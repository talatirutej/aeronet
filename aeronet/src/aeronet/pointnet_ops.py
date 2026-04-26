# Copyright (c) 2026 Rutej Talati. All rights reserved.
# AeroNet — neural surrogate model for vehicle aerodynamics.

"""
Pure-PyTorch implementations of PointNet++ sampling and grouping operations.

We deliberately avoid CUDA extensions (pointnet2_ops, torch-points-kernels) because:
  1. They require compilation and break across PyTorch / CUDA versions.
  2. They don't run on Intel Arc / MPS / CPU, killing portability for prototyping.
  3. Pure PyTorch is ~2x slower but more than fast enough at our point counts (<=16k).

If you later move to >100k points and need maximum throughput, swap these for
the compiled extensions; the function signatures match `pointnet2_ops` so the
model code is unchanged.
"""

from __future__ import annotations

import torch
from torch import Tensor


def square_distance(src: Tensor, dst: Tensor) -> Tensor:
    """
    Pairwise squared L2 distance between two batched point clouds.

    Args:
        src: (B, N, C) source points
        dst: (B, M, C) destination points

    Returns:
        (B, N, M) squared distances
    """
    # |a-b|^2 = |a|^2 + |b|^2 - 2 a.b
    # We do this in fp32 for numerical stability even when input is fp16/bf16.
    src_f, dst_f = src.float(), dst.float()
    inner = -2.0 * torch.matmul(src_f, dst_f.transpose(-2, -1))      # (B,N,M)
    src_sq = (src_f ** 2).sum(-1, keepdim=True)                      # (B,N,1)
    dst_sq = (dst_f ** 2).sum(-1, keepdim=True).transpose(-2, -1)    # (B,1,M)
    return (inner + src_sq + dst_sq).clamp_min_(0.0)


def farthest_point_sample(xyz: Tensor, n_samples: int) -> Tensor:
    """
    Iterative farthest-point sampling. Returns indices of selected points.

    Args:
        xyz: (B, N, 3)
        n_samples: number of points to sample (<= N)

    Returns:
        (B, n_samples) long tensor of indices into xyz
    """
    device = xyz.device
    B, N, _ = xyz.shape
    assert n_samples <= N, f"FPS requested {n_samples} from {N}"

    centroids = torch.zeros(B, n_samples, dtype=torch.long, device=device)
    distance = torch.full((B, N), 1e10, device=device)
    # Random initial point per batch element
    farthest = torch.randint(0, N, (B,), dtype=torch.long, device=device)
    batch_idx = torch.arange(B, dtype=torch.long, device=device)

    for i in range(n_samples):
        centroids[:, i] = farthest
        # Distance from current farthest to all points
        centroid = xyz[batch_idx, farthest, :].unsqueeze(1)          # (B,1,3)
        dist = ((xyz - centroid) ** 2).sum(-1)                       # (B,N)
        # Maintain running min-distance to selected set
        distance = torch.minimum(distance, dist)
        # Next farthest is the point with max running min-distance
        farthest = distance.argmax(dim=-1)
    return centroids


def index_points(points: Tensor, idx: Tensor) -> Tensor:
    """
    Gather points by index. Supports arbitrary trailing index dims.

    Args:
        points: (B, N, C)
        idx:    (B, *)  any shape, values in [0, N)

    Returns:
        (B, *, C)
    """
    B = points.shape[0]
    # Flatten idx to (B, K), gather, then reshape back
    flat_idx = idx.reshape(B, -1)                                    # (B, K)
    K = flat_idx.shape[1]
    arange_b = torch.arange(B, device=points.device).view(B, 1).expand(B, K)
    gathered = points[arange_b, flat_idx]                            # (B, K, C)
    return gathered.reshape(*idx.shape, points.shape[-1])


