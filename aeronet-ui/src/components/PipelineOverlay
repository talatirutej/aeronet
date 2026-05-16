// PipelineOverlay.jsx
// Copyright (c) 2026 Rutej Talati. All rights reserved.
// AeroNet — pipeline progress overlay for the 2D analysis view.

export default function PipelineOverlay({ visible, pct, msg, sub, stages = [] }) {
  if (!visible) return null

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 20,
      background: 'rgba(7,13,20,0.92)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: 24,
      backdropFilter: 'blur(4px)',
    }}>

      {/* Stage pills */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center', maxWidth: 540 }}>
        {stages.map(s => {
          const active = pct >= s.pct[0] && pct < s.pct[1]
          const done   = pct >= s.pct[1]
          return (
            <div key={s.id} style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '3px 10px', borderRadius: 20,
              fontSize: 9, fontFamily: "'IBM Plex Mono', monospace",
              fontWeight: 600, letterSpacing: '0.06em',
              border: `0.5px solid ${active ? 'rgba(10,132,255,0.7)' : done ? 'rgba(48,209,88,0.4)' : 'rgba(255,255,255,0.08)'}`,
              background: active ? 'rgba(10,132,255,0.15)' : done ? 'rgba(48,209,88,0.08)' : 'transparent',
              color: active ? 'rgba(10,132,255,0.95)' : done ? 'rgba(48,209,88,0.85)' : 'rgba(255,255,255,0.20)',
              transition: 'all 0.3s',
            }}>
              <span>{s.icon}</span>
              <span>{s.label}</span>
              {done && <span style={{ color: 'rgba(48,209,88,0.7)' }}>✓</span>}
            </div>
          )
        })}
      </div>

      {/* Progress bar */}
      <div style={{ width: 380, maxWidth: '80vw' }}>
        <div style={{
          height: 2, borderRadius: 2,
          background: 'rgba(255,255,255,0.06)',
          overflow: 'hidden', marginBottom: 14,
        }}>
          <div style={{
            height: '100%', borderRadius: 2,
            width: `${pct}%`,
            background: 'linear-gradient(90deg, rgba(10,132,255,0.8), rgba(10,132,255,1))',
            transition: 'width 0.6s cubic-bezier(0.4,0,0.2,1)',
          }}/>
        </div>

        {/* Message */}
        <div style={{
          fontSize: 11, color: 'rgba(255,255,255,0.75)',
          fontFamily: "'IBM Plex Mono', monospace",
          lineHeight: 1.5, textAlign: 'center',
          minHeight: 32,
        }}>
          {msg}
        </div>
        {sub && (
          <div style={{
            fontSize: 9, color: 'rgba(255,255,255,0.30)',
            fontFamily: "'IBM Plex Mono', monospace",
            textAlign: 'center', marginTop: 4,
            letterSpacing: '0.06em',
          }}>
            {sub}
          </div>
        )}
      </div>

      {/* Pct counter */}
      <div style={{
        fontSize: 10, fontWeight: 700,
        color: 'rgba(10,132,255,0.60)',
        fontFamily: "'IBM Plex Mono', monospace",
        letterSpacing: '0.10em',
      }}>
        {Math.round(pct)}%
      </div>
    </div>
  )
}
