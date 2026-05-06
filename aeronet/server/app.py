# app.py — StatCFD backend
# Chat powered by OpenRouter (no Anthropic key needed).
# Free models: meta-llama/llama-3.1-70b-instruct:free
#              google/gemma-2-9b-it:free
#              mistralai/mistral-7b-instruct:free
#
# Set env var: OPENROUTER_API_KEY=sk-or-...
# Get a free key at https://openrouter.ai/keys
#
# All other endpoints (surrogate predict, /analyze, /predict) unchanged.
# Copyright (c) 2026 Rutej Talati. All rights reserved.

from __future__ import annotations

import io
import json
import math
import os
import re
import time
from datetime import datetime

import httpx
import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

# ── OpenRouter config ─────────────────────────────────────────────────────────

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
OPENROUTER_BASE    = "https://openrouter.ai/api/v1"

# Model priority list — first available free model wins.
# Add your preferred model at the top if you have credits.
# Current free models on OpenRouter (verified May 2026)
# Full list: https://openrouter.ai/models?q=free
CHAT_MODELS = [
    "meta-llama/llama-3.3-70b-instruct:free",
    "meta-llama/llama-3.1-8b-instruct:free",
    "google/gemma-3-12b-it:free",
    "mistralai/mistral-7b-instruct:free",
    "deepseek/deepseek-r1-distill-llama-70b:free",
    "qwen/qwen3-8b:free",
]

STATCFD_SYSTEM = """You are StatCFD AI — an expert automotive aerodynamics and CFD assistant \
built into the StatCFD platform by statinsite.com.

Your knowledge covers:
- CFD fundamentals: RANS, LES, DNS, k-ε, k-ω SST, Spalart-Allmaras turbulence models
- Automotive aerodynamics: drag coefficient (Cd), lift (Cl), pressure coefficient (Cp), \
  wake dynamics, boundary layer separation, underbody flow, diffusers, splitters, spoilers
- Mesh quality: face count, skewness, y+ values, wall treatment
- The DrivAerML dataset (484 high-fidelity LES OpenFOAM cases), DrivAerStar, Ahmed body benchmarks
- Design improvement: how geometry changes affect drag, downforce, and cooling

Rules:
- Write in flowing paragraphs. No bullet points. Be precise and explain the WHY behind every number.
- When you see simulation data (Cd, Cl, mesh stats), use it to give specific, contextual answers.
- If asked about something outside aerodynamics/CFD, briefly answer then steer back to aero.
- Keep answers to 200-350 words unless the user asks for more detail."""


async def chat_openrouter(messages: list[dict]):
    """
    Stream tokens from OpenRouter. Tries each model in CHAT_MODELS in order.
    Uses non-streaming first to check for errors, then switches to SSE streaming.
    """
    if not OPENROUTER_API_KEY:
        yield "StatCFD AI is not configured. Please set the OPENROUTER_API_KEY secret in your HuggingFace Space settings."
        return

    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type":  "application/json",
        "HTTP-Referer":  "https://statinsite.com",
        "X-Title":       "StatCFD",
    }

    last_error = "unknown"

    for model in CHAT_MODELS:
        print(f"[StatCFD] Trying model: {model}")
        try:
            async with httpx.AsyncClient(timeout=90) as client:
                async with client.stream(
                    "POST",
                    f"{OPENROUTER_BASE}/chat/completions",
                    headers=headers,
                    json={
                        "model":       model,
                        "messages":    messages,
                        "stream":      True,
                        "max_tokens":  600,
                        "temperature": 0.65,
                    },
                ) as resp:
                    # Read first chunk to detect errors before yielding
                    if resp.status_code != 200:
                        body = await resp.aread()
                        last_error = f"HTTP {resp.status_code}: {body.decode()[:200]}"
                        print(f"[StatCFD] {model} failed: {last_error}")
                        continue

                    got_content = False
                    async for raw_line in resp.aiter_lines():
                        line = raw_line.strip()
                        if not line or not line.startswith("data: "):
                            continue
                        chunk = line[6:]
                        if chunk == "[DONE]":
                            break
                        try:
                            data = json.loads(chunk)
                            # Handle error object inside SSE stream
                            if "error" in data:
                                last_error = str(data["error"])
                                print(f"[StatCFD] {model} stream error: {last_error}")
                                break
                            delta = data.get("choices", [{}])[0].get("delta", {})
                            token = delta.get("content", "")
                            if token:
                                got_content = True
                                yield token
                        except json.JSONDecodeError:
                            continue

                    if got_content:
                        return  # success

        except httpx.TimeoutException:
            last_error = "timeout"
            print(f"[StatCFD] {model} timed out")
            continue
        except Exception as e:
            last_error = str(e)
            print(f"[StatCFD] {model} exception: {e}")
            continue

    # All models failed
    yield f"StatCFD AI is temporarily unavailable (tried {len(CHAT_MODELS)} models, last error: {last_error}). Check that your OPENROUTER_API_KEY is valid and has credits."


