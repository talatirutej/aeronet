# Copyright (c) 2026 Rutej Talati. All rights reserved.
# AeroNet — neural surrogate model for vehicle aerodynamics.

"""
AeroNet: a hybrid PointNet++ / Physics-Attention model for surface
aerodynamic field prediction on automotive geometries.

Architecture overview
---------------------

    Input:  per-cell surface centroid xyz (B, N, 3)
            optional per-cell normal      (B, N, 3)
            optional global condition     (B, G)   e.g. inflow velocity, ref area

    [Set Abstraction 1]    N -> N1   (multi-scale grouping, channels: 3+f -> 64)
    [Set Abstraction 2]    N1 -> N2  (channels: 64 -> 128)
    [Set Abstraction 3]    N2 -> N3  (channels: 128 -> 256)

    [Physics-Attention Bottleneck]    self-attention over N3 latent tokens
                                       conditioned on global features

    [Feature Propagation 3]  N3 -> N2  (skip connect)
    [Feature Propagation 2]  N2 -> N1  (skip connect)
    [Feature Propagation 1]  N1 -> N   (skip connect)

    [Per-point Head]   ->  (p, tau_x, tau_y, tau_z) per surface cell

    [Cd Integration]   differentiable surface integral -> scalar Cd, Cl, Cs

The "physics-attention bottleneck" is the genuinely original piece versus a
vanilla PointNet++ regressor. It treats the N3 sub-sampled centroids as tokens
in a small Transformer and lets every centroid attend to every other, which
captures long-range flow structure (wake-to-front interactions, pressure
recovery effects) that local ball-query MLPs cannot model on their own.
This is the same idea Transolver uses ("physics-aware attention slicing"), but
applied to the bottleneck of a U-Net-style point network so we keep the
multi-scale locality benefits and only pay attention cost on a small set of
sub-sampled points (N3 = 256 in the default config).
"""

from __future__ import annotations

from dataclasses import dataclass, field

import torch
import torch.nn as nn
import torch.nn.functional as F
from torch import Tensor

from .pointnet_ops import (
    sample_and_group,
    three_nn_interpolate,
    index_points,
    farthest_point_sample,
    ball_query,
)


# ----------------------------------------------------------------------------- #
# Building blocks                                                               #
# ----------------------------------------------------------------------------- #

class SharedMLP(nn.Module):
    """Per-point MLP applied independently to each point. Standard PointNet block."""

    def __init__(self, channels: list[int], use_bn: bool = True, dropout: float = 0.0):
        super().__init__()
        layers: list[nn.Module] = []
        for c_in, c_out in zip(channels[:-1], channels[1:]):
            # Conv2d with kernel 1 is exactly a per-point linear layer; using
            # Conv2d (not Conv1d) lets us share the same code for grouped (B,M,K,C)
            # and ungrouped (B,N,C) tensors via reshaping.
            layers.append(nn.Conv2d(c_in, c_out, kernel_size=1, bias=not use_bn))
            if use_bn:
                layers.append(nn.BatchNorm2d(c_out))
            layers.append(nn.GELU())
            if dropout > 0:
                layers.append(nn.Dropout2d(dropout))
        self.net = nn.Sequential(*layers)

    def forward(self, x: Tensor) -> Tensor:
        # Accept (B, C, ...) tensors, treat last 2 dims as spatial
        if x.dim() == 3:                                             # (B, C, N)
            x = x.unsqueeze(-1)                                      # (B, C, N, 1)
            x = self.net(x)
            return x.squeeze(-1)
        return self.net(x)                                           # (B, C, M, K)


