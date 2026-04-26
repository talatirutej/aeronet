// Copyright (c) 2026 Rutej Talati. All rights reserved.

import { useCallback, useRef, useState } from 'react'

const BODY_TYPES = [
  { value: 'notchback', label: 'Notchback' },
  { value: 'fastback',  label: 'Fastback'  },
  { value: 'estate',    label: 'Estate'    },
  { value: 'suv',       label: 'SUV'       },
  { value: 'pickup',    label: 'Pickup'    },
]

const TURBULENCE_MODELS = [
  { value: 'kw-sst', label: 'k-omega SST',      desc: 'Recommended — best for external automotive aero' },
  { value: 'ke-std', label: 'k-epsilon Standard',desc: 'Faster, good for attached flows'                 },
  { value: 'sa',     label: 'Spalart-Allmaras',  desc: 'Lightweight, aerospace-origin'                   },
]

const PRESETS = [
  { label: 'City',      uRef: 11.1, yaw: 0,  desc: '40 km/h, 0 deg yaw'   },
  { label: 'Highway',   uRef: 33.3, yaw: 3,  desc: '120 km/h, 3 deg yaw'  },
  { label: 'Track',     uRef: 55.6, yaw: 0,  desc: '200 km/h, 0 deg yaw'  },
  { label: 'Crosswind', uRef: 27.8, yaw: 12, desc: '100 km/h, 12 deg yaw' },
]

const T = {
  labelSm:  { fontSize: 11, fontWeight: 500, letterSpacing: '0.07em', textTransform: 'uppercase', color: '#8a9baa' },
  labelMd:  { fontSize: 12, fontWeight: 500, color: '#cac4d0' },
  mono:     { fontFamily: 'Roboto Mono, monospace', fontVariantNumeric: 'tabular-nums' },
  primary:  '#4dd8e8',
  surface1: '#141414',
  surfVar:  '#111',
  outline:  '#2e4048',
  divider:  '#222e34',
}

const Divider = () => <div style={{ height: 1, background: T.divider, margin: '2px 0' }} />

function SectionHeader({ num, title }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
      <div style={{
        width: 22, height: 22, borderRadius: '50%',
        background: 'rgba(77,216,232,0.12)', border: '1px solid rgba(77,216,232,0.25)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, fontWeight: 700, color: T.primary, flexShrink: 0,
      }}>{num}</div>
      <span style={T.labelSm}>{title}</span>
    </div>
  )
}

function SliderField({ label, value, min, max, step, unit, onChange, decimals = 0, tooltip }) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={T.labelMd}>{label}</span>
          {tooltip && <span title={tooltip} style={{ fontSize: 10, color: '#938f99', cursor: 'help' }}>i</span>}
        </div>
        <span style={{ ...T.mono, fontSize: 12, color: T.primary }}>
          {value.toFixed(decimals)}
          <span style={{ color: '#cac4d0', marginLeft: 4, fontSize: 11 }}>{unit}</span>
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="m3-slider" style={{ '--val': `${pct}%` }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', ...T.mono, fontSize: 10, color: '#938f99' }}>
        <span>{min}</span><span>{max}</span>
      </div>
    </div>
  )
}

function RunButton({ onClick, isLoading, disabled }) {
  const inactive = disabled || isLoading
  return (
    <button onClick={onClick} disabled={inactive}
      style={{
        width: '100%', height: 48, borderRadius: 12, border: 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
        fontSize: 14, fontWeight: 600, letterSpacing: '0.02em',
        cursor: inactive ? 'not-allowed' : 'pointer',
        background: inactive
          ? '#1c1c1c'
          : 'linear-gradient(135deg, #4dd8e8 0%, #1fbfd4 100%)',
        color: inactive ? '#938f99' : '#000',
        boxShadow: inactive ? 'none' : '0 4px 18px rgba(77,216,232,0.25)',
        transition: 'all 200ms cubic-bezier(0.2,0,0,1)',
      }}
      onMouseOver={e => { if (!inactive) e.currentTarget.style.boxShadow = '0 6px 24px rgba(77,216,232,0.4)' }}
      onMouseOut={e => { if (!inactive) e.currentTarget.style.boxShadow = '0 4px 18px rgba(77,216,232,0.25)' }}>
      {isLoading ? (
        <>
          <div style={{ width: 16, height: 16, borderRadius: '50%',
            border: '2px solid rgba(77,216,232,0.2)', borderTopColor: T.primary,
            animation: 'spin 1s linear infinite' }} />
          Running Prediction
        </>
      ) : (
        <>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
          Run Prediction
        </>
      )}
    </button>
  )
}

