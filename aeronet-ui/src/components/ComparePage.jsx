// Copyright (c) 2026 Rutej Talati. All rights reserved.

import { useState } from 'react'

const METRICS = [
  { key:'Cd',          label:'Drag Coef.',    unit:'',   fmt: v => v?.toFixed(4), good:'lower' },
  { key:'Cl',          label:'Lift Coef.',    unit:'',   fmt: v => v?.toFixed(4), good:'lower_abs' },
  { key:'Cs',          label:'Side Coef.',    unit:'',   fmt: v => v?.toFixed(4), good:'lower_abs' },
  { key:'dragForceN',  label:'Drag Force',    unit:'N',  fmt: v => Math.round(v),  good:'lower' },
  { key:'liftForceN',  label:'Lift Force',    unit:'N',  fmt: v => Math.round(v),  good:'lower_abs' },
  { key:'CdA',         label:'Drag Area CdA', unit:'m²', fmt: v => v?.toFixed(3),  good:'lower' },
  { key:'ldRatio',     label:'L/D Ratio',     unit:'',   fmt: v => v?.toFixed(3),  good:'higher' },
  { key:'powerDragW',  label:'Drag Power',    unit:'W',  fmt: v => Math.round(v),  good:'lower' },
  { key:'inferenceMs', label:'Inference',     unit:'ms', fmt: v => Math.round(v),  good:'lower' },
]

function winner(a, b, good) {
  if (a == null || b == null) return null
  const av = parseFloat(a), bv = parseFloat(b)
  if (isNaN(av) || isNaN(bv)) return null
  switch (good) {
    case 'lower':     return av < bv ? 'A' : bv < av ? 'B' : null
    case 'higher':    return av > bv ? 'A' : bv > av ? 'B' : null
    case 'lower_abs': return Math.abs(av) < Math.abs(bv) ? 'A' : Math.abs(bv) < Math.abs(av) ? 'B' : null
    default: return null
  }
}

function MetricRow({ label, unit, valA, valB, good, fmt }) {
  const fA = valA != null ? `${fmt(valA)}${unit ? ' ' + unit : ''}` : '—'
  const fB = valB != null ? `${fmt(valB)}${unit ? ' ' + unit : ''}` : '—'
  const w = winner(valA, valB, good)
  const delta = valA != null && valB != null ? valA - valB : null

  return (
    <div style={{ display:'grid', gridTemplateColumns:'1fr 120px 1fr', gap:8,
      padding:'8px 0', borderBottom:'1px solid #1a2830', alignItems:'center' }}>
      {/* A */}
      <div style={{ textAlign:'right' }}>
        <span style={{ fontFamily:'Roboto Mono', fontSize:14, fontWeight:300,
          color: w === 'A' ? '#4ade80' : w === 'B' ? '#f87171' : '#fff',
          fontVariantNumeric:'tabular-nums' }}>{fA}</span>
        {w === 'A' && <span style={{ fontSize:10, color:'#4ade80', marginLeft:6 }}>WIN</span>}
      </div>
      {/* Label + delta */}
      <div style={{ textAlign:'center' }}>
        <div style={{ fontSize:10, color:'#cac4d0', fontWeight:500,
          textTransform:'uppercase', letterSpacing:'0.06em' }}>{label}</div>
        {delta != null && (
          <div style={{ fontSize:9, fontFamily:'Roboto Mono', marginTop:2, fontVariantNumeric:'tabular-nums',
            color: (good==='lower'&&delta<0)||(good==='higher'&&delta>0) ? '#4ade80' : '#f87171' }}>
            {delta > 0 ? '+' : ''}{fmt ? fmt(delta) : delta.toFixed(3)}{unit ? ' '+unit : ''}
          </div>
        )}
      </div>
      {/* B */}
      <div style={{ textAlign:'left' }}>
        {w === 'B' && <span style={{ fontSize:10, color:'#4ade80', marginRight:6 }}>WIN</span>}
        <span style={{ fontFamily:'Roboto Mono', fontSize:14, fontWeight:300,
          color: w === 'B' ? '#4ade80' : w === 'A' ? '#f87171' : '#fff',
          fontVariantNumeric:'tabular-nums' }}>{fB}</span>
      </div>
    </div>
  )
}

