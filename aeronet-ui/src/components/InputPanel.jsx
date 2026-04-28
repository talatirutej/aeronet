// Copyright (c) 2026 Rutej Talati. All rights reserved.

import { useState, useRef, useCallback } from 'react'

// ── Data ───────────────────────────────────────────────────────────────────────
const BODY_TYPES = [
  { id:'fastback',  label:'Fastback'  },
  { id:'notchback', label:'Notchback' },
  { id:'estate',    label:'Estate'    },
  { id:'suv',       label:'SUV'       },
  { id:'pickup',    label:'Pickup'    },
]

const GEO_PARAMS = [
  { id:'Vehicle_Length',      label:'Vehicle Length',   unit:'m',  min:3.8,  max:5.2,  step:0.05,  default:4.60, group:'global' },
  { id:'Vehicle_Width',       label:'Width',            unit:'m',  min:1.6,  max:2.1,  step:0.02,  default:1.85, group:'global' },
  { id:'Vehicle_Height',      label:'Height',           unit:'m',  min:1.1,  max:1.9,  step:0.02,  default:1.42, group:'global' },
  { id:'Windscreen_Angle',    label:'Windscreen Angle', unit:'°',  min:48,   max:74,   step:0.5,   default:62,   group:'cabin'  },
  { id:'Backlight_Angle',     label:'Backlight Angle',  unit:'°',  min:14,   max:45,   step:0.5,   default:28,   group:'rear'   },
  { id:'Vehicle_Ride_Height', label:'Ride Height',      unit:'m',  min:0.06, max:0.22, step:0.005, default:0.10, group:'under'  },
  { id:'Rear_Diffusor_Angle', label:'Diffuser Angle',   unit:'°',  min:2,    max:14,   step:0.5,   default:6,    group:'under'  },
  { id:'Hood_Angle',          label:'Hood Angle',       unit:'°',  min:2,    max:12,   step:0.5,   default:6,    group:'front'  },
  { id:'Front_Overhang',      label:'Front Overhang',   unit:'m',  min:0.6,  max:1.2,  step:0.02,  default:0.88, group:'front'  },
  { id:'Rear_Overhang',       label:'Rear Overhang',    unit:'m',  min:0.5,  max:1.2,  step:0.02,  default:0.84, group:'rear'   },
  { id:'Greenhouse_Tapering', label:'Greenhouse Taper', unit:'°',  min:1,    max:10,   step:0.5,   default:4.0,  group:'cabin'  },
  { id:'Vehicle_Pitch',       label:'Vehicle Pitch',    unit:'°',  min:-1.5, max:1.5,  step:0.1,   default:0.0,  group:'global' },
]

const GEO_GROUP_COLOR = {
  global:'var(--blue)', cabin:'var(--teal)', rear:'var(--orange)',
  under:'var(--green)', front:'var(--red)',
}

const TURB_MODELS = [
  { id:'k-omega-sst',  label:'k-ω SST',           desc:'Industry standard · good separation'    },
  { id:'k-eps-realiz', label:'k-ε Realizable',     desc:'Mildly separated flows'                 },
  { id:'spalart',      label:'Spalart-Allmaras',   desc:'Low Re · thin shear layers'             },
  { id:'les',          label:'LES (HF)',            desc:'High fidelity · matches DrivAerML data' },
]

const SOLVER_SCHEMES = [
  { id:'steady',    label:'Steady RANS'     },
  { id:'transient', label:'Transient URANS' },
]

// ── Reusable primitives ────────────────────────────────────────────────────────
function SL({ n, t, collapsible, open, onToggle }) {
  return (
    <div
      onClick={collapsible ? onToggle : undefined}
      style={{
        display:'flex', alignItems:'center', gap:8,
        cursor: collapsible ? 'pointer' : 'default',
        userSelect:'none', marginBottom:10,
      }}
    >
      <span style={{ fontSize:10, fontWeight:600, color:'var(--text-primary)', fontFamily:"'IBM Plex Mono'" }}>{n}</span>
      <div style={{ flex:1, height:0.5, background:'var(--sep)' }}/>
      <span style={{ fontSize:10, fontWeight:600, color:'var(--text-tertiary)', letterSpacing:'0.08em', textTransform:'uppercase' }}>{t}</span>
      {collapsible && (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="2"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition:'transform 0.2s cubic-bezier(0.22,1,0.36,1)', flexShrink:0 }}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      )}
    </div>
  )
}

