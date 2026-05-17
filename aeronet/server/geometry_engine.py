# geometry_engine.py — Engineering geometry analysis for CFD benchmarking
# Mahindra Research Valley / StatCFD
#
# Provides:
#   - Wheel-based coordinate normalization (3 systems)
#   - Shape descriptors (15 engineering parameters)
#   - Curvature analysis (local curvature, peaks, histogram)
#   - Camera/perspective correction (affine wheel-axis alignment)
#   - Contour comparison (Procrustes alignment, deviation map)
#   - CFD heuristic features (7 indicators)
#   - Engineering exports (CSV, DXF stub, numpy)
#
# All computations are on normalised [0,1] contour points unless stated.
# Copyright (c) 2026 Rutej Talati / statinsite.com

from __future__ import annotations
import math
import numpy as np
from typing import Optional


# ═══════════════════════════════════════════════════════════════════════════════
# COORDINATE SYSTEMS
# ═══════════════════════════════════════════════════════════════════════════════

def normalize_bbox(pts: np.ndarray, bbox: dict) -> np.ndarray:
    """
    System 1: bbox-normalized [0,1] coordinates.
    pts in pixel space → [0,1] relative to bounding box.
    """
    bw, bh = max(bbox['w'], 1), max(bbox['h'], 1)
    bx, by = bbox['x'], bbox['y']
    return np.column_stack([
        (pts[:,0] - bx) / bw,
        (pts[:,1] - by) / bh,
    ])


def normalize_wheelbase(pts_norm: np.ndarray, w1_nx: float, w2_nx: float,
                         w1_ny: float, w2_ny: float) -> np.ndarray:
    """
    System 2: wheelbase-normalized coordinates.
    - Origin at front wheel center
    - X axis: front wheel → rear wheel = 1.0
    - Y axis: ground plane = 0.0 (wheel center = wheel_radius)

    Two images of the same car, regardless of zoom or crop, should produce
    nearly identical wheelbase-normalized contours.
    """
    wb = max(abs(w2_nx - w1_nx), 1e-6)
    # Translate so front wheel is at x=0
    pts_shifted = pts_norm.copy()
    pts_shifted[:,0] -= w1_nx
    pts_shifted[:,1] -= w1_ny   # front wheel center at y=0
    # Scale so wheelbase = 1.0
    pts_shifted[:,0] /= wb
    pts_shifted[:,1] /= wb      # same scale factor — preserves aspect ratio
    return pts_shifted


def normalize_ground_plane(pts_norm: np.ndarray, wheels: list,
                            bbox: dict) -> np.ndarray:
    """
    System 3: ground-plane normalized.
    - Ground (wheel contact patch) = y=0
    - Car height = 1.0
    - Wheelbase center at x=0.5

    Requires wheel positions in bbox-normalized coords.
    """
    if len(wheels) < 2:
        return pts_norm  # fallback if wheels not detected
    # Estimate wheel contact patch Y (bottom of wheel circle)
    wr1 = wheels[0].get('nr', 0.10)  # wheel radius normalised to bbox width
    wr2 = wheels[1].get('nr', 0.10)
    ground_y = max(wheels[0].get('ny', 0.85) + wr1 * (bbox['w']/max(bbox['h'],1)),
                   wheels[1].get('ny', 0.85) + wr2 * (bbox['w']/max(bbox['h'],1)))
    # Car height = ground to roof
    roof_y = pts_norm[:,1].min()
    car_h  = max(ground_y - roof_y, 1e-6)
    # Wheelbase center
    wb_cx  = (wheels[0].get('nx',0.20) + wheels[1].get('nx',0.80)) / 2
    out = pts_norm.copy()
    out[:,0] -= wb_cx       # center on wheelbase midpoint
    out[:,1]  = (ground_y - out[:,1]) / car_h   # flip Y: ground=0, roof=1
    return out


# ═══════════════════════════════════════════════════════════════════════════════
# CAMERA / PERSPECTIVE CORRECTION
# ═══════════════════════════════════════════════════════════════════════════════

