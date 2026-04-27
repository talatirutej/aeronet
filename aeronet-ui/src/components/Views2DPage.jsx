// Copyright (c) 2026 Rutej Talati. All rights reserved.

import { useState, useCallback, useMemo } from 'react'

const BACKEND = import.meta.env?.VITE_AERONET_BACKEND ?? 'https://aeronet-osiw.onrender.com'

// ── Feature definitions (DrivAerML 16-param notchback) ────────────────────────
const FEATURE_DEFS = [
  { key: 'Vehicle_Length',      label: 'Vehicle Length',      unit: 'm',   min: 40,    max: 60,    step: 0.5,   dp: 1 },
  { key: 'Vehicle_Width',       label: 'Vehicle Width',       unit: 'm',   min: 0.5,   max: 0.75,  step: 0.01,  dp: 3 },
  { key: 'Vehicle_Height',      label: 'Vehicle Height',      unit: 'm',   min: 0.08,  max: 0.18,  step: 0.005, dp: 3 },
  { key: 'Front_Overhang',      label: 'Front Overhang',      unit: 'deg', min: -35,   max: -15,   step: 0.5,   dp: 1 },
  { key: 'Front_Planview',      label: 'Front Planview',      unit: '',    min: 0.75,  max: 1.05,  step: 0.01,  dp: 3 },
  { key: 'Hood_Angle',          label: 'Hood Angle',          unit: 'rad', min: -0.05, max: 0.15,  step: 0.005, dp: 3 },
  { key: 'Approach_Angle',      label: 'Approach Angle',      unit: 'deg', min: -10,   max: 0,     step: 0.25,  dp: 2 },
  { key: 'Windscreen_Angle',    label: 'Windscreen Angle',    unit: 'rad', min: 0.08,  max: 0.28,  step: 0.005, dp: 3 },
  { key: 'Greenhouse_Tapering', label: 'Greenhouse Tapering', unit: '',    min: 0.65,  max: 1.0,   step: 0.01,  dp: 3 },
  { key: 'Backlight_Angle',     label: 'Backlight Angle',     unit: 'deg', min: 35,    max: 65,    step: 0.5,   dp: 1 },
  { key: 'Decklid_Height',      label: 'Decklid Height',      unit: 'm',   min: -1.2,  max: 0.2,   step: 0.05,  dp: 2 },
  { key: 'Rearend_tapering',    label: 'Rearend Tapering',    unit: 'deg', min: -18,   max: -2,    step: 0.5,   dp: 1 },
  { key: 'Rear_Overhang',       label: 'Rear Overhang',       unit: 'deg', min: -32,   max: -14,   step: 0.5,   dp: 1 },
  { key: 'Rear_Diffusor_Angle', label: 'Rear Diffusor Angle', unit: 'rad', min: 0.02,  max: 0.26,  step: 0.005, dp: 3 },
  { key: 'Vehicle_Ride_Height', label: 'Ride Height',         unit: 'm',   min: -0.5,  max: 0.2,   step: 0.01,  dp: 2 },
  { key: 'Vehicle_Pitch',       label: 'Vehicle Pitch',       unit: 'deg', min: -0.01, max: 0.02,  step: 0.001, dp: 3 },
]

const DEFAULTS = {
  Vehicle_Length: 49.94,  Vehicle_Width: 0.615,    Vehicle_Height: 0.127,
  Front_Overhang: -25.97, Front_Planview: 0.903,   Hood_Angle: 0.052,
  Approach_Angle: -5.33,  Windscreen_Angle: 0.180, Greenhouse_Tapering: 0.838,
  Backlight_Angle: 50.18, Decklid_Height: -0.587,  Rearend_tapering: -9.96,
  Rear_Overhang: -23.68,  Rear_Diffusor_Angle: 0.142, Vehicle_Ride_Height: -0.179,
  Vehicle_Pitch: 0.004,
}

const MODELS = [
  { id: 'GradBoost-DrivAerML',    label: 'Gradient Boost',  r2: '0.953', ready: true  },
  { id: 'RandomForest-DrivAerML', label: 'Random Forest',   r2: '0.815', ready: true  },
  { id: 'ResNet-Tabular-12K',     label: 'ResNet-12K',      r2: '—',     ready: false },
]

// ── View tabs ──────────────────────────────────────────────────────────────────
const VIEWS = [
  { id: 'side',    label: 'Side'    },
  { id: 'front',   label: 'Front'   },
  { id: 'rear',    label: 'Rear'    },
  { id: 'top',     label: 'Top'     },
  { id: 'quarter', label: '3/4'     },
]

// ── Cd predictor (mock fallback) ──────────────────────────────────────────────
function mockPredict(f) {
  let cd = 0.2788
  cd += (f.Vehicle_Length      - 49.94)  *  0.0008
  cd += (f.Vehicle_Height      - 0.127)  *  0.80
  cd += (f.Backlight_Angle     - 50.18)  *  0.0004
  cd += (f.Vehicle_Ride_Height + 0.179)  *  0.02
  cd += (f.Hood_Angle          - 0.052)  *  0.30
  cd += (f.Windscreen_Angle    - 0.180)  * -0.20
  cd += (f.Greenhouse_Tapering - 0.838)  * -0.15
  cd += (f.Rear_Diffusor_Angle - 0.142)  * -0.12
  cd += (f.Front_Planview      - 0.903)  *  0.10
  return Math.max(0.18, Math.min(0.42, cd))
}

function cdRating(cd) {
  if (cd < 0.24) return { label: 'Exceptional', color: '#30D158' }
  if (cd < 0.27) return { label: 'Excellent',   color: '#40CBE0' }
  if (cd < 0.30) return { label: 'Good',        color: '#0A84FF' }
  if (cd < 0.33) return { label: 'Average',     color: '#FF9F0A' }
  return              { label: 'High drag',    color: '#FF453A' }
}

// ═════════════════════════════════════════════════════════════════════════════
//  PARAMETRIC CAR SVG GEOMETRY
//  All shapes derived directly from the 16 DrivAerML features.
//  Canvas: 540×220 for side/top, 260×220 for front/rear, 480×220 for 3/4
// ═════════════════════════════════════════════════════════════════════════════

function norm(val, min, max) { return (val - min) / (max - min) }

// Map features to a clean set of drawing parameters
function buildDrawParams(f) {
  const lenN   = norm(f.Vehicle_Length,      40,    60)    // 0=short 1=long
  const htN    = norm(f.Vehicle_Height,      0.08,  0.18)  // 0=low 1=tall
  const widN   = norm(f.Vehicle_Width,       0.5,   0.75)  // 0=narrow 1=wide
  const baN    = norm(f.Backlight_Angle,     35,    65)    // 0=shallow 1=steep (fastback→notch)
  const wsN    = norm(f.Windscreen_Angle,    0.08,  0.28)  // 0=upright 1=raked
  const ghN    = norm(f.Greenhouse_Tapering, 0.65,  1.0)   // 0=tapered 1=full
  const ridN   = norm(f.Vehicle_Ride_Height,-0.5,   0.2)   // 0=low 1=high
  const hoodN  = norm(f.Hood_Angle,         -0.05,  0.15)  // 0=flat 1=angled
  const diffN  = norm(f.Rear_Diffusor_Angle, 0.02,  0.26)  // 0=flat 1=steep
  const rearTN = norm(f.Rearend_tapering,   -18,   -2)     // 0=bluff 1=tapered
  const frontPN= norm(f.Front_Planview,      0.75,  1.05)  // 0=narrow 1=wide front
  const deckN  = norm(f.Decklid_Height,     -1.2,   0.2)   // 0=low 1=high deck
  const pitchN = norm(f.Vehicle_Pitch,      -0.01,  0.02)  // nose pitch

  return { lenN, htN, widN, baN, wsN, ghN, ridN, hoodN, diffN, rearTN, frontPN, deckN, pitchN }
}

