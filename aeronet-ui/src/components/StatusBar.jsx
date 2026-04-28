// Copyright (c) 2026 Rutej Talati. All rights reserved.

export default function StatusBar({ result, history }) {
  const avgMs = history.length > 0
    ? Math.round(history.reduce((a, b) => a + b.inferenceMs, 0) / history.length)
    : null

  return (
    <footer style={{
      height: 26, display: 'flex', alignItems: 'center',
      justifyContent: 'space-between', padding: '0 16px',
      background: 'var(--bg1)', borderTop: '0.5px solid var(--sep)',
      flexShrink: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <SI><span style={S.dim}>main</span><V /><span style={S.mono}>97e4b36</span></SI>
        <V />
        <SI><span style={S.dim}>DrivAerML · 484 HF-LES cases</span></SI>
        <V />
        <SI><span style={S.dim}>val Cd err 5.4%</span></SI>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <SI><span style={S.dim}>Runs:</span><span style={S.blue}>{history.length}</span></SI>
        {avgMs !== null && <><V /><SI><span style={S.dim}>Avg:</span><span style={S.blue}>{avgMs} ms</span></SI></>}
        <V />
        <SI>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)', boxShadow: '0 0 5px var(--green)', animation: 'pulse 2.5s ease-in-out infinite', display: 'inline-block' }} />
          <span style={{ color: 'var(--green)' }}>Ready</span>
        </SI>
      </div>
    </footer>
  )
}

const S = {
  dim:  { color: 'rgba(235,235,245,0.28)', fontFamily: "'IBM Plex Sans', sans-serif" },
  blue: { color: 'var(--blue)', fontFamily: "'IBM Plex Mono', monospace", fontVariantNumeric: 'tabular-nums' },
  mono: { color: 'rgba(235,235,245,0.28)', fontFamily: "'IBM Plex Mono', monospace" },
}

function SI({ children }) {
  return <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}>{children}</div>
}
function V() {
  return <span style={{ width: 0.5, height: 10, background: 'var(--sep)', display: 'inline-block', flexShrink: 0 }} />
}
