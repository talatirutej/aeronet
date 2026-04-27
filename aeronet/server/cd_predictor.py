"""
AeroMind — cd_predictor.py
Full Cd prediction pipeline orchestrator.

Flow:
  1. car_classifier.py  → Is it a car? Which car?
  2. geometry_extractor.py → Extract aero geometry features
  3. cd_database_builder.py → Retrieve similar reference cars from ChromaDB
  4. LLM chain-of-thought reasoning (llama3.1:8b) → Cd estimate with explanation
  5. Return structured result with confidence bounds

Designed to be called from aeromind.py Streamlit UI or standalone.
"""

import json
import logging
import requests
from pathlib import Path
from typing import Optional
from dataclasses import dataclass, field

from car_classifier import classify_image
from geometry_extractor import extract_geometry, GeometryFeatures, draw_geometry_overlay
from cd_database_builder import query_similar_cars, get_cd_stats_for_body_type

log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="[AeroMind-Cd] %(levelname)s: %(message)s")

OLLAMA_URL = "http://localhost:11434/api/generate"
REASONING_MODEL = "llama3.1:8b"

# ─── Result structure ─────────────────────────────────────────────────────────

@dataclass
class CdPrediction:
    # Identification
    status: str = "error"          # success | car_unknown | not_car | error
    make: str   = "unknown"
    model: str  = "unknown"
    year_range: str = "unknown"
    body_type: str  = "unknown"
    view_angle: str = "unknown"
    id_confidence: float = 0.0

    # Prediction
    cd_estimate: float    = 0.0
    cd_low: float         = 0.0     # lower bound of confidence interval
    cd_high: float        = 0.0     # upper bound
    prediction_confidence: str = "low"   # low | medium | high

    # Reasoning
    reasoning: str = ""             # Full chain-of-thought explanation
    reference_cars: list = field(default_factory=list)

    # Geometry
    geometry: Optional[dict] = None

    # Pipeline metadata
    image_path: str = ""
    overlay_path: str = ""
    warnings: list = field(default_factory=list)

    def to_ui_dict(self) -> dict:
        """Serialisable dict for Streamlit display."""
        return {
            "status": self.status,
            "identification": {
                "make": self.make, "model": self.model,
                "year_range": self.year_range, "body_type": self.body_type,
                "view_angle": self.view_angle, "confidence": self.id_confidence
            },
            "prediction": {
                "cd_estimate": self.cd_estimate,
                "cd_range": [self.cd_low, self.cd_high],
                "confidence": self.prediction_confidence
            },
            "reasoning": self.reasoning,
            "reference_cars": self.reference_cars,
            "geometry_summary": self.geometry,
            "overlay_path": self.overlay_path,
            "warnings": self.warnings
        }


# ─── LLM reasoning chain ──────────────────────────────────────────────────────

def _build_reasoning_prompt(
    make: str, model: str, year: str, body_type: str, view_angle: str,
    geometry_text: str,
    reference_cars: list[dict],
    body_type_stats: dict
) -> str:

    refs_text = ""
    for r in reference_cars[:6]:
        refs_text += (
            f"  • {r.get('make','?')} {r.get('model','?')} ({r.get('year','?')}) — "
            f"Cd {r.get('cd','?')} ({r.get('body_type','?')})\n"
        )
    if not refs_text:
        refs_text = "  No close matches found in database.\n"

    return f"""You are a senior automotive aerodynamicist with 20 years of experience in wind-tunnel testing and CFD simulation. You reason like an engineer — step by step, citing physical principles and real reference data.

A user has uploaded a car image. Your task is to estimate its drag coefficient (Cd) with a physical explanation.

═══ VEHICLE IDENTIFICATION ═══
Make/Model: {make} {model}
Year range: {year}
Body type:  {body_type}
View angle: {view_angle}
Identification confidence: (provided by LLaVA vision model)

═══ EXTRACTED GEOMETRY FEATURES ═══
{geometry_text}

═══ REFERENCE CARS FROM DATABASE ═══
{refs_text}

═══ BODY TYPE STATISTICS (from AeroMind database) ═══
Body type: {body_type}
Typical Cd range: {body_type_stats.get('min', '?')} – {body_type_stats.get('max', '?')}
Mean Cd for type: {body_type_stats.get('mean', '?')}
Database records: {body_type_stats.get('count', 0)}

═══ YOUR TASK ═══
Reason step by step to estimate this vehicle's Cd. Structure your response EXACTLY as follows:

**Step 1 — Body type baseline**
State the expected Cd range for this body type and why, citing the Ahmed Body or DrivAer experiments if relevant.

**Step 2 — Roofline and rear geometry analysis**
Analyse the roofline slope, rear taper angle, and what they imply about wake size and separation. Compare to fastback vs notchback aerodynamics.

**Step 3 — Frontal area and blockage**
Discuss the frontal area proxy and what it means for pressure drag contribution.

**Step 4 — Surface refinement indicators**
Comment on any visible surface features — flush glazing, door handles, wheel covers, underbody smoothness, active aerodynamics if identifiable.

**Step 5 — Comparison to reference cars**
Pick the 2–3 most physically similar reference cars from the list above. Explain why they are similar and what Cd adjustments to apply.

**Step 6 — Cd estimate with confidence bounds**
State your final estimate as:
  Cd estimate: [value]
  Cd range: [low] – [high]
  Confidence: [low/medium/high]
  Primary uncertainty source: [what makes this hard to pin down]

**Step 7 — Engineering interpretation**
Explain in plain English what this Cd means for real-world fuel/energy consumption, and what aerodynamic improvement the manufacturer could most easily achieve.

Be precise. Use real numbers. Cite physics. Teach the user something they didn't know."""


