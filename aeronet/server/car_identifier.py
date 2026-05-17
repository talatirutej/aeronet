# car_identifier.py — Vehicle identification + real-world dimensions
# Mahindra Research Valley / StatCFD / statinsite.com
#
# Uses Moondream2 (vikhyatk/moondream2 rev 2025-06-21) to identify vehicle
# make/model from a side-view image, then looks up or estimates real-world
# dimensions:
#   - length_mm        (overall length)
#   - width_mm         (track width / overall width)
#   - height_mm        (overall height)
#   - wheelbase_mm     (between axle centres)
#   - track_front_mm   (front axle width)
#   - track_rear_mm    (rear axle width)
#   - ground_clearance_mm
#   - frontal_area_m2
#
# These dimensions drive accurate front/top/underside view rendering
# in the frontend instead of generic SVG paths.
#
# Also extracts:
#   - body_type        (sedan/suv/hatchback/fastback/coupe/wagon/truck/etc)
#   - drivetrain hint  (FWD/RWD/AWD)
#   - aero features    (spoiler, diffuser, grille, mirrors, wheels)
#
# Falls back to body-type-derived dimensional defaults if Moondream2 is unavailable.
#
# Copyright (c) 2026 Rutej Talati / statinsite.com

from __future__ import annotations
import re
import time
import numpy as np
from PIL import Image


# ── Reference dimensions for common body types (mm and m²) ───────────────────
# Sources: typical mid-segment vehicle in each category. Used as fallback
# when Moondream2 is unavailable or returns unrecognised make/model.

BODY_TYPE_DEFAULTS = {
    "sedan":     {"length":4720,"width":1830,"height":1450,"wheelbase":2790,
                  "track_front":1580,"track_rear":1590,"ground_clearance":140,
                  "frontal_area":2.20},
    "notchback": {"length":4720,"width":1830,"height":1450,"wheelbase":2790,
                  "track_front":1580,"track_rear":1590,"ground_clearance":140,
                  "frontal_area":2.20},
    "fastback":  {"length":4780,"width":1860,"height":1430,"wheelbase":2820,
                  "track_front":1590,"track_rear":1600,"ground_clearance":135,
                  "frontal_area":2.18},
    "hatchback": {"length":4280,"width":1790,"height":1480,"wheelbase":2640,
                  "track_front":1540,"track_rear":1550,"ground_clearance":140,
                  "frontal_area":2.15},
    "coupe":     {"length":4640,"width":1860,"height":1380,"wheelbase":2750,
                  "track_front":1580,"track_rear":1600,"ground_clearance":120,
                  "frontal_area":2.05},
    "wagon":     {"length":4760,"width":1830,"height":1480,"wheelbase":2820,
                  "track_front":1580,"track_rear":1590,"ground_clearance":145,
                  "frontal_area":2.30},
    "estate":    {"length":4760,"width":1830,"height":1480,"wheelbase":2820,
                  "track_front":1580,"track_rear":1590,"ground_clearance":145,
                  "frontal_area":2.30},
    "suv":       {"length":4640,"width":1880,"height":1680,"wheelbase":2740,
                  "track_front":1620,"track_rear":1620,"ground_clearance":200,
                  "frontal_area":2.65},
    "crossover": {"length":4500,"width":1840,"height":1620,"wheelbase":2680,
                  "track_front":1590,"track_rear":1600,"ground_clearance":175,
                  "frontal_area":2.50},
    "pickup":    {"length":5320,"width":1990,"height":1850,"wheelbase":3100,
                  "track_front":1690,"track_rear":1690,"ground_clearance":230,
                  "frontal_area":3.05},
    "truck":     {"length":5320,"width":1990,"height":1850,"wheelbase":3100,
                  "track_front":1690,"track_rear":1690,"ground_clearance":230,
                  "frontal_area":3.05},
    "supercar":  {"length":4540,"width":1990,"height":1180,"wheelbase":2660,
                  "track_front":1650,"track_rear":1660,"ground_clearance":100,
                  "frontal_area":1.95},
    "minivan":   {"length":4900,"width":1880,"height":1740,"wheelbase":2920,
                  "track_front":1610,"track_rear":1620,"ground_clearance":160,
                  "frontal_area":2.75},
}


