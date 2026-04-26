# Copyright (c) 2026 Rutej Talati. All rights reserved.
# AeroNet — surrogate model server module
"""
Loads DrivAerML-trained surrogate models and exposes prediction functions
for the FastAPI server.

Models trained on DrivAerML: 484 real HF-LES OpenFOAM CFD cases (notchback).
Features: 16 vehicle geometric parameters.
Target: drag coefficient Cd.

Available models:
  GradBoost-DrivAerML   — CV R²=0.9525  (best, use this)
  RandomForest-DrivAerML — CV R²=0.8149
  ResNet-Tabular-12K    — pending DrivAerStar 12K dataset

Copy these files into aeronet/server/:
  drivaerml_gb_final.pkl
  drivaerml_rf_final.pkl
  drivaerml_qt_scaler.pkl
  drivaerml_meta_v2.json
"""

from __future__ import annotations
import json
import time
from math import erf, sqrt
from pathlib import Path
from typing import Any

import numpy as np

# ── Model registry ─────────────────────────────────────────────────────────────
# Maps frontend model key -> display name, file, needs_qt_scaler
MODEL_REGISTRY = {
    "GradBoost-DrivAerML": {
        "display":      "GradBoost-DrivAerML",
        "full_name":    "Gradient Boosting — DrivAerML 484 cases",
        "description":  "484 real HF-LES OpenFOAM CFD runs · CV R²=0.9525",
        "file":         "drivaerml_gb_final.pkl",
        "needs_qt":     False,
        "cv_r2":        0.9525,
        "cv_rmse":      0.00651,
        "n_samples":    484,
        "dataset":      "DrivAerML",
        "status":       "ready",
    },
    "RandomForest-DrivAerML": {
        "display":      "RandomForest-DrivAerML",
        "full_name":    "Random Forest — DrivAerML 484 cases",
        "description":  "484 real HF-LES OpenFOAM CFD runs · CV R²=0.8149",
        "file":         "drivaerml_rf_final.pkl",
        "needs_qt":     False,
        "cv_r2":        0.8149,
        "cv_rmse":      0.01292,
        "n_samples":    484,
        "dataset":      "DrivAerML",
        "status":       "ready",
    },
    "ResNet-Tabular-12K": {
        "display":      "ResNet-Tabular-12K",
        "full_name":    "Residual MLP — DrivAerStar 12,000 cases",
        "description":  "Deep residual network · Requires DrivAerStar dataset",
        "file":         "resnet_tabular_12k.pt",
        "needs_qt":     True,
        "cv_r2":        None,
        "cv_rmse":      None,
        "n_samples":    12000,
        "dataset":      "DrivAerStar (pending)",
        "status":       "pending",
    },
}

# DrivAerML feature names (16 geometric params)
FEATURE_NAMES = [
    "Vehicle_Length", "Vehicle_Width", "Vehicle_Height",
    "Front_Overhang", "Front_Planview", "Hood_Angle",
    "Approach_Angle", "Windscreen_Angle", "Greenhouse_Tapering",
    "Backlight_Angle", "Decklid_Height", "Rearend_tapering",
    "Rear_Overhang", "Rear_Diffusor_Angle", "Vehicle_Ride_Height",
    "Vehicle_Pitch",
]

# DrivAerML Cd statistics
_CD_MEAN = 0.2788
_CD_STD  = 0.0302
_CD_MIN  = 0.2064
_CD_MAX  = 0.3601

CD_BENCHMARKS = [
    {"name": "Tesla Model 3",  "Cd": 0.23},
    {"name": "BMW 3 Series",   "Cd": 0.26},
    {"name": "Audi A4",        "Cd": 0.27},
    {"name": "Toyota Camry",   "Cd": 0.28},
    {"name": "VW Golf",        "Cd": 0.30},
    {"name": "Porsche 911",    "Cd": 0.30},
    {"name": "Ford Mustang",   "Cd": 0.35},
    {"name": "Generic SUV",    "Cd": 0.38},
]

