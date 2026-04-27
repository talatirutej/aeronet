// Copyright (c) 2026 Rutej Talati. All rights reserved.

export default function StatusBar({ result, history, activeModel, backendStatus }) {
  const avgMs = history.length > 0
    ? Math.round(history.reduce((a, b) => a + b.inferenceMs, 0) / history.length)
    : null

  return (
    <footer style={{
      height: 26,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 16px',
      background: 'var(--bg1)',
      borderTop: '0.5px solid var(--sep)',
      flexShrink: 0,
    }}>
      {/* Left */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <StatusItem>
          <span style={{ color: 'var(--label3)' }}>main</span>
          <Sep />
          <span className="mono" style={{ color: 'var(--label3)' }}>8a3f4e2</span>
        </StatusItem>
        <Sep />
        <StatusItem>
          <span style={{ color: 'var(--label3)' }}>DrivAerML · 484 HF-LES cases</span>
        </StatusItem>
        <Sep />
        <StatusItem>
          <span style={{ color: 'var(--label3)' }}>val Cd err 5.4%</span>
        </StatusItem>
      </div>

      {/* Right */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <StatusItem>
          <span style={{ color: 'var(--label3)' }}>Runs:</span>
          <span className="mono num" style={{ color: 'var(--blue)' }}>{history.length}</span>
        </StatusItem>
        {avgMs !== null && (
          <>
            <Sep />
            <StatusItem>
              <span style={{ color: 'var(--label3)' }}>Avg:</span>
              <span className="mono num" style={{ color: 'var(--blue)' }}>{avgMs} ms</span>
            </StatusItem>
          </>
        )}
        <Sep />
        <StatusItem>
          <span className="status-dot" style={{
            background: 'var(--green)',
            boxShadow: '0 0 4px var(--green)',
            animation: 'pulse 2.5s ease-in-out infinite',
          }} />
          <span style={{ color: 'var(--green)' }}>Ready</span>
        </StatusItem>
      </div>
    </footer>
  )
}

function StatusItem({ children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, letterSpacing: '-0.08px' }}>
      {children}
    </div>
  )
}

function Sep() {
  return <span style={{ width: 0.5, height: 10, background: 'var(--sep)', display: 'inline-block', flexShrink: 0 }} />
}