// ── SIDE VIEW ──────────────────────────────────────────────────────────────────
function SideView({ f }) {
  const { lenN, htN, baN, wsN, ghN, ridN, hoodN, diffN, rearTN, deckN, pitchN } = buildDrawParams(f)

  const W = 540, H = 220
  // Ground line
  const groundY = H - 28
  // Wheel radii & positions
  const wheelR  = 22 + htN * 6
  const rideOff = ridN * 10  // extra ride height moves body up
  const bodyBot  = groundY - wheelR * 0.35 - rideOff  // bottom of body
  const bodyLen  = 320 + lenN * 80
  const bodyX0   = (W - bodyLen) / 2
  const bodyX1   = bodyX0 + bodyLen

  // Heights at key stations
  const bodyH    = 44 + htN * 36   // body slab height
  const roofH    = bodyH + 38 + htN * 22 // total height at cabin peak
  const hoodH    = bodyBot - bodyH   // top of hood/bonnet
  const roofTop  = bodyBot - roofH

  // Longitudinal x-stations (fraction of body length from front)
  const xHoodEnd   = bodyX0 + bodyLen * (0.28 - wsN * 0.04)
  const xAPost     = bodyX0 + bodyLen * (0.32 - wsN * 0.05)
  const xRoofPeak  = bodyX0 + bodyLen * (0.50 - ghN * 0.04)
  const xCPost     = bodyX0 + bodyLen * (0.65 + ghN * 0.04)
  const xDeckStart = bodyX0 + bodyLen * (0.72 + deckN * 0.06)
  const xRearTop   = bodyX0 + bodyLen * (0.88 + rearTN * 0.04)

  // Hood slope: hoodN shifts the hood nose up/down
  const noseY     = hoodH + 8 + (1 - hoodN) * 12
  // Pitch: slight nose up/down
  const pitchOff  = (pitchN - 0.5) * 14

  // Backlight (rear screen) y — how far it drops: baN=1→notchback (less drop), baN=0→fastback (steep)
  const backlightDrop = (1 - baN) * (roofH - bodyH) * 0.85
  const deckY = bodyBot - bodyH - backlightDrop * (1 - deckN * 0.3)

  // Diffuser: raises rear underbody
  const diffH = diffN * 10

  // Windscreen top connects A-post to roof peak
  const wsTopY  = roofTop + (1 - wsN) * 10

  // Wheels
  const wFX = bodyX0 + bodyLen * 0.21
  const wRX = bodyX0 + bodyLen * 0.77

  // Body outline path (clockwise from front-bottom)
  const bodyPath = [
    // front bumper curve
    `M ${bodyX0 + 6} ${bodyBot}`,
    `Q ${bodyX0} ${bodyBot} ${bodyX0 + 2} ${bodyBot - bodyH * 0.7}`,
    // hood line with pitch
    `L ${xHoodEnd} ${noseY + pitchOff}`,
    // windscreen lower → A-post
    `L ${xAPost} ${hoodH - 2 + pitchOff}`,
    // windscreen rake up
    `Q ${xAPost + (xRoofPeak - xAPost) * 0.25} ${wsTopY + (1-wsN)*6} ${xRoofPeak} ${roofTop}`,
    // roof across greenhouse
    `Q ${xRoofPeak + (xCPost - xRoofPeak) * 0.5} ${roofTop - ghN * 4} ${xCPost} ${roofTop + (1-ghN)*8}`,
    // C-post / backlight slope
    `L ${xDeckStart} ${deckY}`,
    // decklid / boot
    `L ${xRearTop} ${bodyBot - bodyH - 2}`,
    // rear face
    `L ${bodyX1 - 4} ${bodyBot - bodyH * (0.5 + rearTN * 0.2)}`,
    `Q ${bodyX1} ${bodyBot} ${bodyX1 - 6} ${bodyBot}`,
    // underside with diffuser
    `L ${bodyX1 - bodyLen * 0.08} ${bodyBot + diffH * 0.5}`,
    `L ${bodyX0 + bodyLen * 0.08} ${bodyBot}`,
    'Z'
  ].join(' ')

  // Glass (side windows)
  const glass1 = [
    `M ${xAPost + 4} ${hoodH + 1 + pitchOff}`,
    `L ${xAPost + (xRoofPeak - xAPost) * 0.3} ${wsTopY + (1-wsN)*5 + 2}`,
    `L ${xRoofPeak} ${roofTop + 2}`,
    `L ${xRoofPeak - (xRoofPeak - xAPost) * 0.15} ${hoodH - 3 + pitchOff}`,
    'Z'
  ].join(' ')

  const glass2 = [
    `M ${xRoofPeak + 2} ${roofTop + 2}`,
    `Q ${xRoofPeak + (xCPost - xRoofPeak) * 0.5} ${roofTop - ghN * 3 + 2} ${xCPost - 2} ${roofTop + (1-ghN)*7 + 2}`,
    `L ${xDeckStart - 4} ${deckY + 4}`,
    `L ${xCPost - (xCPost - xRoofPeak) * 0.3} ${roofTop + (1-ghN)*4 + 10}`,
    `L ${xRoofPeak + 2} ${roofTop + 2}`,
    'Z'
  ].join(' ')

  // Wheel arches (circles cut into body)
  const archR = wheelR + 5

  // Flow lines on hood
  const hoodFlowLines = Array.from({length: 3}, (_, i) => {
    const y = noseY + pitchOff + 6 + i * 5
    return `M ${bodyX0 + 30} ${y} Q ${xHoodEnd * 0.6} ${y - 3} ${xHoodEnd - 10} ${hoodH + pitchOff}`
  })

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: '100%' }}>
      <defs>
        <linearGradient id="bodyGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2a3f48" />
          <stop offset="60%" stopColor="#1a2d35" />
          <stop offset="100%" stopColor="#0f1e24" />
        </linearGradient>
        <linearGradient id="glassGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#4dd8e8" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#0A84FF" stopOpacity="0.08" />
        </linearGradient>
        <filter id="shadow">
          <feDropShadow dx="0" dy="3" stdDeviation="5" floodColor="#000" floodOpacity="0.5"/>
        </filter>
        <marker id="arrowR" markerWidth="5" markerHeight="4" refX="4" refY="2" orient="auto">
          <path d="M0 0 L5 2 L0 4Z" fill="rgba(10,132,255,0.5)"/>
        </marker>
        <marker id="arrowL" markerWidth="5" markerHeight="4" refX="1" refY="2" orient="auto-start-reverse">
          <path d="M0 0 L5 2 L0 4Z" fill="rgba(10,132,255,0.5)"/>
        </marker>
      </defs>

      {/* Grid */}
      <pattern id="sgrid" width="20" height="20" patternUnits="userSpaceOnUse">
        <path d="M20 0L0 0 0 20" fill="none" stroke="rgba(10,132,255,0.04)" strokeWidth="0.5"/>
      </pattern>
      <rect width={W} height={H} fill="url(#sgrid)"/>

      {/* Ground shadow ellipse */}
      <ellipse cx={W/2} cy={groundY + 3} rx={bodyLen/2 + 20} ry={6} fill="rgba(0,0,0,0.35)"/>

      {/* Ground line */}
      <line x1={bodyX0 - 30} y1={groundY} x2={bodyX1 + 30} y2={groundY}
        stroke="rgba(255,255,255,0.08)" strokeWidth="1"/>

      {/* Wheel arches (punch out) */}
      <clipPath id="bodyClip">
        <path d={bodyPath}/>
      </clipPath>

      {/* Body */}
      <path d={bodyPath} fill="url(#bodyGrad)" stroke="#4dd8e8" strokeWidth="1.2" filter="url(#shadow)"/>

      {/* Wheel arch cutouts */}
      <circle cx={wFX} cy={groundY} r={archR}
        fill="#0f1416" stroke="#3a4f56" strokeWidth="1"/>
      <circle cx={wRX} cy={groundY} r={archR}
        fill="#0f1416" stroke="#3a4f56" strokeWidth="1"/>

      {/* Wheels */}
      <circle cx={wFX} cy={groundY} r={wheelR}
        fill="#141c1f" stroke="#3a4f56" strokeWidth="1.5"/>
      <circle cx={wFX} cy={groundY} r={wheelR * 0.62}
        fill="none" stroke="#2a3f48" strokeWidth="1"/>
      <circle cx={wFX} cy={groundY} r={wheelR * 0.18}
        fill="#3a4f56"/>
      {Array.from({length: 5}, (_, i) => {
        const a = (i / 5) * Math.PI * 2
        return <line key={i}
          x1={wFX + Math.cos(a) * wheelR * 0.22} y1={groundY + Math.sin(a) * wheelR * 0.22}
          x2={wFX + Math.cos(a) * wheelR * 0.58} y2={groundY + Math.sin(a) * wheelR * 0.58}
          stroke="#2a3f48" strokeWidth="1.5"/>
      })}

      <circle cx={wRX} cy={groundY} r={wheelR}
        fill="#141c1f" stroke="#3a4f56" strokeWidth="1.5"/>
      <circle cx={wRX} cy={groundY} r={wheelR * 0.62}
        fill="none" stroke="#2a3f48" strokeWidth="1"/>
      <circle cx={wRX} cy={groundY} r={wheelR * 0.18}
        fill="#3a4f56"/>
      {Array.from({length: 5}, (_, i) => {
        const a = (i / 5) * Math.PI * 2
        return <line key={i}
          x1={wRX + Math.cos(a) * wheelR * 0.22} y1={groundY + Math.sin(a) * wheelR * 0.22}
          x2={wRX + Math.cos(a) * wheelR * 0.58} y2={groundY + Math.sin(a) * wheelR * 0.58}
          stroke="#2a3f48" strokeWidth="1.5"/>
      })}

      {/* Glass */}
      <path d={glass1} fill="url(#glassGrad)" stroke="rgba(77,216,232,0.35)" strokeWidth="0.8"/>
      <path d={glass2} fill="url(#glassGrad)" stroke="rgba(77,216,232,0.35)" strokeWidth="0.8"/>

      {/* Hood flow lines */}
      {hoodFlowLines.map((d, i) => (
        <path key={i} d={d} fill="none" stroke="rgba(77,216,232,0.12)" strokeWidth="0.8"/>
      ))}

      {/* Diffuser lines at rear underside */}
      {diffN > 0.15 && Array.from({length: 3}, (_, i) => (
        <line key={i}
          x1={bodyX1 - 10 - i * 5} y1={bodyBot - i * diffH * 0.25}
          x2={bodyX1 - bodyLen * 0.06 - i * 4} y2={bodyBot + 1}
          stroke="rgba(77,216,232,0.2)" strokeWidth="0.8"/>
      ))}

      {/* Body outline again on top for crispness */}
      <path d={bodyPath} fill="none" stroke="rgba(77,216,232,0.6)" strokeWidth="1"/>

      {/* Dimension annotations */}
      <g opacity="0.55">
        {/* Length arrow */}
        <line x1={bodyX0} y1={H - 8} x2={bodyX1} y2={H - 8}
          stroke="rgba(10,132,255,0.5)" strokeWidth="0.8"
          markerStart="url(#arrowL)" markerEnd="url(#arrowR)"/>
        <text x={W/2} y={H - 2} textAnchor="middle"
          fill="rgba(77,216,232,0.6)" fontSize="9"
          fontFamily="'IBM Plex Mono', monospace">
          {(f.Vehicle_Length / 10).toFixed(2)} m
        </text>

        {/* Height arrow */}
        <line x1={bodyX1 + 12} y1={groundY} x2={bodyX1 + 12} y2={roofTop}
          stroke="rgba(10,132,255,0.5)" strokeWidth="0.8"
          markerStart="url(#arrowL)" markerEnd="url(#arrowR)"/>
        <text x={bodyX1 + 22} y={(groundY + roofTop) / 2 + 3} textAnchor="start"
          fill="rgba(77,216,232,0.6)" fontSize="9"
          fontFamily="'IBM Plex Mono', monospace">
          {(f.Vehicle_Height * 10).toFixed(2)} m
        </text>
      </g>

      {/* View label */}
      <text x="10" y="14" fill="rgba(77,216,232,0.4)" fontSize="9" fontWeight="600"
        letterSpacing="0.1em" fontFamily="'IBM Plex Sans', sans-serif">SIDE PROFILE</text>
    </svg>
  )
}

