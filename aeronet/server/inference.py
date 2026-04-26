# Copyright (c) 2026 Rutej Talati. All rights reserved.
# AeroNet — neural surrogate model for vehicle aerodynamics.

"""
Inference logic for the FastAPI server.

Workflow:
    1. Load the trained checkpoint once at startup.
    2. On each request:
        a. Read uploaded mesh (STL / OBJ / VTK / PLY) into a trimesh object.
        b. Auto-scale mm -> m if the geometry is suspiciously large.
        c. FPS-sample to model's input resolution; predict surface fields.
        d. Build TWO viewer payloads from the same prediction.
        e. Integrate predicted fields to (Cd, Cl, Cs).
        f. Return enriched payload including geometry stats, Cp stats, derived metrics.
"""

from __future__ import annotations

import io
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
import torch
import trimesh

from aeronet import (
    AeroNetLitModule,
    integrate_force_coefficients,
    denormalize_fields,
)
from aeronet.pointnet_ops import farthest_point_sample


# ----------------------------------------------------------------------------- #
# Loaded model cache                                                            #
# ----------------------------------------------------------------------------- #

_MODEL_STATE: dict[str, Any] = {
    "lit": None,
    "device": "cpu",
    "checkpoint_path": None,
    "loaded_at": None,
}


def load_checkpoint(ckpt_path: str | Path, device: str = "cpu") -> None:
    ckpt_path = Path(ckpt_path)
    if not ckpt_path.exists():
        raise FileNotFoundError(f"Checkpoint not found: {ckpt_path}")
    print(f"[inference] Loading checkpoint from {ckpt_path} on {device}...")
    t0 = time.time()
    lit = AeroNetLitModule.load_from_checkpoint(
        str(ckpt_path), map_location=device, strict=False,
    )
    lit.eval()
    lit.to(device)
    _MODEL_STATE["lit"] = lit
    _MODEL_STATE["device"] = device
    _MODEL_STATE["checkpoint_path"] = str(ckpt_path)
    _MODEL_STATE["loaded_at"] = time.time()
    print(f"[inference] Loaded in {time.time()-t0:.1f}s. "
          f"n_input_points={lit.model.cfg.n_input_points}")


def model_status() -> dict[str, Any]:
    lit = _MODEL_STATE["lit"]
    if lit is None:
        return {"loaded": False}
    cfg = lit.model.cfg
    return {
        "loaded": True,
        "checkpoint": _MODEL_STATE["checkpoint_path"],
        "device": _MODEL_STATE["device"],
        "loaded_at": _MODEL_STATE["loaded_at"],
        "n_input_points": cfg.n_input_points,
        "use_normals": cfg.use_normals,
        "global_dim": cfg.global_dim,
        "output_channels": cfg.output_channels,
        "params_total_m": round(
            sum(p.numel() for p in lit.model.parameters()) / 1e6, 2
        ),
    }


# ----------------------------------------------------------------------------- #
# Mesh ingestion                                                                #
# ----------------------------------------------------------------------------- #

@dataclass
class IngestedMesh:
    centroids:   np.ndarray
    normals:     np.ndarray
    areas:       np.ndarray
    bbox_min:    np.ndarray
    bbox_max:    np.ndarray
    L_ref:       float
    centre:      np.ndarray
    trimesh_obj: trimesh.Trimesh = field(default=None)
    # Geometry metadata for UI display
    n_faces:     int   = 0
    n_verts:     int   = 0
    units:       str   = "m"      # "mm" or "m"
    length_m:    float = 0.0
    width_m:     float = 0.0
    height_m:    float = 0.0
    is_watertight: bool = False


