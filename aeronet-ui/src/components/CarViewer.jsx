/**
 * CarViewer.jsx — AeroNet 3D Viewer
 * 
 * Renders the ACTUAL uploaded mesh (STL/OBJ/PLY) using Three.js loaders.
 * Applies pressure-coefficient colour map to the real mesh geometry.
 * Falls back to parametric shape only when no mesh is loaded.
 */

import { useMemo, useRef, useEffect, useState, useCallback } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, GizmoHelper, GizmoViewport, Grid, Html } from '@react-three/drei'
import * as THREE from 'three'
import { cpToColor } from '../lib/predict'

// ── STL/OBJ/PLY Parser ──────────────────────────────────────────────────────

function parseSTL(buffer) {
  // Try binary first
  const view = new DataView(buffer)
  const numTriangles = view.getUint32(80, true)
  if (buffer.byteLength === 84 + numTriangles * 50) {
    const positions = new Float32Array(numTriangles * 9)
    const normals   = new Float32Array(numTriangles * 9)
    for (let i = 0; i < numTriangles; i++) {
      const base = 84 + i * 50
      const nx = view.getFloat32(base,      true)
      const ny = view.getFloat32(base +  4, true)
      const nz = view.getFloat32(base +  8, true)
      for (let v = 0; v < 3; v++) {
        const vbase = base + 12 + v * 12
        positions[(i * 3 + v) * 3 + 0] = view.getFloat32(vbase,      true)
        positions[(i * 3 + v) * 3 + 1] = view.getFloat32(vbase +  4, true)
        positions[(i * 3 + v) * 3 + 2] = view.getFloat32(vbase +  8, true)
        normals[  (i * 3 + v) * 3 + 0] = nx
        normals[  (i * 3 + v) * 3 + 1] = ny
        normals[  (i * 3 + v) * 3 + 2] = nz
      }
    }
    return { positions, normals }
  }
  // ASCII STL
  const text = new TextDecoder().decode(buffer)
  const verts = []
  const norms = []
  const vertRe  = /vertex\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)/g
  const normRe  = /facet normal\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)/g
  let vm, nm
  const normList = []
  while ((nm = normRe.exec(text)) !== null)
    normList.push([parseFloat(nm[1]), parseFloat(nm[2]), parseFloat(nm[3])])
  let ni = 0
  while ((vm = vertRe.exec(text)) !== null) {
    verts.push(parseFloat(vm[1]), parseFloat(vm[2]), parseFloat(vm[3]))
    const n = normList[Math.floor(ni / 3)] || [0, 1, 0]
    norms.push(...n)
    ni++
  }
  return { positions: new Float32Array(verts), normals: new Float32Array(norms) }
}

function parseOBJ(text) {
  const v = [], vn = [], positions = [], normals = []
  for (const line of text.split('\n')) {
    const parts = line.trim().split(/\s+/)
    if (parts[0] === 'v')  v.push(parts.slice(1).map(Number))
    if (parts[0] === 'vn') vn.push(parts.slice(1).map(Number))
    if (parts[0] === 'f') {
      const faceVerts = parts.slice(1).map(tok => {
        const [vi, , ni] = tok.split('/').map(x => parseInt(x) - 1)
        return { vi, ni }
      })
      for (let i = 1; i < faceVerts.length - 1; i++) {
        for (const fv of [faceVerts[0], faceVerts[i], faceVerts[i + 1]]) {
          const vv = v[fv.vi] || [0, 0, 0]
          positions.push(...vv)
          const nn = vn[fv.ni] || [0, 1, 0]
          normals.push(...nn)
        }
      }
    }
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals) }
}

async function loadMeshFromFile(file) {
  const buffer = await file.arrayBuffer()
  const ext = file.name.split('.').pop().toLowerCase()
  if (ext === 'stl') return parseSTL(buffer)
  if (ext === 'obj') return parseOBJ(new TextDecoder().decode(buffer))
  // PLY — binary or ASCII
  const text = new TextDecoder().decode(buffer.slice(0, 200))
  if (text.startsWith('ply')) {
    return parsePLY(buffer)
  }
  throw new Error(`Unsupported format: ${ext}`)
}