def _ask_llm(prompt: str) -> str:
    """Send reasoning prompt to local Ollama llama3.1:8b."""
    payload = {
        "model": REASONING_MODEL,
        "prompt": prompt,
        "stream": False,
        "options": {
            "temperature": 0.15,
            "num_predict": 1500,
            "num_ctx": 4096
        }
    }
    try:
        r = requests.post(OLLAMA_URL, json=payload, timeout=180)
        r.raise_for_status()
        return r.json().get("response", "").strip()
    except Exception as e:
        log.error(f"LLM reasoning call failed: {e}")
        return f"[Reasoning engine unavailable: {e}]"


def _parse_cd_from_reasoning(reasoning_text: str) -> tuple[float, float, float, str]:
    """
    Extract Cd estimate, low, high, and confidence from the reasoning text.
    Returns (cd_estimate, cd_low, cd_high, confidence_level).
    """
    import re

    # Look for "Cd estimate: 0.XX"
    est_match = re.search(r'Cd estimate[:\s]+([0-9]\.[0-9]{2,3})', reasoning_text, re.IGNORECASE)
    range_match = re.search(r'Cd range[:\s]+([0-9]\.[0-9]{2,3})\s*[–\-—to]+\s*([0-9]\.[0-9]{2,3})', reasoning_text, re.IGNORECASE)
    conf_match  = re.search(r'Confidence[:\s]+(low|medium|high)', reasoning_text, re.IGNORECASE)

    cd_est  = float(est_match.group(1))   if est_match  else 0.30
    cd_low  = float(range_match.group(1)) if range_match else round(cd_est - 0.025, 3)
    cd_high = float(range_match.group(2)) if range_match else round(cd_est + 0.025, 3)
    conf    = conf_match.group(1).lower() if conf_match  else "low"

    # Sanity clamp
    cd_est  = max(0.15, min(0.80, cd_est))
    cd_low  = max(0.12, min(cd_est, cd_low))
    cd_high = min(0.85, max(cd_est, cd_high))

    return cd_est, cd_low, cd_high, conf


# ─── Main pipeline ────────────────────────────────────────────────────────────

