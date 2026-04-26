# Copyright (c) 2026 Rutej Talati. All rights reserved.
# AeroNet — neural surrogate model for vehicle aerodynamics.

"""
Train AeroNet on preprocessed DrivAerStar caches.

Usage:
    python scripts/train.py --config configs/pretrain_drivaerstar.yaml

Config supports multiple cache directories (e.g. one per body style) which
are concatenated with shared train/val splitting.
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
from lightning.pytorch.callbacks import ModelCheckpoint, LearningRateMonitor, EarlyStopping
from lightning.pytorch.loggers import CSVLogger
from torch.utils.data import DataLoader, ConcatDataset

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from aeronet import (
    AeroNet, AeroNetConfig,
    DrivAerStarDataset, DriveAerStarSplit, SyntheticDriveDataset,
    Normalization,
    LossConfig,
    AeroNetLitModule, OptimConfig,
)


def _load_yaml(path: str) -> dict:
    with open(path) as f:
        return yaml.safe_load(f)


def _build_dataset_from_cache(
    cache_dir: Path,
    case_ids: list[str],
    norm: Normalization,
    augment: bool,
    u_ref: float, rho: float, a_ref: float, body_class: int,
):
    split = DriveAerStarSplit(
        case_ids=case_ids,
        body_class=[body_class] * len(case_ids),
        u_ref=[u_ref] * len(case_ids),
        rho=[rho] * len(case_ids),
        a_ref=[a_ref] * len(case_ids),
    )
    return DrivAerStarDataset(
        cache_dir=cache_dir, split=split, normalization=norm, augment=augment,
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True, type=str)
    ap.add_argument("--resume", type=str, default=None,
                    help="Path to .ckpt file to resume from.")
    ap.add_argument("--smoke-test", action="store_true",
                    help="Use SyntheticDriveDataset and tiny model — laptop validation.")
    args = ap.parse_args()

    cfg = _load_yaml(args.config)
    pl.seed_everything(cfg.get("seed", 42), workers=True)

    # ------------------------------------------------------------------- #
    # Build datasets                                                      #
    # ------------------------------------------------------------------- #
    if args.smoke_test:
        print("Smoke test: using SyntheticDriveDataset.")
        train_ds = SyntheticDriveDataset(n_cases=64, n_points=2048, seed=0)
        val_ds = SyntheticDriveDataset(n_cases=8, n_points=2048, seed=1)
        norm = Normalization()                                       # zero/one defaults
        n_input_points = 2048
    else:
        train_parts = []
        val_parts = []
        norms = []
        for cache_spec in cfg["data"]["cache_dirs"]:
            cache_dir = Path(cache_spec["path"])
            manifest = json.loads((cache_dir / "manifest.json").read_text())
            norm_local = Normalization.load(cache_dir / "normalization.json")
            norms.append(norm_local)

            ids = manifest["case_ids"]
            rng = np.random.default_rng(cfg.get("seed", 42))
            ids = rng.permutation(ids).tolist()
            n_val = max(1, int(len(ids) * cfg["data"].get("val_fraction", 0.1)))
            val_ids, train_ids = ids[:n_val], ids[n_val:]

            train_parts.append(_build_dataset_from_cache(
                cache_dir, train_ids, norm_local, augment=True,
                u_ref=cache_spec.get("u_ref", manifest["u_ref"]),
                rho=cache_spec.get("rho", manifest["rho"]),
                a_ref=cache_spec.get("a_ref", manifest["a_ref"]),
                body_class=cache_spec.get("body_class", manifest["body_class"]),
            ))
            val_parts.append(_build_dataset_from_cache(
                cache_dir, val_ids, norm_local, augment=False,
                u_ref=cache_spec.get("u_ref", manifest["u_ref"]),
                rho=cache_spec.get("rho", manifest["rho"]),
                a_ref=cache_spec.get("a_ref", manifest["a_ref"]),
                body_class=cache_spec.get("body_class", manifest["body_class"]),
            ))

        train_ds = ConcatDataset(train_parts) if len(train_parts) > 1 else train_parts[0]
        val_ds = ConcatDataset(val_parts) if len(val_parts) > 1 else val_parts[0]

        # Combine normalizations: average over cache dirs (acceptable when
        # all came from the same simulation campaign). For multi-source
        # training we'd train one norm per source, but DrivAerStar shares
        # solver+conditions so this is fine.
        norm = Normalization(
            p_mean=float(np.mean([n.p_mean for n in norms])),
            p_std=float(np.mean([n.p_std for n in norms])),
            tau_mean=tuple(float(np.mean([n.tau_mean[i] for n in norms])) for i in range(3)),
            tau_std=tuple(float(np.mean([n.tau_std[i] for n in norms])) for i in range(3)),
        )
        n_input_points = manifest["n_points"]

    print(f"Train: {len(train_ds)} cases | Val: {len(val_ds)} cases | "
          f"N_points={n_input_points}")

    # ------------------------------------------------------------------- #
    # Build model                                                         #
    # ------------------------------------------------------------------- #
    model_cfg_dict = cfg.get("model", {})
    if args.smoke_test:
        # Tiny model for laptop test
        model_cfg = AeroNetConfig(
            n_input_points=2048,
            sa1_centroids=512, sa2_centroids=128, sa3_centroids=32,
            bottleneck_dim=128, bottleneck_layers=2, bottleneck_heads=4,
        )
    else:
        # tuple casting because YAML gives lists
        for k, v in list(model_cfg_dict.items()):
            if isinstance(v, list) and v and isinstance(v[0], list):
                model_cfg_dict[k] = tuple(tuple(x) for x in v)
            elif isinstance(v, list):
                model_cfg_dict[k] = tuple(v)
        model_cfg_dict["n_input_points"] = n_input_points
        model_cfg = AeroNetConfig(**model_cfg_dict)

    loss_cfg = LossConfig(**cfg.get("loss", {}))
    optim_cfg = OptimConfig(**cfg.get("optim", {}))

    lit_module = AeroNetLitModule(
        model_cfg=model_cfg,
        loss_cfg=loss_cfg,
        optim_cfg=optim_cfg,
        normalization=norm,
    )

    # Print parameter count so the user knows what they're training
    n_params = sum(p.numel() for p in lit_module.model.parameters())
    n_trainable = sum(p.numel() for p in lit_module.model.parameters() if p.requires_grad)
    print(f"Model: {n_params/1e6:.2f}M params total, {n_trainable/1e6:.2f}M trainable")

    # ------------------------------------------------------------------- #
    # DataLoaders                                                         #
    # ------------------------------------------------------------------- #
    bs = cfg["trainer"].get("batch_size", 2)
    val_bs = cfg["trainer"].get("val_batch_size", 1)
    train_loader = DataLoader(
        train_ds, batch_size=bs, shuffle=True,
        num_workers=cfg["trainer"].get("num_workers", 2),
        pin_memory=True, drop_last=True, persistent_workers=cfg["trainer"].get("num_workers", 2) > 0,
    )
    val_loader = DataLoader(
        val_ds, batch_size=val_bs, shuffle=False,
        num_workers=cfg["trainer"].get("num_workers", 2),
        pin_memory=True, persistent_workers=cfg["trainer"].get("num_workers", 2) > 0,
    )

    # ------------------------------------------------------------------- #
    # Trainer                                                             #
    # ------------------------------------------------------------------- #
    log_dir = Path(cfg["trainer"].get("log_dir", "./logs"))
    log_dir.mkdir(parents=True, exist_ok=True)

    callbacks = [
        ModelCheckpoint(
            dirpath=log_dir / "checkpoints",
            filename="aeronet-{epoch:03d}-{val/cd_rel_err_pct:.2f}",
            monitor="val/cd_rel_err_pct",
            mode="min",
            save_top_k=3,
            save_last=True,
            auto_insert_metric_name=False,
        ),
        LearningRateMonitor(logging_interval="step"),
    ]
    if cfg["trainer"].get("early_stop_patience"):
        callbacks.append(EarlyStopping(
            monitor="val/cd_rel_err_pct",
            mode="min",
            patience=cfg["trainer"]["early_stop_patience"],
        ))

    # Pick precision based on hardware
    precision = cfg["trainer"].get("precision", "bf16-mixed")
    if precision in ("bf16", "bf16-mixed") and torch.cuda.is_available():
        if not torch.cuda.is_bf16_supported():
            print("bf16 requested but not supported by GPU; falling back to 16-mixed")
            precision = "16-mixed"

    trainer = pl.Trainer(
        max_epochs=cfg["trainer"].get("max_epochs", 100),
        max_steps=cfg["trainer"].get("max_steps", -1),
        accelerator=cfg["trainer"].get("accelerator", "auto"),
        devices=cfg["trainer"].get("devices", "auto"),
        precision=precision,
        gradient_clip_val=optim_cfg.grad_clip,
        accumulate_grad_batches=cfg["trainer"].get("accumulate_grad_batches", 1),
        callbacks=callbacks,
        logger=CSVLogger(save_dir=str(log_dir), name="csv"),
        log_every_n_steps=cfg["trainer"].get("log_every_n_steps", 10),
        deterministic=False,                 # FPS uses randomness; determinism would force CPU
        benchmark=True,
    )

    trainer.fit(lit_module, train_loader, val_loader, ckpt_path=args.resume)

    # Save final norm + model config alongside best ckpt for easy loading later
    (log_dir / "final_normalization.json").write_text(json.dumps(norm.to_dict(), indent=2))
    (log_dir / "final_model_cfg.json").write_text(json.dumps(asdict(model_cfg), indent=2))


if __name__ == "__main__":
    main()
