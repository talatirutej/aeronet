// AeroNet v2 — Vehicle Outline Analysis
// Copyright (c) 2026 Rutej Talati. All rights reserved.
// Redesigned frontend: 4-view drop zones, topbar stats, animated pipeline, sketch-draw reveal

import { useCallback, useEffect, useRef, useState } from 'react'

const API_BASE =
  (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_API_URL) ||
  'https://rutejtalati16-aeronet.hf.space'

// ── Image preprocessing ───────────────────────────────────────────────────────
async function prepareImage(file, maxWidth = 1440, quality = 0.93) {
  return new Promise((resolve) => {
    const img = new window.Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const minWidth = 900
      const effectiveMax = Math.max(maxWidth, minWidth)
      const scale = img.width < minWidth
        ? Math.min(3.0, effectiveMax / img.width)
        : Math.min(1.0, maxWidth / img.width)
      const w = Math.round(img.width * scale)
      const h = Math.round(img.height * scale)
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, w, h)
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, 0, 0, w, h)
      canvas.toBlob(
        (blob) => resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' })),
        'image/jpeg', quality
      )
    }
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file) }
    img.src = url
  })
}

async function fetchImageFromUrl(url) {
  const proxies = [
    u => u,
    u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    u => `https://corsproxy.io/?${encodeURIComponent(u)}`,
  ]
  for (const proxy of proxies) {
    try {
      const r = await fetch(proxy(url), { signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined })
      if (!r.ok) continue
      const blob = await r.blob()
      if (!blob.type.startsWith('image/') && !blob.type.includes('octet')) continue
      const filename = url.split('/').pop()?.split('?')[0] || 'car.jpg'
      return new File([blob], filename, { type: blob.type.startsWith('image/') ? blob.type : 'image/jpeg' })
    } catch { continue }
  }
  throw new Error('Could not fetch image — try downloading and uploading the file directly')
}

// ── Pipeline stages ───────────────────────────────────────────────────────────
const STAGES = [
  { id: 'prep',    label: 'Preprocess', icon: '⚙',  pct: [0,  8]  },
  { id: 'rmbg',   label: 'RMBG 2.0',   icon: '◉',  pct: [8,  28] },
  { id: 'yolo',   label: 'YOLO11',     icon: '◎',  pct: [28, 42] },
  { id: 'sam3',   label: 'SAM3',       icon: '⬡',  pct: [42, 57] },
  { id: 'contour',label: 'Contour',    icon: '✦',  pct: [57, 72] },
  { id: 'keys',   label: 'Keypoints',  icon: '⊞',  pct: [72, 82] },
  { id: 'cfd',    label: 'CFD Geom',   icon: '◈',  pct: [82, 92] },
  { id: 'done',   label: 'Complete',   icon: '✓',  pct: [92, 100]},
]

const BACKEND_MSGS = [
  [0,  'Stage 0a: EXIF correction, canvas margin, resize to 1536px…',       'Input normalisation'],
  [8,  'Stage 0b: RMBG 2.0 — product-photo foreground extraction…',          'Separating car from background'],
  [18, 'RMBG 2.0 forward pass — BiRefNet architecture, 1024×1024…',          'Neural segmentation in progress'],
  [28, 'Stage 1: YOLO11x-seg — confirming vehicle + bounding box…',          '22% better mAP than YOLOv8'],
  [36, 'YOLO bbox extraction — cross-validating against RMBG mask…',         'Dual-model cross-check'],
  [42, 'Stage 2: SAM3 text-prompted concept refinement…',                    '"car body and wheels, not shadow"'],
  [50, 'SAM3 AND-mask — excluding floor shadows & reflections…',             'Neural shadow exclusion'],
  [57, 'Stage 3-4: underbody edge recovery + ground contact clip…',          'Recovering sill & diffuser geometry'],
  [62, 'Stage 5: CHAIN_APPROX_NONE — every boundary pixel traced…',          '~4000 raw boundary pixels'],
  [66, 'Stage 6: spike removal — local angle deviation ±3pt window…',        'Preserving mirrors, bumpers, arches'],
  [70, 'Stage 7: Canny edge snapping — pulling pts to strong edges…',        'Refining to within ±5px of edge'],
  [75, 'Stage 8-9: arc-length resample → 2000pt, window=3 smooth…',         'CFD-grade outline ready'],
  [80, 'Stage 10: Hough circles — wheel centre, rim radius, spokes…',        'Reading actual wheel geometry'],
  [84, 'Stage 11: Ahmed body params — Cd, CdA, rear slant angle…',           'Ahmed 1984 / Hucho 1998 correlation'],
  [88, 'Geometry engine: wheelbase norm, curvature, CFD heuristics…',        'Shape descriptors + perspective correction'],
  [92, 'Quality scoring — 10-signal confidence assessment…',                 'Checking segmentation reliability'],
  [97, 'Finalising SVG, engineering exports, DXF stub…',                     'Complete — rendering result'],
]

const VIEWS = [
  { id: 'side',  label: 'Side',      icon: '◻' },
  { id: 'front', label: 'Front',     icon: '◈' },
  { id: 'top',   label: 'Top',       icon: '⊟' },
  { id: 'under', label: 'Underside', icon: '⊠' },
]

