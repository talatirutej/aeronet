// PipelineOverlay.jsx — AeroNet Engine Destruction Loading Animation
// Copyright (c) 2026 Rutej Talati. All rights reserved.
//
// Props (unchanged API — drop-in replacement):
//   visible  — boolean, show/hide
//   pct      — 0-100, drives engine phase + stage bars
//   msg      — current stage message
//   sub      — subtitle
//   stages   — [{id,label,icon,pct:[start,end]}, ...]

import { useEffect, useRef } from 'react'

// Stage colour map
const STAGE_COL = {
  prep:'#22cc55', rmbg:'#22cc55', yolo:'#0a84ff',
  sam3:'#ff9f0a', contour:'#ff9f0a', enh:'#ff453a',
  keys:'#bf5af2', cfd:'#bf5af2', done:'#30d158',
}

function getStagePct(stage, pct) {
  if (!stage?.pct) return 0
  const [s0, s1] = stage.pct
  if (pct <= s0) return 0
  if (pct >= s1) return 100
  return Math.round((pct - s0) / (s1 - s0) * 100)
}

// Car outline points (normalised saloon silhouette)
const CAR_BODY = [
  [.04,.72],[.06,.58],[.10,.48],[.16,.38],[.24,.28],[.32,.20],[.42,.16],
  [.58,.16],[.68,.20],[.76,.28],[.82,.36],[.86,.44],[.88,.52],[.89,.60],
  [.89,.72],[.82,.72],[.76,.72],[.68,.72],[.58,.72],[.48,.72],[.38,.72],
  [.28,.72],[.18,.72],[.10,.72],[.04,.72],
]
const CAR_SILL = [
  [.10,.72],[.12,.66],[.16,.64],[.28,.62],[.38,.62],[.48,.62],
  [.58,.62],[.68,.64],[.76,.66],[.82,.72],
]
const CAR_WIN = [
  [.24,.28],[.28,.22],[.36,.17],[.48,.16],[.60,.16],[.68,.20],
  [.72,.26],[.72,.44],[.60,.46],[.48,.46],[.36,.46],[.28,.46],[.24,.28],
]
const CAR_LINES = [
  { pts: CAR_BODY, col: '#c8ffc8', w: 2.2, lbl: 'BODY OUTLINE' },
  { pts: CAR_SILL, col: '#44aa44', w: 1.0, lbl: 'SILL LINE'    },
  { pts: CAR_WIN,  col: '#4488cc', w: 1.2, lbl: 'GREENHOUSE'   },
]

