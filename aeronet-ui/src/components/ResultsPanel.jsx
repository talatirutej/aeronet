// Copyright (c) 2026 Rutej Talati. All rights reserved.

export default function ResultsPanel({ result, history, isLoading }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto', padding: '20px 16px' }}>

      <div className="section-label">04 — Prediction</div>

      {!result && !isLoading && (
        <div className="ios-card" style={{ padding: '36px 20px', textAlign: 'center', marginBottom: 20 }}>
          <div style={{
            width: 48, height: 48, borderRadius: 12, background: 'var(--bg2)',
            margin: '0 auto 14px', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
            </svg>
          </div>
          <div className="t-subhead" style={{ color: 'var(--text-secondary)' }}>No prediction yet</div>
          <div className="t-caption1" style={{ color: 'var(--text-tertiary)', marginTop: 4 }}>Configure inputs and run inference</div>
        </div>
      )}

      {isLoading && <LoadingState />}

      {result && !isLoading && (
        <div className="anim-stagger" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <PrimaryKPI result={result} />
          <SecondaryGrid result={result} />
          <DragBreakdown breakdown={result.dragBreakdown} />
        </div>
      )}

      {history.length > 0 && (
        <>
          <div className="section-label" style={{ marginTop: 24 }}>05 — History</div>
          <HistoryList items={history} />
        </>
      )}
    </div>
  )
}

function PrimaryKPI({ result }) {
  const conf = result.confidence
  const confColor = conf > 0.85 ? 'var(--green)' : conf > 0.7 ? 'var(--orange)' : 'var(--red)'

  return (
    <div className="ios-card anim-up" style={{ padding: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <div className="t-caption2" style={{ color: 'var(--text-tertiary)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>
            Drag Coefficient
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span className="mono num" style={{ fontSize: 46, fontWeight: 700, letterSpacing: '-2px', color: 'var(--blue)', lineHeight: 1 }}>
              {result.Cd.toFixed(3)}
            </span>
            <span className="t-title3" style={{ color: 'var(--text-tertiary)' }}>Cd</span>
          </div>
        </div>
        {/* Confidence */}
        <div style={{ textAlign: 'right' }}>
          <div className="t-caption2" style={{ color: 'var(--text-tertiary)', marginBottom: 6 }}>Confidence</div>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            padding: '4px 12px', borderRadius: 20,
            background: `${confColor.replace(')', ', 0.12)').replace('var(', 'rgba(').replace(/--[a-z]+/, match => ({
              'var(--green': '48,209,88',
              'var(--orange': '255,159,10',
              'var(--red': '255,69,58',
            }[match] ?? '255,255,255'))}`,
            border: `0.5px solid ${confColor}`,
          }}>
            <span className="status-dot" style={{ background: confColor }} />
            <span className="mono t-footnote num" style={{ color: confColor }}>
              {Math.round(conf * 100)}%
            </span>
          </div>
        </div>
      </div>

      <div className="ios-sep" />
      <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 12 }}>
        <span className="t-footnote" style={{ color: 'var(--text-tertiary)' }}>{result.bodyTypeLabel}</span>
        <span className="mono t-footnote num" style={{ color: 'var(--text-tertiary)' }}>{result.inferenceMs} ms</span>
      </div>
    </div>
  )
}

function SecondaryGrid({ result }) {
  const metrics = [
    { label: 'Lift Coef.', val: result.Cl?.toFixed(3) ?? '—', unit: 'Cl', accent: result.Cl > 0 ? 'var(--orange)' : 'var(--green)' },
    { label: 'Side Coef.', val: result.Cs?.toFixed(3) ?? '—', unit: 'Cs', accent: 'var(--indigo)' },
    { label: 'Drag Force', val: result.dragForceN?.toFixed(0) ?? '—', unit: 'N',  accent: 'var(--red)' },
    { label: 'Lift Force', val: result.liftForceN?.toFixed(0) ?? '—', unit: 'N',  accent: 'var(--text-secondary)' },
  ]

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
      {metrics.map((m, i) => (
        <div key={m.label} className="ios-card anim-up" style={{ padding: '14px 16px' }}>
          <div className="t-caption2" style={{ color: 'var(--text-tertiary)', marginBottom: 8 }}>{m.label}</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
            <span className="mono num" style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.5px', color: m.accent }}>
              {m.val}
            </span>
            <span className="t-caption1" style={{ color: 'var(--text-tertiary)' }}>{m.unit}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

function DragBreakdown({ breakdown }) {
  if (!breakdown) return null
  const COLORS = ['var(--red)', 'var(--orange)', 'var(--yellow)', 'var(--green)', 'var(--teal)', 'var(--indigo)']
  const max = Math.max(...breakdown.map(b => b.fraction))

  return (
    <div className="ios-card anim-up" style={{ padding: '16px 16px 12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 16 }}>
        <span className="t-caption2" style={{ color: 'var(--text-tertiary)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          Drag Contribution
        </span>
        <span className="t-caption1" style={{ color: 'var(--text-tertiary)' }}>% of total Cd</span>
      </div>
      {breakdown.map((b, i) => (
        <div key={b.region} style={{ marginBottom: i < breakdown.length - 1 ? 12 : 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
            <span className="t-footnote" style={{ color: 'var(--text-primary)' }}>{b.region}</span>
            <span className="mono t-footnote num" style={{ color: COLORS[i] }}>
              {(b.fraction * 100).toFixed(1)}%
            </span>
          </div>
          <div className="ios-progress-track">
            <div
              className="ios-progress-fill"
              style={{ width: `${(b.fraction / max) * 100}%`, background: COLORS[i] }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

function HistoryList({ items }) {
  return (
    <div className="ios-card" style={{ overflow: 'hidden' }}>
      {items.slice(0, 6).map((h, i) => (
        <div key={h.id} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 16px',
          borderBottom: i < Math.min(items.length, 6) - 1 ? '0.5px solid var(--sep)' : 'none',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <span className="mono t-caption2 num" style={{ color: 'var(--text-tertiary)', minWidth: 20, flexShrink: 0 }}>
              {String(i + 1).padStart(2, '0')}
            </span>
            <span className="t-footnote" style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {h.label}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 3, flexShrink: 0, marginLeft: 8 }}>
            <span className="mono t-subhead num" style={{ color: 'var(--blue)' }}>{h.Cd.toFixed(3)}</span>
            <span className="t-caption2" style={{ color: 'var(--text-tertiary)' }}>Cd</span>
          </div>
        </div>
      ))}
    </div>
  )
}

function LoadingState() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {[80, 48, 120].map((h, i) => (
        <div key={i} className="ios-card" style={{
          height: h, background: 'var(--bg1)',
          animation: `pulse 1.5s ease-in-out ${i * 0.15}s infinite`,
        }} />
      ))}
    </div>
  )
}