# Curated lookup for popular models — overrides the body-type default.
# Add more as needed; reasonable for major Mahindra benchmarks.
KNOWN_MODELS = {
    "tata harrier":     {"length":4598,"width":1894,"height":1707,"wheelbase":2741,
                          "track_front":1592,"track_rear":1592,"ground_clearance":205,
                          "frontal_area":2.62,"body_type":"suv"},
    "mahindra xuv700":  {"length":4695,"width":1890,"height":1755,"wheelbase":2750,
                          "track_front":1620,"track_rear":1620,"ground_clearance":200,
                          "frontal_area":2.68,"body_type":"suv"},
    "mahindra scorpio": {"length":4662,"width":1917,"height":1857,"wheelbase":2750,
                          "track_front":1620,"track_rear":1620,"ground_clearance":187,
                          "frontal_area":2.85,"body_type":"suv"},
    "mahindra thar":    {"length":3985,"width":1855,"height":1844,"wheelbase":2450,
                          "track_front":1570,"track_rear":1570,"ground_clearance":226,
                          "frontal_area":2.90,"body_type":"suv"},
    "hyundai creta":    {"length":4330,"width":1790,"height":1635,"wheelbase":2610,
                          "track_front":1571,"track_rear":1581,"ground_clearance":190,
                          "frontal_area":2.50,"body_type":"crossover"},
    "kia seltos":       {"length":4365,"width":1800,"height":1645,"wheelbase":2630,
                          "track_front":1574,"track_rear":1576,"ground_clearance":190,
                          "frontal_area":2.55,"body_type":"crossover"},
    "maruti suzuki swift": {"length":3845,"width":1735,"height":1530,"wheelbase":2450,
                          "track_front":1520,"track_rear":1520,"ground_clearance":163,
                          "frontal_area":2.15,"body_type":"hatchback"},
    "honda city":       {"length":4549,"width":1748,"height":1489,"wheelbase":2600,
                          "track_front":1505,"track_rear":1495,"ground_clearance":165,
                          "frontal_area":2.18,"body_type":"sedan"},
    "toyota innova":    {"length":4735,"width":1830,"height":1795,"wheelbase":2750,
                          "track_front":1545,"track_rear":1545,"ground_clearance":185,
                          "frontal_area":2.78,"body_type":"minivan"},
    "bmw 3 series":     {"length":4709,"width":1827,"height":1442,"wheelbase":2851,
                          "track_front":1576,"track_rear":1579,"ground_clearance":140,
                          "frontal_area":2.20,"body_type":"sedan"},
    "bmw x5":           {"length":4922,"width":2004,"height":1745,"wheelbase":2975,
                          "track_front":1684,"track_rear":1690,"ground_clearance":214,
                          "frontal_area":2.78,"body_type":"suv"},
    "bmw x2":           {"length":4554,"width":1845,"height":1590,"wheelbase":2692,
                          "track_front":1561,"track_rear":1562,"ground_clearance":182,
                          "frontal_area":2.45,"body_type":"crossover"},
    "tesla model 3":    {"length":4694,"width":1849,"height":1443,"wheelbase":2875,
                          "track_front":1580,"track_rear":1580,"ground_clearance":140,
                          "frontal_area":2.20,"body_type":"sedan"},
    "tesla model y":    {"length":4750,"width":1921,"height":1624,"wheelbase":2890,
                          "track_front":1580,"track_rear":1580,"ground_clearance":167,
                          "frontal_area":2.50,"body_type":"crossover"},
    "porsche 911":      {"length":4519,"width":1852,"height":1300,"wheelbase":2450,
                          "track_front":1551,"track_rear":1555,"ground_clearance":110,
                          "frontal_area":1.96,"body_type":"coupe"},
    "audi a4":          {"length":4762,"width":1847,"height":1428,"wheelbase":2820,
                          "track_front":1572,"track_rear":1556,"ground_clearance":135,
                          "frontal_area":2.20,"body_type":"sedan"},
    "audi q5":          {"length":4663,"width":1893,"height":1659,"wheelbase":2819,
                          "track_front":1616,"track_rear":1611,"ground_clearance":190,
                          "frontal_area":2.55,"body_type":"suv"},
    "mercedes c class": {"length":4751,"width":1820,"height":1438,"wheelbase":2865,
                          "track_front":1620,"track_rear":1607,"ground_clearance":130,
                          "frontal_area":2.20,"body_type":"sedan"},
    "ford mustang":     {"length":4789,"width":1916,"height":1379,"wheelbase":2720,
                          "track_front":1582,"track_rear":1647,"ground_clearance":140,
                          "frontal_area":2.20,"body_type":"coupe"},
}


