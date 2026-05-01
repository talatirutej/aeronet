// InputPanel.jsx — supports both full-car and car-part simulation modes.
// Car Part mode: user uploads a photo → Moondream2 identifies the part
// → 3D viewer shows a part-shaped Cp field.
// Copyright (c) 2026 Rutej Talati. All rights reserved.

import { useState, useRef, useCallback } from 'react'
import { Upload, FileCode, X, PlayCircle, Loader2, Camera, ScanSearch } from 'lucide-react'

const BODY_TYPES = [
  { id: 'fastback',  label: 'Fastback'  },
  { id: 'notchback', label: 'Notchback' },
  { id: 'estate',    label: 'Estate'    },
  { id: 'suv',       label: 'SUV'       },
  { id: 'pickup',    label: 'Pickup'    },
]

const PART_TYPES = [
  { id: 'front_bumper',   label: 'Front Bumper',   location: 'front'    },
  { id: 'rear_bumper',    label: 'Rear Bumper',    location: 'rear'     },
  { id: 'front_splitter', label: 'Front Splitter', location: 'front'    },
  { id: 'rear_spoiler',   label: 'Rear Spoiler',   location: 'rear'     },
  { id: 'rear_wing',      label: 'Rear Wing',      location: 'rear'     },
  { id: 'diffuser',       label: 'Diffuser',       location: 'underbody'},
  { id: 'side_mirror',    label: 'Side Mirror',    location: 'side'     },
  { id: 'wheel',          label: 'Wheel',          location: 'side'     },
  { id: 'wheel_cover',    label: 'Wheel Cover',    location: 'side'     },
  { id: 'side_skirt',     label: 'Side Skirt',     location: 'side'     },
  { id: 'canard',         label: 'Canard',         location: 'front'    },
  { id: 'hood_vent',      label: 'Hood Vent',      location: 'top'      },
  { id: 'grille',         label: 'Grille',         location: 'front'    },
]

const BACKEND = import.meta.env?.VITE_AERONET_BACKEND ?? 'http://127.0.0.1:8000'