function parsePLY(buffer) {
  const header = new TextDecoder().decode(buffer.slice(0, 2048))
  const headerEnd = header.indexOf('end_header') + 'end_header\n'.length
  const vertCountMatch = header.match(/element vertex (\d+)/)
  const faceCountMatch = header.match(/element face (\d+)/)
  const nVerts = vertCountMatch ? parseInt(vertCountMatch[1]) : 0
  const nFaces = faceCountMatch ? parseInt(faceCountMatch[1]) : 0
  const isBinary = header.includes('binary_little_endian')
  if (!isBinary) {
    // ASCII PLY
    const lines = new TextDecoder().decode(buffer).split('\n')
    const dataStart = lines.findIndex(l => l.trim() === 'end_header') + 1
    const verts = []
    for (let i = dataStart; i < dataStart + nVerts; i++) {
      const p = lines[i].trim().split(/\s+/).map(Number)
      verts.push([p[0], p[1], p[2]])
    }
    const positions = [], normals = []
    for (let i = dataStart + nVerts; i < dataStart + nVerts + nFaces; i++) {
      const p = lines[i]?.trim().split(/\s+/).map(Number)
      if (!p || p[0] < 3) continue
      const count = p[0]
      for (let t = 1; t < count - 1; t++) {
        const tv = [verts[p[1]], verts[p[1+t]], verts[p[2+t]]]
        const ab = [tv[1][0]-tv[0][0], tv[1][1]-tv[0][1], tv[1][2]-tv[0][2]]
        const ac = [tv[2][0]-tv[0][0], tv[2][1]-tv[0][1], tv[2][2]-tv[0][2]]
        const nx = ab[1]*ac[2] - ab[2]*ac[1]
        const ny = ab[2]*ac[0] - ab[0]*ac[2]
        const nz = ab[0]*ac[1] - ab[1]*ac[0]
        for (const v of tv) { positions.push(...v); normals.push(nx, ny, nz) }
      }
    }
    return { positions: new Float32Array(positions), normals: new Float32Array(normals) }
  }
  // Binary PLY — simplified: assume x,y,z float32
  const view = new DataView(buffer)
  const dataOffset = new TextEncoder().encode(header.slice(0, headerEnd)).length
  const positions = [], normals = []
  let ptr = dataOffset
  const vData = []
  for (let i = 0; i < nVerts; i++) {
    vData.push([view.getFloat32(ptr, true), view.getFloat32(ptr+4, true), view.getFloat32(ptr+8, true)])
    ptr += 12
  }
  for (let i = 0; i < nFaces; i++) {
    const count = view.getUint8(ptr); ptr++
    const idxs = []
    for (let j = 0; j < count; j++) { idxs.push(view.getUint32(ptr, true)); ptr += 4 }
    for (let t = 1; t < count - 1; t++) {
      const tv = [vData[idxs[0]], vData[idxs[t]], vData[idxs[t+1]]]
      const ab = [tv[1][0]-tv[0][0], tv[1][1]-tv[0][1], tv[1][2]-tv[0][2]]
      const ac = [tv[2][0]-tv[0][0], tv[2][1]-tv[0][1], tv[2][2]-tv[0][2]]
      const nx = ab[1]*ac[2] - ab[2]*ac[1]
      const ny = ab[2]*ac[0] - ab[0]*ac[2]
      const nz = ab[0]*ac[1] - ab[1]*ac[0]
      for (const v of tv) { positions.push(...v); normals.push(nx, ny, nz) }
    }
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals) }
}

// ── Pressure simulation on real geometry ─────────────────────────────────────

