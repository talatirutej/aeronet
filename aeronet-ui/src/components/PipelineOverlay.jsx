// PipelineOverlay.jsx — Material 3 Black/White Theme
// Copyright (c) 2026 Rutej Talati. All rights reserved.

export default function PipelineOverlay({ visible, pct, msg, sub, stages = [] }) {
  if (!visible) return null

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 20,
      background: 'rgba(20,20,20,0.94)',
      backdropFilter: 'blur(8px)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: 28,
      animation: 'md-slide-in 0.2s ease both',
    }}>

      {/* M3 Assist chips — pipeline stages */}
      <div style={{
        display: 'flex', gap: 6, flexWrap: 'wrap',
        justifyContent: 'center', maxWidth: 560, padding: '0 24px',
      }}>
        {stages.map(s => {
          const active = pct >= s.pct[0] && pct < s.pct[1]
          const done   = pct >= s.pct[1]
          return (
            <div
              key={s.id}
              className="md-chip-assist"
              data-active={active}
              data-done={done}
            >
              <span style={{ fontSize: 12 }}>{s.icon}</span>
              <span>{s.label}</span>
              {done && <span style={{ fontSize: 10 }}>✓</span>}
            </div>
          )
        })}
      </div>

      {/* M3 Card — progress + message */}
      <div className="md-card-elevated" style={{
        width: 400, maxWidth: '88vw',
        padding: '20px 24px',
        display: 'flex', flexDirection: 'column', gap: 14,
      }}>
        {/* M3 Linear progress */}
        <div className="md-linear-progress">
          <div className="md-linear-progress-bar" style={{ width: `${pct}%` }}/>
        </div>

        {/* Message */}
        <div style={{
          fontSize: 13,
          fontFamily: 'var(--font-mono)',
          color: 'var(--md-on-surface)',
          lineHeight: 1.55,
          textAlign: 'center',
          minHeight: 20,
        }}>
          {msg}
        </div>

        {sub && (
          <div style={{
            fontSize: 11,
            fontFamily: 'var(--font-sans)',
            color: 'var(--md-on-surface-variant)',
            textAlign: 'center',
            letterSpacing: '0.4px',
          }}>
            {sub}
          </div>
        )}

        {/* Pct */}
        <div style={{
          textAlign: 'center',
          fontSize: 28,
          fontWeight: 300,
          fontFamily: 'var(--font-mono)',
          color: 'var(--md-primary)',
          letterSpacing: '-1px',
          lineHeight: 1,
        }}>
          {Math.round(pct)}
          <span style={{ fontSize: 14, fontWeight: 400, marginLeft: 2, color: 'var(--md-on-surface-variant)' }}>%</span>
        </div>
      </div>
    </div>
  )
}// PipelineOverlay.jsx — Material 3 Black/White Theme
// Copyright (c) 2026 Rutej Talati. All rights reserved.

export default function PipelineOverlay({ visible, pct, msg, sub, stages = [] }) {
  if (!visible) return null

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 20,
      background: 'rgba(20,20,20,0.94)',
      backdropFilter: 'blur(8px)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: 28,
      animation: 'md-slide-in 0.2s ease both',
    }}>

      {/* M3 Assist chips — pipeline stages */}
      <div style={{
        display: 'flex', gap: 6, flexWrap: 'wrap',
        justifyContent: 'center', maxWidth: 560, padding: '0 24px',
      }}>
        {stages.map(s => {
          const active = pct >= s.pct[0] && pct < s.pct[1]
          const done   = pct >= s.pct[1]
          return (
            <div
              key={s.id}
              className="md-chip-assist"
              data-active={active}
              data-done={done}
            >
              <span style={{ fontSize: 12 }}>{s.icon}</span>
              <span>{s.label}</span>
              {done && <span style={{ fontSize: 10 }}>✓</span>}
            </div>
          )
        })}
      </div>

      {/* M3 Card — progress + message */}
      <div className="md-card-elevated" style={{
        width: 400, maxWidth: '88vw',
        padding: '20px 24px',
        display: 'flex', flexDirection: 'column', gap: 14,
      }}>
        {/* M3 Linear progress */}
        <div className="md-linear-progress">
          <div className="md-linear-progress-bar" style={{ width: `${pct}%` }}/>
        </div>

        {/* Message */}
        <div style={{
          fontSize: 13,
          fontFamily: 'var(--font-mono)',
          color: 'var(--md-on-surface)',
          lineHeight: 1.55,
          textAlign: 'center',
          minHeight: 20,
        }}>
          {msg}
        </div>

        {sub && (
          <div style={{
            fontSize: 11,
            fontFamily: 'var(--font-sans)',
            color: 'var(--md-on-surface-variant)',
            textAlign: 'center',
            letterSpacing: '0.4px',
          }}>
            {sub}
          </div>
        )}

        {/* Pct */}
        <div style={{
          textAlign: 'center',
          fontSize: 28,
          fontWeight: 300,
          fontFamily: 'var(--font-mono)',
          color: 'var(--md-primary)',
          letterSpacing: '-1px',
          lineHeight: 1,
        }}>
          {Math.round(pct)}
          <span style={{ fontSize: 14, fontWeight: 400, marginLeft: 2, color: 'var(--md-on-surface-variant)' }}>%</span>
        </div>
      </div>
    </div>
  )
}
