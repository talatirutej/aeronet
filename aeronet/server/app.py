# Copyright (c) 2026 Rutej Talati. All rights reserved.
# AeroNet — FastAPI server
"""
FastAPI server for AeroNet CFD surrogate model.
Serves the frontend and exposes prediction/sweep API endpoints.

Endpoints:
  GET  /               → serves index.html
  GET  /health         → backend health check (used by frontend status pill)
  GET  /api/status     → surrogate model status
  POST /api/predict    → predict Cd from 16 features
  POST /api/sweep      → sweep one parameter
  GET  /api/benchmarks → benchmark Cd values
"""

from __future__ import annotations
import os
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from surrogate_server import (
    load_surrogate_models,
    predict_surrogate,
    surrogate_status,
    sweep_parameter,
    CD_BENCHMARKS,
    FEATURE_NAMES,
    _SURR,
)

app = FastAPI(title="AeroNet", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

HERE = Path(__file__).parent
STATIC = HERE / "static"
STATIC.mkdir(exist_ok=True)

app.mount("/static", StaticFiles(directory=str(STATIC)), name="static")


# ── Startup ────────────────────────────────────────────────────────────────────

@app.on_event("startup")
async def startup():
    ok = load_surrogate_models(HERE)
    if ok:
        print("[app] Surrogate models loaded successfully.")
    else:
        print("[app] WARNING: surrogate models not loaded — predictions will fail.")


# ── Routes ─────────────────────────────────────────────────────────────────────

@app.get("/", response_class=FileResponse)
async def index():
    return FileResponse(str(HERE / "index.html"))


@app.get("/health")
async def health() -> dict[str, Any]:
    """Health check endpoint — used by the Vercel frontend status pill."""
    loaded = _SURR.get("loaded", False)
    models_ready = list(_SURR.get("models", {}).keys())
    return {
        "status": "ok",
        "model": {
            "loaded": loaded,
            "models_available": models_ready,
            "best": "GradBoost-DrivAerML" if loaded else None,
        },
    }


@app.get("/api/status")
async def status() -> dict[str, Any]:
    return surrogate_status()


@app.get("/api/benchmarks")
async def benchmarks() -> dict[str, Any]:
    return {"benchmarks": CD_BENCHMARKS, "feature_names": FEATURE_NAMES}


class PredictRequest(BaseModel):
    features: dict[str, float]
    active_model: str = "GradBoost-DrivAerML"


@app.post("/api/predict")
async def predict(req: PredictRequest) -> dict[str, Any]:
    try:
        return predict_surrogate(req.features, req.active_model)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Prediction error: {e}")


class SweepRequest(BaseModel):
    param_name: str
    fixed_features: dict[str, float] | None = None
    active_model: str = "GradBoost-DrivAerML"
    n_points: int = 40


@app.post("/api/sweep")
async def sweep(req: SweepRequest) -> dict[str, Any]:
    try:
        return sweep_parameter(
            req.param_name,
            req.fixed_features,
            req.active_model,
            req.n_points,
        )
    except (RuntimeError, ValueError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Sweep error: {e}")


# ── Entry point ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("app:app", host="0.0.0.0", port=port, reload=False)
