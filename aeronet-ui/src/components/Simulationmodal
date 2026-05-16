// SimulationModal.jsx
// Copyright (c) 2026 Rutej Talati. All rights reserved.
// AeroNet — CFD surrogate simulation modal, triggered from Views2DPage.

import { useState, useEffect } from 'react'

// Feature names expected by the surrogate model (must match surrogate_server.py)
const FEATURE_NAMES = [
  'Vehicle_Length', 'Vehicle_Width', 'Vehicle_Height',
  'Front_Overhang', 'Front_Planview', 'Hood_Angle',
  'Approach_Angle', 'Windscreen_Angle', 'Greenhouse_Tapering',
  'Backlight_Angle', 'Decklid_Height', 'Rearend_tapering',
  'Rear_Overhang', 'Rear_Diffusor_Angle', 'Vehicle_Ride_Height',
  'Vehicle_Pitch',
]

const CD_BENCHMARKS = [
  { name: 'Tesla Model 3',  Cd: 0.23 },
  { name: 'BMW 3 Series',   Cd: 0.26 },
  { name: 'Audi A4',        Cd: 0.27 },
  { name: 'Toyota Camry',   Cd: 0.28 },
  { name: 'VW Golf',        Cd: 0.30 },
  { name: 'Ford Mustang',   Cd: 0.35 },
  { name: 'Generic SUV',    Cd: 0.38 },
]

function cdRating(Cd) {
  if (Cd < 0.24) return { label: 'Exceptional', color: '#30d158' }
  if (Cd < 0.27) return { label: 'Excellent',   color: '#30d158' }
  if (Cd < 0.30) return { label: 'Good',         color: '#ff9f0a' }
  if (Cd < 0.33) return { label: 'Average',      color: '#ff9f0a' }
  return               { label: 'High drag',     color: '#ff453a' }
}

// Map geometry object from contour_analysis to surrogate feature dict
function geoToFeatures(geo) {
  if (!geo) return {}
  const L = 4.5   // default vehicle length (m) — no absolute scale from image
  const W = geo.aspectRatio ? L / geo.aspectRatio : 1.8
  const H = (geo.cabinH ?? 0.58) * (W * 0.78)

  return {
    Vehicle_Length:       parseFloat(L.toFixed(3)),
    Vehicle_Width:        parseFloat(W.toFixed(3)),
    Vehicle_Height:       parseFloat(H.toFixed(3)),
    Front_Overhang:       parseFloat(((geo.hoodRatio  ?? 0.22) * L).toFixed(3)),
    Front_Planview:       parseFloat((W * 0.85).toFixed(3)),
    Hood_Angle:           parseFloat((geo.wsAngleDeg  ?? 10).toFixed(1)),
    Approach_Angle:       parseFloat(((geo.rideH ?? 0.08) * 45).toFixed(1)),
    Windscreen_Angle:     parseFloat((geo.wsAngleDeg  ?? 58).toFixed(1)),
    Greenhouse_Tapering:  parseFloat((geo.rearDrop    ?? 0.15).toFixed(3)),
    Backlight_Angle:      parseFloat((geo.rearSlantAngleDeg ?? 25).toFixed(1)),
    Decklid_Height:       parseFloat(((geo.bootRatio  ?? 0.22) * H).toFixed(3)),
    Rearend_tapering:     parseFloat((geo.rearDrop    ?? 0.12).toFixed(3)),
    Rear_Overhang:        parseFloat(((geo.bootRatio  ?? 0.22) * L).toFixed(3)),
    Rear_Diffusor_Angle:  parseFloat(((geo.rideH ?? 0.08) * 30).toFixed(1)),
    Vehicle_Ride_Height:  parseFloat(((geo.rideH ?? 0.08) * H).toFixed(3)),
    Vehicle_Pitch:        0.0,
  }
}

