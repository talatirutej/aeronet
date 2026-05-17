# image_analysis.py — Moondream2 car/part analysis pipeline
# Revision: 2025-06-21 — uses model.query() / model.caption() API (no pyvips)
# Copyright (c) 2026 Rutej Talati. All rights reserved.

from __future__ import annotations

import io
import re
import time
from datetime import datetime

import torch
from PIL import Image
from transformers import AutoModelForCausalLM, AutoTokenizer

# ── Singleton model ────────────────────────────────────────────────────────────

_MODEL     = None
_TOKENIZER = None
_MODEL_ID  = "vikhyatk/moondream2"
_REVISION  = "2025-06-21"


def _load():
    global _MODEL, _TOKENIZER
    if _MODEL is None:
        print(f"[AeroMind] Loading Moondream2 {_REVISION}…")
        _TOKENIZER = AutoTokenizer.from_pretrained(
            _MODEL_ID, revision=_REVISION, trust_remote_code=True
        )
        _MODEL = AutoModelForCausalLM.from_pretrained(
            _MODEL_ID, revision=_REVISION,
            trust_remote_code=True, torch_dtype=torch.float32,
        )
        _MODEL.eval()
        print("[AeroMind] Ready.")
    return _MODEL, _TOKENIZER


def _ask(pil_image: Image.Image, question: str) -> str:
    """Use the 2025-06-21 API: model.query(image, question)['answer']"""
    model, _ = _load()
    result = model.query(pil_image, question)
    return result.get("answer", "").strip()


def _caption(pil_image: Image.Image, length: str = "normal") -> str:
    """Use model.caption() for general descriptions."""
    model, _ = _load()
    result = model.caption(pil_image, length=length)
    return result.get("caption", "").strip()


# ── Known-car Cd database ──────────────────────────────────────────────────────

KNOWN_CARS = {
    "tesla model 3":       {"cd": 0.230, "type": "fastback"},
    "tesla model s":       {"cd": 0.208, "type": "fastback"},
    "tesla model y":       {"cd": 0.230, "type": "suv"},
    "bmw m3":              {"cd": 0.270, "type": "notchback"},
    "bmw 7 series":        {"cd": 0.220, "type": "notchback"},
    "mercedes eqs":        {"cd": 0.200, "type": "fastback"},
    "mercedes c class":    {"cd": 0.240, "type": "notchback"},
    "audi a7":             {"cd": 0.250, "type": "fastback"},
    "audi a4":             {"cd": 0.270, "type": "notchback"},
    "porsche 911":         {"cd": 0.300, "type": "fastback"},
    "porsche taycan":      {"cd": 0.220, "type": "fastback"},
    "hyundai ioniq 6":     {"cd": 0.210, "type": "fastback"},
    "hyundai ioniq 5":     {"cd": 0.290, "type": "suv"},
    "toyota camry":        {"cd": 0.280, "type": "notchback"},
    "toyota gr86":         {"cd": 0.270, "type": "fastback"},
    "honda civic":         {"cd": 0.290, "type": "notchback"},
    "ford mustang":        {"cd": 0.310, "type": "fastback"},
    "ford f-150":          {"cd": 0.390, "type": "truck"},
    "volkswagen golf":     {"cd": 0.270, "type": "hatchback"},
    "volkswagen id.4":     {"cd": 0.280, "type": "suv"},
    "polestar 2":          {"cd": 0.270, "type": "fastback"},
    "lucid air":           {"cd": 0.210, "type": "notchback"},
    "rivian r1t":          {"cd": 0.340, "type": "truck"},
    "ferrari sf90":        {"cd": 0.330, "type": "supercar"},
    "lamborghini huracan": {"cd": 0.330, "type": "supercar"},
    "mclaren 720s":        {"cd": 0.320, "type": "supercar"},
    "bugatti chiron":      {"cd": 0.350, "type": "hypercar"},
}

PART_CD_CONTRIB = {
    "front bumper":   0.060,  "rear bumper":    0.030,
    "front splitter": -0.012, "rear spoiler":   -0.008,
    "rear wing":      0.025,  "diffuser":       -0.018,
    "side mirror":    0.010,  "wheel":          0.040,
    "wheel cover":    -0.005, "side skirt":     -0.004,
    "canard":         0.005,  "hood vent":      0.003,
    "grille":         0.008,
}

