// Copyright (c) 2026 Rutej Talati. All rights reserved.
import { useEffect, useRef, useState } from 'react'

const REGION_COLORS = ['#ef4444','#4dd8e8','#fbbf24','#84cc16','#a78bfa','#fb923c']

const CD_BENCHMARKS = [
  { name: 'Tesla Model 3', Cd: 0.23 },
  { name: 'Audi A4',       Cd: 0.27 },
  { name: 'BMW 3 Series',  Cd: 0.26 },
  { name: 'Toyota Camry',  Cd: 0.28 },
  { name: 'VW Golf',       Cd: 0.30 },
  { name: 'Porsche 911',   Cd: 0.30 },
  { name: 'Generic SUV',   Cd: 0.38 },
]

function AnimatedNumber({ value, decimals = 3, color }) {
  const [display, setDisplay] = useState(value)
  const prev = useRef(value)

  useEffect(() => {
    const start = prev.current
    const end = value
    const duration = 600
    const startTime = performance.now()
    const tick = now => {
      const t = Math.min((now - startTime) / duration, 1)
      const ease = t < 0.5 ? 2*t*t : -1+(4-2*t)*t
      setDisplay(start + (end - start) * ease)
      if (t < 1) requestAnimationFrame(tick)
      else prev.current = end
    }
    requestAnimationFrame(tick)
  }, [value])

  return (
    <span style={{ fontFamily:'Roboto Mono', fontVariantNumeric:'tabular-nums', color: color ?? '#fff' }}>
      {display.toFixed(decimals)}
    </span>
  )
}

function ConfBadge({ conf }) {
  const pct = Math.round((conf ?? 0) * 100)
  const [color, bg] = pct >= 80 ? ['#4ade80','rgba(74,222,128,0.12)']
    : pct >= 60 ? ['#fbbf24','rgba(251,191,36,0.12)']
    : ['#f87171','rgba(248,113,113,0.12)']
  return (
    <span style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'2px 8px',
      borderRadius:9999, fontSize:11, fontWeight:600, color, background:bg,
      border:`1px solid ${color}44`, animation: pct < 60 ? 'pulse 2s infinite' : 'none' }}>
      {pct}% CONF
    </span>
  )
}

function StatCard({ label, value, unit, sub, color, mono = true }) {
  return (
    <div className="stat-card">
      <div style={{ fontSize:11, fontWeight:500, letterSpacing:'0.08em', textTransform:'uppercase', color:'#938f99' }}>{label}</div>
      <div style={{ display:'flex', alignItems:'baseline', gap:6, marginTop:2 }}>
        <span style={{ fontSize: 28, fontWeight: 300, lineHeight:1,
          fontFamily: mono ? 'Roboto Mono' : 'inherit',
          fontVariantNumeric:'tabular-nums',
          color: color ?? '#fff' }}>{value}</span>
        <span style={{ fontSize:12, color:'#938f99' }}>{unit}</span>
      </div>
      {sub && <div style={{ fontSize:11, color:'#938f99', marginTop:2 }}>{sub}</div>}
    </div>
  )
}

function BreakdownBar({ region, fraction, color, index }) {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const t = setTimeout(() => setWidth(Math.round(fraction * 100)), index * 60)
    return () => clearTimeout(t)
  }, [fraction])

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <span style={{ fontSize:12, color:'#c4cbd0' }}>{region}</span>
        <span style={{ fontFamily:'Roboto Mono', fontSize:11, color:'#938f99', fontVariantNumeric:'tabular-nums' }}>
          {Math.round(fraction*100)}%
        </span>
      </div>
      <div style={{ height:6, borderRadius:9999, background:'#223035', overflow:'hidden' }}>
        <div style={{ height:'100%', borderRadius:9999, width:`${width}%`,
          background: color, boxShadow:`0 0 8px ${color}66`,
          transition:'width 700ms cubic-bezier(0,0,0,1)' }} />
      </div>
    </div>
  )
}

