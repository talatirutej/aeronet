// Copyright (c) 2026 Rutej Talati. All rights reserved.

import { useState } from 'react'

const BENCHMARKS = [
  { name:'Tesla Model 3', Cd:0.23 },{ name:'BMW 3 Series',  Cd:0.26 },
  { name:'Audi A4',       Cd:0.27 },{ name:'Toyota Camry',  Cd:0.28 },
  { name:'VW Golf',       Cd:0.30 },{ name:'Porsche 911',   Cd:0.30 },
  { name:'Ford Mustang',  Cd:0.35 },{ name:'Generic SUV',   Cd:0.38 },
]
const DRAG_COLORS=['#FF453A','#FF9F0A','#FFD60A','#30D158','#40CBE0','#6C7C83']

function cdColor(cd) {
  if (cd<0.25) return 'var(--green)'
  if (cd<0.30) return 'var(--blue)'
  if (cd<0.34) return 'var(--orange)'
  return 'var(--red)'
}

function SL({ n, t }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:10, margin:'20px 0 12px' }}>
      <span style={{ fontSize:11, fontWeight:600, color:'var(--blue)', fontFamily:"'IBM Plex Mono'" }}>{n}</span>
      <div style={{ flex:1, height:0.5, background:'var(--sep)' }}/>
      <span style={{ fontSize:10, fontWeight:600, color:'var(--text-quaternary)', letterSpacing:'0.08em', textTransform:'uppercase' }}>{t}</span>
    </div>
  )
}

function IOSInput({ value, onChange, placeholder, style }) {
  return (
    <input value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder}
      style={{
        background:'var(--bg2)', border:'0.5px solid var(--sep)', borderRadius:8,
        padding:'7px 12px', color:'var(--text-secondary)', fontSize:13,
        fontFamily:"'IBM Plex Sans'", outline:'none',
        transition:'border-color 0.15s',
        ...style,
      }}
      onFocus={e=>e.target.style.borderColor='var(--blue)'}
      onBlur={e=>e.target.style.borderColor='var(--sep)'}
    />
  )
}

const card = { background:'var(--bg1)', borderRadius:12, border:'0.5px solid rgba(255,255,255,0.06)', overflow:'hidden' }

