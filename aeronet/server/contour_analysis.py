# contour_analysis.py — Vehicle contour extraction from side-view images
# Pipeline:
#   1. Load image → resize to 800px wide
#   2. Background removal heuristic (GrabCut-lite: flood-fill from corners)
#   3. Grayscale → bilateral filter → Canny edge detection
#   4. Find largest external contour → simplify with Douglas-Peucker
#   5. Detect keypoints: wheels (Hough circles), roofline, bumpers, sill
#   6. Return JSON with normalised outline points + all keypoints
#
# Copyright (c) 2026 Rutej Talati. All rights reserved.

from __future__ import annotations

import io
import json
import math
from typing import Any

import cv2
import numpy as np
from PIL import Image


# ── Constants ─────────────────────────────────────────────────────────────────

TARGET_W    = 800       # resize width before analysis
CANNY_LOW   = 30        # Canny lower threshold
CANNY_HIGH  = 110       # Canny upper threshold
DP_EPSILON  = 0.004     # Douglas-Peucker simplification (fraction of perimeter)
MIN_CONTOUR = 0.08      # min fraction of image area for the vehicle contour


# ── Helpers ───────────────────────────────────────────────────────────────────

def _load(image_bytes: bytes) -> np.ndarray:
    """Load image bytes → BGR numpy array, resized to TARGET_W."""
    arr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        pil = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        img = cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)
    h, w = img.shape[:2]
    scale = TARGET_W / w
    img   = cv2.resize(img, (TARGET_W, int(h * scale)), interpolation=cv2.INTER_AREA)
    return img


def _remove_background(img: np.ndarray) -> np.ndarray:
    """
    Rough background mask using GrabCut seeded from image corners.
    Returns a binary mask: 255 = foreground (vehicle), 0 = background.
    """
    mask = np.zeros(img.shape[:2], np.uint8)
    # Seed the border as definite background
    border = 6
    h, w = img.shape[:2]
    cv2.rectangle(mask, (0, 0), (w-1, h-1), cv2.GC_BGD, border)
    # Run GrabCut with a generous foreground rect (middle 80% of image)
    fg_rect = (
        int(w * 0.05), int(h * 0.05),
        int(w * 0.90), int(h * 0.90),
    )
    bgd_model = np.zeros((1, 65), np.float64)
    fgd_model = np.zeros((1, 65), np.float64)
    try:
        cv2.grabCut(img, mask, fg_rect, bgd_model, fgd_model, 4, cv2.GC_INIT_WITH_RECT)
        fg_mask = np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)
    except Exception:
        # GrabCut can fail on unusual images — fall back to full-image mask
        fg_mask = np.ones(img.shape[:2], np.uint8) * 255
    # Morphological cleanup
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15))
    fg_mask = cv2.morphologyEx(fg_mask, cv2.MORPH_CLOSE, kernel, iterations=2)
    fg_mask = cv2.morphologyEx(fg_mask, cv2.MORPH_DILATE, kernel, iterations=1)
    return fg_mask


def _edge_image(img: np.ndarray, fg_mask: np.ndarray | None = None) -> np.ndarray:
    """
    Grayscale → bilateral denoise → Canny edges, masked to foreground.
    """
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    # Bilateral keeps edges sharp while smoothing flat areas
    smooth = cv2.bilateralFilter(gray, d=9, sigmaColor=75, sigmaSpace=75)
    # Adaptive thresholding to reduce background noise
    thresh = cv2.adaptiveThreshold(
        smooth, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 15, 3
    )
    edges = cv2.Canny(smooth, CANNY_LOW, CANNY_HIGH, apertureSize=3, L2gradient=True)
    # Combine Canny + adaptive threshold for robustness
    combined = cv2.bitwise_or(edges, thresh)
    # Apply foreground mask if available
    if fg_mask is not None:
        combined = cv2.bitwise_and(combined, fg_mask)
    # Close small gaps in the outline
    kernel = np.ones((3, 3), np.uint8)
    combined = cv2.morphologyEx(combined, cv2.MORPH_CLOSE, kernel, iterations=2)
    return combined


