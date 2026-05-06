// CarViewer.jsx — Production CFD Viewer
// Features:
//   • Real mesh parsing: STL (binary+ASCII), OBJ, PLY — client-side, no server needed
//   • Three render modes: Wireframe / Solid+Cp / Point Cloud
//   • Cp pressure field mapped onto actual geometry vertices
//   • Animated flow streamlines over the surface
//   • AI Assistant panel (AeroMind /chat) with simulation context awareness
//   • Mesh statistics: face/vertex count, bbox dimensions, surface area
//   • Screenshot export
//   • Environment lighting toggle
//   • Fallback synthetic point cloud when no mesh uploaded
// Copyright (c) 2026 Rutej Talati. All rights reserved.

import { useMemo, useRef, useEffect, useState, useCallback, Suspense } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, GizmoHelper, GizmoViewport, Grid, Environment } from '@react-three/drei'
import * as THREE from 'three'
import { cpToColor } from '../lib/predict'

const BACKEND = import.meta.env?.VITE_AERONET_BACKEND ?? 'http://127.0.0.1:8000'

// ─────────────────────────────────────────────────────────────────────────────
// MESH PARSERS — client-side, zero server round-trip
// ─────────────────────────────────────────────────────────────────────────────

function parseSTL(buffer) {
  const dv = new DataView(buffer)
  const numTri = dv.getUint32(80, true)
  const expectedSize = 80 + 4 + numTri * 50
  const isBinary = buffer.byteLength === expectedSize && numTri > 0

  if (isBinary) {
    const positions = new Float32Array(numTri * 9)
    const normals   = new Float32Array(numTri * 9)
    let offset = 84
    for (let i = 0; i < numTri; i++) {
      const nx = dv.getFloat32(offset,   true)
      const ny = dv.getFloat32(offset+4, true)
      const nz = dv.getFloat32(offset+8, true)
      offset += 12
      for (let v = 0; v < 3; v++) {
        const base = i*9 + v*3
        positions[base]   = dv.getFloat32(offset,   true)
        positions[base+1] = dv.getFloat32(offset+4, true)
        positions[base+2] = dv.getFloat32(offset+8, true)
        normals[base] = nx; normals[base+1] = ny; normals[base+2] = nz
        offset += 12
      }
      offset += 2
    }
    return { positions, normals, faceCount: numTri }
  }

  // ASCII STL
  const text = new TextDecoder().decode(buffer)
  const verts = []
  const re = /vertex\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)/g
  let m
  while ((m = re.exec(text)) !== null)
    verts.push(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]))
  return { positions: new Float32Array(verts), normals: null, faceCount: verts.length / 9 }
}

function parseOBJ(buffer) {
  const text = new TextDecoder().decode(buffer)
  const verts = [], faces = []
  for (const line of text.split('\n')) {
    const p = line.trim().split(/\s+/)
    if (p[0] === 'v') verts.push(+p[1], +p[2], +p[3])
    if (p[0] === 'f') {
      const vs = p.slice(1).map(x => parseInt(x.split('/')[0]) - 1)
      for (let i = 1; i < vs.length - 1; i++) faces.push(vs[0], vs[i], vs[i+1])
    }
  }
  const numFaces = faces.length / 3
  const positions = new Float32Array(numFaces * 9)
  for (let i = 0; i < faces.length; i++) {
    const vi = faces[i] * 3
    positions[i*3]=verts[vi]; positions[i*3+1]=verts[vi+1]; positions[i*3+2]=verts[vi+2]
  }
  return { positions, normals: null, faceCount: numFaces }
}

function parsePLY(buffer) {
  const full = new TextDecoder().decode(buffer)
  const headerEnd = full.indexOf('end_header\n')
  if (headerEnd === -1) return null
  let numVerts = 0, numFaces = 0
  for (const line of full.slice(0, headerEnd).split('\n')) {
    if (line.startsWith('element vertex')) numVerts = parseInt(line.split(' ')[2])
    if (line.startsWith('element face'))   numFaces  = parseInt(line.split(' ')[2])
  }
  const body  = full.slice(headerEnd + 'end_header\n'.length)
  const lines = body.split('\n').filter(l => l.trim())
  const verts = []
  for (let i = 0; i < numVerts; i++) {
    const p = lines[i].trim().split(/\s+/)
    verts.push(+p[0], +p[1], +p[2])
  }
  const positions = new Float32Array(numFaces * 9)
  for (let i = 0; i < numFaces; i++) {
    const p  = lines[numVerts + i].trim().split(/\s+/)
    const vs = [parseInt(p[1]), parseInt(p[2]), parseInt(p[3])]
    for (let v = 0; v < 3; v++) {
      const vi = vs[v]*3, base = i*9+v*3
      positions[base]=verts[vi]; positions[base+1]=verts[vi+1]; positions[base+2]=verts[vi+2]
    }
  }
  return { positions, normals: null, faceCount: numFaces }
}

function parseMeshFile(buffer, filename) {
  const ext = filename.split('.').pop().toLowerCase()
  try {
    if (ext === 'stl') return parseSTL(buffer)
    if (ext === 'obj') return parseOBJ(buffer)
    if (ext === 'ply') return parsePLY(buffer)
  } catch(e) { console.error('Mesh parse error:', e) }
  return null
}

