// Copyright (c) 2026 Rutej Talati. All rights reserved.

import { useMemo, useRef, useEffect, useState, useCallback } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, GizmoHelper, GizmoViewport, Grid, Line } from '@react-three/drei'
import * as THREE from 'three'
import { cpToColor } from '../lib/predict'

// ── Parsers ───────────────────────────────────────────────────────────────────
function parseSTL(buffer) {
  const view = new DataView(buffer)
  const numTris = view.getUint32(80, true)
  const isBinary = buffer.byteLength === 84 + numTris * 50
  if (isBinary) {
    const pos = new Float32Array(numTris * 9), nrm = new Float32Array(numTris * 9)
    for (let i = 0; i < numTris; i++) {
      const b = 84 + i * 50
      const nx = view.getFloat32(b, true), ny = view.getFloat32(b+4, true), nz = view.getFloat32(b+8, true)
      for (let v = 0; v < 3; v++) {
        const vb = b + 12 + v * 12, base = (i*3+v)*3
        pos[base] = view.getFloat32(vb,true); pos[base+1] = view.getFloat32(vb+4,true); pos[base+2] = view.getFloat32(vb+8,true)
        nrm[base] = nx; nrm[base+1] = ny; nrm[base+2] = nz
      }
    }
    return { positions: pos, normals: nrm }
  }
  const text = new TextDecoder().decode(buffer)
  const verts = [], norms = []
  const vRe = /vertex\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)/g
  const nRe = /facet normal\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)/g
  const nl = []; let nm
  while ((nm = nRe.exec(text)) !== null) nl.push([parseFloat(nm[1]),parseFloat(nm[2]),parseFloat(nm[3])])
  let vm, vi = 0
  while ((vm = vRe.exec(text)) !== null) {
    verts.push(parseFloat(vm[1]),parseFloat(vm[2]),parseFloat(vm[3]))
    const n2 = nl[Math.floor(vi/3)] || [0,1,0]; norms.push(...n2); vi++
  }
  return { positions: new Float32Array(verts), normals: new Float32Array(norms) }
}

function parseOBJ(text) {
  const v = [], vn = [], positions = [], normals = []
  for (const line of text.split('\n')) {
    const p = line.trim().split(/\s+/)
    if (p[0]==='v')  v.push(p.slice(1).map(Number))
    if (p[0]==='vn') vn.push(p.slice(1).map(Number))
    if (p[0]==='f') {
      const face = p.slice(1).map(tok => { const [vi,,ni]=tok.split('/').map(x=>parseInt(x)-1); return {vi,ni} })
      for (let i=1;i<face.length-1;i++) {
        for (const fv of [face[0],face[i],face[i+1]]) {
          positions.push(...(v[fv.vi]||[0,0,0])); normals.push(...(vn[fv.ni]||[0,1,0]))
        }
      }
    }
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals) }
}

// ── Cp physics ────────────────────────────────────────────────────────────────
function computeCp(positions, normals, Cd) {
  const n = positions.length/3
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity,minZ=Infinity,maxZ=-Infinity
  for (let i=0;i<n;i++) {
    const x=positions[i*3],y=positions[i*3+1],z=positions[i*3+2]
    if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;if(z<minZ)minZ=z;if(z>maxZ)maxZ=z
  }
  const L=maxX-minX||1, W=maxY-minY||1, H=maxZ-minZ||1, scale=Cd/0.30
  const cp = new Float32Array(n)
  for (let i=0;i<n;i++) {
    const t=(positions[i*3]-minX)/L, yw=(positions[i*3+1]-minY)/W, hz=(positions[i*3+2]-minZ)/H
    const nx=normals[i*3], ny=normals[i*3+1], nz=normals[i*3+2]
    const stag  = Math.max(0,(1-6*t*t)*Math.max(0,-nx))
    const roof  = -1.4*Math.sin(Math.PI*Math.min(t*1.3,1))*Math.pow(Math.max(0,hz),0.6)*Math.max(0,nz)
    const side  = -0.55*Math.sin(Math.PI*t*0.7)*(1-Math.abs(yw*2-1))*Math.abs(ny)*(hz>0.5?1:0)
    const under = hz<0.08 ? -0.4*Math.sin(Math.PI*t) : 0
    const wake  = t>0.82 ? -0.7*Math.pow((t-0.82)/0.18,0.7) : 0
    const wscr  = (t>0.15&&t<0.28&&hz>0.65) ? 0.25*nz : 0
    cp[i] = (stag+roof+side+under+wake+wscr)*scale
  }
  return cp
}