function computePressureOnMesh(positions, normals, Cd = 0.3) {
  const n = positions.length / 3
  const pressures = new Float32Array(n)

  // Compute bounding box
  let minX = Infinity, maxX = -Infinity
  let minZ = Infinity, maxZ = -Infinity
  for (let i = 0; i < n; i++) {
    const x = positions[i * 3]
    const z = positions[i * 3 + 2]
    if (x < minX) minX = x; if (x > maxX) maxX = x
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
  }
  const L = maxX - minX || 1
  const H = maxZ - minZ || 1

  for (let i = 0; i < n; i++) {
    const x  = positions[i * 3]
    const z  = positions[i * 3 + 2]
    const nx = normals[i * 3]
    const nz = normals[i * 3 + 2]
    // Normalised position along car body
    const t = (x - minX) / L  // 0 = front, 1 = rear
    const h = (z - minZ) / H  // 0 = bottom, 1 = top

    // Bernoulli-style: stagnation at front, suction peak over roof, wake at rear
    const cpStag   = Math.max(0, (1 - 4 * t * t) * (1 - Math.abs(nx))) * 0.8
    const cpRoof   = -1.1 * Math.sin(Math.PI * t) * Math.pow(h, 0.6) * Math.max(0, -nz * 0.5 + 0.5)
    const cpUnderbody = h < 0.15 ? -0.3 * Math.sin(Math.PI * t) : 0
    const cpWake   = -0.7 * Math.max(0, t - 0.78) * 5
    const cpBase   = t > 0.9 ? -0.5 : 0
    const drag_scale = Cd / 0.30   // scale with predicted Cd

    pressures[i] = (cpStag + cpRoof + cpUnderbody + cpWake + cpBase) * drag_scale
  }
  return pressures
}

// ── 3D components ─────────────────────────────────────────────────────────────

function RealMesh({ meshData, Cd, isLoading, showMode }) {
  const ref = useRef()
  const rotRef = useRef()

  const geometry = useMemo(() => {
    const { positions, normals } = meshData
    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.BufferAttribute(positions.slice(), 3))
    geom.setAttribute('normal',   new THREE.BufferAttribute(normals.slice(),   3))

    // Compute pressure-based vertex colours
    const pressures = computePressureOnMesh(positions, normals, Cd)
    const colors = new Float32Array(pressures.length * 3)
    for (let i = 0; i < pressures.length; i++) {
      const [r, g, b] = cpToColor(pressures[i])
      colors[i * 3] = r; colors[i * 3 + 1] = g; colors[i * 3 + 2] = b
    }
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3))

    // Auto-centre and scale
    geom.computeBoundingBox()
    const bbox = geom.boundingBox
    const centre = new THREE.Vector3()
    bbox.getCenter(centre)
    const size = new THREE.Vector3()
    bbox.getSize(size)
    const maxDim = Math.max(size.x, size.y, size.z)
    const scale = 4.5 / maxDim

    // Translate to centre
    const pos = geom.attributes.position.array
    for (let i = 0; i < pos.length; i += 3) {
      pos[i]     = (pos[i]     - centre.x) * scale
      pos[i + 1] = (pos[i + 1] - centre.y) * scale
      pos[i + 2] = (pos[i + 2] - centre.z) * scale + (size.z * scale * 0.5)
    }
    geom.attributes.position.needsUpdate = true
    geom.computeBoundingBox()
    geom.computeBoundingSphere()
    return geom
  }, [meshData, Cd])

  // Slow auto-rotate when idle
  useFrame((state, delta) => {
    if (ref.current && !state.controls?.isInteracting)
      ref.current.rotation.z += delta * 0.05
  })

  if (showMode === 'wireframe') {
    return (
      <mesh ref={ref} geometry={geometry}>
        <meshBasicMaterial wireframe color="#82CFFF" transparent opacity={0.6} />
      </mesh>
    )
  }
  if (showMode === 'solid') {
    return (
      <mesh ref={ref} geometry={geometry}>
        <meshPhongMaterial color="#37474F" shininess={60} />
      </mesh>
    )
  }
  // Default: pressure-coloured surface
  return (
    <mesh ref={ref} geometry={geometry}>
      <meshPhongMaterial vertexColors shininess={30} transparent opacity={0.92} />
    </mesh>
  )
}