class SetAbstraction(nn.Module):
    """
    Multi-scale grouping (MSG) PointNet++ set abstraction.

    Subsamples the point cloud by FPS, then for each centroid runs ball-query
    at multiple radii, applies an MLP per scale, max-pools each scale's
    neighbourhood, and concatenates scales into the centroid feature.
    """

    def __init__(
        self,
        n_centroids: int,
        radii: list[float],
        n_samples_per_scale: list[int],
        in_channels: int,
        mlp_per_scale: list[list[int]],
    ):
        super().__init__()
        assert len(radii) == len(n_samples_per_scale) == len(mlp_per_scale)
        self.n_centroids = n_centroids
        self.radii = radii
        self.n_samples = n_samples_per_scale
        # Each scale gets its own MLP. Input is (3 relative xyz) + in_channels.
        self.mlps = nn.ModuleList([
            SharedMLP([3 + in_channels] + mlp_per_scale[i])
            for i in range(len(radii))
        ])
        self.out_channels = sum(mlp[-1] for mlp in mlp_per_scale)

    def forward(self, xyz: Tensor, features: Tensor | None) -> tuple[Tensor, Tensor]:
        """
        Args:
            xyz:      (B, N, 3)
            features: (B, N, C) or None

        Returns:
            new_xyz:      (B, M, 3)
            new_features: (B, C_out, M)  channels-first, ready for next SA's
                          .transpose(1, 2) call. C_out = sum(mlp[-1] for mlp in mlps).
        """
        B = xyz.shape[0]

        # FPS once, ball-query separately per radius (centroids shared across scales)
        fps_idx = farthest_point_sample(xyz, self.n_centroids)
        new_xyz = index_points(xyz, fps_idx)                         # (B, M, 3)

        scale_outputs = []
        for i, (radius, k) in enumerate(zip(self.radii, self.n_samples)):
            nbr_idx = ball_query(radius, k, xyz, new_xyz)            # (B, M, K)
            grouped_xyz = index_points(xyz, nbr_idx)                 # (B, M, K, 3)
            grouped_xyz_rel = grouped_xyz - new_xyz.unsqueeze(2)
            if features is not None:
                grouped_feat = index_points(features, nbr_idx)       # (B, M, K, C)
                grouped = torch.cat([grouped_xyz_rel, grouped_feat], dim=-1)
            else:
                grouped = grouped_xyz_rel
            # (B, M, K, C') -> (B, C', M, K) for Conv2d
            grouped = grouped.permute(0, 3, 1, 2).contiguous()
            grouped = self.mlps[i](grouped)                          # (B, C_out_i, M, K)
            # Symmetric reduction across neighbours
            scale_outputs.append(grouped.max(dim=-1)[0])             # (B, C_out_i, M)

        new_features = torch.cat(scale_outputs, dim=1)               # (B, C_out, M)
        return new_xyz, new_features


class FeaturePropagation(nn.Module):
    """
    PointNet++ feature-propagation (upsampling) layer with skip connections.
    Interpolates features from a coarse set to a fine set, concatenates with
    the fine set's features, and passes through a per-point MLP.
    """

    def __init__(self, in_channels: int, mlp: list[int]):
        super().__init__()
        self.mlp = SharedMLP([in_channels] + mlp)
        self.out_channels = mlp[-1]

    def forward(
        self,
        xyz_fine: Tensor,        # (B, N, 3)  upsampling target
        xyz_coarse: Tensor,      # (B, M, 3)
        feat_fine: Tensor | None,    # (B, C1, N) skip features
        feat_coarse: Tensor,         # (B, C2, M)
    ) -> Tensor:
        # Interpolate coarse features up to fine resolution
        # three_nn_interpolate expects (B, *, C) on last dim
        interp = three_nn_interpolate(
            xyz_fine, xyz_coarse, feat_coarse.transpose(1, 2).contiguous()
        )                                                            # (B, N, C2)
        interp = interp.transpose(1, 2).contiguous()                 # (B, C2, N)

        if feat_fine is not None:
            x = torch.cat([feat_fine, interp], dim=1)                # (B, C1+C2, N)
        else:
            x = interp
        return self.mlp(x)                                           # (B, C_out, N)


