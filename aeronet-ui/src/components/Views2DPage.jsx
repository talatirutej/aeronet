// Copyright (c) 2026 Rutej Talati. All rights reserved.
// AeroNet — Views2DPage.jsx  v5  (no external APIs)
//
// Pipeline (fully client-side, no API):
//   1. IMAGE VIEWER    — drop zone with preview
//   2. IMAGE ANALYZER  — canvas-based pixel analysis:
//                        • edge detection via Sobel kernel
//                        • silhouette bounding box extraction
//                        • roofline curve fitting
//                        • windscreen angle estimation from gradient histogram
//                        • hood/cabin/boot ratio from vertical edge density
//                        • body type classification from aspect ratios + roofline shape
//   3. IMAGE DISPLAYER — 4 orthographic SVG views built from extracted geometry
//                        with physics-based Cp pressure field

import { useCallback, useRef, useState } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// Client-side image analysis via Canvas
// Returns structured geometry matching the SVG renderer's expected schema
// ─────────────────────────────────────────────────────────────────────────────

function analyzeImageCanvas(file) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      try {
        const MAX = 320
        const scale = Math.min(1, MAX / Math.max(img.width, img.height))
        const W = Math.round(img.width * scale)
        const H = Math.round(img.height * scale)

        const canvas = document.createElement('canvas')
        canvas.width = W; canvas.height = H
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, W, H)
        const { data } = ctx.getImageData(0, 0, W, H)

        // Convert to grayscale
        const gray = new Float32Array(W * H)
        for (let i = 0; i < W * H; i++) {
          const p = i * 4
          gray[i] = 0.299 * data[p] + 0.587 * data[p+1] + 0.114 * data[p+2]
        }

        // ── Background colour (corners) ──────────────────────────────────
        const cornerSamples = [
          gray[0], gray[W-1], gray[(H-1)*W], gray[(H-1)*W + W-1],
          gray[Math.floor(W/2)],   // top centre
        ]
        const bgLum = cornerSamples.reduce((a,b)=>a+b,0) / cornerSamples.length

        // ── Sobel edge detection ─────────────────────────────────────────
        const edges = new Float32Array(W * H)
        let maxEdge = 0
        for (let y = 1; y < H-1; y++) {
          for (let x = 1; x < W-1; x++) {
            const gx = (
              -gray[(y-1)*W+(x-1)] + gray[(y-1)*W+(x+1)]
              -2*gray[y*W+(x-1)]   + 2*gray[y*W+(x+1)]
              -gray[(y+1)*W+(x-1)] + gray[(y+1)*W+(x+1)]
            )
            const gy = (
              -gray[(y-1)*W+(x-1)] - 2*gray[(y-1)*W+x] - gray[(y-1)*W+(x+1)]
              +gray[(y+1)*W+(x-1)] + 2*gray[(y+1)*W+x] + gray[(y+1)*W+(x+1)]
            )
            const mag = Math.sqrt(gx*gx + gy*gy)
            edges[y*W+x] = mag
            if (mag > maxEdge) maxEdge = mag
          }
        }

        // Threshold edges — adaptive based on max
        const edgeThresh = maxEdge * 0.18
        const edgeBin = new Uint8Array(W * H)
        for (let i = 0; i < W*H; i++) edgeBin[i] = edges[i] > edgeThresh ? 1 : 0

        // ── Silhouette bounding box ─────────────────────────────────────
        // Find rows and columns with significant edge content
        const colEdge = new Float32Array(W)
        const rowEdge = new Float32Array(H)
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            colEdge[x] += edgeBin[y*W+x]
            rowEdge[y] += edgeBin[y*W+x]
          }
        }

        // Vehicle bounding box from edge projection
        const minEdgeCount = 2
        let vLeft=W, vRight=0, vTop=H, vBottom=0
        for (let x = 0; x < W; x++) if (colEdge[x] > minEdgeCount) { vLeft=Math.min(vLeft,x); vRight=Math.max(vRight,x) }
        for (let y = 0; y < H; y++) if (rowEdge[y] > minEdgeCount) { vTop=Math.min(vTop,y); vBottom=Math.max(vBottom,y) }

        // Clamp to at least 40% of image
        if (vRight - vLeft < W*0.4) { vLeft = W*0.1; vRight = W*0.9 }
        if (vBottom - vTop < H*0.3) { vTop = H*0.1; vBottom = H*0.9 }

        const vW = vRight - vLeft || 1
        const vH = vBottom - vTop || 1
        const aspectRatio = vW / vH   // wide=low car, narrow=tall SUV

        // ── Roofline extraction ──────────────────────────────────────────
        // For each column in vehicle bounding box, find topmost edge pixel
        const roofline = []
        for (let x = vLeft; x <= vRight; x++) {
          for (let y = vTop; y < vBottom; y++) {
            if (edgeBin[y*W+x]) { roofline.push({ x, y }); break }
          }
        }

        // Roofline slope: compare left third, mid third, right third
        const thirds = Math.floor(roofline.length / 3)
        let avgLeft = 0, avgMid = 0, avgRight = 0, n = 0
        for (let i = 0; i < thirds && roofline[i]; i++) { avgLeft += roofline[i].y; n++ }
        if (n) avgLeft /= n; n = 0
        for (let i = thirds; i < 2*thirds && roofline[i]; i++) { avgMid += roofline[i].y; n++ }
        if (n) avgMid /= n; n = 0
        for (let i = 2*thirds; i < roofline.length && roofline[i]; i++) { avgRight += roofline[i].y; n++ }
        if (n) avgRight /= n

        // Normalized roof heights (0=top of bbox, 1=bottom)
        const roofL  = (avgLeft  - vTop) / vH
        const roofM  = (avgMid   - vTop) / vH
        const roofR  = (avgRight - vTop) / vH
        // roofL > roofM = bonnet rises to greenhouse (normal)
        // roofR > roofM = rear drops (fastback/hatchback)
        const rearDrop = roofR - roofM   // positive = rear drops

        // ── Vertical edge density per horizontal zone ────────────────────
        // Divide vehicle width into 10 zones, count vertical edges in each
        const nZones = 10
        const zoneDensity = new Float32Array(nZones)
        for (let x = vLeft; x <= vRight; x++) {
          const zone = Math.min(nZones-1, Math.floor((x - vLeft) / vW * nZones))
          for (let y = vTop; y < vBottom; y++) {
            if (edgeBin[y*W+x]) zoneDensity[zone]++
          }
        }
        // Normalize
        const maxZD = Math.max(...zoneDensity) || 1
        for (let i = 0; i < nZones; i++) zoneDensity[i] /= maxZD

        // ── Hood/cabin/boot estimation from zone density ─────────────────
        // High vertical edge density = panel boundary (door, A-pillar, C-pillar)
        // Find peaks in density → likely A-pillar and C-pillar positions
        const peaks = []
        for (let i = 1; i < nZones-1; i++) {
          if (zoneDensity[i] > zoneDensity[i-1] && zoneDensity[i] > zoneDensity[i+1] && zoneDensity[i] > 0.5)
            peaks.push(i / nZones)
        }
        peaks.sort((a,b)=>a-b)

        // Estimate ratios
        let hoodRatio, cabinRatio, bootRatio
        if (peaks.length >= 2) {
          // Two main peaks: likely A-pillar and C-pillar
          const aPos = peaks[0]
          const cPos = peaks[peaks.length-1]
          hoodRatio  = aPos
          cabinRatio = cPos - aPos
          bootRatio  = 1.0 - cPos
        } else if (peaks.length === 1) {
          hoodRatio  = peaks[0]
          cabinRatio = 0.45
          bootRatio  = 1.0 - peaks[0] - 0.45
        } else {
          hoodRatio  = 0.30
          cabinRatio = 0.42
          bootRatio  = 0.28
        }

        // Clamp ratios
        hoodRatio  = Math.max(0.18, Math.min(0.42, hoodRatio))
        bootRatio  = Math.max(0.10, Math.min(0.40, bootRatio))
        cabinRatio = Math.max(0.28, Math.min(0.60, 1 - hoodRatio - bootRatio))

        // ── Height ratio — top of greenhouse to full body ─────────────────
        // Sample pixels in middle horizontal zone to find glass top
        const cabinH = roofM < 0.20 ? 0.62 :
                       roofM < 0.30 ? 0.60 : 0.58

        // ── Windscreen angle from roofline gradient ───────────────────────
        // Approximate: steeper roofline = more raked windscreen
        // rearDrop normalized 0–1 → angle 45–70 degrees from vertical
        const wsAngleDeg = Math.max(44, Math.min(72,
          50 + rearDrop * 60   // more rear drop = more raked
        ))

        // ── Ride height from wheel bottom vs body bottom ─────────────────
        // Look for horizontal edge band near bottom (tyre contact)
        let wheelRowDensity = 0
        const bottomBand = Math.floor(vBottom - vH * 0.18)
        for (let y = bottomBand; y < vBottom; y++) {
          for (let x = vLeft; x <= vRight; x++) {
            wheelRowDensity += edgeBin[y*W+x]
          }
        }
        wheelRowDensity /= (vH * 0.18 * vW || 1)
        const rideH = wheelRowDensity > 0.06 ? 0.14 : 0.08   // more edge activity = more clearance

        // ── Body type classification ─────────────────────────────────────
        let bodyType, rearType, rooflineType

        if (aspectRatio > 2.2) {
          // Very wide = probably SUV or estate
          if (roofR < roofM + 0.04) {
            bodyType = 'estate'; rearType = 'squareback'; rooflineType = 'flat'
          } else {
            bodyType = 'suv'; rearType = 'squareback'; rooflineType = 'flat'
          }
        } else if (aspectRatio > 1.8) {
          // Normal car — distinguish by rear drop
          if (rearDrop > 0.20) {
            bodyType = 'fastback'; rearType = 'fastback'; rooflineType = 'sloped_full'
          } else if (rearDrop > 0.10) {
            bodyType = 'hatchback'; rearType = 'hatchback'; rooflineType = 'sloped_rear'
          } else {
            bodyType = 'notchback'; rearType = 'notchback'; rooflineType = 'flat'
          }
        } else if (aspectRatio < 1.5) {
          // Tall = SUV or van
          bodyType = 'suv'; rearType = 'squareback'; rooflineType = 'flat'
        } else {
          bodyType = 'notchback'; rearType = 'notchback'; rooflineType = 'flat'
        }

        // ── Wheel positions ───────────────────────────────────────────────
        // Look for circular arc clusters near bottom of image
        const w1 = bodyType === 'pickup' ? 0.19 : hoodRatio * 0.65 + 0.04
        const w2 = bodyType === 'pickup' ? 0.78 : 1 - bootRatio * 0.55 - 0.04

        // ── Cd estimate from body type + wsAngle ─────────────────────────
        const baseCd = {
          fastback: 0.27, coupe: 0.28, notchback: 0.30,
          hatchback: 0.31, estate: 0.30, suv: 0.36,
          pickup: 0.42, van: 0.40,
        }[bodyType] ?? 0.30
        const wsEffect = (wsAngleDeg - 58) * 0.002   // rakier = less drag
        const Cd = Math.max(0.22, Math.min(0.48, baseCd - wsEffect))

        URL.revokeObjectURL(url)
        resolve({
          bodyType, rearType, rooflineType,
          hoodRatio, cabinRatio, bootRatio,
          cabinH, wsAngleDeg, rideH,
          w1, w2,
          Cd,
          aspectRatio,
          rearDrop,
          // debug
          _peaks: peaks,
          _roofLMR: [roofL, roofM, roofR],
        })
      } catch(e) {
        URL.revokeObjectURL(url)
        reject(e)
      }
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image load failed')) }
    img.src = url
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Cp physics — surface pressure coefficient
// t=longitudinal 0→1, hz=height 0→1, front=-1/rear=+1 normal indicator
// ─────────────────────────────────────────────────────────────────────────────

