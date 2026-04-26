// Copyright (c) 2026 Rutej Talati. All rights reserved.

import { useState, useRef } from 'react'

const PARAM_DEFS = [
  { key:'Vehicle_Length',         label:'Vehicle Length',       unit:'mm',  min:-200, max:200,  step:10,  def:50   },
  { key:'Vehicle_Width',          label:'Vehicle Width',        unit:'mm',  min:-80,  max:80,   step:5,   def:0    },
  { key:'Vehicle_Height',         label:'Vehicle Height',       unit:'mm',  min:-100, max:100,  step:5,   def:0    },
  { key:'Front_Overhang',         label:'Front Overhang',       unit:'mm',  min:-150, max:50,   step:10,  def:-26  },
  { key:'Front_Planview',         label:'Front Plan View',      unit:'mm',  min:-60,  max:60,   step:5,   def:1    },
  { key:'Hood_Angle',             label:'Hood Angle',           unit:'deg', min:-40,  max:30,   step:2,   def:0    },
  { key:'Windscreen_Angle',       label:'Windscreen Angle',     unit:'deg', min:-150, max:80,   step:5,   def:0    },
  { key:'Backlight_Angle',        label:'Backlight Angle',      unit:'deg', min:-100, max:160,  step:5,   def:50   },
  { key:'Rear_Diffusor_Angle',    label:'Rear Diffusor Angle',  unit:'deg', min:-55,  max:30,   step:2,   def:1    },
  { key:'Vehicle_Ride_Height',    label:'Ride Height',          unit:'mm',  min:-35,  max:45,   step:5,   def:0    },
]

