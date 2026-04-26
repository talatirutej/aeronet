# Copyright (c) 2026 Rutej Talati. All rights reserved.
# AeroNet — ResNet-Tabular model for DrivAerStar 12,000 cases
"""
ResNet-Tabular: Residual MLP for aerodynamic Cd prediction.

Designed for DrivAerStar (12,000 cases, 20 geometric features).
Needs PyTorch. NOT needed for the current 484-case DrivAerML setup —
use GradBoost-DrivAerML instead.

To train when you have DrivAerStar data:
    python resnet_tabular_12k.py --data-dir /path/to/drivaerstar_coefficients.csv

Architecture (ResNet-Tabular):
    Input(n_feats) → BatchNorm1d
    → ResBlock(256) → ResBlock(256)   # 2 residual blocks, 256 units
    → ResBlock(128)                    # 1 residual block, 128 units
    → Linear(64) → GELU → Dropout(0.1)
    → Linear(1)  → Cd prediction

Expected performance on 12K samples: CV R² > 0.95
Training time on CPU: ~10 min | on GPU: ~2 min
"""

import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader, TensorDataset
import numpy as np
import pandas as pd
from sklearn.preprocessing import QuantileTransformer
from sklearn.model_selection import KFold
from sklearn.metrics import r2_score
import joblib, json, os, argparse


# ── Architecture ──────────────────────────────────────────────────────────────

class ResBlock(nn.Module):
    """One residual block: Linear → BN → GELU → Dropout → Linear → BN + skip."""
    def __init__(self, dim: int, dropout: float = 0.1):
        super().__init__()
        self.block = nn.Sequential(
            nn.Linear(dim, dim),
            nn.BatchNorm1d(dim),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(dim, dim),
            nn.BatchNorm1d(dim),
        )
        self.act = nn.GELU()

    def forward(self, x):
        return self.act(x + self.block(x))


class ResNetTabular(nn.Module):
    """
    ResNet-Tabular: residual MLP for small-to-medium tabular regression.
    
    Best for: 5,000 – 50,000 samples, 10-50 features.
    For < 1,000 samples: use GradientBoosting instead.
    For > 50,000 samples: consider wider blocks or attention.
    """
    def __init__(self, n_features: int, dropout: float = 0.1):
        super().__init__()
        self.input_bn = nn.BatchNorm1d(n_features)
        self.embed    = nn.Linear(n_features, 256)
        self.res1     = ResBlock(256, dropout)
        self.res2     = ResBlock(256, dropout)
        self.proj     = nn.Linear(256, 128)
        self.res3     = ResBlock(128, dropout)
        self.head     = nn.Sequential(
            nn.Linear(128, 64),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(64, 1),
        )

    def forward(self, x):
        x = self.input_bn(x)
        x = torch.relu(self.embed(x))
        x = self.res1(x)
        x = self.res2(x)
        x = torch.relu(self.proj(x))
        x = self.res3(x)
        return self.head(x).squeeze(-1)

    @property
    def n_params(self):
        return sum(p.numel() for p in self.parameters())


# ── Training loop ─────────────────────────────────────────────────────────────

def train_model(
    X: np.ndarray,
    y: np.ndarray,
    n_epochs: int = 300,
    batch_size: int = 128,
    lr: float = 1e-3,
    weight_decay: float = 1e-4,
    patience: int = 30,
    device: str = 'cpu',
    verbose: bool = True,
) -> tuple[ResNetTabular, float]:
    """Train ResNetTabular and return (model, best_val_loss)."""
    n = len(X)
    val_size = max(int(n * 0.15), 50)
    idx = np.random.RandomState(42).permutation(n)
    tr_idx, va_idx = idx[val_size:], idx[:val_size]

    Xt = torch.tensor(X[tr_idx], dtype=torch.float32).to(device)
    yt = torch.tensor(y[tr_idx], dtype=torch.float32).to(device)
    Xv = torch.tensor(X[va_idx], dtype=torch.float32).to(device)
    yv = torch.tensor(y[va_idx], dtype=torch.float32).to(device)

    loader = DataLoader(TensorDataset(Xt, yt), batch_size=batch_size, shuffle=True)

    model = ResNetTabular(n_features=X.shape[1]).to(device)
    if verbose:
        print(f"  ResNet-Tabular: {model.n_params:,} parameters")

    opt   = optim.AdamW(model.parameters(), lr=lr, weight_decay=weight_decay)
    sched = optim.lr_scheduler.CosineAnnealingLR(opt, T_max=n_epochs, eta_min=1e-5)
    loss_fn = nn.HuberLoss(delta=0.01)

    best_loss, best_state, no_improve = float('inf'), None, 0

    for epoch in range(n_epochs):
        model.train()
        for xb, yb in loader:
            opt.zero_grad()
            loss_fn(model(xb), yb).backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
        sched.step()

        model.eval()
        with torch.no_grad():
            val_loss = loss_fn(model(Xv), yv).item()

        if val_loss < best_loss:
            best_loss = val_loss
            best_state = {k: v.clone() for k, v in model.state_dict().items()}
            no_improve = 0
        else:
            no_improve += 1

        if no_improve >= patience:
            if verbose:
                print(f"  Early stop at epoch {epoch+1}")
            break

        if verbose and (epoch + 1) % 50 == 0:
            print(f"  Epoch {epoch+1:3d}  val_loss={val_loss:.6f}  best={best_loss:.6f}")

    model.load_state_dict(best_state)
    return model, best_loss