function computeVelocityMag(positions, normals) {
  const n=positions.length/3
  let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity
  for (let i=0;i<n;i++) { const x=positions[i*3],z=positions[i*3+2]; if(x<minX)minX=x;if(x>maxX)maxX=x;if(z<minZ)minZ=z;if(z>maxZ)maxZ=z }
  const L=maxX-minX||1, H=maxZ-minZ||1
  const vm = new Float32Array(n)
  for (let i=0;i<n;i++) {
    const t=(positions[i*3]-minX)/L, hz=(positions[i*3+2]-minZ)/H
    vm[i] = Math.max(0,Math.min(2,1+0.6*Math.sin(Math.PI*t)*Math.pow(hz,0.4)-0.3*Math.pow(Math.max(0,t-0.8)/0.2,2)))
  }
  return vm
}

function velColor(v) { return cpToColor(v-1.2) }

function buildGeometry(positions, normals, Cd, mode) {
  const geom = new THREE.BufferGeometry()
  const pos = positions.slice(), nrm = normals.slice()
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity,minZ=Infinity,maxZ=-Infinity
  for (let i=0;i<pos.length;i+=3) {
    if(pos[i]<minX)minX=pos[i];if(pos[i]>maxX)maxX=pos[i]
    if(pos[i+1]<minY)minY=pos[i+1];if(pos[i+1]>maxY)maxY=pos[i+1]
    if(pos[i+2]<minZ)minZ=pos[i+2];if(pos[i+2]>maxZ)maxZ=pos[i+2]
  }
  const cx=(minX+maxX)/2, cy=(minY+maxY)/2, cz=(minZ+maxZ)/2
  const maxDim=Math.max(maxX-minX,maxY-minY,maxZ-minZ)||1, sc=5.0/maxDim
  const groundLift=(maxZ-minZ)*sc*0.5
  for (let i=0;i<pos.length;i+=3) { pos[i]=(pos[i]-cx)*sc; pos[i+1]=(pos[i+1]-cy)*sc; pos[i+2]=(pos[i+2]-cz)*sc+groundLift }
  geom.setAttribute('position',new THREE.BufferAttribute(pos,3))
  geom.setAttribute('normal',new THREE.BufferAttribute(nrm,3))
  const n=pos.length/3, colors=new Float32Array(n*3)
  if (mode==='velocity') {
    const vm=computeVelocityMag(pos,nrm)
    for (let i=0;i<n;i++) { const [r,g,b]=velColor(vm[i]); colors[i*3]=r;colors[i*3+1]=g;colors[i*3+2]=b }
  } else {
    const cp=computeCp(pos,nrm,Cd)
    for (let i=0;i<n;i++) { const [r,g,b]=cpToColor(cp[i]); colors[i*3]=r;colors[i*3+1]=g;colors[i*3+2]=b }
  }
  geom.setAttribute('color',new THREE.BufferAttribute(colors,3))
  geom.computeBoundingBox(); geom.computeBoundingSphere()
  return geom
}

function CameraFit({ sphere }) {
  const { camera } = useThree()
  useEffect(() => {
    if (!sphere) return
    const { center, radius } = sphere
    const fov=camera.fov*(Math.PI/180), dist=(radius/Math.sin(fov/2))*1.4
    camera.position.set(center.x+dist*0.7,center.y-dist*0.45,center.z+dist*0.38)
    camera.near=dist*0.004; camera.far=dist*14; camera.updateProjectionMatrix()
  }, [sphere])
  return null
}

