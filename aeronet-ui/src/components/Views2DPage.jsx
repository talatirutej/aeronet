// AeroNet v2 — Vehicle Outline Analysis (Side View Only)
// Copyright (c) 2026 Rutej Talati. All rights reserved.

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
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h)
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'
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
  const proxies = [u => u,
    u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    u => `https://corsproxy.io/?${encodeURIComponent(u)}`]
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
  throw new Error('Could not fetch image — try downloading and uploading directly')
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
  [0,  'Stage 0a: EXIF correction, canvas margin, resize to 1536px…',  'Input normalisation'],
  [8,  'Stage 0b: RMBG 2.0 — product-photo foreground extraction…',    'Separating car from background'],
  [18, 'RMBG 2.0 forward pass — BiRefNet architecture, 1024×1024…',    'Neural segmentation in progress'],
  [28, 'Stage 1: YOLO11x-seg — confirming vehicle + bounding box…',    '22% better mAP than YOLOv8'],
  [36, 'YOLO bbox extraction — cross-validating against RMBG mask…',   'Dual-model cross-check'],
  [42, 'Stage 2: SAM3 text-prompted concept refinement…',              '"car body, not floor shadow"'],
  [50, 'SAM3 AND-mask — excluding floor shadows & reflections…',       'Neural shadow exclusion'],
  [57, 'Stage 3-4: underbody edge recovery + ground contact clip…',    'Recovering sill geometry'],
  [62, 'Stage 5: CHAIN_APPROX_NONE — every boundary pixel traced…',    '~4000 raw boundary pixels'],
  [66, 'Stage 6: spike removal — local angle deviation ±3pt window…', 'Preserving bumpers, arches'],
  [70, 'Stage 7: Canny edge snapping — pulling pts to strong edges…', 'Refining to within ±5px'],
  [75, 'Stage 8-9: arc-length resample → 2000pt, window=3 smooth…',   'CFD-grade outline ready'],
  [80, 'Stage 10: Hough circles — wheel centre, rim radius, spokes…', 'Reading wheel geometry'],
  [84, 'Stage 11: Ahmed body params — Cd, CdA, rear slant angle…',    'Ahmed 1984 / Hucho 1998'],
  [88, 'Geometry engine: wheelbase norm, curvature, heuristics…',      'Shape descriptors'],
  [92, 'Quality scoring — 10-signal confidence assessment…',           'Checking reliability'],
  [97, 'Finalising SVG, engineering exports, DXF stub…',               'Complete — rendering'],
]