// Normalise mesh to fit in a ±1.5 box centred at origin
function normaliseMesh(positions) {
  let mnX=Infinity,mnY=Infinity,mnZ=Infinity,mxX=-Infinity,mxY=-Infinity,mxZ=-Infinity
  for (let i=0;i<positions.length;i+=3) {
    if(positions[i]   <mnX)mnX=positions[i];   if(positions[i]   >mxX)mxX=positions[i]
    if(positions[i+1] <mnY)mnY=positions[i+1]; if(positions[i+1] >mxY)mxY=positions[i+1]
    if(positions[i+2] <mnZ)mnZ=positions[i+2]; if(positions[i+2] >mxZ)mxZ=positions[i+2]
  }
  const cx=(mnX+mxX)/2,cy=(mnY+mxY)/2,cz=(mnZ+mxZ)/2
  const scale=3/Math.max(mxX-mnX,mxY-mnY,mxZ-mnZ,1e-6)
  const out=new Float32Array(positions.length)
  for(let i=0;i<positions.length;i+=3){out[i]=(positions[i]-cx)*scale;out[i+1]=(positions[i+1]-cy)*scale;out[i+2]=(positions[i+2]-cz)*scale}
  return {positions:out,bbox:{min:[mnX,mnY,mnZ],max:[mxX,mxY,mxZ]},scale,dims:{length:parseFloat((mxX-mnX).toFixed(3)),width:parseFloat((mxY-mnY).toFixed(3)),height:parseFloat((mxZ-mnZ).toFixed(3))}}
}

// Assign Cp colours to mesh vertices using physics-informed heuristic
function buildMeshGeometry(positions, cpField) {
  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geom.computeVertexNormals()

  const n = positions.length/3
  const colors = new Float32Array(n*3)
  const pts = cpField?.positions, pres = cpField?.pressures

  for (let i=0;i<n;i++) {
    const x=positions[i*3], y=positions[i*3+1], z=positions[i*3+2]
    let cp

    if (pts && pres) {
      // Nearest-neighbour interpolation from backend point cloud (sampled)
      let best=Infinity
      const step=Math.max(1,Math.floor(pts.length/3/300))
      for(let j=0;j<pts.length;j+=step*3){
        const d=(pts[j]-x)**2+(pts[j+1]-y)**2+(pts[j+2]-z)**2
        if(d<best){best=d;cp=pres[j/3]}
      }
    } else {
      // Physics heuristic: normalised x in [-1.5,+1.5]
      const tx = (x+1.5)/3
      cp = Math.max(0,1.0-5*tx*tx)                          // stagnation front
         - 1.2*Math.sin(Math.PI*tx)*Math.pow(Math.abs(z)+0.3,0.4) // suction roof/sides
         - 0.5*Math.max(0,tx-0.85)*5                        // wake
    }
    const [r,g,b]=cpToColor(Math.max(-1.5,Math.min(1.0,cp??0)))
    colors[i*3]=r;colors[i*3+1]=g;colors[i*3+2]=b
  }
  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geom.computeBoundingSphere()
  return geom
}

// ─────────────────────────────────────────────────────────────────────────────
// THREE.JS COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

function MeshObject({ meshData, cpField, renderMode, onStats }) {
  const { geometry, stats } = useMemo(() => {
    if (!meshData) return {geometry:null,stats:null}
    const {positions:raw,normals,faceCount}=meshData
    const norm=normaliseMesh(raw)
    const geom=buildMeshGeometry(norm.positions, cpField)

    // Surface area
    let area=0
    const p=norm.positions
    for(let i=0;i<p.length;i+=9){
      const ux=p[i+3]-p[i],uy=p[i+4]-p[i+1],uz=p[i+5]-p[i+2]
      const vx=p[i+6]-p[i],vy=p[i+7]-p[i+1],vz=p[i+8]-p[i+2]
      area+=Math.sqrt((uy*vz-uz*vy)**2+(uz*vx-ux*vz)**2+(ux*vy-uy*vx)**2)*0.5
    }
    const realArea=area/(norm.scale*norm.scale)
    const stats={faceCount,vertCount:p.length/3,bbox:norm.bbox,dims:norm.dims,surfaceArea:parseFloat(realArea.toFixed(3))}
    return {geometry:geom,stats}
  }, [meshData, cpField])

  useEffect(() => { if (stats && onStats) onStats(stats) }, [stats])
  if (!geometry) return null

  return (
    <group>
      {(renderMode==='solid'||renderMode==='both') && (
        <mesh geometry={geometry}>
          <meshStandardMaterial vertexColors side={THREE.DoubleSide} roughness={0.5} metalness={0.08} />
        </mesh>
      )}
      {(renderMode==='wire'||renderMode==='both') && (
        <mesh geometry={geometry}>
          <meshBasicMaterial wireframe color="#4dd8e8" transparent opacity={renderMode==='both'?0.1:0.55} />
        </mesh>
      )}
    </group>
  )
}

