# Copyright (c) 2026 Rutej Talati. All rights reserved.
# AeroNet — neural surrogate model for vehicle aerodynamics.

"""
Data pipeline for DrivAerStar surface VTK files.

The DrivAerStar release stores per-case surface meshes as VTK polydata with
cell-centered arrays:
  - "Pressure"            : (N_cells,)        Pa, gauge
  - "WallShearStressi"    : (N_cells,)        Pa, x-component
  - "WallShearStressj"    : (N_cells,)        Pa, y-component
  - "WallShearStressk"    : (N_cells,)        Pa, z-component
  - "Area"                : (N_cells,)        m^2  (CellSize filter output)
  - "Normals"             : (N_cells, 3)      unit normals

This module:
  1. Reads a raw VTK and extracts all of the above as tensors.
  2. Subsamples to a fixed point count by farthest-point-sampling (FPS) on
     cell centroids, keeping geometry coverage.
  3. Normalizes coordinates to a unit-length car (L_ref scaling) and centres
     at the geometric centroid so the model sees the same canonical frame
     regardless of vehicle size.
  4. Caches the processed tensor dict to .pt for fast subsequent epochs.
  5. Optionally augments at train time (random rotation about z, jitter).

The class also provides a `SyntheticDriveDataset` for end-to-end pipeline
validation on a laptop with no GPU and no real data, so you can confirm the
training loop runs before renting cloud compute.
"""

from __future__ import annotations

import json
import math
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Sequence

import numpy as np
import torch
from torch import Tensor
from torch.utils.data import Dataset

from .pointnet_ops import farthest_point_sample


# ----------------------------------------------------------------------------- #
# Normalization helpers                                                         #
# ----------------------------------------------------------------------------- #

@dataclass
class Normalization:
    """Per-tensor normalization stats. Computed once over the train split."""

    p_mean: float = 0.0
    p_std: float = 1.0
    tau_mean: tuple[float, float, float] = (0.0, 0.0, 0.0)
    tau_std: tuple[float, float, float] = (1.0, 1.0, 1.0)
    # We normalize coordinates by the per-case bounding-box length, not by
    # train-set statistics, so the model is scale-invariant.

    def to_dict(self) -> dict:
        return {
            "p_mean": self.p_mean,
            "p_std": self.p_std,
            "tau_mean": list(self.tau_mean),
            "tau_std": list(self.tau_std),
        }

    @classmethod
    def from_dict(cls, d: dict) -> "Normalization":
        return cls(
            p_mean=d["p_mean"],
            p_std=d["p_std"],
            tau_mean=tuple(d["tau_mean"]),
            tau_std=tuple(d["tau_std"]),
        )

    def save(self, path: str | Path) -> None:
        Path(path).write_text(json.dumps(self.to_dict(), indent=2))

    @classmethod
    def load(cls, path: str | Path) -> "Normalization":
        return cls.from_dict(json.loads(Path(path).read_text()))


# ----------------------------------------------------------------------------- #
# VTK reading                                                                   #
# ----------------------------------------------------------------------------- #

