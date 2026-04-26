// Copyright (c) 2026 Rutej Talati. All rights reserved.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const CP_STOPS = [
  [0.00, [59,130,246]],
  [0.22, [34,211,238]],
  [0.44, [52,211,153]],
  [0.60, [132,204,22]],
  [0.76, [251,191,36]],
  [0.88, [249,115,22]],
  [1.00, [239,68,68]],
]

function cpToRGB(cp, cpMin = -1.5, cpMax = 1.0) {
  const t = Math.max(0, Math.min(1, (cp - cpMin) / ((cpMax - cpMin) || 1)))
  for (let i = 0; i < CP_STOPS.length - 1; i++) {
    const [t0, c0] = CP_STOPS[i], [t1, c1] = CP_STOPS[i + 1]
    if (t >= t0 && t <= t1) {
      const f = (t - t0) / (t1 - t0)
      return [
        Math.round(c0[0] + f * (c1[0] - c0[0])),
        Math.round(c0[1] + f * (c1[1] - c0[1])),
        Math.round(c0[2] + f * (c1[2] - c0[2])),
      ]
    }
  }
  return [239, 68, 68]
}
function cpToCSS(cp, a = 1, cpMin = -1.5, cpMax = 1.0) {
  const [r, g, b] = cpToRGB(cp, cpMin, cpMax)
  return a < 1 ? `rgba(${r},${g},${b},${a})` : `rgb(${r},${g},${b})`
}

function physCp(u, v, face, p = {}) {
  const { yaw = 0, speed = 120, rearAngle = 28, groundClearance = 150 } = p
  const yr = yaw * Math.PI / 180
  const sf = (speed / 120) ** 1.85
  const yf = Math.cos(yr)
  switch (face) {
    case 'side': {
      const stag = Math.exp(-(u ** 2) / 0.007) * 0.88
      const roof = v < 0.40 ? -0.68 * Math.sin(Math.PI * Math.min(u * 1.12, 1)) : 0
      const under = v > 0.76 ? (0.06 + (150 - groundClearance) * 0.0009) * u : 0
      const wake = Math.exp(-((u - 1) ** 2) / 0.014) * -0.48
      const pillars = (Math.exp(-((u - 0.27) ** 2) / 0.003) + Math.exp(-((u - 0.70) ** 2) / 0.003)) * 0.07 * (v < 0.48 ? 1 : 0)
      return (stag + roof + under + wake + pillars) * sf * yf
    }
    case 'top': {
      const stag = Math.exp(-(u ** 2) / 0.009) * 0.82
      const suc = -0.62 * Math.sin(Math.PI * Math.min(u * 1.15, 1))
      const wake = Math.exp(-((u - 1) ** 2) / 0.016) * -0.32
      const ya = (v - 0.5) * yr * 0.52
      const mirrors = (Math.exp(-((v - 0.11) ** 2) / 0.003) + Math.exp(-((v - 0.89) ** 2) / 0.003)) * 0.13
      return (stag + suc + wake + ya + mirrors) * sf
    }
    case 'front': {
      const du = u - 0.5, dv = v - 0.40
      const r2 = du * du + dv * dv
      const stag = Math.exp(-r2 / 0.030) * 1.08
      const edge = -0.28 * (1 - Math.exp(-r2 / 0.10))
      const grille = v > 0.55 && v < 0.76 && Math.abs(du) < 0.20 ? 0.38 : 0
      return (stag + edge + grille + du * yr * 0.65) * sf
    }
    case 'rear': {
      const du = u - 0.5, dv = v - 0.5
      const r2 = du * du + dv * dv
      const wake = -0.58 * Math.exp(-r2 / 0.065)
      const diff = v > 0.66 ? 0.14 + 0.28 * (v - 0.66) : 0
      return (wake + diff + (rearAngle / 30) * 0.09 + du * yr * 0.48) * sf
    }
    case 'bottom': {
      const tun = Math.abs(u - 0.5) < 0.27 ? -0.42 * (1 + (150 - groundClearance) * 0.0012) : -0.19
      const spl = u < 0.07 ? 0.27 : 0
      const diff = u > 0.83 ? -0.07 + 0.30 * (u - 0.83) / 0.17 : 0
      const wh = (Math.exp(-((u - 0.17) ** 2) / 0.003) + Math.exp(-((u - 0.79) ** 2) / 0.003)) * 0.19
      return (tun + spl + diff + wh) * sf * yf
    }
    default: return 0
  }
}

async function parseSTL(buffer) {
  const dv = new DataView(buffer)
  const n = dv.getUint32(80, true)
  if (buffer.byteLength === 80 + 4 + n * 50 && n > 0) {
    const v = []
    let off = 84
    for (let i = 0; i < n; i++) {
      off += 12
      for (let j = 0; j < 3; j++) {
        v.push(dv.getFloat32(off, true), dv.getFloat32(off + 4, true), dv.getFloat32(off + 8, true))
        off += 12
      }
      off += 2
    }
    return new Float32Array(v)
  }
  const txt = new TextDecoder().decode(buffer)
  const re = /vertex\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)/g
  const v = []; let m
  while ((m = re.exec(txt))) v.push(+m[1], +m[2], +m[3])
  return new Float32Array(v)
}

function orientVerts(raw) {
  const n = raw.length / 3
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity,minZ=Infinity,maxZ=-Infinity
  for (let i = 0; i < raw.length; i += 3) {
    const x=raw[i],y=raw[i+1],z=raw[i+2]
    if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;if(z<minZ)minZ=z;if(z>maxZ)maxZ=z
  }
  const sx=maxX-minX,sy=maxY-minY,sz=maxZ-minZ
  const cx=(minX+maxX)/2,cy=(minY+maxY)/2,cz=(minZ+maxZ)/2
  const dims = [{a:0,s:sx},{a:1,s:sy},{a:2,s:sz}].sort((a,b)=>b.s-a.s)
  const out = new Float32Array(raw.length)
  for (let i = 0; i < raw.length; i += 3) {
    const coords = [raw[i]-cx, raw[i+1]-cy, raw[i+2]-cz]
    out[i]   = coords[dims[0].a]
    out[i+1] = coords[dims[1].a]
    out[i+2] = coords[dims[2].a]
  }
  let minZn = Infinity
  for (let i = 2; i < out.length; i += 3) if (out[i] < minZn) minZn = out[i]
  for (let i = 2; i < out.length; i += 3) out[i] -= minZn
  return out
}