export default function InputPanel({ onSubmit, isLoading }) {
  // Mode: 'car' or 'part'
  const [mode, setMode] = useState('car')

  // Mesh file (for 3D viewer)
  const [meshFile, setMeshFile] = useState(null)
  const [meshDrag, setMeshDrag] = useState(false)
  const meshRef = useRef(null)

  // Image file (for Moondream2 part identification)
  const [imageFile,  setImageFile]  = useState(null)
  const [imagePrev,  setImagePrev]  = useState(null)
  const [imageAnalysis, setImageAnalysis] = useState(null)
  const [analyzing,  setAnalyzing]  = useState(false)
  const imageRef = useRef(null)

  // Car params
  const [params, setParams] = useState({
    bodyType: 'fastback',
    uRef: 40,
    rho:  1.225,
    aRef: 2.37,
    sizeFactor: 1.0,
    yawAngleDeg: 0,
    groundClearanceMm: 100,
  })

  // Part params (auto-filled by Moondream2 or manually set)
  const [partType,     setPartType]     = useState('front_bumper')
  const [partLocation, setPartLocation] = useState('front')
  const [partSpeed,    setPartSpeed]    = useState(40)

  const updateParam = (k, v) => setParams(p => ({ ...p, [k]: v }))

  // ── Mesh file drop ────────────────────────────────────────────────────────

  const handleMeshDrop = useCallback((e) => {
    e.preventDefault(); setMeshDrag(false)
    const f = e.dataTransfer.files?.[0]
    if (f) setMeshFile(f)
  }, [])
  const handleMeshDrag = useCallback((e) => {
    e.preventDefault()
    setMeshDrag(e.type === 'dragenter' || e.type === 'dragover')
  }, [])

  // ── Image file + Moondream2 analysis ─────────────────────────────────────

  const handleImageFile = async (file) => {
    if (!file) return
    setImageFile(file)
    setImagePrev(URL.createObjectURL(file))
    setImageAnalysis(null)
    setAnalyzing(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(`${BACKEND}/analyze`, { method: 'POST', body: fd })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setImageAnalysis(data)
      // Auto-fill part type if Moondream2 identified a part
      if (data.image_type === 'car_part') {
        const partName = data.analysis?.part_confirmed ?? ''
        const matched  = PART_TYPES.find(p =>
          partName.toLowerCase().includes(p.id.replace('_', ' ')) ||
          p.label.toLowerCase().includes(partName.toLowerCase().split(' ')[0])
        )
        if (matched) {
          setPartType(matched.id)
          setPartLocation(matched.location)
        }
        if (data.detection?.part_location) {
          const loc = data.detection.part_location
          if (['front','rear','side','top','underbody'].includes(loc))
            setPartLocation(loc)
        }
      }
    } catch (err) {
      console.error('Moondream2 analysis failed:', err)
    } finally {
      setAnalyzing(false)
    }
  }

  // ── Submit ────────────────────────────────────────────────────────────────

  const submit = () => {
    if (isLoading) return
    if (mode === 'car') {
      const file = meshFile ?? new File(['demo'], 'demo_case.stl', { type: 'model/stl' })
      onSubmit(file, { ...params, mode: 'car' })
    } else {
      const file = meshFile ?? new File(['demo'], 'demo_part.stl', { type: 'model/stl' })
      onSubmit(file, {
        mode: 'part',
        partType,
        partLocation,
        uRef: partSpeed,
        rho:  params.rho,
        aRef: params.aRef,
        imageAnalysis: imageAnalysis ?? null,
      })
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-2 space-y-6">

        {/* ── Mode toggle ── */}
        <div className="flex gap-1 p-1 bg-m3-surface2 rounded-lg">
          {[
            { id: 'car',  label: '🚗 Full Car'  },
            { id: 'part', label: '🔧 Car Part'  },
          ].map(m => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              className={`flex-1 py-2 rounded-md text-label-md font-medium transition-all
                ${mode === m.id
                  ? 'bg-m3-primary text-m3-onPrimary shadow-elev1'
                  : 'text-m3-onSurfVar hover:text-m3-onBg'}`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* ── Full Car mode ── */}
        {mode === 'car' && (
          <>
            <Section label="01" title="Geometry Input">
              <MeshDropZone
                file={meshFile}
                dragActive={meshDrag}
                inputRef={meshRef}
                onDrag={handleMeshDrag}
                onDrop={handleMeshDrop}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) setMeshFile(f) }}
                onClear={() => setMeshFile(null)}
                accept=".vtk,.stl,.obj,.ply"
                hint="VTK / STL / OBJ / PLY"
              />
            </Section>

            <Section label="02" title="Body Configuration">
              <div className="space-y-2">
                <span className="text-label-md text-m3-onSurfVar uppercase tracking-wider">Body Type</span>
                <div className="flex flex-wrap gap-2">
                  {BODY_TYPES.map(bt => (
                    <button
                      key={bt.id}
                      onClick={() => updateParam('bodyType', bt.id)}
                      className={`px-3 py-1.5 rounded-full border text-label-md transition-all
                        ${params.bodyType === bt.id
                          ? 'bg-m3-primary text-m3-onPrimary border-m3-primary'
                          : 'border-m3-outlineVar text-m3-onSurfVar hover:border-m3-primary'}`}
                    >
                      {bt.label}
                    </button>
                  ))}
                </div>
              </div>
              <SliderField label="Size Factor" suffix="× baseline" min={0.85} max={1.15} step={0.01}
                value={params.sizeFactor} display={params.sizeFactor.toFixed(2)}
                onChange={v => updateParam('sizeFactor', v)} />
              <SliderField label="Yaw Angle" suffix="°" min={-15} max={15} step={0.5}
                value={params.yawAngleDeg} display={params.yawAngleDeg.toFixed(1)}
                onChange={v => updateParam('yawAngleDeg', v)} />
              <SliderField label="Ground Clearance" suffix="mm" min={60} max={200} step={5}
                value={params.groundClearanceMm} display={params.groundClearanceMm.toFixed(0)}
                onChange={v => updateParam('groundClearanceMm', v)} />
            </Section>

            <Section label="03" title="Flow Conditions">
              <SliderField label="Inflow Velocity" suffix="m/s" min={20} max={60} step={1}
                value={params.uRef} display={params.uRef.toFixed(0)}
                onChange={v => updateParam('uRef', v)} />
              <SliderField label="Air Density" suffix="kg/m³" min={1.0} max={1.4} step={0.005}
                value={params.rho} display={params.rho.toFixed(3)}
                onChange={v => updateParam('rho', v)} />
              <SliderField label="Ref. Frontal Area" suffix="m²" min={1.8} max={3.2} step={0.01}
                value={params.aRef} display={params.aRef.toFixed(2)}
                onChange={v => updateParam('aRef', v)} />
            </Section>
          </>
        )}

        {/* ── Car Part mode ── */}
        {mode === 'part' && (
          <>
            {/* Step 1: Photo for Moondream2 identification */}
            <Section label="01" title="Identify Part (optional)">
              <div className="text-body-sm text-m3-onSurfVar mb-2">
                Upload a photo of the part — Moondream2 will identify it and pre-fill the settings below.
              </div>
              <div
                className={`relative rounded-lg border-2 border-dashed p-4 cursor-pointer transition-all
                  ${imagePrev ? 'border-m3-primary/60' : 'border-m3-outlineVar hover:border-m3-primary/60'}`}
                onClick={() => imageRef.current?.click()}
              >
                <input ref={imageRef} type="file" accept="image/*" className="hidden"
                  onChange={e => handleImageFile(e.target.files?.[0])} />
                {imagePrev ? (
                  <div className="flex gap-3 items-start">
                    <img src={imagePrev} alt="part" className="w-20 h-20 object-cover rounded-md" />
                    <div className="flex-1 min-w-0">
                      {analyzing && (
                        <div className="flex items-center gap-2 text-label-sm text-m3-primary">
                          <ScanSearch size={14} className="animate-pulse" />
                          <span>Moondream2 analysing…</span>
                        </div>
                      )}
                      {imageAnalysis && !analyzing && (
                        <div className="space-y-1">
                          <div className="text-label-sm text-m3-ok flex items-center gap-1">
                            ✓ Identified
                          </div>
                          <div className="text-body-sm text-m3-onBg font-medium">
                            {imageAnalysis.analysis?.part_confirmed
                              ?? imageAnalysis.detection?.what_i_see
                              ?? 'Unknown part'}
                          </div>
                          {imageAnalysis.analysis?.aero_function?.drag_effect && (
                            <div className="text-label-sm text-m3-onSurfVar">
                              Drag effect: <span className="font-medium text-m3-onBg capitalize">
                                {imageAnalysis.analysis.aero_function.drag_effect}
                              </span>
                            </div>
                          )}
                          {imageAnalysis.analysis?.aero_function?.estimated_cd_contribution != null && (
                            <div className="text-label-sm text-m3-onSurfVar font-mono">
                              ΔCd ≈ {Number(imageAnalysis.analysis.aero_function.estimated_cd_contribution).toFixed(3)}
                            </div>
                          )}
                        </div>
                      )}
                      <button
                        className="mt-2 text-label-sm text-m3-outlineVar hover:text-m3-err"
                        onClick={e => { e.stopPropagation(); setImageFile(null); setImagePrev(null); setImageAnalysis(null) }}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <Camera size={24} className="text-m3-outlineVar" />
                    <div>
                      <div className="text-label-md text-m3-onSurface">Drop part photo</div>
                      <div className="text-body-sm text-m3-outlineVar">JPG / PNG / WEBP</div>
                    </div>
                  </div>
                )}
              </div>
            </Section>

            {/* Step 2: Part mesh (optional) */}
            <Section label="02" title="Part Mesh (optional)">
              <MeshDropZone
                file={meshFile}
                dragActive={meshDrag}
                inputRef={meshRef}
                onDrag={handleMeshDrag}
                onDrop={handleMeshDrop}
                onChange={e => { const f = e.target.files?.[0]; if (f) setMeshFile(f) }}
                onClear={() => setMeshFile(null)}
                accept=".stl,.obj,.ply"
                hint="STL / OBJ / PLY — or skip to use generated geometry"
              />
            </Section>

            {/* Step 3: Part configuration */}
            <Section label="03" title="Part Configuration">
              <div className="space-y-2">
                <span className="text-label-md text-m3-onSurfVar uppercase tracking-wider">Part Type</span>
                <div className="flex flex-wrap gap-1.5">
                  {PART_TYPES.map(pt => (
                    <button
                      key={pt.id}
                      onClick={() => { setPartType(pt.id); setPartLocation(pt.location) }}
                      className={`px-2.5 py-1 rounded-full border text-label-sm transition-all
                        ${partType === pt.id
                          ? 'bg-m3-primary text-m3-onPrimary border-m3-primary'
                          : 'border-m3-outlineVar text-m3-onSurfVar hover:border-m3-primary'}`}
                    >
                      {pt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-2 mt-2">
                {['front','rear','side','top','underbody'].map(loc => (
                  <button
                    key={loc}
                    onClick={() => setPartLocation(loc)}
                    className={`flex-1 py-1 rounded text-label-sm capitalize border transition-all
                      ${partLocation === loc
                        ? 'bg-m3-secCont text-m3-onSecCont border-m3-secondary'
                        : 'border-m3-outlineVar text-m3-outlineVar hover:border-m3-secondary'}`}
                  >
                    {loc}
                  </button>
                ))}
              </div>

              <SliderField label="Flow Speed" suffix="m/s" min={20} max={80} step={1}
                value={partSpeed} display={partSpeed.toFixed(0)}
                onChange={v => setPartSpeed(v)} />
              <SliderField label="Air Density" suffix="kg/m³" min={1.0} max={1.4} step={0.005}
                value={params.rho} display={params.rho.toFixed(3)}
                onChange={v => updateParam('rho', v)} />
            </Section>
          </>
        )}
      </div>

      {/* Run button */}
      <div className="px-4 py-3 border-t border-m3-outlineVar">
        <button onClick={submit} disabled={isLoading}
          className={`w-full h-12 rounded-xl flex items-center justify-center gap-2
                      font-medium text-body-md transition-all
                      ${isLoading
                        ? 'bg-m3-surface2 text-m3-outlineVar cursor-not-allowed'
                        : 'bg-m3-primary text-m3-onPrimary hover:shadow-glow-sm active:scale-[0.98]'}`}
        >
          {isLoading ? (
            <><Loader2 size={18} className="animate-spin" /><span>Running…</span></>
          ) : (
            <><PlayCircle size={18} />
              <span>{mode === 'car' ? 'Run Full Car Simulation' : 'Run Part Simulation'}</span>
            </>
          )}
        </button>
      </div>
    </div>
  )
}

// ── Shared sub-components ─────────────────────────────────────────────────────

function MeshDropZone({ file, dragActive, inputRef, onDrag, onDrop, onChange, onClear, accept, hint }) {
  return (
    <div
      onDragEnter={onDrag} onDragLeave={onDrag} onDragOver={onDrag} onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
      className={`relative rounded-lg border-2 border-dashed p-4 cursor-pointer
        transition-all min-h-[80px] flex items-center
        ${dragActive
          ? 'border-m3-primary bg-m3-primaryCont/20'
          : 'border-m3-outlineVar hover:border-m3-primary/60 bg-m3-surface'}`}
    >
      <input ref={inputRef} type="file" accept={accept} onChange={onChange} className="hidden" />
      {file ? (
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-m3-primaryCont">
              <FileCode size={18} color="#4dd8e8" strokeWidth={1.5} />
            </div>
            <div>
              <div className="text-label-lg text-m3-onBg truncate max-w-[140px]">{file.name}</div>
              <div className="text-body-sm text-m3-outlineVar">
                {(file.size / 1024).toFixed(1)} KB
              </div>
            </div>
          </div>
          <button onClick={e => { e.stopPropagation(); onClear() }}
            className="w-7 h-7 rounded-full flex items-center justify-center
                       text-m3-outlineVar hover:text-m3-err hover:bg-m3-errCont/20 transition-colors">
            <X size={14} />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-3 w-full">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-m3-surface2">
            <Upload size={18} className="text-m3-outlineVar" strokeWidth={1.5} />
          </div>
          <div>
            <div className="text-label-md text-m3-onSurface">Drop mesh file</div>
            <div className="text-body-sm text-m3-outlineVar">{hint}</div>
          </div>
        </div>
      )}
    </div>
  )
}

function Section({ label, title, children }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-label-md text-m3-primary font-mono">{label}</span>
        <div className="flex-1 h-px bg-m3-outlineVar" />
        <span className="text-label-md text-m3-onSurfVar uppercase tracking-wider">{title}</span>
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  )
}

function SliderField({ label, suffix, min, max, step, value, display, onChange }) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-label-md text-m3-onSurfVar uppercase tracking-wider">{label}</span>
        <span className="text-label-lg text-m3-primary font-mono">
          {display} <span className="text-body-sm text-m3-outlineVar">{suffix}</span>
        </span>
      </div>
      <div className="relative pt-1 pb-1">
        <div className="h-1 rounded-full bg-m3-surface3 relative">
          <div className="absolute left-0 top-0 h-1 rounded-full bg-m3-primary"
               style={{ width: `${pct}%` }} />
        </div>
        <input type="range" min={min} max={max} step={step} value={value}
          onChange={e => onChange(parseFloat(e.target.value))}
          className="absolute inset-0 w-full opacity-0 cursor-pointer h-full"
          style={{ zIndex: 2 }} />
        <div className="absolute top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-m3-primary
                        shadow-elev1 pointer-events-none"
             style={{ left: `calc(${pct}% - 10px)`, zIndex: 1 }} />
      </div>
    </div>
  )
}
