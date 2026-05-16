// PipelineOverlay.jsx — AeroNet Engine Animation
// Copyright (c) 2026 Rutej Talati. All rights reserved.

import { useEffect, useRef } from 'react'

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

const CAR_BODY = [[.04,.72],[.06,.58],[.10,.48],[.16,.38],[.24,.28],[.32,.20],[.42,.16],[.58,.16],[.68,.20],[.76,.28],[.82,.36],[.86,.44],[.88,.52],[.89,.60],[.89,.72],[.82,.72],[.76,.72],[.68,.72],[.58,.72],[.48,.72],[.38,.72],[.28,.72],[.18,.72],[.10,.72],[.04,.72]]
const CAR_SILL = [[.10,.72],[.12,.66],[.16,.64],[.28,.62],[.38,.62],[.48,.62],[.58,.62],[.68,.64],[.76,.66],[.82,.72]]
const CAR_WIN  = [[.24,.28],[.28,.22],[.36,.17],[.48,.16],[.60,.16],[.68,.20],[.72,.26],[.72,.44],[.60,.46],[.48,.46],[.36,.46],[.28,.46],[.24,.28]]

export default function PipelineOverlay({ visible, pct = 0, msg = '', sub = '', stages = [] }) {
  const wrapRef   = useRef(null)
  const engRef    = useRef(null)
  const sketchRef = useRef(null)
  const rafRef    = useRef(null)
  // Use a ref for pct so the loop always reads the latest value without restart
  const pctRef    = useRef(pct)
  const stateRef  = useRef(null)

  // Keep pctRef current
  useEffect(() => { pctRef.current = pct }, [pct])

  // Trigger sketch when pct hits 100
  useEffect(() => {
    if (pct >= 100 && stateRef.current && !stateRef.current.exploded) {
      const S = stateRef.current
      S.exploded = true
      S.flashAlpha = 1
      // spawn explosion particles
      const cols = ['255,120,0','255,210,40','255,255,180','255,40,0','210,210,210']
      for (let i = 0; i < 80; i++) {
        const a = Math.random() * Math.PI * 2, sp = 3 + Math.random() * 14
        S.expParts.push({ x:0, y:0, vx:Math.cos(a)*sp, vy:Math.sin(a)*sp, col:cols[i%cols.length], alpha:1, r:1.5+Math.random()*3.5, trail:[], dead:false })
      }
      setTimeout(() => { if (stateRef.current) stateRef.current.sketching = true }, 1000)
    }
  }, [pct])

  useEffect(() => {
    if (!visible) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      return
    }

    // init state
    const S = {
      t:0, pistonT:0, crankAngle:0,
      shakeX:0, shakeY:0,
      flashAlpha:0, rpmVal:800,
      // fixed-size pools to avoid unbounded growth
      debris: [], smoke: [], sparks: [], drops: [], expParts: [],
      exploded: false, sketching: false, sketchProgress: 0,
    }
    stateRef.current = S

    function rr(a, b) { return a + (b - a) * Math.random() }

    const start = () => {
      const ecv = engRef.current
      const scv = sketchRef.current
      if (!ecv || !scv) return

      const W = wrapRef.current?.offsetWidth || 680
      const H = wrapRef.current?.offsetHeight || 400

      // size both canvases
      ;[ecv, scv].forEach(c => {
        c.width = W * 2; c.height = H * 2
        c.style.width = W + 'px'; c.style.height = H + 'px'
      })
      const ctx  = ecv.getContext('2d'); ctx.scale(2, 2)
      const sctx = scv.getContext('2d'); sctx.scale(2, 2)
      const EX = W / 2, EY = H / 2 - 20

      // ── SPAWN helpers ─────────────────────────────────────────────────────
      function spawnDebris(type) {
        if (S.debris.length > 60) return // hard cap
        S.debris.push({
          x: EX + rr(-30, 30), y: EY + rr(-30, 30),
          vx: rr(-5, 5), vy: rr(-6, -1),
          rot: Math.random() * Math.PI * 2, vrot: rr(-.25, .25),
          type, dead: false,
        })
      }
      function spawnSmoke(x, y) {
        if (S.smoke.length > 30) return
        S.smoke.push({ x: x+rr(-15,15), y, vx: rr(-.8,.8), vy: rr(-1,-.3), r: rr(4,10), alpha: .2, dead: false })
      }
      function spawnSpark(x, y) {
        if (S.sparks.length > 40) return
        const a = Math.random()*Math.PI*2, sp = rr(2,6)
        S.sparks.push({ x, y, vx:Math.cos(a)*sp, vy:Math.sin(a)*sp-1, life:1, dead:false })
      }
      function spawnDrop() {
        if (S.drops.length > 25) return
        S.drops.push({ x: EX+rr(-60,60), y: EY+58, vy: rr(1,2.5), r: rr(1,2.2), dead:false })
      }

      // ── DRAW ENGINE ────────────────────────────────────────────────────────
      const pistonPhases = [0, Math.PI/2, Math.PI, Math.PI*1.5]

      function drawEngine(phase) {
        ctx.save(); ctx.translate(EX + S.shakeX, EY + S.shakeY)

        // subtle glow at high phase
        if (phase >= 3) {
          const g = ctx.createRadialGradient(0,0,5,0,0,80)
          g.addColorStop(0, `rgba(255,100,0,${Math.min(.12,phase*.03)})`); g.addColorStop(1,'transparent')
          ctx.fillStyle=g; ctx.beginPath(); ctx.arc(0,0,80,0,Math.PI*2); ctx.fill()
        }

        // oil pan
        ctx.fillStyle='#111c24'; ctx.strokeStyle='#1a3040'; ctx.lineWidth=1
        ctx.beginPath(); ctx.roundRect(-65,58,130,20,3); ctx.fill(); ctx.stroke()

        // block
        ctx.fillStyle='#17242f'; ctx.strokeStyle='#255060'; ctx.lineWidth=1.5
        ctx.beginPath(); ctx.roundRect(-65,-48,130,108,4); ctx.fill(); ctx.stroke()

        // cylinder bores
        for (let i=0; i<4; i++) {
          const bx=-48+i*32
          ctx.fillStyle='#0b1520'; ctx.fillRect(bx-9,-48,18,66)
          ctx.strokeStyle='#1a3545'; ctx.lineWidth=.6; ctx.strokeRect(bx-9,-48,18,66)
        }

        // pistons + rods
        pistonPhases.forEach((ph, i) => {
          const bx=-48+i*32, py=Math.sin(S.pistonT+ph)*20
          ctx.fillStyle='#3a5878'; ctx.strokeStyle='#4a78a8'; ctx.lineWidth=.7
          ctx.fillRect(bx-8,py-12,16,22); ctx.strokeRect(bx-8,py-12,16,22)
          ctx.strokeStyle='#4a6880'; ctx.lineWidth=1.6; ctx.lineCap='round'
          ctx.beginPath(); ctx.moveTo(bx,py+10); ctx.lineTo(bx,py+36); ctx.stroke()
        })

        // crankshaft
        ctx.strokeStyle='#6a8a9a'; ctx.lineWidth=3; ctx.lineCap='round'
        ctx.beginPath(); ctx.moveTo(-62,48); ctx.lineTo(62,48); ctx.stroke()
        pistonPhases.forEach((ph, i) => {
          const bx=-48+i*32, cy=48+Math.sin(S.crankAngle+ph)*13
          ctx.fillStyle='#4a6a7a'; ctx.beginPath(); ctx.arc(bx,cy,4.5,0,Math.PI*2); ctx.fill()
          ctx.strokeStyle='#5a7a8a'; ctx.lineWidth=1.2
          ctx.beginPath(); ctx.moveTo(bx,48); ctx.lineTo(bx,cy); ctx.stroke()
        })

        // head
        ctx.fillStyle='#1c3040'; ctx.strokeStyle='#2a5060'; ctx.lineWidth=1.2
        ctx.beginPath(); ctx.roundRect(-65,-60,130,14,3); ctx.fill(); ctx.stroke()

        // valve cover (hidden phase 3+)
        if (phase < 3) {
          ctx.fillStyle='#22303e'; ctx.strokeStyle='#335060'; ctx.lineWidth=1.2
          ctx.beginPath(); ctx.roundRect(-67,-78,134,20,4); ctx.fill(); ctx.stroke()
          ;[-50,-17,17,50].forEach(bx => {
            ctx.fillStyle = phase>=2 ? '#885544' : '#3a5a6a'
            ctx.beginPath(); ctx.arc(bx,-68,3,0,Math.PI*2); ctx.fill()
          })
        }

        // timing cover
        ctx.fillStyle='#162028'; ctx.strokeStyle='#203040'; ctx.lineWidth=.8
        ctx.beginPath(); ctx.roundRect(-76,-56,13,120,3); ctx.fill(); ctx.stroke()

        // spark firing
        if (phase >= 1) {
          pistonPhases.forEach((ph, i) => {
            if (Math.sin(S.pistonT*2+ph) > .9) {
              const bx=-48+i*32
              ctx.fillStyle=`rgba(255,220,100,${.6+Math.random()*.4})`
              ctx.beginPath(); ctx.arc(bx,-60,2,0,Math.PI*2); ctx.fill()
              spawnSpark(bx+EX+S.shakeX, -60+EY+S.shakeY)
            }
          })
        }

        // crack (phase 2+)
        if (phase >= 2) {
          ctx.strokeStyle=`rgba(255,80,30,${.45+Math.sin(S.t*8)*.2})`; ctx.lineWidth=1.4
          ctx.beginPath(); ctx.moveTo(-25,-44); ctx.lineTo(-6,-15); ctx.lineTo(-16,12); ctx.lineTo(5,28); ctx.stroke()
        }

        // blowout hole (phase 3+)
        if (phase >= 3) {
          ctx.fillStyle='#040c12'
          ctx.strokeStyle=`rgba(255,60,0,${.5+Math.sin(S.t*12)*.3})`; ctx.lineWidth=1
          ctx.beginPath(); ctx.ellipse(42,18,16,11,-.28,0,Math.PI*2); ctx.fill(); ctx.stroke()
        }

        ctx.restore()
      }

      // ── DRAW SKETCH ────────────────────────────────────────────────────────
      function drawSketch() {
        sctx.clearRect(0,0,W,H)
        const cw=W*.72, ch=H*.62, cxo=W*.14, cyo=H*.17
        const lines=[
          {pts:CAR_BODY,col:'#c8ffc8',w:2.2,lbl:'BODY OUTLINE'},
          {pts:CAR_SILL,col:'#44aa44',w:1,  lbl:'SILL LINE'},
          {pts:CAR_WIN, col:'#4488cc',w:1.2,lbl:'GREENHOUSE'},
        ]
        const total=lines.length, perLine=1/total

        lines.forEach((line, li) => {
          const ls=li*perLine, le=(li+1)*perLine
          if (S.sketchProgress < ls) return
          const lp=Math.min(1,(S.sketchProgress-ls)/perLine)
          const pts=line.pts.map(([nx,ny])=>[cxo+nx*cw, cyo+ny*ch])
          const totalD=pts.reduce((s,p,i)=>i?s+Math.hypot(p[0]-pts[i-1][0],p[1]-pts[i-1][1]):0,0)
          let dist=0

          sctx.beginPath(); sctx.strokeStyle=line.col; sctx.lineWidth=line.w
          sctx.lineCap='round'; sctx.lineJoin='round'
          let started=false, tipX=pts[0][0], tipY=pts[0][1]

          for (let i=1; i<pts.length; i++) {
            const seg=Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1])
            if (!started) { sctx.moveTo(pts[0][0]+(Math.random()-.5)*.8,pts[0][1]+(Math.random()-.5)*.8); started=true }
            if (dist+seg > totalD*lp) {
              const t2=(totalD*lp-dist)/seg
              tipX=pts[i-1][0]+(pts[i][0]-pts[i-1][0])*t2
              tipY=pts[i-1][1]+(pts[i][1]-pts[i-1][1])*t2
              sctx.lineTo(tipX+(Math.random()-.5)*.8, tipY+(Math.random()-.5)*.8)
              break
            }
            sctx.lineTo(pts[i][0]+(Math.random()-.5)*.6, pts[i][1]+(Math.random()-.5)*.6)
            dist+=seg
          }
          sctx.stroke()

          // pencil tip
          if (lp < 1) {
            sctx.beginPath(); sctx.arc(tipX,tipY,4,0,Math.PI*2)
            sctx.fillStyle=`rgba(255,255,255,.08)`; sctx.fill()
            sctx.beginPath(); sctx.arc(tipX,tipY,1.5,0,Math.PI*2)
            sctx.fillStyle='rgba(255,255,255,.8)'; sctx.fill()
          }

          // glass hatch
          if (li===2 && lp>.98) {
            const gpts=CAR_WIN.map(([nx,ny])=>[cxo+nx*cw,cyo+ny*ch])
            sctx.save(); sctx.beginPath()
            gpts.forEach(([x,y],i)=>i?sctx.lineTo(x,y):sctx.moveTo(x,y))
            sctx.closePath(); sctx.clip()
            sctx.strokeStyle='rgba(68,136,220,.09)'; sctx.lineWidth=1
            for(let x=-200;x<W+200;x+=7){sctx.beginPath();sctx.moveTo(x,0);sctx.lineTo(x-100,H);sctx.stroke()}
            sctx.restore()
          }

          // label
          if (S.sketchProgress > ls+perLine*.9) {
            const mid=pts[Math.floor(pts.length/2)]
            sctx.globalAlpha=Math.min(1,(S.sketchProgress-(ls+perLine*.9))*14)
            sctx.fillStyle=line.col; sctx.font='bold 8px monospace'
            sctx.textAlign='left'; sctx.fillText(line.lbl,mid[0]+8,mid[1]-8)
            sctx.globalAlpha=1
          }
        })

        // complete text
        if (S.sketchProgress > .96) {
          const f=Math.min(1,(S.sketchProgress-.96)/.04)
          sctx.globalAlpha=f
          sctx.fillStyle='#22cc55'; sctx.font='bold 18px monospace'
          sctx.textAlign='center'; sctx.fillText('ANALYSIS COMPLETE',W/2,H*.88)
          sctx.fillStyle='#1a6a1a'; sctx.font='8px monospace'
          sctx.fillText('OUTLINE READY',W/2,H*.88+16)
          sctx.globalAlpha=1
        }
      }

      // ── RPM gauge ──────────────────────────────────────────────────────────
      function drawRPM() {
        const cx=W-56, cy=40, r=24
        ctx.strokeStyle='#0f1f0f'; ctx.lineWidth=3.5
        ctx.beginPath(); ctx.arc(cx,cy,r,Math.PI*.75,Math.PI*2.25); ctx.stroke()
        const ratio=Math.min(S.rpmVal/9000,1)
        const col=S.rpmVal>7000?'rgba(255,80,0,.9)':S.rpmVal>5000?'rgba(255,160,0,.9)':'rgba(34,180,60,.9)'
        ctx.strokeStyle=col; ctx.lineWidth=2.2
        ctx.beginPath(); ctx.arc(cx,cy,r,Math.PI*.75,Math.PI*.75+Math.PI*1.5*ratio); ctx.stroke()
        const na=Math.PI*.75+Math.PI*1.5*ratio
        ctx.strokeStyle=col; ctx.lineWidth=1.4; ctx.lineCap='round'
        ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(cx+Math.cos(na)*r*.7,cy+Math.sin(na)*r*.7); ctx.stroke()
        ctx.fillStyle='#111'; ctx.beginPath(); ctx.arc(cx,cy,2.5,0,Math.PI*2); ctx.fill()
        ctx.fillStyle=col; ctx.font='bold 5px monospace'; ctx.textAlign='center'
        ctx.fillText('RPM',cx,cy+r+9)
      }

      // ── MAIN LOOP ──────────────────────────────────────────────────────────
      function loop() {
        rafRef.current = requestAnimationFrame(loop)
        const currentPct = pctRef.current  // always fresh
        const S2 = stateRef.current
        if (!S2) return

        S2.t += 0.016

        const phase = currentPct<8?0:currentPct<18?1:currentPct<46?2:currentPct<84?3:currentPct<100?4:5
        const spd = .055 + phase * .025
        if (phase < 5) { S2.pistonT += spd; S2.crankAngle += spd }

        const targetRpm = [800,3500,6000,9000,9000,0][Math.min(phase,5)]
        S2.rpmVal += (targetRpm - S2.rpmVal) * .04

        // shake
        const amp = [0,1.5,5,12,16,0][Math.min(phase,5)]
        if (phase > 0 && phase < 5) {
          S2.shakeX = Math.sin(S2.t*(3+phase*2)*Math.PI*2)*(amp+Math.sin(S2.t*7)*amp*.35)
          S2.shakeY = Math.cos(S2.t*(4+phase)*Math.PI*2)*amp*.3
        } else { S2.shakeX=0; S2.shakeY=0 }

        // spawn — rate-limited
        if (!S2.exploded && phase >= 1) {
          if (Math.random() < .04+phase*.025) spawnDebris('bolt')
          if (phase>=2 && Math.random()<.018) spawnDebris('valve')
          if (phase>=3 && Math.random()<.02)  spawnDebris('gasket')
          if (phase>=3 && Math.random()<.01)  spawnDebris('piston')
          if (Math.random()<.012+phase*.008) spawnSmoke(EX,EY-70)
          if (Math.random()<.04+phase*.02) spawnDrop()
        }

        // ── clear
        ctx.fillStyle='#080808'; ctx.fillRect(0,0,W,H)

        // grid
        ctx.strokeStyle='rgba(20,45,20,.1)'; ctx.lineWidth=.4
        for(let x=0;x<W;x+=40){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke()}
        for(let y=0;y<H;y+=40){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke()}

        // drops — update+draw in one pass
        for (let i=S2.drops.length-1;i>=0;i--) {
          const d=S2.drops[i]; d.vy+=.1; d.y+=d.vy
          if (d.y>H+10) { S2.drops.splice(i,1); continue }
          ctx.beginPath();ctx.arc(d.x,d.y,d.r,0,Math.PI*2);ctx.fillStyle='rgba(12,6,0,.6)';ctx.fill()
        }

        // smoke
        for (let i=S2.smoke.length-1;i>=0;i--) {
          const s=S2.smoke[i]; s.x+=s.vx; s.y+=s.vy; s.r+=.3; s.alpha-=.004
          if (s.alpha<=0) { S2.smoke.splice(i,1); continue }
          ctx.beginPath();ctx.arc(s.x,s.y,s.r,0,Math.PI*2);ctx.fillStyle=`rgba(70,70,70,${s.alpha})`;ctx.fill()
        }

        // engine
        if (!S2.exploded) drawEngine(phase)

        // sparks
        for (let i=S2.sparks.length-1;i>=0;i--) {
          const sp=S2.sparks[i]; sp.vy+=.2; sp.x+=sp.vx; sp.y+=sp.vy; sp.life-=.055
          if (sp.life<=0) { S2.sparks.splice(i,1); continue }
          ctx.beginPath();ctx.moveTo(sp.x,sp.y);ctx.lineTo(sp.x-sp.vx*2,sp.y-sp.vy*2)
          ctx.strokeStyle=`rgba(255,180,0,${sp.life})`;ctx.lineWidth=1.4;ctx.lineCap='round';ctx.stroke()
        }

        // debris
        for (let i=S2.debris.length-1;i>=0;i--) {
          const d=S2.debris[i]; d.vy+=.2; d.x+=d.vx; d.y+=d.vy; d.rot+=d.vrot
          if (d.y>H+50) { S2.debris.splice(i,1); continue }
          ctx.save(); ctx.translate(d.x,d.y); ctx.rotate(d.rot); ctx.globalAlpha=.88
          switch(d.type) {
            case'bolt': ctx.fillStyle='#8a9aaa';ctx.fillRect(-3,-6,6,12);ctx.fillStyle='#6a8a9a';ctx.fillRect(-4,-8,8,4);break
            case'valve':ctx.fillStyle='#7a8a9a';ctx.fillRect(-2,-10,4,20);ctx.beginPath();ctx.arc(0,10,4,0,Math.PI*2);ctx.fillStyle='#5a7a8a';ctx.fill();break
            case'gasket':ctx.strokeStyle='#cc5522';ctx.lineWidth=1.8;ctx.strokeRect(-12,-4,24,8);break
            case'piston':ctx.fillStyle='#445577';ctx.fillRect(-11,-10,22,20);break
            case'frag':
              ctx.fillStyle=`hsl(${20+Math.random()*20},35%,${25+Math.random()*15}%)`
              ctx.beginPath();for(let j=0;j<4;j++){const a=j/4*Math.PI*2,r=3+Math.random()*8;j?ctx.lineTo(Math.cos(a)*r,Math.sin(a)*r):ctx.moveTo(Math.cos(a)*r,Math.sin(a)*r)}
              ctx.closePath();ctx.fill();break
          }
          ctx.restore()
        }

        // explosion particles
        for (let i=S2.expParts.length-1;i>=0;i--) {
          const p=S2.expParts[i]
          p.trail.push({x:p.x+EX,y:p.y+EY})
          if(p.trail.length>8)p.trail.shift()
          p.vy+=.16; p.x+=p.vx; p.y+=p.vy; p.vx*=.97; p.alpha-=.018
          if(p.alpha<=0||p.y+EY>H+20){S2.expParts.splice(i,1);continue}
          if(p.trail.length>1){
            ctx.beginPath();ctx.moveTo(p.trail[0].x,p.trail[0].y)
            p.trail.forEach(pt=>ctx.lineTo(pt.x,pt.y))
            ctx.strokeStyle=`rgba(${p.col},${p.alpha*.4})`;ctx.lineWidth=p.r*.5;ctx.lineCap='round';ctx.stroke()
          }
          ctx.beginPath();ctx.arc(p.x+EX,p.y+EY,p.r,0,Math.PI*2)
          ctx.fillStyle=`rgba(${p.col},${p.alpha})`;ctx.fill()
        }

        // flash
        if(S2.flashAlpha>0){
          ctx.fillStyle=`rgba(255,180,60,${S2.flashAlpha})`;ctx.fillRect(0,0,W,H)
          S2.flashAlpha=Math.max(0,S2.flashAlpha-.04)
        }

        drawRPM()

        // status text
        if(phase>=2&&phase<5&&Math.sin(S2.t*10)>.2){
          ctx.fillStyle='rgba(255,40,0,.7)';ctx.font='bold 9px monospace';ctx.textAlign='center'
          ctx.fillText('⚠  CRITICAL LOAD',W/2,H-90)
        }
        if(S2.exploded&&S2.flashAlpha<.3&&!S2.sketching&&Math.sin(S2.t*6)>0){
          ctx.fillStyle='rgba(34,200,80,.75)';ctx.font='bold 9px monospace';ctx.textAlign='center'
          ctx.fillText('✓  ALL STAGES COMPLETE — RENDERING OUTLINE',W/2,H-90)
        }

        // sketch
        if(S2.sketching){
          S2.sketchProgress=Math.min(1,S2.sketchProgress+.004)
          drawSketch()
          scv.style.opacity='1'
        }
      }

      loop()
    }

    // Wait for real dimensions
    const ro = new ResizeObserver(entries => {
      if (entries[0].contentRect.width > 0) { ro.disconnect(); start() }
    })
    if (wrapRef.current) ro.observe(wrapRef.current)
    if (wrapRef.current?.offsetWidth > 0) { ro.disconnect(); start() }

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      ro.disconnect()
      stateRef.current = null
    }
  }, [visible]) // eslint-disable-line

  if (!visible) return null

  const stagePcts = stages.map(s => ({ ...s, fill: getStagePct(s, pct) }))

  return (
    <div ref={wrapRef} style={{ position:'absolute',inset:0,zIndex:20,background:'#080808',display:'flex',flexDirection:'column',width:'100%',height:'100%' }}>

      {/* Engine + sketch canvas area */}
      <div style={{ flex:1,position:'relative',overflow:'hidden',minHeight:0 }}>
        <canvas ref={engRef}    style={{ position:'absolute',top:0,left:0,width:'100%',height:'100%',display:'block' }}/>
        <canvas ref={sketchRef} style={{ position:'absolute',top:0,left:0,width:'100%',height:'100%',display:'block',opacity:0,transition:'opacity 0.8s' }}/>

        {/* msg */}
        <div style={{ position:'absolute',bottom:6,left:0,right:0,textAlign:'center',pointerEvents:'none' }}>
          <div style={{ fontSize:11,fontFamily:'monospace',color:'#1a5a1a',letterSpacing:'.07em' }}>{msg}</div>
          {sub && <div style={{ fontSize:9,color:'#0f3a0f',letterSpacing:'.04em',fontFamily:'sans-serif',marginTop:2 }}>{sub}</div>}
        </div>
      </div>

      {/* Stage bars */}
      <div style={{ background:'rgba(0,0,0,.97)',borderTop:'1px solid #0f1f0f',padding:'8px 14px 10px',flexShrink:0 }}>
        {stagePcts.map(s => {
          const col = STAGE_COL[s.id] ?? '#22cc55'
          const active = pct >= s.pct[0] && pct < s.pct[1]
          const done   = pct >= s.pct[1]
          return (
            <div key={s.id} style={{ display:'flex',alignItems:'center',gap:8,marginBottom:4 }}>
              <span style={{ fontSize:8,fontFamily:'monospace',letterSpacing:'.1em',width:66,textAlign:'right',textTransform:'uppercase',color:done||active?col:'#1a2a1a',transition:'color .3s' }}>
                {s.label}
              </span>
              <div style={{ flex:1,height:3,background:'#0f1a0f',borderRadius:2,position:'relative',overflow:'visible' }}>
                <div style={{ height:'100%',width:`${s.fill}%`,background:col,borderRadius:2,boxShadow:active?`0 0 6px ${col}88`:'none',transition:'width .35s ease' }}>
                  {active && <div style={{ position:'absolute',right:-3,top:-4,width:7,height:11,background:col,borderRadius:2,boxShadow:`0 0 5px ${col}` }}/>}
                </div>
              </div>
              <span style={{ fontSize:9,fontFamily:'monospace',width:26,textAlign:'right',color:done||active?col:'#1a2a1a' }}>
                {done?'✓':active?`${s.fill}%`:''}
              </span>
            </div>
          )
        })}

        {/* global bar */}
        <div style={{ display:'flex',alignItems:'center',gap:8,marginTop:6,paddingTop:6,borderTop:'1px solid #0f1a0f' }}>
          <div style={{ flex:1,height:2,background:'#0f1a0f',borderRadius:1,overflow:'hidden' }}>
            <div style={{ height:'100%',width:`${pct}%`,background:'#22cc55',borderRadius:1,transition:'width .4s ease' }}/>
          </div>
          <span style={{ fontSize:14,fontFamily:'monospace',fontWeight:'bold',color:'#22cc55',letterSpacing:'.05em',minWidth:40,textAlign:'right' }}>
            {Math.round(pct)}<span style={{ fontSize:10,color:'#1a5a1a' }}>%</span>
          </span>
        </div>
      </div>
    </div>
  )
}