function CdGauge({ Cd }) {
  const max = 0.5
  const pct = Math.min(Cd / max, 1) * 100
  const color = Cd < 0.25 ? '#4ade80' : Cd < 0.30 ? '#4dd8e8' : Cd < 0.35 ? '#fbbf24' : '#f87171'
  const rating = Cd < 0.25 ? 'Excellent' : Cd < 0.30 ? 'Good' : Cd < 0.35 ? 'Average' : 'High Drag'
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:6, marginTop:8 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <span style={{ fontSize:11, color:'#938f99' }}>Cd scale (0 → 0.50)</span>
        <span style={{ fontSize:12, fontWeight:600, color }}>{rating}</span>
      </div>
      <div style={{ height:6, borderRadius:9999, background:'#223035', position:'relative' }}>
        <div style={{ height:'100%', borderRadius:9999, width:`${pct}%`,
          background:`linear-gradient(to right, #4ade80, ${color})`,
          transition:'width 800ms cubic-bezier(0,0,0,1)' }} />
        {/* Known car markers */}
        {CD_BENCHMARKS.slice(0,4).map(b => (
          <div key={b.name} title={`${b.name}: ${b.Cd}`}
            style={{ position:'absolute', top:'50%', transform:'translateY(-50%)',
              left:`${(b.Cd/max)*100}%`, width:2, height:10, background:'#3a4f56',
              borderRadius:1, cursor:'help' }} />
        ))}
      </div>
      <div style={{ display:'flex', justifyContent:'space-between', fontSize:10, color:'#3a4f56' }}>
        <span>0</span><span>0.25</span><span>0.50</span>
      </div>
    </div>
  )
}

function BenchmarkRow({ name, Cd, thisCd }) {
  const delta = Cd - thisCd
  const color = delta > 0 ? '#4ade80' : '#f87171'
  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
      padding:'6px 0', borderBottom:'1px solid #1e2b30' }}>
      <span style={{ fontSize:12, color:'#c4cbd0' }}>{name}</span>
      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
        <span style={{ fontFamily:'Roboto Mono', fontSize:12, color:'#938f99', fontVariantNumeric:'tabular-nums' }}>{Cd.toFixed(2)}</span>
        <span style={{ fontSize:11, color, fontVariantNumeric:'tabular-nums' }}>
          {delta > 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(3)}
        </span>
      </div>
    </div>
  )
}

function GeometryCard({ geo }) {
  if (!geo) return null
  return (
    <div className="m3-card" style={{ padding:12 }}>
      <div style={{ fontSize:11, fontWeight:500, letterSpacing:'0.08em', textTransform:'uppercase',
        color:'#938f99', marginBottom:8 }}>Mesh Geometry</div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6 }}>
        {[
          { label:'Faces',   val: geo.nFaces?.toLocaleString() },
          { label:'Vertices', val: geo.nVerts?.toLocaleString() },
          { label:'Length',  val: `${geo.lengthM?.toFixed(2)} m` },
          { label:'Width',   val: `${geo.widthM?.toFixed(2)} m`  },
          { label:'Height',  val: `${geo.heightM?.toFixed(2)} m` },
          { label:'Units',   val: geo.units === 'mm' ? 'mm → m (auto)' : 'metres' },
        ].map(r => (
          <div key={r.label} style={{ display:'flex', flexDirection:'column', gap:1 }}>
            <span style={{ fontSize:10, color:'#938f99', textTransform:'uppercase', letterSpacing:'0.06em' }}>{r.label}</span>
            <span style={{ fontFamily:'Roboto Mono', fontSize:12, color:'#fff', fontVariantNumeric:'tabular-nums' }}>{r.val}</span>
          </div>
        ))}
      </div>
      <div style={{ marginTop:8, display:'flex', alignItems:'center', gap:6 }}>
        <div style={{ width:8, height:8, borderRadius:'50%',
          background: geo.isWatertight ? '#4ade80' : '#fbbf24' }} />
        <span style={{ fontSize:11, color: geo.isWatertight ? '#4ade80' : '#fbbf24' }}>
          {geo.isWatertight ? 'Watertight mesh' : 'Non-watertight (open shell)'}
        </span>
      </div>
    </div>
  )
}