// ── FRONT VIEW ─────────────────────────────────────────────────────────────────
function FrontView({ f }) {
  const { htN, widN, ridN, frontPN, wsN, hoodN } = buildDrawParams(f)

  const W = 280, H = 220
  const cx = W / 2
  const groundY = H - 28
  const wheelR  = 20 + htN * 5
  const bodyW   = 100 + widN * 60 + frontPN * 20  // half-width each side
  const bodyH   = 40 + htN * 30
  const rideOff = ridN * 8
  const bodyBot = groundY - wheelR * 0.3 - rideOff
  const roofH   = bodyH + 35 + htN * 18
  const roofTop = bodyBot - roofH
  const cabW    = bodyW * (0.65 + wsN * 0.08)  // cabin narrower than body

  // Front fascia — curved lower section
  const fasciaPath = [
    `M ${cx - bodyW} ${bodyBot}`,
    `Q ${cx - bodyW - 4} ${bodyBot - bodyH * 0.5} ${cx - bodyW + 8} ${bodyBot - bodyH}`,
    `L ${cx - cabW * 0.9} ${bodyBot - bodyH - 8}`,
    `L ${cx - cabW * 0.7} ${roofTop + 20}`,
    `Q ${cx - cabW * 0.3} ${roofTop + 4} ${cx} ${roofTop}`,
    `Q ${cx + cabW * 0.3} ${roofTop + 4} ${cx + cabW * 0.7} ${roofTop + 20}`,
    `L ${cx + cabW * 0.9} ${bodyBot - bodyH - 8}`,
    `Q ${cx + bodyW - 8} ${bodyBot - bodyH} ${cx + bodyW + 4} ${bodyBot - bodyH * 0.5}`,
    `Q ${cx + bodyW + 4} ${bodyBot} ${cx + bodyW} ${bodyBot}`,
    `L ${cx + bodyW * 0.55} ${bodyBot + 1}`,
    `L ${cx - bodyW * 0.55} ${bodyBot + 1}`,
    'Z'
  ].join(' ')

  // Windscreen
  const windscreenPath = [
    `M ${cx - cabW * 0.85} ${bodyBot - bodyH}`,
    `L ${cx - cabW * 0.65} ${roofTop + 22}`,
    `Q ${cx} ${roofTop + 6} ${cx + cabW * 0.65} ${roofTop + 22}`,
    `L ${cx + cabW * 0.85} ${bodyBot - bodyH}`,
    `Q ${cx} ${bodyBot - bodyH - 14} ${cx - cabW * 0.85} ${bodyBot - bodyH}`,
    'Z'
  ].join(' ')

  // Headlights
  const hlW = bodyW * 0.28
  const hlH = 12 + hoodN * 4
  const hlY = bodyBot - bodyH * 0.72

  // Grille
  const grilleW = bodyW * 0.55
  const grilleY = bodyBot - bodyH * 0.38
  const grilleH = bodyH * 0.28

  // Wheels (front view — circular)
  const wFX_L = cx - bodyW * 0.78
  const wFX_R = cx + bodyW * 0.78

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: '100%' }}>
      <defs>
        <linearGradient id="fbodyGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#263840"/>
          <stop offset="100%" stopColor="#0f1e24"/>
        </linearGradient>
        <linearGradient id="fglassGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#4dd8e8" stopOpacity="0.2"/>
          <stop offset="100%" stopColor="#0A84FF" stopOpacity="0.06"/>
        </linearGradient>
        <radialGradient id="hlGrad" cx="50%" cy="40%">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.9"/>
          <stop offset="60%" stopColor="#4dd8e8" stopOpacity="0.6"/>
          <stop offset="100%" stopColor="#0A84FF" stopOpacity="0.1"/>
        </radialGradient>
        <filter id="fshadow">
          <feDropShadow dx="0" dy="4" stdDeviation="6" floodColor="#000" floodOpacity="0.5"/>
        </filter>
      </defs>

      <pattern id="fgrid" width="20" height="20" patternUnits="userSpaceOnUse">
        <path d="M20 0L0 0 0 20" fill="none" stroke="rgba(10,132,255,0.04)" strokeWidth="0.5"/>
      </pattern>
      <rect width={W} height={H} fill="url(#fgrid)"/>

      {/* Ground */}
      <ellipse cx={cx} cy={groundY + 2} rx={bodyW + 25} ry={5} fill="rgba(0,0,0,0.3)"/>
      <line x1={cx - bodyW - 40} y1={groundY} x2={cx + bodyW + 40} y2={groundY}
        stroke="rgba(255,255,255,0.07)" strokeWidth="1"/>

      {/* Wheel arches */}
      <circle cx={wFX_L} cy={groundY} r={wheelR + 5}
        fill="#0d1a1f" stroke="#2a3f48" strokeWidth="1"/>
      <circle cx={wFX_R} cy={groundY} r={wheelR + 5}
        fill="#0d1a1f" stroke="#2a3f48" strokeWidth="1"/>

      {/* Body */}
      <path d={fasciaPath} fill="url(#fbodyGrad)" stroke="rgba(77,216,232,0.55)" strokeWidth="1.1" filter="url(#fshadow)"/>

      {/* Windscreen */}
      <path d={windscreenPath} fill="url(#fglassGrad)" stroke="rgba(77,216,232,0.3)" strokeWidth="0.8"/>

      {/* Headlights */}
      {[-1, 1].map(side => (
        <g key={side}>
          <ellipse cx={cx + side * (bodyW * 0.62)}
            cy={hlY} rx={hlW} ry={hlH}
            fill="url(#hlGrad)" stroke="rgba(77,216,232,0.7)" strokeWidth="0.8"/>
          {/* DRL line */}
          <line
            x1={cx + side * (bodyW * 0.38)} y1={hlY + hlH * 0.2}
            x2={cx + side * (bodyW * 0.82)} y2={hlY + hlH * 0.2}
            stroke="rgba(255,255,255,0.6)" strokeWidth="1.2"/>
        </g>
      ))}

      {/* Grille */}
      <rect x={cx - grilleW} y={grilleY} width={grilleW * 2} height={grilleH}
        rx="4" fill="rgba(0,0,0,0.5)" stroke="rgba(77,216,232,0.25)" strokeWidth="0.8"/>
      {Array.from({length: 5}, (_, i) => (
        <line key={i}
          x1={cx - grilleW + i * (grilleW * 2 / 4)} y1={grilleY + 2}
          x2={cx - grilleW + i * (grilleW * 2 / 4)} y2={grilleY + grilleH - 2}
          stroke="rgba(77,216,232,0.15)" strokeWidth="0.7"/>
      ))}

      {/* Front bumper lower lip */}
      <path d={`M ${cx - bodyW * 0.7} ${bodyBot - 3} Q ${cx} ${bodyBot + 4} ${cx + bodyW * 0.7} ${bodyBot - 3}`}
        fill="none" stroke="rgba(77,216,232,0.3)" strokeWidth="1"/>

      {/* Wheels */}
      {[wFX_L, wFX_R].map((wx, i) => (
        <g key={i}>
          <circle cx={wx} cy={groundY} r={wheelR}
            fill="#141c1f" stroke="#3a4f56" strokeWidth="1.5"/>
          <circle cx={wx} cy={groundY} r={wheelR * 0.62}
            fill="none" stroke="#2a3f48" strokeWidth="1"/>
          <circle cx={wx} cy={groundY} r={wheelR * 0.18} fill="#3a4f56"/>
          {Array.from({length: 5}, (_, k) => {
            const a = (k / 5) * Math.PI * 2
            return <line key={k}
              x1={wx + Math.cos(a) * wheelR * 0.22} y1={groundY + Math.sin(a) * wheelR * 0.22}
              x2={wx + Math.cos(a) * wheelR * 0.58} y2={groundY + Math.sin(a) * wheelR * 0.58}
              stroke="#2a3f48" strokeWidth="1.5"/>
          })}
        </g>
      ))}

      {/* Width annotation */}
      <g opacity="0.5">
        <line x1={cx - bodyW} y1={H - 8} x2={cx + bodyW} y2={H - 8}
          stroke="rgba(10,132,255,0.5)" strokeWidth="0.8"/>
        <text x={cx} y={H - 2} textAnchor="middle"
          fill="rgba(77,216,232,0.6)" fontSize="9"
          fontFamily="'IBM Plex Mono', monospace">
          {(f.Vehicle_Width * 3).toFixed(2)} m
        </text>
      </g>

      <text x="10" y="14" fill="rgba(77,216,232,0.4)" fontSize="9" fontWeight="600"
        letterSpacing="0.1em" fontFamily="'IBM Plex Sans', sans-serif">FRONT</text>
    </svg>
  )
}

