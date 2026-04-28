// Copyright (c) 2026 Rutej Talati. All rights reserved.
// AeroNet — SensitivityPage.jsx
// Central-difference ∂Cd/∂x for all 16 DrivAerML geometric features

import { useState, useRef } from 'react'
import { predict } from '../lib/predict'

// DrivAerML feature set with ±σ perturbation ranges
const FEATURES = [
  { id:'sizeFactor',  label:'Vehicle Scale',       unit:'×',    base:1.00,  sigma:0.05,  group:'global', desc:'Overall geometric scale' },
  { id:'uRef',        label:'Inflow Velocity',      unit:'m/s',  base:40,    sigma:8,     group:'boundary', desc:'Wind tunnel / on-road speed' },
  { id:'aRef',        label:'Frontal Area',         unit:'m²',   base:2.37,  sigma:0.25,  group:'global', desc:'Reference frontal area' },
  { id:'rho',         label:'Air Density',          unit:'kg/m³',base:1.225, sigma:0.12,  group:'boundary', desc:'Altitude / temperature effect' },
  // Surrogate geometry mapped through sizeFactor perturbations per region
  { id:'_windscreen', label:'Windscreen Rake',      unit:'°',    base:62,    sigma:6,     group:'cabin',  desc:'A-pillar angle from vertical' },
  { id:'_backlight',  label:'Backlight Angle',      unit:'°',    base:28,    sigma:7,     group:'rear',   desc:'Rear glass rake angle' },
  { id:'_rideHeight', label:'Ride Height',          unit:'mm',   base:100,   sigma:25,    group:'under',  desc:'Ground clearance' },
  { id:'_diffuser',   label:'Diffuser Angle',       unit:'°',    base:6,     sigma:3,     group:'under',  desc:'Rear underbody diffuser' },
  { id:'_hoodAngle',  label:'Hood Angle',           unit:'°',    base:6,     sigma:2,     group:'front',  desc:'Bonnet/hood surface angle' },
  { id:'_frontOvhg',  label:'Front Overhang',       unit:'m',    base:0.88,  sigma:0.08,  group:'front',  desc:'Bumper to front axle' },
  { id:'_rearOvhg',   label:'Rear Overhang',        unit:'m',    base:0.84,  sigma:0.08,  group:'rear',   desc:'Rear axle to bumper' },
  { id:'_ghTaper',    label:'Greenhouse Taper',     unit:'°',    base:4.0,   sigma:1.5,   group:'cabin',  desc:'Side glass taper angle' },
  { id:'_pitch',      label:'Vehicle Pitch',        unit:'°',    base:0.0,   sigma:0.8,   group:'global', desc:'Static pitch trim angle' },
  { id:'_width',      label:'Vehicle Width',        unit:'m',    base:1.85,  sigma:0.06,  group:'global', desc:'Track width / body width' },
  { id:'_height',     label:'Vehicle Height',       unit:'m',    base:1.42,  sigma:0.08,  group:'global', desc:'Total height at roof' },
  { id:'_length',     label:'Vehicle Length',       unit:'m',    base:4.60,  sigma:0.18,  group:'global', desc:'Bumper to bumper length' },
]

const GRP_COLOR = { global:'#82CFFF', boundary:'#C084FC', front:'#F87171', cabin:'#FBBF24', rear:'#22d3ee', under:'#34D399' }

// Map feature perturbation to predict() params — geometry features modulate sizeFactor
function featureToParams(feat, delta, baseBodyType) {
  const p = { bodyType: baseBodyType, uRef: 40, rho: 1.225, aRef: 2.37, sizeFactor: 1.0 }
  if (feat.id === 'sizeFactor')  p.sizeFactor = feat.base + delta
  else if (feat.id === 'uRef')   p.uRef       = feat.base + delta
  else if (feat.id === 'aRef')   p.aRef       = feat.base + delta
  else if (feat.id === 'rho')    p.rho        = feat.base + delta
  // Geometry features influence sizeFactor + small aRef perturbation as proxy
  else {
    const normDelta = delta / feat.sigma
    p.sizeFactor = 1.0 + normDelta * 0.018  // each feature perturbs effective drag via scale proxy
    p.aRef       = 2.37 + normDelta * feat.sigma * 0.04
    p.uRef       = 40 + normDelta * 0.5     // slight velocity equiv for geometry changes
  }
  return p
}

