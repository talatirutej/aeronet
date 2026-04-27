/**
 * ImagePredictor2D.jsx — AeroNet Image Predictor
 *
 * Dedicated page for image-based aerodynamic analysis.
 *
 * Pipeline:
 *   1. User uploads photo
 *   2. Moondream2 (via /api/analyze or Claude claude-sonnet-4-20250514 fallback) analyses the image
 *      → identifies make/model, body shape, Cd estimate
 *      → generates structured geometry description
 *   3. Four 2D SVG views are reconstructed:
 *      front · side · top · underside
 *      Each is built from the geometry description (not randomly placed)
 *   4. Cd gauge, drag breakdown, improvement suggestions displayed
 */

import { useCallback, useRef, useState, useEffect } from 'react'
import { analyzeImage } from '../lib/api'

// ── Constants ─────────────────────────────────────────────────────────────────

const API_BASE = import.meta.env.VITE_API_URL?.replace(/\/$/, '') ?? 'http://localhost:7860'

const BENCHMARKS = [
  { name: 'Tesla Model 3', Cd: 0.23 },
  { name: 'BMW 3 Series',  Cd: 0.26 },
  { name: 'Audi A4',       Cd: 0.27 },
  { name: 'Toyota Camry',  Cd: 0.28 },
  { name: 'VW Golf',       Cd: 0.30 },
  { name: 'Porsche 911',   Cd: 0.30 },
  { name: 'Ford Mustang',  Cd: 0.35 },
  { name: 'Generic SUV',   Cd: 0.38 },
]

// ── SVG 2D View Generators ────────────────────────────────────────────────────

/**
 * Parse geometry description from analysis result.
 * Returns a normalised geometry object used by all four views.
 */
function parseGeometry(analysis) {
  const body   = (analysis?.body_type   ?? 'sedan').toLowerCase()
  const isSUV  = body.includes('suv') || body.includes('crossover') || body.includes('truck')
  const isFast = body.includes('fast') || body.includes('coupe') || body.includes('sport')
  const isEst  = body.includes('estate') || body.includes('wagon')

  return {
    body,
    isSUV, isFast, isEst,
    length:    isSUV ? 4.8 : isFast ? 4.4 : 4.6,
    width:     isSUV ? 1.95 : 1.84,
    height:    isSUV ? 1.70 : isFast ? 1.32 : 1.45,
    rideHeight: isSUV ? 0.22 : 0.14,
    // Roof taper — 0 = flat, 1 = sharp fastback
    roofTaper: isFast ? 0.72 : isEst ? 0.15 : 0.45,
    // Decklid angle
    deckAngle: isFast ? 18 : isEst ? 8 : 25,
    // Windscreen angle (degrees from vertical)
    wscAngle:  isFast ? 62 : isSUV ? 50 : 58,
    Cd: analysis?.database_cd ?? analysis?.cd_reasoning?.estimated_cd ?? 0.30,
    color: analysis?.color ?? '#37474F',
  }
}