# ── App setup ─────────────────────────────────────────────────────────────────

app = FastAPI(title="StatCFD API", version="2.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load surrogate models on startup
SERVER_DIR = os.path.dirname(os.path.abspath(__file__))
try:
    from surrogate_server import load_surrogate_models, surrogate_status, predict_surrogate, sweep_parameter
    load_surrogate_models(SERVER_DIR)
    _surrogate_loaded = True
except Exception as e:
    print(f"[StatCFD] Surrogate models not loaded: {e}")
    _surrogate_loaded = False


# ── Health ─────────────────────────────────────────────────────────────────────

@app.get("/")
async def root():
    return {"status": "ok", "service": "StatCFD API", "version": "2.0.0"}


@app.get("/health")
async def health():
    return {
        "status":    "ok",
        "ai":        "openrouter" if OPENROUTER_API_KEY else "not_configured",
        "surrogate": _surrogate_loaded,
        "timestamp": datetime.utcnow().isoformat() + "Z",
    }


@app.get("/status")
async def status():
    return {
        "online":    True,
        "surrogate": surrogate_status() if _surrogate_loaded else {"loaded": False},
        "ai": {
            "provider": "openrouter",
            "configured": bool(OPENROUTER_API_KEY),
            "models": CHAT_MODELS,
        },
    }


# ── Chat endpoint — StatCFD AI ─────────────────────────────────────────────────

@app.post("/chat")
async def chat(
    message:      str = Form(...),
    context:      str = Form("{}"),   # JSON: {Cd, Cl, bodyType, meshFaces, confidence}
    history:      str = Form("[]"),   # JSON: [{role, content}, ...]
):
    """
    Streaming chat endpoint. Sends message + simulation context to OpenRouter.
    The frontend passes the current simulation state as JSON in `context`.
    `history` is the last N messages for multi-turn conversation.
    """
    # Build context string from simulation data
    try:
        ctx = json.loads(context)
    except Exception:
        ctx = {}

    ctx_parts = []
    if ctx.get("Cd"):        ctx_parts.append(f"Current simulation Cd={ctx['Cd']}")
    if ctx.get("Cl"):        ctx_parts.append(f"Cl={ctx['Cl']}")
    if ctx.get("confidence"): ctx_parts.append(f"confidence={int(ctx['confidence']*100)}%")
    if ctx.get("bodyType"):  ctx_parts.append(f"body type: {ctx['bodyType']}")
    if ctx.get("meshFaces"): ctx_parts.append(f"mesh faces: {ctx['meshFaces']:,}")
    if ctx.get("meshDims"):  ctx_parts.append(f"dimensions: {ctx['meshDims']}")
    if ctx.get("source"):    ctx_parts.append(f"data source: {ctx['source']}")

    system_msg = STATCFD_SYSTEM
    if ctx_parts:
        system_msg += "\n\nCurrent session context: " + ", ".join(ctx_parts) + "."

    # Build message list
    try:
        hist = json.loads(history)
    except Exception:
        hist = []

    messages = [{"role": "system", "content": system_msg}]
    messages.extend(hist[-6:])  # last 6 turns for context window efficiency
    messages.append({"role": "user", "content": message})

    async def generate():
        async for token in chat_openrouter(messages):
            yield token

    return StreamingResponse(generate(), media_type="text/plain")


# ── Surrogate model endpoints (REAL sklearn) ──────────────────────────────────

@app.get("/surrogate/status")
async def get_surrogate_status():
    if not _surrogate_loaded:
        return {"loaded": False}
    return surrogate_status()


@app.post("/surrogate/predict")
async def post_surrogate_predict(body: dict):
    if not _surrogate_loaded:
        raise HTTPException(503, "Surrogate models not loaded")
    try:
        return predict_surrogate(
            features=body.get("features", {}),
            active_model=body.get("active_model", "GradBoost-DrivAerML"),
        )
    except Exception as e:
        raise HTTPException(500, str(e))


@app.post("/surrogate/sweep")
async def post_surrogate_sweep(body: dict):
    if not _surrogate_loaded:
        raise HTTPException(503, "Surrogate models not loaded")
    try:
        return sweep_parameter(
            param_name=body.get("param", "Vehicle_Ride_Height"),
            fixed_features=body.get("fixed_features"),
            active_model=body.get("active_model", "GradBoost-DrivAerML"),
            n_points=body.get("n_points", 40),
        )
    except Exception as e:
        raise HTTPException(500, str(e))


# ── Mesh inference stub (replace with real AeroNet model) ─────────────────────

def _hash_bytes(data: bytes) -> int:
    h = 0
    for b in data[:512]:
        h = (h * 31 + b) & 0xFFFFFFFF
    return h


def _stub_predict(data, filename, yaw, speed_kmh, ground_clearance_mm, frontal_area, body_type):
    seed  = _hash_bytes(data) ^ int(speed_kmh * 100)
    rng   = np.random.default_rng(seed)
    bases = {"notchback":0.298,"fastback":0.275,"estate":0.312,"suv":0.385,"pickup":0.420}
    Cd    = float(np.clip(rng.normal(bases.get(body_type,0.298),0.015),0.20,0.50))
    Cl    = float(np.clip(rng.normal(0.04,0.03),-0.15,0.18))
    Cs    = float(np.clip(rng.normal(0,0.005),-0.03,0.03))
    q     = 0.5 * 1.225 * (speed_kmh/3.6)**2 * frontal_area
    n     = 3000
    th    = rng.uniform(0, 2*math.pi, n)
    ph    = rng.uniform(0, math.pi, n)
    rb    = rng.uniform(0.7,1.0,n)
    L,W,H = 4.6,1.85,1.42
    xs    = (rb*np.sin(ph)*np.cos(th)*L/2).tolist()
    ys    = (rb*np.sin(ph)*np.sin(th)*W/2).tolist()
    zs    = (rb*np.cos(ph)*H/2+H/2).tolist()
    cp    = np.clip(-0.5+1.2*np.sin(ph)*np.cos(th)+rng.normal(0,0.08,n),-1.5,1.5).tolist()
    return {
        "Cd": round(Cd,4), "Cl": round(Cl,4), "Cs": round(Cs,4),
        "dragForceN": round(Cd*q,1), "liftForceN": round(Cl*q,1),
        "confidence": round(float(rng.uniform(0.78,0.95)),3),
        "bodyTypeLabel": body_type.capitalize(),
        "dragBreakdown": [
            {"region":"Front fascia","fraction":0.32},{"region":"Greenhouse","fraction":0.22},
            {"region":"Underbody","fraction":0.18},{"region":"Wheels","fraction":0.14},
            {"region":"Mirrors","fraction":0.06},{"region":"Rear / wake","fraction":0.08},
        ],
        "pointCloud": {
            "positions": [v for trip in zip(xs,ys,zs) for v in trip],
            "pressures": cp,
            "bbox": {"min":[min(xs),min(ys),min(zs)],"max":[max(xs),max(ys),max(zs)]},
        },
        "inferenceMs": round(float(rng.uniform(180,420)),1),
        "timestamp": datetime.utcnow().isoformat()+"Z",
        "_source": "stub",
    }


@app.post("/predict")
async def predict_mesh(
    file:            UploadFile = File(...),
    yaw:             float = Form(0.0),
    speed:           float = Form(120.0),
    groundClearance: float = Form(150.0),
    frontalArea:     float = Form(2.2),
    bodyType:        str   = Form("notchback"),
    turbulenceModel: str   = Form("k-omega SST"),
):
    data = await file.read()
    if len(data) > 25*1024*1024:
        raise HTTPException(413, "File too large (max 25 MB)")
    return JSONResponse(_stub_predict(data, file.filename, yaw, speed, groundClearance, frontalArea, bodyType))



# ── Contour analysis endpoint ─────────────────────────────────────────────────

@app.post("/analyze-contour")
async def analyze_contour_endpoint(file: UploadFile = File(...)):
    """
    Real computer-vision contour extraction from a side-view car image.
    Uses OpenCV: background removal → bilateral filter → Canny → findContours
    → Hough circles (wheels) → keypoint detection.
    Returns normalised outline points and keypoints for SVG rendering.
    """
    data = await file.read()
    if len(data) > 20 * 1024 * 1024:
        raise HTTPException(413, "File too large (max 20 MB)")
    try:
        from contour_analysis import analyse_contour
        result = analyse_contour(data)
        return JSONResponse(result)
    except ImportError:
        raise HTTPException(501, "opencv-python not installed. Add it to requirements.txt.")
    except ValueError as e:
        raise HTTPException(422, str(e))
    except Exception as e:
        raise HTTPException(500, f"Contour analysis failed: {e}")

# ── Moondream2 image analysis ─────────────────────────────────────────────────

@app.post("/analyze")
async def analyze_image(file: UploadFile = File(...)):
    data = await file.read()
    if len(data) > 20*1024*1024:
        raise HTTPException(413, "File too large")
    try:
        from image_analysis import run_analysis
        return JSONResponse(run_analysis(data))
    except ImportError:
        raise HTTPException(501, "Vision model not installed. Ensure image_analysis.py and Moondream2 deps are present.")
    except Exception as e:
        raise HTTPException(500, f"Analysis failed: {e}")


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 7860))
    uvicorn.run("app:app", host="0.0.0.0", port=port, reload=False)