function Streamlines({ bbox }) {
  const lines = useMemo(() => {
    if (!bbox) return []
    const { min, max } = bbox
    const seeds = []
    for (let iy=0;iy<5;iy++) for (let iz=0;iz<4;iz++) {
      const y=min.y+(iy+0.5)*(max.y-min.y)/5, z=min.z+(iz+0.3)*(max.z-min.z)/4
      const pts = []; let px=min.x-0.5, py=y, pz=z
      for (let s=0;s<40;s++) {
        pts.push(new THREE.Vector3(px,py,pz))
        const tx=(px-min.x)/(max.x-min.x+0.001)
        py += -0.04*Math.sin(Math.PI*tx)*(py>0?1:-1)
        pz += 0.06*Math.sin(Math.PI*tx*0.8)*((pz-min.z)/(max.z-min.z+0.001)-0.3)*(s<25?1:-0.5)
        px += 0.28
      }
      seeds.push(pts)
    }
    return seeds
  }, [bbox])
  return (
    <group>
      {lines.map((pts,i) => <Line key={i} points={pts} color="var(--blue)" lineWidth={0.6} transparent opacity={0.18}/>)}
    </group>
  )
}

function CFDMesh({ meshData, Cd, renderMode, showStreamlines, clipX }) {
  const ref = useRef(), idleT = useRef(0)
  const { geom, sphere, bbox } = useMemo(() => {
    const g = buildGeometry(meshData.positions, meshData.normals, Cd, renderMode==='velocity'?'velocity':'cp')
    const bb = g.boundingBox
    return { geom:g, sphere:g.boundingSphere, bbox:bb?{min:bb.min,max:bb.max}:null }
  }, [meshData, Cd, renderMode])
  const clipPlane = useMemo(() => {
    if (!bbox||clipX>=1) return []
    return [new THREE.Plane(new THREE.Vector3(-1,0,0), bbox.min.x+(bbox.max.x-bbox.min.x)*clipX)]
  }, [bbox, clipX])
  useFrame((state,delta) => {
    const busy = state.controls?.isInteracting??false
    if (busy) { idleT.current=0; return }
    idleT.current += delta
    if (idleT.current>3&&ref.current) ref.current.rotation.z+=delta*0.018
  })
  return (
    <>
      <CameraFit sphere={sphere}/>
      {renderMode==='wire'&&<mesh ref={ref} geometry={geom}><meshBasicMaterial wireframe color="#0A84FF" transparent opacity={0.4}/></mesh>}
      {renderMode==='xray'&&<><mesh ref={ref} geometry={geom}><meshPhongMaterial color="#0D2535" transparent opacity={0.1} side={THREE.DoubleSide} depthWrite={false}/></mesh><mesh geometry={geom}><meshBasicMaterial wireframe color="#1A4060" transparent opacity={0.22}/></mesh></>}
      {(renderMode==='cp'||renderMode==='velocity')&&<mesh ref={ref} geometry={geom} clippingPlanes={clipPlane}><meshPhongMaterial vertexColors shininess={22} specular={new THREE.Color(0.1,0.1,0.1)} side={THREE.DoubleSide} clippingPlanes={clipPlane}/></mesh>}
      {showStreamlines&&bbox&&<Streamlines bbox={bbox}/>}
    </>
  )
}

function FallbackCar() {
  const ref = useRef()
  useFrame((_,d) => { if(ref.current) ref.current.rotation.z+=d*0.02 })
  return (
    <group ref={ref}>
      <mesh position={[0,0,0]}><boxGeometry args={[4.2,1.72,1.05]}/><meshBasicMaterial wireframe color="#1C3040" transparent opacity={0.5}/></mesh>
      <mesh position={[0.12,0,0.72]}><boxGeometry args={[1.95,1.42,0.62]}/><meshBasicMaterial wireframe color="#1C3040" transparent opacity={0.3}/></mesh>
      {[[-1.22,-0.88],[-1.22,0.88],[1.22,-0.88],[1.22,0.88]].map(([x,y],i)=>(
        <mesh key={i} position={[x,y,-0.35]} rotation={[Math.PI/2,0,0]}><cylinderGeometry args={[0.31,0.31,0.21,20]}/><meshBasicMaterial wireframe color="#243040" transparent opacity={0.35}/></mesh>
      ))}
      <mesh position={[-2.8,0,0.3]} rotation={[0,Math.PI/2,0]}><planeGeometry args={[2.2,1.6]}/><meshBasicMaterial color="#0A84FF" transparent opacity={0.04} side={THREE.DoubleSide}/></mesh>
    </group>
  )
}