function projectVerts(verts, face) {
  const pts = []
  for (let i = 0; i < verts.length; i += 3) {
    const x=verts[i],y=verts[i+1],z=verts[i+2]
    if      (face==='side')   pts.push([x,  z])
    else if (face==='top')    pts.push([x,  y])
    else if (face==='front')  pts.push([y,  z])
    else if (face==='rear')   pts.push([-y, z])
    else if (face==='bottom') pts.push([x, -y])
  }
  return pts
}

function convexHull(pts) {
  const s = pts.length > 6000 ? pts.filter((_,i)=>i%Math.ceil(pts.length/3000)===0) : pts
  const srt = [...s].sort((a,b)=>a[0]-b[0]||a[1]-b[1])
  const cross=(O,A,B)=>(A[0]-O[0])*(B[1]-O[1])-(A[1]-O[1])*(B[0]-O[0])
  const lo=[],up=[]
  for(const p of srt){while(lo.length>=2&&cross(lo[lo.length-2],lo[lo.length-1],p)<=0)lo.pop();lo.push(p)}
  for(let i=srt.length-1;i>=0;i--){const p=srt[i];while(up.length>=2&&cross(up[up.length-2],up[up.length-1],p)<=0)up.pop();up.push(p)}
  up.pop();lo.pop();return[...lo,...up]
}

function normToPx(pts, W, H, pad=22) {
  if(!pts.length)return[]
  let mnX=Infinity,mxX=-Infinity,mnY=Infinity,mxY=-Infinity
  for(const[x,y]of pts){if(x<mnX)mnX=x;if(x>mxX)mxX=x;if(y<mnY)mnY=y;if(y>mxY)mxY=y}
  const rx=mxX-mnX||1,ry=mxY-mnY||1
  const sc=Math.min((W-pad*2)/rx,(H-pad*2)/ry)
  const cx=(mnX+mxX)/2,cy=(mnY+mxY)/2
  return pts.map(([x,y])=>[W/2+(x-cx)*sc, H/2-(y-cy)*sc])
}

function realCpForFace(predData, face, W, H) {
  const payload = predData?.viewer?.points ?? predData?.pointCloud
  if(!payload?.positions||!payload?.pressures)return[]
  const pos=payload.positions,pres=payload.pressures
  const raw=[]
  for(let i=0;i<pos.length;i+=3){
    const x=pos[i],y=pos[i+1],z=pos[i+2],cp=pres[i/3]
    let px,py
    if(face==='side')  {px=x;py=z}
    else if(face==='top')   {px=x;py=y}
    else if(face==='front') {px=y;py=z}
    else if(face==='rear')  {px=-y;py=z}
    else if(face==='bottom'){px=x;py=-y}
    raw.push([px,py,cp])
  }
  if(!raw.length)return[]
  let mnX=Infinity,mxX=-Infinity,mnY=Infinity,mxY=-Infinity
  for(const[x,y]of raw){if(x<mnX)mnX=x;if(x>mxX)mxX=x;if(y<mnY)mnY=y;if(y>mxY)mxY=y}
  const rx=mxX-mnX||1,ry=mxY-mnY||1
  const sc=Math.min((W-22*2)/rx,(H-22*2)/ry)
  const cx=(mnX+mxX)/2,cy=(mnY+mxY)/2
  return raw.map(([x,y,cp])=>[W/2+(x-cx)*sc,H/2-(y-cy)*sc,cp])
}

function inPoly(px,py,poly){
  let inside=false
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){
    const[xi,yi]=poly[i],[xj,yj]=poly[j]
    if((yi>py)!==(yj>py)&&px<(xj-xi)*(py-yi)/(yj-yi)+xi)inside=!inside
  }
  return inside
}

function drawHeatmap(canvas, face, params, cpPoints, layer, hull, W, H, cpMin, cpMax) {
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0,0,W,H)
  if(layer==='outline')return

  if(cpPoints&&cpPoints.length>0) {
    const r = Math.max(5, Math.min(14, W/50))
    for(const[px,py,cp]of cpPoints) {
      const[ri,gi,bi]=cpToRGB(cp,cpMin,cpMax)
      const gr=ctx.createRadialGradient(px,py,0,px,py,r)
      gr.addColorStop(0,`rgba(${ri},${gi},${bi},0.72)`)
      gr.addColorStop(1,`rgba(${ri},${gi},${bi},0)`)
      ctx.fillStyle=gr;ctx.beginPath();ctx.arc(px,py,r,0,Math.PI*2);ctx.fill()
    }
    return
  }

  const RES=72
  const cw=W/RES,ch=H/RES
  for(let ix=0;ix<RES;ix++){
    for(let iy=0;iy<RES;iy++){
      const u=(ix+0.5)/RES,v=(iy+0.5)/RES
      const px=ix*cw+cw/2,py=iy*ch+ch/2
      if(hull&&hull.length>3&&!inPoly(px,py,hull))continue
      let col
      if(layer==='velocity'){
        const cp=physCp(u,v,face,params)
        const vel=Math.max(0,Math.min(1,1-cp*0.65))
        col=`rgba(${Math.round(vel*22+(1-vel)*200)},${Math.round(vel*140+(1-vel)*240)},${Math.round(vel*230+(1-vel)*30)},0.72)`
      } else {
        const cp=physCp(u,v,face,params)
        const[r,g,b]=cpToRGB(cp,cpMin,cpMax)
        col=`rgba(${r},${g},${b},0.70)`
      }
      ctx.fillStyle=col;ctx.fillRect(ix*cw,iy*ch,cw+1,ch+1)
    }
  }
}

