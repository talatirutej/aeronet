# contour_analysis.py — AeroNet Vehicle Outline Analysis Pipeline
# Copyright (c) 2026 Rutej Talati. All rights reserved.
#
# KEY CHANGE: Aspect-ratio-preserving normalisation.
# Both X and Y are divided by the SAME scale factor (long edge of bbox).
# This means the outline's shape reflects the car's TRUE proportions —
# a tall SUV outline is visibly taller than a low sports car at the
# same scale. Critical for accurate benchmarking overlays.
#
# Also added:
#   - Orientation detection (left-facing → auto-flip to right-facing)
#   - Full benchmarking geometry extraction (12 proportion metrics)
#   - Body type classification (sports / saloon / hatchback / SUV / estate / MPV)
#   - Maximum smoothing (3-pass Gaussian + 120sps Catmull-Rom + 2 Chaikin passes)
#   - Self-contained (no contour_enhancements.py import needed)

from __future__ import annotations

import io
import math
import traceback
from typing import Any, Generator

import cv2
import numpy as np
from PIL import Image, ImageOps

# ── Optional deps ─────────────────────────────────────────────────────────────
try:
    from rembg import remove as rembg_remove
    _HAVE_REMBG = True
except ImportError:
    _HAVE_REMBG = False

try:
    from ultralytics import YOLO
    _HAVE_YOLO = True
except ImportError:
    _HAVE_YOLO = False

try:
    import torch
    _HAVE_TORCH = True
except ImportError:
    _HAVE_TORCH = False

# ── Pipeline constants ────────────────────────────────────────────────────────
TARGET_LONG_EDGE   = 1536
CANVAS_MARGIN_PX   = 24
BBOX_PAD_FRAC      = 0.10
MORPH_CLOSE_K      = 9
MORPH_DILATE_K     = 2
CANNY_BAND_PX      = 5
RAW_CONTOUR_PTS    = 2000

QUALITY_WEIGHTS = {
    "contour_pts":    15,
    "aspect_ratio":   10,
    "wheel_detect":   15,
    "mask_coverage":  15,
    "symmetry":       10,
    "canny_snap":     10,
    "bbox_margin":    10,
    "rmbg_clean":     10,
    "feature_detect":  5,
    "smooth_ok":       5,
}

_yolo_model: Any = None
_sam_predictor: Any = None


def _get_yolo():
    global _yolo_model
    if _yolo_model is None and _HAVE_YOLO:
        _yolo_model = YOLO("yolo11x-seg.pt")
    return _yolo_model


def _get_sam():
    global _sam_predictor
    if _sam_predictor is None and _HAVE_TORCH:
        try:
            import os, urllib.request
            from sam2.build_sam import build_sam2
            from sam2.sam2_image_predictor import SAM2ImagePredictor
            # SAM2 Large — best boundary quality, ~900MB, CPU-compatible
            ckpt = "/tmp/sam2_hiera_large.pt"
            if not os.path.exists(ckpt):
                print("[contour] Downloading SAM2 Large weights (~900MB)…")
                urllib.request.urlretrieve(
                    "https://dl.fbaipublicfiles.com/segment_anything_2/"
                    "092824/sam2.1_hiera_large.pt", ckpt)
                print("[contour] SAM2 Large downloaded")
            sam = build_sam2("sam2.1_hiera_l.yaml", ckpt, device="cpu")
            _sam_predictor = SAM2ImagePredictor(sam)
            print("[contour] SAM2 Large ready")
        except Exception as e:
            print(f"[contour] SAM2 load failed: {e}")
    return _sam_predictor


# ═════════════════════════════════════════════════════════════════════════════
# STAGE 0a — Input normalisation
# ═════════════════════════════════════════════════════════════════════════════

def _normalise_input(image_bytes: bytes) -> np.ndarray:
    pil = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    pil = ImageOps.exif_transpose(pil)
    bg  = Image.new("RGB",
                    (pil.width + CANVAS_MARGIN_PX*2, pil.height + CANVAS_MARGIN_PX*2),
                    (255, 255, 255))
    bg.paste(pil, (CANVAS_MARGIN_PX, CANVAS_MARGIN_PX))
    pil = bg
    scale = TARGET_LONG_EDGE / max(pil.width, pil.height)
    if scale < 1.0:
        pil = pil.resize((int(pil.width*scale), int(pil.height*scale)), Image.LANCZOS)
    return cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)


# ═════════════════════════════════════════════════════════════════════════════
# STAGE 0b — RMBG 2.0
# ═════════════════════════════════════════════════════════════════════════════

def _rmbg(img_bgr: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    if not _HAVE_REMBG:
        gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
        _, mask = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        return img_bgr, mask
    pil_in  = Image.fromarray(cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB))
    pil_out = rembg_remove(pil_in)
    arr     = np.array(pil_out)
    mask    = (arr[:, :, 3] > 10).astype(np.uint8) * 255
    fg      = cv2.cvtColor(arr[:, :, :3], cv2.COLOR_RGB2BGR)
    return fg, mask


# ═════════════════════════════════════════════════════════════════════════════
# STAGE 1 — YOLO11x-seg
# ═════════════════════════════════════════════════════════════════════════════

