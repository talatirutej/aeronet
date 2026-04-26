# Copyright (c) 2026 Rutej Talati. All rights reserved.
# AeroNet — neural surrogate model for vehicle aerodynamics.

"""
AeroNet: hybrid PointNet++ / Physics-Attention model for
surface aerodynamic field prediction on automotive geometries.

Public API:
    AeroNet, AeroNetConfig    -- the model
    integrate_force_coefficients              -- differentiable Cd/Cl integrator
    DrivAerStarDataset, SyntheticDriveDataset -- dataset classes
    Normalization, compute_normalization      -- field statistics
    LossConfig, compute_loss                  -- multi-task loss
    AeroNetLitModule, OptimConfig     -- training entry point
"""

from .model import (
    AeroNet,
    AeroNetConfig,
    integrate_force_coefficients,
)
from .data import (
    DrivAerStarDataset,
    DriveAerStarSplit,
    SyntheticDriveDataset,
    Normalization,
    compute_normalization,
    preprocess_case,
)
from .loss import LossConfig, compute_loss, denormalize_fields
from .lit_module import AeroNetLitModule, OptimConfig

__all__ = [
    "AeroNet",
    "AeroNetConfig",
    "integrate_force_coefficients",
    "DrivAerStarDataset",
    "DriveAerStarSplit",
    "SyntheticDriveDataset",
    "Normalization",
    "compute_normalization",
    "preprocess_case",
    "LossConfig",
    "compute_loss",
    "denormalize_fields",
    "AeroNetLitModule",
    "OptimConfig",
]