function BreakdownCompare({ breakdownA, breakdownB }) {
  if (!breakdownA || !breakdownB) return null
  const COLORS = ['#ef4444','#4dd8e8','#fbbf24','#84cc16','#a78bfa','#fb923c']
  return (
    <div style={{ marginTop:16 }}>
      <div style={{ fontSize:10, color:'#cac4d0', textTransform:'uppercase',
        letterSpacing:'0.07em', marginBottom:10 }}>Drag Breakdown Comparison</div>
      {breakdownA.map((b, i) => {
        const bB = breakdownB[i]
        const pA = Math.round(b.fraction * 100)
        const pB = Math.round(bB?.fraction * 100 ?? 0)
        return (
          <div key={b.region} style={{ marginBottom:8 }}>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
              <span style={{ fontSize:11, color:'#cac4d0' }}>{b.region}</span>
              <span style={{ fontFamily:'Roboto Mono', fontSize:10, color:'#cac4d0' }}>
                {pA}% vs {pB}%
              </span>
            </div>
            <div style={{ position:'relative', height:6 }}>
              <div style={{ height:'100%', background:'#1c1c1c', borderRadius:9999 }} />
              <div style={{ position:'absolute', top:0, left:0, height:'100%',
                width:`${pA}%`, borderRadius:9999,
                background: COLORS[i], opacity:0.9,
                boxShadow:`0 0 6px ${COLORS[i]}66` }} />
              <div style={{ position:'absolute', top:0, left:0, height:'100%',
                width:`${pB}%`, borderRadius:9999,
                background: COLORS[i], opacity:0.3,
                borderBottom:`1px dashed ${COLORS[i]}` }} />
            </div>
          </div>
        )
      })}
      <div style={{ display:'flex', gap:12, marginTop:6, fontSize:9, color:'#938f99' }}>
        <span style={{ display:'flex', alignItems:'center', gap:4 }}>
          <div style={{ width:14, height:3, background:'#4a7080', borderRadius:1 }} /> Run A (solid)
        </span>
        <span style={{ display:'flex', alignItems:'center', gap:4 }}>
          <div style={{ width:14, height:3, background:'#4a7080', opacity:0.4, borderRadius:1 }} /> Run B (faded)
        </span>
      </div>
    </div>
  )
}

