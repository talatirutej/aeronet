// AeroNet v2 — Vehicle Outline Analysis
// Copyright (c) 2026 Rutej Talati. All rights reserved.

import { useCallback, useEffect, useRef, useState } from 'react'

const API_BASE =
  (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_API_URL) ||
  'https://rutejtalati16-aeronet.hf.space'

// ── Image prep ────────────────────────────────────────────────────────────────
async function prepareImage(file, maxWidth = 1440, quality = 0.93) {
  return new Promise((resolve) => {
    const img = new window.Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const minW = 900, effMax = Math.max(maxWidth, minW)
      const scale = img.width < minW ? Math.min(3.0, effMax / img.width) : Math.min(1.0, maxWidth / img.width)
      const w = Math.round(img.width * scale), h = Math.round(img.height * scale)
      const c = document.createElement('canvas'); c.width = w; c.height = h
      const ctx = c.getContext('2d')
      ctx.fillStyle = '#fff'; ctx.fillRect(0,0,w,h)
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img,0,0,w,h)
      c.toBlob(b => resolve(new File([b], file.name.replace(/\.[^.]+$/,'.jpg'),{type:'image/jpeg'})),'image/jpeg',quality)
    }
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file) }
    img.src = url
  })
}

async function fetchImageFromUrl(url) {
  const proxies = [u=>u, u=>`https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`, u=>`https://corsproxy.io/?${encodeURIComponent(u)}`]
  for (const proxy of proxies) {
    try {
      const r = await fetch(proxy(url),{signal:AbortSignal.timeout?AbortSignal.timeout(8000):undefined})
      if (!r.ok) continue
      const blob = await r.blob()
      if (!blob.type.startsWith('image/') && !blob.type.includes('octet')) continue
      const filename = url.split('/').pop()?.split('?')[0] || 'car.jpg'
      return new File([blob], filename, {type: blob.type.startsWith('image/') ? blob.type : 'image/jpeg'})
    } catch { continue }
  }
  throw new Error('Could not fetch image — download and upload directly')
}

// ── Generate demo SUV contour points ─────────────────────────────────────────
// Parametric side-view SUV silhouette in normalised [0,1] coordinates.
// These are the same normalised format the backend returns: [nx, ny] where
// 0,0 = top-left of bbox, 1,1 = bottom-right of bbox.
// Generated from a cubic-spline SUV profile with wheel arches cut out.
function makeDemoContour(n = 400) {
  const pts = []
  // Key shape points for a generic SUV side profile (normalised bbox coords)
  // Going clockwise from front-bottom
  const keyPts = [
    // Front bumper base
    [0.02, 0.94],
    // Front bumper face
    [0.00, 0.80],
    // Front bumper top
    [0.02, 0.68],
    // Front hood start
    [0.07, 0.52],
    // Hood mid
    [0.18, 0.25],
    // A-pillar base / windscreen base
    [0.24, 0.22],
    // Windscreen top / roof start
    [0.32, 0.05],
    // Roof mid
    [0.55, 0.02],
    // Roof rear / C-pillar top
    [0.72, 0.05],
    // Rear window
    [0.80, 0.18],
    // Rear pillar base
    [0.86, 0.32],
    // Boot lid
    [0.92, 0.40],
    // Rear bumper top
    [0.98, 0.52],
    // Rear bumper face
    [1.00, 0.70],
    // Rear bumper base
    [0.98, 0.94],
    // Sill rear end
    [0.86, 0.96],
    // Rear arch right
    [0.83, 0.98],
    [0.80, 0.99],
    [0.76, 0.99],
    // Between arches (sill) - dip for rear arch
    [0.75, 0.92],
    [0.72, 0.90],
    // Rear arch left (bottom of arch opening)
    [0.68, 0.88],
    [0.64, 0.90],
    [0.60, 0.92],
    // Sill between wheels
    [0.58, 0.94],
    [0.52, 0.95],
    [0.46, 0.95],
    [0.42, 0.94],
    // Front arch right
    [0.40, 0.92],
    [0.36, 0.90],
    // Front arch bottom
    [0.32, 0.88],
    [0.28, 0.90],
    [0.24, 0.92],
    // Front sill
    [0.22, 0.96],
    [0.18, 0.98],
    [0.14, 0.99],
    [0.10, 0.98],
    [0.06, 0.96],
    // Back to front bumper base
    [0.02, 0.94],
  ]
  // Catmull-Rom spline through key points for smooth outline
  function catmullRom(p0, p1, p2, p3, t) {
    return [
      0.5 * ((2*p1[0]) + (-p0[0]+p2[0])*t + (2*p0[0]-5*p1[0]+4*p2[0]-p3[0])*t*t + (-p0[0]+3*p1[0]-3*p2[0]+p3[0])*t*t*t),
      0.5 * ((2*p1[1]) + (-p0[1]+p2[1])*t + (2*p0[1]-5*p1[1]+4*p2[1]-p3[1])*t*t + (-p0[1]+3*p1[1]-3*p2[1]+p3[1])*t*t*t),
    ]
  }
  const m = keyPts.length
  const segs = m - 1
  const ptsPerSeg = Math.ceil(n / segs)
  for (let i = 0; i < segs; i++) {
    const p0 = keyPts[Math.max(0, i-1)]
    const p1 = keyPts[i]
    const p2 = keyPts[Math.min(m-1, i+1)]
    const p3 = keyPts[Math.min(m-1, i+2)]
    for (let j = 0; j < ptsPerSeg; j++) {
      const t = j / ptsPerSeg
      pts.push(catmullRom(p0, p1, p2, p3, t))
    }
  }
  return pts.slice(0, n)
}
const DEMO_CONTOUR_PTS = makeDemoContour(400)

// ── Demo result (simulate button — no backend call) ───────────────────────────
const DEMO_RESULT = {
  geometry: {
    bodyType:'suv', aspectRatio:2.73, hoodRatio:0.24, cabinRatio:0.52, bootRatio:0.24,
    wsAngleDeg:31, rearDrop:0.25, rearSlantAngleDeg:19, wheelbaseNorm:2.31,
    frontalAreaNorm:0.42, Cd:0.361, CdA:0.1517, rideH:0.112, archDepth:0.408,
    ahmedRegime:'intermediate', separationPointX:0.70, w1:0.22, w2:0.76, confidence:0.97,
  },
  method: 'rmbg2+yolo11+sam2 [DEMO]',
  quality: { score:88, status:'accepted', warnings:[], signals:{} },
  technical_outline_pts: DEMO_CONTOUR_PTS,
  display_outline_pts:   DEMO_CONTOUR_PTS,
  keypoints: {
    wheels: [
      {nx:0.32, ny:0.90, nr:0.068, nrr:0.050, spokes:6},
      {nx:0.76, ny:0.90, nr:0.065, nrr:0.048, spokes:6},
    ],
    roofline:[], sill:[], bumpers:{front:null,rear:null}, windscreen:{},
  },
  processing: { raw_pts:3820, spike_pts_removed:42, edge_snap_pts:1240, technical_pts:2000 },
  bbox: { w:1280, h:480 },
}

// ── Pipeline stages ───────────────────────────────────────────────────────────
const STAGES = [
  { id:'prep',    label:'Preprocess', icon:'⚙',  pct:[0,8]   },
  { id:'rmbg',   label:'RMBG 2.0',   icon:'◉',  pct:[8,28]  },
  { id:'yolo',   label:'YOLO11',     icon:'◎',  pct:[28,42] },
  { id:'sam3',   label:'SAM3',       icon:'⬡',  pct:[42,57] },
  { id:'contour',label:'Contour',    icon:'✦',  pct:[57,72] },
  { id:'keys',   label:'Keypoints',  icon:'⊞',  pct:[72,82] },
  { id:'cfd',    label:'CFD Geom',   icon:'◈',  pct:[82,92] },
  { id:'done',   label:'Complete',   icon:'✓',  pct:[92,100]},
]