def ingest_mesh(file_bytes: bytes, filename: str) -> IngestedMesh:
    suffix = Path(filename).suffix.lower()

    if suffix in (".stl", ".obj", ".ply", ".glb", ".off"):
        mesh = trimesh.load_mesh(io.BytesIO(file_bytes), file_type=suffix.lstrip("."))
    elif suffix == ".vtk":
        try:
            import pyvista as pv
        except ImportError as e:
            raise ValueError("VTK uploads require pyvista to be installed.") from e
        import tempfile
        with tempfile.NamedTemporaryFile(suffix=".vtk", delete=False) as tmp:
            tmp.write(file_bytes)
            tmp_path = tmp.name
        try:
            pv_mesh = pv.read(tmp_path)
            faces = pv_mesh.faces.reshape(-1, 4)[:, 1:]
            mesh = trimesh.Trimesh(
                vertices=np.asarray(pv_mesh.points, dtype=np.float64),
                faces=np.asarray(faces, dtype=np.int64),
                process=False,
            )
        finally:
            Path(tmp_path).unlink(missing_ok=True)
    else:
        raise ValueError(f"Unsupported mesh type: {suffix!r}.")

    if isinstance(mesh, trimesh.Scene):
        meshes = [g for g in mesh.geometry.values() if isinstance(g, trimesh.Trimesh)]
        if not meshes:
            raise ValueError("Uploaded file contains no triangle meshes.")
        mesh = trimesh.util.concatenate(meshes)

    if not isinstance(mesh, trimesh.Trimesh) or len(mesh.faces) == 0:
        raise ValueError("Uploaded file has no faces.")

    mesh.fix_normals()

    centroids = np.asarray(mesh.triangles_center, dtype=np.float32)
    normals   = np.asarray(mesh.face_normals,      dtype=np.float32)
    areas     = np.asarray(mesh.area_faces,         dtype=np.float32)

    bbox_min = centroids.min(axis=0)
    bbox_max = centroids.max(axis=0)
    centre   = centroids.mean(axis=0)
    diag     = float(np.linalg.norm(bbox_max - bbox_min))
    L_ref    = max(diag, 1e-6)

    # Auto-scale mm -> m
    original_diag = L_ref
    units = "m"
    if L_ref > 100:
        units = "mm"
        scale     = 0.001
        centroids = centroids * scale
        areas     = areas * (scale ** 2)
        bbox_min  = bbox_min  * scale
        bbox_max  = bbox_max  * scale
        centre    = centre    * scale
        L_ref     = L_ref     * scale
        mesh.apply_scale(scale)
        print(f"[inference] Auto-scaled mm -> m (diagonal was {original_diag:.0f} mm, now {L_ref:.2f} m)")

    length_m = float(bbox_max[0] - bbox_min[0])
    width_m  = float(bbox_max[1] - bbox_min[1])
    height_m = float(bbox_max[2] - bbox_min[2])

    try:
        is_watertight = bool(mesh.is_watertight)
    except Exception:
        is_watertight = False

    return IngestedMesh(
        centroids=centroids,
        normals=normals,
        areas=areas,
        bbox_min=bbox_min,
        bbox_max=bbox_max,
        L_ref=L_ref,
        centre=centre.astype(np.float32),
        trimesh_obj=mesh,
        n_faces=int(len(mesh.faces)),
        n_verts=int(len(mesh.vertices)),
        units=units,
        length_m=round(length_m, 3),
        width_m=round(width_m, 3),
        height_m=round(height_m, 3),
        is_watertight=is_watertight,
    )


# ----------------------------------------------------------------------------- #
# Sampling + normalization                                                      #
# ----------------------------------------------------------------------------- #

def fps_sample_mesh(mesh: IngestedMesh, n_points: int) -> dict[str, np.ndarray]:
    n_total = mesh.centroids.shape[0]
    if n_total <= n_points:
        idx = np.concatenate([
            np.arange(n_total),
            np.full(n_points - n_total, n_total - 1, dtype=np.int64),
        ])
    else:
        xyz_t = torch.from_numpy(mesh.centroids).unsqueeze(0)
        idx_t = farthest_point_sample(xyz_t, n_points)
        idx   = idx_t.squeeze(0).cpu().numpy()

    sampled = {
        "centroids_world": mesh.centroids[idx].astype(np.float32),
        "normals":         mesh.normals[idx].astype(np.float32),
        "areas":           mesh.areas[idx].astype(np.float32),
    }
    sampled["centroids_norm"] = (
        (sampled["centroids_world"] - mesh.centre) / mesh.L_ref
    ).astype(np.float32)
    return sampled


