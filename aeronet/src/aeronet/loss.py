# Copyright (c) 2026 Rutej Talati. All rights reserved.
# AeroNet — neural surrogate model for vehicle aerodynamics.

"""
Multi-task loss for surface field prediction.

We combine three terms because pure pointwise field MSE is known to converge
to a "blurry" predictor that gets average pressure right but misses the
sharp wake gradients that drive Cd. Adding an explicit Cd loss pulls the
optimizer toward predictions that integrate to the right force, and a small
neighbour-smoothness term stabilizes early training when the field statistics
are still being learnt.

    L_total = w_field * L_field + w_force * L_force + w_smooth * L_smooth

where:
    L_field   = weighted MSE on (p, tau_x, tau_y, tau_z) in normalized units
    L_force   = L1 on (Cd, Cl) integrated from un-normalized predictions
    L_smooth  = mean-squared difference between each point and its k-NN average,
                applied to predicted fields only.
"""

from __future__ import annotations

from dataclasses import dataclass

import torch
import torch.nn.functional as F
from torch import Tensor

from .model import integrate_force_coefficients
from .data import Normalization
from .pointnet_ops import square_distance, index_points


@dataclass
class LossConfig:
    w_field: float = 1.0
    w_force: float = 0.5
    w_smooth: float = 0.05
    pressure_weight: float = 1.0       # relative weight of p vs tau in field loss
    tau_weight: float = 1.0
    smooth_k: int = 8                  # k-NN size for smoothness term
    enable_force_loss: bool = True
    enable_smooth_loss: bool = True


def _knn_smoothness(xyz: Tensor, fields: Tensor, k: int) -> Tensor:
    """
    Mean-squared difference between each point's prediction and its k-NN average.

    Args:
        xyz:    (B, N, 3)
        fields: (B, N, C)
        k: number of neighbours

    Returns:
        scalar loss
    """
    # Find k+1 nearest points (including self), drop self
    d = square_distance(xyz, xyz)                                    # (B, N, N)
    _, idx = d.topk(k=k + 1, largest=False)                          # (B, N, k+1)
    idx = idx[..., 1:]                                               # drop self
    nbr_fields = index_points(fields, idx)                           # (B, N, k, C)
    mean_nbr = nbr_fields.mean(dim=2)                                # (B, N, C)
    return F.mse_loss(fields, mean_nbr)


def denormalize_fields(
    pred_norm: Tensor,           # (B, N, 4)
    norm: Normalization,
    device: torch.device | None = None,
) -> Tensor:
    """Convert z-scored predictions back to physical units (Pa)."""
    device = device or pred_norm.device
    p_mean = torch.tensor(norm.p_mean, device=device, dtype=pred_norm.dtype)
    p_std = torch.tensor(norm.p_std, device=device, dtype=pred_norm.dtype)
    tau_mean = torch.tensor(norm.tau_mean, device=device, dtype=pred_norm.dtype)
    tau_std = torch.tensor(norm.tau_std, device=device, dtype=pred_norm.dtype)

    p_phys = pred_norm[..., 0] * p_std + p_mean                      # (B, N)
    tau_phys = pred_norm[..., 1:4] * tau_std + tau_mean              # (B, N, 3)
    return torch.cat([p_phys.unsqueeze(-1), tau_phys], dim=-1)


def compute_loss(
    pred_norm: Tensor,           # (B, N, 4) model output (normalized)
    batch: dict,                 # output from DataLoader
    norm: Normalization,
    cfg: LossConfig,
) -> tuple[Tensor, dict[str, float]]:
    """
    Returns:
        total_loss: scalar tensor (for backward)
        log_dict:   dict of float metrics for logging
    """
    target = batch["target"]                                         # (B, N, 4)
    log: dict[str, float] = {}

    # ---- 1. Pointwise field loss in normalized space ----
    p_loss = F.mse_loss(pred_norm[..., 0], target[..., 0])
    tau_loss = F.mse_loss(pred_norm[..., 1:4], target[..., 1:4])
    field_loss = cfg.pressure_weight * p_loss + cfg.tau_weight * tau_loss
    log["loss/p_mse_norm"] = float(p_loss.detach())
    log["loss/tau_mse_norm"] = float(tau_loss.detach())

    total = cfg.w_field * field_loss

    # ---- 2. Force-coefficient loss in physical units ----
    if cfg.enable_force_loss and cfg.w_force > 0:
        pred_phys = denormalize_fields(pred_norm, norm)              # (B, N, 4)
        coeffs = integrate_force_coefficients(
            pred_fields=pred_phys,
            normals=batch["normals"],
            areas=batch["area"],
            u_ref=batch["u_ref"],
            rho=batch["rho"],
            a_ref=batch["a_ref"],
            drag_axis=0,                                             # x = inflow
            lift_axis=2,                                             # z = up
        )
        # Reference force coefficients computed from ground-truth fields by the
        # exact same integrator -> "self-consistent" target. This way we don't
        # need a precomputed Cd target file; if cd_target is provided we use it.
        gt_target = torch.cat(
            [batch["p_raw"].unsqueeze(-1), batch["tau_raw"]], dim=-1
        )
        gt_coeffs = integrate_force_coefficients(
            pred_fields=gt_target,
            normals=batch["normals"],
            areas=batch["area"],
            u_ref=batch["u_ref"],
            rho=batch["rho"],
            a_ref=batch["a_ref"],
            drag_axis=0,
            lift_axis=2,
        )
        cd_loss = F.l1_loss(coeffs["Cd"], gt_coeffs["Cd"])
        cl_loss = F.l1_loss(coeffs["Cl"], gt_coeffs["Cl"])
        force_loss = cd_loss + 0.5 * cl_loss
        total = total + cfg.w_force * force_loss
        log["loss/cd_l1"] = float(cd_loss.detach())
        log["loss/cl_l1"] = float(cl_loss.detach())
        log["metric/cd_pred_mean"] = float(coeffs["Cd"].mean().detach())
        log["metric/cd_gt_mean"] = float(gt_coeffs["Cd"].mean().detach())

    # ---- 3. Smoothness regularizer ----
    if cfg.enable_smooth_loss and cfg.w_smooth > 0:
        smooth = _knn_smoothness(batch["xyz"], pred_norm, k=cfg.smooth_k)
        total = total + cfg.w_smooth * smooth
        log["loss/smooth"] = float(smooth.detach())

    log["loss/total"] = float(total.detach())
    return total, log
