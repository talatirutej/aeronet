// Copyright (c) 2026 Rutej Talati. All rights reserved.

import { useState, useRef } from 'react'
import { predict } from '../lib/predict'

const FEATURES = [
  { id:'sizeFactor',  label:'Vehicle Scale',     unit:'×',    base:1.00,  sigma:0.05,  group:'global'   },
  { id:'uRef',        label:'Inflow Velocity',   unit:'m/s',  base:40,    sigma:8,     group:'boundary' },
  { id:'aRef',        label:'Frontal Area',      unit:'m²',   base:2.37,  sigma:0.25,  group:'global'   },
  { id:'rho',         label:'Air Density',       unit:'kg/m³',base:1.225, sigma:0.12,  group:'boundary' },
  { id:'_windscreen', label:'Windscreen Rake',   unit:'°',    base:62,    sigma:6,     group:'cabin'    },
  { id:'_backlight',  label:'Backlight Angle',   unit:'°',    base:28,    sigma:7,     group:'rear'     },
  { id:'_rideHeight', label:'Ride Height',       unit:'mm',   base:100,   sigma:25,    group:'under'    },
  { id:'_diffuser',   label:'Diffuser Angle',    unit:'°',    base:6,     sigma:3,     group:'under'    },
  { id:'_hoodAngle',  label:'Hood Angle',        unit:'°',    base:6,     sigma:2,     group:'front'    },
  { id:'_frontOvhg',  label:'Front Overhang',    unit:'m',    base:0.88,  sigma:0.08,  group:'front'    },
  { id:'_rearOvhg',   label:'Rear Overhang',     unit:'m',    base:0.84,  sigma:0.08,  group:'rear'     },
  { id:'_ghTaper',    label:'Greenhouse Taper',  unit:'°',    base:4.0,   sigma:1.5,   group:'cabin'    },
  { id:'_pitch',      label:'Vehicle Pitch',     unit:'°',    base:0.0,   sigma:0.8,   group:'global'   },
  { id:'_width',      label:'Vehicle Width',     unit:'m',    base:1.85,  sigma:0.06,  group:'global'   },
  { id:'_height',     label:'Vehicle Height',    unit:'m',    base:1.42,  sigma:0.08,  group:'global'   },
  { id:'_length',     label:'Vehicle Length',    unit:'m',    base:4.60,  sigma:0.18,  group:'global'   },
]
const GRP_COLOR = { global:'#0A84FF', boundary:'#BF5AF2', front:'#FF453A', cabin:'#FFD60A', rear:'#40CBE0', under:'#30D158' }

function featureToParams(feat, delta, bt) {
  const p = { bodyType:bt, uRef:40, rho:1.225, aRef:2.37, sizeFactor:1.0 }
  if      (feat.id==='sizeFactor') p.sizeFactor=feat.base+delta
  else if (feat.id==='uRef')       p.uRef=feat.base+delta
  else if (feat.id==='aRef')       p.aRef=feat.base+delta
  else if (feat.id==='rho')        p.rho=feat.base+delta
  else {
    const n=delta/feat.sigma
    p.sizeFactor=1.0+n*0.018; p.aRef=2.37+n*feat.sigma*0.04; p.uRef=40+n*0.5
  }
  return p
}

function SL({ n, t }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
      <span style={{ fontSize:10, fontWeight:600, color:'var(--blue)', fontFamily:"'IBM Plex Mono',monospace" }}>{n}</span>
      <div style={{ flex:1, height:0.5, background:'var(--sep)' }}/>
      <span style={{ fontSize:10, fontWeight:600, color:'rgba(235,235,245,0.28)', letterSpacing:'0.08em', textTransform:'uppercase' }}>{t}</span>
    </div>
  )
}