// ── Inline CSS ────────────────────────────────────────────────────────────────
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --blue: #0A84FF; --blue-dim: rgba(10,132,255,0.12); --blue-border: rgba(10,132,255,0.35);
    --sep: rgba(255,255,255,0.07); --bg0: #030608; --bg1: #0a1018; --bg2: #111820;
    --green: #30d158; --amber: #ff9f0a; --red: #ff453a;
    --t1: rgba(255,255,255,0.75); --t2: rgba(255,255,255,0.45); --t3: rgba(255,255,255,0.22);
  }
  body { background: var(--bg0); color: #fff; font-family: 'IBM Plex Mono', monospace; overflow: hidden; }

  /* Topbar */
  .topbar { height: 42px; background: #050a0f; border-bottom: .5px solid var(--sep);
    display: flex; align-items: center; gap: 0; flex-shrink: 0; padding: 0 10px; overflow: hidden; }
  .tb-brand { font-size: 11px; font-weight: 700; letter-spacing: .14em; color: var(--blue);
    padding: 0 12px 0 2px; border-right: .5px solid var(--sep); margin-right: 8px; white-space: nowrap; }
  .tb-stat { display: flex; align-items: center; gap: 5px; padding: 0 9px;
    border-right: .5px solid var(--sep); white-space: nowrap; }
  .tb-stat .lbl { font-size: 8px; color: var(--t3); letter-spacing: .08em; text-transform: uppercase; }
  .tb-stat .val { font-size: 11px; font-weight: 700; color: var(--blue); }
  .tb-stat .val.g { color: var(--green); }
  .tb-stat .val.a { color: var(--amber); }
  .tb-spacer { flex: 1; }
  .tb-modes { display: flex; align-items: center; gap: 2px; padding: 0 10px; border-right: .5px solid var(--sep); }
  .tb-mode-btn { padding: 3px 9px; border-radius: 5px; font-size: 9px; font-family: inherit;
    border: none; cursor: pointer; transition: all .12s; letter-spacing: .04em; background: transparent; color: var(--t3); }
  .tb-mode-btn.sel { background: var(--blue-dim); color: var(--blue); font-weight: 700; border: .5px solid var(--blue-border); }
  .tb-btn { padding: 5px 13px; border-radius: 7px; border: none; cursor: pointer; font-family: inherit;
    font-size: 11px; font-weight: 700; transition: all .15s; display: flex; align-items: center; gap: 5px; margin-left: 8px; }
  .tb-run { background: var(--blue); color: #fff; }
  .tb-run:hover { filter: brightness(1.1); }
  .tb-run:disabled { background: rgba(255,255,255,0.06); color: var(--t3); cursor: not-allowed; }
  .tb-exp { background: transparent; border: .5px solid rgba(255,255,255,0.12); color: var(--t2); }
  .tb-exp:hover { border-color: rgba(255,255,255,0.3); color: #fff; }

  /* Body layout */
  .app-body { display: flex; flex: 1; overflow: hidden; min-height: 0; }

  /* Left panel */
  .left { width: 192px; flex-shrink: 0; border-right: .5px solid var(--sep);
    display: flex; flex-direction: column; background: #050a0f; overflow-y: auto; }
  .left-inner { padding: 12px 10px; }
  .sl { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; margin-top: 10px; }
  .sl:first-child { margin-top: 0; }
  .sl-n { font-size: 8px; font-weight: 700; color: var(--blue); }
  .sl-l { flex: 1; height: .5px; background: var(--sep); }
  .sl-t { font-size: 8px; color: var(--t3); letter-spacing: .1em; text-transform: uppercase; }

  /* Drop zones */
  .drop4 { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; margin-bottom: 8px; }
  .dz { border-radius: 8px; border: .5px dashed rgba(255,255,255,0.12); background: var(--bg1);
    cursor: pointer; transition: all .15s; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 3px; padding: 9px 5px;
    min-height: 66px; position: relative; overflow: hidden; }
  .dz:hover { border-color: var(--blue-border); background: var(--blue-dim); }
  .dz.loaded { border-color: rgba(48,209,88,0.4); border-style: solid; background: rgba(48,209,88,0.05); }
  .dz.dragover { border-color: var(--blue); background: rgba(10,132,255,0.15); border-style: solid; }
  .dz-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--green);
    position: absolute; top: 5px; right: 5px; }
  .dz-icon { font-size: 15px; color: var(--t3); transition: color .15s; }
  .dz.loaded .dz-icon { color: var(--green); }
  .dz-label { font-size: 8px; font-weight: 700; letter-spacing: .08em; color: var(--t2); text-transform: uppercase; }
  .dz-sub { font-size: 8px; color: var(--t3); text-align: center; line-height: 1.4; word-break: break-all; }

  .sim-btn { width: 100%; padding: 7px; border-radius: 8px;
    border: .5px solid rgba(10,132,255,0.35); background: rgba(10,132,255,0.12);
    color: var(--blue); font-size: 10px; font-weight: 700; cursor: pointer;
    font-family: inherit; letter-spacing: .06em; margin-bottom: 8px; transition: all .15s; }
  .sim-btn:hover { background: rgba(10,132,255,0.22); }

  .res-card { background: var(--bg1); border-radius: 8px; border: .5px solid rgba(255,255,255,0.06);
    padding: 7px 9px; margin-bottom: 8px; }
  .kv { display: flex; justify-content: space-between; font-size: 10px; padding: 2px 0;
    border-bottom: .5px solid rgba(255,255,255,0.04); }
  .kv:last-child { border-bottom: none; }
  .kv .k { color: var(--t3); }
  .kv .v { color: var(--blue); font-weight: 700; }
  .kv .v.g { color: var(--green); }
  .kv .v.a { color: var(--amber); }

  /* Center */
  .center { flex: 1; display: flex; flex-direction: column; overflow: hidden; min-width: 0; }
  .canvas-tb { height: 36px; background: rgba(0,0,0,0.45); border-bottom: .5px solid var(--sep);
    display: flex; align-items: center; gap: 3px; padding: 0 10px; flex-shrink: 0; overflow: hidden; }
  .vbtn { padding: 3px 10px; border-radius: 6px; border: none; cursor: pointer; font-size: 10px;
    font-family: inherit; transition: all .12s; white-space: nowrap; }
  .vbtn.on { background: rgba(10,132,255,0.18); color: var(--blue); font-weight: 700; }
  .vbtn.off { background: transparent; color: var(--t3); }
  .vdiv { width: .5px; height: 14px; background: rgba(255,255,255,0.08); margin: 0 3px; flex-shrink: 0; }
  .sep-toggle { padding: 3px 9px; border-radius: 5px; font-size: 10px; cursor: pointer;
    font-family: inherit; transition: all .12s; }
  .sep-toggle.on { border: .5px solid var(--blue); background: var(--blue-dim); color: var(--blue); }
  .sep-toggle.off { border: .5px solid rgba(255,255,255,0.1); background: transparent; color: var(--t3); }
  .tb-info { font-size: 9px; color: var(--t3); letter-spacing: .04em; margin-left: 4px; white-space: nowrap; }

  /* Canvas wrap */
  .canvas-wrap { flex: 1; position: relative; overflow: hidden; background: var(--bg0); }

  /* Pipeline overlay */
  .pl-overlay { position: absolute; inset: 0; background: rgba(3,6,8,0.97);
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 16px; padding: 20px; z-index: 20; transition: opacity .4s ease; }
  .pl-overlay.hidden { opacity: 0; pointer-events: none; }

  .ring-wrap { position: relative; width: 88px; height: 88px; }
  .ring-wrap svg { width: 88px; height: 88px; }
  .ring-pulse { position: absolute; inset: -5px; border-radius: 50%;
    border: .5px solid rgba(10,132,255,0.35); animation: rpulse 1.9s ease-out infinite; }
  @keyframes rpulse { 0%{transform:scale(1);opacity:.7} 100%{transform:scale(1.4);opacity:0} }

  .stages-row { display: flex; align-items: center; flex-wrap: wrap;
    justify-content: center; max-width: 440px; gap: 0; }
  .s-item { display: flex; align-items: center; }
  .s-node { display: flex; flex-direction: column; align-items: center; gap: 3px;
    padding: 4px 5px; border-radius: 6px; transition: all .25s; min-width: 42px; }
  .s-node.done { background: rgba(10,132,255,0.1); border: .5px solid rgba(10,132,255,0.3); }
  .s-node.active { background: rgba(10,132,255,0.16); border: .5px solid rgba(10,132,255,0.7); }
  .s-node.pending { background: transparent; border: .5px solid transparent; }
  .s-circ { width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center;
    justify-content: center; font-size: 10px; transition: all .25s; }
  .s-circ.done { background: var(--blue); color: #fff; }
  .s-circ.active { background: rgba(10,132,255,0.2); border: 1.5px solid var(--blue); color: var(--blue);
    box-shadow: 0 0 8px rgba(10,132,255,0.4); }
  .s-circ.pending { background: rgba(255,255,255,0.04); border: .5px solid rgba(255,255,255,0.1); color: var(--t3); }
  .s-name { font-size: 7px; color: var(--t3); text-align: center; line-height: 1.3; max-width: 42px; transition: color .25s; }
  .s-name.done { color: rgba(10,132,255,0.8); }
  .s-name.active { color: rgba(255,255,255,0.85); }
  .s-conn { width: 8px; height: .5px; background: rgba(255,255,255,0.1); margin-bottom: 14px; transition: background .4s; }
  .s-conn.lit { background: rgba(10,132,255,0.7); }

  .status-box { background: rgba(10,132,255,0.07); border: .5px solid rgba(10,132,255,0.22);
    border-radius: 8px; padding: 7px 18px; max-width: 400px; text-align: center; }
  .status-l1 { font-size: 11px; color: rgba(10,132,255,0.9); letter-spacing: .04em; line-height: 1.5; }
  .status-l2 { font-size: 9px; color: rgba(255,255,255,0.22); margin-top: 3px; letter-spacing: .04em; }

  .scan-track { width: 280px; height: 2px; border-radius: 9999px; background: rgba(255,255,255,0.04); overflow: hidden; }
  .scan-bar { height: 100%; width: 38%; border-radius: 9999px;
    background: linear-gradient(90deg,transparent,rgba(10,132,255,0.85),transparent);
    animation: scanbar 2.1s ease-in-out infinite; }
  @keyframes scanbar { 0%{transform:translateX(-120%)} 100%{transform:translateX(370%)} }

  .dont-reload { font-size: 9px; color: var(--t3); letter-spacing: .06em;
    animation: blink 2.8s ease-in-out infinite; }
  @keyframes blink { 0%,100%{opacity:.35} 50%{opacity:.85} }

  /* Empty state */
  .empty-state { position: absolute; inset: 0; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 14px; }
  .empty-icon { width: 54px; height: 54px; border-radius: 14px; background: rgba(255,255,255,0.04);
    border: .5px solid rgba(255,255,255,0.08); display: flex; align-items: center; justify-content: center;
    font-size: 22px; color: rgba(255,255,255,0.15); }
  .empty-title { font-size: 13px; font-weight: 500; color: rgba(255,255,255,0.45); }
  .empty-sub { font-size: 10px; color: var(--t3); text-align: center; line-height: 1.8; }
  .pipe-tags { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; justify-content: center; max-width: 340px; }
  .ptag { font-size: 8px; padding: 2px 7px; border-radius: 4px;
    border: .5px solid rgba(255,255,255,0.08); color: var(--t3); background: rgba(255,255,255,0.03); }
  .parrow { font-size: 8px; color: rgba(255,255,255,0.1); }

  /* Main SVG car drawing */
  .car-path { stroke-dasharray: 3000; stroke-dashoffset: 3000; }
  .car-path.draw { animation: draw-path 2.4s cubic-bezier(0.4,0,0.2,1) forwards; }
  @keyframes draw-path { to { stroke-dashoffset: 0; } }

  /* Thumbnail strip */
  .thumb-strip { height: 86px; flex-shrink: 0; display: grid; grid-template-columns: repeat(4,1fr);
    gap: 5px; padding: 5px; border-top: .5px solid var(--sep); background: var(--bg0); }
  .thumb-btn { border-radius: 8px; border: .5px solid rgba(255,255,255,0.06);
    background: rgba(255,255,255,0.02); cursor: pointer; padding: 3px;
    transition: all .15s; display: flex; flex-direction: column; gap: 2px; overflow: hidden; }
  .thumb-btn.active { border-color: rgba(10,132,255,0.55); background: rgba(10,132,255,0.08); }
  .thumb-canvas { flex: 1; display: flex; align-items: center; justify-content: center;
    background: #070d14; border-radius: 5px; overflow: hidden; }
  .thumb-label { font-size: 9px; font-weight: 700; text-align: center; padding: 1px 0;
    color: rgba(255,255,255,0.2); transition: color .15s; }
  .thumb-btn.active .thumb-label { color: var(--blue); }

  /* Error */
  .err-box { border-radius: 8px; padding: 7px 10px; background: rgba(255,69,58,0.08);
    border: .5px solid rgba(255,69,58,0.3); color: var(--red); font-size: 11px;
    margin-bottom: 8px; line-height: 1.5; }

  @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
`

// ── Side view SVG ─────────────────────────────────────────────────────────────
function SideViewSVG({ g, showSep, isDrawing, drawDone }) {
  const CW = 600, CH = 280, CPAD = 22
  const scale_x = CW - CPAD * 2, scale_y = CH - 52
  const off_x = CPAD, off_y = 6

  if (!g || !g._contourPts || g._contourPts.length <= 10) {
    return (
      <svg viewBox={`0 0 ${CW} ${CH}`} style={{ width: '100%', height: '100%' }} preserveAspectRatio="xMidYMid meet">
        <rect width={CW} height={CH} fill="#070d14"/>
        <text x={CW/2} y={CH/2} textAnchor="middle" fill="rgba(255,255,255,0.07)"
          fontSize="11" fontFamily="'IBM Plex Mono',monospace">Upload a photo and click Analyse</text>
      </svg>
    )
  }

  const rawPts = g._smoothPts ?? g._contourPts
  const bboxAspect = g._bboxAspect ?? (scale_x / scale_y)
  const canvasAspect = scale_x / scale_y
  let draw_w, draw_h

  if (bboxAspect > canvasAspect) {
    draw_w = scale_x * 0.94; draw_h = draw_w / bboxAspect
  } else {
    draw_h = scale_y * 0.91; draw_w = draw_h * bboxAspect
    if (draw_w > scale_x * 0.94) { draw_w = scale_x * 0.94; draw_h = draw_w / bboxAspect }
  }

  const draw_ox = off_x + (scale_x - draw_w) / 2
  const draw_oy = off_y + (scale_y - draw_h) - 6
  const toSVG = ([nx, ny]) => [draw_ox + nx * draw_w, draw_oy + ny * draw_h]

  const pathD = rawPts.map((p, i) => {
    const [sx, sy] = toSVG(p)
    return `${i === 0 ? 'M' : 'L'}${sx.toFixed(2)},${sy.toFixed(2)}`
  }).join(' ') + ' Z'

  // Ground contact line — sits just below the car
  const groundY = draw_oy + draw_h + 3
  const gY = Math.min(groundY, CH - 10)

  const keypoints = g._keypoints
  const rawWheels = keypoints?.wheels ?? []

  // Wheel arch voids — dark filled circles at arch positions so the
  // body outline reads correctly without floating wheel circles.
  // The arch cutout sits inside the outline, punching a dark hole
  // where the wheel opening is. This is how engineering drawings work —
  // the arch is part of the body silhouette, not a separate element.
  const unifiedR = rawWheels.length > 0
    ? Math.max(draw_h * 0.16, Math.min(draw_h * 0.26,
        rawWheels.map(w => w.nr * draw_w).reduce((a, b) => a + b, 0) / rawWheels.length))
    : draw_h * 0.22

  const archVoids = rawWheels.map(w => {
    const cx = draw_ox + w.nx * draw_w
    const r   = unifiedR
    // Find arch bottom from contour — the lowest contour point within ±1.8r of wheel x
    const archCap = draw_oy + draw_h * 0.93
    const band = rawPts.filter(p => {
      const sx = draw_ox + p[0] * draw_w
      const sy = draw_oy + p[1] * draw_h
      return Math.abs(sx - cx) < r * 1.8 && sy < archCap && p[1] > 0.45
    })
    const archBottomY = band.length > 0
      ? Math.max(...band.map(p => draw_oy + p[1] * draw_h))
      : (gY - r - 1)
    const cy = archBottomY - r
    return { cx, cy, r }
  })

  const drawClass = isDrawing || drawDone ? 'car-path draw' : 'car-path'

  return (
    <svg viewBox={`0 0 ${CW} ${CH}`} style={{ width: '100%', height: '100%' }} preserveAspectRatio="xMidYMid meet">
      <defs>
        {/* Clip path: everything inside the car outline. Used for arch voids. */}
        <clipPath id="car-clip">
          <path d={pathD}/>
        </clipPath>
      </defs>

      <rect width={CW} height={CH} fill="#070d14"/>

      {/* Faint ground contact line */}
      <line x1={draw_ox + draw_w * 0.04} y1={gY} x2={draw_ox + draw_w * 0.96} y2={gY}
        stroke="rgba(255,255,255,0.05)" strokeWidth="1"/>

      {/* Wheel arch voids — dark circles clipped inside the car outline.
          These create the arch opening without drawing any wheel circles.
          In engineering drawings the arch is simply a cutout in the silhouette. */}
      {(drawDone || isDrawing) && archVoids.map((v, i) => (
        <circle key={i}
          cx={v.cx.toFixed(1)} cy={v.cy.toFixed(1)} r={(v.r * 1.08).toFixed(1)}
          fill="#070d14"
          clipPath="url(#car-clip)"
          opacity="1"/>
      ))}

      {/* Car outline — crisp single stroke, drawn on top of arch voids */}
      <path d={pathD}
        fill="none"
        stroke="rgba(255,255,255,0.90)"
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
        className={drawClass}
        style={{ strokeDasharray: 3000, strokeDashoffset: isDrawing || drawDone ? undefined : 3000 }}/>

      {/* Separation point line */}
      {showSep && drawDone && keypoints?.bumpers?.rear && (
        <line
          x1={(draw_ox + keypoints.bumpers.rear.x * draw_w).toFixed(1)} y1={draw_oy.toFixed(1)}
          x2={(draw_ox + keypoints.bumpers.rear.x * draw_w).toFixed(1)} y2={gY.toFixed(1)}
          stroke="rgba(255,100,80,0.4)" strokeWidth="1" strokeDasharray="4 2"/>
      )}

      {/* Method label */}
      <text x={CW / 2} y={CH - 3} textAnchor="middle" fill="rgba(255,255,255,0.07)"
        fontSize="8" fontFamily="'IBM Plex Mono',monospace" letterSpacing=".12em">
        SIDE · {g._contourPts?.length ?? 0}pts · {g._method ?? ''}
      </text>
    </svg>
  )
}

function FrontViewSVG({ g }) {
  const W = 300, H = 220, cx = W / 2, gY = H - 14
  const kp = g?._keypoints, wheels = kp?.wheels ?? []
  const roofTopNY = kp?.roofline?.length ? Math.min(...kp.roofline.map(p => p.ny)) : 0.15
  const sillNY = kp?.sill?.length ? kp.sill.reduce((s, p) => s + p.ny, 0) / kp.sill.length : 0.80
  const trackFrac = wheels.length >= 2 ? Math.abs(wheels[1].nx - wheels[0].nx) : 0.48
  const bw = Math.round(Math.min(110, Math.max(70, trackFrac * W * 1.1)))
  const bh = Math.round(Math.min(120, Math.max(75, (sillNY - roofTopNY) * H * 1.15)))
  const bodyBot = gY - bh * 0.08, bodyTop = bodyBot - bh
  const wsAngle = g?.wsAngleDeg ?? 58
  const roofNarrow = Math.max(0.28, Math.min(0.46, 0.38 - (wsAngle - 55) * 0.003))
  const roofHW = bw * roofNarrow, shoulderHW = bw * 0.50, sillHW = bw * 0.46
  const shoulderY = bodyTop + bh * 0.55, sillY = bodyTop + bh * 0.92
  const frontPath = [`M ${cx} ${bodyTop}`,
    `C ${cx - roofHW * 0.6} ${bodyTop} ${cx - shoulderHW} ${shoulderY - bh * 0.22} ${cx - shoulderHW} ${shoulderY}`,
    `C ${cx - shoulderHW} ${shoulderY + bh * 0.12} ${cx - sillHW} ${sillY} ${cx - sillHW * 0.80} ${bodyBot}`,
    `L ${cx + sillHW * 0.80} ${bodyBot}`,
    `C ${cx + sillHW} ${sillY} ${cx + shoulderHW} ${shoulderY + bh * 0.12} ${cx + shoulderHW} ${shoulderY}`,
    `C ${cx + shoulderHW} ${shoulderY - bh * 0.22} ${cx + roofHW * 0.6} ${bodyTop} ${cx} ${bodyTop}`, 'Z'].join(' ')
  const wscPath = [`M ${cx - roofHW * 0.92} ${bodyTop + bh * 0.08}`,
    `Q ${cx} ${bodyTop + bh * 0.04} ${cx + roofHW * 0.92} ${bodyTop + bh * 0.08}`,
    `L ${cx + shoulderHW * 0.86} ${bodyTop + bh * 0.55}`, `L ${cx - shoulderHW * 0.86} ${bodyTop + bh * 0.55}`, 'Z'].join(' ')
  const wR = wheels.length >= 1 ? Math.max(12, Math.min(22, wheels[0].r / 800 * W * 0.9)) : 15
  const w1x = cx - shoulderHW * 1.05, w2x = cx + shoulderHW * 1.05, wY = gY - wR
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: '100%' }} preserveAspectRatio="xMidYMid meet">
      <rect width={W} height={H} fill="#070d14"/>
      <line x1={12} y1={gY} x2={W - 12} y2={gY} stroke="rgba(255,255,255,0.05)" strokeWidth="1"/>
      <path d={frontPath} fill="none" stroke="rgba(10,132,255,0.7)" strokeWidth="1.2"/>
      <path d={wscPath} fill="none" stroke="rgba(10,132,255,0.35)" strokeWidth=".9"/>
      {[-1, 1].map(s => <path key={s}
        d={`M ${cx + s * roofHW * 0.92} ${bodyTop + bh * 0.08} L ${cx + s * shoulderHW * 0.86} ${bodyTop + bh * 0.55}`}
        stroke="rgba(10,132,255,0.3)" strokeWidth="1.4" strokeLinecap="round"/>)}
      {[[w1x, wY], [w2x, wY]].map(([wcx, wcy], i) => (
        <g key={i}>
          <circle cx={wcx} cy={wcy} r={wR} fill="none" stroke="rgba(10,132,255,0.9)" strokeWidth="1.4"/>
          <circle cx={wcx} cy={wcy} r={wR * 0.5} fill="none" stroke="rgba(10,132,255,0.3)" strokeWidth=".8"/>
        </g>
      ))}
      <text x={cx} y={H - 3} textAnchor="middle" fill="rgba(255,255,255,0.1)" fontSize="9" fontFamily="'IBM Plex Mono',monospace" letterSpacing=".12em">FRONT</text>
    </svg>
  )
}

function TopViewSVG({ g }) {
  const W = 300, H = 220, cx = W / 2, cy = H / 2 + 6
  const kp = g?._keypoints, wheels = kp?.wheels ?? []
  const bl = Math.round(Math.min(175, Math.max(125, (g?.aspectRatio ?? 2.0) * 70))), bw = 68
  const hoodEnd = cy + bl * ((g?.hoodRatio ?? 0.28) - 0.50)
  const cabinEnd = cy + bl * ((g?.hoodRatio ?? 0.28) + (g?.cabinRatio ?? 0.44) - 0.50)
  const ghW = bw * 0.41
  const fwy = wheels.length >= 1 ? cy + bl * (wheels[0].nx * 1.1 - 0.55) : cy + bl * -0.28
  const rwy = wheels.length >= 2 ? cy + bl * (wheels[1].nx * 1.1 - 0.55) : cy + bl * 0.26
  const wR = wheels.length >= 1 ? Math.max(8, Math.min(16, wheels[0].r / 800 * W * 0.9)) : 10
  const wTrack = bw * 0.52
  const body = [`M ${cx} ${cy - bl / 2 + 5}`,
    `Q ${cx - bw * 0.24} ${cy - bl / 2 + 1} ${cx - bw * 0.48} ${cy - bl / 2 + 22}`,
    `Q ${cx - bw * 0.50} ${cy - bl / 2 + 52} ${cx - bw * 0.50} ${cy}`,
    `Q ${cx - bw * 0.50} ${cy + bl * 0.12} ${cx - bw * 0.44} ${cy + bl / 2 - 10}`,
    `Q ${cx - bw * 0.30} ${cy + bl / 2 - 2} ${cx} ${cy + bl / 2 - 2}`,
    `Q ${cx + bw * 0.30} ${cy + bl / 2 - 2} ${cx + bw * 0.44} ${cy + bl / 2 - 10}`,
    `Q ${cx + bw * 0.50} ${cy + bl * 0.12} ${cx + bw * 0.50} ${cy}`,
    `Q ${cx + bw * 0.50} ${cy - bl / 2 + 52} ${cx + bw * 0.48} ${cy - bl / 2 + 22}`,
    `Q ${cx + bw * 0.24} ${cy - bl / 2 + 1} ${cx} ${cy - bl / 2 + 5}`, 'Z'].join(' ')
  const ghPath = [`M ${cx} ${hoodEnd - 4}`,
    `Q ${cx - ghW * 0.50} ${hoodEnd + 2} ${cx - ghW * 0.52} ${hoodEnd + 16}`,
    `L ${cx - ghW * 0.52} ${cabinEnd - 10}`,
    `Q ${cx - ghW * 0.44} ${cabinEnd} ${cx} ${cabinEnd}`,
    `Q ${cx + ghW * 0.44} ${cabinEnd} ${cx + ghW * 0.52} ${cabinEnd - 10}`,
    `L ${cx + ghW * 0.52} ${hoodEnd + 16}`,
    `Q ${cx + ghW * 0.50} ${hoodEnd + 2} ${cx} ${hoodEnd - 4}`, 'Z'].join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: '100%' }} preserveAspectRatio="xMidYMid meet">
      <rect width={W} height={H} fill="#070d14"/>
      <path d={body} fill="none" stroke="rgba(10,132,255,0.65)" strokeWidth="1.1"/>
      <path d={ghPath} fill="none" stroke="rgba(10,132,255,0.32)" strokeWidth=".9"/>
      {[[-wTrack, fwy], [wTrack, fwy], [-wTrack, rwy], [wTrack, rwy]].map(([wx, wy], i) => (
        <ellipse key={i} cx={cx + wx} cy={wy} rx={wR * 0.44} ry={wR} fill="none" stroke="rgba(10,132,255,0.72)" strokeWidth="1.2"/>
      ))}
      <text x={cx} y={H - 4} textAnchor="middle" fill="rgba(255,255,255,0.1)" fontSize="9" fontFamily="'IBM Plex Mono',monospace" letterSpacing=".12em">TOP</text>
    </svg>
  )
}

function UnderViewSVG({ g }) {
  const W = 300, H = 220, cx = W / 2, cy = H / 2 + 6
  const kp = g?._keypoints, wheels = kp?.wheels ?? []
  const bl = Math.round(Math.min(175, Math.max(125, (g?.aspectRatio ?? 2.0) * 70))), bw = 68
  const fwy = wheels.length >= 1 ? cy + bl * (wheels[0].nx * 1.1 - 0.55) : cy - bl * 0.28
  const rwy = wheels.length >= 2 ? cy + bl * (wheels[1].nx * 1.1 - 0.55) : cy + bl * 0.26
  const wR = wheels.length >= 1 ? Math.max(8, Math.min(16, wheels[0].r / 800 * W * 0.9)) : 10
  const wTrack = bw * 0.52
  const diffY = cy + bl / 2 - bl * 0.14
  const body = [`M ${cx} ${cy - bl / 2 + 5}`,
    `Q ${cx - bw * 0.24} ${cy - bl / 2 + 1} ${cx - bw * 0.48} ${cy - bl / 2 + 22}`,
    `L ${cx - bw * 0.50} ${cy + bl * 0.08}`,
    `Q ${cx - bw * 0.48} ${cy + bl / 2 - 12} ${cx - bw * 0.42} ${cy + bl / 2 - 3}`,
    `L ${cx + bw * 0.42} ${cy + bl / 2 - 3}`,
    `Q ${cx + bw * 0.48} ${cy + bl / 2 - 12} ${cx + bw * 0.50} ${cy + bl * 0.08}`,
    `L ${cx + bw * 0.48} ${cy - bl / 2 + 22}`,
    `Q ${cx + bw * 0.24} ${cy - bl / 2 + 1} ${cx} ${cy - bl / 2 + 5}`, 'Z'].join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: '100%' }} preserveAspectRatio="xMidYMid meet">
      <rect width={W} height={H} fill="#070d14"/>
      <path d={body} fill="none" stroke="rgba(10,132,255,0.65)" strokeWidth="1.1"/>
      <rect x={cx - bw * 0.28} y={cy - bl * 0.35} width={bw * 0.56} height={bl * 0.62} rx="3"
        fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth=".8"/>
      <path d={`M ${cx - bw * 0.38} ${diffY} L ${cx - bw * 0.42} ${cy + bl / 2 - 3} L ${cx + bw * 0.42} ${cy + bl / 2 - 3} L ${cx + bw * 0.38} ${diffY} Z`}
        fill="none" stroke="rgba(10,132,255,0.38)" strokeWidth=".9"/>
      {[[-wTrack, fwy], [wTrack, fwy], [-wTrack, rwy], [wTrack, rwy]].map(([wx, wy], i) => (
        <ellipse key={i} cx={cx + wx} cy={wy} rx={wR * 0.44} ry={wR} fill="none" stroke="rgba(10,132,255,0.72)" strokeWidth="1.2"/>
      ))}
      <text x={cx} y={H - 4} textAnchor="middle" fill="rgba(255,255,255,0.1)" fontSize="9" fontFamily="'IBM Plex Mono',monospace" letterSpacing=".12em">UNDERSIDE</text>
    </svg>
  )
}

// ── CFD Streamline Animation ──────────────────────────────────────────────────
// Animated streamlines flowing around a ghost car during analysis.
// The car is a simplified SVG silhouette. Particles are CSS-animated lines
// that travel left-to-right and deflect around the car body shape.
function CFDStreamlines({ pct }) {
  // 18 horizontal streamlines at different heights
  // Each streamline has a slight vertical deflection as it passes the car
  const lines = [
    { y: 0.08, amp: 0.00, phase: 0.0, speed: 2.8 },
    { y: 0.14, amp: -0.01, phase: 0.1, speed: 3.1 },
    { y: 0.20, amp: -0.02, phase: 0.2, speed: 2.6 },
    { y: 0.27, amp: -0.04, phase: 0.1, speed: 3.3 },
    { y: 0.33, amp: -0.07, phase: 0.0, speed: 2.9 },
    { y: 0.39, amp: -0.09, phase: 0.2, speed: 3.5 },
    { y: 0.44, amp: -0.06, phase: 0.1, speed: 2.7 },
    { y: 0.50, amp: -0.03, phase: 0.0, speed: 3.0 },
    { y: 0.55, amp:  0.01, phase: 0.2, speed: 3.2 },
    { y: 0.60, amp:  0.04, phase: 0.0, speed: 2.8 },
    { y: 0.65, amp:  0.07, phase: 0.1, speed: 3.4 },
    { y: 0.70, amp:  0.05, phase: 0.2, speed: 2.9 },
    { y: 0.75, amp:  0.03, phase: 0.0, speed: 3.1 },
    { y: 0.80, amp:  0.01, phase: 0.1, speed: 2.7 },
    { y: 0.85, amp:  0.00, phase: 0.0, speed: 3.0 },
    { y: 0.90, amp:  0.00, phase: 0.0, speed: 3.3 },
  ]

  // Ghost car silhouette — simplified SUV/MPV side profile
  const carPath = `
    M 80,148 L 82,130 Q 88,95 102,80 L 125,72 Q 148,62 182,58
    Q 220,54 248,56 L 272,58 Q 298,60 318,72 L 338,82 Q 352,90 360,100
    L 368,112 Q 374,122 376,134 L 378,148
    Q 370,150 362,150 L 340,150 Q 326,150 310,150
    L 200,150 Q 184,150 170,150 L 150,150 Q 134,150 118,150
    L 98,150 Q 86,150 80,148 Z
  `

  const W = 460, H = 200

  // Streamline path generator: horizontal with smooth bump around car region (x: 80-380)
  const streamPath = (ln) => {
    const y0 = ln.y * H
    const pts = []
    for (let x = 0; x <= W; x += 14) {
      // Deflection: only in car x-range [80,380], peak at x=230
      const inCar = x > 70 && x < 390
      const relX = (x - 230) / 160  // -1 to +1
      const bump = inCar ? ln.amp * H * Math.exp(-relX * relX * 1.8) : 0
      pts.push(`${x},${(y0 + bump).toFixed(1)}`)
    }
    return 'M ' + pts.join(' L ')
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: 460, height: 200, position: 'absolute' }}>
      <defs>
        {lines.map((ln, i) => (
          <linearGradient key={i} id={`sg${i}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%"   stopColor="#0A84FF" stopOpacity="0"/>
            <stop offset="35%"  stopColor="#0A84FF" stopOpacity="0.55"/>
            <stop offset="65%"  stopColor="#0A84FF" stopOpacity="0.55"/>
            <stop offset="100%" stopColor="#0A84FF" stopOpacity="0"/>
          </linearGradient>
        ))}
        <linearGradient id="wake-grad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#ff453a" stopOpacity="0"/>
          <stop offset="100%" stopColor="#ff453a" stopOpacity="0.18"/>
        </linearGradient>
      </defs>

      {/* Wake region behind car */}
      <rect x="376" y={H * 0.18} width="84" height={H * 0.64} rx="4"
        fill="url(#wake-grad)" opacity="0.6"/>

      {/* Streamlines */}
      {lines.map((ln, i) => (
        <path key={i} d={streamPath(ln)}
          fill="none"
          stroke={`url(#sg${i})`}
          strokeWidth={ln.y > 0.35 && ln.y < 0.72 ? 1.2 : 0.8}
          strokeLinecap="round"
          style={{
            strokeDasharray: W * 0.55,
            strokeDashoffset: W * 0.55,
            animation: `flow${i % 4} ${ln.speed}s ease-in-out ${(i * 0.18).toFixed(2)}s infinite`,
          }}/>
      ))}

      {/* Ghost car silhouette */}
      <path d={carPath} fill="rgba(10,132,255,0.04)" stroke="rgba(10,132,255,0.25)"
        strokeWidth="1.2" strokeLinejoin="round"/>

      {/* Stagnation point — front of car */}
      <circle cx="80" cy="148" r="2.5" fill="rgba(255,159,10,0.8)"/>
      <circle cx="80" cy="148" r="5" fill="none" stroke="rgba(255,159,10,0.3)" strokeWidth=".8"/>

      {/* Separation point — rear */}
      <circle cx="378" cy="134" r="2" fill="rgba(255,69,58,0.7)"/>

      {/* Flow direction arrow */}
      <text x="12" y={H * 0.5 + 4} fill="rgba(10,132,255,0.35)" fontSize="9"
        fontFamily="'IBM Plex Mono',monospace">U∞ →</text>

      <style>{`
        @keyframes flow0 { 0%{stroke-dashoffset:${W*0.55}} 100%{stroke-dashoffset:-${W*0.55}} }
        @keyframes flow1 { 0%{stroke-dashoffset:${W*0.65}} 100%{stroke-dashoffset:-${W*0.55}} }
        @keyframes flow2 { 0%{stroke-dashoffset:${W*0.45}} 100%{stroke-dashoffset:-${W*0.55}} }
        @keyframes flow3 { 0%{stroke-dashoffset:${W*0.75}} 100%{stroke-dashoffset:-${W*0.55}} }
      `}</style>
    </svg>
  )
}

