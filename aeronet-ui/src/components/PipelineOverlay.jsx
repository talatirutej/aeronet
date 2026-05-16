// PipelineOverlay.jsx — AeroNet Thermal Engine Animation
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
  return (globalPct - s0) / (s1 - s0)
}

// Thermal colour: 0=cold(deep blue) → 0.5=warm(orange) → 1=white-hot
function thermalColor(heat, alpha = 1) {
  const h = Math.max(0, Math.min(1, heat))
  let r, g, b
  if (h < 0.2) {
    // deep blue → blue
    r = 0; g = 0; b = Math.round(100 + h * 5 * 155)
  } else if (h < 0.4) {
    // blue → cyan
    const t = (h - 0.2) / 0.2
    r = 0; g = Math.round(t * 200); b = 255
  } else if (h < 0.6) {
    // cyan → green → yellow
    const t = (h - 0.4) / 0.2
    r = Math.round(t * 255); g = 255; b = Math.round(255 * (1 - t))
  } else if (h < 0.8) {
    // yellow → orange → red
    const t = (h - 0.6) / 0.2
    r = 255; g = Math.round(255 * (1 - t * .7)); b = 0
  } else {
    // red → white
    const t = (h - 0.8) / 0.2
    r = 255; g = Math.round(t * 255); b = Math.round(t * 255)
  }
  return `rgba(${r},${g},${b},${alpha})`
}

function thermalGlow(heat) {
  const h = Math.max(0, Math.min(1, heat))
  if (h < 0.3) return `rgba(0,80,255,${h * .4})`
  if (h < 0.6) return `rgba(255,140,0,${(h - .3) * .6})`
  return `rgba(255,${Math.round(255 * (h - .6) / .4)},0,${Math.min(.8, h * .7)})`
}

