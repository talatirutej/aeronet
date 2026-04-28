// Copyright (c) 2026 Rutej Talati. All rights reserved.
// AeroNet — ComparePage.jsx
// Side-by-side comparison of up to 4 configurations

import { useState } from 'react'
import { predict } from '../lib/predict'

const SLOT_COLORS = ['#82CFFF', '#34D399', '#FBBF24', '#F87171']
const SLOT_NAMES  = ['Config A', 'Config B', 'Config C', 'Config D']
const BODY_TYPES  = ['fastback','notchback','estate','suv','pickup']
const DRAG_REGION_COLORS = ['#ef4444','#fb923c','#fbbf24','#84cc16','#22d3ee','#8a9296']

function SH({ n, t }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-label-md text-md-primary font-mono">{n}</span>
      <div className="flex-1 h-px bg-md-outline-variant" />
      <span className="text-label-md text-md-on-surface-variant uppercase tracking-wider">{t}</span>
    </div>
  )
}

function SliderField({ label, suffix, min, max, step, value, fmt, onChange }) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div className="space-y-1">
      <div className="flex justify-between">
        <span className="text-label-md text-md-on-surface-variant">{label}</span>
        <span className="text-label-lg text-md-primary font-mono num">{fmt(value)} <span className="text-label-sm text-md-on-surface-variant">{suffix}</span></span>
      </div>
      <div className="relative h-5 flex items-center">
        <div className="w-full h-1 rounded-full bg-md-surface-container-highest">
          <div className="h-1 rounded-full bg-md-primary" style={{ width: `${pct}%` }} />
        </div>
        <input type="range" min={min} max={max} step={step} value={value}
          onChange={e => onChange(parseFloat(e.target.value))}
          className="absolute inset-0 w-full opacity-0 cursor-pointer" />
        <div className="absolute w-5 h-5 rounded-full bg-md-primary shadow-elevation-1 pointer-events-none"
          style={{ left: `calc(${pct}% - 10px)` }} />
      </div>
    </div>
  )
}

function CdArc({ cd, color }) {
  const pct  = Math.min(1, Math.max(0, (cd - 0.15) / 0.35))
  const r    = (d) => (d - 90) * Math.PI / 180
  const ang  = -135 + pct * 270
  const nx   = 32 + 26 * Math.cos(r(ang))
  const ny   = 34 + 26 * Math.sin(r(ang))
  return (
    <svg viewBox="0 0 64 44" style={{ width: 80, height: 56 }}>
      <path d="M6,34 A26,26 0 0,1 58,34" fill="none" stroke="#40484C" strokeWidth="6" strokeLinecap="round" />
      <path d="M6,34 A26,26 0 0,1 58,34" fill="none" stroke={color} strokeWidth="6"
        strokeLinecap="round" strokeDasharray={`${pct * 82} 82`} />
      <line x1="32" y1="34" x2={nx} y2={ny} stroke={color} strokeWidth="2" strokeLinecap="round" />
      <circle cx="32" cy="34" r="3" fill={color} />
      <text x="32" y="30" textAnchor="middle" fill={color}
        fontSize="9" fontFamily="'Roboto Mono', monospace" fontWeight="500">{cd.toFixed(3)}</text>
    </svg>
  )
}