class PhysicsAttentionBlock(nn.Module):
    """
    Self-attention over a small set of bottleneck tokens, with a global-condition
    cross-attention so things like inflow velocity and reference area can modulate
    the latent representation. Pre-LN Transformer block style.

    This is the bit that captures non-local flow structure (e.g. how the rear
    diffuser shape affects pressure on the front bumper) which a purely local
    PointNet++ stack cannot represent.
    """

    def __init__(
        self,
        d_model: int,
        n_heads: int = 8,
        d_ff_mult: int = 4,
        global_dim: int = 0,
        dropout: float = 0.0,
    ):
        super().__init__()
        self.norm1 = nn.LayerNorm(d_model)
        self.self_attn = nn.MultiheadAttention(
            d_model, n_heads, dropout=dropout, batch_first=True
        )
        self.norm2 = nn.LayerNorm(d_model)
        self.ff = nn.Sequential(
            nn.Linear(d_model, d_ff_mult * d_model),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(d_ff_mult * d_model, d_model),
        )
        self.global_dim = global_dim
        if global_dim > 0:
            # Project global condition into the same space and inject as an
            # additional [GLOBAL] token. Simpler than FiLM and fits Transformer
            # idiom naturally.
            self.global_proj = nn.Linear(global_dim, d_model)

    def forward(self, x: Tensor, global_cond: Tensor | None = None) -> Tensor:
        """
        Args:
            x: (B, M, d_model)
            global_cond: (B, global_dim) or None

        Returns:
            (B, M, d_model)
        """
        if self.global_dim > 0 and global_cond is not None:
            g = self.global_proj(global_cond).unsqueeze(1)           # (B, 1, d_model)
            x_with_g = torch.cat([g, x], dim=1)                      # (B, M+1, d_model)
            h = self.norm1(x_with_g)
            attn_out, _ = self.self_attn(h, h, h, need_weights=False)
            x_with_g = x_with_g + attn_out
            h = self.norm2(x_with_g)
            x_with_g = x_with_g + self.ff(h)
            return x_with_g[:, 1:, :]                                # drop global token
        else:
            h = self.norm1(x)
            attn_out, _ = self.self_attn(h, h, h, need_weights=False)
            x = x + attn_out
            x = x + self.ff(self.norm2(x))
            return x


# ----------------------------------------------------------------------------- #
# Main model                                                                    #
# ----------------------------------------------------------------------------- #

@dataclass
class AeroNetConfig:
    """Hyperparameters for the model. All defaults tuned for ~16384-point clouds
    on a 24GB consumer GPU (RTX 3090/4090) with bf16 mixed precision."""

    # Input geometry
    n_input_points: int = 16384         # surface points per car after FPS
    use_normals: bool = True            # include per-point surface normals
    global_dim: int = 4                 # (Uref, rho, Aref, body_class_id) by default

    # SA1: large neighbourhood, many points
    sa1_centroids: int = 4096
    sa1_radii: tuple[float, ...] = (0.05, 0.10)
    sa1_samples: tuple[int, ...] = (16, 32)
    sa1_mlps: tuple[tuple[int, ...], ...] = ((32, 32, 64), (32, 32, 64))

    # SA2
    sa2_centroids: int = 1024
    sa2_radii: tuple[float, ...] = (0.10, 0.20)
    sa2_samples: tuple[int, ...] = (16, 32)
    sa2_mlps: tuple[tuple[int, ...], ...] = ((64, 64, 128), (64, 96, 128))

    # SA3 (bottleneck input)
    sa3_centroids: int = 256
    sa3_radii: tuple[float, ...] = (0.20, 0.40)
    sa3_samples: tuple[int, ...] = (16, 32)
    sa3_mlps: tuple[tuple[int, ...], ...] = ((128, 196, 256), (128, 196, 256))

    # Physics-attention bottleneck
    bottleneck_dim: int = 512
    bottleneck_layers: int = 4
    bottleneck_heads: int = 8
    bottleneck_dropout: float = 0.1

    # Feature propagation (decoder)
    fp3_mlp: tuple[int, ...] = (256, 256)
    fp2_mlp: tuple[int, ...] = (256, 128)
    fp1_mlp: tuple[int, ...] = (128, 128, 128)

    # Output head
    head_hidden: tuple[int, ...] = (128, 64)
    output_channels: int = 4            # (p, tau_x, tau_y, tau_z)
    head_dropout: float = 0.1