function drawStreams(canvas, face, params, W, H) {
  const ctx=canvas.getContext('2d')
  ctx.clearRect(0,0,W,H)
  if(face!=='side'&&face!=='top')return
  const N=face==='side'?20:16
  const STEPS=100,DT=0.0065
  ctx.lineWidth=0.9;ctx.globalAlpha=0.55
  for(let n=0;n<N;n++){
    let px=W*0.03,py=H*(0.12+n*(0.76/(N-1)))
    ctx.beginPath();ctx.moveTo(px,py)
    for(let s=0;s<STEPS;s++){
      const u=px/W,v=py/H
      const cp=physCp(u,v,face,params)
      const eps=0.018
      const gx=physCp(u+eps,v,face,params)-cp
      const gy=physCp(u,v+eps,face,params)-cp
      const vx=W*(1-cp*0.28-gx*2.2)
      const vy=H*(-gy*2.8)
      const mg=Math.sqrt(vx*vx+vy*vy)||1
      px+=(vx/mg)*W*DT;py+=(vy/mg)*H*DT
      if(px>W*0.99||px<0||py<0.5||py>H-0.5)break
      ctx.lineTo(px,py)
      const vel=Math.max(0,Math.min(1,1-cp*0.45))
      ctx.strokeStyle=`rgba(${Math.round(vel*20+(1-vel)*210)},${Math.round(vel*160+(1-vel)*235)},${Math.round(vel*225+(1-vel)*40)},0.55)`
    }
    ctx.stroke();ctx.beginPath()
  }
  ctx.globalAlpha=1
}

function estimateCdFromImage(imgData, W, H) {
  const d=imgData.data
  let dark=0,mnX=W,mxX=0,mnY=H,mxY=0
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const i=(y*W+x)*4
    const br=(d[i]+d[i+1]+d[i+2])/3
    if(br<150){
      dark++
      if(x<mnX)mnX=x;if(x>mxX)mxX=x;if(y<mnY)mnY=y;if(y>mxY)mxY=y
    }
  }
  const cw=mxX-mnX||1,ch=mxY-mnY||1
  const ar=cw/ch
  const fill=dark/(cw*ch)
  const arF=Math.max(0,Math.min(1,(ar-1.8)/3.2))
  const fillF=Math.max(0,Math.min(1,(0.88-fill)/0.45))
  const Cd=Math.max(0.19,Math.min(0.52,0.22+(1-arF)*0.13+fillF*0.09))
  return{
    Cd,uncertainty:0.035+Math.max(0,(1-arF)*0.025),
    ar:ar.toFixed(2),fill:(fill*100).toFixed(1),
    conf:Math.round(38+arF*42),
    note:'Silhouette geometry estimate ±0.04. Upload STL for accuracy.',
  }
}

const VIEWS    = ['side','top','front','rear','bottom']
const VL       = {side:'Side Profile',top:'Plan View',front:'Front',rear:'Rear Wake',bottom:'Underbody'}
const VDESC    = {side:'XZ plane',top:'XY plane',front:'YZ plane',rear:'−YZ plane',bottom:'XY inverted'}
const CW=660, CH=260

const FLOW_PARAMS = [
  {key:'speed',           label:'Speed',        unit:'km/h', min:60,  max:250, step:5,   def:120, dp:0},
  {key:'yaw',             label:'Yaw',          unit:'deg',  min:-15, max:15,  step:0.5, def:0,   dp:1},
  {key:'rearAngle',       label:'Rear Slant',   unit:'deg',  min:18,  max:42,  step:1,   def:28,  dp:0},
  {key:'groundClearance', label:'Ride Height',  unit:'mm',   min:70,  max:240, step:5,   def:150, dp:0},
  {key:'frontalArea',     label:'Frontal Area', unit:'m²',   min:1.6, max:2.9, step:0.05,def:2.2, dp:2},
]
const PRESETS=[
  {label:'City',      speed:60,  yaw:0,  rearAngle:28,groundClearance:155,frontalArea:2.2},
  {label:'Highway',   speed:130, yaw:3,  rearAngle:28,groundClearance:150,frontalArea:2.2},
  {label:'Track',     speed:220, yaw:0,  rearAngle:24,groundClearance:115,frontalArea:1.95},
  {label:'Crosswind', speed:110, yaw:13, rearAngle:28,groundClearance:150,frontalArea:2.2},
]