export default function SensitivityPage() {
  const [bodyType, setBodyType] = useState('fastback')
  const [running,  setRunning]  = useState(false)
  const [progress, setProgress] = useState(0)
  const [results,  setResults]  = useState(null)
  const [sortBy,   setSortBy]   = useState('abs')
  const [hoverId,  setHoverId]  = useState(null)
  const cancelRef = useRef(false)

  const run = async () => {
    cancelRef.current=false; setRunning(true); setProgress(0); setResults(null)
    const demoFile=new File(['demo'],'sens.vtk',{type:'model/vtk'})
    const base=await predict(demoFile,{bodyType,uRef:40,rho:1.225,aRef:2.37,sizeFactor:1.0})
    const Cd0=base.Cd
    const data=[]
    for (let i=0;i<FEATURES.length;i++) {
      if (cancelRef.current) break
      const feat=FEATURES[i]
      const rP=await predict(new File([`p${i}`],'s.vtk',{type:'model/vtk'}),featureToParams(feat,+feat.sigma,bodyType))
      const rM=await predict(new File([`m${i}`],'s.vtk',{type:'model/vtk'}),featureToParams(feat,-feat.sigma,bodyType))
      const dCdDx=(rP.Cd-rM.Cd)/(2*feat.sigma)
      const dCd1sig=Math.abs(rP.Cd-rM.Cd)/2
      data.push({...feat,dCdDx,dCd1sig,CdPlus:rP.Cd,CdMinus:rM.Cd})
      setProgress(Math.round((i+1)/FEATURES.length*100))
    }
    const totalVar=data.reduce((a,b)=>a+b.dCd1sig**2,0)||1
    data.forEach(d=>{d.sobol=(d.dCd1sig**2)/totalVar})
    setResults({Cd0,bodyType,data}); setRunning(false)
  }

  const cancel=()=>{cancelRef.current=true;setRunning(false)}
  const sorted=results?[...results.data].sort((a,b)=>
    sortBy==='abs'?Math.abs(b.dCdDx)-Math.abs(a.dCdDx):
    sortBy==='sobol'?b.sobol-a.sobol:a.group.localeCompare(b.group)
  ):[]
  const maxAbs=sorted.length?Math.max(...sorted.map(s=>Math.abs(s.dCdDx)))||1:1
  const groupTotals=results?Object.fromEntries(Object.keys(GRP_COLOR).map(g=>[g,results.data.filter(d=>d.group===g).reduce((a,b)=>a+b.sobol,0)])):{}

  const card={ background:'var(--bg1)', borderRadius:12, border:'0.5px solid rgba(255,255,255,0.06)', overflow:'hidden' }

  return (
    <div style={{ display:'flex', height:'100%', overflow:'hidden', background:'var(--bg0)' }}>

      {/* Sidebar */}
      <div style={{ width:240, flexShrink:0, padding:'16px 14px', borderRight:'0.5px solid var(--sep)', overflowY:'auto', display:'flex', flexDirection:'column', gap:0 }}>

        <SL n="01" t="Body Type"/>
        <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:14 }}>
          {['fastback','notchback','estate','suv','pickup'].map(bt=>(
            <button key={bt} onClick={()=>setBodyType(bt)} style={{
              padding:'4px 12px', borderRadius:8, border:`0.5px solid ${bodyType===bt?'rgba(10,132,255,0.4)':'var(--sep)'}`,
              background: bodyType===bt?'rgba(10,132,255,0.14)':'transparent',
              color: bodyType===bt?'var(--blue)':'rgba(235,235,245,0.4)',
              fontSize:12, fontWeight:500, cursor:'pointer', transition:'all 0.12s',
              fontFamily:"'IBM Plex Sans',sans-serif",
            }}>{bt}</button>
          ))}
        </div>

        <SL n="02" t="Sort By"/>
        <div style={{ display:'flex', gap:6, marginBottom:14 }}>
          {[['abs','|∂Cd/∂x|'],['sobol','Sobol'],['group','Group']].map(([id,lbl])=>(
            <button key={id} onClick={()=>setSortBy(id)} style={{
              flex:1, height:30, borderRadius:8, border:'0.5px solid',
              borderColor: sortBy===id?'rgba(10,132,255,0.4)':'var(--sep)',
              background: sortBy===id?'rgba(10,132,255,0.14)':'transparent',
              color: sortBy===id?'var(--blue)':'rgba(235,235,245,0.4)',
              fontSize:11, fontWeight:500, cursor:'pointer', transition:'all 0.12s',
              fontFamily:"'IBM Plex Sans',sans-serif",
            }}>{lbl}</button>
          ))}
        </div>

        {running ? (
          <button onClick={cancel} style={{ width:'100%', height:38, borderRadius:10, border:'0.5px solid rgba(255,69,58,0.4)', background:'transparent', color:'var(--red)', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:"'IBM Plex Sans',sans-serif", marginBottom:10 }}>
            Cancel
          </button>
        ) : (
          <button onClick={run} disabled={running} style={{ width:'100%', height:38, borderRadius:10, border:'none', background:'var(--blue)', color:'#fff', fontSize:13, fontWeight:600, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:6, fontFamily:"'IBM Plex Sans',sans-serif", marginBottom:10, transition:'opacity 0.15s' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            Run Sensitivity
          </button>
        )}

        {running && (
          <div style={{ marginBottom:14 }}>
            <div style={{ height:2, background:'var(--bg3)', borderRadius:2, overflow:'hidden' }}>
              <div style={{ height:'100%', background:'var(--blue)', width:`${progress}%`, transition:'width 0.3s' }}/>
            </div>
            <div style={{ textAlign:'right', fontSize:11, color:'rgba(235,235,245,0.28)', marginTop:4, fontFamily:"'IBM Plex Mono',monospace" }}>{progress}% · {FEATURES.length} features</div>
          </div>
        )}

        <SL n="03" t="Feature Groups"/>
        <div style={{ ...card, padding:'10px 12px', marginBottom:14 }}>
          {Object.entries(GRP_COLOR).map(([g,c])=>(
            <div key={g} style={{ display:'flex', alignItems:'center', gap:8, paddingBottom:7, marginBottom:7, borderBottom:'0.5px solid var(--sep)' }}>
              <span style={{ width:10, height:10, borderRadius:3, background:c, flexShrink:0 }}/>
              <span style={{ fontSize:12, color:'rgba(235,235,245,0.45)', flex:1, textTransform:'capitalize' }}>{g}</span>
              {results&&<span style={{ fontSize:11, fontWeight:600, color:c, fontFamily:"'IBM Plex Mono',monospace" }}>{((groupTotals[g]||0)*100).toFixed(0)}%</span>}
            </div>
          ))}
        </div>

        {results && (
          <>
            <SL n="04" t="Baseline"/>
            <div style={{ ...card, padding:'14px', textAlign:'center' }}>
              <div style={{ fontSize:10, fontWeight:600, color:'rgba(235,235,245,0.28)', letterSpacing:'0.06em', textTransform:'uppercase', marginBottom:8 }}>Baseline Cd</div>
              <div style={{ fontSize:36, fontWeight:700, color:'var(--blue)', fontFamily:"'IBM Plex Mono',monospace", letterSpacing:'-1.5px', lineHeight:1 }}>{results.Cd0.toFixed(4)}</div>
              <div style={{ fontSize:11, color:'rgba(235,235,245,0.28)', marginTop:6 }}>{results.bodyType} · 40 m/s</div>
            </div>
          </>
        )}
      </div>

      {/* Tornado chart area */}
      <div style={{ flex:1, display:'flex', flexDirection:'column', padding:'16px', gap:12, overflow:'hidden' }}>
        {!results&&!running ? (
          <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center' }}>
            <div style={{ textAlign:'center' }}>
              <div style={{ fontSize:14, color:'rgba(235,235,245,0.25)', marginBottom:6 }}>Feature Sensitivity Map</div>
              <div style={{ fontSize:12, color:'rgba(235,235,245,0.18)', maxWidth:320, lineHeight:1.6 }}>
                Runs ±σ perturbations on all 16 features and computes ∂Cd/∂x via central finite differences
              </div>
            </div>
          </div>
        ) : sorted.length>0 && (
          <>
            <div style={{ flex:1, ...card, display:'flex', flexDirection:'column' }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 16px', borderBottom:'0.5px solid var(--sep)', flexShrink:0 }}>
                <span style={{ fontSize:14, fontWeight:600, color:'rgba(235,235,245,0.85)' }}>Tornado Chart — {bodyType}</span>
                <div style={{ display:'flex', gap:16, fontSize:11, color:'rgba(235,235,245,0.35)' }}>
                  <span><span style={{ color:'var(--red)' }}>▪</span> Increases Cd</span>
                  <span><span style={{ color:'var(--green)' }}>▪</span> Decreases Cd</span>
                  <span>bar ∝ ∂Cd/∂x</span>
                </div>
              </div>
              <div style={{ overflowY:'auto', flex:1, padding:'10px 14px' }}>
                {sorted.map((s,i)=>{
                  const clr=GRP_COLOR[s.group]
                  const barPct=(Math.abs(s.dCdDx)/maxAbs)*44
                  const isPos=s.dCdDx>=0
                  const isHov=hoverId===s.id
                  return (
                    <div key={s.id}
                      onMouseEnter={()=>setHoverId(s.id)}
                      onMouseLeave={()=>setHoverId(null)}
                      style={{
                        display:'flex', alignItems:'center', gap:10, padding:'6px 8px',
                        borderRadius:8, marginBottom:3,
                        background: isHov?'rgba(255,255,255,0.04)':'transparent',
                        transition:'background 0.12s', cursor:'default',
                      }}>
                      <span style={{ fontSize:10, fontFamily:"'IBM Plex Mono',monospace", color:'rgba(235,235,245,0.25)', width:16, flexShrink:0 }}>{i+1}</span>
                      <span style={{ width:8, height:8, borderRadius:2, background:clr, flexShrink:0 }}/>
                      <span style={{ fontSize:12, color:'rgba(235,235,245,0.65)', width:148, flexShrink:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{s.label}</span>
                      {/* Bar chart */}
                      <div style={{ flex:1, position:'relative', height:12, display:'flex', alignItems:'center' }}>
                        <div style={{ position:'absolute', left:'50%', top:0, bottom:0, width:0.5, background:'rgba(255,255,255,0.1)' }}/>
                        {isPos ? (
                          <div style={{ position:'absolute', top:1, bottom:1, left:'50%', width:`${barPct}%`, background:clr, opacity:0.7, borderRadius:'0 3px 3px 0' }}/>
                        ) : (
                          <div style={{ position:'absolute', top:1, bottom:1, right:'50%', width:`${barPct}%`, background:clr, opacity:0.7, borderRadius:'3px 0 0 3px' }}/>
                        )}
                      </div>
                      <span style={{ fontSize:11, fontWeight:600, fontFamily:"'IBM Plex Mono',monospace", fontVariantNumeric:'tabular-nums', width:72, textAlign:'right', flexShrink:0, color:isPos?'var(--red)':'var(--green)' }}>
                        {isPos?'+':''}{s.dCdDx.toFixed(5)}
                      </span>
                      {/* Sobol mini-bar */}
                      <div style={{ width:52, flexShrink:0 }}>
                        <div style={{ height:2, background:'var(--bg3)', borderRadius:1, overflow:'hidden' }}>
                          <div style={{ height:'100%', background:clr, width:`${s.sobol*100}%` }}/>
                        </div>
                        <div style={{ fontSize:9, color:'rgba(235,235,245,0.25)', fontFamily:"'IBM Plex Mono',monospace", marginTop:2 }}>{(s.sobol*100).toFixed(1)}%</div>
                      </div>
                      <span style={{ fontSize:10, color:'rgba(235,235,245,0.25)', width:28, textAlign:'right', flexShrink:0 }}>{s.unit}</span>
                    </div>
                  )
                })}
              </div>
            </div>
            {/* Group totals */}
            <div style={{ display:'grid', gridTemplateColumns:'repeat(6,1fr)', gap:8, flexShrink:0 }}>
              {Object.entries(GRP_COLOR).map(([grp,clr])=>{
                const tot=groupTotals[grp]||0
                const n=results.data.filter(d=>d.group===grp).length
                return (
                  <div key={grp} style={{ background:'var(--bg1)', borderRadius:10, border:'0.5px solid rgba(255,255,255,0.06)', padding:'10px 10px 8px', textAlign:'center' }}>
                    <div style={{ fontSize:22, fontWeight:700, color:clr, fontFamily:"'IBM Plex Mono',monospace", lineHeight:1 }}>{(tot*100).toFixed(0)}%</div>
                    <div style={{ fontSize:11, color:'rgba(235,235,245,0.35)', textTransform:'capitalize', marginTop:4 }}>{grp}</div>
                    <div style={{ fontSize:10, color:'rgba(235,235,245,0.2)' }}>{n} feat{n>1?'s':''}</div>
                    <div style={{ height:2, borderRadius:1, background:'var(--bg3)', overflow:'hidden', marginTop:6 }}>
                      <div style={{ height:'100%', background:clr, width:`${tot*100}%` }}/>
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