def ball_query(radius: float, n_samples: int, xyz: Tensor, new_xyz: Tensor) -> Tensor:
    """
    For each query point in `new_xyz`, find up to `n_samples` neighbours in `xyz`
    within `radius`. If fewer than `n_samples` neighbours exist, the first one is
    repeated (standard PointNet++ behaviour).

    Args:
        radius: search radius (in world units, after normalization)
        n_samples: max neighbours per query
        xyz: (B, N, 3)
        new_xyz: (B, M, 3) query points

    Returns:
        (B, M, n_samples) long indices into xyz
    """
    B, N, _ = xyz.shape
    M = new_xyz.shape[1]
    sqr_dists = square_distance(new_xyz, xyz)                        # (B, M, N)

    # Initialize with first-sample-replicated indices
    group_idx = torch.arange(N, dtype=torch.long, device=xyz.device)
    group_idx = group_idx.view(1, 1, N).expand(B, M, N).clone()
    # Mark out-of-radius points
    group_idx[sqr_dists > radius * radius] = N
    # Sort so in-radius indices come first; clip to n_samples
    group_idx = group_idx.sort(dim=-1)[0][:, :, :n_samples]
    # Replace any remaining N (no neighbours) with the first valid index per row
    first = group_idx[:, :, 0:1].expand(-1, -1, n_samples)
    mask = group_idx == N
    group_idx[mask] = first[mask]
    return group_idx


def sample_and_group(
    n_centroids: int,
    radius: float,
    n_samples: int,
    xyz: Tensor,
    features: Tensor | None,
    return_fps_idx: bool = False,
):
    """
    Sample `n_centroids` points by FPS, then ball-query their neighbourhoods.

    Args:
        n_centroids: M, number of centroids to sample
        radius: ball-query radius (in normalized car-length units)
        n_samples: K, neighbours per centroid
        xyz: (B, N, 3)
        features: (B, N, C) per-point features, may be None
        return_fps_idx: also return FPS indices for debugging

    Returns:
        new_xyz:        (B, M, 3)             centroid coordinates
        grouped_feats:  (B, M, K, 3 + C)      per-neighbour relative xyz + features
        (optional) fps_idx: (B, M)
    """
    B, _, _ = xyz.shape
    fps_idx = farthest_point_sample(xyz, n_centroids)                # (B, M)
    new_xyz = index_points(xyz, fps_idx)                             # (B, M, 3)

    nbr_idx = ball_query(radius, n_samples, xyz, new_xyz)            # (B, M, K)
    grouped_xyz = index_points(xyz, nbr_idx)                         # (B, M, K, 3)
    # Relative position to centroid: this is the key PointNet++ design choice
    grouped_xyz_rel = grouped_xyz - new_xyz.unsqueeze(2)             # (B, M, K, 3)

    if features is not None:
        grouped_feat = index_points(features, nbr_idx)               # (B, M, K, C)
        grouped = torch.cat([grouped_xyz_rel, grouped_feat], dim=-1)
    else:
        grouped = grouped_xyz_rel

    if return_fps_idx:
        return new_xyz, grouped, fps_idx
    return new_xyz, grouped


def three_nn_interpolate(
    unknown_xyz: Tensor,
    known_xyz: Tensor,
    known_feat: Tensor,
) -> Tensor:
    """
    Inverse-distance-weighted interpolation from `known` points to `unknown` points
    using each unknown's 3 nearest known neighbours. Used in feature-propagation
    layers for U-Net style upsampling on point clouds.

    Args:
        unknown_xyz: (B, N, 3)  queries
        known_xyz:   (B, M, 3)  source points (M < N typically)
        known_feat:  (B, M, C)  features at source points

    Returns:
        (B, N, C) interpolated features
    """
    dists = square_distance(unknown_xyz, known_xyz)                  # (B, N, M)
    # Top-3 closest (use negative-then-topk to avoid full sort)
    dists_top3, idx_top3 = dists.topk(k=3, dim=-1, largest=False)    # (B, N, 3)
    dists_top3 = dists_top3.clamp_min_(1e-10).sqrt_()
    weights = 1.0 / dists_top3
    weights = weights / weights.sum(dim=-1, keepdim=True)            # (B, N, 3)

    nbr_feat = index_points(known_feat, idx_top3)                    # (B, N, 3, C)
    interp = (nbr_feat * weights.unsqueeze(-1)).sum(dim=2)           # (B, N, C)
    return interp
