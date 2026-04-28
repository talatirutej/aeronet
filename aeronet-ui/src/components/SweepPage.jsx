// Copyright (c) 2026 Rutej Talati. All rights reserved.
// AeroNet — SweepPage.jsx
// Parametric sweep using predict() surrogate — SAE J1263 DOE protocol

import { useState, useRef, useCallback } from 'react'
import { predict } from '../lib/predict'

// ── Sweep parameter definitions (fed directly to predict()) ─────────────────
const SWEEP_PARAMS = [
  { id:'sizeFactor', label:'Size Factor',     unit:'×',    min:0.85, max:1.15, step:0.015, default:1.0,   pts:14, fmt:v=>v.toFixed(3) },
  { id:'uRef',       label:'Inflow Velocity', unit:'m/s',  min:20,   max:80,   step:5,     default:40,    pts:13, fmt:v=>v.toFixed(0)  },
  { id:'rho',        label:'Air Density',     unit:'kg/m³',min:0.9,  max:1.4,  step:0.025, default:1.225, pts:21, fmt:v=>v.toFixed(3)  },
  { id:'aRef',       label:'Frontal Area',    unit:'m²',   min:1.8,  max:3.2,  step:0.1,   default:2.37,  pts:15, fmt:v=>v.toFixed(2)  },
]

const BODY_TYPES = ['fastback','notchback','estate','suv','pickup']
const BT_COLORS  = { fastback:'#82CFFF', notchback:'#34D399', estate:'#FBBF24', suv:'#F87171', pickup:'#C084FC' }

// Deterministic seed from string
function hash(s){ let h=0x811c9dc5; for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,0x01000193)>>>0} return h }

// ── Shared UI primitives ─────────────────────────────────────────────────────
function SH({ n, t }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-label-md text-md-primary font-mono">{n}</span>
      <div className="flex-1 h-px bg-md-outline-variant" />
      <span className="text-label-md text-md-on-surface-variant uppercase tracking-wider">{t}</span>
    </div>
  )
}

function Chip({ active, onClick, children, color }) {
  return (
    <button onClick={onClick}
      className={`m3-chip ${active ? 'm3-chip-selected' : ''}`}
      style={color && active ? { borderColor: color + '55', color, background: color + '18' } : {}}>
      <span className="text-label-md">{children}</span>
    </button>
  )
}

function MiniSlider({ label, unit, min, max, step, value, fmt, onChange }) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div className="space-y-1">
      <div className="flex justify-between">
        <span className="text-label-md text-md-on-surface-variant">{label}</span>
        <span className="text-label-lg text-md-primary font-mono num">{fmt(value)} <span className="text-body-sm text-md-on-surface-variant">{unit}</span></span>
      </div>
      <div className="relative h-5 flex items-center">
        <div className="w-full h-1 rounded-full bg-md-surface-container-highest">
          <div className="h-1 rounded-full bg-md-primary" style={{ width: `${pct}%` }} />
        </div>
        <input type="range" min={min} max={max} step={step} value={value}
          onChange={e => onChange(parseFloat(e.target.value))}
          className="absolute inset-0 w-full opacity-0 cursor-pointer" />
        <div className="absolute w-5 h-5 rounded-full bg-md-primary shadow-elevation-1 pointer-events-none border-2 border-md-on-primary/20"
          style={{ left: `calc(${pct}% - 10px)` }} />
      </div>
    </div>
  )
}

function RunButton({ onClick, disabled, loading, progress }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="m3-btn-filled w-full h-12 rounded-xl">
      {loading
        ? <><span className="w-4 h-4 border-2 border-md-on-primary/30 border-t-md-on-primary rounded-full animate-spin" />Running… {progress}%</>
        : <>▷ Run Sweep</>}
    </button>
  )
}