def _normalise_make_model(s: str) -> str:
    """Normalise Moondream2's free-text make/model output for lookup."""
    if not s: return ""
    s = s.lower().strip()
    s = re.sub(r"\s+", " ", s)
    s = re.sub(r"[^a-z0-9 \-]", "", s)
    return s


def _match_known(make_model: str) -> dict | None:
    """Try to match the recognised vehicle to a known model in our database."""
    if not make_model: return None
    norm = _normalise_make_model(make_model)
    if norm in KNOWN_MODELS:
        return {**KNOWN_MODELS[norm], "matched_key": norm}
    # Fuzzy: substring match
    for key, dims in KNOWN_MODELS.items():
        if key in norm or norm in key:
            return {**dims, "matched_key": key}
        # Token overlap >= 2 words
        norm_toks = set(norm.split())
        key_toks  = set(key.split())
        if len(norm_toks & key_toks) >= 2:
            return {**dims, "matched_key": key}
    return None


def _match_body_type(body_type: str) -> dict:
    """Fall back to body-type defaults."""
    if not body_type: return BODY_TYPE_DEFAULTS["sedan"]
    bt = body_type.lower().strip()
    return BODY_TYPE_DEFAULTS.get(bt, BODY_TYPE_DEFAULTS["sedan"])


def _moondream_query(rgb_array, geo: dict) -> dict:
    """
    Use Moondream2 to identify the vehicle and extract aero features.
    Returns dict with raw answers; caller decides how to use them.
    """
    try:
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer
    except ImportError:
        return {"_error": "transformers/torch not installed"}

    t0 = time.time()
    pil = Image.fromarray(rgb_array)
    if max(pil.size) > 768:
        pil.thumbnail((768, 768), Image.LANCZOS)

    try:
        tok = AutoTokenizer.from_pretrained(
            "vikhyatk/moondream2", revision="2025-06-21", trust_remote_code=True)
        mdl = AutoModelForCausalLM.from_pretrained(
            "vikhyatk/moondream2", revision="2025-06-21",
            trust_remote_code=True, torch_dtype=torch.float32).eval()
    except Exception as e:
        return {"_error": f"Moondream2 load failed: {e}"}

    def ask(q):
        try:
            return mdl.query(pil, q).get("answer", "").strip()
        except Exception as e:
            return ""

    make_model = ask("What is the make and model of this car? Respond with just the make and model in 1-5 words.")
    body_type  = ask("What body type is this vehicle? One word: sedan, hatchback, suv, fastback, notchback, coupe, wagon, pickup, supercar, minivan, crossover.")
    drivetrain = ask("Is this likely FWD, RWD or AWD? Just one of those three.")
    spoiler    = ask("Does the rear have a spoiler? One word: none, lip, duck, wing, integrated.")
    diffuser   = ask("Does the rear have a diffuser? One word: none, basic, race, aggressive.")
    grille     = ask("Front grille style? One word: open, closed, semi-closed, active.")
    mirrors    = ask("Side mirrors style? One word: conventional, aeroblade, camera, flush.")
    wheels     = ask("Wheel design? One word: open-spoke, closed, aero-cover, fully-enclosed.")
    cd_raw     = ask("Estimated drag coefficient Cd? Just a number like 0.27.")
    suggest    = ask("Two aerodynamic improvements for this car, separated by | character.")

    print(f"[car_id] Moondream2 inference: {time.time()-t0:.1f}s")
    try: del mdl, tok
    except: pass

    cd_meas = geo.get("Cd", 0.30)
    try:
        m = re.findall(r"0\.\d+", cd_raw)
        if m: cd_meas = float(m[0])
    except: pass

    return {
        "make_model": make_model,
        "body_type":  body_type.lower().strip(),
        "drivetrain": drivetrain.lower().strip(),
        "features": {
            "spoiler":  spoiler.lower().strip(),
            "diffuser": diffuser.lower().strip(),
            "grille":   grille.lower().strip(),
            "mirrors":  mirrors.lower().strip(),
            "wheels":   wheels.lower().strip(),
        },
        "vlm_estimated_cd": round(float(cd_meas), 3),
        "improvements": [s.strip() for s in suggest.split("|") if s.strip()][:2],
    }


