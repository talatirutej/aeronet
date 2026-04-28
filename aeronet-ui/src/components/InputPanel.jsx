// Copyright (c) 2026 Rutej Talati. All rights reserved.
// AeroNet — InputPanel.jsx v3 (full CFD simulation inputs)

import { useState, useRef, useCallback } from 'react'
import { Upload, FileCode, X, PlayCircle, Loader2, ChevronDown, ChevronUp } from 'lucide-react'

const BODY_TYPES = [
  { id:'fastback',  label:'Fastback'  },
  { id:'notchback', label:'Notchback' },
  { id:'estate',    label:'Estate'    },
  { id:'suv',       label:'SUV'       },
  { id:'pickup',    label:'Pickup'    },
]

// DrivAerML 16 geometric features with realistic ranges
const GEO_PARAMS = [
  { id:'Vehicle_Length',      label:'Vehicle Length',       unit:'m',   min:3.8,  max:5.2,  step:0.05,  default:4.60, group:'global' },
  { id:'Vehicle_Width',       label:'Width',                unit:'m',   min:1.6,  max:2.1,  step:0.02,  default:1.85, group:'global' },
  { id:'Vehicle_Height',      label:'Height',               unit:'m',   min:1.1,  max:1.9,  step:0.02,  default:1.42, group:'global' },
  { id:'Windscreen_Angle',    label:'Windscreen Angle',     unit:'°',   min:48,   max:74,   step:0.5,   default:62,   group:'cabin'  },
  { id:'Backlight_Angle',     label:'Backlight Angle',      unit:'°',   min:14,   max:45,   step:0.5,   default:28,   group:'rear'   },
  { id:'Vehicle_Ride_Height', label:'Ride Height',          unit:'m',   min:0.06, max:0.22, step:0.005, default:0.10, group:'under'  },
  { id:'Rear_Diffusor_Angle', label:'Diffuser Angle',       unit:'°',   min:2,    max:14,   step:0.5,   default:6,    group:'under'  },
  { id:'Hood_Angle',          label:'Hood Angle',           unit:'°',   min:2,    max:12,   step:0.5,   default:6,    group:'front'  },
  { id:'Front_Overhang',      label:'Front Overhang',       unit:'m',   min:0.6,  max:1.2,  step:0.02,  default:0.88, group:'front'  },
  { id:'Rear_Overhang',       label:'Rear Overhang',        unit:'m',   min:0.5,  max:1.2,  step:0.02,  default:0.84, group:'rear'   },
  { id:'Greenhouse_Tapering', label:'Greenhouse Taper',     unit:'°',   min:1,    max:10,   step:0.5,   default:4.0,  group:'cabin'  },
  { id:'Vehicle_Pitch',       label:'Vehicle Pitch',        unit:'°',   min:-1.5, max:1.5,  step:0.1,   default:0.0,  group:'global' },
]

// Turbulence models
const TURB_MODELS = [
  { id:'k-omega-sst', label:'k-ω SST',      desc:'Industry standard, good separation' },
  { id:'k-eps-realiz',label:'k-ε Realizable',desc:'Good for mildly separated flows'   },
  { id:'spalart',     label:'Spalart-Allmaras',desc:'Low Re, thin shear layers'        },
  { id:'les',         label:'LES (HF)',       desc:'High fidelity, like DrivAerML data' },
]

// Solver schemes
const SOLVER_SCHEMES = [
  { id:'steady',    label:'Steady RANS'    },
  { id:'transient', label:'Transient URANS'},
]