def correct_perspective(pts_norm: np.ndarray, wheels: list,
                         bbox_aspect: float) -> tuple[np.ndarray, dict]:
    """
    Correct mild perspective distortion using wheel-axis alignment.

    Strategy:
    1. Detect angle of wheelbase axis (should be horizontal in side view)
    2. If tilt > 0.5°, apply affine rotation to level the car
    3. If perspective wedge detected (front wheel higher than rear),
       apply shear correction

    Returns (corrected_pts, correction_report)
    """
    report = {'applied': False, 'tilt_deg': 0.0, 'shear': 0.0, 'method': 'none'}

    if len(wheels) < 2:
        return pts_norm, report

    w1x, w1y = wheels[0].get('nx',0.20), wheels[0].get('ny',0.75)
    w2x, w2y = wheels[1].get('nx',0.80), wheels[1].get('ny',0.75)

    # Wheelbase tilt angle
    dx = w2x - w1x; dy = w2y - w1y
    tilt_deg = math.degrees(math.atan2(dy, max(abs(dx), 1e-6)))
    report['tilt_deg'] = round(tilt_deg, 3)

    if abs(tilt_deg) < 0.3:
        report['method'] = 'none_needed'
        return pts_norm, report

    if abs(tilt_deg) > 8.0:
        report['method'] = 'rejected_severe_tilt'
        report['warning'] = f"Tilt {tilt_deg:.1f}° too severe — side view required"
        return pts_norm, report

    # Apply rotation about wheelbase midpoint
    cx = (w1x + w2x) / 2
    cy = (w1y + w2y) / 2
    theta = -math.radians(tilt_deg)
    cos_t, sin_t = math.cos(theta), math.sin(theta)

    corrected = pts_norm.copy()
    dx_pts = corrected[:,0] - cx
    dy_pts = corrected[:,1] - cy
    corrected[:,0] = cx + cos_t*dx_pts - sin_t*dy_pts
    corrected[:,1] = cy + sin_t*dx_pts + cos_t*dy_pts

    # Perspective shear: if front of car appears closer (larger) than rear,
    # the horizontal lines converge. Estimate from wheel Y difference post-rotation.
    w1y_corr = cy + sin_t*(w1x-cx) + cos_t*(w1y-cy)
    w2y_corr = cy + sin_t*(w2x-cx) + cos_t*(w2y-cy)
    shear_factor = (w2y_corr - w1y_corr) / max(abs(w2x - w1x), 1e-6)

    if abs(shear_factor) > 0.02:
        # Apply horizontal shear to remove perspective wedge
        corrected[:,1] -= shear_factor * (corrected[:,0] - cx)
        report['shear'] = round(shear_factor, 4)

    report['applied'] = True
    report['method']  = 'wheelbase_alignment'
    return corrected, report


# ═══════════════════════════════════════════════════════════════════════════════
# SHAPE DESCRIPTORS
# ═══════════════════════════════════════════════════════════════════════════════