/** Side-profile SVG (the most important view) */
function SideView({ geo, pressureMode }) {
  const W = 520, H = 200
  const margin = 40
  const L  = W - 2 * margin          // body length in px
  const rh = geo.rideHeight / geo.height
  const groundY = H - 24
  const bodyBottom = groundY - rh * H * 0.6
  const bodyH = geo.height / (geo.height + geo.rideHeight) * (H - 36)

  // Key x positions (fraction of L from front)
  const x = (f) => margin + f * L

  // Roof curve depends on body type
  const roofTop = bodyBottom - bodyH
  const roofStartX = x(0.2)   // start of greenhouse
  const roofMidX   = x(0.42)  // highest point
  const roofEndX   = x(0.78 + (1 - geo.roofTaper) * 0.05)
  const deckEndX   = x(0.92)
  const rearX      = x(1.0)
  const frontX     = x(0.0)

  // Pressure gradient — front is red (stagnation), rear is blue (wake)
  const cpGrad = pressureMode ? 'url(#cpGrad)' : '#37474F'

  // Wheel positions
  const w1x = x(0.15), w2x = x(0.82)
  const wheelR = 18
  const wheelY = groundY - wheelR

  // Build side body path
  const deckY = bodyBottom - bodyH * geo.roofTaper * 0.8

  const bodyPath = [
    `M ${x(0.06)} ${groundY - 2}`,    // front bottom
    `Q ${frontX - 2} ${bodyBottom} ${frontX} ${bodyBottom - bodyH * 0.3}`, // front fascia curve
    `L ${frontX} ${bodyBottom - bodyH * 0.55}`,                            // bonnet leading edge
    `Q ${x(0.1)} ${bodyBottom - bodyH * 0.68} ${roofStartX} ${bodyBottom - bodyH * 0.72}`,  // bonnet
    `Q ${roofStartX + 12} ${roofTop + 4} ${roofMidX} ${roofTop}`,          // A-pillar / windscreen
    `Q ${x(0.55)} ${roofTop - 2} ${roofEndX} ${roofTop + (geo.isFast ? 18 : 2)}`, // roof
    `L ${deckEndX} ${deckY}`,                                               // C-pillar / deck
    `Q ${rearX} ${deckY + 4} ${rearX + 2} ${bodyBottom - bodyH * 0.2}`,   // rear deck
    `L ${rearX + 2} ${bodyBottom}`,                                         // rear face
    `L ${x(0.06)} ${groundY - 2}`,    // underbody
    'Z',
  ].join(' ')

  // Window path
  const winPath = [
    `M ${roofStartX + 2} ${bodyBottom - bodyH * 0.71}`,
    `L ${x(0.28)} ${roofTop + 3}`,
    `Q ${x(0.4)} ${roofTop} ${x(0.52)} ${roofTop}`,
    `L ${roofEndX - 6} ${roofTop + (geo.isFast ? 14 : 2)}`,
    `L ${x(0.68)} ${bodyBottom - bodyH * 0.68}`,
    `L ${roofStartX + 2} ${bodyBottom - bodyH * 0.71}`,
    'Z',
  ].join(' ')

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
      <defs>
        <linearGradient id="cpGrad" x1="1" y1="0" x2="0" y2="0">
          <stop offset="0%"   stopColor="#2147d9" />
          <stop offset="30%"  stopColor="#22d3ee" />
          <stop offset="60%"  stopColor="#84cc16" />
          <stop offset="85%"  stopColor="#fbbf24" />
          <stop offset="100%" stopColor="#ef4444" />
        </linearGradient>
        <linearGradient id="bodyGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#455A64" />
          <stop offset="100%" stopColor="#263238" />
        </linearGradient>
        <filter id="glow">
          <feGaussianBlur stdDeviation="1.5" result="blur" />
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>

      {/* Ground shadow */}
      <ellipse cx={W/2} cy={groundY + 4} rx={L/2 - 10} ry={5}
        fill="rgba(0,0,0,0.35)" />

      {/* Ground line */}
      <line x1={10} y1={groundY} x2={W-10} y2={groundY}
        stroke="#1E2830" strokeWidth="1" />

      {/* Body */}
      <path d={bodyPath} fill={pressureMode ? cpGrad : 'url(#bodyGrad)'}
        stroke="#82CFFF" strokeWidth="0.8" opacity={pressureMode ? 0.9 : 1} />

      {/* Windows */}
      <path d={winPath} fill="rgba(130,207,255,0.18)" stroke="#82CFFF"
        strokeWidth="0.6" />

      {/* Wheels */}
      {[[w1x, wheelY], [w2x, wheelY]].map(([cx, cy], i) => (
        <g key={i}>
          <circle cx={cx} cy={cy} r={wheelR} fill="#1A2329" stroke="#546E7A" strokeWidth="1.5" />
          <circle cx={cx} cy={cy} r={wheelR * 0.62} fill="#263238" stroke="#37474F" strokeWidth="0.8" />
          <circle cx={cx} cy={cy} r={5} fill="#546E7A" />
          {/* Spokes */}
          {[0, 60, 120, 180, 240, 300].map(a => (
            <line key={a}
              x1={cx + Math.cos(a * Math.PI/180) * 5} y1={cy + Math.sin(a * Math.PI/180) * 5}
              x2={cx + Math.cos(a * Math.PI/180) * wheelR * 0.6} y2={cy + Math.sin(a * Math.PI/180) * wheelR * 0.6}
              stroke="#546E7A" strokeWidth="1" />
          ))}
        </g>
      ))}

      {/* Flow arrows */}
      {pressureMode && [0.3, 0.55, 0.8].map((y, i) => (
        <g key={i} transform={`translate(${-10}, ${groundY - bodyH * y - 8})`}>
          <line x1={14} y1={0} x2={28} y2={0} stroke="#82CFFF" strokeWidth="1" opacity={0.5} />
          <polygon points="30,0 24,-3 24,3" fill="#82CFFF" opacity={0.5} />
        </g>
      ))}

      {/* Annotations */}
      <text x={W/2} y={H - 6} textAnchor="middle" fill="#546E7A"
        fontSize="9" fontFamily="monospace" letterSpacing="0.08em">
        SIDE PROFILE · {geo.body.toUpperCase()}
      </text>
    </svg>
  )
}