class AeroNet(nn.Module):
    """End-to-end model: point cloud -> per-point (p, tau_xyz)."""

    def __init__(self, cfg: AeroNetConfig | None = None):
        super().__init__()
        cfg = cfg or AeroNetConfig()
        self.cfg = cfg

        # ------- Encoder ------- #
        in_ch_sa1 = 3 if cfg.use_normals else 0          # initial features = normals
        self.sa1 = SetAbstraction(
            n_centroids=cfg.sa1_centroids,
            radii=list(cfg.sa1_radii),
            n_samples_per_scale=list(cfg.sa1_samples),
            in_channels=in_ch_sa1,
            mlp_per_scale=[list(m) for m in cfg.sa1_mlps],
        )
        self.sa2 = SetAbstraction(
            n_centroids=cfg.sa2_centroids,
            radii=list(cfg.sa2_radii),
            n_samples_per_scale=list(cfg.sa2_samples),
            in_channels=self.sa1.out_channels,
            mlp_per_scale=[list(m) for m in cfg.sa2_mlps],
        )
        self.sa3 = SetAbstraction(
            n_centroids=cfg.sa3_centroids,
            radii=list(cfg.sa3_radii),
            n_samples_per_scale=list(cfg.sa3_samples),
            in_channels=self.sa2.out_channels,
            mlp_per_scale=[list(m) for m in cfg.sa3_mlps],
        )

        # ------- Bottleneck ------- #
        # Project SA3 features into bottleneck dim, then attention stack.
        self.bottleneck_in = nn.Conv1d(self.sa3.out_channels, cfg.bottleneck_dim, 1)
        self.bottleneck_blocks = nn.ModuleList([
            PhysicsAttentionBlock(
                d_model=cfg.bottleneck_dim,
                n_heads=cfg.bottleneck_heads,
                global_dim=cfg.global_dim,
                dropout=cfg.bottleneck_dropout,
            )
            for _ in range(cfg.bottleneck_layers)
        ])
        self.bottleneck_out = nn.Conv1d(cfg.bottleneck_dim, self.sa3.out_channels, 1)

        # ------- Decoder (Feature Propagation) ------- #
        self.fp3 = FeaturePropagation(
            in_channels=self.sa3.out_channels + self.sa2.out_channels,
            mlp=list(cfg.fp3_mlp),
        )
        self.fp2 = FeaturePropagation(
            in_channels=self.fp3.out_channels + self.sa1.out_channels,
            mlp=list(cfg.fp2_mlp),
        )
        # FP1 has no skip features beyond the input normals
        fp1_in = self.fp2.out_channels + (3 if cfg.use_normals else 0)
        self.fp1 = FeaturePropagation(
            in_channels=fp1_in,
            mlp=list(cfg.fp1_mlp),
        )

        # ------- Head ------- #
        head_chs = [self.fp1.out_channels] + list(cfg.head_hidden)
        head_layers: list[nn.Module] = []
        for c_in, c_out in zip(head_chs[:-1], head_chs[1:]):
            head_layers += [
                nn.Conv1d(c_in, c_out, 1),
                nn.GroupNorm(8, c_out),
                nn.GELU(),
                nn.Dropout(cfg.head_dropout),
            ]
        head_layers.append(nn.Conv1d(head_chs[-1], cfg.output_channels, 1))
        self.head = nn.Sequential(*head_layers)

    # ------------------------------------------------------------------- #
    def forward(
        self,
        xyz: Tensor,                          # (B, N, 3)
        features: Tensor | None = None,       # (B, N, F_in), e.g. normals
        global_cond: Tensor | None = None,    # (B, G)
    ) -> Tensor:
        """
        Returns:
            (B, N, output_channels) per-point predictions.
        """
        # --- Encoder ---
        # SA expects features as (B, N, C). Internal grouped tensors handle (B,C,M,K).
        l1_xyz, l1_feat = self.sa1(xyz, features)                    # l1_feat: (B, C1, N1)
        # Convert l1_feat from (B, C, N) -> (B, N, C) for next SA's `features` arg
        l2_xyz, l2_feat = self.sa2(l1_xyz, l1_feat.transpose(1, 2).contiguous())
        l3_xyz, l3_feat = self.sa3(l2_xyz, l2_feat.transpose(1, 2).contiguous())

        # --- Bottleneck ---
        b = self.bottleneck_in(l3_feat)                              # (B, D, N3)
        b = b.transpose(1, 2).contiguous()                           # (B, N3, D)
        for block in self.bottleneck_blocks:
            b = block(b, global_cond=global_cond)
        b = b.transpose(1, 2).contiguous()                           # (B, D, N3)
        l3_feat = l3_feat + self.bottleneck_out(b)                   # residual

        # --- Decoder ---
        l2_up = self.fp3(l2_xyz, l3_xyz, l2_feat, l3_feat)
        l1_up = self.fp2(l1_xyz, l2_xyz, l1_feat, l2_up)
        # Original input "features" = normals (or None) at full resolution
        if features is not None:
            input_feat = features.transpose(1, 2).contiguous()       # (B, F_in, N)
        else:
            input_feat = None
        l0_up = self.fp1(xyz, l1_xyz, input_feat, l1_up)             # (B, C, N)

        # --- Head ---
        out = self.head(l0_up)                                       # (B, output, N)
        return out.transpose(1, 2).contiguous()                      # (B, N, output)