// ── REAR VIEW ──────────────────────────────────────────────────────────────────
function RearView({ f }) {
  const { htN, widN, ridN, wsN, baN, deckN, diffN, rearTN } = buildDrawParams(f)

  const W = 280, H = 220
  const cx = W / 2
  const groundY = H - 28
  const wheelR  = 20 + htN * 5
  const bodyW   = 98 + widN * 58
  const bodyH   = 40 + htN * 30
  const rideOff = ridN * 8
  const bodyBot = groundY - wheelR * 0.3 - rideOff
  const cabW    = bodyW * (0.62 + wsN * 0.06)
  const roofH   = bodyH + 35 + htN * 18
  const roofTop = bodyBot - roofH

  // Backlight angle affects how wide the rear screen is
  const deckTopY  = bodyBot - bodyH - (1 - baN) * (roofH - bodyH) * 0.75
  const deckTopW  = cabW * (0.55 + baN * 0.2)

  // Diffuser visible at rear bottom
  const diffH = diffN * 14

  const rearBodyPath = [
    `M ${cx - bodyW} ${bodyBot}`,
    `Q ${cx - bodyW - 3} ${bodyBot - bodyH * 0.4} ${cx - bodyW + 6} ${bodyBot - bodyH}`,
    `L ${cx - cabW * 0.88} ${bodyBot - bodyH - 6}`,
    `L ${cx - deckTopW} ${deckTopY}`,
    `Q ${cx} ${deckTopY - 4} ${cx + deckTopW} ${deckTopY}`,
    `L ${cx + cabW * 0.88} ${bodyBot - bodyH - 6}`,
    `Q ${cx + bodyW - 6} ${bodyBot - bodyH} ${cx + bodyW + 3} ${bodyBot - bodyH * 0.4}`,
    `Q ${cx + bodyW + 3} ${bodyBot} ${cx + bodyW} ${bodyBot}`,
    `L ${cx + bodyW * 0.5} ${bodyBot + diffH * 0.4}`,
    `L ${cx - bodyW * 0.5} ${bodyBot + diffH * 0.4}`,
    'Z'
  ].join(' ')

  // Rear screen
  const rearScreenPath = [
    `M ${cx - deckTopW * 0.9} ${deckTopY + 4}`,
    `Q ${cx} ${deckTopY} ${cx + deckTopW * 0.9} ${deckTopY + 4}`,
    `L ${cx + cabW * 0.82} ${bodyBot - bodyH - 4}`,
    `Q ${cx} ${bodyBot - bodyH + 6} ${cx - cabW * 0.82} ${bodyBot - bodyH - 4}`,
    'Z'
  ].join(' ')

  // Tail lights
  const tlW  = bodyW * 0.26
  const tlH  = 10 + (1 - baN) * 5
  const tlY  = bodyBot - bodyH * 0.7

  // Diffuser vanes
  const wRX_L = cx - bodyW * 0.75
  const wRX_R = cx + bodyW * 0.75

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: '100%' }}>
      <defs>
        <linearGradient id="rbodyGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#253840"/>
          <stop offset="100%" stopColor="#0f1e24"/>
        </linearGradient>
        <radialGradient id="tlGrad" cx="50%" cy="50%">
          <stop offset="0%" stopColor="#FF453A" stopOpacity="0.9"/>
          <stop offset="100%" stopColor="#FF453A" stopOpacity="0.15"/>
        </radialGradient>
        <filter id="rshadow">
          <feDropShadow dx="0" dy="4" stdDeviation="6" floodColor="#000" floodOpacity="0.5"/>
        </filter>
        <linearGradient id="rglassGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#4dd8e8" stopOpacity="0.18"/>
          <stop offset="100%" stopColor="#0A84FF" stopOpacity="0.06"/>
        </linearGradient>
      </defs>

      <pattern id="rgrid" width="20" height="20" patternUnits="userSpaceOnUse">
        <path d="M20 0L0 0 0 20" fill="none" stroke="rgba(10,132,255,0.04)" strokeWidth="0.5"/>
      </pattern>
      <rect width={W} height={H} fill="url(#rgrid)"/>

      <ellipse cx={cx} cy={groundY + 2} rx={bodyW + 25} ry={5} fill="rgba(0,0,0,0.3)"/>
      <line x1={cx - bodyW - 40} y1={groundY} x2={cx + bodyW + 40} y2={groundY}
        stroke="rgba(255,255,255,0.07)" strokeWidth="1"/>

      {/* Wheel arches */}
      <circle cx={wRX_L} cy={groundY} r={wheelR + 5} fill="#0d1a1f" stroke="#2a3f48" strokeWidth="1"/>
      <circle cx={wRX_R} cy={groundY} r={wheelR + 5} fill="#0d1a1f" stroke="#2a3f48" strokeWidth="1"/>

      {/* Body */}
      <path d={rearBodyPath} fill="url(#rbodyGrad)" stroke="rgba(77,216,232,0.5)" strokeWidth="1.1" filter="url(#rshadow)"/>

      {/* Rear screen */}
      <path d={rearScreenPath} fill="url(#rglassGrad)" stroke="rgba(77,216,232,0.3)" strokeWidth="0.8"/>

      {/* Tail lights */}
      {[-1, 1].map(side => (
        <g key={side}>
          <ellipse cx={cx + side * (bodyW * 0.62)}
            cy={tlY} rx={tlW} ry={tlH}
            fill="url(#tlGrad)" stroke="rgba(255,69,58,0.6)" strokeWidth="0.8"/>
          <line
            x1={cx + side * (bodyW * 0.38)} y1={tlY}
            x2={cx + side * (bodyW * 0.84)} y2={tlY}
            stroke="rgba(255,69,58,0.5)" strokeWidth="1"/>
        </g>
      ))}

      {/* Number plate area */}
      <rect x={cx - 28} y={bodyBot - bodyH * 0.3} width={56} height={14}
        rx="2" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.12)" strokeWidth="0.7"/>

      {/* Diffuser */}
      {diffN > 0.1 && (
        <g>
          <rect x={cx - bodyW * 0.5} y={bodyBot - 2} width={bodyW} height={diffH * 0.7}
            rx="2" fill="rgba(77,216,232,0.06)" stroke="rgba(77,216,232,0.2)" strokeWidth="0.7"/>
          {Array.from({length: 5}, (_, i) => (
            <line key={i}
              x1={cx - bodyW * 0.45 + i * (bodyW * 0.9 / 4)} y1={bodyBot - 1}
              x2={cx - bodyW * 0.45 + i * (bodyW * 0.9 / 4)} y2={bodyBot + diffH * 0.65}
              stroke="rgba(77,216,232,0.18)" strokeWidth="0.8"/>
          ))}
        </g>
      )}

      {/* Exhaust tips */}
      {[cx - bodyW * 0.3, cx + bodyW * 0.3].map((ex, i) => (
        <ellipse key={i} cx={ex} cy={bodyBot - 4} rx={5} ry={3.5}
          fill="#0a0f12" stroke="rgba(255,159,10,0.4)" strokeWidth="0.8"/>
      ))}

      {/* Wheels */}
      {[wRX_L, wRX_R].map((wx, i) => (
        <g key={i}>
          <circle cx={wx} cy={groundY} r={wheelR}
            fill="#141c1f" stroke="#3a4f56" strokeWidth="1.5"/>
          <circle cx={wx} cy={groundY} r={wheelR * 0.62}
            fill="none" stroke="#2a3f48" strokeWidth="1"/>
          <circle cx={wx} cy={groundY} r={wheelR * 0.18} fill="#3a4f56"/>
          {Array.from({length: 5}, (_, k) => {
            const a = (k / 5) * Math.PI * 2
            return <line key={k}
              x1={wx + Math.cos(a) * wheelR * 0.22} y1={groundY + Math.sin(a) * wheelR * 0.22}
              x2={wx + Math.cos(a) * wheelR * 0.58} y2={groundY + Math.sin(a) * wheelR * 0.58}
              stroke="#2a3f48" strokeWidth="1.5"/>
          })}
        </g>
      ))}

      <text x="10" y="14" fill="rgba(77,216,232,0.4)" fontSize="9" fontWeight="600"
        letterSpacing="0.1em" fontFamily="'IBM Plex Sans', sans-serif">REAR</text>
    </svg>
  )
}

