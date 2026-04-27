// Copyright (c) 2026 Rutej Talati. All rights reserved.

import { useState, useCallback } from 'react'

const BACKEND = import.meta.env?.VITE_AERONET_BACKEND ?? 'https://aeronet-osiw.onrender.com'

const FEATURE_DEFS = [
  { key: 'Vehicle_Length',      label: 'Vehicle Length',      unit: 'm',   min: 40, max: 60,   step: 0.5,  dp: 1  },
  { key: 'Vehicle_Width',       label: 'Vehicle Width',       unit: 'm',   min: 0.5, max: 0.75, step: 0.01, dp: 3  },
  { key: 'Vehicle_Height',      label: 'Vehicle Height',      unit: 'm',   min: 0.08, max: 0.18, step: 0.005, dp: 3 },
  { key: 'Front_Overhang',      label: 'Front Overhang',      unit: 'deg', min: -35, max: -15,  step: 0.5,  dp: 1  },
  { key: 'Front_Planview',      label: 'Front Planview',      unit: '',    min: 0.75, max: 1.05, step: 0.01, dp: 3  },
  { key: 'Hood_Angle',          label: 'Hood Angle',          unit: 'rad', min: -0.05, max: 0.15, step: 0.005, dp: 3 },
  { key: 'Approach_Angle',      label: 'Approach Angle',      unit: 'deg', min: -10, max: 0,    step: 0.25, dp: 2  },
  { key: 'Windscreen_Angle',    label: 'Windscreen Angle',    unit: 'rad', min: 0.08, max: 0.28, step: 0.005, dp: 3 },
  { key: 'Greenhouse_Tapering', label: 'Greenhouse Tapering', unit: '',    min: 0.65, max: 1.0,  step: 0.01, dp: 3  },
  { key: 'Backlight_Angle',     label: 'Backlight Angle',     unit: 'deg', min: 35,  max: 65,   step: 0.5,  dp: 1  },
  { key: 'Decklid_Height',      label: 'Decklid Height',      unit: 'm',   min: -1.2, max: 0.2,  step: 0.05, dp: 2  },
  { key: 'Rearend_tapering',    label: 'Rearend Tapering',    unit: 'deg', min: -18, max: -2,   step: 0.5,  dp: 1  },
  { key: 'Rear_Overhang',       label: 'Rear Overhang',       unit: 'deg', min: -32, max: -14,  step: 0.5,  dp: 1  },
  { key: 'Rear_Diffusor_Angle', label: 'Rear Diffusor Angle', unit: 'rad', min: 0.02, max: 0.26, step: 0.005, dp: 3 },
  { key: 'Vehicle_Ride_Height', label: 'Ride Height',         unit: 'm',   min: -0.5, max: 0.2,  step: 0.01, dp: 2  },
  { key: 'Vehicle_Pitch',       label: 'Vehicle Pitch',       unit: 'deg', min: -0.01, max: 0.02, step: 0.001, dp: 3 },
]

const FEATURE_MEANS = {
  Vehicle_Length: 49.94, Vehicle_Width: 0.615, Vehicle_Height: 0.127,
  Front_Overhang: -25.97, Front_Planview: 0.903, Hood_Angle: 0.052,
  Approach_Angle: -5.33, Windscreen_Angle: 0.180, Greenhouse_Tapering: 0.838,
  Backlight_Angle: 50.18, Decklid_Height: -0.587, Rearend_tapering: -9.96,
  Rear_Overhang: -23.68, Rear_Diffusor_Angle: 0.142, Vehicle_Ride_Height: -0.179,
  Vehicle_Pitch: 0.004,
}

const MODELS = [
  { id: 'GradBoost-DrivAerML',    label: 'Gradient Boost',  r2: '0.953', ready: true },
  { id: 'RandomForest-DrivAerML', label: 'Random Forest',   r2: '0.815', ready: true },
  { id: 'ResNet-Tabular-12K',     label: 'ResNet-12K',       r2: '—',    ready: false },
]

// Simple mock Cd predictor based on features (backend fallback)
function mockPredict(features, modelId) {
  let base = 0.2788
  const len = features.Vehicle_Length ?? 49.94
  const h   = features.Vehicle_Height ?? 0.127
  const ba  = features.Backlight_Angle ?? 50.18
  const rh  = features.Vehicle_Ride_Height ?? -0.179

  base += (len - 49.94) * 0.0008
  base += (h - 0.127) * 0.8
  base += (ba - 50.18) * 0.0004
  base += (rh + 0.179) * 0.02

  if (modelId === 'RandomForest-DrivAerML') {
    base += (Math.random() - 0.5) * 0.012
  }
  return Math.max(0.18, Math.min(0.40, base))
}

