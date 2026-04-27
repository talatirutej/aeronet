"""
AeroMind — geometry_extractor.py
Extracts aerodynamic geometry features from car images.
Works best on side-profile images; degrades gracefully on other angles.

Features extracted:
  - Roofline slope angle (°)
  - Rear taper angle (Kamm-back / fastback indicator)
  - Frontal area proxy (normalised height × width of bounding box)
  - Aspect ratio (length/height)
  - Underbody clearance proxy
  - Windshield rake angle proxy
  - Rear overhang ratio
  - Contour smoothness index
  - SAM-based silhouette (if segment-anything is installed)
"""

import cv2
import numpy as np
import logging
from pathlib import Path
from typing import Optional
from dataclasses import dataclass, asdict

log = logging.getLogger(__name__)

# ─── Result dataclass ─────────────────────────────────────────────────────────

@dataclass
class GeometryFeatures:
    # Image meta
    image_width: int  = 0
    image_height: int = 0
    view_angle_guess: str = "unknown"  # side_profile | front | rear | three_quarter

    # Bounding box of main car object
    bbox_x: int = 0
    bbox_y: int = 0
    bbox_w: int = 0
    bbox_h: int = 0

    # Core aero geometry (all angles in degrees, ratios dimensionless)
    aspect_ratio: float          = 0.0   # length / height — higher → longer/sleeker
    frontal_area_proxy: float    = 0.0   # bbox_h/image_h — proxy for frontal area ratio
    roofline_slope_deg: float    = 0.0   # angle of roof from horizontal (0=flat, higher=sloped)
    rear_taper_angle_deg: float  = 0.0   # rear roofline drop angle — fastback indicator
    windshield_rake_deg: float   = 0.0   # windshield inclination from vertical
    rear_overhang_ratio: float   = 0.0   # rear overhang / total length
    underbody_clearance: float   = 0.0   # gap between lowest point and ground (normalised)
    contour_smoothness: float    = 0.0   # 0=jagged, 1=perfectly smooth
    silhouette_fill_ratio: float = 0.0   # filled area / bounding box area

    # Derived aero classification flags
    is_likely_fastback: bool   = False
    is_likely_suv: bool        = False
    is_likely_sedan: bool      = False
    is_likely_supercar: bool   = False

    # Pipeline quality
    extraction_quality: str = "low"   # low | medium | high
    warnings: list = None

    def __post_init__(self):
        if self.warnings is None:
            self.warnings = []

    def to_dict(self) -> dict:
        return asdict(self)

    def to_prompt_text(self) -> str:
        """Render features as natural language for the LLM reasoning chain."""
        lines = [
            f"• Aspect ratio (length/height): {self.aspect_ratio:.2f} "
            f"({'elongated/sporty' if self.aspect_ratio > 2.8 else 'compact/tall'})",

            f"• Frontal area proxy (normalised height): {self.frontal_area_proxy:.3f} "
            f"({'large frontal area — high base drag' if self.frontal_area_proxy > 0.55 else 'moderate frontal area'})",

            f"• Roofline slope: {self.roofline_slope_deg:.1f}° from horizontal "
            f"({'very sloped — coupe/fastback' if self.roofline_slope_deg > 15 else 'relatively flat — sedan/SUV'})",

            f"• Rear taper angle: {self.rear_taper_angle_deg:.1f}° "
            f"({'fastback/sloped rear' if self.rear_taper_angle_deg > 20 else 'notchback/Kamm-tail'})",

            f"• Windshield rake: {self.windshield_rake_deg:.1f}° from vertical "
            f"({'aggressive rake — reduces Cd' if self.windshield_rake_deg > 55 else 'upright — typical of vans/SUVs'})",

            f"• Underbody clearance proxy: {self.underbody_clearance:.3f} "
            f"({'high ride height — SUV/truck' if self.underbody_clearance > 0.12 else 'low ride height — sports car/sedan'})",

            f"• Contour smoothness index: {self.contour_smoothness:.2f}/1.00 "
            f"({'smooth aerodynamic body' if self.contour_smoothness > 0.75 else 'complex surfaces with features'})",

            f"• Silhouette fill ratio: {self.silhouette_fill_ratio:.2f} "
            f"(proportion of bounding box occupied by vehicle)",
        ]
        flags = []
        if self.is_likely_fastback: flags.append("fastback/coupé body")
        if self.is_likely_suv:      flags.append("SUV/crossover body")
        if self.is_likely_sedan:    flags.append("three-box sedan body")
        if self.is_likely_supercar: flags.append("supercar/low-slung body")
        if flags:
            lines.append(f"• Body type indicators: {', '.join(flags)}")
        lines.append(f"• Extraction quality: {self.extraction_quality}")
        if self.warnings:
            lines.append(f"• Warnings: {'; '.join(self.warnings)}")
        return "\n".join(lines)