export default function InputPanel({ onSubmit, isLoading }) {
  const [file,        setFile]        = useState(null)
  const [dragging,    setDragging]    = useState(false)
  const [bodyType,    setBodyType]    = useState('fastback')
  const [sizeFactor,  setSizeFactor]  = useState(1.0)
  const [uRef,        setURef]        = useState(40)
  const [rho,         setRho]         = useState(1.225)
  const [aRef,        setARef]        = useState(2.4)
  const [yawAngle,    setYawAngle]    = useState(0)
  const [groundClear, setGroundClear] = useState(100)
  const [turbModel,   setTurbModel]   = useState('kw-sst')
  const inputRef = useRef()

  const accept = f => {
    const ok = ['.stl','.obj','.vtk','.ply'].some(ext => f?.name?.toLowerCase().endsWith(ext))
    if (ok) setFile(f)
  }
  const onDrop = useCallback(e => { e.preventDefault(); setDragging(false); accept(e.dataTransfer.files[0]) }, [])
  const handleSubmit = () => { if (!file || isLoading) return; onSubmit(file, { bodyType, sizeFactor, uRef, rho, aRef, yawAngleDeg: yawAngle, groundClearanceMm: groundClear }) }
  const fmt = n => n >= 1024 ? `${(n / 1024).toFixed(1)} MB` : `${Math.round(n)} KB`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, height: '100%', paddingBottom: 4 }}>

      {/* ── 01 Geometry ─────────────────────────────── */}
      <section>
        <SectionHeader num="01" title="Geometry Input" />

        {/* Drop zone */}
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => !file && inputRef.current?.click()}
          style={{
            borderRadius: 12,
            border: `1.5px dashed ${dragging ? T.primary : file ? T.outline : '#2e4048'}`,
            background: dragging ? 'rgba(77,216,232,0.06)' : file ? T.surface1 : T.surfVar,
            cursor: file ? 'default' : 'pointer',
            transition: 'all 180ms cubic-bezier(0.2,0,0,1)',
            transform: dragging ? 'scale(1.01)' : 'scale(1)',
          }}>
          <input ref={inputRef} type="file" accept=".stl,.obj,.vtk,.ply"
            style={{ display: 'none' }} onChange={e => accept(e.target.files[0])} />

          {file ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px' }}>
              <div style={{ width: 38, height: 38, borderRadius: 10,
                background: 'rgba(77,216,232,0.1)', border: '1px solid rgba(77,216,232,0.2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={T.primary} strokeWidth="1.5">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                </svg>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: '#fff',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</div>
                <div style={{ fontSize: 11, color: '#cac4d0', marginTop: 2 }}>{fmt(file.size / 1024)}</div>
              </div>
              <button onClick={e => { e.stopPropagation(); setFile(null) }}
                style={{ width: 28, height: 28, borderRadius: '50%', border: 'none',
                  background: 'transparent', color: '#cac4d0', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                onMouseOver={e => e.currentTarget.style.color = '#f87171'}
                onMouseOut={e => e.currentTarget.style.color = '#cac4d0'}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '22px 16px' }}>
              <div style={{ width: 42, height: 42, borderRadius: 12,
                background: dragging ? 'rgba(77,216,232,0.15)' : '#1c2a30',
                display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 180ms' }}>
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none"
                  stroke={dragging ? T.primary : '#938f99'} strokeWidth="1.5">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
              </div>
              <div style={{ fontSize: 13, fontWeight: 500, color: '#cac4d0' }}>Drop mesh file here</div>
              <div style={{ fontSize: 11, color: '#938f99' }}>STL  OBJ  VTK  PLY</div>
              <button className="m3-btn-text" style={{ fontSize: 12, marginTop: 2 }}>Browse files</button>
            </div>
          )}
        </div>

        {/* Run button directly under geometry — always shown, disabled when no file */}
        <div style={{ marginTop: 10 }}>
          <RunButton onClick={handleSubmit} isLoading={isLoading} disabled={!file} />
        </div>

        {/* Hint when no file */}
        {!file && (
          <div style={{ marginTop: 8, textAlign: 'center', fontSize: 11, color: '#938f99' }}>
            Upload a mesh file above to enable prediction
          </div>
        )}
      </section>

      <Divider />

      {/* ── 02 Body Configuration ───────────────────── */}
      <section>
        <SectionHeader num="02" title="Body Configuration" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={T.labelMd}>Body Type</label>
            <select value={bodyType} onChange={e => setBodyType(e.target.value)} className="m3-select">
              {BODY_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <SliderField label="Size Factor" value={sizeFactor} min={0.5} max={2.0} step={0.05}
            unit="x baseline" decimals={2} onChange={setSizeFactor}
            tooltip="Scale factor relative to DrivAerStar baseline" />
        </div>
      </section>

      <Divider />

      {/* ── 03 Flow Conditions ──────────────────────── */}
      <section>
        <SectionHeader num="03" title="Flow Conditions" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <div style={{ ...T.labelSm, marginBottom: 8 }}>Quick Presets</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {PRESETS.map(p => (
                <button key={p.label} onClick={() => { setURef(p.uRef); setYawAngle(p.yaw) }}
                  title={p.desc}
                  style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid #2e4048',
                    background: '#111', color: '#cac4d0', fontSize: 12, fontWeight: 500,
                    cursor: 'pointer', transition: 'all 140ms', textAlign: 'left' }}
                  onMouseOver={e => { e.currentTarget.style.borderColor = T.primary; e.currentTarget.style.color = T.primary }}
                  onMouseOut={e => { e.currentTarget.style.borderColor = '#2e4048'; e.currentTarget.style.color = '#cac4d0' }}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <SliderField label="Inflow Velocity" value={uRef} min={10} max={80} step={1}
            unit="m/s" onChange={setURef} tooltip="Free-stream velocity U-infinity" />
          <SliderField label="Yaw Angle" value={yawAngle} min={-15} max={15} step={0.5}
            unit="deg" decimals={1} onChange={setYawAngle}
            tooltip="Crosswind yaw angle — 0 is head-on, positive from right" />
          <SliderField label="Ground Clearance" value={groundClear} min={50} max={300} step={5}
            unit="mm" onChange={setGroundClear} tooltip="Ride height — affects underbody flow" />
          <SliderField label="Air Density" value={rho} min={0.9} max={1.5} step={0.005}
            unit="kg/m3" decimals={3} onChange={setRho} tooltip="Sea level ISA: 1.225 kg/m3" />
          <SliderField label="Ref. Frontal Area" value={aRef} min={1.5} max={4.0} step={0.01}
            unit="m2" decimals={2} onChange={setARef} tooltip="A_ref for coefficient normalisation" />
        </div>
      </section>

      <Divider />

      {/* ── 04 Turbulence Model ─────────────────────── */}
      <section>
        <SectionHeader num="04" title="Turbulence Model" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {TURBULENCE_MODELS.map(m => (
            <button key={m.value} onClick={() => setTurbModel(m.value)}
              style={{ padding: '10px 12px', borderRadius: 10, textAlign: 'left', cursor: 'pointer',
                border: turbModel === m.value ? `1px solid ${T.primary}` : '1px solid #2e4048',
                background: turbModel === m.value ? 'rgba(77,216,232,0.07)' : '#111',
                transition: 'all 150ms' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, fontWeight: 500,
                  color: turbModel === m.value ? T.primary : '#e6e1e5' }}>{m.label}</span>
                {turbModel === m.value && (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={T.primary} strokeWidth="2.5">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                )}
              </div>
              <div style={{ fontSize: 11, color: '#938f99', marginTop: 3 }}>{m.desc}</div>
            </button>
          ))}
          <div style={{ fontSize: 11, color: '#938f99', padding: '4px 2px', lineHeight: 1.5 }}>
            Current checkpoint uses k-omega SST. Selection applies to future trained models.
          </div>
        </div>
      </section>

      <div style={{ flex: 1 }} />
    </div>
  )
}
