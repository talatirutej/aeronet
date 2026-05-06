// Copyright (c) 2026 Rutej Talati. All rights reserved.

import { useCallback, useEffect, useRef, useState } from 'react'

const BACKEND = import.meta.env?.VITE_AERONET_BACKEND ?? 'http://127.0.0.1:8000'

// ── Canvas image analysis ─────────────────────────────────────────────────────
function analyzeImageCanvas(file) {
  return new Promise((resolve, reject) => {
    const img = new Image(), url = URL.createObjectURL(file)
    img.onload = () => {
      try {
        const MAX=400, scale=Math.min(1,MAX/Math.max(img.width,img.height))
        const W=Math.round(img.width*scale), H=Math.round(img.height*scale)
        const cvs=document.createElement('canvas'); cvs.width=W; cvs.height=H
        const ctx=cvs.getContext('2d'); ctx.drawImage(img,0,0,W,H)
        const {data}=ctx.getImageData(0,0,W,H)
        const gray=new Float32Array(W*H)
        for(let i=0;i<W*H;i++) gray[i]=0.299*data[i*4]+0.587*data[i*4+1]+0.114*data[i*4+2]
        const edges=new Float32Array(W*H); let maxEdge=0
        for(let y=1;y<H-1;y++) for(let x=1;x<W-1;x++){
          const gx=-gray[(y-1)*W+(x-1)]+gray[(y-1)*W+(x+1)]-2*gray[y*W+(x-1)]+2*gray[y*W+(x+1)]-gray[(y+1)*W+(x-1)]+gray[(y+1)*W+(x+1)]
          const gy=-gray[(y-1)*W+(x-1)]-2*gray[(y-1)*W+x]-gray[(y-1)*W+(x+1)]+gray[(y+1)*W+(x-1)]+2*gray[(y+1)*W+x]+gray[(y+1)*W+(x+1)]
          const m=Math.sqrt(gx*gx+gy*gy); edges[y*W+x]=m; if(m>maxEdge)maxEdge=m
        }
        const thresh=maxEdge*0.16, bin=new Uint8Array(W*H)
        for(let i=0;i<W*H;i++) bin[i]=edges[i]>thresh?1:0
        const colE=new Float32Array(W),rowE=new Float32Array(H)
        for(let y=0;y<H;y++) for(let x=0;x<W;x++){colE[x]+=bin[y*W+x];rowE[y]+=bin[y*W+x]}
        let vL=W,vR=0,vT=H,vB=0
        for(let x=0;x<W;x++) if(colE[x]>3){vL=Math.min(vL,x);vR=Math.max(vR,x)}
        for(let y=0;y<H;y++) if(rowE[y]>3){vT=Math.min(vT,y);vB=Math.max(vB,y)}
        if(vR-vL<W*0.35){vL=Math.floor(W*0.08);vR=Math.floor(W*0.92)}
        if(vB-vT<H*0.25){vT=Math.floor(H*0.08);vB=Math.floor(H*0.88)}
        const vW=vR-vL||1,vH_=vB-vT||1,aspectRatio=vW/vH_
        const roofline=[]
        for(let x=vL;x<=vR;x++) for(let y=vT;y<vB;y++){if(bin[y*W+x]){roofline.push({x,y});break}}
        const seg=Math.floor(roofline.length/4),avg=arr=>arr.length?arr.reduce((a,b)=>a+b,0)/arr.length:0
        const roofL =(avg(roofline.slice(0,seg).map(p=>p.y))-vT)/vH_
        const roofML=(avg(roofline.slice(seg,2*seg).map(p=>p.y))-vT)/vH_
        const roofMR=(avg(roofline.slice(2*seg,3*seg).map(p=>p.y))-vT)/vH_
        const roofR =(avg(roofline.slice(3*seg).map(p=>p.y))-vT)/vH_
        const rearDrop=Math.max(0,roofR-Math.min(roofML,roofMR))
        const frontRise=Math.max(0,roofL-Math.min(roofML,roofMR))
        const nZ=12,zoneD=new Float32Array(nZ)
        for(let x=vL;x<=vR;x++){const z=Math.min(nZ-1,Math.floor((x-vL)/vW*nZ));for(let y=vT;y<vB;y++)if(bin[y*W+x])zoneD[z]++}
        const maxZD=Math.max(...zoneD)||1; for(let i=0;i<nZ;i++)zoneD[i]/=maxZD
        const peaks=[];for(let i=1;i<nZ-1;i++)if(zoneD[i]>zoneD[i-1]&&zoneD[i]>zoneD[i+1]&&zoneD[i]>0.45)peaks.push(i/nZ)
        peaks.sort((a,b)=>a-b)
        let aPos=0.28,cPos=0.72
        if(peaks.length>=2){aPos=peaks[0];cPos=peaks[peaks.length-1]}
        else if(peaks.length===1){aPos=Math.min(peaks[0],0.35);cPos=Math.max(peaks[0],0.65)}
        const hoodRatio=Math.max(0.18,Math.min(0.40,aPos)), bootRatio=Math.max(0.12,Math.min(0.38,1-cPos))
        const cabinRatio=Math.max(0.28,Math.min(0.60,1-hoodRatio-bootRatio))
        const cabinH=0.58+frontRise*0.1
        const aSlope=Math.abs(roofML-roofL)/(Math.max(aPos-0,0.01))
        const wsAngleDeg=Math.max(44,Math.min(72,48+rearDrop*55+aSlope*12))
        const btmBandEdge=(()=>{let s=0,n=0;for(let y=Math.floor(vB-vH_*0.20);y<vB;y++)for(let x=vL;x<=vR;x++){s+=bin[y*W+x];n++};return n?s/n:0})()
        const rideH=btmBandEdge>0.08?0.15:0.08
        let bodyType,rearType,rooflineType
        if(aspectRatio>2.4){bodyType=rearDrop>0.15?'estate':'suv';rearType='squareback';rooflineType='flat'}
        else if(aspectRatio>1.85){if(rearDrop>0.24){bodyType='fastback';rearType='fastback';rooflineType='sloped_full'}else if(rearDrop>0.12){bodyType='hatchback';rearType='hatchback';rooflineType='sloped_rear'}else{bodyType='notchback';rearType='notchback';rooflineType='flat'}}
        else if(aspectRatio<1.55){bodyType='suv';rearType='squareback';rooflineType='flat'}
        else{bodyType=rearDrop>0.20?'fastback':'notchback';rearType=bodyType;rooflineType=bodyType==='fastback'?'sloped_full':'flat'}
        const w1=hoodRatio*0.60+0.05, w2=1-bootRatio*0.55-0.04
        const baseCd={fastback:0.27,coupe:0.27,notchback:0.30,hatchback:0.31,estate:0.29,suv:0.36,pickup:0.42}
        const Cd=Math.max(0.22,Math.min(0.48,(baseCd[bodyType]??0.30)-(wsAngleDeg-58)*0.0018))
        const confidence=Math.min(1,peaks.length/3*0.4+(1-Math.abs(aspectRatio-2)/3)*0.6)
        URL.revokeObjectURL(url)
        resolve({bodyType,rearType,rooflineType,hoodRatio,cabinRatio,bootRatio,cabinH,wsAngleDeg,rideH,w1,w2,Cd,aspectRatio,rearDrop,frontRise,confidence,_peaks:peaks,_zones:Array.from(zoneD)})
      } catch(e){URL.revokeObjectURL(url);reject(e)}
    }
    img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('Image load failed'))}
    img.src=url
  })
}

// ── Cp helpers ────────────────────────────────────────────────────────────────
function cpAtPoint(t,hz,isFront,Cd){const s=Cd/0.30;return((isFront?Math.max(0,(1-7*t*t))*0.95:0)-1.35*Math.sin(Math.PI*t)*Math.pow(Math.max(0,hz),0.55)+(hz<0.10?-0.38*Math.sin(Math.PI*t):0)+(t>0.80?-0.72*Math.pow((t-0.80)/0.20,0.65):0)+((t>0.16&&t<0.30&&hz>0.55)?0.22:0))*s}
function cpToRgb(cp){const t=Math.max(0,Math.min(1,(cp+1.5)/2.5));const stops=[[0,[33,71,217]],[0.25,[34,211,238]],[0.50,[132,204,22]],[0.75,[251,191,36]],[1,[239,68,68]]];for(let i=0;i<stops.length-1;i++){const[t0,c0]=stops[i],[t1,c1]=stops[i+1];if(t<=t1){const f=(t-t0)/(t1-t0);return`rgb(${[0,1,2].map(j=>Math.round(c0[j]+(c1[j]-c0[j])*f)).join(',')})`}}return'rgb(239,68,68)'}
function getDragBreakdown(bt){const d={fastback:[{name:'Pressure',pct:0.38,c:'#FF453A'},{name:'Friction',pct:0.22,c:'#FF9F0A'},{name:'Induced',pct:0.16,c:'#30D158'},{name:'Wheels',pct:0.14,c:'#40CBE0'},{name:'Cooling',pct:0.10,c:'#0A84FF'}],notchback:[{name:'Pressure',pct:0.40,c:'#FF453A'},{name:'Friction',pct:0.20,c:'#FF9F0A'},{name:'Induced',pct:0.18,c:'#30D158'},{name:'Wheels',pct:0.14,c:'#40CBE0'},{name:'Cooling',pct:0.08,c:'#0A84FF'}]};return d[bt]??d.notchback}

