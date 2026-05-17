// PipelineOverlay.jsx — AeroNet GSAP Pipeline Visualiser
// Copyright (c) 2026 Rutej Talati. All rights reserved.
//
// Uses GSAP (loaded from CDN) + DrawSVG plugin for the car outline reveal.
// Each pipeline stage triggers a distinct animation sequence.

import { useEffect, useRef, useState } from 'react'

const STAGE_COL = {
  prep:'#22cc55', rmbg:'#22cc55', yolo:'#0a84ff',
  sam3:'#ff9f0a', contour:'#ff9f0a', enh:'#ff453a',
  keys:'#bf5af2', cfd:'#bf5af2', done:'#30d158',
}

function getStagePct(stage, globalPct) {
  const [s0, s1] = stage.pct
  if (globalPct <= s0) return 0
  if (globalPct >= s1) return 100
  return Math.round((globalPct - s0) / (s1 - s0) * 100)
}

// Car silhouette SVG path (normalised to 400x180 viewBox)
const CAR_PATH = `M 8 140 C 8 130 14 115 26 108 C 38 95 55 82 75 72
  C 95 62 120 54 148 50 C 168 46 195 44 218 44
  C 245 44 272 46 295 52 C 318 58 338 68 355 78
  C 368 86 378 96 385 108 C 390 116 392 126 392 136
  L 392 140 L 355 140 C 352 122 338 110 316 110
  C 294 110 280 122 278 140 L 148 140
  C 146 122 132 110 110 110 C 88 110 74 122 72 140 Z`

// Window path
const WIN_PATH = `M 148 50 C 168 46 195 44 218 44
  C 245 44 272 46 292 50 L 285 90 C 270 92 248 94 228 94
  C 208 94 188 92 172 90 Z`

// Dimension annotation paths
const DIM_LINES = [
  { d:'M 8 155 L 392 155', label:'4520mm', mid:[200,168] },
  { d:'M 395 44 L 395 140', label:'1480mm', mid:[405,92] },
  { d:'M 72 140 L 316 140', label:'2680mm WB', mid:[194,150] },
]