def identify_car_dimensions(rgb_array: np.ndarray, geo: dict) -> dict:
    """
    Main entry point. Identify the vehicle, look up real-world dimensions,
    return a dict with everything the frontend needs to render accurate
    front/top/underside views.

    Always returns a dict with at minimum body_type-derived dimensions.
    Returns None only on catastrophic failure.

    Schema:
    {
      "make_model":          "Mahindra XUV700",
      "matched_known_model": True,
      "body_type":           "suv",
      "drivetrain":          "AWD",
      "features": {
        "spoiler":  "lip",
        "diffuser": "basic",
        "grille":   "closed",
        "mirrors":  "conventional",
        "wheels":   "open-spoke",
      },
      "dimensions": {
        "length_mm":        4695,
        "width_mm":         1890,
        "height_mm":        1755,
        "wheelbase_mm":     2750,
        "track_front_mm":   1620,
        "track_rear_mm":    1620,
        "ground_clearance_mm": 200,
        "frontal_area_m2":  2.68,
      },
      "vlm_estimated_cd":    0.36,
      "improvements":        ["...", "..."],
      "view_proportions": {
        # Derived ratios for accurate front/top/under view rendering
        "front":  {"width_to_height": 1.077, "track_to_width": 0.857},
        "top":    {"length_to_width": 2.484, "wheelbase_to_length": 0.586},
        "under":  {"length_to_width": 2.484, "wheelbase_to_length": 0.586},
      }
    }
    """
    result = {
        "make_model":           None,
        "matched_known_model":  False,
        "body_type":            geo.get("bodyType", "sedan"),
        "drivetrain":           "unknown",
        "features":             {},
        "dimensions":           {},
        "vlm_estimated_cd":     geo.get("Cd", 0.30),
        "improvements":         [],
        "view_proportions":     {},
    }

    # ── Try Moondream2 ──────────────────────────────────────────────────────
    md = _moondream_query(rgb_array, geo)
    if not md.get("_error"):
        result["make_model"] = md.get("make_model")
        result["drivetrain"] = md.get("drivetrain", "unknown")
        result["features"]   = md.get("features", {})
        result["vlm_estimated_cd"] = md.get("vlm_estimated_cd", geo.get("Cd",0.30))
        result["improvements"]      = md.get("improvements", [])
        if md.get("body_type"):
            result["body_type"] = md.get("body_type")

    # ── Look up real dimensions ─────────────────────────────────────────────
    matched = _match_known(result["make_model"]) if result["make_model"] else None
    if matched:
        result["matched_known_model"] = True
        if matched.get("body_type"):
            result["body_type"] = matched["body_type"]
        dims = matched
    else:
        dims = _match_body_type(result["body_type"])

    result["dimensions"] = {
        "length_mm":           int(dims.get("length", 4500)),
        "width_mm":            int(dims.get("width", 1820)),
        "height_mm":           int(dims.get("height", 1500)),
        "wheelbase_mm":        int(dims.get("wheelbase", 2700)),
        "track_front_mm":      int(dims.get("track_front", 1570)),
        "track_rear_mm":       int(dims.get("track_rear", 1580)),
        "ground_clearance_mm": int(dims.get("ground_clearance", 150)),
        "frontal_area_m2":     float(dims.get("frontal_area", 2.20)),
    }

    # ── Compute view proportions ────────────────────────────────────────────
    L = result["dimensions"]["length_mm"]
    W = result["dimensions"]["width_mm"]
    H = result["dimensions"]["height_mm"]
    WB = result["dimensions"]["wheelbase_mm"]
    TF = result["dimensions"]["track_front_mm"]
    TR = result["dimensions"]["track_rear_mm"]

    result["view_proportions"] = {
        "front": {
            "width_to_height":  round(W / max(H, 1), 4),
            "track_to_width":   round((TF + TR) / 2 / max(W, 1), 4),
            "track_front_norm": round(TF / max(W, 1), 4),
            "track_rear_norm":  round(TR / max(W, 1), 4),
        },
        "top": {
            "length_to_width":      round(L / max(W, 1), 4),
            "wheelbase_to_length":  round(WB / max(L, 1), 4),
            "track_to_width_norm":  round((TF + TR) / 2 / max(W, 1), 4),
            "front_overhang_norm":  round((L - WB) / 2 / max(L, 1), 4),
            "rear_overhang_norm":   round((L - WB) / 2 / max(L, 1), 4),
        },
        "under": {
            "length_to_width":     round(L / max(W, 1), 4),
            "wheelbase_to_length": round(WB / max(L, 1), 4),
            "track_to_width_norm": round((TF + TR) / 2 / max(W, 1), 4),
        },
    }

    return result