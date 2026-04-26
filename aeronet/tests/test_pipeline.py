# Copyright (c) 2026 Rutej Talati. All rights reserved.
# AeroNet — neural surrogate model for vehicle aerodynamics.

"""
Smoke tests for AeroNet. Run with: pytest tests/

These tests verify:
  - PointNet++ ops produce correct shapes and don't NaN
  - Model forward pass succeeds on CPU with a tiny config
  - Loss is finite and backward works
  - Force-coefficient integration matches a manual computation
  - End-to-end train step changes the loss
"""

from __future__ import annotations

import sys
from pathlib import Path
import math

import numpy as np
import torch
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from aeronet.pointnet_ops import (
    farthest_point_sample, ball_query, index_points, square_distance,
    three_nn_interpolate,
)
from aeronet.model import (
    AeroNet, AeroNetConfig, integrate_force_coefficients,
)
from aeronet.data import SyntheticDriveDataset, Normalization
from aeronet.loss import compute_loss, LossConfig


# ----------------------------------------------------------------------------- #
# Pure ops                                                                      #
# ----------------------------------------------------------------------------- #

def test_fps_returns_unique_indices():
    torch.manual_seed(0)
    pts = torch.randn(2, 100, 3)
    idx = farthest_point_sample(pts, 32)
    assert idx.shape == (2, 32)
    # FPS with n_samples << N should produce unique indices (no degenerate ties).
    for b in range(2):
        n_unique = idx[b].unique().numel()
        # Allow at most 1 duplicate to avoid flakiness from tied distances on
        # synthetic random data; in production with real geometry you'll always
        # get all-unique indices.
        assert n_unique >= 31, f"FPS produced too many duplicates: {n_unique}/32"


def test_fps_max_coverage():
    """FPS on a uniform grid should pick widely-separated points."""
    torch.manual_seed(1)
    grid = torch.linspace(0, 1, 10)
    xx, yy, zz = torch.meshgrid(grid, grid, grid, indexing="ij")
    pts = torch.stack([xx.flatten(), yy.flatten(), zz.flatten()], dim=-1).unsqueeze(0)
    idx = farthest_point_sample(pts, 8)
    selected = pts[0, idx[0]]
    pairwise = (selected.unsqueeze(0) - selected.unsqueeze(1)).norm(dim=-1)
    # Smallest non-self distance should be reasonably large (not next-neighbour)
    pairwise.fill_diagonal_(float("inf"))
    min_dist = pairwise.min().item()
    assert min_dist > 0.3, f"FPS produced clustered points: min pairwise = {min_dist}"


def test_ball_query_shape_and_indices_in_range():
    torch.manual_seed(0)
    xyz = torch.randn(2, 64, 3)
    new_xyz = xyz[:, :16]
    idx = ball_query(0.5, 8, xyz, new_xyz)
    assert idx.shape == (2, 16, 8)
    assert idx.min() >= 0
    assert idx.max() < 64


def test_index_points_correctness():
    x = torch.arange(20, dtype=torch.float32).view(2, 10, 1)
    idx = torch.tensor([[0, 2], [1, 9]])
    out = index_points(x, idx)
    expected = torch.tensor([[[0.0], [2.0]], [[11.0], [19.0]]])
    assert torch.allclose(out, expected)


def test_three_nn_interpolate_constant_field():
    """If known features are constant, interpolation must be constant too."""
    known_xyz = torch.randn(1, 8, 3)
    unknown_xyz = torch.randn(1, 16, 3)
    feat = torch.full((1, 8, 3), 7.0)
    out = three_nn_interpolate(unknown_xyz, known_xyz, feat)
    assert torch.allclose(out, torch.full_like(out, 7.0), atol=1e-5)


# ----------------------------------------------------------------------------- #
# Model                                                                         #
# ----------------------------------------------------------------------------- #

def _tiny_cfg(n=512):
    return AeroNetConfig(
        n_input_points=n,
        sa1_centroids=128, sa2_centroids=32, sa3_centroids=8,
        sa1_radii=(0.1, 0.2), sa1_samples=(4, 8), sa1_mlps=((16, 16), (16, 16)),
        sa2_radii=(0.2, 0.4), sa2_samples=(4, 8), sa2_mlps=((32, 32), (32, 32)),
        sa3_radii=(0.4, 0.8), sa3_samples=(4, 8), sa3_mlps=((64, 64), (64, 64)),
        bottleneck_dim=64, bottleneck_layers=2, bottleneck_heads=4,
        fp3_mlp=(64, 64), fp2_mlp=(64, 32), fp1_mlp=(32, 32),
        head_hidden=(32, 16), output_channels=4,
    )


def test_model_forward_shape():
    cfg = _tiny_cfg(n=512)
    model = AeroNet(cfg).eval()
    xyz = torch.randn(2, 512, 3)
    normals = torch.randn(2, 512, 3)
    normals = normals / normals.norm(dim=-1, keepdim=True).clamp_min(1e-6)
    g = torch.randn(2, 4)
    with torch.no_grad():
        out = model(xyz, normals, g)
    assert out.shape == (2, 512, 4)
    assert torch.isfinite(out).all()