# ── Classification ─────────────────────────────────────────────────────────────

def _classify(image: Image.Image) -> dict:
    raw = _ask(image,
        "Is this image showing (A) a full car with most of the body visible, "
        "(B) a single detached car component like a bumper, spoiler, or wheel, "
        "or (C) a car interior? Reply with only the letter A, B, or C."
    ).upper().strip()

    if "B" in raw:
        part_name = _ask(image,
            "What specific car part or component is shown? "
            "Give the exact name in 1-4 words, e.g. 'rear diffuser'."
        ).strip().lower()
        part_loc = _ask(image,
            "Where on a car does this part belong? "
            "Reply with ONE of: front, rear, side, top, underbody."
        ).strip().lower()
        if part_loc not in ("front", "rear", "side", "top", "underbody"):
            part_loc = "front"
        return {"type": "car_part", "part_name": part_name,
                "part_location": part_loc, "confidence": 0.85}
    if "C" in raw:
        return {"type": "car_interior", "confidence": 0.90}
    return {"type": "full_car", "confidence": 0.85}

# ── Full car analysis ──────────────────────────────────────────────────────────

def _analyse_full_car(image: Image.Image) -> dict:
    make_model  = _ask(image, "What is the make and model of this car? Be specific.")
    year        = _ask(image, "What year or year range is this car?")
    body_type   = _ask(image,
        "What body type? Choose ONE: fastback, notchback, hatchback, suv, truck, "
        "supercar, hypercar, coupe, convertible."
    ).lower().strip()
    color       = _ask(image, "What color is the car?")

    conf_raw    = _ask(image, "How confident are you in the make/model identification, 0.0 to 1.0? Reply with just a number.")
    try:
        confidence = min(1.0, max(0.0, float(re.findall(r"[01]\.?\d*", conf_raw)[0])))
    except Exception:
        confidence = 0.65

    roofline    = _ask(image, "Roofline type? ONE of: fastback, notchback, squareback, kamm.").lower().strip()
    rear_design = _ask(image, "Rear end design? ONE of: tapered, bluff, slopeback, truncated.").lower().strip()
    spoiler     = _ask(image, "Is there a spoiler? If yes: lip, duck, wing, or integrated. If no: 'none'.").lower().strip()
    diffuser    = _ask(image, "Rear diffuser? ONE of: none, basic, race.").lower().strip()
    grille      = _ask(image, "Front grille type? ONE of: open, closed, semi-closed, active.").lower().strip()

    cd_raw      = _ask(image, "Estimate the drag coefficient (Cd). Reply with ONLY a number like 0.27.")
    try:
        cd_est = float(re.findall(r"0\.\d+", cd_raw)[0])
    except Exception:
        cd_est = 0.28

    cd_why      = _ask(image,
        "In 2-3 sentences explain why this car has that drag coefficient. "
        "Mention the roofline, rear end, and notable aero features."
    )
    improv_raw  = _ask(image, "Suggest two aerodynamic improvements, separated by a pipe |.")
    improvements = [s.strip() for s in improv_raw.split("|") if s.strip()][:2]

    comp_raw    = _ask(image, "Name two cars with similar aerodynamics. Format: Car Name (Cd 0.XX) | Car Name (Cd 0.XX).")
    comparisons = []
    for chunk in comp_raw.split("|"):
        chunk = chunk.strip()
        cd_m  = re.search(r"Cd\s*(0\.\d+)", chunk, re.I)
        name  = re.sub(r"\(.*?\)", "", chunk).strip()
        if name:
            comparisons.append({
                "name": name,
                "cd":   float(cd_m.group(1)) if cd_m else 0.28,
                "why_similar": "similar body type and aerodynamic profile",
            })

    result = {
        "make":          make_model.split()[0] if make_model.split() else "Unknown",
        "model":         " ".join(make_model.split()[1:]) if len(make_model.split()) > 1 else make_model,
        "year_estimate": year,
        "body_type":     body_type,
        "color":         color,
        "confidence":    round(confidence, 2),
        "aero_features": {
            "roofline_type": roofline,
            "rear_design":   rear_design,
            "spoiler":       spoiler,
            "diffuser":      diffuser,
            "grille":        grille,
        },
        "cd_reasoning": {
            "estimated_cd":           round(cd_est, 3),
            "cd_confidence":          "high" if confidence > 0.7 else "medium",
            "main_drag_contributors": ["roofline profile", "rear wake", "underbody turbulence"],
            "reasoning_steps":        cd_why,
        },
        "comparison_cars":         comparisons,
        "improvement_suggestions": improvements,
    }

    # Enrich from database
    full_name = f"{result['make']} {result['model']}".lower().strip()
    for key, val in KNOWN_CARS.items():
        if key in full_name or full_name in key:
            result["database_cd"]    = val["cd"]
            result["database_match"] = key
            result["cd_reasoning"]["estimated_cd"]  = val["cd"]
            result["cd_reasoning"]["cd_confidence"] = "very_high"
            break

    return result

