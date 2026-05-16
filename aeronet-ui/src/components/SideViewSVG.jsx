// SideViewSVG.jsx — Material 3 Black/White Theme
// Copyright (c) 2026 Rutej Talati. All rights reserved.

import { useEffect, useRef, useState } from 'react'

const W = 900, H = 420, PAD = 32

const FEAT_COLOR = {
  antenna: '#FFB74D',
  mirror:  '#81C784',
  spoiler: '#E0E0E0',
  wiper:   '#CE93D8',
  detail:  'rgba(255,255,255,0.40)',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normPtsToPath(pts, bboxAspect, cW=W, cH=H, pad=PAD) {
  if (!pts || pts.length < 4) return ''
  const aspect = bboxAspect ?? 2.4
  const dw = (cW-pad*2)*0.95
  const dh = Math.min(dw/aspect, cH-pad*2)
  const ox = pad+((cW-pad*2)-dw)/2
  const oy = pad+((cH-pad*2)-dh)/2
  return pts.map(([nx,ny],i)=>`${i===0?'M':'L'}${(ox+nx*dw).toFixed(2)},${(oy+ny*dh).toFixed(2)}`).join(' ')+' Z'
}

function buildSepLines(g, bboxAspect, cW=W, cH=H, pad=PAD) {
  if (!g) return []
  const aspect = bboxAspect ?? 2.4
  const dw = (cW-pad*2)*0.95
  const dh = Math.min(dw/aspect, cH-pad*2)
  const ox = pad+((cW-pad*2)-dw)/2
  const oy = pad+((cH-pad*2)-dh)/2
  const cx = ox+dw/2
  const rideY = oy+dh*(1-(g.rideH??0.08))
  const lines = []
  ;[0.25,0.45,0.65].forEach(frac => {
    const y = oy+dh*frac
    lines.push(`M ${ox-28} ${y} Q ${cx*0.6} ${y-10} ${cx} ${y} Q ${cx*1.4+ox*0.4} ${y-10} ${ox+dw+28} ${y}`)
  })
  lines.push(`M ${ox-20} ${rideY} L ${ox+dw+20} ${rideY}`)
  return lines
}

// ── Draw animation hook ───────────────────────────────────────────────────────

function useDrawAnimation(pathRef, durationMs, active) {
  const [done, setDone] = useState(false)
  useEffect(() => {
    if (!active || !pathRef.current) return
    setDone(false)
    const el = pathRef.current
    let total
    try { total = el.getTotalLength() } catch { return }
    if (!total) return
    el.style.strokeDasharray  = `${total}`
    el.style.strokeDashoffset = `${total}`
    el.style.transition = 'none'
    let start = null
    const step = ts => {
      if (!start) start = ts
      const p = Math.min((ts-start)/durationMs, 1)
      const ease = 1-Math.pow(1-p,3)
      el.style.strokeDashoffset = `${total*(1-ease)}`
      if (p < 1) requestAnimationFrame(step)
      else { el.style.strokeDashoffset='0'; el.style.strokeDasharray='none'; setDone(true) }
    }
    requestAnimationFrame(step)
  }, [active]) // eslint-disable-line
  return done
}

// ── Inner (hooks always run) ──────────────────────────────────────────────────

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
    attached:     '#81C784',
    intermediate: '#FFB74D',
    critical:     '#F2B8B8',
    separated:    '#F2B8B8',
  }[regime] ?? '#E0E0E0'

  // Layout
  const aspect = bboxAspect
  const dw = (W-PAD*2)*0.95
  const dh = Math.min(dw/aspect, H-PAD*2)
  const ox  = PAD+((W-PAD*2)-dw)/2
  const oy  = PAD+((H-PAD*2)-dh)/2

  const sx = px => (px/imageW)*W
  const sy = py => (py/imageH)*H

  const revealed = drawDone || animDone

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width:'100%', height:'100%' }} preserveAspectRatio="xMidYMid meet">

      {/* Background */}
      <rect width={W} height={H} fill="#141414"/>

      {/* Ground line */}
      <line x1={ox-20} y1={oy+dh} x2={ox+dw+20} y2={oy+dh}
        stroke="rgba(255,255,255,0.08)" strokeWidth="1"/>

      {/* Separation streamlines */}
      {sepLines.map((d,i) => (
        <path key={i} d={d} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="0.8" strokeDasharray="8 5"/>
      ))}

      {/* ── MAIN OUTLINE ── M3 primary colour (E0E0E0) */}
      {mainPath && (
        <path
          ref={mainPathRef}
          d={mainPath}
          fill="none"
          stroke="#E0E0E0"
          strokeWidth="1.8"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}

      {/* ── ARCH LAYER ── */}
      {showArches && archPath && revealed && (
        <g>
          <path d={archPath} fill="none"
            stroke="rgba(224,224,224,0.45)" strokeWidth="1.2"
            strokeLinejoin="round" strokeLinecap="round" strokeDasharray="6 3"/>
          {(g.arch_wheels ?? []).map((wheel,i) => {
            const wcx=sx(wheel.cx), wcy=sy(wheel.cy), wr=(wheel.r/imageH)*H
            return (
              <g key={i}>
                <circle cx={wcx} cy={wcy} r={wr} fill="none" stroke="rgba(224,224,224,0.50)" strokeWidth="1.2" strokeDasharray="5 3"/>
                <circle cx={wcx} cy={wcy} r={wr*0.60} fill="none" stroke="rgba(224,224,224,0.20)" strokeWidth="0.8"/>
                <line x1={wcx-wr*0.55} y1={wcy} x2={wcx+wr*0.55} y2={wcy} stroke="rgba(255,255,255,0.15)" strokeWidth="0.6"/>
                <line x1={wcx} y1={wcy-wr*0.55} x2={wcx} y2={wcy+wr*0.55} stroke="rgba(255,255,255,0.15)" strokeWidth="0.6"/>
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
      {revealed && (g.features??[]).map((f,i) => {
        const fcx=sx(f.cx), fcy=sy(f.cy)
        const color = FEAT_COLOR[f.type] ?? FEAT_COLOR.detail
        const nearRight = fcx > W*0.75
        const labelX = nearRight ? fcx-12 : fcx+12
        const anchor  = nearRight ? 'end' : 'start'
        return (
          <g key={i}>
            <circle cx={fcx} cy={fcy} r={7} fill="none" stroke={color} strokeWidth="0.8" opacity="0.45"/>
            <circle cx={fcx} cy={fcy} r={2.5} fill={color}/>
            <line x1={fcx} y1={fcy} x2={labelX} y2={fcy} stroke={color} strokeWidth="0.6" opacity="0.5"/>
            <text x={labelX+(nearRight?-2:2)} y={fcy+3.5} textAnchor={anchor}
              fontSize={7.5} fill={color} fontFamily="var(--font-mono)"
              fontWeight="600" letterSpacing="0.07em">
              {f.type.toUpperCase()}
            </text>
          </g>
        )
      })}

      {/* ── GEOMETRY LABELS ── M3 style — bottom right */}
      {revealed && (
        <g>
          {/* Cd label */}
          <text x={W-16} y={H-54} textAnchor="end" fontSize={10}
            fill="rgba(255,255,255,0.30)" fontFamily="var(--font-mono)" letterSpacing="0.12em">
            DRAG COEFFICIENT
          </text>
          <text x={W-16} y={H-30} textAnchor="end" fontSize={22} fontWeight={300}
            fill="#E0E0E0" fontFamily="var(--font-mono)">
            {Cd}
          </text>

          {/* Regime pill */}
          <rect x={W-16-90} y={H-24} width={90} height={18} rx={9}
            fill={`${regimeColor}18`} stroke={regimeColor} strokeWidth="0.6"/>
          <text x={W-16-45} y={H-12} textAnchor="middle"
            fontSize={9} fill={regimeColor} fontFamily="var(--font-mono)"
            fontWeight="600" letterSpacing="0.06em">
            {regime.toUpperCase()} {slant}
          </text>

          {/* WS rake */}
          <text x={W-16} y={H-6} textAnchor="end" fontSize={9}
            fill="rgba(255,255,255,0.20)" fontFamily="var(--font-mono)" letterSpacing="0.05em">
            WS {wsRake}
          </text>
        </g>
      )}

      {/* Point count */}
      <text x={16} y={18} fontSize={9} fill="rgba(255,255,255,0.15)"
        fontFamily="var(--font-mono)" letterSpacing="0.08em">
        {mainPts.length}pt{g._method?` · ${g._method}`:''}
        {showArches&&g.arch_pts?' · ARCHES':''}
      </text>

      {/* SIDE label */}
      <text x={16} y={H-8} fontSize={10} fill="rgba(255,255,255,0.07)"
        fontFamily="var(--font-mono)" letterSpacing="0.16em">SIDE</text>
    </svg>
  )
}

// ── Public wrapper — null guard before hooks ──────────────────────────────────

export default function SideViewSVG({ g, showSep=true, showArches=false, isDrawing=false, drawDone=false }) {
  if (!g || (!g._smoothPts && !g._contourPts)) {
    return (
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width:'100%', height:'100%' }}>
        <rect width={W} height={H} fill="#141414"/>
      </svg>
    )
  }
  return (
    <SideViewSVGInner g={g} showSep={showSep} showArches={showArches} isDrawing={isDrawing} drawDone={drawDone}/>
  )
}