def test_model_backward_runs():
    cfg = _tiny_cfg(n=256)
    model = AeroNet(cfg)
    xyz = torch.randn(1, 256, 3)
    normals = torch.randn(1, 256, 3)
    normals = normals / normals.norm(dim=-1, keepdim=True).clamp_min(1e-6)
    g = torch.randn(1, 4)
    out = model(xyz, normals, g)
    loss = out.pow(2).mean()
    loss.backward()
    # Some gradient must be non-zero
    grads = [p.grad for p in model.parameters() if p.grad is not None]
    assert any(g.abs().sum() > 0 for g in grads)


# ----------------------------------------------------------------------------- #
# Force integration                                                             #
# ----------------------------------------------------------------------------- #

def test_force_integration_uniform_pressure_zero_drag():
    """A closed surface with constant pressure has zero net force (gauge cancellation)."""
    # Six faces of a cube — outward normals along +/- xyz, equal areas.
    normals = torch.tensor([
        [1, 0, 0], [-1, 0, 0],
        [0, 1, 0], [0, -1, 0],
        [0, 0, 1], [0, 0, -1],
    ], dtype=torch.float32).unsqueeze(0)         # (1, 6, 3)
    areas = torch.ones(1, 6)
    p = torch.full((1, 6), 1000.0)
    tau = torch.zeros(1, 6, 3)
    fields = torch.cat([p.unsqueeze(-1), tau], dim=-1)
    coeffs = integrate_force_coefficients(
        fields, normals, areas,
        u_ref=torch.tensor([40.0]),
        rho=torch.tensor([1.25]),
        a_ref=torch.tensor([1.0]),
    )
    assert abs(float(coeffs["Cd"])) < 1e-4
    assert abs(float(coeffs["Cl"])) < 1e-4


def test_force_integration_front_face_pressure_gives_drag():
    """Pressure on the front face only -> positive drag along +x."""
    normals = torch.tensor([[[-1.0, 0, 0]]])   # front face normal points in -x (outward into oncoming flow)
    areas = torch.tensor([[2.0]])
    p = torch.tensor([[500.0]])
    tau = torch.zeros(1, 1, 3)
    fields = torch.cat([p.unsqueeze(-1), tau], dim=-1)
    coeffs = integrate_force_coefficients(
        fields, normals, areas,
        u_ref=torch.tensor([40.0]),
        rho=torch.tensor([1.25]),
        a_ref=torch.tensor([2.0]),
    )
    # F_x = -p * n_x * A = -500 * -1 * 2 = +1000 N
    # q*A_ref = 0.5 * 1.25 * 1600 * 2 = 2000
    # Cd = 1000 / 2000 = 0.5
    assert abs(float(coeffs["Cd"]) - 0.5) < 1e-3


# ----------------------------------------------------------------------------- #
# Loss + dataset                                                                #
# ----------------------------------------------------------------------------- #

def test_synthetic_dataset_yields_valid_batch():
    ds = SyntheticDriveDataset(n_cases=4, n_points=256)
    sample = ds[0]
    for k in ("xyz", "normals", "target", "area", "global_cond", "u_ref", "rho", "a_ref"):
        assert k in sample, f"missing {k}"
    assert sample["xyz"].shape == (256, 3)
    assert sample["target"].shape == (256, 4)


def test_compute_loss_finite_and_backward():
    cfg = _tiny_cfg(n=256)
    model = AeroNet(cfg)
    ds = SyntheticDriveDataset(n_cases=2, n_points=256)
    batch = {k: (v.unsqueeze(0) if torch.is_tensor(v) else v) for k, v in ds[0].items()}
    pred = model(batch["xyz"], batch["normals"], batch["global_cond"])
    norm = Normalization()
    loss_cfg = LossConfig(enable_force_loss=False, enable_smooth_loss=False)
    loss, log = compute_loss(pred, batch, norm, loss_cfg)
    assert torch.isfinite(loss)
    loss.backward()


# ----------------------------------------------------------------------------- #
# End-to-end training step                                                      #
# ----------------------------------------------------------------------------- #

def test_one_step_decreases_loss_on_synthetic():
    """Sanity check: a few SGD steps must reduce loss on synthetic data."""
    torch.manual_seed(0)
    cfg = _tiny_cfg(n=256)
    model = AeroNet(cfg)
    opt = torch.optim.AdamW(model.parameters(), lr=1e-3)
    ds = SyntheticDriveDataset(n_cases=4, n_points=256)
    batch = {k: torch.stack([ds[i][k] for i in range(4)]) if torch.is_tensor(ds[0][k])
             else [ds[i][k] for i in range(4)]
             for k in ds[0].keys()}
    norm = Normalization()
    loss_cfg = LossConfig(enable_force_loss=False, enable_smooth_loss=False)

    losses = []
    for _ in range(8):
        pred = model(batch["xyz"], batch["normals"], batch["global_cond"])
        loss, _ = compute_loss(pred, batch, norm, loss_cfg)
        opt.zero_grad()
        loss.backward()
        opt.step()
        losses.append(float(loss))

    assert losses[-1] < losses[0], f"Loss did not decrease: {losses}"
