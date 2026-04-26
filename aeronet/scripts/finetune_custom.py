# Copyright (c) 2026 Rutej Talati. All rights reserved.
# AeroNet — neural surrogate model for vehicle aerodynamics.

"""
Fine-tune a pretrained AeroNet on the in-house dataset.

This is the script you'll use AFTER pretraining on DrivAerStar, when you have
the 50 (or however many) in-house CFD cases in hand.

Usage:
    python scripts/finetune_custom.py \
        --pretrained-ckpt logs/checkpoints/aeronet-best.ckpt \
        --config configs/finetune_custom.yaml

Strategy:
  1. Load pretrained model.
  2. Freeze SA1/SA2/SA3 encoder (geometry feature extractors).
  3. Train only the bottleneck attention + decoder + head.
  4. Use a much lower LR (10x smaller) and a shorter schedule.
  5. Heavy augmentation since we have very little data.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from dataclasses import asdict

import numpy as np
import torch
import yaml
import lightning.pytorch as pl
from lightning.pytorch.callbacks import ModelCheckpoint, LearningRateMonitor
from lightning.pytorch.loggers import CSVLogger
from torch.utils.data import DataLoader

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from aeronet import (
    AeroNetConfig,
    DrivAerStarDataset, DriveAerStarSplit,
    Normalization, LossConfig,
    AeroNetLitModule, OptimConfig,
)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pretrained-ckpt", required=True, type=str,
                    help="Path to pretrained .ckpt from train.py.")
    ap.add_argument("--config", required=True, type=str,
                    help="YAML config for the in-house cache + finetune hyperparams.")
    args = ap.parse_args()

    with open(args.config) as f:
        cfg = yaml.safe_load(f)

    pl.seed_everything(cfg.get("seed", 42), workers=True)

    # --- Load pretrained module just to inherit its model_cfg + normalization ---
    print(f"Loading pretrained checkpoint: {args.pretrained_ckpt}")
    pretrained = AeroNetLitModule.load_from_checkpoint(
        args.pretrained_ckpt, strict=True,
    )
    pretrained_state = pretrained.state_dict()
    pretrained_norm = pretrained.norm
    pretrained_model_cfg = pretrained.model_cfg

    # We respect the pretrained normalization stats. Fine-tuning data should
    # be in roughly the same physical regime; if not, you need to either
    # rescale custom's CFD outputs or recompute norm and accept some
    # encoder mismatch (and thus probably retrain more layers).
    norm = pretrained_norm

    # --- Build in-house dataset ---
    cache_dir = Path(cfg["data"]["cache_dir"])
    manifest = json.loads((cache_dir / "manifest.json").read_text())
    ids = manifest["case_ids"]
    rng = np.random.default_rng(cfg.get("seed", 42))
    ids = rng.permutation(ids).tolist()
    n_val = max(1, int(len(ids) * cfg["data"].get("val_fraction", 0.2)))
    val_ids, train_ids = ids[:n_val], ids[n_val:]

    def _make(ids_, augment):
        split = DriveAerStarSplit(
            case_ids=ids_,
            body_class=[manifest.get("body_class", 0)] * len(ids_),
            u_ref=[manifest.get("u_ref", 40.0)] * len(ids_),
            rho=[manifest.get("rho", 1.225)] * len(ids_),
            a_ref=[manifest.get("a_ref", 2.4)] * len(ids_),
        )
        return DrivAerStarDataset(
            cache_dir=cache_dir, split=split, normalization=norm,
            augment=augment,
            rotation_deg=cfg["data"].get("rotation_deg", 8.0),     # heavier aug
            jitter_std=cfg["data"].get("jitter_std", 0.008),
        )

    train_ds = _make(train_ids, augment=True)
    val_ds = _make(val_ids, augment=False)
    print(f"custom fine-tune: train={len(train_ds)} val={len(val_ds)}")

    # --- Build new lit module with frozen encoder ---
    loss_cfg = LossConfig(**cfg.get("loss", {}))
    optim_cfg = OptimConfig(**cfg.get("optim", {}))

    lit = AeroNetLitModule(
        model_cfg=pretrained_model_cfg,
        loss_cfg=loss_cfg,
        optim_cfg=optim_cfg,
        normalization=norm,
        finetune_freeze_encoder=True,
    )
    # Copy pretrained weights
    missing, unexpected = lit.load_state_dict(pretrained_state, strict=False)
    print(f"Loaded pretrained weights. missing={len(missing)} unexpected={len(unexpected)}")
    if missing:
        # Show first few so the user can sanity check
        print("First missing keys:", missing[:5])

    n_trainable = sum(p.numel() for p in lit.model.parameters() if p.requires_grad)
    n_total = sum(p.numel() for p in lit.model.parameters())
    print(f"Trainable: {n_trainable/1e6:.2f}M / Total: {n_total/1e6:.2f}M "
          f"({100*n_trainable/n_total:.1f}%)")

    # --- DataLoaders ---
    bs = cfg["trainer"].get("batch_size", 2)
    train_loader = DataLoader(
        train_ds, batch_size=bs, shuffle=True,
        num_workers=cfg["trainer"].get("num_workers", 2),
        pin_memory=True, drop_last=False,
    )
    val_loader = DataLoader(
        val_ds, batch_size=1, shuffle=False,
        num_workers=cfg["trainer"].get("num_workers", 2),
        pin_memory=True,
    )

    # --- Trainer ---
    log_dir = Path(cfg["trainer"].get("log_dir", "./logs_finetune"))
    log_dir.mkdir(parents=True, exist_ok=True)

    callbacks = [
        ModelCheckpoint(
            dirpath=log_dir / "checkpoints",
            filename="finetune-{epoch:03d}-{val/cd_rel_err_pct:.2f}",
            monitor="val/cd_rel_err_pct", mode="min",
            save_top_k=3, save_last=True, auto_insert_metric_name=False,
        ),
        LearningRateMonitor(logging_interval="step"),
    ]

    trainer = pl.Trainer(
        max_epochs=cfg["trainer"].get("max_epochs", 200),
        accelerator=cfg["trainer"].get("accelerator", "auto"),
        devices=cfg["trainer"].get("devices", "auto"),
        precision=cfg["trainer"].get("precision", "bf16-mixed"),
        gradient_clip_val=optim_cfg.grad_clip,
        accumulate_grad_batches=cfg["trainer"].get("accumulate_grad_batches", 1),
        callbacks=callbacks,
        logger=CSVLogger(save_dir=str(log_dir), name="csv"),
        log_every_n_steps=5,
    )

    trainer.fit(lit, train_loader, val_loader)


if __name__ == "__main__":
    main()