# ----------------------------------------------------------------------------- #
# Viewer payload builders                                                       #
# ----------------------------------------------------------------------------- #

def _interpolate_field_3nn(
    src_points: np.ndarray,
    src_values: np.ndarray,
    dst_points: np.ndarray,
) -> np.ndarray:
    src_points = src_points.astype(np.float32)
    dst_points = dst_points.astype(np.float32)
    N_src = src_points.shape[0]
    N_dst = dst_points.shape[0]
    out   = np.zeros(N_dst, dtype=np.float32)
    chunk = 4096
    for start in range(0, N_dst, chunk):
        end  = min(N_dst, start + chunk)
        diff = dst_points[start:end, None, :] - src_points[None, :, :]
        d2   = (diff * diff).sum(-1)
        k    = min(3, N_src)
        nn_idx  = np.argpartition(d2, k - 1, axis=1)[:, :k]
        rows    = np.arange(end - start)[:, None]
        nn_d    = np.sqrt(np.maximum(d2[rows, nn_idx], 1e-10))
        weights = 1.0 / nn_d
        weights = weights / weights.sum(axis=1, keepdims=True)
        out[start:end] = (src_values[nn_idx] * weights).sum(axis=1)
    return out


def _build_points_payload(
    sampled_world: np.ndarray,
    sampled_cp:    np.ndarray,
    n_viewer_points: int,
    bbox_min: np.ndarray,
    bbox_max: np.ndarray,
) -> dict[str, Any]:
    n = sampled_world.shape[0]
    if n_viewer_points >= n:
        idx = np.arange(n)
    else:
        stride = max(1, n // n_viewer_points)
        idx    = np.arange(0, n, stride)[:n_viewer_points]
    return {
        "positions": sampled_world[idx].flatten().astype(np.float32).tolist(),
        "pressures": sampled_cp[idx].astype(np.float32).tolist(),
        "bbox": {"min": bbox_min.tolist(), "max": bbox_max.tolist()},
        "stats": {
            "length":     float(bbox_max[0] - bbox_min[0]),
            "width":      float(bbox_max[1] - bbox_min[1]),
            "height":     float(bbox_max[2] - bbox_min[2]),
            "pointCount": int(idx.shape[0]),
        },
    }


def _build_mesh_payload(
    mesh_obj:      trimesh.Trimesh,
    sampled_world: np.ndarray,
    sampled_cp:    np.ndarray,
    target_faces:  int,
    bbox_min:      np.ndarray,
    bbox_max:      np.ndarray,
) -> dict[str, Any]:
    n_faces_in = len(mesh_obj.faces)
    decimated = None
    if n_faces_in > target_faces:
        try:
            decimated = mesh_obj.simplify_quadric_decimation(target_faces)
        except Exception:
            decimated = None

    if decimated is None or len(decimated.faces) == 0:
        if n_faces_in > target_faces:
            stride        = max(1, n_faces_in // target_faces)
            keep_face_idx = np.arange(0, n_faces_in, stride)[:target_faces]
            decimated     = mesh_obj.submesh([keep_face_idx], append=True)
        else:
            decimated = mesh_obj

    verts = np.asarray(decimated.vertices, dtype=np.float32)
    faces = np.asarray(decimated.faces,    dtype=np.uint32)
    cp_per_vertex = _interpolate_field_3nn(sampled_world, sampled_cp, verts)

    return {
        "positions": verts.flatten().astype(np.float32).tolist(),
        "indices":   faces.flatten().astype(np.uint32).tolist(),
        "pressures": cp_per_vertex.astype(np.float32).tolist(),
        "bbox": {"min": bbox_min.tolist(), "max": bbox_max.tolist()},
        "stats": {
            "length":      float(bbox_max[0] - bbox_min[0]),
            "width":       float(bbox_max[1] - bbox_min[1]),
            "height":      float(bbox_max[2] - bbox_min[2]),
            "vertexCount": int(verts.shape[0]),
            "faceCount":   int(faces.shape[0]),
        },
    }


# ----------------------------------------------------------------------------- #
# Region classifier                                                             #
# ----------------------------------------------------------------------------- #

def _classify_region(
    centroids_world: np.ndarray,
    bbox_min:        np.ndarray,
    bbox_max:        np.ndarray,
    normals:         np.ndarray,
) -> np.ndarray:
    extent = bbox_max - bbox_min
    rel    = (centroids_world - bbox_min) / np.maximum(extent, 1e-6)
    rx, ry, rz = rel[:, 0], rel[:, 1], rel[:, 2]
    labels = np.zeros(rel.shape[0], dtype=np.int64)
    labels[(rx < 0.20)]                                                               = 0
    labels[(rx >= 0.20) & (rx < 0.80) & (rz >= 0.55)]                               = 1
    labels[(rz < 0.25)]                                                               = 2
    labels[(rx > 0.80)]                                                               = 5
    side = np.abs(ry - 0.5) > 0.30
    labels[(rz < 0.35) & side]                                                        = 3
    labels[(rx > 0.18) & (rx < 0.40) & (np.abs(ry - 0.5) > 0.40) & (rz > 0.45)]   = 4
    return labels


REGION_NAMES = ["Front fascia", "Greenhouse", "Underbody", "Wheels", "Mirrors", "Rear / wake"]


# ----------------------------------------------------------------------------- #
# Top-level prediction                                                          #
# ----------------------------------------------------------------------------- #

@dataclass
class PredictionParams:
    body_type:       str   = "fastback"
    u_ref:           float = 40.0
    rho:             float = 1.225
    a_ref:           float = 2.4
    size_factor:     float = 1.0
    yaw_angle_deg:   float = 0.0    # crosswind yaw angle in degrees
    ground_clearance_mm: float = 100.0  # ride height in mm


_BODY_CLASS = {"notchback": 0, "fastback": 1, "estate": 2, "suv": 3, "pickup": 4}
_BODY_LABEL = {v: k.capitalize() for k, v in _BODY_CLASS.items()}

# Air dynamic viscosity at ~20°C (Pa·s)
_MU_AIR = 1.81e-5


def predict_from_mesh(
    file_bytes:        bytes,
    filename:          str,
    params:            PredictionParams,
    n_viewer_points:   int = 10_000,
    target_mesh_faces: int = 15_000,
) -> dict[str, Any]:
    lit = _MODEL_STATE["lit"]
    if lit is None:
        raise RuntimeError("Model checkpoint not loaded.")

    device   = _MODEL_STATE["device"]
    n_points = lit.model.cfg.n_input_points

    t0 = time.time()
    mesh = ingest_mesh(file_bytes, filename)
    t_ingest = time.time() - t0

    t0 = time.time()
    sampled = fps_sample_mesh(mesh, n_points=n_points)
    t_sample = time.time() - t0

    body_class_id = _BODY_CLASS.get(params.body_type.lower(), 1)

    # Encode yaw angle and ground clearance into global condition vector
    yaw_rad = float(np.deg2rad(params.yaw_angle_deg))
    gc_norm = params.ground_clearance_mm / 150.0   # normalise around 100–200 mm range

    global_cond = np.array([
        params.u_ref  / 50.0,
        params.rho    / 1.25,
        params.a_ref  / 2.5,
        body_class_id / 2.0,
        float(np.sin(yaw_rad)),   # yaw encoded as sin/cos
        float(np.cos(yaw_rad)),
        gc_norm,
    ], dtype=np.float32)

    # Smoke-test model only has global_dim=4 — trim to match
    cfg_global_dim = lit.model.cfg.global_dim
    global_cond = global_cond[:cfg_global_dim]

    t0 = time.time()
    with torch.inference_mode():
        xyz       = torch.from_numpy(sampled["centroids_norm"]).unsqueeze(0).to(device)
        normals_t = torch.from_numpy(sampled["normals"]).unsqueeze(0).to(device)
        areas_t   = torch.from_numpy(sampled["areas"]).unsqueeze(0).to(device)
        global_t  = torch.from_numpy(global_cond).unsqueeze(0).to(device)

        pred_norm = lit.model(xyz, normals_t, global_t)
        pred_phys = denormalize_fields(pred_norm, lit.norm)

        coeffs = integrate_force_coefficients(
            pred_phys, normals_t, areas_t,
            u_ref=torch.tensor([params.u_ref], device=device),
            rho=torch.tensor([params.rho],     device=device),
            a_ref=torch.tensor([params.a_ref], device=device),
        )
    t_inference = time.time() - t0

    pred_phys_np = pred_phys.squeeze(0).cpu().numpy()
    pressure_pa  = pred_phys_np[:, 0]
    tau_pa       = pred_phys_np[:, 1:4]

    q_inf = 0.5 * params.rho * params.u_ref ** 2
    cp    = pressure_pa / max(q_inf, 1e-6)

    # Cp statistics
    cp_min  = float(cp.min())
    cp_max  = float(cp.max())
    cp_mean = float(cp.mean())
    cp_std  = float(cp.std())
    stag_pressure_pa = float(q_inf * cp_max)   # approx stagnation pressure

    # Drag breakdown
    f_pressure_x = -pressure_pa * sampled["normals"][:, 0]
    f_total_x    = (f_pressure_x + tau_pa[:, 0]) * sampled["areas"]

    region_labels = _classify_region(
        sampled["centroids_world"], mesh.bbox_min, mesh.bbox_max, sampled["normals"],
    )
    breakdown = []
    total_drag_force = float(np.abs(f_total_x).sum()) + 1e-6
    for i, name in enumerate(REGION_NAMES):
        mask = region_labels == i
        if not mask.any():
            breakdown.append({"region": name, "fraction": 0.0})
            continue
        frac = float(np.abs(f_total_x[mask]).sum()) / total_drag_force
        breakdown.append({"region": name, "fraction": frac})
    total_frac = sum(b["fraction"] for b in breakdown) or 1.0
    for b in breakdown:
        b["fraction"] = round(b["fraction"] / total_frac, 4)

    # Build viewer payloads
    t0 = time.time()
    points_payload = _build_points_payload(
        sampled_world=sampled["centroids_world"],
        sampled_cp=cp,
        n_viewer_points=n_viewer_points,
        bbox_min=mesh.bbox_min,
        bbox_max=mesh.bbox_max,
    )
    t_points = time.time() - t0

    t0 = time.time()
    mesh_payload = _build_mesh_payload(
        mesh_obj=mesh.trimesh_obj,
        sampled_world=sampled["centroids_world"],
        sampled_cp=cp,
        target_faces=target_mesh_faces,
        bbox_min=mesh.bbox_min,
        bbox_max=mesh.bbox_max,
    )
    t_mesh = time.time() - t0

    is_smoke   = lit.model.cfg.n_input_points <= 4096
    base_conf  = 0.55 if is_smoke else 0.85
    confidence = base_conf - 0.05 * abs(params.size_factor - 1.0) / 0.2

    Cd = float(coeffs["Cd"].cpu().item())
    Cl = float(coeffs["Cl"].cpu().item())
    Cs = float(coeffs["Cs"].cpu().item())
    drag_force_n = Cd * q_inf * params.a_ref
    lift_force_n = Cl * q_inf * params.a_ref

    # Derived aerodynamic metrics
    cda        = round(Cd * params.a_ref, 4)           # drag area m²
    ld_ratio   = round(abs(Cl / Cd), 3) if abs(Cd) > 1e-4 else 0.0
    # Power wasted to aero drag at given speed (watts)
    power_drag_w = round(drag_force_n * params.u_ref, 1)
    # Reynolds number Re = rho * U * L / mu  (L = car length)
    re_number  = round(params.rho * params.u_ref * mesh.length_m / _MU_AIR, 0)

    # Cd benchmarks for context
    cd_benchmarks = [
        {"name": "Tesla Model 3", "Cd": 0.23},
        {"name": "Toyota Camry",  "Cd": 0.28},
        {"name": "VW Golf",       "Cd": 0.30},
        {"name": "Audi A4",       "Cd": 0.27},
        {"name": "BMW 3 Series",  "Cd": 0.26},
        {"name": "Porsche 911",   "Cd": 0.30},
        {"name": "Generic SUV",   "Cd": 0.38},
    ]
    # Cd quality band
    if Cd < 0.25:
        cd_rating = "Excellent"
    elif Cd < 0.30:
        cd_rating = "Good"
    elif Cd < 0.35:
        cd_rating = "Average"
    else:
        cd_rating = "High drag"

    inference_ms = (t_ingest + t_sample + t_inference + t_points + t_mesh) * 1000.0

    return {
        # Core aero coefficients
        "Cd": round(Cd, 4),
        "Cl": round(Cl, 4),
        "Cs": round(Cs, 4),
        "dragForceN":    round(drag_force_n, 1),
        "liftForceN":    round(lift_force_n, 1),
        "qInfPa":        round(q_inf, 1),
        "confidence":    round(max(0.0, min(1.0, confidence)), 3),
        "bodyTypeLabel": _BODY_LABEL.get(body_class_id, "Unknown"),
        "dragBreakdown": breakdown,

        # Derived metrics (new)
        "CdA":          cda,
        "ldRatio":      ld_ratio,
        "powerDragW":   power_drag_w,
        "reynoldsNumber": int(re_number),
        "cdRating":     cd_rating,
        "cdBenchmarks": cd_benchmarks,

        # Cp field statistics (new)
        "cpStats": {
            "min":  round(cp_min, 4),
            "max":  round(cp_max, 4),
            "mean": round(cp_mean, 4),
            "std":  round(cp_std, 4),
            "stagPressurePa": round(stag_pressure_pa, 1),
        },

        # Geometry metadata (new)
        "geometry": {
            "nFaces":       mesh.n_faces,
            "nVerts":       mesh.n_verts,
            "units":        mesh.units,
            "lengthM":      mesh.length_m,
            "widthM":       mesh.width_m,
            "heightM":      mesh.height_m,
            "isWatertight": mesh.is_watertight,
        },

        # Simulation parameters echo (new)
        "simParams": {
            "yawAngleDeg":       params.yaw_angle_deg,
            "groundClearanceMm": params.ground_clearance_mm,
            "turbulenceModel":   "k-ω SST (RANS)",
            "solverType":        "Neural surrogate (AeroNet)",
            "uRef":              params.u_ref,
            "rho":               params.rho,
            "aRef":              params.a_ref,
        },

        # Viewer payloads
        "viewer": {
            "points": points_payload,
            "mesh":   mesh_payload,
        },
        "pointCloud":  points_payload,

        "inferenceMs": round(inference_ms, 0),
        "timestamp":   time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "modelInfo": {
            "isSmokeTest":  is_smoke,
            "checkpoint":   _MODEL_STATE["checkpoint_path"],
            "nInputPoints": n_points,
            "device":       device,
            "timing": {
                "ingestMs":    round(t_ingest    * 1000, 1),
                "sampleMs":    round(t_sample    * 1000, 1),
                "inferenceMs": round(t_inference * 1000, 1),
                "pointsMs":    round(t_points    * 1000, 1),
                "meshMs":      round(t_mesh      * 1000, 1),
            },
        },
    }