export default function PipelineOverlay({ visible, pct = 0, msg = '', sub = '', stages = [] }) {
  const overlayRef  = useRef(null)
  const svgRef      = useRef(null)
  const gsapRef     = useRef(null)
  const tlRef       = useRef(null)
  const prevPhase   = useRef(-1)
  const [gsapReady, setGsapReady] = useState(false)

  // ── Load GSAP + DrawSVG from CDN once
  useEffect(() => {
    if (window.__gsapLoaded) { gsapRef.current = window.gsap; setGsapReady(true); return }
    const s1 = document.createElement('script')
    s1.src = 'https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js'
    s1.onload = () => {
      const s2 = document.createElement('script')
      s2.src = 'https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/DrawSVGPlugin.min.js'
      s2.onload = () => {
        window.gsap.registerPlugin(window.DrawSVGPlugin)
        window.__gsapLoaded = true
        gsapRef.current = window.gsap
        setGsapReady(true)
      }
      // DrawSVG might not be on free CDN — fallback: use stroke-dashoffset manually
      s2.onerror = () => {
        window.__gsapLoaded = true
        gsapRef.current = window.gsap
        setGsapReady(true)
      }
      document.head.appendChild(s2)
    }
    document.head.appendChild(s1)
  }, [])

  // ── Run stage animations when pct crosses thresholds
  useEffect(() => {
    if (!visible || !gsapReady || !svgRef.current) return
    const gsap = gsapRef.current
    if (!gsap) return

    const phase =
      pct < 8   ? 0 :
      pct < 18  ? 1 :
      pct < 32  ? 2 :
      pct < 46  ? 3 :
      pct < 60  ? 4 :
      pct < 74  ? 5 :
      pct < 84  ? 6 :
      pct < 100 ? 7 : 8

    if (phase === prevPhase.current) return
    prevPhase.current = phase

    const svg = svgRef.current
    const q = (sel) => svg.querySelector(sel)
    const qa = (sel) => Array.from(svg.querySelectorAll(sel))

    // Kill previous timeline
    if (tlRef.current) tlRef.current.kill()
    const tl = gsap.timeline()
    tlRef.current = tl

    if (phase === 0) {
      // ── PREPROCESS: scanlines sweep + photo frame materialises
      gsap.set(q('#stage-photo'), { opacity:0, scaleY:0, transformOrigin:'center center' })
      gsap.set(qa('.scanline'), { opacity:0 })
      gsap.set(q('#stage-bbox'), { opacity:0 })
      gsap.set(q('#stage-dots'), { opacity:0 })
      gsap.set(q('#stage-outline'), { opacity:0 })
      gsap.set(q('#stage-dims'), { opacity:0 })
      gsap.set(q('#stage-complete'), { opacity:0 })

      tl.to(q('#stage-photo'), { opacity:1, scaleY:1, duration:.5, ease:'power2.out' })
        .to(qa('.scanline'), { opacity:1, stagger:.08, duration:.3, ease:'none' }, '-=.2')
    }

    if (phase === 1) {
      // ── RMBG: scanlines sweep down, background dissolves
      tl.to(qa('.scanline'), {
          y: 180, stagger:{ each:.06, from:'start' },
          duration:.8, ease:'power1.inOut',
        })
        .to(q('#photo-bg'), { opacity:0, duration:.6, ease:'power2.in' }, '-=.4')
        .to(q('#car-silhouette'), { opacity:.9, duration:.5, ease:'power2.out' }, '-=.3')
    }

    if (phase === 2) {
      // ── YOLO: bbox corners snap in, confidence counts up
      gsap.set(q('#stage-bbox'), { opacity:1 })
      gsap.set(qa('.bbox-corner'), { scale:0, transformOrigin:'center center' })
      gsap.set(q('#conf-text'), { textContent:'0%' })

      tl.to(qa('.bbox-corner'), {
          scale:1, stagger:.08, duration:.3, ease:'back.out(2)',
        })
        .to(qa('.bbox-line'), {
          strokeDashoffset:0, stagger:.05, duration:.4, ease:'power2.out',
        }, '-=.1')
        // count up confidence
        .to({}, {
          duration:.8,
          onUpdate() { if (q('#conf-text')) q('#conf-text').textContent = Math.round(this.progress()*94) + '%' }
        }, '-=.3')
        .to(q('#conf-badge'), { opacity:1, scale:1, duration:.3, ease:'back.out(1.5)', transformOrigin:'center center' }, '-=.1')
    }

    if (phase === 3) {
      // ── SAM2: prompt dots pulse in with ripple rings
      gsap.set(q('#stage-dots'), { opacity:1 })
      const fgDots = qa('.dot-fg')
      const bgDots = qa('.dot-bg')
      gsap.set([...fgDots,...bgDots], { scale:0, transformOrigin:'center center' })
      gsap.set(qa('.dot-ring'), { scale:0, opacity:.7, transformOrigin:'center center' })

      tl.to(fgDots, { scale:1, stagger:.12, duration:.35, ease:'back.out(2)' })
        .to(bgDots, { scale:1, stagger:.1,  duration:.3,  ease:'back.out(2)' }, '-=.3')
        .to(qa('.dot-ring'), {
            scale:2.8, opacity:0, stagger:.08, duration:.8, ease:'power1.out',
          }, '-=.5')
    }

    if (phase === 4) {
      // ── CONTOUR: car outline draws itself stroke by stroke
      gsap.set(q('#stage-outline'), { opacity:1 })
      const carPath = q('#car-path-anim')
      const winPath = q('#win-path-anim')

      if (carPath) {
        const len = carPath.getTotalLength()
        gsap.set(carPath, { strokeDasharray: len, strokeDashoffset: len, opacity:1 })
        tl.to(carPath, { strokeDashoffset:0, duration:2.2, ease:'power2.inOut' })
      }
      if (winPath) {
        const wlen = winPath.getTotalLength()
        gsap.set(winPath, { strokeDasharray: wlen, strokeDashoffset: wlen, opacity:1 })
        tl.to(winPath, { strokeDashoffset:0, duration:.8, ease:'power2.inOut' }, '-=1')
      }
      // glow pulse after draw
      tl.to(q('#car-path-anim'), {
          filter:'drop-shadow(0 0 6px #ff9f0a)',
          yoyo:true, repeat:3, duration:.4, ease:'sine.inOut',
        }, '+=.1')
    }

    if (phase === 5) {
      // ── ENHANCE: dimension lines shoot out
      gsap.set(q('#stage-dims'), { opacity:1 })
      gsap.set(qa('.dim-line'), { strokeDashoffset: 500, opacity:1 })
      gsap.set(qa('.dim-label'), { opacity:0, y:5 })
      gsap.set(qa('.dim-tick'), { scale:0, transformOrigin:'center center' })

      tl.to(qa('.dim-line'), { strokeDashoffset:0, stagger:.2, duration:.5, ease:'power2.out' })
        .to(qa('.dim-tick'), { scale:1, stagger:.1, duration:.2, ease:'back.out(3)' }, '-=.2')
        .to(qa('.dim-label'), { opacity:1, y:0, stagger:.15, duration:.3, ease:'power2.out' }, '-=.2')
    }

    if (phase === 6) {
      // ── KEYPOINTS: angle arcs + Cd value counts up
      gsap.set(qa('.angle-arc'), { strokeDashoffset: 80, opacity:0 })
      gsap.set(q('#cd-value'), { textContent:'—' })

      tl.to(qa('.angle-arc'), { strokeDashoffset:0, opacity:1, stagger:.15, duration:.5, ease:'power2.out' })
        .to({}, {
          duration:1,
          onUpdate() {
            const v = (.18 + this.progress() * .16).toFixed(3)
            if (q('#cd-value')) q('#cd-value').textContent = 'Cd ' + v
          }
        }, '-=.2')
    }

    if (phase === 7) {
      // ── GEOMETRY: all annotations settle, numbers finalise
      tl.to(qa('.dim-label, .angle-arc'), {
          filter:'drop-shadow(0 0 4px rgba(255,159,10,.6))',
          duration:.4, ease:'sine.inOut', yoyo:true, repeat:2,
        })
    }

    if (phase === 8) {
      // ── COMPLETE: everything fades except outline + clean pulse
      tl.to(q('#stage-photo'), { opacity:0, duration:.4 })
        .to(q('#stage-bbox'), { opacity:0, duration:.4 }, '<')
        .to(q('#stage-dots'), { opacity:0, duration:.4 }, '<')
        .to(q('#stage-dims'), { opacity:0, duration:.6 })
        .to(q('#stage-outline'), {
            filter:'drop-shadow(0 0 12px #30d158)',
            duration:.6, ease:'power2.inOut',
          }, '-=.3')
        .to(q('#stage-complete'), { opacity:1, duration:.5, ease:'power2.out' })
        .to(q('#car-path-anim'), {
            stroke:'#30d158', duration:.8, ease:'power2.inOut',
          }, '-=.4')
    }

  }, [pct, visible, gsapReady]) // eslint-disable-line

  // Reset when hidden
  useEffect(() => {
    if (!visible) {
      prevPhase.current = -1
      if (tlRef.current) tlRef.current.kill()
    }
  }, [visible])

  if (!visible) return null

  // Build inline SVG for the animation stage
  const VW = 440, VH = 200

  return (
    <div ref={overlayRef} style={{
      position:'absolute', inset:0, zIndex:20,
      background:'#060a06',
      display:'flex', flexDirection:'column',
    }}>

      {/* ── M3 Stage chips (original style) */}
      <div style={{
        display:'flex', gap:5, flexWrap:'wrap',
        justifyContent:'center', padding:'9px 16px 6px',
        flexShrink:0,
      }}>
        {stages.map(s => {
          const active = pct >= s.pct[0] && pct < s.pct[1]
          const done   = pct >= s.pct[1]
          const col    = STAGE_COL[s.id] ?? '#22cc55'
          return (
            <div key={s.id} style={{
              display:'flex', alignItems:'center', gap:4,
              padding:'3px 10px', borderRadius:99,
              border:`0.5px solid ${done||active ? col+'99' : 'rgba(255,255,255,0.08)'}`,
              background: active ? `${col}1a` : done ? `${col}0d` : 'transparent',
              transition:'all 0.4s',
            }}>
              <span style={{ fontSize:11, color:done||active?col:'rgba(255,255,255,0.18)' }}>{s.icon}</span>
              <span style={{
                fontSize:9, fontFamily:'monospace', letterSpacing:'.08em',
                color:done||active?col:'rgba(255,255,255,0.18)',
                fontWeight:active?'bold':'normal',
                transition:'all 0.3s',
              }}>{s.label}</span>
              {done && <span style={{ fontSize:9, color:col }}>✓</span>}
              {active && <span style={{
                width:5, height:5, borderRadius:'50%', background:col, display:'inline-block',
                animation:'ap 0.8s ease infinite',
              }}/>}
            </div>
          )
        })}
      </div>

      {/* ── SVG animation stage */}
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', minHeight:0, position:'relative' }}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VW} ${VH}`}
          style={{ width:'100%', maxWidth:660, height:'auto', overflow:'visible' }}
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <filter id="glow-green">
              <feGaussianBlur stdDeviation="3" result="blur"/>
              <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
            <filter id="glow-amber">
              <feGaussianBlur stdDeviation="2" result="blur"/>
              <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
            <clipPath id="car-clip">
              <path d={CAR_PATH}/>
            </clipPath>
          </defs>

          {/* ── STAGE: PHOTO (preprocess) */}
          <g id="stage-photo" opacity="0">
            {/* photo frame */}
            <rect x="120" y="20" width="200" height="160" rx="4"
              fill="#111" stroke="#222" strokeWidth="1"/>
            {/* photo background */}
            <rect id="photo-bg" x="122" y="22" width="196" height="156" rx="3"
              fill="#1a2a1a" opacity="1"/>
            {/* car silhouette fill */}
            <path id="car-silhouette"
              d={`M${8+112} ${140-18} C${8+112} ${130-18} ${14+112} ${115-18} ${26+112} ${108-18}
                  C${38+112} ${95-18} ${55+112} ${82-18} ${75+112} ${72-18}
                  C${95+112} ${62-18} ${120+112} ${54-18} ${148+112} ${50-18}
                  C${168+112} ${46-18} ${195+112} ${44-18} ${218+112} ${44-18}
                  C${245+112} ${44-18} ${272+112} ${46-18} ${295+112} ${52-18}
                  C${318+112} ${58-18} ${338+112} ${68-18} ${355+112} ${78-18}
                  C${368+112} ${86-18} ${378+112} ${96-18} ${385+112} ${108-18}
                  C${390+112} ${116-18} ${392+112} ${126-18} ${392+112} ${136-18}
                  L ${392+112} ${140-18} L ${355+112} ${140-18}
                  C ${352+112} ${122-18} ${338+112} ${110-18} ${316+112} ${110-18}
                  C ${294+112} ${110-18} ${280+112} ${122-18} ${278+112} ${140-18}
                  L ${148+112} ${140-18}
                  C ${146+112} ${122-18} ${132+112} ${110-18} ${110+112} ${110-18}
                  C ${88+112} ${110-18} ${74+112} ${122-18} ${72+112} ${140-18} Z`}
              fill="#22cc5533" stroke="#22cc5566" strokeWidth=".8" opacity="0"/>
            {/* scanlines */}
            {Array.from({length:10}).map((_,i) => (
              <line key={i} className="scanline"
                x1="122" y1={22+i*16} x2="318" y2={22+i*16}
                stroke="#22cc5522" strokeWidth="8" opacity="0"/>
            ))}
            {/* frame label */}
            <text x="220" y="192" textAnchor="middle" fill="#22cc5544" fontSize="8" fontFamily="monospace">
              INPUT IMAGE
            </text>
          </g>

          {/* ── STAGE: YOLO BBOX */}
          <g id="stage-bbox" opacity="0">
            {/* bbox corner brackets */}
            {[
              [105,15],[325,15],[105,165],[325,165]
            ].map(([cx,cy],i) => {
              const sx = i%2===0?1:-1, sy = i<2?1:-1
              return (
                <g key={i} className="bbox-corner">
                  <line x1={cx} y1={cy} x2={cx+sx*14} y2={cy}
                    stroke="#0a84ff" strokeWidth="2.5" strokeLinecap="round"/>
                  <line x1={cx} y1={cy} x2={cx} y2={cy+sy*14}
                    stroke="#0a84ff" strokeWidth="2.5" strokeLinecap="round"/>
                </g>
              )
            })}
            {/* bbox dashed lines */}
            {[
              `M 119 15 L 311 15`,
              `M 325 29 L 325 151`,
              `M 311 165 L 119 165`,
              `M 105 151 L 105 29`,
            ].map((d,i) => (
              <path key={i} className="bbox-line" d={d}
                stroke="#0a84ff" strokeWidth=".8" strokeDasharray="4 3"
                fill="none" opacity=".6"
                style={{ strokeDashoffset: 200 }}/>
            ))}
            {/* confidence badge */}
            <g id="conf-badge" opacity="0" transform="translate(0,0)" style={{scale:0}}>
              <rect x="148" y="170" width="144" height="20" rx="10"
                fill="#0a84ff1a" stroke="#0a84ff66" strokeWidth=".8"/>
              <text id="conf-text" x="220" y="184" textAnchor="middle"
                fill="#0a84ff" fontSize="9" fontFamily="monospace" fontWeight="bold">
                0%
              </text>
              <text x="220" y="184" textAnchor="middle"
                fill="#0a84ffaa" fontSize="9" fontFamily="monospace">
                {/* updated by GSAP */}
              </text>
            </g>
            <text x="220" y="12" textAnchor="middle" fill="#0a84ff88" fontSize="7" fontFamily="monospace">
              VEHICLE DETECTED · CLASS:CAR
            </text>
          </g>

          {/* ── STAGE: SAM2 DOTS */}
          <g id="stage-dots" opacity="0">
            {/* foreground prompt points (green) */}
            {[
              [185,80],[220,65],[255,80],[220,110],[190,120]
            ].map(([x,y],i) => (
              <g key={i}>
                <circle className="dot-ring" cx={x} cy={y} r="8"
                  fill="none" stroke="#22cc55" strokeWidth="1.2"/>
                <circle className="dot-fg" cx={x} cy={y} r="4"
                  fill="#22cc55" opacity=".9"/>
              </g>
            ))}
            {/* background prompt points (red) */}
            {[
              [130,30],[310,30],[130,170],[310,170]
            ].map(([x,y],i) => (
              <g key={i}>
                <circle className="dot-ring" cx={x} cy={y} r="6"
                  fill="none" stroke="#ff453a" strokeWidth="1"/>
                <circle className="dot-bg" cx={x} cy={y} r="3"
                  fill="#ff453a" opacity=".8"/>
              </g>
            ))}
            <text x="365" y="80" fill="#22cc5566" fontSize="7" fontFamily="monospace">FG ×5</text>
            <text x="365" y="95" fill="#ff453a66" fontSize="7" fontFamily="monospace">BG ×4</text>
            <text x="75" y="192" fill="#ff9f0a44" fontSize="7" fontFamily="monospace" textAnchor="middle">
              SAM2 LARGE · POINT-PROMPTED SEGMENTATION
            </text>
          </g>

          {/* ── STAGE: CAR OUTLINE (contour) */}
          <g id="stage-outline" opacity="0">
            {/* ghost fill */}
            <path d={CAR_PATH} fill="#ff9f0a08" stroke="none"/>
            {/* animated outline */}
            <path id="car-path-anim" d={CAR_PATH}
              fill="none" stroke="#ff9f0a" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round"
              opacity="0"/>
            {/* window */}
            <path id="win-path-anim" d={WIN_PATH}
              fill="#4488cc11" stroke="#4488cc" strokeWidth="1.2"
              strokeLinecap="round" opacity="0"/>
            {/* wheel circles */}
            {[[110,140,24],[316,140,24]].map(([cx,cy,r],i) => (
              <g key={i}>
                <circle cx={cx} cy={cy} r={r} fill="none"
                  stroke="#ff9f0a66" strokeWidth="1.2" strokeDasharray="4 3"/>
                <circle cx={cx} cy={cy} r={r*.55} fill="none"
                  stroke="#ff9f0a33" strokeWidth=".8"/>
              </g>
            ))}
          </g>

          {/* ── STAGE: DIMENSIONS (enhance/keypoints) */}
          <g id="stage-dims" opacity="0">
            {/* dimension lines */}
            {DIM_LINES.map((d,i) => (
              <g key={i}>
                <path className="dim-line" d={d.d}
                  stroke="#bf5af2" strokeWidth=".8" strokeDasharray="3 3"
                  fill="none" opacity=".6"
                  style={{ strokeDasharray:'500', strokeDashoffset:'500' }}/>
                <text className="dim-label"
                  x={d.mid[0]} y={d.mid[1]}
                  textAnchor="middle" fill="#bf5af2" fontSize="8"
                  fontFamily="monospace" opacity="0">
                  {d.label}
                </text>
              </g>
            ))}
            {/* dimension ticks */}
            {[[8,155],[392,155],[8,140],[8,44],[395,44],[395,140]].map(([x,y],i) => (
              <line key={i} className="dim-tick"
                x1={x-4} y1={y} x2={x+4} y2={y}
                stroke="#bf5af2" strokeWidth="1.5" strokeLinecap="round"/>
            ))}
            {/* angle arcs */}
            <path className="angle-arc"
              d="M 52 108 A 24 24 0 0 1 26 130"
              fill="none" stroke="#ff9f0a" strokeWidth="1.2"
              strokeLinecap="round"
              style={{ strokeDasharray:'80', strokeDashoffset:'80' }}
              opacity="0"/>
            <path className="angle-arc"
              d="M 358 108 A 24 24 0 0 0 382 130"
              fill="none" stroke="#ff9f0a" strokeWidth="1.2"
              strokeLinecap="round"
              style={{ strokeDasharray:'80', strokeDashoffset:'80' }}
              opacity="0"/>
            {/* Cd readout */}
            <text id="cd-value" x="220" y="30"
              textAnchor="middle" fill="#ff9f0a" fontSize="14"
              fontFamily="monospace" fontWeight="bold" opacity=".9">
              —
            </text>
            <text x="220" y="19" textAnchor="middle"
              fill="#ff9f0a66" fontSize="7" fontFamily="monospace">
              DRAG COEFFICIENT
            </text>
          </g>

          {/* ── STAGE: COMPLETE */}
          <g id="stage-complete" opacity="0">
            <rect x="130" y="168" width="180" height="22" rx="11"
              fill="#30d15820" stroke="#30d15888" strokeWidth=".8"/>
            <text x="220" y="183" textAnchor="middle"
              fill="#30d158" fontSize="10" fontFamily="monospace" fontWeight="bold"
              letterSpacing=".1em">
              ANALYSIS COMPLETE
            </text>
          </g>

        </svg>
      </div>

      {/* ── msg strip */}
      <div style={{ flexShrink:0, textAlign:'center', padding:'0 16px 4px', minHeight:32 }}>
        <div style={{ fontSize:10, fontFamily:'monospace', color:'rgba(255,255,255,0.4)', letterSpacing:'.08em' }}>{msg}</div>
        {sub && <div style={{ fontSize:9, color:'rgba(255,255,255,0.2)', letterSpacing:'.04em', marginTop:1 }}>{sub}</div>}
      </div>

      {/* ── Global progress bar */}
      <div style={{ flexShrink:0, padding:'4px 14px 10px', background:'rgba(0,0,0,0.5)' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ flex:1, height:2, background:'rgba(255,255,255,0.06)', borderRadius:1, overflow:'hidden' }}>
            <div style={{
              height:'100%', width:`${pct}%`,
              background:`linear-gradient(90deg,#22cc55,${pct>80?'#30d158':'#22cc55'})`,
              borderRadius:1, transition:'width .5s ease',
              boxShadow:'0 0 8px #22cc5566',
            }}/>
          </div>
          <span style={{
            fontSize:12, fontFamily:'monospace', fontWeight:'bold',
            color:'#22cc55', letterSpacing:'.05em', minWidth:38, textAlign:'right',
          }}>
            {Math.round(pct)}<span style={{ fontSize:9, color:'rgba(100,200,100,0.4)' }}>%</span>
          </span>
        </div>
      </div>

      <style>{`
        @keyframes ap {
          0%,100%{opacity:1;transform:scale(1)}
          50%{opacity:.3;transform:scale(.5)}
        }
      `}</style>
    </div>
  )
}