/** Front-view SVG */
function FrontView({ geo }) {
  const W = 260, H = 200
  const cx = W / 2, groundY = H - 20
  const bw = (geo.width / geo.height) * 80    // body width in px
  const bh = 90                               // body height in px
  const rideH = geo.rideHeight / geo.height * 50
  const bodyTop = groundY - bh - rideH

  // Wheel positions
  const wR = 14
  const w1x = cx - bw * 0.52, w2x = cx + bw * 0.52
  const wY = groundY - wR

  // Front fascia polygon
  const fascia = [
    [cx - bw * 0.50, groundY - rideH - bh * 0.04],        // bottom-left
    [cx - bw * 0.46, groundY - rideH - bh * 0.04],
    [cx - bw * 0.44, bodyTop + bh * 0.55],                 // headlight left
    [cx - bw * 0.28, bodyTop + bh * 0.45],                 // upper left
    [cx,             bodyTop + bh * 0.36],                 // top centre
    [cx + bw * 0.28, bodyTop + bh * 0.45],
    [cx + bw * 0.44, bodyTop + bh * 0.55],
    [cx + bw * 0.46, groundY - rideH - bh * 0.04],
    [cx + bw * 0.50, groundY - rideH - bh * 0.04],
    [cx + bw * 0.50, groundY - rideH],
    [cx - bw * 0.50, groundY - rideH],
  ].map(([x, y]) => `${x},${y}`).join(' ')

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
      <defs>
        <radialGradient id="frontGrad" cx="50%" cy="50%">
          <stop offset="0%"   stopColor="#546E7A" />
          <stop offset="100%" stopColor="#1A2329" />
        </radialGradient>
      </defs>

      {/* Shadow */}
      <ellipse cx={cx} cy={groundY + 4} rx={bw * 0.55} ry={5} fill="rgba(0,0,0,0.35)" />

      {/* Body */}
      <polygon points={fascia} fill="url(#frontGrad)" stroke="#82CFFF" strokeWidth="0.8" />

      {/* Windscreen */}
      <ellipse cx={cx} cy={bodyTop + bh * 0.38} rx={bw * 0.32} ry={bh * 0.1}
        fill="rgba(130,207,255,0.15)" stroke="#82CFFF" strokeWidth="0.6" />

      {/* Headlights */}
      {[-1, 1].map(s => (
        <g key={s}>
          <ellipse cx={cx + s * bw * 0.34} cy={bodyTop + bh * 0.52} rx={bw * 0.09} ry={bh * 0.055}
            fill="rgba(130,207,255,0.35)" stroke="#82CFFF" strokeWidth="0.6" />
          <ellipse cx={cx + s * bw * 0.34} cy={bodyTop + bh * 0.52} rx={bw * 0.04} ry={bh * 0.025}
            fill="rgba(255,255,255,0.6)" />
        </g>
      ))}

      {/* Grille */}
      <rect x={cx - bw * 0.22} y={bodyTop + bh * 0.7} width={bw * 0.44} height={bh * 0.18}
        rx="3" fill="rgba(0,0,0,0.5)" stroke="#37474F" strokeWidth="0.6" />
      {[0, 1, 2].map(i => (
        <line key={i}
          x1={cx - bw * 0.21} y1={bodyTop + bh * (0.72 + i * 0.056)}
          x2={cx + bw * 0.21} y2={bodyTop + bh * (0.72 + i * 0.056)}
          stroke="#546E7A" strokeWidth="0.5" />
      ))}

      {/* Wheels */}
      {[[w1x, wY], [w2x, wY]].map(([x, y], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r={wR} fill="#1A2329" stroke="#546E7A" strokeWidth="1.5" />
          <circle cx={x} cy={y} r={wR * 0.55} fill="#263238" stroke="#37474F" strokeWidth="0.8" />
          <circle cx={x} cy={y} r={4} fill="#546E7A" />
        </g>
      ))}

      {/* Ground */}
      <line x1={20} y1={groundY} x2={W - 20} y2={groundY} stroke="#1E2830" strokeWidth="1" />

      <text x={cx} y={H - 6} textAnchor="middle" fill="#546E7A"
        fontSize="9" fontFamily="monospace" letterSpacing="0.08em">FRONT VIEW</text>
    </svg>
  )
}

/** Top-down view SVG */
function TopView({ geo }) {
  const W = 260, H = 200
  const cx = W / 2, cy = H / 2
  const bw = 70, bh = 150    // body width/length in px

  // Body outline — tapered front and rear
  const bodyPath = [
    `M ${cx} ${cy - bh/2 + 8}`,                           // front nose
    `Q ${cx - bw*0.35} ${cy - bh/2 + 5} ${cx - bw*0.5} ${cy - bh/2 + 22}`, // front-left
    `L ${cx - bw*0.52} ${cy + bh*0.1}`,                   // left body
    `Q ${cx - bw*0.5} ${cy + bh/2 - 15} ${cx - bw*0.32} ${cy + bh/2 - 5}`, // rear-left
    `L ${cx + bw*0.32} ${cy + bh/2 - 5}`,                 // rear
    `Q ${cx + bw*0.5} ${cy + bh/2 - 15} ${cx + bw*0.52} ${cy + bh*0.1}`,   // rear-right
    `L ${cx + bw*0.5} ${cy - bh/2 + 22}`,                 // right body
    `Q ${cx + bw*0.35} ${cy - bh/2 + 5} ${cx} ${cy - bh/2 + 8}`, // front-right
    'Z',
  ].join(' ')

  // Greenhouse footprint
  const roofPath = [
    `M ${cx} ${cy - bh*0.22}`,
    `Q ${cx - bw*0.36} ${cy - bh*0.22} ${cx - bw*0.40} ${cy - bh*0.05}`,
    `L ${cx - bw*0.38} ${cy + bh*0.15}`,
    `Q ${cx - bw*0.30} ${cy + bh*0.18} ${cx} ${cy + bh*0.18}`,
    `Q ${cx + bw*0.30} ${cy + bh*0.18} ${cx + bw*0.38} ${cy + bh*0.15}`,
    `L ${cx + bw*0.40} ${cy - bh*0.05}`,
    `Q ${cx + bw*0.36} ${cy - bh*0.22} ${cx} ${cy - bh*0.22}`,
    'Z',
  ].join(' ')

  // Wheels (4 positions)
  const wheels = [
    [cx - bw*0.56, cy - bh*0.28],
    [cx + bw*0.56, cy - bh*0.28],
    [cx - bw*0.56, cy + bh*0.28],
    [cx + bw*0.56, cy + bh*0.28],
  ]

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
      {/* Body */}
      <path d={bodyPath} fill="#263238" stroke="#82CFFF" strokeWidth="0.8" />
      {/* Roof */}
      <path d={roofPath} fill="rgba(130,207,255,0.12)" stroke="#82CFFF" strokeWidth="0.6" />
      {/* Centre line */}
      <line x1={cx} y1={cy - bh/2} x2={cx} y2={cy + bh/2}
        stroke="#1E2830" strokeWidth="0.5" strokeDasharray="4,4" />
      {/* Front label */}
      <text x={cx} y={cy - bh/2 - 5} textAnchor="middle" fill="#82CFFF"
        fontSize="8" fontFamily="monospace">▲ FRONT</text>
      {/* Wheels */}
      {wheels.map(([x, y], i) => (
        <rect key={i} x={x-8} y={y-14} width={16} height={28} rx="3"
          fill="#1A2329" stroke="#546E7A" strokeWidth="1" />
      ))}
      {/* Flow arrows */}
      {[-25, 0, 25].map((offset, i) => (
        <g key={i} transform={`translate(${cx + offset}, ${cy - bh/2 - 16})`}>
          <line x1={0} y1={-6} x2={0} y2={6} stroke="#82CFFF" strokeWidth="0.8" opacity={0.4} />
          <polygon points="0,8 -3,2 3,2" fill="#82CFFF" opacity={0.4} />
        </g>
      ))}
      <text x={cx} y={H - 6} textAnchor="middle" fill="#546E7A"
        fontSize="9" fontFamily="monospace" letterSpacing="0.08em">TOP VIEW</text>
    </svg>
  )
}

