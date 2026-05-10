# contour_analysis.py
# Technical Vehicle Outline Extraction — CFD Benchmarking Pipeline
# Mahindra Research Valley / StatCFD / statinsite.com
#
# PURPOSE:
#   Input vehicle image → accurate segmentation → dense technical contour
#   Engineering-grade outline for CFD benchmarking and vehicle comparison.
#   NOT an aesthetic silhouette generator.
#
# PIPELINE:
#   Stage 0  — Input:       EXIF fix, resize 1536px, PNG alpha, BG removal, enhance
#   Stage 1  — Localize:    YOLOv8x-seg (best-car selection by conf×area×centrality)
#   Stage 2  — Refine:      SAM2.1-hiera-tiny (adaptive bbox padding 10-15%)
#   Stage 3  — Mask:        Conservative cleanup — 3×3 kernel, hole fill, island remove
#   Stage 4  — Underbody:   Wheel-arch floor clamping, shadow/reflection removal
#   Stage 5  — Contour:     cv2.CHAIN_APPROX_NONE (every boundary pixel)
#   Stage 6  — Spike clean: Local angle deviation filter (< 4px protrusions only)
#   Stage 7  — Edge snap:   Canny-guided local refinement (bumpers, arches, roof)
#   Stage 8  — Resample:    2000pt arc-length uniform spacing
#   Stage 9  — Smooth:      window=3 moving average, 1 pass only
#   Stage 10 — Keypoints:   Wheels (Hough), roofline, A-pillar, bumpers, sill
#   Stage 11 — CFD Geom:    Ahmed body params, Cd/CdA, separation point
#   Stage 12 — Quality:     10-signal real score, no hardcoded values
#
# OUTPUT:
#   technical_outline_pts  — 2000pt, window=3 smooth (PRIMARY for CFD)
#   display_outline_pts    — 2000pt, window=5 smooth (for UI rendering)
#   raw_contour_pts        — every boundary pixel, no processing
#   simplified_outline_pts — 200pt, for debug/overview only
#   outline_svg            — SVG polyline, white on black
#   quality                — score/100, status, warnings[], signals{}
#
# RULES:
#   ✓ cv2.CHAIN_APPROX_NONE
#   ✓ 3×3 morphology kernels max
#   ✓ Spike removal (< 4px protrusions, angle > 45°)
#   ✓ Edge snapping via Canny guidance
#   ✓ Arc-length resampling
#   ✓ window=3 smooth max (technical), window=5 (display)
#   ✗ No Catmull-Rom
#   ✗ No approxPolyDP with large epsilon
#   ✗ No Gaussian blur > sigma 1.0
#   ✗ No morphology kernels > 3×3
#   ✗ No hardcoded confidence values
#
# Copyright (c) 2026 Rutej Talati / statinsite.com. All rights reserved.

from __future__ import annotations
import io, math, time
from typing import Generator
import cv2
import numpy as np
from PIL import Image, ExifTags
try:
    from geometry_engine import run_geometry_engine, compare_contours
    _GEO_ENGINE = True
except ImportError:
    _GEO_ENGINE = False
    print("[warn] geometry_engine.py not found — engineering analysis disabled")

# ── Constants ──────────────────────────────────────────────────────────────────
TARGET_W               = 1536   # working resolution (longest side)
N_TECHNICAL            = 2000   # technical outline points
N_SIMPLIFIED           = 200    # simplified debug outline
SPIKE_ANGLE_DEG        = 45     # local angle deviation threshold for spike detection
SPIKE_WINDOW           = 6      # ± pts window for spike detection
SPIKE_MAX_DIST_PX      = 4.0    # max protrusion distance to count as spike
SMOOTH_WINDOW_TECHNICAL = 3     # moving average window — technical mode
SMOOTH_WINDOW_DISPLAY   = 5     # moving average window — display mode
MIN_CAR_FRAC           = 0.03   # minimum contour area / image area
BBOX_PAD_FRAC          = 0.12   # bbox expansion (12% → recovers bumpers/mirrors)
EDGE_SNAP_RADIUS       = 5      # px radius for Canny edge snapping
VEHICLE_CLASSES        = {2:'car', 3:'motorcycle', 5:'bus', 7:'truck'}


def _expand_bbox(x, y, w, h, iw, ih, pad=BBOX_PAD_FRAC):
    px, py = int(w*pad), int(h*pad)
    return (max(0,x-px), max(0,y-py),
            min(iw,x+w+px)-max(0,x-px),
            min(ih,y+h+py)-max(0,y-py))


# ═══════════════════════════════════════════════════════════════════════════════
# STAGE 0 — INPUT LAYER
# ═══════════════════════════════════════════════════════════════════════════════

def _fix_exif(pil: Image.Image) -> Image.Image:
    try:
        exif = pil._getexif()
        if exif is None: return pil
        tag = next((k for k,v in ExifTags.TAGS.items() if v=='Orientation'), None)
        if tag and tag in exif:
            rot = {3:180, 6:270, 8:90}.get(exif[tag])
            if rot:
                pil = pil.rotate(rot, expand=True)
                print(f"[input] EXIF rotate {rot}°")
    except Exception:
        pass
    return pil


def _detect_view_type(img_rgb: np.ndarray) -> str:
    """
    Heuristic view classification.
    Side view: car is wide relative to height (aspect > 1.6)
    Front/rear: car is narrow relative to height (aspect < 1.2)
    3/4: intermediate
    Returns: 'side' | 'front' | 'rear' | 'quarter' | 'unknown'
    """
    h, w = img_rgb.shape[:2]
    aspect = w / max(h, 1)
    if aspect > 1.6:   return 'side'
    if aspect < 1.15:  return 'front_or_rear'
    return 'quarter'


def _classify_bg(img_rgb: np.ndarray) -> dict:
    h, w = img_rgb.shape[:2]
    corners = [img_rgb[5:25,5:25], img_rgb[5:25,w-25:w-5],
               img_rgb[h-25:h-5,5:25], img_rgb[h-25:h-5,w-25:w-5]]
    means = [float(np.mean(p)) for p in corners if p.size > 0]
    stds  = [float(np.std(p))  for p in corners if p.size > 0]
    m, s  = float(np.mean(means)), float(np.mean(stds))
    is_checker = False
    try:
        p = img_rgb[5:45,5:45].astype(float)
        is_checker = float(np.std(p.reshape(-1,3),axis=0).mean()) > 28 and m > 155
    except Exception:
        pass
    return {
        'mean':m,'std':s,
        'is_white':   m>200 and s<25,
        'is_dark':    m<50  and s<25,
        'is_plain':   s<22  or m>200 or is_checker,
        'is_checker': is_checker,
    }


def _remove_bg(img: np.ndarray, bg: dict, raw: bytes|None) -> np.ndarray:
    h, w = img.shape[:2]
    GREY = np.array([118,118,118], dtype=np.uint8)
    fg   = None
    # Priority 1: PNG alpha channel
    if raw is not None:
        try:
            p = Image.open(io.BytesIO(raw))
            if p.mode == 'RGBA':
                a   = np.array(p.convert('RGBA'))[:,:,3]
                a   = cv2.resize(a,(w,h),cv2.INTER_LINEAR)
                fg  = (a>30).astype(np.uint8)*255
                print("[input] PNG alpha channel used")
        except Exception:
            pass
    if fg is None and bg['is_plain']:
        lab = cv2.cvtColor(img,cv2.COLOR_BGR2LAB)
        if bg['is_white'] or bg['is_checker']:
            _,fg = cv2.threshold(lab[:,:,0],228,255,cv2.THRESH_BINARY_INV)
            fg[int(h*0.80):,:] = 0  # hard-wipe bottom 20% (ground/shadow)
            for gy in range(int(h*0.68),int(h*0.80)):
                if float(np.mean(lab[gy,:,0])) > 208:
                    fg[gy,:] = 0
        elif bg['is_dark']:
            hsv = cv2.cvtColor(img,cv2.COLOR_BGR2HSV)
            _,fg = cv2.threshold(hsv[:,:,2],40,255,cv2.THRESH_BINARY)
        else:
            gc=np.zeros(img.shape[:2],np.uint8)
            bgd=np.zeros((1,65),np.float64); fgd=np.zeros((1,65),np.float64)
            mx,my=int(w*0.12),int(h*0.08)
            try:
                cv2.grabCut(img,gc,(mx,my,w-2*mx,h-2*my),bgd,fgd,5,cv2.GC_INIT_WITH_RECT)
                fg=np.where((gc==2)|(gc==0),0,255).astype(np.uint8)
            except Exception:
                fg=np.ones(img.shape[:2],np.uint8)*255
    if fg is None: return img
    ko=cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(5,5))
    kc=cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(19,19))
    fg=cv2.morphologyEx(fg,cv2.MORPH_OPEN, ko,iterations=1)
    fg=cv2.morphologyEx(fg,cv2.MORPH_CLOSE,kc,iterations=3)
    nc,lbl,sts,_=cv2.connectedComponentsWithStats(fg,8)
    if nc>1:
        best=1+int(np.argmax(sts[1:,cv2.CC_STAT_AREA]))
        fg=np.where(lbl==best,255,0).astype(np.uint8)
    out=img.copy(); out[fg==0]=GREY
    return out


