// SideViewSVG.jsx — AeroNet Vehicle Side-View Outline Renderer
// Copyright (c) 2026 Rutej Talati. All rights reserved.
//
// Updated: wheel arch layer, fine feature annotation dots,
//          curvature-adaptive smooth outline rendering,
//          separation streamlines, draw animation.

import { useEffect, useRef, useState } from 'react'

// ─────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────

const W   = 900      // SVG viewBox width
const H   = 420      // SVG viewBox height
const PAD = 32       // margin around outline

// Feature colour palette — matches contour_enhancements classification
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

/**
 * Convert normalised [0..1] points to an SVG path string, fitting
 * the outline inside the canvas with PAD margin, respecting the
 * bbox aspect ratio.
 */
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

/**
 * Scale a pixel coordinate (from original image space) to SVG canvas space.
 * imageW / imageH come from g._imageW / g._imageH written by the backend.
 */
function scaleCoord(px, py, imageW, imageH, cW = W, cH = H) {
  return [
    (px / Math.max(imageW, 1)) * cW,
    (py / Math.max(imageH, 1)) * cH,
  ]
}

/**
 * Build separation streamlines — horizontal flow lines that split
 * at the car's stagnation points (hood tip and rear).  Used when
 * showSep=true.  Returns an array of SVG path strings.
 */
function buildSepLines(g, bboxAspect, cW = W, cH = H, pad = PAD) {
  if (!g) return []
  const aspect = bboxAspect ?? g._bboxAspect ?? 2.4
  const dw = (cW - pad * 2) * 0.95
  const dh = Math.min(dw / aspect, cH - pad * 2)
  const ox  = pad + ((cW - pad * 2) - dw) / 2
  const oy  = pad + ((cH - pad * 2) - dh) / 2

  const cx = ox + dw / 2
  const rideY = oy + dh * (1 - (g.rideH ?? 0.08))
  const lines = []

  // Three horizontal streamlines at different heights
  const heights = [0.25, 0.45, 0.65]
  heights.forEach(frac => {
    const y = oy + dh * frac
    lines.push(`M ${ox - 28} ${y} Q ${cx * 0.6} ${y - 12} ${cx} ${y} Q ${cx * 1.4 + ox * 0.4} ${y - 12} ${ox + dw + 28} ${y}`)
  })
  // Ground line
  lines.push(`M ${ox - 20} ${rideY} L ${ox + dw + 20} ${rideY}`)
  return lines
}

// ─────────────────────────────────────────────────────────────────
// DRAW ANIMATION HOOK
// ─────────────────────────────────────────────────────────────────

/**
 * Animates the stroke-dashoffset of a path from total length → 0
 * over `durationMs` milliseconds using requestAnimationFrame.
 */
function useDrawAnimation(pathRef, durationMs = 2200, active = true) {
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!active || !pathRef.current) return
    setDone(false)
    const el    = pathRef.current
    const total = el.getTotalLength()
    el.style.strokeDasharray  = `${total}`
    el.style.strokeDashoffset = `${total}`
    el.style.transition       = 'none'

    let start = null
    const step = (ts) => {
      if (!start) start = ts
      const progress = Math.min((ts - start) / durationMs, 1)
      // Ease-out cubic
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
  }, [active])

  return done
}

// ─────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────

/**
 * SideViewSVG
 *
 * Props:
 *   g          — geometry object from backend result dict
 *   showSep    — boolean, show separation streamlines
 *   showArches — boolean, show wheel arch overlay layer
 *   isDrawing  — boolean, trigger draw animation
 *   drawDone   — boolean, parent tracks when animation completed
 *
 * g must contain at minimum:
 *   _smoothPts or _contourPts — normalised outline points
 *   _bboxAspect               — float
 *   _imageW, _imageH          — original image pixel dimensions
 *
 * New optional keys from contour_enhancements:
 *   arch_pts, arch_bbox_aspect, arch_wheels — wheel arch data
 *   features                                — fine feature list
 *   sharp_indices                           — corner point indices
 */
