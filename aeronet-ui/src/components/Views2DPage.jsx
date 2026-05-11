// Copyright (c) 2026 Rutej Talati. All rights reserved.

import { useCallback, useEffect, useRef, useState } from 'react'

// ── Proxy helper ──────────────────────────────────────────────────────────────
// All HuggingFace requests are routed through /api/relay?path=...
// This makes every request same-origin from the browser's perspective,
// bypassing corporate firewalls and CORS blocks on hf.space domains.
const proxyUrl = (path) => `/api/relay?path=${encodeURIComponent(path)}`

// ── Image compression ─────────────────────────────────────────────────────────
// HuggingFace free-tier nginx drops multipart uploads > ~1MB (ERR_CONNECTION_RESET).
// Compress to max 800px / JPEG 82% = ~100-200KB — plenty for YOLO detection.
async function compressImage(file, maxWidth = 800, quality = 0.82) {
  return new Promise((resolve) => {
    const img = new window.Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const scale  = Math.min(1, maxWidth / img.width)
      const w      = Math.round(img.width  * scale)
      const h      = Math.round(img.height * scale)
      const canvas = document.createElement('canvas')
      canvas.width  = w
      canvas.height = h
      canvas.getContext('2d').drawImage(img, 0, 0, w, h)
      canvas.toBlob(
        (blob) => resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' })),
        'image/jpeg',
        quality
      )
    }
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file) }
    img.src = url
  })
}

// ── Cp helpers ────────────────────────────────────────────────────────────────
function cpAtPoint(t, hz, isFront) {
  return (
    (isFront ? Math.max(0, (1 - 7 * t * t)) * 0.95 : 0) -
    1.35 * Math.sin(Math.PI * t) * Math.pow(Math.max(0, hz), 0.55) +
    (hz < 0.10 ? -0.38 * Math.sin(Math.PI * t) : 0) +
    (t > 0.80 ? -0.72 * Math.pow((t - 0.80) / 0.20, 0.65) : 0) +
    ((t > 0.16 && t < 0.30 && hz > 0.55) ? 0.22 : 0)
  )
}
function cpToRgb(cp) {
  const t = Math.max(0, Math.min(1, (cp + 1.5) / 2.5))
  const stops = [[0,[33,71,217]],[0.25,[34,211,238]],[0.50,[132,204,22]],[0.75,[251,191,36]],[1,[239,68,68]]]
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0,c0] = stops[i], [t1,c1] = stops[i+1]
    if (t <= t1) {
      const f = (t-t0)/(t1-t0)
      return `rgb(${[0,1,2].map(j=>Math.round(c0[j]+(c1[j]-c0[j])*f)).join(',')})`
    }
  }
  return 'rgb(239,68,68)'
}