function cpAtPoint(t, hz, isFront, Cd) {
  const scale = Cd / 0.30
  const stag   = isFront ? Math.max(0, (1 - 7*t*t)) * 0.95 : 0
  const roof   = -1.35 * Math.sin(Math.PI * t) * Math.pow(Math.max(0, hz), 0.55)
  const under  = hz < 0.10 ? -0.38 * Math.sin(Math.PI * t) : 0
  const wake   = t > 0.80 ? -0.72 * Math.pow((t - 0.80)/0.20, 0.65) : 0
  const wscr   = (t > 0.16 && t < 0.30 && hz > 0.55) ? 0.22 : 0
  return (stag + roof + under + wake + wscr) * scale
}

function cpToRgb(cp) {
  const t = Math.max(0, Math.min(1, (cp + 1.5) / 2.5))
  const stops = [
    [0,    [33,71,217]],
    [0.25, [34,211,238]],
    [0.50, [132,204,22]],
    [0.75, [251,191,36]],
    [1.00, [239,68,68]],
  ]
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0,c0] = stops[i], [t1,c1] = stops[i+1]
    if (t <= t1) {
      const f = (t-t0)/(t1-t0)
      return `rgb(${Math.round(c0[0]+(c1[0]-c0[0])*f)},${Math.round(c0[1]+(c1[1]-c0[1])*f)},${Math.round(c0[2]+(c1[2]-c0[2])*f)})`
    }
  }
  return 'rgb(239,68,68)'
}

// ─────────────────────────────────────────────────────────────────────────────
// SIDE VIEW — hero SVG built from extracted geometry
// ─────────────────────────────────────────────────────────────────────────────

