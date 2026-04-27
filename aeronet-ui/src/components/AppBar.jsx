// Copyright (c) 2026 Rutej Talati. All rights reserved.

const PAGES = [
  { id: '3d',      label: '3D Viewer'  },
  { id: '2d',      label: 'Parametric' },
  { id: 'history', label: 'History'    },
]

const SURROGATE_MODELS = [
  { id: 'GradBoost-DrivAerML',    label: 'GradBoost',   sub: 'R²=0.953', page: '2d' },
  { id: 'RandomForest-DrivAerML', label: 'RandomForest', sub: 'R²=0.815', page: '2d' },
  { id: 'ResNet-Tabular-12K',     label: 'ResNet',       sub: 'Pending',  page: '2d' },
]

export default function AppBar({ backendStatus, activePage, onPageChange, activeModel, onModelChange }) {
  const isOnline = backendStatus?.online

  return (
    <header style={{
      height: 52,
      display: 'flex',
      alignItems: 'center',
      padding: '0 16px',
      gap: 0,
      background: 'rgba(0,0,0,0.82)',
      backdropFilter: 'blur(20px) saturate(180%)',
      WebkitBackdropFilter: 'blur(20px) saturate(180%)',
      borderBottom: '0.5px solid var(--sep)',
      flexShrink: 0,
      zIndex: 100,
    }}>
      {/* Brand */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginRight: 24, minWidth: 130 }}>
        <div style={{
          width: 28, height: 28, borderRadius: 8,
          background: 'rgba(10,132,255,0.15)',
          border: '0.5px solid rgba(10,132,255,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M2 8C2 5.5 4 3 8 3s6 2.5 6 5-2 5-6 5-6-2.5-6-5z" stroke="var(--blue)" strokeWidth="1.2" fill="none"/>
            <path d="M1 8h14M8 3v10" stroke="var(--blue)" strokeWidth="1" opacity="0.5"/>
            <circle cx="8" cy="8" r="1.5" fill="var(--blue)"/>
          </svg>
        </div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.4px', color: 'var(--label)', lineHeight: 1 }}>
            AeroNet
          </div>
          <div style={{ fontSize: 10, color: 'var(--label3)', letterSpacing: '0.04em', textTransform: 'uppercase', marginTop: 1 }}>
            CFD Surrogate
          </div>
        </div>
      </div>

      {/* Page tabs */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1 }}>
        {PAGES.map(p => (
          <button
            key={p.id}
            onClick={() => onPageChange(p.id)}
            style={{
              padding: '5px 14px',
              borderRadius: 8,
              border: 'none',
              background: activePage === p.id ? 'rgba(255,255,255,0.1)' : 'transparent',
              color: activePage === p.id ? 'var(--label)' : 'var(--label2)',
              fontSize: 14,
              fontWeight: activePage === p.id ? 600 : 400,
              letterSpacing: '-0.24px',
              cursor: 'pointer',
              transition: 'background 0.15s, color 0.15s',
              fontFamily: "'IBM Plex Sans', sans-serif",
            }}
          >
            {p.label}
          </button>
        ))}

        {/* Separator */}
        <div style={{ width: 0.5, height: 16, background: 'var(--sep)', margin: '0 8px' }} />

        {/* Surrogate model selector — only visible on 2D page */}
        {activePage === '2d' && SURROGATE_MODELS.map(m => (
          <button
            key={m.id}
            onClick={() => onModelChange(m.id)}
            className={`ios-chip ${activeModel === m.id ? 'active' : ''}`}
            style={{ marginRight: 4, fontSize: 12 }}
          >
            {m.label}
            <span style={{ marginLeft: 4, opacity: 0.6, fontSize: 10 }}>{m.sub}</span>
          </button>
        ))}
      </div>

      {/* Right side — status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 16 }}>
        <div className="ios-pill" style={{ gap: 6 }}>
          <span className="status-dot" style={{
            background: isOnline === null ? 'var(--label3)' : isOnline ? 'var(--green)' : 'var(--orange)',
            boxShadow: isOnline ? '0 0 5px var(--green)' : 'none',
          }} />
          <span style={{ color: isOnline === null ? 'var(--label3)' : isOnline ? 'var(--green)' : 'var(--orange)' }}>
            {isOnline === null ? 'Checking' : isOnline ? 'Online' : 'Mock mode'}
          </span>
        </div>
        <div className="ios-pill">
          <span className="mono" style={{ color: 'var(--label3)', fontSize: 11 }}>DrivAerML</span>
          <span style={{ color: 'var(--label3)', fontSize: 11 }}>484 cases</span>
        </div>
      </div>
    </header>
  )
}
