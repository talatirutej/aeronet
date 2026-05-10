// Copyright (c) 2026 Rutej Talati. All rights reserved.

import { useCallback, useEffect, useRef, useState } from 'react'

// ── Backend base URL ──────────────────────────────────────────────────────────
// Reads NEXT_PUBLIC_API_URL if set (e.g. in .env.local), otherwise hits the
// HuggingFace Space directly. Change this one constant to redirect to any backend.
const API_BASE =
  (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_API_URL) ||
  'https://rutejtalati16-aeronet.hf.space'

// ── Image preprocessing ───────────────────────────────────────────────────────
async function prepareImage(file, maxWidth = 1440, quality = 0.93) {
  return new Promise((resolve) => {
    const img = new window.Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const minWidth = 900
      const effectiveMax = Math.max(maxWidth, minWidth)
      const scale = img.width < minWidth
        ? Math.min(3.0, effectiveMax / img.width)
        : Math.min(1.0, maxWidth / img.width)
      const w = Math.round(img.width  * scale)
      const h = Math.round(img.height * scale)
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, w, h)
      ctx.imageSmoothingEnabled  = true
      ctx.imageSmoothingQuality  = 'high'
      ctx.drawImage(img, 0, 0, w, h)
      canvas.toBlob(
        (blob) => resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' })),
        'image/jpeg', quality
      )
    }
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file) }
    img.src = url
  })
}

// ── URL fetcher with multi-proxy fallback ─────────────────────────────────────
async function fetchImageFromUrl(url) {
  const proxies = [
    u => u,
    u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    u => `https://corsproxy.io/?${encodeURIComponent(u)}`,
    u => `https://proxy.cors.sh/${u}`,
    u => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
  ]
  for (const proxy of proxies) {
    try {
      const r = await fetch(proxy(url), { signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined })
      if (!r.ok) continue
      const blob = await r.blob()
      if (!blob.type.startsWith('image/') && !blob.type.includes('octet')) continue
      const filename = url.split('/').pop()?.split('?')[0] || 'car.jpg'
      return new File([blob], filename, { type: blob.type.startsWith('image/') ? blob.type : 'image/jpeg' })
    } catch { continue }
  }
  throw new Error('Could not fetch image — try downloading and uploading the file directly')
}

// ── Pipeline stage config ─────────────────────────────────────────────────────
const STAGES = [
  { id: 'prep',      label: 'Preprocessing',        icon: '⚙', pct: [0,  8]  },
  { id: 'yolo',      label: 'YOLO Detection',        icon: '◉', pct: [8,  32] },
  { id: 'sam2',      label: 'SAM2 Refinement',       icon: '◎', pct: [32, 60] },
  { id: 'contour',   label: 'Contour Extraction',    icon: '⬡', pct: [60, 72] },
  { id: 'keypoints', label: 'Keypoint Mapping',      icon: '✦', pct: [72, 82] },
  { id: 'panels',    label: 'Panel Detection',       icon: '⊞', pct: [82, 92] },
  { id: 'aero',      label: 'Aero Analysis',         icon: '◈', pct: [92, 98] },
  { id: 'done',      label: 'Complete',              icon: '✓', pct: [98, 100]},
]

// ── Loading animation ─────────────────────────────────────────────────────────
function PipelineLoader({ pct, msg, mode }) {
  const activeStage = STAGES.findLast(s => pct >= s.pct[0]) ?? STAGES[0]
  const relevantStages = mode === 'A' ? STAGES.slice(0,6)
    : mode === 'B' ? STAGES.slice(0,7)
    : STAGES

  return (
    <div style={{
      display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',
      height:'100%',gap:24,padding:'24px 32px',background:'#030608'
    }}>
      {/* Big progress ring */}
      <div style={{position:'relative',width:100,height:100}}>
        <svg width={100} height={100} viewBox="0 0 100 100">
          <circle cx={50} cy={50} r={44} fill="none" stroke="rgba(10,132,255,0.08)" strokeWidth={6}/>
          <circle cx={50} cy={50} r={44} fill="none" stroke="rgba(10,132,255,0.9)" strokeWidth={6}
            strokeLinecap="round"
            strokeDasharray={`${2*Math.PI*44}`}
            strokeDashoffset={`${2*Math.PI*44*(1-pct/100)}`}
            transform="rotate(-90 50 50)"
            style={{transition:'stroke-dashoffset 0.6s ease'}}/>
          <text x={50} y={46} textAnchor="middle" fill="white" fontSize={18} fontWeight={700}
            fontFamily="'IBM Plex Mono',monospace">{Math.round(pct)}</text>
          <text x={50} y={60} textAnchor="middle" fill="rgba(10,132,255,0.7)" fontSize={9}
            fontFamily="'IBM Plex Mono',monospace">%</text>
        </svg>
        <div style={{
          position:'absolute',inset:-4,borderRadius:'50%',
          border:'1px solid rgba(10,132,255,0.3)',
          animation:'pulse-ring 1.5s ease-out infinite'
        }}/>
      </div>

      {/* Stage pipeline */}
      <div style={{display:'flex',alignItems:'center',gap:0,flexWrap:'wrap',justifyContent:'center',maxWidth:480}}>
        {relevantStages.map((s, i) => {
          const done    = pct >= s.pct[1]
          const active  = s.id === activeStage.id
          const pending = pct < s.pct[0]
          return (
            <div key={s.id} style={{display:'flex',alignItems:'center'}}>
              <div style={{
                display:'flex',flexDirection:'column',alignItems:'center',gap:4,padding:'6px 8px',
                borderRadius:8,transition:'all 0.3s',
                background: active ? 'rgba(10,132,255,0.12)' : 'transparent',
                border: active ? '0.5px solid rgba(10,132,255,0.3)' : '0.5px solid transparent',
              }}>
                <div style={{
                  width:28,height:28,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',
                  fontSize:13,
                  background: done ? 'rgba(10,132,255,0.9)' : active ? 'rgba(10,132,255,0.2)' : 'rgba(255,255,255,0.05)',
                  border: active ? '1.5px solid rgba(10,132,255,0.8)' : '1px solid rgba(255,255,255,0.1)',
                  color: done ? '#fff' : active ? 'rgba(10,132,255,1)' : 'rgba(255,255,255,0.25)',
                  boxShadow: active ? '0 0 12px rgba(10,132,255,0.4)' : 'none',
                  transition:'all 0.3s',
                }}>
                  {done ? '✓' : s.icon}
                </div>
                <span style={{
                  fontSize:8,fontFamily:"'IBM Plex Mono',monospace",letterSpacing:'0.04em',
                  color: done ? 'rgba(10,132,255,0.8)' : active ? 'white' : 'rgba(255,255,255,0.2)',
                  textAlign:'center',lineHeight:1.3,maxWidth:52,
                  transition:'color 0.3s',
                }}>
                  {s.label}
                </span>
              </div>
              {i < relevantStages.length-1 && (
                <div style={{
                  width:12,height:1,
                  background: pct >= relevantStages[i+1].pct[0]
                    ? 'rgba(10,132,255,0.6)' : 'rgba(255,255,255,0.1)',
                  transition:'background 0.5s',marginBottom:18,
                }}/>
              )}
            </div>
          )
        })}
      </div>

      {/* Status message */}
      <div style={{
        background:'rgba(10,132,255,0.06)',border:'0.5px solid rgba(10,132,255,0.2)',
        borderRadius:8,padding:'8px 20px',maxWidth:400,textAlign:'center',
      }}>
        <div style={{fontSize:11,color:'rgba(10,132,255,0.9)',fontFamily:"'IBM Plex Mono',monospace",
          letterSpacing:'0.05em',lineHeight:1.6}}>
          {msg}
        </div>
      </div>

      {/* Animated scan line */}
      <div style={{width:320,height:2,borderRadius:9999,background:'rgba(255,255,255,0.05)',overflow:'hidden'}}>
        <div style={{
          height:'100%',width:'40%',borderRadius:9999,
          background:'linear-gradient(90deg,transparent,rgba(10,132,255,0.8),transparent)',
          animation:'scan-line 1.8s ease-in-out infinite',
        }}/>
      </div>

      <style>{`
        @keyframes pulse-ring { 0%{transform:scale(1);opacity:0.6} 100%{transform:scale(1.3);opacity:0} }
        @keyframes scan-line  { 0%{transform:translateX(-100%)} 100%{transform:translateX(350%)} }
      `}</style>
    </div>
  )
}