function Slider({ label, suffix, min, max, step, value, display, onChange, accentColor }) {
  const pct = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100))
  const accent = accentColor || 'var(--blue)'
  return (
    <div style={{ marginBottom:14 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:8 }}>
        <span style={{ fontSize:12, color:'var(--text-secondary)', letterSpacing:'-0.1px' }}>{label}</span>
        <span style={{ fontSize:12, fontWeight:600, color:accent, fontFamily:"'IBM Plex Mono'", fontVariantNumeric:'tabular-nums' }}>
          {display}
          {suffix && <span style={{ color:'var(--text-quaternary)', fontWeight:400, fontSize:10, marginLeft:3 }}>{suffix}</span>}
        </span>
      </div>
      <div style={{ position:'relative', height:20, display:'flex', alignItems:'center' }}>
        {/* Track */}
        <div style={{ position:'absolute', left:0, right:0, height:2, borderRadius:9999, background:'var(--bg3)' }}>
          <div style={{ position:'absolute', left:0, top:0, height:'100%', borderRadius:9999, background:accent, width:`${pct}%`, transition:'width 0.04s' }}/>
        </div>
        {/* Native input — invisible, drives interaction */}
        <input type="range" min={min} max={max} step={step} value={value}
          onChange={e=>onChange(parseFloat(e.target.value))}
          style={{ position:'absolute', inset:0, width:'100%', opacity:0, cursor:'pointer', zIndex:2 }}/>
        {/* Custom thumb */}
        <div style={{
          position:'absolute', top:'50%', transform:'translate(-50%,-50%)',
          left:`${pct}%`, width:16, height:16, borderRadius:'50%',
          background:'#fff', boxShadow:'0 1px 6px rgba(0,0,0,0.55)',
          pointerEvents:'none', zIndex:1, transition:'left 0.04s',
        }}/>
      </div>
    </div>
  )
}

