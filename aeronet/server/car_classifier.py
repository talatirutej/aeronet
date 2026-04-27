"""
AeroMind — car_classifier.py
Determines: Is this image a car? Which car? Or unknown (saved for training).
Uses LLaVA for vision reasoning + OpenCV for structural sanity checks.
"""

import os
import json
import shutil
import hashlib
import logging
from pathlib import Path
from datetime import datetime
from typing import Optional

import cv2
import numpy as np
import requests

logging.basicConfig(level=logging.INFO, format="[AeroMind] %(levelname)s: %(message)s")
log = logging.getLogger(__name__)

# ─── Paths ────────────────────────────────────────────────────────────────────
UNKNOWN_CARS_DIR   = Path("data/unknown_cars")      # images LLaVA can't identify
NOT_CARS_DIR       = Path("data/not_cars")           # confirmed non-car images
TRAINING_QUEUE_DIR = Path("data/training_queue")     # for future fine-tuning
METADATA_FILE      = Path("data/unknown_cars/metadata.jsonl")

for d in [UNKNOWN_CARS_DIR, NOT_CARS_DIR, TRAINING_QUEUE_DIR]:
    d.mkdir(parents=True, exist_ok=True)

OLLAMA_URL = "http://localhost:11434/api/generate"

# ─── Structural pre-filter (fast, no LLM needed) ─────────────────────────────

def structural_precheck(image_path: str) -> dict:
    """
    Fast OpenCV checks before spending tokens on LLaVA.
    Returns dict with keys: passed (bool), reason (str), diagnostics (dict)
    """
    img = cv2.imread(image_path)
    if img is None:
        return {"passed": False, "reason": "Cannot read image file", "diagnostics": {}}

    h, w = img.shape[:2]
    aspect = w / h
    diag = {"width": w, "height": h, "aspect_ratio": round(aspect, 2)}

    # Too small to extract meaningful geometry
    if w < 100 or h < 60:
        return {"passed": False, "reason": f"Image too small ({w}x{h})", "diagnostics": diag}

    # Aspect ratio sanity — cars in side profile are typically 1.5–4.5
    # Front/3/4 views are squarer. Flag extreme ratios.
    if aspect < 0.3 or aspect > 6.0:
        return {"passed": False, "reason": f"Extreme aspect ratio ({aspect:.2f}) — unlikely to be a car photo", "diagnostics": diag}

    # Check for near-blank/solid-color images (screenshots, placeholders)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    std_dev = float(np.std(gray))
    diag["pixel_std_dev"] = round(std_dev, 1)
    if std_dev < 8.0:
        return {"passed": False, "reason": "Image appears blank or solid-colored", "diagnostics": diag}

    # Edge density — real photos have meaningful edge content
    edges = cv2.Canny(gray, 50, 150)
    edge_density = float(np.sum(edges > 0)) / (w * h)
    diag["edge_density"] = round(edge_density, 4)
    if edge_density < 0.005:
        return {"passed": False, "reason": "Near-zero edge content — not a real photograph", "diagnostics": diag}

    diag["passed_structural"] = True
    return {"passed": True, "reason": "Structural checks passed", "diagnostics": diag}


# ─── LLaVA Vision Query ───────────────────────────────────────────────────────