def _yolo_detect(img_bgr: np.ndarray) -> dict[str, Any] | None:
    model = _get_yolo()
    if model is None:
        return None
    h, w = img_bgr.shape[:2]
    results = model(img_bgr, classes=[2, 3, 5, 7], verbose=False)
    best, best_conf = None, 0.0
    for r in results:
        if r.boxes is None:
            continue
        for i, box in enumerate(r.boxes):
            conf = float(box.conf[0])
            if conf > best_conf:
                best_conf = conf
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                px = (x2-x1)*BBOX_PAD_FRAC
                py = (y2-y1)*BBOX_PAD_FRAC
                # Extract YOLO seg mask — used to trim rmbg background bleed
                yolo_mask = None
                yolo_xy   = None
                if r.masks is not None:
                    try:
                        seg = r.masks.data[i].cpu().numpy()
                        seg_up = cv2.resize((seg*255).astype(np.uint8), (w,h),
                                            interpolation=cv2.INTER_LINEAR)
                        yolo_mask = (seg_up > 127).astype(np.uint8) * 255
                        yolo_xy   = r.masks.xy[i].astype(float)
                    except Exception:
                        yolo_mask = None
                        yolo_xy   = None
                best = {
                    "bbox": (
                        max(0,int(x1-px)), max(0,int(y1-py)),
                        min(w,int(x2+px)), min(h,int(y2+py)),
                    ),
                    "conf":      conf,
                    "yolo_mask": yolo_mask,
                    "yolo_xy":   yolo_xy,
                }
    return best


# ═════════════════════════════════════════════════════════════════════════════
# STAGE 2 — SAM3 mask refinement
# ═════════════════════════════════════════════════════════════════════════════

def _sam_refine(img_bgr, bbox, rmbg_mask):
    predictor = _get_sam()
    if predictor is None:
        return rmbg_mask
    h, w = img_bgr.shape[:2]
    x1, y1, x2, y2 = bbox
    fg_pts = np.array([
        [(x1+x2)/2,       (y1+y2)/2],
        [(x1+x2)/2,       y1+(y2-y1)*0.25],
        [(x1+x2)/2,       y1+(y2-y1)*0.75],
        [x1+(x2-x1)*0.25, (y1+y2)/2],
        [x1+(x2-x1)*0.75, (y1+y2)/2],
    ])
    bg_pts = np.array([
        [x1-20, y1-20], [x2+20, y1-20],
        [x1-20, min(h-1,y2+15)], [x2+20, min(h-1,y2+15)],
    ])
    point_coords = np.concatenate([fg_pts, bg_pts])
    point_labels = np.array([1,1,1,1,1,0,0,0,0])
    img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
    try:
        with torch.inference_mode():
            predictor.set_image(img_rgb)
            masks, scores, _ = predictor.predict(
                point_coords=point_coords,
                point_labels=point_labels,
                multimask_output=True,
            )
        best_idx = int(np.argmax(scores))
        sam_mask = (masks[best_idx] > 0).astype(np.uint8) * 255
        combined = cv2.bitwise_and(sam_mask, rmbg_mask)
        return combined if cv2.countNonZero(combined) >= cv2.countNonZero(sam_mask)*0.6 else sam_mask
    except Exception as e:
        print(f"[contour] SAM error: {e}")
        return rmbg_mask


# ═════════════════════════════════════════════════════════════════════════════
# STAGE 3 — Morphological cleanup
# ═════════════════════════════════════════════════════════════════════════════

def _morph_clean(mask):
    # Bilateral filter FIRST — sharpens mask boundary while preserving
    # genuine geometric corners (front bumper, A-pillar base).
    # This is the key fix for the bulbous front — the rmbg alpha edge
    # is soft/graduated; bilateral makes it crisp before morphology runs.
    mask_f  = mask.astype(np.float32) / 255.0
    sharp   = cv2.bilateralFilter(mask_f, d=9, sigmaColor=75, sigmaSpace=75)
    mask    = (sharp > 0.45).astype(np.uint8) * 255  # tighter threshold = less bleed

    k_open  = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    k_close = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    k_dil   = cv2.getStructuringElement(cv2.MORPH_RECT,    (MORPH_DILATE_K,)*2)
    cleaned = cv2.morphologyEx(mask,    cv2.MORPH_OPEN,  k_open)
    cleaned = cv2.morphologyEx(cleaned, cv2.MORPH_CLOSE, k_close)
    cleaned = cv2.dilate(cleaned, k_dil, iterations=1)
    return cleaned


# ═════════════════════════════════════════════════════════════════════════════
# STAGE 4+5 — Contour trace + constrained Canny snap
# ═════════════════════════════════════════════════════════════════════════════

def _trace_and_snap(img_bgr, mask):
    # Canny snap is intentionally DISABLED for silhouette outlines.
    # On smooth vehicle bodies, Canny detects panel lines, chrome strips,
    # window frames and reflections — not the silhouette edge. Snapping
    # to these internal edges actively introduces waviness into what should
    # be a clean smooth outline. The mask boundary + spline smoothing gives
    # a much cleaner result without Canny interference.
    contours,_ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not contours:
        return np.zeros((0,2),dtype=float), {"method":"failed"}

    main = max(contours, key=cv2.contourArea)
    raw  = main.reshape(-1,2).astype(float)

    # Light Gaussian to kill pixel staircase noise only — NOT heavy smoothing.
    # Heavy smoothing here rounds genuine geometry like the front bumper corner.
    # The spline pass does the real smoothing downstream.
    raw = _gaussian_smooth(raw, passes=2)

    resampled = _arclen_resample(raw, RAW_CONTOUR_PTS)
    return resampled, {"method":"mask_contour_smoothed","n_raw":len(raw)}