export default function ComparePage({ history, compareResults }) {
  const [selA, setSelA] = useState(0)
  const [selB, setSelB] = useState(1)

  const runA = history[selA]
  const runB = history[selB]
  const rA = runA?.result
  const rB = runB?.result

  const winsA = rA && rB ? METRICS.filter(m => winner(rA[m.key], rB[m.key], m.good) === 'A').length : 0
  const winsB = rA && rB ? METRICS.filter(m => winner(rA[m.key], rB[m.key], m.good) === 'B').length : 0

  if (history.length < 2) {
    return (
      <div style={{ display:'flex', alignItems:'center', justifyContent:'center',
        height:'100%', background:'#000' }}>
        <div style={{ textAlign:'center', maxWidth:360 }}>
          <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#49454f"
            strokeWidth="1" style={{ marginBottom:16 }}>
            <rect x="3" y="3" width="8" height="18" rx="1"/>
            <rect x="13" y="3" width="8" height="18" rx="1"/>
          </svg>
          <div style={{ fontSize:16, fontWeight:500, color:'#938f99', marginBottom:8 }}>
            Need 2 predictions to compare
          </div>
          <div style={{ fontSize:12, color:'#49454f', lineHeight:1.7 }}>
            Go to the 3D Predictor, run predictions on two different STL files
            or with different parameters. Then come back here to compare them side by side.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%',
      overflow:'hidden', background:'#000' }}>

      {/* Run selectors */}
      <div style={{ padding:'10px 20px', borderBottom:'1px solid #1a2830',
        background:'#0d0d0d', display:'flex', alignItems:'center', gap:16 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ fontSize:11, fontWeight:600, color:'#ef4444',
            fontFamily:'Roboto Mono' }}>A</span>
          <select value={selA} onChange={e=>setSelA(+e.target.value)}
            className="m3-select" style={{ width:220, fontSize:11 }}>
            {history.map((h,i) => <option key={h.id} value={i}>Run {i+1}: {h.label} · Cd={h.Cd?.toFixed(3)}</option>)}
          </select>
        </div>
        <div style={{ flex:1, textAlign:'center', fontSize:10, color:'#938f99' }}>vs</div>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <select value={selB} onChange={e=>setSelB(+e.target.value)}
            className="m3-select" style={{ width:220, fontSize:11 }}>
            {history.map((h,i) => <option key={h.id} value={i}>Run {i+1}: {h.label} · Cd={h.Cd?.toFixed(3)}</option>)}
          </select>
          <span style={{ fontSize:11, fontWeight:600, color:'#4dd8e8',
            fontFamily:'Roboto Mono' }}>B</span>
        </div>
      </div>

      {/* Score bar */}
      {rA && rB && (
        <div style={{ padding:'8px 20px', borderBottom:'1px solid #1a2830',
          display:'flex', alignItems:'center', gap:12, background:'#050505' }}>
          <span style={{ fontSize:11, fontWeight:700, color:'#ef4444',
            fontFamily:'Roboto Mono' }}>A: {winsA} wins</span>
          <div style={{ flex:1, height:4, background:'#1c1c1c', borderRadius:9999, overflow:'hidden' }}>
            <div style={{ height:'100%', borderRadius:9999, background:'linear-gradient(to right,#ef4444,#4dd8e8)',
              width:`${(winsA / (winsA+winsB||1)) * 100}%`, transition:'width 500ms' }} />
          </div>
          <span style={{ fontSize:11, fontWeight:700, color:'#4dd8e8',
            fontFamily:'Roboto Mono' }}>{winsB} wins: B</span>
          <div style={{ fontSize:10, color:'#938f99', marginLeft:8 }}>
            {winsA > winsB ? 'Run A is better overall' : winsB > winsA ? 'Run B is better overall' : 'Tie'}
          </div>
        </div>
      )}

      {/* Content */}
      <div style={{ flex:1, overflowY:'auto', padding:'0 20px 20px' }}>

        {/* Column headers */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 120px 1fr', gap:8,
          padding:'12px 0', position:'sticky', top:0, background:'#000', zIndex:5 }}>
          <div style={{ textAlign:'right' }}>
            <div style={{ fontSize:11, fontWeight:700, color:'#ef4444',
              fontFamily:'Roboto Mono' }}>Run A</div>
            <div style={{ fontSize:10, color:'#938f99', marginTop:2 }}>{runA?.label}</div>
          </div>
          <div style={{ textAlign:'center', fontSize:10, color:'#938f99',
            textTransform:'uppercase', letterSpacing:'0.07em', paddingTop:6 }}>
            Metric
          </div>
          <div style={{ textAlign:'left' }}>
            <div style={{ fontSize:11, fontWeight:700, color:'#4dd8e8',
              fontFamily:'Roboto Mono' }}>Run B</div>
            <div style={{ fontSize:10, color:'#938f99', marginTop:2 }}>{runB?.label}</div>
          </div>
        </div>

        {METRICS.map(m => (
          <MetricRow key={m.key} label={m.label} unit={m.unit}
            valA={rA?.[m.key]} valB={rB?.[m.key]} good={m.good} fmt={m.fmt} />
        ))}

        <BreakdownCompare breakdownA={rA?.dragBreakdown} breakdownB={rB?.dragBreakdown} />
      </div>
    </div>
  )
}