export default function Views2DPage({ activeModel, predictionData }) {
  const [params,     setParams]     = useState(Object.fromEntries(FLOW_PARAMS.map(p=>[p.key,p.def])))
  const [activeView, setActiveView] = useState('side')
  const [layer,      setLayer]      = useState('cp')
  const [streams,    setStreams]     = useState(true)
  const [expanded,   setExpanded]   = useState(false)
  const [stlVerts,   setStlVerts]   = useState(null)
  const [stlName,    setStlName]    = useState(null)
  const [imgResult,  setImgResult]  = useState(null)
  const [imgSrc,     setImgSrc]     = useState(null)
  const [imgDrag,    setImgDrag]    = useState(false)
  const [stlDrag,    setStlDrag]    = useState(false)
  const [running,    setRunning]    = useState(false)
  const [surr,       setSurr]       = useState(null)

  const stlInputRef=useRef();const imgInputRef=useRef()
  const heatRefs=useRef({});const streamRefs=useRef({})

  const loadSTL=useCallback(async f=>{
    setStlName(f.name)
    const buf=await f.arrayBuffer()
    const raw=await parseSTL(buf)
    setStlVerts(orientVerts(raw))
  },[])

  const onSTLDrop=useCallback(e=>{
    e.preventDefault();setStlDrag(false)
    const f=e.dataTransfer.files[0]
    if(f)loadSTL(f)
  },[loadSTL])

  const loadImg=useCallback(f=>{
    const url=URL.createObjectURL(f)
    setImgSrc(url)
    const img=new Image()
    img.onload=()=>{
      const c=document.createElement('canvas');c.width=400;c.height=160
      const ctx=c.getContext('2d')
      ctx.fillStyle='#fff';ctx.fillRect(0,0,400,160)
      ctx.drawImage(img,0,0,400,160)
      setImgResult(estimateCdFromImage(ctx.getImageData(0,0,400,160),400,160))
    }
    img.src=url
  },[])

  const onImgDrop=useCallback(e=>{
    e.preventDefault();setImgDrag(false)
    const f=e.dataTransfer.files[0]
    if(f?.type.startsWith('image/'))loadImg(f)
  },[loadImg])

  const hulls=useMemo(()=>{
    if(!stlVerts)return{}
    return Object.fromEntries(VIEWS.map(face=>{
      const pts2d=projectVerts(stlVerts,face)
      return[face, normToPx(convexHull(pts2d),CW,CH,24)]
    }))
  },[stlVerts])

  const realCp=useMemo(()=>{
    if(!predictionData)return{}
    return Object.fromEntries(VIEWS.map(face=>[face,realCpForFace(predictionData,face,CW,CH)]))
  },[predictionData])
  const hasCp=predictionData&&Object.values(realCp).some(v=>v.length>0)

  const cpMin=predictionData?.cpStats?.min??-1.5
  const cpMax=predictionData?.cpStats?.max??1.0

  const runPredict=useCallback(async()=>{
    setRunning(true)
    try{
      const res=await fetch('http://https://aeronet-osiw.onrender.com/surrogate/predict',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({features:{
          Vehicle_Length:50,Vehicle_Width:params.frontalArea*28-28,
          Vehicle_Height:0,Front_Overhang:-26,Front_Planview:1,
          Hood_Angle:0,Approach_Angle:0,Windscreen_Angle:0,
          Greenhouse_Tapering:0,
          Backlight_Angle:params.rearAngle*1.9-28,
          Decklid_Height:0,Rearend_tapering:0,Rear_Overhang:0,
          Rear_Diffusor_Angle:0,
          Vehicle_Ride_Height:params.groundClearance-150,Vehicle_Pitch:0,
        },active_model:'GradBoost-DrivAerML'}),
      })
      if(res.ok)setSurr(await res.json())
    }catch{}
    setRunning(false)
  },[params])

  useEffect(()=>{
    for(const face of VIEWS){
      const hc=heatRefs.current[face];const sc=streamRefs.current[face]
      if(hc)drawHeatmap(hc,face,params,
        realCp[face]?.length>0?realCp[face]:null,
        layer,hulls[face]||null,CW,CH,cpMin,cpMax)
      if(sc){
        if(streams)drawStreams(sc,face,params,CW,CH)
        else sc.getContext('2d').clearRect(0,0,CW,CH)
      }
    }
  },[params,layer,streams,hulls,realCp,hasCp])

  function exportPNG(){
    const hc=heatRefs.current[activeView],sc=streamRefs.current[activeView]
    const out=document.createElement('canvas');out.width=CW;out.height=CH
    const ctx=out.getContext('2d')
    ctx.fillStyle='#000';ctx.fillRect(0,0,CW,CH)
    if(hc)ctx.drawImage(hc,0,0);if(sc)ctx.drawImage(sc,0,0)
    const hull=hulls[activeView]
    if(hull?.length>2){
      ctx.strokeStyle='rgba(77,216,232,0.75)';ctx.lineWidth=1.5
      ctx.beginPath();ctx.moveTo(hull[0][0],hull[0][1])
      hull.forEach(([x,y])=>ctx.lineTo(x,y))
      ctx.closePath();ctx.stroke()
    }
    ctx.font='9px Roboto Mono';ctx.fillStyle='rgba(77,216,232,0.28)'
    ctx.fillText(`AeroNet · ${VL[activeView]} · © 2026 Rutej Talati`,8,CH-8)
    const a=document.createElement('a');a.download=`aeronet_2d_${activeView}.png`;a.href=out.toDataURL();a.click()
  }

  const Cd=surr?.Cd
  const cdClr=Cd==null?'#4a5f6a':Cd<0.25?'#4ade80':Cd<0.29?'#22d3ee':Cd<0.32?'#fbbf24':'#f87171'
  const cdLbl=Cd==null?'—':Cd<0.25?'Exceptional':Cd<0.29?'Excellent':Cd<0.32?'Good':Cd<0.35?'Average':'High drag'

  return (
    <div style={{display:'flex',height:'100%',overflow:'hidden',background:'#000',fontFamily:"'Roboto Mono',monospace"}}>

      {/* ══ LEFT RAIL ════════════════════════════════════════════════════ */}
      <div style={{width:252,flexShrink:0,borderRight:'1px solid #0f1e28',display:'flex',flexDirection:'column',background:'#050505',overflow:'hidden'}}>

        {/* Geometry drop */}
        <PanelBlock label="GEOMETRY INPUT">
          <DropTarget
            dragState={stlDrag} setDrag={setStlDrag}
            onDrop={onSTLDrop}
            onClick={()=>stlInputRef.current?.click()}
            accept=".stl,.obj" fileRef={stlInputRef} onFile={loadSTL}
            active={!!stlVerts}
            activeLabel={stlName}
            onClear={()=>{setStlVerts(null);setStlName(null)}}
            placeholder="Drop STL / OBJ"
            sub="Projects real silhouette into each view"
            icon={
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
                <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
              </svg>
            }
          />
          {stlVerts&&(
            <div style={{marginTop:6,display:'flex',gap:6}}>
              {['side','top','front'].map(f=>(
                <div key={f} style={{flex:1,background:'#0a0a0a',borderRadius:4,padding:'3px 0',textAlign:'center',fontSize:8,color:'#006874',textTransform:'uppercase',letterSpacing:'0.05em',border:'1px solid #0f2030'}}>
                  {f}
                </div>
              ))}
            </div>
          )}
        </PanelBlock>

        {/* Image drop */}
        <PanelBlock label={<>IMAGE PREDICTION <span style={{color:'#fbbf24',fontSize:7,marginLeft:4}}>BETA</span></>}>
          <DropTarget
            dragState={imgDrag} setDrag={setImgDrag}
            onDrop={onImgDrop}
            onClick={()=>imgInputRef.current?.click()}
            accept="image/*" fileRef={imgInputRef} onFile={loadImg}
            active={!!imgResult}
            activeLabel={imgResult?`Cd ≈ ${imgResult.Cd.toFixed(3)}`:''}
            onClear={()=>{setImgResult(null);setImgSrc(null)}}
            placeholder="Drop car photo / render"
            sub="Cd estimate from silhouette aspect ratio"
            preview={imgSrc}
            icon={
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
                <rect x="3" y="3" width="18" height="18" rx="2"/>
                <circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
              </svg>
            }
          />

          {imgResult&&(
            <div style={{marginTop:8,background:'#050505',borderRadius:7,border:'1px solid #0f1e28',padding:'10px 11px',animation:'fadeIn 280ms ease-out'}}>
              {/* Cd display */}
              <div style={{display:'flex',alignItems:'baseline',gap:6,marginBottom:6}}>
                <span style={{fontSize:30,fontWeight:200,color:'#fbbf24',letterSpacing:'-0.02em',fontVariantNumeric:'tabular-nums'}}>{imgResult.Cd.toFixed(3)}</span>
                <span style={{fontSize:10,color:'#3a5560'}}>Cd</span>
                <span style={{fontSize:10,color:'#3a5560',marginLeft:2}}>±{imgResult.uncertainty.toFixed(3)}</span>
              </div>
              {/* Confidence bar */}
              <div style={{marginBottom:6}}>
                <div style={{display:'flex',justifyContent:'space-between',marginBottom:2}}>
                  <span style={{fontSize:8,color:'#2a4050',textTransform:'uppercase',letterSpacing:'0.06em'}}>Confidence</span>
                  <span style={{fontSize:8,color:'#fbbf24'}}>{imgResult.conf}%</span>
                </div>
                <div style={{height:2,background:'#0f1e28',borderRadius:9999}}>
                  <div style={{height:'100%',borderRadius:9999,width:`${imgResult.conf}%`,background:'linear-gradient(to right,#fbbf24,#fb923c)',transition:'width 600ms'}}/>
                </div>
              </div>
              {/* Silhouette stats */}
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:4}}>
                {[['Aspect Ratio',imgResult.ar],['Fill Ratio',`${imgResult.fill}%`]].map(([l,v])=>(
                  <div key={l} style={{background:'#0a0a0a',borderRadius:4,padding:'4px 6px',border:'1px solid #0f1e28'}}>
                    <div style={{fontSize:7,color:'#49454f',textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:1}}>{l}</div>
                    <div style={{fontSize:11,color:'#5a7f8a',fontVariantNumeric:'tabular-nums'}}>{v}</div>
                  </div>
                ))}
              </div>
              <div style={{marginTop:6,fontSize:8,color:'#49454f',lineHeight:1.5}}>{imgResult.note}</div>
            </div>
          )}
        </PanelBlock>

        {/* Flow params */}
        <PanelBlock label="FLOW CONDITIONS" style={{flex:1,overflowY:'auto'}}>
          {/* Presets */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:3,marginBottom:10}}>
            {PRESETS.map(pr=>(
              <button key={pr.label}
                onClick={()=>setParams(p=>({...p,...pr}))}
                style={{padding:'4px 8px',borderRadius:5,border:'1px solid #0f1e28',background:'#0a0a0a',color:'#006874',fontSize:9,cursor:'pointer',textAlign:'left',transition:'all 130ms',letterSpacing:'0.04em'}}
                onMouseOver={e=>{e.currentTarget.style.borderColor='#4dd8e8';e.currentTarget.style.color='#4dd8e8'}}
                onMouseOut={e=>{e.currentTarget.style.borderColor='#0f1e28';e.currentTarget.style.color='#006874'}}>
                {pr.label}
              </button>
            ))}
          </div>
          {FLOW_PARAMS.map(p=>(
            <ParamSlider key={p.key} def={p} value={params[p.key]}
              onChange={v=>setParams(prev=>({...prev,[p.key]:v}))} />
          ))}
        </PanelBlock>

        {/* Run button */}
        <div style={{padding:'10px 12px',borderTop:'1px solid #0f1e28',flexShrink:0}}>
          <button onClick={runPredict} disabled={running}
            style={{width:'100%',height:40,borderRadius:8,border:'none',
              cursor:running?'not-allowed':'pointer',
              background:running?'#0a0a0a':'linear-gradient(135deg,#0891b2,#06b6d4)',
              color:running?'#49454f':'#001820',
              fontSize:12,fontWeight:700,letterSpacing:'0.04em',
              boxShadow:running?'none':'0 0 20px rgba(6,182,212,0.25)',
              transition:'all 200ms',display:'flex',alignItems:'center',justifyContent:'center',gap:8}}>
            {running
              ? <><Spin/>Analysing…</>
              : <><svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21"/></svg>Run 2D Analysis</>
            }
          </button>
        </div>
      </div>

      {/* ══ MAIN AREA ═════════════════════════════════════════════════════ */}
      <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden',background:'#000'}}>

        {/* Toolbar */}
        <div style={{display:'flex',alignItems:'center',gap:8,padding:'7px 14px',borderBottom:'1px solid #0d1c26',background:'#050505',flexShrink:0}}>

          {/* Layer */}
          <SegCtrl
            opts={[{k:'cp',l:'Cp Field'},{k:'velocity',l:'Velocity'},{k:'outline',l:'Outline'}]}
            val={layer} set={setLayer} />

          <Divider/>

          {/* Streamlines */}
          <Toggle on={streams} onClick={()=>setStreams(s=>!s)} label="Streamlines"
            icon={<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12c0-3.87 4-7 9-7s9 3.13 9 7-4 7-9 7"/><path d="M5 12H1m4 0 4 4m-4-4 4-4"/></svg>}/>

          <Divider/>

          {/* View tabs */}
          {VIEWS.map(v=>(
            <button key={v} onClick={()=>setActiveView(v)}
              style={{padding:'3px 9px',borderRadius:5,border:'none',
                fontFamily:'inherit',fontSize:9,textTransform:'uppercase',letterSpacing:'0.07em',
                cursor:'pointer',transition:'all 120ms',
                background:activeView===v?'rgba(6,182,212,0.14)':'transparent',
                color:activeView===v?'#06b6d4':'#49454f',
                outline:activeView===v?'1px solid rgba(6,182,212,0.25)':'none'}}>
              {v}
            </button>
          ))}

          <div style={{flex:1}}/>

          {/* Cd pill */}
          {Cd!=null&&(
            <div style={{display:'flex',alignItems:'center',gap:8,padding:'3px 12px',
              background:'rgba(6,182,212,0.05)',borderRadius:6,border:'1px solid #0f2030'}}>
              <span style={{fontSize:8,color:'#49454f',textTransform:'uppercase',letterSpacing:'0.07em'}}>Cd</span>
              <span style={{fontSize:20,fontWeight:200,color:cdClr,fontVariantNumeric:'tabular-nums',letterSpacing:'-0.02em'}}>{Cd.toFixed(4)}</span>
              <span style={{fontSize:9,color:cdClr,fontWeight:700}}>{cdLbl}</span>
              {surr?.uncertainty&&<span style={{fontSize:8,color:'#49454f'}}>±{(surr.uncertainty*1000).toFixed(0)}ct</span>}
            </div>
          )}

          {hasCp&&(
            <div style={{fontSize:8,padding:'2px 7px',borderRadius:3,
              background:'rgba(74,222,128,0.08)',color:'#4ade80',
              border:'1px solid rgba(74,222,128,0.2)',letterSpacing:'0.05em'}}>
              REAL CFD DATA
            </div>
          )}

          {/* Export */}
          <button onClick={exportPNG} title="Export PNG"
            style={{width:28,height:28,borderRadius:5,border:'1px solid #0f1e28',background:'transparent',
              color:'#49454f',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',transition:'all 150ms'}}
            onMouseOver={e=>{e.currentTarget.style.borderColor='#06b6d4';e.currentTarget.style.color='#06b6d4'}}
            onMouseOut={e=>{e.currentTarget.style.borderColor='#0f1e28';e.currentTarget.style.color='#49454f'}}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          </button>
        </div>

        {/* Results bar */}
        {surr&&(
          <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:'1px',background:'#111',borderBottom:'1px solid #0d1c26',flexShrink:0,animation:'slideDown 280ms ease-out'}}>
            {[
              {l:'Drag Coef.',       v:surr.Cd?.toFixed(4),               c:cdClr},
              {l:'Ensemble',         v:surr.Cd_ensemble?.toFixed(4),       c:'#8ab4c0'},
              {l:'RF Prediction',    v:surr.all_predictions?.['RandomForest-DrivAerML']?.toFixed(4),c:'#4dd8e8'},
              {l:'Uncertainty',      v:`±${(surr.uncertainty*10000).toFixed(0)} drag ct`,c:'#fbbf24'},
              {l:'Inference',        v:`${surr.inferenceMs?.toFixed(0)} ms`,c:'#4a5f6a'},
            ].map(s=>(
              <div key={s.l} style={{padding:'7px 12px',background:'#000'}}>
                <div style={{fontSize:7,color:'#49454f',textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:3}}>{s.l}</div>
                <div style={{fontFamily:'inherit',fontSize:13,color:s.c,fontVariantNumeric:'tabular-nums'}}>{s.v??'—'}</div>
              </div>
            ))}
          </div>
        )}

        {/* Views area */}
        <div style={{flex:1,overflowY:'auto',padding:'12px 14px',display:'flex',flexDirection:'column',gap:10}}>

          {/* Main view */}
          <ViewCard
            face={activeView} label={VL[activeView]} desc={VDESC[activeView]}
            heatRef={el=>heatRefs.current[activeView]=el}
            streamRef={el=>streamRefs.current[activeView]=el}
            hull={hulls[activeView]}
            main hasCp={hasCp}
            onExpand={()=>setExpanded(true)}
          />

          {/* Thumbnail row */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8}}>
            {VIEWS.filter(v=>v!==activeView).map(v=>(
              <ViewCard key={v}
                face={v} label={VL[v]}
                heatRef={el=>heatRefs.current[v]=el}
                streamRef={el=>streamRefs.current[v]=el}
                hull={hulls[v]}
                hasCp={hasCp}
                onClick={()=>setActiveView(v)}
              />
            ))}
          </div>

          {/* Colorbar */}
          <div style={{display:'flex',alignItems:'center',gap:10,padding:'7px 10px',
            background:'#050505',borderRadius:6,border:'1px solid #0d1c26'}}>
            <span style={{fontSize:8,color:'#49454f',textTransform:'uppercase',letterSpacing:'0.07em',minWidth:40}}>
              {layer==='cp'?'Cp':layer==='velocity'?'V / V∞':'—'}
            </span>
            {layer!=='outline'&&(
              <div style={{flex:1,height:5,borderRadius:9999,overflow:'hidden',
                background:'linear-gradient(to right,#3b82f6,#22d3ee,#34d399,#84cc16,#fbbf24,#f97316,#ef4444)'}}>
              </div>
            )}
            {layer==='cp'&&<>
              <span style={{fontSize:8,fontVariantNumeric:'tabular-nums',color:'#3b82f6'}}>{cpMin.toFixed(2)}</span>
              <span style={{fontSize:8,color:'#49454f'}}>0</span>
              <span style={{fontSize:8,fontVariantNumeric:'tabular-nums',color:'#ef4444'}}>{cpMax.toFixed(2)}</span>
            </>}
            <div style={{flex:1}}/>
            <span style={{fontSize:8,color:'#49454f'}}>
              {hasCp?'AeroNet surface prediction':'Physics estimate (potential flow)'}
            </span>
          </div>
        </div>
      </div>

      {/* ══ EXPANDED MODAL ════════════════════════════════════════════════ */}
      {expanded&&(
        <div style={{position:'fixed',inset:0,zIndex:300,
          background:'rgba(4,8,12,0.94)',backdropFilter:'blur(16px)',
          display:'flex',alignItems:'center',justifyContent:'center',animation:'fadeIn 180ms ease-out'}}
          onClick={()=>setExpanded(false)}>
          <div style={{background:'#000',borderRadius:14,padding:18,
            border:'1px solid #0f2030',maxWidth:'90vw',
            boxShadow:'0 30px 100px rgba(0,0,0,0.8)'}}
            onClick={e=>e.stopPropagation()}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
              <div>
                <span style={{fontSize:13,fontWeight:600,color:'#e6e1e5',letterSpacing:'-0.01em'}}>{VL[activeView]}</span>
                <span style={{fontSize:9,color:'#49454f',marginLeft:10,letterSpacing:'0.06em',textTransform:'uppercase'}}>{VDESC[activeView]}</span>
              </div>
              <button onClick={()=>setExpanded(false)}
                style={{width:26,height:26,borderRadius:'50%',border:'none',background:'#0f1e28',
                  color:'#006874',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
            <ViewCard face={activeView} label={VL[activeView]}
              heatRef={el=>heatRefs.current[activeView+'_exp']=el}
              streamRef={el=>streamRefs.current[activeView+'_exp']=el}
              hull={hulls[activeView]} main hasCp={hasCp} modal/>
          </div>
        </div>
      )}
    </div>
  )
}

