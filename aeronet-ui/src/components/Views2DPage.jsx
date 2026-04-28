// Copyright (c) 2026 Rutej Talati. All rights reserved.
// AeroNet — Views2DPage.jsx v6
//
// Major fixes vs v5:
//  - Front view: correct automotive taper — WIDE at shoulder, NARROW at roof
//                proper 3-zone fascia: upper grille, lower bumper, splitter
//                windscreen fills between A-pillars (not smaller than body)
//                headlights at correct height between hood and shoulder
//  - Side view:  tighter Bezier control points tuned per body type
//                wheelbase inferred from hood+boot ratios
//                correct wheel arch cutout rendering order
//  - Canvas analysis: better background subtract before edge detection
//                     improved peak detection for pillar positions
//
// New features:
//  - Drag breakdown donut chart (right panel)
//  - Cp contour lines overlay (iso-pressure lines)
//  - Yaw angle simulation (±15° view in top panel)
//  - Front/rear lift force indicators
//  - Body type confidence bar
//  - Airflow separation markers on side view
//  - Ground effect indicator on underside
//  - Export SVG button

import { useCallback, useRef, useState } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// Canvas image analysis — Sobel + silhouette + roofline
// ─────────────────────────────────────────────────────────────────────────────

function analyzeImageCanvas(file) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      try {
        const MAX = 400
        const scale = Math.min(1, MAX / Math.max(img.width, img.height))
        const W = Math.round(img.width * scale)
        const H = Math.round(img.height * scale)
        const cvs = document.createElement('canvas')
        cvs.width = W; cvs.height = H
        const ctx = cvs.getContext('2d')
        ctx.drawImage(img, 0, 0, W, H)
        const { data } = ctx.getImageData(0, 0, W, H)

        // Grayscale
        const gray = new Float32Array(W * H)
        for (let i = 0; i < W * H; i++) {
          gray[i] = 0.299*data[i*4] + 0.587*data[i*4+1] + 0.114*data[i*4+2]
        }

        // Sample background from corners and edges — subtract it
        const bgSamples = []
        const margin = Math.floor(Math.min(W,H)*0.08)
        for (let x=0;x<margin;x++) for (let y=0;y<margin;y++) bgSamples.push(gray[y*W+x])
        for (let x=W-margin;x<W;x++) for (let y=0;y<margin;y++) bgSamples.push(gray[y*W+x])
        const bg = bgSamples.reduce((a,b)=>a+b,0)/bgSamples.length

        // Sobel edge detection
        const edges = new Float32Array(W * H)
        let maxEdge = 0
        for (let y=1;y<H-1;y++) for (let x=1;x<W-1;x++) {
          const gx = -gray[(y-1)*W+(x-1)] + gray[(y-1)*W+(x+1)]
                     -2*gray[y*W+(x-1)] + 2*gray[y*W+(x+1)]
                     -gray[(y+1)*W+(x-1)] + gray[(y+1)*W+(x+1)]
          const gy = -gray[(y-1)*W+(x-1)] - 2*gray[(y-1)*W+x] - gray[(y-1)*W+(x+1)]
                     +gray[(y+1)*W+(x-1)] + 2*gray[(y+1)*W+x] + gray[(y+1)*W+(x+1)]
          const m = Math.sqrt(gx*gx+gy*gy)
          edges[y*W+x] = m; if(m>maxEdge) maxEdge=m
        }
        const thresh = maxEdge * 0.16
        const bin = new Uint8Array(W*H)
        for (let i=0;i<W*H;i++) bin[i] = edges[i]>thresh ? 1 : 0

        // Silhouette bbox
        const colE = new Float32Array(W), rowE = new Float32Array(H)
        for (let y=0;y<H;y++) for (let x=0;x<W;x++) { colE[x]+=bin[y*W+x]; rowE[y]+=bin[y*W+x] }
        const minC = 3
        let vL=W,vR=0,vT=H,vB=0
        for (let x=0;x<W;x++) if(colE[x]>minC){vL=Math.min(vL,x);vR=Math.max(vR,x)}
        for (let y=0;y<H;y++) if(rowE[y]>minC){vT=Math.min(vT,y);vB=Math.max(vB,y)}
        if(vR-vL<W*0.35){vL=Math.floor(W*0.08);vR=Math.floor(W*0.92)}
        if(vB-vT<H*0.25){vT=Math.floor(H*0.08);vB=Math.floor(H*0.88)}
        const vW=vR-vL||1, vH_=vB-vT||1
        const aspectRatio = vW/vH_

        // Roofline — topmost edge per column
        const roofline = []
        for (let x=vL;x<=vR;x++) {
          for (let y=vT;y<vB;y++) {
            if(bin[y*W+x]){ roofline.push({x,y}); break }
          }
        }
        const seg = Math.floor(roofline.length/4)
        const avg = (arr) => arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0
        const roofL  = (avg(roofline.slice(0,seg).map(p=>p.y))        - vT) / vH_
        const roofML = (avg(roofline.slice(seg,2*seg).map(p=>p.y))    - vT) / vH_
        const roofMR = (avg(roofline.slice(2*seg,3*seg).map(p=>p.y))  - vT) / vH_
        const roofR  = (avg(roofline.slice(3*seg).map(p=>p.y))        - vT) / vH_
        const rearDrop = Math.max(0, roofR - Math.min(roofML,roofMR))
        const frontRise = Math.max(0, roofL - Math.min(roofML,roofMR)) // bonnet higher = hood is long

        // Vertical edge density — 12 zones
        const nZ=12
        const zoneD = new Float32Array(nZ)
        for (let x=vL;x<=vR;x++) {
          const z = Math.min(nZ-1,Math.floor((x-vL)/vW*nZ))
          for (let y=vT;y<vB;y++) if(bin[y*W+x]) zoneD[z]++
        }
        const maxZD = Math.max(...zoneD)||1
        for (let i=0;i<nZ;i++) zoneD[i]/=maxZD

        // Find significant peaks (A-pillar, C-pillar, door shut lines)
        const peaks=[]
        for (let i=1;i<nZ-1;i++) {
          if(zoneD[i]>zoneD[i-1]&&zoneD[i]>zoneD[i+1]&&zoneD[i]>0.45) peaks.push(i/nZ)
        }
        peaks.sort((a,b)=>a-b)

        // Pillar positions
        let aPos=0.28, cPos=0.72
        if(peaks.length>=2){ aPos=peaks[0]; cPos=peaks[peaks.length-1] }
        else if(peaks.length===1){ aPos=Math.min(peaks[0],0.35); cPos=Math.max(peaks[0],0.65) }

        const hoodRatio  = Math.max(0.18, Math.min(0.40, aPos))
        const bootRatio  = Math.max(0.12, Math.min(0.38, 1-cPos))
        const cabinRatio = Math.max(0.28, Math.min(0.60, 1-hoodRatio-bootRatio))

        // Cabin height ratio
        const cabinH = 0.58 + frontRise*0.1

        // Windscreen angle from the slope between roofline at A-pillar zone and peak
        const roofPeakFrac = (roofML+roofMR)/2
        const aSlope = Math.abs(roofML - roofL) / (Math.max(aPos-0,0.01))
        const wsAngleDeg = Math.max(44, Math.min(72, 48 + rearDrop*55 + aSlope*12))

        // Ride height from lower edge content
        const btmBandEdge = (() => {
          let s=0, n=0
          for(let y=Math.floor(vB-vH_*0.20);y<vB;y++) for(let x=vL;x<=vR;x++) { s+=bin[y*W+x]; n++ }
          return n ? s/n : 0
        })()
        const rideH = btmBandEdge > 0.08 ? 0.15 : 0.08

        // Body type classification — improved
        let bodyType, rearType, rooflineType
        if(aspectRatio > 2.4) {
          if(rearDrop > 0.15) { bodyType='estate'; rearType='squareback'; rooflineType='flat' }
          else { bodyType='suv'; rearType='squareback'; rooflineType='flat' }
        } else if(aspectRatio > 1.85) {
          if(rearDrop > 0.24) { bodyType='fastback'; rearType='fastback'; rooflineType='sloped_full' }
          else if(rearDrop > 0.12) { bodyType='hatchback'; rearType='hatchback'; rooflineType='sloped_rear' }
          else { bodyType='notchback'; rearType='notchback'; rooflineType='flat' }
        } else if(aspectRatio < 1.55) {
          bodyType='suv'; rearType='squareback'; rooflineType='flat'
        } else {
          if(rearDrop>0.20) { bodyType='fastback'; rearType='fastback'; rooflineType='sloped_full' }
          else { bodyType='notchback'; rearType='notchback'; rooflineType='flat' }
        }

        // Wheel positions
        const w1 = hoodRatio*0.60 + 0.05
        const w2 = 1 - bootRatio*0.55 - 0.04

        // Body colour estimate from centre strip average
        let rSum=0,gSum=0,bSum=0,cn=0
        const mx=Math.floor((vL+vR)/2), myStart=Math.floor(vT+vH_*0.3), myEnd=Math.floor(vT+vH_*0.7)
        for(let y=myStart;y<myEnd;y++) {
          const i=(y*W+mx)*4; rSum+=data[i]; gSum+=data[i+1]; bSum+=data[i+2]; cn++
        }
        const bodyColorHex = cn ? `#${[rSum,gSum,bSum].map(v=>{
          const h=Math.round(v/cn).toString(16); return h.length===1?'0'+h:h
        }).join('')}` : '#546E7A'

        // Cd from body type + wsAngle
        const baseCd={fastback:0.27,coupe:0.27,notchback:0.30,hatchback:0.31,estate:0.29,suv:0.36,pickup:0.42,van:0.40}
        const Cd = Math.max(0.22, Math.min(0.48, (baseCd[bodyType]??0.30) - (wsAngleDeg-58)*0.0018))

        // Confidence score 0-1
        const confidence = Math.min(1, peaks.length/3 * 0.4 + (1-Math.abs(aspectRatio-2)/3)*0.6)

        URL.revokeObjectURL(url)
        resolve({
          bodyType, rearType, rooflineType,
          hoodRatio, cabinRatio, bootRatio,
          cabinH, wsAngleDeg, rideH,
          w1, w2, Cd, aspectRatio, rearDrop, frontRise,
          bodyColorHex, confidence,
          _peaks: peaks, _zones: Array.from(zoneD),
        })
      } catch(e) { URL.revokeObjectURL(url); reject(e) }
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image load failed')) }
    img.src = url
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Cp physics
// ─────────────────────────────────────────────────────────────────────────────