export default function SideViewSVG({ g, showSep = true, showArches = false, isDrawing = false, drawDone = false }) {
  const mainPathRef = useRef(null)
  const animDone    = useDrawAnimation(mainPathRef, 2400, isDrawing)

  if (!g) {
    return (
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: '100%' }}>
        <rect width={W} height={H} fill="#070d14"/>
        <text x={W/2} y={H/2} textAnchor="middle" fill="rgba(255,255,255,0.1)"
          fontSize="13" fontFamily="'IBM Plex Mono',monospace">no outline</text>
      </svg>
    )
  }

  // ── Resolve outline points ────────────────────────────────────────
  // Prefer smooth display points, fall back to raw contour
  const mainPts    = g._smoothPts ?? g._contourPts ?? []
  const bboxAspect = g._bboxAspect ?? (g.aspectRatio ?? 2.4)
  const imageW     = g._imageW ?? 1536
  const imageH     = g._imageH ?? 768

  const mainPath   = normPtsToPath(mainPts, bboxAspect)
  const archPath   = normPtsToPath(g.arch_pts, g.arch_bbox_aspect ?? bboxAspect)
  const sepLines   = showSep ? buildSepLines(g, bboxAspect) : []

  // ── Geometry labels ───────────────────────────────────────────────
  const Cd      = g.Cd        != null ? g.Cd.toFixed(3)       : '—'
  const regime  = g.ahmedRegime ?? '—'
  const slant   = g.rearSlantAngleDeg != null ? `${g.rearSlantAngleDeg.toFixed(0)}°` : '—'
  const wsRake  = g.wsAngleDeg        != null ? `${g.wsAngleDeg.toFixed(0)}°`        : '—'

  const regimeColor = {
    attached:     '#30d158',
    intermediate: '#ff9f0a',
    critical:     '#ff453a',
    separated:    '#ff453a',
  }[regime] ?? 'rgba(10,132,255,0.8)'

  // ── SVG coordinate helpers ────────────────────────────────────────
  const aspect = bboxAspect
  const dw = (W - PAD * 2) * 0.95
  const dh = Math.min(dw / aspect, H - PAD * 2)
  const ox  = PAD + ((W - PAD * 2) - dw) / 2
  const oy  = PAD + ((H - PAD * 2) - dh) / 2

  // Scale pixel → SVG canvas (for wheel circles and feature dots)
  const sx = (px) => (px / imageW) * W
  const sy = (py) => (py / imageH) * H

  // ── Render ────────────────────────────────────────────────────────
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

      {/* ── Separation streamlines ── */}
      {sepLines.map((d, i) => (
        <path
          key={i}
          d={d}
          fill="none"
          stroke="rgba(10,132,255,0.10)"
          strokeWidth="0.8"
          strokeDasharray="6 4"
        />
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

      {/* ── ARCH LAYER — shown when showArches=true and data available ── */}
      {showArches && archPath && (drawDone || animDone) && (
        <g style={{ opacity: 1, transition: 'opacity 0.5s' }}>
          {/* Body silhouette with open wheel cutouts */}
          <path
            d={archPath}
            fill="none"
            stroke="rgba(10,132,255,0.50)"
            strokeWidth="1.3"
            strokeLinejoin="round"
            strokeLinecap="round"
            strokeDasharray="none"
          />

          {/* Wheel circle rings */}
          {(g.arch_wheels ?? []).map((wheel, i) => {
            const wcx = sx(wheel.cx)
            const wcy = sy(wheel.cy)
            const wr  = (wheel.r / imageH) * H
            return (
              <g key={i}>
                {/* Outer tyre — dashed ring */}
                <circle
                  cx={wcx} cy={wcy} r={wr}
                  fill="none"
                  stroke="rgba(10,132,255,0.55)"
                  strokeWidth="1.2"
                  strokeDasharray="5 3"
                />
                {/* Rim ring at 60% radius */}
                <circle
                  cx={wcx} cy={wcy} r={wr * 0.60}
                  fill="none"
                  stroke="rgba(10,132,255,0.22)"
                  strokeWidth="0.8"
                />
                {/* Spoke cross-hairs */}
                <line
                  x1={wcx - wr * 0.55} y1={wcy}
                  x2={wcx + wr * 0.55} y2={wcy}
                  stroke="rgba(10,132,255,0.18)" strokeWidth="0.6"
                />
                <line
                  x1={wcx} y1={wcy - wr * 0.55}
                  x2={wcx} y2={wcy + wr * 0.55}
                  stroke="rgba(10,132,255,0.18)" strokeWidth="0.6"
                />
                {/* Centre dot */}
                <circle cx={wcx} cy={wcy} r={2} fill="rgba(10,132,255,0.65)"/>
                {/* Wheel label */}
                <text
                  x={wcx} y={wcy - wr - 5}
                  textAnchor="middle"
                  fontSize={8}
                  fill="rgba(10,132,255,0.55)"
                  fontFamily="'IBM Plex Mono',monospace"
                  letterSpacing="0.08em"
                >
                  {i === 0 ? 'FRONT' : 'REAR'}
                </text>
              </g>
            )
          })}
        </g>
      )}

      {/* ── FINE FEATURE ANNOTATION DOTS ── */}
      {(drawDone || animDone) && (g.features ?? []).map((f, i) => {
        const [fcx, fcy] = [sx(f.cx), sy(f.cy)]
        const color = FEAT_COLOR[f.type] ?? FEAT_COLOR.detail
        // Decide label side: push right unless near right edge
        const labelX = fcx > W * 0.75 ? fcx - 12 : fcx + 12
        const anchor  = fcx > W * 0.75 ? 'end' : 'start'
        return (
          <g key={i} style={{ opacity: 1, transition: 'opacity 0.6s' }}>
            {/* Outer pulse ring */}
            <circle cx={fcx} cy={fcy} r={7}
              fill="none" stroke={color} strokeWidth="0.8" opacity="0.45"/>
            {/* Inner dot */}
            <circle cx={fcx} cy={fcy} r={2.5} fill={color}/>
            {/* Tick line to label */}
            <line
              x1={fcx} y1={fcy}
              x2={labelX} y2={fcy}
              stroke={color} strokeWidth="0.6" opacity="0.5"
            />
            {/* Label */}
            <text
              x={labelX + (fcx > W * 0.75 ? -2 : 2)}
              y={fcy + 3.5}
              textAnchor={anchor}
              fontSize={7.5}
              fill={color}
              fontFamily="'IBM Plex Mono',monospace"
              fontWeight="600"
              letterSpacing="0.07em"
            >
              {f.type.toUpperCase()}
            </text>
          </g>
        )
      })}

      {/* ── GEOMETRY ANNOTATION LABELS (bottom-right corner) ── */}
      {(drawDone || animDone) && (
        <g>
          {/* Cd */}
          <text x={W - 14} y={H - 52} textAnchor="end"
            fontSize={9} fill="rgba(255,255,255,0.25)"
            fontFamily="'IBM Plex Mono',monospace" letterSpacing="0.08em">
            Cd
          </text>
          <text x={W - 14} y={H - 38} textAnchor="end"
            fontSize={16} fontWeight="700"
            fill="rgba(10,132,255,0.85)"
            fontFamily="'IBM Plex Mono',monospace">
            {Cd}
          </text>

          {/* Ahmed regime pill */}
          <rect
            x={W - 14 - 72} y={H - 32}
            width={72} height={16} rx={4}
            fill={`${regimeColor}22`}
            stroke={regimeColor} strokeWidth="0.6"
          />
          <text x={W - 14 - 36} y={H - 21} textAnchor="middle"
            fontSize={8} fill={regimeColor}
            fontFamily="'IBM Plex Mono',monospace" fontWeight="700" letterSpacing="0.06em">
            {regime.toUpperCase()}
          </text>

          {/* WS rake + rear slant */}
          <text x={W - 14} y={H - 10} textAnchor="end"
            fontSize={8} fill="rgba(255,255,255,0.20)"
            fontFamily="'IBM Plex Mono',monospace" letterSpacing="0.06em">
            WS {wsRake}  ·  SLANT {slant}
          </text>
        </g>
      )}

      {/* ── POINT COUNT (top-left) ── */}
      <text x={14} y={16} fontSize={8}
        fill="rgba(255,255,255,0.12)"
        fontFamily="'IBM Plex Mono',monospace" letterSpacing="0.08em">
        {mainPts.length}pt
        {g._method ? ` · ${g._method}` : ''}
        {showArches && g.arch_pts ? ' · ARCHES' : ''}
      </text>

      {/* ── LABEL: SIDE (bottom-left) ── */}
      <text x={14} y={H - 8} fontSize={9}
        fill="rgba(255,255,255,0.08)"
        fontFamily="'IBM Plex Mono',monospace" letterSpacing="0.14em">
        SIDE
      </text>
    </svg>
  )
}
