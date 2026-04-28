// Copyright (c) 2026 Rutej Talati. All rights reserved.
// AeroNet — ReportPage.jsx
// Professional CFD post-processing report — printable / save as PDF

import { useState } from 'react'

const BENCHMARKS = [
  { name:'Tesla Model 3', Cd:0.23 }, { name:'BMW 3 Series',  Cd:0.26 },
  { name:'Audi A4',       Cd:0.27 }, { name:'Toyota Camry',  Cd:0.28 },
  { name:'VW Golf',       Cd:0.30 }, { name:'Porsche 911',   Cd:0.30 },
  { name:'Ford Mustang',  Cd:0.35 }, { name:'Generic SUV',   Cd:0.38 },
]

const DRAG_COLORS = ['#ef4444','#fb923c','#fbbf24','#84cc16','#22d3ee','#8a9296']

function SH({ n, t }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-label-md text-md-primary font-mono">{n}</span>
      <div className="flex-1 h-px bg-md-outline-variant" />
      <span className="text-label-md text-md-on-surface-variant uppercase tracking-wider">{t}</span>
    </div>
  )
}

// Confidence colour
const confColor = c => c > 0.85 ? '#34D399' : c > 0.70 ? '#FBBF24' : '#F87171'

export default function ReportPage({ result, history }) {
  const [title,   setTitle]   = useState('AeroNet CFD Surrogate Report')
  const [author,  setAuthor]  = useState('AeroNet v2.0')
  const [project, setProject] = useState('')
  const [notes,   setNotes]   = useState('')

  const now      = new Date().toLocaleString('en-GB')
  const hasResult = !!result

  const avgLatency = history.length
    ? Math.round(history.reduce((a, b) => a + b.inferenceMs, 0) / history.length)
    : 0

  return (
    <div className="flex flex-col h-full bg-md-background text-md-on-surface overflow-hidden">

      {/* Toolbar */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-md-outline-variant bg-md-surface-container-low shrink-0 no-print">
        <div className="w-7 h-7 rounded-full bg-md-primary-container flex items-center justify-center">
          <span style={{ fontSize: 14 }}>📄</span>
        </div>
        <div>
          <div className="text-label-lg text-md-on-surface font-medium">Report Generator</div>
          <div className="text-label-md text-md-on-surface-variant">Print / Save as PDF · professional CFD post-processing</div>
        </div>
        <div className="flex items-center gap-2 ml-4">
          <input value={title} onChange={e => setTitle(e.target.value)}
            className="bg-md-surface-container border border-md-outline-variant rounded-sm px-3 h-8 text-body-sm text-md-on-surface w-64 focus:outline-none focus:border-md-primary"
            placeholder="Report title" />
          <input value={author} onChange={e => setAuthor(e.target.value)}
            className="bg-md-surface-container border border-md-outline-variant rounded-sm px-3 h-8 text-body-sm text-md-on-surface w-36 focus:outline-none focus:border-md-primary"
            placeholder="Author" />
          <input value={project} onChange={e => setProject(e.target.value)}
            className="bg-md-surface-container border border-md-outline-variant rounded-sm px-3 h-8 text-body-sm text-md-on-surface w-36 focus:outline-none focus:border-md-primary"
            placeholder="Project / vehicle" />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-body-sm text-md-on-surface-variant">
            {history.length} run{history.length !== 1 ? 's' : ''} · avg {avgLatency} ms
          </span>
          <button onClick={() => window.print()}
            className="m3-btn-filled px-5 h-9 rounded-sm">
            🖨 Print / Save PDF
          </button>
        </div>
      </div>

      {/* Scrollable report */}
      <div className="flex-1 overflow-y-auto p-6 bg-md-surface-container-lowest">
        <div className="max-w-5xl mx-auto space-y-5">

          {/* Cover */}
          <div className="m3-card-elevated p-8 animate-slide-up">
            <div className="flex items-start justify-between mb-6">
              <div>
                <div className="text-headline-md text-md-on-surface font-medium">{title}</div>
                {project && <div className="text-title-md text-md-primary mt-1">{project}</div>}
                <div className="text-body-md text-md-on-surface-variant mt-1">
                  AeroNet CFD Surrogate · DrivAerML 484 HF-LES OpenFOAM cases
                </div>
              </div>
              <div className="text-right text-body-sm text-md-on-surface-variant space-y-0.5">
                <div className="text-label-lg text-md-on-surface">{author}</div>
                <div>{now}</div>
                <div className="text-md-primary font-mono">GradBoost · R²=0.9525 · err 5.4%</div>
              </div>
            </div>
            <div className="h-px bg-md-outline-variant mb-6" />
            <div className="grid grid-cols-5 gap-4">
              {[
                ['Model',        'GradBoost-DrivAerML'],
                ['Training Set', '484 HF-LES cases'],
                ['Val Error',    'Cd err 5.4%'],
                ['Inference',    `${avgLatency} ms avg`],
                ['Total Runs',   history.length.toString()],
              ].map(([k, v]) => (
                <div key={k} className="m3-card-filled p-4 text-center">
                  <div className="text-label-md text-md-on-surface-variant uppercase tracking-wider mb-1">{k}</div>
                  <div className="text-label-lg text-md-primary font-mono">{v}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Section 01 — Aerodynamic Coefficients */}
          <SH n="01" t="Aerodynamic Coefficients" />
          {hasResult ? (
            <div className="m3-card-outlined overflow-hidden animate-fade-in">
              <div className="grid grid-cols-4 divide-x divide-md-outline-variant">
                {[
                  { k:'Drag Coef.',    v: result.Cd.toFixed(4),       unit:'Cd', c:'#82CFFF',  big:true },
                  { k:'Lift Coef.',    v: result.Cl.toFixed(4),       unit:'Cl', c: result.Cl > 0 ? '#F87171' : '#34D399' },
                  { k:'Side Coef.',    v: result.Cs.toFixed(4),       unit:'Cs', c:'#FBBF24' },
                  { k:'Confidence',   v: (result.confidence*100).toFixed(1)+'%', unit:'', c: confColor(result.confidence) },
                ].map(m => (
                  <div key={m.k} className="p-5 space-y-2">
                    <div className="text-label-md text-md-on-surface-variant uppercase tracking-wider">{m.k}</div>
                    <div className={`font-mono num ${m.big ? 'text-display-sm' : 'text-headline-sm'}`} style={{ color: m.c }}>
                      {m.v} <span className="text-body-md text-md-on-surface-variant">{m.unit}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="border-t border-md-outline-variant grid grid-cols-4 divide-x divide-md-outline-variant">
                {[
                  { k:'Drag Force',     v: result.dragForceN.toFixed(1), unit:'N' },
                  { k:'Lift Force',     v: result.liftForceN.toFixed(1), unit:'N' },
                  { k:'Dyn. Pressure', v: result.qInfPa.toFixed(1),     unit:'Pa' },
                  { k:'Inference',     v: result.inferenceMs,             unit:'ms' },
                ].map(m => (
                  <div key={m.k} className="p-4 space-y-1">
                    <div className="text-label-md text-md-on-surface-variant uppercase tracking-wider">{m.k}</div>
                    <div className="text-title-lg font-mono num text-md-on-surface">{m.v} <span className="text-label-md text-md-on-surface-variant">{m.unit}</span></div>
                  </div>
                ))}
              </div>
              <div className="border-t border-md-outline-variant p-5 space-y-2">
                <div className="flex items-baseline justify-between mb-3">
                  <span className="text-label-md text-md-on-surface-variant uppercase tracking-wider">Drag Region Breakdown</span>
                  <span className="text-body-sm text-md-on-surface-variant">% of total Cd</span>
                </div>
                {result.dragBreakdown?.map((b, i) => (
                  <div key={b.region} className="space-y-1">
                    <div className="flex justify-between text-body-sm">
                      <span className="text-md-on-surface">{b.region}</span>
                      <span className="font-mono num text-md-on-surface-variant">{(b.fraction*100).toFixed(1)}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-md-surface-container-highest overflow-hidden">
                      <div className="h-full rounded-full" style={{ width:`${b.fraction*100}%`, background: DRAG_COLORS[i] }}/>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="m3-card-outlined p-8 text-center text-md-on-surface-variant">
              No prediction results yet. Run a CFD prediction from the CFD Predictor tab first.
            </div>
          )}

          {/* Section 02 — Benchmark Comparison */}
          <SH n="02" t="Benchmark Comparison" />
          <div className="m3-card-outlined overflow-hidden">
            {hasResult && (
              <div className="p-4 border-b border-md-outline-variant">
                <div className="relative h-3 rounded-full overflow-hidden mb-2">
                  <div className="absolute inset-0" style={{ background:'linear-gradient(to right,#34D399,#82CFFF,#FBBF24,#F87171)' }}/>
                  {BENCHMARKS.map((b, i) => (
                    <div key={i} className="absolute top-0 bottom-0 w-px bg-black/40"
                      style={{ left:`${((b.Cd-0.20)/0.20)*100}%` }}/>
                  ))}
                  <div className="absolute top-[-3px] bottom-[-3px] w-1 bg-white rounded-full shadow"
                    style={{ left:`${Math.min(98,Math.max(2,((result.Cd-0.20)/0.20)*100))}%` }}/>
                </div>
                <div className="flex justify-between text-label-sm text-md-on-surface-variant font-mono">
                  <span>0.20</span><span>0.30</span><span>0.40</span>
                </div>
              </div>
            )}
            <div className="divide-y divide-md-outline-variant">
              {BENCHMARKS.map((b, i) => {
                const d = hasResult ? result.Cd - b.Cd : null
                return (
                  <div key={i} className="flex items-center gap-4 px-5 py-3 hover:bg-md-surface-container transition-colors">
                    <span className="text-body-md text-md-on-surface w-32">{b.name}</span>
                    <span className="text-label-lg font-mono num text-md-primary w-12">{b.Cd.toFixed(3)}</span>
                    <div className="flex-1 h-1.5 rounded-full bg-md-surface-container-highest overflow-hidden">
                      <div className="h-full rounded-full" style={{ width:`${((b.Cd-0.20)/0.25)*100}%`,
                        background: b.Cd<0.26?'#34D399':b.Cd<0.30?'#82CFFF':b.Cd<0.34?'#FBBF24':'#F87171' }}/>
                    </div>
                    {d !== null && (
                      <span className="text-label-lg font-mono num w-16 text-right"
                        style={{ color: d <= 0 ? '#34D399' : '#F87171' }}>
                        {d > 0 ? '+' : ''}{d.toFixed(4)}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Section 03 — Inference History */}
          {history.length > 0 && (
            <>
              <SH n="03" t={`Inference History (${history.length} runs)`} />
              <div className="m3-card-outlined overflow-hidden">
                <div className="grid grid-cols-4 text-label-md text-md-on-surface-variant uppercase tracking-wider px-5 py-3 bg-md-surface-container-high border-b border-md-outline-variant">
                  <span>#</span><span>Configuration</span><span className="text-right">Cd</span><span className="text-right">Latency</span>
                </div>
                <div className="divide-y divide-md-outline-variant">
                  {history.map((h, i) => (
                    <div key={h.id} className="grid grid-cols-4 px-5 py-3 hover:bg-md-surface-container transition-colors">
                      <span className="text-label-md font-mono text-md-on-surface-variant">{String(i+1).padStart(2,'0')}</span>
                      <span className="text-body-sm text-md-on-surface truncate">{h.label}</span>
                      <span className="text-label-lg font-mono num text-right" style={{ color:'#82CFFF' }}>{h.Cd.toFixed(4)}</span>
                      <span className="text-label-md font-mono text-md-on-surface-variant text-right num">{h.inferenceMs} ms</span>
                    </div>
                  ))}
                </div>
                {/* Stats footer */}
                <div className="grid grid-cols-4 gap-4 p-4 bg-md-surface-container-high border-t border-md-outline-variant">
                  {(() => {
                    const cds = history.map(h => h.Cd)
                    return [
                      { k:'Min Cd',  v: Math.min(...cds).toFixed(4), c:'#34D399' },
                      { k:'Max Cd',  v: Math.max(...cds).toFixed(4), c:'#F87171' },
                      { k:'Mean Cd', v: (cds.reduce((a,b)=>a+b,0)/cds.length).toFixed(4), c:'#82CFFF' },
                      { k:'Avg ms',  v: avgLatency.toString(), c:'#BFC8CC' },
                    ].map(s => (
                      <div key={s.k} className="text-center">
                        <div className="text-label-md text-md-on-surface-variant">{s.k}</div>
                        <div className="text-label-lg font-mono num" style={{ color: s.c }}>{s.v}</div>
                      </div>
                    ))
                  })()}
                </div>
              </div>
            </>
          )}

          {/* Section 04 — Engineer Notes */}
          <SH n="04" t="Engineer Notes" />
          <div className="m3-card-outlined overflow-hidden">
            <textarea value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Add observations, design decisions, next steps…"
              className="w-full p-5 bg-transparent text-md-on-surface text-body-md resize-none focus:outline-none placeholder:text-md-on-surface-variant"
              style={{ minHeight: 100, fontFamily:'Roboto, sans-serif' }} />
          </div>

          {/* Footer */}
          <div className="text-center text-label-sm text-md-on-surface-variant py-4">
            AeroNet CFD Surrogate · GradBoost-DrivAerML · 484 HF-LES OpenFOAM cases · val Cd err 5.4% · {now}
          </div>
        </div>
      </div>

      <style>{`
        @media print {
          .no-print { display: none !important; }
          * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>
    </div>
  )
}