// ── SideView ──────────────────────────────────────────────────────────────────
function SideView({ g, showSep, traceProgress, traceAnimating, showPanels=true, mode='A' }) {
  // Canvas: wide enough to show car at good size; bottom reserve for ground line + shadow
  const CW = 620, CH = 310, CPAD = 24
  const scale_x = CW - CPAD*2, scale_y = CH - 52   // 52px bottom reserve (ground + shadow)
  const off_x = CPAD, off_y = 10

  if (traceAnimating || (traceProgress && traceProgress.pct < 100 && traceProgress.pct > 0)) {
    return <PipelineLoader pct={traceProgress?.pct ?? 0} msg={traceProgress?.msg ?? 'Analysing…'} mode={mode}/>
  }

  const contourPts = g?._contourPts
  const keypoints  = g?._keypoints
  if (!contourPts || contourPts.length <= 10) {
    return (
      <svg viewBox={`0 0 ${CW} ${CH}`} style={{width:'100%',height:'100%'}} preserveAspectRatio="xMidYMid meet">
        <rect width={CW} height={CH} fill="#050e18"/>
        <text x={CW/2} y={CH/2} textAnchor="middle" fill="rgba(255,255,255,0.1)"
          fontSize="12" fontFamily="'IBM Plex Mono',monospace">Upload a photo and click Analyse</text>
      </svg>
    )
  }

  const crCps  = g?._catmullCps
  const crPts  = g?._catmullPts
  const rawPts = g?._smoothPts ?? contourPts

  const bboxAspect  = g._bboxAspect ?? (scale_x / scale_y)
  const canvasAspect = scale_x / scale_y
  let draw_w, draw_h

  // Scale to fill canvas well — 93% wide (wide cars) or 90% tall (tall crops)
  if (bboxAspect > canvasAspect) {
    draw_w = scale_x * 0.93; draw_h = draw_w / bboxAspect
  } else {
    draw_h = scale_y * 0.90; draw_w = draw_h * bboxAspect
    if (draw_w > scale_x * 0.93) { draw_w = scale_x * 0.93; draw_h = draw_w / bboxAspect }
  }

  const draw_ox = off_x + (scale_x - draw_w) / 2
  // Anchor car to bottom of draw area (contour ny=1.0 maps to draw_oy+draw_h)
  // then pull up by 8px so wheel bottoms clear the ground line with a small gap
  const draw_oy = off_y + (scale_y - draw_h) - 8

  const toSVG = ([nx,ny]) => [draw_ox + nx*draw_w, draw_oy + ny*draw_h]
  const kpX = nx => draw_ox + nx*draw_w
  const kpY = ny => draw_oy + ny*draw_h

  const pathD = rawPts.map((p,i)=>{
    const[sx,sy]=toSVG(p)
    return`${i===0?'M':'L'}${sx.toFixed(2)},${sy.toFixed(2)}`
  }).join(' ') + ' Z'

  // Ground line: sit just below the lowest contour point (ny=1.0 in draw coords)
  const contourBottom = draw_oy + draw_h
  const gY = Math.min(contourBottom + 10, CH - 10)
  // ── Wheel geometry — read from backend, pinned to arch bottom ──────────────
  // r: nr*draw_w is already the correct pixel radius (nr = wheel_r / bbox_w).
  //    No extra scale factor — the previous *0.52 was shrinking wheels too much.
  //    Clamp: min=13% draw_h (never invisible), max=26% draw_h (never giant).
  // cy: pinned to the lowest contour point in the wheel's x-band (arch bottom),
  //     so the wheel sits correctly inside the arch regardless of gY position.
  // rimR: from backend nrr field (image-read rim radius), fallback 0.68×r.
  const wheels = (keypoints?.wheels??[]).map(w=>{
    const cx   = kpX(w.nx)
    const r    = Math.max(draw_h*0.13, Math.min(draw_h*0.26, w.nr * draw_w))
    const rimR = w.nrr
      ? Math.max(draw_h*0.08, Math.min(r * 0.90, w.nrr * draw_w))
      : r * 0.68
    // Find the lowest contour point within ±1.4r of this wheel's x — that's
    // the wheel arch bottom. Wheel centre sits exactly one radius above it.
    const archBandPts = rawPts.filter(p => {
      const sx = draw_ox + p[0]*draw_w
      return Math.abs(sx - cx) < r * 1.4
    })
    const archBottomY = archBandPts.length > 0
      ? Math.max(...archBandPts.map(p => draw_oy + p[1]*draw_h))
      : (gY - r)
    const cy = archBottomY - r
    return { cx, cy, r, rimR, spokes: w.spokes ?? 5 }
  })
  const method = g?._method ?? ''

  return (
    <svg viewBox={`0 0 ${CW} ${CH}`} style={{width:'100%',height:'100%'}} preserveAspectRatio="xMidYMid meet">
      <defs>
        {/* No glow filters — clean engineering line-drawing style */}
      </defs>

      {/* Subtle ground contact line — no shadow ellipse in line-drawing style */}
      <line x1={draw_ox} y1={gY} x2={draw_ox+draw_w} y2={gY}
        stroke="rgba(255,255,255,0.08)" strokeWidth="0.5"/>

      {/*
        Clean engineering line-drawing style — fill="none", single crisp stroke.
        evenodd fill rule makes wheel arch cutouts render as real holes (matching
        the reference drawing) rather than being filled with the body colour.
      */}
      <path d={pathD} fill="none" stroke="rgba(255,255,255,0.95)" strokeWidth="1.4"
        strokeLinejoin="round" strokeLinecap="round" fillRule="evenodd"/>

      {/* Panel lines (Mode B/C) */}
      {showPanels && g?._panels?.lines
        ?.filter(l => l.length > 0.12 && l.length < 0.85)
        ?.slice(0, 18)
        ?.map((l,i) => {
          if (l.y1 > 0.65 && l.y2 > 0.65) return null
          const x1s = draw_ox+l.x1*draw_w, y1s = draw_oy+l.y1*draw_h
          const x2s = draw_ox+l.x2*draw_w, y2s = draw_oy+l.y2*draw_h
          const isPillar = l.type === 'pillar'
          return <line key={i} x1={x1s.toFixed(1)} y1={y1s.toFixed(1)}
            x2={x2s.toFixed(1)} y2={y2s.toFixed(1)}
            stroke={isPillar?'rgba(100,200,255,0.40)':'rgba(10,132,255,0.30)'}
            strokeWidth={isPillar?'1.0':'0.7'} strokeDasharray={isPillar?'4 3':'5 4'}/>
        })}

      {/* Region markers (Mode B/C) */}
      {showPanels && g?._panels?.markers?.map((m,i) => {
        const mx = draw_ox+m.nx*draw_w, my = draw_oy+m.ny*draw_h
        if (mx<draw_ox||mx>draw_ox+draw_w||my<draw_oy||my>draw_oy+draw_h) return null
        const isTop=m.ny<0.40, isLeft=m.nx<0.30
        const labelY = isTop ? my-10 : my+14
        const anchor = isLeft?'start':(m.nx>0.70?'end':'middle')
        return (
          <g key={i}>
            <line x1={mx.toFixed(1)} y1={my.toFixed(1)} x2={mx.toFixed(1)}
              y2={(isTop?my-6:my+6).toFixed(1)} stroke="rgba(10,132,255,0.5)" strokeWidth="0.7"/>
            <circle cx={mx.toFixed(1)} cy={my.toFixed(1)} r={2.5} fill="rgba(10,132,255,1.0)"/>
            <text x={mx.toFixed(1)} y={labelY.toFixed(1)} textAnchor={anchor}
              fill="rgba(160,210,255,0.9)" fontSize="7.5" fontFamily="'IBM Plex Mono',monospace"
              letterSpacing="0.04em">{m.label}</text>
          </g>
        )
      })}

      {/* ΔCd annotations (Mode C) */}
      {showPanels && g?._aero?.region_cd && Object.entries(g._aero.region_cd).map(([region,val],i) => {
        const pos = {'Front Face':[0.08,0.45],'Underbody':[0.50,0.92],'Wheels':[0.25,0.80],'Rear Wake':[0.92,0.45],'Greenhouse':[0.50,0.25]}[region]
        if (!pos) return null
        const ax = draw_ox+pos[0]*draw_w, ay = draw_oy+pos[1]*draw_h
        return (
          <g key={i}>
            <rect x={(ax-24).toFixed(1)} y={(ay-9).toFixed(1)} width="48" height="16" rx="4"
              fill="rgba(0,0,0,0.8)" stroke="rgba(10,132,255,0.3)" strokeWidth="0.5"/>
            <text x={ax.toFixed(1)} y={(ay+3).toFixed(1)} textAnchor="middle"
              fill="rgba(255,200,50,0.95)" fontSize="7" fontFamily="'IBM Plex Mono',monospace">
              {region.split(' ')[0]} {(val*100).toFixed(1)}%
            </text>
          </g>
        )
      })}

      {/* Sep line */}
      {showSep && keypoints?.bumpers?.rear && (
        <line x1={kpX(keypoints.bumpers.rear.x).toFixed(1)} y1={draw_oy.toFixed(1)}
          x2={kpX(keypoints.bumpers.rear.x).toFixed(1)} y2={gY.toFixed(1)}
          stroke="rgba(255,100,80,0.35)" strokeWidth="1" strokeDasharray="3 2"/>
      )}

      {/* Wheels — rim radius and spoke count read from image by Python _analyse_rim */}
      {wheels.map((w,i)=>{
        const hubR   = w.r * 0.15
        // Generate spoke endpoints from image-derived spoke count
        const spokeAngles = Array.from({length: w.spokes}, (_, k) =>
          (k / w.spokes) * Math.PI * 2
        )
        return (
          <g key={i}>
            {/* Arch cutout — filled circle matches canvas BG, simulating the
                wheel arch opening cut into the body silhouette. Drawn first
                so the outline strokes render over it at the arch lip. */}
            <circle cx={w.cx.toFixed(1)} cy={w.cy.toFixed(1)} r={(w.r * 1.06).toFixed(1)}
              fill="#070d14" stroke="none"/>
            {/* Arch lip — thin ring where tyre meets the body panel */}
            <circle cx={w.cx.toFixed(1)} cy={w.cy.toFixed(1)} r={(w.r * 1.06).toFixed(1)}
              fill="none" stroke="rgba(255,255,255,0.50)" strokeWidth="0.8"/>
            {/* Outer tyre ring */}
            <circle cx={w.cx.toFixed(1)} cy={w.cy.toFixed(1)} r={w.r}
              fill="none" stroke="rgba(255,255,255,0.90)" strokeWidth="1.8"/>
            {/* Inner rim ring — radius read from image */}
            <circle cx={w.cx.toFixed(1)} cy={w.cy.toFixed(1)} r={w.rimR}
              fill="none" stroke="rgba(255,255,255,0.60)" strokeWidth="0.9"/>
            {/* Spokes — count read from image */}
            {spokeAngles.map((a,k)=>{
              const x1 = (w.cx + Math.cos(a) * hubR * 1.4).toFixed(1)
              const y1 = (w.cy + Math.sin(a) * hubR * 1.4).toFixed(1)
              const x2 = (w.cx + Math.cos(a) * w.rimR * 0.92).toFixed(1)
              const y2 = (w.cy + Math.sin(a) * w.rimR * 0.92).toFixed(1)
              return <line key={k} x1={x1} y1={y1} x2={x2} y2={y2}
                stroke="rgba(255,255,255,0.55)" strokeWidth="0.9" strokeLinecap="round"/>
            })}
            {/* Centre hub ring */}
            <circle cx={w.cx.toFixed(1)} cy={w.cy.toFixed(1)} r={hubR}
              fill="none" stroke="rgba(255,255,255,0.70)" strokeWidth="0.9"/>
            {/* Hub centre dot */}
            <circle cx={w.cx.toFixed(1)} cy={w.cy.toFixed(1)} r={w.r * 0.05}
              fill="rgba(255,255,255,0.80)"/>
          </g>
        )
      })}

      <text x={CW/2} y={CH-3} textAnchor="middle" fill="rgba(255,255,255,0.10)"
        fontSize="8" fontFamily="'IBM Plex Mono',monospace" letterSpacing="0.12em">
        SIDE · {contourPts.length}pts · {method}{g?._panels?' · panels':''}{g?._aero?' · aero':''}
      </text>
    </svg>
  )
}