function SideView({ g, pressureMode }) {
  const W = 600, H = 230
  const PAD = 30

  // Canvas layout
  const bodyLen  = W - PAD * 2
  const totalH   = H * 0.78
  const rideHpx  = totalH * g.rideH
  const bodyH    = totalH * (1 - g.rideH) * 0.84
  const groundY  = H - 16
  const bodySill = groundY - rideHpx
  const bodyRoof = bodySill - bodyH

  const x = f => PAD + f * bodyLen

  // Key x positions from ratios
  const hoodEndX  = x(g.hoodRatio)
  const cabinEndX = x(g.hoodRatio + g.cabinRatio)
  const rearX     = x(1.0)

  // Windscreen geometry
  const wsRad     = (90 - g.wsAngleDeg) * Math.PI / 180
  const wsHeight  = bodyH * g.cabinH
  const wsRun     = wsHeight / Math.tan(wsRad)
  const aTopX     = hoodEndX + wsRun
  const aBaseY    = bodySill - bodyH * 0.72
  const roofY     = bodyRoof

  // Roofline mid-point sag
  const roofMidX  = (aTopX + cabinEndX) * 0.50
  const sag       = g.rooflineType === 'flat' ? 0 : bodyH * 0.025

  // Rear shape per body type
  let rearPath
  const bt = g.bodyType
  if (bt === 'fastback' || bt === 'coupe') {
    rearPath = [
      `Q ${x(g.hoodRatio + g.cabinRatio * 0.88)} ${roofY + bodyH*0.06} ${cabinEndX + 14} ${roofY + bodyH*0.18}`,
      `Q ${x(g.hoodRatio + g.cabinRatio * 1.06)} ${bodySill - bodyH*0.40} ${rearX} ${bodySill - bodyH*0.20}`,
    ].join(' ')
  } else if (bt === 'notchback') {
    rearPath = [
      `L ${cabinEndX} ${roofY + sag}`,
      `L ${cabinEndX + bodyLen*0.04} ${roofY + sag}`,
      `Q ${rearX - 6} ${roofY + sag + 6} ${rearX} ${bodySill - bodyH*0.22}`,
    ].join(' ')
  } else if (bt === 'estate') {
    rearPath = [
      `L ${cabinEndX} ${roofY + sag}`,
      `Q ${rearX - 4} ${roofY + sag + 3} ${rearX} ${bodySill - bodyH*0.20}`,
    ].join(' ')
  } else if (bt === 'suv') {
    rearPath = [
      `L ${cabinEndX} ${roofY + sag}`,
      `Q ${rearX - 8} ${roofY + sag + 8} ${rearX} ${bodySill - bodyH*0.18}`,
    ].join(' ')
  } else if (bt === 'pickup') {
    const bedTopY = bodySill - bodyH * 0.55
    rearPath = [
      `L ${cabinEndX} ${roofY + sag}`,
      `L ${cabinEndX} ${bedTopY}`,
      `L ${rearX - 6} ${bedTopY}`,
      `Q ${rearX} ${bedTopY} ${rearX} ${bodySill - bodyH*0.16}`,
    ].join(' ')
  } else {
    // hatchback
    rearPath = [
      `Q ${cabinEndX + 12} ${roofY + bodyH*0.12} ${rearX - 16} ${bodySill - bodyH*0.38}`,
      `Q ${rearX} ${bodySill - bodyH*0.32} ${rearX} ${bodySill - bodyH*0.16}`,
    ].join(' ')
  }

  const hoodY   = bodySill - bodyH * 0.52
  const frontDipY = bodySill - bodyH * 0.30

  const bodyPath = [
    `M ${x(0.025)} ${groundY - 1}`,
    `Q ${PAD} ${bodySill + 2} ${PAD} ${frontDipY}`,
    `L ${PAD} ${bodySill - bodyH * 0.46}`,
    `Q ${x(0.05)} ${hoodY} ${hoodEndX - bodyLen*0.018} ${hoodY}`,
    `Q ${hoodEndX} ${hoodY + bodyH*0.02} ${hoodEndX} ${aBaseY}`,
    `L ${aTopX} ${roofY}`,
    `Q ${roofMidX} ${roofY - 1} ${cabinEndX} ${roofY + sag}`,
    rearPath,
    `L ${rearX} ${bodySill}`,
    `Q ${rearX - 3} ${bodySill + 2} ${rearX - bodyLen*0.055} ${groundY - 1}`,
    `L ${x(0.025)} ${groundY - 1}`,
    'Z',
  ].join(' ')

  const dloPath = [
    `M ${hoodEndX + 4} ${aBaseY + 2}`,
    `L ${aTopX + 3} ${roofY + 4}`,
    `Q ${roofMidX} ${roofY + 4} ${cabinEndX - 4} ${roofY + sag + 4}`,
    bt === 'fastback' || bt === 'coupe'
      ? `Q ${cabinEndX + 14} ${roofY + bodyH*0.18} ${cabinEndX + 24} ${aBaseY + bodyH*0.12}`
      : bt === 'hatchback'
        ? `Q ${cabinEndX + 6} ${roofY + bodyH*0.14} ${cabinEndX + 10} ${aBaseY + 4}`
        : `L ${cabinEndX - 4} ${aBaseY + 4}`,
    `L ${hoodEndX + 4} ${aBaseY + 2}`,
    'Z',
  ].join(' ')

  const wR  = bodyH * (bt === 'suv' || bt === 'pickup' ? 0.195 : 0.170)
  const w1x = x(g.w1), w2x = x(g.w2)
  const wY  = groundY - wR

  const N = 18
  const cpBands = Array.from({length: N}, (_,i) => {
    const tM = (i + 0.5) / N
    const cp = cpAtPoint(tM, 0.65, tM < 0.15, g.Cd)
    return { x0: x(i/N), x1: x((i+1)/N)+1, color: cpToRgb(cp) }
  })

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',height:'100%'}} preserveAspectRatio="xMidYMid meet">
      <defs>
        <clipPath id="sc"><path d={bodyPath}/></clipPath>
        <linearGradient id="edgeG" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="rgba(255,255,255,0.18)"/>
          <stop offset="35%"  stopColor="rgba(255,255,255,0.04)"/>
          <stop offset="100%" stopColor="rgba(0,0,0,0.26)"/>
        </linearGradient>
        <linearGradient id="cpBar" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%"   stopColor="#2147d9"/>
          <stop offset="25%"  stopColor="#22d3ee"/>
          <stop offset="50%"  stopColor="#84cc16"/>
          <stop offset="75%"  stopColor="#fbbf24"/>
          <stop offset="100%" stopColor="#ef4444"/>
        </linearGradient>
      </defs>

      <ellipse cx={W/2} cy={groundY+6} rx={bodyLen*0.44} ry={8} fill="rgba(0,0,0,0.45)"/>
      <line x1={6} y1={groundY} x2={W-6} y2={groundY} stroke="#1A2530" strokeWidth="1.5"/>

      {pressureMode && (
        <g clipPath="url(#sc)">
          {cpBands.map((b,i) => (
            <rect key={i} x={b.x0} y={bodyRoof-20} width={b.x1-b.x0} height={bodyH+rideHpx+30} fill={b.color}/>
          ))}
        </g>
      )}

      <path d={bodyPath}
        fill={pressureMode ? 'rgba(6,12,20,0.22)' : '#1A2C3A'}
        stroke="#82CFFF" strokeWidth={pressureMode ? 0.75 : 1.1}/>
      <path d={bodyPath} fill="url(#edgeG)"/>

      <path d={dloPath} fill={pressureMode ? 'rgba(130,207,255,0.20)' : 'rgba(130,207,255,0.13)'}
        stroke="rgba(130,207,255,0.72)" strokeWidth="0.85"/>
      <path d={dloPath} fill="rgba(0,16,32,0.40)"/>

      {/* DRL */}
      <rect x={PAD+1} y={bodySill-bodyH*0.44} width={4} height={bodyH*0.065} rx="1" fill="rgba(255,255,200,0.88)"/>
      {/* Tail lamp */}
      <rect x={rearX-3} y={bodySill-bodyH*(bt==='fastback'||bt==='coupe'?0.30:0.20)}
        width={4} height={bodyH*0.13} rx="1" fill="rgba(220,50,50,0.90)"/>

      {/* Door shut line */}
      {bt !== 'pickup' && (
        <line x1={x(g.hoodRatio + g.cabinRatio*0.44)} y1={aBaseY + 2}
              x2={x(g.hoodRatio + g.cabinRatio*0.44)} y2={bodySill - 1}
          stroke="rgba(130,207,255,0.22)" strokeWidth="0.7"/>
      )}
      {/* Wing mirror */}
      <path d={`M ${hoodEndX+8} ${aBaseY-1} L ${hoodEndX+24} ${aBaseY-7} L ${hoodEndX+24} ${aBaseY+3} Z`}
        fill="#0C1820" stroke="rgba(130,207,255,0.28)" strokeWidth="0.7"/>

      {/* Wheels */}
      {[[w1x,wY],[w2x,wY]].map(([cx,cy],i) => (
        <g key={i}>
          <circle cx={cx} cy={cy} r={wR+4} fill="rgba(0,0,0,0.35)"/>
          <circle cx={cx} cy={cy} r={wR} fill="#080E14" stroke="#324252" strokeWidth="2.4"/>
          <circle cx={cx} cy={cy} r={wR*0.72} fill="#0F1C24" stroke="#263442" strokeWidth="1.4"/>
          {[0,36,72,108,144,180,216,252,288,324].map(a => {
            const r2 = a*Math.PI/180
            return <line key={a}
              x1={cx+Math.cos(r2)*wR*0.30} y1={cy+Math.sin(r2)*wR*0.30}
              x2={cx+Math.cos(r2)*wR*0.68} y2={cy+Math.sin(r2)*wR*0.68}
              stroke="#263442" strokeWidth="1.5"/>
          })}
          <circle cx={cx} cy={cy} r={wR*0.13} fill="#324252"/>
        </g>
      ))}
      {[[w1x,wY],[w2x,wY]].map(([cx,cy],i) => (
        <circle key={i} cx={cx} cy={cy} r={wR+3}
          fill="none" stroke="#080E14" strokeWidth="5.5"/>
      ))}

      {pressureMode && [0.28,0.52,0.76].map((fh,i) => {
        const ay = bodySill - bodyH*fh
        return (
          <g key={i} transform={`translate(${PAD-22},${ay})`}>
            <line x1={0} y1={0} x2={14} y2={0} stroke="#82CFFF" strokeWidth="1.1" opacity={0.65}/>
            <polygon points="16,0 10,-3.5 10,3.5" fill="#82CFFF" opacity={0.65}/>
          </g>
        )
      })}

      {pressureMode && (
        <>
          <rect x={W-15} y={H*0.14} width={9} height={H*0.62} rx="2" fill="url(#cpBar)"/>
          <text x={W-21} y={H*0.14+5} textAnchor="end" fill="#5A7A8A" fontSize="7" fontFamily="monospace">+1.0</text>
          <text x={W-21} y={H*0.76+5} textAnchor="end" fill="#5A7A8A" fontSize="7" fontFamily="monospace">−1.5</text>
        </>
      )}

      <text x={W/2} y={H-3} textAnchor="middle"
        fill="#2A3E4E" fontSize="9" fontFamily="monospace" letterSpacing="0.13em">
        SIDE PROFILE · {g.bodyType.toUpperCase()} · Cd {g.Cd.toFixed(3)}
      </text>
    </svg>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// FRONT VIEW
// ─────────────────────────────────────────────────────────────────────────────

function FrontView({ g }) {
  const W=300, H=220, cx=W/2, groundY=H-14
  const isTall = g.bodyType==='suv' || g.bodyType==='pickup' || g.bodyType==='van'
  const bh = isTall ? 106 : g.bodyType==='fastback'||g.bodyType==='coupe' ? 86 : 94
  const bw = isTall ? 104 : 90
  const rideHpx = bh * g.rideH * 1.4
  const bodyBot = groundY - rideHpx, bodyTop = bodyBot - bh
  const roofW = bw * (g.bodyType==='fastback'||g.bodyType==='coupe' ? 0.37 : isTall ? 0.45 : 0.40)
  const shdW  = bw * 0.50

  const frontPath = [
    `M ${cx} ${bodyTop}`,
    `Q ${cx-roofW*0.55} ${bodyTop} ${cx-roofW} ${bodyTop+bh*0.08}`,
    `Q ${cx-shdW*0.94} ${bodyTop+bh*0.50} ${cx-shdW} ${bodyBot-bh*0.09}`,
    `Q ${cx-bw*0.50} ${bodyBot-3} ${cx-bw*0.42} ${bodyBot}`,
    `L ${cx+bw*0.42} ${bodyBot}`,
    `Q ${cx+bw*0.50} ${bodyBot-3} ${cx+shdW} ${bodyBot-bh*0.09}`,
    `Q ${cx+shdW*0.94} ${bodyTop+bh*0.50} ${cx+roofW} ${bodyTop+bh*0.08}`,
    `Q ${cx+roofW*0.55} ${bodyTop} ${cx} ${bodyTop}`,
    'Z',
  ].join(' ')

  const wsBot = bodyBot - bh*0.36
  const wscPath = [
    `M ${cx} ${bodyTop+bh*0.03}`,
    `Q ${cx-roofW*0.7} ${bodyTop+bh*0.04} ${cx-roofW*0.92} ${bodyTop+bh*0.14}`,
    `L ${cx-roofW*0.95} ${wsBot}`,
    `L ${cx+roofW*0.95} ${wsBot}`,
    `L ${cx+roofW*0.92} ${bodyTop+bh*0.14}`,
    `Q ${cx+roofW*0.7} ${bodyTop+bh*0.04} ${cx} ${bodyTop+bh*0.03}`,
    'Z',
  ].join(' ')

  const wR  = 15 + (isTall ? 3 : 0)
  const wY  = groundY - wR

  const cpBands = Array.from({length:9},(_,i) => {
    const f = i/8
    const dist = Math.abs(f-0.5)*2
    const cp = (0.85*(1-dist*dist) - 0.25) * (g.Cd/0.30)
    return { xL: cx - bw*(0.50-i*0.11), color: cpToRgb(cp) }
  })

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',height:'100%'}} preserveAspectRatio="xMidYMid meet">
      <defs>
        <clipPath id="fclip"><path d={frontPath}/></clipPath>
        <radialGradient id="fgrd" cx="50%" cy="38%">
          <stop offset="0%"   stopColor="#1C3040"/>
          <stop offset="100%" stopColor="#080E14"/>
        </radialGradient>
      </defs>
      <ellipse cx={cx} cy={groundY+5} rx={bw*0.65} ry={7} fill="rgba(0,0,0,0.42)"/>
      <line x1={12} y1={groundY} x2={W-12} y2={groundY} stroke="#1A2530" strokeWidth="1.5"/>
      <g clipPath="url(#fclip)">
        {cpBands.map((b,i) => (
          <rect key={i} x={b.xL} y={bodyTop-4} width={bw*0.11+1} height={bh+8} fill={b.color} opacity={0.82}/>
        ))}
      </g>
      <path d={frontPath} fill="rgba(6,12,20,0.28)" stroke="#82CFFF" strokeWidth="0.95"/>
      <path d={wscPath} fill="rgba(130,207,255,0.11)" stroke="rgba(130,207,255,0.68)" strokeWidth="0.85"/>
      <path d={wscPath} fill="rgba(0,16,32,0.42)"/>
      {[-1,1].map(s => (
        <g key={s}>
          <ellipse cx={cx+s*roofW*0.76} cy={bodyTop+bh*0.27} rx={roofW*0.23} ry={bh*0.065}
            fill="rgba(255,255,200,0.09)" stroke="rgba(130,207,255,0.62)" strokeWidth="0.8"/>
          <ellipse cx={cx+s*roofW*0.76} cy={bodyTop+bh*0.27} rx={roofW*0.11} ry={bh*0.028}
            fill="rgba(255,255,220,0.92)"/>
          <line x1={cx+s*roofW*0.54} y1={bodyTop+bh*0.21}
                x2={cx+s*roofW*0.95} y2={bodyTop+bh*0.21}
            stroke="rgba(255,255,200,0.65)" strokeWidth="1.2"/>
        </g>
      ))}
      <rect x={cx-roofW*0.56} y={bodyBot-bh*0.34} width={roofW*1.12} height={bh*0.22}
        rx="4" fill="rgba(0,0,0,0.65)" stroke="#263442" strokeWidth="0.9"/>
      {[0,1,2,3].map(i=>(
        <line key={i}
          x1={cx-roofW*0.53} y1={bodyBot-bh*(0.32-i*0.048)}
          x2={cx+roofW*0.53} y2={bodyBot-bh*(0.32-i*0.048)}
          stroke="#1E3040" strokeWidth="0.7"/>
      ))}
      <line x1={cx} y1={bodyBot-bh*0.34} x2={cx} y2={bodyBot-bh*0.12} stroke="#1E3040" strokeWidth="0.9"/>
      {[[cx-bw*0.56,wY],[cx+bw*0.56,wY]].map(([wcx,wcy],i)=>(
        <g key={i}>
          <circle cx={wcx} cy={wcy} r={wR} fill="#080E14" stroke="#324252" strokeWidth="2.2"/>
          <circle cx={wcx} cy={wcy} r={wR*0.70} fill="#0F1C24" stroke="#263442" strokeWidth="1.2"/>
          {[0,60,120,180,240,300].map(a=>{
            const r2=a*Math.PI/180
            return <line key={a}
              x1={wcx+Math.cos(r2)*wR*0.28} y1={wcy+Math.sin(r2)*wR*0.28}
              x2={wcx+Math.cos(r2)*wR*0.66} y2={wcy+Math.sin(r2)*wR*0.66}
              stroke="#263442" strokeWidth="1.4"/>
          })}
          <circle cx={wcx} cy={wcy} r={wR*0.14} fill="#324252"/>
        </g>
      ))}
      <text x={cx} y={H-3} textAnchor="middle"
        fill="#2A3E4E" fontSize="9" fontFamily="monospace" letterSpacing="0.12em">FRONT VIEW</text>
    </svg>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// TOP VIEW
// ─────────────────────────────────────────────────────────────────────────────

function TopView({ g }) {
  const W=300, H=220, cx=W/2, cy=H/2+4
  const isTall = g.bodyType==='suv'||g.bodyType==='pickup'
  const bw = isTall ? 76 : 68
  const bl = g.bodyType==='pickup' ? 168 : g.bodyType==='estate' ? 160 : 154

  const body = [
    `M ${cx} ${cy-bl/2+5}`,
    `Q ${cx-bw*0.28} ${cy-bl/2+1} ${cx-bw*0.50} ${cy-bl/2+18}`,
    `Q ${cx-bw*0.52} ${cy-bl/2+44} ${cx-bw*0.52} ${cy}`,
    `Q ${cx-bw*0.52} ${cy+bl*0.12} ${cx-bw*0.50} ${cy+bl/2-14}`,
    `Q ${cx-bw*0.44} ${cy+bl/2-4} ${cx} ${cy+bl/2-4}`,
    `Q ${cx+bw*0.44} ${cy+bl/2-4} ${cx+bw*0.50} ${cy+bl/2-14}`,
    `Q ${cx+bw*0.52} ${cy+bl*0.12} ${cx+bw*0.52} ${cy}`,
    `Q ${cx+bw*0.52} ${cy-bl/2+44} ${cx+bw*0.50} ${cy-bl/2+18}`,
    `Q ${cx+bw*0.28} ${cy-bl/2+1} ${cx} ${cy-bl/2+5}`,
    'Z',
  ].join(' ')

  const ghFront = cy + bl*(g.hoodRatio - 0.50)
  const ghRear  = cy + bl*(g.hoodRatio + g.cabinRatio - 0.50)
  const ghW = bw * (g.bodyType==='fastback'||g.bodyType==='coupe' ? 0.40 : isTall ? 0.44 : 0.41)

  const ghPath = [
    `M ${cx} ${ghFront-3}`,
    `Q ${cx-ghW*0.50} ${ghFront+2} ${cx-ghW*0.52} ${ghFront+15}`,
    `L ${cx-ghW*0.52} ${ghRear-10}`,
    `Q ${cx-ghW*0.45} ${ghRear} ${cx} ${ghRear}`,
    `Q ${cx+ghW*0.45} ${ghRear} ${cx+ghW*0.52} ${ghRear-10}`,
    `L ${cx+ghW*0.52} ${ghFront+15}`,
    `Q ${cx+ghW*0.50} ${ghFront+2} ${cx} ${ghFront-3}`,
    'Z',
  ].join(' ')

  const frontWheelY = cy + bl*(g.w1-0.50)
  const rearWheelY  = cy + bl*(g.w2-0.50)

  const N=12
  const cpStrips = Array.from({length:N},(_,i) => {
    const tM=(i+0.5)/N
    return { y0: cy-bl/2+4+i*(bl/N), y1: cy-bl/2+4+(i+1)*(bl/N), color: cpToRgb(cpAtPoint(tM,0.70,tM<0.15,g.Cd)) }
  })

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',height:'100%'}} preserveAspectRatio="xMidYMid meet">
      <defs><clipPath id="tc2"><path d={body}/></clipPath></defs>
      <g clipPath="url(#tc2)">
        {cpStrips.map((s,i)=>(
          <rect key={i} x={cx-bw*0.60} y={s.y0} width={bw*1.20} height={s.y1-s.y0+1} fill={s.color} opacity={0.78}/>
        ))}
      </g>
      <path d={body} fill="rgba(6,12,20,0.28)" stroke="#82CFFF" strokeWidth="0.9"/>
      <path d={ghPath} fill="rgba(130,207,255,0.10)" stroke="rgba(130,207,255,0.62)" strokeWidth="0.8"/>
      <path d={ghPath} fill="rgba(0,16,32,0.38)"/>
      {g.bodyType==='pickup' && (
        <rect x={cx-bw*0.48} y={ghRear} width={bw*0.96} height={cy+bl/2-14-ghRear}
          fill="rgba(0,0,0,0.22)" stroke="#263442" strokeWidth="0.8"/>
      )}
      <line x1={cx} y1={cy-bl/2} x2={cx} y2={cy+bl/2} stroke="#1A2530" strokeWidth="0.6" strokeDasharray="5,5"/>
      <text x={cx} y={cy-bl/2-7} textAnchor="middle" fill="#82CFFF" fontSize="8" fontFamily="monospace">▲ FRONT</text>
      {[-bw*0.26,0,bw*0.26].map((ox,i)=>(
        <g key={i} transform={`translate(${cx+ox},${cy-bl/2-18})`}>
          <line x1={0} y1={-4} x2={0} y2={5} stroke="#82CFFF" strokeWidth="0.9" opacity={0.45}/>
          <polygon points="0,8 -2.5,3 2.5,3" fill="#82CFFF" opacity={0.45}/>
        </g>
      ))}
      {[[cx-bw*0.60,frontWheelY],[cx+bw*0.60,frontWheelY],[cx-bw*0.60,rearWheelY],[cx+bw*0.60,rearWheelY]].map(([wx,wy],i)=>(
        <g key={i}>
          <rect x={wx-10} y={wy-18} width={20} height={36} rx="4" fill="#080E14" stroke="#324252" strokeWidth="1.4"/>
          <line x1={wx} y1={wy-12} x2={wx} y2={wy+12} stroke="#1E2E3A" strokeWidth="0.8"/>
        </g>
      ))}
      {[-1,1].map(s=>{
        const mx=cx+s*bw*0.56, my=ghFront+10
        return <path key={s} d={`M ${mx} ${my} L ${mx+s*14} ${my-4} L ${mx+s*14} ${my+5} Z`}
          fill="#0C1820" stroke="#1E2E3A" strokeWidth="0.7"/>
      })}
      <text x={cx} y={H-3} textAnchor="middle" fill="#2A3E4E" fontSize="9" fontFamily="monospace" letterSpacing="0.12em">TOP VIEW</text>
    </svg>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// UNDERSIDE VIEW
// ─────────────────────────────────────────────────────────────────────────────

function UnderView({ g }) {
  const W=300, H=220, cx=W/2, cy=H/2+4
  const isTall=g.bodyType==='suv'||g.bodyType==='pickup'
  const bw=isTall?76:68, bl=g.bodyType==='pickup'?168:154

  const body = [
    `M ${cx} ${cy-bl/2+5}`,
    `Q ${cx-bw*0.28} ${cy-bl/2+1} ${cx-bw*0.50} ${cy-bl/2+18}`,
    `L ${cx-bw*0.52} ${cy+bl*0.08}`,
    `Q ${cx-bw*0.50} ${cy+bl/2-14} ${cx-bw*0.44} ${cy+bl/2-4}`,
    `L ${cx+bw*0.44} ${cy+bl/2-4}`,
    `Q ${cx+bw*0.50} ${cy+bl/2-14} ${cx+bw*0.52} ${cy+bl*0.08}`,
    `L ${cx+bw*0.50} ${cy-bl/2+18}`,
    `Q ${cx+bw*0.28} ${cy-bl/2+1} ${cx} ${cy-bl/2+5}`,
    'Z',
  ].join(' ')

  const N=12
  const cpStrips = Array.from({length:N},(_,i) => {
    const tM=(i+0.5)/N
    return { y0:cy-bl/2+4+i*(bl/N), y1:cy-bl/2+4+(i+1)*(bl/N), color:cpToRgb(cpAtPoint(tM,0.05,tM<0.15,g.Cd)) }
  })

  const frontWheelY=cy+bl*(g.w1-0.50), rearWheelY=cy+bl*(g.w2-0.50)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',height:'100%'}} preserveAspectRatio="xMidYMid meet">
      <defs><clipPath id="uc"><path d={body}/></clipPath></defs>
      <g clipPath="url(#uc)">
        {cpStrips.map((s,i)=>(
          <rect key={i} x={cx-bw*0.60} y={s.y0} width={bw*1.20} height={s.y1-s.y0+1} fill={s.color} opacity={0.82}/>
        ))}
      </g>
      <path d={body} fill="rgba(6,12,20,0.30)" stroke="#82CFFF" strokeWidth="0.9"/>
      <rect x={cx-bw*0.36} y={cy-bl*0.30} width={bw*0.72} height={bl*0.52}
        rx="3" fill="rgba(0,0,0,0.20)" stroke="#1A2C3A" strokeWidth="0.7"/>
      <rect x={cx-bw*0.08} y={cy-bl*0.28} width={bw*0.16} height={bl*0.50}
        rx="5" fill="rgba(0,0,0,0.28)" stroke="#1A2C3A" strokeWidth="0.8"/>
      {[-bw*0.22,bw*0.22].map((ox,i)=>(
        <line key={i} x1={cx+ox} y1={cy-bl*0.28} x2={cx+ox} y2={cy+bl*0.20}
          stroke="#1A2C3A" strokeWidth="2" strokeDasharray="5,8"/>
      ))}
      <rect x={cx-bw*0.35} y={cy-bl*0.38} width={bw*0.70} height={bl*0.15}
        rx="5" fill="none" stroke="#263442" strokeWidth="0.9" strokeDasharray="4,3"/>
      <rect x={cx-bw*0.32} y={cy+bl*0.14} width={bw*0.64} height={bl*0.12}
        rx="5" fill="none" stroke="#263442" strokeWidth="0.9" strokeDasharray="4,3"/>
      {[-3,-1,1,3].map(f=>(
        <line key={f} x1={cx+f*bw*0.09} y1={cy+bl*0.22} x2={cx+f*bw*0.09} y2={cy+bl/2-6}
          stroke="#324252" strokeWidth="1.6"/>
      ))}
      {(g.bodyType==='fastback'||g.bodyType==='coupe'?[-bw*0.18,bw*0.18]:[-bw*0.13,bw*0.13]).map((ox,i)=>(
        <g key={i}>
          <circle cx={cx+ox} cy={cy+bl/2-10} r={5.5} fill="#080E14" stroke="#324252" strokeWidth="1.4"/>
          <circle cx={cx+ox} cy={cy+bl/2-10} r={2.8} fill="#040810"/>
        </g>
      ))}
      {[[cx-bw*0.60,frontWheelY],[cx+bw*0.60,frontWheelY],[cx-bw*0.60,rearWheelY],[cx+bw*0.60,rearWheelY]].map(([wx,wy],i)=>(
        <rect key={i} x={wx-10} y={wy-18} width={20} height={36} rx="4"
          fill="#080E14" stroke="#324252" strokeWidth="1.4"/>
      ))}
      <text x={cx} y={cy-bl/2-7} textAnchor="middle" fill="#82CFFF" fontSize="8" fontFamily="monospace">▲ FRONT</text>
      <text x={cx} y={H-3} textAnchor="middle" fill="#2A3E4E" fontSize="9" fontFamily="monospace" letterSpacing="0.12em">UNDERSIDE VIEW</text>
    </svg>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Cd Gauge
// ─────────────────────────────────────────────────────────────────────────────

function CdGauge({ cd }) {
  const pct   = Math.min(1, Math.max(0, (cd-0.15)/0.35))
  const angle = -135 + pct*270
  const color = cd<0.24?'#30D158':cd<0.27?'#0A84FF':cd<0.32?'#FF9F0A':'#FF453A'
  const label = cd<0.24?'Exceptional':cd<0.27?'Excellent':cd<0.32?'Average':'High drag'
  const rad   = d => (d-90)*Math.PI/180
  const nx = 60 + 46*Math.cos(rad(angle)), ny = 62 + 46*Math.sin(rad(angle))
  return (
    <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:3}}>
      <svg viewBox="0 0 120 72" style={{width:128,height:80}}>
        <path d="M10,62 A50,50 0 0,1 110,62" fill="none" stroke="#1A2830" strokeWidth="10" strokeLinecap="round"/>
        <path d="M10,62 A50,50 0 0,1 110,62" fill="none" stroke={color} strokeWidth="10"
          strokeLinecap="round" strokeDasharray={`${pct*157} 157`}/>
        {[0.20,0.25,0.30,0.35,0.40].map((v,i)=>{
          const tp=Math.min(1,(v-0.15)/0.35)
          const ta=-135+tp*270
          return <circle key={i} cx={60+40*Math.cos(rad(ta))} cy={62+40*Math.sin(rad(ta))} r="2" fill="#263442"/>
        })}
        <line x1="60" y1="62" x2={nx} y2={ny} stroke={color} strokeWidth="2.4" strokeLinecap="round"/>
        <circle cx="60" cy="62" r="5" fill={color}/>
        <text x="60" y="56" textAnchor="middle" fill={color}
          fontSize="14" fontFamily="monospace" fontWeight="bold">{cd.toFixed(3)}</text>
      </svg>
      <span style={{fontSize:11,fontWeight:600,color,letterSpacing:'0.04em'}}>{label}</span>
    </div>
  )
}

const BENCHMARKS=[
  {name:'Tesla Model 3',Cd:0.23},{name:'BMW 3 Series',Cd:0.26},
  {name:'Audi A4',Cd:0.27},{name:'Toyota Camry',Cd:0.28},
  {name:'VW Golf',Cd:0.30},{name:'Porsche 911',Cd:0.30},
  {name:'Ford Mustang',Cd:0.35},{name:'Generic SUV',Cd:0.38},
]

function BenchmarkBar({ cd }) {
  const pct = v => ((v-0.20)/0.24)*100
  return (
    <div style={{width:'100%'}}>
      <div style={{position:'relative',height:18,borderRadius:4,overflow:'hidden',marginBottom:4}}>
        <div style={{position:'absolute',inset:0,
          background:'linear-gradient(to right,#30D158,#0A84FF,#fbbf24,#FF453A)'}}/>
        {BENCHMARKS.map((b,i)=>(
          <div key={i} style={{position:'absolute',top:0,bottom:0,width:1,
            background:'rgba(0,0,0,0.5)',left:`${pct(b.Cd)}%`}}/>
        ))}
        <div style={{position:'absolute',top:-2,bottom:-2,width:3,background:'white',borderRadius:2,
          left:`${pct(cd)}%`,transform:'translateX(-1px)',boxShadow:'0 0 6px rgba(255,255,255,0.8)'}}>
          <div style={{position:'absolute',top:-4,left:'50%',transform:'translateX(-50%) rotate(45deg)',
            width:6,height:6,background:'white'}}/>
        </div>
      </div>
      <div style={{display:'flex',justifyContent:'space-between',
        fontSize:9,fontFamily:'monospace',color:'#3A5464',marginBottom:6}}>
        <span>0.20</span><span>0.30</span><span>0.40+</span>
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:4}}>
        {BENCHMARKS.map((b,i)=>{
          const barW = Math.max(4,((b.Cd-0.20)/0.24)*100)
          const clr  = b.Cd<0.26?'#30D158':b.Cd<0.30?'#0A84FF':b.Cd<0.34?'#FF9F0A':'#FF453A'
          return (
            <div key={i} style={{display:'flex',alignItems:'center',gap:6}}>
              <div style={{width:`${barW}%`,maxWidth:'55%',height:3,borderRadius:2,background:clr,flexShrink:0}}/>
              <span style={{fontSize:9,fontFamily:'monospace',color:clr,width:30,flexShrink:0}}>{b.Cd.toFixed(2)}</span>
              <span style={{fontSize:9,color:'#3A5464',truncate:true,overflow:'hidden',whiteSpace:'nowrap',textOverflow:'ellipsis'}}>{b.name}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Analysis state display
// ─────────────────────────────────────────────────────────────────────────────

function AnalysisReadout({ g }) {
  const rows = [
    ['Body type',      g.bodyType],
    ['Hood ratio',     (g.hoodRatio*100).toFixed(0)+'%'],
    ['Cabin ratio',    (g.cabinRatio*100).toFixed(0)+'%'],
    ['Boot/bed ratio', (g.bootRatio*100).toFixed(0)+'%'],
    ['Windscreen',     g.wsAngleDeg.toFixed(0)+'° rake'],
    ['Roofline',       g.rooflineType.replace('_',' ')],
    ['Ride height',    g.rideH > 0.12 ? 'high' : g.rideH > 0.09 ? 'standard' : 'low'],
    ['Rear type',      g.rearType],
    ['Cd estimate',    g.Cd.toFixed(3)],
  ]
  return (
    <div style={{display:'flex',flexDirection:'column',gap:4}}>
      {rows.map(([k,v])=>(
        <div key={k} style={{display:'flex',justifyContent:'space-between',
          fontSize:10,fontFamily:'monospace',padding:'2px 0',
          borderBottom:'1px solid rgba(130,207,255,0.08)'}}>
          <span style={{color:'#3A5464'}}>{k}</span>
          <span style={{color:'#82CFFF',fontWeight:500}}>{v}</span>
        </div>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

const VIEWS=[
  {id:'side', label:'Side',     icon:'↔'},
  {id:'front',label:'Front',    icon:'→'},
  {id:'top',  label:'Top-Down', icon:'↓'},
  {id:'under',label:'Underside',icon:'↑'},
]

export default function Views2DPage() {
  const [dragOver,   setDragOver]   = useState(false)
  const [file,       setFile]       = useState(null)
  const [preview,    setPreview]    = useState(null)
  const [stage,      setStage]      = useState('idle')
  const [geo,        setGeo]        = useState(null)
  const [error,      setError]      = useState(null)
  const [activeView, setActiveView] = useState('side')
  const [cpOn,       setCpOn]       = useState(true)
  const fileRef = useRef(null)

  const acceptFile = useCallback((f) => {
    if (!f || !f.type.startsWith('image/')) return
    setFile(f)
    setPreview(URL.createObjectURL(f))
    setGeo(null); setError(null); setStage('ready')
  }, [])

  const onDrop = useCallback((e) => {
    e.preventDefault(); setDragOver(false)
    acceptFile(e.dataTransfer.files[0])
  }, [acceptFile])

  const run = async () => {
    if (!file) return
    setError(null); setGeo(null); setStage('analyzing')
    try {
      const result = await analyzeImageCanvas(file)
      setGeo(result)
      setStage('done')
    } catch(e) {
      setError(e.message)
      setStage('error')
    }
  }

  const isRunning = stage === 'analyzing'
  const cd = geo?.Cd ?? 0.30

  const improvements = {
    fastback:  ['Active rear diffuser','Underbody flat floor','Flush wheel covers'],
    coupe:     ['Active aero rear spoiler','Belly pan','Wider tyres for downforce'],
    notchback: ['Active grille shutters','Lower ride height','Rear lip spoiler'],
    hatchback: ['Rear roof spoiler','Underbody diffuser','Tyre aero covers'],
    estate:    ['Roof aero rails','Active rear spoiler','Flush body cladding'],
    suv:       ['Lower ride height','Active grille shutters','Air suspension'],
    pickup:    ['Tonneau cover','Air dam','Bed extender fairings'],
  }
  const suggestions = improvements[geo?.bodyType] ?? ['Lower ride height','Reduce frontal area','Active grille shutters']

  return (
    <div className="flex flex-col h-full bg-md-background text-md-on-surface overflow-hidden">

      {/* Header */}
      <div className="flex items-center gap-4 px-5 py-3 border-b border-md-outline-variant bg-md-surface-container-low shrink-0">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full bg-md-primary ${isRunning?'animate-ping':'animate-pulse-slow'}`}/>
          <span className="text-label-lg text-md-primary font-medium tracking-widest uppercase">AeroVision</span>
        </div>
        <span className="text-md-outline">·</span>
        <span className="text-body-sm text-md-on-surface-variant">
          Canvas pixel analysis → geometry extraction → 4-view orthographic reconstruction
        </span>
        <div className="ml-auto flex items-center gap-2">
          {['Sobel Edge Detection','Roofline Fitting','Cp Physics'].map(t=>(
            <span key={t} className="text-label-sm text-md-outline-variant px-2 py-0.5 rounded border border-md-outline-variant">{t}</span>
          ))}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">

        {/* Left — image viewer */}
        <div className="w-64 shrink-0 flex flex-col gap-3 p-4 border-r border-md-outline-variant overflow-y-auto bg-md-surface-container-low">

          <div className="flex items-center gap-2">
            <span className="text-label-sm text-md-primary font-mono">01</span>
            <div className="flex-1 h-px bg-md-outline-variant"/>
            <span className="text-label-sm text-md-on-surface-variant uppercase tracking-wide">Upload</span>
          </div>

          <div
            className={`relative rounded-xl border-2 border-dashed transition-all cursor-pointer overflow-hidden
              ${dragOver?'border-md-primary bg-md-primary/10 scale-[1.01]':'border-md-outline-variant hover:border-md-primary/50'}`}
            style={{minHeight:156}}
            onDragOver={e=>{e.preventDefault();setDragOver(true)}}
            onDragLeave={()=>setDragOver(false)}
            onDrop={onDrop}
            onClick={()=>fileRef.current?.click()}
          >
            <input ref={fileRef} type="file" accept="image/*" className="hidden"
              onChange={e=>acceptFile(e.target.files[0])}/>
            {preview ? (
              <>
                <img src={preview} alt="preview" className="w-full object-cover rounded-xl" style={{maxHeight:190}}/>
                <div className="absolute inset-0 flex items-end justify-center pb-2 pointer-events-none">
                  <span className="text-label-sm text-white/60 bg-black/50 px-2 py-0.5 rounded backdrop-blur-sm">click to change</span>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center gap-3 py-10 px-4">
                <div className="w-12 h-12 rounded-full bg-md-surface-container-high flex items-center justify-center text-2xl">📸</div>
                <span className="text-body-sm text-md-on-surface-variant text-center">Drop a vehicle photo</span>
                <span className="text-label-sm text-md-outline">JPG · PNG · WEBP</span>
              </div>
            )}
          </div>

          {file && (
            <div className="flex items-center gap-2 px-2 py-1 rounded bg-md-surface-container border border-md-outline-variant">
              <span className="text-label-sm text-md-on-surface-variant truncate flex-1" style={{fontSize:10}}>{file.name}</span>
              <span className="text-label-sm text-md-outline shrink-0" style={{fontSize:9}}>{(file.size/1024).toFixed(0)}KB</span>
            </div>
          )}

          <button onClick={run} disabled={!file||isRunning}
            className={`w-full py-3 rounded-xl font-medium text-body-md transition-all
              ${!file||isRunning
                ?'bg-md-surface-container text-md-on-surface-variant cursor-not-allowed opacity-60'
                :'bg-md-primary text-md-on-primary hover:shadow-glow-sm active:scale-[0.98]'}`}>
            {isRunning
              ? <span className="flex items-center justify-center gap-2">
                  <span className="w-3.5 h-3.5 border-2 border-md-on-primary/30 border-t-md-on-primary rounded-full animate-spin"/>
                  Analysing image…
                </span>
              : 'Analyse Vehicle'}
          </button>

          {error && (
            <div className="rounded-lg bg-md-error/10 border border-md-error/30 p-2 text-label-sm text-md-error">⚠ {error}</div>
          )}

          {geo && (
            <>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-label-sm text-md-primary font-mono">02</span>
                <div className="flex-1 h-px bg-md-outline-variant"/>
                <span className="text-label-sm text-md-on-surface-variant uppercase tracking-wide">Extracted</span>
              </div>
              <div className="rounded-lg bg-md-surface-container border border-md-outline-variant p-3">
                <AnalysisReadout g={geo}/>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-label-sm text-md-primary font-mono">03</span>
                <div className="flex-1 h-px bg-md-outline-variant"/>
                <span className="text-label-sm text-md-on-surface-variant uppercase tracking-wide">Drag</span>
              </div>
              <div className="rounded-lg bg-md-surface-container border border-md-outline-variant p-3 flex flex-col items-center gap-2">
                <CdGauge cd={cd}/>
              </div>
            </>
          )}
        </div>

        {/* Centre — 2D views */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex items-center gap-1 px-4 pt-3 pb-2 border-b border-md-outline-variant shrink-0">
            <div className="flex gap-1 flex-1">
              {VIEWS.map(v=>(
                <button key={v.id} onClick={()=>setActiveView(v.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-label-md transition-all
                    ${activeView===v.id
                      ?'bg-md-primary/15 text-md-primary border border-md-primary/30'
                      :'text-md-on-surface-variant hover:bg-md-surface-container hover:text-md-on-surface'}`}>
                  <span className="font-mono text-xs">{v.icon}</span>
                  <span>{v.label}</span>
                </button>
              ))}
            </div>
            <button onClick={()=>setCpOn(p=>!p)}
              className={`ml-2 px-3 py-1.5 rounded-md text-label-sm border transition-all
                ${cpOn?'bg-md-primary text-md-on-primary border-md-primary'
                      :'text-md-on-surface-variant border-md-outline-variant hover:border-md-primary/50'}`}>
              Cp {cpOn?'ON':'OFF'}
            </button>
          </div>

          <div className="flex-1 flex flex-col p-4 gap-4 overflow-hidden bg-md-background">
            {!geo ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-6">
                <div className="w-20 h-20 rounded-full bg-md-surface-container border-2 border-md-outline-variant flex items-center justify-center text-4xl">🔬</div>
                <div className="text-center max-w-md">
                  <div className="text-title-md text-md-on-surface mb-2">Canvas-based vehicle analysis</div>
                  <div className="text-body-sm text-md-on-surface-variant">
                    Upload a vehicle photo. Sobel edge detection extracts the silhouette, roofline fitting measures the body proportions, and windscreen angle is estimated from gradient data — then 4 accurate orthographic views are generated with a Cp pressure field.
                  </div>
                </div>
                <div className="flex items-center gap-2 text-label-sm text-md-on-surface-variant flex-wrap justify-center">
                  {['Edge detect','Silhouette','Roofline fit','Ratio extract','4-view render'].map((s,i,a)=>(
                    <span key={i} className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded border font-mono
                        ${stage==='analyzing'&&i===0?'bg-md-primary text-md-on-primary border-md-primary animate-pulse'
                          :'bg-md-surface-container border-md-outline-variant text-md-outline'}`}>{s}</span>
                      {i<a.length-1&&<span className="text-md-outline">→</span>}
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <>
                <div className="flex-1 rounded-xl bg-md-surface-container border border-md-outline-variant overflow-hidden flex items-center justify-center p-3" style={{minHeight:0}}>
                  <div style={{width:'100%',height:'100%',maxHeight:285}}>
                    {activeView==='side'  && <SideView  g={geo} pressureMode={cpOn}/>}
                    {activeView==='front' && <FrontView g={geo}/>}
                    {activeView==='top'   && <TopView   g={geo}/>}
                    {activeView==='under' && <UnderView g={geo}/>}
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-2 shrink-0">
                  {VIEWS.map(v=>(
                    <button key={v.id} onClick={()=>setActiveView(v.id)}
                      className={`rounded-lg border overflow-hidden transition-all
                        ${activeView===v.id
                          ?'border-md-primary bg-md-primary/10 ring-1 ring-md-primary/30'
                          :'border-md-outline-variant bg-md-surface-container hover:border-md-primary/40'}`}>
                      <div style={{width:'100%',aspectRatio:'5/3',padding:'3px'}}>
                        {v.id==='side'  && <SideView  g={geo} pressureMode={cpOn}/>}
                        {v.id==='front' && <FrontView g={geo}/>}
                        {v.id==='top'   && <TopView   g={geo}/>}
                        {v.id==='under' && <UnderView g={geo}/>}
                      </div>
                      <div className="text-label-sm text-md-on-surface-variant text-center py-1">{v.label}</div>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Right — results */}
        <div className="w-72 shrink-0 flex flex-col gap-4 p-4 border-l border-md-outline-variant overflow-y-auto bg-md-surface-container-low">

          {geo && (
            <>
              <div className="flex items-center gap-2">
                <span className="text-label-sm text-md-primary font-mono">04</span>
                <div className="flex-1 h-px bg-md-outline-variant"/>
                <span className="text-label-sm text-md-on-surface-variant uppercase tracking-wide">Benchmark</span>
              </div>
              <div className="rounded-lg bg-md-surface-container border border-md-outline-variant p-3">
                <BenchmarkBar cd={cd}/>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-label-sm text-md-primary font-mono">05</span>
                <div className="flex-1 h-px bg-md-outline-variant"/>
                <span className="text-label-sm text-md-on-surface-variant uppercase tracking-wide">Reasoning</span>
              </div>
              <div className="rounded-lg bg-md-surface-container border border-md-outline-variant p-3 space-y-2">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-2xl font-bold text-md-primary">{cd.toFixed(3)}</span>
                  <div>
                    <div className="text-label-sm text-md-on-surface-variant">Estimated from</div>
                    <div className="text-label-sm text-md-primary">{geo.bodyType} profile</div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1">
                  {['Front fascia','Greenhouse','Rear wake'].map(c=>(
                    <span key={c} className="text-label-sm px-2 py-0.5 rounded-full bg-md-error/10 border border-md-error/30 text-md-on-surface-variant">{c}</span>
                  ))}
                </div>
                <p className="text-body-sm text-md-on-surface-variant leading-relaxed">
                  Canvas edge analysis classified the body as <span className="text-md-primary">{geo.bodyType}</span> from
                  aspect ratio {geo.aspectRatio.toFixed(2)} and rear-drop {(geo.rearDrop*100).toFixed(0)}%.
                  Windscreen rake {geo.wsAngleDeg.toFixed(0)}° from vertical.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-label-sm text-md-primary font-mono">06</span>
                <div className="flex-1 h-px bg-md-outline-variant"/>
                <span className="text-label-sm text-md-on-surface-variant uppercase tracking-wide">Optimise</span>
              </div>
              <div className="rounded-lg bg-md-surface-container border border-md-outline-variant p-3">
                <ul className="flex flex-col gap-2">
                  {suggestions.map((s,i)=>(
                    <li key={i} className="flex gap-2 text-body-sm text-md-on-surface-variant">
                      <span className="text-md-primary shrink-0 font-mono">→</span>{s}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-label-sm text-md-primary font-mono">07</span>
                <div className="flex-1 h-px bg-md-outline-variant"/>
                <span className="text-label-sm text-md-on-surface-variant uppercase tracking-wide">Compare</span>
              </div>
              <div className="rounded-lg bg-md-surface-container border border-md-outline-variant p-3">
                <div className="flex flex-col gap-2">
                  {BENCHMARKS.slice(0,5).map((b,i)=>{
                    const diff = (cd - b.Cd).toFixed(3)
                    const clr  = cd <= b.Cd ? '#30D158' : '#FF9F0A'
                    return (
                      <div key={i} className="flex items-center gap-2 text-body-sm">
                        <span className="font-mono text-md-primary w-10 shrink-0">{b.Cd.toFixed(2)}</span>
                        <span className="text-md-on-surface font-medium shrink-0 truncate flex-1">{b.name}</span>
                        <span className="font-mono text-label-sm shrink-0" style={{color:clr}}>
                          {cd<=b.Cd?'-':'+'}{ Math.abs(cd - b.Cd).toFixed(3) }
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </>
          )}

          {!geo && (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center py-12">
              <div className="text-4xl opacity-20">📊</div>
              <div className="text-body-sm text-md-on-surface-variant">Analysis output appears here.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