// ── CSS ───────────────────────────────────────────────────────────────────────
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
  .topbar { height: 42px; background: #050a0f; border-bottom: .5px solid var(--sep);
    display: flex; align-items: center; gap: 0; flex-shrink: 0; padding: 0 10px; overflow: hidden; }
  .tb-brand { font-size: 11px; font-weight: 700; letter-spacing: .14em; color: var(--blue);
    padding: 0 12px 0 2px; border-right: .5px solid var(--sep); margin-right: 8px; white-space: nowrap; }
  .tb-stat { display: flex; align-items: center; gap: 5px; padding: 0 9px;
    border-right: .5px solid var(--sep); white-space: nowrap; }
  .tb-stat .lbl { font-size: 8px; color: var(--t3); letter-spacing: .08em; text-transform: uppercase; }
  .tb-stat .val { font-size: 11px; font-weight: 700; color: var(--blue); }
  .tb-stat .val.g { color: var(--green); } .tb-stat .val.a { color: var(--amber); }
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
  .app-body { display: flex; flex: 1; overflow: hidden; min-height: 0; }
  .left { width: 192px; flex-shrink: 0; border-right: .5px solid var(--sep);
    display: flex; flex-direction: column; background: #050a0f; overflow-y: auto; }
  .left-inner { padding: 12px 10px; }
  .sl { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; margin-top: 10px; }
  .sl:first-child { margin-top: 0; }
  .sl-n { font-size: 8px; font-weight: 700; color: var(--blue); }
  .sl-l { flex: 1; height: .5px; background: var(--sep); }
  .sl-t { font-size: 8px; color: var(--t3); letter-spacing: .1em; text-transform: uppercase; }

  /* Single upload zone — full width */
  .upload-zone { border-radius: 10px; border: .5px dashed rgba(255,255,255,0.14); background: var(--bg1);
    cursor: pointer; transition: all .15s; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 5px; padding: 16px 8px;
    min-height: 90px; position: relative; overflow: hidden; margin-bottom: 8px; }
  .upload-zone:hover { border-color: var(--blue-border); background: var(--blue-dim); }
  .upload-zone.loaded { border-color: rgba(48,209,88,0.4); border-style: solid; background: rgba(48,209,88,0.05); }
  .upload-zone.dragover { border-color: var(--blue); background: rgba(10,132,255,0.15); border-style: solid; }
  .uz-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--green); position: absolute; top: 6px; right: 7px; }
  .uz-icon { font-size: 18px; color: var(--t3); transition: color .15s; }
  .upload-zone.loaded .uz-icon { color: var(--green); }
  .uz-label { font-size: 9px; font-weight: 700; letter-spacing: .08em; color: var(--t2); text-transform: uppercase; }
  .uz-sub { font-size: 8px; color: var(--t3); text-align: center; line-height: 1.5; }

  .sim-btn { width: 100%; padding: 7px; border-radius: 8px;
    border: .5px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.03);
    color: var(--t2); font-size: 9px; font-weight: 700; cursor: pointer;
    font-family: inherit; letter-spacing: .06em; margin-bottom: 8px; transition: all .15s; }
  .sim-btn:hover { background: rgba(255,255,255,0.06); color: var(--t1); }

  .res-card { background: var(--bg1); border-radius: 8px; border: .5px solid rgba(255,255,255,0.06);
    padding: 7px 9px; margin-bottom: 8px; }
  .kv { display: flex; justify-content: space-between; font-size: 10px; padding: 2px 0;
    border-bottom: .5px solid rgba(255,255,255,0.04); }
  .kv:last-child { border-bottom: none; }
  .kv .k { color: var(--t3); } .kv .v { color: var(--blue); font-weight: 700; }
  .kv .v.g { color: var(--green); } .kv .v.a { color: var(--amber); }

  .center { flex: 1; display: flex; flex-direction: column; overflow: hidden; min-width: 0; }
  .canvas-tb { height: 36px; background: rgba(0,0,0,0.45); border-bottom: .5px solid var(--sep);
    display: flex; align-items: center; gap: 6px; padding: 0 12px; flex-shrink: 0; }
  .sep-toggle { padding: 3px 9px; border-radius: 5px; font-size: 10px; cursor: pointer;
    font-family: inherit; transition: all .12s; }
  .sep-toggle.on { border: .5px solid var(--blue); background: var(--blue-dim); color: var(--blue); }
  .sep-toggle.off { border: .5px solid rgba(255,255,255,0.1); background: transparent; color: var(--t3); }
  .tb-info { font-size: 9px; color: var(--t3); letter-spacing: .04em; margin-left: auto; }
  .canvas-wrap { flex: 1; position: relative; overflow: hidden; background: var(--bg0); }

  /* Pipeline overlay */
  .pl-overlay { position: absolute; inset: 0; background: rgba(3,6,8,0.97);
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 14px; padding: 20px; z-index: 20; transition: opacity .4s ease; }
  .pl-overlay.hidden { opacity: 0; pointer-events: none; }
  .ring-wrap { position: relative; width: 72px; height: 72px; flex-shrink: 0; }
  .ring-wrap svg { width: 72px; height: 72px; }
  .ring-pulse { position: absolute; inset: -4px; border-radius: 50%;
    border: .5px solid rgba(10,132,255,0.35); animation: rpulse 1.9s ease-out infinite; }
  @keyframes rpulse { 0%{transform:scale(1);opacity:.7} 100%{transform:scale(1.4);opacity:0} }
  .stages-row { display: flex; align-items: center; flex-wrap: wrap;
    justify-content: center; max-width: 480px; gap: 0; }
  .s-item { display: flex; align-items: center; }
  .s-node { display: flex; flex-direction: column; align-items: center; gap: 3px;
    padding: 3px 4px; border-radius: 5px; transition: all .25s; min-width: 40px; }
  .s-node.done { background: rgba(10,132,255,0.1); border: .5px solid rgba(10,132,255,0.3); }
  .s-node.active { background: rgba(10,132,255,0.16); border: .5px solid rgba(10,132,255,0.7); }
  .s-node.pending { background: transparent; border: .5px solid transparent; }
  .s-circ { width: 20px; height: 20px; border-radius: 50%; display: flex; align-items: center;
    justify-content: center; font-size: 9px; transition: all .25s; }
  .s-circ.done { background: var(--blue); color: #fff; }
  .s-circ.active { background: rgba(10,132,255,0.2); border: 1.5px solid var(--blue); color: var(--blue); box-shadow: 0 0 8px rgba(10,132,255,0.4); }
  .s-circ.pending { background: rgba(255,255,255,0.04); border: .5px solid rgba(255,255,255,0.1); color: var(--t3); }
  .s-name { font-size: 7px; color: var(--t3); text-align: center; max-width: 40px; transition: color .25s; }
  .s-name.done { color: rgba(10,132,255,0.8); } .s-name.active { color: rgba(255,255,255,0.85); }
  .s-conn { width: 7px; height: .5px; background: rgba(255,255,255,0.1); margin-bottom: 13px; transition: background .4s; }
  .s-conn.lit { background: rgba(10,132,255,0.7); }
  .status-box { background: rgba(10,132,255,0.07); border: .5px solid rgba(10,132,255,0.22);
    border-radius: 8px; padding: 6px 16px; max-width: 420px; text-align: center; }
  .status-l1 { font-size: 10px; color: rgba(10,132,255,0.9); letter-spacing: .03em; line-height: 1.5; }
  .status-l2 { font-size: 9px; color: rgba(255,255,255,0.22); margin-top: 3px; }
  .scan-track { width: 260px; height: 2px; border-radius: 9999px; background: rgba(255,255,255,0.04); overflow: hidden; }
  .scan-bar { height: 100%; width: 38%; border-radius: 9999px;
    background: linear-gradient(90deg,transparent,rgba(10,132,255,0.85),transparent);
    animation: scanbar 2.1s ease-in-out infinite; }
  @keyframes scanbar { 0%{transform:translateX(-120%)} 100%{transform:translateX(370%)} }
  .dont-reload { font-size: 9px; color: var(--t3); letter-spacing: .06em;
    animation: blink 2.8s ease-in-out infinite; }
  @keyframes blink { 0%,100%{opacity:.35} 50%{opacity:.85} }

  /* Empty state */
  .empty-state { position: absolute; inset: 0; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 12px; }
  .empty-icon { width: 52px; height: 52px; border-radius: 14px; background: rgba(255,255,255,0.04);
    border: .5px solid rgba(255,255,255,0.08); display: flex; align-items: center; justify-content: center;
    font-size: 22px; color: rgba(255,255,255,0.15); }
  .empty-title { font-size: 13px; font-weight: 500; color: rgba(255,255,255,0.45); }
  .empty-sub { font-size: 10px; color: var(--t3); text-align: center; line-height: 1.9; }
  .pipe-tags { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; justify-content: center; max-width: 340px; }
  .ptag { font-size: 8px; padding: 2px 7px; border-radius: 4px;
    border: .5px solid rgba(255,255,255,0.08); color: var(--t3); background: rgba(255,255,255,0.03); }
  .parrow { font-size: 8px; color: rgba(255,255,255,0.1); }

  /* Car outline draw animation */
  .car-path { stroke-dasharray: 3000; stroke-dashoffset: 3000; }
  .car-path.draw { animation: draw-path 2.4s cubic-bezier(0.4,0,0.2,1) forwards; }
  @keyframes draw-path { to { stroke-dashoffset: 0; } }

  .err-box { border-radius: 8px; padding: 7px 10px; background: rgba(255,69,58,0.08);
    border: .5px solid rgba(255,69,58,0.3); color: var(--red); font-size: 10px;
    margin-bottom: 8px; line-height: 1.5; }
  @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
`

// ── Sketching / Benchmarking Animation ───────────────────────────────────────
// A pencil traces the car outline while dimension callout lines pop in.
// No wheels. Clean engineering drawing aesthetic.
function SketchAnimation() {
  // Car silhouette path — SUV/MPV side profile, no wheel openings
  // Drawn as a single closed outline representing a clean body silhouette
  const W = 480, H = 210

  // Body outline — smooth SUV profile facing right, no wheel circles
  const bodyD = `
    M 58,162
    L 60,148 Q 64,118 76,100 Q 86,84 106,74
    Q 130,63 162,58 Q 196,54 228,54
    Q 262,54 290,57 L 316,61
    Q 338,65 356,76 Q 372,86 380,100
    L 388,116 Q 392,130 393,144 L 394,162
    Q 380,164 362,164
    Q 348,164 334,164
    L 206,164
    Q 190,164 174,164
    L 154,164
    Q 138,164 122,164
    L 80,164
    Q 64,164 58,162 Z
  `

  // Dimension lines — appear one by one after sketch completes
  // Overall length
  const dims = [
    { x1: 58, y1: 178, x2: 394, y2: 178, label: 'L', lx: 226, ly: 188, delay: 2.6 },
    // Height
    { x1: 420, y1: 54,  x2: 420, y2: 164, label: 'H', lx: 432, ly: 112, delay: 3.0, vertical: true },
    // Hood
    { x1: 58, y1: 188, x2: 162, y2: 188, label: 'hood', lx: 110, ly: 197, delay: 3.4 },
    // Cabin
    { x1: 162, y1: 188, x2: 316, y2: 188, label: 'cabin', lx: 239, ly: 197, delay: 3.7 },
  ]

  // Cross-section tick marks for dimension lines
  const tick = (x1, y1, x2, y2, vertical) => vertical
    ? `M ${x1-5},${y1} L ${x1+5},${y1} M ${x1-5},${y2} L ${x1+5},${y2}`
    : `M ${x1},${y1-4} L ${x1},${y1+4} M ${x2},${y1-4} L ${x2},${y1+4}`

  return (
    <div style={{
      position: 'relative', width: W, height: H,
      borderRadius: 12, overflow: 'hidden',
      background: 'rgba(10,132,255,0.025)',
      border: '.5px solid rgba(10,132,255,0.10)',
    }}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H}>
        <defs>
          {/* Pencil-trace gradient — slightly uneven like a real pen stroke */}
          <filter id="sketch-rough">
            <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="3" result="noise"/>
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="0.8" xChannelSelector="R" yChannelSelector="G"/>
          </filter>
        </defs>

        {/* Grid paper effect — faint squares */}
        {Array.from({length: 22}, (_, i) => (
          <line key={`gx${i}`} x1={i*22} y1={0} x2={i*22} y2={H}
            stroke="rgba(10,132,255,0.05)" strokeWidth=".5"/>
        ))}
        {Array.from({length: 10}, (_, i) => (
          <line key={`gy${i}`} x1={0} y1={i*22} x2={W} y2={i*22}
            stroke="rgba(10,132,255,0.05)" strokeWidth=".5"/>
        ))}

        {/* Ground line */}
        <line x1={40} y1={164} x2={W-20} y2={164}
          stroke="rgba(255,255,255,0.08)" strokeWidth=".8" strokeDasharray="4 3"/>

        {/* Car body outline — pencil sketch style, animated draw */}
        <path d={bodyD}
          fill="rgba(10,132,255,0.04)"
          stroke="rgba(10,132,255,0.75)"
          strokeWidth="1.6"
          strokeLinejoin="round"
          strokeLinecap="round"
          filter="url(#sketch-rough)"
          style={{
            strokeDasharray: 1400,
            strokeDashoffset: 1400,
            animation: 'sketchDraw 2.2s cubic-bezier(0.4,0,0.2,1) 0.3s forwards',
          }}/>

        {/* Roofline construction line — appears during sketch */}
        <line x1={76} y1={58} x2={394} y2={58}
          stroke="rgba(10,132,255,0.18)" strokeWidth=".7" strokeDasharray="5 4"
          style={{ opacity: 0, animation: 'fadeIn 0.4s ease 1.8s forwards' }}/>

        {/* Windscreen rake line */}
        <line x1={106} y1={74} x2={162} y2={58}
          stroke="rgba(10,132,255,0.22)" strokeWidth=".8"
          style={{ opacity: 0, animation: 'fadeIn 0.3s ease 2.0s forwards' }}/>

        {/* Dimension callout lines */}
        {dims.map((d, i) => (
          <g key={i} style={{ opacity: 0, animation: `fadeIn 0.5s ease ${d.delay}s forwards` }}>
            <path d={tick(d.x1, d.y1, d.x2, d.y2, d.vertical)}
              stroke="rgba(255,255,255,0.25)" strokeWidth=".8" fill="none"/>
            {d.vertical
              ? <line x1={d.x1} y1={d.y1} x2={d.x2} y2={d.y2} stroke="rgba(255,255,255,0.2)" strokeWidth=".7"/>
              : <line x1={d.x1} y1={d.y1} x2={d.x2} y2={d.y2} stroke="rgba(255,255,255,0.2)" strokeWidth=".7"/>
            }
            <text x={d.lx} y={d.ly} textAnchor="middle"
              fill="rgba(10,132,255,0.6)" fontSize="8" fontFamily="'IBM Plex Mono',monospace"
              letterSpacing=".06em">{d.label}</text>
          </g>
        ))}

        {/* Contour sample dots — appear along the outline after draw completes */}
        {[
          [76,100], [106,74], [162,58], [228,54], [316,61],
          [380,100], [393,144], [394,162], [206,164], [58,162],
        ].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={2.2} fill="rgba(10,132,255,0.8)"
            style={{ opacity: 0, animation: `fadeIn 0.2s ease ${2.3 + i * 0.08}s forwards` }}/>
        ))}

        {/* Measurement readout badge */}
        <g style={{ opacity: 0, animation: 'fadeIn 0.5s ease 4.2s forwards' }}>
          <rect x={8} y={8} width={100} height={40} rx={5}
            fill="rgba(10,132,255,0.08)" stroke="rgba(10,132,255,0.2)" strokeWidth=".7"/>
          <text x={16} y={23} fill="rgba(10,132,255,0.5)" fontSize="7" fontFamily="'IBM Plex Mono',monospace">BENCHMARKING</text>
          <text x={16} y={37} fill="rgba(255,255,255,0.55)" fontSize="9" fontWeight="700" fontFamily="'IBM Plex Mono',monospace">2000 pts</text>
        </g>

        <style>{`
          @keyframes sketchDraw { to { stroke-dashoffset: 0; } }
          @keyframes fadeIn { to { opacity: 1; } }
        `}</style>
      </svg>
    </div>
  )
}

// ── Pipeline Overlay ──────────────────────────────────────────────────────────
function PipelineOverlay({ pct, msg, sub, visible }) {
  const circ = 2 * Math.PI * 32
  const offset = circ * (1 - pct / 100)
  return (
    <div className={'pl-overlay' + (visible ? '' : ' hidden')}>

      {/* Sketch animation */}
      <SketchAnimation/>

      {/* Progress ring */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div className="ring-wrap">
          <div className="ring-pulse"/>
          <svg viewBox="0 0 72 72">
            <circle cx="36" cy="36" r="32" fill="none" stroke="rgba(10,132,255,0.08)" strokeWidth="4.5"/>
            <circle cx="36" cy="36" r="32" fill="none" stroke="rgba(10,132,255,0.9)" strokeWidth="4.5"
              strokeLinecap="round"
              strokeDasharray={circ.toFixed(2)} strokeDashoffset={offset.toFixed(2)}
              transform="rotate(-90 36 36)"
              style={{ transition: 'stroke-dashoffset 0.5s ease' }}/>
            <text x="36" y="33" textAnchor="middle" fill="white" fontSize="14" fontWeight="700"
              fontFamily="'IBM Plex Mono',monospace">{Math.round(pct)}</text>
            <text x="36" y="44" textAnchor="middle" fill="rgba(10,132,255,0.7)" fontSize="7"
              fontFamily="'IBM Plex Mono',monospace">%</text>
          </svg>
        </div>

        {/* Stages inline */}
        <div className="stages-row">
          {STAGES.map((s, i) => {
            const done = pct >= s.pct[1]; const active = pct >= s.pct[0] && pct < s.pct[1]
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

// ── Upload Zone ───────────────────────────────────────────────────────────────
function UploadZone({ file, onFile }) {
  const [dragover, setDragover] = useState(false)
  const inputRef = useRef(null)
  const handleDrop = (e) => {
    e.preventDefault(); setDragover(false)
    const f = e.dataTransfer.files?.[0]
    if (f && f.type.startsWith('image/')) onFile(f)
  }
  const handleChange = (e) => { const f = e.target.files?.[0]; if (f) onFile(f) }
  const cls = ['upload-zone', file ? 'loaded' : '', dragover ? 'dragover' : ''].filter(Boolean).join(' ')
  return (
    <div className={cls}
      onClick={() => inputRef.current?.click()}
      onDragOver={e => { e.preventDefault(); setDragover(true) }}
      onDragLeave={() => setDragover(false)}
      onDrop={handleDrop}>
      <input ref={inputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleChange}/>
      {file && <div className="uz-dot"/>}
      <div className="uz-icon">◻</div>
      <div className="uz-label">Side View</div>
      <div className="uz-sub">
        {file ? file.name.slice(0, 18) + (file.name.length > 18 ? '…' : '') : 'Drop or click · paste URL'}
      </div>
    </div>
  )
}

// ── Side View SVG ─────────────────────────────────────────────────────────────
function SideViewSVG({ g, showSep, isDrawing, drawDone }) {
  const CW = 600, CH = 290, CPAD = 22
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

  const gY = Math.min(draw_oy + draw_h + 4, CH - 10)
  const keypoints = g._keypoints
  const rawWheels = keypoints?.wheels ?? []

  // Arch voids — dark circles inside the outline where the wheel openings are.
  // No drawn wheels, just the arch cut-out.
  const unifiedR = rawWheels.length > 0
    ? Math.max(draw_h * 0.16, Math.min(draw_h * 0.26,
        rawWheels.map(w => w.nr * draw_w).reduce((a, b) => a + b, 0) / rawWheels.length))
    : draw_h * 0.21
  const archVoids = rawWheels.map(w => {
    const cx = draw_ox + w.nx * draw_w
    const r   = unifiedR
    const archCap = draw_oy + draw_h * 0.93
    const band = rawPts.filter(p => {
      const sx = draw_ox + p[0] * draw_w
      const sy = draw_oy + p[1] * draw_h
      return Math.abs(sx - cx) < r * 1.8 && sy < archCap && p[1] > 0.45
    })
    const archBottomY = band.length > 0
      ? Math.max(...band.map(p => draw_oy + p[1] * draw_h))
      : gY - r - 1
    return { cx, cy: archBottomY - r, r }
  })

  const drawClass = isDrawing || drawDone ? 'car-path draw' : 'car-path'

  return (
    <svg viewBox={`0 0 ${CW} ${CH}`} style={{ width: '100%', height: '100%' }} preserveAspectRatio="xMidYMid meet">
      <defs>
        <clipPath id="car-clip-main">
          <path d={pathD}/>
        </clipPath>
      </defs>
      <rect width={CW} height={CH} fill="#070d14"/>

      {/* Ground contact line */}
      <line x1={draw_ox + draw_w * 0.03} y1={gY} x2={draw_ox + draw_w * 0.97} y2={gY}
        stroke="rgba(255,255,255,0.05)" strokeWidth="1"/>

      {/* Arch voids — dark fill clipped to car outline */}
      {(drawDone || isDrawing) && archVoids.map((v, i) => (
        <circle key={i} cx={v.cx.toFixed(1)} cy={v.cy.toFixed(1)} r={(v.r * 1.06).toFixed(1)}
          fill="#070d14" clipPath="url(#car-clip-main)"/>
      ))}

      {/* Car outline */}
      <path d={pathD} fill="none" stroke="rgba(255,255,255,0.90)" strokeWidth="1.4"
        strokeLinejoin="round" strokeLinecap="round"
        className={drawClass}
        style={{ strokeDasharray: 3000, strokeDashoffset: isDrawing || drawDone ? undefined : 3000 }}/>

      {/* Separation line */}
      {showSep && drawDone && keypoints?.bumpers?.rear && (
        <line
          x1={(draw_ox + keypoints.bumpers.rear.x * draw_w).toFixed(1)} y1={draw_oy.toFixed(1)}
          x2={(draw_ox + keypoints.bumpers.rear.x * draw_w).toFixed(1)} y2={gY.toFixed(1)}
          stroke="rgba(255,100,80,0.4)" strokeWidth="1" strokeDasharray="4 2"/>
      )}

      <text x={CW / 2} y={CH - 3} textAnchor="middle" fill="rgba(255,255,255,0.07)"
        fontSize="8" fontFamily="'IBM Plex Mono',monospace" letterSpacing=".12em">
        SIDE · {g._contourPts?.length ?? 0}pts · {g._method ?? ''}
      </text>
    </svg>
  )
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function AeroNetV2() {
  const [sideFile, setSideFile]           = useState(null)
  const [analysisMode, setAnalysisMode]   = useState('A')
  const [showSep, setShowSep]             = useState(true)
  const [stage, setStage]                 = useState('idle')
  const [geo, setGeo]                     = useState(null)
  const [error, setError]                 = useState(null)
  const [traceProgress, setTraceProgress] = useState({ pct: 0, msg: '', sub: '' })
  const [isDrawing, setIsDrawing]         = useState(false)
  const [drawDone, setDrawDone]           = useState(false)
  const svgRef = useRef(null)

  const isRunning = stage === 'analyzing'

  const setFile = useCallback((f) => {
    setSideFile(f); setGeo(null); setError(null); setDrawDone(false); setIsDrawing(false)
  }, [])

  // Paste handler
  useEffect(() => {
    const handle = (e) => {
      const items = Array.from(e.clipboardData?.items ?? [])
      const img = items.find(i => i.type.startsWith('image/'))
      if (img) { setFile(img.getAsFile()); return }
      const text = e.clipboardData?.getData('text') ?? ''
      if (/^https?:\/\//i.test(text)) {
        fetchImageFromUrl(text).then(f => setFile(f)).catch(err => setError(err.message))
      }
    }
    window.addEventListener('paste', handle)
    return () => window.removeEventListener('paste', handle)
  }, [setFile])

  const getMsgForPct = (pct) => {
    const entry = [...BACKEND_MSGS].reverse().find(m => pct >= m[0])
    return entry ? { msg: entry[1], sub: entry[2] } : { msg: 'Processing…', sub: '' }
  }

  const run = async (fileOverride) => {
    const file = fileOverride || sideFile
    if (!file || file.size === 0) {
      setError('Please upload a real side photo of a car before analysing.')
      return
    }
    setError(null); setGeo(null); setDrawDone(false); setIsDrawing(false)
    setStage('analyzing')
    setTraceProgress({ pct: 2, msg: 'Preparing image…', sub: 'Input normalisation' })

    let uploadFile
    try { uploadFile = await prepareImage(file) } catch { uploadFile = file }

    let jobId = null
    const MAX_ATTEMPTS = 8
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      setTraceProgress({ pct: 5,
        msg: attempt === 0 ? 'Connecting to server…' : `Retrying… (${attempt * 5}s elapsed)`,
        sub: 'Input normalisation' })
      try {
        const fd = new FormData()
        fd.append('file', uploadFile); fd.append('mode', analysisMode)
        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), 25000)
        let res
        try { res = await fetch(`${API_BASE}/analyze-contour/start`, { method: 'POST', body: fd, signal: ctrl.signal }) }
        finally { clearTimeout(timer) }
        if (res.ok) { jobId = (await res.json()).job_id; break }
        const text = await res.text().catch(() => '')
        setError(`Server error ${res.status}${text ? ': ' + text.slice(0, 120) : ''}`)
        setStage('idle'); return
      } catch {
        if (attempt >= MAX_ATTEMPTS - 1) {
          setError('Could not reach server. Check connection and try again.')
          setStage('idle'); return
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
        setTraceProgress({ pct: Math.round(pct), msg: `${msg} · ${elapsed}s`, sub })
        continue
      }
      if (poll.status === 'done') {
        const result = poll.result
        if (!result?.geometry) {
          setError('No vehicle outline found. Use a clear side-on photo.')
          setStage('idle'); return
        }
        setTraceProgress({ pct: 98, msg: 'Complete ✓ — rendering outline…', sub: 'Drawing silhouette' })
        const cg = result.geometry
        setGeo({
          aspectRatio: cg.aspectRatio ?? 2.0, hoodRatio: cg.hoodRatio ?? 0.28,
          cabinRatio: cg.cabinRatio ?? 0.44, bootRatio: cg.bootRatio ?? 0.28,
          wsAngleDeg: cg.wsAngleDeg ?? 58, rearDrop: cg.rearDrop ?? 0.15,
          rideH: cg.rideH ?? 0.08, archDepth: cg.archDepth ?? null,
          Cd: cg.Cd ?? 0, CdA: cg.CdA ?? 0,
          rearSlantAngleDeg: cg.rearSlantAngleDeg ?? 20,
          ahmedRegime: cg.ahmedRegime ?? 'intermediate',
          wheelbaseNorm: cg.wheelbaseNorm ?? 0,
          _contourPts: result.technical_outline_pts ?? result.outline_pts,
          _smoothPts:  result.display_outline_pts  ?? result.smooth_pts,
          _bboxAspect: result.bbox ? result.bbox.w / Math.max(1, result.bbox.h) : undefined,
          _keypoints: result.keypoints, _method: result.method,
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
    a.download = 'aeronet_side.svg'; a.click()
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
            <div className="tb-stat"><span className="lbl">Ahmed</span>
              <span className="val" style={{ color: ahmedColor(geo.ahmedRegime) }}>
                {geo.ahmedRegime?.toUpperCase()} {geo.rearSlantAngleDeg?.toFixed(0)}°
              </span></div>
            <div className="tb-stat"><span className="lbl">Aspect</span><span className="val">{geo.aspectRatio?.toFixed(2) ?? '—'}</span></div>
            <div className="tb-stat"><span className="lbl">WS rake</span><span className="val">{geo.wsAngleDeg?.toFixed(0) ?? '—'}°</span></div>
          </>) : (
            <div className="tb-stat"><span className="lbl" style={{ color: 'rgba(255,255,255,0.15)' }}>Upload a side photo and analyse to see results</span></div>
          )}
          <div className="tb-spacer"/>
          <div className="tb-modes">
            {[{ id: 'A', label: '◎ Silhouette', desc: '~30s' },
              { id: 'B', label: '⊞ Panels', desc: '~90s' },
              { id: 'C', label: '⬡ Full Aero', desc: '~150s' }
            ].map(m => (
              <button key={m.id} className={'tb-mode-btn' + (analysisMode === m.id ? ' sel' : '')}
                onClick={() => setAnalysisMode(m.id)} title={m.desc}>{m.label}</button>
            ))}
          </div>
          <button className="tb-btn tb-run" onClick={() => run()} disabled={!sideFile || isRunning}>
            {isRunning
              ? <><span style={{ display:'inline-block',width:12,height:12,border:'2px solid rgba(255,255,255,0.3)',borderTopColor:'#fff',borderRadius:'50%',animation:'spin 0.8s linear infinite' }}/> Analysing…</>
              : <>▶ Analyse</>}
          </button>
          <button className="tb-btn tb-exp" onClick={exportSVG} disabled={!geo}>↓ SVG</button>
        </div>

        <div className="app-body">

          {/* ── Left panel ── */}
          <div className="left">
            <div className="left-inner">

              <div className="sl"><span className="sl-n">01</span><div className="sl-l"/><span className="sl-t">Upload</span></div>
              <UploadZone file={sideFile} onFile={setFile}/>

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
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:5 }}>
                    <span style={{ fontSize:12, fontWeight:700, color: geo._quality?.score >= 75 ? 'var(--green)' : 'var(--amber)' }}>
                      {geo._quality?.score ?? 0}/100
                    </span>
                    <span style={{ fontSize:8, color:'var(--t3)', textTransform:'uppercase', letterSpacing:'.06em' }}>{geo._quality?.status}</span>
                  </div>
                  <div style={{ height:3, borderRadius:2, background:'rgba(255,255,255,0.06)' }}>
                    <div style={{ height:'100%', borderRadius:2, width:`${geo._quality?.score ?? 0}%`,
                      background: geo._quality?.score >= 75 ? 'var(--green)' : 'var(--amber)', transition:'width .6s' }}/>
                  </div>
                  {geo._quality?.warnings?.slice(0, 2).map((w, i) => (
                    <div key={i} style={{ fontSize:9, color:'var(--amber)', marginTop:4, lineHeight:1.4 }}>⚠ {w}</div>
                  ))}
                </div>

                {geo.ahmedRegime && (
                  <>
                    <div className="sl"><span className="sl-n">04</span><div className="sl-l"/><span className="sl-t">Ahmed</span></div>
                    <div className="res-card" style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                      <span style={{ fontSize:10, color:'var(--t3)' }}>Regime</span>
                      <span style={{ fontSize:10, fontWeight:700, color: ahmedColor(geo.ahmedRegime),
                        background:`${ahmedColor(geo.ahmedRegime)}18`, padding:'2px 8px', borderRadius:4 }}>
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
              <span style={{ fontSize:10, color:'var(--t2)', fontWeight:700, letterSpacing:'.06em' }}>SIDE VIEW</span>
              <div style={{ width:'.5px', height:14, background:'rgba(255,255,255,0.08)', margin:'0 6px' }}/>
              <button className={'sep-toggle ' + (showSep ? 'on' : 'off')} onClick={() => setShowSep(p => !p)}>Sep line</button>
              {geo && <span className="tb-info">{geo._contourPts?.length ?? 0}pts · {geo._method ?? ''}</span>}
            </div>

            <div className="canvas-wrap" ref={svgRef}>
              <PipelineOverlay visible={isRunning} pct={traceProgress.pct} msg={traceProgress.msg} sub={traceProgress.sub}/>

              {!geo && !isRunning && (
                <div className="empty-state">
                  <div className="empty-icon">◻</div>
                  <div className="empty-title">Vehicle outline analysis</div>
                  <div className="empty-sub">
                    Drop or paste a side-on car photo<br/>
                    then click Analyse
                  </div>
                  <div className="pipe-tags">
                    {['RMBG 2.0','→','YOLO11x','→','SAM3','→','2000pt contour','→','Ahmed CFD'].map((t, i) => (
                      t === '→' ? <span key={i} className="parrow">→</span> : <span key={i} className="ptag">{t}</span>
                    ))}
                  </div>
                </div>
              )}

              {geo && !isRunning && (
                <div style={{ width:'100%', height:'100%' }}>
                  <SideViewSVG g={geo} showSep={showSep} isDrawing={isDrawing} drawDone={drawDone}/>
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
    </>
  )
}
