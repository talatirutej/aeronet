# contour_enhancements.py
# Copyright (c) 2026 Rutej Talati. All rights reserved.
# AeroNet — three additive enhancements to contour_analysis.py
#
# Changes in this version (smoothness tuning):
#   MODULE 2: min_feature_area raised 20→40, detail threshold raised 6→14px
#             boundary_band_px tightened 22→14 — less interior bleed
#             n_outside threshold raised 5→12 — fewer false positives
#   MODULE 3: samples_per_seg raised 60→100 — more sub-samples per segment
#             tension_smooth lowered 0.5→0.38 — flatter regions get smoother
#             tension_sharp  raised  0.05→0.0 — corners stay perfectly sharp
#             curvature_percentile raised 75→82 — raise bar for "sharp" corner
#             Pre-smooth: 2-pass Gaussian on raw pts before Catmull-Rom
#             Post-smooth: single Chaikin pass on dense output

from __future__ import annotations
import numpy as np
import cv2
from typing import Any


# ══════════════════════════════════════════════════════════════════
# MODULE 1 — WHEEL ARCH CUTOUTS
# ══════════════════════════════════════════════════════════════════

def detect_wheel_circles(
    mask: np.ndarray,
    image_h: int,
    image_w: int,
) -> list[dict[str, float]]:
    roi_top    = int(image_h * 0.45)
    mask_lower = mask[roi_top:, :]

    dist      = cv2.distanceTransform(mask_lower, cv2.DIST_L2, 5)
    dist_norm = cv2.normalize(dist, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)

    min_r = int(image_h * 0.08)
    max_r = int(image_h * 0.22)

    circles = cv2.HoughCircles(
        dist_norm,
        cv2.HOUGH_GRADIENT,
        dp=1.2,
        minDist=int(image_w * 0.25),
        param1=60,
        param2=18,
        minRadius=min_r,
        maxRadius=max_r,
    )

    if circles is None:
        return []

    circles = np.round(circles[0]).astype(int)
    results = []
    for (cx, cy, r) in circles:
        full_cy = cy + roi_top
        if full_cy < image_h * 0.50 or full_cy > image_h * 0.97:
            continue
        results.append({"cx": float(cx), "cy": float(full_cy), "r": float(r)})

    results.sort(key=lambda c: c["cx"])
    return results[:2]


def _fallback_arch_detection(
    mask: np.ndarray,
    image_h: int,
    image_w: int,
) -> list[dict[str, float]]:
    try:
        from scipy.ndimage import uniform_filter1d
    except ImportError:
        return []

    profile = np.zeros(image_w, dtype=int)
    for col in range(image_w):
        whites = np.where(mask[:, col] > 0)[0]
        profile[col] = whites[-1] if len(whites) > 0 else 0

    smoothed = uniform_filter1d(profile.astype(float), size=15)
    mean_y   = float(np.mean(smoothed[smoothed > 0])) if np.any(smoothed > 0) else image_h * 0.7

    concave = smoothed < (mean_y - image_h * 0.05)
    regions, in_region, start = [], False, 0
    for col in range(image_w):
        if concave[col] and not in_region:
            in_region, start = True, col
        elif not concave[col] and in_region:
            in_region = False
            regions.append((start, col - 1))

    if len(regions) < 2:
        return []

    wheels = []
    for (x0, x1) in regions[:2]:
        cx = (x0 + x1) / 2.0
        r  = (x1 - x0) / 2.0
        cy = mean_y + r * 0.3
        wheels.append({"cx": cx, "cy": cy, "r": r})
    return wheels


def punch_wheel_arches(
    mask: np.ndarray,
    wheels: list[dict[str, float]],
    expansion: float = 1.08,
) -> np.ndarray:
    arch_mask = mask.copy()
    for w in wheels:
        r = int(round(w["r"] * expansion))
        cv2.circle(arch_mask, (int(round(w["cx"])), int(round(w["cy"]))), r, 0, -1)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    return cv2.morphologyEx(arch_mask, cv2.MORPH_OPEN, kernel)


