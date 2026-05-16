// SideViewSVG.jsx — AeroNet Vehicle Side-View Outline Renderer
// Copyright (c) 2026 Rutej Talati. All rights reserved.
//
// Fixes in this version:
//   - useDrawAnimation hook moved AFTER early-return guard to prevent
//     React hook order violation crash when g=null (showed "no outline" on load)
//   - Arch layer, fine feature dots, Catmull-Rom smooth outline all integrated

import { useEffect, useRef, useState } from 'react'

// ─────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────

const W   = 900
const H   = 420
const PAD = 32

const FEAT_COLOR = {
  antenna: 'rgba(255,159,10,0.92)',
  mirror:  'rgba(48,209,88,0.92)',
  spoiler: 'rgba(10,132,255,0.92)',
  wiper:   'rgba(191,90,242,0.92)',
  detail:  'rgba(255,255,255,0.40)',
}

// ─────────────────────────────────────────────────────────────────
// PATH HELPERS
// ─────────────────────────────────────────────────────────────────

function normPtsToPath(pts, bboxAspect, cW = W, cH = H, pad = PAD) {
  if (!pts || pts.length < 4) return ''
  const aspect = bboxAspect ?? 2.4
  const dw = (cW - pad * 2) * 0.95
  const dh = Math.min(dw / aspect, cH - pad * 2)
  const ox  = pad + ((cW - pad * 2) - dw) / 2
  const oy  = pad + ((cH - pad * 2) - dh) / 2
  return pts
    .map(([nx, ny], i) =>
      `${i === 0 ? 'M' : 'L'}${(ox + nx * dw).toFixed(2)},${(oy + ny * dh).toFixed(2)}`
    )
    .join(' ') + ' Z'
}

function buildSepLines(g, bboxAspect, cW = W, cH = H, pad = PAD) {
  if (!g) return []
  const aspect = bboxAspect ?? g._bboxAspect ?? 2.4
  const dw = (cW - pad * 2) * 0.95
  const dh = Math.min(dw / aspect, cH - pad * 2)
  const ox  = pad + ((cW - pad * 2) - dw) / 2
  const oy  = pad + ((cH - pad * 2) - dh) / 2
  const cx  = ox + dw / 2
  const rideY = oy + dh * (1 - (g.rideH ?? 0.08))
  const lines = []
  const heights = [0.25, 0.45, 0.65]
  heights.forEach(frac => {
    const y = oy + dh * frac
    lines.push(`M ${ox - 28} ${y} Q ${cx * 0.6} ${y - 12} ${cx} ${y} Q ${cx * 1.4 + ox * 0.4} ${y - 12} ${ox + dw + 28} ${y}`)
  })
  lines.push(`M ${ox - 20} ${rideY} L ${ox + dw + 20} ${rideY}`)
  return lines
}

// ─────────────────────────────────────────────────────────────────
// DRAW ANIMATION HOOK
// ─────────────────────────────────────────────────────────────────

// NOTE: This hook must only be called when g is valid and a real
// <path> ref exists.  It is called inside SideViewSVGInner, not
// in the top-level wrapper, so the hook order is always stable.

function useDrawAnimation(pathRef, durationMs, active) {
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!active || !pathRef.current) return
    setDone(false)
    const el    = pathRef.current
    let total
    try { total = el.getTotalLength() } catch { return }
    if (!total) return
    el.style.strokeDasharray  = `${total}`
    el.style.strokeDashoffset = `${total}`
    el.style.transition       = 'none'
    let start = null
    const step = (ts) => {
      if (!start) start = ts
      const progress = Math.min((ts - start) / durationMs, 1)
      const ease = 1 - Math.pow(1 - progress, 3)
      el.style.strokeDashoffset = `${total * (1 - ease)}`
      if (progress < 1) {
        requestAnimationFrame(step)
      } else {
        el.style.strokeDashoffset = '0'
        el.style.strokeDasharray  = 'none'
        setDone(true)
      }
    }
    requestAnimationFrame(step)
  }, [active])  // eslint-disable-line react-hooks/exhaustive-deps

  return done
}

// ─────────────────────────────────────────────────────────────────
// INNER COMPONENT — only rendered when g is valid
// Hooks are always called in the same order here (no early return)
// ─────────────────────────────────────────────────────────────────