// ── FrontView ─────────────────────────────────────────────────────────────────
function FrontView({ g }) {
  const W=320, H=240, cx=W/2, gY=H-16
  const kp=g?._keypoints, wheels=kp?.wheels??[], roofPts=kp?.roofline??[], sillPts=kp?.sill??[]
  const roofTopNY = roofPts.length ? Math.min(...roofPts.map(p=>p.ny)) : 0.15
  const sillNY    = sillPts.length ? sillPts.reduce((s,p)=>s+p.ny,0)/sillPts.length : 0.80
  const trackFrac = wheels.length>=2 ? Math.abs(wheels[1].nx-wheels[0].nx) : 0.48
  const bw = Math.round(Math.min(110,Math.max(70,trackFrac*W*1.1)))
  const bh = Math.round(Math.min(130,Math.max(75,(sillNY-roofTopNY)*H*1.15)))
  const bodyBot=gY-bh*0.08, bodyTop=bodyBot-bh
  const wsAngle=g?.wsAngleDeg??58
  const roofNarrow=Math.max(0.28,Math.min(0.46,0.38-(wsAngle-55)*0.003))
  const roofHW=bw*roofNarrow, shoulderHW=bw*0.50, sillHW=bw*0.46
  const shoulderY=bodyTop+bh*0.55, sillY=bodyTop+bh*0.92
  const frontPath=[`M ${cx} ${bodyTop}`,`C ${cx-roofHW*0.6} ${bodyTop} ${cx-shoulderHW} ${shoulderY-bh*0.22} ${cx-shoulderHW} ${shoulderY}`,`C ${cx-shoulderHW} ${shoulderY+bh*0.12} ${cx-sillHW} ${sillY} ${cx-sillHW*0.80} ${bodyBot}`,`L ${cx+sillHW*0.80} ${bodyBot}`,`C ${cx+sillHW} ${sillY} ${cx+shoulderHW} ${shoulderY+bh*0.12} ${cx+shoulderHW} ${shoulderY}`,`C ${cx+shoulderHW} ${shoulderY-bh*0.22} ${cx+roofHW*0.6} ${bodyTop} ${cx} ${bodyTop}`,'Z'].join(' ')
  const aBY=bodyTop+bh*0.55, aTY=bodyTop+bh*0.08, aBHW=shoulderHW*0.86, aTHW=roofHW*0.92
  const wscPath=[`M ${cx-aTHW} ${aTY}`,`Q ${cx} ${aTY-2} ${cx+aTHW} ${aTY}`,`L ${cx+aBHW} ${aBY}`,`L ${cx-aBHW} ${aBY}`,'Z'].join(' ')
  const wR=wheels.length>=1?Math.max(12,Math.min(24,wheels[0].r/800*W*0.9)):16
  const w1x=cx-shoulderHW*1.05, w2x=cx+shoulderHW*1.05, wY=gY-wR
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',height:'100%'}} preserveAspectRatio="xMidYMid meet">
      <ellipse cx={cx} cy={gY+5} rx={shoulderHW*1.2} ry={7} fill="rgba(0,0,0,0.4)"/>
      <line x1={12} y1={gY} x2={W-12} y2={gY} stroke="rgba(255,255,255,0.06)" strokeWidth="1.5"/>
      <path d={frontPath} fill="none" stroke="rgba(10,132,255,0.7)" strokeWidth="1.2"/>
      <path d={wscPath}   fill="none" stroke="rgba(10,132,255,0.4)" strokeWidth="0.9"/>
      {[-1,1].map(s=><path key={s} d={`M ${cx+s*aTHW} ${aTY} L ${cx+s*aBHW} ${aBY}`} stroke="rgba(10,132,255,0.3)" strokeWidth="1.5" strokeLinecap="round"/>)}
      {[[w1x,wY],[w2x,wY]].map(([wcx,wcy],i)=>(
        <g key={i}>
          <circle cx={wcx} cy={wcy} r={wR}     fill="none" stroke="rgba(10,132,255,0.9)" strokeWidth="1.5"/>
          <circle cx={wcx} cy={wcy} r={wR*0.5} fill="none" stroke="rgba(10,132,255,0.35)" strokeWidth="0.8"/>
        </g>
      ))}
      <text x={cx} y={H-3} textAnchor="middle" fill="rgba(255,255,255,0.15)" fontSize="9" fontFamily="'IBM Plex Mono',monospace" letterSpacing="0.12em">FRONT</text>
    </svg>
  )
}