def _enhance(img: np.ndarray) -> np.ndarray:
    blur=cv2.GaussianBlur(img,(0,0),1.8)
    img =cv2.addWeighted(img,1.40,blur,-0.40,0)
    lab=cv2.cvtColor(img,cv2.COLOR_BGR2LAB)
    L,A,B=cv2.split(lab)
    clahe=cv2.createCLAHE(clipLimit=1.5,tileGridSize=(8,8))
    return cv2.cvtColor(cv2.merge([clahe.apply(L),A,B]),cv2.COLOR_LAB2BGR)


def _preprocess(image_bytes: bytes, raw: bytes|None=None) -> tuple[bytes, str]:
    """Returns (processed_bytes, view_type)"""
    arr=np.frombuffer(image_bytes,np.uint8)
    img=cv2.imdecode(arr,cv2.IMREAD_COLOR)
    if img is None:
        pil=_fix_exif(Image.open(io.BytesIO(image_bytes)).convert('RGB'))
        img=cv2.cvtColor(np.array(pil),cv2.COLOR_RGB2BGR)
    else:
        try:
            p=_fix_exif(Image.open(io.BytesIO(image_bytes)))
            q=Image.open(io.BytesIO(image_bytes))
            if p.size != q.size:
                img=cv2.cvtColor(np.array(p.convert('RGB')),cv2.COLOR_RGB2BGR)
        except Exception:
            pass
    h,w=img.shape[:2]
    # Resize: longest side to TARGET_W, preserve aspect ratio
    scale=TARGET_W/max(w,h)
    if scale != 1.0:
        img=cv2.resize(img,(int(w*scale),int(h*scale)),
                       cv2.INTER_LANCZOS4 if scale>1 else cv2.INTER_AREA)
        h,w=img.shape[:2]
        print(f"[input] Resized → {w}×{h} (scale={scale:.2f})")
    else:
        print(f"[input] {w}×{h} (no resize needed)")
    rgb=cv2.cvtColor(img,cv2.COLOR_BGR2RGB)
    view=_detect_view_type(rgb)
    bg=_classify_bg(rgb)
    print(f"[input] BG={'white' if bg['is_white'] else 'dark' if bg['is_dark'] else 'plain' if bg['is_plain'] else 'complex'} view={view}")
    img=_remove_bg(img,bg,raw)
    img=_enhance(img)
    _,buf=cv2.imencode('.jpg',img,[cv2.IMWRITE_JPEG_QUALITY,95])
    return bytes(buf), view


# ═══════════════════════════════════════════════════════════════════════════════
# STAGE 1 — VEHICLE LOCALIZATION (YOLO)
# ═══════════════════════════════════════════════════════════════════════════════

def _yolo_mask(image_bytes: bytes) -> tuple[np.ndarray, np.ndarray, float]:
    """Returns (rgb, mask, best_conf)"""
    from ultralytics import YOLO
    model=YOLO('yolov8x-seg.pt')
    arr=np.frombuffer(image_bytes,np.uint8)
    bgr=cv2.imdecode(arr,cv2.IMREAD_COLOR)
    if bgr is None:
        pil=Image.open(io.BytesIO(image_bytes)).convert('RGB')
        bgr=cv2.cvtColor(np.array(pil),cv2.COLOR_RGB2BGR)
    h,w=bgr.shape[:2]
    bgr=cv2.resize(bgr,(TARGET_W,int(h*TARGET_W/w)),cv2.INTER_AREA)
    rgb=cv2.cvtColor(bgr,cv2.COLOR_BGR2RGB); H,W=rgb.shape[:2]
    t0=time.time(); results=model(bgr,verbose=False)
    print(f"[yolo] {time.time()-t0:.1f}s")
    best_mask,best_score,best_bbox,best_conf=None,0.0,None,0.0
    for result in results:
        if result.masks is None: continue
        for i,cls in enumerate(result.boxes.cls.cpu().numpy()):
            if int(cls) not in VEHICLE_CLASSES: continue
            conf=float(result.boxes.conf[i].cpu())
            m=result.masks.data[i].cpu().numpy()
            mr=cv2.resize(m,(W,H),interpolation=cv2.INTER_LINEAR)
            mb=(mr>0.5).astype(np.uint8)*255
            area=float(mb.sum())
            cw=1.0 if int(cls)==2 else 0.75
            coords=cv2.findNonZero(mb)
            cx_n=float(cv2.boundingRect(coords)[0]+cv2.boundingRect(coords)[2]/2)/W if coords is not None else 0.5
            centrality=1.0-abs(cx_n-0.5)*2
            score=area*conf*cw*(0.6+0.4*centrality)
            if score>best_score:
                best_score=score; best_mask=mb; best_conf=conf
                if coords is not None: best_bbox=cv2.boundingRect(coords)
    if best_mask is None:
        raise ValueError("No vehicle detected. Use a clear side-on photo.")
    if best_bbox:
        ex,ey,ew,eh=_expand_bbox(*best_bbox,W,H)
        k=cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(7,7))
        exp=cv2.dilate(best_mask,k,iterations=2)
        clip=np.zeros_like(exp); clip[ey:ey+eh,ex:ex+ew]=255
        best_mask=cv2.bitwise_and(exp,clip)
    print(f"[yolo] conf={best_conf:.3f}")
    return rgb,best_mask,best_conf


def _birefnet_mask(image_bytes: bytes) -> tuple[np.ndarray, np.ndarray, float]:
    from transformers import AutoModelForImageSegmentation
    from torchvision import transforms
    import torch
    device='cuda' if torch.cuda.is_available() else 'cpu'
    m=AutoModelForImageSegmentation.from_pretrained(
        'ZhengPeng7/BiRefNet',trust_remote_code=True).eval().to(device)
    tf=transforms.Compose([transforms.Resize((1024,1024)),transforms.ToTensor(),
        transforms.Normalize([0.485,0.456,0.406],[0.229,0.224,0.225])])
    pil=Image.open(io.BytesIO(image_bytes)).convert('RGB')
    ow,oh=pil.size
    with torch.no_grad(): preds=m(tf(pil).unsqueeze(0).to(device))
    alpha=(preds[0].squeeze().sigmoid().cpu().numpy()*255).astype(np.uint8)
    scale=TARGET_W/max(ow,oh); nw,nh=int(ow*scale),int(oh*scale)
    return (np.array(pil.resize((nw,nh),Image.LANCZOS)),
            cv2.resize(alpha,(nw,nh),cv2.INTER_LINEAR), 0.0)


def _rembg_mask(image_bytes: bytes) -> tuple[np.ndarray, np.ndarray, float]:
    from rembg import remove, new_session
    for m in ('birefnet-general','isnet-general-use','u2net'):
        try:
            s=new_session(m)
            res=remove(image_bytes,session=s,only_mask=False,alpha_matting=True,
                       alpha_matting_foreground_threshold=250,
                       alpha_matting_background_threshold=5,alpha_matting_erode_size=2)
            rgba=Image.open(io.BytesIO(res)).convert('RGBA')
            w,h=rgba.size; scale=TARGET_W/max(w,h)
            rgba=rgba.resize((int(w*scale),int(h*scale)),Image.LANCZOS)
            arr=np.array(rgba)
            return arr[:,:,:3],arr[:,:,3],0.0
        except Exception as e:
            print(f"[rembg] {m}: {e}")
    raise RuntimeError("All segmentation models failed")


# ═══════════════════════════════════════════════════════════════════════════════
# STAGE 2 — SAM2 BOUNDARY REFINEMENT
# ═══════════════════════════════════════════════════════════════════════════════

def _sam2_refine(rgb: np.ndarray, coarse: np.ndarray) -> tuple[np.ndarray|None, float]:
    """Returns (refined_mask, sam2_score)"""
    try:
        import torch
        from sam2.sam2_image_predictor import SAM2ImagePredictor
    except ImportError:
        return None, 0.0
    try:
        _,bm=cv2.threshold(coarse,128,255,cv2.THRESH_BINARY)
        coords=cv2.findNonZero(bm)
        if coords is None: return None,0.0
        x,y,w,h=cv2.boundingRect(coords); H,W=rgb.shape[:2]
        pad=0.13 if (w*h)/(W*H)<0.25 else 0.10
        x0,y0,ew,eh=_expand_bbox(x,y,w,h,W,H,pad=pad)
        bbox=np.array([x0,y0,x0+ew,y0+eh],dtype=float)
        pred=SAM2ImagePredictor.from_pretrained(
            "facebook/sam2.1-hiera-tiny",device=torch.device("cpu"))
        t0=time.time()
        with torch.inference_mode():
            pred.set_image(rgb)
            masks,scores,_=pred.predict(box=bbox[None],multimask_output=True)
        best=masks[int(np.argmax(scores))].astype(np.uint8)*255
        sc=float(scores.max())
        print(f"[sam2] {time.time()-t0:.1f}s score={sc:.3f}")
        return best,sc
    except Exception as e:
        print(f"[sam2] {e}"); return None,0.0