function SideViewSVGInner({ g, showSep, showArches, isDrawing, drawDone }) {
  const mainPathRef = useRef(null)
  const animDone    = useDrawAnimation(mainPathRef, 2400, isDrawing)

  const mainPts    = g._smoothPts ?? g._contourPts ?? []
  const bboxAspect = g._bboxAspect ?? (g.aspectRatio ?? 2.4)
  const imageW     = g._imageW ?? 1536
  const imageH     = g._imageH ?? 768

  const mainPath = normPtsToPath(mainPts, bboxAspect)
  const archPath = normPtsToPath(g.arch_pts, g.arch_bbox_aspect ?? bboxAspect)
  const sepLines = showSep ? buildSepLines(g, bboxAspect) : []

  const Cd     = g.Cd != null ? g.Cd.toFixed(3) : '—'
  const regime = g.ahmedRegime ?? '—'
  const slant  = g.rearSlantAngleDeg != null ? `${g.rearSlantAngleDeg.toFixed(0)}°` : '—'
  const wsRake = g.wsAngleDeg        != null ? `${g.wsAngleDeg.toFixed(0)}°`        : '—'

  const regimeColor = {
    attached:     '#30d158',
    intermediate: '#ff9f0a',
    critical:     '#ff453a',
    separated:    '#ff453a',
  }[regime] ?? 'rgba(10,132,255,0.8)'

  // SVG layout geometry
  const aspect = bboxAspect
  const dw = (W - PAD * 2) * 0.95
  const dh = Math.min(dw / aspect, H - PAD * 2)
  const ox  = PAD + ((W - PAD * 2) - dw) / 2
  const oy  = PAD + ((H - PAD * 2) - dh) / 2

  // Scale pixel → SVG canvas coords
  const sx = (px) => (px / imageW) * W
  const sy = (py) => (py / imageH) * H

  const revealed = drawDone || animDone

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: '100%', height: '100%' }}
      preserveAspectRatio="xMidYMid meet"
    >
      {/* Background */}
      <rect width={W} height={H} fill="#070d14"/>

      {/* Ground line */}
      <line
        x1={ox - 20} y1={oy + dh}
        x2={ox + dw + 20} y2={oy + dh}
        stroke="rgba(255,255,255,0.06)" strokeWidth="1"
      />

      {/* Separation streamlines */}
      {sepLines.map((d, i) => (
        <path key={i} d={d} fill="none"
          stroke="rgba(10,132,255,0.10)" strokeWidth="0.8" strokeDasharray="6 4"/>
      ))}

      {/* ── MAIN OUTLINE ── */}
      {mainPath && (
        <path
          ref={mainPathRef}
          d={mainPath}
          fill="none"
          stroke="rgba(10,132,255,0.90)"
          strokeWidth="1.6"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}

      {/* ── ARCH LAYER ── */}
      {showArches && archPath && revealed && (
        <g>
          <path
            d={archPath}
            fill="none"
            stroke="rgba(10,132,255,0.50)"
            strokeWidth="1.3"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {(g.arch_wheels ?? []).map((wheel, i) => {
            const wcx = sx(wheel.cx)
            const wcy = sy(wheel.cy)
            const wr  = (wheel.r / imageH) * H
            return (
              <g key={i}>
                <circle cx={wcx} cy={wcy} r={wr}
                  fill="none" stroke="rgba(10,132,255,0.55)"
                  strokeWidth="1.2" strokeDasharray="5 3"/>
                <circle cx={wcx} cy={wcy} r={wr * 0.60}
                  fill="none" stroke="rgba(10,132,255,0.22)" strokeWidth="0.8"/>
                <line x1={wcx - wr * 0.55} y1={wcy} x2={wcx + wr * 0.55} y2={wcy}
                  stroke="rgba(10,132,255,0.18)" strokeWidth="0.6"/>
                <line x1={wcx} y1={wcy - wr * 0.55} x2={wcx} y2={wcy + wr * 0.55}
                  stroke="rgba(10,132,255,0.18)" strokeWidth="0.6"/>
                <circle cx={wcx} cy={wcy} r={2} fill="rgba(10,132,255,0.65)"/>
                <text x={wcx} y={wcy - wr - 5} textAnchor="middle"
                  fontSize={8} fill="rgba(10,132,255,0.55)"
                  fontFamily="'IBM Plex Mono',monospace" letterSpacing="0.08em">
                  {i === 0 ? 'FRONT' : 'REAR'}
                </text>
              </g>
            )
          })}
        </g>
      )}

      {/* ── FINE FEATURE DOTS ── */}
      {revealed && (g.features ?? []).map((f, i) => {
        const fcx   = sx(f.cx)
        const fcy   = sy(f.cy)
        const color = FEAT_COLOR[f.type] ?? FEAT_COLOR.detail
        const nearRight = fcx > W * 0.75
        const labelX    = nearRight ? fcx - 12 : fcx + 12
        const anchor    = nearRight ? 'end' : 'start'
        return (
          <g key={i}>
            <circle cx={fcx} cy={fcy} r={7}
              fill="none" stroke={color} strokeWidth="0.8" opacity="0.45"/>
            <circle cx={fcx} cy={fcy} r={2.5} fill={color}/>
            <line x1={fcx} y1={fcy} x2={labelX} y2={fcy}
              stroke={color} strokeWidth="0.6" opacity="0.5"/>
            <text
              x={labelX + (nearRight ? -2 : 2)} y={fcy + 3.5}
              textAnchor={anchor} fontSize={7.5} fill={color}
              fontFamily="'IBM Plex Mono',monospace"
              fontWeight="600" letterSpacing="0.07em">
              {f.type.toUpperCase()}
            </text>
          </g>
        )
      })}

      {/* ── GEOMETRY LABELS (bottom-right) ── */}
      {revealed && (
        <g>
          <text x={W - 14} y={H - 52} textAnchor="end"
            fontSize={9} fill="rgba(255,255,255,0.25)"
            fontFamily="'IBM Plex Mono',monospace" letterSpacing="0.08em">Cd</text>
          <text x={W - 14} y={H - 36} textAnchor="end"
            fontSize={16} fontWeight="700"
            fill="rgba(10,132,255,0.85)"
            fontFamily="'IBM Plex Mono',monospace">{Cd}</text>
          <rect x={W - 86} y={H - 32} width={72} height={16} rx={4}
            fill={`${regimeColor}22`} stroke={regimeColor} strokeWidth="0.6"/>
          <text x={W - 50} y={H - 21} textAnchor="middle"
            fontSize={8} fill={regimeColor}
            fontFamily="'IBM Plex Mono',monospace"
            fontWeight="700" letterSpacing="0.06em">
            {regime.toUpperCase()}
          </text>
          <text x={W - 14} y={H - 10} textAnchor="end"
            fontSize={8} fill="rgba(255,255,255,0.20)"
            fontFamily="'IBM Plex Mono',monospace" letterSpacing="0.06em">
            WS {wsRake}  ·  SLANT {slant}
          </text>
        </g>
      )}

      {/* Point count (top-left) */}
      <text x={14} y={16} fontSize={8}
        fill="rgba(255,255,255,0.12)"
        fontFamily="'IBM Plex Mono',monospace" letterSpacing="0.08em">
        {mainPts.length}pt
        {g._method ? ` · ${g._method}` : ''}
        {showArches && g.arch_pts ? ' · ARCHES' : ''}
      </text>

      {/* SIDE label (bottom-left) */}
      <text x={14} y={H - 8} fontSize={9}
        fill="rgba(255,255,255,0.08)"
        fontFamily="'IBM Plex Mono',monospace" letterSpacing="0.14em">SIDE</text>
    </svg>
  )
}

// ─────────────────────────────────────────────────────────────────
// PUBLIC COMPONENT — safe null guard before any hooks
// ─────────────────────────────────────────────────────────────────

export default function SideViewSVG({
  g,
  showSep    = true,
  showArches = false,
  isDrawing  = false,
  drawDone   = false,
}) {
  // When g is null (empty slot, thumbnail not yet analysed) show
  // a minimal dark placeholder — NO hooks called here so hook
  // order is always identical across renders.
  if (!g || (!g._smoothPts && !g._contourPts)) {
    return (
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: '100%' }}>
        <rect width={W} height={H} fill="#070d14"/>
      </svg>
    )
  }

  return (
    <SideViewSVGInner
      g={g}
      showSep={showSep}
      showArches={showArches}
      isDrawing={isDrawing}
      drawDone={drawDone}
    />
  )
}