def _read_vtk_surface(vtk_path: str | Path) -> dict[str, np.ndarray]:
    """
    Read a DrivAerStar surface VTK using PyVista. Returns a dict of numpy
    arrays. Cell-centered arrays are evaluated at cell centroids.

    Importing pyvista at module level breaks pure-CPU smoke tests for users
    who don't have it installed, so we import lazily.
    """
    try:
        import pyvista as pv
    except ImportError as e:
        raise ImportError(
            "pyvista is required to read DrivAerStar VTK files. "
            "Install with: pip install 'pyvista>=0.44'"
        ) from e

    mesh = pv.read(str(vtk_path))
    # Some DrivAerStar files store data on cells, some on points. The
    # post-processing pipeline (2N_pv.py etc.) writes cell-data, so prefer that.
    cd = mesh.cell_data
    pd = mesh.point_data

    def _get(name: str) -> np.ndarray | None:
        if name in cd:
            return np.asarray(cd[name])
        if name in pd:
            return np.asarray(pd[name])
        return None

    centroids = np.asarray(mesh.cell_centers().points, dtype=np.float32)  # (N, 3)
    pressure = _get("Pressure")
    tau_i = _get("WallShearStressi")
    tau_j = _get("WallShearStressj")
    tau_k = _get("WallShearStressk")
    area = _get("Area")
    normals = _get("Normals")

    # Normals may be stored as point data; recompute from cell normals if missing.
    if normals is None or normals.ndim != 2 or normals.shape[1] != 3:
        mesh = mesh.compute_normals(cell_normals=True, point_normals=False, auto_orient_normals=True)
        normals = np.asarray(mesh.cell_data["Normals"])

    if area is None:
        # Fallback: use built-in cell sizes
        sized = mesh.compute_cell_sizes(area=True)
        area = np.asarray(sized.cell_data["Area"])

    # Some cases may have missing tau (e.g. porosity blocks) -> fill with zeros.
    if tau_i is None or tau_j is None or tau_k is None:
        N = centroids.shape[0]
        tau_i = np.zeros(N, dtype=np.float32) if tau_i is None else tau_i
        tau_j = np.zeros(N, dtype=np.float32) if tau_j is None else tau_j
        tau_k = np.zeros(N, dtype=np.float32) if tau_k is None else tau_k

    if pressure is None:
        raise ValueError(f"VTK file {vtk_path} has no 'Pressure' array")

    return {
        "xyz": centroids,                                            # (N, 3)
        "normals": normals.astype(np.float32),                       # (N, 3)
        "area": area.astype(np.float32),                             # (N,)
        "p": pressure.astype(np.float32),                            # (N,)
        "tau": np.stack([tau_i, tau_j, tau_k], axis=-1).astype(np.float32),  # (N, 3)
    }


# ----------------------------------------------------------------------------- #
# Per-case preprocessing                                                        #
# ----------------------------------------------------------------------------- #

def _fps_subsample(case: dict[str, np.ndarray], n_points: int, device: str = "cpu") -> dict:
    """Run FPS on cell centroids and gather every per-cell array by the same
    indices. Done once per case at cache build, not at training time."""
    xyz = torch.from_numpy(case["xyz"]).unsqueeze(0).to(device)      # (1, N, 3)
    if xyz.shape[1] <= n_points:
        idx = torch.arange(xyz.shape[1], device=device).unsqueeze(0)
        # If we have fewer points than requested, repeat the last point to pad.
        if xyz.shape[1] < n_points:
            pad = torch.full((1, n_points - xyz.shape[1]), xyz.shape[1] - 1, device=device)
            idx = torch.cat([idx, pad], dim=1)
    else:
        idx = farthest_point_sample(xyz, n_points)                   # (1, n_points)

    idx_np = idx.squeeze(0).cpu().numpy()
    return {
        "xyz": case["xyz"][idx_np],
        "normals": case["normals"][idx_np],
        "area": case["area"][idx_np],
        "p": case["p"][idx_np],
        "tau": case["tau"][idx_np],
    }


def _canonicalize_geometry(case: dict[str, np.ndarray]) -> tuple[dict, float, np.ndarray]:
    """Centre at geometric centroid and scale to unit bounding-box diagonal.
    Returns the canonicalized case, the scale factor (L_ref) and the centre."""
    xyz = case["xyz"]
    centre = xyz.mean(axis=0)
    xyz_c = xyz - centre
    bbox_diag = np.linalg.norm(xyz_c.max(0) - xyz_c.min(0))
    L_ref = float(bbox_diag) if bbox_diag > 1e-6 else 1.0

    out = dict(case)
    out["xyz"] = (xyz_c / L_ref).astype(np.float32)
    # Areas scale by L_ref^2 in the normalized frame; we keep raw area
    # because the loss uses normalized fields, and force integration uses
    # raw area + raw fields separately.
    out["area_normalized"] = (case["area"] / (L_ref ** 2)).astype(np.float32)
    return out, L_ref, centre


