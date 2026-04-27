# Copyright (c) 2026 Rutej Talati. All rights reserved.
# AeroNet — FastAPI server
"""
FastAPI server for AeroNet CFD surrogate model + AeroMind image Cd pipeline.

Endpoints:
  GET  /               → serves index.html
  GET  /health         → backend health check (used by frontend status pill)
  GET  /api/status     → surrogate model status
  POST /api/predict    → predict Cd from 16 features
  POST /api/sweep      → sweep one parameter
  GET  /api/benchmarks → benchmark Cd values

  POST /aeromind/predict    → image → full Cd prediction (LLaVA + llama3.1:8b)
  POST /aeromind/classify   → image → car identification only
  POST /aeromind/geometry   → image → geometry features only
  GET  /aeromind/queue      → training queue statistics
  POST /aeromind/label      → label an unknown car in the training queue
"""

from __future__ import annotations
import os
import logging
import tempfile
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
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

# ── AeroMind pipeline — optional, degrades gracefully if Ollama not running ───
_AEROMIND_OK    = False
_AEROMIND_ERROR = ""

try:
    from cd_predictor       import predict_cd_for_ui
    from car_classifier     import classify_image, list_training_queue, label_unknown_car
    from geometry_extractor import extract_geometry
    _AEROMIND_OK = True
except ImportError as e:
    _AEROMIND_ERROR = str(e)
    logging.warning(
        f"[app] AeroMind modules not found ({e}). "
        "Place cd_predictor.py, car_classifier.py, geometry_extractor.py, "
        "cd_database_builder.py in the same folder as app.py and "
        "run: pip install opencv-python chromadb requests"
    )

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="[AeroNet] %(levelname)s: %(message)s",
)
log = logging.getLogger("app")

# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(title="AeroNet + AeroMind", version="3.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

HERE   = Path(__file__).parent
STATIC = HERE / "static"
STATIC.mkdir(exist_ok=True)

app.mount("/static", StaticFiles(directory=str(STATIC)), name="static")


# ── Startup ────────────────────────────────────────────────────────────────────

@app.on_event("startup")
async def startup():
    # .pkl files and meta json live in repo root (2 levels up from aeronet/server/)
    model_dir = HERE.parent.parent
    ok = load_surrogate_models(model_dir)
    if ok:
        log.info(f"Surrogate models loaded from {model_dir}")
    else:
        log.warning(f"Surrogate models NOT loaded from {model_dir} — predictions will fail.")

    if _AEROMIND_OK:
        log.info("AeroMind image pipeline available.")
    else:
        log.warning(f"AeroMind image pipeline unavailable: {_AEROMIND_ERROR}")


# ═════════════════════════════════════════════════════════════════════════════
#  EXISTING SURROGATE ENDPOINTS  (unchanged)
# ═════════════════════════════════════════════════════════════════════════════

@app.get("/", response_class=FileResponse)
async def index():
    return FileResponse(str(HERE / "index.html"))


@app.get("/health")
async def health() -> dict[str, Any]:
    """Health check — used by the Vercel frontend status pill."""
    loaded       = _SURR.get("loaded", False)
    models_ready = list(_SURR.get("models", {}).keys())
    return {
        "status": "ok",
        "model": {
            "loaded":           loaded,
            "models_available": models_ready,
            "best":             "GradBoost-DrivAerML" if loaded else None,
        },
        "aeromind": {
            "available": _AEROMIND_OK,
            "error":     _AEROMIND_ERROR if not _AEROMIND_OK else None,
        },
    }


@app.get("/api/status")
async def status() -> dict[str, Any]:
    return surrogate_status()


@app.get("/api/benchmarks")
async def benchmarks() -> dict[str, Any]:
    return {"benchmarks": CD_BENCHMARKS, "feature_names": FEATURE_NAMES}


class PredictRequest(BaseModel):
    features:     dict[str, float]
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
    param_name:     str
    fixed_features: dict[str, float] | None = None
    active_model:   str = "GradBoost-DrivAerML"
    n_points:       int = 40


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


# ═════════════════════════════════════════════════════════════════════════════
#  AEROMIND IMAGE PIPELINE ENDPOINTS  (new)
# ═════════════════════════════════════════════════════════════════════════════

def _aeromind_check():
    """Raise 503 if AeroMind modules are not available."""
    if not _AEROMIND_OK:
        raise HTTPException(
            status_code=503,
            detail=(
                f"AeroMind pipeline not available: {_AEROMIND_ERROR}. "
                "Install dependencies: pip install opencv-python chromadb requests. "
                "Also ensure Ollama is running with llava:13b and llama3.1:8b pulled."
            ),
        )


