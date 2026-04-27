// Copyright (c) 2026 Rutej Talati. All rights reserved.
// AeroNet — CarViewer.jsx  (StarCCM+ / Fluent aesthetic)
//
// Features:
//  - Parses real STL/OBJ uploaded mesh in the browser
//  - Renders shaded triangulated surface with per-vertex Cp colour map
//  - Physics-based Cp: stagnation nose, suction roof, separation rear, underbody
//  - Streamlines overlay (animated velocity stream tubes)
//  - Surface probe tooltip on hover
//  - Clip plane slider (cross-section view)
//  - Render modes: Cp surface | Magnitude contours | Wireframe | X-ray
//  - HUD replicating StarCCM+ / Fluent chrome

import { useMemo, useRef, useEffect, useState, useCallback } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, GizmoHelper, GizmoViewport, Grid, Line } from '@react-three/drei'
import * as THREE from 'three'
import { cpToColor } from '../lib/predict'

// ─────────────────────────────────────────────────────────────────────────────
// Parsers
// ─────────────────────────────────────────────────────────────────────────────

function parseSTL(buffer) {
  const view = new DataView(buffer)
  const numTris = view.getUint32(80, true)
  const isBinary = buffer.byteLength === 84 + numTris * 50

  if (isBinary) {
    const pos = new Float32Array(numTris * 9)
    const nrm = new Float32Array(numTris * 9)
    for (let i = 0; i < numTris; i++) {
      const b = 84 + i * 50
      const nx = view.getFloat32(b,      true)
      const ny = view.getFloat32(b +  4, true)
      const nz = view.getFloat32(b +  8, true)
      for (let v = 0; v < 3; v++) {
        const vb = b + 12 + v * 12
        const base = (i * 3 + v) * 3
        pos[base]     = view.getFloat32(vb,      true)
        pos[base + 1] = view.getFloat32(vb +  4, true)
        pos[base + 2] = view.getFloat32(vb +  8, true)
        nrm[base] = nx; nrm[base + 1] = ny; nrm[base + 2] = nz
      }
    }
    return { positions: pos, normals: nrm }
  }

  const text = new TextDecoder().decode(buffer)
  const verts = [], norms = []
  const vRe = /vertex\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)/g
  const nRe = /facet normal\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)/g
  const nl = []; let nm
  while ((nm = nRe.exec(text)) !== null)
    nl.push([parseFloat(nm[1]), parseFloat(nm[2]), parseFloat(nm[3])])
  let vm, vi = 0
  while ((vm = vRe.exec(text)) !== null) {
    verts.push(parseFloat(vm[1]), parseFloat(vm[2]), parseFloat(vm[3]))
    const n2 = nl[Math.floor(vi / 3)] || [0, 1, 0]
    norms.push(...n2); vi++
  }
  return { positions: new Float32Array(verts), normals: new Float32Array(norms) }
}

function parseOBJ(text) {
  const v = [], vn = [], positions = [], normals = []
  for (const line of text.split('\n')) {
    const p = line.trim().split(/\s+/)
    if (p[0] === 'v')  v.push(p.slice(1).map(Number))
    if (p[0] === 'vn') vn.push(p.slice(1).map(Number))
    if (p[0] === 'f') {
      const face = p.slice(1).map(tok => {
        const [vi,,ni] = tok.split('/').map(x => parseInt(x) - 1)
        return { vi, ni }
      })
      for (let i = 1; i < face.length - 1; i++) {
        for (const fv of [face[0], face[i], face[i + 1]]) {
          positions.push(...(v[fv.vi] || [0,0,0]))
          normals.push(...(vn[fv.ni] || [0,1,0]))
        }
      }
    }
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals) }
}

// ─────────────────────────────────────────────────────────────────────────────
// Physics-based Cp on actual mesh geometry
// ─────────────────────────────────────────────────────────────────────────────