// ── TOP VIEW (PLAN) ────────────────────────────────────────────────────────────
function TopView({ f }) {
  const { lenN, widN, frontPN, ghN, rearTN } = buildDrawParams(f)

  const W = 540, H = 200
  const cx = W / 2, cy = H / 2
  const bodyLen = 300 + lenN * 80
  const bodyW   = 80 + widN * 40
  const x0 = cx - bodyLen / 2
  const x1 = cx + bodyLen / 2

  // Width variation along body (plan shape)
  const frontW  = bodyW * (0.72 + frontPN * 0.16)   // front track / fascia width
  const midW    = bodyW                               // widest at doors
  const cabW    = bodyW * (0.75 + ghN * 0.12)        // cabin at greenhouse
  const rearW   = bodyW * (0.68 + (1-rearTN) * 0.1) // rear narrowing

  // Key x-stations
  const xFront   = x0 + bodyLen * 0.08
  const xFHood   = x0 + bodyLen * 0.24
  const xMid     = cx
  const xRoof    = cx + bodyLen * 0.08
  const xRearEnd = x1 - bodyLen * 0.06
  const xTail    = x1

  const planPath = [
    // Left side (front to rear)
    `M ${xFront} ${cy - frontW * 0.85}`,
    `Q ${x0 + 8} ${cy - frontW} ${x0} ${cy}`,            // front taper
    `Q ${x0 + 8} ${cy + frontW} ${xFront} ${cy + frontW * 0.85}`,
    `Q ${xFHood} ${cy + midW} ${xMid} ${cy + midW}`,     // door bulge
    `Q ${xRoof} ${cy + cabW} ${xRearEnd} ${cy + rearW}`, // rear taper
    `Q ${xTail - 8} ${cy + rearW * 0.6} ${xTail} ${cy}`,
    `Q ${xTail - 8} ${cy - rearW * 0.6} ${xRearEnd} ${cy - rearW}`,
    `Q ${xRoof} ${cy - cabW} ${xMid} ${cy - midW}`,
    `Q ${xFHood} ${cy - midW} ${xFront} ${cy - frontW * 0.85}`,
    'Z'
  ].join(' ')

  // Windscreen strip
  const wsXL = x0 + bodyLen * 0.3
  const wsXR = x0 + bodyLen * 0.42
  const wsW  = cabW * 0.85

  // Rear window strip
  const rwXL = x0 + bodyLen * 0.66
  const rwXR = x0 + bodyLen * 0.78

  // Roof panel
  const roofX0 = wsXR
  const roofX1 = rwXL
  const roofW  = cabW * 0.78

  // Wheels (ellipses from top)
  const wFront = x0 + bodyLen * 0.2
  const wRear  = x0 + bodyLen * 0.78
  const wOff   = midW * 0.88

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: '100%' }}>
      <defs>
        <linearGradient id="tbodyGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1e3040"/>
          <stop offset="50%" stopColor="#1a2a35"/>
          <stop offset="100%" stopColor="#1e3040"/>
        </linearGradient>
        <linearGradient id="tglassGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#4dd8e8" stopOpacity="0.18"/>
          <stop offset="100%" stopColor="#0A84FF" stopOpacity="0.08"/>
        </linearGradient>
        <filter id="tshadow">
          <feDropShadow dx="0" dy="0" stdDeviation="8" floodColor="#000" floodOpacity="0.6"/>
        </filter>
      </defs>

      <pattern id="tgrid" width="20" height="20" patternUnits="userSpaceOnUse">
        <path d="M20 0L0 0 0 20" fill="none" stroke="rgba(10,132,255,0.04)" strokeWidth="0.5"/>
      </pattern>
      <rect width={W} height={H} fill="url(#tgrid)"/>

      {/* Body plan */}
      <path d={planPath} fill="url(#tbodyGrad)" stroke="rgba(77,216,232,0.55)" strokeWidth="1.2" filter="url(#tshadow)"/>

      {/* Windscreen */}
      <path d={`M ${wsXL} ${cy - wsW * 0.7} Q ${(wsXL + wsXR)/2} ${cy - wsW * 0.85} ${wsXR} ${cy - wsW * 0.72}
                L ${wsXR} ${cy + wsW * 0.72} Q ${(wsXL + wsXR)/2} ${cy + wsW * 0.85} ${wsXL} ${cy + wsW * 0.7} Z`}
        fill="url(#tglassGrad)" stroke="rgba(77,216,232,0.3)" strokeWidth="0.8"/>

      {/* Roof panel */}
      <rect x={roofX0} y={cy - roofW * 0.5} width={roofX1 - roofX0} height={roofW}
        rx="4" fill="rgba(30,45,55,0.7)" stroke="rgba(77,216,232,0.15)" strokeWidth="0.7"/>

      {/* Rear window */}
      <path d={`M ${rwXL} ${cy - wsW * 0.65} Q ${(rwXL + rwXR)/2} ${cy - wsW * 0.76} ${rwXR} ${cy - wsW * 0.62}
                L ${rwXR} ${cy + wsW * 0.62} Q ${(rwXL + rwXR)/2} ${cy + wsW * 0.76} ${rwXL} ${cy + wsW * 0.65} Z`}
        fill="url(#tglassGrad)" stroke="rgba(77,216,232,0.25)" strokeWidth="0.8"/>

      {/* Door seam lines */}
      {[0.42, 0.62].map((frac, i) => {
        const sx = x0 + bodyLen * frac
        const sW = i === 0 ? midW : cabW
        return <line key={i} x1={sx} y1={cy - sW * 0.94} x2={sx} y2={cy + sW * 0.94}
          stroke="rgba(77,216,232,0.12)" strokeWidth="0.8" strokeDasharray="3,3"/>
      })}

      {/* Wheels (top view ellipses) */}
      {[[wFront, cy - wOff], [wFront, cy + wOff], [wRear, cy - wOff], [wRear, cy + wOff]].map(([wx, wy], i) => (
        <g key={i}>
          <ellipse cx={wx} cy={wy} rx={14} ry={26}
            fill="#141c1f" stroke="#3a4f56" strokeWidth="1.2"/>
          <ellipse cx={wx} cy={wy} rx={8} ry={16}
            fill="none" stroke="#2a3f48" strokeWidth="0.8"/>
        </g>
      ))}

      {/* Centerline */}
      <line x1={x0 - 10} y1={cy} x2={x1 + 10} y2={cy}
        stroke="rgba(10,132,255,0.2)" strokeWidth="0.6" strokeDasharray="6,4"/>

      {/* Width annotation */}
      <g opacity="0.5">
        <line x1={cx} y1={cy - midW - 10} x2={cx} y2={cy - midW - 10}/>
        <line x1={x0} y1={H - 8} x2={x1} y2={H - 8}
          stroke="rgba(10,132,255,0.4)" strokeWidth="0.7"/>
        <text x={cx} y={H - 2} textAnchor="middle"
          fill="rgba(77,216,232,0.5)" fontSize="9"
          fontFamily="'IBM Plex Mono', monospace">
          {(f.Vehicle_Length / 10).toFixed(2)} m
        </text>
      </g>

      <text x="10" y="14" fill="rgba(77,216,232,0.4)" fontSize="9" fontWeight="600"
        letterSpacing="0.1em" fontFamily="'IBM Plex Sans', sans-serif">TOP — PLAN VIEW</text>
    </svg>
  )
}

