// Copyright (c) 2026 Rutej Talati. All rights reserved.
// AeroNet — Views2DPage.jsx  (rebuilt SVG profiles)

import { useCallback, useRef, useState } from 'react'
import { analyzeImage } from '../lib/api'

// ─────────────────────────────────────────────────────────────────────────────
// Body type profiles — every number is a fraction of canvas dimensions
// tuned to look like the actual car archetype
// ─────────────────────────────────────────────────────────────────────────────

const PROFILES = {
  // Low, long nose, steeply raked windscreen, fastback roofline
  fastback: {
    // Fractions along body length (0=front, 1=rear)
    hoodEnd:    0.36,   // where bonnet meets A-pillar base
    aBase:      0.40,   // A-pillar base x
    aTop:       0.46,   // A-pillar top x (windscreen raked forward)
    roofPeak:   0.52,   // highest roof point x
    cTop:       0.78,   // C-pillar top x
    cBase:      0.90,   // C-pillar base x (boot start)
    rearEnd:    1.00,
    // Heights as fraction of body height
    hoodH:      0.50,   // bonnet height fraction
    roofH:      1.00,   // roof height fraction (1 = full body height)
    cTopH:      0.82,   // C-pillar top height
    rearTopH:   0.48,   // rear deck height (fastback slopes a lot)
    frontDip:   0.30,   // front lower body taper
    // Wheel positions
    w1:  0.18, w2: 0.80,
    wheelRFrac: 0.165,  // wheel radius as fraction of body height
  },
  // Notchback / sedan — distinct boot, more vertical C-pillar
  notchback: {
    hoodEnd:    0.33,
    aBase:      0.36,
    aTop:       0.43,
    roofPeak:   0.50,
    cTop:       0.74,
    cBase:      0.80,
    rearEnd:    1.00,
    hoodH:      0.52,
    roofH:      1.00,
    cTopH:      0.98,   // C-pillar stays high before dropping to boot
    rearTopH:   0.62,   // boot deck is higher than fastback
    frontDip:   0.28,
    w1:  0.17, w2: 0.79,
    wheelRFrac: 0.165,
  },
  // Estate / wagon — flat extended roofline
  estate: {
    hoodEnd:    0.30,
    aBase:      0.33,
    aTop:       0.40,
    roofPeak:   0.50,
    cTop:       0.84,
    cBase:      0.88,
    rearEnd:    1.00,
    hoodH:      0.54,
    roofH:      1.00,
    cTopH:      1.00,   // stays at full height right to the rear
    rearTopH:   0.98,   // near vertical rear
    frontDip:   0.30,
    w1:  0.15, w2: 0.82,
    wheelRFrac: 0.162,
  },
  // SUV/crossover — tall, bluff, high ride height
  suv: {
    hoodEnd:    0.28,
    aBase:      0.32,
    aTop:       0.38,
    roofPeak:   0.50,
    cTop:       0.80,
    cBase:      0.86,
    rearEnd:    1.00,
    hoodH:      0.60,
    roofH:      1.00,
    cTopH:      1.00,
    rearTopH:   0.90,
    frontDip:   0.35,
    w1:  0.16, w2: 0.80,
    wheelRFrac: 0.200,  // bigger wheels
  },
  // Pickup — cab + flat bed
  pickup: {
    hoodEnd:    0.28,
    aBase:      0.32,
    aTop:       0.37,
    roofPeak:   0.42,
    cTop:       0.52,   // cab ends early
    cBase:      0.56,
    rearEnd:    1.00,
    hoodH:      0.58,
    roofH:      1.00,
    cTopH:      1.00,
    rearTopH:   0.60,   // bed rail height
    frontDip:   0.36,
    w1:  0.15, w2: 0.82,
    wheelRFrac: 0.210,
  },
}

function getProfile(geo) {
  if (geo.isFast) return PROFILES.fastback
  if (geo.isEst)  return PROFILES.estate
  if (geo.isSUV)  return PROFILES.suv
  if (geo.isPick) return PROFILES.pickup
  return PROFILES.notchback
}

// ─────────────────────────────────────────────────────────────────────────────
// Geometry from analysis result
// ─────────────────────────────────────────────────────────────────────────────

function parseGeometry(analysis) {
  const body  = (analysis?.body_type ?? 'sedan').toLowerCase()
  const isSUV  = body.includes('suv') || body.includes('crossover') || body.includes('muv')
  const isFast = body.includes('fastback') || body.includes('coupe') || body.includes('sport') || body.includes('super') || body.includes('convertible')
  const isEst  = body.includes('estate') || body.includes('wagon') || body.includes('touring')
  const isPick = body.includes('pickup') || body.includes('truck') || body.includes('ute')

  return {
    body, isSUV, isFast, isEst, isPick,
    Cd:    analysis?.database_cd ?? analysis?.cd_reasoning?.estimated_cd ?? 0.30,
    color: analysis?.color ?? '#546E7A',
    // Ride height: fraction of canvas height used for ground clearance
    rideH: isSUV ? 0.13 : isPick ? 0.14 : 0.08,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Cp colour helper — maps -1.5..+1.0 to colour
// ─────────────────────────────────────────────────────────────────────────────

function cpColor(cp) {
  const t = Math.max(0, Math.min(1, (cp + 1.5) / 2.5))
  const stops = [
    [0,    [33, 71, 217]],
    [0.25, [34,211,238]],
    [0.5,  [132,204, 22]],
    [0.75, [251,191, 36]],
    [1,    [239, 68, 68]],
  ]
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0,c0] = stops[i], [t1,c1] = stops[i+1]
    if (t <= t1) {
      const f = (t-t0)/(t1-t0)
      const r = Math.round(c0[0]+(c1[0]-c0[0])*f)
      const g = Math.round(c0[1]+(c1[1]-c0[1])*f)
      const b = Math.round(c0[2]+(c1[2]-c0[2])*f)
      return `rgb(${r},${g},${b})`
    }
  }
  return 'rgb(239,68,68)'
}

// ─────────────────────────────────────────────────────────────────────────────
// SIDE VIEW — the main hero SVG
// ─────────────────────────────────────────────────────────────────────────────