function CpStatsCard({ cpStats }) {
  if (!cpStats) return null
  return (
    <div className="m3-card" style={{ padding:12 }}>
      <div style={{ fontSize:11, fontWeight:500, letterSpacing:'0.08em', textTransform:'uppercase',
        color:'#938f99', marginBottom:8 }}>Pressure Coefficient Field</div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6 }}>
        {[
          { label:'Cp min',   val: cpStats.min?.toFixed(3),  color:'#4dd8e8' },
          { label:'Cp max',   val: cpStats.max?.toFixed(3),  color:'#ef4444' },
          { label:'Cp mean',  val: cpStats.mean?.toFixed(3), color:'#fff' },
          { label:'Cp σ',     val: cpStats.std?.toFixed(3),  color:'#938f99' },
        ].map(r => (
          <div key={r.label} style={{ display:'flex', flexDirection:'column', gap:1 }}>
            <span style={{ fontSize:10, color:'#938f99', textTransform:'uppercase', letterSpacing:'0.06em' }}>{r.label}</span>
            <span style={{ fontFamily:'Roboto Mono', fontSize:13, color:r.color, fontVariantNumeric:'tabular-nums' }}>{r.val}</span>
          </div>
        ))}
      </div>
      {cpStats.stagPressurePa && (
        <div style={{ marginTop:8, padding:'6px 8px', borderRadius:6, background:'rgba(239,68,68,0.08)',
          border:'1px solid rgba(239,68,68,0.2)' }}>
          <span style={{ fontSize:11, color:'#938f99' }}>Stagnation pressure: </span>
          <span style={{ fontFamily:'Roboto Mono', fontSize:12, color:'#ef4444', fontVariantNumeric:'tabular-nums' }}>
            {cpStats.stagPressurePa?.toFixed(0)} Pa
          </span>
        </div>
      )}
    </div>
  )
}

function HistoryRow({ item, index, prevCd }) {
  const delta = prevCd != null ? item.Cd - prevCd : null
  return (
    <div style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 10px', borderRadius:10,
      transition:'background 150ms', cursor:'default' }}
      onMouseOver={e=>e.currentTarget.style.background='rgba(77,216,232,0.04)'}
      onMouseOut={e=>e.currentTarget.style.background='transparent'}>
      <div style={{ width:26, height:26, borderRadius:8, background:'#00363d',
        display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
        <span style={{ fontFamily:'Roboto Mono', fontSize:11, color:'#4dd8e8' }}>{index+1}</span>
      </div>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:12, color:'#c4cbd0', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{item.label}</div>
        <div style={{ fontSize:11, color:'#938f99' }}>{Math.round(item.inferenceMs)} ms</div>
      </div>
      <div style={{ textAlign:'right' }}>
        <div style={{ fontFamily:'Roboto Mono', fontSize:13, color:'#4dd8e8', fontVariantNumeric:'tabular-nums' }}>{item.Cd?.toFixed(3)}</div>
        {delta != null && (
          <div style={{ fontSize:10, fontVariantNumeric:'tabular-nums',
            color: delta > 0 ? '#f87171' : '#4ade80' }}>
            {delta > 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(3)}
          </div>
        )}
      </div>
    </div>
  )
}

