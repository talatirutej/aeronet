// SideViewSVG.jsx — AeroNet Vehicle Side-View Outline Renderer
// Copyright (c) 2026 Rutej Talati. All rights reserved.
//
// Fixes:
//   - Null guard checks _smoothPts OR _contourPts length > 0
//   - No draw animation (removed — was causing blank canvas bug)
//   - Renders immediately when geo has points

import { useRef } from 'react'

const W = 900, H = 420, PAD = 32

const FEAT_COLOR = {
  antenna: '#FFB74D',
  mirror:  '#81C784',
  spoiler: '#E0E0E0',
  wiper:   '#CE93D8',
  detail:  'rgba(255,255,255,0.40)',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normPtsToPath(pts, bboxAspect, cW=W, cH=H, pad=PAD, normW=null, normH=null) {
  if (!pts?.length) return ''
  // When normW/normH are provided (aspect-preserving normalisation):
  //   pts.x ∈ [0, normW],  pts.y ∈ [0, normH]  where normW ≤ 1, normH ≤ 1
  // We map these to fill the canvas with uniform padding on all sides.
  // scaleX maps [0,normW] → draw width,  scaleY maps [0,normH] → draw height.
  // This gives the car its natural proportions relative to the canvas.
  if (normW && normH && normW > 0 && normH > 0) {
    const drawW = cW - pad * 2.5
    const drawH = cH - pad * 2.5
    const trueAspect = normW / normH
    const displayAspect = Math.max(trueAspect, 2.2)  // clamp min visual aspect
    const canvasAspect = drawW / drawH
    // scaleX maps normW → draw width; scaleY maps normH → draw height
    // but we adjust scaleY so the outline renders at displayAspect visually
    let scaleX, scaleY, ox, oy
    if (displayAspect > canvasAspect) {
      scaleX = drawW / normW
      scaleY = scaleX * (trueAspect / displayAspect)
      ox = pad * 1.25
      oy = (cH - normH * scaleY) / 2
    } else {
      const drawHadj = drawH * (trueAspect / displayAspect)
      scaleY = drawHadj / normH
      scaleX = drawW / normW * (displayAspect / trueAspect) * (trueAspect / displayAspect)
      scaleX = scaleY * displayAspect / trueAspect
      oy = pad * 1.25
      ox = (cW - normW * scaleX) / 2
    }
    return pts.map(([nx,ny],i) =>
      `${i===0?'M':'L'}${(ox+nx*scaleX).toFixed(2)},${(oy+ny*scaleY).toFixed(2)}`
    ).join(' ')+' Z'
  }
  // Fallback (no norm metadata): old behaviour
  const aspect = bboxAspect ?? 2.4
  const dw = (cW-pad*2)*0.95
  const dh = Math.min(dw/aspect, cH-pad*2)
  const ox = pad+((cW-pad*2)-dw)/2
  const oy = pad+((cH-pad*2)-dh)/2
  return pts.map(([nx,ny],i) =>
    `${i===0?'M':'L'}${(ox+nx*dw).toFixed(2)},${(oy+ny*dh).toFixed(2)}`
  ).join(' ')+' Z'
}

function buildSepLines(g, bboxAspect, cW=W, cH=H, pad=PAD) {
  if (!g) return []
  const aspect = bboxAspect ?? 2.4
  const dw = (cW-pad*2)*0.95
  const dh = Math.min(dw/aspect, cH-pad*2)
  const ox  = pad+((cW-pad*2)-dw)/2
  const oy  = pad+((cH-pad*2)-dh)/2
  const cx  = ox+dw/2
  const lines = []
  ;[0.25, 0.45, 0.65].forEach(frac => {
    const y = oy+dh*frac
    lines.push(`M ${ox-28} ${y} Q ${cx*0.6} ${y-10} ${cx} ${y} Q ${cx*1.4+ox*0.4} ${y-10} ${ox+dw+28} ${y}`)
  })
  lines.push(`M ${ox-20} ${oy+dh} L ${ox+dw+20} ${oy+dh}`)
  return lines
}

// ── Inner component — only rendered when pts are valid ────────────────────────

function SideViewSVGInner({ g, showSep, showArches, drawDone, smoothingLevel=100 }) {
  // smoothingLevel: 100=fully smooth (_smoothPts), 0=fully technical (_contourPts)
  // In between: linearly interpolate between both point sets per point
  const smoothPts    = g._smoothPts?.length  ? g._smoothPts    : null
  const technicalPts = g._contourPts?.length ? g._contourPts   : null

  const mainPts = (() => {
    if (!smoothPts && !technicalPts) return null
    if (!smoothPts)    return technicalPts
    if (!technicalPts) return smoothPts
    const t     = smoothingLevel / 100
    const n     = technicalPts.length
    const ratio = smoothPts.length / n
    return technicalPts.map((tp, i) => {
      const si = Math.min(Math.floor(i * ratio), smoothPts.length - 1)
      const sp = smoothPts[si]
      return [sp[0]*t + tp[0]*(1-t), sp[1]*t + tp[1]*(1-t)]
    })
  })()

  const bboxAspect = g._bboxAspect ?? g.trueAspect ?? g.aspectRatio ?? 2.4
  const imageW     = g._imageW ?? 1536
  const imageH     = g._imageH ?? 768

  const mainPath = normPtsToPath(mainPts, bboxAspect, W, H, PAD, g.normWidth ?? g.norm_w ?? null, g.normHeight ?? g.norm_h ?? null)
  const archPath = g.arch_pts?.length
    ? normPtsToPath(g.arch_pts, g.arch_bbox_aspect ?? bboxAspect, W, H, PAD, g.normWidth ?? g.norm_w ?? null, g.normHeight ?? g.norm_h ?? null)
    : ''
  const sepLines = showSep ? buildSepLines(g, bboxAspect) : []

  const Cd     = g.Cd     != null ? g.Cd.toFixed(3)                : '—'
  const regime = g.ahmedRegime ?? '—'
  const slant  = g.rearSlantAngleDeg != null ? `${g.rearSlantAngleDeg.toFixed(0)}°` : '—'
  const wsRake = g.wsAngleDeg        != null ? `${g.wsAngleDeg.toFixed(0)}°`        : '—'

  const regimeColor = {
    attached:     '#81C784',
    intermediate: '#FFB74D',
    critical:     '#F2B8B8',
    separated:    '#F2B8B8',
  }[regime] ?? '#E0E0E0'

  // Match normPtsToPath layout: fit true car proportions into canvas
  const normW = g.normWidth  ?? g.norm_w  ?? null
  const normH = g.normHeight ?? g.norm_h  ?? null
  let dw, dh, ox, oy
  if (normW && normH && normW > 0 && normH > 0) {
    const drawW = W - PAD * 2.5
    const drawH = H - PAD * 2.5
    const trueAspect = normW / normH
    // Clamp display aspect to min 2.4 — tight-crop photos give normH~0.5 (aspect~2)
    // which fills the canvas and looks like a van. True proportions preserved in data.
    const displayAspect = Math.max(trueAspect, 2.4)
    const normHDisplay = normW / displayAspect
    const canvasAspect = drawW / drawH
    if (displayAspect > canvasAspect) {
      const scale = drawW / normW
      dw = normW * scale; dh = normHDisplay * scale
      ox = PAD * 1.25;    oy = (H - dh) / 2
    } else {
      const scale = drawH / normHDisplay
      dw = normW * scale; dh = normHDisplay * scale
      oy = PAD * 1.25;    ox = (W - dw) / 2
    }
  } else {
    dw = (W-PAD*2)*0.95
    dh = Math.min(dw/bboxAspect, H-PAD*2)
    ox = PAD+((W-PAD*2)-dw)/2
    oy = PAD+((H-PAD*2)-dh)/2
  }

  const sx = px => (px/imageW)*W
  const sy = py => (py/imageH)*H

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',height:'100%'}}
      preserveAspectRatio="xMidYMid meet">

      <rect width={W} height={H} fill="#141414"/>

      {/* Ground line */}
      <line x1={ox-20} y1={oy+dh} x2={ox+dw+20} y2={oy+dh}
        stroke="rgba(255,255,255,0.08)" strokeWidth="1"/>

      {/* Separation streamlines */}
      {sepLines.map((d,i) => (
        <path key={i} d={d} fill="none"
          stroke="rgba(255,255,255,0.06)" strokeWidth="0.8" strokeDasharray="8 5"/>
      ))}

      {/* ── MAIN OUTLINE ── */}
      {mainPath && (
        <path d={mainPath} fill="none"
          stroke="#E0E0E0" strokeWidth="1.8"
          strokeLinejoin="round" strokeLinecap="round"/>
      )}

      {/* ── ARCH LAYER ── */}
      {showArches && archPath && (
        <g>
          <path d={archPath} fill="none"
            stroke="rgba(224,224,224,0.45)" strokeWidth="1.2"
            strokeLinejoin="round" strokeLinecap="round" strokeDasharray="6 3"/>
          {(g.arch_wheels ?? []).map((wheel,i) => {
            const wcx=sx(wheel.cx), wcy=sy(wheel.cy), wr=(wheel.r/imageH)*H
            return (
              <g key={i}>
                <circle cx={wcx} cy={wcy} r={wr} fill="none"
                  stroke="rgba(224,224,224,0.50)" strokeWidth="1.2" strokeDasharray="5 3"/>
                <circle cx={wcx} cy={wcy} r={wr*0.60} fill="none"
                  stroke="rgba(224,224,224,0.20)" strokeWidth="0.8"/>
                <line x1={wcx-wr*0.55} y1={wcy} x2={wcx+wr*0.55} y2={wcy}
                  stroke="rgba(255,255,255,0.15)" strokeWidth="0.6"/>
                <line x1={wcx} y1={wcy-wr*0.55} x2={wcx} y2={wcy+wr*0.55}
                  stroke="rgba(255,255,255,0.15)" strokeWidth="0.6"/>
                <circle cx={wcx} cy={wcy} r={2} fill="rgba(224,224,224,0.6)"/>
                <text x={wcx} y={wcy-wr-5} textAnchor="middle" fontSize={8}
                  fill="rgba(255,255,255,0.40)" fontFamily="var(--font-mono)" letterSpacing="0.08em">
                  {i===0?'FRONT':'REAR'}
                </text>
              </g>
            )
          })}
        </g>
      )}

      {/* ── FINE FEATURE DOTS ── */}
      {(g.features??[]).map((f,i) => {
        const fcx=sx(f.cx), fcy=sy(f.cy)
        const color = FEAT_COLOR[f.type] ?? FEAT_COLOR.detail
        const nearRight = fcx > W*0.75
        const labelX = nearRight ? fcx-12 : fcx+12
        const anchor  = nearRight ? 'end' : 'start'
        return (
          <g key={i}>
            <circle cx={fcx} cy={fcy} r={7} fill="none"
              stroke={color} strokeWidth="0.8" opacity="0.45"/>
            <circle cx={fcx} cy={fcy} r={2.5} fill={color}/>
            <line x1={fcx} y1={fcy} x2={labelX} y2={fcy}
              stroke={color} strokeWidth="0.6" opacity="0.5"/>
            <text x={labelX+(nearRight?-2:2)} y={fcy+3.5}
              textAnchor={anchor} fontSize={7.5} fill={color}
              fontFamily="var(--font-mono)" fontWeight="600" letterSpacing="0.07em">
              {f.type.toUpperCase()}
            </text>
          </g>
        )
      })}

      {/* ── GEOMETRY LABELS (bottom-right) ── */}
      <g>
        <text x={W-16} y={H-54} textAnchor="end" fontSize={10}
          fill="rgba(255,255,255,0.30)" fontFamily="var(--font-mono)" letterSpacing="0.12em">
          DRAG COEFFICIENT
        </text>
        <text x={W-16} y={H-30} textAnchor="end" fontSize={22} fontWeight={300}
          fill="#E0E0E0" fontFamily="var(--font-mono)">{Cd}</text>
        <rect x={W-106} y={H-24} width={90} height={18} rx={9}
          fill={`${regimeColor}18`} stroke={regimeColor} strokeWidth="0.6"/>
        <text x={W-61} y={H-12} textAnchor="middle" fontSize={9}
          fill={regimeColor} fontFamily="var(--font-mono)" fontWeight="600" letterSpacing="0.06em">
          {regime.toUpperCase()} {slant}
        </text>
        <text x={W-16} y={H-6} textAnchor="end" fontSize={9}
          fill="rgba(255,255,255,0.20)" fontFamily="var(--font-mono)" letterSpacing="0.05em">
          WS {wsRake}
        </text>
      </g>

      {/* Body type + point count (top-left) */}
      <text x={16} y={18} fontSize={9} fill="rgba(255,255,255,0.15)"
        fontFamily="var(--font-mono)" letterSpacing="0.08em">
        {mainPts?.length??0}pt
        {g.bodyType ? ` · ${g.bodyType}` : g._method ? ` · ${g._method}` : ''}
        {showArches&&g.arch_pts?' · ARCHES':''}
        {g.wasFlipped?' · ↔flipped':''}
      </text>

      {/* SIDE label */}
      <text x={16} y={H-8} fontSize={10} fill="rgba(255,255,255,0.07)"
        fontFamily="var(--font-mono)" letterSpacing="0.16em">SIDE</text>
    </svg>
  )
}

// ── Public wrapper — safe null guard ──────────────────────────────────────────

export default function SideViewSVG({
  g,
  showSep        = true,
  showArches     = false,
  isDrawing      = false,
  drawDone       = false,
  smoothingLevel = 100,   // 0=technical, 100=smooth, in between=interpolated
}) {
  // Guard: only render if we actually have points
  const hasPoints = (g?._smoothPts?.length ?? 0) > 0 || (g?._contourPts?.length ?? 0) > 0

  if (!g || !hasPoints) {
    return (
      <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',height:'100%'}}>
        <rect width={W} height={H} fill="#141414"/>
      </svg>
    )
  }

  return (
    <SideViewSVGInner
      g={g}
      showSep={showSep}
      showArches={showArches}
      drawDone={drawDone}
      smoothingLevel={smoothingLevel}
    />
  )
}