const BACKEND_MSGS = [
  [0,  'Stage 0a: EXIF correction, canvas margin, resize to 1536px…', 'Input normalisation'],
  [8,  'Stage 0b: RMBG 2.0 — product-photo foreground extraction…',   'Separating car from background'],
  [18, 'RMBG 2.0 forward pass — BiRefNet architecture, 1024×1024…',   'Neural segmentation in progress'],
  [28, 'Stage 1: YOLO11x-seg — confirming vehicle + bounding box…',   '22% better mAP than YOLOv8'],
  [36, 'YOLO bbox extraction — cross-validating against RMBG mask…',  'Dual-model cross-check'],
  [42, 'Stage 2: SAM3 text-prompted concept refinement…',             '"car body, not floor shadow"'],
  [50, 'SAM3 AND-mask — excluding floor shadows & reflections…',      'Neural shadow exclusion'],
  [57, 'Stage 3-4: underbody edge recovery + ground contact clip…',   'Recovering sill geometry'],
  [62, 'Stage 5: CHAIN_APPROX_NONE — every boundary pixel traced…',   '~4000 raw boundary pixels'],
  [66, 'Stage 6: spike removal — local angle deviation ±3pt window…', 'Preserving bumpers, arches'],
  [70, 'Stage 7: Canny edge snapping — pulling pts to strong edges…', 'Refining to within ±5px'],
  [75, 'Stage 8-9: arc-length resample → 2000pt, window=3 smooth…',  'CFD-grade outline ready'],
  [80, 'Stage 10: Hough circles — wheel centre, rim, spokes…',        'Reading wheel geometry'],
  [84, 'Stage 11: Ahmed body params — Cd, CdA, rear slant…',          'Ahmed 1984 / Hucho 1998'],
  [88, 'Geometry engine: wheelbase norm, curvature, heuristics…',     'Shape descriptors'],
  [92, 'Quality scoring — 10-signal confidence assessment…',          'Checking reliability'],
  [97, 'Finalising SVG, engineering exports, DXF…',                   'Complete — rendering'],
]