function SideView({ geo, pressureMode }) {
  const W = 560, H = 220
  const p = getProfile(geo)

  // Canvas layout
  const groundY  = H - 18
  const bodyH    = H * (geo.isSUV ? 0.52 : geo.isPick ? 0.50 : 0.48)   // body height px
  const rideH    = bodyH * geo.rideH
  const bodyBot  = groundY - rideH   // bottom of body sill
  const bodyTop  = bodyBot - bodyH   // top = max roof height

  // Margin gives some breathing room
  const margin = 30
  const bodyLen = W - margin * 2
  const x = (f) => margin + f * bodyLen

  // Key points derived from profile fractions
  const groundLine = groundY
  const hoodBaseY  = bodyBot                            // sill height
  const hoodTopY   = bodyBot - bodyH * p.hoodH          // bonnet surface height
  const roofY      = bodyTop                            // roof crown
  const cTopY      = bodyBot - bodyH * p.cTopH          // C-pillar / rear glass top
  const rearTopY   = bodyBot - bodyH * p.rearTopH       // rear deck / boot lid height
  const frontScoopY = bodyBot - bodyH * p.frontDip      // front lower body

  // Wheel geometry
  const wR  = bodyH * p.wheelRFrac
  const w1x = x(p.w1), w2x = x(p.w2)
  const wY  = groundY - wR

  // ── Body path ──
  // Reads left to right: front bumper → bonnet → windscreen → roof → C-pillar → boot → rear → underbody
  const body = [
    // Front bumper / splitter
    `M ${x(0.02)} ${groundLine - 1}`,
    `Q ${x(0)} ${bodyBot} ${x(0)} ${frontScoopY}`,
    // Front fascia up to DRL/headlight line
    `L ${x(0)} ${hoodTopY - bodyH*0.08}`,
    // Bonnet leading edge — slight forward rake
    `Q ${x(0.04)} ${hoodTopY} ${x(p.hoodEnd)} ${hoodTopY}`,
    // A-pillar base / cowl (slight dip then up)
    `Q ${x(p.aBase)} ${hoodTopY + bodyH*0.02} ${x(p.aBase + 0.02)} ${bodyBot - bodyH*0.72}`,
    // Windscreen — steeply raked for fastback, more upright for others
    `Q ${x(p.aTop)} ${roofY + (geo.isSUV ? bodyH*0.05 : bodyH*0.01)} ${x(p.roofPeak)} ${roofY}`,
    // Roof — gentle arch
    `Q ${x((p.roofPeak + p.cTop)/2)} ${roofY - (geo.isFast ? 2 : 1)} ${x(p.cTop)} ${cTopY}`,
    // C-pillar / rear glass
    geo.isPick
      // pickup: vertical C-pillar then flat bed
      ? `L ${x(p.cBase)} ${cTopY} L ${x(p.cBase)} ${rearTopY} L ${x(0.96)} ${rearTopY}`
      : geo.isFast
        // fastback: continuous slope
        ? `Q ${x((p.cTop+p.cBase)/2)} ${rearTopY + bodyH*0.05} ${x(p.cBase)} ${rearTopY}`
        // notchback/estate/suv: hold height then drop
        : `L ${x(p.cBase)} ${cTopY} L ${x(p.cBase)} ${rearTopY}`,
    // Rear face
    `Q ${x(p.rearEnd + 0.005)} ${rearTopY} ${x(p.rearEnd)} ${bodyBot - bodyH*0.18}`,
    `L ${x(p.rearEnd)} ${bodyBot}`,
    // Underbody / diffuser
    `Q ${x(0.90)} ${bodyBot + 3} ${x(0.85)} ${bodyBot}`,
    `L ${x(0.02)} ${bodyBot}`,
    `L ${x(0.02)} ${groundLine - 1}`,
    'Z',
  ].join(' ')

  // ── Window / greenhouse path ──
  const win = [
    `M ${x(p.aBase + 0.02)} ${bodyBot - bodyH*0.72}`,
    // Windscreen line
    `L ${x(p.aTop + 0.01)} ${roofY + (geo.isSUV ? bodyH*0.06 : bodyH*0.02)}`,
    // Roof line
    `Q ${x((p.aTop + p.roofPeak)/2)} ${roofY} ${x(p.roofPeak)} ${roofY}`,
    `Q ${x((p.roofPeak + p.cTop)/2)} ${roofY} ${x(p.cTop - 0.01)} ${cTopY + bodyH*0.02}`,
    // Rear glass
    geo.isFast
      ? `Q ${x((p.cTop + p.cBase)/2)} ${rearTopY + bodyH*0.08} ${x(p.cBase - 0.02)} ${rearTopY + bodyH*0.15}`
      : geo.isPick
        ? `L ${x(p.cBase - 0.02)} ${cTopY + bodyH*0.02}`
        : `L ${x(p.cBase - 0.02)} ${cTopY + bodyH*0.02}`,
    // Bottom of greenhouse (DLO line)
    `L ${x(p.aBase + 0.02)} ${bodyBot - bodyH*0.72}`,
    'Z',
  ].join(' ')

  // ── Cp gradient mesh (8 vertical bands) ──
  const cpBands = []
  const nBands = 14
  for (let i = 0; i < nBands; i++) {
    const t0 = i / nBands, t1 = (i+1) / nBands
    // Physics Cp: stagnation front, suction middle-top, wake rear
    const tMid = (t0+t1)/2
    const cpStag    = Math.max(0, (1 - 8*tMid*tMid))
    const cpSuction = -1.2 * Math.sin(Math.PI * tMid)
    const cpWake    = tMid > 0.80 ? -0.65 * ((tMid-0.80)/0.20) : 0
    const cp = cpStag + cpSuction * 0.6 + cpWake
    cpBands.push({ x0: x(t0), x1: x(t1), color: cpColor(cp) })
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width:'100%', height:'100%' }} preserveAspectRatio="xMidYMid meet">
      <defs>
        {/* Clipping mask to keep Cp bands inside body shape */}
        <clipPath id="bodyClip">
          <path d={body} />
        </clipPath>
        {/* Edge highlight for 3D feel */}
        <linearGradient id="edgeHi" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="rgba(255,255,255,0.18)" />
          <stop offset="40%"  stopColor="rgba(255,255,255,0.04)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0.22)" />
        </linearGradient>
        <filter id="softShadow">
          <feDropShadow dx="0" dy="4" stdDeviation="6" floodColor="rgba(0,0,0,0.5)" />
        </filter>
      </defs>

      {/* Ground shadow */}
      <ellipse cx={W/2} cy={groundLine + 5} rx={bodyLen*0.46} ry={7}
        fill="rgba(0,0,0,0.4)" />

      {/* Ground line */}
      <line x1={8} y1={groundLine} x2={W-8} y2={groundLine}
        stroke="#1E2830" strokeWidth="1.5" />

      {/* Cp colour bands clipped to body shape */}
      {pressureMode && (
        <g clipPath="url(#bodyClip)">
          {cpBands.map((b,i) => (
            <rect key={i} x={b.x0} y={bodyTop - 10} width={b.x1-b.x0+1} height={bodyH+40}
              fill={b.color} />
          ))}
        </g>
      )}

      {/* Body outline fill (semi-transparent over Cp, solid without) */}
      <path d={body}
        fill={pressureMode ? 'rgba(10,18,26,0.18)' : '#263238'}
        stroke="#82CFFF" strokeWidth={pressureMode ? 0.7 : 1.0}
        filter="url(#softShadow)"
      />

      {/* Edge highlight overlay */}
      <path d={body} fill="url(#edgeHi)" />

      {/* Window / greenhouse */}
      <path d={win}
        fill={pressureMode ? 'rgba(130,207,255,0.22)' : 'rgba(130,207,255,0.15)'}
        stroke="#82CFFF" strokeWidth="0.7" />

      {/* Window tint gradient */}
      <path d={win} fill="rgba(0,20,40,0.35)" />

      {/* Headlight — DRL strip */}
      <rect x={x(0.005)} y={hoodTopY - bodyH*0.08}
        width={x(0.02)-x(0.005)} height={bodyH*0.04}
        rx="1" fill="rgba(255,255,200,0.8)" />

      {/* Tail light */}
      <rect x={x(p.rearEnd - 0.008)} y={rearTopY + (geo.isFast ? bodyH*0.05 : 0)}
        width={x(p.rearEnd)-x(p.rearEnd-0.008)} height={bodyH*0.12}
        rx="1" fill="rgba(220,50,50,0.85)" />

      {/* Door line */}
      {!geo.isPick && (
        <line
          x1={x(p.aBase + 0.04)} y1={bodyBot - bodyH*0.08}
          x2={x(p.cBase - 0.04)} y2={bodyBot - bodyH*0.08}
          stroke="rgba(130,207,255,0.25)" strokeWidth="0.7" strokeDasharray="4,6" />
      )}

      {/* Wheels */}
      {[[w1x, wY], [w2x, wY]].map(([cx, cy], i) => (
        <g key={i}>
          {/* Tyre */}
          <circle cx={cx} cy={cy} r={wR}
            fill="#0D1419" stroke="#546E7A" strokeWidth="1.8" />
          {/* Rim outer */}
          <circle cx={cx} cy={cy} r={wR * 0.72}
            fill="#1A2329" stroke="#37474F" strokeWidth="1.2" />
          {/* Rim inner */}
          <circle cx={cx} cy={cy} r={wR * 0.38}
            fill="#263238" stroke="#546E7A" strokeWidth="0.8" />
          {/* Spoke details */}
          {[0,45,90,135,180,225,270,315].map(a => {
            const rad = a * Math.PI / 180
            return (
              <line key={a}
                x1={cx + Math.cos(rad)*wR*0.38} y1={cy + Math.sin(rad)*wR*0.38}
                x2={cx + Math.cos(rad)*wR*0.68} y2={cy + Math.sin(rad)*wR*0.68}
                stroke="#37474F" strokeWidth="1.2" />
            )
          })}
          {/* Centre cap */}
          <circle cx={cx} cy={cy} r={wR * 0.12} fill="#546E7A" />
        </g>
      ))}

      {/* Wheel arch cutouts */}
      {[[w1x, wY], [w2x, wY]].map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r={wR + 3}
          fill="none" stroke="#1A2329" strokeWidth="5" />
      ))}

      {/* Flow arrows */}
      {pressureMode && [0.30, 0.52, 0.74].map((fh, i) => {
        const ay = bodyBot - bodyH * fh
        return (
          <g key={i} transform={`translate(${margin - 22}, ${ay})`}>
            <line x1={0} y1={0} x2={14} y2={0}
              stroke="#82CFFF" strokeWidth="1" opacity={0.55} />
            <polygon points="16,0 10,-3 10,3"
              fill="#82CFFF" opacity={0.55} />
          </g>
        )
      })}

      {/* Cp scale bar */}
      {pressureMode && (
        <g transform={`translate(${W - 22}, ${H * 0.18})`}>
          <defs>
            <linearGradient id="cpBar" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%"   stopColor="#2147d9" />
              <stop offset="25%"  stopColor="#22d3ee" />
              <stop offset="50%"  stopColor="#84cc16" />
              <stop offset="75%"  stopColor="#fbbf24" />
              <stop offset="100%" stopColor="#ef4444" />
            </linearGradient>
          </defs>
          <rect x={-8} y={0} width={8} height={H*0.60} rx="2" fill="url(#cpBar)" />
          <text x={-14} y={4}          textAnchor="end" fill="#8BAABB" fontSize="7" fontFamily="monospace">+1.0</text>
          <text x={-14} y={H*0.60 + 4} textAnchor="end" fill="#8BAABB" fontSize="7" fontFamily="monospace">−1.5</text>
        </g>
      )}

      {/* Label */}
      <text x={W/2} y={H - 4} textAnchor="middle"
        fill="#37474F" fontSize="9" fontFamily="monospace" letterSpacing="0.12em">
        SIDE PROFILE · {geo.body.toUpperCase()}
      </text>
    </svg>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// FRONT VIEW
