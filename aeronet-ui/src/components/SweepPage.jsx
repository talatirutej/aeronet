// Copyright (c) 2026 Rutej Talati. All rights reserved.

import { useState, useRef, useCallback } from 'react'
import { predict } from '../lib/predict'

const SWEEP_PARAMS = [
  { id:'sizeFactor', label:'Size Factor',     unit:'×',    min:0.85, max:1.15, step:0.015, default:1.0,   pts:14, fmt:v=>v.toFixed(3) },
  { id:'uRef',       label:'Inflow Velocity', unit:'m/s',  min:20,   max:80,   step:5,     default:40,    pts:13, fmt:v=>v.toFixed(0)  },
  { id:'rho',        label:'Air Density',     unit:'kg/m³',min:0.9,  max:1.4,  step:0.025, default:1.225, pts:21, fmt:v=>v.toFixed(3)  },
  { id:'aRef',       label:'Frontal Area',    unit:'m²',   min:1.8,  max:3.2,  step:0.1,   default:2.37,  pts:15, fmt:v=>v.toFixed(2)  },
]
const BODY_TYPES = ['fastback','notchback','estate','suv','pickup']
const BT_COLORS  = { fastback:'#0A84FF', notchback:'#30D158', estate:'#FFD60A', suv:'#FF453A', pickup:'#BF5AF2' }

function hash(s){ let h=0x811c9dc5; for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,0x01000193)>>>0} return h }

function SectionLabel({ n, t }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
      <span style={{ fontSize:10, fontWeight:600, color:'var(--text-primary)', fontFamily:"'IBM Plex Mono'" }}>{n}</span>
      <div style={{ flex:1, height:0.5, background:'var(--sep)' }}/>
      <span style={{ fontSize:10, fontWeight:600, color:'var(--text-quaternary)', letterSpacing:'0.08em', textTransform:'uppercase' }}>{t}</span>
    </div>
  )
}

function Slider({ label, unit, min, max, step, value, fmt, onChange }) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div style={{ marginBottom:14 }}>
      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:7 }}>
        <span style={{ fontSize:12, color:'var(--text-tertiary)' }}>{label}</span>
        <span style={{ fontSize:12, fontWeight:600, color:'var(--text-primary)', fontFamily:"'IBM Plex Mono'" }}>{fmt(value)} <span style={{ color:'var(--text-quaternary)', fontWeight:400, fontSize:10 }}>{unit}</span></span>
      </div>
      <div style={{ position:'relative', height:18, display:'flex', alignItems:'center' }}>
        <div style={{ position:'absolute', left:0, right:0, height:2, borderRadius:9999, background:'var(--bg3)' }}>
          <div style={{ position:'absolute', left:0, top:0, height:'100%', borderRadius:9999, background:'var(--blue)', width:`${pct}%`, transition:'width 0.04s' }}/>
        </div>
        <input type="range" min={min} max={max} step={step} value={value} onChange={e=>onChange(parseFloat(e.target.value))}
          style={{ position:'absolute', inset:0, width:'100%', opacity:0, cursor:'pointer', zIndex:2 }}/>
        <div style={{ position:'absolute', top:'50%', transform:'translate(-50%,-50%)', left:`${pct}%`, width:16, height:16, borderRadius:'50%', background:'#fff', boxShadow:'0 1px 5px rgba(0,0,0,0.5)', pointerEvents:'none', zIndex:1, transition:'left 0.04s' }}/>
      </div>
    </div>
  )
}