function PointCloudMesh({ pointsData }) {
  const ref=useRef()
  const geometry=useMemo(()=>{
    if(!pointsData?.positions) return null
    const pos=pointsData.positions instanceof Float32Array?pointsData.positions:Float32Array.from(pointsData.positions)
    const pres=pointsData.pressures instanceof Float32Array?pointsData.pressures:Float32Array.from(pointsData.pressures)
    const bbox=pointsData.bbox
    let np=pos
    if(bbox){
      const sc=4/Math.max(bbox.max[0]-bbox.min[0],bbox.max[1]-bbox.min[1],bbox.max[2]-bbox.min[2],1)
      const cx=(bbox.min[0]+bbox.max[0])/2,cy=(bbox.min[1]+bbox.max[1])/2,cz=(bbox.min[2]+bbox.max[2])/2
      np=new Float32Array(pos.length)
      for(let i=0;i<pos.length;i+=3){np[i]=(pos[i]-cx)*sc;np[i+1]=(pos[i+1]-cy)*sc;np[i+2]=(pos[i+2]-cz)*sc}
    }
    const geom=new THREE.BufferGeometry()
    geom.setAttribute('position',new THREE.BufferAttribute(np,3))
    const colors=new Float32Array(pres.length*3)
    for(let i=0;i<pres.length;i++){const[r,g,b]=cpToColor(pres[i]);colors[i*3]=r;colors[i*3+1]=g;colors[i*3+2]=b}
    geom.setAttribute('color',new THREE.BufferAttribute(colors,3))
    geom.computeBoundingSphere()
    return geom
  },[pointsData])
  useFrame((_,dt)=>{if(ref.current&&!_.controls?.isInteracting)ref.current.rotation.z+=dt*0.018})
  if(!geometry) return null
  return <points ref={ref} geometry={geometry}><pointsMaterial size={0.022} vertexColors sizeAttenuation transparent opacity={0.88}/></points>
}

function Streamlines({active}) {
  const groupRef=useRef()
  const lines=useMemo(()=>{
    if(!active)return[]
    return Array.from({length:12},(_,i)=>{
      const yOff=(i/11-0.5)*1.8, zOff=0.2+(i%3)*0.3
      const pts=[]
      let x=-2.8,y=yOff,z=zOff
      for(let s=0;s<45;s++){
        pts.push(new THREE.Vector3(x,y,z))
        const onCar=Math.abs(x)<1.4&&Math.abs(y)<1.1&&z<1.3
        x+=onCar?0.16:0.11
        y+=yOff>0?0.004:-0.004
        z+=(z<0.9&&Math.abs(x)<0.9)?0.013:0
        if(x>3.8)break
      }
      return pts
    })
  },[active])
  useFrame(({clock})=>{if(!groupRef.current||!active)return;const t=clock.getElapsedTime();groupRef.current.children.forEach((c,i)=>{if(c.material)c.material.dashOffset=-(t*0.4+i*0.22)%1})})
  if(!active||!lines.length)return null
  return(
    <group ref={groupRef}>
      {lines.map((pts,i)=>{
        const geom=new THREE.BufferGeometry().setFromPoints(pts)
        return(<line key={i} geometry={geom}><lineDashedMaterial color={['#0A84FF','#40CBE0','#82CFFF'][i%3]} dashSize={0.14} gapSize={0.07} transparent opacity={0.4}/></line>)
      })}
    </group>
  )
}

function EmptyState() {
  const g=useRef()
  useFrame(({clock})=>{if(g.current)g.current.rotation.y=Math.sin(clock.getElapsedTime()*0.28)*0.12})
  return(
    <group ref={g}>
      <mesh position={[0,0,0.3]}><boxGeometry args={[4,1.6,1.0]}/><meshBasicMaterial wireframe color="#1e2830" transparent opacity={0.5}/></mesh>
      <mesh position={[0.2,0,1.0]}><boxGeometry args={[2.0,1.3,0.7]}/><meshBasicMaterial wireframe color="#1e2830" transparent opacity={0.3}/></mesh>
      {[-1.5,-0.8,0.8,1.5].map((xp,i)=>(
        <mesh key={i} position={[xp,i%2===0?0.72:-0.72,-0.08]}><cylinderGeometry args={[0.36,0.36,0.24,24]}/><meshBasicMaterial wireframe color="#1e2830" transparent opacity={0.3}/></mesh>
      ))}
    </group>
  )
}