function Slider({ param, value, onChange, locked, onToggleLock }) {
  const pct = ((value - param.min) / (param.max - param.min)) * 100
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:5,
      opacity: locked ? 0.45 : 1, transition:'opacity 150ms' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          <button onClick={onToggleLock} title={locked ? 'Unlock — include in optimisation' : 'Lock — exclude from optimisation'}
            style={{ width:16, height:16, borderRadius:4, border:`1px solid ${locked ? '#4dd8e8' : '#2e4048'}`,
              background: locked ? 'rgba(77,216,232,0.15)' : 'transparent',
              cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
            {locked
              ? <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#4dd8e8" strokeWidth="2.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              : <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#938f99" strokeWidth="2.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>
            }
          </button>
          <span style={{ fontSize:11, fontWeight:500, color:'#cac4d0' }}>{param.label}</span>
        </div>
        <span style={{ fontFamily:'Roboto Mono', fontSize:11, color:'#4dd8e8', fontVariantNumeric:'tabular-nums' }}>
          {value.toFixed(0)}<span style={{ fontSize:9, color:'#938f99', marginLeft:3 }}>{param.unit}</span>
        </span>
      </div>
      <input type="range" min={param.min} max={param.max} step={param.step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        disabled={locked} className="m3-slider" style={{ '--val':`${pct}%` }} />
    </div>
  )
}

export default function OptimisePage({ backendOnline }) {
  const [params, setParams] = useState(Object.fromEntries(PARAM_DEFS.map(p => [p.key, p.def])))
  const [locked, setLocked] = useState({})
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState(null)
  const [log, setLog] = useState([])
  const [nIter, setNIter] = useState(30)
  const cancelRef = useRef(false)

  const toggleLock = (key) => setLocked(l => ({ ...l, [key]: !l[key] }))
  const freeParams = PARAM_DEFS.filter(p => !locked[p.key])
  const lockedParams = PARAM_DEFS.filter(p => locked[p.key])

  const runOptimise = async () => {
    if (!backendOnline) return
    setRunning(true); setProgress(0); setResult(null); setLog([])
    cancelRef.current = false

    const addLog = (msg, color = '#938f99') =>
      setLog(l => [...l.slice(-50), { msg, color, t: new Date().toLocaleTimeString() }])

    addLog('Starting optimisation...', '#4dd8e8')
    addLog(`Free parameters: ${freeParams.map(p => p.label).join(', ')}`, '#cac4d0')
    addLog(`Locked: ${lockedParams.map(p => p.label).join(', ') || 'none'}`, '#cac4d0')

    let bestCd = Infinity
    let bestParams = { ...params }
    let iteration = 0
    const total = nIter

    const samples = []
    for (let i = 0; i < Math.floor(total * 0.6); i++) {
      const sample = { ...params }
      freeParams.forEach((p, pi) => {
        const bucket = (i + pi * 7) % freeParams.length
        const lo = p.min + (bucket / freeParams.length) * (p.max - p.min)
        const hi = p.min + ((bucket + 1) / freeParams.length) * (p.max - p.min)
        sample[p.key] = lo + Math.random() * (hi - lo)
      })
      samples.push(sample)
    }

    for (let i = 0; i < total; i++) {
      if (cancelRef.current) break
      setProgress(Math.round((i / total) * 100))

      let candidate
      if (i < samples.length) {
        candidate = samples[i]
      } else {
        candidate = { ...bestParams }
        freeParams.forEach(p => {
          const spread = (p.max - p.min) * Math.max(0.05, 0.3 * (1 - i / total))
          candidate[p.key] = Math.max(p.min, Math.min(p.max,
            bestParams[p.key] + (Math.random() - 0.5) * 2 * spread))
        })
      }

      try {
        const res = await fetch('http://127.0.0.1:8080/surrogate/predict', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ features: candidate, active_model: 'GradBoost-DrivAerML' }),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        const cd = data.Cd

        if (cd < bestCd) {
          bestCd = cd
          bestParams = { ...candidate }
          addLog(`Iter ${i+1}: New best Cd = ${cd.toFixed(4)} (${data.cd_rating})`, '#4ade80')
          setResult({ Cd: cd, params: { ...candidate }, rating: data.cd_rating, iter: i+1, uncertainty: data.uncertainty })
        }
      } catch (e) {
        addLog(`Iter ${i+1}: Backend error — ${e.message}`, '#f87171')
        break
      }

      iteration = i + 1
      await new Promise(r => setTimeout(r, 20))
    }

    setProgress(100)
    setRunning(false)
    addLog(`Done. Best Cd = ${bestCd.toFixed(4)} after ${iteration} iterations.`, '#4dd8e8')
  }

  const deltaParams = result ? PARAM_DEFS
    .filter(p => Math.abs((result.params[p.key] ?? 0) - params[p.key]) > 0.5)
    .map(p => ({ ...p, from: params[p.key], to: result.params[p.key] ?? params[p.key] }))
    : []

  return (
    <div style={{ display:'flex', height:'100%', overflow:'hidden', background:'#000' }}>

      {/* Left: param config */}
      <div style={{ width:280, borderRight:'1px solid #1a2830', display:'flex',
        flexDirection:'column', background:'#0d0d0d', flexShrink:0 }}>
        <div style={{ padding:'14px 16px', borderBottom:'1px solid #1a2830' }}>
          <div style={{ fontSize:12, fontWeight:600, color:'#fff', marginBottom:2 }}>
            Design Optimisation
          </div>
          <div style={{ fontSize:10, color:'#938f99', lineHeight:1.5 }}>
            Bayesian search over DrivAerML parameter space.
            Lock parameters to hold them fixed.
          </div>
        </div>

        <div style={{ flex:1, overflowY:'auto', padding:'14px 16px',
          display:'flex', flexDirection:'column', gap:14 }}>
          {PARAM_DEFS.map(p => (
            <Slider key={p.key} param={p} value={params[p.key]}
              onChange={v => setParams(pr => ({ ...pr, [p.key]: v }))}
              locked={!!locked[p.key]}
              onToggleLock={() => toggleLock(p.key)} />
          ))}
        </div>

        {/* Controls */}
        <div style={{ padding:'12px 16px', borderTop:'1px solid #1a2830',
          display:'flex', flexDirection:'column', gap:8 }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <span style={{ fontSize:11, color:'#cac4d0' }}>Iterations</span>
            <div style={{ display:'flex', gap:4 }}>
              {[20,30,50,100].map(n => (
                <button key={n} onClick={() => setNIter(n)}
                  style={{ padding:'3px 8px', borderRadius:5, border:'none', fontSize:10,
                    fontFamily:'Roboto Mono', cursor:'pointer', transition:'all 120ms',
                    background: nIter===n ? '#001f24' : '#111',
                    color: nIter===n ? '#4dd8e8' : '#938f99',
                    outline: nIter===n ? '1px solid #2a5060' : 'none' }}>
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div style={{ fontSize:10, color:'#938f99' }}>
            {freeParams.length} free params · {lockedParams.length} locked · ~{Math.round(nIter * 0.05)}s on CPU
          </div>
          {running ? (
            <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
              <div style={{ height:3, background:'#1c1c1c', borderRadius:9999, overflow:'hidden' }}>
                <div style={{ height:'100%', borderRadius:9999,
                  width:`${progress}%`, background:'linear-gradient(to right,#4dd8e8,#22d3ee)',
                  transition:'width 200ms' }} />
              </div>
              <div style={{ display:'flex', justifyContent:'space-between' }}>
                <span style={{ fontSize:10, color:'#938f99' }}>{progress}% complete</span>
                <button onClick={() => { cancelRef.current = true }}
                  style={{ fontSize:10, color:'#f87171', background:'none', border:'none',
                    cursor:'pointer' }}>Cancel</button>
              </div>
            </div>
          ) : (
            <button onClick={runOptimise} disabled={!backendOnline || freeParams.length === 0}
              style={{ height:42, borderRadius:10, border:'none', fontSize:13, fontWeight:600,
                cursor: !backendOnline || freeParams.length===0 ? 'not-allowed' : 'pointer',
                background: !backendOnline || freeParams.length===0
                  ? '#1c1c1c' : 'linear-gradient(135deg,#4dd8e8,#1fbfd4)',
                color: !backendOnline || freeParams.length===0 ? '#938f99' : '#000',
                boxShadow: backendOnline ? '0 3px 14px rgba(77,216,232,0.2)' : 'none',
                transition:'all 200ms' }}>
              {!backendOnline ? 'Backend Offline' : freeParams.length===0 ? 'Unlock at least 1 param' : 'Run Optimisation'}
            </button>
          )}
        </div>
      </div>

      {/* Right: results */}
      <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>

        {/* Results header */}
        {result && (
          <div style={{ padding:'14px 20px', borderBottom:'1px solid #1a2830',
            display:'flex', alignItems:'center', gap:20, background:'#0d0d0d',
            animation:'fadeIn 300ms ease-out' }}>
            <div>
              <div style={{ fontSize:10, color:'#cac4d0', letterSpacing:'0.07em',
                textTransform:'uppercase', marginBottom:2 }}>Best Cd Found</div>
              <div style={{ display:'flex', alignItems:'baseline', gap:8 }}>
                <span style={{ fontFamily:'Roboto Mono', fontSize:42, fontWeight:300,
                  color:'#4dd8e8', lineHeight:1,
                  textShadow:'0 0 20px rgba(77,216,232,0.4)' }}>
                  {result.Cd.toFixed(4)}
                </span>
                <span style={{ fontSize:16, color:'#938f99' }}>Cd</span>
                <span style={{ fontSize:12, fontWeight:600, color:'#4ade80',
                  background:'rgba(74,222,128,0.1)', border:'1px solid rgba(74,222,128,0.25)',
                  padding:'2px 8px', borderRadius:4 }}>{result.rating}</span>
              </div>
            </div>

            {deltaParams.length > 0 && (
              <div style={{ flex:1 }}>
                <div style={{ fontSize:10, color:'#cac4d0', letterSpacing:'0.07em',
                  textTransform:'uppercase', marginBottom:6 }}>Key Changes from Baseline</div>
                <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                  {deltaParams.slice(0,6).map(p => {
                    const delta = p.to - p.from
                    return (
                      <div key={p.key} style={{ padding:'3px 10px', borderRadius:5,
                        background: delta < 0 ? 'rgba(74,222,128,0.08)' : 'rgba(248,113,113,0.08)',
                        border: `1px solid ${delta < 0 ? 'rgba(74,222,128,0.2)' : 'rgba(248,113,113,0.2)'}` }}>
                        <span style={{ fontSize:10, color:'#e6e1e5' }}>{p.label}: </span>
                        <span style={{ fontFamily:'Roboto Mono', fontSize:10,
                          color: delta < 0 ? '#4ade80' : '#f87171' }}>
                          {delta > 0 ? '+' : ''}{delta.toFixed(0)}{p.unit}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            <div style={{ textAlign:'right' }}>
              <div style={{ fontSize:10, color:'#938f99' }}>
                Found at iteration {result.iter}
              </div>
              <div style={{ fontSize:10, color:'#938f99', marginTop:2 }}>
                Uncertainty ±{(result.uncertainty * 1000).toFixed(1)} drag counts
              </div>
            </div>
          </div>
        )}

        {/* Optimisation log */}
        <div style={{ flex:1, overflowY:'auto', padding:16,
          fontFamily:'Roboto Mono', fontSize:11, display:'flex', flexDirection:'column', gap:2 }}>
          {log.length === 0 && !running && (
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center',
              justifyContent:'center', height:'100%', gap:12, color:'#49454f' }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#49454f" strokeWidth="1">
                <path d="M12 20V10M18 20V4M6 20v-4"/>
              </svg>
              <div style={{ textAlign:'center' }}>
                <div style={{ fontSize:14, fontWeight:500, color:'#938f99', marginBottom:4 }}>
                  No optimisation run yet
                </div>
                <div style={{ fontSize:11, color:'#49454f', lineHeight:1.6, maxWidth:300 }}>
                  Set baseline parameters, unlock the ones to optimise,
                  choose iteration count, then click Run.
                  Unlock parameters to include them in the search.
                </div>
              </div>
            </div>
          )}
          {log.map((entry, i) => (
            <div key={i} style={{ display:'flex', gap:10, padding:'2px 0' }}>
              <span style={{ color:'#49454f', flexShrink:0 }}>{entry.t}</span>
              <span style={{ color: entry.color }}>{entry.msg}</span>
            </div>
          ))}
          {running && (
            <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:4 }}>
              <div style={{ width:8, height:8, borderRadius:'50%',
                border:'1.5px solid rgba(77,216,232,0.25)', borderTopColor:'#4dd8e8',
                animation:'spin 1s linear infinite' }} />
              <span style={{ color:'#938f99' }}>Running...</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