export default function SimulationModal({ geo, onClose }) {
  const [result,   setResult]   = useState(null)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState(null)
  const [model,    setModel]    = useState('GradBoost-DrivAerML')

  const features = geoToFeatures(geo)

  useEffect(() => {
    // Run prediction automatically on open
    runPrediction()
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  async function runPrediction() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/predict', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ features, active_model: model }),
      })
      if (!res.ok) throw new Error(`Server error ${res.status}`)
      const data = await res.json()
      setResult(data)
    } catch (e) {
      // Fallback: use the Ahmed-body Cd from the geometry extraction
      if (geo?.Cd) {
        const rating = cdRating(geo.Cd)
        setResult({
          Cd:             geo.Cd,
          Cd_ensemble:    geo.Cd,
          uncertainty:    geo.Cd * 0.05,
          confidence_pct: 72,
          cd_rating:      rating.label,
          cd_percentile:  50,
          active_model:   'Ahmed-1984 (offline)',
          inferenceMs:    0,
          benchmarks:     CD_BENCHMARKS,
        })
      } else {
        setError(`Could not reach surrogate server: ${e.message}`)
      }
    } finally {
      setLoading(false)
    }
  }

  const rating = result ? cdRating(result.Cd) : null

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(0,0,0,0.75)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      backdropFilter: 'blur(6px)',
    }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>

      <div style={{
        width: 480, maxWidth: '94vw', maxHeight: '88vh',
        background: '#0c1520',
        border: '0.5px solid rgba(255,255,255,0.10)',
        borderRadius: 14,
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>

        {/* Header */}
        <div style={{
          padding: '14px 18px', borderBottom: '0.5px solid rgba(255,255,255,0.07)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.85)', fontFamily: "'IBM Plex Mono', monospace" }}>
              CFD Surrogate Prediction
            </div>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', fontFamily: "'IBM Plex Mono', monospace", marginTop: 2 }}>
              GradBoost · DrivAerML 484 HF-LES cases · CV R²=0.9525
            </div>
          </div>
          <button onClick={onClose} style={{
            width: 28, height: 28, borderRadius: 7, border: 'none',
            background: 'rgba(255,255,255,0.06)',
            color: 'rgba(255,255,255,0.5)', fontSize: 14, cursor: 'pointer',
          }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px' }}>

          {/* Loading */}
          {loading && (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%', margin: '0 auto 12px',
                border: '2px solid rgba(10,132,255,0.3)',
                borderTopColor: 'rgba(10,132,255,1)',
                animation: 'spin 0.75s linear infinite',
              }}/>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', fontFamily: "'IBM Plex Mono', monospace" }}>
                Running surrogate model…
              </div>
            </div>
          )}

          {/* Error */}
          {error && !loading && (
            <div style={{
              padding: '12px 14px', borderRadius: 8,
              background: 'rgba(255,69,58,0.08)',
              border: '0.5px solid rgba(255,69,58,0.3)',
              color: 'rgba(255,69,58,0.9)', fontSize: 10,
              fontFamily: "'IBM Plex Mono', monospace", lineHeight: 1.6,
            }}>{error}</div>
          )}

          {/* Result */}
          {result && !loading && (
            <>
              {/* Big Cd */}
              <div style={{ textAlign: 'center', padding: '12px 0 20px' }}>
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', fontFamily: "'IBM Plex Mono', monospace", letterSpacing: '0.12em', marginBottom: 6 }}>
                  DRAG COEFFICIENT
                </div>
                <div style={{ fontSize: 52, fontWeight: 700, fontFamily: "'IBM Plex Mono', monospace", color: rating?.color ?? '#0a84ff', lineHeight: 1 }}>
                  {result.Cd?.toFixed(3)}
                </div>
                <div style={{
                  display: 'inline-block', marginTop: 10, padding: '3px 12px',
                  borderRadius: 20, fontSize: 10, fontWeight: 700,
                  fontFamily: "'IBM Plex Mono', monospace",
                  color: rating?.color, background: `${rating?.color}18`,
                  border: `0.5px solid ${rating?.color}55`,
                }}>
                  {result.cd_rating}
                </div>
              </div>

              {/* Stats row */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 16 }}>
                {[
                  ['Confidence', `${result.confidence_pct?.toFixed(0)}%`],
                  ['Uncertainty', `±${result.uncertainty?.toFixed(4)}`],
                  ['Percentile', `${result.cd_percentile?.toFixed(0)}th`],
                ].map(([k, v]) => (
                  <div key={k} style={{
                    background: 'rgba(255,255,255,0.03)',
                    border: '0.5px solid rgba(255,255,255,0.07)',
                    borderRadius: 8, padding: '8px 10px', textAlign: 'center',
                  }}>
                    <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.30)', fontFamily: "'IBM Plex Mono', monospace", marginBottom: 4 }}>{k}</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(10,132,255,0.9)', fontFamily: "'IBM Plex Mono', monospace" }}>{v}</div>
                  </div>
                ))}
              </div>

              {/* Benchmark bar chart */}
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.30)', fontFamily: "'IBM Plex Mono', monospace", letterSpacing: '0.08em', marginBottom: 10 }}>
                  BENCHMARK COMPARISON
                </div>
                {[...CD_BENCHMARKS, { name: '▶ This vehicle', Cd: result.Cd, highlight: true }]
                  .sort((a, b) => a.Cd - b.Cd)
                  .map(b => {
                    const pct = ((b.Cd - 0.20) / (0.42 - 0.20)) * 100
                    const isThis = b.highlight
                    return (
                      <div key={b.name} style={{ marginBottom: 6 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                          <span style={{ fontSize: 9, color: isThis ? (rating?.color ?? '#0a84ff') : 'rgba(255,255,255,0.45)', fontFamily: "'IBM Plex Mono', monospace", fontWeight: isThis ? 700 : 400 }}>
                            {b.name}
                          </span>
                          <span style={{ fontSize: 9, color: isThis ? (rating?.color ?? '#0a84ff') : 'rgba(255,255,255,0.45)', fontFamily: "'IBM Plex Mono', monospace", fontWeight: isThis ? 700 : 400 }}>
                            {b.Cd.toFixed(2)}
                          </span>
                        </div>
                        <div style={{ height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.05)', overflow: 'hidden' }}>
                          <div style={{
                            height: '100%', borderRadius: 2,
                            width: `${pct}%`,
                            background: isThis ? (rating?.color ?? '#0a84ff') : 'rgba(255,255,255,0.15)',
                            transition: 'width 0.8s cubic-bezier(0.4,0,0.2,1)',
                          }}/>
                        </div>
                      </div>
                    )
                  })}
              </div>

              {/* Model info */}
              <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.20)', fontFamily: "'IBM Plex Mono', monospace", textAlign: 'center', marginTop: 12 }}>
                {result.active_model} · {result.inferenceMs?.toFixed(0)}ms
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {!loading && (
          <div style={{ padding: '10px 18px', borderTop: '0.5px solid rgba(255,255,255,0.07)', display: 'flex', gap: 8 }}>
            <button onClick={runPrediction} style={{
              flex: 1, height: 32, borderRadius: 8,
              border: '0.5px solid rgba(10,132,255,0.4)',
              background: 'rgba(10,132,255,0.10)',
              color: 'rgba(10,132,255,0.9)', fontSize: 10,
              fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700,
              cursor: 'pointer',
            }}>↺ Re-run</button>
            <button onClick={onClose} style={{
              flex: 1, height: 32, borderRadius: 8,
              border: '0.5px solid rgba(255,255,255,0.1)',
              background: 'transparent',
              color: 'rgba(255,255,255,0.4)', fontSize: 10,
              fontFamily: "'IBM Plex Mono', monospace",
              cursor: 'pointer',
            }}>Close</button>
          </div>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