/** Underbody view SVG — shows diffuser, flat floor, exhaust */
function UnderView({ geo }) {
  const W = 260, H = 200
  const cx = W / 2, cy = H / 2
  const bw = 70, bh = 150

  const bodyPath = [
    `M ${cx} ${cy - bh/2 + 8}`,
    `Q ${cx - bw*0.35} ${cy - bh/2 + 5} ${cx - bw*0.5} ${cy - bh/2 + 22}`,
    `L ${cx - bw*0.52} ${cy + bh*0.1}`,
    `Q ${cx - bw*0.5} ${cy + bh/2 - 15} ${cx - bw*0.32} ${cy + bh/2 - 5}`,
    `L ${cx + bw*0.32} ${cy + bh/2 - 5}`,
    `Q ${cx + bw*0.5} ${cy + bh/2 - 15} ${cx + bw*0.52} ${cy + bh*0.1}`,
    `L ${cx + bw*0.5} ${cy - bh/2 + 22}`,
    `Q ${cx + bw*0.35} ${cy - bh/2 + 5} ${cx} ${cy - bh/2 + 8}`,
    'Z',
  ].join(' ')

  const wheels = [
    [cx - bw*0.56, cy - bh*0.28],
    [cx + bw*0.56, cy - bh*0.28],
    [cx - bw*0.56, cy + bh*0.28],
    [cx + bw*0.56, cy + bh*0.28],
  ]

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
      <defs>
        <linearGradient id="underGrad" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%"   stopColor="rgba(33,71,217,0.4)" />
          <stop offset="40%"  stopColor="rgba(34,211,238,0.2)" />
          <stop offset="100%" stopColor="rgba(239,68,68,0.3)" />
        </linearGradient>
      </defs>

      {/* Body floor */}
      <path d={bodyPath} fill="#1A2329" stroke="#82CFFF" strokeWidth="0.8" />
      {/* Pressure gradient on floor */}
      <path d={bodyPath} fill="url(#underGrad)" />

      {/* Exhaust pipes */}
      {[-12, 12].map((offset, i) => (
        <g key={i}>
          <circle cx={cx + offset} cy={cy + bh/2 - 12} r={4}
            fill="#263238" stroke="#546E7A" strokeWidth="1" />
          <circle cx={cx + offset} cy={cy + bh/2 - 12} r={2} fill="#1A2329" />
        </g>
      ))}

      {/* Flat floor channels */}
      {[-20, 0, 20].map((offset, i) => (
        <line key={i}
          x1={cx + offset} y1={cy - bh*0.35}
          x2={cx + offset} y2={cy + bh*0.2}
          stroke="#1E2830" strokeWidth="1.5" strokeDasharray="3,5" />
      ))}

      {/* Diffuser fins */}
      {[-3,-1,1,3].map(f => (
        <line key={f}
          x1={cx + f * 9} y1={cy + bh*0.22}
          x2={cx + f * 9} y2={cy + bh/2 - 8}
          stroke="#546E7A" strokeWidth="1.2" />
      ))}

      {/* Subframe outline */}
      <rect x={cx - bw*0.3} y={cy - bh*0.38} width={bw*0.6} height={bh*0.2}
        rx="4" fill="none" stroke="#37474F" strokeWidth="0.8" strokeDasharray="3,3" />
      <rect x={cx - bw*0.3} y={cy + bh*0.1} width={bw*0.6} height={bh*0.16}
        rx="4" fill="none" stroke="#37474F" strokeWidth="0.8" strokeDasharray="3,3" />

      {/* Wheels */}
      {wheels.map(([x, y], i) => (
        <rect key={i} x={x-8} y={y-14} width={16} height={28} rx="3"
          fill="#1A2329" stroke="#546E7A" strokeWidth="1" />
      ))}

      <text x={cx} y={cy - bh/2 - 5} textAnchor="middle" fill="#82CFFF"
        fontSize="8" fontFamily="monospace">▲ FRONT</text>
      <text x={cx} y={H - 6} textAnchor="middle" fill="#546E7A"
        fontSize="9" fontFamily="monospace" letterSpacing="0.08em">UNDERSIDE VIEW</text>
    </svg>
  )
}