// ── CSS ───────────────────────────────────────────────────────────────────────
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&display=swap');
  * { box-sizing:border-box; margin:0; padding:0; }
  :root {
    --blue:#0A84FF; --blue-dim:rgba(10,132,255,0.12); --blue-border:rgba(10,132,255,0.35);
    --sep:rgba(255,255,255,0.07); --bg0:#030608; --bg1:#0a1018;
    --green:#30d158; --amber:#ff9f0a; --red:#ff453a;
    --t1:rgba(255,255,255,0.75); --t2:rgba(255,255,255,0.45); --t3:rgba(255,255,255,0.22);
  }
  body { background:var(--bg0); color:#fff; font-family:'IBM Plex Mono',monospace; overflow:hidden; }

  /* Topbar */
  .topbar { height:42px; background:#050a0f; border-bottom:.5px solid var(--sep);
    display:flex; align-items:center; gap:0; flex-shrink:0; padding:0 10px; overflow:hidden; }
  .tb-brand { font-size:11px; font-weight:700; letter-spacing:.14em; color:var(--blue);
    padding:0 12px 0 2px; border-right:.5px solid var(--sep); margin-right:8px; white-space:nowrap; }
  .tb-stat { display:flex; align-items:center; gap:5px; padding:0 9px;
    border-right:.5px solid var(--sep); white-space:nowrap; }
  .tb-stat .lbl { font-size:8px; color:var(--t3); letter-spacing:.08em; text-transform:uppercase; }
  .tb-stat .val { font-size:11px; font-weight:700; color:var(--blue); }
  .tb-stat .val.g { color:var(--green); } .tb-stat .val.a { color:var(--amber); }
  .tb-spacer { flex:1; }
  .tb-modes { display:flex; align-items:center; gap:2px; padding:0 10px; border-right:.5px solid var(--sep); }
  .tb-mode-btn { padding:3px 9px; border-radius:5px; font-size:9px; font-family:inherit;
    border:none; cursor:pointer; transition:all .12s; letter-spacing:.04em; background:transparent; color:var(--t3); }
  .tb-mode-btn.sel { background:var(--blue-dim); color:var(--blue); font-weight:700; border:.5px solid var(--blue-border); }
  .tb-btn { padding:5px 13px; border-radius:7px; border:none; cursor:pointer; font-family:inherit;
    font-size:11px; font-weight:700; transition:all .15s; display:flex; align-items:center; gap:5px; margin-left:8px; }
  .tb-run { background:var(--blue); color:#fff; }
  .tb-run:hover { filter:brightness(1.1); }
  .tb-run:disabled { background:rgba(255,255,255,0.06); color:var(--t3); cursor:not-allowed; }
  .tb-exp { background:transparent; border:.5px solid rgba(255,255,255,0.12); color:var(--t2); }
  .tb-exp:hover { border-color:rgba(255,255,255,0.3); color:#fff; }

  /* Layout */
  .app-body { display:flex; flex:1; overflow:hidden; min-height:0; }
  .left { width:200px; flex-shrink:0; border-right:.5px solid var(--sep);
    display:flex; flex-direction:column; background:#050a0f; overflow-y:auto; }
  .left-inner { padding:10px; }
  .sl { display:flex; align-items:center; gap:6px; margin-bottom:7px; margin-top:10px; }
  .sl:first-child { margin-top:0; }
  .sl-n { font-size:8px; font-weight:700; color:var(--blue); }
  .sl-l { flex:1; height:.5px; background:var(--sep); }
  .sl-t { font-size:8px; color:var(--t3); letter-spacing:.1em; text-transform:uppercase; }

  /* Upload zone */
  .upload-zone { border-radius:10px; border:.5px dashed rgba(255,255,255,0.14); background:var(--bg1);
    cursor:pointer; transition:all .15s; display:flex; flex-direction:column;
    align-items:center; justify-content:center; gap:0; padding:0;
    min-height:110px; position:relative; overflow:hidden; margin-bottom:7px; }
  .upload-zone:hover { border-color:var(--blue-border); }
  .upload-zone.dragover { border-color:var(--blue); background:rgba(10,132,255,0.08); border-style:solid; }
  .upload-zone.loaded { border-color:rgba(48,209,88,0.4); border-style:solid; }
  .uz-preview { width:100%; height:100%; object-fit:cover; display:block; border-radius:9px; }
  .uz-overlay { position:absolute; bottom:0; left:0; right:0;
    background:linear-gradient(transparent,rgba(0,0,0,0.75)); padding:6px 8px; border-radius:0 0 9px 9px; }
  .uz-fname { font-size:8px; color:rgba(255,255,255,0.7); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .uz-status-dot { width:5px; height:5px; border-radius:50%; background:var(--green);
    position:absolute; top:6px; right:7px; }
  .uz-empty { display:flex; flex-direction:column; align-items:center; gap:5px; padding:16px 8px; }
  .uz-icon { font-size:20px; color:var(--t3); }
  .uz-label { font-size:9px; font-weight:700; letter-spacing:.08em; color:var(--t2); text-transform:uppercase; }
  .uz-sub { font-size:8px; color:var(--t3); text-align:center; line-height:1.5; }

  .sim-btn { width:100%; padding:6px; border-radius:7px;
    border:.5px solid rgba(255,255,255,0.10); background:rgba(255,255,255,0.03);
    color:var(--t2); font-size:9px; font-weight:700; cursor:pointer; letter-spacing:.06em;
    font-family:inherit; margin-bottom:7px; transition:all .15s; display:flex; align-items:center; justify-content:center; gap:5px; }
  .sim-btn:hover { background:rgba(255,255,255,0.07); color:var(--t1); border-color:rgba(255,255,255,0.2); }

  /* Results */
  .res-card { background:var(--bg1); border-radius:8px; border:.5px solid rgba(255,255,255,0.06);
    padding:6px 8px; margin-bottom:7px; }
  .kv { display:flex; justify-content:space-between; font-size:9.5px; padding:2px 0;
    border-bottom:.5px solid rgba(255,255,255,0.04); }
  .kv:last-child { border-bottom:none; }
  .kv .k { color:var(--t3); } .kv .v { color:var(--blue); font-weight:700; }
  .kv .v.g { color:var(--green); } .kv .v.a { color:var(--amber); } .kv .v.r { color:var(--red); }

  /* Center */
  .center { flex:1; display:flex; flex-direction:column; overflow:hidden; min-width:0; }
  .canvas-tb { height:36px; background:rgba(0,0,0,0.45); border-bottom:.5px solid var(--sep);
    display:flex; align-items:center; gap:6px; padding:0 12px; flex-shrink:0; }
  .sep-toggle { padding:3px 9px; border-radius:5px; font-size:10px; cursor:pointer;
    font-family:inherit; transition:all .12s; }
  .sep-toggle.on { border:.5px solid var(--blue); background:var(--blue-dim); color:var(--blue); }
  .sep-toggle.off { border:.5px solid rgba(255,255,255,0.1); background:transparent; color:var(--t3); }
  .copy-btn { padding:3px 10px; border-radius:5px; font-size:9px; cursor:pointer; font-family:inherit;
    border:.5px solid rgba(255,255,255,0.12); background:transparent; color:var(--t3); transition:all .12s; display:flex; align-items:center; gap:4px; }
  .copy-btn:hover { border-color:var(--amber); color:var(--amber); }
  .copy-btn.copied { border-color:var(--green); color:var(--green); }
  .tb-info { font-size:9px; color:var(--t3); letter-spacing:.04em; margin-left:auto; }
  .canvas-wrap { flex:1; position:relative; overflow:hidden; background:var(--bg0); }

  /* Pipeline overlay */
  .pl-overlay { position:absolute; inset:0; background:rgba(3,6,8,0.97);
    display:flex; flex-direction:column; align-items:center; justify-content:center;
    gap:12px; padding:20px; z-index:20; transition:opacity .4s ease; }
  .pl-overlay.hidden { opacity:0; pointer-events:none; }
  .ring-wrap { position:relative; width:68px; height:68px; flex-shrink:0; }
  .ring-wrap svg { width:68px; height:68px; }
  .ring-pulse { position:absolute; inset:-4px; border-radius:50%;
    border:.5px solid rgba(10,132,255,0.35); animation:rpulse 1.9s ease-out infinite; }
  @keyframes rpulse { 0%{transform:scale(1);opacity:.7} 100%{transform:scale(1.4);opacity:0} }
  .stages-row { display:flex; align-items:center; flex-wrap:wrap; justify-content:center; max-width:480px; gap:0; }
  .s-item { display:flex; align-items:center; }
  .s-node { display:flex; flex-direction:column; align-items:center; gap:2px;
    padding:3px 4px; border-radius:5px; transition:all .25s; min-width:38px; }
  .s-node.done { background:rgba(10,132,255,0.1); border:.5px solid rgba(10,132,255,0.3); }
  .s-node.active { background:rgba(10,132,255,0.16); border:.5px solid rgba(10,132,255,0.7); }
  .s-node.pending { background:transparent; border:.5px solid transparent; }
  .s-circ { width:19px; height:19px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:9px; transition:all .25s; }
  .s-circ.done { background:var(--blue); color:#fff; }
  .s-circ.active { background:rgba(10,132,255,0.2); border:1.5px solid var(--blue); color:var(--blue); box-shadow:0 0 8px rgba(10,132,255,0.4); }
  .s-circ.pending { background:rgba(255,255,255,0.04); border:.5px solid rgba(255,255,255,0.1); color:var(--t3); }
  .s-name { font-size:7px; color:var(--t3); text-align:center; max-width:38px; transition:color .25s; }
  .s-name.done { color:rgba(10,132,255,0.8); } .s-name.active { color:rgba(255,255,255,0.85); }
  .s-conn { width:6px; height:.5px; background:rgba(255,255,255,0.1); margin-bottom:12px; transition:background .4s; }
  .s-conn.lit { background:rgba(10,132,255,0.7); }
  .status-box { background:rgba(10,132,255,0.07); border:.5px solid rgba(10,132,255,0.22);
    border-radius:8px; padding:6px 16px; max-width:430px; text-align:center; }
  .status-l1 { font-size:10px; color:rgba(10,132,255,0.9); letter-spacing:.03em; line-height:1.5; }
  .status-l2 { font-size:9px; color:rgba(255,255,255,0.22); margin-top:2px; }
  .scan-track { width:260px; height:2px; border-radius:9999px; background:rgba(255,255,255,0.04); overflow:hidden; }
  .scan-bar { height:100%; width:38%; border-radius:9999px;
    background:linear-gradient(90deg,transparent,rgba(10,132,255,0.85),transparent);
    animation:scanbar 2.1s ease-in-out infinite; }
  @keyframes scanbar { 0%{transform:translateX(-120%)} 100%{transform:translateX(370%)} }
  .dont-reload { font-size:9px; color:var(--t3); letter-spacing:.06em; animation:blink 2.8s ease-in-out infinite; }
  @keyframes blink { 0%,100%{opacity:.35} 50%{opacity:.85} }

  /* Empty state */
  .empty-state { position:absolute; inset:0; display:flex; flex-direction:column;
    align-items:center; justify-content:center; gap:12px; }
  .empty-icon { width:52px; height:52px; border-radius:14px; background:rgba(255,255,255,0.04);
    border:.5px solid rgba(255,255,255,0.08); display:flex; align-items:center; justify-content:center;
    font-size:22px; color:rgba(255,255,255,0.15); }
  .empty-title { font-size:13px; font-weight:500; color:rgba(255,255,255,0.45); }
  .empty-sub { font-size:10px; color:var(--t3); text-align:center; line-height:1.9; }
  .pipe-tags { display:flex; align-items:center; gap:4px; flex-wrap:wrap; justify-content:center; max-width:340px; }
  .ptag { font-size:8px; padding:2px 7px; border-radius:4px; border:.5px solid rgba(255,255,255,0.08); color:var(--t3); background:rgba(255,255,255,0.03); }
  .parrow { font-size:8px; color:rgba(255,255,255,0.1); }

  /* Car draw animation */
  .car-path { stroke-dasharray:3000; stroke-dashoffset:3000; }
  .car-path.draw { animation:draw-path 2.4s cubic-bezier(0.4,0,0.2,1) forwards; }
  @keyframes draw-path { to { stroke-dashoffset:0; } }
  .err-box { border-radius:8px; padding:7px 10px; background:rgba(255,69,58,0.08);
    border:.5px solid rgba(255,69,58,0.3); color:var(--red); font-size:10px;
    margin-bottom:7px; line-height:1.5; }
  @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
  @keyframes fadeIn { to { opacity:1; } }
  @keyframes sketchDraw { to { stroke-dashoffset:0; } }
`

// ── Engineering sketch animation (sports car line drawing — no wheel circles) ──
function SketchAnimation() {
  const W = 460, H = 186

  // Sports car side profile — low, long hood, fastback roofline, no wheel circles.
  // Derived from the engineering drawing reference provided.
  const bodyD = `
    M 44,148
    L 46,138 L 52,120 L 60,106
    Q 72,90 90,78 L 112,68
    Q 130,61 154,57 Q 180,54 210,54
    Q 244,54 272,56 L 295,59
    Q 318,63 334,70 Q 348,77 358,88
    Q 366,97 372,110 L 378,126 L 380,140 L 381,148
    L 355,148 L 334,148
    L 188,148
    L 110,148 L 88,148
    L 60,148
    Q 48,149 44,148 Z
  `
  // Panel crease line — body shoulder line
  const shoulderD = `M 68,96 Q 140,82 240,80 Q 320,80 362,90`
  // Windscreen frame
  const wsD = `M 154,57 L 196,96 L 284,96 L 314,70`
  // Roofline construction
  const roofD = `M 196,54 L 334,70`
  // Hood crease
  const hoodD = `M 90,78 Q 120,72 160,70`
  // Door panel crease
  const doorD = `M 140,148 Q 142,112 148,96`
  // Rear pillar
  const rearPillarD = `M 314,70 L 340,148`

  // Key contour sample points — pop in after trace
  const samplePts = [
    [60,106],[90,78],[154,57],[210,54],[272,56],[334,70],[372,110],[381,148],
    [188,148],[44,148],
  ]

  // Dimension callout lines
  const dims = [
    {x1:44,y1:164,x2:381,y2:164,label:'L',lx:212,ly:174,delay:2.8},
    {x1:406,y1:54,x2:406,y2:148,label:'H',lx:418,ly:104,delay:3.2,vert:true},
    {x1:44,y1:174,x2:188,y2:174,label:'hood',lx:116,ly:183,delay:3.5},
    {x1:188,y1:174,x2:334,y2:174,label:'cabin',lx:261,ly:183,delay:3.8},
  ]

  return (
    <div style={{position:'relative',width:W,height:H,borderRadius:12,overflow:'hidden',
      background:'rgba(10,132,255,0.025)',border:'.5px solid rgba(10,132,255,0.10)'}}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H}>
        <defs>
          <filter id="sk-rough">
            <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="4" result="n"/>
            <feDisplacementMap in="SourceGraphic" in2="n" scale="0.7" xChannelSelector="R" yChannelSelector="G"/>
          </filter>
        </defs>

        {/* Grid paper */}
        {Array.from({length:22},(_,i)=>(
          <line key={`gx${i}`} x1={i*22} y1={0} x2={i*22} y2={H} stroke="rgba(10,132,255,0.045)" strokeWidth=".5"/>
        ))}
        {Array.from({length:9},(_,i)=>(
          <line key={`gy${i}`} x1={0} y1={i*22} x2={W} y2={i*22} stroke="rgba(10,132,255,0.045)" strokeWidth=".5"/>
        ))}

        {/* Ground line */}
        <line x1={30} y1={148} x2={W-20} y2={148} stroke="rgba(255,255,255,0.07)" strokeWidth=".8" strokeDasharray="4 3"/>

        {/* Main body outline — pencil trace */}
        <path d={bodyD} fill="rgba(10,132,255,0.05)" stroke="rgba(10,132,255,0.8)"
          strokeWidth="1.7" strokeLinejoin="round" strokeLinecap="round"
          filter="url(#sk-rough)"
          style={{strokeDasharray:1500,strokeDashoffset:1500,
            animation:'sketchDraw 2.2s cubic-bezier(0.4,0,0.2,1) 0.2s forwards'}}/>

        {/* Body shoulder crease */}
        <path d={shoulderD} fill="none" stroke="rgba(10,132,255,0.35)" strokeWidth=".9" strokeLinecap="round"
          style={{opacity:0,strokeDasharray:320,strokeDashoffset:320,
            animation:'sketchDraw 0.6s ease 1.6s forwards, fadeIn 0.1s ease 1.6s forwards'}}/>

        {/* Windscreen frame */}
        <path d={wsD} fill="none" stroke="rgba(10,132,255,0.4)" strokeWidth="1.0" strokeLinecap="round"
          style={{opacity:0,strokeDasharray:200,strokeDashoffset:200,
            animation:'sketchDraw 0.5s ease 1.9s forwards, fadeIn 0.1s ease 1.9s forwards'}}/>

        {/* Roofline datum */}
        <path d={roofD} fill="none" stroke="rgba(10,132,255,0.18)" strokeWidth=".7" strokeDasharray="5 4"
          style={{opacity:0,animation:'fadeIn 0.3s ease 1.8s forwards'}}/>

        {/* Hood crease */}
        <path d={hoodD} fill="none" stroke="rgba(10,132,255,0.28)" strokeWidth=".8" strokeLinecap="round"
          style={{opacity:0,strokeDasharray:90,strokeDashoffset:90,
            animation:'sketchDraw 0.4s ease 2.1s forwards, fadeIn 0.1s ease 2.1s forwards'}}/>

        {/* Door panel line */}
        <path d={doorD} fill="none" stroke="rgba(10,132,255,0.25)" strokeWidth=".8" strokeLinecap="round"
          style={{opacity:0,strokeDasharray:60,strokeDashoffset:60,
            animation:'sketchDraw 0.35s ease 2.2s forwards, fadeIn 0.1s ease 2.2s forwards'}}/>

        {/* Rear pillar */}
        <path d={rearPillarD} fill="none" stroke="rgba(10,132,255,0.3)" strokeWidth=".8"
          style={{opacity:0,strokeDasharray:90,strokeDashoffset:90,
            animation:'sketchDraw 0.3s ease 2.3s forwards, fadeIn 0.1s ease 2.3s forwards'}}/>

        {/* Sample dots along contour */}
        {samplePts.map(([x,y],i)=>(
          <circle key={i} cx={x} cy={y} r={2} fill="rgba(10,132,255,0.85)"
            style={{opacity:0,animation:`fadeIn 0.15s ease ${2.4+i*0.07}s forwards`}}/>
        ))}

        {/* Dimension lines */}
        {dims.map((d,i)=>(
          <g key={i} style={{opacity:0,animation:`fadeIn 0.4s ease ${d.delay}s forwards`}}>
            {d.vert
              ? <><line x1={d.x1} y1={d.y1} x2={d.x2} y2={d.y2} stroke="rgba(255,255,255,0.18)" strokeWidth=".7"/>
                  <line x1={d.x1-5} y1={d.y1} x2={d.x1+5} y2={d.y1} stroke="rgba(255,255,255,0.25)" strokeWidth=".8"/>
                  <line x1={d.x1-5} y1={d.y2} x2={d.x1+5} y2={d.y2} stroke="rgba(255,255,255,0.25)" strokeWidth=".8"/></>
              : <><line x1={d.x1} y1={d.y1} x2={d.x2} y2={d.y1} stroke="rgba(255,255,255,0.18)" strokeWidth=".7"/>
                  <line x1={d.x1} y1={d.y1-4} x2={d.x1} y2={d.y1+4} stroke="rgba(255,255,255,0.25)" strokeWidth=".8"/>
                  <line x1={d.x2} y1={d.y1-4} x2={d.x2} y2={d.y1+4} stroke="rgba(255,255,255,0.25)" strokeWidth=".8"/></>
            }
            <text x={d.lx} y={d.ly} textAnchor="middle" fill="rgba(10,132,255,0.55)"
              fontSize="7.5" fontFamily="'IBM Plex Mono',monospace" letterSpacing=".05em">{d.label}</text>
          </g>
        ))}

        {/* Badge */}
        <g style={{opacity:0,animation:'fadeIn 0.5s ease 4.4s forwards'}}>
          <rect x={8} y={8} width={96} height={36} rx={5}
            fill="rgba(10,132,255,0.08)" stroke="rgba(10,132,255,0.2)" strokeWidth=".7"/>
          <text x={16} y={21} fill="rgba(10,132,255,0.45)" fontSize="6.5" fontFamily="'IBM Plex Mono',monospace" letterSpacing=".06em">BENCHMARKING</text>
          <text x={16} y={34} fill="rgba(255,255,255,0.55)" fontSize="9" fontWeight="700" fontFamily="'IBM Plex Mono',monospace">2000 pts</text>
        </g>
      </svg>
    </div>
  )
}

// ── Pipeline overlay ──────────────────────────────────────────────────────────
function PipelineOverlay({ pct, msg, sub, visible }) {
  const circ = 2 * Math.PI * 30
  const offset = circ * (1 - pct / 100)
  return (
    <div className={'pl-overlay' + (visible ? '' : ' hidden')}>
      <SketchAnimation/>

      <div style={{display:'flex',alignItems:'center',gap:14}}>
        <div className="ring-wrap">
          <div className="ring-pulse"/>
          <svg viewBox="0 0 68 68">
            <circle cx="34" cy="34" r="30" fill="none" stroke="rgba(10,132,255,0.08)" strokeWidth="4.5"/>
            <circle cx="34" cy="34" r="30" fill="none" stroke="rgba(10,132,255,0.9)" strokeWidth="4.5"
              strokeLinecap="round"
              strokeDasharray={circ.toFixed(2)} strokeDashoffset={offset.toFixed(2)}
              transform="rotate(-90 34 34)"
              style={{transition:'stroke-dashoffset 0.5s ease'}}/>
            <text x="34" y="31" textAnchor="middle" fill="white" fontSize="13" fontWeight="700" fontFamily="'IBM Plex Mono',monospace">{Math.round(pct)}</text>
            <text x="34" y="42" textAnchor="middle" fill="rgba(10,132,255,0.7)" fontSize="7" fontFamily="'IBM Plex Mono',monospace">%</text>
          </svg>
        </div>
        <div className="stages-row">
          {STAGES.map((s,i) => {
            const done=pct>=s.pct[1], active=pct>=s.pct[0]&&pct<s.pct[1]
            const state=done?'done':active?'active':'pending'
            return (
              <div key={s.id} className="s-item">
                <div className={`s-node ${state}`}>
                  <div className={`s-circ ${state}`}>{done?'✓':s.icon}</div>
                  <div className={`s-name ${state}`}>{s.label}</div>
                </div>
                {i<STAGES.length-1&&<div className={`s-conn ${done?'lit':''}`}/>}
              </div>
            )
          })}
        </div>
      </div>

      <div className="status-box">
        <div className="status-l1">{msg}</div>
        <div className="status-l2">{sub}</div>
      </div>
      <div className="scan-track"><div className="scan-bar"/></div>
      <div className="dont-reload">Please wait · Do not close or reload</div>
    </div>
  )
}

// ── Upload zone with image preview ───────────────────────────────────────────
function UploadZone({ file, preview, onFile }) {
  const [dragover, setDragover] = useState(false)
  const inputRef = useRef(null)
  const handleDrop = (e) => {
    e.preventDefault(); setDragover(false)
    const f = e.dataTransfer.files?.[0]
    if (f && f.type.startsWith('image/')) onFile(f)
  }
  const handleChange = (e) => { const f = e.target.files?.[0]; if (f) onFile(f) }
  const cls = ['upload-zone', dragover ? 'dragover' : '', file ? 'loaded' : ''].filter(Boolean).join(' ')

  return (
    <div className={cls}
      onClick={() => inputRef.current?.click()}
      onDragOver={e => { e.preventDefault(); setDragover(true) }}
      onDragLeave={() => setDragover(false)}
      onDrop={handleDrop}>
      <input ref={inputRef} type="file" accept="image/*" style={{display:'none'}} onChange={handleChange}/>
      {preview ? (
        <>
          <img src={preview} alt="car" className="uz-preview"/>
          <div className="uz-overlay">
            <div className="uz-fname">{file?.name ?? 'image'}</div>
          </div>
          <div className="uz-status-dot"/>
        </>
      ) : (
        <div className="uz-empty">
          <div className="uz-icon">◻</div>
          <div className="uz-label">Side View Photo</div>
          <div className="uz-sub">Drop image · click · paste URL<br/>or paste from clipboard</div>
        </div>
      )}
    </div>
  )
}

// ── Side view SVG ─────────────────────────────────────────────────────────────
function SideViewSVG({ g, showSep, isDrawing, drawDone, svgRef }) {
  const CW=600, CH=290, CPAD=22
  const scale_x=CW-CPAD*2, scale_y=CH-52
  const off_x=CPAD, off_y=6

  if (!g||!g._contourPts||!Array.isArray(g._contourPts)||g._contourPts.length<=10) {
    return (
      <svg viewBox={`0 0 ${CW} ${CH}`} style={{width:'100%',height:'100%'}} preserveAspectRatio="xMidYMid meet">
        <rect width={CW} height={CH} fill="#070d14"/>
        <text x={CW/2} y={CH/2} textAnchor="middle" fill="rgba(255,255,255,0.07)"
          fontSize="11" fontFamily="'IBM Plex Mono',monospace">Upload and analyse to see outline</text>
      </svg>
    )
  }

  const rawPts = g._smoothPts ?? g._contourPts
  const bboxAspect = g._bboxAspect ?? (scale_x/scale_y)
  const canvasAspect = scale_x/scale_y
  let draw_w, draw_h
  if (bboxAspect > canvasAspect) { draw_w=scale_x*0.94; draw_h=draw_w/bboxAspect }
  else { draw_h=scale_y*0.91; draw_w=draw_h*bboxAspect; if(draw_w>scale_x*0.94){draw_w=scale_x*0.94;draw_h=draw_w/bboxAspect} }

  const draw_ox = off_x+(scale_x-draw_w)/2
  const draw_oy = off_y+(scale_y-draw_h)-6
  const toSVG = ([nx,ny]) => [draw_ox+nx*draw_w, draw_oy+ny*draw_h]

  const pathD = rawPts.map((p,i) => {
    const [sx,sy]=toSVG(p)
    return `${i===0?'M':'L'}${sx.toFixed(2)},${sy.toFixed(2)}`
  }).join(' ')+' Z'

  const gY = Math.min(draw_oy+draw_h+4, CH-10)
  const kp = g._keypoints
  const rawWheels = kp?.wheels??[]

  const unifiedR = rawWheels.length>0
    ? Math.max(draw_h*0.16, Math.min(draw_h*0.26,
        rawWheels.map(w=>w.nr*draw_w).reduce((a,b)=>a+b,0)/rawWheels.length))
    : draw_h*0.21

  const archVoids = rawWheels.map(w => {
    const cx = draw_ox+w.nx*draw_w, r=unifiedR
    const archCap = draw_oy+draw_h*0.93
    const band = rawPts.filter(p => {
      const sx=draw_ox+p[0]*draw_w, sy=draw_oy+p[1]*draw_h
      return Math.abs(sx-cx)<r*1.8&&sy<archCap&&p[1]>0.45
    })
    const archBottomY = band.length>0
      ? Math.max(...band.map(p=>draw_oy+p[1]*draw_h))
      : gY-r-1
    return {cx, cy:archBottomY-r, r}
  })

  const drawClass = isDrawing||drawDone ? 'car-path draw' : 'car-path'

  return (
    <svg ref={svgRef} viewBox={`0 0 ${CW} ${CH}`} style={{width:'100%',height:'100%'}} preserveAspectRatio="xMidYMid meet">
      <defs>
        <clipPath id="car-clip-main"><path d={pathD}/></clipPath>
      </defs>
      <rect width={CW} height={CH} fill="#070d14"/>
      <line x1={draw_ox+draw_w*0.03} y1={gY} x2={draw_ox+draw_w*0.97} y2={gY}
        stroke="rgba(255,255,255,0.05)" strokeWidth="1"/>
      {(drawDone||isDrawing)&&archVoids.map((v,i)=>(
        <circle key={i} cx={v.cx.toFixed(1)} cy={v.cy.toFixed(1)} r={(v.r*1.06).toFixed(1)}
          fill="#070d14" clipPath="url(#car-clip-main)"/>
      ))}
      <path d={pathD} fill="none" stroke="rgba(255,255,255,0.90)" strokeWidth="1.4"
        strokeLinejoin="round" strokeLinecap="round"
        className={drawClass}
        style={{strokeDasharray:3000, strokeDashoffset:isDrawing||drawDone?undefined:3000}}/>
      {showSep&&drawDone&&kp?.bumpers?.rear&&(
        <line
          x1={(draw_ox+kp.bumpers.rear.nx*draw_w).toFixed(1)} y1={draw_oy.toFixed(1)}
          x2={(draw_ox+kp.bumpers.rear.nx*draw_w).toFixed(1)} y2={gY.toFixed(1)}
          stroke="rgba(255,100,80,0.4)" strokeWidth="1" strokeDasharray="4 2"/>
      )}
      <text x={CW/2} y={CH-3} textAnchor="middle" fill="rgba(255,255,255,0.07)"
        fontSize="8" fontFamily="'IBM Plex Mono',monospace" letterSpacing=".12em">
        SIDE · {g._contourPts?.length??0}pts · {g._method??''}
      </text>
    </svg>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt = (v, decimals=2, suffix='') => v != null ? `${Number(v).toFixed(decimals)}${suffix}` : '—'
const fmtPct = (v) => v != null ? `${(Number(v)*100).toFixed(1)}%` : '—'
const ahmedColor = (r) => ({attached:'#30d158',intermediate:'#ff9f0a',critical:'#ff453a',separated:'#ff453a'}[r]??'#0A84FF')

// ── Main App ──────────────────────────────────────────────────────────────────
export default function AeroNetV2() {
  const [sideFile,       setSideFile]       = useState(null)
  const [preview,        setPreview]        = useState(null)
  const [analysisMode,   setAnalysisMode]   = useState('A')
  const [showSep,        setShowSep]        = useState(true)
  const [stage,          setStage]          = useState('idle')
  const [geo,            setGeo]            = useState(null)
  const [error,          setError]          = useState(null)
  const [traceProgress,  setTraceProgress]  = useState({pct:0,msg:'',sub:''})
  const [isDrawing,      setIsDrawing]      = useState(false)
  const [drawDone,       setDrawDone]       = useState(false)
  const [copied,         setCopied]         = useState(false)
  const canvasRef = useRef(null)
  const svgPathRef = useRef(null)

  const isRunning = stage === 'analyzing'

  const setFile = useCallback((f) => {
    setSideFile(f)
    setPreview(URL.createObjectURL(f))
    setGeo(null); setError(null); setDrawDone(false); setIsDrawing(false)
  }, [])

  useEffect(() => {
    const handle = (e) => {
      const items = Array.from(e.clipboardData?.items??[])
      const img = items.find(i=>i.type.startsWith('image/'))
      if (img) { setFile(img.getAsFile()); return }
      const text = e.clipboardData?.getData('text')??''
      if (/^https?:\/\//i.test(text)) {
        fetchImageFromUrl(text).then(f=>setFile(f)).catch(err=>setError(err.message))
      }
    }
    window.addEventListener('paste', handle)
    return () => window.removeEventListener('paste', handle)
  }, [setFile])

  const getMsgForPct = (pct) => {
    const entry = [...BACKEND_MSGS].reverse().find(m=>pct>=m[0])
    return entry ? {msg:entry[1],sub:entry[2]} : {msg:'Processing…',sub:''}
  }

  // ── Simulate — loads a realistic demo state locally, no backend call ────────
  const simulate = () => {
    setError(null); setGeo(null); setDrawDone(false); setIsDrawing(false)
    setStage('analyzing')
    setTraceProgress({pct:5,msg:'Simulating pipeline…',sub:'Demo mode — watch the sketch animation'})
    let p = 5
    const tick = setInterval(() => {
      p = Math.min(97, p + 2.5 + Math.random()*3)
      const {msg,sub} = getMsgForPct(p)
      setTraceProgress({pct:Math.round(p),msg,sub})
      if (p >= 97) {
        clearInterval(tick)
        setTraceProgress({pct:98,msg:'Complete ✓ — rendering outline…',sub:'Drawing silhouette'})
        const r = DEMO_RESULT
        const cg = r.geometry
        setGeo({
          bodyType:         cg.bodyType,
          aspectRatio:      cg.aspectRatio,
          hoodRatio:        cg.hoodRatio,
          cabinRatio:       cg.cabinRatio,
          bootRatio:        cg.bootRatio,
          wsAngleDeg:       cg.wsAngleDeg,
          rearDrop:         cg.rearDrop,
          rearSlantAngleDeg:cg.rearSlantAngleDeg,
          wheelbaseNorm:    cg.wheelbaseNorm,
          frontalAreaNorm:  cg.frontalAreaNorm,
          Cd:               cg.Cd,
          CdA:              cg.CdA,
          rideH:            cg.rideH,
          archDepth:        cg.archDepth,
          ahmedRegime:      cg.ahmedRegime,
          _contourPts:      r.technical_outline_pts,
          _smoothPts:       r.display_outline_pts,
          _bboxAspect:      r.bbox ? r.bbox.w / Math.max(1, r.bbox.h) : undefined,
          _keypoints:       r.keypoints,
          _method:          r.method,
          _quality:         r.quality,
          _processing:      r.processing,
        })
        // Wait 800ms so the overlay has time to show "Complete ✓" before fading
        setTimeout(() => {
          setStage('done')
          // Clear progress after overlay fades (400ms transition)
          setTimeout(() => {
            setTraceProgress({pct:0,msg:'',sub:''})
            // Start draw animation after overlay is gone
            setIsDrawing(true)
            setTimeout(() => { setIsDrawing(false); setDrawDone(true) }, 2600)
          }, 500)
        }, 800)
      }
    }, 220)
  }

  const run = async () => {
    const file = sideFile
    if (!file || file.size === 0) { setError('Please upload a real side photo.'); return }
    setError(null); setGeo(null); setDrawDone(false); setIsDrawing(false)
    setStage('analyzing')
    setTraceProgress({pct:2,msg:'Preparing image…',sub:'Input normalisation'})

    let uploadFile
    try { uploadFile = await prepareImage(file) } catch { uploadFile = file }

    let jobId = null
    for (let attempt = 0; attempt < 8; attempt++) {
      setTraceProgress({pct:5, msg:attempt===0?'Connecting to server…':`Retrying… (${attempt*5}s)`, sub:'Input normalisation'})
      try {
        const fd = new FormData()
        fd.append('file', uploadFile); fd.append('mode', analysisMode)
        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), 25000)
        let res
        try { res = await fetch(`${API_BASE}/analyze-contour/start`,{method:'POST',body:fd,signal:ctrl.signal}) }
        finally { clearTimeout(timer) }
        if (res.ok) { jobId = (await res.json()).job_id; break }
        const text = await res.text().catch(()=>'')
        setError(`Server error ${res.status}${text?': '+text.slice(0,120):''}`)
        setStage('idle'); return
      } catch {
        if (attempt >= 7) { setError('Could not reach server. Check connection.'); setStage('idle'); return }
        await new Promise(r=>setTimeout(r,5000))
      }
    }
    if (!jobId) { setError('Failed to start job.'); setStage('idle'); return }
    setTraceProgress({pct:10,msg:'Job queued…',sub:'Input normalisation'})

    const startTime = Date.now()
    while (true) {
      await new Promise(r=>setTimeout(r,3000))
      const elapsed = Math.round((Date.now()-startTime)/1000)
      let poll
      try {
        const pc=new AbortController(); const pt=setTimeout(()=>pc.abort(),10000)
        let res
        try { res=await fetch(`${API_BASE}/analyze-contour/result/${jobId}`,{signal:pc.signal}) }
        finally { clearTimeout(pt) }
        if (!res.ok) { setError(`Poll error ${res.status}`); setStage('idle'); return }
        poll = await res.json()
      } catch(e) { setError(`Connection lost: ${e.message}`); setStage('idle'); return }

      if (poll.status==='error') { setError(poll.error??'Analysis failed'); setStage('idle'); return }
      if (poll.status==='running'||poll.status==='pending') {
        const pct = Math.min(90, 10+elapsed*1.2)
        const {msg,sub} = getMsgForPct(pct)
        setTraceProgress({pct:Math.round(pct),msg:`${msg} · ${elapsed}s`,sub})
        continue
      }
      if (poll.status==='done') {
        const result = poll.result
        if (!result?.geometry) { setError('No outline found. Use a clear side-on photo.'); setStage('idle'); return }
        setTraceProgress({pct:98,msg:'Complete ✓ — rendering outline…',sub:'Drawing silhouette'})
        const cg = result.geometry
        // All values come directly from backend — no hardcoded display fallbacks
        setGeo({
          bodyType:         cg.bodyType,
          aspectRatio:      cg.aspectRatio,
          hoodRatio:        cg.hoodRatio,
          cabinRatio:       cg.cabinRatio,
          bootRatio:        cg.bootRatio,
          wsAngleDeg:       cg.wsAngleDeg,
          rearDrop:         cg.rearDrop,
          rearSlantAngleDeg:cg.rearSlantAngleDeg,
          wheelbaseNorm:    cg.wheelbaseNorm,
          frontalAreaNorm:  cg.frontalAreaNorm,
          Cd:               cg.Cd,
          CdA:              cg.CdA,
          rideH:            cg.rideH,
          archDepth:        cg.archDepth,
          ahmedRegime:      cg.ahmedRegime,
          _contourPts:      result.technical_outline_pts ?? result.outline_pts,
          _smoothPts:       result.display_outline_pts  ?? result.smooth_pts,
          _bboxAspect:      result.bbox ? result.bbox.w/Math.max(1,result.bbox.h) : undefined,
          _keypoints:       result.keypoints,
          _method:          result.method,
          _quality:         result.quality,
          _processing:      result.processing,
        })
        setStage('done')
        setTimeout(() => {
          setTraceProgress({pct:0,msg:'',sub:''})
          setIsDrawing(true)
          setTimeout(() => { setIsDrawing(false); setDrawDone(true) }, 2600)
        }, 600)
        return
      }
    }
  }

  // ── Export SVG outline — clean path only, transparent background ─────────
  // This SVG can be pasted into PowerPoint as a vector shape:
  // Insert → Pictures → This Device → select the .svg file
  // PowerPoint imports SVG as an editable vector object since PPT 2016+
  const exportOutlineSVG = () => {
    if (!geo?._contourPts) return
    const pts = geo._smoothPts ?? geo._contourPts
    if (!pts || pts.length < 3) return

    // Use a 1000×400 canvas — good aspect for most car photos, scales cleanly in PPT
    const W = 1000, H = 400, PAD = 20
    const xs = pts.map(p=>p[0]), ys = pts.map(p=>p[1])
    const minX=Math.min(...xs), maxX=Math.max(...xs), minY=Math.min(...ys), maxY=Math.max(...ys)
    const rangeX=maxX-minX||1, rangeY=maxY-minY||1
    // Scale to fit with padding, preserving aspect
    const scaleF = Math.min((W-PAD*2)/rangeX, (H-PAD*2)/rangeY)
    const offX = PAD + ((W-PAD*2) - rangeX*scaleF)/2
    const offY = PAD + ((H-PAD*2) - rangeY*scaleF)/2

    const d = pts.map((p,i) => {
      const x = (offX + (p[0]-minX)*scaleF).toFixed(2)
      const y = (offY + (p[1]-minY)*scaleF).toFixed(2)
      return `${i===0?'M':'L'}${x},${y}`
    }).join(' ')+' Z'

    // Pure outline SVG: transparent background, no fill, just the stroke
    // PowerPoint treats this as a vector shape — stroke is copyable and editable
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <!-- AeroNet Vehicle Outline | ${new Date().toISOString().slice(0,10)} | ${geo._method??''} | Q:${geo._quality?.score??'?'}/100 -->
  <!-- Import into PowerPoint: Insert > Pictures > select this file (PPT 2016+) -->
  <path d="${d}" fill="none" stroke="#000000" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
</svg>`

    const blob = new Blob([svg], {type:'image/svg+xml'})
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `aeronet_outline_${new Date().toISOString().slice(0,10)}.svg`
    a.click()
    // Also copy SVG text to clipboard so it can be pasted as-is
    navigator.clipboard?.writeText(svg).then(() => {
      setCopied(true); setTimeout(()=>setCopied(false), 2500)
    }).catch(() => {
      setCopied(true); setTimeout(()=>setCopied(false), 2500)
    })
  }

  return (
    <>
      <style>{CSS}</style>
      <div style={{display:'flex',flexDirection:'column',height:'100vh',overflow:'hidden'}}>

        {/* ── Topbar ── */}
        <div className="topbar">
          <span className="tb-brand">AERONET</span>
          {geo ? (<>
            <div className="tb-stat"><span className="lbl">Method</span><span className="val" style={{fontSize:9}}>{geo._method??'—'}</span></div>
            <div className="tb-stat"><span className="lbl">Quality</span><span className={'val '+(geo._quality?.score>=75?'g':'a')}>{geo._quality?.score??'—'}/100</span></div>
            <div className="tb-stat"><span className="lbl">Cd est.</span><span className="val">{fmt(geo.Cd,3)}</span></div>
            <div className="tb-stat"><span className="lbl">CdA</span><span className="val">{fmt(geo.CdA,4)}</span></div>
            <div className="tb-stat"><span className="lbl">Ahmed</span>
              <span className="val" style={{color:ahmedColor(geo.ahmedRegime)}}>
                {geo.ahmedRegime?.toUpperCase()??'—'} {fmt(geo.rearSlantAngleDeg,0,'°')}
              </span></div>
            <div className="tb-stat"><span className="lbl">Body</span><span className="val">{geo.bodyType?.toUpperCase()??'—'}</span></div>
            <div className="tb-stat"><span className="lbl">Aspect</span><span className="val">{fmt(geo.aspectRatio,2)}</span></div>
            <div className="tb-stat"><span className="lbl">WB norm</span><span className="val">{fmt(geo.wheelbaseNorm,2)}</span></div>
          </>) : (
            <div className="tb-stat"><span className="lbl" style={{color:'rgba(255,255,255,0.15)'}}>Upload a side photo and analyse to see results</span></div>
          )}
          <div className="tb-spacer"/>
          <div className="tb-modes">
            {[{id:'A',label:'◎ Silhouette',desc:'~30s'},{id:'B',label:'⊞ Panels',desc:'~90s'},{id:'C',label:'⬡ Full Aero',desc:'~150s'}].map(m=>(
              <button key={m.id} className={'tb-mode-btn'+(analysisMode===m.id?' sel':'')}
                onClick={()=>setAnalysisMode(m.id)} title={m.desc}>{m.label}</button>
            ))}
          </div>
          <button className="tb-btn tb-run" onClick={run} disabled={!sideFile||isRunning}>
            {isRunning
              ? <><span style={{display:'inline-block',width:12,height:12,border:'2px solid rgba(255,255,255,0.3)',borderTopColor:'#fff',borderRadius:'50%',animation:'spin 0.8s linear infinite'}}/> Analysing…</>
              : <>▶ Analyse</>}
          </button>
          <button className="tb-btn tb-exp" onClick={exportOutlineSVG} disabled={!geo} title="Download outline SVG · importable into PowerPoint as vector shape">↓ Outline</button>
        </div>

        <div className="app-body">

          {/* ── Left panel ── */}
          <div className="left">
            <div className="left-inner">

              <div className="sl"><span className="sl-n">01</span><div className="sl-l"/><span className="sl-t">Upload</span></div>
              <UploadZone file={sideFile} preview={preview} onFile={setFile}/>

              {/* Simulate button */}
              <button className="sim-btn" onClick={simulate} disabled={isRunning}>
                <span style={{fontSize:10}}>⬡</span> Simulate pipeline
              </button>

              {error && <div className="err-box">{error}</div>}

              {geo && (<>
                <div className="sl"><span className="sl-n">02</span><div className="sl-l"/><span className="sl-t">Geometry</span></div>
                <div className="res-card">
                  {/* All values come from backend — displayed as-is, no hardcoded fallback values */}
                  {[
                    ['Body type',   geo.bodyType?.toUpperCase()??'—'],
                    ['Aspect',      fmt(geo.aspectRatio,2)],
                    ['Wheelbase n.',fmt(geo.wheelbaseNorm,2)],
                    ['Hood',        fmtPct(geo.hoodRatio)],
                    ['Cabin',       fmtPct(geo.cabinRatio)],
                    ['Boot',        fmtPct(geo.bootRatio)],
                    ['WS rake',     fmt(geo.wsAngleDeg,0,'°')],
                    ['Rear slant',  fmt(geo.rearSlantAngleDeg,1,'°')],
                    ['Rear drop',   fmtPct(geo.rearDrop)],
                    ['Ride height', fmtPct(geo.rideH)],
                    ['Arch depth',  fmtPct(geo.archDepth)],
                    ['Frontal A.',  fmt(geo.frontalAreaNorm,3)],
                  ].map(([k,v])=>(
                    <div key={k} className="kv"><span className="k">{k}</span><span className="v">{v}</span></div>
                  ))}
                </div>

                <div className="sl"><span className="sl-n">03</span><div className="sl-l"/><span className="sl-t">Aerodynamics</span></div>
                <div className="res-card">
                  {[
                    ['Cd est.',  fmt(geo.Cd,3)],
                    ['CdA',      fmt(geo.CdA,4)],
                    ['Ahmed',    geo.ahmedRegime?.toUpperCase()??'—'],
                    ['Slant',    fmt(geo.rearSlantAngleDeg,1,'°')],
                    ['Wheels',   (geo._keypoints?.wheels?.length??0)+' found'],
                  ].map(([k,v])=>(
                    <div key={k} className="kv">
                      <span className="k">{k}</span>
                      <span className={'v'+(k==='Ahmed'?' '+(geo.ahmedRegime==='attached'?'g':geo.ahmedRegime==='separated'?'r':'a'):'')}>
                        {v}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="sl"><span className="sl-n">04</span><div className="sl-l"/><span className="sl-t">Quality</span></div>
                <div className="res-card">
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
                    <span style={{fontSize:12,fontWeight:700,color:geo._quality?.score>=75?'var(--green)':'var(--amber)'}}>
                      {geo._quality?.score??'—'}/100
                    </span>
                    <span style={{fontSize:8,color:'var(--t3)',textTransform:'uppercase',letterSpacing:'.06em'}}>{geo._quality?.status??''}</span>
                  </div>
                  <div style={{height:3,borderRadius:2,background:'rgba(255,255,255,0.06)',marginBottom:4}}>
                    <div style={{height:'100%',borderRadius:2,width:`${geo._quality?.score??0}%`,
                      background:geo._quality?.score>=75?'var(--green)':'var(--amber)',transition:'width .6s'}}/>
                  </div>
                  {[
                    ['Points',  (geo._processing?.technical_pts??geo._contourPts?.length??0)+' pt'],
                    ['Raw pts', (geo._processing?.raw_pts??'—')+' pt'],
                    ['Spikes',  (geo._processing?.spike_pts_removed??'—')+' removed'],
                    ['Snapped', (geo._processing?.edge_snap_pts??'—')+' pts'],
                    ['Method',  geo._method?.replace(/\+/g,' + ')??'—'],
                  ].map(([k,v])=>(
                    <div key={k} className="kv" style={{fontSize:8.5}}>
                      <span className="k">{k}</span><span style={{color:'var(--t2)',fontWeight:600}}>{v}</span>
                    </div>
                  ))}
                  {geo._quality?.warnings?.slice(0,3).map((w,i)=>(
                    <div key={i} style={{fontSize:8,color:'var(--amber)',marginTop:3,lineHeight:1.4}}>⚠ {w}</div>
                  ))}
                </div>
              </>)}
            </div>
          </div>

          {/* ── Center ── */}
          <div className="center">
            <div className="canvas-tb">
              <span style={{fontSize:10,color:'var(--t2)',fontWeight:700,letterSpacing:'.06em'}}>SIDE VIEW</span>
              <div style={{width:'.5px',height:14,background:'rgba(255,255,255,0.08)',margin:'0 6px'}}/>
              <button className={'sep-toggle '+(showSep?'on':'off')} onClick={()=>setShowSep(p=>!p)}>Sep</button>
              {geo && (
                <button className={'copy-btn'+(copied?' copied':'')} onClick={exportOutlineSVG}
                  title="Download SVG outline · open in PowerPoint via Insert > Pictures">
                  {copied ? '✓ copied' : '⎘ Copy outline'}
                </button>
              )}
              {geo&&<span className="tb-info">{geo._contourPts?.length??0}pts · {geo._method??''}</span>}
            </div>

            <div className="canvas-wrap" ref={canvasRef}>
              <PipelineOverlay visible={isRunning} pct={traceProgress.pct} msg={traceProgress.msg} sub={traceProgress.sub}/>

              {!geo&&!isRunning&&(
                <div className="empty-state">
                  <div className="empty-icon">◻</div>
                  <div className="empty-title">Vehicle outline analysis</div>
                  <div className="empty-sub">Drop or paste a side-on car photo<br/>then click Analyse — or try Simulate</div>
                  <div className="pipe-tags">
                    {['RMBG 2.0','→','YOLO11x','→','SAM3','→','2000pt contour','→','Ahmed CFD'].map((t,i)=>(
                      t==='→'?<span key={i} className="parrow">→</span>:<span key={i} className="ptag">{t}</span>
                    ))}
                  </div>
                </div>
              )}

              {geo&&!isRunning&&(
                <div style={{width:'100%',height:'100%'}}>
                  <SideViewSVG g={geo} showSep={showSep} isDrawing={isDrawing} drawDone={drawDone} svgRef={svgPathRef}/>
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
    </>
  )
}