# ─── Main extractor ───────────────────────────────────────────────────────────

def extract_geometry(image_path: str, use_sam: bool = False) -> GeometryFeatures:
    """
    Full geometry extraction pipeline.
    Falls back gracefully if image is not a clean side profile.
    """
    feat = GeometryFeatures()

    img = cv2.imread(str(image_path))
    if img is None:
        feat.warnings.append("Cannot read image")
        return feat

    feat.image_height, feat.image_width = img.shape[:2]

    # ── 1. Isolate car silhouette ─────────────────────────────────────────────
    if use_sam:
        mask, bbox = _sam_silhouette(img)
    else:
        mask, bbox = _opencv_silhouette(img)

    if bbox is None:
        feat.warnings.append("No clear vehicle contour found")
        feat.extraction_quality = "low"
        return feat

    feat.bbox_x, feat.bbox_y, feat.bbox_w, feat.bbox_h = bbox

    # ── 2. Basic ratios ───────────────────────────────────────────────────────
    feat.aspect_ratio = feat.bbox_w / max(feat.bbox_h, 1)
    feat.frontal_area_proxy = feat.bbox_h / feat.image_height

    # ── 3. View angle guess ───────────────────────────────────────────────────
    feat.view_angle_guess = _guess_view_angle(feat.aspect_ratio, feat.frontal_area_proxy)

    # ── 4. Silhouette fill ratio ──────────────────────────────────────────────
    if mask is not None:
        roi_mask = mask[feat.bbox_y:feat.bbox_y+feat.bbox_h,
                        feat.bbox_x:feat.bbox_x+feat.bbox_w]
        filled = np.sum(roi_mask > 0)
        bbox_area = feat.bbox_w * feat.bbox_h
        feat.silhouette_fill_ratio = filled / max(bbox_area, 1)
    else:
        feat.silhouette_fill_ratio = 0.7  # default assumption

    # ── 5. Roofline and rear taper (side-profile only) ────────────────────────
    if feat.view_angle_guess == "side_profile" and mask is not None:
        feat.roofline_slope_deg  = _measure_roofline_slope(mask, bbox)
        feat.rear_taper_angle_deg = _measure_rear_taper(mask, bbox)
        feat.windshield_rake_deg  = _measure_windshield_rake(mask, bbox)
        feat.rear_overhang_ratio  = _measure_rear_overhang(mask, bbox)
        feat.underbody_clearance  = _measure_underbody_clearance(mask, bbox, feat.image_height)
        feat.extraction_quality   = "high"
    else:
        feat.warnings.append(f"Non-side-profile view ({feat.view_angle_guess}) — angle measurements limited")
        feat.extraction_quality = "medium" if feat.view_angle_guess != "unknown" else "low"

    # ── 6. Contour smoothness ─────────────────────────────────────────────────
    if mask is not None:
        feat.contour_smoothness = _measure_contour_smoothness(mask, bbox)

    # ── 7. Body type classification flags ─────────────────────────────────────
    _classify_body_flags(feat)

    return feat


# ─── Silhouette extraction ────────────────────────────────────────────────────