def contour_with_arches(
    original_mask: np.ndarray,
    image_h: int,
    image_w: int,
) -> dict[str, Any]:
    wheels = detect_wheel_circles(original_mask, image_h, image_w)
    if len(wheels) < 2:
        wheels = _fallback_arch_detection(original_mask, image_h, image_w)

    if not wheels:
        return {
            "wheels": [], "arch_mask": original_mask,
            "arch_pts": None, "arch_bbox_aspect": None,
            "warning": "wheel detection failed",
        }

    arch_mask = punch_wheel_arches(original_mask, wheels)
    contours, _ = cv2.findContours(arch_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not contours:
        return {
            "wheels": wheels, "arch_mask": arch_mask,
            "arch_pts": None, "arch_bbox_aspect": None,
            "warning": "arch contour trace failed",
        }

    main = max(contours, key=cv2.contourArea)
    pts  = main.reshape(-1, 2).astype(float)
    x, y, w, h = cv2.boundingRect(main)
    pts_norm = np.column_stack([
        (pts[:, 0] - x) / max(w, 1),
        (pts[:, 1] - y) / max(h, 1),
    ])

    return {
        "wheels":           wheels,
        "arch_mask":        arch_mask,
        "arch_pts":         pts_norm.tolist(),
        "arch_bbox_aspect": float(w) / max(h, 1),
        "warning":          None,
    }


# ══════════════════════════════════════════════════════════════════
# MODULE 2 — FINE FEATURE DETECTION (tuned)
# ══════════════════════════════════════════════════════════════════
#
# Key changes vs previous version:
#   - boundary_band_px: 22 → 14  (tighter band, less interior bleed)
#   - min_feature_area: 20 → 40  (ignore small reflection blobs)
#   - n_outside threshold: 5 → 12  (fewer false positives)
#   - detail threshold in _classify_feature: 6px → 14px
#   - mirror cx_norm threshold: 0.45 → 0.42 (stricter positioning)

def detect_fine_features(
    original_image: np.ndarray,
    sam_mask: np.ndarray,
    contour_pts: np.ndarray,
    scale_factor: float = 2.0,
    boundary_band_px: int = 14,    # TUNED: was 22
    min_feature_area: int = 40,    # TUNED: was 20
) -> dict[str, Any]:
    h, w = original_image.shape[:2]
    big_w, big_h = int(w * scale_factor), int(h * scale_factor)

    img_up = cv2.resize(original_image, (big_w, big_h), interpolation=cv2.INTER_LANCZOS4)
    gray   = cv2.cvtColor(img_up, cv2.COLOR_BGR2GRAY)
    clahe  = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
    gray   = clahe.apply(gray)

    otsu_thresh, _ = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    canny = cv2.Canny(gray, otsu_thresh * 0.4, otsu_thresh)

    mask_up    = cv2.resize(sam_mask, (big_w, big_h), interpolation=cv2.INTER_NEAREST)
    band_px_up = int(boundary_band_px * scale_factor)
    k          = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (band_px_up * 2 + 1,) * 2)
    dilated    = cv2.dilate(mask_up, k)
    eroded     = cv2.erode(mask_up, k)
    band       = cv2.bitwise_or(cv2.subtract(dilated, mask_up), cv2.subtract(mask_up, eroded))
    canny_masked = cv2.bitwise_and(canny, band)

    num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(
        canny_masked, connectivity=8
    )

    features, extra_pts = [], []
    M = cv2.moments(mask_up)
    mask_cx = M["m10"] / M["m00"] if M["m00"] else big_w / 2
    mask_cy = M["m01"] / M["m00"] if M["m00"] else big_h / 2

    for lid in range(1, num_labels):
        area = stats[lid, cv2.CC_STAT_AREA]
        if area < min_feature_area:
            continue

        comp = (labels == lid).astype(np.uint8) * 255
        n_outside = cv2.countNonZero(cv2.bitwise_and(comp, cv2.bitwise_not(mask_up)))
        if n_outside < 12:          # TUNED: was 5
            continue

        bw   = stats[lid, cv2.CC_STAT_WIDTH]
        bh_  = stats[lid, cv2.CC_STAT_HEIGHT]
        cxu  = float(centroids[lid][0])
        cyu  = float(centroids[lid][1])
        feat = _classify_feature(
            bw / max(bh_, 1),
            bw / scale_factor, bh_ / scale_factor,
            cxu / big_w, cyu / big_h,
        )
        if feat is None:
            continue

        features.append({
            "type": feat,
            "cx":   round(cxu / scale_factor, 1),
            "cy":   round(cyu / scale_factor, 1),
            "w":    round(bw / scale_factor, 1),
            "h":    round(bh_ / scale_factor, 1),
        })

        ys, xs = np.where(comp > 0)
        if len(xs):
            dists   = (xs - mask_cx) ** 2 + (ys - mask_cy) ** 2
            far_idx = int(np.argmax(dists))
            extra_pts.append(np.array([xs[far_idx] / scale_factor, ys[far_idx] / scale_factor]))

    merged_pts = _insert_feature_points(contour_pts, extra_pts) if extra_pts else contour_pts
    return {"merged_pts": merged_pts, "features": features}