# ── Car part analysis ──────────────────────────────────────────────────────────

def _analyse_part(image: Image.Image, detection: dict) -> dict:
    part = detection.get("part_name", "car part")

    purpose   = _ask(image, f"What is the aerodynamic purpose of this {part}? One sentence.")
    drag_raw  = _ask(image, f"Does this {part} increase drag, reduce drag, or is it neutral? Reply ONE word: increases, reduces, or neutral.")
    drag_eff  = "neutral"
    for w in ("increases", "reduces", "neutral"):
        if w in drag_raw.lower():
            drag_eff = w
            break

    downforce = _ask(image, f"Does this {part} generate downforce? Reply ONE of: increases, reduces, neutral, none.").lower().strip()
    if downforce not in ("increases", "reduces", "neutral", "none"):
        downforce = "none"

    cd_raw    = _ask(image, f"Estimated Cd contribution of this {part}? Reply ONLY a number like 0.015 (negative if drag-reducing).")
    try:
        matches   = re.findall(r"-?0\.\d+", cd_raw)
        cd_contrib = float(matches[0]) if matches else PART_CD_CONTRIB.get(part, 0.010)
    except Exception:
        cd_contrib = PART_CD_CONTRIB.get(part, 0.010)

    material  = _ask(image, f"Material of this {part}? ONE of: steel, aluminum, carbon_fiber, plastic, composite, unknown.").lower().strip()
    if material not in ("steel", "aluminum", "carbon_fiber", "plastic", "composite", "unknown"):
        material = "unknown"

    flow      = _ask(image, f"How does air flow around this {part}? One sentence.")
    cfd_tip   = _ask(image, f"What to focus on when simulating this {part} in CFD? One sentence.")
    condition = _ask(image, f"Condition of this {part}? ONE of: new, used, modified, race-spec.").lower().strip()
    if condition not in ("new", "used", "modified", "race-spec"):
        condition = "used"

    return {
        "part_confirmed":  part,
        "part_category":   "aerodynamic",
        "location_on_car": detection.get("part_location", "unknown"),
        "aero_function": {
            "primary_purpose":           purpose,
            "drag_effect":               drag_eff,
            "downforce_effect":          downforce,
            "estimated_cd_contribution": round(float(cd_contrib), 4),
            "explanation":               flow,
        },
        "cfd_notes": {
            "flow_behaviour":  flow,
            "problem_areas":   [],
            "simulation_tips": cfd_tip,
        },
        "condition":        condition,
        "material_estimate": material,
    }

# ── Expert explanation ─────────────────────────────────────────────────────────

def _explain(image: Image.Image, analysis: dict, image_type: str) -> str:
    if image_type == "car_part":
        part    = analysis.get("part_confirmed", "part")
        drag    = analysis.get("aero_function", {}).get("drag_effect", "")
        contrib = analysis.get("aero_function", {}).get("estimated_cd_contribution", 0)
        q = (
            f"You are AeroMind, an expert automotive aerodynamicist. "
            f"Write a 150-word expert explanation of this {part}. "
            f"Its drag effect is '{drag}' with estimated ΔCd of {contrib:+.3f}. "
            f"Explain the physics, how air flows around it, and CFD considerations. "
            f"Write in flowing paragraphs like a senior engineer talking to a student."
        )
    else:
        make   = analysis.get("make", "")
        model_ = analysis.get("model", "")
        cd     = analysis.get("database_cd") or analysis.get("cd_reasoning", {}).get("estimated_cd", 0.28)
        q = (
            f"You are AeroMind, an expert automotive aerodynamicist. "
            f"Write a 200-word explanation of the {make} {model_}'s aerodynamics. "
            f"Its Cd is {cd:.3f}. Explain what shape features drive this, "
            f"compare it to similar cars, and what makes its aero interesting. "
            f"Write in flowing paragraphs like a mentor talking to a curious student."
        )
    return _ask(image, q)