// ── 3/4 FRONT VIEW ────────────────────────────────────────────────────────────
function QuarterView({ f }) {
  const { lenN, htN, widN, baN, wsN, ghN, ridN, hoodN, diffN } = buildDrawParams(f)

  const W = 480, H = 220
  const groundY = H - 28

  // Perspective projection helper — simple oblique
  const px = (x, y, z) => {
    // x=length(0=front,1=rear), y=height(0=ground), z=width(0=right side,1=left)
    const oblX = 0.32, oblY = 0.22  // oblique angles
    return {
      sx: 60 + x * 280 + z * 110 + oblX * y * 60,
      sy: groundY - y * (60 + htN * 32) - z * oblY * 40 - ridN * 8
    }
  }

  // Key geometry
  const wheelR = 21 + htN * 5
  const bodyH  = 44 + htN * 34   // body slab (belt line to ground)
  const totalH = bodyH + 38 + htN * 20  // to roof
  const roofH  = totalH / (60 + htN * 32)  // normalised

  const hoodEndZ = 0.3 + wsN * 0.1
  const cabStartZ = 0.35
  const cabEndZ  = 0.65 + ghN * 0.08
  const bootH    = (1 - baN) * 0.65

  // Outline — 8 key points of a simplified car box in 3D → projected
  const pts = {
    // Front face
    fbl:  px(0,   0,       0),   // front bottom left (near)
    ftl:  px(0,   0.68,    0),   // front top left (near)
    ftr:  px(0,   0.68,    0.8), // front top right (far)
    fbr:  px(0,   0,       0.8), // front bottom right (far)
    // Rear face
    rbl:  px(1,   0,       0),
    rtl:  px(1,   bootH,   0),
    rtr:  px(1,   bootH,   0.8),
    rbr:  px(1,   0,       0.8),
    // Roof (cabin)
    rflt: px(0.3, roofH,   0.08),
    rfrt: px(0.3, roofH,   0.72),
    rrlt: px(0.75,roofH - (1-baN)*0.28, 0.08),
    rrrt: px(0.75,roofH - (1-baN)*0.28, 0.72),
    // Hood connection
    hfl:  px(0.28,0.66 + hoodN * 0.08, 0.05),
    hfr:  px(0.28,0.66 + hoodN * 0.08, 0.75),
  }

  const P = (key) => `${pts[key].sx},${pts[key].sy}`

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: '100%' }}>
      <defs>
        <linearGradient id="qbodyL" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#253a44"/>
          <stop offset="100%" stopColor="#0f1e26"/>
        </linearGradient>
        <linearGradient id="qbodyT" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1d3440"/>
          <stop offset="100%" stopColor="#162830"/>
        </linearGradient>
        <linearGradient id="qglassG" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#4dd8e8" stopOpacity="0.22"/>
          <stop offset="100%" stopColor="#0A84FF" stopOpacity="0.06"/>
        </linearGradient>
        <filter id="qshadow">
          <feDropShadow dx="2" dy="4" stdDeviation="7" floodColor="#000" floodOpacity="0.5"/>
        </filter>
      </defs>

      <pattern id="qgrid" width="20" height="20" patternUnits="userSpaceOnUse">
        <path d="M20 0L0 0 0 20" fill="none" stroke="rgba(10,132,255,0.04)" strokeWidth="0.5"/>
      </pattern>
      <rect width={W} height={H} fill="url(#qgrid)"/>

      {/* Ground shadow */}
      <ellipse cx={200} cy={groundY + 3} rx={170} ry={7} fill="rgba(0,0,0,0.4)"/>
      <line x1={20} y1={groundY} x2={W - 20} y2={groundY}
        stroke="rgba(255,255,255,0.06)" strokeWidth="1"/>

      {/* Side face (nearest) */}
      <polygon
        points={`${P('fbl')} ${P('ftl')} ${P('hfl')} ${P('rflt')} ${P('rrlt')} ${P('rtl')} ${P('rbl')}`}
        fill="url(#qbodyL)" stroke="rgba(77,216,232,0.5)" strokeWidth="1" filter="url(#qshadow)"/>

      {/* Top/hood face */}
      <polygon
        points={`${P('hfl')} ${P('hfr')} ${P('rfrt')} ${P('rflt')}`}
        fill="url(#qbodyT)" stroke="rgba(77,216,232,0.3)" strokeWidth="0.8"/>

      {/* Roof panel */}
      <polygon
        points={`${P('rflt')} ${P('rfrt')} ${P('rrrt')} ${P('rrlt')}`}
        fill="url(#qbodyT)" stroke="rgba(77,216,232,0.25)" strokeWidth="0.8"/>

      {/* Far side face (darker) */}
      <polygon
        points={`${P('fbr')} ${P('ftr')} ${P('hfr')} ${P('rfrt')} ${P('rrrt')} ${P('rtr')} ${P('rbr')}`}
        fill="rgba(12,22,28,0.85)" stroke="rgba(77,216,232,0.2)" strokeWidth="0.7"/>

      {/* Windscreen glass */}
      <polygon
        points={`${P('hfl')} ${P('hfr')} ${P('rfrt')} ${P('rflt')}`}
        fill="url(#qglassG)" stroke="rgba(77,216,232,0.35)" strokeWidth="0.8"/>

      {/* Front face */}
      <polygon
        points={`${P('fbl')} ${P('ftl')} ${P('ftr')} ${P('fbr')}`}
        fill="rgba(15,25,32,0.9)" stroke="rgba(77,216,232,0.35)" strokeWidth="0.8"/>

      {/* Headlight on front (near side) */}
      <ellipse
        cx={pts.ftl.sx + 12} cy={pts.ftl.sy + (pts.fbl.sy - pts.ftl.sy) * 0.4}
        rx={14} ry={7}
        fill="rgba(255,255,255,0.12)" stroke="rgba(77,216,232,0.6)" strokeWidth="0.8"/>

      {/* Wheels */}
      {[
        { x: pts.fbl.sx + 26, y: groundY },
        { x: pts.rbl.sx + 22, y: groundY },
      ].map(({ x, y }, i) => (
        <g key={i}>
          <circle cx={x} cy={y} r={wheelR} fill="#141c1f" stroke="#3a4f56" strokeWidth="1.5"/>
          <circle cx={x} cy={y} r={wheelR * 0.62} fill="none" stroke="#2a3f48" strokeWidth="1"/>
          <circle cx={x} cy={y} r={wheelR * 0.18} fill="#3a4f56"/>
          {Array.from({length: 5}, (_, k) => {
            const a = (k / 5) * Math.PI * 2
            return <line key={k}
              x1={x + Math.cos(a) * wheelR * 0.22} y1={y + Math.sin(a) * wheelR * 0.22}
              x2={x + Math.cos(a) * wheelR * 0.58} y2={y + Math.sin(a) * wheelR * 0.58}
              stroke="#2a3f48" strokeWidth="1.5"/>
          })}
        </g>
      ))}

      <text x="10" y="14" fill="rgba(77,216,232,0.4)" fontSize="9" fontWeight="600"
        letterSpacing="0.1em" fontFamily="'IBM Plex Sans', sans-serif">3/4 FRONT</text>
    </svg>
  )
}