export default function ReportPage({ result, history }) {
  const [title,   setTitle]   = useState('AeroNet CFD Surrogate Report')
  const [author,  setAuthor]  = useState('AeroNet v3.0')
  const [project, setProject] = useState('')
  const [notes,   setNotes]   = useState('')

  const now = new Date().toLocaleString('en-GB')
  const hasResult = !!result
  const avgLatency = history.length ? Math.round(history.reduce((a,b)=>a+b.inferenceMs,0)/history.length) : 0

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', background:'var(--bg0)', overflow:'hidden' }}>

      {/* Toolbar */}
      <div className="no-print" style={{
        display:'flex', alignItems:'center', gap:12, padding:'10px 16px',
        borderBottom:'0.5px solid var(--sep)', background:'var(--bg1)', flexShrink:0,
      }}>
        <div>
          <div style={{ fontSize:13, fontWeight:600, color:'var(--text-primary)', letterSpacing:'-0.2px' }}>Report Generator</div>
          <div style={{ fontSize:11, color:'var(--text-quaternary)', marginTop:1 }}>Print · Save as PDF</div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:8, marginLeft:8 }}>
          <IOSInput value={title}   onChange={setTitle}   placeholder="Report title"       style={{ width:220 }}/>
          <IOSInput value={author}  onChange={setAuthor}  placeholder="Author"              style={{ width:130 }}/>
          <IOSInput value={project} onChange={setProject} placeholder="Project / vehicle"   style={{ width:130 }}/>
        </div>
        <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:12 }}>
          <span style={{ fontSize:12, color:'var(--text-tertiary)' }}>
            {history.length} run{history.length!==1?'s':''} · avg {avgLatency} ms
          </span>
          <button onClick={()=>window.print()} style={{
            height:34, padding:'0 18px', borderRadius:9, border:'none',
            background:'var(--blue)', color:'var(--text-primary)', fontSize:13, fontWeight:600,
            cursor:'pointer', fontFamily:"'IBM Plex Sans'",
            display:'flex', alignItems:'center', gap:6, transition:'opacity 0.15s',
          }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6z"/></svg>
            Print / Save PDF
          </button>
        </div>
      </div>

      {/* Report body */}
      <div style={{ flex:1, overflowY:'auto', padding:'24px', background:'rgba(0,0,0,0.3)' }}>
        <div style={{ maxWidth:960, margin:'0 auto' }}>

          {/* Cover card */}
          <div style={{ ...card, padding:'24px 28px', marginBottom:0, animation:'fadeUp 0.3s ease both' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:20 }}>
              <div>
                <div style={{ fontSize:24, fontWeight:700, color:'var(--text-primary)', letterSpacing:'-0.6px', lineHeight:1.2 }}>{title}</div>
                {project && <div style={{ fontSize:16, color:'var(--blue)', marginTop:4, fontWeight:500 }}>{project}</div>}
                <div style={{ fontSize:13, color:'var(--text-tertiary)', marginTop:4 }}>AeroNet CFD Surrogate · DrivAerML 484 HF-LES OpenFOAM cases</div>
              </div>
              <div style={{ textAlign:'right', fontSize:12, color:'var(--text-tertiary)', lineHeight:1.8 }}>
                <div style={{ fontSize:14, fontWeight:600, color:'var(--text-secondary)' }}>{author}</div>
                <div>{now}</div>
                <div style={{ color:'var(--blue)', fontFamily:"'IBM Plex Mono'", fontSize:11 }}>GradBoost · R²=0.9525 · err 5.4%</div>
              </div>
            </div>
            <div style={{ height:0.5, background:'var(--sep)', marginBottom:20 }}/>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:10 }}>
              {[['Model','GradBoost-DrivAerML'],['Training Set','484 HF-LES cases'],['Val Error','Cd err 5.4%'],['Avg Latency',`${avgLatency} ms`],['Total Runs',String(history.length)]].map(([k,v])=>(
                <div key={k} style={{ background:'var(--bg2)', borderRadius:10, padding:'12px', textAlign:'center', border:'0.5px solid rgba(255,255,255,0.05)' }}>
                  <div style={{ fontSize:10, fontWeight:600, color:'var(--text-quaternary)', letterSpacing:'0.06em', textTransform:'uppercase', marginBottom:6 }}>{k}</div>
                  <div style={{ fontSize:13, fontWeight:600, color:'var(--blue)', fontFamily:"'IBM Plex Mono'" }}>{v}</div>
                </div>
              ))}
            </div>
          </div>

          <SL n="01" t="Aerodynamic Coefficients"/>
          {hasResult ? (
            <div style={{ ...card, animation:'fadeUp 0.3s 0.05s ease both' }}>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', borderBottom:'0.5px solid var(--sep)' }}>
                {[
                  { k:'Drag Coef.',  v:result.Cd.toFixed(4),                    unit:'Cd', c:cdColor(result.Cd), big:true },
                  { k:'Lift Coef.',  v:result.Cl?.toFixed(4)??'—',              unit:'Cl', c:result.Cl>0?'var(--red)':'var(--green)' },
                  { k:'Side Coef.',  v:result.Cs?.toFixed(4)??'—',              unit:'Cs', c:'var(--orange)' },
                  { k:'Confidence', v:(result.confidence*100).toFixed(1)+'%',   unit:'',   c:result.confidence>0.85?'var(--green)':result.confidence>0.7?'var(--orange)':'var(--red)' },
                ].map((m,i)=>(
                  <div key={m.k} style={{ padding:'18px 20px', borderRight: i<3?'0.5px solid var(--sep)':'none' }}>
                    <div style={{ fontSize:10, fontWeight:600, color:'var(--text-quaternary)', letterSpacing:'0.06em', textTransform:'uppercase', marginBottom:10 }}>{m.k}</div>
                    <div style={{ display:'flex', alignItems:'baseline', gap:6 }}>
                      <span style={{ fontSize: m.big?38:24, fontWeight:700, color:m.c, fontFamily:"'IBM Plex Mono'", letterSpacing:m.big?'-1.5px':'-0.5px', lineHeight:1 }}>{m.v}</span>
                      {m.unit&&<span style={{ fontSize:14, color:'var(--text-tertiary)' }}>{m.unit}</span>}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', borderBottom:'0.5px solid var(--sep)' }}>
                {[
                  { k:'Drag Force',    v:result.dragForceN?.toFixed(1)??'—', unit:'N'  },
                  { k:'Lift Force',    v:result.liftForceN?.toFixed(1)??'—', unit:'N'  },
                  { k:'Dyn. Pressure', v:result.qInfPa?.toFixed(1)??'—',    unit:'Pa' },
                  { k:'Inference',     v:String(result.inferenceMs),          unit:'ms' },
                ].map((m,i)=>(
                  <div key={m.k} style={{ padding:'12px 20px', borderRight: i<3?'0.5px solid var(--sep)':'none' }}>
                    <div style={{ fontSize:10, color:'var(--text-quaternary)', letterSpacing:'0.06em', textTransform:'uppercase', marginBottom:5 }}>{m.k}</div>
                    <div style={{ fontSize:18, fontWeight:600, color:'var(--text-secondary)', fontFamily:"'IBM Plex Mono'" }}>{m.v} <span style={{ fontSize:12, color:'var(--text-quaternary)' }}>{m.unit}</span></div>
                  </div>
                ))}
              </div>
              {result.dragBreakdown && (
                <div style={{ padding:'16px 20px' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', marginBottom:12 }}>
                    <span style={{ fontSize:11, fontWeight:600, color:'var(--text-quaternary)', letterSpacing:'0.06em', textTransform:'uppercase' }}>Drag Region Breakdown</span>
                    <span style={{ fontSize:11, color:'var(--text-quaternary)' }}>% of total Cd</span>
                  </div>
                  {result.dragBreakdown.map((b,i)=>(
                    <div key={b.region} style={{ marginBottom:10 }}>
                      <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, marginBottom:5 }}>
                        <span style={{ color:'var(--text-secondary)' }}>{b.region}</span>
                        <span style={{ fontFamily:"'IBM Plex Mono'", color:'var(--text-tertiary)', fontVariantNumeric:'tabular-nums' }}>{(b.fraction*100).toFixed(1)}%</span>
                      </div>
                      <div style={{ height:4, background:'var(--bg3)', borderRadius:2, overflow:'hidden' }}>
                        <div style={{ height:'100%', background:DRAG_COLORS[i], borderRadius:2, width:`${b.fraction*100}%`, transition:'width 0.6s cubic-bezier(0.34,1.56,0.64,1)' }}/>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div style={{ ...card, padding:'36px', textAlign:'center', color:'var(--text-quaternary)', fontSize:13 }}>
              No prediction results yet. Run a CFD prediction from the CFD Predictor tab first.
            </div>
          )}

          <SL n="02" t="Benchmark Comparison"/>
          <div style={{ ...card, animation:'fadeUp 0.3s 0.08s ease both' }}>
            {hasResult && (
              <div style={{ padding:'14px 20px', borderBottom:'0.5px solid var(--sep)' }}>
                <div style={{ position:'relative', height:10, borderRadius:5, overflow:'hidden', marginBottom:6 }}>
                  <div style={{ position:'absolute', inset:0, background:'linear-gradient(to right,#30D158,#0A84FF,#FF9F0A,#FF453A)' }}/>
                  <div style={{ position:'absolute', top:-2, bottom:-2, width:3, borderRadius:9999, background:'#fff', boxShadow:'0 1px 6px rgba(0,0,0,0.6)', transition:'left 0.4s', left:`${Math.min(98,Math.max(2,((result.Cd-0.20)/0.20)*100))}%` }}/>
                </div>
                <div style={{ display:'flex', justifyContent:'space-between', fontSize:10, color:'var(--text-quaternary)', fontFamily:"'IBM Plex Mono'" }}>
                  <span>0.20</span><span>0.30</span><span>0.40</span>
                </div>
              </div>
            )}
            {BENCHMARKS.map((b,i)=>{
              const d=hasResult?result.Cd-b.Cd:null
              const clr=b.Cd<0.26?'var(--green)':b.Cd<0.30?'var(--blue)':b.Cd<0.34?'var(--orange)':'var(--red)'
              return (
                <div key={i} style={{
                  display:'flex', alignItems:'center', gap:14, padding:'10px 20px',
                  borderBottom: i<BENCHMARKS.length-1?'0.5px solid var(--sep)':'none',
                  transition:'background 0.12s',
                }}
                  onMouseEnter={e=>e.currentTarget.style.background='rgba(255,255,255,0.02)'}
                  onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                  <span style={{ fontSize:13, color:'var(--text-secondary)', width:120, flexShrink:0 }}>{b.name}</span>
                  <span style={{ fontSize:13, fontWeight:600, fontFamily:"'IBM Plex Mono'", color:clr, width:44, flexShrink:0 }}>{b.Cd.toFixed(3)}</span>
                  <div style={{ flex:1, height:3, background:'var(--bg3)', borderRadius:2, overflow:'hidden' }}>
                    <div style={{ height:'100%', background:clr, borderRadius:2, width:`${((b.Cd-0.20)/0.25)*100}%` }}/>
                  </div>
                  {d!==null && (
                    <span style={{ fontSize:12, fontFamily:"'IBM Plex Mono'", fontVariantNumeric:'tabular-nums', width:56, textAlign:'right', color:d<=0?'var(--green)':'var(--red)', flexShrink:0 }}>
                      {d>0?'+':''}{d.toFixed(4)}
                    </span>
                  )}
                </div>
              )
            })}
          </div>

          {history.length>0 && (
            <>
              <SL n="03" t={`Inference History (${history.length} runs)`}/>
              <div style={{ ...card, animation:'fadeUp 0.3s 0.1s ease both' }}>
                <div style={{ display:'grid', gridTemplateColumns:'40px 1fr 80px 80px', padding:'8px 16px', borderBottom:'0.5px solid var(--sep)', fontSize:10, fontWeight:600, color:'var(--text-quaternary)', letterSpacing:'0.06em', textTransform:'uppercase' }}>
                  <span>#</span><span>Configuration</span><span style={{ textAlign:'right' }}>Cd</span><span style={{ textAlign:'right' }}>ms</span>
                </div>
                {history.map((h,i)=>(
                  <div key={h.id} style={{
                    display:'grid', gridTemplateColumns:'40px 1fr 80px 80px', padding:'9px 16px',
                    borderBottom: i<history.length-1?'0.5px solid rgba(255,255,255,0.04)':'none',
                    transition:'background 0.12s',
                  }}
                    onMouseEnter={e=>e.currentTarget.style.background='rgba(255,255,255,0.02)'}
                    onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                    <span style={{ fontSize:11, fontFamily:"'IBM Plex Mono'", color:'var(--text-quaternary)' }}>{String(i+1).padStart(2,'0')}</span>
                    <span style={{ fontSize:12, color:'var(--text-secondary)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{h.label}</span>
                    <span style={{ fontSize:13, fontWeight:600, fontFamily:"'IBM Plex Mono'", color:'var(--blue)', textAlign:'right', fontVariantNumeric:'tabular-nums' }}>{h.Cd.toFixed(4)}</span>
                    <span style={{ fontSize:12, fontFamily:"'IBM Plex Mono'", color:'var(--text-tertiary)', textAlign:'right', fontVariantNumeric:'tabular-nums' }}>{h.inferenceMs}</span>
                  </div>
                ))}
                {(()=>{
                  const cds=history.map(h=>h.Cd)
                  return (
                    <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:0, borderTop:'0.5px solid var(--sep)', background:'rgba(255,255,255,0.02)' }}>
                      {[
                        { k:'Min Cd',  v:Math.min(...cds).toFixed(4), c:'var(--green)' },
                        { k:'Max Cd',  v:Math.max(...cds).toFixed(4), c:'var(--red)'   },
                        { k:'Mean Cd', v:(cds.reduce((a,b)=>a+b,0)/cds.length).toFixed(4), c:'var(--blue)' },
                        { k:'Avg ms',  v:String(avgLatency), c:'rgba(255,255,255,0.5)' },
                      ].map((s,i,arr)=>(
                        <div key={s.k} style={{ padding:'10px 16px', textAlign:'center', borderRight:i<arr.length-1?'0.5px solid var(--sep)':'none' }}>
                          <div style={{ fontSize:10, color:'var(--text-quaternary)', marginBottom:4 }}>{s.k}</div>
                          <div style={{ fontSize:14, fontWeight:600, fontFamily:"'IBM Plex Mono'", color:s.c, fontVariantNumeric:'tabular-nums' }}>{s.v}</div>
                        </div>
                      ))}
                    </div>
                  )
                })()}
              </div>
            </>
          )}

          <SL n="04" t="Engineer Notes"/>
          <div style={{ ...card }}>
            <textarea value={notes} onChange={e=>setNotes(e.target.value)}
              placeholder="Add observations, design decisions, next steps…"
              style={{
                width:'100%', minHeight:100, padding:'14px 18px',
                background:'transparent', border:'none', outline:'none', resize:'none',
                color:'var(--text-secondary)', fontSize:13, lineHeight:1.6,
                fontFamily:"'IBM Plex Sans'",
              }}/>
          </div>

          <div style={{ textAlign:'center', padding:'24px 0 8px', fontSize:11, color:'var(--text-quaternary)' }}>
            AeroNet CFD Surrogate · GradBoost-DrivAerML · 484 HF-LES OpenFOAM cases · val Cd err 5.4% · {now}
          </div>
        </div>
      </div>

      <style>{`
        @media print { .no-print { display:none !important; } * { -webkit-print-color-adjust:exact; print-color-adjust:exact; } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(8px) } to { opacity:1; transform:translateY(0) } }
      `}</style>
    </div>
  )
}