def _opencv_silhouette(img: np.ndarray):
    """
    Multi-stage OpenCV approach to extract car silhouette.
    Returns (mask, (x,y,w,h)) or (None, None) on failure.
    """
    h, w = img.shape[:2]

    # Stage A: GrabCut on a central region (car is usually center-framed)
    mask_gc = np.zeros((h, w), np.uint8)
    rect = (int(w * 0.05), int(h * 0.05), int(w * 0.90), int(h * 0.90))
    bgd = np.zeros((1, 65), np.float64)
    fgd = np.zeros((1, 65), np.float64)
    try:
        cv2.grabCut(img, mask_gc, rect, bgd, fgd, 5, cv2.GC_INIT_WITH_RECT)
        fg_mask = np.where((mask_gc == 2) | (mask_gc == 0), 0, 255).astype(np.uint8)
    except Exception:
        fg_mask = None

    # Stage B: Edge + morphology fallback
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (7, 7), 0)
    edges = cv2.Canny(blur, 30, 100)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15))
    dilated = cv2.dilate(edges, kernel, iterations=2)
    _, thresh = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    combined = cv2.bitwise_or(dilated, thresh)
    closed = cv2.morphologyEx(combined, cv2.MORPH_CLOSE, kernel, iterations=3)

    # Pick best mask
    if fg_mask is not None and np.sum(fg_mask > 0) > (h * w * 0.05):
        working_mask = cv2.bitwise_or(fg_mask, closed)
    else:
        working_mask = closed

    # Find largest contour
    contours, _ = cv2.findContours(working_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None, None

    # Filter small noise contours
    min_area = h * w * 0.03
    valid = [c for c in contours if cv2.contourArea(c) > min_area]
    if not valid:
        return None, None

    largest = max(valid, key=cv2.contourArea)
    x, y, cw, ch = cv2.boundingRect(largest)

    # Build clean mask from largest contour
    clean_mask = np.zeros((h, w), np.uint8)
    cv2.drawContours(clean_mask, [largest], -1, 255, cv2.FILLED)

    return clean_mask, (x, y, cw, ch)


def _sam_silhouette(img: np.ndarray):
    """
    Use Segment Anything Model for precise silhouette.
    Falls back to OpenCV if SAM not installed.
    """
    try:
        from segment_anything import sam_model_registry, SamAutomaticMaskGenerator
        import torch

        sam_checkpoint = "models/sam_vit_h_4b8939.pth"
        model_type = "vit_h"
        device = "cpu"  # Galaxy Book5 Pro — CPU or Intel Arc via OpenVINO

        if not Path(sam_checkpoint).exists():
            log.warning("SAM checkpoint not found, falling back to OpenCV silhouette")
            return _opencv_silhouette(img)

        sam = sam_model_registry[model_type](checkpoint=sam_checkpoint)
        sam.to(device=device)
        generator = SamAutomaticMaskGenerator(
            sam,
            points_per_side=16,
            pred_iou_thresh=0.86,
            stability_score_thresh=0.90,
            min_mask_region_area=1000,
        )
        img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        masks = generator.generate(img_rgb)

        if not masks:
            return _opencv_silhouette(img)

        h, w = img.shape[:2]
        center_x, center_y = w / 2, h / 2

        def score(m):
            # Prefer large masks near center
            seg = m["segmentation"]
            ys, xs = np.where(seg)
            if len(xs) == 0:
                return 0
            cx, cy = xs.mean(), ys.mean()
            dist = np.sqrt((cx - center_x)**2 + (cy - center_y)**2)
            return m["area"] / (dist + 1)

        best = max(masks, key=score)
        seg = best["segmentation"].astype(np.uint8) * 255
        x, y, bw, bh = cv2.boundingRect(seg)
        return seg, (x, y, bw, bh)

    except ImportError:
        log.info("segment_anything not installed — using OpenCV silhouette")
        return _opencv_silhouette(img)


# ─── Measurement helpers ──────────────────────────────────────────────────────

def _guess_view_angle(aspect_ratio: float, frontal_proxy: float) -> str:
    if aspect_ratio > 2.0:
        return "side_profile"
    elif aspect_ratio < 1.2 and frontal_proxy > 0.4:
        return "front"
    elif aspect_ratio < 1.4:
        return "rear"
    elif 1.4 <= aspect_ratio <= 2.0:
        return "three_quarter"
    return "unknown"


def _top_edge_points(mask: np.ndarray, bbox: tuple, n_samples: int = 80) -> list:
    """Sample the topmost filled pixel at n evenly spaced x-columns across the bbox."""
    x, y, w, h = bbox
    points = []
    for i in range(n_samples):
        col = x + int(i * w / n_samples)
        col = min(col, mask.shape[1] - 1)
        col_slice = mask[y:y+h, col]
        nonzero = np.where(col_slice > 0)[0]
        if len(nonzero) > 0:
            top_row = nonzero[0] + y
            points.append((col, top_row))
    return points


def _bottom_edge_points(mask: np.ndarray, bbox: tuple, n_samples: int = 80) -> list:
    x, y, w, h = bbox
    points = []
    for i in range(n_samples):
        col = x + int(i * w / n_samples)
        col = min(col, mask.shape[1] - 1)
        col_slice = mask[y:y+h, col]
        nonzero = np.where(col_slice > 0)[0]
        if len(nonzero) > 0:
            bot_row = nonzero[-1] + y
            points.append((col, bot_row))
    return points


def _fit_line_angle(points: list) -> float:
    """Fit a line through points and return its angle from horizontal in degrees."""
    if len(points) < 4:
        return 0.0
    pts = np.array(points, dtype=np.float32)
    vx, vy, _, _ = cv2.fitLine(pts, cv2.DIST_L2, 0, 0.01, 0.01)
    angle = float(np.degrees(np.arctan2(float(vy), float(vx))))
    return abs(angle)


def _measure_roofline_slope(mask: np.ndarray, bbox: tuple) -> float:
    """Slope of the top 40% of the vehicle (roofline)."""
    x, y, w, h = bbox
    # Use only the middle 60% of width (avoid hood rise and boot/trunk)
    trim_x = x + int(w * 0.2)
    trim_w = int(w * 0.6)
    trimmed_bbox = (trim_x, y, trim_w, h)
    top_pts = _top_edge_points(mask, trimmed_bbox, n_samples=60)
    return _fit_line_angle(top_pts)


def _measure_rear_taper(mask: np.ndarray, bbox: tuple) -> float:
    """Angle of roofline drop in the rear 30% of the car."""
    x, y, w, h = bbox
    rear_start = x + int(w * 0.65)
    rear_w = int(w * 0.32)
    rear_bbox = (rear_start, y, rear_w, h)
    top_pts = _top_edge_points(mask, rear_bbox, n_samples=40)
    return _fit_line_angle(top_pts)


def _measure_windshield_rake(mask: np.ndarray, bbox: tuple) -> float:
    """
    Estimate windshield rake from the front-third roofline drop to hood level.
    Higher angle from vertical = more raked = lower Cd.
    """
    x, y, w, h = bbox
    front_bbox = (x + int(w * 0.12), y, int(w * 0.28), h)
    top_pts = _top_edge_points(mask, front_bbox, n_samples=30)
    slope = _fit_line_angle(top_pts)
    # Convert roof slope to windshield rake from vertical
    # Empirical: rake ≈ 90 - slope for a typical A-pillar geometry
    rake = max(0.0, 90.0 - slope)
    return rake


def _measure_rear_overhang(mask: np.ndarray, bbox: tuple) -> float:
    """
    Rear overhang as fraction of total length.
    Approximated by finding where roof ends vs where car body ends.
    """
    x, y, w, h = bbox
    top_pts = _top_edge_points(mask, bbox, n_samples=100)
    if not top_pts:
        return 0.25

    # Find rightmost x where roof is "high" (above mid-height of car)
    mid_y = y + h * 0.45
    roof_pts = [(px, py) for px, py in top_pts if py < mid_y]
    if not roof_pts:
        return 0.25

    rightmost_roof_x = max(p[0] for p in roof_pts)
    car_right = x + w
    overhang_px = car_right - rightmost_roof_x
    return max(0.0, overhang_px / w)


def _measure_underbody_clearance(mask: np.ndarray, bbox: tuple, image_height: int) -> float:
    """
    Ground clearance proxy: gap between bottom of car silhouette and image bottom.
    Normalised by image height.
    """
    x, y, w, h = bbox
    bot_pts = _bottom_edge_points(mask, bbox, n_samples=60)
    if not bot_pts:
        return 0.08
    avg_bottom = np.mean([p[1] for p in bot_pts])
    clearance = (image_height - avg_bottom) / image_height
    return float(np.clip(clearance, 0, 0.4))


def _measure_contour_smoothness(mask: np.ndarray, bbox: tuple) -> float:
    """
    Smoothness index: ratio of convex hull perimeter to actual contour perimeter.
    1.0 = perfectly convex/smooth. Lower = more surface complexity.
    """
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not contours:
        return 0.7
    c = max(contours, key=cv2.contourArea)
    hull = cv2.convexHull(c)
    perimeter = cv2.arcLength(c, True)
    hull_perimeter = cv2.arcLength(hull, True)
    if perimeter == 0:
        return 0.7
    return float(np.clip(hull_perimeter / perimeter, 0, 1.0))


def _classify_body_flags(feat: GeometryFeatures):
    """Set boolean body-type flags from extracted metrics."""
    ar = feat.aspect_ratio
    rt = feat.rear_taper_angle_deg
    fc = feat.frontal_area_proxy
    uc = feat.underbody_clearance

    # Fastback: long, steep rear taper
    feat.is_likely_fastback = (ar > 2.4 and rt > 22)

    # SUV: tall frontal area, high ride height
    feat.is_likely_suv = (fc > 0.58 and uc > 0.10)

    # Sedan: moderate aspect, low rear taper (notchback)
    feat.is_likely_sedan = (2.0 < ar < 3.2 and rt < 20 and not feat.is_likely_suv)

    # Supercar: very long + wide, very low, aggressive rake
    feat.is_likely_supercar = (
        ar > 2.8 and
        feat.windshield_rake_deg > 58 and
        uc < 0.06
    )


# ─── Visualisation helper ─────────────────────────────────────────────────────

def draw_geometry_overlay(image_path: str, feat: GeometryFeatures, output_path: str):
    """
    Draw silhouette bbox + key measurement annotations on a copy of the image.
    Useful for debugging and UI display.
    """
    img = cv2.imread(str(image_path))
    if img is None:
        return

    x, y, w, h = feat.bbox_x, feat.bbox_y, feat.bbox_w, feat.bbox_h
    # Bounding box
    cv2.rectangle(img, (x, y), (x+w, y+h), (0, 255, 100), 2)

    font = cv2.FONT_HERSHEY_SIMPLEX
    labels = [
        f"AR: {feat.aspect_ratio:.2f}",
        f"Roof slope: {feat.roofline_slope_deg:.1f}deg",
        f"Rear taper: {feat.rear_taper_angle_deg:.1f}deg",
        f"Rake: {feat.windshield_rake_deg:.1f}deg",
        f"Quality: {feat.extraction_quality}",
    ]
    for i, label in enumerate(labels):
        cv2.putText(img, label, (10, 25 + i * 22), font, 0.55, (0, 230, 255), 1, cv2.LINE_AA)

    cv2.imwrite(str(output_path), img)
    log.info(f"Geometry overlay saved to {output_path}")


# ─── CLI entry point ──────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys, json
    if len(sys.argv) < 2:
        print("Usage: python geometry_extractor.py <image_path> [--sam] [--overlay]")
        sys.exit(1)

    path = sys.argv[1]
    use_sam = "--sam" in sys.argv
    do_overlay = "--overlay" in sys.argv

    feat = extract_geometry(path, use_sam=use_sam)

    print("\n" + "═" * 60)
    print("  AeroMind Geometry Extractor")
    print("═" * 60)
    print(feat.to_prompt_text())
    print("═" * 60)

    if do_overlay:
        out = Path(path).stem + "_geometry.jpg"
        draw_geometry_overlay(path, feat, out)
        print(f"Overlay saved: {out}")