def predict_cd(image_path: str, use_sam: bool = False, save_overlay: bool = True) -> CdPrediction:
    """
    Full Cd prediction pipeline. Returns CdPrediction dataclass.
    """
    result = CdPrediction(image_path=str(image_path))
    image_path = str(image_path)

    log.info("═" * 55)
    log.info("AeroMind Cd Prediction Pipeline")
    log.info("═" * 55)

    # ── Stage 1: Classification ───────────────────────────────────────────────
    log.info("Stage 1: Car classification...")
    clf = classify_image(image_path)

    if clf["status"] == "not_car":
        result.status = "not_car"
        result.reasoning = (
            f"This image does not appear to contain a road vehicle. "
            f"Reason: {clf.get('notes', 'Unknown')}. "
            f"AeroMind can only estimate drag coefficients for passenger cars, SUVs, trucks, and vans."
        )
        result.warnings.append(clf.get("notes", "Not a car"))
        return result

    result.make       = clf.get("make", "unknown") or "unknown"
    result.model      = clf.get("model", "unknown") or "unknown"
    result.year_range = clf.get("year_range", "unknown") or "unknown"
    result.body_type  = clf.get("body_type", "unknown") or "unknown"
    result.view_angle = clf.get("view_angle", "unknown") or "unknown"
    result.id_confidence = clf.get("identification_confidence", 0.0)

    if clf["status"] == "car_unknown":
        result.warnings.append(
            "Vehicle could not be positively identified — image saved to training queue. "
            "Cd prediction will proceed based on geometry only."
        )

    # ── Stage 2: Geometry extraction ──────────────────────────────────────────
    log.info("Stage 2: Geometry extraction...")
    feat = extract_geometry(image_path, use_sam=use_sam)
    result.geometry = feat.to_dict()
    if feat.warnings:
        result.warnings.extend(feat.warnings)

    geometry_text = feat.to_prompt_text()

    # Override body type from geometry if classifier was uncertain
    if result.body_type == "unknown":
        if feat.is_likely_suv:       result.body_type = "SUV"
        elif feat.is_likely_fastback: result.body_type = "sports_car"
        elif feat.is_likely_supercar: result.body_type = "supercar"
        elif feat.is_likely_sedan:    result.body_type = "sedan"
        else:                         result.body_type = "sedan"  # safe default

    # ── Stage 3: Reference car retrieval ──────────────────────────────────────
    log.info("Stage 3: ChromaDB similarity search...")
    ref_cars = query_similar_cars(
        make=result.make,
        model=result.model,
        body_type=result.body_type,
        n_results=8
    )
    result.reference_cars = ref_cars

    body_stats = get_cd_stats_for_body_type(result.body_type)

    # ── Stage 4: LLM chain-of-thought reasoning ───────────────────────────────
    log.info("Stage 4: LLM reasoning chain...")
    prompt = _build_reasoning_prompt(
        make=result.make, model=result.model,
        year=result.year_range, body_type=result.body_type,
        view_angle=result.view_angle,
        geometry_text=geometry_text,
        reference_cars=ref_cars,
        body_type_stats=body_stats
    )

    reasoning_text = _ask_llm(prompt)
    result.reasoning = reasoning_text

    # ── Stage 5: Parse numeric prediction from reasoning ──────────────────────
    log.info("Stage 5: Parsing prediction values...")
    try:
        cd_est, cd_low, cd_high, conf = _parse_cd_from_reasoning(reasoning_text)
        result.cd_estimate = cd_est
        result.cd_low      = cd_low
        result.cd_high     = cd_high
        result.prediction_confidence = conf
    except Exception as e:
        log.warning(f"Could not parse Cd from reasoning: {e}")
        # Fallback to body-type mean
        result.cd_estimate = body_stats.get("mean", 0.30)
        result.cd_low      = body_stats.get("min", 0.25)
        result.cd_high     = body_stats.get("max", 0.40)
        result.prediction_confidence = "low"
        result.warnings.append("Cd extracted from reasoning text; fell back to body-type statistics.")

    # ── Stage 6: Geometry overlay ─────────────────────────────────────────────
    if save_overlay and feat.extraction_quality != "low":
        overlay_path = Path(image_path).stem + "_aeromind_overlay.jpg"
        draw_geometry_overlay(image_path, feat, str(overlay_path))
        result.overlay_path = str(overlay_path)

    # ── Final status ──────────────────────────────────────────────────────────
    result.status = "success" if result.cd_estimate > 0 else "error"
    log.info(f"Prediction complete: {result.make} {result.model} → Cd {result.cd_estimate:.3f} [{result.cd_low:.3f}–{result.cd_high:.3f}] ({result.prediction_confidence})")

    return result


# ─── Streamlit-friendly wrapper ───────────────────────────────────────────────

def predict_cd_for_ui(image_path: str, use_sam: bool = False) -> dict:
    """
    Wrapper for Streamlit aeromind.py.
    Returns a plain dict — no dataclasses.
    """
    prediction = predict_cd(image_path, use_sam=use_sam)
    return prediction.to_ui_dict()


# ─── CLI entry point ──────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Usage: python cd_predictor.py <image_path> [--sam]")
        sys.exit(1)

    path  = sys.argv[1]
    sam   = "--sam" in sys.argv

    pred = predict_cd(path, use_sam=sam)

    print("\n" + "═" * 65)
    print("  AeroMind — Cd Prediction Result")
    print("═" * 65)
    print(f"  Status      : {pred.status.upper()}")
    print(f"  Vehicle     : {pred.make} {pred.model} ({pred.year_range})")
    print(f"  Body type   : {pred.body_type} | View: {pred.view_angle}")
    print(f"  ID conf.    : {pred.id_confidence:.0%}")
    print()
    print(f"  Cd estimate : {pred.cd_estimate:.3f}")
    print(f"  Cd range    : {pred.cd_low:.3f} – {pred.cd_high:.3f}")
    print(f"  Confidence  : {pred.prediction_confidence.upper()}")
    print()
    if pred.warnings:
        print("  Warnings:")
        for w in pred.warnings:
            print(f"    ⚠  {w}")
        print()
    print("  REASONING:")
    print("─" * 65)
    print(pred.reasoning)
    print("═" * 65)
