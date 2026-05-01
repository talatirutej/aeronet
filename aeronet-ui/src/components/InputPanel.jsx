// InputPanel.jsx — Full Car + Car Part simulation modes
// Uses project CSS variables & classes — no Tailwind, no M3 tokens
// Copyright (c) 2026 Rutej Talati. All rights reserved.

import { useState, useRef, useCallback } from 'react'

const BODY_TYPES = [
  { id: 'fastback',  label: 'Fastback'  },
  { id: 'notchback', label: 'Notchback' },
  { id: 'estate',    label: 'Estate'    },
  { id: 'suv',       label: 'SUV'       },
  { id: 'pickup',    label: 'Pickup'    },
]

const PART_TYPES = [
  { id: 'front_bumper',   label: 'Front Bumper',   location: 'front'     },
  { id: 'rear_bumper',    label: 'Rear Bumper',     location: 'rear'      },
  { id: 'front_splitter', label: 'Front Splitter',  location: 'front'     },
  { id: 'rear_spoiler',   label: 'Rear Spoiler',    location: 'rear'      },
  { id: 'rear_wing',      label: 'Rear Wing',       location: 'rear'      },
  { id: 'diffuser',       label: 'Diffuser',        location: 'underbody' },
  { id: 'side_mirror',    label: 'Side Mirror',     location: 'side'      },
  { id: 'wheel',          label: 'Wheel',           location: 'side'      },
  { id: 'wheel_cover',    label: 'Wheel Cover',     location: 'side'      },
  { id: 'side_skirt',     label: 'Side Skirt',      location: 'side'      },
  { id: 'canard',         label: 'Canard',          location: 'front'     },
  { id: 'hood_vent',      label: 'Hood Vent',       location: 'top'       },
  { id: 'grille',         label: 'Grille',          location: 'front'     },
]

const LOCATIONS = ['front', 'rear', 'side', 'top', 'underbody']
const BACKEND = import.meta.env?.VITE_AERONET_BACKEND ?? 'http://127.0.0.1:8000'

// ── Sub-components ────────────────────────────────────────────────────────────

function Section({ label, number, children }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{
        fontSize: 11, fontWeight: 600, letterSpacing: '0.08em',
        textTransform: 'uppercase', color: 'var(--text-tertiary)',
        marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6,
      }}>
        {number && <span style={{ color: 'var(--blue)', fontFamily: "'IBM Plex Mono', monospace" }}>{number}</span>}
        {label}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>
    </div>
  )
}

function SliderField({ label, suffix, min, max, step, value, display, onChange }) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 7 }}>
        <span style={{ fontSize: 12, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>{label}</span>
        <span style={{ fontSize: 13, color: 'var(--blue)', fontFamily: "'IBM Plex Mono', monospace" }}>
          {display}<span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginLeft: 3 }}>{suffix}</span>
        </span>
      </div>
      <div style={{ position: 'relative', height: 22, display: 'flex', alignItems: 'center' }}>
        <div style={{ position: 'absolute', inset: '0 0', height: 3, top: '50%', transform: 'translateY(-50%)', background: 'var(--bg3)', borderRadius: 9999 }}>
          <div style={{ width: `${pct}%`, height: '100%', background: 'var(--blue)', borderRadius: 9999 }} />
        </div>
        <div style={{
          position: 'absolute', left: `calc(${pct}% - 9px)`, top: '50%', transform: 'translateY(-50%)',
          width: 18, height: 18, borderRadius: '50%',
          background: 'var(--blue)', border: '2.5px solid var(--bg0)',
          boxShadow: '0 1px 4px rgba(0,0,0,0.6)', pointerEvents: 'none', zIndex: 1,
        }} />
        <input
          type="range" min={min} max={max} step={step} value={value}
          onChange={e => onChange(parseFloat(e.target.value))}
          style={{ position: 'absolute', inset: 0, width: '100%', opacity: 0, cursor: 'pointer', zIndex: 2, margin: 0, height: '100%' }}
        />
      </div>
    </div>
  )
}

