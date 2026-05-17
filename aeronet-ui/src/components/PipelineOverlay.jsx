// PipelineOverlay.jsx — AeroNet Loading Animation
// Copyright (c) 2026 Rutej Talati. All rights reserved.

export default function PipelineOverlay({ visible, pct = 0, msg = '', sub = '', stages = [] }) {
  if (!visible) return null

  const activeStage = stages.find(s => pct >= s.pct[0] && pct < s.pct[1])
  const activeCol = {
    prep:'#22cc55', rmbg:'#22cc55', yolo:'#0a84ff',
    sam3:'#ff9f0a', contour:'#ff9f0a', enh:'#ff453a',
    keys:'#bf5af2', cfd:'#bf5af2', done:'#30d158',
  }[activeStage?.id] ?? '#22cc55'

  return (
    <div style={{
      position:'absolute', inset:0, zIndex:20,
      background:'rgba(20,20,20,0.96)',
      backdropFilter:'blur(8px)',
      display:'flex', flexDirection:'column',
      alignItems:'center', justifyContent:'center',
      gap:28,
    }}>

      {/* M3 stage chips — original style */}
      <div style={{
        display:'flex', gap:6, flexWrap:'wrap',
        justifyContent:'center', maxWidth:560, padding:'0 24px',
      }}>
        {stages.map(s => {
          const active = pct >= s.pct[0] && pct < s.pct[1]
          const done   = pct >= s.pct[1]
          return (
            <div key={s.id} className="md-chip-assist"
              data-active={active} data-done={done}>
              <span style={{ fontSize:12 }}>{s.icon}</span>
              <span>{s.label}</span>
              {done && <span style={{ fontSize:10 }}>✓</span>}
            </div>
          )
        })}
      </div>

      {/* Spinning rings */}
      <div style={{ position:'relative', width:160, height:160 }}>

        {/* outer ring — slow clockwise */}
        <div style={{
          position:'absolute', inset:0,
          borderRadius:'50%',
          border:`2px solid transparent`,
          borderTopColor: activeCol,
          borderRightColor: activeCol+'44',
          animation:'spin-cw 2.8s linear infinite',
          boxShadow:`0 0 12px ${activeCol}33`,
        }}/>

        {/* middle ring — medium counter-clockwise */}
        <div style={{
          position:'absolute', inset:16,
          borderRadius:'50%',
          border:`1.5px solid transparent`,
          borderTopColor: activeCol+'cc',
          borderLeftColor: activeCol+'66',
          animation:'spin-ccw 1.9s linear infinite',
        }}/>

        {/* inner ring — fast clockwise */}
        <div style={{
          position:'absolute', inset:32,
          borderRadius:'50%',
          border:`1px solid transparent`,
          borderTopColor: activeCol,
          borderBottomColor: activeCol+'44',
          animation:'spin-cw 1.1s linear infinite',
          boxShadow:`0 0 8px ${activeCol}55`,
        }}/>

        {/* centre dot */}
        <div style={{
          position:'absolute', inset:0,
          display:'flex', alignItems:'center', justifyContent:'center',
          flexDirection:'column', gap:4,
        }}>
          <div style={{
            fontSize:24, fontWeight:300,
            fontFamily:'var(--font-mono)',
            color: activeCol,
            letterSpacing:'-1px',
            lineHeight:1,
            transition:'color 0.5s',
          }}>
            {Math.round(pct)}
          </div>
          <div style={{
            fontSize:10, fontWeight:400,
            fontFamily:'var(--font-mono)',
            color:'var(--md-on-surface-variant)',
            letterSpacing:'0.04em',
          }}>%</div>
        </div>
      </div>

      {/* M3 card — message */}
      <div className="md-card-elevated" style={{
        width:400, maxWidth:'88vw',
        padding:'16px 20px',
        display:'flex', flexDirection:'column', gap:10,
      }}>
        {/* linear progress */}
        <div className="md-linear-progress">
          <div className="md-linear-progress-bar" style={{
            width:`${pct}%`,
            background: activeCol,
            boxShadow:`0 0 6px ${activeCol}88`,
            transition:'width 0.4s ease, background 0.5s ease',
          }}/>
        </div>

        {/* message */}
        <div style={{
          fontSize:13,
          fontFamily:'var(--font-mono)',
          color:'var(--md-on-surface)',
          lineHeight:1.55,
          textAlign:'center',
          minHeight:20,
        }}>
          {msg}
        </div>

        {sub && (
          <div style={{
            fontSize:11,
            fontFamily:'var(--font-sans)',
            color:'var(--md-on-surface-variant)',
            textAlign:'center',
            letterSpacing:'0.4px',
          }}>
            {sub}
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin-cw  { to { transform: rotate(360deg);  } }
        @keyframes spin-ccw { to { transform: rotate(-360deg); } }
      `}</style>
    </div>
  )
}