def cv_evaluate(X: np.ndarray, y: np.ndarray, n_folds: int = 5, **train_kwargs) -> dict:
    """K-fold CV evaluation of ResNetTabular."""
    kf  = KFold(n_splits=n_folds, shuffle=True, random_state=42)
    r2s, rmses = [], []
    for fold, (tr, va) in enumerate(kf.split(X)):
        model, _ = train_model(X[tr], y[tr], verbose=False, **train_kwargs)
        model.eval()
        with torch.no_grad():
            preds = model(torch.tensor(X[va], dtype=torch.float32)).numpy()
        r2s.append(r2_score(y[va], preds))
        rmse = float(np.sqrt(np.mean((y[va] - preds) ** 2)))
        rmses.append(rmse)
        print(f"  Fold {fold+1}: R2={r2s[-1]:.4f}  RMSE={rmse:.5f}")
    return {'r2_mean': float(np.mean(r2s)), 'rmse_mean': float(np.mean(rmses))}


# ── Main: train on DrivAerStar CSV ────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data-dir', required=True,
                        help='Path to drivaerstar coefficients CSV with columns: '
                             '[geo features...] + cd + cl + cs')
    parser.add_argument('--out-dir',  default='.',
                        help='Where to save model files')
    parser.add_argument('--epochs',   type=int, default=300)
    parser.add_argument('--device',   default='cpu')
    args = parser.parse_args()

    print("Loading DrivAerStar data...")
    df = pd.read_csv(args.data_dir)
    print(f"  Shape: {df.shape}")

    # Auto-detect geometric features (everything except cd/cl/cs/run)
    skip = {'cd','cl','cs','clf','clr','run','run_id','case'}
    FEATS = [c for c in df.columns if c.lower() not in skip]
    print(f"  Features ({len(FEATS)}): {FEATS}")

    X = df[FEATS].values.astype(float)
    y = df['cd'].values.astype(float)
    print(f"  Cd range: {y.min():.4f} – {y.max():.4f}")

    # Quantile transform (maps to N(0,1), handles outliers)
    qt = QuantileTransformer(output_distribution='normal', random_state=42)
    Xq = qt.fit_transform(X)

    print("\nCross-validating ResNet-Tabular (5-fold)...")
    cv = cv_evaluate(Xq, y, n_folds=5, n_epochs=args.epochs, device=args.device)
    print(f"\n  CV R2  = {cv['r2_mean']:.4f}")
    print(f"  CV RMSE= {cv['rmse_mean']:.5f}")

    print("\nTraining final model on full dataset...")
    model, _ = train_model(Xq, y, n_epochs=args.epochs, device=args.device, verbose=True)

    os.makedirs(args.out_dir, exist_ok=True)
    torch.save(model.state_dict(), os.path.join(args.out_dir, 'resnet_tabular_12k.pt'))
    joblib.dump(qt, os.path.join(args.out_dir, 'drivaerstar_qt_scaler.pkl'))

    meta = {
        'model_name': 'ResNet-Tabular-12K',
        'architecture': 'ResNet-Tabular (256-256-128-64-1 with skip connections)',
        'dataset': 'DrivAerStar 12,000 HF CFD cases (STAR-CCM+)',
        'features': FEATS,
        'n_features': len(FEATS),
        'cd_min': float(y.min()), 'cd_max': float(y.max()),
        'cd_mean': float(y.mean()), 'cd_std': float(y.std()),
        'n_samples': int(len(y)),
        'cv_r2': cv['r2_mean'], 'cv_rmse': cv['rmse_mean'],
        'n_params': model.n_params,
    }
    with open(os.path.join(args.out_dir, 'resnet_tabular_12k_meta.json'), 'w') as f:
        json.dump(meta, f, indent=2)

    print(f"\nSaved: resnet_tabular_12k.pt, drivaerstar_qt_scaler.pkl, meta.json")
    print(f"To use: python resnet_tabular_12k.py --data-dir drivaerstar.csv --epochs 300")


if __name__ == '__main__':
    main()