def preprocess_case(
    vtk_path: str | Path,
    n_points: int,
    fps_device: str = "cpu",
) -> dict:
    """End-to-end: read VTK -> FPS subsample -> canonicalize. Output is a
    plain dict of numpy arrays ready to be torch.save'd."""
    raw = _read_vtk_surface(vtk_path)
    sub = _fps_subsample(raw, n_points=n_points, device=fps_device)
    canon, L_ref, centre = _canonicalize_geometry(sub)
    canon["L_ref"] = np.float32(L_ref)
    canon["centre"] = centre.astype(np.float32)
    return canon


# ----------------------------------------------------------------------------- #
# Datasets                                                                      #
# ----------------------------------------------------------------------------- #

@dataclass
class DriveAerStarSplit:
    """One split of the DrivAerStar dataset. Each entry pairs a case-id with
    physics conditions used during the corresponding CFD run."""

    case_ids: list[str]
    body_class: list[int]      # 0=Notch, 1=Fast, 2=Estate
    u_ref: list[float]         # m/s
    rho: list[float]           # kg/m^3
    a_ref: list[float]         # m^2 (frontal area)
    cd_target: list[float] | None = None     # may be None if not parsed yet


class DrivAerStarDataset(Dataset):
    """
    Loads preprocessed DrivAerStar cases from a cache directory.

    Expected directory layout:

        cache_dir/
            normalization.json
            00001.pt
            00002.pt
            ...

    Each .pt file is a dict produced by `preprocess_case`. The split metadata
    (body class, U_ref, etc.) lives in a separate JSON manifest so we can
    swap dataset versions without re-caching.
    """

    def __init__(
        self,
        cache_dir: str | Path,
        split: DriveAerStarSplit,
        normalization: Normalization,
        augment: bool = False,
        rotation_deg: float = 5.0,
        jitter_std: float = 0.005,
    ):
        self.cache_dir = Path(cache_dir)
        self.split = split
        self.norm = normalization
        self.augment = augment
        self.rotation_deg = rotation_deg
        self.jitter_std = jitter_std

    def __len__(self) -> int:
        return len(self.split.case_ids)

    def _augment(self, xyz: np.ndarray, normals: np.ndarray, tau: np.ndarray):
        """Random small yaw rotation about z + per-point xyz jitter.

        We only rotate about z because the inflow direction is fixed along x;
        a full SO(3) augmentation would change the physics. Tau vectors must
        be rotated together with normals."""
        if self.rotation_deg > 0:
            theta = math.radians(np.random.uniform(-self.rotation_deg, self.rotation_deg))
            c, s = math.cos(theta), math.sin(theta)
            R = np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]], dtype=np.float32)
            xyz = xyz @ R.T
            normals = normals @ R.T
            tau = tau @ R.T
        if self.jitter_std > 0:
            xyz = xyz + np.random.normal(0.0, self.jitter_std, size=xyz.shape).astype(np.float32)
        return xyz, normals, tau

    def __getitem__(self, idx: int) -> dict[str, Tensor]:
        case_id = self.split.case_ids[idx]
        path = self.cache_dir / f"{case_id}.pt"
        case = torch.load(path, weights_only=False)

        xyz = case["xyz"]              # already normalized
        normals = case["normals"]
        p = case["p"]
        tau = case["tau"]
        area = case["area"]            # raw, in m^2
        L_ref = float(case["L_ref"])

        if self.augment:
            xyz, normals, tau = self._augment(xyz, normals, tau)

        # Field normalization. We z-score pressure and tau using train stats so
        # the loss is well-scaled across the (very different) field magnitudes.
        p_norm = (p - self.norm.p_mean) / max(self.norm.p_std, 1e-6)
        tau_mean = np.array(self.norm.tau_mean, dtype=np.float32)
        tau_std = np.array(self.norm.tau_std, dtype=np.float32)
        tau_norm = (tau - tau_mean) / np.maximum(tau_std, 1e-6)

        target = np.concatenate([p_norm[:, None], tau_norm], axis=-1).astype(np.float32)

        # Global condition: (U_ref / 50, rho / 1.25, A_ref / 2.5, body_class_onehot...)
        # We feed body_class as a learned token via class index, but for a simple
        # global vector we one-hot it within G dims. Default G=4: [u, rho, a, class_id]
        u_ref = self.split.u_ref[idx]
        rho = self.split.rho[idx]
        a_ref = self.split.a_ref[idx]
        body_class = self.split.body_class[idx]
        global_cond = np.array(
            [u_ref / 50.0, rho / 1.25, a_ref / 2.5, body_class / 2.0],
            dtype=np.float32,
        )

        out = {
            "case_id": case_id,
            "xyz": torch.from_numpy(xyz),                            # (N, 3)
            "normals": torch.from_numpy(normals),                    # (N, 3)
            "target": torch.from_numpy(target),                      # (N, 4) normalized
            "area": torch.from_numpy(area),                          # (N,) raw m^2
            "p_raw": torch.from_numpy(p),                            # (N,) Pa
            "tau_raw": torch.from_numpy(tau),                        # (N, 3) Pa
            "global_cond": torch.from_numpy(global_cond),            # (G,)
            "u_ref": torch.tensor(u_ref, dtype=torch.float32),
            "rho": torch.tensor(rho, dtype=torch.float32),
            "a_ref": torch.tensor(a_ref, dtype=torch.float32),
            "L_ref": torch.tensor(L_ref, dtype=torch.float32),
            "body_class": torch.tensor(body_class, dtype=torch.long),
        }
        if self.split.cd_target is not None:
            out["cd_target"] = torch.tensor(self.split.cd_target[idx], dtype=torch.float32)
        return out