// ── SideView ──────────────────────────────────────────────────────────────────
function SideView({ g, cpOn, showSep, traceProgress, traceAnimating }) {
  const CW = 620, CH = 260, CPAD = 28
  const scale_x = CW - CPAD * 2
  const scale_y = CH - 40
  const off_x   = CPAD
  const off_y   = 20

  if (traceAnimating || (traceProgress && traceProgress.pct < 100 && traceProgress.pct > 0)) {
    const pts = traceProgress?.pts ?? []
    const pct = traceProgress?.pct ?? 0
    const msg = traceProgress?.msg ?? 'Analysing…'
    let tracePath = null
    if (pts.length > 2) {
      const mapped = pts.map(([nx,ny]) => [off_x + nx*scale_x, off_y + ny*scale_y])
      tracePath = mapped.map((p,i) => `${i===0?'M':'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
    }
    const lastPt = pts.length > 0 ? pts[pts.length-1] : null
    const lx = lastPt ? off_x + lastPt[0]*scale_x : CW/2
    const ly = lastPt ? off_y + lastPt[1]*scale_y : CH/2
    return (
      <svg viewBox={`0 0 ${CW} ${CH}`} style={{width:'100%',height:'100%'}} preserveAspectRatio="xMidYMid meet">
        <rect x={0} y={0} width={CW} height={CH} fill="#050e18"/>
        {Array.from({length:8},(_,i)=>(
          <line key={i} x1={off_x+i*(scale_x/7)} y1={off_y} x2={off_x+i*(scale_x/7)} y2={off_y+scale_y}
            stroke="rgba(10,132,255,0.06)" strokeWidth="0.5"/>
        ))}
        <line x1={12} y1={CH-16} x2={CW-12} y2={CH-16} stroke="rgba(255,255,255,0.05)" strokeWidth="1"/>
        {tracePath && (
          <path d={tracePath} fill="none" stroke="rgba(10,132,255,0.85)" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round"
            style={{filter:'drop-shadow(0 0 4px rgba(10,132,255,0.6))'}}/>
        )}
        <circle cx={lx} cy={ly} r={5} fill="#0A84FF" style={{filter:'drop-shadow(0 0 8px #0A84FF)'}}/>
        <circle cx={lx} cy={ly} r={9} fill="none" stroke="rgba(10,132,255,0.4)" strokeWidth="1.5">
          <animate attributeName="r" values="5;16;5" dur="1.2s" repeatCount="indefinite"/>
          <animate attributeName="opacity" values="0.8;0;0.8" dur="1.2s" repeatCount="indefinite"/>
        </circle>
        <rect x={CPAD} y={CH-10} width={scale_x} height={3} rx="1.5" fill="rgba(255,255,255,0.06)"/>
        <rect x={CPAD} y={CH-10} width={scale_x*(pct/100)} height={3} rx="1.5" fill="rgba(10,132,255,0.8)"/>
        <text x={CW/2} y={CH-3} textAnchor="middle" fill="rgba(10,132,255,0.7)" fontSize="9"
          fontFamily="'IBM Plex Mono',monospace" letterSpacing="0.1em">
          {msg} · {pct}%
        </text>
      </svg>
    )
  }

  const contourPts = g?._contourPts
  const keypoints  = g?._keypoints

  if (contourPts && contourPts.length > 10) {
    const crCps  = g?._catmullCps
    const crPts  = g?._catmullPts
    const rawPts = g?._smoothPts ?? contourPts

    const bboxAspect = g._bboxAspect ?? (scale_x / scale_y)
    let draw_w, draw_h
    if (bboxAspect > scale_x / scale_y) {
      draw_w = scale_x; draw_h = scale_x / bboxAspect
    } else {
      draw_h = scale_y; draw_w = scale_y * bboxAspect
    }
    const draw_ox = off_x + (scale_x - draw_w) / 2
    const draw_oy = off_y + (scale_y - draw_h) / 2
    const toSVG = ([nx, ny]) => [draw_ox + nx * draw_w, draw_oy + ny * draw_h]
    const kpX = nx => draw_ox + nx * draw_w
    const kpY = ny => draw_oy + ny * draw_h

    const n = rawPts.length
    const smoothed = rawPts.map((_,i) => {
      const pts5 = [-2,-1,0,1,2].map(d=>rawPts[(i+d+n)%n])
      return [pts5.reduce((s,p)=>s+p[0],0)/5, pts5.reduce((s,p)=>s+p[1],0)/5]
    })

    let pathD
    if (crCps && crPts && crCps.length === crPts.length && crCps.length > 10) {
      pathD = crPts.map((pt, i) => {
        const [px, py] = toSVG(pt)
        const cp = crCps[i]
        const [c1x,c1y] = toSVG([cp[0],cp[1]])
        const [c2x,c2y] = toSVG([cp[2],cp[3]])
        return i===0 ? `M${px.toFixed(2)},${py.toFixed(2)}`
          : `C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${px.toFixed(2)},${py.toFixed(2)}`
      }).join(' ') + ' Z'
    } else {
      pathD = smoothed.map((p,i)=>{const[sx,sy]=toSVG(p);return`${i===0?'M':'L'}${sx.toFixed(1)},${sy.toFixed(1)}`}).join(' ') + ' Z'
    }

    const gY = CH - 16
    const cpBands = Array.from({length:16},(_,i)=>{
      const f=(i+0.5)/16
      return { x: draw_ox+i*(draw_w/16), w: draw_w/16+1, c: cpToRgb(cpAtPoint(f, 0.7, f<0.15)) }
    })
    const wheels = (keypoints?.wheels??[]).map(w=>({
      cx: kpX(w.nx), cy: kpY(w.ny), r: Math.max(10, w.nr * draw_w),
    }))
    const roofPts  = keypoints?.roofline ?? []
    const roofPath = roofPts.length > 1
      ? roofPts.map((p,i)=>`${i===0?'M':'L'}${kpX(p.nx).toFixed(1)},${kpY(p.ny).toFixed(1)}`).join(' ')
      : null
    const method = g?._method ?? ''

    return (
      <svg viewBox={`0 0 ${CW} ${CH}`} style={{width:'100%',height:'100%'}} preserveAspectRatio="xMidYMid meet">
        <defs>
          <clipPath id="sclip"><path d={pathD} fillRule="nonzero"/></clipPath>
          <filter id="glow">
            <feGaussianBlur stdDeviation="2" result="blur"/>
            <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>
        <ellipse cx={CW/2} cy={gY+5} rx={scale_x*0.46} ry={7} fill="rgba(0,0,0,0.5)"/>
        <line x1={12} y1={gY} x2={CW-12} y2={gY} stroke="rgba(255,255,255,0.05)" strokeWidth="1.5"/>
        <path d={pathD} fill="#07111c" stroke="none" fillRule="nonzero"/>
        {cpOn && (
          <g clipPath="url(#sclip)">
            {cpBands.map((b,i)=><rect key={i} x={b.x} y={off_y-4} width={b.w} height={scale_y+8} fill={b.c} opacity={0.82}/>)}
          </g>
        )}
        <path d={pathD} fill={cpOn?'rgba(2,8,14,0.15)':'rgba(8,18,28,0.5)'}
          stroke="rgba(10,132,255,0.85)" strokeWidth="1.6" fillRule="nonzero" filter="url(#glow)"/>
        {roofPath && (
          <path d={roofPath} fill="none" stroke="rgba(100,200,255,0.2)" strokeWidth="1" strokeDasharray="5 4"/>
        )}
        {showSep && keypoints?.bumpers?.rear && (
          <line x1={kpX(keypoints.bumpers.rear.x)} y1={draw_oy}
            x2={kpX(keypoints.bumpers.rear.x)} y2={gY}
            stroke="rgba(255,100,80,0.5)" strokeWidth="1" strokeDasharray="3 2"/>
        )}
        {wheels.map((w,i)=>(
          <g key={i}>
            <circle cx={w.cx} cy={w.cy} r={w.r} fill="#060C14" stroke="#1E3040" strokeWidth="2.5"/>
            <circle cx={w.cx} cy={w.cy} r={w.r*0.68} fill="#0C1C28" stroke="#162C38" strokeWidth="1.4"/>
            {[0,72,144,216,288].map(a=>{
              const rad=a*Math.PI/180
              return <path key={a} d={`M${w.cx+Math.cos(rad)*w.r*0.22} ${w.cy+Math.sin(rad)*w.r*0.22}L${w.cx+Math.cos(rad+0.26)*w.r*0.64} ${w.cy+Math.sin(rad+0.26)*w.r*0.64}Q${w.cx+Math.cos(rad)*w.r*0.68} ${w.cy+Math.sin(rad)*w.r*0.68} ${w.cx+Math.cos(rad-0.26)*w.r*0.64} ${w.cy+Math.sin(rad-0.26)*w.r*0.64}Z`} fill="#162838" stroke="#1E3040" strokeWidth="0.8"/>
            })}
            <circle cx={w.cx} cy={w.cy} r={w.r*0.14} fill="#1E3040"/>
          </g>
        ))}
        <text x={CW/2} y={CH-3} textAnchor="middle" fill="rgba(255,255,255,0.12)"
          fontSize="9" fontFamily="'IBM Plex Mono',monospace" letterSpacing="0.12em">
          SIDE · {contourPts.length}pts · {method}
        </text>
      </svg>
    )
  }

  return (
    <svg viewBox={`0 0 ${CW} ${CH}`} style={{width:'100%',height:'100%'}} preserveAspectRatio="xMidYMid meet">
      <rect x={0} y={0} width={CW} height={CH} fill="#050e18"/>
      <text x={CW/2} y={CH/2} textAnchor="middle" fill="rgba(255,255,255,0.1)"
        fontSize="12" fontFamily="'IBM Plex Mono',monospace">Upload a photo and click Analyse</text>
    </svg>
  )
}

// ── FrontView ─────────────────────────────────────────────────────────────────
function FrontView({ g, cpOn }) {
  const W=320, H=240, cx=W/2, gY=H-16
  const kp      = g?._keypoints
  const wheels  = kp?.wheels ?? []
  const roofPts = kp?.roofline ?? []
  const sillPts = kp?.sill ?? []
  const roofTopNY = roofPts.length ? Math.min(...roofPts.map(p=>p.ny)) : 0.15
  const sillNY    = sillPts.length ? sillPts.reduce((s,p)=>s+p.ny,0)/sillPts.length : 0.80
  const trackFrac = wheels.length >= 2 ? Math.abs(wheels[1].nx - wheels[0].nx) : 0.48
  const bw = Math.round(Math.min(110, Math.max(70, trackFrac * W * 1.1)))
  const bh = Math.round(Math.min(130, Math.max(75, (sillNY - roofTopNY) * H * 1.15)))
  const bodyBot = gY - bh * 0.08
  const bodyTop = bodyBot - bh
  const wsAngle = g?.wsAngleDeg ?? 58
  const roofNarrow = Math.max(0.28, Math.min(0.46, 0.38-(wsAngle-55)*0.003))
  const roofHW = bw * roofNarrow, shoulderHW = bw * 0.50, sillHW = bw * 0.46
  const shoulderY = bodyTop + bh * 0.55, sillY = bodyTop + bh * 0.92
  const frontPath = [`M ${cx} ${bodyTop}`,`C ${cx-roofHW*0.6} ${bodyTop} ${cx-shoulderHW} ${shoulderY-bh*0.22} ${cx-shoulderHW} ${shoulderY}`,`C ${cx-shoulderHW} ${shoulderY+bh*0.12} ${cx-sillHW} ${sillY} ${cx-sillHW*0.80} ${bodyBot}`,`L ${cx+sillHW*0.80} ${bodyBot}`,`C ${cx+sillHW} ${sillY} ${cx+shoulderHW} ${shoulderY+bh*0.12} ${cx+shoulderHW} ${shoulderY}`,`C ${cx+shoulderHW} ${shoulderY-bh*0.22} ${cx+roofHW*0.6} ${bodyTop} ${cx} ${bodyTop}`,'Z'].join(' ')
  const aBY = bodyTop+bh*0.55, aTY = bodyTop+bh*0.08, aBHW = shoulderHW*0.86, aTHW = roofHW*0.92
  const wscPath = [`M ${cx-aTHW} ${aTY}`,`Q ${cx} ${aTY-2} ${cx+aTHW} ${aTY}`,`L ${cx+aBHW} ${aBY}`,`L ${cx-aBHW} ${aBY}`,'Z'].join(' ')
  const wR = wheels.length>=1 ? Math.max(12,Math.min(24,wheels[0].r/800*W*0.9)) : 16
  const w1x = cx-shoulderHW*1.05, w2x = cx+shoulderHW*1.05, wY = gY-wR
  const cpBands = Array.from({length:11},(_,i)=>{const f=i/10,d=Math.abs(f-0.5)*2;return{color:cpToRgb(0.85*(1-d*d)-0.25)}})
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',height:'100%'}} preserveAspectRatio="xMidYMid meet">
      <defs><clipPath id="fclip"><path d={frontPath}/></clipPath></defs>
      <ellipse cx={cx} cy={gY+5} rx={shoulderHW*1.2} ry={7} fill="rgba(0,0,0,0.4)"/>
      <line x1={12} y1={gY} x2={W-12} y2={gY} stroke="rgba(255,255,255,0.06)" strokeWidth="1.5"/>
      {cpOn&&<g clipPath="url(#fclip)">{cpBands.map((b,i)=><rect key={i} x={cx-shoulderHW+i*(shoulderHW*2/10)} y={bodyTop-4} width={(shoulderHW*2)/10+2} height={bh+8} fill={b.color} opacity={0.85}/>)}</g>}
      <path d={frontPath} fill={cpOn?'rgba(5,10,18,0.28)':'#111E28'} stroke="rgba(10,132,255,0.6)" strokeWidth="0.95"/>
      <path d={wscPath} fill="rgba(0,14,28,0.45)" stroke="rgba(10,132,255,0.55)" strokeWidth="0.9"/>
      {[-1,1].map(s=><path key={s} d={`M ${cx+s*aTHW} ${aTY} L ${cx+s*aBHW} ${aBY}`} stroke="rgba(0,0,0,0.5)" strokeWidth="4" strokeLinecap="round"/>)}
      {[[w1x,wY],[w2x,wY]].map(([wcx,wcy],i)=>(
        <g key={i}>
          <circle cx={wcx} cy={wcy} r={wR} fill="#060C14" stroke="#1E3040" strokeWidth="2.5"/>
          <circle cx={wcx} cy={wcy} r={wR*0.72} fill="#0C1C28" stroke="#162C38" strokeWidth="1.4"/>
          {[0,72,144,216,288].map(a=>{const r2=a*Math.PI/180;return<path key={a} d={`M ${wcx+Math.cos(r2)*wR*0.24} ${wcy+Math.sin(r2)*wR*0.24} L ${wcx+Math.cos(r2+0.25)*wR*0.68} ${wcy+Math.sin(r2+0.25)*wR*0.68} Q ${wcx+Math.cos(r2)*wR*0.72} ${wcy+Math.sin(r2)*wR*0.72} ${wcx+Math.cos(r2-0.25)*wR*0.68} ${wcy+Math.sin(r2-0.25)*wR*0.68} Z`} fill="#162838" stroke="#1E3040" strokeWidth="0.8"/>})}
          <circle cx={wcx} cy={wcy} r={wR*0.15} fill="#1E3040"/>
        </g>
      ))}
      <text x={cx} y={H-3} textAnchor="middle" fill="rgba(255,255,255,0.15)" fontSize="9" fontFamily="'IBM Plex Mono',monospace" letterSpacing="0.12em">FRONT</text>
    </svg>
  )
}

// ── TopView ───────────────────────────────────────────────────────────────────
function TopView({ g, yawAngle }) {
  const W=320, H=240, cx=W/2, cy=H/2+6
  const kp = g?._keypoints, wheels = kp?.wheels ?? []
  const bl = Math.round(Math.min(180, Math.max(130, (g?.aspectRatio??2.0)*72))), bw = 70
  const hoodEnd = cy+bl*((g?.hoodRatio??0.28)-0.50), cabinEnd = cy+bl*((g?.hoodRatio??0.28)+(g?.cabinRatio??0.44)-0.50)
  const ghW = bw*0.41
  const fwy = wheels.length>=1 ? cy+bl*(wheels[0].nx*1.1-0.55) : cy+bl*((g?.w1??0.22)-0.50)
  const rwy = wheels.length>=2 ? cy+bl*(wheels[1].nx*1.1-0.55) : cy+bl*((g?.w2??0.76)-0.50)
  const wR = wheels.length>=1 ? Math.max(8,Math.min(18,wheels[0].r/800*W*0.9)) : 10, wTrack = bw*0.52
  const body = [`M ${cx} ${cy-bl/2+5}`,`Q ${cx-bw*0.24} ${cy-bl/2+1} ${cx-bw*0.48} ${cy-bl/2+22}`,`Q ${cx-bw*0.50} ${cy-bl/2+52} ${cx-bw*0.50} ${cy}`,`Q ${cx-bw*0.50} ${cy+bl*0.12} ${cx-bw*0.44} ${cy+bl/2-10}`,`Q ${cx-bw*0.30} ${cy+bl/2-2} ${cx} ${cy+bl/2-2}`,`Q ${cx+bw*0.30} ${cy+bl/2-2} ${cx+bw*0.44} ${cy+bl/2-10}`,`Q ${cx+bw*0.50} ${cy+bl*0.12} ${cx+bw*0.50} ${cy}`,`Q ${cx+bw*0.50} ${cy-bl/2+52} ${cx+bw*0.48} ${cy-bl/2+22}`,`Q ${cx+bw*0.24} ${cy-bl/2+1} ${cx} ${cy-bl/2+5}`,'Z'].join(' ')
  const ghPath = [`M ${cx} ${hoodEnd-4}`,`Q ${cx-ghW*0.50} ${hoodEnd+2} ${cx-ghW*0.52} ${hoodEnd+16}`,`L ${cx-ghW*0.52} ${cabinEnd-10}`,`Q ${cx-ghW*0.44} ${cabinEnd} ${cx} ${cabinEnd}`,`Q ${cx+ghW*0.44} ${cabinEnd} ${cx+ghW*0.52} ${cabinEnd-10}`,`L ${cx+ghW*0.52} ${hoodEnd+16}`,`Q ${cx+ghW*0.50} ${hoodEnd+2} ${cx} ${hoodEnd-4}`,'Z'].join(' ')
  const N=14, cpS = Array.from({length:N},(_,i)=>{const tM=(i+0.5)/N;return{y0:cy-bl/2+5+i*(bl-7)/N,y1:cy-bl/2+5+(i+1)*(bl-7)/N,c:cpToRgb(cpAtPoint(tM,0.70,tM<0.15))}})
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',height:'100%'}} preserveAspectRatio="xMidYMid meet">
      <defs><clipPath id="tclip"><path d={body}/></clipPath></defs>
      <g clipPath="url(#tclip)">{cpS.map((s,i)=><rect key={i} x={cx-bw*0.52} y={s.y0} width={bw*1.04} height={s.y1-s.y0+1} fill={s.c} opacity={0.88}/>)}</g>
      <path d={body} fill="rgba(4,8,16,0.25)" stroke="rgba(10,132,255,0.65)" strokeWidth="1.1"/>
      <path d={ghPath} fill="rgba(0,14,28,0.60)" stroke="rgba(10,132,255,0.40)" strokeWidth="0.9"/>
      <line x1={cx-bw*0.26} y1={cy-bl/2+22} x2={cx+bw*0.26} y2={cy-bl/2+22} stroke="rgba(255,255,255,0.06)" strokeWidth="0.8"/>
      {[[-wTrack,fwy],[wTrack,fwy],[-wTrack,rwy],[wTrack,rwy]].map(([wx,wy],i)=>(
        <g key={i}><ellipse cx={cx+wx} cy={wy} rx={wR*0.45} ry={wR} fill="#060C14" stroke="#1E3040" strokeWidth="1.5"/></g>
      ))}
      {[-1,1].map(s=><line key={s} x1={cx+s*ghW*0.52} y1={hoodEnd+16} x2={cx+s*bw*0.46} y2={hoodEnd-10} stroke="rgba(255,255,255,0.08)" strokeWidth="1.2"/>)}
      <text x={cx} y={H-4} textAnchor="middle" fill="rgba(255,255,255,0.15)" fontSize="9" fontFamily="'IBM Plex Mono',monospace" letterSpacing="0.12em">TOP</text>
    </svg>
  )
}

// ── UnderView ─────────────────────────────────────────────────────────────────
function UnderView({ g, showGroundEffect }) {
  const W=320, H=240, cx=W/2, cy=H/2+6
  const kp = g?._keypoints, wheels = kp?.wheels ?? []
  const bl = Math.round(Math.min(180, Math.max(130, (g?.aspectRatio??2.0)*72))), bw = 70
  const fwy = wheels.length>=1 ? cy+bl*(wheels[0].nx*1.1-0.55) : cy+bl*((g?.w1??0.22)-0.50)
  const rwy = wheels.length>=2 ? cy+bl*(wheels[1].nx*1.1-0.55) : cy+bl*((g?.w2??0.76)-0.50)
  const wR = wheels.length>=1 ? Math.max(8,Math.min(18,wheels[0].r/800*W*0.9)) : 10, wTrack = bw*0.52
  const diffY = cy+bl/2-bl*0.14
  const body = [`M ${cx} ${cy-bl/2+5}`,`Q ${cx-bw*0.24} ${cy-bl/2+1} ${cx-bw*0.48} ${cy-bl/2+22}`,`L ${cx-bw*0.50} ${cy+bl*0.08}`,`Q ${cx-bw*0.48} ${cy+bl/2-12} ${cx-bw*0.42} ${cy+bl/2-3}`,`L ${cx+bw*0.42} ${cy+bl/2-3}`,`Q ${cx+bw*0.48} ${cy+bl/2-12} ${cx+bw*0.50} ${cy+bl*0.08}`,`L ${cx+bw*0.48} ${cy-bl/2+22}`,`Q ${cx+bw*0.24} ${cy-bl/2+1} ${cx} ${cy-bl/2+5}`,'Z'].join(' ')
  const N=14, cpS = Array.from({length:N},(_,i)=>{const tM=(i+0.5)/N;return{y0:cy-bl/2+5+i*(bl-7)/N,y1:cy-bl/2+5+(i+1)*(bl-7)/N,c:cpToRgb(cpAtPoint(tM,0.05,tM<0.15))}})
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',height:'100%'}} preserveAspectRatio="xMidYMid meet">
      <defs><clipPath id="uclip"><path d={body}/></clipPath></defs>
      <g clipPath="url(#uclip)">{cpS.map((s,i)=><rect key={i} x={cx-bw*0.52} y={s.y0} width={bw*1.04} height={s.y1-s.y0+1} fill={s.c} opacity={0.85}/>)}</g>
      <path d={body} fill="rgba(4,8,16,0.25)" stroke="rgba(10,132,255,0.65)" strokeWidth="1.1"/>
      <rect x={cx-bw*0.28} y={cy-bl*0.35} width={bw*0.56} height={bl*0.62} rx="3" fill="rgba(0,0,0,0.3)" stroke="rgba(255,255,255,0.05)" strokeWidth="0.8"/>
      <rect x={cx-bw*0.05} y={cy-bl*0.30} width={bw*0.10} height={bl*0.52} rx="2" fill="rgba(0,0,0,0.5)" stroke="rgba(255,255,255,0.07)" strokeWidth="0.6"/>
      <path d={`M ${cx-bw*0.38} ${diffY} L ${cx-bw*0.42} ${cy+bl/2-3} L ${cx+bw*0.42} ${cy+bl/2-3} L ${cx+bw*0.38} ${diffY} Z`} fill="rgba(10,132,255,0.08)" stroke="rgba(10,132,255,0.3)" strokeWidth="0.9"/>
      {[-2,-1,0,1,2].map(i=><line key={i} x1={cx+i*bw*0.07} y1={diffY} x2={cx+i*bw*0.075} y2={cy+bl/2-3} stroke="rgba(10,132,255,0.2)" strokeWidth="0.7"/>)}
      {[[-wTrack,fwy],[wTrack,fwy],[-wTrack,rwy],[wTrack,rwy]].map(([wx,wy],i)=>(
        <ellipse key={i} cx={cx+wx} cy={wy} rx={wR*0.45} ry={wR} fill="#060C14" stroke="#1E3040" strokeWidth="1.5"/>
      ))}
      <text x={cx} y={H-4} textAnchor="middle" fill="rgba(255,255,255,0.15)" fontSize="9" fontFamily="'IBM Plex Mono',monospace" letterSpacing="0.12em">UNDERSIDE</text>
    </svg>
  )
}

// ── Section label ─────────────────────────────────────────────────────────────
function SL({ n, t }) {
  return (
    <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}>
      <span style={{fontSize:10,fontWeight:600,color:'var(--blue)',fontFamily:"'IBM Plex Mono'"}}>{n}</span>
      <div style={{flex:1,height:0.5,background:'var(--sep)'}}/>
      <span style={{fontSize:10,fontWeight:600,color:'var(--text-quaternary)',letterSpacing:'0.08em',textTransform:'uppercase'}}>{t}</span>
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
  const [cpOn,           setCpOn]           = useState(true)
  const [showSep,        setShowSep]        = useState(true)
  const [showGE,         setShowGE]         = useState(false)
  const [yawAngle,       setYawAngle]       = useState(0)
  const [urlInput,       setUrlInput]       = useState('')
  const [urlError,       setUrlError]       = useState('')
  const [urlMode,        setUrlMode]        = useState(false)
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
    setUrlError(''); setStage('analyzing'); setGeo(null)
    try {
      const proxies = [
        `https://api.allorigins.win/raw?url=${encodeURIComponent(trimmed)}`,
        `https://corsproxy.io/?${encodeURIComponent(trimmed)}`,
      ]
      let blob = null
      if (!trimmed.startsWith('data:')) {
        for (const proxy of proxies) {
          try { const r = await fetch(proxy); if (r.ok) { blob = await r.blob(); break } } catch {}
        }
        if (!blob) throw new Error('Image blocked by CORS — try uploading the file directly')
      } else {
        const res = await fetch(trimmed); if (!res.ok) throw new Error(`HTTP ${res.status}`); blob = await res.blob()
      }
      if (!blob.type.startsWith('image/') && !blob.type.includes('octet')) throw new Error('URL does not point to an image')
      const f = new File([blob], trimmed.split('/').pop()?.split('?')[0]||'car.jpg', {type:blob.type})
      setFile(f); setPreview(URL.createObjectURL(blob)); setUrlInput(''); setUrlMode(false); setStage('ready')
    } catch(e) { setUrlError(`Could not load image: ${e.message}`); setStage('idle') }
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

  // ── Main analysis function ────────────────────────────────────────────────
  const run = async () => {
    if (!file) return
    setError(null); setGeo(null); setTraceAnimating(false)

    setTraceProgress({ pct: 2, msg: 'Compressing image…', pts: [] })
    setStage('analyzing')
    let uploadFile
    try {
      uploadFile = await compressImage(file)
      console.log(`[StatCFD] Compressed: ${(file.size/1024).toFixed(0)}KB → ${(uploadFile.size/1024).toFixed(0)}KB`)
    } catch(e) {
      uploadFile = file
    }

    // ── Start job — POST through Vercel proxy ─────────────────────────────
    // proxyUrl() routes to /api/relay?path=... which forwards server-side
    // to HuggingFace, bypassing corporate firewall blocks on hf.space.
    let jobId = null
    const MAX_ATTEMPTS = 18   // 18 × 5s = 90s — covers HF cold start
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const waited = attempt * 5
      setTraceProgress({
        pct: 5,
        msg: attempt === 0
          ? 'Connecting to server…'
          : `Retrying… (${waited}s elapsed)`,
        pts: [],
      })
      try {
        const fd = new FormData()
        fd.append('file', uploadFile)
        const res = await fetch(proxyUrl('contour/start'), {
          method: 'POST',
          body: fd,
          signal: AbortSignal.timeout(25000),
        })
        if (res.ok) {
          const data = await res.json()
          jobId = data.job_id
          break
        }
        const text = await res.text().catch(() => '')
        setError(`Server error ${res.status}${text ? ': ' + text.slice(0,120) : ''}`)
        setTraceAnimating(false); setStage('idle'); setTraceProgress(null); return
      } catch(e) {
        console.warn(`[StatCFD] Attempt ${attempt+1} failed:`, e.message)
        if (attempt >= MAX_ATTEMPTS - 1) {
          setError(
            `Could not reach the server after ${MAX_ATTEMPTS * 5}s. ` +
            `Check https://huggingface.co/spaces/rutejtalati16/Aeronet — it may need a manual restart.`
          )
          setTraceAnimating(false); setStage('idle'); setTraceProgress(null); return
        }
        await new Promise(r => setTimeout(r, 5000))
      }
    }

    if (!jobId) {
      setError('Failed to start analysis job.')
      setTraceAnimating(false); setStage('idle'); setTraceProgress(null); return
    }

    setTraceAnimating(true)
    setTraceProgress({ pct: 15, msg: 'Job queued — YOLO loading…', pts: [] })

    // ── Poll for result — also through Vercel proxy ───────────────────────
    const startTime = Date.now()
    while (true) {
      await new Promise(r => setTimeout(r, 3000))
      const elapsed = Math.round((Date.now() - startTime) / 1000)

      let poll
      try {
        const res = await fetch(proxyUrl(`contour/result/${jobId}`), {
          signal: AbortSignal.timeout(10000),
        })
        if (!res.ok) {
          setError(`Poll error ${res.status}`)
          setTraceAnimating(false); setStage('idle'); setTraceProgress(null); return
        }
        poll = await res.json()
      } catch(e) {
        setError(`Connection lost while polling: ${e.message}`)
        setTraceAnimating(false); setStage('idle'); setTraceProgress(null); return
      }

      if (poll.status === 'error') {
        setError(poll.error ?? 'Analysis failed on server')
        setTraceAnimating(false); setStage('idle'); setTraceProgress(null); return
      }

      if (poll.status === 'running' || poll.status === 'pending') {
        const pct = Math.min(88, 15 + elapsed * 1.2)
        setTraceProgress({ pct: Math.round(pct), msg: `YOLO+SAM2 running… ${elapsed}s`, pts: [] })
        continue
      }

      if (poll.status === 'done') {
        const result = poll.result
        if (!result?.geometry) {
          setError('No vehicle outline found. Use a clear side-on photo with plain background.')
          setTraceAnimating(false); setStage('idle'); setTraceProgress(null); return
        }

        const allPts = result.smooth_pts ?? []
        if (allPts.length > 0) {
          const steps = 30
          const delay = 1500 / steps
          setTraceAnimating(true)
          for (let step = 0; step <= steps; step++) {
            setTimeout(() => {
              const visible = Math.round((step / steps) * allPts.length)
              setTraceProgress({
                pct: 100,
                msg: step < steps ? `Tracing… ${Math.round(step/steps*100)}%` : 'Done ✓',
                pts: allPts.slice(0, visible),
                done: step === steps,
              })
              if (step === steps) {
                setTraceAnimating(false)
                setTraceProgress(null)
              }
            }, step * delay)
          }
        } else {
          setTraceAnimating(false)
          setTraceProgress(null)
        }

        const cg = result.geometry
        setGeo({
          aspectRatio: cg.aspectRatio ?? 2.0,
          hoodRatio:   cg.hoodRatio   ?? 0.28,
          cabinRatio:  cg.cabinRatio  ?? 0.44,
          bootRatio:   cg.bootRatio   ?? 0.28,
          wsAngleDeg:  cg.wsAngleDeg  ?? 58,
          rearDrop:    cg.rearDrop    ?? 0.15,
          cabinH:      cg.cabinH      ?? 0.58,
          rideH:       cg.rideH       ?? 0.08,
          w1:          cg.w1          ?? 0.22,
          w2:          cg.w2          ?? 0.76,
          // ── Fix: confidence lives in quality.score (0-100), not geometry ──
          confidence:  (result.quality?.score ?? 97) / 100,
          _contourPts: result.smooth_pts ?? result.outline_pts,
          _smoothPts:  result.smooth_pts,
          _catmullCps: result.catmull_rom_cps,
          _catmullPts: result.catmull_rom_pts,
          _bboxAspect: result.bbox ? result.bbox.w / Math.max(1, result.bbox.h) : undefined,
          _keypoints:  result.keypoints,
          _method:     result.method,
        })
        setStage('done')
        return
      }
    }
  }

  const exportSVG = () => {
    const svg = svgRef.current?.querySelector('svg'); if (!svg) return
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([svg.outerHTML], {type:'image/svg+xml'}))
    a.download = `statcfd_${activeView}.svg`; a.click()
  }

  const isRunning = stage === 'analyzing'
  const card = {background:'var(--bg1)',borderRadius:12,border:'0.5px solid rgba(255,255,255,0.06)',overflow:'hidden'}
  const toggleBtn = (label, val, set) => (
    <button key={label} onClick={()=>set(p=>!p)} style={{padding:'4px 11px',borderRadius:7,border:`0.5px solid ${val?'rgba(10,132,255,0.4)':'var(--sep)'}`,background:val?'rgba(10,132,255,0.16)':'transparent',color:val?'var(--blue)':'rgba(255,255,255,0.35)',fontSize:11,fontWeight:500,cursor:'pointer',transition:'all 0.12s',fontFamily:"'IBM Plex Sans'"}}>
      {label}
    </button>
  )

  return (
    <div style={{display:'flex',height:'100%',overflow:'hidden',background:'var(--bg0)'}}>

      {/* ── Left: upload ── */}
      <div style={{width:228,flexShrink:0,display:'flex',flexDirection:'column',borderRight:'0.5px solid var(--sep)',overflow:'hidden'}}>
        <div style={{flex:1,overflowY:'auto',padding:'16px 14px'}}>
          <SL n="01" t="Upload"/>

          <div
            onDragOver={e=>{e.preventDefault();setDragOver(true)}}
            onDragLeave={()=>setDragOver(false)}
            onDrop={e=>{e.preventDefault();setDragOver(false);const f=e.dataTransfer.files?.[0];if(f){acceptFile(f);return}const url=e.dataTransfer.getData('text/uri-list')||e.dataTransfer.getData('text/plain');if(url&&/^https?:\/\//i.test(url))acceptUrl(url)}}
            onClick={()=>fileRef.current?.click()}
            style={{borderRadius:12,border:`0.5px dashed ${dragOver?'var(--blue)':'rgba(255,255,255,0.12)'}`,background:dragOver?'rgba(10,132,255,0.06)':'var(--bg1)',cursor:'pointer',overflow:'hidden',minHeight:130,transition:'border-color 0.15s, background 0.15s',marginBottom:10,display:'flex',flexDirection:'column'}}>
            <input ref={fileRef} type="file" accept="image/*" style={{display:'none'}} onChange={e=>acceptFile(e.target.files[0])}/>
            {preview ? (
              <div style={{position:'relative'}}>
                <img src={preview} alt="preview" style={{width:'100%',display:'block',borderRadius:12}}/>
                <div style={{position:'absolute',bottom:6,left:0,right:0,textAlign:'center'}}>
                  <span style={{fontSize:10,color:'var(--text-secondary)',background:'rgba(0,0,0,0.55)',padding:'2px 10px',borderRadius:20}}>click to change</span>
                </div>
              </div>
            ) : (
              <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:10,padding:'28px 16px',flex:1}}>
                <div style={{width:44,height:44,borderRadius:12,background:'var(--bg2)',border:'0.5px solid var(--sep)',display:'flex',alignItems:'center',justifyContent:'center'}}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
                </div>
                <span style={{fontSize:12,color:'var(--text-tertiary)',textAlign:'center'}}>Drop image or file</span>
                <span style={{fontSize:10,color:'var(--text-quaternary)',fontFamily:"'IBM Plex Mono'",textAlign:'center',lineHeight:1.7}}>JPG · PNG · WEBP<br/><span style={{color:'rgba(255,255,255,0.18)'}}>Ctrl+V to paste</span></span>
              </div>
            )}
          </div>

          <div style={{marginBottom:10}}>
            {urlMode ? (
              <div style={{display:'flex',flexDirection:'column',gap:6}}>
                <div style={{display:'flex',gap:5}}>
                  <input autoFocus value={urlInput} onChange={e=>setUrlInput(e.target.value)}
                    onKeyDown={e=>{if(e.key==='Enter')acceptUrl(urlInput);if(e.key==='Escape')setUrlMode(false)}}
                    placeholder="https://example.com/car.jpg"
                    style={{flex:1,background:'var(--bg2)',border:`0.5px solid ${urlError?'var(--red)':'rgba(255,255,255,0.12)'}`,borderRadius:8,padding:'7px 10px',color:'var(--text-primary)',fontSize:11,outline:'none',fontFamily:"'IBM Plex Mono',monospace"}}/>
                  <button onClick={()=>acceptUrl(urlInput)} style={{padding:'0 10px',borderRadius:8,border:'none',cursor:'pointer',background:'var(--blue)',color:'#fff',fontSize:11}}>Go</button>
                  <button onClick={()=>{setUrlMode(false);setUrlError('')}} style={{padding:'0 8px',borderRadius:8,border:'0.5px solid var(--sep)',cursor:'pointer',background:'transparent',color:'var(--text-tertiary)',fontSize:11}}>✕</button>
                </div>
                {urlError && <span style={{fontSize:10,color:'var(--red)'}}>{urlError}</span>}
              </div>
            ) : (
              <button onClick={()=>setUrlMode(true)}
                style={{width:'100%',height:32,borderRadius:8,border:'0.5px solid rgba(255,255,255,0.08)',background:'transparent',cursor:'pointer',color:'var(--text-quaternary)',fontSize:11,display:'flex',alignItems:'center',justifyContent:'center',gap:6,transition:'all 0.12s'}}
                onMouseEnter={e=>{e.currentTarget.style.background='var(--bg2)';e.currentTarget.style.color='var(--text-tertiary)'}}
                onMouseLeave={e=>{e.currentTarget.style.background='transparent';e.currentTarget.style.color='var(--text-quaternary)'}}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                Load from URL
              </button>
            )}
          </div>

          {file && (
            <div style={{...card,padding:'8px 12px',display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
              <span style={{fontSize:11,color:'var(--text-tertiary)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',flex:1}}>{file.name}</span>
              <span style={{fontSize:10,fontFamily:"'IBM Plex Mono'",color:'var(--text-quaternary)',marginLeft:8,flexShrink:0}}>{(file.size/1024).toFixed(0)} KB</span>
            </div>
          )}

          <button onClick={run} disabled={!file||isRunning}
            style={{width:'100%',height:38,borderRadius:10,border:'none',marginBottom:14,background:!file||isRunning?'rgba(255,255,255,0.05)':'var(--blue)',color:!file||isRunning?'rgba(255,255,255,0.3)':'#fff',fontSize:13,fontWeight:600,cursor:!file||isRunning?'not-allowed':'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:6,transition:'opacity 0.15s'}}>
            {isRunning ? (
              <><svg className="anim-spin" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2.5"><path d="M12 3a9 9 0 019 9"/></svg>Analysing…</>
            ) : (
              <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>Analyse Vehicle</>
            )}
          </button>

          {error && (
            <div style={{...card,padding:'9px 12px',background:'rgba(255,69,58,0.08)',border:'0.5px solid rgba(255,69,58,0.3)',color:'var(--red)',fontSize:12,marginBottom:12}}>
              {error}
            </div>
          )}

          {geo && (
            <>
              <SL n="02" t="Result"/>
              <div style={{...card,padding:'10px 12px',marginBottom:14}}>
                {[
                  ['Method',   geo._method ?? '—'],
                  ['Points',   (geo._contourPts?.length ?? 0) + ' pt'],
                  ['Wheels',   (geo._keypoints?.wheels?.length ?? 0) + ' found'],
                  ['Aspect',   (geo.aspectRatio ?? 0).toFixed(2)],
                  ['WS rake',  (geo.wsAngleDeg ?? 0).toFixed(0) + '°'],
                ].map(([k,v])=>(
                  <div key={k} style={{display:'flex',justifyContent:'space-between',fontSize:11,padding:'3px 0',borderBottom:'0.5px solid rgba(255,255,255,0.04)'}}>
                    <span style={{fontFamily:"'IBM Plex Mono'",color:'var(--text-quaternary)'}}>{k}</span>
                    <span style={{fontFamily:"'IBM Plex Mono'",color:'var(--blue)'}}>{v}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Centre: views ── */}
      <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
        <div style={{display:'flex',alignItems:'center',gap:6,padding:'7px 12px',borderBottom:'0.5px solid var(--sep)',flexShrink:0,background:'rgba(0,0,0,0.4)',flexWrap:'wrap'}}>
          <div style={{display:'flex',gap:2}}>
            {VIEWS.map(v=>(
              <button key={v.id} onClick={()=>setActiveView(v.id)}
                style={{padding:'4px 12px',borderRadius:7,border:'none',cursor:'pointer',background:activeView===v.id?'rgba(10,132,255,0.18)':'transparent',color:activeView===v.id?'var(--blue)':'rgba(255,255,255,0.38)',fontSize:12,fontWeight:activeView===v.id?600:400,transition:'background 0.12s',fontFamily:"'IBM Plex Sans'"}}>{v.label}</button>
            ))}
          </div>
          <div style={{width:0.5,height:14,background:'var(--sep)'}}/>
          <div style={{display:'flex',gap:5}}>
            {toggleBtn('Cp', cpOn, setCpOn)}
            {toggleBtn('Sep', showSep, setShowSep)}
            {toggleBtn('Ground', showGE, setShowGE)}
          </div>
          {geo && activeView==='top' && (
            <div style={{display:'flex',alignItems:'center',gap:8,marginLeft:4}}>
              <span style={{fontSize:11,color:'var(--text-tertiary)'}}>Yaw</span>
              <div style={{position:'relative',width:72,height:18,display:'flex',alignItems:'center'}}>
                <div style={{position:'absolute',left:0,right:0,height:2,borderRadius:9999,background:'var(--bg3)'}}>
                  <div style={{position:'absolute',left:'50%',top:0,height:'100%',width:`${Math.abs(yawAngle)/15*50}%`,background:'var(--blue)',borderRadius:9999,transform:yawAngle>=0?'none':'translateX(-100%)'}}/>
                </div>
                <input type="range" min={-15} max={15} value={yawAngle} onChange={e=>setYawAngle(Number(e.target.value))} style={{position:'absolute',inset:0,width:'100%',opacity:0,cursor:'pointer',zIndex:2}}/>
                <div style={{position:'absolute',top:'50%',transform:'translate(-50%,-50%)',left:`${((yawAngle+15)/30)*100}%`,width:14,height:14,borderRadius:'50%',background:'#fff',boxShadow:'0 1px 5px rgba(0,0,0,0.5)',pointerEvents:'none',zIndex:1}}/>
              </div>
              <span style={{fontSize:11,fontWeight:600,color:'var(--blue)',fontFamily:"'IBM Plex Mono'",width:28,textAlign:'right'}}>{yawAngle>0?'+':''}{yawAngle}°</span>
            </div>
          )}
          <button onClick={exportSVG}
            style={{marginLeft:'auto',padding:'4px 12px',borderRadius:7,border:'0.5px solid var(--sep)',background:'transparent',color:'var(--text-tertiary)',fontSize:11,cursor:'pointer',transition:'all 0.12s'}}
            onMouseEnter={e=>{e.currentTarget.style.borderColor='rgba(10,132,255,0.4)';e.currentTarget.style.color='var(--blue)'}}
            onMouseLeave={e=>{e.currentTarget.style.borderColor='var(--sep)';e.currentTarget.style.color='rgba(255,255,255,0.38)'}}>
            Export SVG
          </button>
        </div>

        <div ref={svgRef} style={{flex:1,display:'flex',flexDirection:'column',padding:'14px',gap:12,overflow:'hidden',background:'#030608'}}>
          {!geo && !isRunning && !traceProgress ? (
            <div style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:16}}>
              <div style={{width:64,height:64,borderRadius:16,background:'var(--bg1)',border:'0.5px solid var(--sep)',display:'flex',alignItems:'center',justifyContent:'center'}}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5"><path d="M2 12c0-5.5 4.5-10 10-10s10 4.5 10 10-4.5 10-10 10S2 17.5 2 12z"/><path d="M12 8v4l3 3"/></svg>
              </div>
              <div style={{textAlign:'center',maxWidth:380}}>
                <div style={{fontSize:15,fontWeight:600,color:'var(--text-secondary)',marginBottom:8}}>YOLO Vehicle Outline</div>
                <div style={{fontSize:12,color:'var(--text-quaternary)',lineHeight:1.7}}>Upload a side-on photo. YOLOv8x-seg segments the vehicle, SAM2 refines the boundary, and the outline is traced live.</div>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap',justifyContent:'center'}}>
                {['YOLOv8x-seg','SAM2','500pt contour','Catmull-Rom','Keypoints'].map((s,i,a)=>(
                  <span key={i} style={{display:'flex',alignItems:'center',gap:5}}>
                    <span style={{padding:'3px 10px',borderRadius:6,border:'0.5px solid var(--sep)',fontSize:10,fontFamily:"'IBM Plex Mono'",color:'var(--text-quaternary)',background:'var(--bg1)'}}>{s}</span>
                    {i<a.length-1&&<span style={{fontSize:10,color:'var(--text-quaternary)'}}>→</span>}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <>
              <div style={{flex:1,...card,display:'flex',alignItems:'center',justifyContent:'center',padding:'12px',overflow:'hidden'}}>
                <div style={{width:'100%',height:'100%',maxHeight:295}}>
                  {activeView==='side'  && <SideView  g={geo} cpOn={cpOn} showSep={showSep} traceProgress={traceProgress} traceAnimating={traceAnimating}/>}
                  {activeView==='front' && <FrontView g={geo} cpOn={cpOn}/>}
                  {activeView==='top'   && <TopView   g={geo} yawAngle={yawAngle}/>}
                  {activeView==='under' && <UnderView g={geo} showGroundEffect={showGE}/>}
                </div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8,flexShrink:0}}>
                {VIEWS.map(v=>(
                  <button key={v.id} onClick={()=>setActiveView(v.id)}
                    style={{borderRadius:10,border:`0.5px solid ${activeView===v.id?'rgba(10,132,255,0.45)':'rgba(255,255,255,0.06)'}`,background:activeView===v.id?'rgba(10,132,255,0.1)':'var(--bg1)',overflow:'hidden',cursor:'pointer',padding:4,transition:'border-color 0.15s'}}>
                    <div style={{width:'100%',aspectRatio:'5/3',pointerEvents:'none'}}>
                      {v.id==='side'  && <SideView  g={geo} cpOn={cpOn} showSep={false}/>}
                      {v.id==='front' && <FrontView g={geo} cpOn={cpOn}/>}
                      {v.id==='top'   && <TopView   g={geo} yawAngle={0}/>}
                      {v.id==='under' && <UnderView g={geo} showGroundEffect={false}/>}
                    </div>
                    <div style={{fontSize:10,color:activeView===v.id?'var(--blue)':'rgba(255,255,255,0.3)',textAlign:'center',padding:'3px 0',fontWeight:activeView===v.id?600:400}}>{v.label}</div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Right: keypoints + geometry ── */}
      <div style={{width:210,flexShrink:0,borderLeft:'0.5px solid var(--sep)',overflowY:'auto',padding:'16px 14px',background:'var(--bg0)'}}>
        {geo ? (
          <>
            <SL n="03" t="Wheels"/>
            <div style={{...card,padding:'10px 12px',marginBottom:14}}>
              {(geo._keypoints?.wheels ?? []).length === 0 ? (
                <div style={{fontSize:11,color:'var(--text-quaternary)',textAlign:'center',padding:'8px 0'}}>No wheels detected</div>
              ) : (geo._keypoints?.wheels ?? []).map((w,i)=>(
                <div key={i} style={{marginBottom:8,paddingBottom:8,borderBottom:'0.5px solid rgba(255,255,255,0.04)'}}>
                  <div style={{fontSize:10,fontWeight:600,color:'var(--blue)',marginBottom:4,fontFamily:"'IBM Plex Mono'"}}>Wheel {i+1}</div>
                  {[['cx',(w.nx*100).toFixed(1)+'%'],['cy',(w.ny*100).toFixed(1)+'%'],['r',(w.nr*100).toFixed(1)+'%']].map(([k,v])=>(
                    <div key={k} style={{display:'flex',justifyContent:'space-between',fontSize:10,padding:'1px 0'}}>
                      <span style={{color:'var(--text-quaternary)',fontFamily:"'IBM Plex Mono'"}}>{k}</span>
                      <span style={{color:'var(--text-secondary)',fontFamily:"'IBM Plex Mono'"}}>{v}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>

            <SL n="04" t="Geometry"/>
            <div style={{...card,padding:'10px 12px',marginBottom:14}}>
              {[
                ['Hood',     ((geo.hoodRatio??0)*100).toFixed(0)+'%'],
                ['Cabin',    ((geo.cabinRatio??0)*100).toFixed(0)+'%'],
                ['Boot',     ((geo.bootRatio??0)*100).toFixed(0)+'%'],
                ['Aspect',   (geo.aspectRatio??0).toFixed(2)],
                ['WS rake',  (geo.wsAngleDeg??0).toFixed(0)+'°'],
                ['Rear drop',((geo.rearDrop??0)*100).toFixed(0)+'%'],
              ].map(([k,v])=>(
                <div key={k} style={{display:'flex',justifyContent:'space-between',fontSize:11,padding:'3px 0',borderBottom:'0.5px solid rgba(255,255,255,0.04)'}}>
                  <span style={{fontFamily:"'IBM Plex Mono'",color:'var(--text-quaternary)'}}>{k}</span>
                  <span style={{fontFamily:"'IBM Plex Mono'",color:'var(--blue)'}}>{v}</span>
                </div>
              ))}
            </div>

            <SL n="05" t="Confidence"/>
            <div style={{...card,padding:'10px 12px'}}>
              <div style={{display:'flex',justifyContent:'space-between',fontSize:11,marginBottom:6}}>
                <span style={{fontFamily:"'IBM Plex Mono'",color:'var(--text-quaternary)'}}>score</span>
                <span style={{fontFamily:"'IBM Plex Mono'",color:'var(--blue)'}}>{((geo.confidence??0)*100).toFixed(0)}%</span>
              </div>
              <div style={{height:4,borderRadius:2,background:'var(--bg3)',overflow:'hidden'}}>
                <div style={{height:'100%',borderRadius:2,width:`${(geo.confidence??0)*100}%`,background:(geo.confidence??0)>0.7?'var(--green)':(geo.confidence??0)>0.4?'var(--orange)':'var(--red)',transition:'width 0.5s'}}/>
              </div>
            </div>
          </>
        ) : (
          <div style={{display:'flex',alignItems:'center',justifyContent:'center',padding:'40px 0',textAlign:'center'}}>
            <span style={{fontSize:12,color:'var(--text-quaternary)'}}>Results appear here after analysis</span>
          </div>
        )}
      </div>
    </div>
  )
}