def _classify_feature(
    aspect: float, width_px: float, height_px: float,
    cx_norm: float, cy_norm: float,
) -> str | None:
    # Antenna: tall thin rod, upper half of car
    if aspect < 0.22 and height_px > 10 and cy_norm < 0.50:
        return "antenna"
    # Mirror: wider than tall, front-upper quadrant only
    if 0.9 < aspect < 3.5 and width_px > 14 and cy_norm < 0.55 and cx_norm < 0.42:
        return "mirror"
    # Rear spoiler: wide and shallow, rear upper area
    if aspect > 3.5 and width_px > 24 and cy_norm < 0.60 and cx_norm > 0.60:
        return "spoiler"
    # Wiper: diagonal line, lower front
    if 0.4 < aspect < 2.0 and 8 < width_px < 50 and cy_norm > 0.35 and cx_norm < 0.55:
        return "wiper"
    # Generic detail — much stricter threshold to avoid bumper reflections
    if width_px > 14 and height_px > 14:     # TUNED: was >6
        return "detail"
    return None


def _insert_feature_points(
    contour_pts: np.ndarray,
    extra_pts: list[np.ndarray],
) -> np.ndarray:
    pts = contour_pts.copy()
    for ep in extra_pts:
        dists = np.linalg.norm(pts - ep, axis=1)
        i     = int(np.argmin(dists))
        pts = np.concatenate([pts[:i + 1], [ep], pts[i:]], axis=0)
    return pts


# ══════════════════════════════════════════════════════════════════
# MODULE 3 — CATMULL-ROM SPLINE SMOOTHING (tuned)
# ══════════════════════════════════════════════════════════════════
#
# Key changes vs previous version:
#   Pre-processing:
#     - 2-pass Gaussian smoothing on raw pixel pts before Catmull-Rom
#       This removes staircase artifacts from CHAIN_APPROX_NONE at
#       pixel level before the spline runs.
#     - Window size adapts to point density (min 5, max 15)
#
#   Catmull-Rom parameters:
#     - samples_per_seg: 60 → 100   (more sub-samples = smoother)
#     - tension_smooth:  0.5 → 0.38  (flatter regions smoother)
#     - tension_sharp:   0.05 → 0.0  (corners perfectly sharp)
#     - curvature_percentile: 75 → 82 (raise bar for "sharp")
#
#   Post-processing:
#     - Single Chaikin subdivision pass on the dense output
#       Chaikin is a corner-cutting algorithm: replaces each segment
#       with two points at 1/4 and 3/4 positions. One pass adds no
#       visible rounding but removes residual kinks.