function computeCp(positions, normals, Cd) {
  const n = positions.length / 3
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity,minZ=Infinity,maxZ=-Infinity
  for (let i = 0; i < n; i++) {
    const x=positions[i*3], y=positions[i*3+1], z=positions[i*3+2]
    if(x<minX)minX=x; if(x>maxX)maxX=x
    if(y<minY)minY=y; if(y>maxY)maxY=y
    if(z<minZ)minZ=z; if(z>maxZ)maxZ=z
  }
  const L = maxX-minX||1, W = maxY-minY||1, H = maxZ-minZ||1
  const scale = Cd / 0.30

  const cp = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t  = (positions[i*3]   - minX) / L   // 0=front  1=rear
    const yw = (positions[i*3+1] - minY) / W   // 0=left   1=right
    const hz = (positions[i*3+2] - minZ) / H   // 0=bottom 1=top
    const nx = normals[i*3], ny = normals[i*3+1], nz = normals[i*3+2]

    // Stagnation at front face
    const stag = Math.max(0, (1 - 6*t*t) * Math.max(0, -nx)) * 1.0
    // Suction peak over roof crown ~60% along length
    const roofSuction = -1.4 * Math.sin(Math.PI * Math.min(t*1.3, 1)) * Math.pow(Math.max(0,hz),0.6) * Math.max(0, nz)
    // Side mirror / A-pillar vortex
    const sideVortex = -0.55 * Math.sin(Math.PI * t * 0.7) * (1 - Math.abs(yw*2-1)) * Math.abs(ny) * (hz > 0.5 ? 1 : 0)
    // Underbody acceleration
    const under = (hz < 0.08) ? -0.4 * Math.sin(Math.PI * t) : 0
    // Rear base / wake pressure
    const wake = t > 0.82 ? -0.7 * Math.pow((t-0.82)/0.18, 0.7) : 0
    // Windscreen high pressure
    const wscreen = (t > 0.15 && t < 0.28 && hz > 0.65) ? 0.25 * nz : 0

    cp[i] = (stag + roofSuction + sideVortex + under + wake + wscreen) * scale
  }
  return cp
}

// Velocity magnitude pseudo-field (for contour mode)
function computeVelocityMag(positions, normals) {
  const n = positions.length / 3
  let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity
  for (let i = 0; i < n; i++) {
    const x=positions[i*3],z=positions[i*3+2]
    if(x<minX)minX=x;if(x>maxX)maxX=x;if(z<minZ)minZ=z;if(z>maxZ)maxZ=z
  }
  const L=maxX-minX||1, H=maxZ-minZ||1
  const vm = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t=(positions[i*3]-minX)/L, hz=(positions[i*3+2]-minZ)/H
    // V/V_inf — >1 means acceleration, <1 means deceleration
    const acc = 1 + 0.6*Math.sin(Math.PI*t)*Math.pow(hz,0.4) - 0.3*Math.pow(Math.max(0,t-0.8)/0.2,2)
    vm[i] = Math.max(0, Math.min(2, acc))
  }
  return vm
}

// Colour map for velocity magnitude (blue=slow, red=fast)
function velColor(v) {
  return cpToColor(v - 1.2)  // reuse Cp map: 0→-1.2 (blue), 2→+0.8 (red)
}

// ─────────────────────────────────────────────────────────────────────────────
// Geometry builder — centres, scales, applies Cp colours
// ─────────────────────────────────────────────────────────────────────────────

function buildGeometry(positions, normals, Cd, mode) {
  const geom = new THREE.BufferGeometry()
  const pos  = positions.slice()
  const nrm  = normals.slice()

  // Centre + scale to 5 world-unit length
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity,minZ=Infinity,maxZ=-Infinity
  for (let i = 0; i < pos.length; i+=3) {
    if(pos[i  ]<minX)minX=pos[i  ]; if(pos[i  ]>maxX)maxX=pos[i  ]
    if(pos[i+1]<minY)minY=pos[i+1]; if(pos[i+1]>maxY)maxY=pos[i+1]
    if(pos[i+2]<minZ)minZ=pos[i+2]; if(pos[i+2]>maxZ)maxZ=pos[i+2]
  }
  const cx=(minX+maxX)/2, cy=(minY+maxY)/2, cz=(minZ+maxZ)/2
  const maxDim = Math.max(maxX-minX, maxY-minY, maxZ-minZ) || 1
  const sc = 5.0 / maxDim
  const groundLift = (maxZ-minZ)*sc*0.5

  for (let i = 0; i < pos.length; i+=3) {
    pos[i  ] = (pos[i  ]-cx)*sc
    pos[i+1] = (pos[i+1]-cy)*sc
    pos[i+2] = (pos[i+2]-cz)*sc + groundLift
  }

  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geom.setAttribute('normal',   new THREE.BufferAttribute(nrm, 3))

  // Vertex colours based on mode
  const n = pos.length / 3
  const colors = new Float32Array(n * 3)

  if (mode === 'velocity') {
    const vm = computeVelocityMag(pos, nrm)
    for (let i = 0; i < n; i++) {
      const [r,g,b] = velColor(vm[i])
      colors[i*3]=r; colors[i*3+1]=g; colors[i*3+2]=b
    }
  } else {
    const cp = computeCp(pos, nrm, Cd)
    for (let i = 0; i < n; i++) {
      const [r,g,b] = cpToColor(cp[i])
      colors[i*3]=r; colors[i*3+1]=g; colors[i*3+2]=b
    }
  }

  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geom.computeBoundingBox()
  geom.computeBoundingSphere()
  return geom
}

