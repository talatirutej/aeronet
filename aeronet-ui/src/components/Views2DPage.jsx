// Copyright (c) 2026 Rutej Talati. All rights reserved.

import { useCallback, useRef, useState } from 'react'

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
function SideView({g,cpOn,showSep,showIso}){const W=620,H=240,PAD=32;const bLen=W-PAD*2,rideH=bLen*0.055*(g.rideH>0.12?1.8:1.0),bH=H*0.52,gY=H-18,sill=gY-rideH,roofY=sill-bH;const x=f=>PAD+f*bLen;const hx=x(g.hoodRatio),chx=x(g.hoodRatio+g.cabinRatio),rX=x(1.0);const wsH=bH*g.cabinH,wsRad=(90-g.wsAngleDeg)*Math.PI/180,wsRun=wsH/Math.tan(Math.max(0.1,wsRad));const aTx=hx+wsRun,aBy=sill-bH*0.74,hoodY=sill-bH*0.50,cowlY=sill-bH*0.72,roofMidX=(aTx+chx)*0.50,sag=g.bodyType==='suv'?bH*0.01:g.bodyType==='estate'?0:bH*0.015;const bt=g.bodyType;let rearSVG='';if(bt==='fastback'||bt==='coupe'){const c1=x(g.hoodRatio+g.cabinRatio*0.82),c2=x(g.hoodRatio+g.cabinRatio*1.05);rearSVG=[`Q ${c1} ${roofY+sag} ${chx+8} ${roofY+bH*0.10}`,`C ${c2} ${sill-bH*0.38} ${rX-10} ${sill-bH*0.28} ${rX} ${sill-bH*0.18}`].join(' ')}else if(bt==='notchback'){const deckY=sill-bH*0.56;rearSVG=[`L ${chx} ${roofY+sag}`,`L ${x(g.hoodRatio+g.cabinRatio+0.02)} ${roofY+sag}`,`Q ${rX-14} ${roofY+sag+4} ${rX} ${deckY}`,`L ${rX} ${sill-bH*0.18}`].join(' ')}else if(bt==='estate'){rearSVG=[`L ${chx} ${roofY+sag}`,`Q ${rX-5} ${roofY+sag+3} ${rX} ${sill-bH*0.18}`].join(' ')}else if(bt==='suv'){rearSVG=[`L ${chx} ${roofY+sag}`,`Q ${rX-10} ${roofY+sag+8} ${rX} ${sill-bH*0.20}`].join(' ')}else if(bt==='pickup'){const bedTopY=sill-bH*0.52;rearSVG=[`L ${chx} ${roofY+sag}`,`L ${chx} ${bedTopY}`,`L ${rX-5} ${bedTopY}`,`Q ${rX} ${bedTopY} ${rX} ${sill-bH*0.14}`].join(' ')}else{rearSVG=[`Q ${chx+14} ${roofY+bH*0.10} ${rX-18} ${sill-bH*0.40}`,`Q ${rX} ${sill-bH*0.32} ${rX} ${sill-bH*0.16}`].join(' ')}
const bodyPath=[`M ${x(0.03)} ${gY-1}`,`C ${PAD+2} ${sill+4} ${PAD} ${sill-bH*0.18} ${PAD} ${sill-bH*0.32}`,`L ${PAD} ${sill-bH*0.47}`,`Q ${x(0.04)} ${hoodY-bH*0.03} ${x(0.10)} ${hoodY}`,`Q ${x(0.22)} ${hoodY} ${hx} ${cowlY}`,`L ${aTx} ${roofY}`,`Q ${roofMidX} ${roofY-sag} ${chx} ${roofY+sag}`,rearSVG,`L ${rX} ${sill}`,`Q ${rX-3} ${sill+2} ${rX-bLen*0.055} ${gY-1}`,`L ${x(0.03)} ${gY-1}`,'Z'].join(' ')
const dloPath=(()=>{const dloFrontY=aBy,dloRoofL=roofY+3,dloRoofR=roofY+sag+3;let rear='';if(bt==='fastback'||bt==='coupe')rear=`Q ${chx+8} ${roofY+bH*0.14} ${chx+26} ${dloFrontY+bH*0.10}`;else if(bt==='notchback')rear=`L ${chx-4} ${dloFrontY+2}`;else if(bt==='hatchback')rear=`Q ${chx+10} ${roofY+bH*0.12} ${chx+16} ${dloFrontY+4}`;else rear=`L ${chx-4} ${dloFrontY+2}`;return[`M ${hx+5} ${dloFrontY}`,`L ${aTx+3} ${dloRoofL}`,`Q ${roofMidX} ${dloRoofL} ${chx-4} ${dloRoofR}`,rear,`L ${hx+5} ${dloFrontY}`,'Z'].join(' ')})()
const wR=bH*(bt==='suv'||bt==='pickup'?0.210:0.178),w1x=x(g.w1),w2x=x(g.w2),wY=gY-wR
const N=20,cpBands=Array.from({length:N},(_,i)=>{const tM=(i+0.5)/N;return{x0:x(i/N),x1:x((i+1)/N)+1,color:cpToRgb(cpAtPoint(tM,0.65,tM<0.15,g.Cd))}})
const sepX=bt==='fastback'?x(g.hoodRatio+g.cabinRatio*0.88):x(g.hoodRatio+g.cabinRatio),sepY=bt==='fastback'?roofY+bH*0.08:roofY+sag
return(<svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',height:'100%'}} preserveAspectRatio="xMidYMid meet"><defs><clipPath id="sc"><path d={bodyPath}/></clipPath><linearGradient id="edgeHi" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="rgba(255,255,255,0.14)"/><stop offset="40%" stopColor="rgba(255,255,255,0.02)"/><stop offset="100%" stopColor="rgba(0,0,0,0.22)"/></linearGradient><linearGradient id="cpBar" x1="0" y1="1" x2="0" y2="0"><stop offset="0%" stopColor="#2147d9"/><stop offset="25%" stopColor="#22d3ee"/><stop offset="50%" stopColor="#84cc16"/><stop offset="75%" stopColor="#fbbf24"/><stop offset="100%" stopColor="#ef4444"/></linearGradient><filter id="sep"><feGaussianBlur stdDeviation="1.2"/></filter></defs><ellipse cx={W/2} cy={gY+6} rx={bLen*0.43} ry={8} fill="rgba(0,0,0,0.4)"/><line x1={6} y1={gY} x2={W-6} y2={gY} stroke="rgba(255,255,255,0.06)" strokeWidth="1.5"/>{cpOn&&<g clipPath="url(#sc)">{cpBands.map((b,i)=><rect key={i} x={b.x0} y={roofY-20} width={b.x1-b.x0} height={bH+rideH+30} fill={b.color}/>)}</g>}<path d={bodyPath} fill={cpOn?'rgba(5,10,18,0.24)':'#111E28'} stroke="rgba(10,132,255,0.65)" strokeWidth={cpOn?0.75:1.1}/><path d={bodyPath} fill="url(#edgeHi)"/><path d={dloPath} fill={cpOn?'rgba(10,132,255,0.16)':'rgba(10,132,255,0.10)'} stroke="rgba(10,132,255,0.55)" strokeWidth="0.85"/><path d={dloPath} fill="rgba(0,14,30,0.40)"/>{bt!=='pickup'&&bt!=='fastback'&&bt!=='coupe'&&<line x1={x(g.hoodRatio+g.cabinRatio*0.46)} y1={aBy} x2={x(g.hoodRatio+g.cabinRatio*0.46)} y2={sill} stroke="rgba(0,0,0,0.6)" strokeWidth="3.5"/>}<path d={`M ${hx+9} ${aBy-2} L ${hx+28} ${aBy-9} L ${hx+28} ${aBy+3} Z`} fill="#0A1620" stroke="rgba(10,132,255,0.25)" strokeWidth="0.7"/><rect x={PAD+2} y={sill-bH*0.44} width={5} height={bH*0.065} rx="1.5" fill="rgba(255,255,200,0.90)"/><rect x={rX-4} y={sill-bH*(bt==='fastback'||bt==='coupe'?0.30:0.22)} width={5} height={bH*0.14} rx="1.5" fill="rgba(255,69,58,0.90)"/>{showSep&&<g><circle cx={sepX} cy={sepY} r={5} fill="rgba(255,214,10,0.2)" filter="url(#sep)"/><circle cx={sepX} cy={sepY} r={2.5} fill="#FFD60A" opacity={0.8}/>{[0,40,80,120,160,200,240,280,320].map(a=>{const r2=a*Math.PI/180,len=a<90||a>270?10:6;return<line key={a} x1={sepX+Math.cos(r2)*2.5} y1={sepY+Math.sin(r2)*2.5} x2={sepX+Math.cos(r2)*(2.5+len)} y2={sepY+Math.sin(r2)*(2.5+len)} stroke="#FFD60A" strokeWidth="0.7" opacity={0.5}/>})}<text x={sepX+8} y={sepY-6} fill="#FFD60A" fontSize="7" fontFamily="'IBM Plex Mono',monospace">SEP</text></g>}{cpOn&&[0.28,0.52,0.76].map((fh,i)=>{const ay=sill-bH*fh;return<g key={i} transform={`translate(${PAD-24},${ay})`}><line x1={0} y1={0} x2={14} y2={0} stroke="rgba(10,132,255,0.55)" strokeWidth="1.1"/><polygon points="16,0 10,-3.5 10,3.5" fill="rgba(10,132,255,0.55)"/></g>})}{cpOn&&<g opacity={0.4}>{[0.15,0.30,0.45].map((d,i)=><ellipse key={i} cx={rX+10+d*30} cy={sill-bH*0.28} rx={4+d*12} ry={3+d*8} fill="none" stroke="#2147d9" strokeWidth="0.8" strokeDasharray="3,3"/>)}</g>}{[[w1x,wY],[w2x,wY]].map(([cx,cy],i)=><g key={i}><circle cx={cx} cy={cy} r={wR+3} fill="rgba(0,0,0,0.35)"/><circle cx={cx} cy={cy} r={wR} fill="#060C14" stroke="#1E3040" strokeWidth="2.6"/><circle cx={cx} cy={cy} r={wR*0.74} fill="#0C1824" stroke="#162C38" strokeWidth="1.5"/>{[0,72,144,216,288].map(a=>{const r2=a*Math.PI/180;return<path key={a} d={`M ${cx+Math.cos(r2)*wR*0.25} ${cy+Math.sin(r2)*wR*0.25} L ${cx+Math.cos(r2+0.22)*wR*0.70} ${cy+Math.sin(r2+0.22)*wR*0.70} Q ${cx+Math.cos(r2)*wR*0.73} ${cy+Math.sin(r2)*wR*0.73} ${cx+Math.cos(r2-0.22)*wR*0.70} ${cy+Math.sin(r2-0.22)*wR*0.70} Z`} fill="#162434" stroke="#1E3040" strokeWidth="0.8"/>})}<circle cx={cx} cy={cy} r={wR*0.15} fill="#1E3040"/><circle cx={cx} cy={cy} r={wR*0.42} fill="none" stroke="#162434" strokeWidth="0.6" strokeDasharray="4,4"/></g>)}{[[w1x,wY],[w2x,wY]].map(([cx,cy],i)=><circle key={i} cx={cx} cy={cy} r={wR+3} fill="none" stroke="#060C14" strokeWidth="5.5"/>)}{cpOn&&<><rect x={W-16} y={H*0.13} width={10} height={H*0.62} rx="2" fill="url(#cpBar)"/><text x={W-22} y={H*0.13+5} textAnchor="end" fill="rgba(255,255,255,0.25)" fontSize="7" fontFamily="'IBM Plex Mono',monospace">+1.0</text><text x={W-22} y={H*0.75+5} textAnchor="end" fill="rgba(255,255,255,0.25)" fontSize="7" fontFamily="'IBM Plex Mono',monospace">−1.5</text></>}<text x={W/2} y={H-3} textAnchor="middle" fill="rgba(255,255,255,0.15)" fontSize="9" fontFamily="'IBM Plex Mono',monospace" letterSpacing="0.12em">SIDE · {g.bodyType.toUpperCase()} · Cd {g.Cd.toFixed(3)} · WS {g.wsAngleDeg.toFixed(0)}°</text></svg>)}

function FrontView({g,cpOn}){const W=320,H=230,cx=W/2,gY=H-14;const isTall=g.bodyType==='suv'||g.bodyType==='pickup',isFast=g.bodyType==='fastback'||g.bodyType==='coupe';const bh=isTall?112:isFast?84:96,bw=isTall?110:isFast?94:98;const rideHpx=bh*(g.rideH>0.12?0.18:0.08),bodyBot=gY-rideHpx,bodyTop=bodyBot-bh;const shoulderFrac=0.55,roofHW=bw*(isFast?0.34:isTall?0.42:0.38),shoulderHW=bw*0.50,sillHW=bw*0.46;const roofY=bodyTop,shoulderY=bodyTop+bh*shoulderFrac,sillY=bodyTop+bh*0.92;const bodyL=[`M ${cx} ${roofY}`,`C ${cx-roofHW*0.6} ${roofY} ${cx-shoulderHW} ${shoulderY-bh*0.22} ${cx-shoulderHW} ${shoulderY}`,`C ${cx-shoulderHW} ${shoulderY+bh*0.12} ${cx-sillHW} ${sillY} ${cx-sillHW*0.80} ${bodyBot}`];const bodyR=[`L ${cx+sillHW*0.80} ${bodyBot}`,`C ${cx+sillHW} ${sillY} ${cx+shoulderHW} ${shoulderY+bh*0.12} ${cx+shoulderHW} ${shoulderY}`,`C ${cx+shoulderHW} ${shoulderY-bh*0.22} ${cx+roofHW*0.6} ${roofY} ${cx} ${roofY}`];const frontPath=[...bodyL,...bodyR,'Z'].join(' ');const aPillarBaseY=bodyTop+bh*0.55,aPillarTopY=bodyTop+bh*0.08,wsInset=4,aPillarBaseHW=shoulderHW*0.88-wsInset,aPillarTopHW=roofHW*0.90+wsInset;const wscPath=[`M ${cx-aPillarTopHW} ${aPillarTopY}`,`Q ${cx-aPillarTopHW*0.96} ${aPillarTopY-2} ${cx} ${aPillarTopY}`,`Q ${cx+aPillarTopHW*0.96} ${aPillarTopY-2} ${cx+aPillarTopHW} ${aPillarTopY}`,`L ${cx+aPillarBaseHW} ${aPillarBaseY}`,`L ${cx-aPillarBaseHW} ${aPillarBaseY}`,'Z'].join(' ');const hlY=bodyTop+bh*0.27,hlHW=shoulderHW*0.72,hlIW=shoulderHW*0.30;const wR=16+(isTall?4:0),w1x=cx-shoulderHW*1.05,w2x=cx+shoulderHW*1.05,wY=gY-wR;const cpBands=Array.from({length:11},(_,i)=>{const f=i/10,d=Math.abs(f-0.5)*2;const cp=(0.85*(1-d*d)-0.25)*(g.Cd/0.30);return{xL:cx-shoulderHW*(1-i*0.18),color:cpToRgb(cp)}});
return(<svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',height:'100%'}} preserveAspectRatio="xMidYMid meet"><defs><clipPath id="fclip"><path d={frontPath}/></clipPath></defs><ellipse cx={cx} cy={gY+5} rx={shoulderHW*1.2} ry={7} fill="rgba(0,0,0,0.4)"/><line x1={12} y1={gY} x2={W-12} y2={gY} stroke="rgba(255,255,255,0.06)" strokeWidth="1.5"/>{cpOn&&<g clipPath="url(#fclip)">{cpBands.map((b,i)=><rect key={i} x={b.xL} y={bodyTop-4} width={(shoulderHW*2)/10+2} height={bh+8} fill={b.color} opacity={0.85}/>)}</g>}<path d={frontPath} fill={cpOn?'rgba(5,10,18,0.28)':'#111E28'} stroke="rgba(10,132,255,0.6)" strokeWidth="0.95"/><path d={wscPath} fill="rgba(10,132,255,0.08)" stroke="rgba(10,132,255,0.55)" strokeWidth="0.9"/><path d={wscPath} fill="rgba(0,14,28,0.45)"/>{[-1,1].map(s=><path key={s} d={`M ${cx+s*aPillarTopHW} ${aPillarTopY} L ${cx+s*aPillarBaseHW} ${aPillarBaseY}`} stroke="rgba(0,0,0,0.5)" strokeWidth="4" strokeLinecap="round"/>)}{[-1,1].map(s=><g key={s}><path d={`M ${cx+s*hlIW} ${hlY-bh*0.04} Q ${cx+s*(hlIW+hlHW)/2} ${hlY-bh*0.06} ${cx+s*hlHW} ${hlY}`} stroke="rgba(255,255,200,0.7)" strokeWidth="2" fill="none" strokeLinecap="round"/><path d={`M ${cx+s*hlIW} ${hlY-bh*0.025} Q ${cx+s*(hlIW+hlHW)/2} ${hlY-bh*0.05} ${cx+s*hlHW} ${hlY} L ${cx+s*hlHW} ${hlY+bh*0.058} Q ${cx+s*(hlIW+hlHW)/2} ${hlY+bh*0.07} ${cx+s*hlIW} ${hlY+bh*0.055} Z`} fill="rgba(255,255,200,0.06)" stroke="rgba(10,132,255,0.5)" strokeWidth="0.8"/><circle cx={cx+s*(hlIW+hlHW)*0.58} cy={hlY+bh*0.028} r={bh*0.022} fill="rgba(255,255,220,0.85)"/></g>)}<path d={`M ${cx-shoulderHW*0.48} ${bodyTop+bh*0.50} L ${cx-shoulderHW*0.48} ${bodyTop+bh*0.70} L ${cx+shoulderHW*0.48} ${bodyTop+bh*0.70} L ${cx+shoulderHW*0.48} ${bodyTop+bh*0.50} Z`} fill="rgba(0,0,0,0.65)" stroke="rgba(255,255,255,0.06)" strokeWidth="0.9" rx="3"/>{[0,1,2,3,4].map(i=><line key={i} x1={cx-shoulderHW*0.46} y1={bodyTop+bh*(0.52+i*0.038)} x2={cx+shoulderHW*0.46} y2={bodyTop+bh*(0.52+i*0.038)} stroke="rgba(255,255,255,0.04)" strokeWidth="0.7"/>)}<rect x={cx-shoulderHW*0.12} y={bodyTop+bh*0.56} width={shoulderHW*0.24} height={bh*0.04} rx="2" fill="rgba(10,132,255,0.12)" stroke="rgba(10,132,255,0.2)" strokeWidth="0.6"/><rect x={cx-shoulderHW*0.68} y={bodyTop+bh*0.76} width={shoulderHW*1.36} height={bh*0.10} rx="2" fill="rgba(0,0,0,0.50)" stroke="rgba(255,255,255,0.06)" strokeWidth="0.8"/>{[-1,1].map(s=><ellipse key={s} cx={cx+s*shoulderHW*0.55} cy={bodyTop+bh*0.81} rx={shoulderHW*0.10} ry={bh*0.035} fill="rgba(255,255,200,0.06)" stroke="rgba(255,255,255,0.08)" strokeWidth="0.7"/>)}<rect x={cx-sillHW*0.95} y={bodyBot-bh*0.05} width={sillHW*1.90} height={bh*0.03} rx="1" fill="#0A1820" stroke="rgba(255,255,255,0.06)" strokeWidth="0.7"/><rect x={cx-shoulderHW*0.28} y={bodyTop+bh*0.85} width={shoulderHW*0.56} height={bh*0.08} rx="2" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.08)" strokeWidth="0.7"/>{[[w1x,wY],[w2x,wY]].map(([wcx,wcy],i)=><g key={i}><circle cx={wcx} cy={wcy} r={wR} fill="#060C14" stroke="#1E3040" strokeWidth="2.5"/><circle cx={wcx} cy={wcy} r={wR*0.72} fill="#0C1C28" stroke="#162C38" strokeWidth="1.4"/>{[0,72,144,216,288].map(a=>{const r2=a*Math.PI/180;return<path key={a} d={`M ${wcx+Math.cos(r2)*wR*0.24} ${wcy+Math.sin(r2)*wR*0.24} L ${wcx+Math.cos(r2+0.25)*wR*0.68} ${wcy+Math.sin(r2+0.25)*wR*0.68} Q ${wcx+Math.cos(r2)*wR*0.72} ${wcy+Math.sin(r2)*wR*0.72} ${wcx+Math.cos(r2-0.25)*wR*0.68} ${wcy+Math.sin(r2-0.25)*wR*0.68} Z`} fill="#162838" stroke="#1E3040" strokeWidth="0.8"/>})}<circle cx={wcx} cy={wcy} r={wR*0.15} fill="#1E3040"/></g>)}<text x={cx} y={H-3} textAnchor="middle" fill="rgba(255,255,255,0.15)" fontSize="9" fontFamily="'IBM Plex Mono',monospace" letterSpacing="0.12em">FRONT · {g.bodyType.toUpperCase()}</text></svg>)}

function TopView({g,yawAngle}){const W=320,H=230,cx=W/2,cy=H/2+6;const isTall=g.bodyType==='suv'||g.bodyType==='pickup';const bw=isTall?78:70,bl=g.bodyType==='pickup'?172:g.bodyType==='estate'?164:156;const yawRad=(yawAngle??0)*Math.PI/180,frontSteerOffset=Math.sin(yawRad)*bw*0.28;const body=[`M ${cx} ${cy-bl/2+5}`,`Q ${cx-bw*0.26} ${cy-bl/2+1} ${cx-bw*0.50} ${cy-bl/2+20}`,`Q ${cx-bw*0.52} ${cy-bl/2+50} ${cx-bw*0.52} ${cy}`,`Q ${cx-bw*0.52} ${cy+bl*0.14} ${cx-bw*0.50} ${cy+bl/2-14}`,`Q ${cx-bw*0.44} ${cy+bl/2-4} ${cx} ${cy+bl/2-4}`,`Q ${cx+bw*0.44} ${cy+bl/2-4} ${cx+bw*0.50} ${cy+bl/2-14}`,`Q ${cx+bw*0.52} ${cy+bl*0.14} ${cx+bw*0.52} ${cy}`,`Q ${cx+bw*0.52} ${cy-bl/2+50} ${cx+bw*0.50} ${cy-bl/2+20}`,`Q ${cx+bw*0.26} ${cy-bl/2+1} ${cx} ${cy-bl/2+5}`,'Z'].join(' ');const ghFront=cy+bl*(g.hoodRatio-0.50),ghRear=cy+bl*(g.hoodRatio+g.cabinRatio-0.50),ghW=bw*(g.bodyType==='fastback'||g.bodyType==='coupe'?0.40:isTall?0.44:0.42);const ghPath=[`M ${cx} ${ghFront-4}`,`Q ${cx-ghW*0.52} ${ghFront+2} ${cx-ghW*0.54} ${ghFront+18}`,`L ${cx-ghW*0.54} ${ghRear-12}`,`Q ${cx-ghW*0.46} ${ghRear} ${cx} ${ghRear}`,`Q ${cx+ghW*0.46} ${ghRear} ${cx+ghW*0.54} ${ghRear-12}`,`L ${cx+ghW*0.54} ${ghFront+18}`,`Q ${cx+ghW*0.52} ${ghFront+2} ${cx} ${ghFront-4}`,'Z'].join(' ');const fwy=cy+bl*(g.w1-0.50),rwy=cy+bl*(g.w2-0.50);const N=14,cpS=Array.from({length:N},(_,i)=>{const tM=(i+0.5)/N;return{y0:cy-bl/2+5+i*(bl-9)/N,y1:cy-bl/2+5+(i+1)*(bl-9)/N,c:cpToRgb(cpAtPoint(tM,0.70,tM<0.15,g.Cd))}});
return(<svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',height:'100%'}} preserveAspectRatio="xMidYMid meet"><defs><clipPath id="tc2"><path d={body}/></clipPath></defs><g clipPath="url(#tc2)">{cpS.map((s,i)=><rect key={i} x={cx-bw*0.60} y={s.y0} width={bw*1.20} height={s.y1-s.y0+1} fill={s.c} opacity={0.78}/>)}</g><path d={body} fill="rgba(5,10,18,0.28)" stroke="rgba(10,132,255,0.6)" strokeWidth="0.9"/><path d={ghPath} fill="rgba(10,132,255,0.08)" stroke="rgba(10,132,255,0.5)" strokeWidth="0.8"/><path d={ghPath} fill="rgba(0,14,28,0.38)"/><line x1={cx-ghW*0.48} y1={ghFront+20} x2={cx-ghW*0.48} y2={ghRear-14} stroke="rgba(10,132,255,0.12)" strokeWidth="0.6" strokeDasharray="8,8"/><line x1={cx+ghW*0.48} y1={ghFront+20} x2={cx+ghW*0.48} y2={ghRear-14} stroke="rgba(10,132,255,0.12)" strokeWidth="0.6" strokeDasharray="8,8"/>{g.bodyType==='pickup'&&<rect x={cx-bw*0.48} y={ghRear} width={bw*0.96} height={cy+bl/2-14-ghRear} fill="rgba(0,0,0,0.20)" stroke="rgba(255,255,255,0.05)" strokeWidth="0.8"/>}<line x1={cx} y1={cy-bl/2} x2={cx} y2={cy+bl/2} stroke="rgba(255,255,255,0.05)" strokeWidth="0.6" strokeDasharray="6,6"/><text x={cx} y={cy-bl/2-8} textAnchor="middle" fill="rgba(10,132,255,0.5)" fontSize="8" fontFamily="'IBM Plex Mono',monospace">FRONT</text>{[-bw*0.24,0,bw*0.24].map((ox,i)=><g key={i} transform={`translate(${cx+ox},${cy-bl/2-20})`}><line x1={0} y1={-4} x2={0} y2={6} stroke="rgba(10,132,255,0.35)" strokeWidth="0.9"/><polygon points="0,9 -2.5,4 2.5,4" fill="rgba(10,132,255,0.35)"/></g>)}{[-1,1].map(s=>{const mx=cx+s*bw*0.56,my=ghFront+12;return<path key={s} d={`M ${mx} ${my} L ${mx+s*16} ${my-5} L ${mx+s*16} ${my+6} Z`} fill="#0A1820" stroke="rgba(255,255,255,0.08)" strokeWidth="0.8"/>})}{ [[cx-bw*0.62,fwy,frontSteerOffset],[cx+bw*0.62,fwy,-frontSteerOffset],[cx-bw*0.62,rwy,0],[cx+bw*0.62,rwy,0]].map(([wx,wy,off],i)=><g key={i} transform={`translate(${wx},${wy}) rotate(${i<2?(yawAngle??0)*0.7:0})`}><rect x={-10} y={-18} width={20} height={36} rx="4" fill="#060C14" stroke="#1E3040" strokeWidth="1.5"/><line x1={0} y1={-12} x2={0} y2={12} stroke="#162434" strokeWidth="0.8"/></g>)}<text x={cx} y={H-3} textAnchor="middle" fill="rgba(255,255,255,0.15)" fontSize="9" fontFamily="'IBM Plex Mono',monospace" letterSpacing="0.12em">TOP{(yawAngle??0)!==0?` · YAW ${yawAngle>0?'+':''}${yawAngle}°`:''}</text></svg>)}

function UnderView({g,showGroundEffect}){const W=320,H=230,cx=W/2,cy=H/2+6;const isTall=g.bodyType==='suv'||g.bodyType==='pickup';const bw=isTall?78:70,bl=g.bodyType==='pickup'?172:156;const body=[`M ${cx} ${cy-bl/2+5}`,`Q ${cx-bw*0.26} ${cy-bl/2+1} ${cx-bw*0.50} ${cy-bl/2+20}`,`L ${cx-bw*0.52} ${cy+bl*0.08}`,`Q ${cx-bw*0.50} ${cy+bl/2-14} ${cx-bw*0.44} ${cy+bl/2-4}`,`L ${cx+bw*0.44} ${cy+bl/2-4}`,`Q ${cx+bw*0.50} ${cy+bl/2-14} ${cx+bw*0.52} ${cy+bl*0.08}`,`L ${cx+bw*0.50} ${cy-bl/2+20}`,`Q ${cx+bw*0.26} ${cy-bl/2+1} ${cx} ${cy-bl/2+5}`,'Z'].join(' ');const N=14,cpS=Array.from({length:N},(_,i)=>{const tM=(i+0.5)/N;return{y0:cy-bl/2+5+i*(bl-9)/N,y1:cy-bl/2+5+(i+1)*(bl-9)/N,c:cpToRgb(cpAtPoint(tM,0.05,tM<0.15,g.Cd))}});const fwy=cy+bl*(g.w1-0.50),rwy=cy+bl*(g.w2-0.50);const geC=showGroundEffect?[-0.6,-0.4,-0.2,0.0].map((cp,li)=>({y:cy-bl*0.15+li*(bl*0.12),w:(1-(-cp/0.8))*bw*0.40,c:cpToRgb(cp)})):[];
return(<svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',height:'100%'}} preserveAspectRatio="xMidYMid meet"><defs><clipPath id="uc"><path d={body}/></clipPath></defs><g clipPath="url(#uc)">{cpS.map((s,i)=><rect key={i} x={cx-bw*0.60} y={s.y0} width={bw*1.20} height={s.y1-s.y0+1} fill={s.c} opacity={0.82}/>)}</g><path d={body} fill="rgba(5,10,18,0.32)" stroke="rgba(10,132,255,0.6)" strokeWidth="0.9"/><rect x={cx-bw*0.38} y={cy-bl*0.32} width={bw*0.76} height={bl*0.54} rx="4" fill="rgba(0,0,0,0.18)" stroke="rgba(255,255,255,0.05)" strokeWidth="0.8"/><path d={`M ${cx-bw*0.09} ${cy-bl*0.30} Q ${cx} ${cy-bl*0.32} ${cx+bw*0.09} ${cy-bl*0.30} L ${cx+bw*0.09} ${cy+bl*0.22} Q ${cx} ${cy+bl*0.24} ${cx-bw*0.09} ${cy+bl*0.22} Z`} fill="rgba(0,0,0,0.30)" stroke="rgba(255,255,255,0.04)" strokeWidth="0.9"/><rect x={cx-bw*0.28} y={cy+bl*0.02} width={bw*0.56} height={bl*0.12} rx="6" fill="rgba(0,0,0,0.25)" stroke="rgba(255,255,255,0.06)" strokeWidth="0.8" strokeDasharray="3,2"/><rect x={cx-bw*0.36} y={cy-bl*0.40} width={bw*0.72} height={bl*0.16} rx="6" fill="none" stroke="rgba(10,132,255,0.15)" strokeWidth="1.0" strokeDasharray="4,3"/><rect x={cx-bw*0.34} y={cy+bl*0.16} width={bw*0.68} height={bl*0.14} rx="6" fill="none" stroke="rgba(10,132,255,0.15)" strokeWidth="1.0" strokeDasharray="4,3"/>{[-bw*0.24,-bw*0.08,bw*0.08,bw*0.24].map((ox,i)=><line key={i} x1={cx+ox} y1={cy-bl*0.30} x2={cx+ox} y2={cy+bl*0.22} stroke="rgba(255,255,255,0.06)" strokeWidth={i===1||i===2?3:1.8} strokeDasharray={i===0||i===3?"6,10":undefined}/>)}{[-4,-2,0,2,4].map(f=><line key={f} x1={cx+f*bw*0.08} y1={cy+bl*0.24} x2={cx+f*bw*0.08} y2={cy+bl/2-6} stroke="rgba(10,132,255,0.15)" strokeWidth="1.8"/>)}{(g.bodyType==='fastback'||g.bodyType==='coupe'?[-bw*0.20,bw*0.20]:[-bw*0.14,bw*0.14]).map((ox,i)=><g key={i}><circle cx={cx+ox} cy={cy+bl/2-11} r={6} fill="#060C14" stroke="rgba(255,255,255,0.08)" strokeWidth="1.6"/><circle cx={cx+ox} cy={cy+bl/2-11} r={3} fill="#020608"/><circle cx={cx+ox} cy={cy+bl/2-11} r={8} fill="none" stroke="rgba(255,69,58,0.12)" strokeWidth="3"/></g>)}{showGroundEffect&&geC.map((gc,i)=><rect key={i} x={cx-gc.w} y={gc.y} width={gc.w*2} height={bl*0.10} rx="3" fill={gc.c} opacity={0.18} stroke={gc.c} strokeWidth="0.5" strokeOpacity={0.5}/>)}{[[cx-bw*0.62,fwy],[cx+bw*0.62,fwy],[cx-bw*0.62,rwy],[cx+bw*0.62,rwy]].map(([wx,wy],i)=><rect key={i} x={wx-10} y={wy-18} width={20} height={36} rx="4" fill="#060C14" stroke="rgba(10,132,255,0.2)" strokeWidth="1.5"/>)}<text x={cx} y={cy-bl/2-8} textAnchor="middle" fill="rgba(10,132,255,0.45)" fontSize="8" fontFamily="'IBM Plex Mono',monospace">FRONT</text>{showGroundEffect&&<text x={cx} y={cy+bl/2+12} textAnchor="middle" fill="rgba(64,203,224,0.6)" fontSize="7" fontFamily="'IBM Plex Mono',monospace">GROUND EFFECT ACTIVE</text>}<text x={cx} y={H-3} textAnchor="middle" fill="rgba(255,255,255,0.15)" fontSize="9" fontFamily="'IBM Plex Mono',monospace" letterSpacing="0.12em">UNDERSIDE</text></svg>)}

// ── Drag donut ────────────────────────────────────────────────────────────────
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
  const [geo,      setGeo]        = useState(null)
  const [error,    setError]      = useState(null)
  const [activeView, setActiveView] = useState('side')
  const [cpOn,     setCpOn]       = useState(true)
  const [showSep,  setShowSep]    = useState(true)
  const [showIso,  setShowIso]    = useState(false)
  const [showGE,   setShowGE]     = useState(false)
  const [yawAngle, setYawAngle]   = useState(0)
  const svgRef = useRef(null)
  const fileRef = useRef(null)

  const acceptFile = useCallback((f) => {
    if (!f||!f.type.startsWith('image/')) return
    setFile(f); setPreview(URL.createObjectURL(f)); setGeo(null); setError(null); setStage('ready')
  }, [])

  const run = async () => {
    if (!file) return
    setError(null); setGeo(null); setStage('analyzing')
    try { const r = await analyzeImageCanvas(file); setGeo(r); setStage('done') }
    catch(e) { setError(e.message); setStage('error') }
  }

  const exportSVG = () => {
    const svg = svgRef.current?.querySelector('svg'); if(!svg) return
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([svg.outerHTML],{type:'image/svg+xml'}))
    a.download = `aeronet_${activeView}.svg`; a.click()
  }

  const isRunning = stage==='analyzing'
  const cd = geo?.Cd ?? 0.30
  const breakdown = geo ? getDragBreakdown(geo.bodyType) : []
  const improvements = { fastback:['Active rear diffuser','Underbody flat floor','Delete rear wing'], notchback:['Active grille shutters','Lower ride height','Rear lip spoiler'], hatchback:['Roof spoiler','Underbody diffuser','Tyre aero covers'], suv:['Lower ride height','Air suspension','Active aero'], estate:['Roof aero rails','Tow hitch fairing','Flush body'], pickup:['Tonneau cover','Air dam','Bed extender fairing'] }
  const suggestions = improvements[geo?.bodyType] ?? ['Lower ride height','Reduce frontal area','Active grille shutters']

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

          {/* Drop zone */}
          <div
            onDragOver={e=>{e.preventDefault();setDragOver(true)}}
            onDragLeave={()=>setDragOver(false)}
            onDrop={e=>{e.preventDefault();setDragOver(false);acceptFile(e.dataTransfer.files[0])}}
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
                <span style={{ fontSize:12, color:'var(--text-tertiary)', fontFamily:"'IBM Plex Sans'", textAlign:'center' }}>Drop a vehicle photo</span>
                <span style={{ fontSize:10, color:'var(--text-quaternary)', fontFamily:"'IBM Plex Mono'" }}>JPG · PNG · WEBP</span>
              </div>
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
            {isRunning ? (
              <>
                <svg className="anim-spin" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2.5"><path d="M12 3a9 9 0 019 9"/></svg>
                Analysing…
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