// ── VIEW SELECTOR & CANVAS ─────────────────────────────────────────────────────
function CarViewer2D({ features, activeView }) {
  const viewMap = {
    side:    <SideView    f={features} />,
    front:   <FrontView   f={features} />,
    rear:    <RearView    f={features} />,
    top:     <TopView     f={features} />,
    quarter: <QuarterView f={features} />,
  }
  return (
    <div style={{
      width: '100%', height: '100%',
      background: '#030608',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      position: 'relative',
    }}>
      {/* Grid background */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        backgroundImage: 'linear-gradient(rgba(10,132,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(10,132,255,0.035) 1px, transparent 1px)',
        backgroundSize: '28px 28px',
      }}/>
      <div style={{ width: '92%', height: '85%', position: 'relative', zIndex: 1 }}>
        {viewMap[activeView] ?? viewMap.side}
      </div>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
//  MAIN PAGE
// ═════════════════════════════════════════════════════════════════════════════
export default function Views2DPage({ activeModel, onModelChange }) {
  const [features,    setFeatures]    = useState({ ...DEFAULTS })
  const [result,      setResult]      = useState(null)
  const [loading,     setLoading]     = useState(false)
  const [activeView,  setActiveView]  = useState('side')

  const updateFeature = useCallback((key, val) => {
    setFeatures(f => ({ ...f, [key]: val }))
  }, [])

  // Live Cd preview (instant mock, no button needed)
  const liveCd    = useMemo(() => mockPredict(features), [features])
  const liveRating = cdRating(liveCd)

  const runPrediction = async () => {
    setLoading(true)
    try {
      const body = new FormData()
      body.append('features',     JSON.stringify(features))
      body.append('active_model', activeModel)
      const res = await fetch(`${BACKEND}/surrogate/predict`, { method: 'POST', body })
      if (res.ok) {
        const data = await res.json()
        setResult({ ...data, _source: 'backend' })
      } else throw new Error('backend')
    } catch {
      await new Promise(r => setTimeout(r, 260))
      const cd = mockPredict(features)
      const z  = (cd - 0.2788) / 0.0302
      const pct = Math.min(99, Math.max(1, Math.round(50 * (1 + z * 0.399))))
      setResult({
        Cd: parseFloat(cd.toFixed(4)),
        Cd_ensemble: parseFloat((cd + (Math.random() - 0.5) * 0.004).toFixed(4)),
        uncertainty: parseFloat((cd * 0.045).toFixed(5)),
        confidence_pct: Math.round(80 + Math.random() * 14),
        cd_rating: cdRating(cd).label,
        cd_percentile: pct,
        active_model: activeModel,
        inferenceMs: Math.round(50 + Math.random() * 60),
        _source: 'mock',
      })
    } finally {
      setLoading(false)
    }
  }

  const displayCd     = result?.Cd ?? liveCd
  const displayRating = cdRating(displayCd)

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

      {/* ── Left: sliders ────────────────────────────────────────────────── */}
      <div style={{
        width: 280, flexShrink: 0,
        borderRight: '0.5px solid rgba(84,84,88,0.55)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{ padding: '12px 16px 10px', borderBottom: '0.5px solid rgba(84,84,88,0.55)' }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: 'rgba(235,235,245,0.3)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 2 }}>
            Geometric Parameters
          </div>
          <div style={{ fontSize: 11, color: 'rgba(235,235,245,0.25)' }}>
            16 features · DrivAerML notchback
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 14px 14px' }}>
          {FEATURE_DEFS.map((fd, i) => (
            <FeatureSlider
              key={fd.key} def={fd}
              value={features[fd.key] ?? fd.min}
              onChange={v => updateFeature(fd.key, v)}
              last={i === FEATURE_DEFS.length - 1}
            />
          ))}
        </div>

        <div style={{ padding: '10px 14px', borderTop: '0.5px solid rgba(84,84,88,0.55)' }}>
          <button
            onClick={runPrediction} disabled={loading}
            style={{
              width: '100%', height: 38, borderRadius: 10, border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
              background: loading ? 'rgba(10,132,255,0.2)' : '#0A84FF',
              color: '#fff', fontSize: 13, fontWeight: 600, letterSpacing: '-0.2px',
              fontFamily: "'IBM Plex Sans', sans-serif",
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              transition: 'opacity 0.15s',
              opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? (
              <>
                <svg style={{ animation: 'spin 0.9s linear infinite' }} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2.5">
                  <path d="M12 3a9 9 0 019 9" />
                </svg>
                Predicting…
              </>
            ) : (
              <>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polygon points="5 3 19 12 5 21 5 3"/>
                </svg>
                Predict Cd
              </>
            )}
          </button>
        </div>
      </div>

      {/* ── Center: 2D viewer ─────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

        {/* View tabs */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 2,
          padding: '6px 12px',
          borderBottom: '0.5px solid rgba(84,84,88,0.55)',
          background: 'rgba(0,0,0,0.4)',
          flexShrink: 0,
        }}>
          {VIEWS.map(v => (
            <button
              key={v.id}
              onClick={() => setActiveView(v.id)}
              style={{
                padding: '4px 14px', borderRadius: 7, border: 'none', cursor: 'pointer',
                background: activeView === v.id ? 'rgba(10,132,255,0.2)' : 'transparent',
                color: activeView === v.id ? '#0A84FF' : 'rgba(235,235,245,0.4)',
                fontSize: 12, fontWeight: 600, letterSpacing: '0.01em',
                fontFamily: "'IBM Plex Sans', sans-serif",
                transition: 'background 0.12s, color 0.12s',
              }}
            >
              {v.label}
            </button>
          ))}

          {/* Live Cd badge */}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '3px 12px', borderRadius: 20,
              background: `${displayRating.color}18`,
              border: `0.5px solid ${displayRating.color}44`,
            }}>
              <span style={{ fontSize: 10, color: 'rgba(235,235,245,0.4)', fontFamily: "'IBM Plex Mono',monospace" }}>Cd</span>
              <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.5px', color: displayRating.color, fontFamily: "'IBM Plex Mono',monospace" }}>
                {displayCd.toFixed(3)}
              </span>
              <span style={{ fontSize: 10, color: displayRating.color }}>{displayRating.label}</span>
            </div>
            {result && (
              <span style={{ fontSize: 10, color: result._source === 'backend' ? '#30D158' : '#FF9F0A', fontFamily: "'IBM Plex Mono',monospace" }}>
                {result._source}
              </span>
            )}
          </div>
        </div>

        {/* SVG canvas */}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <CarViewer2D features={features} activeView={activeView} />
        </div>
      </div>

      {/* ── Right: results panel ──────────────────────────────────────────── */}
      <div style={{
        width: 240, flexShrink: 0,
        borderLeft: '0.5px solid rgba(84,84,88,0.55)',
        display: 'flex', flexDirection: 'column', overflowY: 'auto',
        padding: '16px 14px',
        background: '#000',
      }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: 'rgba(235,235,245,0.28)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 12 }}>
          Model
        </div>

        {/* Model chips */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20 }}>
          {MODELS.map(m => (
            <button
              key={m.id}
              onClick={() => m.ready && onModelChange(m.id)}
              style={{
                padding: '7px 12px', borderRadius: 9, border: '0.5px solid',
                borderColor: activeModel === m.id ? 'rgba(10,132,255,0.45)' : 'rgba(84,84,88,0.4)',
                background: activeModel === m.id ? 'rgba(10,132,255,0.14)' : 'transparent',
                color: activeModel === m.id ? '#0A84FF' : 'rgba(235,235,245,0.4)',
                fontSize: 12, fontWeight: 500, cursor: m.ready ? 'pointer' : 'not-allowed',
                opacity: m.ready ? 1 : 0.35,
                fontFamily: "'IBM Plex Sans', sans-serif",
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                transition: 'all 0.12s',
              }}
            >
              <span>{m.label}</span>
              <span style={{ fontSize: 10, opacity: 0.7, fontFamily: "'IBM Plex Mono',monospace" }}>R²={m.r2}</span>
            </button>
          ))}
        </div>

        <div style={{ fontSize: 10, fontWeight: 600, color: 'rgba(235,235,245,0.28)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 12 }}>
          Prediction
        </div>

        {/* Primary Cd */}
        <div style={{
          background: '#1C1C1E', borderRadius: 12, padding: '16px',
          marginBottom: 10, position: 'relative', overflow: 'hidden',
          border: '0.5px solid rgba(255,255,255,0.06)',
        }}>
          <div style={{ fontSize: 10, color: 'rgba(235,235,245,0.3)', marginBottom: 6, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Drag Coeff.
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
            <span style={{ fontSize: 38, fontWeight: 700, letterSpacing: '-2px', color: displayRating.color, lineHeight: 1, fontFamily: "'IBM Plex Mono',monospace" }}>
              {displayCd.toFixed(3)}
            </span>
          </div>
          <div style={{ fontSize: 12, color: displayRating.color, marginTop: 4, fontWeight: 500 }}>
            {displayRating.label}
          </div>
          {/* Gauge bar */}
          <div style={{ marginTop: 10, height: 4, background: '#2C2C2E', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 2,
              background: `linear-gradient(90deg, #30D158, ${displayRating.color})`,
              width: `${Math.max(2, Math.min(98, ((displayCd - 0.20) / 0.22) * 100))}%`,
              transition: 'width 0.3s ease, background 0.3s ease',
            }}/>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
            <span style={{ fontSize: 9, color: 'rgba(235,235,245,0.2)', fontFamily: "'IBM Plex Mono',monospace" }}>0.20</span>
            <span style={{ fontSize: 9, color: 'rgba(235,235,245,0.2)', fontFamily: "'IBM Plex Mono',monospace" }}>0.42</span>
          </div>
        </div>

        {/* Secondary metrics */}
        {result && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[
              { label: 'Ensemble',    val: result.Cd_ensemble?.toFixed(4) ?? '—',    color: '#0A84FF'  },
              { label: 'Uncertainty', val: `±${result.uncertainty?.toFixed(4) ?? '—'}`, color: '#FF9F0A' },
              { label: 'Confidence',  val: `${result.confidence_pct ?? '—'}%`,       color: '#30D158'  },
              { label: 'Percentile',  val: `P${result.cd_percentile ?? '—'}`,        color: '#5E5CE6'  },
            ].map(m => (
              <div key={m.label} style={{
                background: '#1C1C1E', borderRadius: 9, padding: '9px 12px',
                border: '0.5px solid rgba(255,255,255,0.05)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <span style={{ fontSize: 11, color: 'rgba(235,235,245,0.35)' }}>{m.label}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: m.color, fontFamily: "'IBM Plex Mono',monospace" }}>{m.val}</span>
              </div>
            ))}
          </div>
        )}

        {/* Benchmarks */}
        <div style={{ fontSize: 10, fontWeight: 600, color: 'rgba(235,235,245,0.28)', letterSpacing: '0.08em', textTransform: 'uppercase', margin: '18px 0 10px' }}>
          Benchmarks
        </div>
        {[
          { name: 'Tesla Model 3',  cd: 0.230, color: '#30D158' },
          { name: 'Audi A4',        cd: 0.270, color: '#40CBE0' },
          { name: 'Toyota Camry',   cd: 0.280, color: '#0A84FF' },
          { name: 'Ford Mustang',   cd: 0.350, color: '#FF9F0A' },
          { name: 'Generic SUV',    cd: 0.380, color: '#FF453A' },
        ].map(b => {
          const isClosest = Math.abs(displayCd - b.cd) < 0.018
          return (
            <div key={b.name} style={{
              padding: '7px 0',
              borderBottom: '0.5px solid rgba(84,84,88,0.3)',
              background: isClosest ? `${b.color}0a` : 'transparent',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 11, color: isClosest ? 'rgba(235,235,245,0.7)' : 'rgba(235,235,245,0.35)' }}>
                  {b.name}
                </span>
                <span style={{ fontSize: 11, fontWeight: 600, color: b.color, fontFamily: "'IBM Plex Mono',monospace" }}>
                  {b.cd.toFixed(3)}
                </span>
              </div>
              <div style={{ height: 2, background: 'rgba(255,255,255,0.06)', borderRadius: 1, overflow: 'hidden' }}>
                <div style={{ height: '100%', background: b.color, borderRadius: 1, width: `${((b.cd - 0.20) / 0.20) * 100}%` }}/>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Feature slider component ───────────────────────────────────────────────────
function FeatureSlider({ def, value, onChange, last }) {
  const { label, unit, min, max, step, dp } = def
  const pct = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100))

  return (
    <div style={{ paddingTop: 10, paddingBottom: 10, borderBottom: last ? 'none' : '0.5px solid rgba(84,84,88,0.22)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 7 }}>
        <span style={{ fontSize: 11, color: 'rgba(235,235,245,0.45)', letterSpacing: '-0.1px' }}>{label}</span>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#0A84FF', fontFamily: "'IBM Plex Mono',monospace" }}>
          {value.toFixed(dp)}{unit && <span style={{ color: 'rgba(235,235,245,0.25)', fontWeight: 400, fontSize: 10 }}> {unit}</span>}
        </span>
      </div>
      <div style={{ position: 'relative', height: 18, display: 'flex', alignItems: 'center' }}>
        <div style={{ position: 'absolute', left: 0, right: 0, height: 2, borderRadius: 9999, background: '#2C2C2E' }}>
          <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', borderRadius: 9999, background: '#0A84FF', width: `${pct}%`, transition: 'width 0.05s' }}/>
        </div>
        <input
          type="range" min={min} max={max} step={step} value={value}
          onChange={e => onChange(parseFloat(e.target.value))}
          style={{ position: 'absolute', inset: 0, width: '100%', opacity: 0, cursor: 'pointer', zIndex: 2 }}
        />
        <div style={{
          position: 'absolute', top: '50%', transform: 'translate(-50%, -50%)',
          left: `${pct}%`, width: 16, height: 16, borderRadius: '50%',
          background: '#fff', boxShadow: '0 1px 5px rgba(0,0,0,0.5)',
          pointerEvents: 'none', zIndex: 1, transition: 'left 0.05s',
        }}/>
      </div>
    </div>
  )
}