// ── TopView ───────────────────────────────────────────────────────────────────
function TopView({ g, yawAngle }) {
  const W=320,H=240,cx=W/2,cy=H/2+6
  const kp=g?._keypoints,wheels=kp?.wheels??[]
  const bl=Math.round(Math.min(180,Math.max(130,(g?.aspectRatio??2.0)*72))),bw=70
  const hoodEnd=cy+bl*((g?.hoodRatio??0.28)-0.50), cabinEnd=cy+bl*((g?.hoodRatio??0.28)+(g?.cabinRatio??0.44)-0.50)
  const ghW=bw*0.41
  const fwy=wheels.length>=1?cy+bl*(wheels[0].nx*1.1-0.55):cy+bl*((g?.w1??0.22)-0.50)
  const rwy=wheels.length>=2?cy+bl*(wheels[1].nx*1.1-0.55):cy+bl*((g?.w2??0.76)-0.50)
  const wR=wheels.length>=1?Math.max(8,Math.min(18,wheels[0].r/800*W*0.9)):10,wTrack=bw*0.52
  const body=[`M ${cx} ${cy-bl/2+5}`,`Q ${cx-bw*0.24} ${cy-bl/2+1} ${cx-bw*0.48} ${cy-bl/2+22}`,`Q ${cx-bw*0.50} ${cy-bl/2+52} ${cx-bw*0.50} ${cy}`,`Q ${cx-bw*0.50} ${cy+bl*0.12} ${cx-bw*0.44} ${cy+bl/2-10}`,`Q ${cx-bw*0.30} ${cy+bl/2-2} ${cx} ${cy+bl/2-2}`,`Q ${cx+bw*0.30} ${cy+bl/2-2} ${cx+bw*0.44} ${cy+bl/2-10}`,`Q ${cx+bw*0.50} ${cy+bl*0.12} ${cx+bw*0.50} ${cy}`,`Q ${cx+bw*0.50} ${cy-bl/2+52} ${cx+bw*0.48} ${cy-bl/2+22}`,`Q ${cx+bw*0.24} ${cy-bl/2+1} ${cx} ${cy-bl/2+5}`,'Z'].join(' ')
  const ghPath=[`M ${cx} ${hoodEnd-4}`,`Q ${cx-ghW*0.50} ${hoodEnd+2} ${cx-ghW*0.52} ${hoodEnd+16}`,`L ${cx-ghW*0.52} ${cabinEnd-10}`,`Q ${cx-ghW*0.44} ${cabinEnd} ${cx} ${cabinEnd}`,`Q ${cx+ghW*0.44} ${cabinEnd} ${cx+ghW*0.52} ${cabinEnd-10}`,`L ${cx+ghW*0.52} ${hoodEnd+16}`,`Q ${cx+ghW*0.50} ${hoodEnd+2} ${cx} ${hoodEnd-4}`,'Z'].join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',height:'100%'}} preserveAspectRatio="xMidYMid meet">
      <path d={body}   fill="none" stroke="rgba(10,132,255,0.65)" strokeWidth="1.1"/>
      <path d={ghPath} fill="none" stroke="rgba(10,132,255,0.35)" strokeWidth="0.9"/>
      {[[-wTrack,fwy],[wTrack,fwy],[-wTrack,rwy],[wTrack,rwy]].map(([wx,wy],i)=>(
        <ellipse key={i} cx={cx+wx} cy={wy} rx={wR*0.45} ry={wR} fill="none" stroke="rgba(10,132,255,0.7)" strokeWidth="1.2"/>
      ))}
      <text x={cx} y={H-4} textAnchor="middle" fill="rgba(255,255,255,0.15)" fontSize="9" fontFamily="'IBM Plex Mono',monospace" letterSpacing="0.12em">TOP</text>
    </svg>
  )
}

// ── UnderView ─────────────────────────────────────────────────────────────────
function UnderView({ g }) {
  const W=320,H=240,cx=W/2,cy=H/2+6
  const kp=g?._keypoints,wheels=kp?.wheels??[]
  const bl=Math.round(Math.min(180,Math.max(130,(g?.aspectRatio??2.0)*72))),bw=70
  const fwy=wheels.length>=1?cy+bl*(wheels[0].nx*1.1-0.55):cy+bl*((g?.w1??0.22)-0.50)
  const rwy=wheels.length>=2?cy+bl*(wheels[1].nx*1.1-0.55):cy+bl*((g?.w2??0.76)-0.50)
  const wR=wheels.length>=1?Math.max(8,Math.min(18,wheels[0].r/800*W*0.9)):10,wTrack=bw*0.52
  const diffY=cy+bl/2-bl*0.14
  const body=[`M ${cx} ${cy-bl/2+5}`,`Q ${cx-bw*0.24} ${cy-bl/2+1} ${cx-bw*0.48} ${cy-bl/2+22}`,`L ${cx-bw*0.50} ${cy+bl*0.08}`,`Q ${cx-bw*0.48} ${cy+bl/2-12} ${cx-bw*0.42} ${cy+bl/2-3}`,`L ${cx+bw*0.42} ${cy+bl/2-3}`,`Q ${cx+bw*0.48} ${cy+bl/2-12} ${cx+bw*0.50} ${cy+bl*0.08}`,`L ${cx+bw*0.48} ${cy-bl/2+22}`,`Q ${cx+bw*0.24} ${cy-bl/2+1} ${cx} ${cy-bl/2+5}`,'Z'].join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',height:'100%'}} preserveAspectRatio="xMidYMid meet">
      <path d={body} fill="none" stroke="rgba(10,132,255,0.65)" strokeWidth="1.1"/>
      <rect x={cx-bw*0.28} y={cy-bl*0.35} width={bw*0.56} height={bl*0.62} rx="3" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="0.8"/>
      <path d={`M ${cx-bw*0.38} ${diffY} L ${cx-bw*0.42} ${cy+bl/2-3} L ${cx+bw*0.42} ${cy+bl/2-3} L ${cx+bw*0.38} ${diffY} Z`} fill="none" stroke="rgba(10,132,255,0.4)" strokeWidth="0.9"/>
      {[[-wTrack,fwy],[wTrack,fwy],[-wTrack,rwy],[wTrack,rwy]].map(([wx,wy],i)=>(
        <ellipse key={i} cx={cx+wx} cy={wy} rx={wR*0.45} ry={wR} fill="none" stroke="rgba(10,132,255,0.7)" strokeWidth="1.2"/>
      ))}
      <text x={cx} y={H-4} textAnchor="middle" fill="rgba(255,255,255,0.15)" fontSize="9" fontFamily="'IBM Plex Mono',monospace" letterSpacing="0.12em">UNDERSIDE</text>
    </svg>
  )
}

// ── Section label ─────────────────────────────────────────────────────────────
function SL({ n, t }) {
  return (
    <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
      <span style={{fontSize:9,fontWeight:700,color:'var(--blue)',fontFamily:"'IBM Plex Mono'"}}>{n}</span>
      <div style={{flex:1,height:0.5,background:'var(--sep)'}}/>
      <span style={{fontSize:9,fontWeight:600,color:'var(--text-quaternary)',letterSpacing:'0.08em',textTransform:'uppercase'}}>{t}</span>
    </div>
  )
}

const VIEWS = [{id:'side',label:'Side'},{id:'front',label:'Front'},{id:'top',label:'Top'},{id:'under',label:'Underside'}]

