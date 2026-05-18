// CompareOverlay.jsx — StatContour Benchmarking Overlay
// Copyright (c) 2026 Rutej Talati. All rights reserved.
//
// Renders two car outlines superimposed in the same SVG canvas,
// aligned by their true aspect-ratio-preserving proportions.
// Alignment modes: wheelbase | overall-length | height | ground-line
// Diff highlight shows where one car is larger/smaller than the other.

import { useState, useMemo } from 'react'

const W = 900, H = 420, PAD = 36

// ── Colour scheme for the two cars ───────────────────────────────────────────
const CAR_A = { stroke: '#E0E0E0', label: 'Car A', dim: 'rgba(224,224,224,0.18)' }
const CAR_B = { stroke: '#FFB74D', label: 'Car B', dim: 'rgba(255,183,77,0.18)'  }

// ── Alignment modes ───────────────────────────────────────────────────────────
const ALIGN_MODES = [
  { id: 'length',    label: 'Overall Length',  desc: 'Both cars scaled to same length' },
  { id: 'height',    label: 'Overall Height',  desc: 'Both cars scaled to same height' },
  { id: 'wheelbase', label: 'Wheelbase',       desc: 'Wheelbase matched (most accurate)' },
  { id: 'none',      label: 'True Scale',      desc: 'Outlines at their true proportions' },
]

// ── Build SVG path from normalised points ─────────────────────────────────────
function ptsToPath(pts, scaleX, scaleY, offsetX, offsetY) {
  if (!pts?.length) return ''
  return pts.map(([nx, ny], i) =>
    `${i===0?'M':'L'}${(offsetX + nx*scaleX).toFixed(2)},${(offsetY + ny*scaleY).toFixed(2)}`
  ).join(' ') + ' Z'
}

// ── Proportion bar ────────────────────────────────────────────────────────────
function PropBar({ label, valA, valB, unit = '', decimals = 2, higher = 'neutral' }) {
  if (valA == null || valB == null) return null
  const max   = Math.max(valA, valB, 0.001)
  const wA    = (valA / max) * 100
  const wB    = (valB / max) * 100
  const diff  = valA !== 0 ? ((valB - valA) / valA * 100) : 0
  const diffColor = higher === 'neutral' ? 'var(--md-on-surface-variant)'
    : higher === 'lower'
      ? (diff < 0 ? 'var(--md-success)' : diff > 0 ? 'var(--md-error)' : 'var(--md-on-surface-variant)')
      : (diff > 0 ? 'var(--md-success)' : diff < 0 ? 'var(--md-error)' : 'var(--md-on-surface-variant)')

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
        <span style={{ fontSize:10, color:'var(--md-on-surface-variant)', fontFamily:'var(--font-mono)' }}>{label}</span>
        <span style={{ fontSize:10, color:diffColor, fontFamily:'var(--font-mono)', fontWeight:600 }}>
          {diff > 0 ? '+' : ''}{diff.toFixed(1)}%
        </span>
      </div>
      <div style={{ position:'relative', height:6, background:'var(--md-surface-container-highest)', borderRadius:3, overflow:'hidden' }}>
        <div style={{ position:'absolute', left:0, top:0, height:'100%', width:`${wA}%`, background:CAR_A.stroke, borderRadius:3, opacity:0.7 }}/>
      </div>
      <div style={{ position:'relative', height:6, background:'var(--md-surface-container-highest)', borderRadius:3, overflow:'hidden', marginTop:2 }}>
        <div style={{ position:'absolute', left:0, top:0, height:'100%', width:`${wB}%`, background:CAR_B.stroke, borderRadius:3, opacity:0.7 }}/>
      </div>
      <div style={{ display:'flex', justifyContent:'space-between', marginTop:2 }}>
        <span style={{ fontSize:9, color:CAR_A.stroke, fontFamily:'var(--font-mono)' }}>{valA.toFixed(decimals)}{unit}</span>
        <span style={{ fontSize:9, color:CAR_B.stroke, fontFamily:'var(--font-mono)' }}>{valB.toFixed(decimals)}{unit}</span>
      </div>
    </div>
  )
}

