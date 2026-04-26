// Copyright (c) 2026 Rutej Talati. All rights reserved.

export default function StatusBar({ result, history }) {
  const avg = history.length
    ? Math.round(history.reduce((s,h) => s + h.inferenceMs, 0) / history.length)
    : null

  return (
    <footer style={{
      height: 52,
      display: 'flex',
      alignItems: 'center',
      padding: '0 16px',
      gap: 0,
      borderTop: '1px solid #1e2b30',
      background: '#000',
      flexShrink: 0,
      flexDirection: 'column',
      justifyContent: 'center',
    }}>
      <div style={{ display:'flex', alignItems:'center', width:'100%', gap:16 }}>

        {/* Left: project metadata */}
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <Chip icon={
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="6"/>
              <line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/>
              <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/>
            </svg>
          }>
            <span style={{ color:'#4dd8e8' }}>main</span>
            <span style={{ color:'#3a4f56', margin:'0 4px' }}>·</span>
            <span style={{ fontFamily:'Roboto Mono' }}>8a3f4e2</span>
          </Chip>

          <Chip icon={
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>
            </svg>
          }>
            DrivAerStar · 12,000 cases
          </Chip>

          <Chip>
            <span style={{ color:'#938f99' }}># val Cd err</span>
            <span style={{ color:'#4dd8e8', marginLeft:4, fontFamily:'Roboto Mono' }}>5.4%</span>
          </Chip>
        </div>

        <div style={{ flex:1 }} />

        {/* Right: runtime stats */}
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          {history.length > 0 && (
            <Chip>
              <span style={{ color:'#938f99' }}>Inferences:</span>
              <span style={{ fontFamily:'Roboto Mono', color:'#4dd8e8', marginLeft:4 }}>{history.length}</span>
            </Chip>
          )}
          {avg && (
            <Chip>
              <span style={{ color:'#938f99' }}>Avg latency:</span>
              <span style={{ fontFamily:'Roboto Mono', color:'#fff', marginLeft:4 }}>{avg} ms</span>
            </Chip>
          )}
          <Chip>
            <span style={{ width:6, height:6, borderRadius:'50%', background:'#4ade80',
              animation:'pulse 2s ease-in-out infinite', flexShrink:0 }} />
            <span style={{ color:'#4ade80', marginLeft:4 }}>Ready</span>
          </Chip>
        </div>
      </div>

      {/* Copyright line */}
      <div style={{ width:'100%', textAlign:'center', fontSize:10, color:'#3a4f56',
        fontWeight:400, letterSpacing:'0.04em', marginTop:2 }}>
        © 2026 Rutej Talati · AeroNet · All rights reserved
      </div>
    </footer>
  )
}

function Chip({ children, icon }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:5,
      fontSize:11, color:'#938f99', fontVariantNumeric:'tabular-nums' }}>
      {icon && <span style={{ color:'#938f99', display:'flex', alignItems:'center' }}>{icon}</span>}
      {children}
    </div>
  )
}