// ── Pipeline Overlay component ────────────────────────────────────────────────
function PipelineOverlay({ pct, msg, sub, visible }) {
  const circ = 2 * Math.PI * 37
  const offset = circ * (1 - pct / 100)
  return (
    <div className={'pl-overlay' + (visible ? '' : ' hidden')}>

      {/* CFD streamline animation — the hero visual during analysis */}
      <div style={{ position: 'relative', width: 460, height: 200,
        borderRadius: 12, overflow: 'hidden',
        background: 'rgba(10,132,255,0.03)',
        border: '.5px solid rgba(10,132,255,0.12)' }}>
        <CFDStreamlines pct={pct}/>
        {/* Legend */}
        <div style={{ position: 'absolute', bottom: 8, right: 10,
          display: 'flex', gap: 12, alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'rgba(255,159,10,0.8)' }}/>
            <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.25)', fontFamily: "'IBM Plex Mono'" }}>stagnation</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'rgba(255,69,58,0.7)' }}/>
            <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.25)', fontFamily: "'IBM Plex Mono'" }}>separation</span>
          </div>
        </div>
      </div>

      {/* Progress ring */}
      <div className="ring-wrap">
        <div className="ring-pulse"/>
        <svg viewBox="0 0 88 88">
          <circle cx="44" cy="44" r="37" fill="none" stroke="rgba(10,132,255,0.08)" strokeWidth="5"/>
          <circle cx="44" cy="44" r="37" fill="none" stroke="rgba(10,132,255,0.9)" strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={circ.toFixed(2)}
            strokeDashoffset={offset.toFixed(2)}
            transform="rotate(-90 44 44)"
            style={{ transition: 'stroke-dashoffset 0.5s ease' }}/>
          <text x="44" y="40" textAnchor="middle" fill="white" fontSize="16" fontWeight="700"
            fontFamily="'IBM Plex Mono',monospace">{Math.round(pct)}</text>
          <text x="44" y="52" textAnchor="middle" fill="rgba(10,132,255,0.7)" fontSize="8"
            fontFamily="'IBM Plex Mono',monospace">%</text>
        </svg>
      </div>

      {/* Stage nodes */}
      <div className="stages-row">
        {STAGES.map((s, i) => {
          const done = pct >= s.pct[1]
          const active = pct >= s.pct[0] && pct < s.pct[1]
          const state = done ? 'done' : active ? 'active' : 'pending'
          return (
            <div key={s.id} className="s-item">
              <div className={`s-node ${state}`}>
                <div className={`s-circ ${state}`}>{done ? '✓' : s.icon}</div>
                <div className={`s-name ${state}`}>{s.label}</div>
              </div>
              {i < STAGES.length - 1 && <div className={`s-conn ${done ? 'lit' : ''}`}/>}
            </div>
          )
        })}
      </div>

      <div className="status-box">
        <div className="status-l1">{msg}</div>
        <div className="status-l2">{sub}</div>
      </div>
      <div className="scan-track"><div className="scan-bar"/></div>
      <div className="dont-reload">Please wait · Do not close or reload this tab</div>
    </div>
  )
}