function EmptyStateMesh() {
  const ref = useRef()
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.z += delta * 0.04
  })
  return (
    <group ref={ref}>
      {/* Body */}
      <mesh position={[0, 0, 0.55]}>
        <boxGeometry args={[4.4, 1.8, 1.15]} />
        <meshBasicMaterial wireframe color="#37474F" transparent opacity={0.5} />
      </mesh>
      {/* Greenhouse */}
      <mesh position={[0.2, 0, 1.33]}>
        <boxGeometry args={[2.1, 1.48, 0.72]} />
        <meshBasicMaterial wireframe color="#37474F" transparent opacity={0.35} />
      </mesh>
      {/* Wheels */}
      {[[-1.3, -0.92], [-1.3, 0.92], [1.3, -0.92], [1.3, 0.92]].map(([x, y], i) => (
        <mesh key={i} position={[x, y, 0.2]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.3, 0.3, 0.22, 20]} />
          <meshBasicMaterial wireframe color="#546E7A" transparent opacity={0.4} />
        </mesh>
      ))}
      {/* Upload hint */}
      <Html center position={[0, 0, 1.8]}>
        <div style={{
          color: '#546E7A', fontSize: 11, textAlign: 'center',
          fontFamily: 'monospace', letterSpacing: '0.1em',
          textTransform: 'uppercase', whiteSpace: 'nowrap',
          background: 'rgba(10,10,10,0.7)', padding: '4px 10px', borderRadius: 4,
        }}>
          Upload STL · OBJ · PLY
        </div>
      </Html>
    </group>
  )
}