function DropZone({ file, dragActive, onDrag, onDrop, inputRef, onChange, onClear, accept, hint }) {
  return (
    <div
      onDragEnter={onDrag} onDragLeave={onDrag} onDragOver={onDrag} onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
      style={{
        border: `1.5px dashed ${dragActive ? 'var(--blue)' : 'var(--bg3)'}`,
        borderRadius: 10, padding: '14px 16px', cursor: 'pointer',
        background: dragActive ? 'rgba(10,132,255,0.06)' : 'var(--bg1)',
        transition: 'border-color 0.15s, background 0.15s',
        display: 'flex', alignItems: 'center', minHeight: 68,
      }}
    >
      <input ref={inputRef} type="file" accept={accept} onChange={onChange} style={{ display: 'none' }} />
      {file ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <div style={{
              width: 34, height: 34, borderRadius: 8, flexShrink: 0,
              background: 'rgba(10,132,255,0.12)', border: '0.5px solid rgba(10,132,255,0.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth="1.5">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
              </svg>
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</div>
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 1 }}>{(file.size / 1024).toFixed(1)} KB</div>
            </div>
          </div>
          <button onClick={e => { e.stopPropagation(); onClear() }}
            style={{ width: 26, height: 26, border: 'none', borderRadius: 6, cursor: 'pointer', background: 'transparent', color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 34, height: 34, borderRadius: 8, background: 'var(--bg2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5">
              <polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/>
              <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500 }}>Drop mesh file</div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>{hint}</div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function InputPanel({ onSubmit, isLoading }) {
  const [mode, setMode] = useState('car')
  const [meshFile, setMeshFile] = useState(null)
  const [meshDrag, setMeshDrag] = useState(false)
  const meshRef = useRef(null)

  const [imageFile,     setImageFile]     = useState(null)
  const [imagePrev,     setImagePrev]     = useState(null)
  const [imageAnalysis, setImageAnalysis] = useState(null)
  const [analyzing,     setAnalyzing]     = useState(false)
  const imageRef = useRef(null)

  const [params, setParams] = useState({
    bodyType: 'fastback', uRef: 40, rho: 1.225, aRef: 2.37,
    sizeFactor: 1.0, yawAngleDeg: 0, groundClearanceMm: 100,
  })
  const [partType,     setPartType]     = useState('front_bumper')
  const [partLocation, setPartLocation] = useState('front')
  const [partSpeed,    setPartSpeed]    = useState(40)

  const updateParam = (k, v) => setParams(p => ({ ...p, [k]: v }))

  const handleMeshDrop = useCallback((e) => {
    e.preventDefault(); setMeshDrag(false)
    const f = e.dataTransfer.files?.[0]; if (f) setMeshFile(f)
  }, [])
  const handleMeshDrag = useCallback((e) => {
    e.preventDefault(); setMeshDrag(e.type === 'dragenter' || e.type === 'dragover')
  }, [])

  const handleImageFile = async (file) => {
    if (!file) return
    setImageFile(file); setImagePrev(URL.createObjectURL(file)); setImageAnalysis(null); setAnalyzing(true)
    try {
      const fd = new FormData(); fd.append('file', file)
      const res = await fetch(`${BACKEND}/analyze`, { method: 'POST', body: fd })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setImageAnalysis(data)
      if (data.image_type === 'car_part') {
        const partName = data.analysis?.part_confirmed ?? ''
        const matched = PART_TYPES.find(p =>
          partName.toLowerCase().includes(p.id.replace('_', ' ')) ||
          p.label.toLowerCase().includes(partName.toLowerCase().split(' ')[0])
        )
        if (matched) { setPartType(matched.id); setPartLocation(matched.location) }
        if (data.detection?.part_location && LOCATIONS.includes(data.detection.part_location))
          setPartLocation(data.detection.part_location)
      }
    } catch (err) { console.error('Moondream2 analysis failed:', err) }
    finally { setAnalyzing(false) }
  }

  const submit = () => {
    if (isLoading) return
    if (mode === 'car') {
      onSubmit(meshFile ?? new File(['demo'], 'demo_case.stl', { type: 'model/stl' }), { ...params, mode: 'car' })
    } else {
      onSubmit(meshFile ?? new File(['demo'], 'demo_part.stl', { type: 'model/stl' }), { mode: 'part', partType, partLocation, uRef: partSpeed, rho: params.rho, aRef: params.aRef, imageAnalysis })
    }
  }

  const spinStyle = { width: 14, height: 14, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', animation: 'spin 0.85s linear infinite', flexShrink: 0 }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* Scrollable area */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 8px' }}>

        {/* Mode toggle */}
        <div style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--bg2)', borderRadius: 10, marginBottom: 20 }}>
          {[{ id: 'car', label: '🚗 Full Car' }, { id: 'part', label: '🔧 Car Part' }].map(m => (
            <button key={m.id} onClick={() => setMode(m.id)} style={{
              flex: 1, padding: '7px 0', borderRadius: 7, border: 'none', cursor: 'pointer',
              background: mode === m.id ? 'var(--blue)' : 'transparent',
              color: mode === m.id ? '#fff' : 'var(--text-tertiary)',
              fontSize: 13, fontWeight: mode === m.id ? 600 : 400,
              fontFamily: "'IBM Plex Sans', sans-serif",
              transition: 'background 0.15s, color 0.15s',
            }}>
              {m.label}
            </button>
          ))}
        </div>

        {/* ── FULL CAR ── */}
        {mode === 'car' && <>
          <Section number="01" label="Geometry Input">
            <DropZone file={meshFile} dragActive={meshDrag} inputRef={meshRef}
              onDrag={handleMeshDrag} onDrop={handleMeshDrop}
              onChange={e => { const f = e.target.files?.[0]; if (f) setMeshFile(f) }}
              onClear={() => setMeshFile(null)} accept=".vtk,.stl,.obj,.ply" hint="VTK / STL / OBJ / PLY" />
          </Section>

          <Section number="02" label="Body Configuration">
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: 8 }}>Body Type</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {BODY_TYPES.map(bt => (
                  <button key={bt.id} onClick={() => updateParam('bodyType', bt.id)}
                    className={`ios-chip${params.bodyType === bt.id ? ' ios-chip-active' : ''}`}>
                    {bt.label}
                  </button>
                ))}
              </div>
            </div>
            <SliderField label="Size Factor" suffix="× baseline" min={0.85} max={1.15} step={0.01} value={params.sizeFactor} display={params.sizeFactor.toFixed(2)} onChange={v => updateParam('sizeFactor', v)} />
            <SliderField label="Yaw Angle" suffix="°" min={-15} max={15} step={0.5} value={params.yawAngleDeg} display={params.yawAngleDeg.toFixed(1)} onChange={v => updateParam('yawAngleDeg', v)} />
            <SliderField label="Ground Clearance" suffix="mm" min={60} max={200} step={5} value={params.groundClearanceMm} display={params.groundClearanceMm.toFixed(0)} onChange={v => updateParam('groundClearanceMm', v)} />
          </Section>

          <Section number="03" label="Flow Conditions">
            <SliderField label="Inflow Velocity" suffix="m/s" min={20} max={60} step={1} value={params.uRef} display={params.uRef.toFixed(0)} onChange={v => updateParam('uRef', v)} />
            <SliderField label="Air Density" suffix="kg/m³" min={1.0} max={1.4} step={0.005} value={params.rho} display={params.rho.toFixed(3)} onChange={v => updateParam('rho', v)} />
            <SliderField label="Ref. Frontal Area" suffix="m²" min={1.8} max={3.2} step={0.01} value={params.aRef} display={params.aRef.toFixed(2)} onChange={v => updateParam('aRef', v)} />
          </Section>
        </>}

        {/* ── CAR PART ── */}
        {mode === 'part' && <>
          <Section number="01" label="Identify Part (optional)">
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
              Upload a photo — Moondream2 will identify the part and pre-fill settings below.
            </div>
            <div onClick={() => imageRef.current?.click()} style={{
              border: `1.5px dashed ${imagePrev ? 'rgba(10,132,255,0.5)' : 'var(--bg3)'}`,
              borderRadius: 10, padding: 14, cursor: 'pointer',
              background: imagePrev ? 'rgba(10,132,255,0.05)' : 'var(--bg1)',
              transition: 'border-color 0.15s',
            }}>
              <input ref={imageRef} type="file" accept="image/*" style={{ display: 'none' }}
                onChange={e => handleImageFile(e.target.files?.[0])} />
              {imagePrev ? (
                <div style={{ display: 'flex', gap: 12 }}>
                  <img src={imagePrev} alt="part" style={{ width: 68, height: 68, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {analyzing && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--blue)', marginBottom: 4 }}>
                        <div style={spinStyle} /> Moondream2 analysing…
                      </div>
                    )}
                    {imageAnalysis && !analyzing && (
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--green)', fontWeight: 600, marginBottom: 3 }}>✓ Identified</div>
                        <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500, marginBottom: 3 }}>
                          {imageAnalysis.analysis?.part_confirmed ?? 'Unknown part'}
                        </div>
                        {imageAnalysis.analysis?.aero_function?.drag_effect && (
                          <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                            Drag: <span style={{ color: 'var(--text-secondary)', fontWeight: 500, textTransform: 'capitalize' }}>
                              {imageAnalysis.analysis.aero_function.drag_effect}
                            </span>
                          </div>
                        )}
                        {imageAnalysis.analysis?.aero_function?.estimated_cd_contribution != null && (
                          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: "'IBM Plex Mono', monospace" }}>
                            ΔCd ≈ {Number(imageAnalysis.analysis.aero_function.estimated_cd_contribution).toFixed(3)}
                          </div>
                        )}
                      </div>
                    )}
                    <button onClick={e => { e.stopPropagation(); setImageFile(null); setImagePrev(null); setImageAnalysis(null) }}
                      style={{ marginTop: 6, fontSize: 11, color: 'var(--text-tertiary)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                      Remove
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 34, height: 34, borderRadius: 8, background: 'var(--bg2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5">
                      <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
                    </svg>
                  </div>
                  <div>
                    <div style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500 }}>Drop part photo</div>
                    <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>JPG / PNG / WEBP</div>
                  </div>
                </div>
              )}
            </div>
          </Section>

          <Section number="02" label="Part Mesh (optional)">
            <DropZone file={meshFile} dragActive={meshDrag} inputRef={meshRef}
              onDrag={handleMeshDrag} onDrop={handleMeshDrop}
              onChange={e => { const f = e.target.files?.[0]; if (f) setMeshFile(f) }}
              onClear={() => setMeshFile(null)} accept=".stl,.obj,.ply" hint="STL / OBJ / PLY — or skip for auto geometry" />
          </Section>

          <Section number="03" label="Part Configuration">
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: 8 }}>Part Type</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {PART_TYPES.map(pt => (
                  <button key={pt.id} onClick={() => { setPartType(pt.id); setPartLocation(pt.location) }}
                    className={`ios-chip${partType === pt.id ? ' ios-chip-active' : ''}`}
                    style={{ fontSize: 11, padding: '4px 10px' }}>
                    {pt.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: 8 }}>Location</div>
              <div style={{ display: 'flex', gap: 5 }}>
                {LOCATIONS.map(loc => (
                  <button key={loc} onClick={() => setPartLocation(loc)} style={{
                    flex: 1, padding: '5px 0', borderRadius: 7, cursor: 'pointer',
                    border: `0.5px solid ${partLocation === loc ? 'var(--blue)' : 'var(--bg3)'}`,
                    background: partLocation === loc ? 'rgba(10,132,255,0.12)' : 'transparent',
                    color: partLocation === loc ? 'var(--blue)' : 'var(--text-tertiary)',
                    fontSize: 10, fontWeight: partLocation === loc ? 600 : 400,
                    fontFamily: "'IBM Plex Sans', sans-serif", textTransform: 'capitalize',
                    transition: 'all 0.12s',
                  }}>
                    {loc}
                  </button>
                ))}
              </div>
            </div>
            <SliderField label="Flow Speed" suffix="m/s" min={20} max={80} step={1} value={partSpeed} display={partSpeed.toFixed(0)} onChange={v => setPartSpeed(v)} />
            <SliderField label="Air Density" suffix="kg/m³" min={1.0} max={1.4} step={0.005} value={params.rho} display={params.rho.toFixed(3)} onChange={v => updateParam('rho', v)} />
          </Section>
        </>}
      </div>

      {/* Run button */}
      <div style={{ padding: '12px 16px', borderTop: '0.5px solid var(--sep)', flexShrink: 0 }}>
        <button onClick={submit} disabled={isLoading} className="ios-btn" style={{ width: '100%', height: 44, fontSize: 14 }}>
          {isLoading ? (
            <><div style={spinStyle} /> Running inference…</>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <polygon points="5 3 19 12 5 21 5 3"/>
              </svg>
              {mode === 'car' ? 'Run Full Car Simulation' : 'Run Part Simulation'}
            </>
          )}
        </button>
      </div>
    </div>
  )
}