function FlowArrows() {
  return (
    <>
      {[0.7,0.15,-0.4].map((z,i)=>(
        <group key={i} position={[-3.8,0,z]}>
          <mesh rotation={[0,0,-Math.PI/2]}><coneGeometry args={[0.065,0.2,10]}/><meshBasicMaterial color="#0A84FF" transparent opacity={0.6}/></mesh>
          <mesh position={[-0.2,0,0]} rotation={[0,0,Math.PI/2]}><cylinderGeometry args={[0.011,0.011,0.4,8]}/><meshBasicMaterial color="#0A84FF" transparent opacity={0.3}/></mesh>
        </group>
      ))}
    </>
  )
}

// ── Colour bar ─────────────────────────────────────────────────────────────────
function ColourBar({ mode, Cd }) {
  const labels = mode==='velocity' ? ['0.0','0.5','1.0','1.5','2.0'] : ['-1.5','-0.75','0','+0.5','+1.0']
  const title  = mode==='velocity' ? 'V/V∞' : 'Cp'
  return (
    <div style={{
      position:'absolute', right:12, top:'50%', transform:'translateY(-50%)',
      background:'rgba(0,0,0,0.75)', border:'0.5px solid rgba(255,255,255,0.08)',
      borderRadius:10, padding:'10px 8px', display:'flex', flexDirection:'column',
      alignItems:'center', gap:5, zIndex:10, backdropFilter:'blur(12px)',
    }}>
      <span style={{ fontSize:9, fontFamily:"'IBM Plex Mono',monospace", color:'var(--blue)', letterSpacing:'0.06em' }}>{title}</span>
      <div style={{ position:'relative', width:10, height:130 }}>
        <div style={{ width:10, height:130, borderRadius:5, background:'linear-gradient(to bottom,#ef4444,#fb923c,#fbbf24,#4ade80,#22d3ee,#3b82f6)' }}/>
        {labels.map((l,i)=>(
          <div key={i} style={{ position:'absolute', right:14, top:`${(i/(labels.length-1))*100}%`, transform:'translateY(-50%)', fontSize:8, fontFamily:"'IBM Plex Mono',monospace", color:'rgba(235,235,245,0.3)', whiteSpace:'nowrap' }}>{l}</div>
        ))}
        {labels.map((_,i)=>(
          <div key={i} style={{ position:'absolute', right:-3, width:5, height:0.5, background:'rgba(235,235,245,0.2)', top:`${(i/(labels.length-1))*100}%` }}/>
        ))}
      </div>
      {Cd&&<div style={{ marginTop:4, fontSize:8, fontFamily:"'IBM Plex Mono',monospace", color:'rgba(235,235,245,0.28)', textAlign:'center' }}>Cd {Cd.toFixed(3)}</div>}
    </div>
  )
}

// ── Camera presets ─────────────────────────────────────────────────────────────
const PRESETS = [
  { id:'iso',   label:'ISO',   pos:[7,-4.5,3.5], target:[0,0,0.6]   },
  { id:'side',  label:'Side',  pos:[0,12,1.5],   target:[0,0,1.0]   },
  { id:'front', label:'Front', pos:[9,0,1.5],    target:[0,0,1.0]   },
  { id:'top',   label:'Top',   pos:[0,0,12],     target:[0,0,0.6]   },
  { id:'rear',  label:'Rear',  pos:[-9,0,1.5],   target:[0,0,1.0]   },
]