// ── Body type badge ───────────────────────────────────────────────────────────
function BodyBadge({ type, color }) {
  const icons = {
    sports:'🏎', saloon:'🚗', hatchback:'🚗', estate:'🚙',
    suv:'🛻', mpv:'🚐', coupe:'🚗', pickup:'🛻',
  }
  return (
    <span style={{
      display:'inline-flex', alignItems:'center', gap:4,
      padding:'2px 8px', borderRadius:99,
      background:`${color}18`, border:`1px solid ${color}44`,
      fontSize:10, fontWeight:600, color, fontFamily:'var(--font-mono)',
      letterSpacing:'0.05em', textTransform:'uppercase',
    }}>
      {icons[type] ?? '🚗'} {type}
    </span>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═════════════════════════════════════════════════════════════════════════════

export default function CompareOverlay({ geoA, geoB, labelA = 'Car A', labelB = 'Car B' }) {
  const [alignMode,  setAlignMode]  = useState('length')
  const [showDiff,   setShowDiff]   = useState(true)
  const [showGrid,   setShowGrid]   = useState(true)
  const [opacity,    setOpacity]    = useState(85)   // Car B opacity %

  const gA = geoA
  const gB = geoB

  // ── Compute layout geometry for both cars ─────────────────────────────────
  const layout = useMemo(() => {
    if (!gA || !gB) return null

    const ptsA = gA._smoothPts ?? gA._contourPts ?? []
    const ptsB = gB._smoothPts ?? gB._contourPts ?? []
    if (!ptsA.length || !ptsB.length) return null

    // True normalised dimensions from backend
    // norm_w and norm_h are aspect-ratio-preserving (both divided by same long edge)
    const nwA = gA.normWidth  ?? gA._bboxAspect ? gA._bboxAspect / (gA._bboxAspect + 1) : 0.70
    const nhA = gA.normHeight ?? 1.0 - nwA
    const nwB = gB.normWidth  ?? gB._bboxAspect ? gB._bboxAspect / (gB._bboxAspect + 1) : 0.70
    const nhB = gB.normHeight ?? 1.0 - nwB

    // Available canvas after padding
    const canW = W - PAD*2
    const canH = H - PAD*2

    let scaleAX, scaleAY, scaleBX, scaleBY
    let offAX, offAY, offBX, offBY

    if (alignMode === 'none') {
      // True scale: fit the wider car to canvas width, scale both the same
      const scaleBase = canW / Math.max(nwA, nwB, 0.001)
      scaleAX = scaleAY = scaleBase
      scaleBX = scaleBY = scaleBase
      // Ground-line align: both sit on same Y ground line
      const groundY = PAD + canH * 0.85
      offAX = PAD + (canW - nwA*scaleBase)/2
      offAY = groundY - nhA*scaleBase
      offBX = PAD + (canW - nwB*scaleBase)/2
      offBY = groundY - nhB*scaleBase

    } else if (alignMode === 'length') {
      // Scale both to same canvas width
      const scaleA = canW / Math.max(nwA, 0.001)
      const scaleB = canW / Math.max(nwB, 0.001)
      scaleAX = scaleAY = scaleA
      scaleBX = scaleBY = scaleB
      const groundY = PAD + canH * 0.85
      offAX = PAD; offAY = groundY - nhA*scaleA
      offBX = PAD; offBY = groundY - nhB*scaleB

    } else if (alignMode === 'height') {
      // Scale both to same canvas height
      const scaleA = canH * 0.75 / Math.max(nhA, 0.001)
      const scaleB = canH * 0.75 / Math.max(nhB, 0.001)
      scaleAX = scaleAY = scaleA
      scaleBX = scaleBY = scaleB
      const groundY = PAD + canH * 0.85
      offAX = PAD + (canW - nwA*scaleA)/2
      offAY = groundY - nhA*scaleA
      offBX = PAD + (canW - nwB*scaleB)/2
      offBY = groundY - nhB*scaleB

    } else {
      // Wheelbase align: match wheelbase lengths
      const wbA = gA.wheelbaseNorm ?? 0.55
      const wbB = gB.wheelbaseNorm ?? 0.55
      const scaleA = canW * 0.65 / Math.max(wbA, 0.001)
      const scaleB = scaleA * (wbB / Math.max(wbA, 0.001))  // not right — same pixel wheelbase
      const scaleBAdj = canW * 0.65 / Math.max(wbB, 0.001)
      scaleAX = scaleAY = scaleA
      scaleBX = scaleBY = scaleBAdj
      const groundY = PAD + canH * 0.85
      offAX = PAD + canW*0.15; offAY = groundY - nhA*scaleA
      offBX = PAD + canW*0.15; offBY = groundY - nhB*scaleBAdj
    }

    return { ptsA, ptsB, scaleAX, scaleAY, scaleBX, scaleBY, offAX, offAY, offBX, offBY }
  }, [gA, gB, alignMode])

  // ── Build SVG paths ───────────────────────────────────────────────────────
  const pathA = layout ? ptsToPath(layout.ptsA, layout.scaleAX, layout.scaleAY, layout.offAX, layout.offAY) : ''
  const pathB = layout ? ptsToPath(layout.ptsB, layout.scaleBX, layout.scaleBY, layout.offBX, layout.offBY) : ''

  const groundY = PAD + (H - PAD*2) * 0.85

  if (!gA || !gB) {
    return (
      <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100%', color:'var(--md-on-surface-disabled)', fontSize:14, fontFamily:'var(--font-sans)' }}>
        Analyse two cars to enable comparison
      </div>
    )
  }

  const geoDataA = gA
  const geoDataB = gB

  return (
    <div style={{ display:'flex', height:'100%', overflow:'hidden' }}>

      {/* ══ Compare canvas ══════════════════════════════════════════════════ */}
      <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>

        {/* Toolbar */}
        <div style={{
          height:44, flexShrink:0, display:'flex', alignItems:'center', gap:6, padding:'0 12px',
          background:'var(--md-surface-container)', borderBottom:'1px solid var(--md-outline-variant)',
        }}>
          <span style={{ fontSize:13, fontWeight:500, color:'var(--md-on-surface)', fontFamily:'var(--font-sans)', marginRight:4 }}>
            Compare
          </span>

          {/* Car labels */}
          <div style={{ display:'flex', alignItems:'center', gap:4, padding:'2px 8px', borderRadius:99, background:CAR_A.dim, border:`1px solid ${CAR_A.stroke}44` }}>
            <div style={{ width:8,height:8,borderRadius:'50%',background:CAR_A.stroke }}/>
            <span style={{ fontSize:11, color:CAR_A.stroke, fontFamily:'var(--font-mono)', fontWeight:600 }}>{labelA}</span>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:4, padding:'2px 8px', borderRadius:99, background:CAR_B.dim, border:`1px solid ${CAR_B.stroke}44` }}>
            <div style={{ width:8,height:8,borderRadius:'50%',background:CAR_B.stroke }}/>
            <span style={{ fontSize:11, color:CAR_B.stroke, fontFamily:'var(--font-mono)', fontWeight:600 }}>{labelB}</span>
          </div>

          <div style={{ width:1,height:18,background:'var(--md-outline-variant)',margin:'0 4px' }}/>

          {/* Alignment mode chips */}
          {ALIGN_MODES.map(m => (
            <button key={m.id} className="md-chip" data-selected={alignMode===m.id}
              onClick={()=>setAlignMode(m.id)} style={{ fontSize:11, height:28, padding:'0 10px' }}
              title={m.desc}>
              {m.label}
            </button>
          ))}

          <div style={{ flex:1 }}/>

          {/* Toggles */}
          <button className="md-icon-btn" data-active={showGrid} onClick={()=>setShowGrid(p=>!p)} title="Grid" style={{ fontSize:12 }}>⊞</button>
          <button className="md-icon-btn" data-active={showDiff} onClick={()=>setShowDiff(p=>!p)} title="Difference highlight" style={{ fontSize:12 }}>◈</button>

          {/* Opacity slider for Car B */}
          <span style={{ fontSize:10, color:'var(--md-on-surface-variant)', fontFamily:'var(--font-mono)' }}>B opacity</span>
          <input type="range" min={20} max={100} value={opacity}
            onChange={e=>setOpacity(Number(e.target.value))}
            style={{ width:60, accentColor:CAR_B.stroke }}/>
        </div>

        {/* SVG canvas */}
        <div style={{ flex:1, position:'relative', overflow:'hidden', background:'var(--md-surface)' }}>
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width:'100%', height:'100%' }} preserveAspectRatio="xMidYMid meet">
            <rect width={W} height={H} fill="#141414"/>

            {/* Grid */}
            {showGrid && [0.25,0.50,0.75].map(f => (
              <g key={f}>
                <line x1={PAD+f*(W-PAD*2)} y1={PAD} x2={PAD+f*(W-PAD*2)} y2={H-PAD}
                  stroke="rgba(255,255,255,0.04)" strokeWidth="1" strokeDasharray="4 4"/>
                <line x1={PAD} y1={PAD+f*(H-PAD*2)} x2={W-PAD} y2={PAD+f*(H-PAD*2)}
                  stroke="rgba(255,255,255,0.04)" strokeWidth="1" strokeDasharray="4 4"/>
              </g>
            ))}

            {/* Ground line */}
            <line x1={PAD-10} y1={groundY} x2={W-PAD+10} y2={groundY}
              stroke="rgba(255,255,255,0.08)" strokeWidth="1"/>

            {/* Car A outline (always full opacity, white) */}
            {pathA && (
              <path d={pathA} fill="none"
                stroke={CAR_A.stroke} strokeWidth="1.8"
                strokeLinejoin="round" strokeLinecap="round"/>
            )}

            {/* Car B outline (adjustable opacity, amber) */}
            {pathB && (
              <path d={pathB} fill="none"
                stroke={CAR_B.stroke} strokeWidth="1.8"
                strokeLinejoin="round" strokeLinecap="round"
                opacity={opacity/100}/>
            )}

            {/* Car A filled area (very faint) for diff read */}
            {showDiff && pathA && (
              <path d={pathA} fill={CAR_A.dim} stroke="none" opacity="0.5"/>
            )}
            {showDiff && pathB && (
              <path d={pathB} fill={CAR_B.dim} stroke="none" opacity={opacity/200}/>
            )}

            {/* Labels */}
            <text x={PAD+8} y={PAD+16} fontSize={10} fill={CAR_A.stroke}
              fontFamily="var(--font-mono)" fontWeight="600">{labelA}</text>
            <text x={PAD+8} y={PAD+30} fontSize={10} fill={CAR_B.stroke}
              fontFamily="var(--font-mono)" fontWeight="600" opacity={opacity/100}>{labelB}</text>

            {/* Alignment label */}
            <text x={W-PAD-4} y={H-8} textAnchor="end" fontSize={9}
              fill="rgba(255,255,255,0.15)" fontFamily="var(--font-mono)" letterSpacing="0.1em">
              {ALIGN_MODES.find(m=>m.id===alignMode)?.desc?.toUpperCase()}
            </text>
          </svg>
        </div>
      </div>

      {/* ══ Metrics panel ═══════════════════════════════════════════════════ */}
      <div style={{
        width:260, flexShrink:0, borderLeft:'1px solid var(--md-outline-variant)',
        background:'var(--md-surface-container-low)', overflowY:'auto', padding:'14px 12px',
      }}>

        {/* Body type */}
        <div style={{ marginBottom:14 }}>
          <div style={{ fontSize:10, color:'var(--md-on-surface-disabled)', letterSpacing:'0.8px', textTransform:'uppercase', fontFamily:'var(--font-sans)', marginBottom:6 }}>
            Body Type
          </div>
          <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
            <BodyBadge type={geoDataA?.bodyType ?? '—'} color={CAR_A.stroke}/>
            <BodyBadge type={geoDataB?.bodyType ?? '—'} color={CAR_B.stroke}/>
          </div>
        </div>

        <div style={{ height:1, background:'var(--md-outline-variant)', marginBottom:12 }}/>

        {/* Proportions */}
        <div style={{ fontSize:10, color:'var(--md-on-surface-disabled)', letterSpacing:'0.8px', textTransform:'uppercase', fontFamily:'var(--font-sans)', marginBottom:8 }}>
          Proportions
        </div>

        <PropBar label="Length:Height ratio"
          valA={geoDataA?.trueAspect} valB={geoDataB?.trueAspect}
          decimals={2} higher="neutral"/>

        <PropBar label="Norm. height"
          valA={geoDataA?.normHeight} valB={geoDataB?.normHeight}
          decimals={3} higher="neutral"/>

        <PropBar label="Hood ratio"
          valA={geoDataA?.hoodRatio} valB={geoDataB?.hoodRatio}
          decimals={2} unit="" higher="neutral"/>

        <PropBar label="Cabin ratio"
          valA={geoDataA?.cabinRatio} valB={geoDataB?.cabinRatio}
          decimals={2} higher="higher"/>

        <PropBar label="Boot ratio"
          valA={geoDataA?.bootRatio} valB={geoDataB?.bootRatio}
          decimals={2} higher="neutral"/>

        <PropBar label="Wheelbase (norm)"
          valA={geoDataA?.wheelbaseNorm} valB={geoDataB?.wheelbaseNorm}
          decimals={3} higher="higher"/>

        <div style={{ height:1, background:'var(--md-outline-variant)', margin:'10px 0' }}/>

        <div style={{ fontSize:10, color:'var(--md-on-surface-disabled)', letterSpacing:'0.8px', textTransform:'uppercase', fontFamily:'var(--font-sans)', marginBottom:8 }}>
          Glass & Stance
        </div>

        <PropBar label="Greenhouse ratio"
          valA={geoDataA?.greenhouseRatio} valB={geoDataB?.greenhouseRatio}
          decimals={3} higher="higher"/>

        <PropBar label="A-pillar angle"
          valA={geoDataA?.aPillarAngle} valB={geoDataB?.aPillarAngle}
          decimals={1} unit="°" higher="lower"/>

        <PropBar label="Windscreen rake"
          valA={geoDataA?.wsAngleDeg} valB={geoDataB?.wsAngleDeg}
          decimals={1} unit="°" higher="lower"/>

        <PropBar label="Rear slant"
          valA={geoDataA?.rearSlantAngleDeg} valB={geoDataB?.rearSlantAngleDeg}
          decimals={1} unit="°" higher="neutral"/>

        <PropBar label="Ride height (norm)"
          valA={geoDataA?.rideH} valB={geoDataB?.rideH}
          decimals={3} higher="neutral"/>

        <PropBar label="Roof flatness"
          valA={geoDataA?.roofFlatness} valB={geoDataB?.roofFlatness}
          decimals={3} higher="higher"/>

        <PropBar label="Underbody flatness"
          valA={geoDataA?.underbodyFlatness} valB={geoDataB?.underbodyFlatness}
          decimals={3} higher="higher"/>

        <div style={{ height:1, background:'var(--md-outline-variant)', margin:'10px 0' }}/>

        <div style={{ fontSize:10, color:'var(--md-on-surface-disabled)', letterSpacing:'0.8px', textTransform:'uppercase', fontFamily:'var(--font-sans)', marginBottom:8 }}>
          Outline Quality
        </div>

        <PropBar label="Convexity score"
          valA={geoDataA?.convexityScore} valB={geoDataB?.convexityScore}
          decimals={3} higher="higher"/>

        {/* Flip warning */}
        {(geoDataA?.wasFlipped || geoDataB?.wasFlipped) && (
          <div style={{ fontSize:10, color:'var(--md-warning)', marginTop:8, lineHeight:1.5, fontFamily:'var(--font-sans)' }}>
            ⚠ {geoDataA?.wasFlipped ? `${labelA} ` : ''}{geoDataB?.wasFlipped ? `${labelB} ` : ''} auto-flipped to right-facing
          </div>
        )}
      </div>
    </div>
  )
}