# ── SVG renders ────────────────────────────────────────────────────────────────

_FB  = ("M 80,280 C 80,280 100,275 140,270 L 180,265 C 200,263 220,255 250,230 "
        "C 270,212 290,195 330,175 C 370,155 420,148 480,148 C 540,148 580,152 620,158 "
        "C 650,162 670,168 690,175 L 710,180 C 720,183 728,188 730,195 L 735,220 "
        "C 737,230 737,240 735,255 L 730,270 C 725,278 718,282 710,283 L 640,285 "
        "C 630,285 622,283 616,278 C 608,270 604,260 604,248 C 604,218 580,196 550,196 "
        "C 520,196 496,218 496,248 C 496,260 492,270 484,278 C 478,283 470,285 460,285 "
        "L 280,285 C 270,285 262,283 256,278 C 248,270 244,260 244,248 C 244,218 220,196 "
        "190,196 C 160,196 136,218 136,248 C 136,260 132,270 124,278 C 118,283 110,285 "
        "100,285 L 80,283 Z")
_FBW = ("M 260,228 C 270,208 295,188 330,175 C 370,162 420,155 480,155 "
        "C 540,155 580,160 618,168 L 690,178 L 688,228 Z")
_NB  = ("M 80,278 C 90,278 100,276 115,272 C 125,265 130,258 132,248 C 132,218 156,196 "
        "186,196 C 216,196 240,218 240,248 C 240,258 245,265 255,272 C 265,276 275,278 "
        "285,278 L 455,278 C 465,278 475,276 485,272 C 495,265 498,258 500,248 C 500,218 "
        "524,196 554,196 C 584,196 608,218 608,248 C 608,258 612,265 620,272 C 630,276 "
        "640,278 650,278 L 700,276 C 714,274 722,268 726,258 L 728,230 L 728,215 "
        "C 728,205 720,198 710,195 L 670,185 C 650,180 625,176 595,174 L 580,165 "
        "L 545,148 L 380,145 L 260,145 L 218,162 L 200,172 C 170,176 140,182 115,190 "
        "L 88,200 C 82,205 80,212 80,220 Z")
_NBW = ("M 225,165 L 225,210 L 595,210 L 595,165 C 570,158 540,150 505,148 "
        "L 380,145 L 260,148 C 245,152 235,158 225,165 Z")
_SUV = ("M 80,295 L 100,290 L 120,285 C 125,283 130,278 132,272 C 135,262 136,252 136,248 "
        "C 136,218 160,196 190,196 C 220,196 244,218 244,248 C 244,252 245,262 248,272 "
        "C 250,278 255,283 260,285 L 460,285 C 465,283 470,278 472,272 C 475,262 476,252 "
        "476,248 C 476,218 500,196 530,196 C 560,196 584,218 584,248 C 584,252 585,262 "
        "588,272 C 590,278 595,283 600,285 L 680,285 C 695,285 710,278 718,268 L 725,248 "
        "L 725,210 C 725,200 720,190 712,185 L 680,172 C 655,165 620,160 580,158 L 580,150 "
        "L 200,150 L 200,158 C 165,162 135,170 110,180 L 90,192 C 83,198 80,207 80,216 Z")
_SUVW = "M 205,158 L 200,158 L 200,215 L 575,215 L 575,158 Z"


def _cd_color(cd: float) -> tuple[str, str]:
    if cd < 0.22: return "#30D158", "Exceptional"
    if cd < 0.27: return "#0A84FF", "Good"
    if cd < 0.32: return "#FF9F0A", "Average"
    return "#FF453A", "High Drag"


def _defs(c: str) -> str:
    return (f'<defs>'
            f'<pattern id="g" width="40" height="40" patternUnits="userSpaceOnUse">'
            f'<path d="M40 0L0 0 0 40" fill="none" stroke="#1a1a1a" stroke-width="0.5"/></pattern>'
            f'<linearGradient id="b" x1="0" y1="0" x2="0" y2="1">'
            f'<stop offset="0%" stop-color="{c}" stop-opacity="0.9"/>'
            f'<stop offset="100%" stop-color="{c}" stop-opacity="0.6"/></linearGradient>'
            f'<linearGradient id="w" x1="0" y1="0" x2="1" y2="1">'
            f'<stop offset="0%" stop-color="#3a3a3a"/>'
            f'<stop offset="100%" stop-color="#1a1a1a"/></linearGradient>'
            f'<filter id="s"><feDropShadow dx="0" dy="4" stdDeviation="8" '
            f'flood-color="#000" flood-opacity="0.5"/></filter></defs>')