export default function ResultsPanel({ result, history, isLoading }) {
  const [showBenchmarks, setShowBenchmarks] = useState(false)

  if (!result && !isLoading) {
    return (
      <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
        height:'100%', gap:16, textAlign:'center', padding:'0 24px' }}>
        <div style={{ width:60, height:60, borderRadius:16, background:'#141414',
          display:'flex', alignItems:'center', justifyContent:'center',
          boxShadow:'0 1px 2px rgba(0,0,0,0.3)' }}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#3a4f56" strokeWidth="1.5">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
          </svg>
        </div>
        <div>
          <div style={{ fontSize:16, fontWeight:500, color:'#c4cbd0' }}>No prediction yet</div>
          <div style={{ fontSize:12, color:'#938f99', marginTop:4 }}>Upload a mesh and run prediction to see results</div>
        </div>
      </div>
    )
  }

  if (isLoading && !result) {
    return (
      <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
        height:'100%', gap:16 }}>
        <div style={{ width:44, height:44, borderRadius:'50%',
          border:'2px solid #243339', borderTopColor:'#4dd8e8', animation:'spin 1s linear infinite' }} />
        <div style={{ fontSize:14, color:'#938f99' }}>Running inference…</div>
        <div style={{ fontSize:11, color:'#938f99', opacity:0.7 }}>Mesh decimation + IDW interpolation</div>
      </div>
    )
  }

  const r = result

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16, height:'100%', overflowY:'auto', paddingRight:2 }}>

      {/* Section label */}
      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
        <div style={{ width:22, height:22, borderRadius:'50%', background:'#00363d',
          display:'flex', alignItems:'center', justifyContent:'center',
          fontSize:11, fontWeight:700, color:'#4dd8e8' }}>4</div>
        <span style={{ fontSize:11, fontWeight:500, letterSpacing:'0.08em',
          textTransform:'uppercase', color:'#938f99' }}>Prediction Results</span>
      </div>

      {/* Hero Cd card */}
      <div className="m3-card" style={{ padding:20, background:'rgba(77,216,232,0.04)', borderColor:'rgba(77,216,232,0.2)' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:6 }}>
          <span style={{ fontSize:11, fontWeight:500, letterSpacing:'0.08em', textTransform:'uppercase', color:'#938f99' }}>
            Drag Coefficient
          </span>
          <ConfBadge conf={r.confidence} />
        </div>
        <div style={{ display:'flex', alignItems:'baseline', gap:10 }}>
          <span style={{ fontSize:56, fontWeight:300, lineHeight:1,
            fontFamily:'Roboto Mono', fontVariantNumeric:'tabular-nums', color:'#4dd8e8',
            textShadow:'0 0 24px rgba(77,216,232,0.4)' }}>
            <AnimatedNumber value={r.Cd} decimals={3} color="#4dd8e8" />
          </span>
          <span style={{ fontSize:16, color:'#938f99' }}>Cd</span>
        </div>
        <CdGauge Cd={r.Cd} />
        <div style={{ display:'flex', justifyContent:'space-between', marginTop:12,
          paddingTop:12, borderTop:'1px solid #243339' }}>
          <span style={{ fontSize:12, color:'#938f99' }}>{r.bodyTypeLabel}</span>
          <span style={{ fontFamily:'Roboto Mono', fontSize:11, color:'#938f99', fontVariantNumeric:'tabular-nums' }}>
            {Math.round(r.inferenceMs)} ms
          </span>
        </div>
      </div>

      {/* 2×2 stats grid */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
        <StatCard label="Lift Coef." value={r.Cl?.toFixed(3)} unit="CL"
          color={r.Cl < 0 ? '#4ade80' : '#f87171'} />
        <StatCard label="Side Coef." value={r.Cs?.toFixed(3)} unit="CS" />
        <StatCard label="Drag Force" value={Math.round(r.dragForceN)} unit="N" />
        <StatCard label="Lift Force" value={Math.round(r.liftForceN)} unit="N"
          color={r.liftForceN < 0 ? '#4ade80' : '#f87171'} />
      </div>

      {/* Derived metrics */}
      <div className="m3-card" style={{ padding:12 }}>
        <div style={{ fontSize:11, fontWeight:500, letterSpacing:'0.08em', textTransform:'uppercase',
          color:'#938f99', marginBottom:10 }}>Derived Aero Metrics</div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
          {[
            { label:'Drag Area CdA',   val:`${r.CdA?.toFixed(3)} m²`,    color:'#fff', tip:'Cd × A_ref — the key drag figure for vehicle comparison' },
            { label:'L/D Ratio',       val:r.ldRatio?.toFixed(2),          color:'#4dd8e8', tip:'|Cl/Cd| — aero efficiency ratio' },
            { label:'Power Loss',      val:`${(r.powerDragW/1000)?.toFixed(1)} kW`, color:'#fbbf24', tip:'Drag power = F_drag × V at current speed' },
            { label:'Reynolds No.',    val:`${(r.reynoldsNumber/1e6)?.toFixed(1)}M`, color:'#a78bfa', tip:'Re = ρUL/μ — flow regime indicator' },
            { label:'Dyn. Pressure',   val:`${r.qInfPa?.toFixed(0)} Pa`,   color:'#fff', tip:'q∞ = ½ρU²' },
            { label:'Yaw Angle',       val:`${r.simParams?.yawAngleDeg?.toFixed(1)}°`, color:'#fff', tip:'Crosswind yaw angle used in this run' },
          ].map(m => (
            <div key={m.label} title={m.tip} style={{ display:'flex', flexDirection:'column', gap:2, cursor:'help' }}>
              <span style={{ fontSize:10, color:'#938f99', textTransform:'uppercase', letterSpacing:'0.06em' }}>{m.label}</span>
              <span style={{ fontFamily:'Roboto Mono', fontSize:13, color:m.color, fontVariantNumeric:'tabular-nums' }}>{m.val}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Drag breakdown */}
      <div className="m3-card" style={{ padding:14 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
          <span style={{ fontSize:11, fontWeight:500, letterSpacing:'0.08em', textTransform:'uppercase', color:'#938f99' }}>
            Drag Contribution
          </span>
          <span style={{ fontSize:11, color:'#938f99' }}>% of total Cd</span>
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {r.dragBreakdown?.map((b, i) => (
            <BreakdownBar key={b.region} region={b.region}
              fraction={b.fraction} color={REGION_COLORS[i]} index={i} />
          ))}
        </div>
      </div>

      {/* Cp stats */}
      <CpStatsCard cpStats={r.cpStats} />

      {/* Geometry */}
      <GeometryCard geo={r.geometry} />

      {/* Benchmarks */}
      <div className="m3-card" style={{ padding:14 }}>
        <button onClick={()=>setShowBenchmarks(s=>!s)}
          style={{ width:'100%', display:'flex', justifyContent:'space-between', alignItems:'center',
            background:'none', border:'none', cursor:'pointer', padding:0 }}>
          <span style={{ fontSize:11, fontWeight:500, letterSpacing:'0.08em', textTransform:'uppercase', color:'#938f99' }}>
            vs Known Vehicles
          </span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#938f99" strokeWidth="2"
            style={{ transform: showBenchmarks ? 'rotate(180deg)' : 'none', transition:'transform 200ms' }}>
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>
        {showBenchmarks && (
          <div style={{ marginTop:12 }}>
            {CD_BENCHMARKS.map(b => (
              <BenchmarkRow key={b.name} name={b.name} Cd={b.Cd} thisCd={r.Cd} />
            ))}
          </div>
        )}
      </div>

      {/* History */}
      {history.length > 0 && (
        <div>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
            <div style={{ width:22, height:22, borderRadius:'50%', background:'#00363d',
              display:'flex', alignItems:'center', justifyContent:'center',
              fontSize:11, fontWeight:700, color:'#4dd8e8' }}>5</div>
            <span style={{ fontSize:11, fontWeight:500, letterSpacing:'0.08em',
              textTransform:'uppercase', color:'#938f99' }}>Run History</span>
          </div>
          <div style={{ display:'flex', flexDirection:'column' }}>
            {[...history].reverse().map((item, i, arr) => (
              <HistoryRow key={item.id} item={item} index={history.length-1-i}
                prevCd={i < arr.length-1 ? arr[i+1].Cd : null} />
            ))}
          </div>
        </div>
      )}

      {/* Sim params echo */}
      {r.simParams && (
        <div className="m3-card" style={{ padding:12 }}>
          <div style={{ fontSize:11, fontWeight:500, letterSpacing:'0.08em', textTransform:'uppercase',
            color:'#938f99', marginBottom:8 }}>Simulation Parameters</div>
          <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
            {[
              ['Solver',       r.simParams.solverType],
              ['Turbulence',   r.simParams.turbulenceModel],
              ['U∞',           `${r.simParams.uRef} m/s`],
              ['ρ',            `${r.simParams.rho} kg/m³`],
              ['A_ref',        `${r.simParams.aRef} m²`],
              ['Yaw',          `${r.simParams.yawAngleDeg}°`],
              ['Ride height',  `${r.simParams.groundClearanceMm} mm`],
            ].map(([k,v]) => (
              <div key={k} style={{ display:'flex', justifyContent:'space-between', fontSize:12 }}>
                <span style={{ color:'#938f99' }}>{k}</span>
                <span style={{ fontFamily:'Roboto Mono', color:'#c4cbd0', fontSize:11 }}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  )
}