def _largest_contour(edges: np.ndarray, img_area: int) -> np.ndarray | None:
    """Find the largest external contour (the vehicle silhouette)."""
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    # Filter by minimum area
    valid = [c for c in contours if cv2.contourArea(c) > img_area * MIN_CONTOUR]
    if not valid:
        # Fall back to largest regardless
        valid = contours
    return max(valid, key=cv2.contourArea)


def _simplify_contour(contour: np.ndarray, perimeter: float) -> list[list[int]]:
    """Douglas-Peucker simplification → list of [x, y] points."""
    epsilon = DP_EPSILON * perimeter
    approx  = cv2.approxPolyDP(contour, epsilon, closed=True)
    return [[int(pt[0][0]), int(pt[0][1])] for pt in approx]


def _dense_outline(contour: np.ndarray, n_points: int = 300) -> list[list[int]]:
    """
    Resample the raw contour to exactly n_points evenly spaced points.
    Used for the smooth SVG path rendering.
    """
    pts = contour.reshape(-1, 2).astype(float)
    # Cumulative arc length
    diffs  = np.diff(pts, axis=0)
    dists  = np.sqrt((diffs ** 2).sum(axis=1))
    cumdist = np.concatenate([[0], np.cumsum(dists)])
    total  = cumdist[-1]
    if total < 1:
        return pts.astype(int).tolist()
    # Interpolate at equally spaced positions
    sample_dists = np.linspace(0, total, n_points)
    xs = np.interp(sample_dists, cumdist, pts[:, 0])
    ys = np.interp(sample_dists, cumdist, pts[:, 1])
    return [[int(x), int(y)] for x, y in zip(xs, ys)]


# ── Keypoint detection ────────────────────────────────────────────────────────

def _detect_wheels(img: np.ndarray, contour_bbox: tuple) -> list[dict]:
    """
    Hough circle transform to find wheels.
    Constrains search to the lower 40% of the vehicle bounding box.
    """
    h, w = img.shape[:2]
    bx, by, bw, bh = contour_bbox
    # Only search lower portion (wheels are at the bottom)
    lower_y = by + int(bh * 0.55)
    roi     = img[lower_y:by+bh, bx:bx+bw]
    if roi.size == 0:
        return []

    gray_roi = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
    blur_roi = cv2.GaussianBlur(gray_roi, (9, 9), 2)

    # Expected wheel radius: roughly 10-18% of vehicle width
    min_r = int(bw * 0.08)
    max_r = int(bw * 0.18)
    min_r = max(10, min_r)
    max_r = max(min_r + 5, max_r)

    circles = cv2.HoughCircles(
        blur_roi, cv2.HOUGH_GRADIENT, dp=1.2,
        minDist=int(bw * 0.25),
        param1=50, param2=30,
        minRadius=min_r, maxRadius=max_r,
    )

    wheels = []
    if circles is not None:
        circles = np.uint16(np.around(circles[0]))
        # Sort by x position (front wheel first)
        for (cx, cy, r) in sorted(circles[:2], key=lambda c: c[0]):
            wheels.append({
                "cx": int(bx + cx),
                "cy": int(lower_y + cy),
                "r":  int(r),
            })
    return wheels