export default function SweepPage() {
  const [sweepId,   setSweepId]   = useState('sizeFactor')
  const [btSingle,  setBtSingle]  = useState('fastback')
  const [multiBody, setMultiBody] = useState(false)
  const [fixed,     setFixed]     = useState({ uRef:40, rho:1.225, aRef:2.37, sizeFactor:1.0 })
  const [running,   setRunning]   = useState(false)
  const [progress,  setProgress]  = useState(0)
  const [data,      setData]      = useState(null)
  const [hovX,      setHovX]      = useState(null)
  const cancelRef = useRef(false)

  const param  = SWEEP_PARAMS.find(p => p.id === sweepId)
  const bodies = multiBody ? BODY_TYPES : [btSingle]

  const runSweep = async () => {
    cancelRef.current = false
    setRunning(true); setProgress(0); setData(null)
    const xs = Array.from({ length: param.pts }, (_, i) => param.min + i * (param.max - param.min) / (param.pts - 1))
    const series = {}
    let done = 0, total = xs.length * bodies.length
    for (const bt of bodies) {
      series[bt] = []
      for (const xVal of xs) {
        if (cancelRef.current) break
        const p = { bodyType:bt, uRef:sweepId==='uRef'?xVal:fixed.uRef, rho:sweepId==='rho'?xVal:fixed.rho, aRef:sweepId==='aRef'?xVal:fixed.aRef, sizeFactor:sweepId==='sizeFactor'?xVal:fixed.sizeFactor }
        const demoFile = new File([`${bt}${xVal}`], `sweep.vtk`, { type:'model/vtk' })
        try { const r = await predict(demoFile, p); series[bt].push({ x:xVal, Cd:r.Cd, Cl:r.Cl, conf:r.confidence, ms:r.inferenceMs }) }
        catch { series[bt].push({ x:xVal, Cd:0.30, Cl:0, conf:0.5, ms:0 }) }
        done++; setProgress(Math.round(done/total*100))
      }
    }
    setData({ sweepId, series }); setRunning(false)
  }

  const cancel = () => { cancelRef.current = true; setRunning(false) }

  // Chart geometry
  const CW=660, CH=280, PL=58, PR=28, PT=24, PB=42
  const cW=CW-PL-PR, cH=CH-PT-PB
  const allPts = data ? Object.values(data.series).flat() : []
  const xMin=param.min, xMax=param.max
  const cdAll = allPts.map(p=>p.Cd)
  const cdMin = cdAll.length ? Math.min(...cdAll)-0.005 : 0.22
  const cdMax = cdAll.length ? Math.max(...cdAll)+0.005 : 0.44
  const px = x => PL + ((x-xMin)/(xMax-xMin))*cW
  const py = y => PT + cH - ((y-cdMin)/(cdMax-cdMin))*cH
  const yTicks = Array.from({length:5},(_,i)=>cdMin+i*(cdMax-cdMin)/4)
  const xTicks = Array.from({length:5},(_,i)=>xMin+i*(xMax-xMin)/4)
  const linePath = pts => pts.map((p,i)=>`${i?'L':'M'} ${px(p.x).toFixed(1)} ${py(p.Cd).toFixed(1)}`).join(' ')
  const hovPts = data ? Object.values(data.series)[0] : []
  const hovIdx = hovX !== null ? hovPts.findIndex(p=>Math.abs(p.x-hovX)<(xMax-xMin)/param.pts) : -1

  const sideStyle = { width:272, flexShrink:0, display:'flex', flexDirection:'column', gap:0, padding:'16px 14px', borderRight:'0.5px solid var(--sep)', overflowY:'auto', background:'var(--bg0)' }
  const cardStyle = { background:'var(--bg1)', borderRadius:12, border:'0.5px solid rgba(255,255,255,0.06)', overflow:'hidden', marginBottom:14 }

  return (
    <div style={{ display:'flex', height:'100%', overflow:'hidden', background:'var(--bg0)' }}>

      {/* Sidebar */}
      <div style={sideStyle}>

        <SectionLabel n="01" t="Sweep Variable"/>
        <div style={cardStyle}>
          {SWEEP_PARAMS.map((sp,i) => (
            <button key={sp.id} onClick={()=>setSweepId(sp.id)} style={{
              width:'100%', textAlign:'left', padding:'10px 14px', border:'none', cursor:'pointer',
              background: sweepId===sp.id ? 'rgba(10,132,255,0.14)' : 'transparent',
              borderBottom: i<SWEEP_PARAMS.length-1 ? '0.5px solid var(--sep)' : 'none',
              display:'flex', justifyContent:'space-between', alignItems:'center',
              transition:'background 0.12s',
              fontFamily:"'IBM Plex Sans'",
            }}>
              <div>
                <div style={{ fontSize:13, fontWeight:500, color: sweepId===sp.id ? 'var(--blue)' : 'rgba(255,255,255,0.7)' }}>{sp.label}</div>
                <div style={{ fontSize:11, color:'var(--text-quaternary)', marginTop:2 }}>{sp.pts} pts · {sp.unit}</div>
              </div>
              {sweepId===sp.id && <div style={{ width:6, height:6, borderRadius:'50%', background:'var(--blue)', flexShrink:0 }}/>}
            </button>
          ))}
        </div>

        <SectionLabel n="02" t="Body Type"/>
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:12 }}>
          <div onClick={()=>setMultiBody(m=>!m)} style={{ width:36, height:22, borderRadius:11, background: multiBody?'var(--blue)':'var(--bg3)', cursor:'pointer', position:'relative', transition:'background 0.2s', flexShrink:0 }}>
            <div style={{ position:'absolute', top:3, left: multiBody?16:3, width:16, height:16, borderRadius:'50%', background:'#fff', boxShadow:'0 1px 4px rgba(0,0,0,0.4)', transition:'left 0.2s' }}/>
          </div>
          <span style={{ fontSize:12, color:'var(--text-tertiary)' }}>Compare all body types</span>
        </div>
        {!multiBody && (
          <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:14 }}>
            {BODY_TYPES.map(bt=>(
              <button key={bt} onClick={()=>setBtSingle(bt)} style={{
                padding:'4px 12px', borderRadius:8, border:`0.5px solid ${btSingle===bt?(BT_COLORS[bt]+'88'):'var(--sep)'}`,
                background: btSingle===bt ? (BT_COLORS[bt]+'18') : 'transparent',
                color: btSingle===bt ? BT_COLORS[bt] : 'rgba(255,255,255,0.4)',
                fontSize:12, fontWeight:500, cursor:'pointer', transition:'all 0.12s',
                fontFamily:"'IBM Plex Sans'",
              }}>{bt}</button>
            ))}
          </div>
        )}

        <SectionLabel n="03" t="Fixed Conditions"/>
        <div style={{ ...cardStyle, padding:'12px 14px 4px' }}>
          {SWEEP_PARAMS.filter(p=>p.id!==sweepId).map(p=>(
            <Slider key={p.id} label={p.label} unit={p.unit} min={p.min} max={p.max} step={p.step} fmt={p.fmt} value={fixed[p.id]} onChange={v=>setFixed(f=>({...f,[p.id]:v}))}/>
          ))}
        </div>

        {running ? (
          <button onClick={cancel} style={{ width:'100%', height:38, borderRadius:10, border:'0.5px solid rgba(255,69,58,0.4)', background:'transparent', color:'var(--red)', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:"'IBM Plex Sans'", transition:'background 0.12s' }}>
            Cancel
          </button>
        ) : (
          <button onClick={runSweep} disabled={running} style={{ width:'100%', height:38, borderRadius:10, border:'none', background:'var(--blue)', color:'var(--text-primary)', fontSize:13, fontWeight:600, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:6, fontFamily:"'IBM Plex Sans'", transition:'opacity 0.15s' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            Run Sweep
          </button>
        )}

        {running && (
          <div style={{ marginTop:10 }}>
            <div style={{ height:2, background:'var(--bg3)', borderRadius:2, overflow:'hidden' }}>
              <div style={{ height:'100%', background:'var(--blue)', borderRadius:2, width:`${progress}%`, transition:'width 0.2s' }}/>
            </div>
            <div style={{ display:'flex', justifyContent:'space-between', marginTop:5, fontSize:11, color:'var(--text-tertiary)', fontFamily:"'IBM Plex Mono'" }}>
              <span>{bodies.length} bod{bodies.length>1?'ies':'y'} · {param.pts} pts</span>
              <span>{progress}%</span>
            </div>
          </div>
        )}

        {data && !running && (
          <>
            <div style={{ marginTop:16, marginBottom:10 }}><SectionLabel n="04" t="Summary"/></div>
            <div style={cardStyle}>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', padding:'7px 12px', borderBottom:'0.5px solid var(--sep)', fontSize:10, color:'var(--text-quaternary)', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.06em' }}>
                <span>Body</span><span style={{ textAlign:'right' }}>Min Cd</span><span style={{ textAlign:'right' }}>Max Cd</span>
              </div>
              {Object.entries(data.series).map(([bt,pts],i,arr)=>{
                const cds=pts.map(p=>p.Cd), clr=BT_COLORS[bt]
                return (
                  <div key={bt} style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', padding:'8px 12px', borderBottom: i<arr.length-1?'0.5px solid var(--sep)':'none' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                      <span style={{ width:6, height:6, borderRadius:'50%', background:clr, flexShrink:0 }}/>
                      <span style={{ fontSize:12, color:clr, fontWeight:500 }}>{bt}</span>
                    </div>
                    <span style={{ fontSize:12, fontWeight:600, color:'var(--blue)', textAlign:'right', fontFamily:"'IBM Plex Mono'", fontVariantNumeric:'tabular-nums' }}>{Math.min(...cds).toFixed(4)}</span>
                    <span style={{ fontSize:12, color:'var(--text-tertiary)', textAlign:'right', fontFamily:"'IBM Plex Mono'", fontVariantNumeric:'tabular-nums' }}>{Math.max(...cds).toFixed(4)}</span>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>

      {/* Chart panel */}
      <div style={{ flex:1, display:'flex', flexDirection:'column', padding:'16px', gap:12, overflow:'hidden' }}>
        <div style={{ flex:1, ...cardStyle, display:'flex', flexDirection:'column' }}>
          {/* Chart header */}
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 16px', borderBottom:'0.5px solid var(--sep)', flexShrink:0 }}>
            <div>
              <span style={{ fontSize:14, fontWeight:600, color:'var(--text-primary)' }}>Cd vs {param.label}</span>
              <span style={{ fontSize:11, color:'var(--text-quaternary)', marginLeft:10 }}>{param.pts} pts · {bodies.length} body type{bodies.length>1?'s':''}</span>
            </div>
            <div style={{ display:'flex', gap:14 }}>
              {data && Object.keys(data.series).map(bt=>(
                <div key={bt} style={{ display:'flex', alignItems:'center', gap:5 }}>
                  <div style={{ width:20, height:2, borderRadius:1, background:BT_COLORS[bt] }}/>
                  <span style={{ fontSize:11, color:'var(--text-tertiary)' }}>{bt}</span>
                </div>
              ))}
            </div>
          </div>

          {/* SVG Chart */}
          <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', padding:'8px', overflow:'hidden' }}
            onMouseMove={e=>{
              if (!data) return
              const rect=e.currentTarget.getBoundingClientRect()
              const relX=(e.clientX-rect.left-PL)/(rect.width-PL-PR)
              const hv=xMin+relX*(xMax-xMin)
              if(hv>=xMin&&hv<=xMax)setHovX(hv)
            }}
            onMouseLeave={()=>setHovX(null)}>
            {!data && !running ? (
              <div style={{ textAlign:'center' }}>
                <div style={{ fontSize:13, color:'var(--text-quaternary)', marginBottom:6 }}>Configure sweep and run</div>
                <div style={{ fontSize:11, color:'var(--text-quaternary)' }}>Results will appear here</div>
              </div>
            ) : (
              <svg viewBox={`0 0 ${CW} ${CH}`} style={{ width:'100%', height:'100%', maxHeight:320 }}>
                <defs>
                  {BODY_TYPES.map(bt=>(
                    <linearGradient key={bt} id={`swg_${bt}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={BT_COLORS[bt]} stopOpacity="0.14"/>
                      <stop offset="100%" stopColor={BT_COLORS[bt]} stopOpacity="0.02"/>
                    </linearGradient>
                  ))}
                </defs>
                {yTicks.map((y,i)=>(
                  <g key={i}>
                    <line x1={PL} y1={py(y)} x2={PL+cW} y2={py(y)} stroke="rgba(255,255,255,0.05)" strokeWidth="0.8"/>
                    <text x={PL-6} y={py(y)+4} textAnchor="end" fill="rgba(255,255,255,0.28)" fontSize="9" fontFamily="'IBM Plex Mono',monospace">{y.toFixed(3)}</text>
                  </g>
                ))}
                {xTicks.map((x,i)=>(
                  <g key={i}>
                    <line x1={px(x)} y1={PT} x2={px(x)} y2={PT+cH} stroke="rgba(255,255,255,0.05)" strokeWidth="0.8"/>
                    <text x={px(x)} y={PT+cH+14} textAnchor="middle" fill="rgba(255,255,255,0.28)" fontSize="9" fontFamily="'IBM Plex Mono',monospace">{param.fmt(x)}</text>
                  </g>
                ))}
                <text x={PL+cW/2} y={CH-4} textAnchor="middle" fill="rgba(255,255,255,0.35)" fontSize="10" fontFamily="'IBM Plex Sans',sans-serif" letterSpacing="0.05em">{param.label.toUpperCase()} ({param.unit})</text>
                <text x={12} y={PT+cH/2} textAnchor="middle" fill="rgba(255,255,255,0.35)" fontSize="10" fontFamily="'IBM Plex Sans',sans-serif" transform={`rotate(-90,12,${PT+cH/2})`}>Cd</text>
                <rect x={PL} y={PT} width={cW} height={cH} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="0.8"/>
                {data && Object.entries(data.series).map(([bt,pts])=>{
                  const clr=BT_COLORS[bt]||'var(--blue)'
                  const bandTop=pts.map(p=>`${px(p.x).toFixed(1)},${py(p.Cd+0.008).toFixed(1)}`).join(' L')
                  const bandBot=[...pts].reverse().map(p=>`${px(p.x).toFixed(1)},${py(p.Cd-0.008).toFixed(1)}`).join(' L')
                  return (
                    <g key={bt}>
                      <path d={`M ${bandTop} L ${bandBot} Z`} fill={`url(#swg_${bt})`}/>
                      <path d={linePath(pts)} fill="none" stroke={clr} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"/>
                      {pts.map((p,i)=>(
                        <circle key={i} cx={px(p.x)} cy={py(p.Cd)} r={hovIdx===i?5:3} fill={clr} stroke="rgba(0,0,0,0.8)" strokeWidth="1.2" style={{ cursor:'crosshair', transition:'r 0.1s' }}/>
                      ))}
                    </g>
                  )
                })}
                {hovIdx>=0&&hovPts[hovIdx]&&(
                  <line x1={px(hovPts[hovIdx].x)} y1={PT} x2={px(hovPts[hovIdx].x)} y2={PT+cH} stroke="var(--blue)" strokeWidth="0.8" strokeDasharray="4,4" opacity="0.5"/>
                )}
              </svg>
            )}
          </div>

          {/* Hover strip */}
          {hovIdx>=0&&data&&(
            <div style={{ display:'flex', alignItems:'center', gap:20, padding:'8px 16px', borderTop:'0.5px solid var(--sep)', background:'rgba(255,255,255,0.02)', flexShrink:0 }}>
              <span style={{ fontSize:11, color:'var(--text-tertiary)', fontFamily:"'IBM Plex Mono'" }}>
                {param.label}: {param.fmt(hovPts[hovIdx]?.x??0)} {param.unit}
              </span>
              {Object.entries(data.series).map(([bt,pts])=>(
                <span key={bt} style={{ display:'flex', alignItems:'center', gap:5, fontSize:12, fontFamily:"'IBM Plex Mono'", fontVariantNumeric:'tabular-nums' }}>
                  <span style={{ width:6, height:6, borderRadius:'50%', background:BT_COLORS[bt] }}/>
                  <span style={{ color:BT_COLORS[bt] }}>{bt}:</span>
                  <span style={{ color:'var(--text-secondary)' }}>{pts[hovIdx]?.Cd?.toFixed(4)}</span>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Bottom stat row */}
        {data && (
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10, flexShrink:0 }}>
            {(()=>{
              const all=Object.values(data.series).flat()
              const best=all.reduce((a,b)=>b.Cd<a.Cd?b:a,all[0])
              const worst=all.reduce((a,b)=>b.Cd>a.Cd?b:a,all[0])
              const avgMs=(all.reduce((a,b)=>a+b.ms,0)/all.length).toFixed(0)
              return [
                { label:'Best Cd',    val:best.Cd.toFixed(4),  sub:`at ${param.fmt(best.x)} ${param.unit}`,  c:'var(--green)' },
                { label:'Worst Cd',   val:worst.Cd.toFixed(4), sub:`at ${param.fmt(worst.x)} ${param.unit}`, c:'var(--red)'   },
                { label:'Delta',      val:(worst.Cd-best.Cd).toFixed(4), sub:'max − min',                    c:'var(--orange)'},
                { label:'Avg Latency',val:avgMs+' ms',         sub:`${all.length} inferences`,               c:'rgba(255,255,255,0.5)' },
              ].map(s=>(
                <div key={s.label} style={{ background:'var(--bg1)', borderRadius:12, border:'0.5px solid rgba(255,255,255,0.06)', padding:'12px 14px' }}>
                  <div style={{ fontSize:10, fontWeight:600, color:'var(--text-quaternary)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:6 }}>{s.label}</div>
                  <div style={{ fontSize:20, fontWeight:600, color:s.c, fontFamily:"'IBM Plex Mono'", fontVariantNumeric:'tabular-nums', letterSpacing:'-0.5px' }}>{s.val}</div>
                  <div style={{ fontSize:11, color:'var(--text-quaternary)', marginTop:3 }}>{s.sub}</div>
                </div>
              ))
            })()}
          </div>
        )}
      </div>
      {/* Copyright footer */}
      <div style={{ textAlign: 'center', padding: '10px 0 14px', fontSize: 11, color: 'rgba(255,255,255,0.18)' }}>
        © 2026 Rutej Talati · All rights reserved
      </div>
    </div>
  )
}