def _image_to_base64(image_path: str) -> str:
    import base64
    with open(image_path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")


def ask_llava(image_path: str, prompt: str, model: str = "llava:13b") -> str:
    """Send image + prompt to local LLaVA via Ollama. Returns raw text."""
    b64 = _image_to_base64(image_path)
    payload = {
        "model": model,
        "prompt": prompt,
        "images": [b64],
        "stream": False,
        "options": {"temperature": 0.1, "num_predict": 512}
    }
    try:
        r = requests.post(OLLAMA_URL, json=payload, timeout=120)
        r.raise_for_status()
        return r.json().get("response", "").strip()
    except Exception as e:
        log.error(f"LLaVA call failed: {e}")
        return ""


# ─── Classification Logic ─────────────────────────────────────────────────────

CAR_CHECK_PROMPT = """Look at this image carefully and answer exactly three questions in JSON format:

1. "is_car": true if the main subject is a road car, SUV, truck, or van. false for motorcycles, aircraft, boats, people, scenery, diagrams, or anything else.
2. "confidence": your confidence 0.0–1.0 that your is_car answer is correct.
3. "reason": one sentence explaining what you see.

Respond ONLY with valid JSON, nothing else. Example:
{"is_car": true, "confidence": 0.95, "reason": "A silver sedan photographed from the side on a road."}"""

CAR_ID_PROMPT = """This image shows a road car. Identify it as specifically as possible.
Respond ONLY in JSON with these fields:
- "make": manufacturer name (e.g. "Toyota") or "unknown"
- "model": model name (e.g. "Camry") or "unknown"  
- "year_range": approximate years (e.g. "2018-2022") or "unknown"
- "body_type": one of [sedan, coupe, hatchback, SUV, crossover, wagon, pickup, van, supercar, sports_car, convertible]
- "view_angle": one of [side_profile, front, rear, three_quarter_front, three_quarter_rear, aerial, unknown]
- "confidence": 0.0–1.0 overall identification confidence
- "notes": any notable aerodynamic features you can see (spoilers, diffusers, vents, etc.)

Respond ONLY with valid JSON."""


def classify_image(image_path: str) -> dict:
    """
    Full classification pipeline.
    Returns a result dict with keys:
      status: 'car_identified' | 'car_unknown' | 'not_car' | 'error'
      ... plus all details
    """
    image_path = str(image_path)
    result = {
        "image_path": image_path,
        "timestamp": datetime.utcnow().isoformat(),
        "status": "error",
        "is_car": None,
        "make": None,
        "model": None,
        "year_range": None,
        "body_type": None,
        "view_angle": None,
        "identification_confidence": 0.0,
        "structural_diagnostics": {},
        "llava_car_check_raw": "",
        "llava_id_raw": "",
        "notes": ""
    }

    # Step 1: Structural pre-filter
    precheck = structural_precheck(image_path)
    result["structural_diagnostics"] = precheck["diagnostics"]

    if not precheck["passed"]:
        result["status"] = "not_car"
        result["is_car"] = False
        result["notes"] = precheck["reason"]
        _save_not_car(image_path, result)
        return result

    # Step 2: LLaVA car detection
    car_check_raw = ask_llava(image_path, CAR_CHECK_PROMPT)
    result["llava_car_check_raw"] = car_check_raw

    try:
        car_check = _parse_json_response(car_check_raw)
        is_car = bool(car_check.get("is_car", False))
        car_confidence = float(car_check.get("confidence", 0.0))
        result["is_car"] = is_car
        result["notes"] = car_check.get("reason", "")
    except Exception as e:
        log.warning(f"Could not parse LLaVA car-check JSON: {e}")
        # If LLaVA fails to parse, treat as uncertain — save for review
        result["status"] = "error"
        result["notes"] = f"LLaVA response unparseable: {car_check_raw[:200]}"
        _save_unknown_car(image_path, result, reason="llava_parse_error")
        return result

    if not is_car:
        result["status"] = "not_car"
        _save_not_car(image_path, result)
        return result

    # Step 3: Car identification
    id_raw = ask_llava(image_path, CAR_ID_PROMPT)
    result["llava_id_raw"] = id_raw

    try:
        car_id = _parse_json_response(id_raw)
        result["make"]  = car_id.get("make", "unknown")
        result["model"] = car_id.get("model", "unknown")
        result["year_range"] = car_id.get("year_range", "unknown")
        result["body_type"]  = car_id.get("body_type", "unknown")
        result["view_angle"] = car_id.get("view_angle", "unknown")
        result["identification_confidence"] = float(car_id.get("confidence", 0.0))
        aero_notes = car_id.get("notes", "")
        result["notes"] = (result["notes"] + " | " + aero_notes).strip(" |")
    except Exception as e:
        log.warning(f"Could not parse LLaVA ID JSON: {e}")
        result["make"] = "unknown"
        result["model"] = "unknown"

    # Step 4: Route based on identification confidence
    id_conf = result["identification_confidence"]
    make    = result["make"]
    model   = result["model"]

    if make == "unknown" or model == "unknown" or id_conf < 0.45:
        # Can't identify — save to training queue
        result["status"] = "car_unknown"
        _save_unknown_car(image_path, result, reason="low_confidence_id")
        log.info(f"Car detected but not identified (conf={id_conf:.2f}) — saved to training queue.")
    else:
        result["status"] = "car_identified"
        log.info(f"Identified: {make} {model} ({year_range_str(result)}) — conf {id_conf:.2f}")

    return result


# ─── Storage helpers ──────────────────────────────────────────────────────────

def _image_hash(image_path: str) -> str:
    with open(image_path, "rb") as f:
        return hashlib.md5(f.read()).hexdigest()[:12]


def _parse_json_response(raw: str) -> dict:
    """Strip markdown fences and parse JSON."""
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    raw = raw.strip().strip("```").strip()
    return json.loads(raw)


def year_range_str(result: dict) -> str:
    return result.get("year_range") or "unknown year"


def _save_not_car(image_path: str, result: dict):
    """Copy image to not_cars folder with metadata sidecar."""
    h = _image_hash(image_path)
    ext = Path(image_path).suffix
    dest = NOT_CARS_DIR / f"{h}{ext}"
    if not dest.exists():
        shutil.copy2(image_path, dest)
    meta_path = NOT_CARS_DIR / f"{h}.json"
    with open(meta_path, "w") as f:
        json.dump(result, f, indent=2)
    log.info(f"Saved non-car image to {dest}")


def _save_unknown_car(image_path: str, result: dict, reason: str = "unknown"):
    """
    Copy unidentified car images to training queue.
    These will be used to fine-tune or improve the pipeline over time.
    """
    h = _image_hash(image_path)
    ext = Path(image_path).suffix
    dest = TRAINING_QUEUE_DIR / f"{h}{ext}"
    if not dest.exists():
        shutil.copy2(image_path, dest)

    # Append to JSONL log for batch review
    entry = {**result, "save_reason": reason, "image_hash": h, "dest_path": str(dest)}
    with open(METADATA_FILE, "a") as f:
        f.write(json.dumps(entry) + "\n")

    log.info(f"Unknown car saved to training queue: {dest} (reason: {reason})")


# ─── Training Queue Inspector ─────────────────────────────────────────────────

def list_training_queue() -> list[dict]:
    """Return all entries in the unknown-car training queue."""
    if not METADATA_FILE.exists():
        return []
    entries = []
    with open(METADATA_FILE) as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    entries.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
    return entries


def label_unknown_car(image_hash: str, make: str, model: str, year_range: str, body_type: str):
    """
    Human-in-the-loop labelling: move a training-queue image to a labelled set.
    Call this from a review UI or CLI to annotate unknown cars.
    """
    labelled_dir = Path("data/labelled_cars") / make.lower().replace(" ", "_")
    labelled_dir.mkdir(parents=True, exist_ok=True)

    # Find image in queue
    for ext in [".jpg", ".jpeg", ".png", ".webp", ".bmp"]:
        src = TRAINING_QUEUE_DIR / f"{image_hash}{ext}"
        if src.exists():
            dest = labelled_dir / f"{image_hash}_{model.lower().replace(' ','_')}{ext}"
            shutil.move(str(src), str(dest))
            meta = {
                "image_hash": image_hash,
                "make": make, "model": model,
                "year_range": year_range, "body_type": body_type,
                "labelled_at": datetime.utcnow().isoformat(),
                "dest": str(dest)
            }
            with open(labelled_dir / f"{image_hash}.json", "w") as f:
                json.dump(meta, f, indent=2)
            log.info(f"Labelled {make} {model} → {dest}")
            return meta

    raise FileNotFoundError(f"No image with hash {image_hash} found in training queue.")


# ─── CLI entry point ──────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys
    if len(sys.argv) < 2:
        print("Usage: python car_classifier.py <image_path>")
        sys.exit(1)

    path = sys.argv[1]
    result = classify_image(path)

    print("\n" + "═" * 60)
    print(f"  AeroMind Car Classifier")
    print("═" * 60)
    print(f"  Status      : {result['status'].upper()}")
    print(f"  Is Car      : {result['is_car']}")
    if result['is_car']:
        print(f"  Make/Model  : {result['make']} {result['model']}")
        print(f"  Year Range  : {result['year_range']}")
        print(f"  Body Type   : {result['body_type']}")
        print(f"  View Angle  : {result['view_angle']}")
        print(f"  Confidence  : {result['identification_confidence']:.0%}")
    print(f"  Notes       : {result['notes']}")
    print(f"  Struct. diag: {result['structural_diagnostics']}")
    print("═" * 60 + "\n")