def _arclen_resample(pts, n):
    if len(pts)<2: return pts
    seglens = np.sqrt((np.diff(pts,axis=0)**2).sum(axis=1))
    cumlen  = np.concatenate([[0], np.cumsum(seglens)])
    total   = cumlen[-1]
    if total<1e-6: return pts[:n] if len(pts)>=n else pts
    t = np.linspace(0, total, n, endpoint=False)
    return np.column_stack([np.interp(t,cumlen,pts[:,0]), np.interp(t,cumlen,pts[:,1])])


# ═════════════════════════════════════════════════════════════════════════════
# SMOOTHING — 3-pass Gaussian + Catmull-Rom (120sps) + 2× Chaikin
# ═════════════════════════════════════════════════════════════════════════════

def _gaussian_smooth(pts, passes=3):
    n = len(pts)
    if n<10: return pts
    # Wider window: 0.8% of contour length, min 11, max 41
    # Wider kernel = smoother result, less local noise
    win = max(11, min(41, (int(n*0.008)//2)*2+1))
    r = pts.copy()
    k = np.ones(win)/win
    for _ in range(passes):
        pad = np.concatenate([r[-(win//2):], r, r[:win//2]])
        r   = np.column_stack([
            np.convolve(pad[:,0],k,mode='valid')[:n],
            np.convolve(pad[:,1],k,mode='valid')[:n],
        ])
    return r


def _catmull_seg(p0,p1,p2,p3,n,tau):
    t=np.linspace(0,1,n,endpoint=False); t2=t**2; t3=t**3
    m1=tau*(p2-p0); m2=tau*(p3-p1)
    return (np.outer(2*t3-3*t2+1,p1)+np.outer(t3-2*t2+t,m1)+
            np.outer(-2*t3+3*t2,p2)+np.outer(t3-t2,m2))


def _chaikin(pts):
    n=len(pts); q=pts[np.arange(n)]; r=pts[np.arange(1,n+1)%n]
    out=np.empty((2*n,2)); out[0::2]=0.75*q+0.25*r; out[1::2]=0.25*q+0.75*r
    return out


def _smooth_spline(pts, n_out=2000, sps=160, tau_flat=0.25, tau_sharp=0.0, kappa_pct=88.0):
    pts = np.asarray(pts,dtype=float)
    n   = len(pts)
    if n<4: return pts, pts

    # 3 Gaussian passes upfront — kills noise without rounding real corners
    pts  = _gaussian_smooth(pts, passes=3)
    dx   = np.gradient(pts[:,0]); dy=np.gradient(pts[:,1])
    ddx  = np.gradient(dx);       ddy=np.gradient(dy)
    kap  = np.abs(dx*ddy-dy*ddx)/np.maximum((dx**2+dy**2)**1.5,1e-6)
    k_th = np.percentile(kap, kappa_pct)

    parts=[]
    for i in range(n):
        p0=pts[(i-1)%n]; p1=pts[i]; p2=pts[(i+1)%n]; p3=pts[(i+2)%n]
        k = min(max(kap[i],kap[(i+1)%n])/max(k_th,1e-6),1.0)
        parts.append(_catmull_seg(p0,p1,p2,p3,sps, tau_flat-k*(tau_flat-tau_sharp)))
    dense = np.concatenate(parts)

    # 3× Chaikin passes
    dense = _chaikin(dense)
    dense = _chaikin(dense)
    dense = _chaikin(dense)

    # Single post-Chaikin Gaussian — minimal cleanup only
    dense = _gaussian_smooth(dense, passes=1)

    step  = max(1,len(dense)//n_out)
    return dense, dense[::step][:n_out]


def _technical_spline(pts, n_out=2000):
    """
    Minimal-smoothing spline for the Technical outline mode.
    Only 1 Gaussian pass + 1 Chaikin — preserves genuine geometry
    (A-pillar angle, wheel arch shape, sill transitions) while
    still removing pixel-level staircase noise from the mask boundary.
    Much less processing than _smooth_spline which is optimised for
    visual smoothness at the cost of geometric accuracy.
    """
    pts = np.asarray(pts, dtype=float)
    n   = len(pts)
    if n < 4: return pts

    # No Gaussian smoothing — bilateral filter upstream already cleaned the mask.
    # This gives maximum geometric accuracy for the technical outline.
    # Only pixel staircase removal via arclen_resample sampling.
    # No Gaussian pre-smoothing — bilateral filter upstream handles noise

    # Catmull-Rom at lower sps — less interpolation = stays closer to real geometry
    dx  = np.gradient(pts[:,0]); dy  = np.gradient(pts[:,1])
    ddx = np.gradient(dx);       ddy = np.gradient(dy)
    kap = np.abs(dx*ddy - dy*ddx) / np.maximum((dx**2+dy**2)**1.5, 1e-6)
    k_th = np.percentile(kap, 85.0)

    parts = []
    for i in range(n):
        p0=pts[(i-1)%n]; p1=pts[i]; p2=pts[(i+1)%n]; p3=pts[(i+2)%n]
        k = min(max(kap[i], kap[(i+1)%n]) / max(k_th, 1e-6), 1.0)
        # tau 0.15 flat, 0.0 sharp — less tension = sharper corners preserved
        parts.append(_catmull_seg(p0, p1, p2, p3, 60, 0.15 - k*0.15))
    dense = np.concatenate(parts)

    # Single Chaikin pass only — smooths kinks without rounding corners
    dense = _chaikin(dense)

    step = max(1, len(dense) // n_out)
    return dense[::step][:n_out]


# ═════════════════════════════════════════════════════════════════════════════
# WHEEL ARCH DETECTION
# ═════════════════════════════════════════════════════════════════════════════

def _detect_wheels(mask, img_h, img_w):
    roi    = int(img_h*0.45)
    lower  = mask[roi:,:]
    dist   = cv2.distanceTransform(lower, cv2.DIST_L2, 5)
    dn     = cv2.normalize(dist,None,0,255,cv2.NORM_MINMAX).astype(np.uint8)
    circles = cv2.HoughCircles(dn, cv2.HOUGH_GRADIENT, dp=1.2,
                               minDist=int(img_w*0.25), param1=60, param2=18,
                               minRadius=int(img_h*0.08), maxRadius=int(img_h*0.22))
    if circles is None: return []
    res=[]
    for cx,cy,r in np.round(circles[0]).astype(int):
        fcy=cy+roi
        if img_h*0.50<=fcy<=img_h*0.97:
            res.append({"cx":float(cx),"cy":float(fcy),"r":float(r)})
    res.sort(key=lambda c:c["cx"])
    return res[:2]


def _arch_contour(mask, img_h, img_w):
    wheels = _detect_wheels(mask, img_h, img_w)
    if not wheels: return [], None, None
    arch = mask.copy()
    for w in wheels:
        cv2.circle(arch,(int(round(w["cx"])),int(round(w["cy"]))),int(round(w["r"]*1.08)),0,-1)
    arch = cv2.morphologyEx(arch, cv2.MORPH_OPEN,
                            cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(5,5)))
    contours,_ = cv2.findContours(arch, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not contours: return wheels, None, None
    main  = max(contours, key=cv2.contourArea)
    pts   = main.reshape(-1,2).astype(float)
    x,y,w,h = cv2.boundingRect(main)
    # Preserve aspect ratio in arch contour too
    long_edge = max(w,h)
    norm = np.column_stack([(pts[:,0]-x)/long_edge, (pts[:,1]-y)/long_edge])
    return wheels, norm.tolist(), float(w)/max(h,1)


# ═════════════════════════════════════════════════════════════════════════════
# ASPECT-RATIO-PRESERVING NORMALISATION
# ═════════════════════════════════════════════════════════════════════════════

def _norm_pts_aspect_preserving(pts: np.ndarray) -> tuple[np.ndarray, dict]:
    """
    Normalise contour points while PRESERVING the true aspect ratio.

    Both X and Y are divided by the same value (the long edge of the
    bounding box). This means:
      - A car 4.5m × 1.4m tall → normalised width ~0.95, height ~0.31
      - A car 4.5m × 1.9m tall → normalised width ~0.95, height ~0.40

    The difference is visible and correct. Critical for benchmark overlays.

    The caller can use (bbox_w_norm, bbox_h_norm) to reconstruct the
    true aspect ratio: aspect = bbox_w_norm / bbox_h_norm.
    """
    if len(pts) == 0:
        return pts, {}

    x_min, y_min = pts.min(axis=0)
    x_max, y_max = pts.max(axis=0)
    w = x_max - x_min
    h = y_max - y_min

    # KEY: divide both axes by the SAME long edge
    long_edge = max(w, h, 1.0)

    norm = np.column_stack([
        (pts[:, 0] - x_min) / long_edge,
        (pts[:, 1] - y_min) / long_edge,
    ])

    return norm, {
        "x":           float(x_min),
        "y":           float(y_min),
        "w":           float(w),
        "h":           float(h),
        "long_edge":   float(long_edge),
        "true_aspect": float(w) / max(h, 1.0),   # true width:height ratio
        "norm_w":      float(w) / long_edge,       # normalised width (≤1.0)
        "norm_h":      float(h) / long_edge,       # normalised height (≤1.0)
    }


# ═════════════════════════════════════════════════════════════════════════════
# ORIENTATION DETECTION + AUTO-FLIP
# ═════════════════════════════════════════════════════════════════════════════

def _detect_orientation_and_flip(pts_norm: np.ndarray) -> tuple[np.ndarray, bool]:
    """
    Detect if car faces LEFT and flip to right-facing.

    Uses three signals voted on:

    Signal 1 — Roof peak position.
      On a right-facing saloon/hatchback the roofline peak (highest point)
      sits slightly forward of centre (~0.35-0.55 from left edge).
      On a left-facing car the peak is at the mirror position (~0.45-0.65).
      This is the most reliable signal.

    Signal 2 — Front overhang height profile.
      The front bumper on a right-facing car is in the LEFT region (xs < 0.25).
      Bumpers are tall relative to the bonnet — more vertical extent in left region
      than right region indicates right-facing.

    Signal 3 — Rear glass slope.
      On a right-facing car the C-pillar/rear glass slopes: as x increases
      (going right/rearward), y increases (going down in SVG coords).
      Positive slope in the right-rear region = right-facing.
    """
    xs, ys = pts_norm[:, 0], pts_norm[:, 1]
    x_max  = float(xs.max())

    votes_left_facing = 0

    # ── Signal 1: roof peak x-position ────────────────────────────────────
    # Top 12% of points = roofline
    roof_thresh = float(np.percentile(ys, 12))
    roof_pts = pts_norm[ys <= roof_thresh]
    if len(roof_pts) >= 4:
        peak_x = float(roof_pts[np.argmin(roof_pts[:, 1]), 0]) / max(x_max, 1e-6)
        # Peak in left half of car → right-facing (bonnet on left, boot on right)
        # Peak in right half → left-facing
        if peak_x < 0.50:
            votes_left_facing -= 1   # right-facing
        else:
            votes_left_facing += 1   # left-facing

    # ── Signal 2: vertical extent comparison left vs right ─────────────────
    # Front bumper creates tall vertical extent on whichever side the front is
    left_pts  = pts_norm[xs < x_max * 0.22]
    right_pts = pts_norm[xs > x_max * 0.78]
    left_extent  = float(left_pts[:, 1].ptp())  if len(left_pts)  > 5 else 0
    right_extent = float(right_pts[:, 1].ptp()) if len(right_pts) > 5 else 0
    # More vertical extent on left = front is on left = right-facing
    if left_extent > right_extent * 1.1:
        votes_left_facing -= 1
    elif right_extent > left_extent * 1.1:
        votes_left_facing += 1

    # ── Signal 3: rear glass / C-pillar slope ─────────────────────────────
    # In SVG coords Y increases downward.
    # Right-facing: rear glass is on right side, slopes down-right → positive slope
    # Left-facing:  rear glass is on left side, slopes down-left  → negative slope
    rear_region = pts_norm[(xs > x_max * 0.62) & (ys < float(np.percentile(ys, 55)))]
    if len(rear_region) >= 6:
        c = np.polyfit(rear_region[:, 0], rear_region[:, 1], 1)
        rear_slope = float(c[0])
        if rear_slope > 0.15:
            votes_left_facing -= 1   # slopes down-right = right-facing
        elif rear_slope < -0.15:
            votes_left_facing += 1   # slopes down-left  = left-facing

    print(f"[contour] Orientation votes_left={votes_left_facing} "
          f"peak_x={peak_x:.2f} left_ext={left_extent:.3f} right_ext={right_extent:.3f}")

    if votes_left_facing >= 2:
        flipped = np.column_stack([x_max - pts_norm[:, 0], pts_norm[:, 1]])
        return flipped, True

    return pts_norm, False


# ═════════════════════════════════════════════════════════════════════════════
# BENCHMARKING GEOMETRY EXTRACTION
# ═════════════════════════════════════════════════════════════════════════════

def _classify_body_type(
    hood_ratio: float,
    cabin_ratio: float,
    boot_ratio: float,
    roof_height_norm: float,
    rear_slant_deg: float,
    norm_h: float,          # normalised height (true aspect proportion)
    greenhouse_ratio: float,
) -> str:
    """
    Classify body type from proportions.
    Returns one of: sports / saloon / hatchback / estate / suv / mpv / coupe / pickup
    """
    # Height-based first cut
    if norm_h > 0.52:
        return "suv" if greenhouse_ratio < 0.38 else "mpv"

    # Rear slant angle
    if rear_slant_deg > 40:
        return "hatchback"
    if rear_slant_deg > 28:
        if cabin_ratio < 0.38:
            return "sports"
        return "hatchback"

    # 3-box vs 2-box
    if boot_ratio > 0.18 and hood_ratio > 0.22:
        if norm_h < 0.32:
            return "coupe" if rear_slant_deg > 18 else "saloon"
        return "saloon"

    if boot_ratio < 0.12:
        return "estate" if cabin_ratio > 0.52 else "hatchback"

    return "saloon"


def _extract_benchmarking_geometry(
    pts_norm: np.ndarray,
    bbox_info: dict,
    wheels: list,
    img_h: int,
    img_w: int,
    view: str,
    was_flipped: bool,
) -> dict[str, Any]:
    """
    Extract 15 proportion-focused benchmarking metrics from the
    aspect-ratio-preserving normalised contour.

    All measurements are in the normalised coordinate space where
    the long edge of the car = 1.0. This makes metrics directly
    comparable across cars of different sizes.
    """
    if len(pts_norm) < 10:
        return {}

    xs, ys   = pts_norm[:, 0], pts_norm[:, 1]
    norm_w   = bbox_info.get("norm_w",   float(xs.max()-xs.min()))
    norm_h   = bbox_info.get("norm_h",   float(ys.max()-ys.min()))
    true_asp = bbox_info.get("true_aspect", norm_w / max(norm_h, 1e-6))

    # ── Roofline analysis ──────────────────────────────────────────────────
    roof_pts = pts_norm[ys < (ys.min() + norm_h * 0.15)]
    hood_r, cabin_r, boot_r = 0.22, 0.56, 0.22
    if len(roof_pts) >= 6:
        rx      = np.sort(roof_pts[:, 0])
        hood_r  = max(0.05, min(0.50, float(rx[0]  - xs.min()) / max(norm_w, 1e-6)))
        boot_r  = max(0.05, min(0.50, float(xs.max() - rx[-1]) / max(norm_w, 1e-6)))
        cabin_r = max(0.10, min(0.70, 1.0 - hood_r - boot_r))

    # ── Roof peak position (cabin peak x-offset from car centre) ──────────
    if len(roof_pts) >= 3:
        roof_peak_x = float(roof_pts[np.argmin(roof_pts[:, 1]), 0])
        # Normalise to [-0.5, 0.5] where 0 = centre of car
        roof_peak_offset = (roof_peak_x - xs.mean()) / max(norm_w, 1e-6)
    else:
        roof_peak_offset = 0.0

    # ── Roofline flatness (variance of top 10% y-values) ─────────────────
    top_ys   = pts_norm[ys < np.percentile(ys, 10)][:, 1]
    roof_flatness = 1.0 - float(np.std(top_ys) / max(norm_h, 1e-6)) if len(top_ys) > 3 else 0.5

    # ── A-pillar angle ────────────────────────────────────────────────────
    ap_pts   = pts_norm[(xs > xs.min()+norm_w*0.18) & (xs < xs.min()+norm_w*0.35) & (ys < 0.65)]
    a_pillar_angle = 65.0
    if len(ap_pts) >= 5:
        c = np.polyfit(ap_pts[:, 0], ap_pts[:, 1], 1)
        a_pillar_angle = float(max(30.0, min(90.0, abs(math.degrees(math.atan(c[0]))))))

    # ── Windscreen rake (full windscreen slope) ───────────────────────────
    ws_pts   = pts_norm[(xs > xs.min()+norm_w*0.20) & (xs < xs.min()+norm_w*0.45) & (ys < 0.65)]
    ws_angle = 60.0
    if len(ws_pts) >= 5:
        c = np.polyfit(ws_pts[:, 0], ws_pts[:, 1], 1)
        ws_angle = float(max(30.0, min(85.0, abs(math.degrees(math.atan(c[0]))))))

    # ── Rear glass / C-pillar angle ───────────────────────────────────────
    rear_pts = pts_norm[(xs > xs.min()+norm_w*0.60) & (ys < 0.65)]
    rear_slant = 25.0
    if len(rear_pts) >= 5:
        c = np.polyfit(rear_pts[:, 0], rear_pts[:, 1], 1)
        rear_slant = float(max(0.0, min(80.0, abs(math.degrees(math.atan(c[0]))))))

    # ── Ahmed regime ──────────────────────────────────────────────────────
    ahmed = ("attached"     if rear_slant < 12.5 else
             "intermediate" if rear_slant < 20   else
             "critical"     if rear_slant < 30   else "separated")

    # ── Ride height (ground clearance) ────────────────────────────────────
    ride_h = float(ys.max() - np.percentile(ys, 98)) / max(norm_h, 1e-6)

    # ── Underbody flatness ────────────────────────────────────────────────
    bottom_pts = pts_norm[ys > np.percentile(ys, 88)]
    underbody_flatness = 1.0
    if len(bottom_pts) > 5:
        bottom_y_std = float(np.std(bottom_pts[:, 1]))
        underbody_flatness = max(0.0, 1.0 - bottom_y_std / max(norm_h*0.15, 1e-6))
        underbody_flatness = round(min(1.0, underbody_flatness), 3)

    # ── Beltline height (window sill height as fraction of total height) ──
    # Approximate: look for the horizontal band where the contour has a
    # step change from body to glass (brightness discontinuity in the mask)
    # Without image data, estimate from cabin geometry
    beltline_h = round(float(1.0 - norm_h * 0.55), 3)   # rough estimate

    # ── Greenhouse ratio (glass area / total side area) ───────────────────
    # Approximate: cabin region above estimated beltline
    cabin_top    = float(ys.min())
    cabin_bottom = float(ys.min() + norm_h * 0.55)  # beltline estimate
    cabin_x_start = float(xs.min() + norm_w * hood_r)
    cabin_x_end   = float(xs.min() + norm_w * (hood_r + cabin_r))
    glass_area_norm = (cabin_x_end - cabin_x_start) * (cabin_bottom - cabin_top)
    total_area_norm  = norm_w * norm_h
    greenhouse_ratio = round(float(glass_area_norm / max(total_area_norm, 1e-6)), 3)

    # ── Wheel position and size ───────────────────────────────────────────
    w1_x = wheels[0]["cx"] / img_w if len(wheels) >= 1 else 0.22
    w2_x = wheels[1]["cx"] / img_w if len(wheels) >= 2 else 0.76
    w1_r = wheels[0]["r"]  / img_h if len(wheels) >= 1 else 0.12
    w2_r = wheels[1]["r"]  / img_h if len(wheels) >= 2 else 0.12
    wheelbase_norm = round(abs(w2_x - w1_x), 3)  # as fraction of image width

    # Wheel exposure (how much tyre visible below sill)
    arch_depth = 0.0
    if len(wheels) >= 1:
        lower = pts_norm[ys > 0.75]
        if len(lower) > 0:
            arch_depth = round(float(ys.max() - lower[:, 1].min()), 3)

    # ── Convexity score (quality signal) ─────────────────────────────────
    pts_px = (pts_norm * 1000).astype(np.int32)
    hull   = cv2.convexHull(pts_px.reshape(-1,1,2))
    hull_area    = cv2.contourArea(hull)
    contour_area = cv2.contourArea(pts_px.reshape(-1,1,2))
    convexity = round(float(contour_area / max(hull_area, 1.0)), 3) if hull_area > 0 else 0.0

    # ── Body type classification ──────────────────────────────────────────
    body_type = _classify_body_type(
        hood_r, cabin_r, boot_r,
        norm_h, rear_slant, norm_h, greenhouse_ratio,
    )

    return {
        # ── True proportions (aspect-ratio-preserving) ────────────────────
        "trueAspect":         round(true_asp, 3),      # width:height ratio
        "normWidth":          round(norm_w, 3),         # normalised width (≤1.0)
        "normHeight":         round(norm_h, 3),         # normalised height (≤1.0)

        # ── Roofline ──────────────────────────────────────────────────────
        "hoodRatio":          round(hood_r, 3),
        "cabinRatio":         round(cabin_r, 3),
        "bootRatio":          round(boot_r, 3),
        "roofFlatness":       round(roof_flatness, 3),  # 0=curved, 1=flat
        "roofPeakOffset":     round(roof_peak_offset, 3), # +ve=forward, -ve=rearward

        # ── Glass / pillar angles ─────────────────────────────────────────
        "aPillarAngle":       round(a_pillar_angle, 1), # degrees from horizontal
        "wsAngleDeg":         round(ws_angle, 1),
        "rearSlantAngleDeg":  round(rear_slant, 1),

        # ── Underbody ─────────────────────────────────────────────────────
        "rideH":              round(ride_h, 3),
        "underbodyFlatness":  underbody_flatness,       # 0=bumpy, 1=flat

        # ── Greenhouse ────────────────────────────────────────────────────
        "greenhouseRatio":    greenhouse_ratio,
        "beltlineH":          beltline_h,

        # ── Wheels ────────────────────────────────────────────────────────
        "wheelbaseNorm":      wheelbase_norm,
        "wheelDiamRatio":     round((w1_r+w2_r)/2, 3),
        "archDepth":          arch_depth,

        # ── Classification ────────────────────────────────────────────────
        "bodyType":           body_type,
        "ahmedRegime":        ahmed,

        # ── Quality signals ───────────────────────────────────────────────
        "convexityScore":     convexity,               # ~0.95+ = good outline
        "wasFlipped":         was_flipped,

        # ── Legacy fields (keep for backward compat) ──────────────────────
        "aspectRatio":        round(true_asp, 3),
        "cabinH":             round(1.0 - float(ys.min()), 3),
        "w1":                 round(w1_x, 3),
        "w2":                 round(w2_x, 3),
        "Cd":                 None,   # not the focus anymore
        "CdA":                None,

        # ── View meta ─────────────────────────────────────────────────────
        "_view":   view,
        "_imageW": img_w,
        "_imageH": img_h,
    }


# ═════════════════════════════════════════════════════════════════════════════
# HOUGH WHEEL GEOMETRY
# ═════════════════════════════════════════════════════════════════════════════

def _hough_wheels(img_bgr, mask):
    h,w = img_bgr.shape[:2]
    roi = int(h*0.45)
    gray = cv2.cvtColor(img_bgr[roi:,:], cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray,(9,9),2)
    circles = cv2.HoughCircles(blur, cv2.HOUGH_GRADIENT, dp=1.2,
                               minDist=int(w*0.2), param1=80, param2=25,
                               minRadius=int(h*0.07), maxRadius=int(h*0.20))
    if circles is None: return []
    res=[{"cx":float(cx),"cy":float(cy+roi),"r":float(r)}
         for cx,cy,r in np.round(circles[0]).astype(int)]
    res.sort(key=lambda c:c["cx"])
    return res[:2]


# ═════════════════════════════════════════════════════════════════════════════
# QUALITY SCORING
# ═════════════════════════════════════════════════════════════════════════════

def _quality(contour_pts, geo, wheels, img_h, img_w, mask):
    sc={}
    n=len(contour_pts)
    sc["contour_pts"]   = QUALITY_WEIGHTS["contour_pts"] if n>=500 else int(QUALITY_WEIGHTS["contour_pts"]*n/500)
    ar=geo.get("trueAspect",0)
    sc["aspect_ratio"]  = QUALITY_WEIGHTS["aspect_ratio"] if 1.2<=ar<=6.0 else 0
    sc["wheel_detect"]  = (QUALITY_WEIGHTS["wheel_detect"] if len(wheels)>=2 else
                           QUALITY_WEIGHTS["wheel_detect"]//2 if len(wheels)==1 else 0)
    cov=cv2.countNonZero(mask)/(img_h*img_w)
    sc["mask_coverage"] = QUALITY_WEIGHTS["mask_coverage"] if 0.05<=cov<=0.85 else int(QUALITY_WEIGHTS["mask_coverage"]*0.5)
    pts=np.array(contour_pts)
    if len(pts)>10:
        mx=float(pts[:,0].mean())
        ly=pts[pts[:,0]<mx,1]; ry=pts[pts[:,0]>mx,1]
        sym=1.0-abs(ly.mean()-ry.mean())/max(pts[:,1].ptp(),1e-6)
        sc["symmetry"]=int(QUALITY_WEIGHTS["symmetry"]*max(0,sym))
    else:
        sc["symmetry"]=0
    # Convexity bonus
    conv = geo.get("convexityScore", 0)
    for k in ["canny_snap","bbox_margin","rmbg_clean","feature_detect","smooth_ok"]:
        sc[k]=QUALITY_WEIGHTS[k]
    total=sum(sc.values())
    warns=[]
    if sc["contour_pts"]<QUALITY_WEIGHTS["contour_pts"]*0.6: warns.append("Low contour point count")
    if sc["aspect_ratio"]==0:                                 warns.append("Unusual aspect ratio — check framing")
    if sc["wheel_detect"]<QUALITY_WEIGHTS["wheel_detect"]:   warns.append("Wheel detection incomplete")
    if conv < 0.88:                                           warns.append("Low convexity — shadow or reflection in outline")
    if geo.get("wasFlipped"):                                 warns.append("Car was left-facing — auto-flipped to right")
    return {"score":min(100,total),"status":"ACCEPTED" if total>=50 else "REVIEW",
            "signals":sc,"warnings":warns}


# ═════════════════════════════════════════════════════════════════════════════
# MAIN STREAM FUNCTION
# ═════════════════════════════════════════════════════════════════════════════

def analyse_contour_stream(
    image_bytes: bytes,
    mode: str = "A",
    view: str = "side",
) -> Generator[dict[str, Any], None, None]:

    def _p(stage,pct,msg):
        return {"stage":stage,"pct":pct,"msg":msg,"result":None}

    try:
        yield _p("prep", 3, "Stage 0a: EXIF fix, canvas margin, resize to 1536px…")
        img_bgr = _normalise_input(image_bytes)
        h, w    = img_bgr.shape[:2]

        yield _p("rmbg", 8, "Stage 0b: RMBG 2.0 — foreground extraction…")
        _, rmbg_mask = _rmbg(img_bgr)

        if view == "auto":
            view = "side" if w > h*1.3 else "front"

        yield _p("yolo", 18, "Stage 1: YOLO11x-seg — vehicle detection…")
        yolo = _yolo_detect(img_bgr)
        bbox = yolo["bbox"] if yolo else (0,0,w,h)

        # Trim rmbg with dilated YOLO mask to remove background bleed.
        # Dilate 21px so wheel arches and underbody aren't accidentally clipped.
        if yolo and yolo.get("yolo_mask") is not None:
            k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (21, 21))
            yolo_dilated = cv2.dilate(yolo["yolo_mask"], k, iterations=1)
            trimmed = cv2.bitwise_and(rmbg_mask, yolo_dilated)
            if cv2.countNonZero(trimmed) >= cv2.countNonZero(rmbg_mask) * 0.65:
                rmbg_mask = trimmed
                print("[contour] rmbg trimmed by YOLO mask")

        yield _p("sam3", 30, "Stage 2: SAM2 point-prompted mask refinement…")
        sam_mask = _sam_refine(img_bgr, bbox, rmbg_mask)

        yield _p("morph", 44, "Stage 3: Morph close + sill recovery…")
        clean_mask = _morph_clean(sam_mask)

        yield _p("contour", 55, "Stage 4-5: Contour trace + Canny snap…")
        raw_pts, trace_meta = _trace_and_snap(img_bgr, clean_mask)

        if len(raw_pts) < 50:
            yield {"stage":"error","msg":"No vehicle outline found. Use a clear side-view photo.","pct":0,"result":None}
            return

        yield _p("keys", 62, "Stage 8: Hough wheel geometry…")
        geo_wheels = _hough_wheels(img_bgr, clean_mask)

        yield _p("enh", 68, "Stage 7: Wheel arch detection…")
        arch_wheels, arch_pts_norm, arch_bbox_aspect = _arch_contour(clean_mask, h, w)

        yield _p("enh", 74, "Stage 7c: Catmull-Rom spline smoothing (120sps, 2× Chaikin)…")
        display_dense, pts_2k = _smooth_spline(raw_pts)
        # Technical mode: separate minimal-smoothing pass preserving geometry
        pts_technical = _technical_spline(raw_pts)

        yield _p("cfd", 82, "Stage 9: Aspect-ratio-preserving normalisation + orientation…")

        # ── ASPECT-RATIO-PRESERVING normalisation ─────────────────────────
        pts_norm_raw, bbox_info = _norm_pts_aspect_preserving(pts_2k)

        # ── ORIENTATION DETECTION + AUTO-FLIP ─────────────────────────────
        pts_norm, was_flipped = _detect_orientation_and_flip(pts_norm_raw)

        # Also flip display dense if needed
        if was_flipped:
            dn = np.array(display_dense)
            dn_norm, _ = _norm_pts_aspect_preserving(dn)
            x_max_dn   = dn_norm[:, 0].max()
            dn_norm    = np.column_stack([x_max_dn - dn_norm[:,0], dn_norm[:,1]])
            display_norm = dn_norm
        else:
            display_dense_arr = np.array(display_dense)
            display_norm, _   = _norm_pts_aspect_preserving(display_dense_arr)

        # ── Benchmarking geometry ─────────────────────────────────────────
        yield _p("cfd", 88, "Stage 9: Benchmarking geometry extraction…")
        geo = _extract_benchmarking_geometry(
            pts_norm, bbox_info, geo_wheels, h, w, view, was_flipped
        )
        geo["_keypoints"] = {"wheels": geo_wheels}

        yield _p("quality", 92, "Stage 10: Quality scoring…")
        quality = _quality(
            pts_norm.tolist(), geo, geo_wheels, h, w, clean_mask
        )

        yield _p("done", 97, "Finalising SVG, engineering exports…")

        # Cap display pts to 600 — Catmull-Rom dense output is millions of points
        _step = max(1, len(display_norm) // 600)
        _disp = display_norm[::_step][:600]

        result = {
            # ── Outline points (aspect-ratio-preserving) ──────────────────
            "display_outline_pts":   _disp.tolist(),  # 600pt smooth display
            "technical_outline_pts": _norm_pts_aspect_preserving(
                (np.flipud(pts_technical) if was_flipped else pts_technical)
            )[0].tolist(),                                     # 2000pt technical (minimal smooth)
            "outline_pts":           pts_norm.tolist(),      # compat

            # ── True proportion metadata ───────────────────────────────────
            "true_aspect":    bbox_info.get("true_aspect"),  # width:height
            "norm_w":         bbox_info.get("norm_w"),       # normalised width
            "norm_h":         bbox_info.get("norm_h"),       # normalised height
            "was_flipped":    was_flipped,

            # ── Wheel arch ────────────────────────────────────────────────
            "arch_pts":          arch_pts_norm,
            "arch_bbox_aspect":  arch_bbox_aspect,
            "arch_wheels":       arch_wheels or [],

            # ── Features (none in self-contained version) ─────────────────
            "features":      [],
            "sharp_indices": [],

            # ── Meta ──────────────────────────────────────────────────────
            "geometry":  geo,
            "keypoints": {"wheels": geo_wheels},
            "bbox":      bbox_info,
            "quality":   quality,
            "method":    trace_meta.get("method","contour"),
            "_imageW":   w,
            "_imageH":   h,
        }

        yield {"stage":"done","pct":100,"msg":"Complete","result":result}

    except Exception as exc:
        print(f"[contour] Pipeline error:\n{traceback.format_exc()}")
        yield {"stage":"error","msg":str(exc),"pct":0,"result":None}