function KVChip({ label, value }) {
  return (
    <div style={{
      background:'var(--bg2)', borderRadius:9, border:'0.5px solid rgba(255,255,255,0.06)',
      padding:'8px 12px',
    }}>
      <div style={{ fontSize:9, fontFamily:"'IBM Plex Mono'", color:'var(--text-quaternary)', letterSpacing:'0.06em', marginBottom:4 }}>{label}</div>
      <div style={{ fontSize:13, fontWeight:600, color:'var(--text-primary)', fontFamily:"'IBM Plex Mono'", fontVariantNumeric:'tabular-nums' }}>{value}</div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function InputPanel({ onSubmit, isLoading }) {
  const [file,       setFile]       = useState(null)
  const [dragActive, setDragActive] = useState(false)
  const [params,     setParams]     = useState({
    bodyType:'fastback', uRef:40, rho:1.225, aRef:2.37, sizeFactor:1.0,
    turbModel:'k-omega-sst', solver:'steady',
    yawAngleDeg:0, groundClearanceMm:100,
    turbIntensity:0.5, turbLengthScale:0.1,
    tempK:293.15, pressurePa:101325,
  })
  const [geoParams,  setGeoParams]  = useState(
    Object.fromEntries(GEO_PARAMS.map(g => [g.id, g.default]))
  )
  const [showGeo,    setShowGeo]    = useState(false)
  const [showSolver, setShowSolver] = useState(false)
  const inputRef = useRef(null)

  const handleDrop = useCallback((e) => {
    e.preventDefault(); e.stopPropagation(); setDragActive(false)
    const f = e.dataTransfer.files?.[0]; if (f) setFile(f)
  }, [])
  const handleDrag = useCallback((e) => {
    e.preventDefault(); e.stopPropagation()
    setDragActive(e.type === 'dragenter' || e.type === 'dragover')
  }, [])

  const up    = (k, v) => setParams(p => ({ ...p, [k]: v }))
  const upGeo = (k, v) => setGeoParams(g => ({ ...g, [k]: v }))

  const submit = () => {
    if (!isLoading) onSubmit(
      file ?? new File(['demo'], 'demo_case.vtk', { type: 'model/vtk' }),
      { ...params, geoFeatures: geoParams }
    )
  }

  const qInf = 0.5 * params.rho * params.uRef * params.uRef
  const Re   = params.rho * params.uRef * (geoParams.Vehicle_Length || 4.6) / 1.8e-5

  const card = { background:'var(--bg1)', borderRadius:12, border:'0.5px solid rgba(255,255,255,0.06)', overflow:'hidden' }

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>

      {/* ── Scrollable body ── */}
      <div style={{ flex:1, overflowY:'auto', padding:'18px 14px 8px' }}>

        {/* 01 — Geometry Input */}
        <SL n="01" t="Geometry Input"/>
        <div
          onDragEnter={handleDrag} onDragLeave={handleDrag}
          onDragOver={handleDrag} onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          style={{
            ...card,
            padding:'14px 16px',
            border: dragActive ? '0.5px solid var(--blue)' : '0.5px solid rgba(255,255,255,0.06)',
            background: dragActive ? 'rgba(10,132,255,0.07)' : 'var(--bg1)',
            cursor:'pointer', transition:'border-color 0.15s, background 0.15s',
            marginBottom:20,
          }}
        >
          <input ref={inputRef} type="file" accept=".vtk,.stl,.obj,.ply" onChange={e => setFile(e.target.files?.[0])} style={{ display:'none' }}/>
          {file ? (
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                <div style={{ width:36, height:36, borderRadius:9, background:'rgba(10,132,255,0.14)', border:'0.5px solid rgba(10,132,255,0.35)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth="1.5">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>
                    <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
                  </svg>
                </div>
                <div>
                  <div style={{ fontSize:13, fontWeight:500, color:'var(--text-primary)', maxWidth:148, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', letterSpacing:'-0.2px' }}>{file.name}</div>
                  <div style={{ fontSize:11, color:'var(--text-tertiary)', fontFamily:"'IBM Plex Mono'", marginTop:2, fontVariantNumeric:'tabular-nums' }}>{(file.size/1024).toFixed(1)} KB</div>
                </div>
              </div>
              <button
                onClick={e => { e.stopPropagation(); setFile(null) }}
                style={{ width:28, height:28, borderRadius:14, background:'var(--bg3)', border:'none', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', transition:'background 0.12s', flexShrink:0 }}
                onMouseEnter={e => e.currentTarget.style.background='rgba(255,69,58,0.2)'}
                onMouseLeave={e => e.currentTarget.style.background='var(--bg3)'}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12"/>
                </svg>
              </button>
            </div>
          ) : (
            <div style={{ display:'flex', alignItems:'center', gap:12, padding:'4px 0' }}>
              <div style={{ width:36, height:36, borderRadius:9, background:'var(--bg2)', border:'0.5px solid var(--sep)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
              </div>
              <div>
                <div style={{ fontSize:13, fontWeight:500, color:'var(--text-secondary)', letterSpacing:'-0.2px' }}>Drop surface mesh</div>
                <div style={{ fontSize:11, color:'var(--text-quaternary)', marginTop:2, fontFamily:"'IBM Plex Mono'" }}>STL · OBJ · VTK · PLY</div>
              </div>
            </div>
          )}
        </div>

        {/* 02 — Body Configuration */}
        <SL n="02" t="Body Configuration"/>
        <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:14 }}>
          {BODY_TYPES.map(bt => (
            <button key={bt.id} onClick={() => up('bodyType', bt.id)} style={{
              padding:'5px 13px', borderRadius:8, border:'0.5px solid',
              borderColor: params.bodyType === bt.id ? 'rgba(10,132,255,0.45)' : 'var(--sep)',
              background:  params.bodyType === bt.id ? 'rgba(10,132,255,0.16)' : 'transparent',
              color:       params.bodyType === bt.id ? 'var(--blue)' : 'rgba(255,255,255,0.4)',
              fontSize:12, fontWeight:500, cursor:'pointer', transition:'all 0.12s',
              fontFamily:"'IBM Plex Sans'",
            }}>{bt.label}</button>
          ))}
        </div>
        <div style={{ ...card, padding:'12px 14px 2px', marginBottom:20 }}>
          <Slider label="Size Factor" suffix="×" min={0.85} max={1.15} step={0.01}
            value={params.sizeFactor} display={params.sizeFactor.toFixed(2)} onChange={v=>up('sizeFactor',v)}/>
        </div>

        {/* 03 — Flow Conditions */}
        <SL n="03" t="Flow Conditions"/>
        <div style={{ ...card, padding:'12px 14px 2px', marginBottom:12 }}>
          <Slider label="Inflow Velocity" suffix="m/s" min={20} max={80} step={1}
            value={params.uRef} display={params.uRef.toFixed(0)} onChange={v=>up('uRef',v)}/>
          <Slider label="Air Density" suffix="kg/m³" min={0.9} max={1.4} step={0.005}
            value={params.rho} display={params.rho.toFixed(3)} onChange={v=>up('rho',v)}/>
          <Slider label="Frontal Area" suffix="m²" min={1.8} max={3.2} step={0.01}
            value={params.aRef} display={params.aRef.toFixed(2)} onChange={v=>up('aRef',v)}/>
          <Slider label="Yaw Angle" suffix="°" min={-15} max={15} step={0.5}
            value={params.yawAngleDeg} display={params.yawAngleDeg.toFixed(1)}
            onChange={v=>up('yawAngleDeg',v)}
            accentColor={params.yawAngleDeg !== 0 ? 'var(--orange)' : 'var(--blue)'}/>
        </div>

        {/* Derived quantities */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:20 }}>
          <KVChip label="q∞  Pa"         value={qInf.toFixed(0)}/>
          <KVChip label="Re"             value={`${(Re/1e6).toFixed(2)}M`}/>
          <KVChip label="T  K"           value={params.tempK.toFixed(0)}/>
          <KVChip label="p∞  kPa"        value={(params.pressurePa/1000).toFixed(1)}/>
        </div>

        {/* 04 — Solver Settings (collapsible) */}
        <SL n="04" t="Solver Settings" collapsible open={showSolver} onToggle={() => setShowSolver(s=>!s)}/>
        <div style={{
          overflow:'hidden',
          maxHeight: showSolver ? 600 : 0,
          transition:'max-height 0.3s cubic-bezier(0.22,1,0.36,1)',
          marginBottom:20,
        }}>
          <div style={{ display:'flex', flexDirection:'column', gap:10, paddingBottom:4 }}>
            {/* Turbulence model */}
            <div style={{ fontSize:10, fontWeight:600, color:'var(--text-quaternary)', letterSpacing:'0.08em', textTransform:'uppercase', marginBottom:4 }}>Turbulence Model</div>
            <div style={{ ...card, overflow:'hidden' }}>
              {TURB_MODELS.map((tm, i) => (
                <button key={tm.id} onClick={() => up('turbModel', tm.id)} style={{
                  width:'100%', textAlign:'left', padding:'10px 14px',
                  background: params.turbModel === tm.id ? 'rgba(10,132,255,0.12)' : 'transparent',
                  border:'none', borderBottom: i < TURB_MODELS.length-1 ? '0.5px solid var(--sep)' : 'none',
                  cursor:'pointer', transition:'background 0.12s',
                  display:'flex', justifyContent:'space-between', alignItems:'center',
                  fontFamily:"'IBM Plex Sans'",
                }}>
                  <div>
                    <div style={{ fontSize:13, fontWeight:500, color: params.turbModel===tm.id?'var(--blue)':'rgba(255,255,255,0.7)', letterSpacing:'-0.2px' }}>{tm.label}</div>
                    <div style={{ fontSize:11, color:'var(--text-quaternary)', marginTop:2 }}>{tm.desc}</div>
                  </div>
                  {params.turbModel === tm.id && (
                    <div style={{ width:6, height:6, borderRadius:'50%', background:'var(--blue)', flexShrink:0 }}/>
                  )}
                </button>
              ))}
            </div>

            {/* Solver scheme */}
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
              {SOLVER_SCHEMES.map(s => (
                <button key={s.id} onClick={() => up('solver', s.id)} style={{
                  height:36, borderRadius:9, border:'0.5px solid',
                  borderColor: params.solver===s.id ? 'rgba(10,132,255,0.45)' : 'var(--sep)',
                  background:  params.solver===s.id ? 'rgba(10,132,255,0.14)' : 'transparent',
                  color:       params.solver===s.id ? 'var(--blue)' : 'rgba(255,255,255,0.4)',
                  fontSize:12, fontWeight:500, cursor:'pointer', transition:'all 0.12s',
                  fontFamily:"'IBM Plex Sans'",
                }}>{s.label}</button>
              ))}
            </div>

            <div style={{ ...card, padding:'12px 14px 2px' }}>
              <Slider label="Turbulence Intensity" suffix="%" min={0.1} max={5.0} step={0.1}
                value={params.turbIntensity} display={params.turbIntensity.toFixed(1)} onChange={v=>up('turbIntensity',v)}/>
              <Slider label="Length Scale" suffix="m" min={0.01} max={0.5} step={0.01}
                value={params.turbLengthScale} display={params.turbLengthScale.toFixed(2)} onChange={v=>up('turbLengthScale',v)}/>
            </div>
          </div>
        </div>

        {/* 05 — Geometric Features (collapsible) */}
        <SL n="05" t="Geometric Features" collapsible open={showGeo} onToggle={() => setShowGeo(g=>!g)}/>
        <div style={{
          overflow:'hidden',
          maxHeight: showGeo ? 1200 : 0,
          transition:'max-height 0.35s cubic-bezier(0.22,1,0.36,1)',
          marginBottom:8,
        }}>
          <div style={{ fontSize:11, color:'var(--text-quaternary)', marginBottom:10, lineHeight:1.5 }}>
            DrivAerML 16 geometric parameters fed directly to the surrogate model
          </div>
          <div style={{ ...card, padding:'12px 14px 2px' }}>
            {GEO_PARAMS.map(gp => (
              <Slider
                key={gp.id}
                label={gp.label}
                suffix={gp.unit}
                min={gp.min} max={gp.max} step={gp.step}
                value={geoParams[gp.id]}
                display={geoParams[gp.id].toFixed(gp.step < 0.1 ? 3 : gp.step < 1 ? 2 : 1)}
                onChange={v => upGeo(gp.id, v)}
                accentColor={GEO_GROUP_COLOR[gp.group]}
              />
            ))}
          </div>
        </div>

      </div>

      {/* ── Run button ── */}
      <div style={{ padding:'10px 14px 14px', borderTop:'0.5px solid var(--sep)', flexShrink:0 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
          <span style={{ fontSize:11, color:'var(--text-tertiary)', fontFamily:"'IBM Plex Sans'" }}>GradBoost-DrivAerML</span>
          <span style={{ fontSize:11, fontWeight:600, color:'var(--text-primary)', fontFamily:"'IBM Plex Mono'" }}>R²=0.9525</span>
        </div>
        <button
          onClick={submit}
          disabled={isLoading}
          style={{
            width:'100%', height:42, borderRadius:11, border:'none',
            background: isLoading ? 'rgba(10,132,255,0.3)' : 'var(--blue)',
            color:'var(--text-primary)', fontSize:14, fontWeight:600, letterSpacing:'-0.2px',
            cursor: isLoading ? 'not-allowed' : 'pointer',
            display:'flex', alignItems:'center', justifyContent:'center', gap:7,
            fontFamily:"'IBM Plex Sans'",
            transition:'opacity 0.15s, transform 0.1s',
          }}
          onMouseEnter={e => { if (!isLoading) e.currentTarget.style.opacity='0.88' }}
          onMouseLeave={e => { e.currentTarget.style.opacity='1' }}
          onMouseDown={e  => { if (!isLoading) e.currentTarget.style.transform='scale(0.97)' }}
          onMouseUp={e    => { e.currentTarget.style.transform='scale(1)' }}
        >
          {isLoading ? (
            <>
              <svg style={{ animation:'spin 0.85s linear infinite' }} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2.5">
                <path d="M12 3a9 9 0 019 9" strokeLinecap="round"/>
              </svg>
              Running Inference…
            </>
          ) : (
            <>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polygon points="5 3 19 12 5 21 5 3"/>
              </svg>
              Run Prediction
            </>
          )}
        </button>
      </div>
    </div>
  )
}