def compute_normalization(
    cache_dir: str | Path,
    case_ids: Sequence[str],
    max_cases_for_stats: int = 200,
) -> Normalization:
    """Pass over a sample of training cases to compute pressure/tau mean and std."""
    cache_dir = Path(cache_dir)
    rng = np.random.default_rng(0)
    sample_ids = list(case_ids)
    if len(sample_ids) > max_cases_for_stats:
        sample_ids = rng.choice(sample_ids, size=max_cases_for_stats, replace=False).tolist()

    p_vals: list[np.ndarray] = []
    tau_vals: list[np.ndarray] = []
    for cid in sample_ids:
        case = torch.load(cache_dir / f"{cid}.pt", weights_only=False)
        p_vals.append(case["p"].astype(np.float64))
        tau_vals.append(case["tau"].astype(np.float64))
    p = np.concatenate(p_vals)
    tau = np.concatenate(tau_vals, axis=0)

    return Normalization(
        p_mean=float(p.mean()),
        p_std=float(p.std() + 1e-8),
        tau_mean=tuple(float(x) for x in tau.mean(axis=0)),
        tau_std=tuple(float(x + 1e-8) for x in tau.std(axis=0)),
    )


# ----------------------------------------------------------------------------- #
# Synthetic dataset for laptop validation                                       #
# ----------------------------------------------------------------------------- #