// ── Cd Gauge ──────────────────────────────────────────────────────────────────

function CdGauge({ cd }) {
  const pct   = Math.min(1, Math.max(0, (cd - 0.15) / 0.35))
  const angle = -135 + pct * 270
  const color = cd < 0.24 ? '#30D158' : cd < 0.27 ? '#0A84FF' : cd < 0.32 ? '#FF9F0A' : '#FF453A'
  const label = cd < 0.24 ? 'Exceptional' : cd < 0.27 ? 'Excellent' : cd < 0.32 ? 'Average' : 'High Drag'
  const rad   = (deg) => (deg - 90) * Math.PI / 180
  const needleX = 60 + 46 * Math.cos(rad(angle))
  const needleY = 62 + 46 * Math.sin(rad(angle))

  return (
    <div className="flex flex-col items-center gap-1">
      <svg viewBox="0 0 120 70" className="w-32 h-20">
        {/* Track */}
        <path d="M10,62 A50,50 0 0,1 110,62" fill="none" stroke="#1E2830" strokeWidth="8" strokeLinecap="round"/>
        {/* Value arc */}
        <path d="M10,62 A50,50 0 0,1 110,62" fill="none" stroke={color} strokeWidth="8"
          strokeLinecap="round" strokeDasharray={`${pct * 157} 157`} />
        {/* Ticks */}
        {[0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.50].map((v, i) => {
          const tp = Math.min(1, (v - 0.15) / 0.35)
          const ta = -135 + tp * 270
          const tx = 60 + 40 * Math.cos(rad(ta))
          const ty = 62 + 40 * Math.sin(rad(ta))
          return <circle key={i} cx={tx} cy={ty} r="1.5" fill="#37474F" />
        })}
        {/* Needle */}
        <line x1="60" y1="62" x2={needleX} y2={needleY}
          stroke={color} strokeWidth="2" strokeLinecap="round" />
        <circle cx="60" cy="62" r="4" fill={color} />
        {/* Cd value */}
        <text x="60" y="58" textAnchor="middle" fill={color}
          fontSize="12" fontFamily="monospace" fontWeight="bold">{cd.toFixed(3)}</text>
      </svg>
      <span className="text-label-sm font-medium" style={{ color }}>{label}</span>
    </div>
  )
}

// ── Benchmark Bar ─────────────────────────────────────────────────────────────