# ── Model cache ────────────────────────────────────────────────────────────────
_SURR: dict[str, Any] = {
    "models":    {},     # key -> loaded model object
    "qt_scaler": None,   # QuantileTransformer
    "meta":      {},     # contents of drivaerml_meta_v2.json
    "loaded":    False,
    "model_dir": None,
}


def load_surrogate_models(model_dir: str | Path) -> bool:
    """
    Load DrivAerML pkl files from model_dir.
    Returns True if at least GradBoost-DrivAerML loaded.
    """
    global _SURR
    try:
        import joblib
    except ImportError:
        print("[surrogate] joblib not installed — pip install joblib")
        return False

    model_dir = Path(model_dir)
    loaded_any = False

    # Load metadata
    meta_path = model_dir / "drivaerml_meta_v2.json"
    if meta_path.exists():
        with open(meta_path) as f:
            _SURR["meta"] = json.load(f)
        print(f"[surrogate] Loaded metadata: {meta_path.name}")

    # Load each model
    for key, info in MODEL_REGISTRY.items():
        if info["status"] != "ready":
            print(f"[surrogate] {key}: skipped (status={info['status']})")
            continue
        fpath = model_dir / info["file"]
        if fpath.exists():
            try:
                _SURR["models"][key] = joblib.load(str(fpath))
                print(f"[surrogate] Loaded {key} ({info['file']})")
                if key == "GradBoost-DrivAerML":
                    loaded_any = True
            except Exception as e:
                print(f"[surrogate] Failed to load {key}: {e}")
        else:
            print(f"[surrogate] Not found: {fpath}")

    # Load quantile scaler
    qt_path = model_dir / "drivaerml_qt_scaler.pkl"
    if qt_path.exists():
        try:
            _SURR["qt_scaler"] = joblib.load(str(qt_path))
            print(f"[surrogate] Loaded quantile scaler")
        except Exception as e:
            print(f"[surrogate] Failed to load scaler: {e}")

    _SURR["loaded"]    = loaded_any
    _SURR["model_dir"] = str(model_dir)
    return loaded_any


def surrogate_status() -> dict[str, Any]:
    ready = [k for k, m in _SURR["models"].items() if m is not None]
    return {
        "loaded":           _SURR["loaded"],
        "models_available": ready,
        "model_registry":   {
            k: {
                "display":      v["display"],
                "full_name":    v["full_name"],
                "description":  v["description"],
                "status":       v["status"],
                "cv_r2":        v["cv_r2"],
                "cv_rmse":      v["cv_rmse"],
                "n_samples":    v["n_samples"],
                "dataset":      v["dataset"],
                "is_loaded":    k in ready,
            }
            for k, v in MODEL_REGISTRY.items()
        },
        "feature_names": FEATURE_NAMES,
        "n_features":    len(FEATURE_NAMES),
        "dataset":       "DrivAerML — 484 HF-LES OpenFOAM CFD cases (notchback)",
        "cd_range":      {"min": _CD_MIN, "max": _CD_MAX, "mean": _CD_MEAN},
    }


def _cd_rating(Cd: float) -> str:
    if Cd < 0.24: return "Exceptional"
    if Cd < 0.27: return "Excellent"
    if Cd < 0.30: return "Good"
    if Cd < 0.33: return "Average"
    if Cd < 0.37: return "Above average drag"
    return "High drag"


