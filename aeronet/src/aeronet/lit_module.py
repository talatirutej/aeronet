# Copyright (c) 2026 Rutej Talati. All rights reserved.
# AeroNet — neural surrogate model for vehicle aerodynamics.

"""
PyTorch Lightning module for training AeroNet.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import torch
import torch.nn as nn
import lightning.pytorch as pl
from torch.optim import AdamW
from torch.optim.lr_scheduler import LambdaLR

from .model import AeroNet, AeroNetConfig, integrate_force_coefficients
from .loss import LossConfig, compute_loss, denormalize_fields
from .data import Normalization


@dataclass
class OptimConfig:
    lr: float = 3e-4
    weight_decay: float = 1e-4
    betas: tuple[float, float] = (0.9, 0.95)
    warmup_steps: int = 500
    max_steps: int = 100_000
    min_lr_ratio: float = 0.05
    grad_clip: float = 1.0

    def __post_init__(self):
        # YAML / checkpoint dicts may pass strings or numpy types in. Cast.
        self.lr = float(self.lr)
        self.weight_decay = float(self.weight_decay)
        self.warmup_steps = int(self.warmup_steps)
        self.max_steps = int(self.max_steps)
        self.min_lr_ratio = float(self.min_lr_ratio)
        self.grad_clip = float(self.grad_clip)
        self.betas = tuple(float(b) for b in self.betas)


def _cosine_with_warmup(
    optimizer: torch.optim.Optimizer,
    warmup_steps: int,
    max_steps: int,
    min_lr_ratio: float = 0.05,
) -> LambdaLR:
    def lr_lambda(step: int) -> float:
        if step < warmup_steps:
            return step / max(1, warmup_steps)
        progress = (step - warmup_steps) / max(1, max_steps - warmup_steps)
        progress = min(1.0, max(0.0, progress))
        cos = 0.5 * (1.0 + math.cos(math.pi * progress))
        return min_lr_ratio + (1.0 - min_lr_ratio) * cos
    return LambdaLR(optimizer, lr_lambda)


def _coerce(obj, dataclass_type):
    """Convert a dict back into a dataclass, or pass through if already correct.

    Lightning's load_from_checkpoint hands us plain dicts (because that's what
    save_hyperparameters serialized). We need actual dataclass instances so
    .__dict__ access still works downstream.
    """
    if obj is None:
        return dataclass_type()
    if isinstance(obj, dataclass_type):
        return obj
    if isinstance(obj, dict):
        # Filter to fields the dataclass actually accepts; ignore stray keys
        valid_fields = {f for f in dataclass_type.__dataclass_fields__.keys()}
        kwargs = {k: v for k, v in obj.items() if k in valid_fields}
        return dataclass_type(**kwargs)
    raise TypeError(f"Cannot coerce {type(obj).__name__} to {dataclass_type.__name__}")


def _coerce_normalization(obj):
    """Same idea but Normalization has a custom from_dict path."""
    if obj is None:
        return Normalization()
    if isinstance(obj, Normalization):
        return obj
    if isinstance(obj, dict):
        return Normalization.from_dict(obj)
    raise TypeError(f"Cannot coerce {type(obj).__name__} to Normalization")


class AeroNetLitModule(pl.LightningModule):
    def __init__(
        self,
        model_cfg: AeroNetConfig | dict | None = None,
        loss_cfg: LossConfig | dict | None = None,
        optim_cfg: OptimConfig | dict | None = None,
        normalization: Normalization | dict | None = None,
        finetune_freeze_encoder: bool = False,
    ):
        super().__init__()
        # Coerce everything to its proper type. Handles both fresh
        # construction (dataclass instances) and checkpoint reload (dicts).
        self.model_cfg = _coerce(model_cfg, AeroNetConfig)
        self.loss_cfg = _coerce(loss_cfg, LossConfig)
        self.optim_cfg = _coerce(optim_cfg, OptimConfig)
        self.norm = _coerce_normalization(normalization)
        self.finetune_freeze_encoder = finetune_freeze_encoder

        self.save_hyperparameters({
            "model_cfg": self.model_cfg.__dict__,
            "loss_cfg": self.loss_cfg.__dict__,
            "optim_cfg": self.optim_cfg.__dict__,
            "normalization": self.norm.to_dict(),
            "finetune_freeze_encoder": finetune_freeze_encoder,
        })

        self.model = AeroNet(self.model_cfg)

        if finetune_freeze_encoder:
            self._freeze_encoder()

    # --------------------------------------------------------------------- #
    def _freeze_encoder(self) -> None:
        for module in (self.model.sa1, self.model.sa2, self.model.sa3):
            for p in module.parameters():
                p.requires_grad = False

    # --------------------------------------------------------------------- #
    def forward(self, batch: dict) -> torch.Tensor:
        return self.model(
            xyz=batch["xyz"],
            features=batch.get("normals") if self.model_cfg.use_normals else None,
            global_cond=batch.get("global_cond"),
        )

    # --------------------------------------------------------------------- #
    def _shared_step(self, batch: dict, stage: str):
        pred = self(batch)
        loss, log = compute_loss(pred, batch, self.norm, self.loss_cfg)
        for k, v in log.items():
            self.log(
                f"{stage}/{k.replace('loss/', '').replace('metric/', '')}",
                v, prog_bar=("total" in k or "cd" in k),
                on_step=(stage == "train"), on_epoch=True, sync_dist=True,
            )
        return loss, pred

    def training_step(self, batch: dict, batch_idx: int) -> torch.Tensor:
        loss, _ = self._shared_step(batch, "train")
        return loss

    def validation_step(self, batch: dict, batch_idx: int) -> torch.Tensor:
        loss, pred = self._shared_step(batch, "val")
        pred_phys = denormalize_fields(pred, self.norm)
        pred_coeffs = integrate_force_coefficients(
            pred_phys, batch["normals"], batch["area"],
            batch["u_ref"], batch["rho"], batch["a_ref"],
        )
        gt_target = torch.cat([batch["p_raw"].unsqueeze(-1), batch["tau_raw"]], dim=-1)
        gt_coeffs = integrate_force_coefficients(
            gt_target, batch["normals"], batch["area"],
            batch["u_ref"], batch["rho"], batch["a_ref"],
        )
        rel = (pred_coeffs["Cd"] - gt_coeffs["Cd"]).abs() / gt_coeffs["Cd"].abs().clamp_min(1e-3)
        self.log("val/cd_rel_err_pct", float(rel.mean() * 100.0),
                 prog_bar=True, on_step=False, on_epoch=True, sync_dist=True)
        return loss

    # --------------------------------------------------------------------- #
    def configure_optimizers(self):
        decay, no_decay = [], []
        for name, p in self.named_parameters():
            if not p.requires_grad:
                continue
            if p.dim() <= 1 or name.endswith(".bias") or "norm" in name.lower() or "bn" in name.lower():
                no_decay.append(p)
            else:
                decay.append(p)
        param_groups = [
            {"params": decay, "weight_decay": self.optim_cfg.weight_decay},
            {"params": no_decay, "weight_decay": 0.0},
        ]
        opt = AdamW(param_groups, lr=self.optim_cfg.lr, betas=self.optim_cfg.betas)
        sched = _cosine_with_warmup(
            opt,
            warmup_steps=self.optim_cfg.warmup_steps,
            max_steps=self.optim_cfg.max_steps,
            min_lr_ratio=self.optim_cfg.min_lr_ratio,
        )
        return {
            "optimizer": opt,
            "lr_scheduler": {"scheduler": sched, "interval": "step"},
        }