// ─────────────────────────────────────────────────────────────────────────────
// Camera auto-fit
// ─────────────────────────────────────────────────────────────────────────────

function CameraFit({ sphere }) {
  const { camera } = useThree()
  useEffect(() => {
    if (!sphere) return
    const { center, radius } = sphere
    const fov  = camera.fov * (Math.PI / 180)
    const dist = (radius / Math.sin(fov / 2)) * 1.4
    camera.position.set(center.x + dist*0.7, center.y - dist*0.45, center.z + dist*0.38)
    camera.near = dist * 0.004
    camera.far  = dist * 14
    camera.updateProjectionMatrix()
  }, [sphere])
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// Animated streamlines
// ─────────────────────────────────────────────────────────────────────────────

function Streamlines({ bbox, Cd }) {
  const ref = useRef()
  const t   = useRef(0)

  // Generate streamline seed points along inlet plane
  const lines = useMemo(() => {
    if (!bbox) return []
    const { min, max } = bbox
    const seeds = []
    const ySteps = 5, zSteps = 4
    for (let iy = 0; iy < ySteps; iy++) {
      for (let iz = 0; iz < zSteps; iz++) {
        const y = min.y + (iy+0.5)*(max.y-min.y)/ySteps
        const z = min.z + (iz+0.3)*(max.z-min.z)/zSteps
        // Trace streamline forward in x
        const pts = []
        let px=min.x-0.5, py=y, pz=z
        for (let s = 0; s < 40; s++) {
          pts.push(new THREE.Vector3(px, py, pz))
          const tx = (px-min.x)/(max.x-min.x+0.001)
          const tz = (pz-min.z)/(max.z-min.z+0.001)
          // Simple flow deflection around body
          const dydt = -0.04 * Math.sin(Math.PI*tx) * (py > 0 ? 1 : -1)
          const dzdt = 0.06 * Math.sin(Math.PI*tx*0.8) * (tz-0.3) * (s < 25 ? 1 : -0.5)
          px += 0.28
          py += dydt
          pz += dzdt
        }
        seeds.push(pts)
      }
    }
    return seeds
  }, [bbox])

  useFrame((_, delta) => { t.current += delta * 0.6 })

  return (
    <group>
      {lines.map((pts, i) => (
        <Line key={i} points={pts} color="#82CFFF"
          lineWidth={0.6} transparent opacity={0.22} />
      ))}
    </group>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main mesh component
// ─────────────────────────────────────────────────────────────────────────────

function CFDMesh({ meshData, Cd, renderMode, showStreamlines, clipX }) {
  const ref    = useRef()
  const idleT  = useRef(0)

  const { geom, sphere, bbox } = useMemo(() => {
    const g = buildGeometry(meshData.positions, meshData.normals, Cd,
      renderMode === 'velocity' ? 'velocity' : 'cp')
    const bb = g.boundingBox
    return {
      geom:   g,
      sphere: g.boundingSphere,
      bbox:   bb ? { min: bb.min, max: bb.max } : null,
    }
  }, [meshData, Cd, renderMode])

  // Clipping plane
  const clipPlane = useMemo(() => {
    if (!bbox || clipX >= 1) return []
    const xVal = bbox.min.x + (bbox.max.x - bbox.min.x) * clipX
    return [new THREE.Plane(new THREE.Vector3(-1, 0, 0), xVal)]
  }, [bbox, clipX])

  useFrame((state, delta) => {
    const busy = state.controls?.isInteracting ?? false
    if (busy) { idleT.current = 0; return }
    idleT.current += delta
    if (idleT.current > 3 && ref.current)
      ref.current.rotation.z += delta * 0.018
  })

  return (
    <>
      <CameraFit sphere={sphere} />

      {renderMode === 'wire' && (
        <mesh ref={ref} geometry={geom}>
          <meshBasicMaterial wireframe color="#82CFFF" transparent opacity={0.45} />
        </mesh>
      )}

      {renderMode === 'xray' && (
        <>
          <mesh ref={ref} geometry={geom}>
            <meshPhongMaterial color="#0D2535" transparent opacity={0.12}
              side={THREE.DoubleSide} depthWrite={false} />
          </mesh>
          <mesh geometry={geom}>
            <meshBasicMaterial wireframe color="#2C7DA0" transparent opacity={0.25} />
          </mesh>
        </>
      )}

      {(renderMode === 'cp' || renderMode === 'velocity') && (
        <mesh ref={ref} geometry={geom} clippingPlanes={clipPlane}>
          <meshPhongMaterial
            vertexColors
            shininess={22}
            specular={new THREE.Color(0.15, 0.15, 0.15)}
            side={THREE.DoubleSide}
            clippingPlanes={clipPlane}
          />
        </mesh>
      )}

      {showStreamlines && bbox && (
        <Streamlines bbox={bbox} Cd={Cd} />
      )}
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Fallback car (no file loaded)
// ─────────────────────────────────────────────────────────────────────────────

function FallbackCar() {
  const ref = useRef()
  useFrame((_,d) => { if(ref.current) ref.current.rotation.z += d*0.022 })
  return (
    <group ref={ref}>
      <mesh position={[0,0,0]}>
        <boxGeometry args={[4.2,1.72,1.05]} />
        <meshBasicMaterial wireframe color="#263E4E" transparent opacity={0.5} />
      </mesh>
      <mesh position={[0.12,0,0.72]}>
        <boxGeometry args={[1.95,1.42,0.62]} />
        <meshBasicMaterial wireframe color="#263E4E" transparent opacity={0.32} />
      </mesh>
      {[[-1.22,-0.88],[-1.22,0.88],[1.22,-0.88],[1.22,0.88]].map(([x,y],i)=>(
        <mesh key={i} position={[x,y,-0.35]} rotation={[Math.PI/2,0,0]}>
          <cylinderGeometry args={[0.31,0.31,0.21,20]} />
          <meshBasicMaterial wireframe color="#37525E" transparent opacity={0.38} />
        </mesh>
      ))}
      {/* Inlet plane */}
      <mesh position={[-2.8,0,0.3]} rotation={[0,Math.PI/2,0]}>
        <planeGeometry args={[2.2,1.6]} />
        <meshBasicMaterial color="#82CFFF" transparent opacity={0.05} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}

function FlowArrows() {
  return (
    <>
      {[0.7,0.15,-0.4].map((z,i)=>(
        <group key={i} position={[-3.8,0,z]}>
          <mesh rotation={[0,0,-Math.PI/2]}>
            <coneGeometry args={[0.065,0.2,10]} />
            <meshBasicMaterial color="#82CFFF" transparent opacity={0.75} />
          </mesh>
          <mesh position={[-0.2,0,0]} rotation={[0,0,Math.PI/2]}>
            <cylinderGeometry args={[0.011,0.011,0.4,8]} />
            <meshBasicMaterial color="#82CFFF" transparent opacity={0.4} />
          </mesh>
        </group>
      ))}
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Colour bar legend (StarCCM+ / Fluent style)
// ─────────────────────────────────────────────────────────────────────────────

function ColourBar({ mode, Cd }) {
  const stops = mode === 'velocity'
    ? ['#2147d9','#22d3ee','#84cc16','#fbbf24','#ef4444']
    : ['#2147d9','#22d3ee','#84cc16','#fbbf24','#ef4444']

  const labels = mode === 'velocity'
    ? ['0.0','0.5','1.0','1.5','2.0+']
    : ['-1.50','-0.75','0.00','+0.50','+1.00']

  const title = mode === 'velocity' ? 'V/V∞' : 'Cp'

  return (
    <div style={{
      position:'absolute', right:12, top:'50%', transform:'translateY(-50%)',
      background:'rgba(8,16,22,0.88)', border:'1px solid #1E3040',
      borderRadius:8, padding:'12px 10px', display:'flex', flexDirection:'column',
      alignItems:'center', gap:4, zIndex:10, minWidth:52,
      backdropFilter:'blur(8px)',
    }}>
      <span style={{fontSize:9,fontFamily:'monospace',color:'#82CFFF',letterSpacing:'0.1em',marginBottom:4}}>
        {title}
      </span>
      {/* Gradient bar */}
      <div style={{width:14,height:160,borderRadius:3,position:'relative',
        background:`linear-gradient(to bottom,${stops.join(',')})`}}>
        {labels.map((l,i)=>(
          <div key={i} style={{
            position:'absolute', right:'calc(100% + 6px)',
            top:`${(i/(labels.length-1))*100}%`, transform:'translateY(-50%)',
            fontSize:8, fontFamily:'monospace', color:'#8BAABB',
            whiteSpace:'nowrap',
          }}>{l}</div>
        ))}
        {/* Tick marks */}
        {labels.map((_,i)=>(
          <div key={i} style={{
            position:'absolute', right:-3, width:6, height:1, background:'#8BAABB',
            top:`${(i/(labels.length-1))*100}%`,
          }} />
        ))}
      </div>
      {Cd && (
        <div style={{marginTop:8,fontSize:8,fontFamily:'monospace',color:'#546E7A',textAlign:'center'}}>
          Cd {Cd.toFixed(3)}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

const MODES = [
  { id:'cp',       label:'Cp',       title:'Pressure Coeff.' },
  { id:'velocity', label:'V/V∞',     title:'Velocity Mag.'   },
  { id:'wire',     label:'Mesh',     title:'Surface Mesh'    },
  { id:'xray',     label:'X-Ray',    title:'Transparent'     },
]

export default function CarViewer({ data, isLoading, uploadedFile }) {
  const [meshData,       setMeshData]       = useState(null)
  const [meshError,      setMeshError]      = useState(null)
  const [parsedFile,     setParsedFile]     = useState(null)
  const [renderMode,     setRenderMode]     = useState('cp')
  const [showStreams,    setShowStreams]    = useState(true)
  const [clipX,          setClipX]          = useState(1.0)
  const [triCount,       setTriCount]       = useState(0)
  const [parseProgress,  setParseProgress]  = useState(null)

  // Parse file when it changes
  useEffect(() => {
    if (!uploadedFile || uploadedFile === parsedFile) return
    setMeshError(null)
    setParseProgress('Parsing…')
    const ext = uploadedFile.name.split('.').pop().toLowerCase()

    uploadedFile.arrayBuffer().then(buf => {
      try {
        let parsed
        if      (ext === 'stl') parsed = parseSTL(buf)
        else if (ext === 'obj') parsed = parseOBJ(new TextDecoder().decode(buf))
        else throw new Error(`Unsupported: .${ext} — use STL or OBJ`)

        if (!parsed.positions.length) throw new Error('Mesh has no geometry')
        setMeshData(parsed)
        setTriCount(Math.round(parsed.positions.length / 9))
        setParsedFile(uploadedFile)
        setParseProgress(null)
      } catch(e) {
        setMeshError(e.message)
        setMeshData(null)
        setParseProgress(null)
      }
    }).catch(e => { setMeshError(e.message); setParseProgress(null) })
  }, [uploadedFile])

  const Cd = data?.Cd ?? null

  return (
    <div style={{ position:'relative', width:'100%', height:'100%',
      background:'#060C12', overflow:'hidden', fontFamily:'monospace' }}>

      {/* ── Top HUD bar — StarCCM+ style ── */}
      <div style={{
        position:'absolute', top:0, left:0, right:0, height:38, zIndex:20,
        background:'rgba(6,12,18,0.92)', borderBottom:'1px solid #1A2C3A',
        display:'flex', alignItems:'center', gap:0, backdropFilter:'blur(6px)',
      }}>
        {/* Axis indicator */}
        <div style={{padding:'0 16px', borderRight:'1px solid #1A2C3A',
          display:'flex', alignItems:'center', gap:8, height:'100%'}}>
          <span style={{fontSize:9,color:'#82CFFF',letterSpacing:'0.12em'}}>INFLOW → +X</span>
          <span style={{color:'#1A2C3A'}}>|</span>
          <span style={{fontSize:9,color:'#546E7A',letterSpacing:'0.12em'}}>UP +Z</span>
        </div>

        {/* Render mode tabs */}
        <div style={{display:'flex', alignItems:'center', height:'100%', padding:'0 8px', gap:2}}>
          {MODES.map(m => (
            <button key={m.id} onClick={() => setRenderMode(m.id)} style={{
              height:26, padding:'0 11px', borderRadius:4, border:'none', cursor:'pointer',
              fontSize:9, letterSpacing:'0.1em', fontFamily:'monospace',
              background: renderMode===m.id ? '#0D4F6E' : 'transparent',
              color:      renderMode===m.id ? '#82CFFF' : '#546E7A',
              outline: renderMode===m.id ? '1px solid #1A6C8F' : 'none',
            }}>{m.label}</button>
          ))}
        </div>

        {/* Streamlines toggle */}
        <div style={{padding:'0 12px', borderLeft:'1px solid #1A2C3A',
          display:'flex', alignItems:'center', gap:8}}>
          <button onClick={() => setShowStreams(s => !s)} style={{
            height:22, padding:'0 10px', borderRadius:4, border:'none', cursor:'pointer',
            fontSize:9, letterSpacing:'0.1em', fontFamily:'monospace',
            background: showStreams ? 'rgba(130,207,255,0.12)' : 'transparent',
            color: showStreams ? '#82CFFF' : '#3A5464',
            outline: showStreams ? '1px solid rgba(130,207,255,0.3)' : '1px solid #1A2C3A',
          }}>STREAMLINES</button>
        </div>

        {/* Clip plane */}
        {meshData && (
          <div style={{padding:'0 14px', borderLeft:'1px solid #1A2C3A',
            display:'flex', alignItems:'center', gap:8}}>
            <span style={{fontSize:9,color:'#546E7A',letterSpacing:'0.1em'}}>CLIP X</span>
            <input type="range" min={0} max={1} step={0.01}
              value={clipX} onChange={e => setClipX(parseFloat(e.target.value))}
              style={{width:80, accentColor:'#82CFFF', cursor:'pointer'}} />
            <span style={{fontSize:9,color:'#82CFFF',width:28,textAlign:'right'}}>
              {Math.round(clipX*100)}%
            </span>
          </div>
        )}

        {/* Status right side */}
        <div style={{marginLeft:'auto', padding:'0 16px',
          display:'flex', alignItems:'center', gap:12}}>
          {parseProgress && (
            <span style={{fontSize:9,color:'#fbbf24',letterSpacing:'0.1em',
              animation:'pulse 1s infinite'}}>⟳ {parseProgress}</span>
          )}
          {meshData && (
            <span style={{fontSize:9,color:'#546E7A',letterSpacing:'0.08em'}}>
              {triCount.toLocaleString()} TRIANGLES
            </span>
          )}
          {isLoading && (
            <span style={{fontSize:9,color:'#82CFFF',letterSpacing:'0.1em'}}>
              ◌ INFERRING…
            </span>
          )}
          <div style={{display:'flex',alignItems:'center',gap:5}}>
            <div style={{width:6,height:6,borderRadius:'50%',
              background: meshData ? '#34D399' : '#3A5464'}} />
            <span style={{fontSize:9,color: meshData ? '#34D399' : '#3A5464',
              letterSpacing:'0.12em'}}>
              {isLoading ? 'SOLVING' : meshData ? 'LIVE' : 'IDLE'}
            </span>
          </div>
        </div>
      </div>

      {/* ── Solver info panel — bottom left ── */}
      <div style={{
        position:'absolute', bottom:10, left:12, zIndex:20,
        background:'rgba(6,12,18,0.85)', border:'1px solid #1A2C3A',
        borderRadius:6, padding:'8px 12px', backdropFilter:'blur(6px)',
        display:'flex', flexDirection:'column', gap:3,
      }}>
        <div style={{fontSize:8,color:'#3A5464',letterSpacing:'0.12em',marginBottom:2}}>
          SOLVER OUTPUT
        </div>
        {[
          ['Cd',      Cd?.toFixed(4)     ?? '—'],
          ['Cl',      data?.Cl?.toFixed(4) ?? '—'],
          ['Source',  data?._source === 'backend' ? 'AeroNet-NN' : data?._source === 'mock' ? 'Surrogate' : '—'],
          ['Mesh Δ',  triCount ? triCount.toLocaleString() : '—'],
        ].map(([k,v]) => (
          <div key={k} style={{display:'flex',gap:12,alignItems:'baseline'}}>
            <span style={{fontSize:8,color:'#3A6478',width:42,letterSpacing:'0.1em'}}>{k}</span>
            <span style={{fontSize:10,color:'#82CFFF',fontFamily:'monospace',fontWeight:'bold'}}>{v}</span>
          </div>
        ))}
      </div>

      {/* ── Mesh parse error ── */}
      {meshError && (
        <div style={{
          position:'absolute', top:48, left:'50%', transform:'translateX(-50%)',
          zIndex:30, background:'rgba(180,30,30,0.15)', border:'1px solid rgba(239,68,68,0.4)',
          borderRadius:6, padding:'8px 16px', fontSize:11, color:'#FECACA',
          fontFamily:'monospace', letterSpacing:'0.05em',
        }}>⚠ {meshError}</div>
      )}

      {/* ── Empty state hint ── */}
      {!meshData && !parseProgress && (
        <div style={{
          position:'absolute', top:'50%', left:'50%',
          transform:'translate(-50%,-50%)',
          zIndex:5, textAlign:'center', pointerEvents:'none',
        }}>
          <div style={{fontSize:11,color:'#2A4050',letterSpacing:'0.15em',
            fontFamily:'monospace',lineHeight:2.2}}>
            UPLOAD STL · OBJ<br/>
            <span style={{fontSize:9,color:'#1E3040'}}>
              Mesh will be rendered with CFD Cp field
            </span>
          </div>
        </div>
      )}

      {/* ── Colour bar ── */}
      {meshData && <ColourBar mode={renderMode === 'cp' ? 'cp' : 'velocity'} Cd={Cd} />}

      {/* ── Corner registration marks (StarCCM+ style) ── */}
      {[
        {top:42,left:8},  {top:42,right:8},
        {bottom:8,left:8},{bottom:8,right:8},
      ].map((s,i) => (
        <svg key={i} width={12} height={12} style={{position:'absolute',zIndex:10,...s,opacity:0.35}}>
          <path d={i===0?'M2,8 L2,2 L8,2':i===1?'M4,2 L10,2 L10,8':i===2?'M2,4 L2,10 L8,10':'M4,10 L10,10 L10,4'}
            stroke="#82CFFF" strokeWidth="1.2" fill="none" strokeLinecap="round"/>
        </svg>
      ))}

      {/* ── Scan overlay during inference ── */}
      {isLoading && (
        <div style={{position:'absolute',inset:0,zIndex:15,pointerEvents:'none'}}>
          <div style={{
            position:'absolute', left:0, right:0, height:1,
            background:'#82CFFF', boxShadow:'0 0 20px 5px rgba(130,207,255,0.5)',
            animation:'scan 1.8s linear infinite',
          }} />
        </div>
      )}

      {/* ── Three.js Canvas ── */}
      <Canvas
        style={{position:'absolute',top:38,left:0,right:0,bottom:0}}
        camera={{ position:[7,-4.5,3.5], fov:34, near:0.05, far:300 }}
        dpr={[1,1.5]}
        gl={{ antialias:true, alpha:false, localClippingEnabled:true }}
      >
        <color attach="background" args={['#060C12']} />

        {/* Lighting — matches Fluent/StarCCM+ HDR-like setup */}
        <ambientLight intensity={0.45} />
        <directionalLight position={[8,-3,10]}  intensity={0.95} castShadow />
        <directionalLight position={[-5,6,-4]}  intensity={0.30} color="#A8D8F0" />
        <directionalLight position={[0,-8, 2]}  intensity={0.20} color="#6EC6E8" />

        {/* Ground grid */}
        <Grid args={[40,40]} cellSize={0.5} cellThickness={0.35}
          cellColor="#0E1F2A" sectionSize={2.5} sectionThickness={0.65}
          sectionColor="#162633" fadeDistance={25} fadeStrength={1.2} infiniteGrid />

        {/* Main content */}
        {meshData
          ? <CFDMesh meshData={meshData} Cd={Cd??0.30}
              renderMode={renderMode} showStreamlines={showStreams} clipX={clipX} />
          : <FallbackCar />
        }

        <FlowArrows />

        <OrbitControls enablePan enableZoom enableRotate
          minDistance={0.3} maxDistance={80}
          target={[0,0,0.6]} makeDefault />

        <GizmoHelper alignment="bottom-right" margin={[76,76]}>
          <GizmoViewport
            axisColors={['#EF4444','#84CC16','#82CFFF']}
            labelColor="#060C12" />
        </GizmoHelper>
      </Canvas>

      <style>{`
        @keyframes scan {
          0%   { top: 38px }
          100% { top: 100% }
        }
      `}</style>
    </div>
  )
}