class SyntheticDriveDataset(Dataset):
    """
    Generates fake car-like point clouds and synthetic pressure/shear fields
    on the fly. Lets you validate the entire training pipeline (model forward,
    backward, loss, dataloader, checkpointing) on a laptop without GPU and
    without DrivAerStar in hand.

    The synthetic fields are deterministic functions of geometry + a few
    parameters, so the model can actually learn them and you can confirm the
    loss decreases.
    """

    def __init__(self, n_cases: int = 64, n_points: int = 4096, seed: int = 0):
        self.n_cases = n_cases
        self.n_points = n_points
        self.rng = np.random.default_rng(seed)
        # Pre-generate per-case parameters
        self.params = [
            {
                "scale": self.rng.uniform(0.9, 1.1, size=3).astype(np.float32),
                "bump": self.rng.uniform(-0.1, 0.1, size=3).astype(np.float32),
                "u_ref": float(self.rng.uniform(30, 50)),
                "a_ref": float(self.rng.uniform(2.0, 2.6)),
                "body_class": int(self.rng.integers(0, 3)),
            }
            for _ in range(n_cases)
        ]

    def __len__(self) -> int:
        return self.n_cases

    @staticmethod
    def _car_like_cloud(n: int, scale: np.ndarray, bump: np.ndarray, rng: np.random.Generator):
        # Sample on an ellipsoid + a "roof bump" to make it not a sphere.
        u = rng.uniform(-1.0, 1.0, n)
        v = rng.uniform(0.0, 2 * np.pi, n)
        r = np.sqrt(np.maximum(0.0, 1.0 - u ** 2))
        x = r * np.cos(v)
        y = r * np.sin(v)
        z = u
        pts = np.stack([x, y, z], axis=-1).astype(np.float32) * scale
        pts[:, 2] += bump[2] * np.exp(-((pts[:, 0] - bump[0]) ** 2 + (pts[:, 1] - bump[1]) ** 2) * 4)
        # Normals approximated by point - centre of bbox
        centre = pts.mean(axis=0)
        normals = pts - centre
        normals = normals / (np.linalg.norm(normals, axis=-1, keepdims=True) + 1e-8)
        return pts, normals.astype(np.float32)

    def __getitem__(self, idx: int) -> dict[str, Tensor]:
        p_idx = self.params[idx]
        rng = np.random.default_rng(idx + 1)
        xyz, normals = self._car_like_cloud(self.n_points, p_idx["scale"], p_idx["bump"], rng)

        # Synthetic pressure: cosine of angle between normal and inflow x-axis,
        # scaled by U^2. This gives the model a learnable, physical-ish target.
        u_ref = p_idx["u_ref"]
        cos_theta = normals[:, 0]                                    # n . x_hat
        p_field = -0.5 * 1.225 * (u_ref ** 2) * cos_theta + 5.0 * np.cos(8 * xyz[:, 0])
        # Synthetic wall shear: aligned with inflow on lee side
        tau_mag = 1.5 * (u_ref / 40.0) * np.maximum(0.0, 1.0 - cos_theta)
        tau = np.stack([tau_mag, 0.05 * tau_mag, 0.05 * tau_mag], axis=-1).astype(np.float32)

        # "Areas": uniform on the synthetic surface
        area = np.full(self.n_points, 4 * np.pi / self.n_points, dtype=np.float32)

        # Centre + scale to unit
        centre = xyz.mean(axis=0)
        xyz_c = xyz - centre
        L = float(np.linalg.norm(xyz_c.max(0) - xyz_c.min(0))) or 1.0
        xyz_n = (xyz_c / L).astype(np.float32)

        target = np.concatenate([p_field[:, None], tau], axis=-1).astype(np.float32)
        global_cond = np.array(
            [u_ref / 50.0, 1.225 / 1.25, p_idx["a_ref"] / 2.5, p_idx["body_class"] / 2.0],
            dtype=np.float32,
        )

        return {
            "case_id": f"synth_{idx:05d}",
            "xyz": torch.from_numpy(xyz_n),
            "normals": torch.from_numpy(normals),
            "target": torch.from_numpy(target),
            "area": torch.from_numpy(area),
            "p_raw": torch.from_numpy(p_field.astype(np.float32)),
            "tau_raw": torch.from_numpy(tau),
            "global_cond": torch.from_numpy(global_cond),
            "u_ref": torch.tensor(u_ref, dtype=torch.float32),
            "rho": torch.tensor(1.225, dtype=torch.float32),
            "a_ref": torch.tensor(p_idx["a_ref"], dtype=torch.float32),
            "L_ref": torch.tensor(L, dtype=torch.float32),
            "body_class": torch.tensor(p_idx["body_class"], dtype=torch.long),
        }