def _wheel(cx, cy, r):
    return (f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="url(#w)" stroke="#555" stroke-width="2"/>'
            f'<circle cx="{cx}" cy="{cy}" r="{int(r*.65)}" fill="#111" stroke="#444" stroke-width="1"/>'
            f'<circle cx="{cx}" cy="{cy}" r="{int(r*.15)}" fill="#333"/>')


def _badge(w, cd):
    color, label = _cd_color(cd)
    x = w - 100
    return (f'<rect x="{w-160}" y="20" width="120" height="78" rx="12" '
            f'fill="rgba(30,30,30,0.95)" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>'
            f'<text x="{x}" y="46" font-family="-apple-system,sans-serif" font-size="9" '
            f'fill="rgba(235,235,245,0.55)" text-anchor="middle">DRAG COEFFICIENT</text>'
            f'<text x="{x}" y="72" font-family="-apple-system,sans-serif" font-size="28" '
            f'font-weight="700" fill="{color}" text-anchor="middle">{cd:.3f}</text>'
            f'<text x="{x}" y="90" font-family="-apple-system,sans-serif" font-size="11" '
            f'font-weight="600" fill="{color}" text-anchor="middle">{label}</text>')


def _wm(w, h):
    return (f'<text x="{w//2}" y="{h-10}" font-family="-apple-system,sans-serif" '
            f'font-size="8" fill="rgba(235,235,245,0.15)" text-anchor="middle">AEROMIND</text>')


def _fastback_svg(name, cd):
    w, h, c, ac = 800, 375, "#C0C0C0", "#0A84FF"
    return (f'<svg width="{w}" height="{h}" viewBox="0 0 {w} {h}" xmlns="http://www.w3.org/2000/svg" '
            f'style="background:#0a0a0a;border-radius:16px;">{_defs(c)}'
            f'<rect width="{w}" height="{h}" fill="url(#g)"/>'
            f'<ellipse cx="390" cy="295" rx="310" ry="12" fill="rgba(0,0,0,0.4)"/>'
            f'<path d="{_FB}" fill="url(#b)" stroke="#666" stroke-width="1.5" filter="url(#s)"/>'
            f'<path d="{_FBW}" fill="rgba(100,180,255,0.13)" stroke="rgba(100,180,255,0.38)" stroke-width="1"/>'
            f'{_wheel(190,248,52)}{_wheel(550,248,52)}'
            f'<text x="50" y="43" font-family="-apple-system,sans-serif" font-size="20" font-weight="700" fill="white">{name}</text>'
            f'<rect x="50" y="52" width="90" height="19" rx="9" fill="rgba(10,132,255,0.18)" stroke="rgba(10,132,255,0.45)" stroke-width="1"/>'
            f'<text x="95" y="65" font-family="-apple-system,sans-serif" font-size="10" font-weight="600" fill="{ac}" text-anchor="middle">FASTBACK</text>'
            f'{_badge(w,cd)}{_wm(w,h)}</svg>')


def _notchback_svg(name, cd):
    w, h, c, ac = 800, 375, "#A8A8B0", "#FF9F0A"
    return (f'<svg width="{w}" height="{h}" viewBox="0 0 {w} {h}" xmlns="http://www.w3.org/2000/svg" '
            f'style="background:#0a0a0a;border-radius:16px;">{_defs(c)}'
            f'<rect width="{w}" height="{h}" fill="url(#g)"/>'
            f'<ellipse cx="400" cy="292" rx="310" ry="12" fill="rgba(0,0,0,0.4)"/>'
            f'<path d="{_NB}" fill="url(#b)" stroke="#666" stroke-width="1.5" filter="url(#s)"/>'
            f'<path d="{_NBW}" fill="rgba(100,180,255,0.12)" stroke="rgba(100,180,255,0.35)" stroke-width="1"/>'
            f'{_wheel(186,248,52)}{_wheel(554,248,52)}'
            f'<text x="50" y="43" font-family="-apple-system,sans-serif" font-size="20" font-weight="700" fill="white">{name}</text>'
            f'<rect x="50" y="52" width="100" height="19" rx="9" fill="rgba(255,159,10,0.18)" stroke="rgba(255,159,10,0.45)" stroke-width="1"/>'
            f'<text x="100" y="65" font-family="-apple-system,sans-serif" font-size="10" font-weight="600" fill="{ac}" text-anchor="middle">NOTCHBACK</text>'
            f'{_badge(w,cd)}{_wm(w,h)}</svg>')