export default function Views2DPage() {
  const [dragOver,       setDragOver]       = useState(false)
  const [file,           setFile]           = useState(null)
  const [preview,        setPreview]        = useState(null)
  const [stage,          setStage]          = useState('idle')
  const [traceProgress,  setTraceProgress]  = useState(null)
  const [traceAnimating, setTraceAnimating] = useState(false)
  const [geo,            setGeo]            = useState(null)
  const [error,          setError]          = useState(null)
  const [activeView,     setActiveView]     = useState('side')
  const [showSep,        setShowSep]        = useState(true)
  const [yawAngle,       setYawAngle]       = useState(0)
  const [urlInput,       setUrlInput]       = useState('')
  const [urlError,       setUrlError]       = useState('')
  const [urlMode,        setUrlMode]        = useState(false)
  const [analysisMode,   setAnalysisMode]   = useState('A')
  const svgRef  = useRef(null)
  const fileRef = useRef(null)

  const acceptFile = useCallback((f) => {
    if (!f || !f.type.startsWith('image/')) return
    setFile(f); setPreview(URL.createObjectURL(f))
    setGeo(null); setError(null); setTraceProgress(null); setTraceAnimating(false)
    setStage('ready'); setUrlError('')
  }, [])

  const acceptUrl = useCallback(async (url) => {
    const trimmed = url?.trim(); if (!trimmed) return
    setUrlError(''); setGeo(null); setStage('idle')
    try {
      setUrlError('Fetching image…')
      const f = await fetchImageFromUrl(trimmed)
      setFile(f); setPreview(URL.createObjectURL(f))
      setUrlInput(''); setUrlMode(false); setStage('ready'); setUrlError('')
    } catch(e) {
      setUrlError(e.message); setStage('idle')
    }
  }, [])

  const handlePaste = useCallback((e) => {
    const items = Array.from(e.clipboardData?.items ?? [])
    const imgItem = items.find(i=>i.type.startsWith('image/'))
    if (imgItem) { acceptFile(imgItem.getAsFile()); return }
    const text = e.clipboardData?.getData('text') ?? ''
    if (/^https?:\/\//i.test(text)) acceptUrl(text)
  }, [acceptFile, acceptUrl])

  useEffect(() => {
    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [handlePaste])

  const run = async () => {
    if (!file) return
    setError(null); setGeo(null); setTraceAnimating(false)
    setTraceProgress({ pct: 2, msg: 'Preparing image…', pts: [] })
    setStage('analyzing')

    let uploadFile
    try {
      uploadFile = await prepareImage(file)
      console.log(`[StatCFD] Prepared: ${(file.size/1024).toFixed(0)}KB → ${(uploadFile.size/1024).toFixed(0)}KB`)
    } catch(e) { uploadFile = file }

    let jobId = null
    const MAX_ATTEMPTS = 8
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      setTraceProgress({
        pct: 5,
        msg: attempt === 0 ? 'Connecting to server…' : `Retrying… (${attempt*5}s elapsed)`,
        pts: [],
      })
      try {
        const fd = new FormData()
        fd.append('file', uploadFile)
        fd.append('mode', analysisMode)
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 25000)
        let res
        try {
          res = await fetch(`${API_BASE}/analyze-contour/start`, {
            method:'POST', body:fd, signal:controller.signal,
          })
        } finally { clearTimeout(timer) }
        if (res.ok) { jobId = (await res.json()).job_id; break }
        const text = await res.text().catch(()=>'')
        setError(`Server error ${res.status}${text?': '+text.slice(0,120):''}`)
        setTraceAnimating(false); setStage('idle'); setTraceProgress(null); return
      } catch(e) {
        if (attempt >= MAX_ATTEMPTS-1) {
          setError(`Could not reach server after ${MAX_ATTEMPTS*5}s. Check https://huggingface.co/spaces/rutejtalati16/Aeronet`)
          setTraceAnimating(false); setStage('idle'); setTraceProgress(null); return
        }
        await new Promise(r=>setTimeout(r,5000))
      }
    }
    if (!jobId) { setError('Failed to start job.'); setTraceAnimating(false); setStage('idle'); setTraceProgress(null); return }

    setTraceAnimating(true)
    setTraceProgress({ pct: 10, msg: 'Job queued — preprocessing image…', pts: [] })

    const startTime = Date.now()
    while (true) {
      await new Promise(r=>setTimeout(r,3000))
      const elapsed = Math.round((Date.now()-startTime)/1000)
      let poll
      try {
        const pc = new AbortController(); const pt = setTimeout(()=>pc.abort(),10000)
        let res
        try { res = await fetch(`${API_BASE}/analyze-contour/result/${jobId}`,{signal:pc.signal}) }
        finally { clearTimeout(pt) }
        if (!res.ok) { setError(`Poll error ${res.status}`); setTraceAnimating(false); setStage('idle'); setTraceProgress(null); return }
        poll = await res.json()
      } catch(e) { setError(`Connection lost: ${e.message}`); setTraceAnimating(false); setStage('idle'); setTraceProgress(null); return }

      if (poll.status==='error') { setError(poll.error??'Analysis failed'); setTraceAnimating(false); setStage('idle'); setTraceProgress(null); return }
      if (poll.status==='running'||poll.status==='pending') {
        const pct = Math.min(88, 10+elapsed*1.2)
        const stageMsg = elapsed < 10 ? 'Preprocessing & YOLO detection…'
          : elapsed < 25 ? 'SAM2 boundary refinement…'
          : elapsed < 40 ? 'Contour extraction & smoothing…'
          : elapsed < 60 ? (analysisMode!=='A' ? 'Panel detection running…' : 'Finalising outline…')
          : analysisMode==='C' ? 'Moondream2 aero analysis…'
          : 'Almost done…'
        setTraceProgress({ pct:Math.round(pct), msg:`${stageMsg} ${elapsed}s`, pts:[] })
        continue
      }
      if (poll.status==='done') {
        const result = poll.result
        if (!result?.geometry) { setError('No vehicle outline found. Use a clear side-on photo.'); setTraceAnimating(false); setStage('idle'); setTraceProgress(null); return }
        const allPts = result.smooth_pts ?? []
        if (allPts.length > 0) {
          const steps=30, delay=1500/steps; setTraceAnimating(true)
          for (let step=0;step<=steps;step++) {
            setTimeout(()=>{
              const visible = Math.round((step/steps)*allPts.length)
              setTraceProgress({pct:100,msg:step<steps?`Tracing outline… ${Math.round(step/steps*100)}%`:'Done ✓',pts:allPts.slice(0,visible),done:step===steps})
              if (step===steps){setTraceAnimating(false);setTraceProgress(null)}
            }, step*delay)
          }
        } else { setTraceAnimating(false); setTraceProgress(null) }
        const cg=result.geometry
        setGeo({
          aspectRatio:cg.aspectRatio??2.0,hoodRatio:cg.hoodRatio??0.28,
          cabinRatio:cg.cabinRatio??0.44,bootRatio:cg.bootRatio??0.28,
          wsAngleDeg:cg.wsAngleDeg??58,rearDrop:cg.rearDrop??0.15,
          cabinH:cg.cabinH??0.58,rideH:cg.rideH??0.08,
          w1:cg.w1??0.22,w2:cg.w2??0.76,confidence:cg.confidence??0.97,
          _contourPts: result.technical_outline_pts ?? result.outline_pts,
          _smoothPts:  result.display_outline_pts ?? result.smooth_pts,
          _catmullCps: null,
          _catmullPts: result.display_outline_pts ?? result.smooth_pts,
          _bboxAspect: result.bbox?result.bbox.w/Math.max(1,result.bbox.h):undefined,
          _keypoints:  result.keypoints,_method:result.method,
          _panels:     result.panels??null,_aero:result.aero??null,
          _quality:     result.quality??null,
          _engineering: result.engineering??null,
          ahmedRegime:        result.geometry?.ahmedRegime,
          rearSlantAngleDeg:  result.geometry?.rearSlantAngleDeg,
          CdA:                result.geometry?.CdA,
          rearSlantAngleDeg:cg.rearSlantAngleDeg??20,
          ahmedRegime:cg.ahmedRegime??'intermediate',
          Cd:cg.Cd??0, CdA:cg.CdA??0,
          wheelbaseNorm:cg.wheelbaseNorm??0,
          separationPointX:cg.separationPointX??0.75,
        })
        setStage('done'); return
      }
    }
  }

  const exportSVG = () => {
    const svg=svgRef.current?.querySelector('svg'); if(!svg) return
    const a=document.createElement('a')
    a.href=URL.createObjectURL(new Blob([svg.outerHTML],{type:'image/svg+xml'}))
    a.download=`statcfd_${activeView}.svg`; a.click()
  }

  const isRunning = stage==='analyzing'

  const card = {background:'var(--bg1)',borderRadius:10,border:'0.5px solid rgba(255,255,255,0.06)',overflow:'hidden'}
  const darkCard = {background:'var(--bg1)',borderRadius:10,border:'0.5px solid rgba(255,255,255,0.06)',overflow:'hidden'}

  return (
    <div style={{display:'flex',height:'100%',overflow:'hidden',background:'var(--bg0)'}}>

      {/* ── LEFT PANEL ── */}
      <div style={{width:240,flexShrink:0,display:'flex',flexDirection:'column',
        borderRight:'0.5px solid var(--sep)',overflow:'hidden',background:'var(--bg0)'}}>
        <div style={{flex:1,overflowY:'auto',padding:'16px 14px'}}>

          <SL n="01" t="Upload"/>

          {/* Drop zone */}
          <div
            onDragOver={e=>{e.preventDefault();setDragOver(true)}}
            onDragLeave={()=>setDragOver(false)}
            onDrop={e=>{
              e.preventDefault();setDragOver(false)
              const f=e.dataTransfer.files?.[0]
              if(f){acceptFile(f);return}
              const url=e.dataTransfer.getData('text/uri-list')||e.dataTransfer.getData('text/plain')
              if(url&&/^https?:\/\//i.test(url))acceptUrl(url)
            }}
            onClick={()=>fileRef.current?.click()}
            style={{borderRadius:10,border:`0.5px dashed ${dragOver?'var(--blue)':'rgba(255,255,255,0.12)'}`,
              background:dragOver?'rgba(10,132,255,0.06)':'var(--bg1)',cursor:'pointer',
              overflow:'hidden',minHeight:120,transition:'all 0.15s',marginBottom:8,
              display:'flex',flexDirection:'column'}}>
            <input ref={fileRef} type="file" accept="image/*" style={{display:'none'}}
              onChange={e=>acceptFile(e.target.files[0])}/>
            {preview ? (
              <div style={{position:'relative'}}>
                <img src={preview} alt="preview" style={{width:'100%',display:'block',borderRadius:10}}/>
                <div style={{position:'absolute',bottom:6,left:0,right:0,textAlign:'center'}}>
                  <span style={{fontSize:10,color:'#fff',background:'rgba(0,0,0,0.55)',
                    padding:'2px 10px',borderRadius:20}}>click to change</span>
                </div>
              </div>
            ) : (
              <div style={{display:'flex',flexDirection:'column',alignItems:'center',
                justifyContent:'center',gap:8,padding:'24px 16px',flex:1}}>
                <div style={{width:40,height:40,borderRadius:10,background:'var(--bg2)',
                  border:'0.5px solid var(--sep)',display:'flex',alignItems:'center',justifyContent:'center'}}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5">
                    <rect x="3" y="3" width="18" height="18" rx="3"/>
                    <circle cx="8.5" cy="8.5" r="1.5"/>
                    <path d="M21 15l-5-5L5 21"/>
                  </svg>
                </div>
                <span style={{fontSize:12,color:'var(--text-tertiary)',textAlign:'center'}}>Drop image or file</span>
                <span style={{fontSize:9,color:'var(--text-quaternary)',fontFamily:"'IBM Plex Mono'",
                  textAlign:'center',lineHeight:1.7}}>
                  JPG · PNG · WEBP<br/>
                  <span style={{color:'rgba(255,255,255,0.18)'}}>Ctrl+V · drag URL</span>
                </span>
              </div>
            )}
          </div>

          {/* URL input */}
          <div style={{marginBottom:10}}>
            {urlMode ? (
              <div style={{display:'flex',flexDirection:'column',gap:5}}>
                <div style={{display:'flex',gap:4}}>
                  <input autoFocus value={urlInput} onChange={e=>setUrlInput(e.target.value)}
                    onKeyDown={e=>{if(e.key==='Enter')acceptUrl(urlInput);if(e.key==='Escape')setUrlMode(false)}}
                    placeholder="https://example.com/car.jpg"
                    style={{flex:1,background:'var(--bg2)',border:`0.5px solid ${urlError&&urlError!=='Fetching image…'?'var(--red)':'rgba(255,255,255,0.12)'}`,
                      borderRadius:7,padding:'6px 9px',color:'var(--text-primary)',fontSize:11,outline:'none',
                      fontFamily:"'IBM Plex Mono',monospace"}}/>
                  <button onClick={()=>acceptUrl(urlInput)}
                    style={{padding:'0 10px',borderRadius:7,border:'none',cursor:'pointer',
                      background:'#0A84FF',color:'#fff',fontSize:11,fontWeight:600}}>Go</button>
                  <button onClick={()=>{setUrlMode(false);setUrlError('')}}
                    style={{padding:'0 8px',borderRadius:7,border:'1px solid rgba(0,0,0,0.12)',
                      cursor:'pointer',background:'#fff',color:'var(--text-quaternary)',fontSize:11}}>✕</button>
                </div>
                {urlError && (
                  <span style={{fontSize:10,color:urlError==='Fetching image…'?'#0A84FF':'#ff3b30'}}>
                    {urlError}
                  </span>
                )}
              </div>
            ) : (
              <button onClick={()=>setUrlMode(true)}
                style={{width:'100%',height:30,borderRadius:7,border:'1px solid rgba(0,0,0,0.1)',
                  background:'#fafafa',cursor:'pointer',color:'var(--text-quaternary)',fontSize:11,
                  display:'flex',alignItems:'center',justifyContent:'center',gap:5,transition:'all 0.12s'}}
                onMouseEnter={e=>e.currentTarget.style.borderColor='#0A84FF'}
                onMouseLeave={e=>e.currentTarget.style.borderColor='rgba(0,0,0,0.1)'}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                </svg>
                Load from URL
              </button>
            )}
          </div>

          {file && (
            <div style={{...card,padding:'7px 11px',display:'flex',justifyContent:'space-between',
              alignItems:'center',marginBottom:10}}>
              <span style={{fontSize:11,color:'var(--text-secondary)',overflow:'hidden',textOverflow:'ellipsis',
                whiteSpace:'nowrap',flex:1}}>{file.name}</span>
              <span style={{fontSize:9,fontFamily:"'IBM Plex Mono'",color:'var(--text-quaternary)',marginLeft:6,flexShrink:0}}>
                {(file.size/1024).toFixed(0)} KB
              </span>
            </div>
          )}

          {/* Analysis Mode selector */}
          <div style={{marginBottom:12}}>
            <div style={{fontSize:9,color:'var(--text-quaternary)',marginBottom:6,textTransform:'uppercase',
              letterSpacing:'0.08em',fontFamily:"'IBM Plex Mono'",fontWeight:600}}>Analysis Mode</div>
            <div style={{display:'flex',flexDirection:'column',gap:3}}>
              {[
                {id:'A',label:'Silhouette',  desc:'~30s · outline only',         icon:'◎'},
                {id:'B',label:'Panels',      desc:'~90s · lines + markers',       icon:'⊞'},
                {id:'C',label:'Full Aero',   desc:'~150s · panels + ΔCd + ID',   icon:'⬡'},
              ].map(m=>(
                <button key={m.id} onClick={()=>setAnalysisMode(m.id)}
                  style={{display:'flex',alignItems:'center',gap:8,padding:'7px 10px',borderRadius:8,
                    border:`0.5px solid ${analysisMode===m.id?'rgba(10,132,255,0.6)':'rgba(255,255,255,0.08)'}`,
                    background:analysisMode===m.id?'rgba(10,132,255,0.12)':'transparent',
                    cursor:'pointer',textAlign:'left',transition:'all 0.12s'}}>
                  <span style={{fontSize:13,color:analysisMode===m.id?'var(--blue)':'rgba(255,255,255,0.3)'}}>{m.icon}</span>
                  <div>
                    <div style={{fontSize:11,fontWeight:600,color:analysisMode===m.id?'var(--blue)':'rgba(255,255,255,0.6)'}}>{m.label}</div>
                    <div style={{fontSize:9,color:'var(--text-quaternary)',fontFamily:"'IBM Plex Mono'"}}>{m.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Run button */}
          <button onClick={run} disabled={!file||isRunning}
            style={{width:'100%',height:40,borderRadius:10,border:'none',marginBottom:12,
              background:!file||isRunning?'rgba(255,255,255,0.05)':'var(--blue)',
              color:!file||isRunning?'rgba(255,255,255,0.3)':'#fff',
              fontSize:13,fontWeight:600,cursor:!file||isRunning?'not-allowed':'pointer',
              display:'flex',alignItems:'center',justifyContent:'center',gap:6,
              transition:'all 0.15s',boxShadow:!file||isRunning?'none':'0 2px 8px rgba(10,132,255,0.3)'}}>
            {isRunning
              ? <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                  style={{animation:'spin 1s linear infinite'}}><path d="M12 3a9 9 0 019 9"/></svg>Analysing…</>
              : <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polygon points="5 3 19 12 5 21 5 3"/></svg>Analyse Vehicle</>
            }
          </button>

          <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>

          {error && (
            <div style={{borderRadius:8,padding:'8px 11px',background:'rgba(255,69,58,0.08)',
              border:'0.5px solid rgba(255,69,58,0.3)',color:'var(--red)',fontSize:11,marginBottom:10,lineHeight:1.5}}>
              {error}
            </div>
          )}

          {geo && (
            <>
              <SL n="02" t="Result"/>
              <div style={{...card,padding:'9px 11px',marginBottom:10}}>
                {[
                  ['Method',   geo._method??'—'],
                  ['Points',   (geo._contourPts?.length??0)+' pt'],
                  ['Wheels',   (geo._keypoints?.wheels?.length??0)+' found'],
                  ['Aspect',   (geo.aspectRatio??0).toFixed(2)],
                  ['WS rake',  (geo.wsAngleDeg??0).toFixed(0)+'°'],
                  ['Rear slant',(geo.rearSlantAngleDeg??0).toFixed(0)+'°'],
                  ['Ahmed',    geo.ahmedRegime??'—'],
                  ['Cd est.',  (geo.Cd??0).toFixed(3)],
                  ['CdA',      (geo.CdA??0).toFixed(4)],
                ].map(([k,v])=>(
                  <div key={k} style={{display:'flex',justifyContent:'space-between',fontSize:11,
                    padding:'3px 0',borderBottom:'0.5px solid rgba(255,255,255,0.04)'}}>
                    <span style={{color:'var(--text-quaternary)',fontFamily:"'IBM Plex Mono'"}}>{k}</span>
                    <span style={{color:'#0A84FF',fontFamily:"'IBM Plex Mono'",fontWeight:600}}>{v}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── CENTRE: canvas ── */}
      <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>

        {/* Toolbar */}
        <div style={{display:'flex',alignItems:'center',gap:6,padding:'7px 12px',
          borderBottom:'0.5px solid rgba(0,0,0,0.1)',flexShrink:0,
          background:'rgba(0,0,0,0.4)',flexWrap:'wrap'}}>
          <div style={{display:'flex',gap:2}}>
            {VIEWS.map(v=>(
              <button key={v.id} onClick={()=>setActiveView(v.id)}
                style={{padding:'4px 12px',borderRadius:7,border:'none',cursor:'pointer',
                  background:activeView===v.id?'rgba(10,132,255,0.18)':'transparent',
                  color:activeView===v.id?'var(--blue)':'rgba(255,255,255,0.38)',
                  fontSize:12,fontWeight:activeView===v.id?600:400,transition:'all 0.12s'}}>
                {v.label}
              </button>
            ))}
          </div>
          <div style={{width:0.5,height:14,background:'rgba(0,0,0,0.1)'}}/>
          <button onClick={()=>setShowSep(p=>!p)}
            style={{padding:'3px 10px',borderRadius:6,fontSize:11,fontWeight:500,cursor:'pointer',
              border:`1px solid ${showSep?'#0A84FF':'rgba(0,0,0,0.1)'}`,
              background:showSep?'rgba(10,132,255,0.08)':'transparent',
              color:showSep?'#0A84FF':'rgba(0,0,0,0.4)'}}>Sep</button>
          <button onClick={exportSVG}
            style={{marginLeft:'auto',padding:'4px 12px',borderRadius:7,
              border:'1px solid rgba(0,0,0,0.1)',background:'transparent',
              color:'var(--text-quaternary)',fontSize:11,cursor:'pointer',transition:'all 0.12s'}}
            onMouseEnter={e=>e.currentTarget.style.color='var(--blue)'}
            onMouseLeave={e=>e.currentTarget.style.color='var(--text-quaternary)'}>
            Export SVG
          </button>
        </div>

        {/* Dark canvas */}
        <div ref={svgRef} style={{flex:1,display:'flex',flexDirection:'column',
          padding:'14px',gap:10,overflow:'hidden',background:'#030608'}}>
          {!geo && !isRunning && !traceProgress ? (
            <div style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',
              justifyContent:'center',gap:16}}>
              <div style={{width:60,height:60,borderRadius:16,background:'rgba(255,255,255,0.04)',
                border:'0.5px solid rgba(255,255,255,0.08)',display:'flex',alignItems:'center',justifyContent:'center'}}>
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5">
                  <path d="M2 12c0-5.5 4.5-10 10-10s10 4.5 10 10-4.5 10-10 10S2 17.5 2 12z"/>
                  <path d="M12 8v4l3 3"/>
                </svg>
              </div>
              <div style={{textAlign:'center',maxWidth:360}}>
                <div style={{fontSize:14,fontWeight:600,color:'rgba(255,255,255,0.6)',marginBottom:6}}>
                  YOLO Vehicle Outline
                </div>
                <div style={{fontSize:11,color:'rgba(255,255,255,0.25)',lineHeight:1.7}}>
                  Upload a side-on photo or paste a URL.<br/>
                  Choose analysis mode then click Analyse.
                </div>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:5,flexWrap:'wrap',justifyContent:'center'}}>
                {['Preprocessor','YOLOv8x-seg','SAM2','2000pt contour','Catmull-Rom','Florence-2','Moondream2'].map((s,i,a)=>(
                  <span key={i} style={{display:'flex',alignItems:'center',gap:4}}>
                    <span style={{padding:'2px 8px',borderRadius:5,border:'0.5px solid rgba(255,255,255,0.1)',
                      fontSize:9,fontFamily:"'IBM Plex Mono'",color:'rgba(255,255,255,0.3)',
                      background:'rgba(255,255,255,0.03)'}}>{s}</span>
                    {i<a.length-1&&<span style={{fontSize:9,color:'rgba(255,255,255,0.15)'}}>→</span>}
                  </span>
                ))}
              </div>
            </div>
          ) : isRunning && traceProgress ? (
            <div style={{flex:1}}>
              <PipelineLoader pct={traceProgress.pct} msg={traceProgress.msg} mode={analysisMode}/>
            </div>
          ) : (
            <>
              {/* ── FIX: maxHeight increased from 295 → 340 to match taller SVG (CH=310) */}
              <div style={{flex:1,background:'#070d14',borderRadius:12,
                border:'0.5px solid rgba(255,255,255,0.06)',display:'flex',
                alignItems:'center',justifyContent:'center',padding:'12px',overflow:'hidden'}}>
                <div style={{width:'100%',height:'100%',maxHeight:345}}>
                  {activeView==='side'  && <SideView g={geo} showSep={showSep} mode={analysisMode}
                    traceProgress={traceProgress} traceAnimating={traceAnimating}/>}
                  {activeView==='front' && <FrontView g={geo}/>}
                  {activeView==='top'   && <TopView   g={geo} yawAngle={yawAngle}/>}
                  {activeView==='under' && <UnderView g={geo}/>}
                </div>
              </div>
              {/* Thumbnails */}
              <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8,flexShrink:0}}>
                {VIEWS.map(v=>(
                  <button key={v.id} onClick={()=>setActiveView(v.id)}
                    style={{borderRadius:10,
                      border:`1px solid ${activeView===v.id?'rgba(10,132,255,0.5)':'rgba(255,255,255,0.06)'}`,
                      background:activeView===v.id?'rgba(10,132,255,0.08)':'rgba(255,255,255,0.02)',
                      overflow:'hidden',cursor:'pointer',padding:4,transition:'all 0.15s'}}>
                    <div style={{width:'100%',aspectRatio:'5/3',pointerEvents:'none'}}>
                      {v.id==='side'  && <SideView  g={geo} showSep={false} showPanels={false}/>}
                      {v.id==='front' && <FrontView g={geo}/>}
                      {v.id==='top'   && <TopView   g={geo} yawAngle={0}/>}
                      {v.id==='under' && <UnderView g={geo}/>}
                    </div>
                    <div style={{fontSize:10,color:activeView===v.id?'#0A84FF':'rgba(255,255,255,0.25)',
                      textAlign:'center',padding:'3px 0',fontWeight:activeView===v.id?600:400}}>
                      {v.label}
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── RIGHT PANEL ── */}
      <div style={{width:210,flexShrink:0,borderLeft:'0.5px solid var(--sep)',
        overflowY:'auto',padding:'16px 14px',background:'#fff'}}>
        {geo ? (
          <>
            <SL n="03" t="Wheels"/>
            <div style={{...card,padding:'9px 11px',marginBottom:10}}>
              {(geo._keypoints?.wheels??[]).length===0 ? (
                <div style={{fontSize:11,color:'var(--text-quaternary)',textAlign:'center',padding:'6px 0'}}>
                  No wheels detected
                </div>
              ) : (geo._keypoints?.wheels??[]).map((w,i)=>(
                <div key={i} style={{marginBottom:7,paddingBottom:7,borderBottom:'0.5px solid rgba(255,255,255,0.04)'}}>
                  <div style={{fontSize:10,fontWeight:700,color:'#0A84FF',marginBottom:3,fontFamily:"'IBM Plex Mono'"}}>
                    Wheel {i+1}
                  </div>
                  {[
                    ['cx',     (w.nx*100).toFixed(1)+'%'],
                    ['cy',     (w.ny*100).toFixed(1)+'%'],
                    ['r',      (w.nr*100).toFixed(1)+'%'],
                    ['rim r',  w.nrr != null ? (w.nrr*100).toFixed(1)+'%' : '—'],
                    ['spokes', w.spokes != null ? String(w.spokes) : '—'],
                  ].map(([k,v])=>(
                    <div key={k} style={{display:'flex',justifyContent:'space-between',fontSize:10,padding:'1px 0'}}>
                      <span style={{color:'var(--text-quaternary)',fontFamily:"'IBM Plex Mono'"}}>{k}</span>
                      <span style={{color:'var(--text-secondary)',fontFamily:"'IBM Plex Mono'"}}>{v}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>

            <SL n="04" t="Geometry"/>
            <div style={{...card,padding:'9px 11px',marginBottom:10}}>
              {[
                ['Hood',      ((geo.hoodRatio??0)*100).toFixed(0)+'%'],
                ['Cabin',     ((geo.cabinRatio??0)*100).toFixed(0)+'%'],
                ['Boot',      ((geo.bootRatio??0)*100).toFixed(0)+'%'],
                ['Aspect',    (geo.aspectRatio??0).toFixed(2)],
                ['WS rake',   (geo.wsAngleDeg??0).toFixed(0)+'°'],
                ['Rear drop', ((geo.rearDrop??0)*100).toFixed(0)+'%'],
              ].map(([k,v])=>(
                <div key={k} style={{display:'flex',justifyContent:'space-between',fontSize:11,
                  padding:'3px 0',borderBottom:'0.5px solid rgba(255,255,255,0.04)'}}>
                  <span style={{color:'var(--text-quaternary)',fontFamily:"'IBM Plex Mono'"}}>{k}</span>
                  <span style={{color:'#0A84FF',fontFamily:"'IBM Plex Mono'",fontWeight:600}}>{v}</span>
                </div>
              ))}
            </div>

            <SL n="05" t="Quality"/>
            <div style={{...card,padding:'9px 11px',marginBottom:10}}>
              {geo._quality ? (
                <>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
                    <span style={{fontSize:11,fontWeight:700,
                      color: geo._quality.score>=90?'#30d158': geo._quality.score>=75?'#0A84FF': geo._quality.score>=55?'#ff9f0a':'#ff453a',
                      fontFamily:"'IBM Plex Mono'"}}>
                      {geo._quality.score}/100
                    </span>
                    <span style={{fontSize:9,color:'var(--text-quaternary)',textTransform:'uppercase',
                      letterSpacing:'0.06em',fontFamily:"'IBM Plex Mono'"}}>{geo._quality.status}</span>
                  </div>
                  <div style={{height:4,borderRadius:2,background:'var(--bg3)',marginBottom:8}}>
                    <div style={{height:'100%',borderRadius:2,
                      width:`${geo._quality.score}%`,
                      background: geo._quality.score>=90?'#30d158': geo._quality.score>=75?'#0A84FF': geo._quality.score>=55?'#ff9f0a':'#ff453a',
                      transition:'width 0.6s'}}/>
                  </div>
                  {geo._quality.warnings?.map((w,i)=>(
                    <div key={i} style={{fontSize:9,color:'#ff9f0a',fontFamily:"'IBM Plex Mono'",
                      padding:'2px 0',lineHeight:1.5,borderBottom:'0.5px solid rgba(255,255,255,0.04)'}}>
                      ⚠ {w}
                    </div>
                  ))}
                </>
              ) : (
                <div style={{fontSize:11,color:'var(--text-quaternary)',textAlign:'center'}}>—</div>
              )}
            </div>

            {/* Mode C: Aero ID */}
            {geo._aero && (
              <>
                <SL n="06" t="Aero ID"/>
                <div style={{...card,padding:'9px 11px',marginBottom:10}}>
                  <div style={{fontSize:12,fontWeight:700,color:'#0A84FF',marginBottom:6,fontFamily:"'IBM Plex Mono'"}}>{geo._aero.car_id}</div>
                  {[
                    ['Cd est.',  geo._aero.estimated_cd?.toFixed(3)?? '—'],
                    ['Body',     geo._aero.body_type??'—'],
                    ['Spoiler',  geo._aero.features?.spoiler??'—'],
                    ['Diffuser', geo._aero.features?.diffuser??'—'],
                    ['Grille',   geo._aero.features?.grille??'—'],
                  ].map(([k,v])=>(
                    <div key={k} style={{display:'flex',justifyContent:'space-between',fontSize:10,
                      padding:'2px 0',borderBottom:'0.5px solid rgba(255,255,255,0.04)'}}>
                      <span style={{color:'var(--text-quaternary)',fontFamily:"'IBM Plex Mono'"}}>{k}</span>
                      <span style={{color:'var(--text-secondary)',fontFamily:"'IBM Plex Mono'",textTransform:'capitalize'}}>{v}</span>
                    </div>
                  ))}
                </div>

                <SL n="07" t="Drag Regions"/>
                <div style={{...card,padding:'9px 11px',marginBottom:10}}>
                  {Object.entries(geo._aero.region_cd??{}).map(([region,val])=>(
                    <div key={region} style={{marginBottom:6}}>
                      <div style={{display:'flex',justifyContent:'space-between',fontSize:10,marginBottom:2}}>
                        <span style={{color:'var(--text-quaternary)',fontFamily:"'IBM Plex Mono'"}}>{region}</span>
                        <span style={{color:'#0A84FF',fontFamily:"'IBM Plex Mono'",fontWeight:600}}>
                          {(val*100).toFixed(1)}%
                        </span>
                      </div>
                      <div style={{height:3,borderRadius:2,background:'var(--bg3)'}}>
                        <div style={{height:'100%',borderRadius:2,background:'rgba(10,132,255,0.5)',
                          width:`${Math.min(100,(val/(geo._aero.estimated_cd??0.3))*100)}%`}}/>
                      </div>
                    </div>
                  ))}
                </div>

                {geo._aero.improvements?.length>0 && (
                  <>
                    <SL n="08" t="Improvements"/>
                    <div style={{...card,padding:'9px 11px'}}>
                      {geo._aero.improvements.map((imp,i)=>(
                        <div key={i} style={{fontSize:10,color:'var(--text-secondary)',padding:'3px 0',
                          borderBottom:'0.5px solid rgba(255,255,255,0.04)',lineHeight:1.5}}>
                          {i+1}. {imp}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}

            {/* Engineering data */}
            {geo._engineering?.shape_descriptors && (
              <>
                <SL n={geo._aero ? "09" : "06"} t="Shape"/>
                <div style={{...card,padding:'9px 11px',marginBottom:10}}>
                  {[
                    ['Hood slope',   (geo._engineering.shape_descriptors.hood_slope_deg??0).toFixed(1)+'°'],
                    ['Rear taper',   (geo._engineering.shape_descriptors.rear_taper_deg??0).toFixed(1)+'°'],
                    ['WS rake',      (geo._engineering.shape_descriptors.ws_rake_deg??0).toFixed(1)+'°'],
                    ['Roof curve',   (geo._engineering.shape_descriptors.roof_curvature_range??0).toFixed(3)],
                    ['Taper onset',  ((geo._engineering.shape_descriptors.taper_onset_x??0)*100).toFixed(0)+'%'],
                    ['GH ratio',     (geo._engineering.shape_descriptors.greenhouse_ratio??0).toFixed(3)],
                    ['CdA',          (geo.CdA??geo._engineering?.exports?.json_descriptor?.geometry?.cda_estimate??0).toFixed(4)],
                  ].map(([k,v])=>(
                    <div key={k} style={{display:'flex',justifyContent:'space-between',fontSize:10,
                      padding:'2px 0',borderBottom:'0.5px solid rgba(255,255,255,0.04)'}}>
                      <span style={{color:'var(--text-quaternary)',fontFamily:"'IBM Plex Mono'"}}>{k}</span>
                      <span style={{color:'var(--blue)',fontFamily:"'IBM Plex Mono'",fontWeight:600}}>{v}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* CFD Heuristics */}
            {geo._engineering?.cfd_heuristics && (
              <>
                <SL n={geo._aero ? "10" : "07"} t="CFD Hints"/>
                <div style={{...card,padding:'9px 11px',marginBottom:10}}>
                  {Object.entries(geo._engineering.cfd_heuristics)
                    .filter(([k]) => k !== 'ahmed_regime' && k !== 'note')
                    .map(([k,v])=>{
                      const label = k.replace(/_/g,' ').replace(/tendency|likelihood|fraction|factor/,'').trim()
                      const pct = Math.round(Number(v)*100)
                      return (
                        <div key={k} style={{marginBottom:5}}>
                          <div style={{display:'flex',justifyContent:'space-between',fontSize:9,marginBottom:2}}>
                            <span style={{color:'var(--text-quaternary)',fontFamily:"'IBM Plex Mono'",
                              textTransform:'capitalize'}}>{label}</span>
                            <span style={{color: pct>65?'#ff453a':pct>35?'#ff9f0a':'#30d158',
                              fontFamily:"'IBM Plex Mono'",fontWeight:600,fontSize:10}}>{pct}%</span>
                          </div>
                          <div style={{height:3,borderRadius:2,background:'rgba(255,255,255,0.06)'}}>
                            <div style={{height:'100%',borderRadius:2,
                              background: pct>65?'#ff453a':pct>35?'#ff9f0a':'#30d158',
                              width:`${pct}%`,transition:'width 0.4s'}}/>
                          </div>
                        </div>
                      )
                    })}
                </div>
              </>
            )}

            {/* Ahmed regime badge */}
            {geo.ahmedRegime && (
              <div style={{...card,padding:'8px 11px',marginBottom:10,
                display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <span style={{fontSize:10,color:'var(--text-quaternary)',fontFamily:"'IBM Plex Mono'"}}>Ahmed</span>
                <span style={{fontSize:10,fontWeight:700,fontFamily:"'IBM Plex Mono'",
                  color: geo.ahmedRegime==='critical'?'#ff453a':
                         geo.ahmedRegime==='separated'?'#ff9f0a':
                         geo.ahmedRegime==='attached'?'#30d158':'var(--blue)',
                  padding:'2px 8px',borderRadius:4,
                  background: geo.ahmedRegime==='critical'?'rgba(255,69,58,0.12)':
                              geo.ahmedRegime==='separated'?'rgba(255,159,10,0.12)':
                              geo.ahmedRegime==='attached'?'rgba(48,209,88,0.12)':'rgba(10,132,255,0.12)'}}>
                  {geo.ahmedRegime?.toUpperCase()} {geo.rearSlantAngleDeg?.toFixed(1)}°
                </span>
              </div>
            )}
          </>
        ) : (
          <div style={{display:'flex',alignItems:'center',justifyContent:'center',
            padding:'40px 0',textAlign:'center'}}>
            <span style={{fontSize:12,color:'var(--text-quaternary)'}}>Results appear here after analysis</span>
          </div>
        )}
      </div>
    </div>
  )
}