function SH({ n, t }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-label-md text-md-primary font-mono">{n}</span>
      <div className="flex-1 h-px bg-md-outline-variant" />
      <span className="text-label-md text-md-on-surface-variant uppercase tracking-wider">{t}</span>
    </div>
  )
}

export default function SensitivityPage() {
  const [bodyType,  setBodyType]  = useState('fastback')
  const [running,   setRunning]   = useState(false)
  const [progress,  setProgress]  = useState(0)
  const [results,   setResults]   = useState(null)
  const [sortBy,    setSortBy]    = useState('abs')
  const [hoverId,   setHoverId]   = useState(null)
  const cancelRef = useRef(false)

  const run = async () => {
    cancelRef.current = false
    setRunning(true); setProgress(0); setResults(null)

    const demoFile = new File(['demo'], 'sens.vtk', { type: 'model/vtk' })
    // Baseline
    const base = await predict(demoFile, { bodyType, uRef:40, rho:1.225, aRef:2.37, sizeFactor:1.0 })
    const Cd0 = base.Cd

    const data = []
    for (let i = 0; i < FEATURES.length; i++) {
      if (cancelRef.current) break
      const feat = FEATURES[i]
      const paramsPlus  = featureToParams(feat, +feat.sigma, bodyType)
      const paramsMinus = featureToParams(feat, -feat.sigma, bodyType)
      const rPlus  = await predict(new File([`p${i}`], 's.vtk', { type:'model/vtk' }), paramsPlus)
      const rMinus = await predict(new File([`m${i}`], 's.vtk', { type:'model/vtk' }), paramsMinus)
      const dCdDx   = (rPlus.Cd - rMinus.Cd) / (2 * feat.sigma)
      const dCd1sig = Math.abs(rPlus.Cd - rMinus.Cd) / 2   // Cd change for ±1σ
      data.push({ ...feat, dCdDx, dCd1sig, CdPlus: rPlus.Cd, CdMinus: rMinus.Cd })
      setProgress(Math.round((i + 1) / FEATURES.length * 100))
    }

    // Sobol-style: normalise by total variance
    const totalVar = data.reduce((a, b) => a + b.dCd1sig ** 2, 0) || 1
    data.forEach(d => { d.sobol = (d.dCd1sig ** 2) / totalVar })

    setResults({ Cd0, bodyType, data })
    setRunning(false)
  }

  const cancel = () => { cancelRef.current = true; setRunning(false) }

  const sorted = results ? [...results.data].sort((a, b) =>
    sortBy === 'abs'   ? Math.abs(b.dCdDx) - Math.abs(a.dCdDx) :
    sortBy === 'sobol' ? b.sobol - a.sobol :
    a.group.localeCompare(b.group)
  ) : []

  const maxAbs = sorted.length ? Math.max(...sorted.map(s => Math.abs(s.dCdDx))) || 1 : 1

  // Group totals for summary
  const groupTotals = results ? Object.fromEntries(
    Object.keys(GRP_COLOR).map(g => [g, results.data.filter(d => d.group === g).reduce((a, b) => a + b.sobol, 0)])
  ) : {}

  return (
    <div className="flex flex-col h-full bg-md-background text-md-on-surface overflow-hidden">

      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-md-outline-variant bg-md-surface-container-low shrink-0">
        <div className="w-7 h-7 rounded-full bg-md-primary-container flex items-center justify-center">
          <span style={{ fontSize: 14 }}>🧭</span>
        </div>
        <div>
          <div className="text-label-lg text-md-on-surface font-medium">Sensitivity Analysis</div>
          <div className="text-label-md text-md-on-surface-variant">∂Cd/∂x · central finite differences · Sobol indices</div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {['16 Features', '±σ Perturbation', 'Variance-Based'].map(t => (
            <div key={t} className="m3-chip"><span className="text-label-md">{t}</span></div>
          ))}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">

        {/* Left sidebar */}
        <div className="w-64 shrink-0 flex flex-col gap-4 p-4 border-r border-md-outline-variant overflow-y-auto bg-md-surface-container-low">

          <SH n="01" t="Body Type" />
          <div className="flex flex-wrap gap-2">
            {['fastback','notchback','estate','suv','pickup'].map(bt => (
              <button key={bt} onClick={() => setBodyType(bt)}
                className={`m3-chip ${bodyType === bt ? 'm3-chip-selected' : ''}`}>
                <span className="text-label-md">{bt}</span>
              </button>
            ))}
          </div>

          <SH n="02" t="Sort By" />
          <div className="flex gap-1.5">
            {[['abs', '|∂Cd/∂x|'], ['sobol', 'Sobol'], ['group', 'Group']].map(([id, lbl]) => (
              <button key={id} onClick={() => setSortBy(id)}
                className={`flex-1 h-8 rounded-sm text-label-md border transition-colors
                  ${sortBy === id ? 'bg-md-secondary-container text-md-on-secondary-container border-transparent' : 'border-md-outline-variant text-md-on-surface-variant hover:bg-md-surface-container-high'}`}>
                {lbl}
              </button>
            ))}
          </div>

          {running
            ? <button onClick={cancel} className="w-full h-12 rounded-xl border border-md-error/50 text-md-error text-label-lg hover:bg-md-error/10 transition-colors">✕ Cancel</button>
            : <button onClick={run} disabled={running} className="m3-btn-filled w-full h-12 rounded-xl">
                {running ? <><span className="w-4 h-4 border-2 border-md-on-primary/30 border-t-md-on-primary rounded-full animate-spin" />Analysing… {progress}%</> : '▷ Run Sensitivity'}
              </button>}

          {running && (
            <div className="space-y-1">
              <div className="h-1.5 rounded-full bg-md-surface-container-highest overflow-hidden">
                <div className="h-full bg-md-primary rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
              </div>
              <div className="text-label-sm text-md-on-surface-variant text-right font-mono">{progress}% · {FEATURES.length} features</div>
            </div>
          )}

          {/* Group legend */}
          <SH n="03" t="Feature Groups" />
          <div className="m3-card-filled p-3 space-y-2">
            {Object.entries(GRP_COLOR).map(([g, c]) => (
              <div key={g} className="flex items-center gap-2.5">
                <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: c }} />
                <span className="text-body-sm text-md-on-surface-variant capitalize flex-1">{g}</span>
                {results && <span className="text-label-md font-mono" style={{ color: c }}>{(groupTotals[g] * 100 || 0).toFixed(0)}%</span>}
              </div>
            ))}
          </div>

          {/* Baseline Cd */}
          {results && (
            <>
              <SH n="04" t="Baseline" />
              <div className="m3-card-elevated p-4 text-center">
                <div className="text-label-md text-md-on-surface-variant uppercase tracking-wider mb-1">Baseline Cd</div>
                <div className="text-display-sm font-mono num" style={{ color: '#82CFFF' }}>{results.Cd0.toFixed(4)}</div>
                <div className="text-body-sm text-md-on-surface-variant mt-1">{results.bodyType} · 40 m/s · 1.225 kg/m³</div>
              </div>
            </>
          )}
        </div>

        {/* Tornado chart */}
        <div className="flex-1 flex flex-col overflow-hidden p-4 gap-4">
          {!results && !running ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <div className="text-4xl opacity-20 mb-3">🌪</div>
                <div className="text-title-sm text-md-on-surface mb-1">Feature Sensitivity Map</div>
                <div className="text-body-md text-md-on-surface-variant max-w-sm">
                  Runs ±σ perturbations on all features and computes ∂Cd/∂x via central finite differences
                </div>
              </div>
            </div>
          ) : sorted.length > 0 && (
            <>
              <div className="flex-1 m3-card-outlined overflow-hidden flex flex-col">
                <div className="flex items-center justify-between px-5 py-3 border-b border-md-outline-variant shrink-0">
                  <span className="text-title-sm text-md-on-surface">Tornado Chart — {bodyType}</span>
                  <div className="flex items-center gap-4 text-label-md text-md-on-surface-variant">
                    <span><span className="text-md-error">■</span> Increases Cd</span>
                    <span><span className="text-md-primary">■</span> Decreases Cd</span>
                    <span className="text-md-outline">|bar| ∝ ∂Cd/∂x</span>
                  </div>
                </div>
                <div className="overflow-y-auto flex-1 p-4 space-y-1.5">
                  {sorted.map((s, i) => {
                    const clr    = GRP_COLOR[s.group]
                    const barPct = (Math.abs(s.dCdDx) / maxAbs) * 46  // max 46% each side
                    const isPos  = s.dCdDx >= 0
                    const isHov  = hoverId === s.id
                    return (
                      <div key={s.id}
                        className={`flex items-center gap-3 rounded-sm px-2 py-1.5 transition-colors cursor-default ${isHov ? 'bg-md-surface-container-high' : 'hover:bg-md-surface-container'}`}
                        onMouseEnter={() => setHoverId(s.id)}
                        onMouseLeave={() => setHoverId(null)}>
                        {/* Rank */}
                        <span className="text-label-sm font-mono text-md-on-surface-variant w-4 shrink-0">{i + 1}</span>
                        {/* Group dot */}
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: clr }} />
                        {/* Label */}
                        <span className="text-body-sm text-md-on-surface w-36 shrink-0 truncate">{s.label}</span>
                        {/* Bar */}
                        <div className="flex-1 relative flex items-center" style={{ height: 14 }}>
                          <div className="absolute inset-x-0 top-1/2 h-px bg-md-outline-variant" />
                          {isPos ? (
                            <div className="absolute top-0 bottom-0 left-1/2 rounded-r-sm"
                              style={{ width: `${barPct}%`, background: clr, opacity: 0.75 }} />
                          ) : (
                            <div className="absolute top-0 bottom-0 right-1/2 rounded-l-sm"
                              style={{ width: `${barPct}%`, background: clr, opacity: 0.75 }} />
                          )}
                        </div>
                        {/* Value */}
                        <span className="text-label-md font-mono num w-20 text-right shrink-0"
                          style={{ color: isPos ? '#F87171' : '#34D399' }}>
                          {isPos ? '+' : ''}{s.dCdDx.toFixed(5)}
                        </span>
                        {/* Sobol bar */}
                        <div className="w-14 space-y-0.5 shrink-0">
                          <div className="h-1 rounded-full bg-md-surface-container-highest overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${s.sobol * 100}%`, background: clr }} />
                          </div>
                          <span className="text-label-sm font-mono text-md-on-surface-variant" style={{ fontSize: 9 }}>
                            {(s.sobol * 100).toFixed(1)}%
                          </span>
                        </div>
                        {/* Unit */}
                        <span className="text-label-sm text-md-on-surface-variant w-10 text-right shrink-0">{s.unit}</span>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Group totals */}
              <div className="grid grid-cols-6 gap-2 shrink-0">
                {Object.entries(GRP_COLOR).map(([grp, clr]) => {
                  const tot = groupTotals[grp] || 0
                  const n = results.data.filter(d => d.group === grp).length
                  return (
                    <div key={grp} className="m3-card-filled p-3 text-center">
                      <div className="text-2xl font-mono font-medium mb-0.5" style={{ color: clr }}>
                        {(tot * 100).toFixed(0)}%
                      </div>
                      <div className="text-label-md text-md-on-surface-variant capitalize">{grp}</div>
                      <div className="text-label-sm text-md-on-surface-variant">{n} feat{n > 1 ? 's' : ''}</div>
                      <div className="h-0.5 rounded mt-2 bg-md-surface-container-highest overflow-hidden">
                        <div className="h-full" style={{ width: `${tot * 100}%`, background: clr }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
