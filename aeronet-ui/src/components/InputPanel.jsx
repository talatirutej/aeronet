// Copyright (c) 2026 Rutej Talati. All rights reserved.

import { useState, useRef, useCallback } from 'react'

const BODY_TYPES = [
  { id: 'fastback',  label: 'Fastback'  },
  { id: 'notchback', label: 'Notchback' },
  { id: 'estate',    label: 'Estate'    },
  { id: 'suv',       label: 'SUV'       },
  { id: 'pickup',    label: 'Pickup'    },
]

export default function InputPanel({ onSubmit, isLoading }) {
  const [file, setFile]       = useState(null)
  const [dragActive, setDragActive] = useState(false)
  const [params, setParams]   = useState({
    bodyType:   'fastback',
    uRef:       40,
    rho:        1.225,
    aRef:       2.37,
    sizeFactor: 1.0,
  })
  const inputRef = useRef(null)

  const handleDrop = useCallback((e) => {
    e.preventDefault(); e.stopPropagation()
    setDragActive(false)
    const f = e.dataTransfer.files?.[0]
    if (f) setFile(f)
  }, [])
  const handleDrag = useCallback((e) => {
    e.preventDefault(); e.stopPropagation()
    setDragActive(e.type === 'dragenter' || e.type === 'dragover')
  }, [])
  const handleFile = (e) => { const f = e.target.files?.[0]; if (f) setFile(f) }
  const updateParam = (k, v) => setParams(p => ({ ...p, [k]: v }))
  const submit = () => {
    if (!isLoading) onSubmit(file ?? new File(['demo'], 'demo_case.vtk', { type: 'model/vtk' }), params)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 16px 8px' }}>

        {/* Section: Geometry */}
        <div style={{ marginBottom: 24 }}>
          <div className="section-label">01 — Geometry Input</div>
          {/* Drop zone */}
          <div
            onDragEnter={handleDrag} onDragLeave={handleDrag}
            onDragOver={handleDrag} onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
            className="ios-card"
            style={{
              padding: '14px 16px',
              border: dragActive ? '1px solid var(--blue)' : '0.5px solid var(--sep)',
              background: dragActive ? 'rgba(10,132,255,0.06)' : 'var(--bg1)',
              cursor: 'pointer',
              transition: 'border-color 0.15s, background 0.15s',
            }}
          >
            <input ref={inputRef} type="file" accept=".vtk,.stl,.obj,.ply" onChange={handleFile} style={{ display: 'none' }} />
            {file ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 9,
                    background: 'rgba(10,132,255,0.15)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth="1.5">
                      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                      <polyline points="14 2 14 8 20 8"/>
                    </svg>
                  </div>
                  <div>
                    <div className="t-subhead" style={{ color: 'var(--label)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {file.name}
                    </div>
                    <div className="t-caption1 num" style={{ color: 'var(--label3)', marginTop: 1 }}>
                      {(file.size / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} KB
                    </div>
                  </div>
                </div>
                <button
                  onClick={e => { e.stopPropagation(); setFile(null) }}
                  style={{ width: 28, height: 28, borderRadius: 14, background: 'var(--bg3)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--label2)" strokeWidth="2">
                    <path d="M18 6L6 18M6 6l12 12"/>
                  </svg>
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 0' }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 9,
                  background: 'var(--bg2)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--label3)" strokeWidth="1.5">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                  </svg>
                </div>
                <div>
                  <div className="t-subhead" style={{ color: 'var(--label)' }}>Drop mesh file</div>
                  <div className="t-caption1" style={{ color: 'var(--label3)', marginTop: 1 }}>VTK · STL · OBJ · or click to browse</div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Section: Body config */}
        <div style={{ marginBottom: 24 }}>
          <div className="section-label">02 — Body Configuration</div>
          {/* Body type chips */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
            {BODY_TYPES.map(bt => (
              <button
                key={bt.id}
                onClick={() => updateParam('bodyType', bt.id)}
                className={`ios-chip ${params.bodyType === bt.id ? 'active' : ''}`}
              >
                {bt.label}
              </button>
            ))}
          </div>

          <div className="ios-card" style={{ padding: '4px 16px' }}>
            <SliderRow
              label="Size Factor" suffix="×"
              min={0.85} max={1.15} step={0.01}
              value={params.sizeFactor}
              display={params.sizeFactor.toFixed(2)}
              onChange={v => updateParam('sizeFactor', v)}
            />
          </div>
        </div>

        {/* Section: Flow conditions */}
        <div style={{ marginBottom: 8 }}>
          <div className="section-label">03 — Flow Conditions</div>
          <div className="ios-card" style={{ padding: '4px 16px' }}>
            <SliderRow
              label="Velocity" suffix="m/s"
              min={20} max={60} step={1}
              value={params.uRef}
              display={params.uRef.toFixed(0)}
              onChange={v => updateParam('uRef', v)}
            />
            <SliderRow
              label="Air Density" suffix="kg/m³"
              min={1.0} max={1.4} step={0.005}
              value={params.rho}
              display={params.rho.toFixed(3)}
              onChange={v => updateParam('rho', v)}
            />
            <SliderRow
              label="Frontal Area" suffix="m²"
              min={1.8} max={3.2} step={0.01}
              value={params.aRef}
              display={params.aRef.toFixed(2)}
              onChange={v => updateParam('aRef', v)}
              last
            />
          </div>
        </div>
      </div>

      {/* Run button */}
      <div style={{ padding: '12px 16px', borderTop: '0.5px solid var(--sep)' }}>
        <button
          onClick={submit}
          disabled={isLoading}
          className="ios-btn"
          style={{ width: '100%', height: 44, borderRadius: 12, fontSize: 15 }}
        >
          {isLoading ? (
            <>
              <svg className="anim-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="2">
                <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" opacity="0.3"/><path d="M12 3a9 9 0 019 9"/>
              </svg>
              Running inference…
            </>
          ) : (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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

function SliderRow({ label, suffix, min, max, step, value, display, onChange, last }) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div style={{
      padding: '12px 0',
      borderBottom: last ? 'none' : '0.5px solid var(--sep)',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
        <span className="t-subhead" style={{ color: 'var(--label2)' }}>{label}</span>
        <span className="mono t-subhead num" style={{ color: 'var(--blue)' }}>
          {display} <span style={{ color: 'var(--label3)', fontSize: 12 }}>{suffix}</span>
        </span>
      </div>
      <div style={{ position: 'relative', height: 22, display: 'flex', alignItems: 'center' }}>
        {/* Track */}
        <div style={{ position: 'absolute', left: 0, right: 0, height: 3, borderRadius: 9999, background: 'var(--bg3)' }}>
          <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', borderRadius: 9999, background: 'var(--blue)', width: `${pct}%` }} />
        </div>
        {/* Hidden native input for interaction */}
        <input
          type="range" min={min} max={max} step={step} value={value}
          onChange={e => onChange(parseFloat(e.target.value))}
          style={{ position: 'absolute', inset: 0, width: '100%', opacity: 0, cursor: 'pointer', height: '100%', zIndex: 2 }}
        />
        {/* Custom thumb */}
        <div style={{
          position: 'absolute', top: '50%', transform: 'translate(-50%, -50%)',
          left: `${pct}%`,
          width: 22, height: 22, borderRadius: '50%',
          background: '#fff',
          boxShadow: '0 1px 6px rgba(0,0,0,0.5)',
          pointerEvents: 'none', zIndex: 1,
        }} />
      </div>
    </div>
  )
}