def _detect_roofline(contour: np.ndarray, bbox: tuple) -> list[dict]:
    """
    Extract the roofline: points in the top 35% of the vehicle bbox.
    Returns them sorted left→right.
    """
    bx, by, bw, bh = bbox
    roof_thresh = by + int(bh * 0.35)
    pts = contour.reshape(-1, 2)
    roof_pts = pts[pts[:, 1] < roof_thresh]
    if len(roof_pts) == 0:
        return []
    # Sort by x
    roof_pts = roof_pts[roof_pts[:, 0].argsort()]
    # Downsample to at most 30 points
    step = max(1, len(roof_pts) // 30)
    return [{"x": int(p[0]), "y": int(p[1])} for p in roof_pts[::step]]


def _detect_bumpers(contour: np.ndarray, bbox: tuple) -> dict:
    """
    Front and rear bumper edge: leftmost and rightmost points in the
    middle vertical band (25-75% of height).
    """
    bx, by, bw, bh = bbox
    mid_lo = by + int(bh * 0.25)
    mid_hi = by + int(bh * 0.75)
    pts = contour.reshape(-1, 2)
    mid_pts = pts[(pts[:, 1] >= mid_lo) & (pts[:, 1] <= mid_hi)]
    if len(mid_pts) == 0:
        return {"front": None, "rear": None}
    front = mid_pts[mid_pts[:, 0].argmin()]
    rear  = mid_pts[mid_pts[:, 0].argmax()]
    return {
        "front": {"x": int(front[0]), "y": int(front[1])},
        "rear":  {"x": int(rear[0]),  "y": int(rear[1])},
    }


def _detect_sill(contour: np.ndarray, bbox: tuple) -> list[dict]:
    """
    Sill line: points between 65-85% height (lower body, above wheels).
    """
    bx, by, bw, bh = bbox
    lo = by + int(bh * 0.65)
    hi = by + int(bh * 0.85)
    pts = contour.reshape(-1, 2)
    sill = pts[(pts[:, 1] >= lo) & (pts[:, 1] <= hi)]
    if len(sill) == 0:
        return []
    sill = sill[sill[:, 0].argsort()]
    step = max(1, len(sill) // 20)
    return [{"x": int(p[0]), "y": int(p[1])} for p in sill[::step]]


def _detect_windscreen(contour: np.ndarray, bbox: tuple) -> dict:
    """
    Approximate windscreen base and top from contour points in the
    front-upper quadrant.
    """
    bx, by, bw, bh = bbox
    # Front half, upper portion
    front_x = bx + int(bw * 0.50)
    upper_y  = by + int(bh * 0.60)
    pts = contour.reshape(-1, 2)
    front_upper = pts[(pts[:, 0] < front_x) & (pts[:, 1] < upper_y)]
    if len(front_upper) < 2:
        return {}
    # A-pillar base: lowest point in front-upper zone
    base = front_upper[front_upper[:, 1].argmax()]
    # A-pillar top: highest point in front-upper zone
    top  = front_upper[front_upper[:, 1].argmin()]
    # Angle of A-pillar
    dy = base[1] - top[1]
    dx = base[0] - top[0]
    angle_deg = math.degrees(math.atan2(dy, abs(dx))) if abs(dx) > 2 else 80
    return {
        "base": {"x": int(base[0]), "y": int(base[1])},
        "top":  {"x": int(top[0]),  "y": int(top[1])},
        "a_pillar_angle_deg": round(angle_deg, 1),
    }


# ── Geometry metrics ──────────────────────────────────────────────────────────

def _geometry_metrics(
    contour: np.ndarray,
    bbox: tuple,
    wheels: list[dict],
    windscreen: dict,
) -> dict:
    """
    Compute the same geometry metrics as analyzeImageCanvas() but from
    real contour data instead of edge histograms.
    """
    bx, by, bw, bh = bbox
    pts = contour.reshape(-1, 2)

    # Hood / cabin / boot ratios from wheel positions
    if len(wheels) >= 2:
        w_front_x = wheels[0]["cx"]
        w_rear_x  = wheels[1]["cx"]
        total_len = bw
        hood_r  = (w_front_x - bx) / total_len
        cabin_r = (w_rear_x  - w_front_x) / total_len
        boot_r  = (bx + bw   - w_rear_x)  / total_len
    else:
        hood_r  = 0.28
        cabin_r = 0.44
        boot_r  = 0.28

    # Aspect ratio
    aspect = bw / bh if bh > 0 else 2.0

    # Rear drop: how much the rear roofline drops vs peak roof height
    top_y   = pts[:, 1].min()
    rear_pts = pts[pts[:, 0] > bx + bw * 0.75]
    rear_top = rear_pts[:, 1].min() if len(rear_pts) else top_y
    rear_drop = (rear_top - top_y) / bh

    # Cabin height ratio
    cabin_h = (by + bh - top_y) / bh

    # Ride height from wheel bottom vs contour bottom
    contour_bottom = pts[:, 1].max()
    if wheels:
        wheel_bottom = max(w["cy"] + w["r"] for w in wheels)
        ride_h = (wheel_bottom - contour_bottom) / bh if wheel_bottom > 0 else 0.07
    else:
        ride_h = 0.07

    # Windscreen angle
    ws_angle = windscreen.get("a_pillar_angle_deg", 58.0)

    # Body type classification (same rules as JS canvas analyser)
    if aspect > 2.4:
        body_type = "estate" if rear_drop > 0.15 else "suv"
    elif aspect > 1.85:
        if rear_drop > 0.24:
            body_type = "fastback"
        elif rear_drop > 0.12:
            body_type = "hatchback"
        else:
            body_type = "notchback"
    elif aspect < 1.55:
        body_type = "suv"
    else:
        body_type = "notchback"

    # Cd heuristic (same as JS)
    cd_base  = {"fastback":0.275,"notchback":0.298,"estate":0.310,
                "hatchback":0.290,"suv":0.380,"pickup":0.420}.get(body_type, 0.30)
    ws_bonus = max(0, (ws_angle - 55) * 0.0015)
    rd_bonus = rear_drop * 0.08
    cd       = round(min(0.48, max(0.20, cd_base + ws_bonus + rd_bonus)), 3)

    # w1/w2: wheel x positions normalised to bbox
    w1 = wheels[0]["cx"] / (bx + bw) if len(wheels) >= 1 else 0.22
    w2 = wheels[1]["cx"] / (bx + bw) if len(wheels) >= 2 else 0.76

    return {
        "bodyType":  body_type,
        "aspectRatio": round(aspect, 2),
        "hoodRatio":   round(max(0, hood_r),  2),
        "cabinRatio":  round(max(0, cabin_r), 2),
        "bootRatio":   round(max(0, boot_r),  2),
        "cabinH":      round(cabin_h, 2),
        "wsAngleDeg":  round(ws_angle, 1),
        "rearDrop":    round(rear_drop, 2),
        "rideH":       round(max(0, ride_h), 2),
        "w1":          round(w1, 3),
        "w2":          round(w2, 3),
        "Cd":          cd,
        "confidence":  0.88,   # contour-based confidence is higher than edge histogram
    }


# ── Normalisation ─────────────────────────────────────────────────────────────

def _normalise_points(pts: list, bbox: tuple, img_w: int, img_h: int) -> list:
    """
    Convert absolute pixel [x, y] to normalised [0..1, 0..1] within the
    vehicle bounding box.
    """
    bx, by, bw, bh = bbox
    return [
        [round((p[0] - bx) / bw, 4), round((p[1] - by) / bh, 4)]
        for p in pts
    ]


def _normalise_kp(kp: dict | None, bbox: tuple) -> dict | None:
    """Normalise a single {"x": .., "y": ..} keypoint."""
    if kp is None:
        return None
    bx, by, bw, bh = bbox
    return {
        "x": round((kp["x"] - bx) / bw, 4),
        "y": round((kp["y"] - by) / bh, 4),
    }


# ── Main entry point ──────────────────────────────────────────────────────────

def analyse_contour(image_bytes: bytes) -> dict[str, Any]:
    """
    Full pipeline. Returns:
    {
      outline_pts: [[nx, ny], ...]   # 250 pts, normalised to vehicle bbox
      simplified_pts: [[nx, ny], ...] # ~80 pts Douglas-Peucker simplification
      keypoints: {
        wheels: [{cx, cy, r, nx, ny}, ...],
        roofline: [{x, y, nx, ny}, ...],
        sill: [...],
        bumpers: {front: {x,y,nx,ny}, rear: ...},
        windscreen: {base, top, a_pillar_angle_deg},
      },
      bbox: {x, y, w, h},
      image_size: {w, h},
      geometry: { bodyType, aspectRatio, hoodRatio, ..., Cd, confidence }
    }
    """
    img       = _load(image_bytes)
    h, w      = img.shape[:2]
    img_area  = h * w

    # Background removal
    fg_mask   = _remove_background(img)

    # Edge detection
    edges     = _edge_image(img, fg_mask)

    # Main contour
    contour = _largest_contour(edges, img_area)
    if contour is None:
        raise ValueError("No vehicle contour found. Try a cleaner side-on photo.")

    perimeter  = cv2.arcLength(contour, True)
    bbox_raw   = cv2.boundingRect(contour)     # (x, y, w, h)

    # Validate bbox is sensible
    bx, by, bw, bh = bbox_raw
    if bw < 80 or bh < 40:
        raise ValueError("Detected region too small — is this a clear side-view photo?")

    # Dense outline (for smooth SVG rendering)
    dense       = _dense_outline(contour, n_points=250)
    simplified  = _simplify_contour(contour, perimeter)

    # Keypoint detection
    wheels      = _detect_wheels(img, bbox_raw)
    roofline    = _detect_roofline(contour, bbox_raw)
    sill        = _detect_sill(contour, bbox_raw)
    bumpers     = _detect_bumpers(contour, bbox_raw)
    windscreen  = _detect_windscreen(contour, bbox_raw)

    # Geometry metrics from real contour data
    geometry    = _geometry_metrics(contour, bbox_raw, wheels, windscreen)

    # Normalise everything to [0,1] within the vehicle bounding box
    norm_dense  = _normalise_points(dense, bbox_raw, w, h)
    norm_simple = _normalise_points([[p[0], p[1]] for p in simplified], bbox_raw, w, h)

    def norm_w(wh):
        return {**wh,
                "nx": round((wh["cx"] - bx) / bw, 4),
                "ny": round((wh["cy"] - by) / bh, 4)}

    def norm_kp_list(lst):
        return [{**p,
                 "nx": round((p["x"] - bx) / bw, 4),
                 "ny": round((p["y"] - by) / bh, 4)} for p in lst]

    norm_wheels    = [norm_w(wh) for wh in wheels]
    norm_roofline  = norm_kp_list(roofline)
    norm_sill      = norm_kp_list(sill)
    norm_bumpers   = {
        "front": {**bumpers["front"], "nx": round((bumpers["front"]["x"]-bx)/bw,4), "ny": round((bumpers["front"]["y"]-by)/bh,4)} if bumpers["front"] else None,
        "rear":  {**bumpers["rear"],  "nx": round((bumpers["rear"]["x"]-bx)/bw,4),  "ny": round((bumpers["rear"]["y"]-by)/bh,4)}  if bumpers["rear"]  else None,
    }
    norm_ws = {}
    if windscreen.get("base"):
        norm_ws = {
            "base": _normalise_kp(windscreen["base"], bbox_raw),
            "top":  _normalise_kp(windscreen["top"],  bbox_raw),
            "a_pillar_angle_deg": windscreen["a_pillar_angle_deg"],
        }

    return {
        "outline_pts":    norm_dense,
        "simplified_pts": norm_simple,
        "keypoints": {
            "wheels":     norm_wheels,
            "roofline":   norm_roofline,
            "sill":       norm_sill,
            "bumpers":    norm_bumpers,
            "windscreen": norm_ws,
        },
        "bbox": {"x": bx, "y": by, "w": bw, "h": bh},
        "image_size": {"w": w, "h": h},
        "geometry": geometry,
    }