export default function PipelineOverlay({ visible, pct = 0, msg = '', sub = '', stages = [] }) {
  const wrapRef    = useRef(null)
  const engRef     = useRef(null)
  const sketchRef  = useRef(null)
  const rafRef     = useRef(null)
  const timerRef   = useRef([])
  const pctRef     = useRef(pct)      // Fix: keep pct current inside RAF loop closure
  const visibleRef = useRef(visible)  // Fix: stabilise visible — only react to true transitions
  const stRef     = useRef({
    t:0, pistonT:0, crankAngle:0, shakeX:0, shakeY:0,
    flashAlpha:0, rpmVal:800,
    debris:[], smoke:[], sparks:[], drops:[], expParts:[],
    exploded:false, sketchProgress:0, sketching:false,
    prevPct:-1,
  })

  // Run ONLY on true visible transitions (false→true / true→false)
  // Using visibleRef prevents the effect re-firing on every parent setSlot re-render
  useEffect(() => {
    const prev = visibleRef.current
    visibleRef.current = visible
    if (visible === prev) return   // same value — do nothing (prevents loop restart storms)

    if (!visible) { stopLoop(); return }

    const S = stRef.current
    S.t=0; S.pistonT=0; S.crankAngle=0; S.shakeX=0; S.shakeY=0
    S.flashAlpha=0; S.rpmVal=800; S.exploded=false
    S.sketchProgress=0; S.sketching=false; S.prevPct=-1
    S.debris=[]; S.smoke=[]; S.sparks=[]; S.drops=[]; S.expParts=[]

    // Wait for layout then start — ResizeObserver fires once element has real size
    const ro = new ResizeObserver((entries) => {
      if (entries[0].contentRect.width > 0) {
        ro.disconnect()
        stopLoop()
        startLoop()
      }
    })
    if (wrapRef.current) ro.observe(wrapRef.current)
    // Fallback if already sized
    if (wrapRef.current?.offsetWidth > 0) { ro.disconnect(); startLoop() }

    return () => { ro.disconnect(); stopLoop() }
  }, [visible]) // eslint-disable-line

  // Keep pctRef in sync so the RAF loop always reads the latest value
  useEffect(() => { pctRef.current = pct }, [pct])

  // React to pct changes — trigger sketch at 100
  useEffect(() => {
    if (!visibleRef.current) return
    const S = stRef.current
    if (pct >= 100 && S.debris && !S.sketching && !S.exploded) {
      triggerExplosion()
      setTimeout(() => { S.sketching = true }, 900)
    }
  }, [pct]) // eslint-disable-line

  function stopLoop() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    timerRef.current.forEach(t => clearTimeout(t))
    timerRef.current = []
  }

  function sched(fn, ms) {
    const t = setTimeout(fn, ms); timerRef.current.push(t)
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function rr(a, b) { return a + (b - a) * Math.random() }

  function triggerExplosion() {
    const S = stRef.current; S.exploded = true; S.flashAlpha = 1
    const cols = ['255,120,0','255,210,40','255,255,180','255,40,0','210,210,210']
    for (let i = 0; i < 120; i++) {
      const a = Math.random() * Math.PI * 2, sp = rr(3, 18)
      S.expParts.push({
        x: 0, y: 0, vx: Math.cos(a)*sp, vy: Math.sin(a)*sp,
        col: cols[Math.floor(Math.random()*cols.length)],
        alpha: 1, r: rr(1.5, 5), trail: [], dead: false,
      })
    }
    for (let i = 0; i < 30; i++) {
      S.debris.push({
        x: 0+rr(-20,20), y: 0+rr(-20,20),
        vx: rr(-10,10), vy: rr(-12,-2),
        rot: Math.random()*Math.PI*2, vrot: rr(-.3,.3),
        type: 'frag', dead: false,
      })
    }
  }

  // ── Canvas loop ────────────────────────────────────────────────────────────
  function startLoop() {
    const ecv = engRef.current
    const scv = sketchRef.current
    if (!ecv || !scv) return

    const W = wrapRef.current?.offsetWidth  || ecv.offsetWidth  || 680
    const H = wrapRef.current?.offsetHeight || ecv.offsetHeight || 380
    ;[ecv, scv].forEach(c => {
      c.width = W * 2; c.height = H * 2
      c.style.width = W + 'px'; c.style.height = H + 'px'
    })
    const ctx  = ecv.getContext('2d');  ctx.scale(2, 2)
    const sctx = scv.getContext('2d');  sctx.scale(2, 2)

    const EX = W / 2, EY = H / 2 - 10

    function loop() {
      rafRef.current = requestAnimationFrame(loop)
      const S = stRef.current
      S.t += 0.016

      // Derive engine phase from pctRef.current (fixes stale closure bug)
      const livePct = pctRef.current ?? 0
      const phase =
        livePct < 8  ? 0 :
        livePct < 18 ? 1 :
        livePct < 46 ? 2 :
        livePct < 84 ? 3 :
        livePct < 100 ? 4 : 5

      const spd = 0.055 + phase * 0.028
      S.pistonT    += phase < 5 ? spd : 0
      S.crankAngle += phase < 5 ? spd : 0

      // RPM
      const targetRpm = [800,3500,6000,9000,9000,0][Math.min(phase,5)]
      S.rpmVal += (targetRpm - S.rpmVal) * 0.04

      // Shake amplitude
      const amp = [0, 1.5, 5, 12, 18, 0][Math.min(phase, 5)]
      if (phase > 0 && phase < 5) {
        S.shakeX = Math.sin(S.t * (3 + phase*2) * Math.PI * 2) * (amp + Math.sin(S.t*7)*amp*.4)
        S.shakeY = Math.cos(S.t * (4 + phase*2) * Math.PI * 2) * (amp * .35)
      } else { S.shakeX = 0; S.shakeY = 0 }

      // Auto-spawn debris based on phase
      if (phase >= 1 && phase < 5) {
        if (Math.random() < 0.04 + phase * 0.03) spawnDebris(EX, EY, 'bolt')
        if (phase >= 2 && Math.random() < 0.02) spawnDebris(EX, EY, 'valve')
        if (phase >= 3 && Math.random() < 0.025) spawnDebris(EX, EY, 'gasket')
        if (phase >= 3 && Math.random() < 0.012) spawnDebris(EX, EY, 'piston')
        if (phase >= 4 && Math.random() < 0.015) spawnDebris(EX, EY, 'frag')
        if (Math.random() < 0.015 + phase * 0.01)
          S.smoke.push({ x: EX+rr(-25,25), y: EY-75, vx: rr(-1,1), vy: rr(-1.2,-.3), r: rr(4,12), alpha: .22, dead: false })
      }
      if (phase >= 1 && phase < 5 && Math.random() < .05 + phase * .025)
        S.drops.push({ x: EX+rr(-70,70), y: EY+62, vy: rr(1,3), r: rr(1,2.5), dead: false })

      // ── Draw ──────────────────────────────────────────────────────────────
      ctx.fillStyle = '#080808'; ctx.fillRect(0, 0, W, H)

      // Grid
      ctx.strokeStyle = 'rgba(20,45,20,.1)'; ctx.lineWidth = .4
      for (let x = 0; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke() }
      for (let y = 0; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke() }

      // Drops
      S.drops?.forEach(d => {
        d.vy += .1; d.y += d.vy
        if (d.y > H + 10) d.dead = true
        else { ctx.beginPath(); ctx.arc(d.x,d.y,d.r,0,Math.PI*2); ctx.fillStyle='rgba(12,6,0,.65)'; ctx.fill() }
      })
      if (S.drops) S.drops = S.drops.filter(d => !d.dead)

      // Smoke
      S.smoke?.forEach(s => {
        s.x += s.vx; s.y += s.vy; s.r += .35; s.alpha -= .003
        if (s.alpha <= 0) s.dead = true
        else { ctx.beginPath(); ctx.arc(s.x,s.y,s.r,0,Math.PI*2); ctx.fillStyle=`rgba(70,70,70,${s.alpha})`; ctx.fill() }
      })
      if (S.smoke) S.smoke = S.smoke.filter(s => !s.dead)

      // Engine body
      if (!S.exploded) drawEngine(ctx, EX + S.shakeX, EY + S.shakeY, S, phase, W, H)

      // Sparks
      S.sparks?.forEach(s => {
        s.vy += .22; s.x += s.vx; s.y += s.vy; s.life -= .055
        if (s.life <= 0) s.dead = true
        else {
          ctx.beginPath(); ctx.moveTo(s.x,s.y); ctx.lineTo(s.x-s.vx*2.5,s.y-s.vy*2.5)
          ctx.strokeStyle=`rgba(255,${160+Math.floor(Math.random()*95)},0,${s.life})`
          ctx.lineWidth=1.5; ctx.lineCap='round'; ctx.stroke()
        }
      })
      if (S.sparks) S.sparks = S.sparks.filter(s => !s.dead)

      // Debris
      S.debris?.forEach(d => {
        d.vy += .22; d.x += d.vx; d.y += d.vy; d.rot += d.vrot
        if (d.y > H + 60) d.dead = true; else drawDebris(ctx, d, EX, EY)
      })
      if (S.debris) S.debris = S.debris.filter(d => !d.dead)

      // Explosion particles
      S.expParts?.forEach(p => {
        p.trail.push({x: p.x + EX, y: p.y + EY})
        if (p.trail.length > 10) p.trail.shift()
        p.vy += .18; p.x += p.vx; p.y += p.vy; p.vx *= .97
        p.alpha -= .016
        if (p.alpha <= 0) { p.dead = true; return }
        if (p.trail.length > 1) {
          ctx.beginPath()
          ctx.moveTo(p.trail[0].x, p.trail[0].y)
          p.trail.forEach(pt => ctx.lineTo(pt.x, pt.y))
          ctx.strokeStyle = `rgba(${p.col},${p.alpha*.4})`
          ctx.lineWidth = p.r * .6; ctx.lineCap = 'round'; ctx.stroke()
        }
        ctx.beginPath(); ctx.arc(p.x+EX, p.y+EY, p.r, 0, Math.PI*2)
        ctx.fillStyle = `rgba(${p.col},${p.alpha})`; ctx.fill()
      })
      if (S.expParts) S.expParts = S.expParts.filter(p => !p.dead)

      // Flash
      if (S.flashAlpha > 0) {
        ctx.fillStyle = `rgba(255,180,60,${S.flashAlpha})`
        ctx.fillRect(0, 0, W, H)
        S.flashAlpha = Math.max(0, S.flashAlpha - .038)
      }

      // RPM gauge
      drawRPM(ctx, W - 60, 46, S.rpmVal)

      // Phase warning
      if (phase >= 2 && phase < 5 && Math.sin(S.t * 10) > .2) {
        ctx.fillStyle = 'rgba(255,40,0,.75)'; ctx.font = 'bold 9px monospace'
        ctx.textAlign = 'center'
        ctx.fillText('⚠  CRITICAL LOAD — PIPELINE ACTIVE', W/2, H - 96)
      }
      if (S.exploded && S.flashAlpha < .3 && !S.sketching) {
        if (Math.sin(S.t * 6) > 0) {
          ctx.fillStyle = 'rgba(34,200,80,.8)'; ctx.font = 'bold 10px monospace'
          ctx.textAlign = 'center'
          ctx.fillText('✓  ALL STAGES COMPLETE — RENDERING OUTLINE', W/2, H - 96)
        }
      }

      // ── Sketch overlay ──────────────────────────────────────────────────
      if (S.sketching) {
        S.sketchProgress = Math.min(1, S.sketchProgress + .004)
        drawSketch(sctx, S.sketchProgress, W, H)
        scv.style.opacity = '1'
      } else {
        scv.style.opacity = '0'
        sctx.clearRect(0, 0, W * 2, H * 2)
      }
    }
    loop()
  }

  function spawnDebris(EX, EY, type) {
    const S = stRef.current
    S.debris.push({
      x: rr(-60,60), y: rr(-40,40),
      vx: rr(-5,5) * (1 + stRef.current.debris.length*.01),
      vy: rr(-7,-1), rot: Math.random()*Math.PI*2,
      vrot: rr(-.28,.28), type, dead: false,
    })
  }

  function drawDebris(ctx, d, EX, EY) {
    ctx.save(); ctx.translate(d.x + EX, d.y + EY); ctx.rotate(d.rot); ctx.globalAlpha = .88
    switch (d.type) {
      case 'bolt':
        ctx.fillStyle='#8a9aaa'; ctx.fillRect(-3,-7,6,14)
        ctx.fillStyle='#6a8a9a'; ctx.fillRect(-5,-9,10,5); break
      case 'valve':
        ctx.fillStyle='#7a8a9a'; ctx.fillRect(-2,-12,4,22)
        ctx.beginPath(); ctx.arc(0,12,5,0,Math.PI*2); ctx.fillStyle='#5a7a8a'; ctx.fill(); break
      case 'gasket':
        ctx.strokeStyle='#cc5522'; ctx.lineWidth=2; ctx.strokeRect(-14,-5,28,10)
        ctx.strokeStyle='#993311'; ctx.lineWidth=1; ctx.strokeRect(-9,-3,18,6); break
      case 'piston':
        ctx.fillStyle='#445577'; ctx.fillRect(-13,-11,26,22)
        ctx.strokeStyle='#6688aa'; ctx.lineWidth=1; ctx.strokeRect(-13,-11,26,22); break
      case 'frag':
        ctx.fillStyle=`hsl(${20+Math.random()*20},35%,${25+Math.random()*15}%)`
        ctx.beginPath()
        for (let i=0; i<4; i++) { const a=i/4*Math.PI*2,r=3+Math.random()*9; i?ctx.lineTo(Math.cos(a)*r,Math.sin(a)*r):ctx.moveTo(Math.cos(a)*r,Math.sin(a)*r) }
        ctx.closePath(); ctx.fill(); break
    }
    ctx.restore()
  }

  function drawEngine(ctx, ox, oy, S, phase, W, H) {
    ctx.save(); ctx.translate(ox, oy)
    const ph = [0,Math.PI/2,Math.PI,Math.PI*1.5]

    // Glow
    if (phase >= 3) {
      const g = ctx.createRadialGradient(0,0,10,0,0,88)
      g.addColorStop(0, `rgba(255,100,0,${Math.min(.18, phase*.04)})`); g.addColorStop(1,'transparent')
      ctx.fillStyle=g; ctx.beginPath(); ctx.arc(0,0,88,0,Math.PI*2); ctx.fill()
    }

    // Oil pan
    ctx.fillStyle='#111c24'; ctx.strokeStyle='#1a3040'; ctx.lineWidth=1
    ctx.beginPath(); ctx.roundRect(-70,60,140,22,3); ctx.fill(); ctx.stroke()
    ctx.fillStyle='#223344'; ctx.beginPath(); ctx.arc(0,71,4,0,Math.PI*2); ctx.fill()

    // Block
    ctx.fillStyle='#17242f'; ctx.strokeStyle='#255060'; ctx.lineWidth=1.5
    ctx.beginPath(); ctx.roundRect(-70,-50,140,112,4); ctx.fill(); ctx.stroke()

    // Bores
    for (let i=0; i<4; i++) {
      const bx=-52+i*35
      ctx.fillStyle='#0b1520'; ctx.fillRect(bx-10,-50,20,70)
      ctx.strokeStyle='#1a3545'; ctx.lineWidth=.7; ctx.strokeRect(bx-10,-50,20,70)
    }

    // Pistons
    ph.forEach((p, i) => {
      const bx=-52+i*35, py=Math.sin(S.pistonT+p)*22
      ctx.fillStyle='#3a5878'; ctx.strokeStyle='#4a78a8'; ctx.lineWidth=.8
      ctx.fillRect(bx-9,py-13,18,24); ctx.strokeRect(bx-9,py-13,18,24)
      ctx.strokeStyle='#2a4868'; ctx.lineWidth=.4
      [-5,0,5].forEach(dy=>{ctx.beginPath();ctx.moveTo(bx-9,py+dy);ctx.lineTo(bx+9,py+dy);ctx.stroke()})
      ctx.strokeStyle='#4a6880'; ctx.lineWidth=1.8; ctx.lineCap='round'
      ctx.beginPath(); ctx.moveTo(bx,py+11); ctx.lineTo(bx,py+40); ctx.stroke()
    })

    // Crank
    ctx.strokeStyle='#6a8a9a'; ctx.lineWidth=3; ctx.lineCap='round'
    ctx.beginPath(); ctx.moveTo(-68,50); ctx.lineTo(68,50); ctx.stroke()
    ph.forEach((p, i) => {
      const bx=-52+i*35, cy=50+Math.sin(S.crankAngle+p)*14
      ctx.fillStyle='#4a6a7a'; ctx.beginPath(); ctx.arc(bx,cy,5,0,Math.PI*2); ctx.fill()
      ctx.strokeStyle='#5a7a8a'; ctx.lineWidth=1.2
      ctx.beginPath(); ctx.moveTo(bx,50); ctx.lineTo(bx,cy); ctx.stroke()
    })

    // Head
    ctx.fillStyle='#1c3040'; ctx.strokeStyle='#2a5060'; ctx.lineWidth=1.2
    ctx.beginPath(); ctx.roundRect(-70,-62,140,14,3); ctx.fill(); ctx.stroke()

    // Valve cover
    if (phase < 3) {
      ctx.fillStyle='#22303e'; ctx.strokeStyle='#335060'; ctx.lineWidth=1.2
      ctx.beginPath(); ctx.roundRect(-72,-80,144,20,4); ctx.fill(); ctx.stroke()
      ;[-55,-18,18,55].forEach(bx=>{
        ctx.fillStyle = phase>=2 ? '#885544' : '#3a5a6a'
        ctx.beginPath(); ctx.arc(bx,-70,3,0,Math.PI*2); ctx.fill()
      })
    }

    // Timing cover
    ctx.fillStyle='#162028'; ctx.strokeStyle='#203040'; ctx.lineWidth=1
    ctx.beginPath(); ctx.roundRect(-80,-58,13,126,3); ctx.fill(); ctx.stroke()

    // Spark firing
    if (phase >= 1) {
      ph.forEach((p, i) => {
        if (Math.sin(S.pistonT*2+p) > .88) {
          const bx=-52+i*35
          ctx.fillStyle=`rgba(255,220,100,${Math.random()*.8+.2})`
          ctx.beginPath(); ctx.arc(bx,-62,2.5,0,Math.PI*2); ctx.fill()
          for(let j=0;j<2;j++) S.sparks.push({x:bx+ox,y:-62+oy,vx:rr(-4,4),vy:rr(-5,-1),life:1,dead:false})
        }
      })
    }

    // Crack
    if (phase >= 2) {
      ctx.strokeStyle=`rgba(255,80,30,${.5+Math.sin(S.t*8)*.2})`; ctx.lineWidth=1.5
      ctx.beginPath(); ctx.moveTo(-28,-46); ctx.lineTo(-8,-16); ctx.lineTo(-18,14); ctx.lineTo(4,30); ctx.stroke()
    }

    // Hole
    if (phase >= 3) {
      ctx.fillStyle='#040c12'; ctx.strokeStyle=`rgba(255,60,0,${.6+Math.sin(S.t*12)*.3})`; ctx.lineWidth=1
      ctx.beginPath(); ctx.ellipse(46,20,18,12,-.28,0,Math.PI*2); ctx.fill(); ctx.stroke()
      ctx.strokeStyle='rgba(12,6,0,.55)'; ctx.lineWidth=1
      for(let j=0;j<7;j++){const a=-.28+j*.18,l=12+j*5;ctx.beginPath();ctx.moveTo(46+Math.cos(a)*18,20+Math.sin(a)*12);ctx.lineTo(46+Math.cos(a)*(18+l),20+Math.sin(a)*(12+l*.5));ctx.stroke()}
    }

    ctx.restore()
  }

  function drawRPM(ctx, cx, cy, val) {
    const r=26
    ctx.strokeStyle='#0f1f0f'; ctx.lineWidth=4
    ctx.beginPath(); ctx.arc(cx,cy,r,Math.PI*.75,Math.PI*2.25); ctx.stroke()
    const ratio=Math.min(val/9000,1)
    const col=val>7000?`rgba(255,${Math.max(0,200-(val-7000)/8)},0,.9)`:val>5500?'rgba(255,150,0,.9)':'rgba(34,180,60,.9)'
    ctx.strokeStyle=col; ctx.lineWidth=2.5
    ctx.shadowColor=col; ctx.shadowBlur=6
    ctx.beginPath(); ctx.arc(cx,cy,r,Math.PI*.75,Math.PI*.75+Math.PI*1.5*ratio); ctx.stroke()
    ctx.shadowBlur=0
    const na=Math.PI*.75+Math.PI*1.5*ratio
    ctx.strokeStyle=col; ctx.lineWidth=1.5; ctx.lineCap='round'
    ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(cx+Math.cos(na)*r*.72,cy+Math.sin(na)*r*.72); ctx.stroke()
    ctx.fillStyle='#111'; ctx.beginPath(); ctx.arc(cx,cy,3,0,Math.PI*2); ctx.fill()
    ctx.fillStyle=val>7000?'#ff2200':val>5500?'#ff9900':'#22aa44'
    ctx.font='bold 6px monospace'; ctx.textAlign='center'; ctx.fillText('RPM',cx,cy+r+10)
    ctx.fillStyle='#334433'; ctx.font='5px monospace'; ctx.fillText(Math.round(val/100)*100,cx,cy+r+17)
  }

  function drawSketch(sctx, progress, W, H) {
    sctx.clearRect(0, 0, W * 2, H * 2)
    const cw=W*.72, ch=H*.58, cxo=W*.14, cyo=H*.2
    const total=CAR_LINES.length, perLine=1/total

    function wb(x,y,a){return[x+(Math.random()-.5)*a,y+(Math.random()-.5)*a]}

    CAR_LINES.forEach((line, li) => {
      const ls=li*perLine, le=(li+1)*perLine
      if (progress < ls) return
      const lp=Math.min(1,(progress-ls)/perLine)
      const pts=line.pts.map(([nx,ny])=>[cxo+nx*cw, cyo+ny*ch])
      const totalDist=pts.reduce((s,p,i)=>i?s+Math.hypot(p[0]-pts[i-1][0],p[1]-pts[i-1][1]):0,0)
      const drawDist=totalDist*lp
      let dist=0, started=false

      sctx.beginPath(); sctx.strokeStyle=line.col; sctx.lineWidth=line.w
      sctx.lineCap='round'; sctx.lineJoin='round'

      for (let i=1; i<pts.length; i++) {
        const seg=Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1])
        if (!started) { const[wx,wy]=wb(pts[0][0],pts[0][1],1.2); sctx.moveTo(wx,wy); started=true }
        if (dist+seg > drawDist) {
          const t=(drawDist-dist)/seg
          const ex=pts[i-1][0]+(pts[i][0]-pts[i-1][0])*t
          const ey=pts[i-1][1]+(pts[i][1]-pts[i-1][1])*t
          const[wx,wy]=wb(ex,ey,1.5); sctx.lineTo(wx,wy); sctx.stroke()
          // tip glow
          sctx.beginPath(); sctx.arc(wx,wy,5+Math.random()*3,0,Math.PI*2)
          sctx.fillStyle=`rgba(${line.col==='#4488cc'?'68,136,220':'200,255,180'},.12)`; sctx.fill()
          sctx.beginPath(); sctx.arc(wx,wy,1.8,0,Math.PI*2)
          sctx.fillStyle='rgba(255,255,255,.85)'; sctx.fill()
          break
        }
        const[wx,wy]=wb(pts[i][0],pts[i][1],.9); sctx.lineTo(wx,wy)
        dist+=seg
      }
      if (lp >= 1) sctx.stroke()

      // glass hatch when window complete
      if (li===2 && lp>.98) {
        const gpts=CAR_WIN.map(([nx,ny])=>[cxo+nx*cw,cyo+ny*ch])
        sctx.save(); sctx.beginPath()
        gpts.forEach(([x,y],i)=>i?sctx.lineTo(x,y):sctx.moveTo(x,y))
        sctx.closePath(); sctx.clip()
        sctx.strokeStyle='rgba(68,136,220,.1)'; sctx.lineWidth=1
        for(let x=-200;x<W+200;x+=7){sctx.beginPath();sctx.moveTo(x,0);sctx.lineTo(x-120,H);sctx.stroke()}
        sctx.restore()
      }

      // label after line done
      if (progress > ls + perLine*.92) {
        const mid=pts[Math.floor(pts.length/2)]
        sctx.globalAlpha=Math.min(1,(progress-(ls+perLine*.92))*12)
        sctx.fillStyle=line.col; sctx.font='bold 8px monospace'
        sctx.textAlign='left'; sctx.fillText(line.lbl, mid[0]+8, mid[1]-8)
        sctx.globalAlpha=1
      }
    })

    // ANALYSIS COMPLETE when fully drawn
    if (progress > .96) {
      const fade=Math.min(1,(progress-.96)/.04)
      sctx.globalAlpha=fade
      if (Math.sin(Date.now()*.006)>.0) {
        sctx.fillStyle='#22cc55'; sctx.font='bold 20px monospace'
        sctx.textAlign='center'; sctx.fillText('ANALYSIS COMPLETE', W/2, H*.88)
        sctx.fillStyle='#1a6a1a'; sctx.font='8px monospace'
        sctx.fillText('OUTLINE READY · 2000pt · SALOON', W/2, H*.88+16)
      }
      sctx.globalAlpha=1
    }
  }

  if (!visible) return null

  // Stage fill values
  const stagePcts = (stages ?? []).map(s => ({ ...s, fill: getStagePct(s, pct) }))

  return (
    <div ref={wrapRef} style={{
      position:'absolute', inset:0, zIndex:20,
      background:'#080808',
      display:'flex', flexDirection:'column',
      width:'100%', height:'100%',
    }}>
      {/* Engine canvas */}
      <div style={{flex:1, position:'relative', overflow:'hidden', minHeight:0}}>
        <canvas ref={engRef} style={{position:'absolute',top:0,left:0,width:'100%',height:'100%',display:'block'}}/>
        <canvas ref={sketchRef} style={{position:'absolute',top:0,left:0,width:'100%',height:'100%',display:'block',opacity:0,transition:'opacity 0.6s'}}/>

        {/* MSG overlay */}
        <div style={{
          position:'absolute', bottom:8, left:0, right:0,
          textAlign:'center', pointerEvents:'none',
        }}>
          <div style={{fontSize:11,fontFamily:'var(--font-mono)',color:'#1a5a1a',letterSpacing:'.08em',marginBottom:2}}>{msg}</div>
          {sub && <div style={{fontSize:9,fontFamily:'var(--font-sans)',color:'#0f3a0f',letterSpacing:'.04em'}}>{sub}</div>}
        </div>
      </div>

      {/* Stage progress bars */}
      <div style={{
        background:'rgba(0,0,0,.96)',
        borderTop:'1px solid #0f1f0f',
        padding:'8px 16px 10px',
      }}>
        {stagePcts.map(s => {
          const col = STAGE_COL[s.id] ?? '#22cc55'
          const active = pct >= s.pct[0] && pct < s.pct[1]
          const done   = pct >= s.pct[1]
          return (
            <div key={s.id} style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
              <span style={{
                fontSize:8, fontFamily:'monospace', letterSpacing:'.1em',
                width:68, textAlign:'right', textTransform:'uppercase',
                color: done ? col : active ? col : '#1a2a1a',
                transition:'color .3s',
              }}>{s.label}</span>
              <div style={{flex:1,height:3,background:'#0f1a0f',borderRadius:2,overflow:'visible',position:'relative'}}>
                <div style={{
                  height:'100%', width:`${s.fill}%`,
                  background: col,
                  borderRadius:2,
                  boxShadow: active ? `0 0 8px ${col}88` : 'none',
                  transition:'width .3s ease, box-shadow .3s',
                  position:'relative',
                }}>
                  {active && (
                    <div style={{
                      position:'absolute',right:-3,top:-4,
                      width:8,height:11,background:col,borderRadius:2,
                      boxShadow:`0 0 6px ${col}`,
                    }}/>
                  )}
                </div>
              </div>
              <span style={{
                fontSize:9, fontFamily:'monospace', width:28,
                textAlign:'right', letterSpacing:'.04em',
                color: done ? col : active ? col : '#1a2a1a',
              }}>
                {done ? '✓' : active ? `${s.fill}%` : ''}
              </span>
            </div>
          )
        })}

        {/* Global pct */}
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:6,paddingTop:6,borderTop:'1px solid #0f1a0f'}}>
          <div style={{height:2,flex:1,background:'#0f1a0f',borderRadius:1,marginRight:10,overflow:'hidden'}}>
            <div style={{height:'100%',width:`${pct}%`,background:'#22cc55',borderRadius:1,transition:'width .4s ease'}}/>
          </div>
          <span style={{fontSize:14,fontFamily:'monospace',fontWeight:'bold',color:'#22cc55',letterSpacing:'.06em',minWidth:42,textAlign:'right'}}>
            {Math.round(pct)}<span style={{fontSize:10,color:'#1a5a1a'}}>%</span>
          </span>
        </div>
      </div>
    </div>
  )
}