// ── Drop zone component ───────────────────────────────────────────────────────
function DropZone({ viewId, label, icon, file, onFile }) {
  const [dragover, setDragover] = useState(false)
  const inputRef = useRef(null)

  const handleDrop = (e) => {
    e.preventDefault(); setDragover(false)
    const f = e.dataTransfer.files?.[0]
    if (f && f.type.startsWith('image/')) onFile(viewId, f)
  }
  const handleChange = (e) => {
    const f = e.target.files?.[0]
    if (f) onFile(viewId, f)
  }
  const cls = ['dz', file ? 'loaded' : '', dragover ? 'dragover' : ''].filter(Boolean).join(' ')

  return (
    <div className={cls}
      onClick={() => inputRef.current?.click()}
      onDragOver={e => { e.preventDefault(); setDragover(true) }}
      onDragLeave={() => setDragover(false)}
      onDrop={handleDrop}>
      <input ref={inputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleChange}/>
      {file && <div className="dz-dot"/>}
      <div className="dz-icon">{icon}</div>
      <div className="dz-label">{label}</div>
      <div className="dz-sub" style={{ fontSize: 8, color: 'rgba(255,255,255,0.22)', textAlign: 'center', lineHeight: 1.4 }}>
        {file ? file.name.slice(0, 14) + (file.name.length > 14 ? '…' : '') : 'drop or click'}
      </div>
    </div>
  )
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function AeroNetV2() {
  const [viewFiles, setViewFiles]         = useState({ side: null, front: null, top: null, under: null })
  const [activeView, setActiveView]       = useState('side')
  const [analysisMode, setAnalysisMode]   = useState('A')
  const [showSep, setShowSep]             = useState(true)
  const [stage, setStage]                 = useState('idle')
  const [geo, setGeo]                     = useState(null)
  const [error, setError]                 = useState(null)
  const [bgRemovedImg, setBgRemovedImg]   = useState(null)
  const [traceProgress, setTraceProgress] = useState({ pct: 0, msg: 'Waiting…', sub: '' })
  const [isDrawing, setIsDrawing]         = useState(false)
  const [drawDone, setDrawDone]           = useState(false)
  const svgRef = useRef(null)

  const isRunning = stage === 'analyzing'
  const hasMainFile = !!viewFiles.side

  const setViewFile = useCallback((viewId, file) => {
    setViewFiles(p => ({ ...p, [viewId]: file }))
    if (viewId === 'side') {
      setGeo(null); setError(null); setDrawDone(false); setIsDrawing(false)
    }
  }, [])

  // Paste handler
  useEffect(() => {
    const handle = (e) => {
      const items = Array.from(e.clipboardData?.items ?? [])
      const img = items.find(i => i.type.startsWith('image/'))
      if (img) { setViewFile('side', img.getAsFile()); return }
      const text = e.clipboardData?.getData('text') ?? ''
      if (/^https?:\/\//i.test(text)) {
        fetchImageFromUrl(text).then(f => setViewFile('side', f)).catch(err => setError(err.message))
      }
    }
    window.addEventListener('paste', handle)
    return () => window.removeEventListener('paste', handle)
  }, [setViewFile])

  const getMsgForPct = (pct) => {
    const entry = [...BACKEND_MSGS].reverse().find(m => pct >= m[0])
    return entry ? { msg: entry[1], sub: entry[2] } : { msg: 'Processing…', sub: '' }
  }

  const simulateAll = () => {
    const dummy = new File([''], 'simulated.jpg', { type: 'image/jpeg' })
    setViewFiles({ side: dummy, front: dummy, top: dummy, under: dummy })
    setTimeout(() => run(dummy), 100)
  }

  const run = async (fileOverride) => {
    const file = fileOverride || viewFiles.side
    if (!file) return
    setError(null); setGeo(null); setDrawDone(false); setIsDrawing(false)
    setStage('analyzing')
    setTraceProgress({ pct: 2, msg: 'Preparing image…', sub: 'Input normalisation' })

    let uploadFile
    try { uploadFile = await prepareImage(file) } catch { uploadFile = file }

    let jobId = null
    const MAX_ATTEMPTS = 8
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const { msg, sub } = getMsgForPct(5)
      setTraceProgress({ pct: 5, msg: attempt === 0 ? 'Connecting to server…' : `Retrying… (${attempt * 5}s elapsed)`, sub })
      try {
        const fd = new FormData()
        fd.append('file', uploadFile)
        fd.append('mode', analysisMode)
        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), 25000)
        let res
        try { res = await fetch(`${API_BASE}/analyze-contour/start`, { method: 'POST', body: fd, signal: ctrl.signal }) }
        finally { clearTimeout(timer) }
        if (res.ok) { jobId = (await res.json()).job_id; break }
        const text = await res.text().catch(() => '')
        setError(`Server error ${res.status}${text ? ': ' + text.slice(0, 120) : ''}`)
        setStage('idle'); setTraceProgress({ pct: 0, msg: '', sub: '' }); return
      } catch {
        if (attempt >= MAX_ATTEMPTS - 1) {
          setError(`Could not reach server after ${MAX_ATTEMPTS * 5}s.`)
          setStage('idle'); setTraceProgress({ pct: 0, msg: '', sub: '' }); return
        }
        await new Promise(r => setTimeout(r, 5000))
      }
    }
    if (!jobId) { setError('Failed to start job.'); setStage('idle'); return }
    setTraceProgress({ pct: 10, msg: 'Job queued — preprocessing image…', sub: 'Input normalisation' })

    const startTime = Date.now()
    while (true) {
      await new Promise(r => setTimeout(r, 3000))
      const elapsed = Math.round((Date.now() - startTime) / 1000)
      let poll
      try {
        const pc = new AbortController(); const pt = setTimeout(() => pc.abort(), 10000)
        let res
        try { res = await fetch(`${API_BASE}/analyze-contour/result/${jobId}`, { signal: pc.signal }) }
        finally { clearTimeout(pt) }
        if (!res.ok) { setError(`Poll error ${res.status}`); setStage('idle'); return }
        poll = await res.json()
      } catch (e) { setError(`Connection lost: ${e.message}`); setStage('idle'); return }

      if (poll.status === 'error') { setError(poll.error ?? 'Analysis failed'); setStage('idle'); return }
      if (poll.status === 'running' || poll.status === 'pending') {
        const pct = Math.min(90, 10 + elapsed * 1.2)
        const { msg, sub } = getMsgForPct(pct)
        setTraceProgress({ pct: Math.round(pct), msg: `${msg} ${elapsed}s`, sub })
        continue
      }
      if (poll.status === 'done') {
        const result = poll.result
        if (!result?.geometry) {
          setError('No vehicle outline found. Use a clear side-on photo.')
          setStage('idle'); return
        }
        setTraceProgress({ pct: 98, msg: 'Complete ✓ — rendering outline…', sub: 'Drawing car silhouette' })
        if (result.bg_removed_image) setBgRemovedImg(`data:image/jpeg;base64,${result.bg_removed_image}`)
        const cg = result.geometry
        const allPts = result.display_outline_pts ?? result.smooth_pts ?? []
        setGeo({
          aspectRatio: cg.aspectRatio ?? 2.0, hoodRatio: cg.hoodRatio ?? 0.28,
          cabinRatio: cg.cabinRatio ?? 0.44, bootRatio: cg.bootRatio ?? 0.28,
          wsAngleDeg: cg.wsAngleDeg ?? 58, rearDrop: cg.rearDrop ?? 0.15,
          rideH: cg.rideH ?? 0.08, archDepth: cg.archDepth ?? null,
          Cd: cg.Cd ?? 0, CdA: cg.CdA ?? 0, confidence: cg.confidence ?? 0.97,
          rearSlantAngleDeg: cg.rearSlantAngleDeg ?? 20,
          ahmedRegime: cg.ahmedRegime ?? 'intermediate',
          wheelbaseNorm: cg.wheelbaseNorm ?? 0, separationPointX: cg.separationPointX ?? 0.75,
          _contourPts: result.technical_outline_pts ?? result.outline_pts,
          _smoothPts: result.display_outline_pts ?? result.smooth_pts,
          _bboxAspect: result.bbox ? result.bbox.w / Math.max(1, result.bbox.h) : undefined,
          _keypoints: result.keypoints, _method: result.method,
          _panels: result.panels ?? null, _aero: result.aero ?? null,
          _quality: result.quality ?? null,
        })
        setStage('done')
        setTimeout(() => {
          setTraceProgress({ pct: 0, msg: '', sub: '' })
          setIsDrawing(true)
          setTimeout(() => { setIsDrawing(false); setDrawDone(true) }, 2600)
        }, 600)
        return
      }
    }
  }

  const exportSVG = () => {
    const svg = svgRef.current?.querySelector('svg')
    if (!svg) return
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([svg.outerHTML], { type: 'image/svg+xml' }))
    a.download = `aeronet_${activeView}.svg`; a.click()
  }

  const getViewSVG = (viewId) => {
    if (!geo) return null
    if (viewId === 'side') return <SideViewSVG g={geo} showSep={showSep} isDrawing={isDrawing} drawDone={drawDone}/>
    if (viewId === 'front') return <FrontViewSVG g={geo}/>
    if (viewId === 'top') return <TopViewSVG g={geo}/>
    if (viewId === 'under') return <UnderViewSVG g={geo}/>
    return null
  }

  const ahmedColor = (r) => ({ attached: '#30d158', intermediate: '#ff9f0a', critical: '#ff453a', separated: '#ff453a' }[r] ?? '#0A84FF')

  return (
    <>
      <style>{CSS}</style>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>

        {/* ── Topbar ── */}
        <div className="topbar">
          <span className="tb-brand">AERONET</span>
          {geo ? (<>
            <div className="tb-stat"><span className="lbl">Method</span><span className="val" style={{ fontSize: 9 }}>{geo._method ?? '—'}</span></div>
            <div className="tb-stat"><span className="lbl">Quality</span><span className={'val ' + (geo._quality?.score >= 75 ? 'g' : 'a')}>{geo._quality?.score ?? '—'}/100</span></div>
            <div className="tb-stat"><span className="lbl">Cd est.</span><span className="val">{geo.Cd?.toFixed(3) ?? '—'}</span></div>
            <div className="tb-stat"><span className="lbl">CdA</span><span className="val">{geo.CdA?.toFixed(4) ?? '—'}</span></div>
            <div className="tb-stat"><span className="lbl">Ahmed</span><span className="val a" style={{ color: ahmedColor(geo.ahmedRegime) }}>{geo.ahmedRegime?.toUpperCase()} {geo.rearSlantAngleDeg?.toFixed(0)}°</span></div>
            <div className="tb-stat"><span className="lbl">Wheels</span><span className="val">{geo._keypoints?.wheels?.length ?? 0} found</span></div>
            <div className="tb-stat"><span className="lbl">Aspect</span><span className="val">{geo.aspectRatio?.toFixed(2) ?? '—'}</span></div>
            <div className="tb-stat"><span className="lbl">WS rake</span><span className="val">{geo.wsAngleDeg?.toFixed(0) ?? '—'}°</span></div>
            <div className="tb-stat"><span className="lbl">Rear slant</span><span className="val">{geo.rearSlantAngleDeg?.toFixed(0) ?? '—'}°</span></div>
          </>) : (
            <div className="tb-stat"><span className="lbl" style={{ color: 'rgba(255,255,255,0.15)' }}>Upload a side photo and analyse to see results</span></div>
          )}
          <div className="tb-spacer"/>
          <div className="tb-modes">
            {[{ id: 'A', label: '◎ Silhouette', desc: '~30s' }, { id: 'B', label: '⊞ Panels', desc: '~90s' }, { id: 'C', label: '⬡ Full Aero', desc: '~150s' }].map(m => (
              <button key={m.id} className={'tb-mode-btn' + (analysisMode === m.id ? ' sel' : '')}
                onClick={() => setAnalysisMode(m.id)} title={m.desc}>{m.label}</button>
            ))}
          </div>
          <button className={'tb-btn tb-run'} onClick={() => run()} disabled={!hasMainFile || isRunning}>
            {isRunning
              ? <><span style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }}/> Analysing…</>
              : <>▶ Analyse</>}
          </button>
          <button className="tb-btn tb-exp" onClick={exportSVG} disabled={!geo}>↓ SVG</button>
        </div>

        <div className="app-body">

          {/* ── Left panel ── */}
          <div className="left">
            <div className="left-inner">

              <div className="sl"><span className="sl-n">01</span><div className="sl-l"/><span className="sl-t">Upload views</span></div>

              <div className="drop4">
                <DropZone viewId="side"  label="Side"      icon="◻" file={viewFiles.side}  onFile={setViewFile}/>
                <DropZone viewId="front" label="Front"     icon="◈" file={viewFiles.front} onFile={setViewFile}/>
                <DropZone viewId="top"   label="Top"       icon="⊟" file={viewFiles.top}   onFile={setViewFile}/>
                <DropZone viewId="under" label="Underside" icon="⊠" file={viewFiles.under} onFile={setViewFile}/>
              </div>

              <button className="sim-btn" onClick={simulateAll}>
                ⬡ Simulate All Views
              </button>

              {error && <div className="err-box">{error}</div>}

              {geo && (<>
                <div className="sl"><span className="sl-n">02</span><div className="sl-l"/><span className="sl-t">Result</span></div>
                <div className="res-card">
                  {[
                    ['Points',     (geo._contourPts?.length ?? 0) + ' pt'],
                    ['Wheels',     (geo._keypoints?.wheels?.length ?? 0) + ' found'],
                    ['Aspect',     (geo.aspectRatio ?? 0).toFixed(2)],
                    ['WS rake',    (geo.wsAngleDeg ?? 0).toFixed(0) + '°'],
                    ['Rear slant', (geo.rearSlantAngleDeg ?? 0).toFixed(0) + '°'],
                    ['Cd est.',    (geo.Cd ?? 0).toFixed(3)],
                    ['CdA',        (geo.CdA ?? 0).toFixed(4)],
                    ['Hood',       ((geo.hoodRatio ?? 0) * 100).toFixed(0) + '%'],
                    ['Cabin',      ((geo.cabinRatio ?? 0) * 100).toFixed(0) + '%'],
                    ['Boot',       ((geo.bootRatio ?? 0) * 100).toFixed(0) + '%'],
                    ['Ride h.',    geo.rideH != null ? (geo.rideH * 100).toFixed(1) + '%' : '—'],
                    ['Arch d.',    geo.archDepth != null ? (geo.archDepth * 100).toFixed(1) + '%' : '—'],
                  ].map(([k, v]) => (
                    <div key={k} className="kv"><span className="k">{k}</span><span className="v">{v}</span></div>
                  ))}
                </div>

                <div className="sl"><span className="sl-n">03</span><div className="sl-l"/><span className="sl-t">Quality</span></div>
                <div className="res-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: geo._quality?.score >= 75 ? 'var(--green)' : 'var(--amber)' }}>
                      {geo._quality?.score ?? 0}/100
                    </span>
                    <span style={{ fontSize: 8, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{geo._quality?.status}</span>
                  </div>
                  <div style={{ height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.06)' }}>
                    <div style={{ height: '100%', borderRadius: 2, width: `${geo._quality?.score ?? 0}%`,
                      background: geo._quality?.score >= 75 ? 'var(--green)' : 'var(--amber)', transition: 'width .6s' }}/>
                  </div>
                  {geo._quality?.warnings?.slice(0, 2).map((w, i) => (
                    <div key={i} style={{ fontSize: 9, color: 'var(--amber)', marginTop: 4, lineHeight: 1.4 }}>⚠ {w}</div>
                  ))}
                </div>

                {geo.ahmedRegime && (
                  <>
                    <div className="sl"><span className="sl-n">04</span><div className="sl-l"/><span className="sl-t">Ahmed</span></div>
                    <div className="res-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 10, color: 'var(--t3)' }}>Regime</span>
                      <span style={{ fontSize: 10, fontWeight: 700, color: ahmedColor(geo.ahmedRegime),
                        background: `${ahmedColor(geo.ahmedRegime)}18`, padding: '2px 8px', borderRadius: 4 }}>
                        {geo.ahmedRegime.toUpperCase()} {geo.rearSlantAngleDeg?.toFixed(1)}°
                      </span>
                    </div>
                  </>
                )}
              </>)}
            </div>
          </div>

          {/* ── Center ── */}
          <div className="center">
            <div className="canvas-tb">
              {VIEWS.map(v => (
                <button key={v.id} className={'vbtn ' + (activeView === v.id ? 'on' : 'off')}
                  onClick={() => setActiveView(v.id)}>{v.label}</button>
              ))}
              <div className="vdiv"/>
              <button className={'sep-toggle ' + (showSep ? 'on' : 'off')} onClick={() => setShowSep(p => !p)}>Sep</button>
              {geo && <span className="tb-info">SIDE · {geo._contourPts?.length ?? 0}pts · {geo._method ?? ''}</span>}
            </div>

            <div className="canvas-wrap" ref={svgRef}>
              <PipelineOverlay
                visible={isRunning}
                pct={traceProgress.pct}
                msg={traceProgress.msg}
                sub={traceProgress.sub}/>

              {!geo && !isRunning && (
                <div className="empty-state">
                  <div className="empty-icon">◈</div>
                  <div className="empty-title">Vehicle outline analysis</div>
                  <div className="empty-sub">
                    Drop a side photo into the Side slot<br/>
                    then click Analyse. Add Front / Top / Underside<br/>
                    photos to enable all four views.
                  </div>
                  <div className="pipe-tags">
                    {['RMBG 2.0','→','YOLO11x','→','SAM3','→','2000pt contour','→','Ahmed CFD'].map((t, i) => (
                      t === '→' ? <span key={i} className="parrow">→</span> : <span key={i} className="ptag">{t}</span>
                    ))}
                  </div>
                </div>
              )}

              {geo && !isRunning && (
                <div style={{ width: '100%', height: '100%' }}>
                  {getViewSVG(activeView)}
                </div>
              )}
            </div>

            {/* ── Thumbnail strip ── */}
            <div className="thumb-strip">
              {VIEWS.map(v => (
                <button key={v.id} className={'thumb-btn' + (activeView === v.id ? ' active' : '')}
                  onClick={() => setActiveView(v.id)}>
                  <div className="thumb-canvas">
                    {geo ? (
                      <div style={{ width: '100%', height: '100%', pointerEvents: 'none' }}>
                        {v.id === 'side'  && <SideViewSVG g={geo} showSep={false} isDrawing={false} drawDone={drawDone}/>}
                        {v.id === 'front' && <FrontViewSVG g={geo}/>}
                        {v.id === 'top'   && <TopViewSVG g={geo}/>}
                        {v.id === 'under' && <UnderViewSVG g={geo}/>}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center',
                        justifyContent: 'center', gap: 3, width: '100%', height: '100%' }}>
                        <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.1)' }}>+</span>
                        {viewFiles[v.id] && <span style={{ fontSize: 7, color: 'rgba(48,209,88,0.6)' }}>loaded</span>}
                      </div>
                    )}
                  </div>
                  <div className="thumb-label">{v.label}</div>
                </button>
              ))}
            </div>

          </div>
        </div>
      </div>
    </>
  )
}