# ----------------------------------------------------------------------------- #
# Differentiable force-coefficient integration                                  #
# ----------------------------------------------------------------------------- #

def integrate_force_coefficients(
    pred_fields: Tensor,    # (B, N, 4) (p, tau_x, tau_y, tau_z)
    normals: Tensor,        # (B, N, 3) outward unit normals
    areas: Tensor,          # (B, N)    cell areas
    u_ref: Tensor,          # (B,)      reference velocity (m/s)
    rho: Tensor,            # (B,)      density (kg/m^3)
    a_ref: Tensor,          # (B,)      reference frontal area (m^2)
    drag_axis: int = 0,     # 0=x, 1=y, 2=z
    lift_axis: int = 2,
) -> dict[str, Tensor]:
    """
    Compute drag and lift coefficients by surface integration of predicted
    pressure and wall-shear stress. Fully differentiable so we can train with
    a force-coefficient loss alongside the pointwise field loss.

    Convention: outward normals point INTO the fluid. Pressure force on the
    body is -p * n * dA (acting opposite to the outward normal). Viscous
    force is tau * dA acting along the wall-shear direction.

    F_total = sum_cells [(-p) * n + tau] * dA
    Cd = F . d_hat / (0.5 * rho * U^2 * A_ref),   d_hat = inflow direction
    Cl = F . l_hat / (0.5 * rho * U^2 * A_ref),   l_hat = lift direction
    """
    p = pred_fields[..., 0]                                          # (B, N)
    tau = pred_fields[..., 1:4]                                      # (B, N, 3)

    # Per-cell force vector (B, N, 3)
    f_pressure = -p.unsqueeze(-1) * normals                          # (B, N, 3)
    f_total = (f_pressure + tau) * areas.unsqueeze(-1)               # (B, N, 3)

    # Sum over cells
    F_body = f_total.sum(dim=1)                                      # (B, 3)

    # Dynamic pressure denominator
    q_inf = 0.5 * rho * u_ref.pow(2) * a_ref                         # (B,)

    Cd = F_body[:, drag_axis] / q_inf
    Cl = F_body[:, lift_axis] / q_inf
    # Side force = remaining axis
    side_axis = ({0, 1, 2} - {drag_axis, lift_axis}).pop()
    Cs = F_body[:, side_axis] / q_inf

    return {"Cd": Cd, "Cl": Cl, "Cs": Cs, "F_body": F_body}