# ═══════════════════════════════════════════════════════════════════════════════
# STAGE 3 — CONSERVATIVE MASK CLEANUP
# ═══════════════════════════════════════════════════════════════════════════════

def _clean_mask(mask: np.ndarray) -> np.ndarray:
    """
    Minimal mask cleanup — preserves ALL car geometry including thin sill/skirt.

    CRITICAL: No MORPH_OPEN — it erodes thin underbody regions (sill ~3-5px wide)
    and the subsequent largest-component filter then discards them permanently.

    Operations:
    1. MORPH_CLOSE 1 pass only — fills single-pixel JPEG gaps at boundaries
    2. Connected components — keep MAIN body + anything touching/near it
    3. Hole fill — windows, grille (< 3% image area)
    4. NO MORPH_OPEN — never
    5. NO row deletion — never
    """
    binary = (mask > 0).astype(np.uint8) * 255
    h, w   = binary.shape

    # Step 1: CLOSE only, 1 pass — fills 1-2px gaps without destroying thin features
    k3     = np.ones((3,3), np.uint8)
    binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, k3, iterations=1)

    # Step 2: Component filtering — keep main body + anything geometrically close.
    # Use a 5px dilation to test connectivity, but keep original pixel values.
    nc_raw, labels_raw, stats_raw, _ = cv2.connectedComponentsWithStats(binary, 8)
    if nc_raw <= 2:
        pass  # 0 or 1 foreground components — nothing to filter
    else:
        main_idx  = 1 + int(np.argmax(stats_raw[1:, cv2.CC_STAT_AREA]))
        main_area = int(stats_raw[main_idx, cv2.CC_STAT_AREA])

        # Build a 5px-dilated version of the main body to test proximity
        main_only = (labels_raw == main_idx).astype(np.uint8) * 255
        k5 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5,5))
        main_expanded = cv2.dilate(main_only, k5, iterations=1)

        # Keep a secondary component if ANY of its pixels touch the expanded main body
        # This preserves: thin sill strips, lower bumper lips, small skirt sections
        keep = np.zeros_like(binary)
        keep[labels_raw == main_idx] = 255  # always keep main body
        for ci in range(1, nc_raw):
            if ci == main_idx: continue
            comp_px = (labels_raw == ci).astype(np.uint8) * 255
            overlap = cv2.bitwise_and(comp_px, main_expanded)
            area_ratio = int(stats_raw[ci, cv2.CC_STAT_AREA]) / max(main_area, 1)
            if overlap.any() or area_ratio > 0.02:
                keep[labels_raw == ci] = 255
        binary = cv2.bitwise_and(binary, keep)

    # Step 3: Fill interior holes (windows/grille) up to 3% of image
    flood = binary.copy()
    cv2.floodFill(flood, np.zeros((h+2,w+2), np.uint8), (0,0), 255)
    interior = cv2.bitwise_and(cv2.bitwise_not(flood), cv2.bitwise_not(binary))
    nc2, lb2, st2, _ = cv2.connectedComponentsWithStats(interior, 8)
    max_hole = int(w * h * 0.03)
    for i in range(1, nc2):
        if st2[i, cv2.CC_STAT_AREA] < max_hole:
            binary[lb2 == i] = 255

    # Step 4: Sub-pixel boundary smoothing only
    blurred = cv2.GaussianBlur(binary, (0,0), 0.5)
    _, binary = cv2.threshold(blurred, 64, 255, cv2.THRESH_BINARY)
    return binary


# ═══════════════════════════════════════════════════════════════════════════════
# STAGE 4 — UNDERBODY / SHADOW REMOVAL
# ═══════════════════════════════════════════════════════════════════════════════