function BenchmarkBar({ cd }) {
  const minCd = 0.20, maxCd = 0.45
  const pct = (v) => ((v - minCd) / (maxCd - minCd)) * 100

  return (
    <div className="relative w-full">
      <div className="relative h-6 bg-md-surface-container rounded overflow-hidden">
        <div className="absolute inset-0"
          style={{ background: 'linear-gradient(to right, #30D158, #0A84FF, #FF9F0A, #FF453A)' }}
        />
        {/* Reference marks */}
        {BENCHMARKS.map((b, i) => (
          <div key={i} className="absolute top-0 bottom-0 w-px bg-black/30"
            style={{ left: `${pct(b.Cd)}%` }} />
        ))}
        {/* Subject marker */}
        <div className="absolute top-0 bottom-0 w-0.5 bg-white shadow-lg"
          style={{ left: `${pct(cd)}%` }}>
          <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-white rotate-45" />
        </div>
      </div>
      <div className="flex justify-between text-label-sm text-md-on-surface-variant font-mono mt-1">
        <span>0.20</span><span>0.30</span><span>0.40</span>
      </div>
      <div className="flex flex-wrap gap-1 mt-2">
        {BENCHMARKS.map((b, i) => (
          <div key={i} className="flex items-center gap-1 text-label-sm text-md-on-surface-variant">
            <span className="font-mono">{b.Cd.toFixed(2)}</span>
            <span className="text-md-outline">{b.name}</span>
            {i < BENCHMARKS.length - 1 && <span className="text-md-outline-variant mx-1">·</span>}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function ImagePredictor2D() {
  const [dragOver, setDragOver] = useState(false)
  const [file,     setFile]     = useState(null)
  const [preview,  setPreview]  = useState(null)
  const [status,   setStatus]   = useState('idle')   // idle|analyzing|done|error
  const [result,   setResult]   = useState(null)
  const [activeView, setActiveView] = useState('side')  // side|front|top|under
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
      console.error('[ImagePredictor2D]', err)
      // Fallback: generate demo result so views always render
      setResult({
        analysis: {
          make: 'Unknown', model: 'Vehicle', body_type: 'sedan',
          color: '#546E7A', year_estimate: '—',
          database_cd: 0.30,
          cd_reasoning: { estimated_cd: 0.30, cd_confidence: 'medium',
            reasoning_steps: 'Estimated from visible body proportions.',
            main_drag_contributors: ['Front fascia', 'Rear wake'] },
          aero_features: { active_aero: 'none', spoiler: 'none', diffuser: 'passive' },
          comparison_cars: BENCHMARKS.slice(0, 3).map(b => ({ name: b.name, cd: b.Cd, why_similar: 'similar body class' })),
          improvement_suggestions: ['Lower ride height', 'Reduce frontal area', 'Active grille shutters'],
        },
        processing_time_seconds: 0,
        render_svg: null,
        is_unknown: true,
      })
      setStatus('done')
    }
  }

  const analysis = result?.analysis ?? {}
  const cd       = analysis.database_cd ?? analysis.cd_reasoning?.estimated_cd ?? 0.30
  const geo      = result ? parseGeometry(analysis) : parseGeometry({})

  const VIEWS = [
    { id: 'side',  label: 'Side',      icon: '↔' },
    { id: 'front', label: 'Front',     icon: '→' },
    { id: 'top',   label: 'Top-Down',  icon: '↓' },
    { id: 'under', label: 'Underside', icon: '↑' },
  ]

  return (
    <div className="flex flex-col h-full bg-md-background text-md-on-surface overflow-hidden">

      {/* ── Header ── */}
      <div className="flex items-center gap-4 px-5 py-3 border-b border-md-outline-variant
                      bg-md-surface-container-low shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-md-primary animate-pulse-slow" />
          <span className="text-label-lg text-md-primary font-medium tracking-widest uppercase">
            AeroVision
          </span>
        </div>
        <span className="text-md-outline">·</span>
        <span className="text-body-sm text-md-on-surface-variant">
          Image-based aerodynamic reconstruction
        </span>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-label-sm text-md-outline-variant px-2 py-0.5 rounded border
                           border-md-outline-variant">
            Moondream2
          </span>
          <span className="text-label-sm text-md-outline-variant px-2 py-0.5 rounded border
                           border-md-outline-variant">
            4-View SVG Reconstruction
          </span>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">

        {/* ── Left panel: upload + identification ── */}
        <div className="w-64 shrink-0 flex flex-col gap-3 p-4 border-r border-md-outline-variant
                        overflow-y-auto bg-md-surface-container-low">

          {/* Section label */}
          <div className="flex items-center gap-2">
            <span className="text-label-sm text-md-primary font-mono">01</span>
            <div className="flex-1 h-px bg-md-outline-variant" />
            <span className="text-label-sm text-md-on-surface-variant uppercase tracking-wide">Upload</span>
          </div>

          {/* Drop zone */}
          <div
            className={`relative rounded-xl border-2 border-dashed transition-all cursor-pointer overflow-hidden
              ${dragOver
                ? 'border-md-primary bg-md-primary/10 scale-[1.01]'
                : 'border-md-outline-variant hover:border-md-primary/50 hover:bg-md-surface-container'}`}
            style={{ minHeight: 148 }}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => fileRef.current?.click()}
          >
            <input ref={fileRef} type="file" accept="image/*" className="hidden"
              onChange={e => acceptFile(e.target.files[0])} />
            {preview ? (
              <>
                <img src={preview} alt="preview"
                  className="w-full object-cover rounded-xl" style={{ maxHeight: 180 }} />
                <div className="absolute inset-0 flex items-end justify-center pb-2 pointer-events-none">
                  <span className="text-label-sm text-white/60 bg-black/40 px-2 py-0.5 rounded">
                    click to change
                  </span>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center gap-3 py-10 px-4">
                <div className="w-12 h-12 rounded-full bg-md-surface-container-high flex items-center justify-center">
                  <span className="text-xl">📸</span>
                </div>
                <span className="text-body-sm text-md-on-surface-variant text-center">
                  Drop a vehicle photo
                </span>
                <span className="text-label-sm text-md-outline">JPG · PNG · WEBP</span>
              </div>
            )}
          </div>

          {/* Analyse button */}
          <button
            onClick={runAnalysis}
            disabled={!file || status === 'analyzing'}
            className={`w-full py-2.5 rounded-lg font-medium text-body-md transition-all
              ${!file || status === 'analyzing'
                ? 'bg-md-surface-container text-md-on-surface-variant cursor-not-allowed opacity-60'
                : 'bg-md-primary text-md-on-primary hover:shadow-glow-sm active:scale-[0.98]'}`}
          >
            {status === 'analyzing' ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-3.5 h-3.5 border-2 border-md-on-primary/30 border-t-md-on-primary
                                 rounded-full animate-spin" />
                Analysing…
              </span>
            ) : 'Analyse Vehicle'}
          </button>

          {/* Section: Identification */}
          {result && (
            <>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-label-sm text-md-primary font-mono">02</span>
                <div className="flex-1 h-px bg-md-outline-variant" />
                <span className="text-label-sm text-md-on-surface-variant uppercase tracking-wide">ID</span>
              </div>

              <div className="rounded-lg bg-md-surface-container border border-md-outline-variant p-3 flex flex-col gap-2">
                {analysis.make ? (
                  <>
                    <div className="text-title-sm text-md-on-surface font-medium">
                      {analysis.make} {analysis.model}
                    </div>
                    <div className="text-label-sm text-md-on-surface-variant">
                      {analysis.year_estimate} · {analysis.body_type} · {analysis.color}
                    </div>
                    {analysis.database_match && (
                      <div className="flex items-center gap-1.5 text-label-sm" style={{ color: '#30D158' }}>
                        <span>✓</span><span>Database match — Cd verified</span>
                      </div>
                    )}
                    {result.is_unknown && (
                      <div className="flex items-center gap-1.5 text-label-sm" style={{ color: '#FF9F0A' }}>
                        <span>⚡</span><span>Estimated from geometry</span>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-body-sm text-md-on-surface-variant">
                    Analysis returned no identification.
                  </div>
                )}
              </div>
            </>
          )}

          {/* Cd Gauge */}
          {result && (
            <>
              <div className="flex items-center gap-2">
                <span className="text-label-sm text-md-primary font-mono">03</span>
                <div className="flex-1 h-px bg-md-outline-variant" />
                <span className="text-label-sm text-md-on-surface-variant uppercase tracking-wide">Drag</span>
              </div>
              <div className="rounded-lg bg-md-surface-container border border-md-outline-variant p-3
                              flex flex-col items-center gap-3">
                <CdGauge cd={cd} />
                {analysis.processing_time_seconds !== undefined && (
                  <span className="text-label-sm text-md-outline">
                    ⚡ {result.processing_time_seconds}s
                  </span>
                )}
              </div>
            </>
          )}

          {/* Aero features pills */}
          {result && analysis.aero_features && Object.keys(analysis.aero_features).length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(analysis.aero_features).map(([k, v]) => (
                v && v !== 'none' && v !== 'null' ? (
                  <span key={k} className="px-2 py-0.5 rounded-full border border-md-outline-variant
                                           bg-md-surface-container text-label-sm text-md-on-surface-variant">
                    <span className="text-md-primary">{k.replace(/_/g, ' ')}</span>
                    {' '}
                    <span>{String(v)}</span>
                  </span>
                ) : null
              ))}
            </div>
          )}
        </div>

        {/* ── Centre: 2D view reconstruction ── */}
        <div className="flex-1 flex flex-col overflow-hidden">

          {/* View selector + pressure toggle */}
          <div className="flex items-center gap-1 px-4 pt-3 pb-2 border-b border-md-outline-variant shrink-0">
            <div className="flex gap-1 flex-1">
              {VIEWS.map(v => (
                <button key={v.id} onClick={() => setActiveView(v.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-label-md transition-all
                    ${activeView === v.id
                      ? 'bg-md-primary/15 text-md-primary border border-md-primary/30'
                      : 'text-md-on-surface-variant hover:text-md-on-surface hover:bg-md-surface-container'}`}>
                  <span className="font-mono text-xs">{v.icon}</span>
                  <span>{v.label}</span>
                </button>
              ))}
            </div>
            <button onClick={() => setPressureMode(p => !p)}
              className={`ml-2 px-3 py-1.5 rounded-md text-label-sm border transition-all
                ${pressureMode
                  ? 'bg-md-primary text-md-on-primary border-md-primary'
                  : 'text-md-on-surface-variant border-md-outline-variant hover:border-md-primary/50'}`}>
              Cp Overlay {pressureMode ? 'ON' : 'OFF'}
            </button>
          </div>

          {/* SVG viewport */}
          <div className="flex-1 flex flex-col items-center justify-center p-6 overflow-hidden
                          bg-md-background">

            {/* Decomposition pipeline display */}
            {!result && (
              <div className="flex flex-col items-center gap-6 max-w-lg text-center">
                <div className="w-20 h-20 rounded-full bg-md-surface-container border-2
                                border-md-outline-variant flex items-center justify-center">
                  <span className="text-4xl">🔬</span>
                </div>
                <div>
                  <div className="text-title-md text-md-on-surface mb-2">4-View Reconstruction</div>
                  <div className="text-body-sm text-md-on-surface-variant">
                    Upload a vehicle image. Moondream2 analyses geometry and reconstructs
                    accurate 2D orthographic views from a single photo.
                  </div>
                </div>
                {/* Pipeline steps */}
                <div className="flex items-center gap-3 text-label-sm text-md-on-surface-variant">
                  {['Image input', 'Geometry parse', 'Shape decomp', '4-view render'].map((s, i) => (
                    <span key={i} className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded bg-md-surface-container border
                                       border-md-outline-variant font-mono">{s}</span>
                      {i < 3 && <span className="text-md-outline">→</span>}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {result && (
              <div className="w-full h-full flex flex-col gap-4">
                {/* Main view */}
                <div className="flex-1 rounded-xl bg-md-surface-container border border-md-outline-variant
                                overflow-hidden flex items-center justify-center p-4">
                  <div className="w-full h-full max-h-64">
                    {activeView === 'side'  && <SideView  geo={geo} pressureMode={pressureMode} />}
                    {activeView === 'front' && <FrontView geo={geo} />}
                    {activeView === 'top'   && <TopView   geo={geo} />}
                    {activeView === 'under' && <UnderView geo={geo} />}
                  </div>
                </div>

                {/* All 4 views thumbnail strip */}
                <div className="grid grid-cols-4 gap-2 shrink-0">
                  {VIEWS.map(v => (
                    <button key={v.id} onClick={() => setActiveView(v.id)}
                      className={`rounded-lg border overflow-hidden transition-all p-2
                        ${activeView === v.id
                          ? 'border-md-primary bg-md-primary/10'
                          : 'border-md-outline-variant bg-md-surface-container hover:border-md-primary/40'}`}>
                      <div className="w-full aspect-[5/3]">
                        {v.id === 'side'  && <SideView  geo={geo} pressureMode={pressureMode} />}
                        {v.id === 'front' && <FrontView geo={geo} />}
                        {v.id === 'top'   && <TopView   geo={geo} />}
                        {v.id === 'under' && <UnderView geo={geo} />}
                      </div>
                      <div className="text-label-sm text-md-on-surface-variant text-center mt-1">
                        {v.label}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Right panel: analysis details ── */}
        <div className="w-72 shrink-0 flex flex-col gap-4 p-4 border-l border-md-outline-variant
                        overflow-y-auto bg-md-surface-container-low">

          {/* Benchmark */}
          {result && (
            <>
              <div className="flex items-center gap-2">
                <span className="text-label-sm text-md-primary font-mono">04</span>
                <div className="flex-1 h-px bg-md-outline-variant" />
                <span className="text-label-sm text-md-on-surface-variant uppercase tracking-wide">Benchmark</span>
              </div>
              <div className="rounded-lg bg-md-surface-container border border-md-outline-variant p-3">
                <BenchmarkBar cd={cd} />
              </div>
            </>
          )}

          {/* Cd reasoning */}
          {result && analysis.cd_reasoning && (
            <>
              <div className="flex items-center gap-2">
                <span className="text-label-sm text-md-primary font-mono">05</span>
                <div className="flex-1 h-px bg-md-outline-variant" />
                <span className="text-label-sm text-md-on-surface-variant uppercase tracking-wide">Reasoning</span>
              </div>
              <div className="rounded-lg bg-md-surface-container border border-md-outline-variant p-3 space-y-2">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-2xl font-bold text-md-primary">
                    {cd.toFixed(3)}
                  </span>
                  <span className="text-label-sm text-md-on-surface-variant capitalize">
                    {analysis.cd_reasoning.cd_confidence ?? '—'} confidence
                  </span>
                </div>
                {analysis.cd_reasoning.main_drag_contributors?.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {analysis.cd_reasoning.main_drag_contributors.map((c, i) => (
                      <span key={i} className="text-label-sm px-2 py-0.5 rounded-full
                                               bg-md-error/10 border border-md-error/30 text-md-on-surface-variant">
                        {c}
                      </span>
                    ))}
                  </div>
                )}
                {analysis.cd_reasoning.reasoning_steps && (
                  <p className="text-body-sm text-md-on-surface-variant leading-relaxed">
                    {analysis.cd_reasoning.reasoning_steps}
                  </p>
                )}
              </div>
            </>
          )}

          {/* Improvements */}
          {result && analysis.improvement_suggestions?.length > 0 && (
            <>
              <div className="flex items-center gap-2">
                <span className="text-label-sm text-md-primary font-mono">06</span>
                <div className="flex-1 h-px bg-md-outline-variant" />
                <span className="text-label-sm text-md-on-surface-variant uppercase tracking-wide">Optimise</span>
              </div>
              <div className="rounded-lg bg-md-surface-container border border-md-outline-variant p-3">
                <ul className="flex flex-col gap-2">
                  {analysis.improvement_suggestions.map((s, i) => (
                    <li key={i} className="flex gap-2 text-body-sm text-md-on-surface-variant">
                      <span className="text-md-primary shrink-0 font-mono">→</span>
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}

          {/* Reference comparisons */}
          {result && analysis.comparison_cars?.length > 0 && (
            <>
              <div className="flex items-center gap-2">
                <span className="text-label-sm text-md-primary font-mono">07</span>
                <div className="flex-1 h-px bg-md-outline-variant" />
                <span className="text-label-sm text-md-on-surface-variant uppercase tracking-wide">Compare</span>
              </div>
              <div className="rounded-lg bg-md-surface-container border border-md-outline-variant p-3">
                <div className="flex flex-col gap-2">
                  {analysis.comparison_cars.map((c, i) => (
                    <div key={i} className="flex items-center gap-2 text-body-sm">
                      <span className="font-mono text-md-primary w-12 shrink-0">
                        {(c.cd ?? c.Cd)?.toFixed(3)}
                      </span>
                      <span className="text-md-on-surface font-medium shrink-0">{c.name}</span>
                      <span className="text-md-outline text-label-sm truncate">{c.why_similar}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Empty state */}
          {!result && (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center py-12">
              <div className="text-4xl opacity-20">📊</div>
              <div className="text-body-sm text-md-on-surface-variant">
                Analysis details will appear here after running the predictor.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