def predict_surrogate(
    features:     dict[str, float],
    active_model: str = "GradBoost-DrivAerML",
) -> dict[str, Any]:
    """
    Predict Cd for a given set of 16 geometric features.
    features: dict with keys matching FEATURE_NAMES.
    Returns Cd + uncertainty + model metadata.
    """
    if not _SURR["loaded"]:
        raise RuntimeError("Surrogate models not loaded.")

    # Build feature vector in correct order, fill missing with dataset mean
    meta_means = _SURR["meta"].get("feature_means", [0.0] * len(FEATURE_NAMES))
    X = np.array([[
        features.get(f, meta_means[i] if i < len(meta_means) else 0.0)
        for i, f in enumerate(FEATURE_NAMES)
    ]])

    t0 = time.time()
    results = {}

    # Run all loaded models
    for key, model in _SURR["models"].items():
        if model is None:
            continue
        try:
            pred = float(model.predict(X)[0])
            results[key] = pred

            # RF uncertainty from tree variance
            if "RandomForest" in key and hasattr(model, "estimators_"):
                tree_preds = np.array([t.predict(X)[0] for t in model.estimators_])
                results[f"{key}_std"] = float(tree_preds.std())
        except Exception as e:
            print(f"[surrogate] Predict error for {key}: {e}")

    elapsed_ms = (time.time() - t0) * 1000

    # Primary prediction
    if active_model in results:
        Cd_primary = results[active_model]
    elif results:
        Cd_primary = results.get("GradBoost-DrivAerML",
                     list(results.values())[0])
        active_model = "GradBoost-DrivAerML"
    else:
        raise RuntimeError("No models returned a prediction.")

    # Uncertainty: RF tree std if available, else 5% of Cd
    uncertainty = results.get(f"{active_model}_std",
                  results.get("RandomForest-DrivAerML_std",
                  Cd_primary * 0.05))

    # Ensemble (average of all available predictions)
    pred_vals = [v for k, v in results.items() if "_std" not in k]
    ensemble  = float(np.mean(pred_vals)) if pred_vals else Cd_primary

    # Percentile rank
    z = (Cd_primary - _CD_MEAN) / max(_CD_STD, 1e-6)
    percentile = round(50 * (1 + erf(z / sqrt(2))), 1)

    # Confidence
    conf = max(0, min(100, 100 - (uncertainty / _CD_STD) * 50))

    model_info = MODEL_REGISTRY.get(active_model, {})

    return {
        "Cd":             round(Cd_primary, 4),
        "Cd_ensemble":    round(ensemble, 4),
        "uncertainty":    round(uncertainty, 5),
        "confidence_pct": round(conf, 1),
        "cd_rating":      _cd_rating(Cd_primary),
        "cd_percentile":  percentile,
        "all_predictions": {k: round(v, 4) for k, v in results.items() if "_std" not in k},
        "benchmarks":     CD_BENCHMARKS,
        "active_model":   active_model,
        "model_display":  model_info.get("display", active_model),
        "model_full_name": model_info.get("full_name", active_model),
        "dataset":        model_info.get("dataset", "DrivAerML"),
        "cv_r2":          model_info.get("cv_r2"),
        "inferenceMs":    round(elapsed_ms, 1),
        "features_used":  {f: features.get(f, None) for f in FEATURE_NAMES},
    }


def sweep_parameter(
    param_name: str,
    fixed_features: dict[str, float] | None = None,
    active_model: str = "GradBoost-DrivAerML",
    n_points: int = 40,
) -> dict[str, Any]:
    """Sweep one parameter, hold others at dataset mean."""
    if not _SURR["loaded"]:
        raise RuntimeError("Surrogate models not loaded.")

    meta_means = _SURR["meta"].get("feature_means", [0.0] * len(FEATURE_NAMES))
    defaults   = {f: meta_means[i] for i, f in enumerate(FEATURE_NAMES)}
    if fixed_features:
        defaults.update(fixed_features)

    meta_stds = _SURR["meta"].get("feature_stds", [1.0] * len(FEATURE_NAMES))
    feat_idx  = {f: i for i, f in enumerate(FEATURE_NAMES)}

    if param_name not in feat_idx:
        raise ValueError(f"Unknown param: {param_name}")

    i   = feat_idx[param_name]
    lo  = meta_means[i] - 2 * meta_stds[i]
    hi  = meta_means[i] + 2 * meta_stds[i]
    sweep_vals = np.linspace(lo, hi, n_points)

    cd_vals = {key: [] for key in _SURR["models"]}
    for v in sweep_vals:
        feats = {**defaults, param_name: float(v)}
        X = np.array([[feats.get(f, defaults.get(f, 0.0)) for f in FEATURE_NAMES]])
        for key, model in _SURR["models"].items():
            if model is not None:
                try:
                    cd_vals[key].append(round(float(model.predict(X)[0]), 5))
                except Exception:
                    cd_vals[key].append(None)

    return {
        "param":       param_name,
        "x":           sweep_vals.tolist(),
        "predictions": cd_vals,
        "active_model": active_model,
    }
