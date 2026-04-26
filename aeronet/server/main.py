# Copyright (c) 2026 Rutej Talati. All rights reserved.
# AeroNet — neural surrogate model for vehicle aerodynamics.

"""
FastAPI server exposing the AeroNet model for inline prediction by the UI.

Endpoints:
    GET  /            -- redirect to /docs (FastAPI's interactive Swagger UI)
    GET  /health      -- model status & memory info
    POST /predict     -- multipart upload of a mesh file + JSON params
                         returns the prediction dict the React UI expects

Run with:
    python -m server.main \\
        --ckpt logs/smoke/checkpoints/last.ckpt \\
        --host 127.0.0.1 \\
        --port 8000

Or via the helper script:
    python scripts/start_server.py
"""

from __future__ import annotations

import argparse
import json
import sys
import traceback
from pathlib import Path

import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse

# Make `src/` importable when run as `python -m server.main`
_PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_PROJECT_ROOT / "src"))

from server.inference import (    # noqa: E402  -- after sys.path edit on purpose
    PredictionParams,
    load_checkpoint,
    model_status,
    predict_from_mesh,
)


# ----------------------------------------------------------------------------- #
# App                                                                           #
# ----------------------------------------------------------------------------- #

app = FastAPI(
    title="AeroNet Inference API",
    description="CFD surrogate model for surface aerodynamic field prediction.",
    version="0.1.0",
)

# The React dev server runs on 5173 (vite default). Allow it explicitly.
# In production you'd front both behind the same domain and drop CORS.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/", include_in_schema=False)
def root():
    """Redirect to interactive API docs."""
    return RedirectResponse(url="/docs")


@app.get("/health")
def health():
    """Liveness + model status. Useful for the UI to show 'backend live'."""
    return {
        "status": "ok",
        "model": model_status(),
    }


@app.post("/predict")
async def predict(
    file: UploadFile = File(..., description="Mesh file: STL/OBJ/PLY/GLB/VTK"),
    params: str = Form(..., description="JSON-encoded PredictionParams"),
):
    """Run inference on an uploaded mesh.

    The `params` field is a JSON string (FastAPI's multipart form fields can't
    be nested objects directly, so we serialize). Example:

        {"body_type": "fastback", "u_ref": 40, "rho": 1.225,
         "a_ref": 2.4, "size_factor": 1.0}
    """
    try:
        params_dict = json.loads(params)
    except json.JSONDecodeError as e:
        raise HTTPException(
            status_code=400, detail=f"`params` is not valid JSON: {e}"
        )

    # Filter to known keys so unknown fields don't crash the dataclass
    allowed = {"body_type", "u_ref", "rho", "a_ref", "size_factor"}
    pp = PredictionParams(**{k: v for k, v in params_dict.items() if k in allowed})

    # Read uploaded mesh into memory. For huge files (>100 MB STL) this is
    # not ideal, but for typical surface meshes it's fine.
    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    try:
        result = predict_from_mesh(
            file_bytes=file_bytes,
            filename=file.filename or "upload.stl",
            params=pp,
        )
    except ValueError as e:
        # User-facing problems (bad file format, malformed mesh, etc.)
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        # Unexpected. Log full trace server-side, return generic message.
        print(f"[predict] UNEXPECTED: {type(e).__name__}: {e}")
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"Internal error during inference: {type(e).__name__}",
        )

    return JSONResponse(result)


# ----------------------------------------------------------------------------- #
# CLI entry                                                                     #
# ----------------------------------------------------------------------------- #

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--ckpt", required=True, type=str,
        help="Path to a Lightning checkpoint (.ckpt) produced by train.py.",
    )
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--device", default="cpu",
                    help="cpu / cuda / cuda:0 etc.")
    ap.add_argument("--reload", action="store_true",
                    help="Auto-reload on code change (development only).")
    args = ap.parse_args()

    # Load model BEFORE starting the server, so the first request isn't slow
    # and a missing checkpoint fails loudly instead of mid-request.
    load_checkpoint(args.ckpt, device=args.device)

    uvicorn.run(
        "server.main:app" if args.reload else app,
        host=args.host,
        port=args.port,
        reload=args.reload,
    )


if __name__ == "__main__":
    main()