function cdRating(cd) {
  if (cd < 0.24) return { label: 'Exceptional', color: 'var(--green)' }
  if (cd < 0.27) return { label: 'Excellent',   color: 'var(--teal)'  }
  if (cd < 0.30) return { label: 'Good',        color: 'var(--blue)'  }
  if (cd < 0.33) return { label: 'Average',     color: 'var(--orange)'}
  return              { label: 'High drag',    color: 'var(--red)'   }
}

export default function Views2DPage({ activeModel, onModelChange }) {
  const [features, setFeatures] = useState({ ...FEATURE_MEANS })
  const [result,   setResult]   = useState(null)
  const [loading,  setLoading]  = useState(false)
  const [useBackend, setUseBackend] = useState(true)

  const updateFeature = useCallback((key, val) => {
    setFeatures(f => ({ ...f, [key]: val }))
  }, [])

  const runPrediction = async () => {
    setLoading(true)
    try {
      const body = new FormData()
      body.append('features', JSON.stringify(features))
      body.append('active_model', activeModel)
      const res = await fetch(`${BACKEND}/surrogate/predict`, { method: 'POST', body })
      if (res.ok) {
        const data = await res.json()
        setResult({ ...data, _source: 'backend' })
      } else {
        throw new Error('backend failed')
      }
    } catch {
      // Fallback mock
      await new Promise(r => setTimeout(r, 280))
      const cd = mockPredict(features, activeModel)
      const z  = (cd - 0.2788) / 0.0302
      const pct = Math.min(99, Math.max(1, Math.round(50 * (1 + z * 0.399))))
      setResult({
        Cd: parseFloat(cd.toFixed(4)),
        Cd_ensemble: parseFloat((cd + (Math.random() - 0.5) * 0.004).toFixed(4)),
        uncertainty: parseFloat((cd * 0.045).toFixed(5)),
        confidence_pct: Math.round(80 + Math.random() * 14),
        cd_rating: cdRating(cd).label,
        cd_percentile: pct,
        active_model: activeModel,
        inferenceMs: Math.round(50 + Math.random() * 60),
        _source: 'mock',
      })
    } finally {
      setLoading(false)
    }
  }

  const rating = result ? cdRating(result.Cd) : null

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

      {/* Left panel — feature sliders */}
      <div style={{ width: 340, borderRight: '0.5px solid var(--sep)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '16px 16px 12px', borderBottom: '0.5px solid var(--sep)' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--label3)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 4 }}>
            Geometric Parameters
          </div>
          <div style={{ fontSize: 12, color: 'var(--label3)' }}>
            16 features · DrivAerML notchback
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 16px 16px' }}>
          {FEATURE_DEFS.map((fd, i) => (
            <FeatureSlider
              key={fd.key}
              def={fd}
              value={features[fd.key] ?? fd.min}
              onChange={v => updateFeature(fd.key, v)}
              last={i === FEATURE_DEFS.length - 1}
            />
          ))}
        </div>
        <div style={{ padding: '12px 16px', borderTop: '0.5px solid var(--sep)' }}>
          <button
            onClick={runPrediction}
            disabled={loading}
            className="ios-btn"
            style={{ width: '100%', height: 42, borderRadius: 11, fontSize: 14 }}
          >
            {loading ? (
              <>
                <svg className="anim-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="2">
                  <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" opacity="0.3"/><path d="M12 3a9 9 0 019 9"/>
                </svg>
                Predicting…
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="5 3 19 12 5 21 5 3"/>
                </svg>
                Predict Cd
              </>
            )}
          </button>
        </div>
      </div>

      {/* Right panel — results */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>

        {/* Model selector */}
        <div style={{ marginBottom: 24 }}>
          <div className="section-label" style={{ marginBottom: 10 }}>Surrogate Model</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {MODELS.map(m => (
              <button
                key={m.id}
                onClick={() => m.ready && onModelChange(m.id)}
                className={`ios-chip ${activeModel === m.id ? 'active' : ''}`}
                style={{ opacity: m.ready ? 1 : 0.4, cursor: m.ready ? 'pointer' : 'not-allowed' }}
              >
                {m.label}
                <span style={{ marginLeft: 5, opacity: 0.6, fontSize: 11 }}>R²={m.r2}</span>
                {!m.ready && <span style={{ marginLeft: 4, fontSize: 10, color: 'var(--orange)' }}>pending</span>}
              </button>
            ))}
          </div>
        </div>

        {!result && !loading && (
          <div className="ios-card" style={{ padding: '48px 28px', textAlign: 'center' }}>
            <div style={{ width: 52, height: 52, borderRadius: 13, background: 'var(--bg2)', margin: '0 auto 16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--label3)" strokeWidth="1.5">
                <rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 12h8M12 8v8"/>
              </svg>
            </div>
            <div className="t-subhead" style={{ color: 'var(--label2)' }}>Adjust parameters and run prediction</div>
            <div className="t-caption1" style={{ color: 'var(--label3)', marginTop: 4 }}>GradBoost-DrivAerML · 484 real CFD cases</div>
          </div>
        )}

        {loading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[140, 96, 80].map((h, i) => (
              <div key={i} className="ios-card" style={{ height: h, animation: `pulse 1.4s ease-in-out ${i * 0.12}s infinite` }} />
            ))}
          </div>
        )}

        {result && !loading && (
          <div className="anim-stagger" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

            {/* Primary Cd KPI */}
            <div className="ios-card anim-up" style={{ padding: '24px 24px 20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--label3)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>
                    Drag Coefficient
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span className="mono num" style={{ fontSize: 52, fontWeight: 700, letterSpacing: '-2.5px', color: rating?.color, lineHeight: 1 }}>
                      {result.Cd.toFixed(3)}
                    </span>
                    <span style={{ fontSize: 20, color: 'var(--label3)', letterSpacing: '-0.4px' }}>Cd</span>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 11, color: 'var(--label3)', marginBottom: 6 }}>Rating</div>
                  <div style={{
                    display: 'inline-block',
                    padding: '5px 14px', borderRadius: 20,
                    background: `${rating?.color}1A`,
                    border: `0.5px solid ${rating?.color}55`,
                    fontSize: 13, fontWeight: 600,
                    color: rating?.color,
                  }}>
                    {rating?.label}
                  </div>
                </div>
              </div>

              {/* Gauge bar */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                  <span style={{ fontSize: 10, color: 'var(--label3)' }}>0.20</span>
                  <span style={{ fontSize: 10, color: 'var(--label3)' }}>Dataset mean: 0.279</span>
                  <span style={{ fontSize: 10, color: 'var(--label3)' }}>0.36</span>
                </div>
                <div style={{ height: 6, background: 'var(--bg3)', borderRadius: 3, overflow: 'hidden', position: 'relative' }}>
                  <div style={{
                    position: 'absolute', left: 0, top: 0, height: '100%',
                    width: `${Math.max(0, Math.min(100, ((result.Cd - 0.20) / 0.16) * 100))}%`,
                    background: `linear-gradient(90deg, var(--green), ${rating?.color})`,
                    borderRadius: 3,
                    transition: 'width 0.6s cubic-bezier(0.34,1.56,0.64,1)',
                  }} />
                  {/* Mean line */}
                  <div style={{
                    position: 'absolute', top: 0, bottom: 0,
                    left: `${((0.279 - 0.20) / 0.16) * 100}%`,
                    width: 1, background: 'var(--label3)', opacity: 0.5,
                  }} />
                </div>
              </div>

              <div className="ios-sep" style={{ marginTop: 16 }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 12 }}>
                <span style={{ fontSize: 12, color: 'var(--label3)' }}>
                  Model: <span style={{ color: 'var(--label2)' }}>{result.active_model}</span>
                </span>
                <span className="mono" style={{ fontSize: 11, color: 'var(--label3)' }}>
                  {result.inferenceMs ?? '—'} ms ·{' '}
                  <span style={{ color: result._source === 'backend' ? 'var(--green)' : 'var(--orange)' }}>
                    {result._source}
                  </span>
                </span>
              </div>
            </div>

            {/* Secondary metrics */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {[
                { label: 'Ensemble Cd',  val: result.Cd_ensemble?.toFixed(4) ?? '—', color: 'var(--blue)'  },
                { label: 'Uncertainty',  val: `±${result.uncertainty?.toFixed(4) ?? '—'}`, color: 'var(--orange)' },
                { label: 'Confidence',   val: `${result.confidence_pct ?? '—'}%`, color: 'var(--green)'  },
                { label: 'Percentile',   val: `P${result.cd_percentile ?? '—'}`, color: 'var(--indigo)'  },
                { label: 'Cd Dataset Mean', val: '0.279',  color: 'var(--label2)'  },
                { label: 'Cd Range',     val: '0.206–0.360', color: 'var(--label3)' },
              ].map((m, i) => (
                <div key={m.label} className="ios-card anim-up" style={{ padding: '14px 16px' }}>
                  <div style={{ fontSize: 10, color: 'var(--label3)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    {m.label}
                  </div>
                  <div className="mono num" style={{ fontSize: 19, fontWeight: 600, letterSpacing: '-0.5px', color: m.color }}>
                    {m.val}
                  </div>
                </div>
              ))}
            </div>

            {/* Benchmarks */}
            <div className="ios-card anim-up" style={{ overflow: 'hidden' }}>
              <div style={{ padding: '14px 18px 10px', borderBottom: '0.5px solid var(--sep)' }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--label3)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                  Reference Benchmarks
                </span>
              </div>
              {[
                { name: 'Tesla Model 3',  cd: 0.23 },
                { name: 'BMW 3 Series',   cd: 0.26 },
                { name: 'Toyota Camry',   cd: 0.28 },
                { name: 'Ford Mustang',   cd: 0.35 },
                { name: 'Generic SUV',    cd: 0.38 },
              ].map((b, i, arr) => (
                <div key={b.name} style={{
                  display: 'flex', alignItems: 'center', gap: 14,
                  padding: '10px 18px',
                  borderBottom: i < arr.length - 1 ? '0.5px solid var(--sep)' : 'none',
                  background: result.Cd >= b.cd - 0.005 && result.Cd <= b.cd + 0.005 ? 'rgba(10,132,255,0.06)' : 'transparent',
                }}>
                  <span style={{ fontSize: 13, color: 'var(--label2)', flex: 1 }}>{b.name}</span>
                  <div style={{ flex: 2, position: 'relative' }}>
                    <div style={{ height: 3, background: 'var(--bg3)', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${((b.cd - 0.18) / 0.22) * 100}%`, background: cdRating(b.cd).color, borderRadius: 2 }} />
                    </div>
                  </div>
                  <span className="mono num" style={{ fontSize: 13, fontWeight: 600, color: cdRating(b.cd).color, minWidth: 40, textAlign: 'right' }}>
                    {b.cd.toFixed(3)}
                  </span>
                </div>
              ))}
            </div>

          </div>
        )}
      </div>
    </div>
  )
}

function FeatureSlider({ def, value, onChange, last }) {
  const { key, label, unit, min, max, step, dp } = def
  const pct = ((value - min) / (max - min)) * 100

  return (
    <div style={{ paddingTop: 12, paddingBottom: 12, borderBottom: last ? 'none' : '0.5px solid var(--sep)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: 'var(--label2)', letterSpacing: '-0.1px' }}>{label}</span>
        <span className="mono num" style={{ fontSize: 12, color: 'var(--blue)' }}>
          {value.toFixed(dp)} {unit && <span style={{ color: 'var(--label3)', fontSize: 10 }}>{unit}</span>}
        </span>
      </div>
      <div style={{ position: 'relative', height: 20, display: 'flex', alignItems: 'center' }}>
        <div style={{ position: 'absolute', left: 0, right: 0, height: 2, borderRadius: 9999, background: 'var(--bg3)' }}>
          <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', borderRadius: 9999, background: 'var(--blue)', width: `${Math.max(0, Math.min(100, pct))}%` }} />
        </div>
        <input
          type="range" min={min} max={max} step={step} value={value}
          onChange={e => onChange(parseFloat(e.target.value))}
          style={{ position: 'absolute', inset: 0, width: '100%', opacity: 0, cursor: 'pointer', zIndex: 2 }}
        />
        <div style={{
          position: 'absolute', top: '50%', transform: 'translate(-50%, -50%)',
          left: `${Math.max(0, Math.min(100, pct))}%`,
          width: 18, height: 18, borderRadius: '50%',
          background: '#fff', boxShadow: '0 1px 5px rgba(0,0,0,0.45)',
          pointerEvents: 'none', zIndex: 1,
        }} />
      </div>
    </div>
  )
}
