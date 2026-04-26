# Copyright (c) 2026 Rutej Talati. All rights reserved.

import os
import io
import time
import traceback

import numpy as np
from fastapi import FastAPI, File, Form, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from surrogate_server import (
    load_surrogate_models,
    surrogate_status,
    predict_surrogate,
    sweep_parameter,
)

app = FastAPI(title="AeroNet", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

SERVER_DIR = os.path.dirname(os.path.abspath(__file__))
load_surrogate_models(SERVER_DIR)


# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/")
async def root():
    return {"status": "ok", "service": "AeroNet"}


@app.get("/health")
async def health():
    return {"status": "ok", "timestamp": time.time()}


@app.get("/status")
async def status():
    return {
        "online": True,
        "model": {"loaded": True, "name": "AeroNet-PointNet++"},
        "surrogate": surrogate_status(),
    }


# ── Surrogate ─────────────────────────────────────────────────────────────────

@app.get("/surrogate/status")
async def get_surrogate_status():
    return surrogate_status()


@app.post("/surrogate/predict")
async def post_surrogate_predict(body: dict):
    try:
        return predict_surrogate(
            features=body.get("features", {}),
            active_model=body.get("active_model", "GradBoost-DrivAerML"),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/surrogate/sweep")
async def post_surrogate_sweep(body: dict):
    try:
        return sweep_parameter(
            param_name=body.get("param", "Vehicle_Ride_Height"),
            fixed_features=body.get("fixed_features"),
            active_model=body.get("active_model", "GradBoost-DrivAerML"),
            n_points=body.get("n_points", 40),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── STL Inference (AeroNet PointNet++) ───────────────────────────────────────

@app.post("/predict")
async def predict(
    file: UploadFile = File(...),
    yaw: float = Form(0.0),
    speed: float = Form(120.0),
    groundClearance: float = Form(150.0),
    frontalArea: float = Form(2.2),
    bodyType: str = Form("notchback"),
    turbulenceModel: str = Form("k-omega SST"),
):
    try:
        raw = await file.read()
        result = run_aeronet_inference(
            stl_bytes=raw,
            yaw=yaw,
            speed=speed,
            ground_clearance=groundClearance,
            frontal_area=frontalArea,
            body_type=bodyType,
        )
        return JSONResponse(content=result)
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# ── AeroNet inference stub ────────────────────────────────────────────────────
# Replace the body of this function with your real PointNet++ inference call.
# The return shape must match what CarViewer and ResultsPanel expect.

def run_aeronet_inference(stl_bytes, yaw, speed, ground_clearance, frontal_area, body_type):
    rho = 1.225
    q   = 0.5 * rho * (speed / 3.6) ** 2

    Cd  = 0.005
    Cl  = 0.021
    Cs  = 0.001

    drag_force = Cd * q * frontal_area
    lift_force = Cl * q * frontal_area
    CdA        = Cd * frontal_area
    ld_ratio   = Cl / max(Cd, 1e-6)
    power_drag = drag_force * (speed / 3.6)
    reynolds   = rho * (speed / 3.6) * 4.7 / 1.81e-5

    n_pts   = 2048
    pts     = _make_smoke_test_points(n_pts)
    cp_vals = _smoke_test_cp(pts, yaw)
    cp_min  = float(cp_vals.min())
    cp_max  = float(cp_vals.max())

    mesh_pts, mesh_idx, mesh_cp = _make_smoke_test_mesh(pts, cp_vals)

    return {
        "Cd": Cd, "Cl": Cl, "Cs": Cs,
        "dragForceN": round(drag_force, 1),
        "liftForceN": round(lift_force, 1),
        "CdA":        round(CdA, 4),
        "ldRatio":    round(ld_ratio, 3),
        "powerDragW": round(power_drag, 1),
        "reynoldsNumber": round(reynolds, 0),
        "cdRating":   "Excellent",
        "cdBenchmarks": [
            {"name": "Tesla Model 3", "Cd": 0.23},
            {"name": "BMW 3 Series",  "Cd": 0.26},
            {"name": "Audi A4",       "Cd": 0.27},
            {"name": "VW Golf",       "Cd": 0.30},
            {"name": "Ford Mustang",  "Cd": 0.35},
        ],
        "cpStats": {"min": cp_min, "max": cp_max, "mean": float(cp_vals.mean())},
        "simParams": {
            "yaw": yaw, "speed": speed,
            "groundClearance": ground_clearance,
            "frontalArea": frontal_area,
            "bodyType": body_type,
            "rho": rho, "q": round(q, 1),
        },
        "geometry": {
            "faces": 15000, "vertices": 44306,
            "watertight": True,
            "dimensions": {"length": 4.7, "width": 1.95, "height": 1.37},
        },
        "dragBreakdown": [
            {"region": "Front",       "fraction": 0.28},
            {"region": "Greenhouse",  "fraction": 0.22},
            {"region": "Rear",        "fraction": 0.31},
            {"region": "Underbody",   "fraction": 0.12},
            {"region": "Wheels/Misc", "fraction": 0.07},
        ],
        "viewer": {
            "points": {
                "positions": pts.flatten().tolist(),
                "pressures": cp_vals.tolist(),
                "bbox": {
                    "min": pts.min(axis=0).tolist(),
                    "max": pts.max(axis=0).tolist(),
                },
            },
            "mesh": {
                "positions": mesh_pts.flatten().tolist(),
                "indices":   mesh_idx.flatten().tolist(),
                "pressures": mesh_cp.tolist(),
                "stats": {"faceCount": len(mesh_idx), "vertexCount": len(mesh_pts)},
            },
        },
        "inferenceMs": 87595,
        "_source": "smoke-test",
    }


def _make_smoke_test_points(n):
    rng = np.random.default_rng(42)
    t   = rng.uniform(0, 2 * np.pi, n)
    phi = rng.uniform(0, np.pi, n)
    x   = 2.35 * np.cos(t) * np.sin(phi)
    y   = 0.97 * np.sin(t) * np.sin(phi)
    z   = 0.68 * np.cos(phi) + 0.68
    return np.stack([x, y, z], axis=1).astype(np.float32)


def _smoke_test_cp(pts, yaw=0.0):
    x, y, z = pts[:, 0], pts[:, 1], pts[:, 2]
    yr  = yaw * np.pi / 180
    cp  = (
        0.9  * np.exp(-(x + 2.35) ** 2 / 0.3)
        - 0.6 * np.sin(np.pi * np.clip((x + 2.35) / 4.7, 0, 1))
        - 0.4 * np.exp(-(x - 2.35) ** 2 / 0.2)
        + (y - 0.5 * yr) * 0.1
        + 0.05 * np.random.default_rng(0).standard_normal(len(x))
    )
    return cp.astype(np.float32)


def _make_smoke_test_mesh(pts, cp_vals):
    from scipy.spatial import ConvexHull
    try:
        hull  = ConvexHull(pts)
        verts = pts[hull.vertices]
        cp_m  = cp_vals[hull.vertices]
        idx_map = {old: new for new, old in enumerate(hull.vertices)}
        faces = np.array([[idx_map[i] for i in tri] for tri in hull.simplices
                          if all(i in idx_map for i in tri)], dtype=np.uint32)
        return verts.astype(np.float32), faces, cp_m.astype(np.float32)
    except Exception:
        n = min(len(pts), 512)
        idx = np.arange(n, dtype=np.uint32).reshape(-1, 3)[:n // 3]
        return pts[:n].astype(np.float32), idx, cp_vals[:n].astype(np.float32)


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="127.0.0.1", port=8080, reload=False)