// ── SVG views (kept exactly — only label text updated) ─────────────────────
function SideView({g,cpOn,showSep,showIso}){
  // If we have real contour points from the backend, render them directly
  const contourPts   = g?._contourPts
  const keypoints    = g?._keypoints
  const W=620,H=260,PAD=28

  if (contourPts && contourPts.length > 10) {
    // Render real SVG path from contour data
    const scale_x = (W - PAD*2)
    const scale_y = (H - 40)
    const off_x   = PAD
    const off_y   = 20

    // Build SVG path from normalised points
    const pts = contourPts.map(([nx, ny]) => [
      off_x + nx * scale_x,
      off_y + ny * scale_y
    ])
    const pathD = pts.map((p, i) => `${i===0?'M':'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ') + ' Z'

    // Cp color bands (vertical slices, same as before)
    const cpBands = Array.from({length:14}, (_,i) => {
      const f=i/14, cp=(0.9*(1-Math.pow(f-0.3,2)*3)-0.15)*(g.Cd/0.30)
      return { x: off_x + f*scale_x, w: scale_x/14+1, color: cpToRgb(cp) }
    })

    // Wheel circles from keypoints
    const wheels = (keypoints?.wheels ?? []).map(w => ({
      cx: off_x + w.nx * scale_x,
      cy: off_y + w.ny * scale_y,
      r:  Math.max(8, w.r / 800 * scale_x),
    }))

    // Roofline accent from keypoints
    const roofPts = (keypoints?.roofline ?? [])
    const roofPath = roofPts.length > 1
      ? roofPts.map((p,i) => `${i===0?'M':'L'}${(off_x+p.nx*scale_x).toFixed(1)},${(off_y+p.ny*scale_y).toFixed(1)}`).join(' ')
      : null

    const gY = H - 16

    return (
      <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',height:'100%'}} preserveAspectRatio="xMidYMid meet">
        <defs>
          <clipPath id="sclip"><path d={pathD}/></clipPath>
          <linearGradient id="bodygrd" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(255,255,255,0.08)"/>
            <stop offset="100%" stopColor="rgba(0,0,0,0)"/>
          </linearGradient>
        </defs>

        {/* Shadow */}
        <ellipse cx={W/2} cy={gY+5} rx={scale_x*0.48} ry={7} fill="rgba(0,0,0,0.45)"/>
        <line x1={12} y1={gY} x2={W-12} y2={gY} stroke="rgba(255,255,255,0.06)" strokeWidth="1.5"/>

        {/* Cp bands clipped to real contour */}
        {cpOn && (
          <g clipPath="url(#sclip)">
            {cpBands.map((b,i) => <rect key={i} x={b.x} y={0} width={b.w} height={H} fill={b.color} opacity={0.88}/>)}
          </g>
        )}

        {/* Main body — real contour */}
        <path d={pathD} fill={cpOn?'rgba(4,8,16,0.25)':'#0e1a24'} stroke="rgba(10,132,255,0.7)" strokeWidth="1.2"/>

        {/* Gloss highlight overlay */}
        <path d={pathD} fill="url(#bodygrd)" clipPath="url(#sclip)" opacity="0.4"/>

        {/* Roofline accent */}
        {roofPath && (
          <path d={roofPath} fill="none" stroke="rgba(10,132,255,0.35)" strokeWidth="1.5" strokeDasharray="4 3"/>
        )}

        {/* Wheels from Hough detection */}
        {wheels.map((w,i) => (
          <g key={i}>
            <circle cx={w.cx} cy={w.cy} r={w.r} fill="#060C14" stroke="#1E3040" strokeWidth="2.5"/>
            <circle cx={w.cx} cy={w.cy} r={w.r*0.65} fill="#0C1C28" stroke="#162C38" strokeWidth="1.4"/>
            {[0,72,144,216,288].map(a => {
              const rad=a*Math.PI/180
              return <path key={a} d={`M ${w.cx+Math.cos(rad)*w.r*0.22} ${w.cy+Math.sin(rad)*w.r*0.22} L ${w.cx+Math.cos(rad+0.28)*w.r*0.62} ${w.cy+Math.sin(rad+0.28)*w.r*0.62} Q ${w.cx+Math.cos(rad)*w.r*0.65} ${w.cy+Math.sin(rad)*w.r*0.65} ${w.cx+Math.cos(rad-0.28)*w.r*0.62} ${w.cy+Math.sin(rad-0.28)*w.r*0.62} Z`} fill="#162838" stroke="#1E3040" strokeWidth="0.8"/>
            })}
            <circle cx={w.cx} cy={w.cy} r={w.r*0.14} fill="#1E3040"/>
          </g>
        ))}

        {/* Separation line indicator */}
        {showSep && keypoints?.bumpers?.rear && (
          <line
            x1={off_x + keypoints.bumpers.rear.nx * scale_x}
            y1={off_y}
            x2={off_x + keypoints.bumpers.rear.nx * scale_x}
            y2={gY}
            stroke="rgba(255,100,80,0.5)" strokeWidth="1" strokeDasharray="3 2"
          />
        )}

        {/* Labels */}
        <text x={W/2} y={H-3} textAnchor="middle" fill="rgba(255,255,255,0.15)" fontSize="9" fontFamily="'IBM Plex Mono',monospace" letterSpacing="0.12em">
          SIDE · {(g.bodyType??'').toUpperCase()} · {contourPts.length}pts
        </text>
      </svg>
    )
  }

  // ── Fallback: geometric SVG (original code, when no contour available) ──
  const W2=620,H2=240,PAD2=32; // renamed to avoid conflictconst bLen=W-PAD*2,rideH=bLen*0.055*(g.rideH>0.12?1.8:1.0),bH=H*0.52,gY=H-18,sill=gY-rideH,roofY=sill-bH;const x=f=>PAD+f*bLen;const hx=x(g.hoodRatio),chx=x(g.hoodRatio+g.cabinRatio),rX=x(1.0);const wsH=bH*g.cabinH,wsRad=(90-g.wsAngleDeg)*Math.PI/180,wsRun=wsH/Math.tan(Math.max(0.1,wsRad));const aTx=hx+wsRun,aBy=sill-bH*0.74,hoodY=sill-bH*0.50,cowlY=sill-bH*0.72,roofMidX=(aTx+chx)*0.50,sag=g.bodyType==='suv'?bH*0.01:g.bodyType==='estate'?0:bH*0.015;const bt=g.bodyType;let rearSVG='';if(bt==='fastback'||bt==='coupe'){const c1=x(g.hoodRatio+g.cabinRatio*0.82),c2=x(g.hoodRatio+g.cabinRatio*1.05);rearSVG=[`Q ${c1} ${roofY+sag} ${chx+8} ${roofY+bH*0.10}`,`C ${c2} ${sill-bH*0.38} ${rX-10} ${sill-bH*0.28} ${rX} ${sill-bH*0.18}`].join(' ')}else if(bt==='notchback'){const deckY=sill-bH*0.56;rearSVG=[`L ${chx} ${roofY+sag}`,`L ${x(g.hoodRatio+g.cabinRatio+0.02)} ${roofY+sag}`,`Q ${rX-14} ${roofY+sag+4} ${rX} ${deckY}`,`L ${rX} ${sill-bH*0.18}`].join(' ')}else if(bt==='estate'){rearSVG=[`L ${chx} ${roofY+sag}`,`Q ${rX-5} ${roofY+sag+3} ${rX} ${sill-bH*0.18}`].join(' ')}else if(bt==='suv'){rearSVG=[`L ${chx} ${roofY+sag}`,`Q ${rX-10} ${roofY+sag+8} ${rX} ${sill-bH*0.20}`].join(' ')}else if(bt==='pickup'){const bedTopY=sill-bH*0.52;rearSVG=[`L ${chx} ${roofY+sag}`,`L ${chx} ${bedTopY}`,`L ${rX-5} ${bedTopY}`,`Q ${rX} ${bedTopY} ${rX} ${sill-bH*0.14}`].join(' ')}else{rearSVG=[`Q ${chx+14} ${roofY+bH*0.10} ${rX-18} ${sill-bH*0.40}`,`Q ${rX} ${sill-bH*0.32} ${rX} ${sill-bH*0.16}`].join(' ')}
const bodyPath=[`M ${x(0.03)} ${gY-1}`,`C ${PAD+2} ${sill+4} ${PAD} ${sill-bH*0.18} ${PAD} ${sill-bH*0.32}`,`L ${PAD} ${sill-bH*0.47}`,`Q ${x(0.04)} ${hoodY-bH*0.03} ${x(0.10)} ${hoodY}`,`Q ${x(0.22)} ${hoodY} ${hx} ${cowlY}`,`L ${aTx} ${roofY}`,`Q ${roofMidX} ${roofY-sag} ${chx} ${roofY+sag}`,rearSVG,`L ${rX} ${sill}`,`Q ${rX-3} ${sill+2} ${rX-bLen*0.055} ${gY-1}`,`L ${x(0.03)} ${gY-1}`,'Z'].join(' ')
const dloPath=(()=>{const dloFrontY=aBy,dloRoofL=roofY+3,dloRoofR=roofY+sag+3;let rear='';if(bt==='fastback'||bt==='coupe')rear=`Q ${chx+8} ${roofY+bH*0.14} ${chx+26} ${dloFrontY+bH*0.10}`;else if(bt==='notchback')rear=`L ${chx-4} ${dloFrontY+2}`;else if(bt==='hatchback')rear=`Q ${chx+10} ${roofY+bH*0.12} ${chx+16} ${dloFrontY+4}`;else rear=`L ${chx-4} ${dloFrontY+2}`;return[`M ${hx+5} ${dloFrontY}`,`L ${aTx+3} ${dloRoofL}`,`Q ${roofMidX} ${dloRoofL} ${chx-4} ${dloRoofR}`,rear,`L ${hx+5} ${dloFrontY}`,'Z'].join(' ')})()
const wR=bH*(bt==='suv'||bt==='pickup'?0.210:0.178),w1x=x(g.w1),w2x=x(g.w2),wY=gY-wR
const N=20,cpBands=Array.from({length:N},(_,i)=>{const tM=(i+0.5)/N;return{x0:x(i/N),x1:x((i+1)/N)+1,color:cpToRgb(cpAtPoint(tM,0.65,tM<0.15,g.Cd))}})
const sepX=bt==='fastback'?x(g.hoodRatio+g.cabinRatio*0.88):x(g.hoodRatio+g.cabinRatio),sepY=bt==='fastback'?roofY+bH*0.08:roofY+sag
return(<svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',height:'100%'}} preserveAspectRatio="xMidYMid meet"><defs><clipPath id="sc"><path d={bodyPath}/></clipPath><linearGradient id="edgeHi" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="rgba(255,255,255,0.14)"/><stop offset="40%" stopColor="rgba(255,255,255,0.02)"/><stop offset="100%" stopColor="rgba(0,0,0,0.22)"/></linearGradient><linearGradient id="cpBar" x1="0" y1="1" x2="0" y2="0"><stop offset="0%" stopColor="#2147d9"/><stop offset="25%" stopColor="#22d3ee"/><stop offset="50%" stopColor="#84cc16"/><stop offset="75%" stopColor="#fbbf24"/><stop offset="100%" stopColor="#ef4444"/></linearGradient><filter id="sep"><feGaussianBlur stdDeviation="1.2"/></filter></defs><ellipse cx={W/2} cy={gY+6} rx={bLen*0.43} ry={8} fill="rgba(0,0,0,0.4)"/><line x1={6} y1={gY} x2={W-6} y2={gY} stroke="rgba(255,255,255,0.06)" strokeWidth="1.5"/>{cpOn&&<g clipPath="url(#sc)">{cpBands.map((b,i)=><rect key={i} x={b.x0} y={roofY-20} width={b.x1-b.x0} height={bH+rideH+30} fill={b.color}/>)}</g>}<path d={bodyPath} fill={cpOn?'rgba(5,10,18,0.24)':'#111E28'} stroke="rgba(10,132,255,0.65)" strokeWidth={cpOn?0.75:1.1}/><path d={bodyPath} fill="url(#edgeHi)"/><path d={dloPath} fill={cpOn?'rgba(10,132,255,0.16)':'rgba(10,132,255,0.10)'} stroke="rgba(10,132,255,0.55)" strokeWidth="0.85"/><path d={dloPath} fill="rgba(0,14,30,0.40)"/>{bt!=='pickup'&&bt!=='fastback'&&bt!=='coupe'&&<line x1={x(g.hoodRatio+g.cabinRatio*0.46)} y1={aBy} x2={x(g.hoodRatio+g.cabinRatio*0.46)} y2={sill} stroke="rgba(0,0,0,0.6)" strokeWidth="3.5"/>}<path d={`M ${hx+9} ${aBy-2} L ${hx+28} ${aBy-9} L ${hx+28} ${aBy+3} Z`} fill="#0A1620" stroke="rgba(10,132,255,0.25)" strokeWidth="0.7"/><rect x={PAD+2} y={sill-bH*0.44} width={5} height={bH*0.065} rx="1.5" fill="rgba(255,255,200,0.90)"/><rect x={rX-4} y={sill-bH*(bt==='fastback'||bt==='coupe'?0.30:0.22)} width={5} height={bH*0.14} rx="1.5" fill="rgba(255,69,58,0.90)"/>{showSep&&<g><circle cx={sepX} cy={sepY} r={5} fill="rgba(255,214,10,0.2)" filter="url(#sep)"/><circle cx={sepX} cy={sepY} r={2.5} fill="#FFD60A" opacity={0.8}/>{[0,40,80,120,160,200,240,280,320].map(a=>{const r2=a*Math.PI/180,len=a<90||a>270?10:6;return<line key={a} x1={sepX+Math.cos(r2)*2.5} y1={sepY+Math.sin(r2)*2.5} x2={sepX+Math.cos(r2)*(2.5+len)} y2={sepY+Math.sin(r2)*(2.5+len)} stroke="#FFD60A" strokeWidth="0.7" opacity={0.5}/>})}<text x={sepX+8} y={sepY-6} fill="#FFD60A" fontSize="7" fontFamily="'IBM Plex Mono',monospace">SEP</text></g>}{cpOn&&[0.28,0.52,0.76].map((fh,i)=>{const ay=sill-bH*fh;return<g key={i} transform={`translate(${PAD-24},${ay})`}><line x1={0} y1={0} x2={14} y2={0} stroke="rgba(10,132,255,0.55)" strokeWidth="1.1"/><polygon points="16,0 10,-3.5 10,3.5" fill="rgba(10,132,255,0.55)"/></g>})}{cpOn&&<g opacity={0.4}>{[0.15,0.30,0.45].map((d,i)=><ellipse key={i} cx={rX+10+d*30} cy={sill-bH*0.28} rx={4+d*12} ry={3+d*8} fill="none" stroke="#2147d9" strokeWidth="0.8" strokeDasharray="3,3"/>)}</g>}{[[w1x,wY],[w2x,wY]].map(([cx,cy],i)=><g key={i}><circle cx={cx} cy={cy} r={wR+3} fill="rgba(0,0,0,0.35)"/><circle cx={cx} cy={cy} r={wR} fill="#060C14" stroke="#1E3040" strokeWidth="2.6"/><circle cx={cx} cy={cy} r={wR*0.74} fill="#0C1824" stroke="#162C38" strokeWidth="1.5"/>{[0,72,144,216,288].map(a=>{const r2=a*Math.PI/180;return<path key={a} d={`M ${cx+Math.cos(r2)*wR*0.25} ${cy+Math.sin(r2)*wR*0.25} L ${cx+Math.cos(r2+0.22)*wR*0.70} ${cy+Math.sin(r2+0.22)*wR*0.70} Q ${cx+Math.cos(r2)*wR*0.73} ${cy+Math.sin(r2)*wR*0.73} ${cx+Math.cos(r2-0.22)*wR*0.70} ${cy+Math.sin(r2-0.22)*wR*0.70} Z`} fill="#162434" stroke="#1E3040" strokeWidth="0.8"/>})}<circle cx={cx} cy={cy} r={wR*0.15} fill="#1E3040"/><circle cx={cx} cy={cy} r={wR*0.42} fill="none" stroke="#162434" strokeWidth="0.6" strokeDasharray="4,4"/></g>)}{[[w1x,wY],[w2x,wY]].map(([cx,cy],i)=><circle key={i} cx={cx} cy={cy} r={wR+3} fill="none" stroke="#060C14" strokeWidth="5.5"/>)}{cpOn&&<><rect x={W-16} y={H*0.13} width={10} height={H*0.62} rx="2" fill="url(#cpBar)"/><text x={W-22} y={H*0.13+5} textAnchor="end" fill="rgba(255,255,255,0.25)" fontSize="7" fontFamily="'IBM Plex Mono',monospace">+1.0</text><text x={W-22} y={H*0.75+5} textAnchor="end" fill="rgba(255,255,255,0.25)" fontSize="7" fontFamily="'IBM Plex Mono',monospace">−1.5</text></>}<text x={W/2} y={H-3} textAnchor="middle" fill="rgba(255,255,255,0.15)" fontSize="9" fontFamily="'IBM Plex Mono',monospace" letterSpacing="0.12em">SIDE · {g.bodyType.toUpperCase()} · Cd {g.Cd.toFixed(3)} · WS {g.wsAngleDeg.toFixed(0)}°</text></svg>)}

function FrontView({g,cpOn}){
  const W=320,H=240,cx=W/2,gY=H-16
  const kp = g?._keypoints

  // Derive real dimensions from keypoints when available
  const isTall = g.bodyType==='suv'||g.bodyType==='pickup'
  const isFast = g.bodyType==='fastback'||g.bodyType==='coupe'

  // Width: use wheel track from keypoints (distance between wheels × 0.7 for perspective)
  // or fall back to body-type defaults
  const wheels = kp?.wheels ?? []
  const hasWheels = wheels.length >= 2
  const trackFrac = hasWheels
    ? Math.abs(wheels[1].nx - wheels[0].nx)  // normalised wheel separation
    : (isTall ? 0.52 : isFast ? 0.44 : 0.48)

  // Height: from roofline top to sill
  const roofPts   = kp?.roofline ?? []
  const roofTopNY = roofPts.length ? Math.min(...roofPts.map(p=>p.ny)) : (isTall?0.08:0.15)
  const sillPts   = kp?.sill ?? []
  const sillNY    = sillPts.length ? (sillPts.reduce((s,p)=>s+p.ny,0)/sillPts.length) : 0.80

  // Map to pixel dimensions — front view is narrower than side
  const bw = Math.round(Math.min(110, Math.max(70, trackFrac * W * 1.1)))
  const bh = Math.round(Math.min(130, Math.max(75, (sillNY - roofTopNY) * H * 1.15)))

  const rideHpx  = bh * (g.rideH > 0.12 ? 0.16 : 0.08)
  const bodyBot  = gY - rideHpx
  const bodyTop  = bodyBot - bh

  // Windscreen rake affects shoulder width relative to roof
  const wsAngle  = g.wsAngleDeg ?? 58
  const roofNarrow = Math.max(0.28, Math.min(0.46, 0.38 - (wsAngle - 55) * 0.003))
  const roofHW   = bw * roofNarrow
  const shoulderHW = bw * 0.50
  const sillHW   = bw * 0.46
  const shoulderY  = bodyTop + bh * 0.55
  const sillY      = bodyTop + bh * 0.92

  const frontPath = [
    `M ${cx} ${bodyTop}`,
    `C ${cx-roofHW*0.6} ${bodyTop} ${cx-shoulderHW} ${shoulderY-bh*0.22} ${cx-shoulderHW} ${shoulderY}`,
    `C ${cx-shoulderHW} ${shoulderY+bh*0.12} ${cx-sillHW} ${sillY} ${cx-sillHW*0.80} ${bodyBot}`,
    `L ${cx+sillHW*0.80} ${bodyBot}`,
    `C ${cx+sillHW} ${sillY} ${cx+shoulderHW} ${shoulderY+bh*0.12} ${cx+shoulderHW} ${shoulderY}`,
    `C ${cx+shoulderHW} ${shoulderY-bh*0.22} ${cx+roofHW*0.6} ${bodyTop} ${cx} ${bodyTop}`,
    'Z'
  ].join(' ')

  // Windscreen shape — scaled by real A-pillar angle
  const wsAngleRad   = (90 - wsAngle) * Math.PI / 180
  const aPillarBaseY = bodyTop + bh * 0.55
  const aPillarTopY  = bodyTop + bh * 0.08
  const aPillarBaseHW = shoulderHW * 0.86
  const aPillarTopHW  = roofHW * 0.92
  const wscPath = [
    `M ${cx-aPillarTopHW} ${aPillarTopY}`,
    `Q ${cx} ${aPillarTopY-2} ${cx+aPillarTopHW} ${aPillarTopY}`,
    `L ${cx+aPillarBaseHW} ${aPillarBaseY}`,
    `L ${cx-aPillarBaseHW} ${aPillarBaseY}`,
    'Z'
  ].join(' ')

  // Headlights — scaled to real bw
  const hlY = bodyTop + bh * 0.27
  const hlHW = shoulderHW * 0.72
  const hlIW = shoulderHW * 0.30

  // Wheel radius from real detection
  const wR = hasWheels
    ? Math.max(12, Math.min(24, wheels[0].r / 800 * W * 0.9))
    : 16 + (isTall ? 4 : 0)
  const w1x = cx - shoulderHW * 1.05
  const w2x = cx + shoulderHW * 1.05
  const wY  = gY - wR

  // Cp bands
  const cpBands = Array.from({length:11},(_,i)=>{
    const f=i/10, d=Math.abs(f-0.5)*2
    const cp=(0.85*(1-d*d)-0.25)*(g.Cd/0.30)
    return{xL:cx-shoulderHW*(1-i*0.18),color:cpToRgb(cp)}
  })

  return(
    <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',height:'100%'}} preserveAspectRatio="xMidYMid meet">
      <defs><clipPath id="fclip"><path d={frontPath}/></clipPath></defs>
      <ellipse cx={cx} cy={gY+5} rx={shoulderHW*1.2} ry={7} fill="rgba(0,0,0,0.4)"/>
      <line x1={12} y1={gY} x2={W-12} y2={gY} stroke="rgba(255,255,255,0.06)" strokeWidth="1.5"/>
      {cpOn&&<g clipPath="url(#fclip)">{cpBands.map((b,i)=><rect key={i} x={b.xL} y={bodyTop-4} width={(shoulderHW*2)/10+2} height={bh+8} fill={b.color} opacity={0.85}/>)}</g>}
      <path d={frontPath} fill={cpOn?'rgba(5,10,18,0.28)':'#111E28'} stroke="rgba(10,132,255,0.6)" strokeWidth="0.95"/>
      <path d={wscPath} fill="rgba(10,132,255,0.08)" stroke="rgba(10,132,255,0.55)" strokeWidth="0.9"/>
      <path d={wscPath} fill="rgba(0,14,28,0.45)"/>
      {[-1,1].map(s=><path key={s} d={`M ${cx+s*aPillarTopHW} ${aPillarTopY} L ${cx+s*aPillarBaseHW} ${aPillarBaseY}`} stroke="rgba(0,0,0,0.5)" strokeWidth="4" strokeLinecap="round"/>)}
      {[-1,1].map(s=><g key={s}>
        <path d={`M ${cx+s*hlIW} ${hlY-bh*0.04} Q ${cx+s*(hlIW+hlHW)/2} ${hlY-bh*0.06} ${cx+s*hlHW} ${hlY}`} stroke="rgba(255,255,200,0.7)" strokeWidth="2" fill="none" strokeLinecap="round"/>
        <path d={`M ${cx+s*hlIW} ${hlY-bh*0.025} Q ${cx+s*(hlIW+hlHW)/2} ${hlY-bh*0.05} ${cx+s*hlHW} ${hlY} L ${cx+s*hlHW} ${hlY+bh*0.058} Q ${cx+s*(hlIW+hlHW)/2} ${hlY+bh*0.07} ${cx+s*hlIW} ${hlY+bh*0.055} Z`} fill="rgba(255,255,200,0.06)" stroke="rgba(10,132,255,0.5)" strokeWidth="0.8"/>
        <circle cx={cx+s*(hlIW+hlHW)*0.58} cy={hlY+bh*0.028} r={bh*0.022} fill="rgba(255,255,220,0.85)"/>
      </g>)}
      <path d={`M ${cx-shoulderHW*0.48} ${bodyTop+bh*0.50} L ${cx-shoulderHW*0.48} ${bodyTop+bh*0.70} L ${cx+shoulderHW*0.48} ${bodyTop+bh*0.70} L ${cx+shoulderHW*0.48} ${bodyTop+bh*0.50} Z`} fill="rgba(0,0,0,0.65)" stroke="rgba(255,255,255,0.06)" strokeWidth="0.9"/>
      {[0,1,2,3,4].map(i=><line key={i} x1={cx-shoulderHW*0.46} y1={bodyTop+bh*(0.52+i*0.038)} x2={cx+shoulderHW*0.46} y2={bodyTop+bh*(0.52+i*0.038)} stroke="rgba(255,255,255,0.04)" strokeWidth="0.7"/>)}
      <rect x={cx-shoulderHW*0.68} y={bodyTop+bh*0.76} width={shoulderHW*1.36} height={bh*0.10} rx="2" fill="rgba(0,0,0,0.50)" stroke="rgba(255,255,255,0.06)" strokeWidth="0.8"/>
      <rect x={cx-shoulderHW*0.95} y={bodyBot-bh*0.05} width={shoulderHW*1.90} height={bh*0.03} rx="1" fill="#0A1820" stroke="rgba(255,255,255,0.06)" strokeWidth="0.7"/>
      {[[w1x,wY],[w2x,wY]].map(([wcx,wcy],i)=><g key={i}>
        <circle cx={wcx} cy={wcy} r={wR} fill="#060C14" stroke="#1E3040" strokeWidth="2.5"/>
        <circle cx={wcx} cy={wcy} r={wR*0.72} fill="#0C1C28" stroke="#162C38" strokeWidth="1.4"/>
        {[0,72,144,216,288].map(a=>{const r2=a*Math.PI/180;return<path key={a} d={`M ${wcx+Math.cos(r2)*wR*0.24} ${wcy+Math.sin(r2)*wR*0.24} L ${wcx+Math.cos(r2+0.25)*wR*0.68} ${wcy+Math.sin(r2+0.25)*wR*0.68} Q ${wcx+Math.cos(r2)*wR*0.72} ${wcy+Math.sin(r2)*wR*0.72} ${wcx+Math.cos(r2-0.25)*wR*0.68} ${wcy+Math.sin(r2-0.25)*wR*0.68} Z`} fill="#162838" stroke="#1E3040" strokeWidth="0.8"/>})}
        <circle cx={wcx} cy={wcy} r={wR*0.15} fill="#1E3040"/>
      </g>)}
      <text x={cx} y={H-3} textAnchor="middle" fill="rgba(255,255,255,0.15)" fontSize="9" fontFamily="'IBM Plex Mono',monospace" letterSpacing="0.12em">FRONT · {g.bodyType?.toUpperCase()}</text>
    </svg>
  )
}

function TopView({g,yawAngle}){
  const W=320,H=240,cx=W/2,cy=H/2+6
  const kp     = g?._keypoints
  const wheels = kp?.wheels ?? []

  // Real proportions from keypoint-derived geometry
  const isTall = g.bodyType==='suv'||g.bodyType==='pickup'

  // Body length: proportional to aspect ratio (clamped to canvas)
  const bl = Math.round(Math.min(180, Math.max(130, g.aspectRatio * 72)))
  // Body width: narrower for fastback, wider for SUV
  const bw = isTall ? 82 : g.bodyType==='fastback'||g.bodyType==='coupe' ? 64 : 70

  const yawRad = (yawAngle??0)*Math.PI/180

  // Hood/cabin boundary positions along length axis
  const hoodEnd  = cy + bl * (g.hoodRatio  - 0.50)
  const cabinEnd = cy + bl * (g.hoodRatio + g.cabinRatio - 0.50)

  // Roof glass width — narrower for fastback
  const ghW = bw * (g.bodyType==='fastback'||g.bodyType==='coupe' ? 0.38 : isTall ? 0.44 : 0.41)

  // Wheel positions from real keypoints or geometry
  const fwy = wheels.length>=1 ? cy + bl*(wheels[0].nx*1.1-0.55) : cy + bl*(g.w1-0.50)
  const rwy = wheels.length>=2 ? cy + bl*(wheels[1].nx*1.1-0.55) : cy + bl*(g.w2-0.50)
  const wR  = wheels.length>=1
    ? Math.max(8, Math.min(18, wheels[0].r/800*W*0.9))
    : 10 + (isTall?2:0)
  const wTrack = bw * (isTall ? 0.54 : 0.52)

  // Roof drop for fastback — rear narrows more
  const rearNarrow = g.bodyType==='fastback' ? 0.35 : g.bodyType==='estate' ? 0.48 : 0.44

  const body = [
    `M ${cx} ${cy-bl/2+5}`,
    `Q ${cx-bw*0.24} ${cy-bl/2+1} ${cx-bw*0.48} ${cy-bl/2+22}`,
    `Q ${cx-bw*0.50} ${cy-bl/2+52} ${cx-bw*0.50} ${cy}`,
    `Q ${cx-bw*0.50} ${cy+bl*0.12} ${cx-bw*rearNarrow} ${cy+bl/2-10}`,
    `Q ${cx-bw*0.30} ${cy+bl/2-2} ${cx} ${cy+bl/2-2}`,
    `Q ${cx+bw*0.30} ${cy+bl/2-2} ${cx+bw*rearNarrow} ${cy+bl/2-10}`,
    `Q ${cx+bw*0.50} ${cy+bl*0.12} ${cx+bw*0.50} ${cy}`,
    `Q ${cx+bw*0.50} ${cy-bl/2+52} ${cx+bw*0.48} ${cy-bl/2+22}`,
    `Q ${cx+bw*0.24} ${cy-bl/2+1} ${cx} ${cy-bl/2+5}`,
    'Z'
  ].join(' ')

  const ghPath = [
    `M ${cx} ${hoodEnd-4}`,
    `Q ${cx-ghW*0.50} ${hoodEnd+2} ${cx-ghW*0.52} ${hoodEnd+16}`,
    `L ${cx-ghW*0.52} ${cabinEnd-10}`,
    `Q ${cx-ghW*0.44} ${cabinEnd} ${cx} ${cabinEnd}`,
    `Q ${cx+ghW*0.44} ${cabinEnd} ${cx+ghW*0.52} ${cabinEnd-10}`,
    `L ${cx+ghW*0.52} ${hoodEnd+16}`,
    `Q ${cx+ghW*0.50} ${hoodEnd+2} ${cx} ${hoodEnd-4}`,
    'Z'
  ].join(' ')

  // Cp stripes along length
  const N=14
  const cpS = Array.from({length:N},(_,i)=>{
    const tM=(i+0.5)/N
    return{y0:cy-bl/2+5+i*(bl-7)/N, y1:cy-bl/2+5+(i+1)*(bl-7)/N, c:cpToRgb(cpAtPoint(tM,0.70,tM<0.15,g.Cd))}
  })

  return(
    <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',height:'100%'}} preserveAspectRatio="xMidYMid meet">
      <defs><clipPath id="tclip"><path d={body}/></clipPath></defs>
      <g clipPath="url(#tclip)">{cpS.map((s,i)=><rect key={i} x={cx-bw*0.52} y={s.y0} width={bw*1.04} height={s.y1-s.y0+1} fill={s.c} opacity={0.88}/>)}</g>
      <path d={body} fill={cpS?'rgba(4,8,16,0.25)':'#0e1a24'} stroke="rgba(10,132,255,0.65)" strokeWidth="1.1"/>
      <path d={ghPath} fill="rgba(0,14,28,0.60)" stroke="rgba(10,132,255,0.40)" strokeWidth="0.9"/>
      {/* Hood crease line */}
      <line x1={cx-bw*0.26} y1={cy-bl/2+22} x2={cx+bw*0.26} y2={cy-bl/2+22} stroke="rgba(255,255,255,0.06)" strokeWidth="0.8"/>
      {/* Wheels — 4 positions */}
      {[[-wTrack,fwy],[wTrack,fwy],[-wTrack,rwy],[wTrack,rwy]].map(([wx,wy],i)=>(
        <g key={i}>
          <ellipse cx={cx+wx} cy={wy} rx={wR*0.45} ry={wR} fill="#060C14" stroke="#1E3040" strokeWidth="1.5"/>
        </g>
      ))}
      {/* A-pillar lines */}
      {[-1,1].map(s=>(
        <line key={s} x1={cx+s*ghW*0.52} y1={hoodEnd+16} x2={cx+s*bw*0.46} y2={hoodEnd-10} stroke="rgba(255,255,255,0.08)" strokeWidth="1.2"/>
      ))}
      <text x={cx} y={H-4} textAnchor="middle" fill="rgba(255,255,255,0.15)" fontSize="9" fontFamily="'IBM Plex Mono',monospace" letterSpacing="0.12em">TOP · {g.bodyType?.toUpperCase()}</text>
    </svg>
  )
}

function UnderView({g,showGroundEffect}){
  const W=320,H=240,cx=W/2,cy=H/2+6
  const kp     = g?._keypoints
  const wheels = kp?.wheels ?? []
  const isTall = g.bodyType==='suv'||g.bodyType==='pickup'

  const bl = Math.round(Math.min(180, Math.max(130, g.aspectRatio * 72)))
  const bw = isTall ? 82 : g.bodyType==='fastback'||g.bodyType==='coupe' ? 64 : 70

  const fwy = wheels.length>=1 ? cy + bl*(wheels[0].nx*1.1-0.55) : cy + bl*(g.w1-0.50)
  const rwy = wheels.length>=2 ? cy + bl*(wheels[1].nx*1.1-0.55) : cy + bl*(g.w2-0.50)
  const wR  = wheels.length>=1 ? Math.max(8, Math.min(18, wheels[0].r/800*W*0.9)) : 10+(isTall?2:0)
  const wTrack = bw * (isTall ? 0.54 : 0.52)

  // Ride height affects underbody detail visibility
  const rh = g.rideH ?? 0.08
  const diffuserLength = bl * 0.14
  const diffuserY = cy + bl/2 - diffuserLength

  const body = [
    `M ${cx} ${cy-bl/2+5}`,
    `Q ${cx-bw*0.24} ${cy-bl/2+1} ${cx-bw*0.48} ${cy-bl/2+22}`,
    `L ${cx-bw*0.50} ${cy+bl*0.08}`,
    `Q ${cx-bw*0.48} ${cy+bl/2-12} ${cx-bw*0.42} ${cy+bl/2-3}`,
    `L ${cx+bw*0.42} ${cy+bl/2-3}`,
    `Q ${cx+bw*0.48} ${cy+bl/2-12} ${cx+bw*0.50} ${cy+bl*0.08}`,
    `L ${cx+bw*0.48} ${cy-bl/2+22}`,
    `Q ${cx+bw*0.24} ${cy-bl/2+1} ${cx} ${cy-bl/2+5}`,
    'Z'
  ].join(' ')

  const N=14
  const cpS = Array.from({length:N},(_,i)=>{
    const tM=(i+0.5)/N
    return{y0:cy-bl/2+5+i*(bl-7)/N, y1:cy-bl/2+5+(i+1)*(bl-7)/N, c:cpToRgb(cpAtPoint(tM,0.05,tM<0.15,g.Cd))}
  })

  // Ground effect channels — more pronounced with lower ride height
  const geChannels = showGroundEffect ? [-0.55,-0.35,-0.15,0.05].map((cp,li)=>({
    y: cy - bl*0.12 + li*(bl*0.10),
    w: (1-Math.abs(cp)/0.8) * bw * 0.38,
    c: cpToRgb(cp)
  })) : []

  return(
    <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',height:'100%'}} preserveAspectRatio="xMidYMid meet">
      <defs><clipPath id="uclip"><path d={body}/></clipPath></defs>
      <g clipPath="url(#uclip)">{cpS.map((s,i)=><rect key={i} x={cx-bw*0.52} y={s.y0} width={bw*1.04} height={s.y1-s.y0+1} fill={s.c} opacity={0.85}/>)}</g>
      <path d={body} fill={cpS?'rgba(4,8,16,0.25)':'#0e1a24'} stroke="rgba(10,132,255,0.65)" strokeWidth="1.1"/>
      {/* Floor pan — large central rectangle */}
      <rect x={cx-bw*0.28} y={cy-bl*0.35} width={bw*0.56} height={bl*0.62} rx="3" fill="rgba(0,0,0,0.3)" stroke="rgba(255,255,255,0.05)" strokeWidth="0.8"/>
      {/* Driveshaft tunnel */}
      <rect x={cx-bw*0.05} y={cy-bl*0.30} width={bw*0.10} height={bl*0.52} rx="2" fill="rgba(0,0,0,0.5)" stroke="rgba(255,255,255,0.07)" strokeWidth="0.6"/>
      {/* Ground effect channels */}
      {geChannels.map((ch,i)=>(
        <rect key={i} x={cx-ch.w/2} y={ch.y} width={ch.w} height={bl*0.08} rx="2" fill={ch.c} opacity={0.5}/>
      ))}
      {/* Rear diffuser */}
      <path d={`M ${cx-bw*0.38} ${diffuserY} L ${cx-bw*0.42} ${cy+bl/2-3} L ${cx+bw*0.42} ${cy+bl/2-3} L ${cx+bw*0.38} ${diffuserY} Z`} fill="rgba(10,132,255,0.08)" stroke="rgba(10,132,255,0.3)" strokeWidth="0.9"/>
      {/* Diffuser fins */}
      {[-2,-1,0,1,2].map(i=>(
        <line key={i} x1={cx+i*bw*0.07} y1={diffuserY} x2={cx+i*bw*0.075} y2={cy+bl/2-3} stroke="rgba(10,132,255,0.2)" strokeWidth="0.7"/>
      ))}
      {/* Exhaust tips */}
      {(g.bodyType!=='suv'&&g.bodyType!=='pickup') && [-1,1].map(s=>(
        <ellipse key={s} cx={cx+s*bw*0.30} cy={cy+bl/2-5} rx={bw*0.04} ry={bw*0.025} fill="rgba(40,40,40,0.8)" stroke="rgba(255,255,255,0.12)" strokeWidth="0.8"/>
      ))}
      {/* Wheels */}
      {[[-wTrack,fwy],[wTrack,fwy],[-wTrack,rwy],[wTrack,rwy]].map(([wx,wy],i)=>(
        <ellipse key={i} cx={cx+wx} cy={wy} rx={wR*0.45} ry={wR} fill="#060C14" stroke="#1E3040" strokeWidth="1.5"/>
      ))}
      <text x={cx} y={H-4} textAnchor="middle" fill="rgba(255,255,255,0.15)" fontSize="9" fontFamily="'IBM Plex Mono',monospace" letterSpacing="0.12em">UNDERSIDE · {g.bodyType?.toUpperCase()}</text>
    </svg>
  )
}

function DragDonut({breakdown}){const R=44,r=28,cx=60,cy=54;let sa=-Math.PI/2;const slices=breakdown.map(b=>{const a=b.pct*2*Math.PI,x1=cx+R*Math.cos(sa),y1=cy+R*Math.sin(sa),x2=cx+R*Math.cos(sa+a),y2=cy+R*Math.sin(sa+a),ix1=cx+r*Math.cos(sa),iy1=cy+r*Math.sin(sa),ix2=cx+r*Math.cos(sa+a),iy2=cy+r*Math.sin(sa+a),lg=a>Math.PI?1:0,path=`M ${x1} ${y1} A ${R} ${R} 0 ${lg} 1 ${x2} ${y2} L ${ix2} ${iy2} A ${r} ${r} 0 ${lg} 0 ${ix1} ${iy1} Z`;sa+=a;return{...b,path}});return(<svg viewBox="0 0 120 108" style={{width:'100%',height:108}}>{slices.map((s,i)=><path key={i} d={s.path} fill={s.c} stroke="#030608" strokeWidth="0.8"/>)}<text x={cx} y={cy+4} textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize="8" fontFamily="'IBM Plex Mono',monospace">DRAG</text>{breakdown.map((b,i)=><g key={i}><rect x={i<3?2:62} y={88+i%3*13} width={8} height={8} rx="1" fill={b.c}/><text x={i<3?12:72} y={88+i%3*13+7} fill="rgba(255,255,255,0.3)" fontSize="7" fontFamily="'IBM Plex Mono',monospace">{b.name} {(b.pct*100).toFixed(0)}%</text></g>)}</svg>)}

// ── Cd gauge ──────────────────────────────────────────────────────────────────
function CdGauge({cd}){const pct=Math.min(1,Math.max(0,(cd-0.15)/0.35));const angle=-135+pct*270;const color=cd<0.24?'var(--green)':cd<0.27?'var(--blue)':cd<0.32?'var(--orange)':'var(--red)';const label=cd<0.24?'Exceptional':cd<0.27?'Excellent':cd<0.32?'Average':'High drag';const rad=d=>(d-90)*Math.PI/180;const nx=60+46*Math.cos(rad(angle)),ny=62+46*Math.sin(rad(angle));return(<div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:4}}><svg viewBox="0 0 120 72" style={{width:128,height:80}}><path d="M10,62 A50,50 0 0,1 110,62" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="10" strokeLinecap="round"/><path d="M10,62 A50,50 0 0,1 110,62" fill="none" stroke={color} strokeWidth="10" strokeLinecap="round" strokeDasharray={`${pct*157} 157`}/>{[0.20,0.25,0.30,0.35,0.40].map((v,i)=>{const tp=Math.min(1,(v-0.15)/0.35),ta=-135+tp*270;return<circle key={i} cx={60+40*Math.cos(rad(ta))} cy={62+40*Math.sin(rad(ta))} r="2" fill="rgba(255,255,255,0.1)"/>})}<line x1="60" y1="62" x2={nx} y2={ny} stroke={color} strokeWidth="2.4" strokeLinecap="round"/><circle cx="60" cy="62" r="5" fill={color}/><text x="60" y="56" textAnchor="middle" fill={color} fontSize="14" fontFamily="'IBM Plex Mono',monospace" fontWeight="bold">{cd.toFixed(3)}</text></svg><span style={{fontSize:11,fontWeight:600,color,letterSpacing:'0.04em'}}>{label}</span></div>)}

const BENCHMARKS=[{name:'Tesla Model 3',Cd:0.23},{name:'BMW 3 Series',Cd:0.26},{name:'Audi A4',Cd:0.27},{name:'Toyota Camry',Cd:0.28},{name:'VW Golf',Cd:0.30},{name:'Porsche 911',Cd:0.30},{name:'Ford Mustang',Cd:0.35},{name:'Generic SUV',Cd:0.38}]

function BenchmarkBar({cd}){const pct=v=>((v-0.20)/0.24)*100;return(<div style={{width:'100%'}}><div style={{position:'relative',height:16,borderRadius:4,overflow:'hidden',marginBottom:5}}><div style={{position:'absolute',inset:0,background:'linear-gradient(to right,var(--green),var(--blue),var(--orange),var(--red))'}}/>{BENCHMARKS.map((b,i)=><div key={i} style={{position:'absolute',top:0,bottom:0,width:0.5,background:'rgba(0,0,0,0.5)',left:`${pct(b.Cd)}%`}}/>)}<div style={{position:'absolute',top:-2,bottom:-2,width:3,background:'white',borderRadius:2,left:`${Math.min(98,Math.max(2,pct(cd)))}%`,transform:'translateX(-1px)',boxShadow:'0 0 6px rgba(255,255,255,0.7)'}}/></div><div style={{display:'flex',justifyContent:'space-between',fontSize:9,fontFamily:"'IBM Plex Mono'",color:'var(--text-quaternary)',marginBottom:6}}><span>0.20</span><span>0.30</span><span>0.40</span></div></div>)}

function ZoneBar({zones}){if(!zones)return null;return(<div style={{display:'flex',gap:1,height:18,alignItems:'flex-end',margin:'4px 0'}}>{zones.map((z,i)=><div key={i} style={{flex:1,background:`rgba(10,132,255,${0.12+z*0.6})`,height:`${Math.max(4,z*100)}%`,borderRadius:1}}/>)}</div>)}

// ── Section label ─────────────────────────────────────────────────────────────
function SL({n,t}){return(<div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}><span style={{fontSize:10,fontWeight:600,color:'var(--blue)',fontFamily:"'IBM Plex Mono'"}}>{n}</span><div style={{flex:1,height:0.5,background:'var(--sep)'}}/><span style={{fontSize:10,fontWeight:600,color:'var(--text-quaternary)',letterSpacing:'0.08em',textTransform:'uppercase'}}>{t}</span></div>)}

const VIEWS=[{id:'side',label:'Side'},{id:'front',label:'Front'},{id:'top',label:'Top'},{id:'under',label:'Underside'}]

export default function Views2DPage() {
  const [dragOver, setDragOver]   = useState(false)
  const [file,     setFile]       = useState(null)
  const [preview,  setPreview]    = useState(null)
  const [stage,    setStage]      = useState('idle')
  const [aiInsight,   setAiInsight]   = useState(null)
  const [contourData, setContourData] = useState(null)
  const [geo,      setGeo]        = useState(null)
  const [error,    setError]      = useState(null)
  const [activeView, setActiveView] = useState('side')
  const [cpOn,     setCpOn]       = useState(true)
  const [showSep,  setShowSep]    = useState(true)
  const [showIso,  setShowIso]    = useState(false)
  const [showGE,   setShowGE]     = useState(false)
  const [yawAngle, setYawAngle]   = useState(0)
  const [urlInput,  setUrlInput]  = useState('')
  const [urlError,  setUrlError]  = useState('')
  const [urlMode,   setUrlMode]   = useState(false)
  const svgRef = useRef(null)
  const fileRef = useRef(null)

  const acceptFile = useCallback((f) => {
    if (!f||!f.type.startsWith('image/')) return
    setFile(f); setPreview(URL.createObjectURL(f)); setGeo(null); setError(null); setStage('ready')
    setUrlError('')
  }, [])

  // Load image from URL (supports http/https, drag-from-browser, paste)
  const acceptUrl = useCallback(async (url) => {
    const trimmed = url?.trim()
    if (!trimmed) return
    // Must look like an image URL
    const looksLikeImage = /\.(jpe?g|png|webp|gif|bmp|svg)(\?.*)?$/i.test(trimmed) || trimmed.startsWith('data:image/')
    setUrlError('')
    setStage('analyzing')
    setGeo(null)
    try {
      // Fetch through a CORS proxy so images from any origin work
      const fetchUrl = trimmed.startsWith('data:')
        ? trimmed
        : `https://corsproxy.io/?${encodeURIComponent(trimmed)}`
      const res = await fetch(fetchUrl)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      if (!blob.type.startsWith('image/')) throw new Error('URL does not point to an image')
      const filename = trimmed.split('/').pop()?.split('?')[0] || 'dropped.jpg'
      const file = new File([blob], filename, { type: blob.type })
      setFile(file)
      setPreview(URL.createObjectURL(blob))
      setUrlInput('')
      setUrlMode(false)
      setStage('ready')
    } catch(e) {
      setUrlError(`Could not load image: ${e.message}`)
      setStage('idle')
    }
  }, [])

  // Paste handler — catches Ctrl+V anywhere on the page
  const handlePaste = useCallback((e) => {
    // Image from clipboard
    const items = Array.from(e.clipboardData?.items ?? [])
    const imgItem = items.find(i => i.type.startsWith('image/'))
    if (imgItem) { acceptFile(imgItem.getAsFile()); return }
    // URL text from clipboard
    const text = e.clipboardData?.getData('text') ?? ''
    if (/^https?:\/\//i.test(text)) { acceptUrl(text); return }
  }, [acceptFile, acceptUrl])

  // Wire paste to window on mount
  useEffect(() => {
    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [handlePaste])

  // ── Dual-engine analysis ──────────────────────────────────────────────────
  // Step 1: canvas edge detection (fast, always works, gives geometry)
  // Step 2: backend Moondream2 /analyze (AI vision, gives identity + real Cd)
  // Results are merged — Moondream2 overrides canvas where it has data
  const run = async () => {
    if (!file) return
    setError(null); setGeo(null); setAiInsight(null); setStage('analyzing')

    // Run both in parallel — canvas is instant, backend takes ~10s
    const canvasPromise = analyzeImageCanvas(file).catch(e => ({ _error: e.message }))
    const backendPromise = (async () => {
      try {
        const fd = new FormData(); fd.append('file', file)
        const res = await fetch(`${BACKEND}/analyze`, { method: 'POST', body: fd })
        if (!res.ok) return null
        return await res.json()
      } catch { return null }
    })()
    // Contour analysis — real CV outline
    const contourPromise = (async () => {
      try {
        const fd = new FormData(); fd.append('file', file)
        const res = await fetch(`${BACKEND}/analyze-contour`, { method: 'POST', body: fd })
        if (!res.ok) return null
        return await res.json()
      } catch { return null }
    })()

    // Canvas finishes first — show preliminary geometry immediately
    const canvasResult = await canvasPromise
    if (!canvasResult._error) {
      setGeo(canvasResult)
      setStage('refining') // show "AI enhancing…" state
    }

    // Wait for contour data and AI in parallel
    const [aiResult, contourResult] = await Promise.all([backendPromise, contourPromise])
    if (contourResult?.outline_pts) {
      setContourData(contourResult)
    }
    const canvas = canvasResult._error ? null : canvasResult

    if (aiResult?.image_type === 'full_car' && aiResult.analysis) {
      const ai = aiResult.analysis
      const aiCd = ai.database_cd ?? ai.cd_reasoning?.estimated_cd
      const aiBt = _mapAiBodyType(ai.body_type)

      // Merge: AI overrides canvas for identity + Cd, canvas keeps geometry
      const merged = {
        ...(canvas ?? {}),
        // AI-sourced (authoritative when available)
        bodyType:    aiBt ?? canvas?.bodyType ?? 'notchback',
        Cd:          aiCd  ?? canvas?.Cd ?? 0.30,
        confidence:  ai.confidence ?? canvas?.confidence ?? 0.5,
        // Keep canvas geometry if we have it
        aspectRatio: canvas?.aspectRatio ?? 2.0,
        hoodRatio:   canvas?.hoodRatio   ?? 0.28,
        cabinRatio:  canvas?.cabinRatio  ?? 0.44,
        bootRatio:   canvas?.bootRatio   ?? 0.28,
        wsAngleDeg:  canvas?.wsAngleDeg  ?? 58,
        rearDrop:    canvas?.rearDrop    ?? 0.15,
        frontRise:   canvas?.frontRise   ?? 0.05,
        cabinH:      canvas?.cabinH      ?? 0.58,
        rideH:       canvas?.rideH       ?? 0.08,
        w1:          canvas?.w1          ?? 0.22,
        w2:          canvas?.w2          ?? 0.76,
        _peaks:      canvas?._peaks      ?? [],
        _zones:      canvas?._zones      ?? [],
      }
      setGeo(merged)
      setAiInsight({
        make:       ai.make,
        model:      ai.model,
        year:       ai.year_estimate,
        color:      ai.color,
        bodyType:   ai.body_type,
        cdDatabase: ai.database_cd,
        cdEstimate: ai.cd_reasoning?.estimated_cd,
        cdConfidence: ai.cd_reasoning?.cd_confidence,
        cdReasoning:  ai.cd_reasoning?.reasoning_steps,
        roofline:   ai.aero_features?.roofline_type,
        rearDesign: ai.aero_features?.rear_design,
        spoiler:    ai.aero_features?.spoiler,
        diffuser:   ai.aero_features?.diffuser,
        grille:     ai.aero_features?.grille,
        improvements: ai.improvement_suggestions ?? [],
        comparisons:  ai.comparison_cars ?? [],
        explanation:  aiResult.explanation,
        isDatabase:   !!ai.database_cd,
        databaseMatch: ai.database_match,
      })
    } else if (!canvas) {
      setError('Image analysis failed. Try a clearer side-on photo of the vehicle.')
    }
    // Merge contour geometry into the result if we have it
    if (contourResult?.geometry) {
      const cg = contourResult.geometry
      setGeo(prev => prev ? {
        ...prev,
        // Override with accurate contour-derived measurements
        bodyType:    cg.bodyType    ?? prev.bodyType,
        aspectRatio: cg.aspectRatio ?? prev.aspectRatio,
        hoodRatio:   cg.hoodRatio   ?? prev.hoodRatio,
        cabinRatio:  cg.cabinRatio  ?? prev.cabinRatio,
        bootRatio:   cg.bootRatio   ?? prev.bootRatio,
        wsAngleDeg:  cg.wsAngleDeg  ?? prev.wsAngleDeg,
        rearDrop:    cg.rearDrop    ?? prev.rearDrop,
        cabinH:      cg.cabinH      ?? prev.cabinH,
        rideH:       cg.rideH       ?? prev.rideH,
        w1:          cg.w1          ?? prev.w1,
        w2:          cg.w2          ?? prev.w2,
        confidence:  cg.confidence  ?? prev.confidence,
        _contourPts: contourResult.outline_pts,
        _keypoints:  contourResult.keypoints,
      } : { ...cg, _contourPts: contourResult.outline_pts, _keypoints: contourResult.keypoints })
    }

    setStage('done')
  }

  // Map Moondream2 body type strings → our internal keys
  function _mapAiBodyType(bt) {
    if (!bt) return null
    const s = bt.toLowerCase()
    if (s.includes('fastback') || s.includes('coupe') || s.includes('supercar') || s.includes('hypercar')) return 'fastback'
    if (s.includes('suv') || s.includes('crossover') || s.includes('truck')) return 'suv'
    if (s.includes('pickup')) return 'pickup'
    if (s.includes('estate') || s.includes('wagon') || s.includes('touring')) return 'estate'
    if (s.includes('hatchback')) return 'hatchback'
    if (s.includes('notchback') || s.includes('sedan') || s.includes('saloon')) return 'notchback'
    return null
  }

  const exportSVG = () => {
    const svg = svgRef.current?.querySelector('svg'); if(!svg) return
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([svg.outerHTML],{type:'image/svg+xml'}))
    a.download = `aeronet_${activeView}.svg`; a.click()
  }

  const isRunning = stage==='analyzing' || stage==='refining'
  const cd = aiInsight?.cdDatabase ?? aiInsight?.cdEstimate ?? geo?.Cd ?? 0.30
  const breakdown = geo ? getDragBreakdown(geo.bodyType) : []
  const improvements = { fastback:['Active rear diffuser','Underbody flat floor','Delete rear wing'], notchback:['Active grille shutters','Lower ride height','Rear lip spoiler'], hatchback:['Roof spoiler','Underbody diffuser','Tyre aero covers'], suv:['Lower ride height','Air suspension','Active aero'], estate:['Roof aero rails','Tow hitch fairing','Flush body'], pickup:['Tonneau cover','Air dam','Bed extender fairing'] }
  const suggestions = aiInsight?.improvements?.length ? aiInsight.improvements : (improvements[geo?.bodyType] ?? ['Lower ride height','Reduce frontal area','Active grille shutters'])

  const card = { background:'var(--bg1)', borderRadius:12, border:'0.5px solid rgba(255,255,255,0.06)', overflow:'hidden' }
  const toggleBtn = (label, val, set) => (
    <button key={label} onClick={()=>set(p=>!p)} style={{
      padding:'4px 11px', borderRadius:7, border:`0.5px solid ${val?'rgba(10,132,255,0.4)':'var(--sep)'}`,
      background: val?'rgba(10,132,255,0.16)':'transparent',
      color: val?'var(--blue)':'rgba(255,255,255,0.35)',
      fontSize:11, fontWeight:500, cursor:'pointer', transition:'all 0.12s',
      fontFamily:"'IBM Plex Sans'",
    }}>{label}</button>
  )

  return (
    <div style={{ display:'flex', height:'100%', overflow:'hidden', background:'var(--bg0)' }}>

      {/* ── Left panel ── */}
      <div style={{ width:248, flexShrink:0, display:'flex', flexDirection:'column', borderRight:'0.5px solid var(--sep)', overflow:'hidden' }}>
        <div style={{ flex:1, overflowY:'auto', padding:'16px 14px' }}>
          <SL n="01" t="Upload"/>

          {/* Analysis capabilities — shown only before any image loaded */}
          {!file && (
            <div style={{ marginBottom:12, padding:'10px 12px', borderRadius:10, background:'rgba(10,132,255,0.05)', border:'0.5px solid rgba(10,132,255,0.12)' }}>
              <div style={{ fontSize:10, fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase', color:'var(--blue)', marginBottom:8 }}>What gets analysed</div>
              {[
                ['Body type',      'Fastback / notchback / estate / SUV / pickup'],
                ['Cd estimate',    'From roofline slope + aspect ratio'],
                ['WS rake angle',  'A-pillar angle in degrees'],
                ['Proportions',    'Hood / cabin / boot length ratios'],
                ['Separation pt.', 'Predicted flow detachment zone'],
                ['Cp field',       'Pressure map across all 4 views'],
                ['Drag breakdown', 'Pressure · friction · induced · wheels'],
                ['vs. benchmarks', '8 production cars compared'],
                ['Suggestions',    '3 geometry changes to reduce Cd'],
              ].map(([k,v]) => (
                <div key={k} style={{ display:'flex', gap:8, marginBottom:3 }}>
                  <span style={{ fontSize:10, color:'rgba(10,132,255,0.8)', fontFamily:"'IBM Plex Mono',monospace", minWidth:86, flexShrink:0 }}>{k}</span>
                  <span style={{ fontSize:10, color:'var(--text-quaternary)', lineHeight:1.4 }}>{v}</span>
                </div>
              ))}
            </div>
          )}

          {/* Drop zone */}
          <div
            onDragOver={e=>{e.preventDefault();setDragOver(true)}}
            onDragLeave={()=>setDragOver(false)}
            onDrop={e=>{
              e.preventDefault(); setDragOver(false)
              // File drop (from OS)
              const f = e.dataTransfer.files?.[0]
              if (f) { acceptFile(f); return }
              // URL drop (dragging image from browser)
              const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain')
              if (url && /^https?:\/\//i.test(url)) { acceptUrl(url); return }
            }}
            onClick={()=>fileRef.current?.click()}
            style={{
              borderRadius:12, border:`0.5px dashed ${dragOver?'var(--blue)':'rgba(255,255,255,0.12)'}`,
              background: dragOver?'rgba(10,132,255,0.06)':'var(--bg1)',
              cursor:'pointer', overflow:'hidden', minHeight:140,
              transition:'border-color 0.15s, background 0.15s', marginBottom:10,
              display:'flex', flexDirection:'column',
            }}>
            <input ref={fileRef} type="file" accept="image/*" style={{display:'none'}} onChange={e=>acceptFile(e.target.files[0])}/>
            {preview ? (
              <div style={{ position:'relative' }}>
                <img src={preview} alt="preview" style={{ width:'100%', display:'block', borderRadius:12 }}/>
                <div style={{ position:'absolute', bottom:6, left:0, right:0, textAlign:'center' }}>
                  <span style={{ fontSize:10, color:'var(--text-secondary)', background:'rgba(0,0,0,0.55)', padding:'2px 10px', borderRadius:20, fontFamily:"'IBM Plex Sans'" }}>click to change</span>
                </div>
              </div>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:10, padding:'28px 16px', flex:1 }}>
                <div style={{ width:44, height:44, borderRadius:12, background:'var(--bg2)', border:'0.5px solid var(--sep)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5">
                    <rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>
                  </svg>
                </div>
                <span style={{ fontSize:12, color:'var(--text-tertiary)', fontFamily:"'IBM Plex Sans'", textAlign:'center' }}>Drop image, URL or file</span>
                <span style={{ fontSize:10, color:'var(--text-quaternary)', fontFamily:"'IBM Plex Mono'", textAlign:'center', lineHeight:1.7 }}>
                  JPG · PNG · WEBP<br/>
                  <span style={{color:'rgba(255,255,255,0.18)'}}>Ctrl+V to paste · drag from browser</span>
                </span>
              </div>
            )}
          </div>

          {/* URL input — paste or type any image URL */}
          <div style={{ marginBottom:10 }}>
            {urlMode ? (
              <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                <div style={{ display:'flex', gap:5 }}>
                  <input
                    autoFocus
                    value={urlInput}
                    onChange={e=>setUrlInput(e.target.value)}
                    onKeyDown={e=>{ if(e.key==='Enter') acceptUrl(urlInput); if(e.key==='Escape') setUrlMode(false) }}
                    placeholder="https://example.com/car.jpg"
                    style={{
                      flex:1, background:'var(--bg2)', border:`0.5px solid ${urlError?'var(--red)':'rgba(255,255,255,0.12)'}`,
                      borderRadius:8, padding:'7px 10px', color:'var(--text-primary)',
                      fontSize:11, outline:'none', fontFamily:"'IBM Plex Mono',monospace",
                    }}
                    onFocus={e=>e.target.style.borderColor='rgba(10,132,255,0.5)'}
                    onBlur={e=>e.target.style.borderColor=urlError?'var(--red)':'rgba(255,255,255,0.12)'}
                  />
                  <button onClick={()=>acceptUrl(urlInput)} style={{ padding:'0 10px', borderRadius:8, border:'none', cursor:'pointer', background:'var(--blue)', color:'#fff', fontSize:11, fontFamily:"'IBM Plex Sans',sans-serif" }}>Go</button>
                  <button onClick={()=>{setUrlMode(false);setUrlError('')}} style={{ padding:'0 8px', borderRadius:8, border:'0.5px solid var(--sep)', cursor:'pointer', background:'transparent', color:'var(--text-tertiary)', fontSize:11, fontFamily:"'IBM Plex Sans',sans-serif" }}>✕</button>
                </div>
                {urlError && <span style={{ fontSize:10, color:'var(--red)', fontFamily:"'IBM Plex Sans',sans-serif" }}>{urlError}</span>}
                {stage==='analyzing' && <span style={{ fontSize:10, color:'var(--blue)', fontFamily:"'IBM Plex Sans',sans-serif" }}>Fetching image…</span>}
              </div>
            ) : (
              <button onClick={()=>setUrlMode(true)} style={{
                width:'100%', height:32, borderRadius:8,
                border:'0.5px solid rgba(255,255,255,0.08)',
                background:'transparent', cursor:'pointer',
                color:'var(--text-quaternary)', fontSize:11,
                fontFamily:"'IBM Plex Sans',sans-serif",
                display:'flex', alignItems:'center', justifyContent:'center', gap:6,
                transition:'all 0.12s',
              }}
              onMouseEnter={e=>{e.currentTarget.style.background='var(--bg2)';e.currentTarget.style.color='var(--text-tertiary)'}}
              onMouseLeave={e=>{e.currentTarget.style.background='transparent';e.currentTarget.style.color='var(--text-quaternary)'}}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                Load from URL
              </button>
            )}
          </div>

          {file && (
            <div style={{ ...card, padding:'8px 12px', display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
              <span style={{ fontSize:11, color:'var(--text-tertiary)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1, fontFamily:"'IBM Plex Sans'" }}>{file.name}</span>
              <span style={{ fontSize:10, fontFamily:"'IBM Plex Mono'", color:'var(--text-quaternary)', marginLeft:8, flexShrink:0 }}>{(file.size/1024).toFixed(0)} KB</span>
            </div>
          )}

          <button onClick={run} disabled={!file||isRunning} style={{
            width:'100%', height:38, borderRadius:10, border:'none', marginBottom:14,
            background: !file||isRunning?'rgba(255,255,255,0.05)':'var(--blue)',
            color: !file||isRunning?'rgba(255,255,255,0.3)':'#fff',
            fontSize:13, fontWeight:600, cursor: !file||isRunning?'not-allowed':'pointer',
            display:'flex', alignItems:'center', justifyContent:'center', gap:6,
            fontFamily:"'IBM Plex Sans'", transition:'opacity 0.15s',
          }}>
            {stage==='analyzing' ? (
              <>
                <svg className="anim-spin" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2.5"><path d="M12 3a9 9 0 019 9"/></svg>
                Reading geometry…
              </>
            ) : stage==='refining' ? (
              <>
                <svg className="anim-spin" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2.5"><path d="M12 3a9 9 0 019 9"/></svg>
                AI enhancing…
              </>
            ) : (
              <>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                Analyse Vehicle
              </>
            )}
          </button>

          {error && (
            <div style={{ ...card, padding:'9px 12px', background:'rgba(255,69,58,0.08)', border:'0.5px solid rgba(255,69,58,0.3)', color:'var(--red)', fontSize:12, marginBottom:12, fontFamily:"'IBM Plex Sans'" }}>{error}</div>
          )}

          {geo && (
            <>
              {/* ── AI Identity Card ── */}
              {aiInsight && (
                <>
                  <div style={{ marginBottom:12, padding:'10px 12px', borderRadius:10, background:'rgba(10,132,255,0.07)', border:'0.5px solid rgba(10,132,255,0.2)', animation:'fadeIn 0.3s ease' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:8 }}>
                      <div style={{ width:6, height:6, borderRadius:'50%', background: aiInsight.isDatabase ? 'var(--green)' : 'var(--orange)', boxShadow: aiInsight.isDatabase ? '0 0 5px var(--green)' : '0 0 5px var(--orange)' }}/>
                      <span style={{ fontSize:9, fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase', color: aiInsight.isDatabase ? 'var(--green)' : 'var(--orange)' }}>
                        {aiInsight.isDatabase ? 'Database match' : 'AI estimate'}
                      </span>
                    </div>
                    <div style={{ fontSize:15, fontWeight:700, color:'var(--text-primary)', letterSpacing:'-0.3px', marginBottom:2 }}>
                      {aiInsight.make} {aiInsight.model}
                    </div>
                    {aiInsight.year && <div style={{ fontSize:11, color:'var(--text-tertiary)', marginBottom:6 }}>{aiInsight.year} · {aiInsight.color}</div>}
                    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
                      <span style={{ fontSize:22, fontWeight:700, color:'var(--blue)', fontFamily:"'IBM Plex Mono',monospace", letterSpacing:'-1px' }}>
                        {(aiInsight.cdDatabase ?? aiInsight.cdEstimate ?? 0.30).toFixed(3)}
                      </span>
                      <div>
                        <div style={{ fontSize:9, color:'var(--text-quaternary)', textTransform:'uppercase', letterSpacing:'0.06em' }}>Drag Coefficient</div>
                        <div style={{ fontSize:10, color: aiInsight.cdConfidence==='very_high'?'var(--green)':aiInsight.cdConfidence==='high'?'var(--blue)':'var(--orange)' }}>
                          {aiInsight.cdConfidence?.replace('_',' ')} confidence
                        </div>
                      </div>
                    </div>
                    {aiInsight.databaseMatch && (
                      <div style={{ fontSize:10, color:'var(--text-quaternary)', fontStyle:'italic', marginBottom:4 }}>
                        Matched: {aiInsight.databaseMatch}
                      </div>
                    )}
                    {/* Aero features */}
                    <div style={{ display:'flex', flexWrap:'wrap', gap:4, marginTop:6 }}>
                      {[
                        aiInsight.roofline && `${aiInsight.roofline} roof`,
                        aiInsight.rearDesign && `${aiInsight.rearDesign} rear`,
                        aiInsight.spoiler && aiInsight.spoiler!=='none' && `${aiInsight.spoiler} spoiler`,
                        aiInsight.diffuser && aiInsight.diffuser!=='none' && `${aiInsight.diffuser} diffuser`,
                        aiInsight.grille && `${aiInsight.grille} grille`,
                      ].filter(Boolean).map((feat, i) => (
                        <span key={i} style={{ fontSize:9, padding:'2px 7px', borderRadius:5, background:'rgba(255,255,255,0.06)', color:'var(--text-tertiary)' }}>
                          {feat}
                        </span>
                      ))}
                    </div>
                  </div>
                  {/* AI explanation */}
                  {aiInsight.explanation && (
                    <div style={{ marginBottom:12, padding:'10px 12px', borderRadius:10, background:'var(--bg1)', border:'0.5px solid rgba(255,255,255,0.06)' }}>
                      <div style={{ fontSize:9, fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase', color:'var(--text-quaternary)', marginBottom:6 }}>
                        Aero Analysis
                      </div>
                      <div style={{ fontSize:11, color:'var(--text-secondary)', lineHeight:1.6 }}>
                        {aiInsight.explanation?.slice(0, 320)}{aiInsight.explanation?.length > 320 ? '…' : ''}
                      </div>
                    </div>
                  )}
                  {/* AI improvement suggestions */}
                  {aiInsight.improvements?.length > 0 && (
                    <div style={{ marginBottom:12 }}>
                      <div style={{ fontSize:9, fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase', color:'var(--text-quaternary)', marginBottom:6 }}>
                        AI Suggestions
                      </div>
                      {aiInsight.improvements.map((s, i) => (
                        <div key={i} style={{ display:'flex', gap:7, marginBottom:5, padding:'6px 10px', borderRadius:8, background:'rgba(48,209,88,0.06)', border:'0.5px solid rgba(48,209,88,0.15)' }}>
                          <span style={{ fontSize:10, color:'var(--green)', flexShrink:0, marginTop:1 }}>→</span>
                          <span style={{ fontSize:11, color:'var(--text-secondary)', lineHeight:1.4 }}>{s}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Comparison cars */}
                  {aiInsight.comparisons?.length > 0 && (
                    <div style={{ marginBottom:12 }}>
                      <div style={{ fontSize:9, fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase', color:'var(--text-quaternary)', marginBottom:6 }}>
                        Similar Aero
                      </div>
                      {aiInsight.comparisons.slice(0,3).map((c, i) => (
                        <div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'5px 10px', borderRadius:7, marginBottom:3, background:'rgba(255,255,255,0.03)' }}>
                          <span style={{ fontSize:11, color:'var(--text-secondary)' }}>{c.name}</span>
                          <span style={{ fontSize:11, color:'var(--blue)', fontFamily:"'IBM Plex Mono',monospace" }}>Cd {c.cd?.toFixed(3)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              <SL n="02" t="Extracted"/>
              <div style={{ ...card, padding:'10px 12px', marginBottom:14 }}>
                {[['Type',geo.bodyType],['Aspect',geo.aspectRatio.toFixed(2)],['Hood',(geo.hoodRatio*100).toFixed(0)+'%'],['Cabin',(geo.cabinRatio*100).toFixed(0)+'%'],['Boot',(geo.bootRatio*100).toFixed(0)+'%'],['WS rake',geo.wsAngleDeg.toFixed(0)+'°'],['Rear drop',(geo.rearDrop*100).toFixed(0)+'%']].map(([k,v])=>(
                  <div key={k} style={{ display:'flex', justifyContent:'space-between', fontSize:11, padding:'3px 0', borderBottom:'0.5px solid rgba(255,255,255,0.04)' }}>
                    <span style={{ fontFamily:"'IBM Plex Mono'", color:'var(--text-quaternary)' }}>{k}</span>
                    <span style={{ fontFamily:"'IBM Plex Mono'", color:'var(--blue)' }}>{v}</span>
                  </div>
                ))}
                <div style={{ marginTop:8 }}>
                  <div style={{ display:'flex', justifyContent:'space-between', fontSize:10, fontFamily:"'IBM Plex Mono'", marginBottom:4 }}>
                    <span style={{ color:'var(--text-quaternary)' }}>confidence</span>
                    <span style={{ color:'var(--blue)' }}>{(geo.confidence*100).toFixed(0)}%</span>
                  </div>
                  <div style={{ height:3, borderRadius:2, background:'var(--bg3)', overflow:'hidden' }}>
                    <div style={{ height:'100%', borderRadius:2, width:`${geo.confidence*100}%`, background:geo.confidence>0.7?'var(--green)':geo.confidence>0.4?'var(--orange)':'var(--red)', transition:'width 0.5s' }}/>
                  </div>
                </div>
                <div style={{ marginTop:8 }}>
                  <div style={{ fontSize:8, fontFamily:"'IBM Plex Mono'", color:'var(--text-quaternary)', marginBottom:3 }}>VERTICAL EDGE DENSITY</div>
                  <ZoneBar zones={geo._zones}/>
                </div>
              </div>

              <SL n="03" t="Drag"/>
              <div style={{ ...card, padding:'14px', display:'flex', flexDirection:'column', alignItems:'center', marginBottom:14 }}>
                <CdGauge cd={cd}/>
                <div style={{ fontSize:10, fontFamily:"'IBM Plex Mono'", color:'var(--text-quaternary)', marginTop:5 }}>estimated · {geo.bodyType}</div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Centre panel ── */}
      <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>

        {/* Toolbar */}
        <div style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 12px', borderBottom:'0.5px solid var(--sep)', flexShrink:0, background:'rgba(0,0,0,0.4)', flexWrap:'wrap' }}>
          {/* View tabs */}
          <div style={{ display:'flex', gap:2 }}>
            {VIEWS.map(v=>(
              <button key={v.id} onClick={()=>setActiveView(v.id)} style={{
                padding:'4px 12px', borderRadius:7, border:'none', cursor:'pointer',
                background: activeView===v.id?'rgba(10,132,255,0.18)':'transparent',
                color: activeView===v.id?'var(--blue)':'rgba(255,255,255,0.38)',
                fontSize:12, fontWeight: activeView===v.id?600:400,
                transition:'background 0.12s, color 0.12s',
                fontFamily:"'IBM Plex Sans'",
              }}>{v.label}</button>
            ))}
          </div>

          {/* Separator */}
          <div style={{ width:0.5, height:14, background:'var(--sep)' }}/>

          {/* Overlays */}
          <div style={{ display:'flex', gap:5 }}>
            {toggleBtn('Cp', cpOn, setCpOn)}
            {toggleBtn('Sep', showSep, setShowSep)}
            {toggleBtn('Iso', showIso, setShowIso)}
            {toggleBtn('Ground', showGE, setShowGE)}
          </div>

          {/* Yaw — only on top view */}
          {geo && activeView==='top' && (
            <div style={{ display:'flex', alignItems:'center', gap:8, marginLeft:4 }}>
              <span style={{ fontSize:11, color:'var(--text-tertiary)', fontFamily:"'IBM Plex Sans'" }}>Yaw</span>
              <div style={{ position:'relative', width:72, height:18, display:'flex', alignItems:'center' }}>
                <div style={{ position:'absolute', left:0, right:0, height:2, borderRadius:9999, background:'var(--bg3)' }}>
                  <div style={{ position:'absolute', left:'50%', top:0, height:'100%', width:`${Math.abs(yawAngle)/15*50}%`, background:'var(--blue)', borderRadius:9999, transform: yawAngle>=0?'none':'translateX(-100%)' }}/>
                </div>
                <input type="range" min={-15} max={15} value={yawAngle} onChange={e=>setYawAngle(Number(e.target.value))} style={{ position:'absolute', inset:0, width:'100%', opacity:0, cursor:'pointer', zIndex:2 }}/>
                <div style={{ position:'absolute', top:'50%', transform:'translate(-50%,-50%)', left:`${((yawAngle+15)/30)*100}%`, width:14, height:14, borderRadius:'50%', background:'#fff', boxShadow:'0 1px 5px rgba(0,0,0,0.5)', pointerEvents:'none', zIndex:1 }}/>
              </div>
              <span style={{ fontSize:11, fontWeight:600, color:'var(--blue)', fontFamily:"'IBM Plex Mono'", width:28, textAlign:'right' }}>{yawAngle>0?'+':''}{yawAngle}°</span>
            </div>
          )}

          {/* Export */}
          <button onClick={exportSVG} style={{
            marginLeft:'auto', padding:'4px 12px', borderRadius:7,
            border:'0.5px solid var(--sep)', background:'transparent',
            color:'var(--text-tertiary)', fontSize:11, cursor:'pointer',
            fontFamily:"'IBM Plex Sans'", transition:'all 0.12s',
          }}
            onMouseEnter={e=>{e.currentTarget.style.borderColor='rgba(10,132,255,0.4)';e.currentTarget.style.color='var(--blue)'}}
            onMouseLeave={e=>{e.currentTarget.style.borderColor='var(--sep)';e.currentTarget.style.color='rgba(255,255,255,0.38)'}}>
            Export SVG
          </button>
        </div>

        {/* Canvas area */}
        <div ref={svgRef} style={{ flex:1, display:'flex', flexDirection:'column', padding:'14px', gap:12, overflow:'hidden', background:'#030608' }}>
          {!geo ? (
            <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:20 }}>
              <div style={{ width:64, height:64, borderRadius:16, background:'var(--bg1)', border:'0.5px solid var(--sep)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5">
                  <path d="M2 12c0-5.5 4.5-10 10-10s10 4.5 10 10-4.5 10-10 10S2 17.5 2 12z"/><path d="M12 8v4l3 3"/>
                </svg>
              </div>
              <div style={{ textAlign:'center', maxWidth:440 }}>
                <div style={{ fontSize:15, fontWeight:600, color:'var(--text-secondary)', marginBottom:8, letterSpacing:'-0.3px' }}>Canvas Vehicle Analysis</div>
                <div style={{ fontSize:12, color:'var(--text-quaternary)', lineHeight:1.7 }}>
                  Upload any vehicle photo. Sobel edge detection extracts the silhouette, vertical edge density maps pillar positions, roofline fitting measures slope and rake — then 4 orthographic CFD views are rendered with physics-based Cp field.
                </div>
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap', justifyContent:'center' }}>
                {['Sobel','Silhouette','Roofline','Pillars','Classify','Cp field','4-view'].map((s,i,a)=>(
                  <span key={i} style={{ display:'flex', alignItems:'center', gap:5 }}>
                    <span style={{ padding:'3px 10px', borderRadius:6, border:'0.5px solid var(--sep)', fontSize:10, fontFamily:"'IBM Plex Mono'", color:'var(--text-quaternary)', background:'var(--bg1)' }}>{s}</span>
                    {i<a.length-1&&<span style={{ fontSize:10, color:'var(--text-quaternary)' }}>→</span>}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <>
              {/* Main view */}
              <div style={{ flex:1, ...card, display:'flex', alignItems:'center', justifyContent:'center', padding:'12px', overflow:'hidden' }}>
                <div style={{ width:'100%', height:'100%', maxHeight:295 }}>
                  {activeView==='side'  && <SideView  g={geo} cpOn={cpOn} showSep={showSep} showIso={showIso}/>}
                  {activeView==='front' && <FrontView g={geo} cpOn={cpOn}/>}
                  {activeView==='top'   && <TopView   g={geo} yawAngle={yawAngle}/>}
                  {activeView==='under' && <UnderView g={geo} showGroundEffect={showGE}/>}
                </div>
              </div>
              {/* Thumbnail strip */}
              <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:8, flexShrink:0 }}>
                {VIEWS.map(v=>(
                  <button key={v.id} onClick={()=>setActiveView(v.id)} style={{
                    borderRadius:10, border:`0.5px solid ${activeView===v.id?'rgba(10,132,255,0.45)':'rgba(255,255,255,0.06)'}`,
                    background: activeView===v.id?'rgba(10,132,255,0.1)':'var(--bg1)',
                    overflow:'hidden', cursor:'pointer', padding:4,
                    transition:'border-color 0.15s, background 0.15s',
                  }}>
                    <div style={{ width:'100%', aspectRatio:'5/3', pointerEvents:'none' }}>
                      {v.id==='side'  && <SideView  g={geo} cpOn={cpOn} showSep={false} showIso={false}/>}
                      {v.id==='front' && <FrontView g={geo} cpOn={cpOn}/>}
                      {v.id==='top'   && <TopView   g={geo} yawAngle={0}/>}
                      {v.id==='under' && <UnderView g={geo} showGroundEffect={false}/>}
                    </div>
                    <div style={{ fontSize:10, color: activeView===v.id?'var(--blue)':'rgba(255,255,255,0.3)', textAlign:'center', padding:'3px 0', fontFamily:"'IBM Plex Sans'", fontWeight: activeView===v.id?600:400 }}>{v.label}</div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Right panel ── */}
      <div style={{ width:260, flexShrink:0, borderLeft:'0.5px solid var(--sep)', overflowY:'auto', padding:'16px 14px', background:'var(--bg0)' }}>
        {geo ? (
          <>
            <SL n="04" t="Benchmark"/>
            <div style={{ ...card, padding:'12px', marginBottom:14 }}>
              <BenchmarkBar cd={cd}/>
              <div style={{ display:'flex', flexDirection:'column', gap:5, marginTop:4 }}>
                {BENCHMARKS.map((b,i)=>{const diff=cd-b.Cd,clr=diff<=0?'var(--green)':'var(--orange)';return(
                  <div key={i} style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <div style={{ width:`${((b.Cd-0.20)/0.24)*50}%`, height:3, borderRadius:2, background:b.Cd<0.26?'var(--green)':b.Cd<0.30?'var(--blue)':b.Cd<0.34?'var(--orange)':'var(--red)', flexShrink:0 }}/>
                    <span style={{ fontSize:10, fontFamily:"'IBM Plex Mono'", color:'var(--blue)', width:28, flexShrink:0 }}>{b.Cd.toFixed(2)}</span>
                    <span style={{ fontSize:10, color:'var(--text-tertiary)', flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{b.name}</span>
                    <span style={{ fontSize:10, fontFamily:"'IBM Plex Mono'", color:clr, flexShrink:0 }}>{diff>0?'+':''}{diff.toFixed(3)}</span>
                  </div>
                )})}
              </div>
            </div>

            <SL n="05" t="Drag Breakdown"/>
            <div style={{ ...card, padding:'10px', marginBottom:14 }}>
              <DragDonut breakdown={breakdown}/>
            </div>

            <SL n="06" t="Aero Forces"/>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:14 }}>
              {[['Front Lift','CL_f',(cd*0.06).toFixed(3),'var(--teal)'],['Rear Lift','CL_r',(-cd*0.02).toFixed(3),'var(--green)'],['Side Force','Cs','0.000','var(--yellow)'],['Drag Force','F_d',(cd*0.5*1.225*40*40*2.4).toFixed(0)+'N','var(--red)']].map(([name,sym,val,clr])=>(
                <div key={name} style={{ background:'var(--bg1)', borderRadius:10, border:'0.5px solid rgba(255,255,255,0.06)', padding:'10px 12px' }}>
                  <div style={{ fontSize:9, fontFamily:"'IBM Plex Mono'", color:'var(--text-quaternary)', marginBottom:5 }}>{name}</div>
                  <div style={{ fontSize:15, fontFamily:"'IBM Plex Mono'", color:clr, fontWeight:600, fontVariantNumeric:'tabular-nums' }}>{val}</div>
                  <div style={{ fontSize:9, fontFamily:"'IBM Plex Mono'", color:'var(--text-quaternary)', marginTop:2 }}>{sym}</div>
                </div>
              ))}
            </div>

            <SL n="07" t="Optimise"/>
            <div style={{ ...card, padding:'12px', marginBottom:14 }}>
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                {suggestions.map((s,i)=>(
                  <div key={i} style={{ display:'flex', gap:8, alignItems:'flex-start' }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth="2.5" style={{ flexShrink:0, marginTop:1 }}>
                      <polyline points="9 18 15 12 9 6"/>
                    </svg>
                    <span style={{ fontSize:12, color:'var(--text-secondary)', lineHeight:1.5 }}>{s}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:10, padding:'40px 0', textAlign:'center' }}>
            <div style={{ width:48, height:48, borderRadius:12, background:'var(--bg1)', border:'0.5px solid var(--sep)', display:'flex', alignItems:'center', justifyContent:'center' }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5">
                <rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9 9h6M9 12h6M9 15h4"/>
              </svg>
            </div>
            <div style={{ fontSize:12, color:'var(--text-quaternary)' }}>Upload and analyse a vehicle to see results</div>
          </div>
        )}
      </div>
    </div>
  )
}