export default function PipelineOverlay({ visible, pct = 0, msg = '', sub = '', stages = [] }) {
  const wrapRef   = useRef(null)
  const canvasRef = useRef(null)
  const rafRef    = useRef(null)
  const pctRef    = useRef(pct)
  const tRef      = useRef(0)
  // Per-cylinder heat state
  const heatRef   = useRef({ block:0.05, cylinders:[0,0,0,0], head:0.05, exhaust:0.05, oil:0.05, turbo:0.05 })

  useEffect(() => { pctRef.current = pct }, [pct])

  useEffect(() => {
    if (!visible) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      return
    }

    const start = () => {
      const cv = canvasRef.current
      if (!cv) return
      const W = wrapRef.current?.offsetWidth || 680
      const H = wrapRef.current?.offsetHeight || 360
      cv.width = W * 2; cv.height = H * 2
      cv.style.width = W + 'px'; cv.style.height = H + 'px'
      const ctx = cv.getContext('2d'); ctx.scale(2, 2)

      const EX = W / 2, EY = H / 2 + 10
      const pistonPhases = [0, Math.PI / 2, Math.PI, Math.PI * 1.5]

      function loop() {
        rafRef.current = requestAnimationFrame(loop)
        tRef.current += 0.016
        const t = tRef.current
        const currentPct = pctRef.current
        const H2 = heatRef.current

        // Heat target based on pct
        const heatTarget = Math.min(1, currentPct / 95)
        const spd = currentPct >= 95 ? 0.025 : 0.008
        H2.block    += (Math.min(heatTarget * .85, .9) - H2.block) * spd
        H2.head     += (Math.min(heatTarget * .95, .98) - H2.head) * spd
        H2.exhaust  += (Math.min(heatTarget * 1.0, 1.0) - H2.exhaust) * spd * 1.5
        H2.oil      += (Math.min(heatTarget * .55, .55) - H2.oil) * spd * .7
        H2.turbo    += (Math.min(heatTarget * .9, .95) - H2.turbo) * spd * 1.2
        pistonPhases.forEach((ph, i) => {
          const firing = Math.sin(t * (3 + currentPct * .04) + ph) > .88
          const cylTarget = Math.min(heatTarget * .9 + (firing ? .15 : 0), 1)
          H2.cylinders[i] += (cylTarget - H2.cylinders[i]) * (spd + (firing ? .08 : 0))
        })

        const engineSpd = .04 + currentPct * .001
        const pistonT = t * engineSpd * 60

        // ── clear
        ctx.fillStyle = '#080808'
        ctx.fillRect(0, 0, W, H)

        // ── dark vignette bg
        const vg = ctx.createRadialGradient(EX, EY, 20, EX, EY, W * .65)
        vg.addColorStop(0, 'rgba(10,10,10,0)')
        vg.addColorStop(1, 'rgba(0,0,0,0.7)')
        ctx.fillStyle = vg
        ctx.fillRect(0, 0, W, H)

        ctx.save()
        ctx.translate(EX, EY)

        // ─────────────────────────────────────────────────────────────────
        // ENGINE COMPONENTS — drawn back to front
        // ─────────────────────────────────────────────────────────────────

        const BW = 160, BH = 130

        // ── exhaust manifold (left side, glows hottest)
        drawExhaust(ctx, H2.exhaust, t)

        // ── intake manifold (right side, stays cooler)
        drawIntake(ctx, H2.oil, t)

        // ── turbocharger (top right)
        drawTurbo(ctx, H2.turbo, t, currentPct)

        // ── oil pan (bottom)
        const opHeat = H2.oil
        ctx.fillStyle = thermalColor(opHeat * .5, .9)
        ctx.strokeStyle = thermalColor(opHeat * .6)
        ctx.lineWidth = 1
        ctx.beginPath(); ctx.roundRect(-BW*.55, BH*.42, BW*1.1, 28, 4)
        ctx.fill(); ctx.stroke()
        // oil level indicator
        ctx.fillStyle = thermalColor(opHeat * .3, .6)
        ctx.fillRect(-BW*.4, BH*.42 + 8, BW*.8 * (H2.oil / .55), 8)
        ctx.fillStyle = 'rgba(255,255,255,0.15)'
        ctx.font = '6px monospace'; ctx.textAlign = 'center'
        ctx.fillText('OIL', 0, BH*.42 + 18)

        // ── engine block (main body)
        drawBlock(ctx, H2.block, BW, BH, t)

        // ── cylinder bores + pistons (drawn inside block clip)
        drawCylinders(ctx, H2, BW, BH, pistonT, pistonPhases, t, currentPct)

        // ── crankshaft (below cylinders)
        drawCrank(ctx, H2.block, BH, pistonT, pistonPhases, t)

        // ── cylinder head
        drawHead(ctx, H2.head, BW, BH, t, currentPct)

        // ── valve cover (top)
        drawValveCover(ctx, H2.head, BW, BH, t)

        // ── heat shimmer overlay on hottest parts
        if (H2.exhaust > .7) {
          const shimmer = ctx.createLinearGradient(-BW*.75, -BH*.3, -BW*.75, -BH*.5)
          shimmer.addColorStop(0, `rgba(255,120,0,${(H2.exhaust-.7)*.15})`)
          shimmer.addColorStop(0.5, 'transparent')
          shimmer.addColorStop(1, `rgba(255,200,0,${(H2.exhaust-.7)*.08})`)
          ctx.fillStyle = shimmer
          ctx.fillRect(-BW*.9, -BH*.6, BW*.35, BH*.8)
        }

        // ── thermal legend (top right of engine)
        drawThermalLegend(ctx, BW, BH)

        // ── RPM / temp readouts
        drawReadouts(ctx, H2, BW, BH, currentPct, t)

        ctx.restore()

        // ── heat particles floating up from hot areas
        drawHeatParticles(ctx, EX, EY, H2, t, W, H)
      }

      loop()
    }

    const ro = new ResizeObserver(entries => {
      if (entries[0].contentRect.width > 0) { ro.disconnect(); start() }
    })
    if (wrapRef.current) ro.observe(wrapRef.current)
    if (wrapRef.current?.offsetWidth > 0) { ro.disconnect(); start() }

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      ro.disconnect()
    }
  }, [visible]) // eslint-disable-line

  // ── Component draw functions ────────────────────────────────────────────────

  function drawBlock(ctx, heat, BW, BH, t) {
    // main cast shadow
    ctx.fillStyle = 'rgba(0,0,0,0.4)'
    ctx.beginPath(); ctx.roundRect(-BW*.51+3, -BH*.38+3, BW*1.02, BH*.82, 6)
    ctx.fill()

    // block glow
    if (heat > .3) {
      const g = ctx.createRadialGradient(0, 0, 20, 0, 0, BW * .7)
      g.addColorStop(0, thermalGlow(heat))
      g.addColorStop(1, 'transparent')
      ctx.fillStyle = g
      ctx.fillRect(-BW, -BH*.5, BW*2, BH)
    }

    // block body — layered for depth
    const blockBase = thermalColor(heat * .7, 1)
    const blockEdge = thermalColor(heat * .85, 1)

    ctx.fillStyle = blockBase
    ctx.strokeStyle = blockEdge
    ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.roundRect(-BW*.5, -BH*.38, BW, BH*.8, 5)
    ctx.fill(); ctx.stroke()

    // ribbing / cooling fins (vertical lines on sides)
    ctx.strokeStyle = thermalColor(heat * .9, .5)
    ctx.lineWidth = .6
    for (let i = -4; i <= 4; i++) {
      const rx = i * (BW * .11)
      ctx.beginPath()
      ctx.moveTo(rx, -BH*.35)
      ctx.lineTo(rx, BH*.38)
      ctx.stroke()
    }

    // horizontal structural lines
    ctx.strokeStyle = thermalColor(heat * .6, .3)
    ctx.lineWidth = .5
    ;[-0.1, 0.1, 0.25].forEach(fy => {
      ctx.beginPath()
      ctx.moveTo(-BW*.48, BH*fy)
      ctx.lineTo(BW*.48, BH*fy)
      ctx.stroke()
    })

    // block logo / badge
    ctx.fillStyle = thermalColor(heat * .4, .4)
    ctx.font = 'bold 8px monospace'
    ctx.textAlign = 'center'
    ctx.fillText('AERONET', 0, BH * .32)
    ctx.font = '6px monospace'
    ctx.fillText('2.0T', 0, BH * .38)
  }

  function drawCylinders(ctx, H2, BW, BH, pistonT, pistonPhases, t, pct) {
    const CW = 28, CH = 70, GAP = 6
    const totalW = 4 * CW + 3 * GAP
    const startX = -totalW / 2

    pistonPhases.forEach((ph, i) => {
      const cx = startX + i * (CW + GAP) + CW / 2
      const heat = H2.cylinders[i]
      const firing = Math.sin(pistonT * Math.PI * 2 * 2 + ph) > .88
      const py = Math.sin(pistonT * Math.PI * 2 + ph) * 22

      // bore background
      ctx.fillStyle = thermalColor(heat * .4, .95)
      ctx.beginPath(); ctx.rect(cx - CW/2 + 1, -BH*.36, CW - 2, CH)
      ctx.fill()

      // bore liner (inner wall)
      ctx.strokeStyle = thermalColor(heat * .7, .6)
      ctx.lineWidth = .5
      ctx.strokeRect(cx - CW/2 + 1, -BH*.36, CW - 2, CH)

      // combustion glow when firing
      if (firing && pct > 5) {
        const fg = ctx.createRadialGradient(cx, -BH*.36 + 8, 0, cx, -BH*.36 + 8, CW)
        fg.addColorStop(0, `rgba(255,255,200,${.6 + Math.random()*.3})`)
        fg.addColorStop(0.4, `rgba(255,150,0,${.4 + Math.random()*.2})`)
        fg.addColorStop(1, 'transparent')
        ctx.fillStyle = fg
        ctx.beginPath(); ctx.rect(cx - CW/2 + 1, -BH*.36, CW - 2, CH*.35)
        ctx.fill()
      }

      // piston body
      const pTop = py - 12
      const pistonHeat = heat * .8
      ctx.fillStyle = thermalColor(pistonHeat, .95)
      ctx.strokeStyle = thermalColor(pistonHeat * 1.1, .8)
      ctx.lineWidth = .8
      ctx.beginPath(); ctx.roundRect(cx - CW/2 + 3, pTop, CW - 6, 22, 2)
      ctx.fill(); ctx.stroke()

      // piston crown detail
      ctx.fillStyle = thermalColor(pistonHeat * 1.2, .5)
      ctx.fillRect(cx - CW/2 + 5, pTop + 2, CW - 10, 3)

      // ring grooves
      ctx.strokeStyle = thermalColor(pistonHeat * .5, .4)
      ctx.lineWidth = .5
      ;[6, 10, 14].forEach(ry => {
        ctx.beginPath()
        ctx.moveTo(cx - CW/2 + 3, pTop + ry)
        ctx.lineTo(cx + CW/2 - 3, pTop + ry)
        ctx.stroke()
      })

      // connecting rod
      ctx.strokeStyle = thermalColor(heat * .6, .7)
      ctx.lineWidth = 2.5; ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(cx, pTop + 22)
      ctx.lineTo(cx, py + 36)
      ctx.stroke()

      // wrist pin
      ctx.fillStyle = thermalColor(heat * .7, .8)
      ctx.beginPath(); ctx.arc(cx, pTop + 11, 2.5, 0, Math.PI * 2); ctx.fill()
    })
  }

  function drawCrank(ctx, heat, BH, pistonT, pistonPhases, t) {
    // main journal
    ctx.strokeStyle = thermalColor(heat * .65, .9)
    ctx.lineWidth = 4; ctx.lineCap = 'round'
    ctx.beginPath(); ctx.moveTo(-80, BH*.32); ctx.lineTo(80, BH*.32); ctx.stroke()

    pistonPhases.forEach((ph, i) => {
      const bx = -48 + i * 33
      const cy2 = BH*.32 + Math.sin(pistonT * Math.PI * 2 + ph) * 14
      ctx.fillStyle = thermalColor(heat * .7, .9)
      ctx.beginPath(); ctx.arc(bx, cy2, 5.5, 0, Math.PI * 2); ctx.fill()
      ctx.strokeStyle = thermalColor(heat * .8, .7)
      ctx.lineWidth = 1.5
      ctx.beginPath(); ctx.moveTo(bx, BH*.32); ctx.lineTo(bx, cy2); ctx.stroke()
      // counterweight
      ctx.fillStyle = thermalColor(heat * .5, .6)
      ctx.beginPath()
      ctx.arc(bx, BH*.32 - Math.sin(pistonT * Math.PI * 2 + ph) * 10, 7, 0, Math.PI * 2)
      ctx.fill()
    })
  }

  function drawHead(ctx, heat, BW, BH, t, pct) {
    // head gasket glow
    if (heat > .5) {
      ctx.fillStyle = thermalColor(heat * .9, (heat - .5) * .4)
      ctx.fillRect(-BW*.5, -BH*.42, BW, 5)
    }

    ctx.fillStyle = thermalColor(heat * .8, .95)
    ctx.strokeStyle = thermalColor(heat * .95, .8)
    ctx.lineWidth = 1.2
    ctx.beginPath(); ctx.roundRect(-BW*.5, -BH*.54, BW, BH*.17, 3)
    ctx.fill(); ctx.stroke()

    // spark plugs
    ;[-48, -16, 16, 48].forEach((sx, i) => {
      const firing = pct > 5 && Math.sin(t * (3 + pct * .04) + pistonPhases[i]) > .88
      ctx.fillStyle = firing ? 'rgba(255,255,200,.9)' : thermalColor(heat * .6, .7)
      ctx.beginPath(); ctx.arc(sx, -BH*.48, 2.5, 0, Math.PI * 2); ctx.fill()
      // spark
      if (firing) {
        ctx.strokeStyle = `rgba(255,255,150,${.6 + Math.random() * .4})`
        ctx.lineWidth = 1
        for (let j = 0; j < 4; j++) {
          const a = j / 4 * Math.PI * 2
          ctx.beginPath()
          ctx.moveTo(sx, -BH*.48)
          ctx.lineTo(sx + Math.cos(a) * 5, -BH*.48 + Math.sin(a) * 5)
          ctx.stroke()
        }
      }
    })
  }

  function drawValveCover(ctx, heat, BW, BH, t) {
    ctx.fillStyle = thermalColor(heat * .6, .92)
    ctx.strokeStyle = thermalColor(heat * .75, .7)
    ctx.lineWidth = 1.2
    ctx.beginPath(); ctx.roundRect(-BW*.52, -BH*.72, BW*1.04, BH*.19, 4)
    ctx.fill(); ctx.stroke()

    // oil filler cap
    ctx.fillStyle = thermalColor(heat * .5, .8)
    ctx.strokeStyle = thermalColor(heat * .7, .6)
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.arc(BW*.28, -BH*.64, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
    ctx.fillStyle = thermalColor(heat * .3, .5)
    ctx.font = '5px monospace'; ctx.textAlign = 'center'
    ctx.fillText('OIL', BW*.28, -BH*.62)

    // breather tube
    ctx.strokeStyle = thermalColor(heat * .4, .5)
    ctx.lineWidth = 3; ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(BW*.15, -BH*.72)
    ctx.quadraticCurveTo(BW*.2, -BH*.85, BW*.35, -BH*.85)
    ctx.stroke()

    // cover bolts
    ctx.fillStyle = thermalColor(heat * .55, .7)
    ;[-BW*.38, -BW*.18, 0, BW*.18, BW*.38].forEach(bx => {
      ctx.beginPath(); ctx.arc(bx, -BH*.635, 3, 0, Math.PI * 2); ctx.fill()
    })
  }

  function drawExhaust(ctx, heat, t) {
    ctx.strokeStyle = thermalColor(heat, .85)
    ctx.lineWidth = 8; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    // manifold runners — 4 pipes merging into one
    ;[-48, -16, 16, 48].forEach((sx, i) => {
      const wave = Math.sin(t * 2 + i * .5) * 1.5
      ctx.beginPath()
      ctx.moveTo(sx, -20)
      ctx.quadraticCurveTo(sx - 30 + wave, 10, -90, 20 + i * 8)
      ctx.stroke()
    })
    // collector pipe
    ctx.lineWidth = 12
    ctx.beginPath()
    ctx.moveTo(-90, 20)
    ctx.lineTo(-90, 52)
    ctx.quadraticCurveTo(-90, 70, -105, 70)
    ctx.stroke()

    // exhaust glow
    if (heat > .5) {
      const eg = ctx.createRadialGradient(-98, 60, 2, -98, 60, 20)
      eg.addColorStop(0, thermalGlow(heat))
      eg.addColorStop(1, 'transparent')
      ctx.fillStyle = eg
      ctx.fillRect(-120, 40, 40, 40)
    }
  }

  function drawIntake(ctx, heat, t) {
    ctx.strokeStyle = thermalColor(heat * .5, .7)
    ctx.lineWidth = 7; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    ;[-48, -16, 16, 48].forEach((sx, i) => {
      ctx.beginPath()
      ctx.moveTo(sx, -25)
      ctx.quadraticCurveTo(sx + 30, 5, 90, 10 + i * 6)
      ctx.stroke()
    })
    ctx.lineWidth = 10
    ctx.beginPath()
    ctx.moveTo(90, 10)
    ctx.lineTo(90, 40)
    ctx.quadraticCurveTo(90, 55, 108, 55)
    ctx.stroke()
  }

  function drawTurbo(ctx, heat, t, pct) {
    const tx = 85, ty = -55
    const spin = t * (2 + pct * .04)

    // turbo housing
    ctx.fillStyle = thermalColor(heat * .8, .85)
    ctx.strokeStyle = thermalColor(heat, .7)
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.arc(tx, ty, 18, 0, Math.PI * 2); ctx.fill(); ctx.stroke()

    // compressor wheel (spinning)
    ctx.save(); ctx.translate(tx, ty); ctx.rotate(spin)
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2
      ctx.fillStyle = thermalColor(heat * .9, .8)
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.arc(0, 0, 13, a, a + .35)
      ctx.closePath()
      ctx.fill()
    }
    ctx.restore()

    // centre bearing
    ctx.fillStyle = thermalColor(heat * 1.0, .9)
    ctx.beginPath(); ctx.arc(tx, ty, 4, 0, Math.PI * 2); ctx.fill()

    // inlet/outlet pipes
    ctx.strokeStyle = thermalColor(heat * .6, .6)
    ctx.lineWidth = 5; ctx.lineCap = 'round'
    ctx.beginPath(); ctx.moveTo(tx + 18, ty); ctx.lineTo(tx + 35, ty); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(tx, ty - 18); ctx.lineTo(tx, ty - 32); ctx.stroke()

    // TURBO label
    ctx.fillStyle = thermalColor(heat * .4, .5)
    ctx.font = '5px monospace'; ctx.textAlign = 'center'
    ctx.fillText('TURBO', tx, ty + 28)
  }

  function drawThermalLegend(ctx, BW, BH) {
    const lx = BW*.55, ly = -BH*.7, lh = BH*.55, lw = 7
    // gradient bar
    const lg = ctx.createLinearGradient(lx, ly + lh, lx, ly)
    ;[0, .2, .4, .6, .8, 1].forEach(stop => {
      lg.addColorStop(stop, thermalColor(stop, .8))
    })
    ctx.fillStyle = lg
    ctx.fillRect(lx, ly, lw, lh)
    ctx.strokeStyle = 'rgba(255,255,255,.15)'
    ctx.lineWidth = .5
    ctx.strokeRect(lx, ly, lw, lh)

    // labels
    ctx.fillStyle = 'rgba(255,255,255,.4)'
    ctx.font = '5px monospace'; ctx.textAlign = 'left'
    ctx.fillText('HOT',  lx + lw + 3, ly + 4)
    ctx.fillText('COLD', lx + lw + 3, ly + lh)
  }

  function drawReadouts(ctx, H2, BW, BH, pct, t) {
    const temp = Math.round(20 + H2.block * 280)
    const rpm  = Math.round(800 + pct * 82)
    const oil  = Math.round(H2.oil * 80 + 10)

    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    ctx.beginPath(); ctx.roundRect(-BW*.52, BH*.72, BW*1.04, 32, 4); ctx.fill()

    const items = [
      { label:'TEMP', value:`${temp}°C`, heat: H2.block },
      { label:'RPM',  value:rpm.toLocaleString(), heat: Math.min(1, pct/100) },
      { label:'OIL',  value:`${oil} PSI`, heat: H2.oil },
      { label:'BOOST',value:`${(H2.turbo * 18).toFixed(1)} psi`, heat: H2.turbo },
    ]

    items.forEach((item, i) => {
      const ix = -BW*.44 + i * BW*.29
      ctx.fillStyle = thermalColor(item.heat, .6)
      ctx.font = '5px monospace'; ctx.textAlign = 'center'
      ctx.fillText(item.label, ix, BH*.77)
      ctx.fillStyle = thermalColor(item.heat, .9)
      ctx.font = 'bold 7px monospace'
      ctx.fillText(item.value, ix, BH*.86)
    })
  }

  const pistonPhases = [0, Math.PI / 2, Math.PI, Math.PI * 1.5]

  function drawHeatParticles(ctx, EX, EY, H2, t, W, H) {
    // Floating heat shimmer particles above exhaust
    const count = Math.floor(H2.exhaust * 12)
    for (let i = 0; i < count; i++) {
      const seed = (t * .8 + i * 2.3) % (Math.PI * 2)
      const px = EX - 95 + Math.sin(seed * 1.7 + i) * 12
      const py = EY + 65 - ((t * 25 + i * 18) % 80)
      const alpha = Math.sin(seed + i) * .3 + .15
      if (alpha > 0) {
        ctx.beginPath()
        ctx.arc(px, py, 1.5 + Math.sin(seed) * .8, 0, Math.PI * 2)
        ctx.fillStyle = thermalColor(H2.exhaust, Math.max(0, alpha))
        ctx.fill()
      }
    }
  }

  if (!visible) return null

  return (
    <div style={{
      position:'absolute', inset:0, zIndex:20,
      background:'#060808',
      display:'flex', flexDirection:'column',
    }}>

      {/* M3 stage chips */}
      <div style={{
        display:'flex', gap:5, flexWrap:'wrap',
        justifyContent:'center', padding:'9px 16px 5px',
        flexShrink:0,
      }}>
        {stages.map(s => {
          const active = pct >= s.pct[0] && pct < s.pct[1]
          const done   = pct >= s.pct[1]
          const col    = STAGE_COL[s.id] ?? '#22cc55'
          return (
            <div key={s.id} style={{
              display:'flex', alignItems:'center', gap:4,
              padding:'3px 9px', borderRadius:99,
              border:`0.5px solid ${done||active ? col+'88' : 'rgba(255,255,255,0.08)'}`,
              background: active ? `${col}18` : done ? `${col}0a` : 'transparent',
              transition:'all 0.3s',
            }}>
              <span style={{ fontSize:11, color: done||active ? col : 'rgba(255,255,255,0.2)' }}>{s.icon}</span>
              <span style={{
                fontSize:9, fontFamily:'monospace', letterSpacing:'.08em',
                color: done||active ? col : 'rgba(255,255,255,0.2)',
                fontWeight: active ? 'bold' : 'normal',
              }}>{s.label}</span>
              {done && <span style={{ fontSize:9, color:col }}>✓</span>}
              {active && (
                <span style={{
                  width:5, height:5, borderRadius:'50%',
                  background:col, display:'inline-block',
                  animation:'aero-pulse 0.8s ease infinite',
                }}/>
              )}
            </div>
          )
        })}
      </div>

      {/* Canvas */}
      <div ref={wrapRef} style={{ flex:1, position:'relative', overflow:'hidden', minHeight:0 }}>
        <canvas ref={canvasRef} style={{ position:'absolute', top:0, left:0, width:'100%', height:'100%', display:'block' }}/>

        {/* msg */}
        <div style={{ position:'absolute', bottom:6, left:0, right:0, textAlign:'center', pointerEvents:'none' }}>
          <div style={{ fontSize:10, fontFamily:'monospace', color:'rgba(255,200,100,0.6)', letterSpacing:'.07em' }}>{msg}</div>
          {sub && <div style={{ fontSize:9, color:'rgba(200,150,80,0.4)', letterSpacing:'.04em', marginTop:1 }}>{sub}</div>}
        </div>
      </div>

      {/* Global progress */}
      <div style={{ flexShrink:0, padding:'5px 14px 8px', background:'rgba(0,0,0,0.7)' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ flex:1, height:2, background:'rgba(255,255,255,0.06)', borderRadius:1, overflow:'hidden' }}>
            <div style={{
              height:'100%', width:`${pct}%`,
              background:`linear-gradient(90deg,#22cc55,${pct>80?'#ff9f0a':'#22cc55'})`,
              borderRadius:1, transition:'width .4s ease',
            }}/>
          </div>
          <span style={{ fontSize:11, fontFamily:'monospace', fontWeight:'bold', color:'#22cc55', minWidth:36, textAlign:'right' }}>
            {Math.round(pct)}<span style={{ fontSize:9, color:'rgba(100,200,100,0.5)' }}>%</span>
          </span>
        </div>
      </div>

      <style>{`@keyframes aero-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.3;transform:scale(.5)}}`}</style>
    </div>
  )
}
