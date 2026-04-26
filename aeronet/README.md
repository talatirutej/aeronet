# AeroNet

**Neural surrogate model for vehicle aerodynamic prediction.**

Copyright © 2026 Rutej Talati. All rights reserved.

A hybrid PointNet++ / Physics-Attention deep learning model that predicts
surface pressure and wall shear stress on automotive geometries directly from
the surface mesh, then integrates them to produce drag, lift, and side-force
coefficients. Designed as a fast surrogate for full CFD simulation —
prediction in seconds versus hours of compute.

## What it does

Traditional CFD on a passenger car takes 4–24 hours of cluster compute per
configuration. AeroNet trains on existing CFD datasets and learns to predict
the same surface fields in roughly a tenth of a second on a single GPU. The
predictions integrate to drag coefficient values within a few percent of full
CFD, fast enough for early-stage design iteration where running full CFD on
every shape variant is infeasible.

The architecture combines three ideas:

- A **PointNet++ multi-scale-grouping encoder** for hierarchical local
  geometry feature extraction from raw surface point clouds.
- A **Physics-Attention bottleneck** — a small Transformer over the
  sub-sampled latent points that models long-range flow structure (e.g. how
  rear diffuser shape influences front-bumper pressure through wake
  recirculation), which a purely local PointNet cannot capture.
- A **differentiable force-coefficient integrator** that performs the same
  surface integral as the CFD post-processor, so the model can be trained
  with a multi-task loss on both the pointwise field and the integrated Cd.

The model is designed for **transfer learning**: it can be pretrained on a
large public dataset (such as DrivAerStar, 12 000 STAR-CCM+ cases) and then
fine-tuned on a small in-house dataset (50–200 cases) with a frozen encoder,
making it practical for organisations whose own CFD dataset is too small to
train a deep network from scratch.

## Architecture

```
Input:  surface point cloud (xyz, normals, ~16k points)
        + global condition (U_inf, rho, A_ref, body class)

  [Set Abstraction 1]    16k -> 4k    multi-scale grouping
  [Set Abstraction 2]    4k  -> 1k
  [Set Abstraction 3]    1k  -> 256   bottleneck input

  [Physics-Attention]    4-layer Transformer over 256 latent tokens
                         conditioned on global vector

  [Feature Propagation]  256 -> 1k -> 4k -> 16k    skip-connected U-Net upsampling

  [Per-point Head]       (p, tau_x, tau_y, tau_z) per surface cell

  [Force Integration]    differentiable surface integral -> Cd, Cl, Cs
```

About 13 M parameters. Designed to fit a single 24 GB consumer GPU
(RTX 3090 / 4090) with bf16 mixed precision and gradient accumulation.

## Repository layout

```
aeronet/
├── src/aeronet/
│   ├── __init__.py             public API
│   ├── pointnet_ops.py         FPS, ball-query, three-NN interp (pure PyTorch)
│   ├── model.py                AeroNet + force-coefficient integrator
│   ├── data.py                 VTK reader, FPS cache, datasets
│   ├── loss.py                 multi-task field + force + smoothness loss
│   └── lit_module.py           PyTorch Lightning training wrapper
├── scripts/
│   ├── preprocess_drivaerstar.py   raw VTK -> .pt cache
│   ├── train.py                    pretraining
│   ├── finetune_custom.py          fine-tuning on small in-house data
│   └── predict.py                  inference + force-coefficient output
├── configs/
│   ├── pretrain_drivaerstar.yaml
│   ├── finetune_custom.yaml
│   └── smoke_test.yaml
├── tests/
│   └── test_pipeline.py        unit + integration tests
├── requirements.txt
├── LICENSE
└── README.md
```

## Quick start

### 1. Install

```bash
cd aeronet
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

### 2. Smoke test

Validates the entire pipeline with synthetic data on CPU. No GPU required.

```bash
pytest tests/ -v
python scripts/train.py --config configs/smoke_test.yaml --smoke-test
```

### 3. Preprocess a CFD dataset

For DrivAerStar (or any compatible VTK surface-mesh dataset):

```bash
python scripts/preprocess_drivaerstar.py \
    --vtk-dir /path/to/vtk_F \
    --cache-dir ./cache/fastback \
    --n-points 16384 \
    --num-workers 8 \
    --body-class 1
```

### 4. Pretrain

On a single 24 GB GPU, ~6–12 hours for full DrivAerStar:

```bash
python scripts/train.py --config configs/pretrain_drivaerstar.yaml
```

Validation drag-coefficient error should reach below 8 % within a day.

### 5. Fine-tune on a custom dataset

After pretraining, adapt to a small in-house dataset:

```bash
python scripts/finetune_custom.py \
    --pretrained-ckpt logs/pretrain/checkpoints/aeronet-best.ckpt \
    --config configs/finetune_custom.yaml
```

The encoder is frozen and only the bottleneck and decoder adapt. This is the
right strategy when fine-tuning data is scarce (50–200 cases).

### 6. Predict

```bash
python scripts/predict.py \
    --ckpt logs/finetune_custom/checkpoints/finetune-best.ckpt \
    --vtk-input path/to/new_car.vtk \
    --out-dir ./predictions \
    --u-ref 40 --rho 1.225 --a-ref 2.4
```

Outputs a VTK file with the predicted pressure and wall-shear-stress fields
(open in ParaView to inspect) and a CSV with the integrated coefficients.

## Acknowledgements

This implementation builds on architectural ideas from published research:

- PointNet++ (Qi et al., 2017) — the multi-scale-grouping encoder.
- Transolver (Wu et al., 2024) — physics-attention slicing.
- DrivAerStar (Qiu et al., NeurIPS 2025) — the dataset format the
  preprocessing pipeline is built around.

The code is original and does not copy from the reference implementations of
those papers. The DrivAerStar dataset itself is **not** included in this
repository and must be obtained separately under its own license
(CC BY-NC-SA 4.0, non-commercial). Users intending to apply this software
commercially must verify their own licensing obligations.

## License

Proprietary. See `LICENSE`.