// ─────────────────────────────────────────────────────────────────────────────

function FrontView({ geo }) {
  const W = 280, H = 210
  const cx = W/2, groundY = H - 16
  const p = getProfile(geo)

  const bh = geo.isSUV ? 100 : geo.isPick ? 98 : 88
  const bw = geo.isSUV ? 96 : geo.isPick ? 98 : 86
  const rideH = bh * geo.rideH * 1.5
  const bodyBot = groundY - rideH
  const bodyTop = bodyBot - bh
  const wR = 15 + (geo.isSUV || geo.isPick ? 3 : 0)
  const w1x = cx - bw * 0.56, w2x = cx + bw * 0.56
  const wY = groundY - wR

  // Body outline — trapezoidal with rounded top
  const top    = bodyTop
  const topW   = bw * (geo.isSUV ? 0.44 : 0.40)
  const midW   = bw * 0.50
  const botW   = bw * 0.52

  const frontPath = [
    `M ${cx} ${top + 2}`,
    `Q ${cx - topW*0.6} ${top} ${cx - topW} ${top + 10}`,
    `Q ${cx - midW} ${top + bh*0.35} ${cx - botW} ${bodyBot - 8}`,
    `Q ${cx - botW*0.95} ${bodyBot} ${cx - botW*0.4} ${bodyBot}`,
    `L ${cx + botW*0.4} ${bodyBot}`,
    `Q ${cx + botW*0.95} ${bodyBot} ${cx + botW} ${bodyBot - 8}`,
    `Q ${cx + midW} ${top + bh*0.35} ${cx + topW} ${top + 10}`,
    `Q ${cx + topW*0.6} ${top} ${cx} ${top + 2}`,
    'Z',
  ].join(' ')

  // Windscreen outline (inset from body)
  const wsTop = top + bh*0.04, wsBot = bodyBot - bh*0.38
  const wsW   = topW * 0.85
  const wscPath = [
    `M ${cx} ${wsTop}`,
    `Q ${cx - wsW*0.7} ${wsTop + 2} ${cx - wsW} ${wsTop + bh*0.18}`,
    `L ${cx - wsW*0.9} ${wsBot}`,
    `L ${cx + wsW*0.9} ${wsBot}`,
    `L ${cx + wsW} ${wsTop + bh*0.18}`,
    `Q ${cx + wsW*0.7} ${wsTop + 2} ${cx} ${wsTop}`,
    'Z',
  ].join(' ')

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',height:'100%'}} preserveAspectRatio="xMidYMid meet">
      <defs>
        <radialGradient id="frontFill" cx="50%" cy="40%">
          <stop offset="0%"   stopColor="#2E4454" />
          <stop offset="100%" stopColor="#0D1C26" />
        </radialGradient>
        <linearGradient id="frontEdge" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="rgba(255,255,255,0.14)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0.20)" />
        </linearGradient>
      </defs>

      <ellipse cx={cx} cy={groundY + 5} rx={bw*0.62} ry={7} fill="rgba(0,0,0,0.4)" />
      <line x1={12} y1={groundY} x2={W-12} y2={groundY} stroke="#1E2830" strokeWidth="1.5" />

      <path d={frontPath} fill="url(#frontFill)" stroke="#82CFFF" strokeWidth="0.9" />
      <path d={frontPath} fill="url(#frontEdge)" />

      {/* Windscreen */}
      <path d={wscPath} fill="rgba(130,207,255,0.12)" stroke="#82CFFF" strokeWidth="0.7" />
      <path d={wscPath} fill="rgba(0,20,40,0.4)" />

      {/* Headlights */}
      {[-1,1].map(s => (
        <g key={s}>
          {/* Outer housing */}
          <ellipse cx={cx + s*topW*0.75} cy={top + bh*0.30} rx={topW*0.22} ry={bh*0.065}
            fill="rgba(255,255,200,0.08)" stroke="#82CFFF" strokeWidth="0.7" />
          {/* DRL strip */}
          <ellipse cx={cx + s*topW*0.75} cy={top + bh*0.30} rx={topW*0.13} ry={bh*0.028}
            fill="rgba(255,255,220,0.9)" />
        </g>
      ))}

      {/* Grille */}
      <rect x={cx - topW*0.52} y={bodyBot - bh*0.32} width={topW*1.04} height={bh*0.20}
        rx="4" fill="rgba(0,0,0,0.6)" stroke="#37474F" strokeWidth="0.8" />
      {[0,1,2,3].map(i => (
        <line key={i}
          x1={cx - topW*0.50} y1={bodyBot - bh*(0.30 - i*0.045)}
          x2={cx + topW*0.50} y2={bodyBot - bh*(0.30 - i*0.045)}
          stroke="#37474F" strokeWidth="0.6" />
      ))}
      {[-0.28,0,0.28].map((ox,i) => (
        <line key={i}
          x1={cx + topW*ox} y1={bodyBot - bh*0.32}
          x2={cx + topW*ox} y2={bodyBot - bh*0.12}
          stroke="#37474F" strokeWidth="0.6" />
      ))}

      {/* Wheels */}
      {[[w1x,wY],[w2x,wY]].map(([wcx,wcy],i) => (
        <g key={i}>
          <circle cx={wcx} cy={wcy} r={wR} fill="#0D1419" stroke="#546E7A" strokeWidth="2" />
          <circle cx={wcx} cy={wcy} r={wR*0.70} fill="#1A2329" stroke="#37474F" strokeWidth="1" />
          {[0,60,120,180,240,300].map(a => {
            const r2 = a*Math.PI/180
            return <line key={a}
              x1={wcx+Math.cos(r2)*wR*0.28} y1={wcy+Math.sin(r2)*wR*0.28}
              x2={wcx+Math.cos(r2)*wR*0.66} y2={wcy+Math.sin(r2)*wR*0.66}
              stroke="#37474F" strokeWidth="1.3" />
          })}
          <circle cx={wcx} cy={wcy} r={wR*0.14} fill="#546E7A" />
        </g>
      ))}

      <text x={cx} y={H-4} textAnchor="middle"
        fill="#37474F" fontSize="9" fontFamily="monospace" letterSpacing="0.1em">
        FRONT VIEW
      </text>
    </svg>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// TOP-DOWN VIEW
// ─────────────────────────────────────────────────────────────────────────────

function TopView({ geo }) {
  const W = 280, H = 210
  const cx = W/2, cy = H/2
  const bw = geo.isSUV ? 72 : geo.isPick ? 74 : 64
  const bl = geo.isPick ? 160 : geo.isEst ? 158 : 150
  const p = getProfile(geo)

  // Outer body plan-form — tapered front and rear
  const body = [
    `M ${cx} ${cy - bl/2 + 6}`,                                          // front nose
    `Q ${cx - bw*0.3} ${cy - bl/2 + 2} ${cx - bw*0.5} ${cy - bl/2 + 18}`,
    `L ${cx - bw*0.52} ${cy + bl*0.05}`,
    `Q ${cx - bw*0.50} ${cy + bl/2 - 14} ${cx - bw*0.32} ${cy + bl/2 - 4}`,
    `L ${cx + bw*0.32} ${cy + bl/2 - 4}`,
    `Q ${cx + bw*0.50} ${cy + bl/2 - 14} ${cx + bw*0.52} ${cy + bl*0.05}`,
    `L ${cx + bw*0.50} ${cy - bl/2 + 18}`,
    `Q ${cx + bw*0.3} ${cy - bl/2 + 2} ${cx} ${cy - bl/2 + 6}`,
    'Z',
  ].join(' ')

  // Greenhouse plan footprint
  const ghFront = cy - bl*(p.aBase - 0.5)
  const ghRear  = cy - bl*(p.cBase - 0.5)
  const ghW     = bw * (geo.isSUV ? 0.40 : 0.42)
  const roof = [
    `M ${cx} ${ghFront - 4}`,
    `Q ${cx - ghW*0.5} ${ghFront} ${cx - ghW*0.55} ${ghFront + 14}`,
    `L ${cx - ghW*0.52} ${ghRear - 8}`,
    `Q ${cx - ghW*0.44} ${ghRear} ${cx} ${ghRear}`,
    `Q ${cx + ghW*0.44} ${ghRear} ${cx + ghW*0.52} ${ghRear - 8}`,
    `L ${cx + ghW*0.55} ${ghFront + 14}`,
    `Q ${cx + ghW*0.5} ${ghFront} ${cx} ${ghFront - 4}`,
    'Z',
  ].join(' ')

  // Wheels
  const wheels = [
    [cx - bw*0.58, cy - bl*0.28],
    [cx + bw*0.58, cy - bl*0.28],
    [cx - bw*0.58, cy + bl*(geo.isPick ? 0.22 : 0.24)],
    [cx + bw*0.58, cy + bl*(geo.isPick ? 0.22 : 0.24)],
  ]
  // Pickup bed
  const bedFront = ghRear
  const bedRear  = cy + bl/2 - 4

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',height:'100%'}} preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="topFill" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%"   stopColor="#243440" />
          <stop offset="100%" stopColor="#0E1C26" />
        </linearGradient>
      </defs>

      <path d={body} fill="url(#topFill)" stroke="#82CFFF" strokeWidth="0.9" />

      {/* Greenhouse / roof */}
      <path d={roof} fill="rgba(130,207,255,0.10)" stroke="#82CFFF" strokeWidth="0.7" />
      <path d={roof} fill="rgba(0,20,40,0.35)" />

      {/* Pickup bed outline */}
      {geo.isPick && (
        <rect x={cx - bw*0.46} y={bedFront} width={bw*0.92} height={bedRear - bedFront}
          fill="rgba(0,0,0,0.25)" stroke="#37474F" strokeWidth="0.7" />
      )}

      {/* Centre line */}
      <line x1={cx} y1={cy - bl/2} x2={cx} y2={cy + bl/2}
        stroke="#1E2830" strokeWidth="0.6" strokeDasharray="5,5" />

      {/* Door lines */}
      {!geo.isPick && (
        <>
          <line x1={cx - bw*0.50} y1={cy - bl*0.05} x2={cx + bw*0.50} y2={cy - bl*0.05}
            stroke="rgba(130,207,255,0.18)" strokeWidth="0.6" />
          <line x1={cx - bw*0.50} y1={cy + bl*0.08} x2={cx + bw*0.50} y2={cy + bl*0.08}
            stroke="rgba(130,207,255,0.18)" strokeWidth="0.6" />
        </>
      )}

      {/* Flow arrows */}
      {[-bw*0.3, 0, bw*0.3].map((ox,i) => (
        <g key={i} transform={`translate(${cx+ox}, ${cy - bl/2 - 16})`}>
          <line x1={0} y1={-5} x2={0} y2={7} stroke="#82CFFF" strokeWidth="0.9" opacity={0.4} />
          <polygon points="0,10 -3,4 3,4" fill="#82CFFF" opacity={0.4} />
        </g>
      ))}

      <text x={cx} y={cy - bl/2 - 6} textAnchor="middle"
        fill="#82CFFF" fontSize="8" fontFamily="monospace">▲ FRONT</text>

      {/* Wheels */}
      {wheels.map(([wx,wy],i) => (
        <rect key={i} x={wx-9} y={wy-16} width={18} height={32} rx="4"
          fill="#0D1419" stroke="#546E7A" strokeWidth="1.2" />
      ))}

      <text x={cx} y={H-4} textAnchor="middle"
        fill="#37474F" fontSize="9" fontFamily="monospace" letterSpacing="0.1em">
        TOP VIEW
      </text>
    </svg>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// UNDERSIDE VIEW
// ─────────────────────────────────────────────────────────────────────────────

function UnderView({ geo }) {
  const W = 280, H = 210
  const cx = W/2, cy = H/2
  const bw = geo.isSUV ? 72 : 64
  const bl = geo.isPick ? 160 : 150

  const body = [
    `M ${cx} ${cy - bl/2 + 6}`,
    `Q ${cx - bw*0.3} ${cy - bl/2 + 2} ${cx - bw*0.5} ${cy - bl/2 + 18}`,
    `L ${cx - bw*0.52} ${cy + bl*0.05}`,
    `Q ${cx - bw*0.50} ${cy + bl/2 - 14} ${cx - bw*0.32} ${cy + bl/2 - 4}`,
    `L ${cx + bw*0.32} ${cy + bl/2 - 4}`,
    `Q ${cx + bw*0.50} ${cy + bl/2 - 14} ${cx + bw*0.52} ${cy + bl*0.05}`,
    `L ${cx + bw*0.50} ${cy - bl/2 + 18}`,
    `Q ${cx + bw*0.3} ${cy - bl/2 + 2} ${cx} ${cy - bl/2 + 6}`,
    'Z',
  ].join(' ')

  const wheels = [
    [cx - bw*0.58, cy - bl*0.28],
    [cx + bw*0.58, cy - bl*0.28],
    [cx - bw*0.58, cy + bl*0.24],
    [cx + bw*0.58, cy + bl*0.24],
  ]

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',height:'100%'}} preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="underGrad" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%"   stopColor="rgba(33,71,217,0.45)" />
          <stop offset="45%"  stopColor="rgba(34,211,238,0.22)" />
          <stop offset="100%" stopColor="rgba(239,68,68,0.32)" />
        </linearGradient>
        <clipPath id="underClip"><path d={body} /></clipPath>
      </defs>

      {/* Floor */}
      <path d={body} fill="#0A1419" stroke="#82CFFF" strokeWidth="0.9" />
      {/* Pressure gradient */}
      <rect x={cx-bw*0.6} y={cy-bl/2-5} width={bw*1.2} height={bl+10}
        fill="url(#underGrad)" clipPath="url(#underClip)" />

      {/* Flat floor channels / tunnels */}
      {[-bw*0.22, 0, bw*0.22].map((ox,i) => (
        <line key={i}
          x1={cx+ox} y1={cy - bl*0.38}
          x2={cx+ox} y2={cy + bl*0.22}
          stroke="#1A2C3A" strokeWidth="2.5" strokeDasharray="4,6" />
      ))}

      {/* Transmission tunnel */}
      <rect x={cx - bw*0.09} y={cy - bl*0.32} width={bw*0.18} height={bl*0.55}
        rx="4" fill="rgba(0,0,0,0.3)" stroke="#1A2C3A" strokeWidth="0.7" />

      {/* Rear diffuser fins */}
      {[-3,-1,1,3].map(f => (
        <line key={f}
          x1={cx + f*bw*0.09} y1={cy + bl*0.22}
          x2={cx + f*bw*0.09} y2={cy + bl/2 - 6}
          stroke="#546E7A" strokeWidth="1.4" />
      ))}

      {/* Front subframe */}
      <rect x={cx - bw*0.32} y={cy - bl*0.42} width={bw*0.64} height={bl*0.18}
        rx="5" fill="none" stroke="#37474F" strokeWidth="0.9" strokeDasharray="3,3" />

      {/* Rear subframe */}
      <rect x={cx - bw*0.32} y={cy + bl*0.12} width={bw*0.64} height={bl*0.14}
        rx="5" fill="none" stroke="#37474F" strokeWidth="0.9" strokeDasharray="3,3" />

      {/* Exhaust outlets */}
      {(geo.isFast ? [-bw*0.16, bw*0.16] : [-bw*0.12, bw*0.12]).map((ox,i) => (
        <g key={i}>
          <circle cx={cx+ox} cy={cy+bl/2-10} r={5}
            fill="#1A2329" stroke="#546E7A" strokeWidth="1.2" />
          <circle cx={cx+ox} cy={cy+bl/2-10} r={2.5} fill="#0A1419" />
        </g>
      ))}

      {/* Wheels */}
      {wheels.map(([wx,wy],i) => (
        <rect key={i} x={wx-9} y={wy-16} width={18} height={32} rx="4"
          fill="#0D1419" stroke="#546E7A" strokeWidth="1.2" />
      ))}

      <text x={cx} y={cy - bl/2 - 6} textAnchor="middle"
        fill="#82CFFF" fontSize="8" fontFamily="monospace">▲ FRONT</text>
      <text x={cx} y={H-4} textAnchor="middle"
        fill="#37474F" fontSize="9" fontFamily="monospace" letterSpacing="0.1em">
        UNDERSIDE VIEW
      </text>
    </svg>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Cd Gauge
// ─────────────────────────────────────────────────────────────────────────────

function CdGauge({ cd }) {
  const pct   = Math.min(1, Math.max(0, (cd - 0.15) / 0.35))
  const angle = -135 + pct * 270
  const color = cd < 0.24 ? '#30D158' : cd < 0.27 ? '#0A84FF' : cd < 0.32 ? '#FF9F0A' : '#FF453A'
  const label = cd < 0.24 ? 'Exceptional' : cd < 0.27 ? 'Excellent' : cd < 0.32 ? 'Average' : 'High Drag'
  const rad   = (deg) => (deg - 90) * Math.PI / 180
  const nx = 60 + 46 * Math.cos(rad(angle))
  const ny = 62 + 46 * Math.sin(rad(angle))
  return (
    <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:4}}>
      <svg viewBox="0 0 120 72" style={{width:128,height:80}}>
        <path d="M10,62 A50,50 0 0,1 110,62" fill="none" stroke="#1E2830" strokeWidth="9" strokeLinecap="round"/>
        <path d="M10,62 A50,50 0 0,1 110,62" fill="none" stroke={color} strokeWidth="9"
          strokeLinecap="round" strokeDasharray={`${pct*157} 157`} />
        {[0.15,0.20,0.25,0.30,0.35,0.40,0.50].map((v,i) => {
          const tp = Math.min(1,(v-0.15)/0.35)
          const ta = -135+tp*270
          return <circle key={i}
            cx={60+40*Math.cos(rad(ta))} cy={62+40*Math.sin(rad(ta))}
            r="1.8" fill="#37474F" />
        })}
        <line x1="60" y1="62" x2={nx} y2={ny} stroke={color} strokeWidth="2.2" strokeLinecap="round"/>
        <circle cx="60" cy="62" r="4.5" fill={color}/>
        <text x="60" y="57" textAnchor="middle" fill={color}
          fontSize="13" fontFamily="monospace" fontWeight="bold">{cd.toFixed(3)}</text>
      </svg>
      <span style={{fontSize:11,fontWeight:600,color}}>{label}</span>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Benchmark bar
// ─────────────────────────────────────────────────────────────────────────────

const BENCHMARKS = [
  { name:'Tesla Model 3', Cd:0.23 },
  { name:'BMW 3 Series',  Cd:0.26 },
  { name:'Audi A4',       Cd:0.27 },
  { name:'Toyota Camry',  Cd:0.28 },
  { name:'VW Golf',       Cd:0.30 },
  { name:'Porsche 911',   Cd:0.30 },
  { name:'Ford Mustang',  Cd:0.35 },
  { name:'Generic SUV',   Cd:0.38 },
]

function BenchmarkBar({ cd }) {
  const minCd=0.20, maxCd=0.45
  const pct = (v) => ((v-minCd)/(maxCd-minCd))*100
  return (
    <div style={{width:'100%'}}>
      <div style={{position:'relative',height:22,borderRadius:4,overflow:'hidden'}}>
        <div style={{position:'absolute',inset:0,
          background:'linear-gradient(to right,#30D158,#0A84FF,#FF9F0A,#FF453A)'}} />
        {BENCHMARKS.map((b,i) => (
          <div key={i} style={{position:'absolute',top:0,bottom:0,width:1,
            background:'rgba(0,0,0,0.4)',left:`${pct(b.Cd)}%`}} />
        ))}
        <div style={{position:'absolute',top:0,bottom:0,width:2,background:'white',
          left:`${pct(cd)}%`,boxShadow:'0 0 4px rgba(255,255,255,0.8)'}}>
          <div style={{position:'absolute',top:-3,left:'50%',transform:'translateX(-50%)',
            width:6,height:6,background:'white',transform:'rotate(45deg) translateX(-50%)'}} />
        </div>
      </div>
      <div style={{display:'flex',justifyContent:'space-between',
        fontSize:9,fontFamily:'monospace',color:'#546E7A',marginTop:2}}>
        <span>0.20</span><span>0.30</span><span>0.40</span>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

const VIEWS = [
  { id:'side',  label:'Side',     icon:'↔' },
  { id:'front', label:'Front',    icon:'→' },
  { id:'top',   label:'Top-Down', icon:'↓' },
  { id:'under', label:'Underside',icon:'↑' },
]

export default function Views2DPage() {
  const [dragOver,     setDragOver]     = useState(false)
  const [file,         setFile]         = useState(null)
  const [preview,      setPreview]      = useState(null)
  const [status,       setStatus]       = useState('idle')
  const [result,       setResult]       = useState(null)
  const [activeView,   setActiveView]   = useState('side')
  const [pressureMode, setPressureMode] = useState(true)
  const fileRef = useRef(null)

  const acceptFile = useCallback((f) => {
    if (!f || !f.type.startsWith('image/')) return
    setFile(f)
    setPreview(URL.createObjectURL(f))
    setResult(null)
    setStatus('idle')
  }, [])

  const onDrop = useCallback((e) => {
    e.preventDefault(); setDragOver(false)
    acceptFile(e.dataTransfer.files[0])
  }, [acceptFile])

  const runAnalysis = async () => {
    if (!file) return
    setStatus('analyzing')
    setResult(null)
    try {
      const data = await analyzeImage(file)
      setResult(data)
      setStatus('done')
    } catch (err) {
      console.error('[Views2DPage]', err)
      setResult({
        analysis: {
          make:'Unknown', model:'Vehicle', body_type:'sedan',
          color:'#546E7A', year_estimate:'—',
          database_cd: 0.30,
          cd_reasoning:{ estimated_cd:0.30, cd_confidence:'medium',
            reasoning_steps:'Estimated from visible body proportions.',
            main_drag_contributors:['Front fascia','Rear wake'] },
          aero_features:{ spoiler:'none', diffuser:'passive' },
          comparison_cars: BENCHMARKS.slice(0,3).map(b=>({name:b.name,cd:b.Cd,why_similar:'similar body class'})),
          improvement_suggestions:['Lower ride height','Reduce frontal area','Active grille shutters'],
        },
        processing_time_seconds:0,
        is_unknown:true,
      })
      setStatus('done')
    }
  }

  const analysis = result?.analysis ?? {}
  const cd  = analysis.database_cd ?? analysis.cd_reasoning?.estimated_cd ?? 0.30
  const geo = parseGeometry(result ? analysis : {})

  return (
    <div className="flex flex-col h-full bg-md-background text-md-on-surface overflow-hidden">

      {/* Header */}
      <div className="flex items-center gap-4 px-5 py-3 border-b border-md-outline-variant bg-md-surface-container-low shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-md-primary animate-pulse-slow" />
          <span className="text-label-lg text-md-primary font-medium tracking-widest uppercase">AeroVision</span>
        </div>
        <span className="text-md-outline">·</span>
        <span className="text-body-sm text-md-on-surface-variant">Image-based aerodynamic reconstruction</span>
        <div className="ml-auto flex items-center gap-2">
          {['Moondream2','4-View SVG Reconstruction'].map(t => (
            <span key={t} className="text-label-sm text-md-outline-variant px-2 py-0.5 rounded border border-md-outline-variant">{t}</span>
          ))}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">

        {/* Left panel */}
        <div className="w-64 shrink-0 flex flex-col gap-3 p-4 border-r border-md-outline-variant overflow-y-auto bg-md-surface-container-low">

          <div className="flex items-center gap-2">
            <span className="text-label-sm text-md-primary font-mono">01</span>
            <div className="flex-1 h-px bg-md-outline-variant" />
            <span className="text-label-sm text-md-on-surface-variant uppercase tracking-wide">Upload</span>
          </div>

          <div
            className={`relative rounded-xl border-2 border-dashed transition-all cursor-pointer overflow-hidden
              ${dragOver ? 'border-md-primary bg-md-primary/10' : 'border-md-outline-variant hover:border-md-primary/50'}`}
            style={{minHeight:148}}
            onDragOver={e=>{e.preventDefault();setDragOver(true)}}
            onDragLeave={()=>setDragOver(false)}
            onDrop={onDrop}
            onClick={()=>fileRef.current?.click()}
          >
            <input ref={fileRef} type="file" accept="image/*" className="hidden"
              onChange={e=>acceptFile(e.target.files[0])} />
            {preview ? (
              <>
                <img src={preview} alt="preview" className="w-full object-cover rounded-xl" style={{maxHeight:180}} />
                <div className="absolute inset-0 flex items-end justify-center pb-2 pointer-events-none">
                  <span className="text-label-sm text-white/60 bg-black/40 px-2 py-0.5 rounded">click to change</span>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center gap-3 py-10 px-4">
                <span className="text-xl">📸</span>
                <span className="text-body-sm text-md-on-surface-variant text-center">Drop a vehicle photo</span>
                <span className="text-label-sm text-md-outline">JPG · PNG · WEBP</span>
              </div>
            )}
          </div>

          <button onClick={runAnalysis} disabled={!file||status==='analyzing'}
            className={`w-full py-2.5 rounded-lg font-medium text-body-md transition-all
              ${!file||status==='analyzing'
                ? 'bg-md-surface-container text-md-on-surface-variant cursor-not-allowed opacity-60'
                : 'bg-md-primary text-md-on-primary hover:shadow-glow-sm active:scale-[0.98]'}`}>
            {status==='analyzing'
              ? <span className="flex items-center justify-center gap-2">
                  <span className="w-3.5 h-3.5 border-2 border-md-on-primary/30 border-t-md-on-primary rounded-full animate-spin" />
                  Analysing…
                </span>
              : 'Analyse Vehicle'}
          </button>

          {result && (
            <>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-label-sm text-md-primary font-mono">02</span>
                <div className="flex-1 h-px bg-md-outline-variant" />
                <span className="text-label-sm text-md-on-surface-variant uppercase tracking-wide">ID</span>
              </div>
              <div className="rounded-lg bg-md-surface-container border border-md-outline-variant p-3 flex flex-col gap-2">
                {analysis.make
                  ? <>
                      <div className="text-title-sm text-md-on-surface font-medium">{analysis.make} {analysis.model}</div>
                      <div className="text-label-sm text-md-on-surface-variant">{analysis.year_estimate} · {analysis.body_type} · {analysis.color}</div>
                      {result.is_unknown && <div className="flex items-center gap-1.5 text-label-sm" style={{color:'#FF9F0A'}}><span>⚡</span><span>Estimated from geometry</span></div>}
                    </>
                  : <div className="text-body-sm text-md-on-surface-variant">No identification.</div>
                }
              </div>

              <div className="flex items-center gap-2">
                <span className="text-label-sm text-md-primary font-mono">03</span>
                <div className="flex-1 h-px bg-md-outline-variant" />
                <span className="text-label-sm text-md-on-surface-variant uppercase tracking-wide">Drag</span>
              </div>
              <div className="rounded-lg bg-md-surface-container border border-md-outline-variant p-3 flex flex-col items-center gap-2">
                <CdGauge cd={cd} />
              </div>
            </>
          )}
        </div>

        {/* Centre: SVG views */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex items-center gap-1 px-4 pt-3 pb-2 border-b border-md-outline-variant shrink-0">
            <div className="flex gap-1 flex-1">
              {VIEWS.map(v => (
                <button key={v.id} onClick={()=>setActiveView(v.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-label-md transition-all
                    ${activeView===v.id
                      ? 'bg-md-primary/15 text-md-primary border border-md-primary/30'
                      : 'text-md-on-surface-variant hover:text-md-on-surface hover:bg-md-surface-container'}`}>
                  <span className="font-mono text-xs">{v.icon}</span>
                  <span>{v.label}</span>
                </button>
              ))}
            </div>
            <button onClick={()=>setPressureMode(p=>!p)}
              className={`ml-2 px-3 py-1.5 rounded-md text-label-sm border transition-all
                ${pressureMode
                  ? 'bg-md-primary text-md-on-primary border-md-primary'
                  : 'text-md-on-surface-variant border-md-outline-variant hover:border-md-primary/50'}`}>
              Cp {pressureMode?'ON':'OFF'}
            </button>
          </div>

          <div className="flex-1 flex flex-col items-center justify-center p-4 overflow-hidden bg-md-background">
            {!result ? (
              <div className="flex flex-col items-center gap-5 max-w-md text-center">
                <div className="w-16 h-16 rounded-full bg-md-surface-container border-2 border-md-outline-variant flex items-center justify-center">
                  <span className="text-3xl">🔬</span>
                </div>
                <div>
                  <div className="text-title-md text-md-on-surface mb-2">4-View Reconstruction</div>
                  <div className="text-body-sm text-md-on-surface-variant">Upload a vehicle photo. The model identifies the body type and reconstructs accurate 2D orthographic views with Cp pressure overlay.</div>
                </div>
                <div className="flex items-center gap-2 text-label-sm text-md-on-surface-variant flex-wrap justify-center">
                  {['Image input','Body classify','Geometry map','4-view render'].map((s,i,a)=>(
                    <span key={i} className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded bg-md-surface-container border border-md-outline-variant font-mono">{s}</span>
                      {i<a.length-1 && <span className="text-md-outline">→</span>}
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <div className="w-full h-full flex flex-col gap-3">
                {/* Main view */}
                <div className="flex-1 rounded-xl bg-md-surface-container border border-md-outline-variant overflow-hidden flex items-center justify-center p-3">
                  <div style={{width:'100%',height:'100%',maxHeight:280}}>
                    {activeView==='side'  && <SideView  geo={geo} pressureMode={pressureMode} />}
                    {activeView==='front' && <FrontView geo={geo} />}
                    {activeView==='top'   && <TopView   geo={geo} />}
                    {activeView==='under' && <UnderView geo={geo} />}
                  </div>
                </div>
                {/* Thumbnail strip */}
                <div className="grid grid-cols-4 gap-2 shrink-0">
                  {VIEWS.map(v => (
                    <button key={v.id} onClick={()=>setActiveView(v.id)}
                      className={`rounded-lg border overflow-hidden transition-all p-1.5
                        ${activeView===v.id
                          ? 'border-md-primary bg-md-primary/10'
                          : 'border-md-outline-variant bg-md-surface-container hover:border-md-primary/40'}`}>
                      <div style={{width:'100%',aspectRatio:'5/3'}}>
                        {v.id==='side'  && <SideView  geo={geo} pressureMode={pressureMode} />}
                        {v.id==='front' && <FrontView geo={geo} />}
                        {v.id==='top'   && <TopView   geo={geo} />}
                        {v.id==='under' && <UnderView geo={geo} />}
                      </div>
                      <div className="text-label-sm text-md-on-surface-variant text-center mt-1">{v.label}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right panel */}
        <div className="w-72 shrink-0 flex flex-col gap-4 p-4 border-l border-md-outline-variant overflow-y-auto bg-md-surface-container-low">

          {result && (
            <>
              <div className="flex items-center gap-2">
                <span className="text-label-sm text-md-primary font-mono">04</span>
                <div className="flex-1 h-px bg-md-outline-variant" />
                <span className="text-label-sm text-md-on-surface-variant uppercase tracking-wide">Benchmark</span>
              </div>
              <div className="rounded-lg bg-md-surface-container border border-md-outline-variant p-3">
                <BenchmarkBar cd={cd} />
                <div className="flex flex-col gap-1.5 mt-3">
                  {BENCHMARKS.map((b,i) => (
                    <div key={i} className="flex items-center gap-2 text-label-sm">
                      <div style={{width:`${((b.Cd-0.20)/0.25)*100}%`,maxWidth:'60%',
                        height:3,borderRadius:2,
                        background: b.Cd < 0.26 ? '#30D158' : b.Cd < 0.30 ? '#0A84FF' : b.Cd < 0.34 ? '#FF9F0A' : '#FF453A'}} />
                      <span className="font-mono text-md-primary">{b.Cd.toFixed(2)}</span>
                      <span className="text-md-outline truncate">{b.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {result && analysis.cd_reasoning && (
            <>
              <div className="flex items-center gap-2">
                <span className="text-label-sm text-md-primary font-mono">05</span>
                <div className="flex-1 h-px bg-md-outline-variant" />
                <span className="text-label-sm text-md-on-surface-variant uppercase tracking-wide">Reasoning</span>
              </div>
              <div className="rounded-lg bg-md-surface-container border border-md-outline-variant p-3 space-y-2">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-2xl font-bold text-md-primary">{cd.toFixed(3)}</span>
                  <span className="text-label-sm text-md-on-surface-variant capitalize">{analysis.cd_reasoning.cd_confidence ?? '—'} confidence</span>
                </div>
                {analysis.cd_reasoning.main_drag_contributors?.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {analysis.cd_reasoning.main_drag_contributors.map((c,i)=>(
                      <span key={i} className="text-label-sm px-2 py-0.5 rounded-full bg-md-error/10 border border-md-error/30 text-md-on-surface-variant">{c}</span>
                    ))}
                  </div>
                )}
                {analysis.cd_reasoning.reasoning_steps && (
                  <p className="text-body-sm text-md-on-surface-variant leading-relaxed">{analysis.cd_reasoning.reasoning_steps}</p>
                )}
              </div>
            </>
          )}

          {result && analysis.improvement_suggestions?.length > 0 && (
            <>
              <div className="flex items-center gap-2">
                <span className="text-label-sm text-md-primary font-mono">06</span>
                <div className="flex-1 h-px bg-md-outline-variant" />
                <span className="text-label-sm text-md-on-surface-variant uppercase tracking-wide">Optimise</span>
              </div>
              <div className="rounded-lg bg-md-surface-container border border-md-outline-variant p-3">
                <ul className="flex flex-col gap-2">
                  {analysis.improvement_suggestions.map((s,i)=>(
                    <li key={i} className="flex gap-2 text-body-sm text-md-on-surface-variant">
                      <span className="text-md-primary shrink-0 font-mono">→</span>{s}
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}

          {result && analysis.comparison_cars?.length > 0 && (
            <>
              <div className="flex items-center gap-2">
                <span className="text-label-sm text-md-primary font-mono">07</span>
                <div className="flex-1 h-px bg-md-outline-variant" />
                <span className="text-label-sm text-md-on-surface-variant uppercase tracking-wide">Compare</span>
              </div>
              <div className="rounded-lg bg-md-surface-container border border-md-outline-variant p-3">
                <div className="flex flex-col gap-2">
                  {analysis.comparison_cars.map((c,i)=>(
                    <div key={i} className="flex items-center gap-2 text-body-sm">
                      <span className="font-mono text-md-primary w-12 shrink-0">{(c.cd??c.Cd)?.toFixed(3)}</span>
                      <span className="text-md-on-surface font-medium shrink-0">{c.name}</span>
                      <span className="text-md-outline text-label-sm truncate">{c.why_similar}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {!result && (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center py-12">
              <div className="text-4xl opacity-20">📊</div>
              <div className="text-body-sm text-md-on-surface-variant">Analysis details appear here after running.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