def extract_shape_descriptors(pts_wb: np.ndarray, geo: dict) -> dict:
    """
    Extract 15 engineering shape descriptors from wheelbase-normalized contour.

    pts_wb: contour in wheelbase-normalized coordinates
            (front wheel at x=0, rear wheel at x=1, ground at y≈0)

    Returns dict with all descriptors + physical interpretations.
    """
    if len(pts_wb) < 10:
        return {}

    x = pts_wb[:,0]; y = pts_wb[:,1]

    # Split into top and bottom profiles
    # Top profile: points with y > median (above midline in WB coords)
    # In WB coords: y>0 means above ground, higher y = higher on car
    y_med   = float(np.median(y))
    top_pts = pts_wb[y > y_med]
    bot_pts = pts_wb[y <= y_med]
    top_pts = top_pts[top_pts[:,0].argsort()] if len(top_pts) > 0 else pts_wb
    bot_pts = bot_pts[bot_pts[:,0].argsort()] if len(bot_pts) > 0 else pts_wb

    x_all = pts_wb[:,0]
    x_min, x_max = float(x_all.min()), float(x_all.max())
    car_len = max(x_max - x_min, 1e-6)

    # 1. Roof curvature range
    # In wheelbase-norm: Y increases upward. Roof = highest Y at each x slice.
    # Sample max-Y across the centre 80% of car length.
    # Range = max(roofline_y) - min(roofline_y) = how much the roof curves.
    # Flat roof → near 0. Fastback/curved → larger value.
    roof_y_samples = []
    for frac in np.linspace(0.10, 0.90, 16):
        x_target = x_min + frac * car_len
        nearby   = pts_wb[np.abs(pts_wb[:,0]-x_target) < car_len*0.04]
        if len(nearby) >= 2:
            roof_y_samples.append(float(nearby[:,1].max()))
    if len(roof_y_samples) >= 4:
        arr = np.array(roof_y_samples)
        # Remove bottom 10% (outliers from noisy underbody points)
        arr = arr[arr >= np.percentile(arr, 10)]
        roof_curvature_range = round(float(arr.max() - arr.min()), 4)
    else:
        roof_curvature_range = 0.0

    # 2. Hood slope angle
    # Front 20% of car, top profile
    hood_mask = (pts_wb[:,0] > x_min) & (pts_wb[:,0] < x_min+car_len*0.22) & (pts_wb[:,1] > y_med*0.3)
    hood_pts  = pts_wb[hood_mask]
    if len(hood_pts) >= 3:
        hood_pts_s = hood_pts[hood_pts[:,0].argsort()]
        dy_h = float(hood_pts_s[-1,1] - hood_pts_s[0,1])
        dx_h = float(hood_pts_s[-1,0] - hood_pts_s[0,0])
        hood_slope_deg = round(math.degrees(math.atan2(dy_h, max(abs(dx_h),1e-6))), 2)
    else:
        hood_slope_deg = 0.0

    # 3. Rear taper angle (rear 20% of car)
    rear_mask = (pts_wb[:,0] > x_min+car_len*0.78) & (pts_wb[:,1] > y_med*0.3)
    rear_pts  = pts_wb[rear_mask]
    if len(rear_pts) >= 3:
        rear_pts_s = rear_pts[rear_pts[:,0].argsort()]
        dy_r = float(rear_pts_s[-1,1] - rear_pts_s[0,1])
        dx_r = float(rear_pts_s[-1,0] - rear_pts_s[0,0])
        rear_taper_deg = round(math.degrees(math.atan2(dy_r, max(abs(dx_r),1e-6))), 2)
    else:
        rear_taper_deg = round(geo.get('rearSlantAngleDeg', 20.0), 2)

    # 4. Frontal wedge angle (front face verticality)
    front_mask = (pts_wb[:,0] < x_min+car_len*0.08)
    front_pts  = pts_wb[front_mask]
    if len(front_pts) >= 3:
        fy_range = float(front_pts[:,1].max() - front_pts[:,1].min())
        fx_range = float(np.abs(front_pts[:,0] - front_pts[:,0].mean()).max())
        frontal_wedge_deg = round(math.degrees(math.atan2(fx_range, max(fy_range, 1e-6))), 2)
    else:
        frontal_wedge_deg = 5.0

    # 5. Max thickness location (x position of widest car cross-section in side view)
    # In side view this is the tallest point (max y span at each x)
    thickness_x = []
    for frac in np.linspace(0.0, 1.0, 20):
        x_t = x_min + frac * car_len
        nearby = pts_wb[np.abs(pts_wb[:,0]-x_t) < car_len*0.03]
        if len(nearby) > 1:
            thickness_x.append((frac, float(nearby[:,1].max()-nearby[:,1].min())))
    if thickness_x:
        max_thick = max(thickness_x, key=lambda t: t[1])
        max_thickness_location = round(max_thick[0], 3)
        max_thickness_value    = round(max_thick[1], 4)
    else:
        max_thickness_location, max_thickness_value = 0.5, 0.0

    # 6. Greenhouse ratio (glazed area / total side area — approximated)
    # Cabin region: x from 20% to 80%, y from 40% to 90% of car height
    cabin_mask = (pts_wb[:,0] > x_min+car_len*0.22) & \
                 (pts_wb[:,0] < x_min+car_len*0.82) & \
                 (pts_wb[:,1] > y_med*0.4)
    cabin_pts  = pts_wb[cabin_mask]
    gh_ratio   = round(len(cabin_pts)/max(len(pts_wb),1), 3)

    # 7. Wheel placement ratios (front/rear wheel x positions normalised to car length)
    w1_ratio = round(float(geo.get('hoodRatio', 0.28)), 3)
    w2_ratio = round(1.0 - float(geo.get('bootRatio', 0.28)), 3)

    # 8. Cabin centroid (mean x,y of cabin region points)
    cabin_cx = round(float(cabin_pts[:,0].mean()) if len(cabin_pts) > 0 else 0.50, 3)
    cabin_cy = round(float(cabin_pts[:,1].mean()) if len(cabin_pts) > 0 else 0.60, 3)

    # 9. Taper onset point (x where rear roofline starts dropping)
    # Find the x where roofline y starts consistently decreasing
    taper_onset = 0.70  # default
    if len(roof_pts) > 6:
        rp_s = roof_pts[roof_pts[:,0].argsort()]
        y_smooth = np.convolve(rp_s[:,1], np.ones(5)/5, mode='valid')
        if len(y_smooth) > 3:
            diffs = np.diff(y_smooth)
            # Find last point where roofline stops increasing
            pos_diffs = np.where(diffs < -0.005)[0]
            if len(pos_diffs) > 0:
                idx = int(pos_diffs[0])
                if idx < len(rp_s)-5:
                    taper_onset = round(float((rp_s[idx,0]-x_min)/car_len), 3)

    # 10. Rear cutoff sharpness (how abrupt is the rear truncation)
    rear_zone  = pts_wb[pts_wb[:,0] > x_min+car_len*0.85]
    if len(rear_zone) >= 4:
        rx = rear_zone[:,0]; ry = rear_zone[:,1]
        x_span = float(rx.max()-rx.min())
        y_span = float(ry.max()-ry.min())
        cutoff_sharpness = round(y_span / max(x_span, 1e-6) / car_len, 3)
    else:
        cutoff_sharpness = 1.0

    # 11. Underbody rise angle (how much the floor rises front to rear)
    under_mask = bot_pts if len(bot_pts) > 0 else pts_wb[pts_wb[:,1] < y_med]
    if len(under_mask) >= 4:
        um = under_mask[under_mask[:,0].argsort()]
        dy_u = float(um[-1,1] - um[0,1])
        dx_u = float(um[-1,0] - um[0,0])
        underbody_rise_deg = round(math.degrees(math.atan2(dy_u, max(abs(dx_u),1e-6))), 2)
    else:
        underbody_rise_deg = 0.0

    # 12. Windscreen rake (from geo if available, else estimate from A-pillar)
    ws_rake = round(float(geo.get('wsAngleDeg', 58.0)), 1)

    return {
        # Roofline
        "roof_curvature_range":   roof_curvature_range,
        "taper_onset_x":          taper_onset,
        # Hood
        "hood_slope_deg":         hood_slope_deg,
        "frontal_wedge_deg":      frontal_wedge_deg,
        # Rear
        "rear_taper_deg":         rear_taper_deg,
        "rear_cutoff_sharpness":  cutoff_sharpness,
        # Body
        "max_thickness_location": max_thickness_location,
        "max_thickness_value":    max_thickness_value,
        "greenhouse_ratio":       gh_ratio,
        "underbody_rise_deg":     underbody_rise_deg,
        "ws_rake_deg":            ws_rake,
        # Cabin
        "cabin_centroid_x":       cabin_cx,
        "cabin_centroid_y":       cabin_cy,
        # Wheels
        "front_wheel_ratio":      w1_ratio,
        "rear_wheel_ratio":       w2_ratio,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# CURVATURE ANALYSIS
# ═══════════════════════════════════════════════════════════════════════════════

def compute_curvature(pts: np.ndarray, window: int = 5) -> np.ndarray:
    """
    Compute signed curvature at each point using finite differences.
    κ = (x'y'' - y'x'') / (x'² + y'²)^(3/2)

    Returns curvature array, same length as pts.
    High curvature = sharp corner (bumper edge, wheel arch, A-pillar kink)
    Low curvature = flat region (door panel, roof, underbody)
    """
    n = len(pts)
    kappa = np.zeros(n)
    for i in range(n):
        # Central differences with periodic boundary
        p0 = pts[(i-window)%n]; p1 = pts[i]; p2 = pts[(i+window)%n]
        dx1 = p1[0]-p0[0]; dy1 = p1[1]-p0[1]
        dx2 = p2[0]-p1[0]; dy2 = p2[1]-p1[1]
        # First derivatives (forward from p0→p1, backward from p1→p2)
        xp  = (dx1+dx2)/2; yp = (dy1+dy2)/2
        # Second derivatives
        xpp = dx2-dx1;     ypp = dy2-dy1
        denom = (xp**2 + yp**2)**1.5
        kappa[i] = (xp*ypp - yp*xpp) / denom if denom > 1e-10 else 0.0
    return kappa


def analyse_curvature(pts_norm: np.ndarray, geo: dict) -> dict:
    """
    Full curvature analysis of normalised contour.

    Returns:
    - curvature array (normalised)
    - peak locations (wheel arches, bumpers, A-pillar)
    - curvature histogram (10 bins)
    - bluff regions
    - separation-prone regions
    - smooth regions
    """
    if len(pts_norm) < 20:
        return {}

    kappa   = compute_curvature(pts_norm, window=4)
    abs_k   = np.abs(kappa)
    n       = len(pts_norm)

    # Normalise curvature to [0,1] for export
    k_max   = float(abs_k.max()) if abs_k.max() > 0 else 1.0
    k_norm  = (abs_k / k_max).tolist()

    # Find curvature peaks (local maxima above 0.3 × max)
    threshold = k_max * 0.30
    peaks     = []
    for i in range(1, n-1):
        if abs_k[i] > threshold and abs_k[i] >= abs_k[i-1] and abs_k[i] >= abs_k[i+1]:
            peaks.append({
                "idx":  i,
                "nx":   round(float(pts_norm[i,0]), 4),
                "ny":   round(float(pts_norm[i,1]), 4),
                "kappa":round(float(kappa[i]), 6),
                "abs_k":round(float(abs_k[i]/k_max), 4),
            })
    # Keep top 20 strongest peaks
    peaks.sort(key=lambda p: p['abs_k'], reverse=True)
    peaks = peaks[:20]

    # Curvature histogram (10 bins, 0→1 normalised curvature)
    hist, edges = np.histogram(k_norm, bins=10, range=(0.0,1.0))
    curvature_histogram = {
        "bins":  [round(float(edges[i]),2) for i in range(len(edges)-1)],
        "counts":[int(c) for c in hist],
    }

    # Region classification based on local curvature level
    # High curvature (>0.4) → sharp geometric transitions (bumpers, arches, pillars)
    # Medium (0.1-0.4) → curved surfaces (hood, roofline, windscreen)
    # Low (<0.1) → flat/bluff surfaces (door panels, underbody)
    high_k_frac   = float((abs_k > k_max*0.40).sum()) / n
    medium_k_frac = float(((abs_k >= k_max*0.10)&(abs_k<=k_max*0.40)).sum()) / n
    low_k_frac    = float((abs_k < k_max*0.10).sum()) / n

    # Identify bluff (separation-prone) regions:
    # Rear zone with low curvature followed by abrupt drop = bluff base
    rear_k = abs_k[int(n*0.70):]
    bluff_tendency = round(float(np.mean(rear_k)) / k_max, 3)

    # Smooth taper score: high = smooth rear taper (fastback-like)
    # Low = abrupt cutoff (notchback-like)
    rear_k_grad = float(np.gradient(rear_k).std()) if len(rear_k) > 1 else 0.0
    taper_smoothness = round(1.0 - min(1.0, rear_k_grad/k_max*10), 3)

    return {
        "curvature_normalised":   [round(k,4) for k in k_norm],
        "curvature_peaks":        peaks,
        "curvature_histogram":    curvature_histogram,
        "stats": {
            "k_max_raw":        round(k_max, 6),
            "mean_abs_k":       round(float(abs_k.mean()/k_max), 4),
            "high_k_fraction":  round(high_k_frac, 3),
            "medium_k_fraction":round(medium_k_frac, 3),
            "low_k_fraction":   round(low_k_frac, 3),
            "bluff_tendency":   bluff_tendency,
            "taper_smoothness": taper_smoothness,
            "n_peaks":          len(peaks),
        },
    }


# ═══════════════════════════════════════════════════════════════════════════════
# CFD HEURISTIC FEATURES
# ═══════════════════════════════════════════════════════════════════════════════

def compute_cfd_heuristics(pts_norm: np.ndarray, geo: dict,
                            shape: dict, curv: dict) -> dict:
    """
    Physically meaningful heuristic indicators for CFD pre-screening.
    These are NOT CFD results — they are geometry-based tendency scores.

    All scores are 0-1 where:
    0 = low tendency / favorable
    1 = high tendency / unfavorable
    """
    cd    = geo.get('Cd', 0.30)
    slant = geo.get('rearSlantAngleDeg', 20.0)
    ws    = geo.get('wsAngleDeg', 58.0)
    bt    = geo.get('bodyType', 'notchback')
    rearD = geo.get('rearDrop', 0.15)

    # 1. Frontal blockage tendency
    # High if: low ws rake (upright windscreen), large frontal area, SUV/truck
    ws_contrib = max(0, (75-ws)/30)   # more upright windscreen = more blockage
    bt_contrib = {'suv':0.7,'estate':0.4,'notchback':0.3,'fastback':0.1}.get(bt,0.3)
    frontal_blockage = round(min(1.0, ws_contrib*0.5 + bt_contrib*0.5), 3)

    # 2. Wake tendency (base pressure drag contribution)
    # High if: abrupt rear, large rear area, notchback/estate
    wake_t = min(1.0, (
        0.4 * (1.0 if bt in('notchback','estate') else 0.3) +
        0.3 * min(1.0, rearD*3) +
        0.3 * shape.get('rear_cutoff_sharpness', 1.0)
    ))
    wake_tendency = round(wake_t, 3)

    # 3. Pressure recovery tendency
    # Good pressure recovery: gradual rear slope (fastback), low slant
    # Use Ahmed body critical angle: best recovery 12-30°
    if 12 < slant < 30:
        pr_score = 0.7  # favorable range
    elif slant < 12:
        pr_score = 0.4  # attached but not optimal
    elif 30 <= slant < 36:
        pr_score = 0.3  # critical, possible separation
    else:
        pr_score = 0.1  # separated — poor recovery
    pressure_recovery = round(pr_score, 3)

    # 4. Diffuser tendency
    # Estimate from underbody rise angle
    rise = shape.get('underbody_rise_deg', 0.0)
    diffuser_tendency = round(min(1.0, abs(rise)/15.0), 3)

    # 5. Cooling opening fraction (heuristic from grille geometry)
    # Proxy: frontal area fraction that is likely open (depends on body type)
    cooling_opening = {
        'suv':0.18,'estate':0.12,'notchback':0.10,'fastback':0.08,'hatchback':0.10
    }.get(bt, 0.10)
    cooling_opening = round(cooling_opening, 3)

    # 6. Wheel exposure factor
    # How much the wheel protrudes relative to body (affects wheel drag ~14% of Cd)
    # Proxy from geometry: compact cars have more enclosed arches
    wf = shape.get('front_wheel_ratio', 0.25)
    wr = shape.get('rear_wheel_ratio', 0.75)
    # Estimate exposure from how far wheels are from bumpers
    front_exposure = round(min(1.0, wf * 2), 3)
    rear_exposure  = round(min(1.0, (1.0-wr) * 2), 3)
    wheel_exposure = round((front_exposure + rear_exposure) / 2, 3)

    # 7. Rear separation likelihood (Ahmed body regime)
    regime = geo.get('ahmedRegime', 'intermediate')
    sep_scores = {'attached':0.2,'intermediate':0.5,'critical':0.9,'separated':0.7}
    rear_separation_likelihood = sep_scores.get(regime, 0.5)

    # 8. Cabin taper smoothness
    cabin_taper_smoothness = curv.get('stats',{}).get('taper_smoothness', 0.5)

    return {
        "frontal_blockage_tendency":   frontal_blockage,
        "wake_tendency":               wake_tendency,
        "pressure_recovery_tendency":  pressure_recovery,
        "diffuser_tendency":           diffuser_tendency,
        "cooling_opening_fraction":    cooling_opening,
        "wheel_exposure_factor":       wheel_exposure,
        "rear_separation_likelihood":  rear_separation_likelihood,
        "cabin_taper_smoothness":      round(cabin_taper_smoothness, 3),
        "ahmed_regime":                regime,
        "note": "Heuristic geometry-based indicators only. Not CFD results.",
    }


# ═══════════════════════════════════════════════════════════════════════════════
# CONTOUR COMPARISON (Procrustes alignment)
# ═══════════════════════════════════════════════════════════════════════════════

def compare_contours(pts_a: np.ndarray, pts_b: np.ndarray,
                     geo_a: dict, geo_b: dict) -> dict:
    """
    Compare two wheelbase-normalised contours for engineering benchmarking.

    IMPORTANT: pts_a and pts_b must be in WHEELBASE-NORMALISED coordinates
    (from engineering['_pts_wb'] or engineering['coords']['wheelbase_norm']).
    Do NOT pass bbox-normalised pts — crop differences will corrupt the comparison.

    Pipeline:
    1. Resample both to N=500 points
    2. Check left/right side consistency (mirror if needed)
    3. Align on wheelbase midpoint — NO scale removal (preserves real size differences)
    4. Rotation-only alignment via SVD
    5. Point-by-point deviation
    6. Region deltas split by x-coordinate (not array index)

    FIX: Procrustes scale removal replaced with fixed-scale wheelbase alignment.
         Scale removal hid real dimensional differences (longer hood, taller greenhouse).
    FIX: Region split now by x-position in wheelbase space, not contour array index.
         Array-index split caused "Front" to map to the roof and "Rear" to the underbody.
    FIX: Left/right side consistency check added. Mirrored photos previously gave ~0 score.
    """
    N = 500

    def _resample_n(pts, n):
        closed = np.vstack([pts, pts[0:1]])
        diffs  = np.diff(closed, axis=0)
        dists  = np.sqrt((diffs**2).sum(axis=1))
        cum    = np.concatenate([[0], np.cumsum(dists)])
        total  = cum[-1]
        if total < 1e-6: return pts[:n] if len(pts)>=n else pts
        sd = np.linspace(0, total, n, endpoint=False)
        return np.column_stack([np.interp(sd,cum,closed[:,0]),
                                 np.interp(sd,cum,closed[:,1])])

    a = _resample_n(np.array(pts_a), N)
    b = _resample_n(np.array(pts_b), N)

    # ── Left/right side consistency check ────────────────────────────────────
    # In wheelbase-norm: x=0 is front wheel, x=1 is rear wheel.
    # If one contour is left-side and the other right-side, the x-distribution
    # will appear mirrored. Detect this by comparing whether the front bumper
    # (lowest x) aligns with the front of both cars.
    # Heuristic: if the majority of contour points for one car have x>0.5
    # while the other has majority x<0.5, they are mirrored.
    a_front_heavy = float((a[:,0] < 0.5).sum()) / N
    b_front_heavy = float((b[:,0] < 0.5).sum()) / N
    mirrored = abs(a_front_heavy - b_front_heavy) > 0.35
    side_note = ""
    if mirrored:
        # Mirror b horizontally so both face the same direction
        b = b.copy()
        b[:,0] = -b[:,0]
        # Re-centre after mirror
        b[:,0] -= b[:,0].min()
        side_note = "Car B was mirrored (left/right side mismatch auto-corrected)"

    # ── Fixed-scale alignment (no scale removal) ──────────────────────────────
    # Centre both on wheelbase midpoint (x=0.5 in WB coords after centering).
    # DO NOT normalise by RMS — this preserves real dimensional differences.
    # A compact car and a full-size saloon should show their true size difference.
    ca = a.mean(axis=0)
    cb = b.mean(axis=0)
    a_c = a - ca
    b_c = b - cb

    # Rotation-only SVD alignment
    M    = b_c.T @ a_c
    U, S, Vt = np.linalg.svd(M)
    R    = U @ Vt
    b_aligned = b_c @ R.T

    # ── Point-by-point deviation ──────────────────────────────────────────────
    deviations = np.sqrt(((a_c - b_aligned)**2).sum(axis=1))
    mean_dev   = float(deviations.mean())
    max_dev    = float(deviations.max())
    # Similarity: 1 - normalised mean deviation.
    # In WB space, wheelbase=1.0, so mean_dev ~0.01 = 1% of wheelbase difference.
    # Divide by 0.5 so a 50% wheelbase deviation = similarity 0.
    similarity_score = round(max(0.0, 1.0 - mean_dev / 0.5), 3)

    # ── Region-specific deltas by x-coordinate (not array index) ─────────────
    # FIX: previously split 500 points into equal index blocks, which mapped
    # arbitrary arc segments to region names. Now split by x-position in WB space.
    region_bounds = [
        ("Front",      (-0.3,  0.15)),   # bumper to front wheel
        ("Front-Mid",  ( 0.15, 0.40)),   # front wheel to A-pillar
        ("Mid",        ( 0.40, 0.65)),   # cabin centre
        ("Rear-Mid",   ( 0.65, 0.88)),   # C-pillar to rear wheel
        ("Rear",       ( 0.88, 1.50)),   # rear wheel to bumper
    ]
    region_devs = {}
    for name, (x_lo, x_hi) in region_bounds:
        # Use a_c x-coordinates to select region points
        mask = (a_c[:,0] >= x_lo) & (a_c[:,0] < x_hi)
        if mask.sum() > 0:
            region_devs[name] = round(float(deviations[mask].mean()), 4)
        else:
            region_devs[name] = 0.0

    # ── Profile-specific deltas ───────────────────────────────────────────────
    # Roofline: top 25% of car height in WB space
    roof_thresh = float(np.percentile(a_c[:,1], 75))
    a_roof = a_c[a_c[:,1] > roof_thresh]
    b_roof = b_aligned[b_aligned[:,1] > roof_thresh]
    roofline_delta = round(float(abs(
        a_roof[:,1].mean() - b_roof[:,1].mean()
    )), 4) if len(a_roof)>0 and len(b_roof)>0 else 0.0

    # Taper: rear 20% by x
    a_rear = a_c[a_c[:,0] > float(np.percentile(a_c[:,0], 80))]
    b_rear = b_aligned[b_aligned[:,0] > float(np.percentile(b_aligned[:,0], 80))]
    taper_delta = round(float(abs(
        a_rear[:,1].mean() - b_rear[:,1].mean()
    )), 4) if len(a_rear)>0 and len(b_rear)>0 else 0.0

    # Frontal: front 20% by x
    a_front = a_c[a_c[:,0] < float(np.percentile(a_c[:,0], 20))]
    b_front = b_aligned[b_aligned[:,0] < float(np.percentile(b_aligned[:,0], 20))]
    frontal_delta = round(float(abs(
        a_front[:,1].mean() - b_front[:,1].mean()
    )), 4) if len(a_front)>0 and len(b_front)>0 else 0.0

    # Underbody: bottom 20% of car height
    under_thresh = float(np.percentile(a_c[:,1], 20))
    a_under = a_c[a_c[:,1] < under_thresh]
    b_under = b_aligned[b_aligned[:,1] < under_thresh]
    underbody_delta = round(float(abs(
        a_under[:,1].mean() - b_under[:,1].mean()
    )), 4) if len(a_under)>0 and len(b_under)>0 else 0.0

    cd_a = geo_a.get('Cd', 0.30)
    cd_b = geo_b.get('Cd', 0.30)

    return {
        "similarity_score":   similarity_score,
        "mean_deviation":     round(mean_dev, 4),
        "max_deviation":      round(max_dev, 4),
        "overlap_pct":        round(similarity_score * 100, 1),
        "region_deviations":  region_devs,    # now by x-position, not array index
        "roofline_delta":     roofline_delta,
        "taper_delta":        taper_delta,
        "frontal_delta":      frontal_delta,
        "underbody_delta":    underbody_delta,
        "cd_delta":           round(float(cd_b - cd_a), 3),
        "rotation_deg":       round(math.degrees(math.atan2(R[1,0],R[0,0])), 2),
        "scale_ratio":        1.0,  # scale NOT removed — real size preserved
        "side_corrected":     mirrored,
        "side_note":          side_note,
        "aligned_pts_a":      a_c.tolist(),
        "aligned_pts_b":      b_aligned.tolist(),
        "deviation_map":      [round(float(d),4) for d in deviations],
    }


# ═══════════════════════════════════════════════════════════════════════════════
# ENGINEERING EXPORTS
# ═══════════════════════════════════════════════════════════════════════════════

def export_csv(pts: np.ndarray, header: str = "x,y") -> str:
    """Export contour as CSV string."""
    lines = [header]
    for p in pts:
        lines.append(f"{p[0]:.6f},{p[1]:.6f}")
    return "\n".join(lines)


def export_dxf_polyline(pts: np.ndarray, scale: float = 1000.0) -> str:
    """
    Export contour as minimal DXF R12 POLYLINE entity.
    scale=1000 means 1 normalised unit = 1000mm = 1m (typical car wheelbase ~2.7m)

    DXF R12 format — compatible with ANSA, ICEM CFD, Fluent Meshing.
    """
    lines = [
        "0", "SECTION",
        "2", "ENTITIES",
        "0", "POLYLINE",
        "8", "CONTOUR",     # layer name
        "66", "1",          # vertices follow
        "10", "0.0",
        "20", "0.0",
        "30", "0.0",
        "70", "1",          # closed polyline
    ]
    for p in pts:
        lines += [
            "0",  "VERTEX",
            "8",  "CONTOUR",
            "10", f"{p[0]*scale:.4f}",
            "20", f"{p[1]*scale:.4f}",
            "30", "0.0",
        ]
    lines += ["0", "SEQEND", "0", "ENDSEC", "0", "EOF"]
    return "\n".join(lines)


def export_json_descriptor(result: dict, geo: dict, quality: dict,
                            shape: dict, curv_stats: dict) -> dict:
    """
    Structured JSON descriptor for databases, ML datasets, surrogate preprocessing.
    """
    return {
        "schema_version": "1.0",
        "source":         "StatCFD / Mahindra Research Valley",
        "geometry": {
            "body_type":              geo.get("bodyType"),
            "aspect_ratio":           geo.get("aspectRatio"),
            "cd_estimate":            geo.get("Cd"),
            "cda_estimate":           geo.get("CdA"),
            "ahmed_regime":           geo.get("ahmedRegime"),
            "rear_slant_deg":         geo.get("rearSlantAngleDeg"),
            "ws_rake_deg":            geo.get("wsAngleDeg"),
            "wheelbase_norm":         geo.get("wheelbaseNorm"),
            "frontal_area_norm":      geo.get("frontalAreaNorm"),
            "separation_point_x":     geo.get("separationPointX"),
        },
        "shape_descriptors": shape,
        "curvature_stats":   curv_stats,
        "quality":           quality,
        "contour_meta": {
            "n_technical_pts":  len(result.get("technical_outline_pts", [])),
            "n_raw_pts":        len(result.get("raw_contour_pts", [])),
            "method":           result.get("method"),
            "view_type":        result.get("view_type"),
        },
    }


# ═══════════════════════════════════════════════════════════════════════════════
# FULL GEOMETRY ENGINE — main entry point
# ═══════════════════════════════════════════════════════════════════════════════

def run_geometry_engine(pts_norm: np.ndarray, geo: dict,
                         wheels_norm: list, bbox: dict,
                         result_meta: dict) -> dict:
    """
    Run the full geometry engine on a normalised contour.

    pts_norm:    [N,2] normalised [0,1] contour (technical_outline_pts)
    geo:         CFD geometry dict from _cfd_geometry()
    wheels_norm: list of wheel dicts with nx,ny,nr keys
    bbox:        {'x','y','w','h'} in pixels
    result_meta: {'method','view_type','quality'}

    FIX 1: perspective-corrected pts are now used for ALL downstream analysis
            (was using uncorrected pts_np — 3° camera angle caused systematic error)
    FIX 2: wheelbase-normalised pts passed to compare_contours, not bbox-norm
            (bbox-norm absorbs crop differences as false geometry differences)
    """
    out = {}

    # 1. Coordinate normalization
    w1_nx = wheels_norm[0]['nx'] if len(wheels_norm)>=1 else 0.20
    w2_nx = wheels_norm[1]['nx'] if len(wheels_norm)>=2 else 0.80
    w1_ny = wheels_norm[0]['ny'] if len(wheels_norm)>=1 else 0.75
    w2_ny = wheels_norm[1]['ny'] if len(wheels_norm)>=2 else 0.75

    pts_np = np.array(pts_norm)

    # 2. Perspective correction — apply FIRST, use corrected pts everywhere
    # FIX: previously pts_corrected was computed but never used downstream
    pts_corrected, persp_report = correct_perspective(
        pts_np, wheels_norm,
        float(bbox.get('w',1)) / max(float(bbox.get('h',1)), 1)
    )
    # All downstream analysis uses perspective-corrected coordinates
    pts_for_analysis = pts_corrected

    # 3. Wheelbase and ground-plane normalisation (on corrected pts)
    pts_wb = normalize_wheelbase(pts_for_analysis, w1_nx, w2_nx, w1_ny, w2_ny)
    pts_gp = normalize_ground_plane(pts_for_analysis, wheels_norm, bbox)

    # 4. Shape descriptors (wheelbase-norm — scale-invariant)
    shape = extract_shape_descriptors(pts_wb, geo)

    # 5. Curvature analysis (corrected bbox-norm)
    curv  = analyse_curvature(pts_for_analysis, geo)

    # 6. CFD heuristics
    cfd_h = compute_cfd_heuristics(pts_for_analysis, geo, shape,
                                    curv if curv else {})

    # 7. Exports — use wheelbase-norm for CSV/DXF (scale-invariant for benchmarking)
    csv_technical  = export_csv(pts_wb,  "wb_x,wb_y")
    csv_bbox       = export_csv(pts_for_analysis, "bbox_x,bbox_y")
    dxf_string     = export_dxf_polyline(pts_wb, scale=1000.0)
    json_desc      = export_json_descriptor(
        result_meta, geo, result_meta.get('quality',{}), shape,
        curv.get('stats',{}) if curv else {})

    out = {
        # Coordinate systems
        "coords": {
            "bbox_norm":        pts_np.tolist(),
            "bbox_norm_corrected": pts_for_analysis.tolist(),
            "wheelbase_norm":   pts_wb.tolist(),
            "ground_plane_norm":pts_gp.tolist(),
        },
        # Perspective correction
        "perspective_correction": persp_report,
        # Shape descriptors
        "shape_descriptors": shape,
        # Curvature
        "curvature": curv,
        # CFD heuristics
        "cfd_heuristics": cfd_h,
        # Exports — wheelbase_norm pts are the correct input for compare_contours
        "exports": {
            "csv_wheelbase":  csv_technical,
            "csv_bbox":       csv_bbox,
            "dxf":            dxf_string,
            "json_descriptor":json_desc,
        },
        # Expose wheelbase-norm pts explicitly for compare_contours calls
        "_pts_wb": pts_wb.tolist(),
    }
    return out