def _suv_svg(name, cd):
    w, h, c, ac = 800, 405, "#8A8A8E", "#30D158"
    return (f'<svg width="{w}" height="{h}" viewBox="0 0 {w} {h}" xmlns="http://www.w3.org/2000/svg" '
            f'style="background:#0a0a0a;border-radius:16px;">{_defs(c)}'
            f'<rect width="{w}" height="{h}" fill="url(#g)"/>'
            f'<ellipse cx="400" cy="305" rx="320" ry="14" fill="rgba(0,0,0,0.4)"/>'
            f'<path d="{_SUV}" fill="url(#b)" stroke="#666" stroke-width="1.5" filter="url(#s)"/>'
            f'<path d="{_SUVW}" fill="rgba(100,180,255,0.11)" stroke="rgba(100,180,255,0.33)" stroke-width="1"/>'
            f'{_wheel(190,248,55)}{_wheel(530,248,55)}'
            f'<text x="50" y="43" font-family="-apple-system,sans-serif" font-size="20" font-weight="700" fill="white">{name}</text>'
            f'<rect x="50" y="52" width="55" height="19" rx="9" fill="rgba(48,209,88,0.18)" stroke="rgba(48,209,88,0.45)" stroke-width="1"/>'
            f'<text x="77" y="65" font-family="-apple-system,sans-serif" font-size="10" font-weight="600" fill="{ac}" text-anchor="middle">SUV</text>'
            f'{_badge(w,cd)}{_wm(w,h)}</svg>')


def _part_svg(analysis: dict) -> str:
    w, h    = 600, 340
    aero    = analysis.get("aero_function", {})
    pname   = analysis.get("part_confirmed", "Car Part")
    loc     = analysis.get("location_on_car", "unknown")
    drag    = aero.get("drag_effect", "neutral")
    contrib = float(aero.get("estimated_cd_contribution", 0.0))
    downf   = aero.get("downforce_effect", "none")
    ecol    = {"reduces": "#30D158", "increases": "#FF453A", "neutral": "#FF9F0A"}.get(drag, "#8A8A8E")
    return (f'<svg width="{w}" height="{h}" viewBox="0 0 {w} {h}" xmlns="http://www.w3.org/2000/svg" '
            f'style="background:#0a0a0a;border-radius:16px;">'
            f'<defs><pattern id="g" width="30" height="30" patternUnits="userSpaceOnUse">'
            f'<path d="M30 0L0 0 0 30" fill="none" stroke="#1a1a1a" stroke-width="0.5"/></pattern>'
            f'<marker id="arr" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">'
            f'<path d="M0 0L8 3 0 6Z" fill="rgba(10,132,255,0.6)"/></marker></defs>'
            f'<rect width="{w}" height="{h}" fill="url(#g)"/>'
            f'<rect x="200" y="80" width="200" height="150" rx="12" '
            f'fill="rgba(40,40,45,0.9)" stroke="rgba(10,132,255,0.4)" stroke-width="1.5" stroke-dasharray="6,4"/>'
            f'<text x="300" y="152" font-family="-apple-system,sans-serif" font-size="13" '
            f'fill="rgba(235,235,245,0.5)" text-anchor="middle">{pname.upper()}</text>'
            f'<text x="300" y="172" font-family="-apple-system,sans-serif" font-size="10" '
            f'fill="rgba(235,235,245,0.3)" text-anchor="middle">{loc} of vehicle</text>'
            f'<path d="M50,155 L190,155" stroke="rgba(10,132,255,0.5)" stroke-width="2" marker-end="url(#arr)"/>'
            f'<text x="40" y="42" font-family="-apple-system,sans-serif" font-size="18" font-weight="700" fill="white">{pname.title()}</text>'
            f'<rect x="35" y="262" width="150" height="52" rx="10" fill="rgba(30,30,35,0.95)" stroke="rgba(255,255,255,0.07)" stroke-width="1"/>'
            f'<text x="110" y="284" font-family="-apple-system,sans-serif" font-size="9" fill="rgba(235,235,245,0.5)" text-anchor="middle">DRAG EFFECT</text>'
            f'<text x="110" y="304" font-family="-apple-system,sans-serif" font-size="13" font-weight="700" fill="{ecol}" text-anchor="middle">{drag.upper()}</text>'
            f'<rect x="205" y="262" width="150" height="52" rx="10" fill="rgba(30,30,35,0.95)" stroke="rgba(255,255,255,0.07)" stroke-width="1"/>'
            f'<text x="280" y="284" font-family="-apple-system,sans-serif" font-size="9" fill="rgba(235,235,245,0.5)" text-anchor="middle">ΔCd</text>'
            f'<text x="280" y="304" font-family="-apple-system,sans-serif" font-size="13" font-weight="700" fill="white" text-anchor="middle">{contrib:+.4f}</text>'
            f'<rect x="375" y="262" width="188" height="52" rx="10" fill="rgba(30,30,35,0.95)" stroke="rgba(255,255,255,0.07)" stroke-width="1"/>'
            f'<text x="469" y="284" font-family="-apple-system,sans-serif" font-size="9" fill="rgba(235,235,245,0.5)" text-anchor="middle">DOWNFORCE</text>'
            f'<text x="469" y="304" font-family="-apple-system,sans-serif" font-size="12" font-weight="600" fill="#5E5CE6" text-anchor="middle">{downf.upper()}</text>'
            f'<text x="{w//2}" y="{h-10}" font-family="-apple-system,sans-serif" font-size="8" fill="rgba(235,235,245,0.15)" text-anchor="middle">AEROMIND</text>'
            f'</svg>')