function FlowArrows() {
  return (
    <group>
      {[-0.7, 0, 0.7].map((y, i) => (
        <group key={i} position={[-3.8, y, 0.6]}>
          <mesh rotation={[0, 0, -Math.PI / 2]}>
            <coneGeometry args={[0.07, 0.22, 10]} />
            <meshBasicMaterial color="#82CFFF" transparent opacity={0.7} />
          </mesh>
          <mesh position={[-0.22, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.012, 0.012, 0.45, 8]} />
            <meshBasicMaterial color="#82CFFF" transparent opacity={0.4} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function CarViewer({ data, isLoading, uploadedFile }) {
  const [meshData, setMeshData]   = useState(null)
  const [meshError, setMeshError] = useState(null)
  const [showMode, setShowMode]   = useState('pressure') // pressure|wireframe|solid

  // Load mesh when file changes
  useEffect(() => {
    if (!uploadedFile) { setMeshData(null); return }
    setMeshError(null)
    loadMeshFromFile(uploadedFile)
      .then(setMeshData)
      .catch(err => {
        console.error('[CarViewer] Mesh load failed:', err)
        setMeshError(err.message)
      })
  }, [uploadedFile])

  // When a result arrives (with Cd), recompute colours on same mesh
  const Cd = data?.Cd ?? 0.3

  return (
    <div className="relative w-full h-full overflow-hidden cfd-grid" style={{ background: '#080C10' }}>

      {/* Scan line during inference */}
      {isLoading && (
        <div className="absolute inset-0 z-10 pointer-events-none">
          <div className="absolute inset-x-0 h-px animate-scan"
            style={{ background: '#82CFFF', boxShadow: '0 0 24px 6px rgba(130,207,255,0.55)' }} />
          <div className="absolute inset-0 animate-pulse" style={{ background: 'rgba(130,207,255,0.03)' }} />
        </div>
      )}

      {/* Top axis chip */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10
                      bg-md-surface-container-high rounded-full px-4 h-8 flex items-center gap-3
                      border border-md-outline-variant shadow-elevation-1">
        <span className="text-label-md text-md-primary uppercase tracking-wider">Inflow</span>
        <span className="text-body-sm text-md-on-surface-variant">→ +X</span>
        <span className="w-px h-3 bg-md-outline-variant" />
        <span className="text-label-md text-md-on-surface-variant uppercase tracking-wider">Up</span>
        <span className="text-body-sm text-md-on-surface-variant">+Z</span>
      </div>

      {/* View mode buttons */}
      <div className="absolute top-3 right-3 z-10 flex gap-1">
        {[
          { id: 'pressure',  label: 'Cp' },
          { id: 'solid',     label: 'Solid' },
          { id: 'wireframe', label: 'Wire' },
        ].map(m => (
          <button key={m.id} onClick={() => setShowMode(m.id)}
            className={`px-2.5 h-7 rounded-full text-label-sm transition-all border
              ${showMode === m.id
                ? 'bg-md-primary text-md-on-primary border-md-primary'
                : 'bg-md-surface-container-high text-md-on-surface-variant border-md-outline-variant hover:border-md-primary/60'}`}>
            {m.label}
          </button>
        ))}
      </div>

      {/* Cp colour bar */}
      {(meshData || data) && (
        <div className="absolute right-3 top-14 z-10 animate-fade-in
                        bg-md-surface-container-high rounded-lg p-3 flex flex-col items-center gap-2
                        border border-md-outline-variant shadow-elevation-1">
          <span className="text-label-sm text-md-on-surface-variant uppercase tracking-wider">Cp</span>
          <div className="w-3 h-32 rounded"
            style={{ background: 'linear-gradient(to bottom,#ef4444,#f97316,#fbbf24,#84cc16,#22d3ee,#2147d9)' }} />
          <div className="flex flex-col items-center text-label-sm text-md-on-surface-variant font-mono gap-1">
            <span>+1.0</span>
            <div className="flex-1 h-4" />
            <span>−1.5</span>
          </div>
        </div>
      )}

      {/* Status pill */}
      <div className="absolute bottom-3 left-3 z-10
                      bg-md-surface-container-high rounded-full px-3 h-7 flex items-center gap-2
                      border border-md-outline-variant">
        <span className={`w-2 h-2 rounded-full ${meshData ? 'animate-pulse-slow' : ''}`}
          style={{ background: meshData ? '#34D399' : '#546E7A' }} />
        <span className="text-label-sm text-md-on-surface-variant uppercase tracking-wider">
          {isLoading ? 'Inferring' : meshData ? (data ? `Cd ${Cd.toFixed(4)}` : 'Mesh Loaded') : 'Idle'}
        </span>
      </div>

      {/* Triangle count */}
      {meshData && (
        <div className="absolute bottom-3 right-3 z-10
                        bg-md-surface-container-high rounded-full px-3 h-7 flex items-center gap-2
                        border border-md-outline-variant">
          <span className="text-label-sm text-md-on-surface-variant font-mono">
            {(meshData.positions.length / 9).toLocaleString()}Δ
          </span>
        </div>
      )}

      {/* Mesh error */}
      {meshError && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20
                        bg-md-error/10 border border-md-error/40 rounded-lg p-4 text-center max-w-xs">
          <div className="text-label-sm text-md-error mb-1">Mesh parse error</div>
          <div className="text-body-sm text-md-on-surface-variant">{meshError}</div>
        </div>
      )}

      {/* Corner marks */}
      {['top-3 left-3','top-3 right-3 rotate-90','bottom-3 right-3 rotate-180','bottom-3 left-3 -rotate-90'].map((cls, i) => (
        <div key={i} className={`absolute z-10 pointer-events-none ${cls}`}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M2 6 L2 2 L6 2" stroke="#82CFFF" strokeWidth="1.5" opacity="0.45" strokeLinecap="round" />
          </svg>
        </div>
      ))}

      <Canvas camera={{ position: [7, 5, 4], fov: 36, near: 0.05, far: 200 }} dpr={[1, 2]}>
        <color attach="background" args={['#080C10']} />
        <ambientLight intensity={0.5} />
        <directionalLight position={[8, 6, 8]} intensity={0.8} />
        <directionalLight position={[-4, -2, 4]} intensity={0.3} color="#82CFFF" />

        <Grid args={[24, 24]} cellSize={0.5} cellThickness={0.4}
          cellColor="#141C20" sectionSize={2} sectionThickness={0.8}
          sectionColor="#1E2830" fadeDistance={18} fadeStrength={1} infiniteGrid />

        {meshData
          ? <RealMesh meshData={meshData} Cd={Cd} isLoading={isLoading} showMode={showMode} />
          : <EmptyStateMesh />
        }
        <FlowArrows />

        <OrbitControls enablePan enableZoom enableRotate minDistance={1} maxDistance={25} target={[0, 0, 0.8]} />
        <GizmoHelper alignment="bottom-right" margin={[72, 72]}>
          <GizmoViewport axisColors={['#ef4444', '#84cc16', '#82CFFF']} labelColor="#080C10" />
        </GizmoHelper>
      </Canvas>
    </div>
  )
}