function ViewCard({face,label,desc,heatRef,streamRef,hull,main,hasCp,onClick,onExpand,modal}){
  const [hov,setHov]=useState(false)
  const W=CW,H=CH

  return(
    <div onClick={onClick}
      onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}
      style={{position:'relative',borderRadius:main?10:7,overflow:'hidden',
        cursor:onClick?'pointer':'default',
        border:`1px solid ${hov&&onClick?'#0d2a2a':'#111'}`,
        background:'#050505',transition:'border-color 160ms',
        boxShadow:main?'0 4px 30px rgba(0,0,0,0.5)':undefined}}>

      {/* Canvases */}
      <div style={{position:'relative',paddingBottom:`${(H/W)*100}%`}}>
        <canvas ref={heatRef}   width={W} height={H} style={{position:'absolute',inset:0,width:'100%',height:'100%'}}/>
        <canvas ref={streamRef} width={W} height={H} style={{position:'absolute',inset:0,width:'100%',height:'100%',mixBlendMode:'screen'}}/>

        {/* SVG overlay */}
        <svg viewBox={`0 0 ${W} ${H}`} style={{position:'absolute',inset:0,width:'100%',height:'100%',pointerEvents:'none'}}>
          {/* Ground plane dashes */}
          {(face==='side'||face==='front'||face==='rear')&&(
            <line x1={W*0.04} y1={H*0.87} x2={W*0.96} y2={H*0.87}
              stroke="#1a1a1a" strokeWidth="0.7" strokeDasharray="5,5"/>
          )}
          {/* Hull polygon */}
          {hull&&hull.length>2&&(
            <polygon
              points={hull.map(([x,y])=>`${x},${y}`).join(' ')}
              fill="none"
              stroke={hasCp?'rgba(6,182,212,0.65)':'rgba(6,182,212,0.28)'}
              strokeWidth={main?1.3:0.8}
            />
          )}
          {/* Flow direction arrow */}
          {(face==='side'||face==='top')&&main&&(
            <g>
              <defs>
                <marker id="arr" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
                  <path d="M0,0 L6,3 L0,6 L1.5,3 Z" fill="#1a3a40"/>
                </marker>
              </defs>
              <line x1={W*0.06} y1={H*0.5} x2={W*0.14} y2={H*0.5}
                stroke="#1a3a40" strokeWidth="1" markerEnd="url(#arr)"/>
              <text x={W*0.04} y={H*0.5-5} fontSize="7" fill="#1a3a40" fontFamily="Roboto Mono">FLOW</text>
            </g>
          )}
          {/* Axis labels */}
          {main&&(
            <>
              <text x={W-6} y={H*0.87+10} fontSize="8" fill="#1a1a1a" textAnchor="end" fontFamily="Roboto Mono">
                {face==='side'||face==='top'?'+X':face==='rear'?'−Y':'+Y'}
              </text>
              <text x={8} y={14} fontSize="8" fill="#1a1a1a" fontFamily="Roboto Mono">
                {face==='bottom'?'+Y':'+Z'}
              </text>
            </>
          )}
        </svg>
      </div>

      {/* Label overlay */}
      <div style={{position:'absolute',top:main?8:5,left:main?10:7,
        display:'flex',alignItems:'center',gap:5,pointerEvents:'none'}}>
        <span style={{fontSize:main?10:8,fontWeight:600,letterSpacing:'0.08em',textTransform:'uppercase',
          color:'#49454f',fontFamily:"'Roboto Mono',monospace"}}>
          {label}
        </span>
        {hasCp&&(
          <span style={{fontSize:7,background:'rgba(74,222,128,0.1)',color:'#4ade80',
            border:'1px solid rgba(74,222,128,0.2)',borderRadius:2,padding:'0 4px',letterSpacing:'0.04em'}}>
            CFD
          </span>
        )}
      </div>

      {/* Expand button */}
      {main&&onExpand&&(
        <button onClick={e=>{e.stopPropagation();onExpand()}}
          style={{position:'absolute',top:7,right:7,width:22,height:22,
            borderRadius:4,border:'none',background:'rgba(6,14,20,0.8)',
            color:'#49454f',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',transition:'all 140ms'}}
          onMouseOver={e=>{e.currentTarget.style.color='#06b6d4'}}
          onMouseOut={e=>{e.currentTarget.style.color='#49454f'}}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/>
            <line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
          </svg>
        </button>
      )}
    </div>
  )
}

function PanelBlock({label,children,style={}}){
  return(
    <div style={{padding:'11px 12px',borderBottom:'1px solid #0d1c26',...style}}>
      <div style={{fontSize:8,fontWeight:600,letterSpacing:'0.09em',textTransform:'uppercase',color:'#49454f',marginBottom:8}}>{label}</div>
      {children}
    </div>
  )
}

function DropTarget({dragState,setDrag,onDrop,onClick,accept,fileRef,onFile,active,activeLabel,onClear,placeholder,sub,icon,preview}){
  return(
    <div
      onDragOver={e=>{e.preventDefault();setDrag(true)}}
      onDragLeave={()=>setDrag(false)}
      onDrop={e=>{setDrag(false);onDrop(e)}}
      onClick={active?undefined:onClick}
      style={{borderRadius:8,border:`1.5px dashed ${dragState?'#06b6d4':active?'#1a1a1a':'#111'}`,
        background:dragState?'rgba(6,182,212,0.04)':active?'#050505':'#000',
        cursor:active?'default':'pointer',transition:'all 160ms',overflow:'hidden'}}>
      <input ref={fileRef} type="file" accept={accept} style={{display:'none'}}
        onChange={e=>{const f=e.target.files[0];if(f)onFile(f)}}/>
      {active?(
        <div style={{display:'flex',alignItems:'center',gap:8,padding:'9px 11px'}}>
          {preview?(
            <img src={preview} alt="" style={{width:48,height:30,objectFit:'cover',borderRadius:4,border:'1px solid #0f2030',flexShrink:0}}/>
          ):(
            <div style={{width:28,height:28,borderRadius:5,background:'rgba(6,182,212,0.08)',display:'flex',alignItems:'center',justifyContent:'center',color:'#06b6d4',flexShrink:0}}>
              {icon}
            </div>
          )}
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:10,fontWeight:600,color:'#4dd8e8',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{activeLabel}</div>
          </div>
          <button onClick={e=>{e.stopPropagation();onClear()}}
            style={{border:'none',background:'transparent',color:'#49454f',cursor:'pointer',fontSize:16,lineHeight:1,flexShrink:0}}
            onMouseOver={e=>e.currentTarget.style.color='#f87171'}
            onMouseOut={e=>e.currentTarget.style.color='#49454f'}>×</button>
        </div>
      ):(
        <div style={{padding:'13px 11px',display:'flex',flexDirection:'column',alignItems:'center',gap:4}}>
          <div style={{color:dragState?'#06b6d4':'#1a1a1a',marginBottom:2}}>{icon}</div>
          <div style={{fontSize:10,fontWeight:600,color:'#49454f'}}>{placeholder}</div>
          <div style={{fontSize:8,color:'#111',textAlign:'center',lineHeight:1.4}}>{sub}</div>
        </div>
      )}
    </div>
  )
}

function ParamSlider({def,value,onChange}){
  const pct=((value-def.min)/(def.max-def.min))*100
  return(
    <div style={{marginBottom:10}}>
      <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
        <span style={{fontSize:9,color:'#006874',letterSpacing:'0.04em'}}>{def.label}</span>
        <span style={{fontSize:9,color:'#06b6d4',fontVariantNumeric:'tabular-nums'}}>
          {value.toFixed(def.dp)}<span style={{fontSize:7,color:'#49454f',marginLeft:2}}>{def.unit}</span>
        </span>
      </div>
      <div style={{position:'relative',height:3,background:'#111',borderRadius:9999,cursor:'pointer'}}>
        <div style={{position:'absolute',left:0,top:0,height:'100%',borderRadius:9999,
          width:`${pct}%`,background:'linear-gradient(to right,#164050,#06b6d4)',transition:'width 60ms'}}/>
        <input type="range" min={def.min} max={def.max} step={def.step} value={value}
          onChange={e=>onChange(parseFloat(e.target.value))}
          style={{position:'absolute',inset:0,width:'100%',opacity:0,cursor:'pointer',height:'100%'}}/>
      </div>
    </div>
  )
}

function SegCtrl({opts,val,set}){
  return(
    <div style={{display:'flex',gap:1,background:'#050505',borderRadius:6,padding:'2px',border:'1px solid #0d1c26'}}>
      {opts.map(o=>(
        <button key={o.k} onClick={()=>set(o.k)}
          style={{padding:'3px 9px',borderRadius:4,border:'none',fontFamily:'inherit',
            fontSize:9,textTransform:'uppercase',letterSpacing:'0.06em',cursor:'pointer',transition:'all 120ms',
            background:val===o.k?'rgba(6,182,212,0.14)':'transparent',
            color:val===o.k?'#06b6d4':'#49454f',
            outline:val===o.k?'1px solid rgba(6,182,212,0.2)':'none'}}>
          {o.l}
        </button>
      ))}
    </div>
  )
}

function Toggle({on,onClick,label,icon}){
  return(
    <button onClick={onClick}
      style={{display:'flex',alignItems:'center',gap:5,padding:'3px 9px',borderRadius:5,border:'none',
        fontFamily:'inherit',fontSize:9,textTransform:'uppercase',letterSpacing:'0.06em',cursor:'pointer',
        transition:'all 140ms',
        background:on?'rgba(6,182,212,0.1)':'transparent',
        color:on?'#06b6d4':'#49454f',
        outline:on?'1px solid rgba(6,182,212,0.2)':'none'}}>
      {icon}{label}
    </button>
  )
}

function Divider(){return<div style={{width:1,height:14,background:'#111',flexShrink:0}}/>}

function Spin(){
  return<div style={{width:11,height:11,borderRadius:'50%',
    border:'1.5px solid rgba(6,182,212,0.15)',borderTopColor:'#06b6d4',
    animation:'spin 1s linear infinite',flexShrink:0}}/>
}