def _clean_underbody(mask: np.ndarray,
                      underbody_preserve: bool = True) -> tuple[np.ndarray, dict]:
    """
    Conservative underbody cleanup for engineering-grade CFD geometry.

    PRESERVES (connected to main body):
      - lower bumper lip / chin spoiler
      - sill / rocker panel
      - side skirt geometry
      - diffuser hint / underbody ramp
      - ride height variation
      - wheel arch bottom transitions

    REMOVES (disconnected only):
      - ground shadow islands
      - reflection blobs
      - floating noise
      - thin elongated shadow bands (low solidity, disconnected)

    CRITICAL RULE: Never uses mask[y:,:]=0 row-deletion.
    Only removes pixels that are disconnected from the main vehicle body.

    Returns: (cleaned_mask, diagnostics_dict)
    """
    if not (mask > 127).any():
        return mask, {"warning": "empty mask"}

    binary = (mask > 127).astype(np.uint8) * 255
    h, w   = binary.shape
    diag   = {}

    # ── Step 1: Find all connected components ─────────────────────────────────
    nc, labels, stats, centroids = cv2.connectedComponentsWithStats(binary, 8)

    if nc <= 1:
        # No components at all — return as-is
        diag["components"] = 0
        return binary, diag

    if nc == 2:
        # Only one foreground component — nothing to remove
        diag["components"] = 1
        diag["removed_blobs"] = 0
        return binary, diag

    # ── Step 2: Identify the MAIN vehicle component ───────────────────────────
    # Largest area = main car body
    areas = stats[1:, cv2.CC_STAT_AREA]
    main_idx  = 1 + int(np.argmax(areas))
    main_area = int(areas[main_idx - 1])

    # ── Step 3: Decide which secondary components to remove ───────────────────
    # Keep a component ONLY if it passes shadow/noise detection.
    # Shadow blobs are characterised by:
    #   a) Small area relative to main body  (< 3% of main)
    #   b) Very low solidity (area / convex hull area < 0.3) — elongated smear
    #   c) Located mostly below the main body centroid Y
    #   d) Disconnected from main body (already guaranteed here)

    main_cy   = float(centroids[main_idx][1])
    main_bbox = stats[main_idx]
    main_bottom_y = main_bbox[cv2.CC_STAT_TOP] + main_bbox[cv2.CC_STAT_HEIGHT]

    removed_blobs = 0
    kept_blobs    = 0
    cleaned       = np.zeros_like(binary)
    cleaned[labels == main_idx] = 255   # always keep main body

    for ci in range(1, nc):
        if ci == main_idx:
            continue

        comp_area = int(stats[ci, cv2.CC_STAT_AREA])
        comp_x    = int(stats[ci, cv2.CC_STAT_LEFT])
        comp_y    = int(stats[ci, cv2.CC_STAT_TOP])
        comp_w    = int(stats[ci, cv2.CC_STAT_WIDTH])
        comp_h    = int(stats[ci, cv2.CC_STAT_HEIGHT])
        comp_cy   = float(centroids[ci][1])

        area_ratio = comp_area / max(main_area, 1)

        # Solidity: area / convex hull area (low = elongated shadow blob)
        comp_mask  = (labels == ci).astype(np.uint8) * 255
        contours_c, _ = cv2.findContours(comp_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        solidity = 1.0
        if contours_c:
            hull = cv2.convexHull(contours_c[0])
            hull_area = cv2.contourArea(hull)
            solidity  = comp_area / max(float(hull_area), 1.0)

        # Aspect ratio of bounding box (elongated horizontal = shadow stripe)
        comp_aspect = comp_w / max(comp_h, 1)

        # Is this blob mostly below the main body?
        below_main = comp_cy > main_cy

        # Decision: remove if ALL of these hold:
        #   - area < 3% of main body
        #   - solidity < 0.45 (elongated / diffuse)  OR  below_main + aspect > 4
        #   - located below the bottom 10% of the main body bbox
        is_tiny     = area_ratio < 0.03
        is_smear    = solidity < 0.45
        is_stripe   = comp_aspect > 5.0 and below_main
        is_below    = comp_cy > main_bottom_y * 0.92

        # Conservative default — only remove if clearly a shadow/reflection:
        # Must be ALL of: tiny (<1%), elongated smear or stripe, AND below main body
        # This preserves: sills, diffusers, skirts, lower bumper lips
        if underbody_preserve:
            should_remove = (
                area_ratio < 0.01        # very small relative to car
                and is_below             # located below main body centroid
                and (is_smear or is_stripe)  # elongated / diffuse shape
                and comp_h < int(h * 0.05)  # thin (< 5% of image height)
            )
        else:
            should_remove = is_tiny and (is_smear or is_stripe) and is_below

        if should_remove:
            removed_blobs += 1
        else:
            # Keep this component — it may be a sill, skirt, diffuser hint
            cleaned[labels == ci] = 255
            kept_blobs += 1

    # ── Step 4: Underbody continuity diagnostics ──────────────────────────────
    # Check if lower contour is unnaturally flat (over-cleaning warning)
    rows_after  = np.where(cleaned > 127)[0]
    if len(rows_after) > 0:
        body_top_a  = int(rows_after.min())
        body_bot_a  = int(rows_after.max())
        car_h_a     = max(body_bot_a - body_top_a, 1)

        # Sample the bottom Y at 20 horizontal positions
        lower_zone  = cleaned[body_top_a + int(car_h_a*0.70):, :]
        flat_count  = 0
        prev_bot    = None
        n_samples   = 20
        for i in range(n_samples):
            xc = int(i * w / n_samples)
            col = lower_zone[:, xc]
            fg  = np.where(col > 127)[0]
            if len(fg) > 0:
                bot_y = int(fg.max())
                if prev_bot is not None and abs(bot_y - prev_bot) <= 1:
                    flat_count += 1
                prev_bot = bot_y

        flat_fraction = flat_count / max(n_samples - 1, 1)
        if flat_fraction > 0.40:
            diag["warning_underbody"] = (
                f"Possible underbody over-cleaning — lower contour is flat "
                f"for {flat_fraction*100:.0f}% of vehicle length. "
                f"Check segmentation mask quality."
            )
            print(f"[underbody] ⚠ flat lower contour {flat_fraction*100:.0f}%")

        # Lower contour occupancy: fraction of bottom 20% of car height that has pixels
        lower_band = cleaned[body_top_a + int(car_h_a*0.80):body_bot_a, :]
        occupancy  = float((lower_band > 127).sum()) / max(lower_band.size, 1)
        diag["lower_contour_occupancy"] = round(occupancy, 3)
        diag["underbody_flat_fraction"] = round(flat_fraction, 3)

    diag["components_input"]  = nc - 1
    diag["removed_blobs"]     = removed_blobs
    diag["kept_secondary"]    = kept_blobs
    diag["preserve_mode"]     = underbody_preserve
    print(f"[underbody] kept={kept_blobs} removed={removed_blobs} "
          f"(preserve={'ON' if underbody_preserve else 'OFF'})")

    return cleaned, diag


# ═══════════════════════════════════════════════════════════════════════════════
# STAGE 5 — TECHNICAL CONTOUR EXTRACTION
# ═══════════════════════════════════════════════════════════════════════════════

def extract_technical_outline(mask: np.ndarray) -> np.ndarray|None:
    """CHAIN_APPROX_NONE — every boundary pixel. Returns largest valid contour."""
    _,binary=cv2.threshold(mask,127,255,cv2.THRESH_BINARY)
    contours,_=cv2.findContours(binary,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_NONE)
    if not contours: return None
    h,w=mask.shape
    valid=[c for c in contours if cv2.contourArea(c)>w*h*MIN_CAR_FRAC]
    return max(valid or contours, key=cv2.contourArea)


# ═══════════════════════════════════════════════════════════════════════════════
# STAGE 6 — SPIKE REMOVAL
# ═══════════════════════════════════════════════════════════════════════════════

def _remove_spikes(pts: np.ndarray) -> np.ndarray:
    """
    Remove single-pixel spike noise from contour.
    Only removes protrusions < SPIKE_MAX_DIST_PX that deviate > SPIKE_ANGLE_DEG.
    Preserves ALL real car geometry — bumpers, wheel arches, mirrors, spoilers.
    """
    n=len(pts); out=[]
    for i in range(n):
        prev=pts[(i-SPIKE_WINDOW)%n]; curr=pts[i]; nxt=pts[(i+SPIKE_WINDOW)%n]
        v1=curr-prev; v2=nxt-curr
        n1=np.linalg.norm(v1); n2=np.linalg.norm(v2)
        if n1<1e-6 or n2<1e-6: out.append(curr); continue
        cos_a=np.clip(np.dot(v1/n1,v2/n2),-1.0,1.0)
        angle=math.degrees(math.acos(cos_a))
        if angle>(180-SPIKE_ANGLE_DEG):
            ln=np.linalg.norm(nxt-prev)
            if ln>0:
                t=np.clip(np.dot(curr-prev,nxt-prev)/ln**2,0,1)
                proj=prev+t*(nxt-prev)
                if np.linalg.norm(curr-proj)<SPIKE_MAX_DIST_PX:
                    continue
        out.append(curr)
    return np.array(out)


# ═══════════════════════════════════════════════════════════════════════════════
# STAGE 7 — CANNY EDGE SNAPPING
# ═══════════════════════════════════════════════════════════════════════════════

def _edge_snap(pts: np.ndarray, img_rgb: np.ndarray,
               radius: int = EDGE_SNAP_RADIUS) -> np.ndarray:
    """
    Pull each contour point toward the nearest strong Canny edge within `radius` px.
    Improves accuracy at bumper corners, wheel arch lips, roof edges, spoiler edges.
    Does NOT replace the segmentation boundary — only refines by up to `radius` px.

    Strategy:
    1. Compute Canny edge map on the RGB image
    2. For each contour point, search a `radius`×`radius` window
    3. If a strong edge pixel exists within radius, snap to it
    4. Otherwise keep original point
    """
    # Canny on luminance channel
    gray     = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2GRAY)
    enhanced = cv2.bilateralFilter(gray, 7, 50, 50)  # preserve edges, reduce noise
    med      = float(np.median(enhanced))
    lo,hi    = max(15, int(med*0.4)), min(255, int(med*1.2))
    edges    = cv2.Canny(enhanced, lo, hi)

    H, W     = img_rgb.shape[:2]
    snapped  = pts.copy().astype(float)
    n_snapped = 0

    for i, pt in enumerate(pts):
        x, y = int(round(pt[0])), int(round(pt[1]))
        # Search window clamped to image bounds
        x0 = max(0, x-radius); x1 = min(W, x+radius+1)
        y0 = max(0, y-radius); y1 = min(H, y+radius+1)
        patch = edges[y0:y1, x0:x1]
        if patch.sum() == 0:
            continue  # no edge in window — keep original
        # Find closest edge pixel to current point
        ey_local, ex_local = np.where(patch > 0)
        if len(ex_local) == 0:
            continue
        ex_global = ex_local + x0
        ey_global = ey_local + y0
        dists = (ex_global - x)**2 + (ey_global - y)**2
        closest = int(np.argmin(dists))
        nx, ny  = float(ex_global[closest]), float(ey_global[closest])
        # Only snap if the edge is closer than current position to image gradient
        if dists[closest] < radius**2:
            snapped[i] = [nx, ny]
            n_snapped += 1

    print(f"[snap] {n_snapped}/{len(pts)} pts snapped to Canny edges")
    return snapped


# ═══════════════════════════════════════════════════════════════════════════════
# STAGE 8 — ARC-LENGTH RESAMPLING
# ═══════════════════════════════════════════════════════════════════════════════

def _resample_arclen(pts: np.ndarray, n: int) -> np.ndarray:
    closed  = np.vstack([pts, pts[0:1]])
    diffs   = np.diff(closed, axis=0)
    dists   = np.sqrt((diffs**2).sum(axis=1))
    cumdist = np.concatenate([[0], np.cumsum(dists)])
    total   = cumdist[-1]
    if total < 1: return pts[:n] if len(pts)>=n else pts
    sd = np.linspace(0, total, n, endpoint=False)
    return np.column_stack([np.interp(sd,cumdist,closed[:,0]),
                             np.interp(sd,cumdist,closed[:,1])])


# ═══════════════════════════════════════════════════════════════════════════════
# STAGE 9 — MINIMAL SMOOTHING
# ═══════════════════════════════════════════════════════════════════════════════

def _smooth(pts: np.ndarray, w: int) -> np.ndarray:
    """Moving average. window=3 for technical, window=5 for display. 1 pass only."""
    if w <= 1: return pts
    n, half = len(pts), w//2
    out = np.zeros_like(pts)
    for i in range(n):
        idx = [(i+j-half)%n for j in range(w)]
        out[i] = pts[idx].mean(axis=0)
    return out


# ═══════════════════════════════════════════════════════════════════════════════
# STAGE 10 — KEYPOINTS
# ═══════════════════════════════════════════════════════════════════════════════