function cpAtPoint(t, hz, isFront, Cd) {
  const s = Cd/0.30
  const stag  = isFront ? Math.max(0,(1-7*t*t))*0.95 : 0
  const roof  = -1.35*Math.sin(Math.PI*t)*Math.pow(Math.max(0,hz),0.55)
  const under = hz<0.10 ? -0.38*Math.sin(Math.PI*t) : 0
  const wake  = t>0.80 ? -0.72*Math.pow((t-0.80)/0.20,0.65) : 0
  const wscr  = (t>0.16&&t<0.30&&hz>0.55) ? 0.22 : 0
  return (stag+roof+under+wake+wscr)*s
}

function cpToRgb(cp) {
  const t = Math.max(0,Math.min(1,(cp+1.5)/2.5))
  const stops=[[0,[33,71,217]],[0.25,[34,211,238]],[0.50,[132,204,22]],[0.75,[251,191,36]],[1,[239,68,68]]]
  for(let i=0;i<stops.length-1;i++){
    const [t0,c0]=stops[i],[t1,c1]=stops[i+1]
    if(t<=t1){const f=(t-t0)/(t1-t0);return `rgb(${[0,1,2].map(j=>Math.round(c0[j]+(c1[j]-c0[j])*f)).join(',')})`}
  }
  return 'rgb(239,68,68)'
}

// Drag breakdown percentages by body type
function getDragBreakdown(bt) {
  const breakdowns = {
    fastback:  [{name:'Pressure',  pct:0.38,c:'#ef4444'},{name:'Friction',  pct:0.22,c:'#fbbf24'},{name:'Induced', pct:0.16,c:'#84cc16'},{name:'Wheels', pct:0.14,c:'#22d3ee'},{name:'Cooling',pct:0.10,c:'#2147d9'}],
    notchback: [{name:'Pressure',  pct:0.40,c:'#ef4444'},{name:'Friction',  pct:0.20,c:'#fbbf24'},{name:'Induced', pct:0.18,c:'#84cc16'},{name:'Wheels', pct:0.14,c:'#22d3ee'},{name:'Cooling',pct:0.08,c:'#2147d9'}],
    hatchback: [{name:'Pressure',  pct:0.36,c:'#ef4444'},{name:'Friction',  pct:0.22,c:'#fbbf24'},{name:'Induced', pct:0.18,c:'#84cc16'},{name:'Wheels', pct:0.14,c:'#22d3ee'},{name:'Cooling',pct:0.10,c:'#2147d9'}],
    suv:       [{name:'Pressure',  pct:0.46,c:'#ef4444'},{name:'Friction',  pct:0.18,c:'#fbbf24'},{name:'Induced', pct:0.16,c:'#84cc16'},{name:'Wheels', pct:0.12,c:'#22d3ee'},{name:'Cooling',pct:0.08,c:'#2147d9'}],
    estate:    [{name:'Pressure',  pct:0.38,c:'#ef4444'},{name:'Friction',  pct:0.22,c:'#fbbf24'},{name:'Induced', pct:0.16,c:'#84cc16'},{name:'Wheels', pct:0.14,c:'#22d3ee'},{name:'Cooling',pct:0.10,c:'#2147d9'}],
    pickup:    [{name:'Pressure',  pct:0.52,c:'#ef4444'},{name:'Friction',  pct:0.16,c:'#fbbf24'},{name:'Induced', pct:0.14,c:'#84cc16'},{name:'Wheels', pct:0.12,c:'#22d3ee'},{name:'Cooling',pct:0.06,c:'#2147d9'}],
  }
  return breakdowns[bt] ?? breakdowns.notchback
}

// ─────────────────────────────────────────────────────────────────────────────
// SIDE VIEW — Bezier-correct per body type
// ─────────────────────────────────────────────────────────────────────────────