function CameraRig({meshLoaded}) {
  const{camera,controls}=useThree()
  useEffect(()=>{
    camera.position.set(meshLoaded?3.5:5,meshLoaded?2.5:3.5,meshLoaded?2.8:4)
    if(controls){controls.target.set(0,0,0.3);controls.update()}
    camera.updateProjectionMatrix()
  },[meshLoaded])
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// AI ASSISTANT
// ─────────────────────────────────────────────────────────────────────────────

const SUGGESTIONS=[
  "What does high pressure on the front mean?",
  "How can I reduce drag on this shape?",
  "Explain the Cp colour scale",
  "What's causing wake separation?",
  "Compare this Cd to a production car",
]

function AIAssistant({result,meshStats,open,onClose}) {
  const[msgs,setMsgs]=useState([{role:'assistant',text:"I'm AeroMind — your CFD co-pilot. I can explain pressure fields, interpret Cd values, suggest geometry improvements, and help you understand what the simulation reveals. What would you like to know?"}])
  const[input,setInput]=useState('')
  const[busy,setBusy]=useState(false)
  const endRef=useRef(null)

  useEffect(()=>{
    if(!result)return
    setMsgs(m=>[...m,{role:'system',text:`Prediction: Cd=${result.Cd}, Cl=${result.Cl??'—'}, confidence=${Math.round((result.confidence??0)*100)}%`}])
  },[result?.Cd])

  const ctx=()=>{
    let c='You are AeroMind, an expert CFD and automotive aerodynamics AI assistant. Write in flowing paragraphs, no bullet points. Be precise and explain the underlying physics clearly. '
    if(result)c+=`Current simulation: Cd=${result.Cd}, Cl=${result.Cl}, confidence=${Math.round((result.confidence??0)*100)}%, body type: ${result.bodyTypeLabel??'unknown'}. `
    if(meshStats)c+=`Mesh: ${meshStats.faceCount} faces, dimensions ${meshStats.dims.length}m × ${meshStats.dims.width}m × ${meshStats.dims.height}m. `
    return c
  }

  const send=async(text)=>{
    const msg=text??input.trim()
    if(!msg||busy)return
    setInput('')
    setMsgs(m=>[...m,{role:'user',text:msg},{role:'assistant',text:''}])
    setBusy(true)
    let buf=''
    try{
      const fd=new FormData();fd.append('message',`${ctx()}\n\nQuestion: ${msg}`)
      const res=await fetch(`${BACKEND}/chat`,{method:'POST',body:fd})
      if(!res.ok)throw new Error(`HTTP ${res.status}`)
      const reader=res.body.getReader(),dec=new TextDecoder()
      while(true){
        const{done,value}=await reader.read()
        if(done)break
        buf+=dec.decode(value,{stream:true})
        setMsgs(m=>{const c=[...m];c[c.length-1]={role:'assistant',text:buf};return c})
        endRef.current?.scrollIntoView({behavior:'smooth'})
      }
    }catch(e){
      setMsgs(m=>{const c=[...m];c[c.length-1]={role:'assistant',text:`Backend unavailable. Start the HuggingFace Space to enable AI chat. (${e.message})`};return c})
    }
    setBusy(false)
  }

  if(!open)return null
  const OC={background:'rgba(10,11,13,0.97)',backdropFilter:'blur(24px)',border:'0.5px solid rgba(10,132,255,0.22)',borderRadius:14,overflow:'hidden',boxShadow:'0 0 40px rgba(10,132,255,0.07),0 20px 60px rgba(0,0,0,0.5)',animation:'fadeIn 0.18s ease'}

  return(
    <div style={{position:'absolute',right:12,top:52,bottom:44,width:310,zIndex:50,display:'flex',flexDirection:'column',...OC}}>
      {/* Header */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'11px 14px',borderBottom:'0.5px solid rgba(255,255,255,0.06)',flexShrink:0}}>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <div style={{width:26,height:26,borderRadius:7,background:'rgba(10,132,255,0.15)',border:'0.5px solid rgba(10,132,255,0.4)',display:'flex',alignItems:'center',justifyContent:'center'}}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth="1.5"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3"/></svg>
          </div>
          <div>
            <div style={{fontSize:13,fontWeight:600,color:'var(--text-primary)',lineHeight:1}}>AeroMind</div>
            <div style={{fontSize:10,color:'var(--blue)',marginTop:2}}>CFD AI Assistant</div>
          </div>
        </div>
        <button onClick={onClose} style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-tertiary)',padding:4,borderRadius:6}}
          onMouseEnter={e=>e.currentTarget.style.color='var(--text-primary)'}
          onMouseLeave={e=>e.currentTarget.style.color='var(--text-tertiary)'}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      {/* Context pills */}
      {(result||meshStats)&&(
        <div style={{display:'flex',gap:5,padding:'7px 12px',borderBottom:'0.5px solid rgba(255,255,255,0.05)',flexShrink:0,flexWrap:'wrap'}}>
          {result&&<span style={{fontSize:10,padding:'3px 8px',borderRadius:6,background:'rgba(10,132,255,0.12)',color:'var(--blue)',fontFamily:"'IBM Plex Mono',monospace"}}>Cd {result.Cd}</span>}
          {meshStats&&<span style={{fontSize:10,padding:'3px 8px',borderRadius:6,background:'rgba(48,209,88,0.1)',color:'var(--green)',fontFamily:"'IBM Plex Mono',monospace"}}>{meshStats.faceCount.toLocaleString()}f</span>}
          {result?.confidence&&<span style={{fontSize:10,padding:'3px 8px',borderRadius:6,background:'rgba(255,159,10,0.1)',color:'var(--orange)',fontFamily:"'IBM Plex Mono',monospace"}}>{Math.round(result.confidence*100)}% conf</span>}
        </div>
      )}

      {/* Messages */}
      <div style={{flex:1,overflowY:'auto',padding:'12px 13px',display:'flex',flexDirection:'column',gap:9}}>
        {msgs.filter(m=>m.role!=='system').map((m,i)=>(
          <div key={i} style={{maxWidth:'90%',alignSelf:m.role==='user'?'flex-end':'flex-start',background:m.role==='user'?'rgba(10,132,255,0.18)':'rgba(255,255,255,0.05)',border:`0.5px solid ${m.role==='user'?'rgba(10,132,255,0.3)':'rgba(255,255,255,0.07)'}`,borderRadius:m.role==='user'?'12px 12px 3px 12px':'3px 12px 12px 12px',padding:'9px 11px',fontSize:12,lineHeight:1.55,color:'var(--text-secondary)'}}>
            {m.text||(<span style={{display:'inline-flex',gap:3}}>{[0,150,300].map(d=>(<span key={d} style={{width:5,height:5,borderRadius:'50%',background:'var(--blue)',animation:`pulse 1.2s ease-in-out ${d}ms infinite`}}/>))}</span>)}
          </div>
        ))}
        <div ref={endRef}/>
      </div>

      {/* Quick suggestions */}
      <div style={{padding:'6px 11px',flexShrink:0,display:'flex',gap:5,flexWrap:'wrap',borderTop:'0.5px solid rgba(255,255,255,0.05)'}}>
        {SUGGESTIONS.slice(0,3).map((s,i)=>(
          <button key={i} onClick={()=>send(s)} style={{fontSize:10,padding:'4px 9px',borderRadius:8,cursor:'pointer',background:'rgba(255,255,255,0.04)',border:'0.5px solid rgba(255,255,255,0.09)',color:'var(--text-tertiary)',fontFamily:"'IBM Plex Sans',sans-serif",transition:'all 0.12s',whiteSpace:'nowrap'}}
            onMouseEnter={e=>{e.currentTarget.style.background='rgba(10,132,255,0.1)';e.currentTarget.style.color='var(--blue)';e.currentTarget.style.borderColor='rgba(10,132,255,0.3)'}}
            onMouseLeave={e=>{e.currentTarget.style.background='rgba(255,255,255,0.04)';e.currentTarget.style.color='var(--text-tertiary)';e.currentTarget.style.borderColor='rgba(255,255,255,0.09)'}}>
            {s}
          </button>
        ))}
      </div>

      {/* Input */}
      <div style={{padding:'9px 11px',borderTop:'0.5px solid rgba(255,255,255,0.06)',display:'flex',gap:7,flexShrink:0}}>
        <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&send()}
          placeholder="Ask about the aerodynamics…"
          style={{flex:1,background:'rgba(255,255,255,0.05)',border:'0.5px solid rgba(255,255,255,0.1)',borderRadius:9,padding:'8px 11px',color:'var(--text-primary)',fontSize:12,outline:'none',fontFamily:"'IBM Plex Sans',sans-serif"}}
          onFocus={e=>e.target.style.borderColor='rgba(10,132,255,0.5)'}
          onBlur={e=>e.target.style.borderColor='rgba(255,255,255,0.1)'}/>
        <button onClick={()=>send()} disabled={!input.trim()||busy} style={{width:33,height:33,borderRadius:9,border:'none',cursor:'pointer',background:input.trim()&&!busy?'var(--blue)':'rgba(255,255,255,0.06)',color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',transition:'background 0.15s',flexShrink:0}}>
          {busy?<span style={{width:11,height:11,borderRadius:'50%',border:'2px solid rgba(255,255,255,0.3)',borderTopColor:'#fff',animation:'spin 0.85s linear infinite'}}/>:<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>}
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// STATS PANEL
// ─────────────────────────────────────────────────────────────────────────────

function StatsPanel({meshStats,result}) {
  if(!meshStats&&!result)return null
  const rows=[]
  if(meshStats){
    rows.push(['Faces',meshStats.faceCount.toLocaleString()],['Verts',meshStats.vertCount.toLocaleString()],['Length',`${meshStats.dims.length} m`],['Width',`${meshStats.dims.width} m`],['Height',`${meshStats.dims.height} m`],['Surface',`${meshStats.surfaceArea} m²`])
  }
  if(result){rows.push(['Cd',result.Cd?.toFixed(4)],['Cl',result.Cl?.toFixed(4)],['Drag',`${result.dragForceN?.toFixed(0)} N`],['Conf',`${Math.round((result.confidence??0)*100)}%`])}
  return(
    <div style={{position:'absolute',left:12,bottom:44,zIndex:20,background:'rgba(10,11,13,0.9)',backdropFilter:'blur(12px)',border:'0.5px solid rgba(255,255,255,0.07)',borderRadius:10,padding:'10px 12px',minWidth:148,animation:'fadeIn 0.2s ease'}}>
      <div style={{fontSize:9,fontWeight:600,letterSpacing:'0.08em',textTransform:'uppercase',color:'var(--text-quaternary)',marginBottom:8}}>Mesh Stats</div>
      {rows.map(([l,v])=>(
        <div key={l} style={{display:'flex',justifyContent:'space-between',gap:16,marginBottom:3}}>
          <span style={{fontSize:11,color:'var(--text-tertiary)'}}>{l}</span>
          <span style={{fontSize:11,color:'var(--text-primary)',fontFamily:"'IBM Plex Mono',monospace",fontWeight:500}}>{v}</span>
        </div>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// TOOLBAR
// ─────────────────────────────────────────────────────────────────────────────

function TB({icon,label,active,onClick,title}) {
  return(
    <button onClick={onClick} title={title??label} style={{display:'flex',alignItems:'center',gap:5,padding:'0 9px',height:28,borderRadius:7,border:`0.5px solid ${active?'rgba(10,132,255,0.35)':'transparent'}`,cursor:'pointer',background:active?'rgba(10,132,255,0.18)':'transparent',color:active?'var(--blue)':'var(--text-tertiary)',fontSize:11,fontFamily:"'IBM Plex Sans',sans-serif",fontWeight:active?600:400,transition:'all 0.12s',whiteSpace:'nowrap'}}
      onMouseEnter={e=>{if(!active){e.currentTarget.style.background='rgba(255,255,255,0.06)';e.currentTarget.style.color='var(--text-secondary)'}}}
      onMouseLeave={e=>{if(!active){e.currentTarget.style.background='transparent';e.currentTarget.style.color='var(--text-tertiary)'}}}>
      {icon}{label&&<span>{label}</span>}
    </button>
  )
}
const Sep=()=><div style={{width:0.5,height:14,background:'rgba(84,84,88,0.4)',margin:'0 2px',flexShrink:0}}/>

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────

export default function CarViewer({data,isLoading,uploadedFile,onMeshStats}) {
  const[meshData,  setMeshData]  = useState(null)
  const[parsing,   setParsing]   = useState(false)
  const[parseErr,  setParseErr]  = useState(null)
  const[meshStats, setMeshStats] = useState(null)
  const handleMeshStats = useCallback((s) => { setMeshStats(s); if (onMeshStats) onMeshStats(s) }, [onMeshStats])
  const[renderMode,setRenderMode]= useState('solid')
  const[showFlow,  setShowFlow]  = useState(false)
  const[showStats, setShowStats] = useState(false)
  const[showAI,    setShowAI]    = useState(false)
  const[showGrid,  setShowGrid]  = useState(true)
  const[envLight,  setEnvLight]  = useState(false)

  // Parse uploaded mesh file
  useEffect(()=>{
    if(!uploadedFile)return
    const ext=uploadedFile.name.split('.').pop().toLowerCase()
    if(!['stl','obj','ply'].includes(ext))return
    setParsing(true);setParseErr(null);setMeshData(null);setMeshStats(null)
    const reader=new FileReader()
    reader.onload=e=>{
      try{
        const parsed=parseMeshFile(e.target.result,uploadedFile.name)
        if(!parsed||parsed.positions.length===0){setParseErr('Could not parse mesh — check file format.')}
        else{setMeshData(parsed);setRenderMode('solid')}
      }catch(err){setParseErr(`Parse error: ${err.message}`)}
      setParsing(false)
    }
    reader.onerror=()=>{setParseErr('File read failed.');setParsing(false)}
    reader.readAsArrayBuffer(uploadedFile)
  },[uploadedFile])

  const cpField=useMemo(()=>{
    const pc=data?.pointCloud??data?.viewer?.points
    if(!pc?.positions)return null
    return{positions:pc.positions instanceof Float32Array?pc.positions:Float32Array.from(pc.positions),pressures:pc.pressures instanceof Float32Array?pc.pressures:Float32Array.from(pc.pressures)}
  },[data])

  const result=data?.Cd!=null?data:null
  const hasRealMesh=!!meshData
  const pointsData=data?.pointCloud??data?.viewer?.points

  const screenshot=()=>{
    const c=document.querySelector('#cfd-canvas canvas')
    if(!c)return
    const a=document.createElement('a');a.href=c.toDataURL('image/png');a.download='aeronet_render.png';a.click()
  }

  const OC={background:'rgba(10,11,13,0.88)',backdropFilter:'blur(14px)',WebkitBackdropFilter:'blur(14px)',border:'0.5px solid rgba(255,255,255,0.07)',borderRadius:10}

  // SVG icons inline
  const I = {
    solid:  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><polygon points="12 2 2 7 12 12 22 7"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>,
    wire:   <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>,
    both:   <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18"/></svg>,
    cloud:  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="9" r="1.5"/><circle cx="16" cy="12" r="1.5"/><circle cx="10" cy="17" r="1.5"/><circle cx="18" cy="6" r="1.5"/></svg>,
    flow:   <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 8c2-2 4-2 6 0s4 2 6 0M4 16c2-2 4-2 6 0s4 2 6 0"/></svg>,
    grid:   <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>,
    env:    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="5"/><path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>,
    stats:  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
    ai:     <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12"/></svg>,
    cam:    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="12" cy="12" r="4"/><path d="M8 3v2M16 3v2M8 19v2M16 19v2"/></svg>,
  }

  return(
    <div style={{position:'relative',width:'100%',height:'100%',overflow:'hidden',background:'#050608'}} className="cfd-grid">

      {/* Toolbar */}
      <div style={{position:'absolute',top:10,left:'50%',transform:'translateX(-50%)',zIndex:30,display:'flex',alignItems:'center',gap:2,...OC,padding:'4px 7px',boxShadow:'0 4px 24px rgba(0,0,0,0.45)'}}>
        {[{id:'solid',l:'Surface'},{id:'wire',l:'Wire'},{id:'both',l:'Both'},{id:'cloud',l:'Cloud'}].map(m=>(
          <TB key={m.id} icon={I[m.id]} label={m.l} active={renderMode===m.id} onClick={()=>setRenderMode(m.id)}/>
        ))}
        <Sep/>
        <TB icon={I.flow}  label="Flow"     active={showFlow}  onClick={()=>setShowFlow(f=>!f)}  title="Toggle streamlines"/>
        <TB icon={I.grid}  label="Grid"     active={showGrid}  onClick={()=>setShowGrid(g=>!g)}  title="Toggle ground grid"/>
        <TB icon={I.env}   label="Env"      active={envLight}  onClick={()=>setEnvLight(e=>!e)}  title="Environment lighting"/>
        <Sep/>
        <TB icon={I.stats} label="Stats"    active={showStats} onClick={()=>setShowStats(s=>!s)} title="Mesh statistics"/>
        <TB icon={I.ai}    label="AeroMind" active={showAI}    onClick={()=>setShowAI(a=>!a)}    title="AI assistant"/>
        <TB icon={I.cam}                    onClick={screenshot}                                  title="Save screenshot"/>
      </div>

      {/* Scan line / loading */}
      {(parsing||isLoading)&&(
        <div style={{position:'absolute',inset:0,zIndex:20,pointerEvents:'none'}}>
          <div className="anim-scan" style={{position:'absolute',left:0,right:0,height:1,background:'var(--teal)',boxShadow:'0 0 20px 4px rgba(64,203,224,0.5)'}}/>
          <div style={{position:'absolute',inset:0,background:'rgba(10,132,255,0.02)'}}/>
          <div style={{position:'absolute',bottom:52,left:'50%',transform:'translateX(-50%)',...OC,padding:'7px 15px',display:'flex',alignItems:'center',gap:8}}>
            <span style={{width:11,height:11,borderRadius:'50%',border:'2px solid rgba(10,132,255,0.3)',borderTopColor:'var(--blue)',animation:'spin 0.85s linear infinite',flexShrink:0}}/>
            <span style={{fontSize:12,color:'var(--text-secondary)'}}>{parsing?`Parsing ${uploadedFile?.name}…`:'Running inference…'}</span>
          </div>
        </div>
      )}

      {/* Parse error */}
      {parseErr&&(
        <div style={{position:'absolute',top:52,left:'50%',transform:'translateX(-50%)',zIndex:20,...OC,padding:'7px 13px',border:'0.5px solid rgba(255,69,58,0.4)',display:'flex',alignItems:'center',gap:7}}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <span style={{fontSize:12,color:'var(--red)'}}>{parseErr}</span>
        </div>
      )}

      {/* Mesh loaded badge */}
      {hasRealMesh&&!showStats&&(
        <div style={{position:'absolute',bottom:40,left:12,zIndex:20,...OC,padding:'6px 11px',display:'flex',alignItems:'center',gap:7}}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
          <span style={{fontSize:11,color:'var(--green)',fontWeight:500}}>{uploadedFile?.name}</span>
          {meshStats&&<span style={{fontSize:10,color:'var(--text-quaternary)',fontFamily:"'IBM Plex Mono',monospace"}}>{meshStats.faceCount.toLocaleString()}f</span>}
        </div>
      )}

      {/* Cp colorbar */}
      {(hasRealMesh||pointsData)&&(
        <div style={{...OC,position:'absolute',right:showAI?326:12,top:'50%',transform:'translateY(-50%)',zIndex:20,padding:'10px 10px',display:'flex',flexDirection:'column',alignItems:'center',gap:5,transition:'right 0.22s cubic-bezier(0.22,1,0.36,1)',animation:'fadeIn 0.3s ease both'}}>
          <span style={{fontSize:9,fontWeight:600,letterSpacing:'0.08em',textTransform:'uppercase',color:'var(--text-quaternary)'}}>Cp</span>
          <div style={{width:9,height:128,borderRadius:5,background:'linear-gradient(to bottom,#ef4444,#fbbf24 30%,#84cc16 50%,#22d3ee 75%,#1e3aaa)'}}/>
          {['+1.0','0.0','-1.5'].map((l,i)=><span key={l} style={{fontSize:9,color:'var(--text-tertiary)',fontFamily:"'IBM Plex Mono',monospace",marginTop:i===1?32:0}}>{l}</span>)}
        </div>
      )}

      {/* Axis labels */}
      <div style={{...OC,position:'absolute',top:52,left:12,zIndex:20,display:'flex',alignItems:'center',gap:7,padding:'0 11px',height:26}}>
        {[['X','#ef4444'],['Y','#84cc16'],['Z','#82CFFF']].map(([ax,col])=>(
          <span key={ax} style={{fontSize:11,fontWeight:700,color:col,fontFamily:"'IBM Plex Mono',monospace"}}>+{ax}</span>
        ))}
        <div style={{width:0.5,height:9,background:'var(--sep)'}}/>
        <span style={{fontSize:10,color:'var(--text-quaternary)'}}>{hasRealMesh?'Real mesh':'Synthetic'}</span>
      </div>

      {/* Status chip */}
      <div style={{...OC,position:'absolute',bottom:12,left:12,zIndex:20,display:'flex',alignItems:'center',gap:6,padding:'0 11px',height:24,borderRadius:12}}>
        <span style={{width:6,height:6,borderRadius:'50%',flexShrink:0,background:isLoading?'var(--orange)':hasRealMesh?'var(--green)':pointsData?'var(--blue)':'var(--bg4)',boxShadow:hasRealMesh?'0 0 5px var(--green)':pointsData?'0 0 5px var(--blue)':'none',...((isLoading||hasRealMesh||pointsData)?{animation:'pulse 2.5s ease-in-out infinite'}:{})}}/>
        <span style={{fontSize:10,fontWeight:500,textTransform:'uppercase',letterSpacing:'0.04em',color:'var(--text-tertiary)'}}>
          {isLoading?'Inferring':parsing?'Parsing':hasRealMesh?'Mesh · Live':pointsData?'Synthetic · Live':'Idle'}
        </span>
      </div>

      {/* Corner marks */}
      {[{t:52,l:12,r:'0deg'},{t:52,r:showAI?326:12,ro:'90deg'},{b:12,r:showAI?326:12,ro:'180deg'},{b:12,l:12,ro:'270deg'}].map(({t,b,l,r,ro},i)=>{
        const s={position:'absolute',zIndex:10,pointerEvents:'none'}
        if(t!==undefined)s.top=t;if(b!==undefined)s.bottom=b;if(l!==undefined)s.left=l;if(r!==undefined)s.right=r
        return(<div key={i} style={s}><svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{transform:`rotate(${ro??'0deg'})`,display:'block'}}><path d="M2 8L2 2L8 2" stroke="var(--teal)" strokeWidth="1.5" opacity="0.3" strokeLinecap="round"/></svg></div>)
      })}

      {/* Stats & AI panels */}
      {showStats&&<StatsPanel meshStats={meshStats} result={result}/>}
      <AIAssistant result={result} meshStats={meshStats} open={showAI} onClose={()=>setShowAI(false)}/>

      {/* Canvas */}
      <div id="cfd-canvas" style={{position:'absolute',inset:0}}>
        <Canvas camera={{position:[5,3.5,4],fov:38,near:0.001,far:500}} dpr={[1,2]} gl={{preserveDrawingBuffer:true}}>
          <color attach="background" args={['#050608']}/>
          <ambientLight intensity={envLight?0.15:0.45}/>
          <directionalLight position={[5,8,5]} intensity={envLight?0.25:0.75} castShadow/>
          <directionalLight position={[-3,-2,-3]} intensity={0.18}/>
          <pointLight position={[0,4,0]} intensity={0.25} color="#4dd8e8"/>
          {envLight&&<Environment preset="night"/>}
          {showGrid&&<Grid args={[20,20]} cellSize={0.3} cellThickness={0.3} cellColor="#191e22" sectionSize={1.5} sectionThickness={0.5} sectionColor="#1d2530" fadeDistance={12} fadeStrength={1} infiniteGrid/>}
          <Suspense fallback={null}>
            {hasRealMesh&&renderMode!=='cloud'&&<MeshObject meshData={meshData} cpField={cpField} renderMode={renderMode} onStats={handleMeshStats}/>}
            {(showGrid||!hasRealMesh||renderMode==='cloud')&&pointsData&&!hasRealMesh&&<PointCloudMesh pointsData={pointsData}/>}
            {renderMode==='cloud'&&pointsData&&<PointCloudMesh pointsData={pointsData}/>}
            {!hasRealMesh&&!pointsData&&!parsing&&<EmptyState/>}
            <Streamlines active={showFlow}/>
          </Suspense>
          <OrbitControls enablePan enableZoom enableRotate minDistance={0.1} maxDistance={30} target={[0,0,0.3]}/>
          <CameraRig meshLoaded={hasRealMesh}/>
          <GizmoHelper alignment="bottom-right" margin={[68,68]}><GizmoViewport axisColors={['#ef4444','#84cc16','#82CFFF']} labelColor="#050608"/></GizmoHelper>
        </Canvas>
      </div>

      {/* Empty state hint */}
      {!hasRealMesh&&!pointsData&&!parsing&&!isLoading&&(
        <div style={{position:'absolute',bottom:'28%',left:'50%',transform:'translateX(-50%)',zIndex:10,textAlign:'center',pointerEvents:'none'}}>
          <div style={{fontSize:12,color:'rgba(255,255,255,0.16)',marginBottom:3}}>Upload an STL, OBJ, or PLY to render the actual mesh</div>
          <div style={{fontSize:11,color:'rgba(255,255,255,0.09)'}}>or run simulation to see the synthetic Cp field</div>
        </div>
      )}
    </div>
  )
}