function CameraController({ preset, controlsRef }) {
  const { camera } = useThree()
  const prevId = useRef(null)
  useEffect(() => {
    if (!preset||preset.id===prevId.current) return
    prevId.current = preset.id
    const startPos = camera.position.clone()
    const endPos   = new THREE.Vector3(...preset.pos)
    const startTgt = controlsRef.current?.target.clone() ?? new THREE.Vector3(...preset.target)
    const endTgt   = new THREE.Vector3(...preset.target)
    let t=0
    const step = () => {
      t = Math.min(1, t+0.06)
      const e = 1-Math.pow(1-t,3)
      camera.position.lerpVectors(startPos,endPos,e)
      if (controlsRef.current) { controlsRef.current.target.lerpVectors(startTgt,endTgt,e); controlsRef.current.update() }
      if (t<1) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }, [preset])
  return null
}

const MODES = [
  { id:'cp',       label:'Cp',     title:'Pressure Coeff.'  },
  { id:'velocity', label:'V/V∞',   title:'Velocity Mag.'    },
  { id:'wire',     label:'Mesh',   title:'Surface Mesh'     },
  { id:'xray',     label:'X-Ray',  title:'Transparent'      },
]

// ── ToolBtn ────────────────────────────────────────────────────────────────────
function ToolBtn({ active, onClick, children, title }) {
  return (
    <button onClick={onClick} title={title} style={{
      height:26, padding:'0 10px', borderRadius:6, border:'none', cursor:'pointer',
      fontSize:10, fontFamily:"'IBM Plex Sans',sans-serif", fontWeight: active?600:400,
      letterSpacing:'-0.1px',
      background: active ? 'rgba(10,132,255,0.22)' : 'transparent',
      color:      active ? 'var(--blue)' : 'rgba(235,235,245,0.35)',
      outline:    active ? '0.5px solid rgba(10,132,255,0.4)' : 'none',
      transition: 'background 0.12s, color 0.12s',
    }}>{children}</button>
  )
}

export default function CarViewer({ data, isLoading, uploadedFile }) {
  const [meshData,      setMeshData]      = useState(null)
  const [meshError,     setMeshError]     = useState(null)
  const [parsedFile,    setParsedFile]    = useState(null)
  const [renderMode,    setRenderMode]    = useState('cp')
  const [showStreams,   setShowStreams]   = useState(true)
  const [clipX,         setClipX]         = useState(1.0)
  const [triCount,      setTriCount]      = useState(0)
  const [parseProgress, setParseProgress] = useState(null)
  const [activePreset,  setActivePreset]  = useState(PRESETS[0])
  const controlsRef = useRef(null)

  useEffect(() => {
    if (!uploadedFile||uploadedFile===parsedFile) return
    setMeshError(null); setParseProgress('Parsing mesh…')
    const ext = uploadedFile.name.split('.').pop().toLowerCase()
    uploadedFile.arrayBuffer().then(buf => {
      try {
        let parsed
        if (ext==='stl') parsed=parseSTL(buf)
        else if (ext==='obj') parsed=parseOBJ(new TextDecoder().decode(buf))
        else throw new Error(`Unsupported: .${ext} — use STL or OBJ`)
        if (!parsed.positions.length) throw new Error('Mesh has no geometry')
        setMeshData(parsed); setTriCount(Math.round(parsed.positions.length/9))
        setParsedFile(uploadedFile); setParseProgress(null)
      } catch(e) { setMeshError(e.message); setMeshData(null); setParseProgress(null) }
    }).catch(e => { setMeshError(e.message); setParseProgress(null) })
  }, [uploadedFile])

  const Cd = data?.Cd ?? null

  const jumpPreset = useCallback((p) => setActivePreset({...p, _t:Date.now()}), [])

  return (
    <div style={{ position:'relative', width:'100%', height:'100%', background:'#030608', overflow:'hidden' }}>

      {/* CFD grid bg */}
      <div className="cfd-grid" style={{ position:'absolute', inset:0, pointerEvents:'none', zIndex:0 }}/>

      {/* Scan overlay */}
      {isLoading && (
        <div style={{ position:'absolute', inset:0, zIndex:15, pointerEvents:'none' }}>
          <div style={{ position:'absolute', insetInline:0, height:1, background:'var(--blue)', boxShadow:'0 0 20px 4px rgba(10,132,255,0.5)', animation:'scan 1.9s ease-in-out infinite' }}/>
          <div style={{ position:'absolute', inset:0, background:'rgba(10,132,255,0.02)', animation:'pulse 2s ease-in-out infinite' }}/>
        </div>
      )}

      {/* ── Top HUD ── */}
      <div style={{
        position:'absolute', top:0, left:0, right:0, height:40, zIndex:20,
        background:'rgba(0,0,0,0.82)', borderBottom:'0.5px solid rgba(255,255,255,0.07)',
        display:'flex', alignItems:'center', gap:0, backdropFilter:'blur(16px)',
      }}>
        {/* Axis */}
        <div style={{ padding:'0 14px', borderRight:'0.5px solid var(--sep)', display:'flex', alignItems:'center', gap:8, height:'100%' }}>
          <span style={{ fontSize:9, fontFamily:"'IBM Plex Mono',monospace", color:'var(--blue)', letterSpacing:'0.1em' }}>INFLOW +X</span>
          <span style={{ width:0.5, height:10, background:'var(--sep)', display:'inline-block' }}/>
          <span style={{ fontSize:9, fontFamily:"'IBM Plex Mono',monospace", color:'rgba(235,235,245,0.25)', letterSpacing:'0.1em' }}>UP +Z</span>
        </div>

        {/* Camera presets */}
        <div style={{ display:'flex', alignItems:'center', height:'100%', padding:'0 6px', gap:2, borderRight:'0.5px solid var(--sep)' }}>
          {PRESETS.map(p => (
            <button key={p.id} onClick={()=>jumpPreset(p)} style={{
              height:26, padding:'0 10px', borderRadius:6, border:'none', cursor:'pointer',
              fontSize:10, fontFamily:"'IBM Plex Sans',sans-serif", fontWeight: activePreset?.id===p.id?600:400,
              background: activePreset?.id===p.id ? 'rgba(10,132,255,0.2)' : 'transparent',
              color:      activePreset?.id===p.id ? 'var(--blue)' : 'rgba(235,235,245,0.3)',
              transition:'background 0.12s, color 0.12s',
            }}>{p.label}</button>
          ))}
        </div>

        {/* Render modes */}
        <div style={{ display:'flex', alignItems:'center', height:'100%', padding:'0 6px', gap:2 }}>
          {MODES.map(m => <ToolBtn key={m.id} active={renderMode===m.id} onClick={()=>setRenderMode(m.id)} title={m.title}>{m.label}</ToolBtn>)}
        </div>

        {/* Streamlines */}
        <div style={{ padding:'0 10px', borderLeft:'0.5px solid var(--sep)', display:'flex', alignItems:'center', gap:6 }}>
          <ToolBtn active={showStreams} onClick={()=>setShowStreams(s=>!s)} title="Toggle streamlines">Streamlines</ToolBtn>
        </div>

        {/* Clip plane */}
        {meshData && (
          <div style={{ padding:'0 12px', borderLeft:'0.5px solid var(--sep)', display:'flex', alignItems:'center', gap:8 }}>
            <span style={{ fontSize:9, fontFamily:"'IBM Plex Mono',monospace", color:'rgba(235,235,245,0.3)', letterSpacing:'0.08em' }}>CLIP X</span>
            <div style={{ position:'relative', width:72, height:18, display:'flex', alignItems:'center' }}>
              <div style={{ position:'absolute', left:0, right:0, height:2, borderRadius:9999, background:'var(--bg3)' }}>
                <div style={{ position:'absolute', left:0, top:0, height:'100%', borderRadius:9999, background:'var(--blue)', width:`${clipX*100}%` }}/>
              </div>
              <input type="range" min={0} max={1} step={0.01} value={clipX} onChange={e=>setClipX(parseFloat(e.target.value))} style={{ position:'absolute', inset:0, width:'100%', opacity:0, cursor:'pointer', zIndex:2 }}/>
              <div style={{ position:'absolute', top:'50%', transform:'translate(-50%,-50%)', left:`${clipX*100}%`, width:14, height:14, borderRadius:'50%', background:'#fff', boxShadow:'0 1px 5px rgba(0,0,0,0.5)', pointerEvents:'none', zIndex:1 }}/>
            </div>
            <span style={{ fontSize:9, fontFamily:"'IBM Plex Mono',monospace", color:'var(--blue)', width:28, textAlign:'right' }}>{Math.round(clipX*100)}%</span>
          </div>
        )}

        {/* Status right */}
        <div style={{ marginLeft:'auto', padding:'0 14px', display:'flex', alignItems:'center', gap:12 }}>
          {parseProgress && <span style={{ fontSize:9, fontFamily:"'IBM Plex Mono',monospace", color:'var(--orange)', letterSpacing:'0.08em', animation:'pulse 1.4s infinite' }}>{parseProgress}</span>}
          {meshData && <span style={{ fontSize:9, fontFamily:"'IBM Plex Mono',monospace", color:'rgba(235,235,245,0.25)' }}>{triCount.toLocaleString()} TRI</span>}
          {isLoading && <span style={{ fontSize:9, fontFamily:"'IBM Plex Mono',monospace", color:'var(--blue)', animation:'pulse 1.4s infinite' }}>INFERRING</span>}
          <div style={{ display:'flex', alignItems:'center', gap:5 }}>
            <span style={{ width:6, height:6, borderRadius:'50%', background:meshData?'var(--green)':'var(--bg4)', boxShadow:meshData?'0 0 5px var(--green)':'none', display:'inline-block', animation:meshData&&!isLoading?'pulse 2.5s ease-in-out infinite':'none' }}/>
            <span style={{ fontSize:9, fontFamily:"'IBM Plex Mono',monospace", color:meshData?'var(--green)':'rgba(235,235,245,0.2)', letterSpacing:'0.1em' }}>
              {isLoading?'SOLVING':meshData?'LIVE':'IDLE'}
            </span>
          </div>
        </div>
      </div>

      {/* ── Solver output — bottom left ── */}
      <div style={{
        position:'absolute', bottom:10, left:12, zIndex:20,
        background:'rgba(0,0,0,0.78)', border:'0.5px solid rgba(255,255,255,0.07)',
        borderRadius:9, padding:'9px 12px', backdropFilter:'blur(12px)',
        display:'flex', flexDirection:'column', gap:4,
      }}>
        <div style={{ fontSize:8, fontFamily:"'IBM Plex Mono',monospace", color:'rgba(235,235,245,0.2)', letterSpacing:'0.12em', marginBottom:3 }}>SOLVER</div>
        {[
          ['Cd',      Cd?.toFixed(4)??'—'],
          ['Cl',      data?.Cl?.toFixed(4)??'—'],
          ['Source',  data?._source==='backend'?'AeroNet-NN':data?._source==='mock'?'Surrogate':'—'],
          ['Mesh',    triCount?triCount.toLocaleString()+'T':'—'],
        ].map(([k,v])=>(
          <div key={k} style={{ display:'flex', gap:10, alignItems:'baseline' }}>
            <span style={{ fontSize:8, fontFamily:"'IBM Plex Mono',monospace", color:'rgba(235,235,245,0.25)', width:40, letterSpacing:'0.08em' }}>{k}</span>
            <span style={{ fontSize:11, fontFamily:"'IBM Plex Mono',monospace", color:'var(--blue)', fontWeight:600, fontVariantNumeric:'tabular-nums' }}>{v}</span>
          </div>
        ))}
      </div>

      {/* Mouse hint — bottom right */}
      <div style={{
        position:'absolute', bottom:10, right:12, zIndex:20,
        background:'rgba(0,0,0,0.78)', border:'0.5px solid rgba(255,255,255,0.07)',
        borderRadius:8, padding:'5px 10px', display:'flex', gap:12,
        backdropFilter:'blur(12px)',
      }}>
        {[['LMB','Rotate'],['RMB','Pan'],['Scroll','Zoom']].map(([k,a])=>(
          <span key={k} style={{ fontSize:10, color:'rgba(235,235,245,0.25)', fontFamily:"'IBM Plex Sans',sans-serif" }}>
            <span style={{ color:'rgba(235,235,245,0.45)', fontWeight:600 }}>{k}</span> {a}
          </span>
        ))}
      </div>

      {/* Mesh error */}
      {meshError && (
        <div style={{ position:'absolute', top:50, left:'50%', transform:'translateX(-50%)', zIndex:30, background:'rgba(255,69,58,0.12)', border:'0.5px solid rgba(255,69,58,0.4)', borderRadius:8, padding:'8px 16px', fontSize:12, color:'var(--red)', fontFamily:"'IBM Plex Sans',sans-serif" }}>
          {meshError}
        </div>
      )}

      {/* Empty state */}
      {!meshData&&!parseProgress && (
        <div style={{ position:'absolute', top:'50%', left:'50%', transform:'translate(-50%,-50%)', zIndex:5, textAlign:'center', pointerEvents:'none' }}>
          <div style={{ fontSize:11, fontFamily:"'IBM Plex Mono',monospace", color:'rgba(235,235,245,0.15)', letterSpacing:'0.15em', lineHeight:2.4 }}>
            UPLOAD STL · OBJ
            <br/>
            <span style={{ fontSize:9, color:'rgba(235,235,245,0.08)' }}>Mesh rendered with physics-based Cp field</span>
          </div>
        </div>
      )}

      {/* Corner brackets */}
      {[{top:42,left:8},{top:42,right:8},{bottom:8,left:8},{bottom:8,right:8}].map((s,i)=>(
        <svg key={i} width={12} height={12} style={{ position:'absolute', zIndex:10, ...s, opacity:0.3 }}>
          <path d={i===0?'M2,8 L2,2 L8,2':i===1?'M4,2 L10,2 L10,8':i===2?'M2,4 L2,10 L8,10':'M4,10 L10,10 L10,4'} stroke="var(--blue)" strokeWidth="1.2" fill="none" strokeLinecap="round"/>
        </svg>
      ))}

      {/* Cp bar */}
      {meshData && <ColourBar mode={renderMode==='cp'?'cp':'velocity'} Cd={Cd}/>}

      {/* Canvas */}
      <Canvas
        style={{ position:'absolute', top:40, left:0, right:0, bottom:0 }}
        camera={{ position:[7,-4.5,3.5], fov:34, near:0.05, far:300 }}
        dpr={[1,1.5]} gl={{ antialias:true, alpha:false, localClippingEnabled:true }}
      >
        <color attach="background" args={['#030608']}/>
        <ambientLight intensity={0.5}/>
        <directionalLight position={[8,-3,10]} intensity={0.9} castShadow/>
        <directionalLight position={[-5,6,-4]} intensity={0.25} color="#A8D8F0"/>
        <directionalLight position={[0,-8,2]}  intensity={0.18} color="#6EC6E8"/>
        <Grid args={[40,40]} cellSize={0.5} cellThickness={0.3} cellColor="#0E1F2A" sectionSize={2.5} sectionThickness={0.6} sectionColor="#162633" fadeDistance={25} fadeStrength={1.2} infiniteGrid/>
        {meshData
          ? <CFDMesh meshData={meshData} Cd={Cd??0.30} renderMode={renderMode} showStreamlines={showStreams} clipX={clipX}/>
          : <FallbackCar/>
        }
        <FlowArrows/>
        <CameraController preset={activePreset} controlsRef={controlsRef}/>
        <OrbitControls ref={controlsRef} enablePan enableZoom enableRotate minDistance={0.3} maxDistance={80} target={[0,0,0.6]} makeDefault
          mouseButtons={{ LEFT:THREE.MOUSE.ROTATE, MIDDLE:THREE.MOUSE.DOLLY, RIGHT:THREE.MOUSE.PAN }}/>
        <GizmoHelper alignment="bottom-right" margin={[76,76]}>
          <GizmoViewport axisColors={['#FF453A','#30D158','#0A84FF']} labelColor="#030608"/>
        </GizmoHelper>
      </Canvas>

      <style>{`
        @keyframes scan { 0%{top:40px} 100%{top:100%} }
      `}</style>
    </div>
  )
}