def _build_svg(result: dict) -> str:
    rt       = result.get("render_type", "none")
    analysis = result.get("analysis", {})
    if rt == "part_diagram":
        return _part_svg(analysis)
    if rt in ("standard", "reconstructed"):
        name  = f"{analysis.get('make','Unknown')} {analysis.get('model','Car')}".strip()
        cd    = float(analysis.get("database_cd") or
                      analysis.get("cd_reasoning", {}).get("estimated_cd", 0.30))
        btype = (analysis.get("body_type") or
                 analysis.get("aero_features", {}).get("roofline_type", "notchback")).lower()
        if any(t in btype for t in ["fastback","coupe","supercar","hypercar"]):
            return _fastback_svg(name, cd)
        if any(t in btype for t in ["suv","crossover","truck","hatchback"]):
            return _suv_svg(name, cd)
        return _notchback_svg(name, cd)
    return ('<svg width="400" height="80" xmlns="http://www.w3.org/2000/svg" '
            'style="background:#0a0a0a;border-radius:12px;">'
            '<text x="200" y="45" font-family="-apple-system,sans-serif" font-size="13" '
            'fill="rgba(235,235,245,0.3)" text-anchor="middle">No render available</text></svg>')

# ── Entry point ────────────────────────────────────────────────────────────────

def run_analysis(image_bytes: bytes) -> dict:
    t0    = time.time()
    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    if max(image.size) > 768:
        image.thumbnail((768, 768), Image.LANCZOS)

    detection  = _classify(image)
    image_type = detection["type"]

    result: dict = {
        "image_type": image_type,
        "detection":  detection,
        "timestamp":  datetime.utcnow().isoformat() + "Z",
    }

    if image_type == "car_part":
        analysis              = _analyse_part(image, detection)
        result["analysis"]    = analysis
        result["render_type"] = "part_diagram"
    elif image_type == "full_car":
        analysis              = _analyse_full_car(image)
        result["analysis"]    = analysis
        result["is_unknown"]  = analysis.get("confidence", 1.0) < 0.5
        result["render_type"] = "reconstructed" if result["is_unknown"] else "standard"
    else:
        result["analysis"]    = {"note": "Interior — no aerodynamic analysis"}
        result["render_type"] = "none"

    result["explanation"]              = _explain(image, result.get("analysis", {}), image_type)
    result["render_svg"]               = _build_svg(result)
    result["processing_time_seconds"]  = round(time.time() - t0, 1)
    return result