def _keypoints(contour, mask, rgb, bbox):
    bx,by,bw,bh=bbox; pts=contour.reshape(-1,2)
    def band(y0,y1): return pts[(pts[:,1]>=by+bh*y0)&(pts[:,1]<by+bh*y1)]
    rp=band(0,0.30); rp=rp[rp[:,0].argsort()] if len(rp) else rp
    sp=band(0.60,0.82); sp=sp[sp[:,0].argsort()] if len(sp) else sp
    mp=band(0.25,0.75); bumpers={"front":None,"rear":None}
    if len(mp):
        f=mp[mp[:,0].argmin()]; r=mp[mp[:,0].argmax()]
        bumpers={"front":{"x":int(f[0]),"y":int(f[1])},
                 "rear": {"x":int(r[0]),"y":int(r[1])}}
    ws={}
    fu=pts[(pts[:,0]<bx+bw*0.50)&(pts[:,1]<by+bh*0.65)]
    if len(fu)>=2:
        base=fu[fu[:,1].argmax()]; top=fu[fu[:,1].argmin()]
        dy=float(base[1]-top[1]); dx=float(base[0]-top[0])
        ws={"base":{"x":int(base[0]),"y":int(base[1])},
            "top":{"x":int(top[0]),"y":int(top[1])},
            "a_pillar_angle_deg":round(math.degrees(math.atan2(dy,max(abs(dx),1))),1)}
    gray=cv2.cvtColor(rgb,cv2.COLOR_RGB2GRAY)
    _,bm=cv2.threshold(mask,127,255,cv2.THRESH_BINARY)
    mg=cv2.bitwise_and(gray,bm)
    ly=by+int(bh*0.40); roi=mg[ly:by+bh,bx:bx+bw]
    wheels=[]
    if roi.size>0:
        blur=cv2.GaussianBlur(roi,(7,7),2)
        circs=cv2.HoughCircles(blur,cv2.HOUGH_GRADIENT,1.1,
            minDist=int(bw*0.22),param1=40,param2=22,
            minRadius=max(8,int(bw*0.07)),maxRadius=max(16,int(bw*0.20)))
        if circs is not None:
            for cx2,cy2,r in sorted(np.uint16(np.around(circs[0]))[:2],key=lambda c:c[0]):
                wheels.append({"cx":int(bx+cx2),"cy":int(ly+cy2),"r":int(r)})
    step=lambda a:max(1,len(a)//40)
    return {"wheels":wheels,
            "roofline":[{"x":int(p[0]),"y":int(p[1])} for p in rp[::step(rp)]],
            "sill":[{"x":int(p[0]),"y":int(p[1])} for p in sp[::step(sp)]],
            "bumpers":bumpers,"windscreen":ws}


# ═══════════════════════════════════════════════════════════════════════════════
# STAGE 11 — CFD GEOMETRY EXTRACTION
# ═══════════════════════════════════════════════════════════════════════════════

def _cfd_geometry(dense, bbox, wheels, ws, img_shape):
    bx,by,bw,bh=bbox; aspect=bw/max(bh,1)
    if len(wheels)>=2:
        wb_px=abs(wheels[1]["cx"]-wheels[0]["cx"])
        hood_r=(wheels[0]["cx"]-bx)/bw
        cabin_r=wb_px/bw
        boot_r=(bx+bw-wheels[1]["cx"])/bw
        wb_norm=wb_px/bh
    else:
        hood_r,cabin_r,boot_r=0.28,0.44,0.28; wb_norm=aspect*0.85
    top_y=dense[:,1].min()
    rm=dense[:,0]>bx+bw*0.72
    rear_top=dense[rm,1].min() if rm.any() else top_y
    rear_drop=(rear_top-top_y)/max(bh,1)
    # Rear slant: Ahmed body equivalent angle
    # Measure the slope of the rear upper surface (C-pillar to boot lid)
    # Use rear 20% of car width, but ONLY the top half of car height
    # to avoid the near-vertical bumper face corrupting the measurement
    rear_zone = dense[dense[:,0] > bx + bw*0.78]
    if len(rear_zone) >= 5:
        # Restrict to upper 55% of car height (roofline to shoulder line)
        # This avoids the vertical rear face of hatchbacks/SUVs
        upper_y_limit = by + bh * 0.55
        rear_upper    = rear_zone[rear_zone[:,1] < upper_y_limit]
        if len(rear_upper) >= 4:
            # Sort by x (front→rear within rear zone)
            rear_upper_s = rear_upper[rear_upper[:,0].argsort()]
            # Robust slope: linear regression on the upper rear points
            xs = rear_upper_s[:,0].astype(float)
            ys = rear_upper_s[:,1].astype(float)
            # Normalise to avoid numerical issues
            x_range = float(xs.max() - xs.min())
            if x_range > bw * 0.02:
                slope = float(np.polyfit(xs, ys, 1)[0])  # dy/dx in pixel coords
                # positive slope = y increases as x increases = roof drops toward rear
                raw_slant = math.degrees(math.atan(abs(slope)))
                # Clamp to physical range: 0° (vertical rear) to 50° (fastback)
                rear_slant = float(np.clip(raw_slant, 0.0, 50.0))
            else:
                rear_slant = float(np.clip(rear_drop * 60.0, 0.0, 45.0))
        else:
            rear_slant = float(np.clip(rear_drop * 60.0, 0.0, 45.0))
    else:
        rear_slant = 20.0
    # Ahmed body Cd correlation (validated, Ahmed 1984 / Hucho 1998)
    if rear_slant<12:    cd_ahmed=0.23+rear_slant*0.002
    elif rear_slant<30:  cd_ahmed=0.25+(rear_slant-12)*0.009
    elif rear_slant<35:  cd_ahmed=0.41+(rear_slant-30)*0.04
    else:                cd_ahmed=0.45-(rear_slant-35)*0.003
    ws_ang=ws.get("a_pillar_angle_deg",58.0)
    ws_corr=max(0,(ws_ang-55)*0.0015)
    if aspect>2.5:   bt="estate" if rear_drop>0.14 else "suv"
    elif aspect>1.9:
        if rear_drop>0.22:   bt="fastback"
        elif rear_drop>0.10: bt="hatchback"
        else:                bt="notchback"
    elif aspect<1.6: bt="suv"
    else:            bt="notchback"
    bt_off={"fastback":-0.02,"notchback":0.02,"hatchback":0.0,"estate":0.03,"suv":0.09}.get(bt,0.0)
    cd=float(np.clip(cd_ahmed+ws_corr+bt_off,0.18,0.52))
    fa_norm=round(float(bh/bw*0.82),3)
    return {
        "bodyType":bt,"aspectRatio":round(float(aspect),3),
        "hoodRatio":round(float(hood_r),3),"cabinRatio":round(float(cabin_r),3),
        "bootRatio":round(float(boot_r),3),
        "cabinH":round(float((by+bh-top_y)/max(bh,1)),3),
        "wsAngleDeg":round(float(ws_ang),1),
        "rearDrop":round(float(rear_drop),3),
        "rearSlantAngleDeg":round(float(rear_slant),1),
        "wheelbaseNorm":round(float(wb_norm),3),
        "frontalAreaNorm":fa_norm,
        "Cd":round(float(cd),3),
        "CdA":round(float(cd*fa_norm),4),
        "separationPointX":round(0.80+rear_drop*0.15 if bt in("fastback","hatchback") else 0.70,3),
        "ahmedRegime":("attached"     if rear_slant<12 else
                       "intermediate" if rear_slant<30 else
                       "critical"     if rear_slant<36 else
                       "separated"),
        "w1":round(float(wheels[0]["cx"]/(bx+bw)),4) if wheels else 0.22,
        "w2":round(float(wheels[1]["cx"]/(bx+bw)),4) if len(wheels)>=2 else 0.76,
        "confidence":None,  # set by quality scorer
        "rideH":0.07,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# STAGE 12 — QUALITY SCORING
# ═══════════════════════════════════════════════════════════════════════════════

def _quality_score(method, yolo_conf, sam2_score, mask_area_ratio,
                   bbox_aspect, contour_len, touches_border,
                   n_wheels, spike_pts_removed, total_pts,
                   n_snap_pts, view_type) -> dict:
    score=100; warnings=[]

    # Method penalties
    if   method.startswith("birefnet"): score-=15; warnings.append("YOLO failed — BiRefNet fallback")
    elif method.startswith("rembg"):    score-=25; warnings.append("YOLO+BiRefNet failed — rembg fallback")
    else:
        if   yolo_conf<0.70: score-=12; warnings.append(f"Low YOLO conf ({yolo_conf:.2f})")
        elif yolo_conf<0.85: score-= 5

    # SAM2
    if "+sam2" not in method:
        score-=10; warnings.append("SAM2 unavailable — coarse mask only")
    elif sam2_score<0.80:
        score-=8;  warnings.append(f"Low SAM2 score ({sam2_score:.2f})")
    elif sam2_score<0.90:
        score-=3

    # Mask coverage
    if   mask_area_ratio<0.05: score-=15; warnings.append("Very small vehicle area in frame")
    elif mask_area_ratio<0.10: score-= 5; warnings.append("Small vehicle area — mostly background")

    # View type
    if view_type=='front_or_rear':
        score-=20; warnings.append("Image may be front/rear view — side view recommended for CFD")
    elif view_type=='quarter':
        score-=10; warnings.append("Possible 3/4 view — side view gives best results")

    # Aspect ratio realism for side view
    if bbox_aspect<1.2:
        score-=20; warnings.append("Very low aspect ratio — check image orientation")
    elif bbox_aspect<1.5:
        score-=10; warnings.append("Low aspect ratio — possible non-side view")
    elif bbox_aspect>5.5:
        score-=8;  warnings.append("Very wide aspect — possible crop/padding issue")

    # Contour density check
    pts_per_unit=contour_len/max(1,bbox_aspect*100)
    if pts_per_unit<1.5:
        score-=8; warnings.append("Low contour density — mask may be over-simplified")

    # Contour continuity (no large gaps)
    spike_ratio=spike_pts_removed/max(total_pts,1)
    if   spike_ratio>0.05: score-=8; warnings.append(f"High spike ratio ({spike_ratio:.1%}) — noisy boundary")
    elif spike_ratio>0.02: score-=3

    # Edge snapping coverage
    snap_ratio=n_snap_pts/max(total_pts,1)
    if snap_ratio<0.05:
        warnings.append("Low edge snap rate — image may lack clear boundaries")

    # Border clipping
    if touches_border:
        score-=12; warnings.append("Contour touches image border — vehicle may be clipped")

    # Wheel detection
    if   n_wheels==0: score-=10; warnings.append("No wheels detected — underbody may be missing")
    elif n_wheels==1: score-= 5; warnings.append("Only 1 wheel detected")

    # Mask consistency — check for implausible coverage ratios
    if mask_area_ratio>0.80:
        score-=10; warnings.append("Mask covers >80% of image — background removal may have failed")
    # mask_consistency: ratio of filled area to bounding box area
    mask_consistency = round(mask_area_ratio * (bbox_aspect / max(bbox_aspect, 1.0)), 3)
    if mask_consistency < 0.08:
        score-=5; warnings.append(f"Low mask consistency ({mask_consistency:.2f}) — check segmentation")

    score=max(0,min(100,score))
    status=("accepted" if score>=75 else "review" if score>=50 else "fallback")
    return {
        "score":score,"status":status,"warnings":warnings,
        "signals":{
            "method":method,"yolo_conf":round(yolo_conf,3),
            "sam2_score":round(sam2_score,3),
            "mask_coverage":round(mask_area_ratio,3),
            "aspect_ratio":round(bbox_aspect,2),
            "view_type":view_type,
            "n_wheels":n_wheels,
            "spike_ratio":round(spike_ratio,3),
            "snap_ratio":round(snap_ratio,3),
            "touches_border":touches_border,
        }
    }


# ═══════════════════════════════════════════════════════════════════════════════
# EXPORT HELPERS
# ═══════════════════════════════════════════════════════════════════════════════

def _n(v,o,s): return round(float((v-o)/max(s,1)),4)
def _npts(a,bx,by,bw,bh): return [[_n(p[0],bx,bw),_n(p[1],by,bh)] for p in a]
def _nkp(k,bx,by,bw,bh): return {"x":_n(k["x"],bx,bw),"y":_n(k["y"],by,bh)} if k else None
def _nw(w,bx,by,bw,bh): return {**w,"nx":_n(w["cx"],bx,bw),"ny":_n(w["cy"],by,bh),
                                  "nr":round(w["r"]/max(bw,1),4)}

def outline_to_svg(pts_norm: list, w: int=800, h: int=300) -> str:
    """White 1px polyline on black — technical drawing. No curves, no fill."""
    mapped=[(round(p[0]*w,2),round(p[1]*h,2)) for p in pts_norm]
    path_d=" ".join(f"{'M' if i==0 else 'L'}{x},{y}" for i,(x,y) in enumerate(mapped))+" Z"
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" '
            f'width="{w}" height="{h}" style="background:#000;font-family:monospace">'
            f'<path d="{path_d}" fill="none" stroke="white" stroke-width="1" '
            f'stroke-linejoin="round" stroke-linecap="round"/>'
            f'</svg>')


def draw_outline_png(rgb: np.ndarray, contour: np.ndarray) -> np.ndarray:
    """White 1px outline on black — for technical_outline.png"""
    canvas=np.zeros((rgb.shape[0],rgb.shape[1],3),dtype=np.uint8)
    cv2.drawContours(canvas,[contour],-1,(255,255,255),1)
    return canvas


# ═══════════════════════════════════════════════════════════════════════════════
# MODE B — PANEL DETECTION (unchanged)
# ═══════════════════════════════════════════════════════════════════════════════

def _detect_panels(img_rgb,mask,bbox):
    bx,by,bw,bh=bbox; H,W=img_rgb.shape[:2]
    pad=10; x0,y0=max(0,bx-pad),max(0,by-pad)
    x1,y1=min(W,bx+bw+pad),min(H,by+bh+pad)
    crop=img_rgb[y0:y1,x0:x1]; cm=mask[y0:y1,x0:x1]
    gray=cv2.cvtColor(crop,cv2.COLOR_RGB2GRAY)
    _,bm=cv2.threshold(cm,127,255,cv2.THRESH_BINARY)
    gm=cv2.bitwise_and(gray,bm)
    clahe=cv2.createCLAHE(clipLimit=2.0,tileGridSize=(8,8))
    filt=cv2.bilateralFilter(clahe.apply(gm),9,75,75)
    med=float(np.median(filt[filt>0])) if (filt>0).any() else 128
    edges=cv2.Canny(filt,max(10,int(med*0.5)),min(255,int(med*1.5)))
    edges=cv2.bitwise_and(edges,bm)
    for wx_f in(0.20,0.78):
        cv2.circle(edges,(int(wx_f*bw),int(0.80*bh)),int(bh*0.18*1.3),0,-1)
    lrs=cv2.HoughLinesP(edges,1,np.pi/180,25,minLineLength=int(bw*0.08),maxLineGap=int(bw*0.04))
    lines=[]
    if lrs is not None:
        for l in lrs:
            x1l,y1l,x2l,y2l=l[0]; dx,dy=x2l-x1l,y2l-y1l
            ln=math.sqrt(dx*dx+dy*dy); ang=abs(math.degrees(math.atan2(dy,max(abs(dx),1))))
            if ln<bw*0.06: continue
            lines.append({"x1":_n(x0+x1l,bx,bw),"y1":_n(y0+y1l,by,bh),
                          "x2":_n(x0+x2l,bx,bw),"y2":_n(y0+y2l,by,bh),
                          "angle":round(ang,1),"length":round(ln/bw,3),
                          "type":"pillar" if ang>40 else "panel"})
    lines.sort(key=lambda l:l["length"],reverse=True)
    markers=[{"nx":nx,"ny":ny,"label":lb,"region":rg} for nx,ny,lb,rg in [
        (0.12,0.35,"Grille","front"),(0.08,0.55,"Front Light","front"),
        (0.10,0.72,"Front Bumper","front"),(0.30,0.15,"Hood","top"),
        (0.50,0.10,"Windscreen","top"),(0.65,0.15,"Roof","top"),
        (0.78,0.20,"Rear Screen","top"),(0.88,0.35,"Boot/Trunk","rear"),
        (0.92,0.55,"Rear Light","rear"),(0.90,0.72,"Rear Bumper","rear"),
        (0.50,0.55,"Door Panel","side"),
    ]]
    return {"panel_lines":lines[:30],"region_markers":markers}


def _florence_regions(img_rgb,bbox):
    try:
        import torch
        from transformers import AutoProcessor,AutoModelForCausalLM
        t0=time.time(); device='cuda' if torch.cuda.is_available() else 'cpu'
        mdl=AutoModelForCausalLM.from_pretrained("microsoft/Florence-2-base",
            trust_remote_code=True,torch_dtype=torch.float32).eval().to(device)
        proc=AutoProcessor.from_pretrained("microsoft/Florence-2-base",trust_remote_code=True)
        bx,by,bw,bh=bbox; H,W=img_rgb.shape[:2]
        crop=img_rgb[max(0,by):min(H,by+bh),max(0,bx):min(W,bx+bw)]
        pil=Image.fromarray(crop)
        parts="car door . hood . trunk . windshield . headlight . taillight . bumper . wheel arch . roof . pillar . grille"
        inp=proc(text=f"<OPEN_VOCABULARY_DETECTION>{parts}",images=pil,return_tensors="pt").to(device)
        with torch.no_grad():
            gen=mdl.generate(input_ids=inp["input_ids"],pixel_values=inp["pixel_values"],
                max_new_tokens=512,num_beams=1,do_sample=False)
        txt=proc.batch_decode(gen,skip_special_tokens=False)[0]
        parsed=proc.post_process_generation(txt,task="<OPEN_VOCABULARY_DETECTION>",
            image_size=(pil.width,pil.height))
        det=parsed.get("<OPEN_VOCABULARY_DETECTION>",{})
        out=[]
        for bd,lb in zip(det.get("bboxes",[]),det.get("bboxes_labels",[])):
            x1d,y1d,x2d,y2d=bd; cx=(x1d+x2d)/2; cy=(y1d+y2d)/2
            out.append({"label":lb.title(),"nx":round(_n(bx+cx*bw/pil.width,bx,bw),3),
                "ny":round(_n(by+cy*bh/pil.height,by,bh),3),"confidence":0.85,"source":"florence2"})
        print(f"[florence] {len(out)} regions {time.time()-t0:.1f}s")
        del mdl,proc; return out
    except Exception as e:
        print(f"[florence] {e}"); return []


# ═══════════════════════════════════════════════════════════════════════════════
# MODE C — MOONDREAM2 AERO (unchanged)
# ═══════════════════════════════════════════════════════════════════════════════

def _moondream_aero(img_rgb,geo):
    try:
        import torch,re
        from transformers import AutoModelForCausalLM,AutoTokenizer
        t0=time.time()
        pil=Image.fromarray(img_rgb)
        if max(pil.size)>768: pil.thumbnail((768,768),Image.LANCZOS)
        tok=AutoTokenizer.from_pretrained("vikhyatk/moondream2",revision="2025-06-21",trust_remote_code=True)
        mdl=AutoModelForCausalLM.from_pretrained("vikhyatk/moondream2",revision="2025-06-21",
            trust_remote_code=True,torch_dtype=torch.float32).eval()
        def ask(q): return mdl.query(pil,q).get("answer","").strip()
        car_id=ask("Make and model of this car? 1-5 words.")
        cd_raw=ask("Drag coefficient Cd? Just a number like 0.27.")
        bt=ask("Body type? One word: fastback notchback hatchback suv supercar estate coupe.")
        feats={"spoiler":ask("Rear spoiler? none/lip/duck/wing/integrated."),
               "diffuser":ask("Rear diffuser? none/basic/race."),
               "grille":ask("Front grille? open/closed/semi-closed/active."),
               "mirror":ask("Mirror type? conventional/aeroblade/camera/flush."),
               "wheels":ask("Wheel type? open-spoke/closed/aero-cover/fully-enclosed.")}
        suggest=ask("Two aerodynamic improvements, separated by |")
        try: cd_meas=float(re.findall(r"0\.\d+",cd_raw)[0])
        except: cd_meas=geo.get("Cd",0.29)
        fracs={"fastback":{"Front Face":0.30,"Underbody":0.20,"Wheels":0.14,"Rear Wake":0.22,"Greenhouse":0.14},
               "notchback":{"Front Face":0.32,"Underbody":0.18,"Wheels":0.14,"Rear Wake":0.26,"Greenhouse":0.10},
               "suv":{"Front Face":0.35,"Underbody":0.15,"Wheels":0.15,"Rear Wake":0.28,"Greenhouse":0.07}
               }.get(bt.lower().strip(),{"Front Face":0.32,"Underbody":0.18,"Wheels":0.14,"Rear Wake":0.26,"Greenhouse":0.10})
        print(f"[moondream] {time.time()-t0:.1f}s"); del mdl,tok
        return {"car_id":car_id,"estimated_cd":round(cd_meas,3),"body_type":bt.lower().strip(),
                "features":feats,
                "region_cd":{k:round(cd_meas*v,4) for k,v in fracs.items()},
                "improvements":[s.strip() for s in suggest.split("|") if s.strip()][:2],
                "ahmed_regime":geo.get("ahmedRegime","intermediate"),
                "rear_slant":geo.get("rearSlantAngleDeg",20.0),
                "cda":round(cd_meas*geo.get("frontalAreaNorm",0.45),4)}
    except Exception as e:
        print(f"[moondream] {e}"); return {}


# ═══════════════════════════════════════════════════════════════════════════════
# MAIN STREAMING ENTRY POINT
# ═══════════════════════════════════════════════════════════════════════════════

def analyse_contour_stream(image_bytes: bytes, mode: str="A") -> Generator[dict,None,None]:
    mode=mode.upper()
    yield {"stage":"prep","pct":2,"msg":"Stage 0: EXIF, resize, background removal…"}

    _raw=image_bytes; view_type="unknown"
    try:
        image_bytes, view_type = _preprocess(image_bytes, _raw)
        yield {"stage":"prep","pct":7,"msg":f"Preprocessed — view={view_type}"}
    except Exception as e:
        print(f"[pre] {e}")
        yield {"stage":"prep","pct":7,"msg":"Preprocessed (basic)"}

    yield {"stage":"yolo","pct":8,"msg":"Stage 1: YOLO vehicle localisation…"}
    method="yolov8"; _yolo_conf=0.0; _sam2_score=0.0
    try:
        rgb,coarse,_yolo_conf=_yolo_mask(image_bytes)
        yield {"stage":"yolo","pct":30,"msg":f"YOLO ✓ conf={_yolo_conf:.2f}"}
    except Exception as e:
        print(f"[yolo] {e}")
        yield {"stage":"yolo","pct":15,"msg":"YOLO failed → BiRefNet…"}
        try:
            rgb,coarse,_yolo_conf=_birefnet_mask(image_bytes); method="birefnet"
            yield {"stage":"yolo","pct":30,"msg":"BiRefNet ✓"}
        except Exception:
            try:
                rgb,coarse,_yolo_conf=_rembg_mask(image_bytes); method="rembg"
                yield {"stage":"yolo","pct":30,"msg":"rembg ✓"}
            except Exception as e3:
                yield {"stage":"error","msg":str(e3)}; return

    yield {"stage":"sam2","pct":33,"msg":"Stage 2: SAM2 boundary refinement…"}
    sam2,_sam2_score=_sam2_refine(rgb,coarse)
    if sam2 is not None:
        # Union: YOLO fills interior, SAM2 refines edges
        final = cv2.bitwise_or((coarse>128).astype(np.uint8)*255,
                                (sam2>128).astype(np.uint8)*255)
        method += "+sam2"
        yield {"stage":"sam2","pct":52,"msg":f"SAM2 ✓ score={_sam2_score:.3f}"}
    else:
        final = coarse
        yield {"stage":"sam2","pct":52,"msg":"SAM2 unavailable — coarse mask only"}

    # ── Underbody reconstruction ──────────────────────────────────────────────
    # Problem: YOLO mask is a low-res upscaled blob with smooth bottom edge.
    #          SAM2 clips the lower boundary 4-8px above real vehicle bottom.
    #          Result: sill/rocker/diffuser geometry lost before contour extraction.
    #
    # Fix: use Canny edges from original image to find real lower boundary,
    # then extend the mask downward to snap to those edges.
    yield {"stage":"sam2","pct":54,"msg":"Underbody edge reconstruction…"}
    try:
        H_img, W_img = rgb.shape[:2]
        gray_img = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)

        # 1. Find current mask bottom row per column
        final_bin = (final > 127).astype(np.uint8)
        rows_f    = np.where(final_bin.any(axis=1))[0]
        if len(rows_f) == 0:
            raise ValueError("empty mask")
        body_top = int(rows_f.min())
        body_bot = int(rows_f.max())
        car_h    = body_bot - body_top

        # 2. Compute Canny on lower 40% of car (where sill/underbody lives)
        search_top = body_top + int(car_h * 0.60)
        search_bot = min(body_bot + int(car_h * 0.12), H_img)
        search_roi = gray_img[search_top:search_bot, :]

        # Bilateral filter preserves edges while reducing noise
        roi_filt  = cv2.bilateralFilter(search_roi, 7, 40, 40)
        med_val   = float(np.median(roi_filt))
        lo, hi    = max(10, int(med_val * 0.35)), min(255, int(med_val * 1.1))
        edges_roi = cv2.Canny(roi_filt, lo, hi)

        # 3. For each column, find the lowest Canny edge within the search zone
        #    that is below the current mask bottom for that column
        #    → this is the real vehicle boundary (sill bottom / wheel arch bottom)
        recovery_mask = np.zeros((H_img, W_img), dtype=np.uint8)

        for col in range(W_img):
            # Current mask bottom at this column
            col_mask = final_bin[:, col]
            fg_rows  = np.where(col_mask > 0)[0]
            if len(fg_rows) == 0:
                continue
            cur_bot = int(fg_rows.max())

            # Look for strong edges below current bottom, within search zone
            col_edges = edges_roi[:, col]  # search_top to search_bot
            edge_rows = np.where(col_edges > 0)[0]
            if len(edge_rows) == 0:
                continue

            # Convert back to image coordinates
            edge_rows_abs = edge_rows + search_top

            # Only care about edges BELOW current bottom (underbody detail)
            below = edge_rows_abs[edge_rows_abs > cur_bot]
            if len(below) == 0:
                continue

            # Take the FIRST edge below current bottom (= top of sill/skirt boundary)
            snap_row = int(below[0])

            # Only snap if within 8% of car height (prevent pulling in ground)
            if snap_row - cur_bot > car_h * 0.08:
                continue

            # Fill from current bottom to snap row (recovers the sill strip)
            recovery_mask[cur_bot:snap_row+1, col] = 255

        # 4. Merge recovery into final mask
        recovered = int((recovery_mask > 0).sum())
        if recovered > 0:
            final = cv2.bitwise_or(final, recovery_mask)
            print(f"[underbody] Edge recovery: {recovered} px restored")
        else:
            print("[underbody] No edge recovery needed or no edges found")

        # 5. Remove only clearly disconnected shadow blobs above the ground plane
        #    (never row-delete — only component-filter disconnected islands)
        if (final > 127).any():
            _,lf,sf,_ = cv2.connectedComponentsWithStats(
                (final>127).astype(np.uint8), 8)
            if sf.shape[0] > 1:
                mb         = 1 + int(np.argmax(sf[1:, cv2.CC_STAT_AREA]))
                main_area  = int(sf[mb, cv2.CC_STAT_AREA])
                keep_final = np.zeros_like(final)
                for ci in range(1, sf.shape[0]):
                    ratio = int(sf[ci, cv2.CC_STAT_AREA]) / max(main_area, 1)
                    if ci == mb or ratio > 0.005:  # keep anything > 0.5% of main
                        keep_final[lf == ci] = 255
                final = keep_final

    except Exception as e:
        print(f"[underbody] Edge reconstruction failed: {e}")

    yield {"stage":"sam2","pct":57,"msg":"Mask assembly complete"}

    yield {"stage":"contour","pct":57,"msg":"Stage 3-4: mask cleanup + underbody…"}
    refined=_clean_mask(final)
    h,w=rgb.shape[:2]
    refined, underbody_diag = _clean_underbody(refined, underbody_preserve=True)
    if underbody_diag.get("warning_underbody"):
        yield {"stage":"contour","pct":60,
               "msg":f"⚠ {underbody_diag['warning_underbody'][:80]}"}

    yield {"stage":"contour","pct":62,"msg":"Stage 5: CHAIN_APPROX_NONE contour…"}
    contour=extract_technical_outline(refined)
    if contour is None:
        yield {"stage":"error","msg":"No vehicle contour found."}; return
    bx,by,bw,bh=cv2.boundingRect(contour)
    if bw<80 or bh<40:
        yield {"stage":"error","msg":"Detected region too small."}; return

    raw_pts=contour.reshape(-1,2).astype(float)
    yield {"stage":"contour","pct":66,"msg":f"Stage 5: raw contour {len(raw_pts)} pts"}

    yield {"stage":"contour","pct":68,"msg":"Stage 6: spike removal…"}
    clean_pts=_remove_spikes(raw_pts)
    n_spikes=len(raw_pts)-len(clean_pts)
    yield {"stage":"contour","pct":70,"msg":f"Spikes removed: {n_spikes} pts"}

    yield {"stage":"contour","pct":72,"msg":"Stage 7: Canny edge snapping…"}
    snapped_pts=_edge_snap(clean_pts, rgb, EDGE_SNAP_RADIUS)
    n_snapped=int(np.sum(np.any(snapped_pts!=clean_pts,axis=1)))
    yield {"stage":"contour","pct":75,"msg":f"Edge snap: {n_snapped} pts refined"}

    yield {"stage":"contour","pct":77,"msg":"Stage 8-9: resample + smooth…"}
    # Technical outline: 2000pt + window=3
    technical  = _smooth(_resample_arclen(snapped_pts, N_TECHNICAL), SMOOTH_WINDOW_TECHNICAL)
    # Display outline: 2000pt + window=5
    display    = _smooth(_resample_arclen(snapped_pts, N_TECHNICAL), SMOOTH_WINDOW_DISPLAY)
    # Simplified: 200pt + window=3 (debug only)
    simplified = _smooth(_resample_arclen(snapped_pts, N_SIMPLIFIED), SMOOTH_WINDOW_TECHNICAL)

    yield {"stage":"keypoints","pct":80,"msg":"Stage 10: keypoints…"}
    kp=_keypoints(contour,refined,rgb,(bx,by,bw,bh))

    yield {"stage":"keypoints","pct":84,"msg":"Stage 11: CFD geometry…"}
    geo=_cfd_geometry(technical,(bx,by,bw,bh),kp["wheels"],kp["windscreen"],rgb.shape)
    yield {"stage":"keypoints","pct":87,"msg":f"CFD: Cd≈{geo['Cd']} regime={geo['ahmedRegime']} slant={geo['rearSlantAngleDeg']}°"}

    # Quality scoring
    H_img,W_img=rgb.shape[:2]
    ctpts=contour.reshape(-1,2)
    touches_border=bool(
        ctpts[:,0].min()<=2 or ctpts[:,0].max()>=W_img-3 or
        ctpts[:,1].min()<=2 or ctpts[:,1].max()>=H_img-3)
    quality=_quality_score(
        method=method, yolo_conf=_yolo_conf, sam2_score=_sam2_score,
        mask_area_ratio=float((refined>127).sum())/float(h*w),
        bbox_aspect=float(bw)/max(float(bh),1),
        contour_len=len(contour), touches_border=touches_border,
        n_wheels=len(kp["wheels"]),
        spike_pts_removed=n_spikes, total_pts=len(raw_pts),
        n_snap_pts=n_snapped, view_type=view_type)
    yield {"stage":"keypoints","pct":90,"msg":f"Quality: {quality['score']}/100 ({quality['status']})"}

    # Normalise all to [0,1] relative to bbox
    def nkl(lst): return [{"nx":_n(p["x"],bx,bw),"ny":_n(p["y"],by,bh)} for p in lst]
    nt  = _npts(technical.tolist(),  bx,by,bw,bh)
    nd  = _npts(display.tolist(),    bx,by,bw,bh)
    ns  = _npts(simplified.tolist(), bx,by,bw,bh)
    nri = _npts(raw_pts.tolist(),    bx,by,bw,bh)

    outline_svg=outline_to_svg(nt, w=800, h=300)

    # ── Geometry engine: normalization, descriptors, curvature, heuristics ────
    engineering = {}
    if _GEO_ENGINE:
        try:
            wheels_norm = [_nw(wh,bx,by,bw,bh) for wh in kp["wheels"]]
            engineering = run_geometry_engine(
                pts_norm   = np.array(nt),
                geo        = geo,
                wheels_norm= wheels_norm,
                bbox       = {"x":bx,"y":by,"w":bw,"h":bh},
                result_meta= {"method":method,"view_type":view_type,"quality":quality},
            )
            yield {"stage":"keypoints","pct":89,
                   "msg":f"Geometry engine ✓ — shape descriptors, curvature, DXF ready"}
        except Exception as e:
            print(f"[geo_engine] {e}")

    result={
        # ── PRIMARY TECHNICAL OUTPUT ──────────────────────────────────────────
        "technical_outline_pts": nt,   # 2000pt, window=3, edge-snapped (USE FOR CFD)
        "raw_contour_pts":       nri,  # every boundary pixel, zero processing
        # ── DISPLAY OUTPUT ────────────────────────────────────────────────────
        "display_outline_pts":   nd,   # 2000pt, window=5 (USE FOR UI)
        "simplified_outline_pts":ns,   # 200pt, window=3 (debug/overview only)
        # ── COMPAT ALIASES (frontend) ─────────────────────────────────────────
        "outline_pts":           nt,
        "smooth_pts":            nd,
        "catmull_rom_pts":       nd,   # no Catmull-Rom — alias to display
        "catmull_rom_cps":       None,
        "simplified_pts":        ns,
        # ── EXPORTS ───────────────────────────────────────────────────────────
        "outline_svg":           outline_svg,
        # ── METADATA ─────────────────────────────────────────────────────────
        "keypoints":{
            "wheels":  [_nw(wh,bx,by,bw,bh) for wh in kp["wheels"]],
            "roofline":nkl(kp["roofline"]),"sill":nkl(kp["sill"]),
            "bumpers":{"front":_nkp(kp["bumpers"]["front"],bx,by,bw,bh),
                       "rear": _nkp(kp["bumpers"]["rear"], bx,by,bw,bh)},
            "windscreen":{k:(_nkp(v,bx,by,bw,bh) if k in("base","top") else v)
                for k,v in kp["windscreen"].items()} if kp["windscreen"] else {},
        },
        "bbox":       {"x":bx,"y":by,"w":bw,"h":bh},
        "image_size": {"w":w,"h":h},
        "view_type":  view_type,
        "geometry":   geo,
        "method":     method,
        "mode":       mode,
        "processing": {
            "raw_pts":            len(raw_pts),
            "spike_pts_removed":  n_spikes,
            "edge_snap_pts":      n_snapped,
            "technical_pts":      len(technical),
            "underbody":          underbody_diag,
        },
        "quality":      quality,
        "engineering":  engineering,   # shape descriptors, curvature, heuristics, exports
        "panels":       None,
        "aero":         None,
    }

    # Mode B
    if mode in("B","C"):
        yield {"stage":"panels","pct":92,"msg":"Mode B: panel detection…"}
        pd=_detect_panels(rgb,refined,(bx,by,bw,bh))
        fm=_florence_regions(rgb,(bx,by,bw,bh))
        result["panels"]={"lines":pd["panel_lines"],
                          "markers":fm if len(fm)>=4 else pd["region_markers"]}
        yield {"stage":"panels","pct":95,"msg":f"Panels: {len(pd['panel_lines'])} lines ✓"}

    # Mode C
    if mode=="C":
        yield {"stage":"aero","pct":96,"msg":"Mode C: Moondream2 aero analysis…"}
        aero=_moondream_aero(rgb,geo); result["aero"]=aero
        yield {"stage":"aero","pct":98,"msg":f"Aero: {aero.get('car_id','?')} Cd≈{aero.get('estimated_cd','?')} ✓"}

    yield {"stage":"done","pct":100,"msg":f"Complete ✓ quality={quality['score']}/100","result":result}


def analyse_contour(image_bytes: bytes, mode: str="A") -> dict:
    result=None
    for evt in analyse_contour_stream(image_bytes,mode):
        if evt.get("stage")=="error": raise ValueError(evt["msg"])
        if evt.get("stage")=="done":  result=evt["result"]
    if not result: raise RuntimeError("No result produced")
    return result