def _save_upload(upload: UploadFile) -> str:
    """Save an UploadFile to a temp file and return its path."""
    suffix = Path(upload.filename or "image.jpg").suffix or ".jpg"
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    tmp.write(upload.file.read())
    tmp.flush()
    tmp.close()
    return tmp.name


@app.post("/aeromind/predict")
async def aeromind_predict(
    file:    UploadFile = File(..., description="Car image — JPG / PNG / WEBP"),
    use_sam: str        = Form("false", description="Use SAM segmentation (true/false)"),
) -> dict[str, Any]:
    """
    Full AeroMind pipeline:
      1. LLaVA:13b  — is it a car? which car?
      2. OpenCV/SAM — geometry feature extraction
      3. ChromaDB   — retrieve similar reference cars
      4. llama3.1:8b — 7-step chain-of-thought Cd reasoning

    Returns structured result including Cd estimate, confidence interval,
    full reasoning text, reference cars, and geometry features.
    Unknown cars are saved to data/training_queue/ automatically.
    """
    _aeromind_check()
    tmp_path = _save_upload(file)
    try:
        result = predict_cd_for_ui(tmp_path, use_sam=(use_sam.lower() == "true"))
        return JSONResponse(content=result)
    except Exception as e:
        log.error(f"AeroMind predict error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Pipeline error: {e}")
    finally:
        Path(tmp_path).unlink(missing_ok=True)


@app.post("/aeromind/classify")
async def aeromind_classify(
    file: UploadFile = File(..., description="Car image"),
) -> dict[str, Any]:
    """
    Stage 1 only — structural checks + LLaVA car identification.
    Returns: status, make, model, year_range, body_type, view_angle, confidence.
    Fast (~3–5s). Does not run geometry or LLM reasoning.
    """
    _aeromind_check()
    tmp_path = _save_upload(file)
    try:
        result = classify_image(tmp_path)
        return JSONResponse(content=result)
    except Exception as e:
        log.error(f"AeroMind classify error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Classification error: {e}")
    finally:
        Path(tmp_path).unlink(missing_ok=True)


@app.post("/aeromind/geometry")
async def aeromind_geometry(
    file:    UploadFile = File(..., description="Car image"),
    use_sam: str        = Form("false"),
) -> dict[str, Any]:
    """
    Stage 2 only — OpenCV/SAM geometry extraction.
    Returns: aspect_ratio, roofline_slope, rear_taper, windshield_rake,
             underbody_clearance, contour_smoothness, body_type_flags, etc.
    Does not run LLaVA or LLM reasoning.
    """
    _aeromind_check()
    tmp_path = _save_upload(file)
    try:
        feat = extract_geometry(tmp_path, use_sam=(use_sam.lower() == "true"))
        return JSONResponse(content=feat.to_dict())
    except Exception as e:
        log.error(f"AeroMind geometry error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Geometry extraction error: {e}")
    finally:
        Path(tmp_path).unlink(missing_ok=True)


@app.get("/aeromind/queue")
async def aeromind_queue_stats() -> dict[str, Any]:
    """
    Returns statistics about the training queue of unidentified cars.
    Use review_unknown_cars.py CLI to label them.
    """
    _aeromind_check()
    try:
        queue = list_training_queue()
        reasons: dict[str, int] = {}
        for e in queue:
            r = e.get("save_reason", "unknown")
            reasons[r] = reasons.get(r, 0) + 1

        labelled_dir = Path("data/labelled_cars")
        labelled_count = (
            len(list(labelled_dir.rglob("*.json")))
            if labelled_dir.exists() else 0
        )

        return {
            "queue_total":    len(queue),
            "labelled_total": labelled_count,
            "save_reasons":   reasons,
            "queue_path":     "data/training_queue/",
            "label_cli":      "python review_unknown_cars.py",
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class LabelRequest(BaseModel):
    image_hash: str
    make:       str
    model:      str
    year_range: str
    body_type:  str


@app.post("/aeromind/label")
async def aeromind_label(req: LabelRequest) -> dict[str, Any]:
    """
    Label an unknown car in the training queue.
    image_hash comes from the /aeromind/queue response or metadata.jsonl.
    """
    _aeromind_check()
    try:
        meta = label_unknown_car(
            req.image_hash, req.make, req.model, req.year_range, req.body_type
        )
        return {"status": "labelled", "meta": meta}
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Entry point ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("app:app", host="0.0.0.0", port=port, reload=False)