function ConfigSlot({ idx, config, onRun, onClear, isRunning }) {
  const color = SLOT_COLORS[idx]
  const name  = SLOT_NAMES[idx]

  const [bodyType,   setBodyType]   = useState('fastback')
  const [sizeFactor, setSizeFactor] = useState(1.0)
  const [uRef,       setURef]       = useState(40)
  const [rho,        setRho]        = useState(1.225)
  const [aRef,       setARef]       = useState(2.37)
  const [file,       setFile]       = useState(null)

  const run = () => onRun(idx, { bodyType, sizeFactor, uRef, rho, aRef }, file)

  return (
    <div className="rounded-md border flex flex-col overflow-hidden transition-all"
      style={{ borderColor: config?.result ? color + '44' : '#40484C' }}>

      {/* Slot header */}
      <div className="flex items-center justify-between px-3 py-2 shrink-0 border-b"
        style={{ background: config?.result ? color + '12' : '#111111', borderColor: color + '22' }}>
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
          <span className="text-label-lg" style={{ color }}>{name}</span>
          {config?.label && <span className="text-label-md text-md-on-surface-variant truncate max-w-[100px]">{config.label}</span>}
        </div>
        <div className="flex gap-1.5">
          <button onClick={run} disabled={isRunning}
            className="px-2.5 h-7 rounded-sm text-label-md transition-colors"
            style={{ background: color + '22', color, border: `1px solid ${color}44`, opacity: isRunning ? 0.5 : 1 }}>
            {isRunning ? '…' : 'Run'}
          </button>
          {config && (
            <button onClick={() => onClear(idx)}
              className="px-2 h-7 rounded-sm text-label-md text-md-error border border-md-error/30 hover:bg-md-error/10">
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Inputs */}
      <div className="p-3 bg-md-surface-container space-y-3 shrink-0">
        {/* Body type chips */}
        <div className="flex flex-wrap gap-1">
          {BODY_TYPES.map(bt => (
            <button key={bt} onClick={() => setBodyType(bt)}
              className="px-2 h-6 rounded-sm text-label-sm border transition-colors"
              style={{
                borderColor: bodyType === bt ? color : '#40484C',
                color: bodyType === bt ? color : '#8A9296',
                background: bodyType === bt ? color + '18' : 'transparent'
              }}>
              {bt}
            </button>
          ))}
        </div>
        {/* Sliders */}
        <div className="grid grid-cols-2 gap-3">
          <SliderField label="Size" suffix="×" min={0.85} max={1.15} step={0.01}
            value={sizeFactor} fmt={v => v.toFixed(2)} onChange={setSizeFactor} />
          <SliderField label="V" suffix="m/s" min={20} max={80} step={5}
            value={uRef} fmt={v => v.toFixed(0)} onChange={setURef} />
          <SliderField label="ρ" suffix="kg/m³" min={0.9} max={1.4} step={0.025}
            value={rho} fmt={v => v.toFixed(3)} onChange={setRho} />
          <SliderField label="Aref" suffix="m²" min={1.8} max={3.2} step={0.05}
            value={aRef} fmt={v => v.toFixed(2)} onChange={setARef} />
        </div>
        {/* File input */}
        <label className="flex items-center gap-2 text-label-sm text-md-on-surface-variant cursor-pointer
                           border border-dashed border-md-outline-variant rounded-sm px-2 py-1.5
                           hover:border-md-outline transition-colors">
          <input type="file" accept=".stl,.obj,.vtk" className="hidden"
            onChange={e => setFile(e.target.files[0])} />
          <span className="truncate">{file ? file.name : '📁 Attach geometry (optional)'}</span>
        </label>
      </div>

      {/* Result */}
      <div className="flex-1 flex flex-col items-center justify-center p-3 bg-md-background gap-2 min-h-[140px]">
        {isRunning ? (
          <div className="flex flex-col items-center gap-2">
            <span className="w-5 h-5 border-2 border-md-outline-variant rounded-full animate-spin" style={{ borderTopColor: color }} />
            <span className="text-label-md text-md-on-surface-variant">Running…</span>
          </div>
        ) : config?.result ? (
          <>
            <CdArc cd={config.result.Cd} color={color} />
            <div className="grid grid-cols-3 gap-1.5 w-full">
              {[['Cl', config.result.Cl.toFixed(3)], ['Cs', config.result.Cs.toFixed(3)], ['ms', config.result.inferenceMs]].map(([k, v]) => (
                <div key={k} className="rounded-sm bg-md-surface-container text-center py-1.5">
                  <div className="text-label-sm text-md-on-surface-variant font-mono">{k}</div>
                  <div className="text-label-lg font-mono num" style={{ color }}>{v}</div>
                </div>
              ))}
            </div>
            <div className="w-full space-y-1">
              {config.result.dragBreakdown?.slice(0, 4).map((b, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-label-sm text-md-on-surface-variant w-16 truncate">{b.region.split('/')[0]}</span>
                  <div className="flex-1 h-1 rounded-full bg-md-surface-container-highest overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${b.fraction * 100}%`, background: DRAG_REGION_COLORS[i] }} />
                  </div>
                  <span className="text-label-sm font-mono text-md-on-surface-variant w-8 text-right">
                    {(b.fraction * 100).toFixed(0)}%
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="text-center opacity-30">
            <div className="text-2xl mb-1">⬡</div>
            <div className="text-label-md text-md-on-surface-variant">Configure and run</div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function ComparePage() {
  const [configs,  setConfigs]  = useState([null, null, null, null])
  const [running,  setRunning]  = useState(-1)

  const handleRun = async (idx, params, file) => {
    setRunning(idx)
    const f = file ?? new File(['demo'], `cfg_${idx}.vtk`, { type: 'model/vtk' })
    try {
      const r = await predict(f, params)
      setConfigs(prev => {
        const next = [...prev]
        next[idx] = {
          label: `${params.bodyType} ${params.sizeFactor.toFixed(2)}× @${params.uRef}m/s`,
          result: r, params
        }
        return next
      })
    } catch (e) { console.error(e) }
    setRunning(-1)
  }

  const handleClear = (idx) => setConfigs(prev => { const n = [...prev]; n[idx] = null; return n })

  const valid   = configs.map((c, i) => ({ ...c, idx: i })).filter(c => c?.result)
  const base    = valid[0]

  return (
    <div className="flex flex-col h-full bg-md-background text-md-on-surface overflow-hidden">

      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-md-outline-variant bg-md-surface-container-low shrink-0">
        <div className="w-7 h-7 rounded-full bg-md-primary-container flex items-center justify-center">
          <span style={{ fontSize: 14 }}>⊞</span>
        </div>
        <div>
          <div className="text-label-lg text-md-on-surface font-medium">Comparative Study</div>
          <div className="text-label-md text-md-on-surface-variant">Up to 4 configurations · ΔCd vs baseline · drag region diff</div>
        </div>
        <div className="ml-auto flex items-center gap-2 text-label-md text-md-on-surface-variant">
          {valid.length > 0 && <span className="m3-chip"><span>{valid.length} config{valid.length > 1 ? 's' : ''} run</span></span>}
          {base && <span className="m3-chip"><span>Baseline: {base.result.Cd.toFixed(4)} Cd</span></span>}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">

        {/* 4-slot grid */}
        <div className="flex-1 grid grid-cols-4 gap-3 p-4 overflow-hidden">
          {[0, 1, 2, 3].map(i => (
            <ConfigSlot key={i} idx={i} config={configs[i]}
              onRun={handleRun} onClear={handleClear} isRunning={running === i} />
          ))}
        </div>

        {/* Delta panel */}
        {valid.length >= 2 && (
          <div className="w-60 shrink-0 border-l border-md-outline-variant overflow-y-auto p-4 space-y-4 bg-md-surface-container-low">

            <SH n="Δ" t="Delta Analysis" />

            {/* Cd delta bars */}
            <div className="space-y-3">
              {valid.map((c) => {
                const color  = SLOT_COLORS[c.idx]
                const dCd    = c.result.Cd - (base?.result?.Cd ?? c.result.Cd)
                const isBase = c.idx === valid[0].idx
                return (
                  <div key={c.idx} className="m3-card-outlined p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full" style={{ background: color }} />
                      <span className="text-label-lg truncate" style={{ color }}>{SLOT_NAMES[c.idx]}</span>
                      {isBase && <span className="text-label-sm text-md-on-surface-variant ml-auto">baseline</span>}
                    </div>
                    <div className="text-headline-sm font-mono num" style={{ color }}>
                      {c.result.Cd.toFixed(4)}
                    </div>
                    {!isBase && (
                      <div className="flex items-center gap-2">
                        <span className="text-label-lg font-mono num px-2 py-0.5 rounded-sm"
                          style={{ color: dCd < 0 ? '#34D399' : '#F87171', background: (dCd < 0 ? '#34D399' : '#F87171') + '18' }}>
                          {dCd > 0 ? '+' : ''}{dCd.toFixed(4)}
                        </span>
                        <span className="text-body-sm text-md-on-surface-variant">
                          {dCd < 0 ? '▼' : '▲'} {Math.abs(dCd / (base?.result.Cd || 1) * 100).toFixed(1)}%
                        </span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Drag region diff */}
            <SH n="▤" t="Drag Regions" />
            <div className="space-y-3">
              {base?.result.dragBreakdown?.map((b, bi) => (
                <div key={bi} className="space-y-1.5">
                  <span className="text-label-md text-md-on-surface-variant">{b.region}</span>
                  <div className="space-y-1">
                    {valid.map(c => {
                      const frac  = c.result.dragBreakdown?.[bi]?.fraction ?? 0
                      const color = SLOT_COLORS[c.idx]
                      return (
                        <div key={c.idx} className="flex items-center gap-2">
                          <span className="w-2 h-0.5 rounded" style={{ background: color }} />
                          <div className="flex-1 h-1.5 rounded-full bg-md-surface-container-highest overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${frac * 100}%`, background: color, opacity: 0.8 }} />
                          </div>
                          <span className="text-label-sm font-mono text-md-on-surface-variant w-7 text-right num">
                            {(frac * 100).toFixed(0)}%
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* Force comparison */}
            <SH n="F" t="Forces" />
            <div className="space-y-2">
              {[['Drag Force', 'dragForceN', 'N'], ['Lift Force', 'liftForceN', 'N']].map(([label, key, unit]) => (
                <div key={key} className="m3-card-filled p-3">
                  <div className="text-label-md text-md-on-surface-variant mb-2">{label}</div>
                  {valid.map(c => (
                    <div key={c.idx} className="flex items-center gap-2 mb-1">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: SLOT_COLORS[c.idx] }} />
                      <span className="text-label-lg font-mono num" style={{ color: SLOT_COLORS[c.idx] }}>
                        {c.result[key]?.toFixed(0) ?? '—'} <span className="text-label-sm text-md-on-surface-variant">{unit}</span>
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