export default function InputPanel({ onSubmit, isLoading }) {
  const [file,          setFile]          = useState(null)
  const [dragActive,    setDragActive]    = useState(false)
  const [params,        setParams]        = useState({
    bodyType:   'fastback',
    uRef:       40,
    rho:        1.225,
    aRef:       2.37,
    sizeFactor: 1.0,
    turbModel:  'k-omega-sst',
    solver:     'steady',
    yawAngleDeg: 0,
    groundClearanceMm: 100,
    turbIntensity: 0.5,
    turbLengthScale: 0.1,
    tempK:      293.15,
    pressurePa: 101325,
  })
  const [geoParams,     setGeoParams]     = useState(
    Object.fromEntries(GEO_PARAMS.map(g=>[g.id, g.default]))
  )
  const [showGeo,       setShowGeo]       = useState(false)
  const [showSolver,    setShowSolver]    = useState(false)
  const inputRef = useRef(null)

  const handleDrop = useCallback((e)=>{
    e.preventDefault(); e.stopPropagation(); setDragActive(false)
    const f=e.dataTransfer.files?.[0]; if(f) setFile(f)
  },[])
  const handleDrag = useCallback((e)=>{
    e.preventDefault(); e.stopPropagation()
    setDragActive(e.type==='dragenter'||e.type==='dragover')
  },[])
  const up = (k,v) => setParams(p=>({...p,[k]:v}))
  const upGeo = (k,v) => setGeoParams(g=>({...g,[k]:v}))

  const submit = () => {
    if(!isLoading) onSubmit(
      file ?? new File(['demo'],'demo_case.vtk',{type:'model/vtk'}),
      { ...params, geoFeatures: geoParams }
    )
  }

  // Compute dynamic pressure
  const qInf = 0.5 * params.rho * params.uRef * params.uRef
  const Re = params.rho * params.uRef * (geoParams.Vehicle_Length||4.6) / 1.8e-5

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-2 space-y-5">

        {/* 01 — Geometry upload */}
        <Section label="01" title="Geometry Input">
          <div
            onDragEnter={handleDrag} onDragLeave={handleDrag}
            onDragOver={handleDrag} onDrop={handleDrop}
            onClick={()=>inputRef.current?.click()}
            className={`relative rounded-lg border-2 border-dashed p-4 cursor-pointer transition-all min-h-[88px] flex items-center
              ${dragActive?'border-md-primary bg-md-primary/10':'border-md-outline-variant hover:border-md-outline bg-md-surface-container'}`}>
            <input ref={inputRef} type="file" accept=".vtk,.stl,.obj,.ply" onChange={e=>setFile(e.target.files?.[0])} className="hidden"/>
            {file ? (
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{background:'#004D66'}}>
                    <FileCode size={20} color="#82CFFF" strokeWidth={1.5}/>
                  </div>
                  <div>
                    <div className="text-label-lg text-md-on-surface truncate max-w-[130px]">{file.name}</div>
                    <div className="text-body-sm text-md-on-surface-variant num">{(file.size/1024).toFixed(1)} KB</div>
                  </div>
                </div>
                <button onClick={e=>{e.stopPropagation();setFile(null)}}
                  className="w-8 h-8 rounded-full flex items-center justify-center text-md-on-surface-variant hover:bg-md-error/12 hover:text-md-error">
                  <X size={16}/>
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-3 w-full">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-md-surface-container-highest">
                  <Upload size={20} className="text-md-on-surface-variant" strokeWidth={1.5}/>
                </div>
                <div>
                  <div className="text-label-lg text-md-on-surface">Drop surface mesh</div>
                  <div className="text-body-sm text-md-on-surface-variant">STL · OBJ · VTK · PLY</div>
                </div>
              </div>
            )}
          </div>
        </Section>

        {/* 02 — Body configuration */}
        <Section label="02" title="Body Configuration">
          <div className="flex flex-wrap gap-1.5">
            {BODY_TYPES.map(bt=>(
              <button key={bt.id} onClick={()=>up('bodyType',bt.id)}
                className={`m3-chip ${params.bodyType===bt.id?'m3-chip-selected':''}`}>
                <span className="text-label-md">{bt.label}</span>
              </button>
            ))}
          </div>
          <SliderField label="Size Factor" suffix="×" min={0.85} max={1.15} step={0.01}
            value={params.sizeFactor} display={params.sizeFactor.toFixed(2)} onChange={v=>up('sizeFactor',v)}/>
        </Section>

        {/* 03 — Flow conditions */}
        <Section label="03" title="Flow Conditions">
          <SliderField label="Inflow Velocity" suffix="m/s" min={20} max={80} step={1}
            value={params.uRef} display={params.uRef.toFixed(0)} onChange={v=>up('uRef',v)}/>
          <SliderField label="Air Density" suffix="kg/m³" min={0.9} max={1.4} step={0.005}
            value={params.rho} display={params.rho.toFixed(3)} onChange={v=>up('rho',v)}/>
          <SliderField label="Frontal Area" suffix="m²" min={1.8} max={3.2} step={0.01}
            value={params.aRef} display={params.aRef.toFixed(2)} onChange={v=>up('aRef',v)}/>
          <SliderField label="Yaw Angle" suffix="°" min={-15} max={15} step={0.5}
            value={params.yawAngleDeg} display={params.yawAngleDeg.toFixed(1)} onChange={v=>up('yawAngleDeg',v)}/>

          {/* Dynamic info */}
          <div className="grid grid-cols-2 gap-2">
            {[
              ['q∞',  `${qInf.toFixed(0)} Pa`],
              ['Re',  `${(Re/1e6).toFixed(2)}M`],
              ['T',   `${params.tempK.toFixed(0)} K`],
              ['p∞',  `${(params.pressurePa/1000).toFixed(1)} kPa`],
            ].map(([k,v])=>(
              <div key={k} className="rounded-md bg-md-surface-container border border-md-outline-variant px-2 py-1.5">
                <div className="text-label-sm text-md-outline font-mono">{k}</div>
                <div className="text-label-lg text-md-primary font-mono num">{v}</div>
              </div>
            ))}
          </div>
        </Section>

        {/* 04 — Turbulence & Solver (collapsible) */}
        <div>
          <button onClick={()=>setShowSolver(s=>!s)}
            className="w-full flex items-center gap-2 mb-2">
            <span className="text-label-md text-md-primary font-mono">04</span>
            <div className="flex-1 h-px bg-md-outline-variant"/>
            <span className="text-label-md text-md-on-surface-variant uppercase tracking-wider">Solver Settings</span>
            {showSolver?<ChevronUp size={14} className="text-md-outline"/>:<ChevronDown size={14} className="text-md-outline"/>}
          </button>
          {showSolver && (
            <div className="space-y-4">
              {/* Turbulence model */}
              <div className="space-y-2">
                <span className="text-label-md text-md-on-surface-variant uppercase tracking-wider text-xs">Turbulence Model</span>
                <div className="space-y-1.5">
                  {TURB_MODELS.map(tm=>(
                    <button key={tm.id} onClick={()=>up('turbModel',tm.id)}
                      className={`w-full text-left px-3 py-2 rounded-md border transition-all
                        ${params.turbModel===tm.id
                          ?'border-md-primary bg-md-primary/10 text-md-primary'
                          :'border-md-outline-variant text-md-on-surface-variant hover:border-md-outline'}`}>
                      <div className="text-label-md">{tm.label}</div>
                      <div className="text-label-sm opacity-60">{tm.desc}</div>
                    </button>
                  ))}
                </div>
              </div>
              {/* Solver scheme */}
              <div className="flex gap-2">
                {SOLVER_SCHEMES.map(s=>(
                  <button key={s.id} onClick={()=>up('solver',s.id)}
                    className={`flex-1 py-2 rounded-md text-label-md border transition-all
                      ${params.solver===s.id?'border-md-primary bg-md-primary/10 text-md-primary':'border-md-outline-variant text-md-on-surface-variant'}`}>
                    {s.label}
                  </button>
                ))}
              </div>
              {/* Turbulence intensity */}
              <SliderField label="Turbulence Intensity" suffix="%" min={0.1} max={5.0} step={0.1}
                value={params.turbIntensity} display={params.turbIntensity.toFixed(1)} onChange={v=>up('turbIntensity',v)}/>
              <SliderField label="Length Scale" suffix="m" min={0.01} max={0.5} step={0.01}
                value={params.turbLengthScale} display={params.turbLengthScale.toFixed(2)} onChange={v=>up('turbLengthScale',v)}/>
            </div>
          )}
        </div>

        {/* 05 — DrivAerML Geometric Features (collapsible) */}
        <div>
          <button onClick={()=>setShowGeo(g=>!g)}
            className="w-full flex items-center gap-2 mb-2">
            <span className="text-label-md text-md-primary font-mono">05</span>
            <div className="flex-1 h-px bg-md-outline-variant"/>
            <span className="text-label-md text-md-on-surface-variant uppercase tracking-wider">Geometric Features</span>
            {showGeo?<ChevronUp size={14} className="text-md-outline"/>:<ChevronDown size={14} className="text-md-outline"/>}
          </button>
          {showGeo && (
            <div className="space-y-3">
              <div className="text-body-sm text-md-on-surface-variant px-1">
                DrivAerML 16 geometric parameters — directly fed to the surrogate model
              </div>
              {GEO_PARAMS.map(gp=>(
                <SliderField key={gp.id}
                  label={gp.label} suffix={gp.unit}
                  min={gp.min} max={gp.max} step={gp.step}
                  value={geoParams[gp.id]} display={geoParams[gp.id].toFixed(gp.step<0.1?3:gp.step<1?2:1)}
                  onChange={v=>upGeo(gp.id,v)}/>
              ))}
            </div>
          )}
        </div>

      </div>

      {/* Run button */}
      <div className="px-4 py-3 border-t border-md-outline-variant">
        {/* Model indicator */}
        <div className="flex items-center justify-between mb-2">
          <span className="text-label-sm text-md-on-surface-variant">GradBoost-DrivAerML</span>
          <span className="text-label-sm text-md-primary font-mono">R²=0.9525</span>
        </div>
        <button onClick={submit} disabled={isLoading} className="m3-btn-filled w-full h-12 rounded-xl">
          {isLoading?(
            <><Loader2 size={18} className="animate-spin"/><span>Running Inference…</span></>
          ):(
            <><PlayCircle size={18}/><span>Run Prediction</span></>
          )}
        </button>
      </div>
    </div>
  )
}