def _gaussian_smooth_pts(pts: np.ndarray, passes: int = 2) -> np.ndarray:
    """
    Apply Gaussian smoothing to a closed polyline in pixel space.
    Preserves closure. window size is adaptive to point count.
    """
    n = len(pts)
    if n < 10:
        return pts

    # Adaptive window: ~0.3% of total points, odd, between 5 and 15
    win = max(5, min(15, int(n * 0.003) | 1))
    sigma = win / 3.0

    result = pts.copy()
    for _ in range(passes):
        # Wrap-around padding for closed contour
        padded = np.concatenate([result[-(win//2):], result, result[:win//2]], axis=0)
        x_smooth = np.convolve(padded[:, 0], np.ones(win)/win, mode='valid')
        y_smooth = np.convolve(padded[:, 1], np.ones(win)/win, mode='valid')
        result = np.column_stack([x_smooth[:n], y_smooth[:n]])

    return result


def _chaikin_pass(pts: np.ndarray) -> np.ndarray:
    """
    One pass of Chaikin's corner-cutting algorithm on a closed polyline.
    Replaces each edge (P_i, P_{i+1}) with two points at 1/4 and 3/4.
    Removes residual kinks without rounding genuine corners (because
    corners have high curvature tension=0 from Catmull-Rom already).
    """
    n = len(pts)
    q = pts[np.arange(n)]           # P_i
    r = pts[np.arange(1, n+1) % n]  # P_{i+1}
    pts_q = 0.75 * q + 0.25 * r
    pts_r = 0.25 * q + 0.75 * r
    # Interleave: q0, r0, q1, r1, ...
    result = np.empty((2*n, 2), dtype=float)
    result[0::2] = pts_q
    result[1::2] = pts_r
    return result


def _catmull_rom_seg(
    p0: np.ndarray, p1: np.ndarray, p2: np.ndarray, p3: np.ndarray,
    n: int, tau: float,
) -> np.ndarray:
    t  = np.linspace(0, 1, n, endpoint=False)
    t2 = t ** 2
    t3 = t ** 3
    m1 = tau * (p2 - p0)
    m2 = tau * (p3 - p1)
    h00 =  2*t3 - 3*t2 + 1
    h10 =    t3 - 2*t2 + t
    h01 = -2*t3 + 3*t2
    h11 =    t3 -   t2
    return np.outer(h00, p1) + np.outer(h10, m1) + np.outer(h01, p2) + np.outer(h11, m2)


def smooth_catmull_rom(
    pts: np.ndarray,
    n_out: int                = 2000,
    samples_per_seg: int      = 100,   # TUNED: was 60
    tension_smooth: float     = 0.38,  # TUNED: was 0.5
    tension_sharp: float      = 0.0,   # TUNED: was 0.05
    curvature_percentile: float = 82.0, # TUNED: was 75.0
) -> dict[str, Any]:
    pts = np.asarray(pts, dtype=float)
    n   = len(pts)

    if n < 4:
        return {
            "smooth_pts_dense": pts,
            "smooth_pts_2k":    pts,
            "curvature":        np.zeros(n),
            "sharp_indices":    [],
        }

    # ── Pre-smooth: remove staircase pixel artifacts ───────────────
    pts = _gaussian_smooth_pts(pts, passes=2)

    # ── Compute curvature ──────────────────────────────────────────
    dx    = np.gradient(pts[:, 0])
    dy    = np.gradient(pts[:, 1])
    ddx   = np.gradient(dx)
    ddy   = np.gradient(dy)
    kappa = np.abs(dx * ddy - dy * ddx) / np.maximum((dx**2 + dy**2)**1.5, 1e-6)

    k_thresh = np.percentile(kappa, curvature_percentile)

    # ── Catmull-Rom with adaptive tension ─────────────────────────
    parts = []
    for i in range(n):
        p0, p1 = pts[(i-1) % n], pts[i]
        p2, p3 = pts[(i+1) % n], pts[(i+2) % n]
        k_local = max(kappa[i], kappa[(i+1) % n])
        k_norm  = min(k_local / max(k_thresh, 1e-6), 1.0)
        tau     = tension_smooth - k_norm * (tension_smooth - tension_sharp)
        parts.append(_catmull_rom_seg(p0, p1, p2, p3, samples_per_seg, tau))

    dense = np.concatenate(parts, axis=0)

    # ── Post-smooth: single Chaikin pass to remove residual kinks ──
    dense = _chaikin_pass(dense)

    # ── Downsample for surrogate ───────────────────────────────────
    step   = max(1, len(dense) // n_out)
    pts_2k = dense[::step][:n_out]

    return {
        "smooth_pts_dense": dense,
        "smooth_pts_2k":    pts_2k,
        "curvature":        kappa,
        "sharp_indices":    np.where(kappa >= k_thresh)[0].tolist(),
    }


# ══════════════════════════════════════════════════════════════════
# INTEGRATION ENTRYPOINT
# ══════════════════════════════════════════════════════════════════

def run_all_enhancements(
    original_image: np.ndarray,
    sam_mask: np.ndarray,
    contour_pts: np.ndarray,
    image_h: int,
    image_w: int,
    view: str = "side",
) -> dict[str, Any]:
    out: dict[str, Any] = {
        "arch_pts": None, "arch_bbox_aspect": None,
        "wheels": [], "features": [],
        "smooth_pts_display": None, "smooth_pts_2k": None,
        "sharp_indices": [],
    }

    # Module 1: wheel arches (side view only)
    if view == "side":
        arch = contour_with_arches(sam_mask, image_h, image_w)
        out["wheels"]           = arch["wheels"]
        out["arch_pts"]         = arch["arch_pts"]
        out["arch_bbox_aspect"] = arch["arch_bbox_aspect"]
        working_mask = arch["arch_mask"]
    else:
        working_mask = sam_mask

    # Module 2: fine features
    fine = detect_fine_features(original_image, working_mask, contour_pts)
    out["features"] = fine["features"]
    merged = fine["merged_pts"]

    # Module 3: smooth
    smooth = smooth_catmull_rom(merged)
    out["smooth_pts_display"] = smooth["smooth_pts_dense"].tolist()
    out["smooth_pts_2k"]      = smooth["smooth_pts_2k"].tolist()
    out["sharp_indices"]      = smooth["sharp_indices"]

    return out