function SideView({ g, cpOn, showSep, showIso }) {
  const W=620, H=240, PAD=32
  const bLen = W-PAD*2
  const rideH = bLen * 0.055 * (g.rideH>0.12?1.8:1.0)
  const bH  = H*0.52   // body height in px (not counting ride height)
  const gY  = H-18     // ground y
  const sill = gY - rideH
  const roofY= sill - bH
  const x = f => PAD + f*bLen

  const hx  = x(g.hoodRatio)    // A-pillar base x
  const chx = x(g.hoodRatio+g.cabinRatio)  // C-pillar x
  const rX  = x(1.0)

  // Windscreen — A-pillar top position from angle + height
  const wsH   = bH * g.cabinH
  const wsRad = (90 - g.wsAngleDeg) * Math.PI/180
  const wsRun = wsH / Math.tan(Math.max(0.1, wsRad))
  const aTx   = hx + wsRun       // A-pillar top x
  const aBy   = sill - bH*0.74  // A-pillar base y (DLO bottom front)

  // Hood shape — rises from front to cowl
  const hoodY = sill - bH*0.50  // bonnet surface height
  const cowlY = sill - bH*0.72  // cowl/scuttle (where bonnet meets screen)

  // Roofline sag (most cars have slight sag in centre)
  const roofMidX = (aTx + chx)*0.50
  const sag = g.bodyType==='suv' ? bH*0.01 : g.bodyType==='estate' ? 0 : bH*0.015

  // Rear path — precise per body type
  let rearSVG = ''
  const bt = g.bodyType
  if(bt==='fastback'||bt==='coupe') {
    // Continuous flowing slope — C-pillar merges into boot
    const cSlope1X = x(g.hoodRatio+g.cabinRatio*0.82)
    const cSlope2X = x(g.hoodRatio+g.cabinRatio*1.05)
    rearSVG = [
      `Q ${cSlope1X} ${roofY+sag} ${chx+8} ${roofY+bH*0.10}`,
      `C ${cSlope2X} ${sill-bH*0.38} ${rX-10} ${sill-bH*0.28} ${rX} ${sill-bH*0.18}`,
    ].join(' ')
  } else if(bt==='notchback') {
    // Three-box: roof stays high, vertical drop to boot, horizontal boot lid, steep rear
    const bootTopY = roofY+sag
    const deckY    = sill-bH*0.56
    rearSVG = [
      `L ${chx} ${bootTopY}`,                               // C-pillar top stays high
      `L ${x(g.hoodRatio+g.cabinRatio+0.02)} ${bootTopY}`,  // boot lid start
      `Q ${rX-14} ${bootTopY+4} ${rX} ${deckY}`,            // boot lid to rear
      `L ${rX} ${sill-bH*0.18}`,                            // rear face
    ].join(' ')
  } else if(bt==='estate') {
    // Long flat roof all the way to near-vertical rear
    rearSVG = [
      `L ${chx} ${roofY+sag}`,
      `Q ${rX-5} ${roofY+sag+3} ${rX} ${sill-bH*0.18}`,
    ].join(' ')
  } else if(bt==='suv') {
    // D-segment SUV: high C-pillar, slight slope to vertical rear
    rearSVG = [
      `L ${chx} ${roofY+sag}`,
      `Q ${rX-10} ${roofY+sag+8} ${rX} ${sill-bH*0.20}`,
    ].join(' ')
  } else if(bt==='pickup') {
    const bedTopY = sill-bH*0.52
    rearSVG = [
      `L ${chx} ${roofY+sag}`,       // cab rear top
      `L ${chx} ${bedTopY}`,          // cab rear vertical
      `L ${rX-5} ${bedTopY}`,         // bed rail
      `Q ${rX} ${bedTopY} ${rX} ${sill-bH*0.14}`,
    ].join(' ')
  } else {
    // hatchback — steep rear glass
    rearSVG = [
      `Q ${chx+14} ${roofY+bH*0.10} ${rX-18} ${sill-bH*0.40}`,
      `Q ${rX} ${sill-bH*0.32} ${rX} ${sill-bH*0.16}`,
    ].join(' ')
  }

  const bodyPath = [
    `M ${x(0.03)} ${gY-1}`,
    // Front bumper — curves up to lower fascia
    `C ${PAD+2} ${sill+4} ${PAD} ${sill-bH*0.18} ${PAD} ${sill-bH*0.32}`,
    // Fascia up to bonnet line
    `L ${PAD} ${sill-bH*0.47}`,
    // Bonnet leading edge / power bulge
    `Q ${x(0.04)} ${hoodY-bH*0.03} ${x(0.10)} ${hoodY}`,
    // Bonnet surface to cowl
    `Q ${x(0.22)} ${hoodY} ${hx} ${cowlY}`,
    // A-pillar / windscreen (straight ruled line at wsAngleDeg)
    `L ${aTx} ${roofY}`,
    // Roofline
    `Q ${roofMidX} ${roofY-sag} ${chx} ${roofY+sag}`,
    // Rear section (body-type specific)
    rearSVG,
    // Underbody flat / rear bumper
    `L ${rX} ${sill}`,
    `Q ${rX-3} ${sill+2} ${rX-bLen*0.055} ${gY-1}`,
    `L ${x(0.03)} ${gY-1}`,
    'Z',
  ].join(' ')

  // DLO (Day Light Opening) — the glass area
  const dloPath = (() => {
    const dloFrontY = aBy
    const dloRoofL  = roofY+3
    const dloRoofR  = roofY+sag+3
    let rear = ''
    if(bt==='fastback'||bt==='coupe') {
      rear = `Q ${chx+8} ${roofY+bH*0.14} ${chx+26} ${dloFrontY+bH*0.10}`
    } else if(bt==='notchback') {
      rear = `L ${chx-4} ${dloFrontY+2}`  // vertical C-pillar in notchback
    } else if(bt==='hatchback') {
      rear = `Q ${chx+10} ${roofY+bH*0.12} ${chx+16} ${dloFrontY+4}`
    } else {
      rear = `L ${chx-4} ${dloFrontY+2}`
    }
    return [
      `M ${hx+5} ${dloFrontY}`,
      `L ${aTx+3} ${dloRoofL}`,
      `Q ${roofMidX} ${dloRoofL} ${chx-4} ${dloRoofR}`,
      rear,
      `L ${hx+5} ${dloFrontY}`,
      'Z',
    ].join(' ')
  })()

  const wR  = bH*(bt==='suv'||bt==='pickup'?0.210:0.178)
  const w1x = x(g.w1), w2x = x(g.w2)
  const wY  = gY - wR

  // Cp colour bands
  const N=20
  const cpBands = Array.from({length:N},(_,i)=>{
    const tM=(i+0.5)/N
    return {x0:x(i/N),x1:x((i+1)/N)+1,color:cpToRgb(cpAtPoint(tM,0.65,tM<0.15,g.Cd))}
  })

  // Iso-pressure contour lines (5 Cp levels)
  const isoLevels = [-1.0,-0.5,0.0,0.35,0.70]

  // Airflow separation markers
  const sepX = bt==='fastback' ? x(g.hoodRatio+g.cabinRatio*0.88) : x(g.hoodRatio+g.cabinRatio)
  const sepY = bt==='fastback' ? roofY+bH*0.08 : roofY+sag

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',height:'100%'}} preserveAspectRatio="xMidYMid meet">
      <defs>
        <clipPath id="sc"><path d={bodyPath}/></clipPath>
        <linearGradient id="edgeHi" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="rgba(255,255,255,0.16)"/>
          <stop offset="40%"  stopColor="rgba(255,255,255,0.03)"/>
          <stop offset="100%" stopColor="rgba(0,0,0,0.24)"/>
        </linearGradient>
        <linearGradient id="cpBar" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%"   stopColor="#2147d9"/>
          <stop offset="25%"  stopColor="#22d3ee"/>
          <stop offset="50%"  stopColor="#84cc16"/>
          <stop offset="75%"  stopColor="#fbbf24"/>
          <stop offset="100%" stopColor="#ef4444"/>
        </linearGradient>
        <filter id="sep"><feGaussianBlur stdDeviation="1.2"/></filter>
      </defs>

      {/* Ground shadow */}
      <ellipse cx={W/2} cy={gY+6} rx={bLen*0.43} ry={8} fill="rgba(0,0,0,0.45)"/>
      <line x1={6} y1={gY} x2={W-6} y2={gY} stroke="#182430" strokeWidth="1.5"/>

      {/* Cp bands clipped to body */}
      {cpOn && <g clipPath="url(#sc)">
        {cpBands.map((b,i)=>(
          <rect key={i} x={b.x0} y={roofY-20} width={b.x1-b.x0} height={bH+rideH+30} fill={b.color}/>
        ))}
      </g>}

      {/* Iso-pressure contour lines */}
      {cpOn && showIso && isoLevels.map((cpLev,li)=>{
        const tTgt = (cpLev+1.5)/2.5
        // Approximate x position where this Cp level crosses the roofline
        // by finding where stagnation+roof Cp = cpLev
        const pts = []
        for(let i=0;i<=100;i++) {
          const t=i/100, cp=cpAtPoint(t,0.65,t<0.15,g.Cd)
          if(Math.abs(cp-cpLev)<0.08) pts.push({x:x(t),y:roofY+bH*(1-0.65)*0.3})
        }
        if(!pts.length) return null
        return pts.map((p,pi) => (
          <circle key={`${li}-${pi}`} cx={p.x} cy={p.y} r={1.2}
            fill={cpToRgb(cpLev)} opacity={0.7}/>
        ))
      })}

      {/* Body */}
      <path d={bodyPath}
        fill={cpOn ? 'rgba(5,10,18,0.24)' : '#192838'}
        stroke="#82CFFF" strokeWidth={cpOn?0.75:1.1}/>
      <path d={bodyPath} fill="url(#edgeHi)"/>

      {/* DLO */}
      <path d={dloPath} fill={cpOn?'rgba(130,207,255,0.18)':'rgba(130,207,255,0.12)'}
        stroke="rgba(130,207,255,0.72)" strokeWidth="0.85"/>
      <path d={dloPath} fill="rgba(0,14,30,0.40)"/>

      {/* B-pillar (solid) */}
      {bt!=='pickup' && bt!=='fastback' && bt!=='coupe' && (
        <line
          x1={x(g.hoodRatio+g.cabinRatio*0.46)} y1={aBy}
          x2={x(g.hoodRatio+g.cabinRatio*0.46)} y2={sill}
          stroke="rgba(0,0,0,0.6)" strokeWidth="3.5"/>
      )}

      {/* Door shut lines */}
      {bt!=='pickup' && (
        <line
          x1={x(g.hoodRatio+g.cabinRatio*0.46)} y1={aBy+1}
          x2={x(g.hoodRatio+g.cabinRatio*0.46)} y2={sill-1}
          stroke="rgba(130,207,255,0.20)" strokeWidth="0.8"/>
      )}

      {/* Wing mirror */}
      <path d={`M ${hx+9} ${aBy-2} L ${hx+28} ${aBy-9} L ${hx+28} ${aBy+3} Z`}
        fill="#0A1620" stroke="rgba(130,207,255,0.3)" strokeWidth="0.7"/>

      {/* Headlight DRL strip */}
      <rect x={PAD+2} y={sill-bH*0.44} width={5} height={bH*0.065} rx="1.5"
        fill="rgba(255,255,200,0.90)"/>
      {/* Headlight housing */}
      <path d={`M ${PAD+2} ${sill-bH*0.46} Q ${x(0.08)} ${sill-bH*0.48} ${x(0.12)} ${sill-bH*0.42} L ${PAD+2} ${sill-bH*0.38} Z`}
        fill="rgba(255,255,200,0.08)" stroke="rgba(130,207,255,0.4)" strokeWidth="0.6"/>

      {/* Tail lamp */}
      <rect x={rX-4} y={sill-bH*(bt==='fastback'||bt==='coupe'?0.30:0.22)}
        width={5} height={bH*0.14} rx="1.5" fill="rgba(220,50,50,0.90)"/>

      {/* Airflow separation marker */}
      {showSep && (
        <g>
          <circle cx={sepX} cy={sepY} r={5} fill="rgba(251,191,36,0.25)" filter="url(#sep)"/>
          <circle cx={sepX} cy={sepY} r={2.5} fill="#fbbf24" opacity={0.8}/>
          {[0,40,80,120,160,200,240,280,320].map(a => {
            const r2=a*Math.PI/180, len=a<90||a>270?10:6
            return <line key={a}
              x1={sepX+Math.cos(r2)*2.5} y1={sepY+Math.sin(r2)*2.5}
              x2={sepX+Math.cos(r2)*(2.5+len)} y2={sepY+Math.sin(r2)*(2.5+len)}
              stroke="#fbbf24" strokeWidth="0.7" opacity={0.55}/>
          })}
          <text x={sepX+8} y={sepY-6} fill="#fbbf24" fontSize="7" fontFamily="monospace">SEP</text>
        </g>
      )}

      {/* Flow arrows */}
      {cpOn && [0.28,0.52,0.76].map((fh,i)=>{
        const ay=sill-bH*fh
        return <g key={i} transform={`translate(${PAD-24},${ay})`}>
          <line x1={0} y1={0} x2={14} y2={0} stroke="#82CFFF" strokeWidth="1.1" opacity={0.65}/>
          <polygon points="16,0 10,-3.5 10,3.5" fill="#82CFFF" opacity={0.65}/>
        </g>
      })}

      {/* Wake turbulence indicator */}
      {cpOn && (
        <g opacity={0.45}>
          {[0.15,0.30,0.45].map((d,i)=>(
            <ellipse key={i}
              cx={rX+10+d*30} cy={sill-bH*0.28}
              rx={4+d*12} ry={3+d*8}
              fill="none" stroke="#2147d9" strokeWidth="0.8" strokeDasharray="3,3"/>
          ))}
        </g>
      )}

      {/* Wheels */}
      {[[w1x,wY],[w2x,wY]].map(([cx,cy],i)=>(
        <g key={i}>
          <circle cx={cx} cy={cy} r={wR+3} fill="rgba(0,0,0,0.38)"/>
          <circle cx={cx} cy={cy} r={wR} fill="#060C14" stroke="#2E3E50" strokeWidth="2.6"/>
          <circle cx={cx} cy={cy} r={wR*0.74} fill="#0C1C28" stroke="#223040" strokeWidth="1.5"/>
          {/* 5-spoke rim */}
          {[0,72,144,216,288].map(a=>{
            const r2=a*Math.PI/180
            return <path key={a}
              d={`M ${cx+Math.cos(r2)*wR*0.25} ${cy+Math.sin(r2)*wR*0.25}
                  L ${cx+Math.cos(r2+0.22)*wR*0.70} ${cy+Math.sin(r2+0.22)*wR*0.70}
                  Q ${cx+Math.cos(r2)*wR*0.73} ${cy+Math.sin(r2)*wR*0.73}
                    ${cx+Math.cos(r2-0.22)*wR*0.70} ${cy+Math.sin(r2-0.22)*wR*0.70}
                  Z`}
              fill="#1A2E3E" stroke="#263C50" strokeWidth="0.8"/>
          })}
          <circle cx={cx} cy={cy} r={wR*0.15} fill="#2E3E50"/>
          {/* Brake disc hint */}
          <circle cx={cx} cy={cy} r={wR*0.42} fill="none" stroke="#1A2A38" strokeWidth="0.6" strokeDasharray="4,4"/>
        </g>
      ))}
      {[[w1x,wY],[w2x,wY]].map(([cx,cy],i)=>(
        <circle key={i} cx={cx} cy={cy} r={wR+3} fill="none" stroke="#060C14" strokeWidth="5.5"/>
      ))}

      {/* Ground clearance dimension line */}
      {rideH > bH*0.08 && (
        <g opacity={0.4}>
          <line x1={w1x-wR-6} y1={sill} x2={w1x-wR-6} y2={gY} stroke="#82CFFF" strokeWidth="0.6"/>
          <line x1={w1x-wR-10} y1={sill} x2={w1x-wR-2} y2={sill} stroke="#82CFFF" strokeWidth="0.6"/>
          <line x1={w1x-wR-10} y1={gY}   x2={w1x-wR-2} y2={gY}   stroke="#82CFFF" strokeWidth="0.6"/>
          <text x={w1x-wR-14} y={(sill+gY)/2+3} textAnchor="middle" fill="#82CFFF"
            fontSize="6" fontFamily="monospace" transform={`rotate(-90,${w1x-wR-14},${(sill+gY)/2})`}>
            RH
          </text>
        </g>
      )}

      {/* Cp bar */}
      {cpOn && <>
        <rect x={W-16} y={H*0.13} width={10} height={H*0.62} rx="2" fill="url(#cpBar)"/>
        <text x={W-22} y={H*0.13+5}  textAnchor="end" fill="#6A8A9A" fontSize="7" fontFamily="monospace">+1.0</text>
        <text x={W-22} y={H*0.75+5}  textAnchor="end" fill="#6A8A9A" fontSize="7" fontFamily="monospace">−1.5</text>
      </>}

      <text x={W/2} y={H-3} textAnchor="middle"
        fill="#28404E" fontSize="9" fontFamily="monospace" letterSpacing="0.13em">
        SIDE PROFILE · {g.bodyType.toUpperCase()} · Cd {g.Cd.toFixed(3)} · WS {g.wsAngleDeg.toFixed(0)}°
      </text>
    </svg>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// FRONT VIEW — correct automotive geometry
// Body is WIDEST at shoulder/beltline, tapers NARROWER to roof crown
// ─────────────────────────────────────────────────────────────────────────────

function FrontView({ g, cpOn }) {
  const W=320, H=230, cx=W/2, gY=H-14
  const isTall = g.bodyType==='suv'||g.bodyType==='pickup'||g.bodyType==='van'
  const isFast = g.bodyType==='fastback'||g.bodyType==='coupe'

  // Body dimensions — proportional to real vehicles
  const bh   = isTall ? 112 : isFast ? 84 : 96   // total body height px
  const bw   = isTall ? 110 : isFast ? 94 : 98   // half-width at widest = bw*0.5
  const rideHpx = bh*(g.rideH>0.12?0.18:0.08)
  const bodyBot = gY - rideHpx
  const bodyTop = bodyBot - bh

  // Key heights as fractions of bh
  const roofFrac  = 0.00   // roof crown y offset from bodyTop
  const shoulderFrac = 0.55  // beltline / widest point
  const sillFrac  = 0.92   // sill

  // Key widths (half-widths from centreline, in px)
  const roofHW    = bw * (isFast ? 0.34 : isTall ? 0.42 : 0.38)   // roof crown half-width
  const shoulderHW = bw * 0.50                                       // widest (beltline)
  const sillHW    = bw * 0.46                                        // sill (narrower than shoulder)

  // Heights in px
  const roofY     = bodyTop + bh*roofFrac
  const shoulderY = bodyTop + bh*shoulderFrac
  const sillY     = bodyTop + bh*sillFrac

  // Body outline — smooth Bezier through roof → shoulder → sill
  // This gives the correct wide-shoulder-narrow-roof shape
  const bodyL = [
    `M ${cx} ${roofY}`,
    `C ${cx-roofHW*0.6} ${roofY} ${cx-shoulderHW} ${shoulderY-bh*0.22} ${cx-shoulderHW} ${shoulderY}`,
    `C ${cx-shoulderHW} ${shoulderY+bh*0.12} ${cx-sillHW} ${sillY} ${cx-sillHW*0.80} ${bodyBot}`,
  ]
  const bodyR = [
    `L ${cx+sillHW*0.80} ${bodyBot}`,
    `C ${cx+sillHW} ${sillY} ${cx+shoulderHW} ${shoulderY+bh*0.12} ${cx+shoulderHW} ${shoulderY}`,
    `C ${cx+shoulderHW} ${shoulderY-bh*0.22} ${cx+roofHW*0.6} ${roofY} ${cx} ${roofY}`,
  ]
  const frontPath = [...bodyL, ...bodyR, 'Z'].join(' ')

  // Windscreen — spans between A-pillars at the correct height
  // A-pillar base sits at ~55% of body height, top at ~8%
  const aPillarBaseY  = bodyTop + bh*0.55
  const aPillarTopY   = bodyTop + bh*0.08
  const wsInset = 4   // px inset from A-pillar position
  // A-pillar x at base height (interpolated from body curve)
  // At shoulderY the body is shoulderHW; at aPillarBaseY (55%) interpolate
  const tBase = 0.55 / shoulderFrac
  const aPillarBaseHW = shoulderHW * 0.88 - wsInset
  // At top
  const aPillarTopHW  = roofHW * 0.90 + wsInset

  const wscPath = [
    `M ${cx-aPillarTopHW} ${aPillarTopY}`,
    `Q ${cx-aPillarTopHW*0.96} ${aPillarTopY-2} ${cx} ${aPillarTopY}`,
    `Q ${cx+aPillarTopHW*0.96} ${aPillarTopY-2} ${cx+aPillarTopHW} ${aPillarTopY}`,
    `L ${cx+aPillarBaseHW} ${aPillarBaseY}`,
    `L ${cx-aPillarBaseHW} ${aPillarBaseY}`,
    'Z',
  ].join(' ')

  // Headlights — at upper fascia, between A-pillar and centreline
  const hlY   = bodyTop + bh*0.27
  const hlHW  = shoulderHW * 0.72   // headlight outer edge
  const hlIW  = shoulderHW * 0.30   // headlight inner edge

  // Wheel positions
  const wR  = 16 + (isTall ? 4 : 0)
  const w1x = cx - shoulderHW * 1.05
  const w2x = cx + shoulderHW * 1.05
  const wY  = gY - wR

  // Cp bands (left→right stagnation in centre)
  const cpBands = Array.from({length:11},(_,i)=>{
    const f = i/10, d=Math.abs(f-0.5)*2
    const cp = (0.85*(1-d*d)-0.25)*(g.Cd/0.30)
    return {xL: cx-shoulderHW*(1-i*0.18), color:cpToRgb(cp)}
  })

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',height:'100%'}} preserveAspectRatio="xMidYMid meet">
      <defs>
        <clipPath id="fclip"><path d={frontPath}/></clipPath>
        <radialGradient id="fgrd" cx="50%" cy="35%">
          <stop offset="0%"   stopColor="#1A3040"/>
          <stop offset="100%" stopColor="#060C14"/>
        </radialGradient>
      </defs>

      {/* Shadow */}
      <ellipse cx={cx} cy={gY+5} rx={shoulderHW*1.2} ry={7} fill="rgba(0,0,0,0.42)"/>
      <line x1={12} y1={gY} x2={W-12} y2={gY} stroke="#182430" strokeWidth="1.5"/>

      {/* Cp bands */}
      {cpOn && <g clipPath="url(#fclip)">
        {cpBands.map((b,i)=>(
          <rect key={i} x={b.xL} y={bodyTop-4} width={(shoulderHW*2)/10+2} height={bh+8} fill={b.color} opacity={0.85}/>
        ))}
      </g>}

      {/* Body */}
      <path d={frontPath} fill={cpOn?'rgba(5,10,18,0.28)':'#162435'}
        stroke="#82CFFF" strokeWidth="0.95"/>
      {/* Shoulder line highlight */}
      <path d={`M ${cx-shoulderHW} ${shoulderY} L ${cx+shoulderHW} ${shoulderY}`}
        stroke="rgba(130,207,255,0.25)" strokeWidth="0.7"/>

      {/* Windscreen */}
      <path d={wscPath} fill="rgba(130,207,255,0.10)" stroke="rgba(130,207,255,0.65)" strokeWidth="0.9"/>
      <path d={wscPath} fill="rgba(0,14,28,0.45)"/>
      {/* Screen reflection streak */}
      <path d={`M ${cx-aPillarTopHW*0.60} ${aPillarTopY+6} L ${cx-aPillarTopHW*0.20} ${aPillarBaseY-12}`}
        stroke="rgba(255,255,255,0.08)" strokeWidth="6" strokeLinecap="round"/>

      {/* A-pillars */}
      {[-1,1].map(s=>(
        <path key={s}
          d={`M ${cx+s*aPillarTopHW} ${aPillarTopY} L ${cx+s*aPillarBaseHW} ${aPillarBaseY}`}
          stroke="rgba(0,0,0,0.5)" strokeWidth="4" strokeLinecap="round"/>
      ))}

      {/* Headlights */}
      {[-1,1].map(s=>(
        <g key={s}>
          {/* Outer DRL strip */}
          <path d={`M ${cx+s*hlIW} ${hlY-bh*0.04} Q ${cx+s*(hlIW+hlHW)/2} ${hlY-bh*0.06} ${cx+s*hlHW} ${hlY}`}
            stroke="rgba(255,255,200,0.75)" strokeWidth="2" fill="none" strokeLinecap="round"/>
          {/* Main light housing */}
          <path d={`M ${cx+s*hlIW} ${hlY-bh*0.025} 
                    Q ${cx+s*(hlIW+hlHW)/2} ${hlY-bh*0.05} ${cx+s*hlHW} ${hlY}
                    L ${cx+s*hlHW} ${hlY+bh*0.058}
                    Q ${cx+s*(hlIW+hlHW)/2} ${hlY+bh*0.07} ${cx+s*hlIW} ${hlY+bh*0.055}
                    Z`}
            fill="rgba(255,255,200,0.07)" stroke="rgba(130,207,255,0.55)" strokeWidth="0.8"/>
          {/* LED projector */}
          <circle cx={cx+s*(hlIW+hlHW)*0.58} cy={hlY+bh*0.028} r={bh*0.022}
            fill="rgba(255,255,220,0.85)"/>
        </g>
      ))}

      {/* Front fascia — three zones: upper grille, lower air dam, splitter */}
      {/* Upper grille */}
      <path d={`M ${cx-shoulderHW*0.48} ${bodyTop+bh*0.50}
                L ${cx-shoulderHW*0.48} ${bodyTop+bh*0.70}
                L ${cx+shoulderHW*0.48} ${bodyTop+bh*0.70}
                L ${cx+shoulderHW*0.48} ${bodyTop+bh*0.50} Z`}
        fill="rgba(0,0,0,0.65)" stroke="#1E2E3E" strokeWidth="0.9" rx="3"/>
      {/* Grille bars */}
      {[0,1,2,3,4].map(i=>(
        <line key={i}
          x1={cx-shoulderHW*0.46} y1={bodyTop+bh*(0.52+i*0.038)}
          x2={cx+shoulderHW*0.46} y2={bodyTop+bh*(0.52+i*0.038)}
          stroke="#182430" strokeWidth="0.7"/>
      ))}
      {/* Central logo bar */}
      <rect x={cx-shoulderHW*0.12} y={bodyTop+bh*0.56} width={shoulderHW*0.24} height={bh*0.04}
        rx="2" fill="rgba(130,207,255,0.15)" stroke="#2E4050" strokeWidth="0.6"/>
      {/* Lower air dam */}
      <rect x={cx-shoulderHW*0.68} y={bodyTop+bh*0.76} width={shoulderHW*1.36} height={bh*0.10}
        rx="2" fill="rgba(0,0,0,0.50)" stroke="#1E2E3E" strokeWidth="0.8"/>
      {/* Fog light recesses */}
      {[-1,1].map(s=>(
        <ellipse key={s} cx={cx+s*shoulderHW*0.55} cy={bodyTop+bh*0.81}
          rx={shoulderHW*0.10} ry={bh*0.035}
          fill="rgba(255,255,200,0.08)" stroke="#2E4050" strokeWidth="0.7"/>
      ))}
      {/* Front splitter */}
      <rect x={cx-sillHW*0.95} y={bodyBot-bh*0.05} width={sillHW*1.90} height={bh*0.03}
        rx="1" fill="#0A1820" stroke="#2E4050" strokeWidth="0.7"/>

      {/* Number plate recess */}
      <rect x={cx-shoulderHW*0.28} y={bodyTop+bh*0.85} width={shoulderHW*0.56} height={bh*0.08}
        rx="2" fill="rgba(255,255,255,0.06)" stroke="#1E2E3E" strokeWidth="0.7"/>

      {/* Wheels */}
      {[[w1x,wY],[w2x,wY]].map(([wcx,wcy],i)=>(
        <g key={i}>
          <circle cx={wcx} cy={wcy} r={wR} fill="#060C14" stroke="#2E3E50" strokeWidth="2.5"/>
          <circle cx={wcx} cy={wcy} r={wR*0.72} fill="#0C1C28" stroke="#1E3040" strokeWidth="1.4"/>
          {[0,72,144,216,288].map(a=>{
            const r2=a*Math.PI/180
            return <path key={a}
              d={`M ${wcx+Math.cos(r2)*wR*0.24} ${wcy+Math.sin(r2)*wR*0.24}
                  L ${wcx+Math.cos(r2+0.25)*wR*0.68} ${wcy+Math.sin(r2+0.25)*wR*0.68}
                  Q ${wcx+Math.cos(r2)*wR*0.72} ${wcy+Math.sin(r2)*wR*0.72}
                    ${wcx+Math.cos(r2-0.25)*wR*0.68} ${wcy+Math.sin(r2-0.25)*wR*0.68}
                  Z`}
              fill="#182838" stroke="#263C50" strokeWidth="0.8"/>
          })}
          <circle cx={wcx} cy={wcy} r={wR*0.15} fill="#2E3E50"/>
        </g>
      ))}

      {/* Front track dimension */}
      <g opacity={0.35}>
        <line x1={w1x} y1={gY+4} x2={w2x} y2={gY+4} stroke="#82CFFF" strokeWidth="0.6"/>
        <line x1={w1x} y1={gY+2} x2={w1x} y2={gY+6} stroke="#82CFFF" strokeWidth="0.6"/>
        <line x1={w2x} y1={gY+2} x2={w2x} y2={gY+6} stroke="#82CFFF" strokeWidth="0.6"/>
        <text x={cx} y={gY+10} textAnchor="middle" fill="#82CFFF" fontSize="6" fontFamily="monospace">TRACK</text>
      </g>

      <text x={cx} y={H-3} textAnchor="middle"
        fill="#28404E" fontSize="9" fontFamily="monospace" letterSpacing="0.12em">
        FRONT VIEW · {g.bodyType.toUpperCase()}
      </text>
    </svg>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// TOP VIEW
// ─────────────────────────────────────────────────────────────────────────────

function TopView({ g, yawAngle }) {
  const W=320, H=230, cx=W/2, cy=H/2+6
  const isTall=g.bodyType==='suv'||g.bodyType==='pickup'
  const bw=isTall?78:70, bl=g.bodyType==='pickup'?172:g.bodyType==='estate'?164:156

  // Yaw offset for wheels (simulate yaw angle)
  const yawRad = (yawAngle??0)*Math.PI/180
  const frontSteerOffset = Math.sin(yawRad)*bw*0.28

  const body=[
    `M ${cx} ${cy-bl/2+5}`,
    `Q ${cx-bw*0.26} ${cy-bl/2+1} ${cx-bw*0.50} ${cy-bl/2+20}`,
    `Q ${cx-bw*0.52} ${cy-bl/2+50} ${cx-bw*0.52} ${cy}`,
    `Q ${cx-bw*0.52} ${cy+bl*0.14} ${cx-bw*0.50} ${cy+bl/2-14}`,
    `Q ${cx-bw*0.44} ${cy+bl/2-4} ${cx} ${cy+bl/2-4}`,
    `Q ${cx+bw*0.44} ${cy+bl/2-4} ${cx+bw*0.50} ${cy+bl/2-14}`,
    `Q ${cx+bw*0.52} ${cy+bl*0.14} ${cx+bw*0.52} ${cy}`,
    `Q ${cx+bw*0.52} ${cy-bl/2+50} ${cx+bw*0.50} ${cy-bl/2+20}`,
    `Q ${cx+bw*0.26} ${cy-bl/2+1} ${cx} ${cy-bl/2+5}`,
    'Z',
  ].join(' ')

  const ghFront=cy+bl*(g.hoodRatio-0.50)
  const ghRear =cy+bl*(g.hoodRatio+g.cabinRatio-0.50)
  const ghW=bw*(g.bodyType==='fastback'||g.bodyType==='coupe'?0.40:isTall?0.44:0.42)

  const ghPath=[
    `M ${cx} ${ghFront-4}`,
    `Q ${cx-ghW*0.52} ${ghFront+2} ${cx-ghW*0.54} ${ghFront+18}`,
    `L ${cx-ghW*0.54} ${ghRear-12}`,
    `Q ${cx-ghW*0.46} ${ghRear} ${cx} ${ghRear}`,
    `Q ${cx+ghW*0.46} ${ghRear} ${cx+ghW*0.54} ${ghRear-12}`,
    `L ${cx+ghW*0.54} ${ghFront+18}`,
    `Q ${cx+ghW*0.52} ${ghFront+2} ${cx} ${ghFront-4}`,
    'Z',
  ].join(' ')

  const fwy=cy+bl*(g.w1-0.50), rwy=cy+bl*(g.w2-0.50)

  // Cp strips
  const N=14
  const cpS=Array.from({length:N},(_,i)=>{
    const tM=(i+0.5)/N
    return {y0:cy-bl/2+5+i*(bl-9)/N, y1:cy-bl/2+5+(i+1)*(bl-9)/N, c:cpToRgb(cpAtPoint(tM,0.70,tM<0.15,g.Cd))}
  })
  const defs = `<clipPath id="tc2"><path d="${body}"/></clipPath>`

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',height:'100%'}} preserveAspectRatio="xMidYMid meet">
      <defs><clipPath id="tc2"><path d={body}/></clipPath></defs>
      <g clipPath="url(#tc2)">
        {cpS.map((s,i)=>(
          <rect key={i} x={cx-bw*0.60} y={s.y0} width={bw*1.20} height={s.y1-s.y0+1} fill={s.c} opacity={0.78}/>
        ))}
      </g>
      <path d={body} fill="rgba(5,10,18,0.28)" stroke="#82CFFF" strokeWidth="0.9"/>
      <path d={ghPath} fill="rgba(130,207,255,0.09)" stroke="rgba(130,207,255,0.60)" strokeWidth="0.8"/>
      <path d={ghPath} fill="rgba(0,14,28,0.38)"/>

      {/* Roof panel lines */}
      <line x1={cx-ghW*0.48} y1={ghFront+20} x2={cx-ghW*0.48} y2={ghRear-14}
        stroke="rgba(130,207,255,0.14)" strokeWidth="0.6" strokeDasharray="8,8"/>
      <line x1={cx+ghW*0.48} y1={ghFront+20} x2={cx+ghW*0.48} y2={ghRear-14}
        stroke="rgba(130,207,255,0.14)" strokeWidth="0.6" strokeDasharray="8,8"/>

      {/* Pickup bed */}
      {g.bodyType==='pickup' && (
        <rect x={cx-bw*0.48} y={ghRear} width={bw*0.96} height={cy+bl/2-14-ghRear}
          fill="rgba(0,0,0,0.20)" stroke="#1E2E3E" strokeWidth="0.8"/>
      )}

      {/* Centreline */}
      <line x1={cx} y1={cy-bl/2} x2={cx} y2={cy+bl/2}
        stroke="#182430" strokeWidth="0.6" strokeDasharray="6,6"/>

      {/* FRONT indicator */}
      <text x={cx} y={cy-bl/2-8} textAnchor="middle" fill="#82CFFF" fontSize="8" fontFamily="monospace">▲ FRONT</text>

      {/* Flow arrows */}
      {[-bw*0.24,0,bw*0.24].map((ox,i)=>(
        <g key={i} transform={`translate(${cx+ox},${cy-bl/2-20})`}>
          <line x1={0} y1={-4} x2={0} y2={6} stroke="#82CFFF" strokeWidth="0.9" opacity={0.45}/>
          <polygon points="0,9 -2.5,4 2.5,4" fill="#82CFFF" opacity={0.45}/>
        </g>
      ))}

      {/* Wing mirrors */}
      {[-1,1].map(s=>{
        const mx=cx+s*bw*0.56, my=ghFront+12
        return <path key={s} d={`M ${mx} ${my} L ${mx+s*16} ${my-5} L ${mx+s*16} ${my+6} Z`}
          fill="#0A1820" stroke="#1E3040" strokeWidth="0.8"/>
      })}

      {/* Wheels — front wheels steered by yaw angle */}
      {[[cx-bw*0.62,fwy,frontSteerOffset],[cx+bw*0.62,fwy,-frontSteerOffset],
        [cx-bw*0.62,rwy,0],[cx+bw*0.62,rwy,0]].map(([wx,wy,off],i)=>(
        <g key={i} transform={`translate(${wx},${wy}) rotate(${i<2?(yawAngle??0)*0.7:0})`}>
          <rect x={-10} y={-18} width={20} height={36} rx="4"
            fill="#060C14" stroke="#2E3E50" strokeWidth="1.5"/>
          <line x1={0} y1={-12} x2={0} y2={12} stroke="#1A2E3E" strokeWidth="0.8"/>
        </g>
      ))}

      <text x={cx} y={H-3} textAnchor="middle"
        fill="#28404E" fontSize="9" fontFamily="monospace" letterSpacing="0.12em">
        TOP VIEW{(yawAngle??0)!==0?` · YAW ${yawAngle>0?'+':''}${yawAngle}°`:''}
      </text>
    </svg>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// UNDERSIDE VIEW
// ─────────────────────────────────────────────────────────────────────────────

function UnderView({ g, showGroundEffect }) {
  const W=320, H=230, cx=W/2, cy=H/2+6
  const isTall=g.bodyType==='suv'||g.bodyType==='pickup'
  const bw=isTall?78:70, bl=g.bodyType==='pickup'?172:156

  const body=[
    `M ${cx} ${cy-bl/2+5}`,
    `Q ${cx-bw*0.26} ${cy-bl/2+1} ${cx-bw*0.50} ${cy-bl/2+20}`,
    `L ${cx-bw*0.52} ${cy+bl*0.08}`,
    `Q ${cx-bw*0.50} ${cy+bl/2-14} ${cx-bw*0.44} ${cy+bl/2-4}`,
    `L ${cx+bw*0.44} ${cy+bl/2-4}`,
    `Q ${cx+bw*0.50} ${cy+bl/2-14} ${cx+bw*0.52} ${cy+bl*0.08}`,
    `L ${cx+bw*0.50} ${cy-bl/2+20}`,
    `Q ${cx+bw*0.26} ${cy-bl/2+1} ${cx} ${cy-bl/2+5}`,
    'Z',
  ].join(' ')

  const N=14
  const cpS=Array.from({length:N},(_,i)=>{
    const tM=(i+0.5)/N
    return {y0:cy-bl/2+5+i*(bl-9)/N, y1:cy-bl/2+5+(i+1)*(bl-9)/N, c:cpToRgb(cpAtPoint(tM,0.05,tM<0.15,g.Cd))}
  })

  const fwy=cy+bl*(g.w1-0.50), rwy=cy+bl*(g.w2-0.50)

  // Ground effect contours
  const geContours = showGroundEffect ? [-0.6,-0.4,-0.2,0.0].map((cpLev,li) => {
    const barWidth = (1-(-cpLev/0.8))*bw*0.40
    return {y: cy-bl*0.15+li*(bl*0.12), w: barWidth, c: cpToRgb(cpLev)}
  }) : []

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',height:'100%'}} preserveAspectRatio="xMidYMid meet">
      <defs><clipPath id="uc"><path d={body}/></clipPath></defs>
      <g clipPath="url(#uc)">
        {cpS.map((s,i)=>(
          <rect key={i} x={cx-bw*0.60} y={s.y0} width={bw*1.20} height={s.y1-s.y0+1} fill={s.c} opacity={0.82}/>
        ))}
      </g>
      <path d={body} fill="rgba(5,10,18,0.32)" stroke="#82CFFF" strokeWidth="0.9"/>

      {/* Flat floor panel */}
      <rect x={cx-bw*0.38} y={cy-bl*0.32} width={bw*0.76} height={bl*0.54}
        rx="4" fill="rgba(0,0,0,0.18)" stroke="#182838" strokeWidth="0.8"/>

      {/* Transmission/driveshaft tunnel */}
      <path d={`M ${cx-bw*0.09} ${cy-bl*0.30} Q ${cx} ${cy-bl*0.32} ${cx+bw*0.09} ${cy-bl*0.30}
                L ${cx+bw*0.09} ${cy+bl*0.22} Q ${cx} ${cy+bl*0.24} ${cx-bw*0.09} ${cy+bl*0.22} Z`}
        fill="rgba(0,0,0,0.30)" stroke="#182838" strokeWidth="0.9"/>

      {/* Fuel tank */}
      <rect x={cx-bw*0.28} y={cy+bl*0.02} width={bw*0.56} height={bl*0.12}
        rx="6" fill="rgba(0,0,0,0.25)" stroke="#1E3040" strokeWidth="0.8" strokeDasharray="3,2"/>

      {/* Front subframe */}
      <rect x={cx-bw*0.36} y={cy-bl*0.40} width={bw*0.72} height={bl*0.16}
        rx="6" fill="none" stroke="#2A3E50" strokeWidth="1.0" strokeDasharray="4,3"/>

      {/* Rear subframe */}
      <rect x={cx-bw*0.34} y={cy+bl*0.16} width={bw*0.68} height={bl*0.14}
        rx="6" fill="none" stroke="#2A3E50" strokeWidth="1.0" strokeDasharray="4,3"/>

      {/* Floor channels / aero strakes */}
      {[-bw*0.24,-bw*0.08,bw*0.08,bw*0.24].map((ox,i)=>(
        <line key={i} x1={cx+ox} y1={cy-bl*0.30} x2={cx+ox} y2={cy+bl*0.22}
          stroke="#182838" strokeWidth={i===1||i===2?3:1.8} strokeDasharray={i===0||i===3?"6,10":undefined}/>
      ))}

      {/* Rear diffuser fins */}
      {[-4,-2,0,2,4].map(f=>(
        <line key={f} x1={cx+f*bw*0.08} y1={cy+bl*0.24} x2={cx+f*bw*0.08} y2={cy+bl/2-6}
          stroke="#2E4050" strokeWidth="1.8"/>
      ))}

      {/* Exhaust outlets */}
      {(g.bodyType==='fastback'||g.bodyType==='coupe'?[-bw*0.20,bw*0.20]:[-bw*0.14,bw*0.14]).map((ox,i)=>(
        <g key={i}>
          <circle cx={cx+ox} cy={cy+bl/2-11} r={6}
            fill="#060C14" stroke="#2E4050" strokeWidth="1.6"/>
          <circle cx={cx+ox} cy={cy+bl/2-11} r={3} fill="#020608"/>
          {/* Exhaust heat shimmer */}
          <circle cx={cx+ox} cy={cy+bl/2-11} r={8} fill="none"
            stroke="rgba(239,68,68,0.15)" strokeWidth="3"/>
        </g>
      ))}

      {/* Ground effect pressure contours */}
      {showGroundEffect && geContours.map((gc,i)=>(
        <rect key={i} x={cx-gc.w} y={gc.y} width={gc.w*2} height={bl*0.10}
          rx="3" fill={gc.c} opacity={0.18} stroke={gc.c} strokeWidth="0.5" strokeOpacity={0.5}/>
      ))}

      {/* Wheels */}
      {[[cx-bw*0.62,fwy],[cx+bw*0.62,fwy],[cx-bw*0.62,rwy],[cx+bw*0.62,rwy]].map(([wx,wy],i)=>(
        <rect key={i} x={wx-10} y={wy-18} width={20} height={36} rx="4"
          fill="#060C14" stroke="#2E4050" strokeWidth="1.5"/>
      ))}

      <text x={cx} y={cy-bl/2-8} textAnchor="middle" fill="#82CFFF" fontSize="8" fontFamily="monospace">▲ FRONT</text>
      {showGroundEffect && (
        <text x={cx} y={cy+bl/2+12} textAnchor="middle" fill="#22d3ee" fontSize="7" fontFamily="monospace">
          GROUND EFFECT ACTIVE
        </text>
      )}
      <text x={cx} y={H-3} textAnchor="middle"
        fill="#28404E" fontSize="9" fontFamily="monospace" letterSpacing="0.12em">UNDERSIDE VIEW</text>
    </svg>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Drag breakdown donut chart
// ─────────────────────────────────────────────────────────────────────────────

function DragDonut({ breakdown }) {
  const R=44, r=28, cx=60, cy=54
  let startAngle = -Math.PI/2
  const slices = breakdown.map(b => {
    const angle = b.pct * 2 * Math.PI
    const x1=cx+R*Math.cos(startAngle), y1=cy+R*Math.sin(startAngle)
    const x2=cx+R*Math.cos(startAngle+angle), y2=cy+R*Math.sin(startAngle+angle)
    const ix1=cx+r*Math.cos(startAngle), iy1=cy+r*Math.sin(startAngle)
    const ix2=cx+r*Math.cos(startAngle+angle), iy2=cy+r*Math.sin(startAngle+angle)
    const large = angle > Math.PI ? 1 : 0
    const path = `M ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2} L ${ix2} ${iy2} A ${r} ${r} 0 ${large} 0 ${ix1} ${iy1} Z`
    startAngle += angle
    return {...b, path}
  })
  return (
    <svg viewBox="0 0 120 108" style={{width:'100%',height:108}}>
      {slices.map((s,i)=>(
        <path key={i} d={s.path} fill={s.c} stroke="#060C14" strokeWidth="0.8"/>
      ))}
      <text x={cx} y={cy+4} textAnchor="middle" fill="#82CFFF" fontSize="8" fontFamily="monospace">DRAG</text>
      {/* Legend */}
      {breakdown.map((b,i)=>(
        <g key={i} transform={`translate(${i<3?0:60}, ${90+Math.floor(i/3)*0})`}>
          <rect x={i<3?2:62} y={88+i%3*13} width={8} height={8} rx="1" fill={b.c}/>
          <text x={i<3?12:72} y={88+i%3*13+7} fill="#5A7A8A" fontSize="7" fontFamily="monospace">
            {b.name} {(b.pct*100).toFixed(0)}%
          </text>
        </g>
      ))}
    </svg>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Cd Gauge
// ─────────────────────────────────────────────────────────────────────────────

function CdGauge({ cd }) {
  const pct=Math.min(1,Math.max(0,(cd-0.15)/0.35))
  const angle=-135+pct*270
  const color=cd<0.24?'#30D158':cd<0.27?'#0A84FF':cd<0.32?'#FF9F0A':'#FF453A'
  const label=cd<0.24?'Exceptional':cd<0.27?'Excellent':cd<0.32?'Average':'High drag'
  const rad=d=>(d-90)*Math.PI/180
  const nx=60+46*Math.cos(rad(angle)), ny=62+46*Math.sin(rad(angle))
  return (
    <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:3}}>
      <svg viewBox="0 0 120 72" style={{width:128,height:80}}>
        <path d="M10,62 A50,50 0 0,1 110,62" fill="none" stroke="#182430" strokeWidth="10" strokeLinecap="round"/>
        <path d="M10,62 A50,50 0 0,1 110,62" fill="none" stroke={color} strokeWidth="10"
          strokeLinecap="round" strokeDasharray={`${pct*157} 157`}/>
        {[0.20,0.25,0.30,0.35,0.40].map((v,i)=>{
          const tp=Math.min(1,(v-0.15)/0.35), ta=-135+tp*270
          return <circle key={i} cx={60+40*Math.cos(rad(ta))} cy={62+40*Math.sin(rad(ta))} r="2" fill="#263442"/>
        })}
        <line x1="60" y1="62" x2={nx} y2={ny} stroke={color} strokeWidth="2.4" strokeLinecap="round"/>
        <circle cx="60" cy="62" r="5" fill={color}/>
        <text x="60" y="56" textAnchor="middle" fill={color} fontSize="14" fontFamily="monospace" fontWeight="bold">{cd.toFixed(3)}</text>
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
  const pct=v=>((v-0.20)/0.24)*100
  return (
    <div style={{width:'100%'}}>
      <div style={{position:'relative',height:18,borderRadius:4,overflow:'hidden',marginBottom:4}}>
        <div style={{position:'absolute',inset:0,background:'linear-gradient(to right,#30D158,#0A84FF,#fbbf24,#FF453A)'}}/>
        {BENCHMARKS.map((b,i)=>(
          <div key={i} style={{position:'absolute',top:0,bottom:0,width:1,background:'rgba(0,0,0,0.5)',left:`${pct(b.Cd)}%`}}/>
        ))}
        <div style={{position:'absolute',top:-2,bottom:-2,width:3,background:'white',borderRadius:2,
          left:`${Math.min(98,Math.max(2,pct(cd)))}%`,transform:'translateX(-1px)',boxShadow:'0 0 6px rgba(255,255,255,0.8)'}}>
          <div style={{position:'absolute',top:-4,left:'50%',transform:'translateX(-50%) rotate(45deg)',width:6,height:6,background:'white'}}/>
        </div>
      </div>
      <div style={{display:'flex',justifyContent:'space-between',fontSize:9,fontFamily:'monospace',color:'#3A5464',marginBottom:6}}>
        <span>0.20</span><span>0.30</span><span>0.40+</span>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Zone density debug bar
// ─────────────────────────────────────────────────────────────────────────────

function ZoneBar({ zones }) {
  if(!zones) return null
  return (
    <div style={{display:'flex',gap:1,height:20,alignItems:'flex-end',margin:'4px 0'}}>
      {zones.map((z,i)=>(
        <div key={i} style={{
          flex:1,background:`rgba(130,207,255,${0.15+z*0.65})`,
          height:`${Math.max(4,z*100)}%`,borderRadius:1,
          position:'relative',
        }} title={`Zone ${i}: ${(z*100).toFixed(0)}%`}/>
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
  const [showSep,    setShowSep]    = useState(true)
  const [showIso,    setShowIso]    = useState(false)
  const [showGE,     setShowGE]     = useState(false)
  const [yawAngle,   setYawAngle]   = useState(0)
  const svgRef = useRef(null)
  const fileRef = useRef(null)

  const acceptFile = useCallback((f) => {
    if(!f||!f.type.startsWith('image/')) return
    setFile(f); setPreview(URL.createObjectURL(f))
    setGeo(null); setError(null); setStage('ready')
  }, [])

  const onDrop = useCallback((e) => {
    e.preventDefault(); setDragOver(false)
    acceptFile(e.dataTransfer.files[0])
  }, [acceptFile])

  const run = async () => {
    if(!file) return
    setError(null); setGeo(null); setStage('analyzing')
    try {
      const r = await analyzeImageCanvas(file)
      setGeo(r); setStage('done')
    } catch(e) {
      setError(e.message); setStage('error')
    }
  }

  const exportSVG = () => {
    const svg = svgRef.current?.querySelector('svg')
    if(!svg) return
    const blob = new Blob([svg.outerHTML], {type:'image/svg+xml'})
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `aeronet_${activeView}_view.svg`
    a.click()
  }

  const isRunning = stage==='analyzing'
  const cd = geo?.Cd??0.30
  const breakdown = geo ? getDragBreakdown(geo.bodyType) : []
  const improvements = {
    fastback:  ['Active rear diffuser','Underbody flat floor','Rear wing delete'],
    coupe:     ['Ducktail spoiler','Smooth underbody','Aero wheels'],
    notchback: ['Active grille shutters','Lower ride height','Rear lip spoiler'],
    hatchback: ['Roof spoiler','Underbody diffuser','Tyre aero covers'],
    estate:    ['Roof aero rails','Tow hitch fairing','Flush body'],
    suv:       ['Lower ride height','Air suspension','Active aero'],
    pickup:    ['Tonneau cover','Air dam','Bed extender fairing'],
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
        <span className="text-body-sm text-md-on-surface-variant">Canvas Sobel → silhouette → roofline → 4-view CFD reconstruction</span>
        <div className="ml-auto flex items-center gap-2">
          {['Sobel Edge','Roofline Fit','Cp Physics','Drag Donut'].map(t=>(
            <span key={t} className="text-label-sm text-md-outline-variant px-2 py-0.5 rounded border border-md-outline-variant">{t}</span>
          ))}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">

        {/* Left panel */}
        <div className="w-64 shrink-0 flex flex-col gap-3 p-4 border-r border-md-outline-variant overflow-y-auto bg-md-surface-container-low">
          <div className="flex items-center gap-2">
            <span className="text-label-sm text-md-primary font-mono">01</span>
            <div className="flex-1 h-px bg-md-outline-variant"/>
            <span className="text-label-sm text-md-on-surface-variant uppercase tracking-wide">Upload</span>
          </div>

          <div
            className={`relative rounded-xl border-2 border-dashed transition-all cursor-pointer overflow-hidden
              ${dragOver?'border-md-primary bg-md-primary/10':'border-md-outline-variant hover:border-md-primary/50'}`}
            style={{minHeight:150}}
            onDragOver={e=>{e.preventDefault();setDragOver(true)}}
            onDragLeave={()=>setDragOver(false)}
            onDrop={onDrop}
            onClick={()=>fileRef.current?.click()}
          >
            <input ref={fileRef} type="file" accept="image/*" className="hidden"
              onChange={e=>acceptFile(e.target.files[0])}/>
            {preview ? (
              <>
                <img src={preview} alt="preview" className="w-full object-cover rounded-xl" style={{maxHeight:185}}/>
                <div className="absolute inset-0 flex items-end justify-center pb-2 pointer-events-none">
                  <span className="text-label-sm text-white/60 bg-black/50 px-2 py-0.5 rounded">click to change</span>
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
              <span style={{fontSize:9,color:'#3A5464'}}>{(file.size/1024).toFixed(0)}KB</span>
            </div>
          )}

          <button onClick={run} disabled={!file||isRunning}
            className={`w-full py-3 rounded-xl font-medium text-body-md transition-all
              ${!file||isRunning?'bg-md-surface-container text-md-on-surface-variant cursor-not-allowed opacity-60'
                :'bg-md-primary text-md-on-primary hover:shadow-glow-sm active:scale-[0.98]'}`}>
            {isRunning?<span className="flex items-center justify-center gap-2">
              <span className="w-3.5 h-3.5 border-2 border-md-on-primary/30 border-t-md-on-primary rounded-full animate-spin"/>Analysing…
            </span>:'Analyse Vehicle'}
          </button>

          {error && <div className="rounded-lg bg-md-error/10 border border-md-error/30 p-2 text-label-sm text-md-error">⚠ {error}</div>}

          {geo && (
            <>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-label-sm text-md-primary font-mono">02</span>
                <div className="flex-1 h-px bg-md-outline-variant"/>
                <span className="text-label-sm text-md-on-surface-variant uppercase tracking-wide">Extracted</span>
              </div>
              <div className="rounded-lg bg-md-surface-container border border-md-outline-variant p-3 space-y-1">
                {[
                  ['Type',         geo.bodyType],
                  ['Aspect ratio', geo.aspectRatio.toFixed(2)],
                  ['Hood',         (geo.hoodRatio*100).toFixed(0)+'%'],
                  ['Cabin',        (geo.cabinRatio*100).toFixed(0)+'%'],
                  ['Boot',         (geo.bootRatio*100).toFixed(0)+'%'],
                  ['WS rake',      geo.wsAngleDeg.toFixed(0)+'°'],
                  ['Rear drop',    (geo.rearDrop*100).toFixed(0)+'%'],
                  ['Ride height',  geo.rideH>0.12?'high':'standard'],
                ].map(([k,v])=>(
                  <div key={k} style={{display:'flex',justifyContent:'space-between',fontSize:10,fontFamily:'monospace',padding:'1px 0'}}>
                    <span style={{color:'#3A5464'}}>{k}</span>
                    <span style={{color:'#82CFFF'}}>{v}</span>
                  </div>
                ))}
                {/* Confidence bar */}
                <div style={{marginTop:6}}>
                  <div style={{display:'flex',justifyContent:'space-between',fontSize:9,fontFamily:'monospace',marginBottom:3}}>
                    <span style={{color:'#3A5464'}}>confidence</span>
                    <span style={{color:'#82CFFF'}}>{(geo.confidence*100).toFixed(0)}%</span>
                  </div>
                  <div style={{height:4,borderRadius:2,background:'#182838',overflow:'hidden'}}>
                    <div style={{height:'100%',width:`${geo.confidence*100}%`,
                      background:geo.confidence>0.7?'#30D158':geo.confidence>0.4?'#FF9F0A':'#FF453A',
                      borderRadius:2}}/>
                  </div>
                </div>
                {/* Zone density debug */}
                <div style={{marginTop:4}}>
                  <div style={{fontSize:8,fontFamily:'monospace',color:'#263442',marginBottom:2}}>
                    VERTICAL EDGE DENSITY
                  </div>
                  <ZoneBar zones={geo._zones}/>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-label-sm text-md-primary font-mono">03</span>
                <div className="flex-1 h-px bg-md-outline-variant"/>
                <span className="text-label-sm text-md-on-surface-variant uppercase tracking-wide">Drag</span>
              </div>
              <div className="rounded-lg bg-md-surface-container border border-md-outline-variant p-3 flex flex-col items-center gap-1">
                <CdGauge cd={cd}/>
                <div style={{fontSize:9,fontFamily:'monospace',color:'#3A5464',textAlign:'center'}}>
                  Estimated · {geo.bodyType} profile
                </div>
              </div>
            </>
          )}
        </div>

        {/* Centre panel */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Toolbar */}
          <div className="flex items-center gap-1 px-3 pt-3 pb-2 border-b border-md-outline-variant shrink-0 flex-wrap">
            <div className="flex gap-1">
              {VIEWS.map(v=>(
                <button key={v.id} onClick={()=>setActiveView(v.id)}
                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-label-md transition-all
                    ${activeView===v.id?'bg-md-primary/15 text-md-primary border border-md-primary/30'
                      :'text-md-on-surface-variant hover:bg-md-surface-container'}`}>
                  <span className="text-xs">{v.icon}</span><span>{v.label}</span>
                </button>
              ))}
            </div>
            <div className="flex gap-1 ml-2 flex-wrap">
              {[['Cp',cpOn,setCpOn],['Sep',showSep,setShowSep],['Iso',showIso,setShowIso],
                ['GEffect',showGE,setShowGE]].map(([label,val,set])=>(
                <button key={label} onClick={()=>set(p=>!p)}
                  className={`px-2 py-1 rounded text-label-sm border transition-all
                    ${val?'bg-md-primary text-md-on-primary border-md-primary'
                        :'text-md-on-surface-variant border-md-outline-variant hover:border-md-primary/50'}`}>
                  {label}
                </button>
              ))}
            </div>
            {/* Yaw slider */}
            {geo && activeView==='top' && (
              <div className="flex items-center gap-2 ml-2">
                <span className="text-label-sm text-md-on-surface-variant">Yaw</span>
                <input type="range" min={-15} max={15} value={yawAngle}
                  onChange={e=>setYawAngle(Number(e.target.value))}
                  style={{width:80,accentColor:'#82CFFF'}}/>
                <span className="text-label-sm text-md-primary font-mono">{yawAngle>0?'+':''}{yawAngle}°</span>
              </div>
            )}
            <button onClick={exportSVG} className="ml-auto px-2.5 py-1.5 rounded-md text-label-sm border
              border-md-outline-variant text-md-on-surface-variant hover:border-md-primary/50 transition-all">
              ↓ SVG
            </button>
          </div>

          <div ref={svgRef} className="flex-1 flex flex-col p-4 gap-4 overflow-hidden bg-md-background">
            {!geo ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-6">
                <div className="w-20 h-20 rounded-full bg-md-surface-container border-2 border-md-outline-variant flex items-center justify-center text-4xl">🔬</div>
                <div className="text-center max-w-lg">
                  <div className="text-title-md text-md-on-surface mb-2">Canvas Vehicle Analysis</div>
                  <div className="text-body-sm text-md-on-surface-variant">
                    Upload any vehicle photo. Sobel edge detection extracts the silhouette, vertical edge density maps pillar positions, roofline fitting measures the slope and rake — then 4 accurate orthographic CFD views are generated with physics-based Cp pressure field, airflow separation markers, and drag breakdown.
                  </div>
                </div>
                <div className="flex items-center gap-2 text-label-sm text-md-on-surface-variant flex-wrap justify-center">
                  {['Sobel edges','Silhouette bbox','Roofline 4-seg','Pillar peaks','Body classify','Cp physics','4-view render'].map((s,i,a)=>(
                    <span key={i} className="flex items-center gap-1">
                      <span className="px-2 py-0.5 rounded border bg-md-surface-container border-md-outline-variant font-mono text-md-outline">{s}</span>
                      {i<a.length-1&&<span className="text-md-outline">→</span>}
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <>
                <div className="flex-1 rounded-xl bg-md-surface-container border border-md-outline-variant overflow-hidden flex items-center justify-center p-3" style={{minHeight:0}}>
                  <div style={{width:'100%',height:'100%',maxHeight:295}}>
                    {activeView==='side'  && <SideView  g={geo} cpOn={cpOn} showSep={showSep} showIso={showIso}/>}
                    {activeView==='front' && <FrontView g={geo} cpOn={cpOn}/>}
                    {activeView==='top'   && <TopView   g={geo} yawAngle={yawAngle}/>}
                    {activeView==='under' && <UnderView g={geo} showGroundEffect={showGE}/>}
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-2 shrink-0">
                  {VIEWS.map(v=>(
                    <button key={v.id} onClick={()=>setActiveView(v.id)}
                      className={`rounded-lg border overflow-hidden transition-all
                        ${activeView===v.id?'border-md-primary bg-md-primary/10 ring-1 ring-md-primary/30'
                          :'border-md-outline-variant bg-md-surface-container hover:border-md-primary/40'}`}>
                      <div style={{width:'100%',aspectRatio:'5/3',padding:'3px'}}>
                        {v.id==='side'  && <SideView  g={geo} cpOn={cpOn} showSep={false} showIso={false}/>}
                        {v.id==='front' && <FrontView g={geo} cpOn={cpOn}/>}
                        {v.id==='top'   && <TopView   g={geo} yawAngle={0}/>}
                        {v.id==='under' && <UnderView g={geo} showGroundEffect={false}/>}
                      </div>
                      <div className="text-label-sm text-md-on-surface-variant text-center py-1">{v.label}</div>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Right panel */}
        <div className="w-72 shrink-0 flex flex-col gap-4 p-4 border-l border-md-outline-variant overflow-y-auto bg-md-surface-container-low">

          {geo ? (
            <>
              <div className="flex items-center gap-2">
                <span className="text-label-sm text-md-primary font-mono">04</span>
                <div className="flex-1 h-px bg-md-outline-variant"/>
                <span className="text-label-sm text-md-on-surface-variant uppercase tracking-wide">Benchmark</span>
              </div>
              <div className="rounded-lg bg-md-surface-container border border-md-outline-variant p-3">
                <BenchmarkBar cd={cd}/>
                <div className="flex flex-col gap-1.5 mt-2">
                  {BENCHMARKS.map((b,i)=>{
                    const diff=cd-b.Cd
                    const clr=diff<=0?'#30D158':'#FF9F0A'
                    return (
                      <div key={i} className="flex items-center gap-2">
                        <div style={{width:`${((b.Cd-0.20)/0.24)*55}%`,height:3,borderRadius:2,flexShrink:0,
                          background:b.Cd<0.26?'#30D158':b.Cd<0.30?'#0A84FF':b.Cd<0.34?'#FF9F0A':'#FF453A'}}/>
                        <span style={{fontSize:9,fontFamily:'monospace',color:'#82CFFF',width:28,flexShrink:0}}>{b.Cd.toFixed(2)}</span>
                        <span style={{fontSize:9,color:'#3A5464',flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{b.name}</span>
                        <span style={{fontSize:9,fontFamily:'monospace',color:clr,flexShrink:0}}>
                          {diff>0?'+':''}{diff.toFixed(3)}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-label-sm text-md-primary font-mono">05</span>
                <div className="flex-1 h-px bg-md-outline-variant"/>
                <span className="text-label-sm text-md-on-surface-variant uppercase tracking-wide">Drag Breakdown</span>
              </div>
              <div className="rounded-lg bg-md-surface-container border border-md-outline-variant p-2">
                <DragDonut breakdown={breakdown}/>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-label-sm text-md-primary font-mono">06</span>
                <div className="flex-1 h-px bg-md-outline-variant"/>
                <span className="text-label-sm text-md-on-surface-variant uppercase tracking-wide">Aero Forces</span>
              </div>
              <div className="rounded-lg bg-md-surface-container border border-md-outline-variant p-3 grid grid-cols-2 gap-3">
                {[
                  ['Front Lift',  'CL_f', (cd*0.06).toFixed(3), '#22d3ee'],
                  ['Rear Lift',   'CL_r', (-cd*0.02).toFixed(3), '#84cc16'],
                  ['Side Force',  'Cs',   '0.000', '#fbbf24'],
                  ['Drag (1 atm)','Cd·q', (cd*0.5*1.225*40*40*2.4).toFixed(0)+'N', '#ef4444'],
                ].map(([name,sym,val,clr])=>(
                  <div key={name} style={{background:'rgba(0,0,0,0.2)',borderRadius:6,padding:'8px 10px'}}>
                    <div style={{fontSize:8,fontFamily:'monospace',color:'#3A5464',marginBottom:3}}>{name}</div>
                    <div style={{fontSize:13,fontFamily:'monospace',color:clr,fontWeight:600}}>{val}</div>
                    <div style={{fontSize:8,fontFamily:'monospace',color:'#263442'}}>{sym}</div>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <span className="text-label-sm text-md-primary font-mono">07</span>
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
                <span className="text-label-sm text-md-primary font-mono">08</span>
                <div className="flex-1 h-px bg-md-outline-variant"/>
                <span className="text-label-sm text-md-on-surface-variant uppercase tracking-wide">Compare</span>
              </div>
              <div className="rounded-lg bg-md-surface-container border border-md-outline-variant p-3">
                <div className="flex flex-col gap-2">
                  {BENCHMARKS.slice(0,5).map((b,i)=>{
                    const diff=cd-b.Cd, clr=diff<=0?'#30D158':'#FF9F0A'
                    return (
                      <div key={i} className="flex items-center gap-2 text-body-sm">
                        <span className="font-mono text-md-primary w-10 shrink-0">{b.Cd.toFixed(2)}</span>
                        <span className="text-md-on-surface flex-1 truncate">{b.name}</span>
                        <span className="font-mono text-label-sm shrink-0" style={{color:clr}}>
                          {diff>0?'+':''}{Math.abs(diff).toFixed(3)}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center py-12">
              <div className="text-4xl opacity-20">📊</div>
              <div className="text-body-sm text-md-on-surface-variant">Upload and analyse a vehicle to see results.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