function Section({ label, title, children }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-label-md text-md-primary font-mono">{label}</span>
        <div className="flex-1 h-px bg-md-outline-variant"/>
        <span className="text-label-md text-md-on-surface-variant uppercase tracking-wider">{title}</span>
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  )
}

function SliderField({ label, suffix, min, max, step, value, display, onChange }) {
  const pct = ((value-min)/(max-min))*100
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-label-md text-md-on-surface-variant uppercase tracking-wider">{label}</span>
        <span className="text-label-lg text-md-primary font-mono num">
          {display} <span className="text-body-sm text-md-on-surface-variant">{suffix}</span>
        </span>
      </div>
      <div className="relative pt-1 pb-1">
        <div className="h-1 rounded-full bg-md-surface-container-highest relative overflow-visible">
          <div className="absolute left-0 top-0 h-1 rounded-full bg-md-primary" style={{width:`${pct}%`}}/>
        </div>
        <input type="range" min={min} max={max} step={step} value={value}
          onChange={e=>onChange(parseFloat(e.target.value))}
          className="absolute inset-0 w-full opacity-0 cursor-pointer h-full" style={{zIndex:2}}/>
        <div className="absolute top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-md-primary shadow-elevation-1 pointer-events-none"
          style={{left:`calc(${pct}% - 10px)`,zIndex:1}}/>
      </div>
    </div>
  )
}