export default function SweepPage() {
  const [sweepId,    setSweepId]    = useState('sizeFactor')
  const [btSingle,   setBtSingle]   = useState('fastback')
  const [multiBody,  setMultiBody]  = useState(false)
  const [fixed,      setFixed]      = useState({ uRef:40, rho:1.225, aRef:2.37, sizeFactor:1.0 })
  const [running,    setRunning]    = useState(false)
  const [progress,   setProgress]   = useState(0)
  const [data,       setData]       = useState(null)  // { sweepId, series: {bt: [{x,Cd,Cl,Cs,conf,inferenceMs}]} }
  const [hovX,       setHovX]       = useState(null)
  const cancelRef = useRef(false)

  const param = SWEEP_PARAMS.find(p => p.id === sweepId)
  const bodies = multiBody ? BODY_TYPES : [btSingle]

  const runSweep = async () => {
    cancelRef.current = false
    setRunning(true); setProgress(0); setData(null)

    const xs = Array.from({ length: param.pts }, (_, i) =>
      param.min + i * (param.max - param.min) / (param.pts - 1))

    const series = {}
    let done = 0, total = xs.length * bodies.length

    for (const bt of bodies) {
      series[bt] = []
      for (const xVal of xs) {
        if (cancelRef.current) break
        // Build params for predict() — all standard keys
        const params = {
          bodyType:   bt,
          uRef:       sweepId === 'uRef'       ? xVal : fixed.uRef,
          rho:        sweepId === 'rho'        ? xVal : fixed.rho,
          aRef:       sweepId === 'aRef'       ? xVal : fixed.aRef,
          sizeFactor: sweepId === 'sizeFactor' ? xVal : fixed.sizeFactor,
        }
        const demoFile = new File([`${bt}${xVal}`], `sweep.vtk`, { type: 'model/vtk' })
        try {
          const r = await predict(demoFile, params)
          series[bt].push({ x: xVal, Cd: r.Cd, Cl: r.Cl, Cs: r.Cs, conf: r.confidence, ms: r.inferenceMs })
        } catch {
          series[bt].push({ x: xVal, Cd: 0.30, Cl: 0, Cs: 0, conf: 0.5, ms: 0 })
        }
        done++; setProgress(Math.round(done / total * 100))
      }
    }
    setData({ sweepId, series })
    setRunning(false)
  }

  const cancel = () => { cancelRef.current = true; setRunning(false) }

  // SVG chart
  const CW = 680, CH = 290, PL = 62, PR = 70, PT = 28, PB = 46
  const cW = CW - PL - PR, cH = CH - PT - PB

  const allPts = data ? Object.values(data.series).flat() : []
  const xMin = param.min, xMax = param.max
  const cdAll = allPts.map(p => p.Cd)
  const cdMin = cdAll.length ? Math.min(...cdAll) - 0.005 : 0.22
  const cdMax = cdAll.length ? Math.max(...cdAll) + 0.005 : 0.44

  const px = x => PL + ((x - xMin) / (xMax - xMin)) * cW
  const py = y => PT + cH - ((y - cdMin) / (cdMax - cdMin)) * cH

  const yTicks = Array.from({ length: 6 }, (_, i) => cdMin + i * (cdMax - cdMin) / 5)
  const xTicks = Array.from({ length: 5 }, (_, i) => xMin + i * (xMax - xMin) / 4)

  const linePath = pts => pts.map((p, i) => `${i ? 'L' : 'M'} ${px(p.x).toFixed(1)} ${py(p.Cd).toFixed(1)}`).join(' ')
  const bandPath = pts => {
    const σ = 0.012
    const top = pts.map(p => `${px(p.x).toFixed(1)},${py(p.Cd + p.conf * σ).toFixed(1)}`).join(' L')
    const bot = [...pts].reverse().map(p => `${px(p.x).toFixed(1)},${py(p.Cd - p.conf * σ).toFixed(1)}`).join(' L')
    return `M ${top} L ${bot} Z`
  }

  // Find hover point index
  const hovPts = data ? Object.values(data.series)[0] : []
  const hovIdx = hovX !== null ? hovPts.findIndex(p => Math.abs(p.x - hovX) < (xMax - xMin) / param.pts) : -1

  return (
    <div className="flex flex-col h-full bg-md-background text-md-on-surface overflow-hidden">

      {/* Page header */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-md-outline-variant bg-md-surface-container-low shrink-0">
        <div className="w-7 h-7 rounded-full bg-md-primary-container flex items-center justify-center">
          <span style={{ fontSize: 14 }}>📈</span>
        </div>
        <div>
          <div className="text-label-lg text-md-on-surface font-medium">Parametric Sweep</div>
          <div className="text-label-md text-md-on-surface-variant">Design of Experiments · SAE J1263</div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {['DrivAerML Surrogate', 'Confidence Band', 'Multi-body'].map(t => (
            <div key={t} className="m3-chip"><span className="text-label-md">{t}</span></div>
          ))}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">

        {/* Controls sidebar */}
        <div className="w-72 shrink-0 flex flex-col gap-4 p-4 border-r border-md-outline-variant overflow-y-auto bg-md-surface-container-low">

          <SH n="01" t="Sweep Variable" />
          <div className="m3-card-outlined divide-y divide-md-outline-variant overflow-hidden">
            {SWEEP_PARAMS.map(sp => (
              <button key={sp.id} onClick={() => setSweepId(sp.id)}
                className={`w-full text-left px-4 py-3 transition-colors flex items-center justify-between
                  ${sweepId === sp.id ? 'bg-md-primary-container text-md-on-primary-container' : 'hover:bg-md-surface-container-high text-md-on-surface-variant'}`}>
                <div>
                  <div className="text-label-lg">{sp.label}</div>
                  <div className="text-body-sm text-md-on-surface-variant">{sp.pts} points · ±{((sp.max - sp.min) / 2).toFixed(2)} {sp.unit}</div>
                </div>
                {sweepId === sp.id && <span className="text-md-primary">✓</span>}
              </button>
            ))}
          </div>

          <SH n="02" t="Body Type" />
          <label className="flex items-center gap-3 px-1 cursor-pointer">
            <div className={`w-10 h-6 rounded-full relative transition-colors ${multiBody ? 'bg-md-primary' : 'bg-md-surface-variant'}`}
              onClick={() => setMultiBody(m => !m)}>
              <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-md-on-primary shadow-elevation-1 transition-transform ${multiBody ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </div>
            <span className="text-body-md text-md-on-surface-variant">Compare all body types</span>
          </label>
          {!multiBody && (
            <div className="flex flex-wrap gap-2">
              {BODY_TYPES.map(bt => (
                <Chip key={bt} active={btSingle === bt} onClick={() => setBtSingle(bt)} color={BT_COLORS[bt]}>
                  {bt}
                </Chip>
              ))}
            </div>
          )}

          <SH n="03" t="Fixed Conditions" />
          <div className="m3-card-filled p-4 space-y-4">
            {SWEEP_PARAMS.filter(p => p.id !== sweepId).map(p => (
              <MiniSlider key={p.id} label={p.label} unit={p.unit}
                min={p.min} max={p.max} step={p.step} fmt={p.fmt}
                value={fixed[p.id]}
                onChange={v => setFixed(f => ({ ...f, [p.id]: v }))} />
            ))}
          </div>

          {running
            ? <button onClick={cancel} className="w-full h-12 rounded-xl border border-md-error/50 text-md-error text-label-lg hover:bg-md-error/10 transition-colors">✕ Cancel</button>
            : <RunButton onClick={runSweep} disabled={running} loading={running} progress={progress} />}

          {running && (
            <div className="space-y-1">
              <div className="h-1.5 rounded-full bg-md-surface-container-highest overflow-hidden">
                <div className="h-full bg-md-primary rounded-full transition-all duration-200" style={{ width: `${progress}%` }} />
              </div>
              <div className="flex justify-between text-label-sm text-md-on-surface-variant">
                <span>{bodies.length} bod{bodies.length > 1 ? 'ies' : 'y'} · {param.pts} pts each</span>
                <span className="font-mono">{progress}%</span>
              </div>
            </div>
          )}

          {/* Summary table */}
          {data && !running && (
            <>
              <SH n="04" t="Summary" />
              <div className="m3-card-outlined overflow-hidden">
                <div className="grid grid-cols-3 text-label-md text-md-on-surface-variant px-3 py-2 border-b border-md-outline-variant bg-md-surface-container-high">
                  <span>Body</span><span className="text-right">Min Cd</span><span className="text-right">Max Cd</span>
                </div>
                {Object.entries(data.series).map(([bt, pts]) => {
                  const cds = pts.map(p => p.Cd)
                  const clr = BT_COLORS[bt]
                  return (
                    <div key={bt} className="grid grid-cols-3 px-3 py-2 border-b border-md-outline-variant/50 last:border-0">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full" style={{ background: clr }} />
                        <span className="text-label-lg" style={{ color: clr }}>{bt}</span>
                      </div>
                      <span className="text-label-lg font-mono text-md-primary text-right num">{Math.min(...cds).toFixed(4)}</span>
                      <span className="text-label-md font-mono text-md-on-surface-variant text-right num">{Math.max(...cds).toFixed(4)}</span>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>

        {/* Chart panel */}
        <div className="flex-1 flex flex-col p-4 gap-3 overflow-hidden">
          <div className="flex-1 m3-card-outlined overflow-hidden flex flex-col">

            {/* Chart header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-md-outline-variant shrink-0">
              <div>
                <span className="text-title-sm text-md-on-surface">Cd vs {param.label}</span>
                <span className="text-body-sm text-md-on-surface-variant ml-3">
                  {param.pts} pts · 95% confidence band · {bodies.length} body type{bodies.length > 1 ? 's' : ''}
                </span>
              </div>
              <div className="flex items-center gap-4">
                {data && Object.keys(data.series).map(bt => (
                  <div key={bt} className="flex items-center gap-1.5">
                    <div className="w-6 h-0.5 rounded" style={{ background: BT_COLORS[bt] }} />
                    <span className="text-label-md text-md-on-surface-variant">{bt}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Chart */}
            <div className="flex-1 flex items-center justify-center overflow-hidden p-2"
              onMouseMove={e => {
                if (!data) return
                const rect = e.currentTarget.getBoundingClientRect()
                const relX = (e.clientX - rect.left - PL) / (rect.width - PL - PR)
                const hovVal = xMin + relX * (xMax - xMin)
                if (hovVal >= xMin && hovVal <= xMax) setHovX(hovVal)
              }}
              onMouseLeave={() => setHovX(null)}>
              {!data && !running ? (
                <div className="text-center">
                  <div className="text-4xl opacity-20 mb-3">📈</div>
                  <div className="text-body-md text-md-on-surface-variant">Configure and run sweep to see results</div>
                </div>
              ) : (
                <svg viewBox={`0 0 ${CW} ${CH}`} style={{ width: '100%', height: '100%', maxHeight: 340 }}>
                  <defs>
                    {BODY_TYPES.map(bt => (
                      <linearGradient key={bt} id={`bg_${bt}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%"   stopColor={BT_COLORS[bt]} stopOpacity="0.16" />
                        <stop offset="100%" stopColor={BT_COLORS[bt]} stopOpacity="0.02" />
                      </linearGradient>
                    ))}
                  </defs>

                  {/* Grid */}
                  {yTicks.map((y, i) => (
                    <g key={i}>
                      <line x1={PL} y1={py(y)} x2={PL + cW} y2={py(y)} stroke="#40484C" strokeWidth="0.5" strokeDasharray="4,6" />
                      <text x={PL - 8} y={py(y) + 4} textAnchor="end" fill="#8A9296" fontSize="10" fontFamily="'Roboto Mono', monospace">{y.toFixed(3)}</text>
                    </g>
                  ))}
                  {xTicks.map((x, i) => (
                    <g key={i}>
                      <line x1={px(x)} y1={PT} x2={px(x)} y2={PT + cH} stroke="#40484C" strokeWidth="0.5" strokeDasharray="4,6" />
                      <text x={px(x)} y={PT + cH + 16} textAnchor="middle" fill="#8A9296" fontSize="10" fontFamily="'Roboto Mono', monospace">
                        {param.fmt(x)}
                      </text>
                    </g>
                  ))}

                  {/* Axis labels */}
                  <text x={PL + cW / 2} y={CH - 4} textAnchor="middle" fill="#BFC8CC" fontSize="11" fontFamily="Roboto" letterSpacing="0.5">
                    {param.label.toUpperCase()} ({param.unit})
                  </text>
                  <text x={14} y={PT + cH / 2} textAnchor="middle" fill="#BFC8CC" fontSize="11" fontFamily="Roboto" letterSpacing="0.5"
                    transform={`rotate(-90,14,${PT + cH / 2})`}>Cd</text>

                  {/* Chart border */}
                  <rect x={PL} y={PT} width={cW} height={cH} fill="none" stroke="#40484C" strokeWidth="1" />

                  {/* Series */}
                  {data && Object.entries(data.series).map(([bt, pts]) => {
                    const clr = BT_COLORS[bt] || '#82CFFF'
                    return (
                      <g key={bt}>
                        <path d={bandPath(pts)} fill={`url(#bg_${bt})`} />
                        <path d={linePath(pts)} fill="none" stroke={clr} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
                        {pts.map((p, i) => (
                          <circle key={i} cx={px(p.x)} cy={py(p.Cd)} r={hovIdx === i ? 5.5 : 3.5}
                            fill={clr} stroke="#0A0A0A" strokeWidth="1.5" style={{ cursor: 'crosshair', transition: 'r 0.1s' }} />
                        ))}
                      </g>
                    )
                  })}

                  {/* Hover crosshair */}
                  {hovIdx >= 0 && hovPts[hovIdx] && (
                    <line x1={px(hovPts[hovIdx].x)} y1={PT} x2={px(hovPts[hovIdx].x)} y2={PT + cH}
                      stroke="#82CFFF" strokeWidth="1" strokeDasharray="4,4" opacity="0.6" />
                  )}
                </svg>
              )}
            </div>

            {/* Hover tooltip strip */}
            {hovIdx >= 0 && data && (
              <div className="flex items-center gap-6 px-5 py-2.5 border-t border-md-outline-variant bg-md-surface-container-high shrink-0">
                <span className="text-label-md text-md-on-surface-variant font-mono">
                  {param.label}: {param.fmt(hovPts[hovIdx]?.x ?? 0)} {param.unit}
                </span>
                {Object.entries(data.series).map(([bt, pts]) => (
                  <span key={bt} className="flex items-center gap-1.5 text-label-lg font-mono">
                    <span className="w-2 h-2 rounded-full" style={{ background: BT_COLORS[bt] }} />
                    <span style={{ color: BT_COLORS[bt] }}>{bt}:</span>
                    <span className="text-md-on-surface num">{pts[hovIdx]?.Cd?.toFixed(4)}</span>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Bottom stat row */}
          {data && (
            <div className="grid grid-cols-4 gap-3 shrink-0">
              {(() => {
                const all = Object.values(data.series).flat()
                const best = all.reduce((a, b) => b.Cd < a.Cd ? b : a, all[0])
                const worst = all.reduce((a, b) => b.Cd > a.Cd ? b : a, all[0])
                const avgMs = (all.reduce((a, b) => a + b.ms, 0) / all.length).toFixed(0)
                return [
                  { label:'Best Cd',    val: best.Cd.toFixed(4),  sub:`at ${param.fmt(best.x)} ${param.unit}`,   c:'#34D399' },
                  { label:'Worst Cd',   val: worst.Cd.toFixed(4), sub:`at ${param.fmt(worst.x)} ${param.unit}`,  c:'#F87171' },
                  { label:'Δ Range',    val: (worst.Cd - best.Cd).toFixed(4), sub:'max − min',                   c:'#FBBF24' },
                  { label:'Avg Latency',val: avgMs + ' ms',        sub:`${all.length} inferences`,               c:'#BFC8CC' },
                ].map(s => (
                  <div key={s.label} className="m3-card-filled p-4">
                    <div className="text-label-md text-md-on-surface-variant uppercase tracking-wider mb-1">{s.label}</div>
                    <div className="text-title-lg font-mono num" style={{ color: s.c }}>{s.val}</div>
                    <div className="text-body-sm text-md-on-surface-variant">{s.sub}</div>
                  </div>
                ))
              })()}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
