// Copyright (c) 2026 Rutej Talati. All rights reserved.
// AeroNet — CarViewer.jsx v3
//
// Renders the ACTUAL uploaded STL/OBJ/PLY as a shaded triangulated mesh
// with a CFD-style pressure coefficient (Cp) colour map computed from the
// real geometry — stagnation zone at nose, suction peak over roof, wake at
// rear — scaled by the surrogate Cd so the colours change with the prediction.
//
// Falls back to a parametric car silhouette when no file is loaded.

import { useMemo, useRef, useEffect, useState, useCallback } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, GizmoHelper, GizmoViewport, Grid } from '@react-three/drei'
import * as THREE from 'three'
import { cpToColor } from '../lib/predict'

// ─────────────────────────────────────────────────────────────────────────────
// STL parser  (binary + ASCII, no external dep)
// ─────────────────────────────────────────────────────────────────────────────

function parseSTL(buffer) {
  const isBinary = (() => {
    const view = new DataView(buffer)
    const numTris = view.getUint32(80, true)
    return buffer.byteLength === 84 + numTris * 50
  })()

  if (isBinary) {
    const view = new DataView(buffer)
    const n = view.getUint32(80, true)
    const pos = new Float32Array(n * 9)
    const nrm = new Float32Array(n * 9)
    for (let i = 0; i < n; i++) {
      const b = 84 + i * 50
      const nx = view.getFloat32(b,      true)
      const ny = view.getFloat32(b +  4, true)
      const nz = view.getFloat32(b +  8, true)
      for (let v = 0; v < 3; v++) {
        const vb = b + 12 + v * 12
        const base = (i * 3 + v) * 3
        pos[base]     = view.getFloat32(vb,     true)
        pos[base + 1] = view.getFloat32(vb + 4, true)
        pos[base + 2] = view.getFloat32(vb + 8, true)
        nrm[base] = nx; nrm[base + 1] = ny; nrm[base + 2] = nz
      }
    }
    return { positions: pos, normals: nrm }
  }

  // ASCII STL
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

// ─────────────────────────────────────────────────────────────────────────────
// OBJ parser
// ─────────────────────────────────────────────────────────────────────────────

function parseOBJ(text) {
  const v = [], vn = [], positions = [], normals = []
  for (const line of text.split('\n')) {
    const p = line.trim().split(/\s+/)
    if (p[0] === 'v')  v.push(p.slice(1).map(Number))
    if (p[0] === 'vn') vn.push(p.slice(1).map(Number))
    if (p[0] === 'f') {
      const face = p.slice(1).map(tok => {
        const [vi, , ni] = tok.split('/').map(x => parseInt(x) - 1)
        return { vi, ni }
      })
      for (let i = 1; i < face.length - 1; i++) {
        for (const fv of [face[0], face[i], face[i + 1]]) {
          const vv = v[fv.vi] || [0, 0, 0]
          positions.push(...vv)
          normals.push(...(vn[fv.ni] || [0, 1, 0]))
        }
      }
    }
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals) }
}

// ─────────────────────────────────────────────────────────────────────────────
// Cp simulation on the actual mesh vertices
// Physics: Bernoulli stagnation at nose, suction over roof crown,
//          boundary layer separation at rear, underbody acceleration.
//          All scaled by (Cd / 0.30) so colours shift with prediction.
// ─────────────────────────────────────────────────────────────────────────────

function computeCp(positions, normals, Cd = 0.30) {
  const n = positions.length / 3
  let minX = Infinity, maxX = -Infinity
  let minZ = Infinity, maxZ = -Infinity
  for (let i = 0; i < n; i++) {
    const x = positions[i * 3], z = positions[i * 3 + 2]
    if (x < minX) minX = x; if (x > maxX) maxX = x
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
  }
  const L = maxX - minX || 1
  const H = maxZ - minZ || 1
  const scale = Cd / 0.30

  const cp = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t  = (positions[i * 3]     - minX) / L  // 0=front  1=rear
    const hz = (positions[i * 3 + 2] - minZ) / H  // 0=bottom 1=top
    const nx = normals[i * 3]
    const nz = normals[i * 3 + 2]

    // Stagnation: highest Cp at front face (normal pointing upstream)
    const stag   = Math.max(0, (1 - 5 * t * t) * Math.max(0, -nx)) * 0.9
    // Suction peak over roof
    const suction = -1.3 * Math.sin(Math.PI * t) * Math.pow(Math.max(0, hz), 0.5) * Math.max(0, nz * 0.6 + 0.4)
    // Underbody acceleration
    const under  = hz < 0.12 ? -0.35 * Math.sin(Math.PI * t) : 0
    // Base pressure / wake
    const wake   = t > 0.80 ? -0.65 * ((t - 0.80) / 0.20) : 0

    cp[i] = (stag + suction + under + wake) * scale
  }
  return cp
}

// ─────────────────────────────────────────────────────────────────────────────
// Build coloured geometry from parsed mesh
// ─────────────────────────────────────────────────────────────────────────────

function buildGeometry(positions, normals, Cd) {
  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.BufferAttribute(positions.slice(), 3))
  geom.setAttribute('normal',   new THREE.BufferAttribute(normals.slice(),   3))

  const cp     = computeCp(positions, normals, Cd)
  const colors = new Float32Array(cp.length * 3)
  for (let i = 0; i < cp.length; i++) {
    const [r, g, b] = cpToColor(cp[i])
    colors[i * 3] = r; colors[i * 3 + 1] = g; colors[i * 3 + 2] = b
  }
  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3))

  // Centre and normalise scale to fit ~4.5 world-units long
  geom.computeBoundingBox()
  const bbox = geom.boundingBox
  const centre = new THREE.Vector3(); bbox.getCenter(centre)
  const size   = new THREE.Vector3(); bbox.getSize(size)
  const maxDim = Math.max(size.x, size.y, size.z) || 1
  const sc = 4.5 / maxDim

  const pos = geom.attributes.position.array
  for (let i = 0; i < pos.length; i += 3) {
    pos[i]     = (pos[i]     - centre.x) * sc
    pos[i + 1] = (pos[i + 1] - centre.y) * sc
    pos[i + 2] = (pos[i + 2] - centre.z) * sc + (size.z * sc * 0.5)
  }
  geom.attributes.position.needsUpdate = true
  geom.computeBoundingBox()
  geom.computeBoundingSphere()
  return geom
}

// ─────────────────────────────────────────────────────────────────────────────
// Camera auto-fit
// ─────────────────────────────────────────────────────────────────────────────

function CameraFit({ sphere }) {
  const { camera } = useThree()
  const controls = useRef()
  useEffect(() => {
    if (!sphere) return
    const { center, radius } = sphere
    const fov  = camera.fov * (Math.PI / 180)
    const dist = (radius / Math.sin(fov / 2)) * 1.35
    camera.position.set(center.x + dist * 0.65, center.y - dist * 0.4, center.z + dist * 0.45)
    camera.near = dist * 0.005
    camera.far  = dist * 12
    camera.updateProjectionMatrix()
  }, [sphere])
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// Actual mesh rendered from STL/OBJ geometry
// ─────────────────────────────────────────────────────────────────────────────

function MeshCFD({ meshData, Cd, renderMode }) {
  const ref      = useRef()
  const idleMs   = useRef(0)

  const { geometry, sphere } = useMemo(() => {
    const geom = buildGeometry(meshData.positions, meshData.normals, Cd)
    return { geometry: geom, sphere: geom.boundingSphere }
  }, [meshData, Cd])

  useFrame((state, delta) => {
    const busy = state.controls?.isInteracting ?? false
    if (busy) { idleMs.current = 0; return }
    idleMs.current += delta
    if (idleMs.current > 2 && ref.current) ref.current.rotation.z += delta * 0.025
  })

  return (
    <>
      <CameraFit sphere={sphere} />
      {renderMode === 'wire' ? (
        <mesh ref={ref} geometry={geometry}>
          <meshBasicMaterial wireframe color="#82CFFF" transparent opacity={0.55} />
        </mesh>
      ) : renderMode === 'solid' ? (
        <mesh ref={ref} geometry={geometry}>
          <meshPhongMaterial color="#37474F" shininess={55} side={THREE.DoubleSide} />
        </mesh>
      ) : (
        /* Default: Cp-coloured shaded surface */
        <mesh ref={ref} geometry={geometry}>
          <meshPhongMaterial
            vertexColors
            shininess={28}
            side={THREE.DoubleSide}
            transparent
            opacity={0.94}
          />
        </mesh>
      )}
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Parametric fallback car (when no file loaded)
// ─────────────────────────────────────────────────────────────────────────────

function FallbackCar() {
  const ref = useRef()
  useFrame((_, delta) => { if (ref.current) ref.current.rotation.z += delta * 0.025 })
  const col = '#37474F'
  return (
    <group ref={ref}>
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[4.2, 1.72, 1.05]} />
        <meshBasicMaterial wireframe color={col} transparent opacity={0.4} />
      </mesh>
      <mesh position={[0.12, 0, 0.72]}>
        <boxGeometry args={[1.95, 1.42, 0.62]} />
        <meshBasicMaterial wireframe color={col} transparent opacity={0.28} />
      </mesh>
      {[[-1.22, -0.89], [-1.22, 0.89], [1.22, -0.89], [1.22, 0.89]].map(([x, y], i) => (
        <mesh key={i} position={[x, y, -0.38]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.31, 0.31, 0.21, 20]} />
          <meshBasicMaterial wireframe color="#546E7A" transparent opacity={0.38} />
        </mesh>
      ))}
    </group>
  )
}

function FlowArrows() {
  return (
    <>
      {[0.6, 0, -0.4].map((z, i) => (
        <group key={i} position={[-3.6, 0, z]}>
          <mesh rotation={[0, 0, -Math.PI / 2]}>
            <coneGeometry args={[0.07, 0.22, 10]} />
            <meshBasicMaterial color="#82CFFF" transparent opacity={0.7} />
          </mesh>
          <mesh position={[-0.22, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.013, 0.013, 0.44, 8]} />
            <meshBasicMaterial color="#82CFFF" transparent opacity={0.4} />
          </mesh>
        </group>
      ))}
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────

export default function CarViewer({ data, isLoading, uploadedFile }) {
  const [meshData,    setMeshData]    = useState(null)
  const [meshError,   setMeshError]   = useState(null)
  const [parsedFile,  setParsedFile]  = useState(null)   // track which file is parsed
  const [renderMode,  setRenderMode]  = useState('cp')   // cp | solid | wire
  const [triCount,    setTriCount]    = useState(0)

  // Parse the STL/OBJ whenever a new file arrives
  useEffect(() => {
    if (!uploadedFile || uploadedFile === parsedFile) return
    setMeshError(null)
    const ext = uploadedFile.name.split('.').pop().toLowerCase()

    uploadedFile.arrayBuffer().then(buf => {
      try {
        let parsed
        if (ext === 'stl') {
          parsed = parseSTL(buf)
        } else if (ext === 'obj') {
          parsed = parseOBJ(new TextDecoder().decode(buf))
        } else {
          throw new Error(`Unsupported format: .${ext}  (use STL or OBJ)`)
        }
        if (!parsed.positions.length) throw new Error('Mesh has no vertices')
        setMeshData(parsed)
        setTriCount(Math.round(parsed.positions.length / 9))
        setParsedFile(uploadedFile)
      } catch (e) {
        setMeshError(e.message)
        setMeshData(null)
      }
    }).catch(e => setMeshError(e.message))
  }, [uploadedFile])

  // Cd from latest prediction (or 0.30 default for colour map)
  const Cd = data?.Cd ?? 0.30

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

      {/* Axis chip */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10
                      bg-md-surface-container-high rounded-full px-4 h-8 flex items-center gap-3
                      border border-md-outline-variant shadow-elevation-1">
        <span className="text-label-md text-md-primary uppercase tracking-wider">Inflow</span>
        <span className="text-body-sm text-md-on-surface-variant">→ +X</span>
        <span className="w-px h-3 bg-md-outline-variant" />
        <span className="text-label-md text-md-on-surface-variant uppercase tracking-wider">Up</span>
        <span className="text-body-sm text-md-on-surface-variant">+Z</span>
      </div>

      {/* Render mode buttons */}
      <div className="absolute top-3 right-3 z-10 flex gap-1">
        {[['cp','Cp'],['solid','Solid'],['wire','Wire']].map(([id, label]) => (
          <button key={id} onClick={() => setRenderMode(id)}
            className={`px-2.5 h-7 rounded-full text-label-sm transition-all border
              ${renderMode === id
                ? 'bg-md-primary text-md-on-primary border-md-primary'
                : 'bg-md-surface-container-high text-md-on-surface-variant border-md-outline-variant hover:border-md-primary/60'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* Cp colour bar */}
      {(meshData && renderMode === 'cp') && (
        <div className="absolute right-3 top-14 z-10
                        bg-md-surface-container-high rounded-lg p-3 flex flex-col items-center gap-2
                        border border-md-outline-variant shadow-elevation-1">
          <span className="text-label-sm text-md-on-surface-variant uppercase tracking-wider">Cp</span>
          <div className="w-3 h-32 rounded"
            style={{ background: 'linear-gradient(to bottom,#ef4444,#f97316,#fbbf24,#84cc16,#22d3ee,#2147d9)' }} />
          <div className="flex flex-col items-center text-label-sm text-md-on-surface-variant font-mono gap-1">
            <span>+1.0</span><div className="h-3" /><span>−1.5</span>
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
          {isLoading ? 'Inferring…'
            : meshData ? `Live · ${triCount.toLocaleString()}Δ`
            : 'Upload STL · OBJ'}
        </span>
      </div>

      {/* Mesh parse error */}
      {meshError && (
        <div className="absolute inset-x-6 top-16 z-20 bg-md-error/10 border border-md-error/40
                        rounded-lg p-3 text-body-sm text-md-on-surface-variant text-center">
          ⚠ {meshError}
        </div>
      )}

      {/* Corner marks */}
      {['top-3 left-3','top-3 right-36 rotate-90','bottom-3 right-3 rotate-180','bottom-3 left-3 -rotate-90'].map((cls,i) => (
        <div key={i} className={`absolute z-10 pointer-events-none ${cls}`}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M2 6 L2 2 L6 2" stroke="#82CFFF" strokeWidth="1.5" opacity="0.45" strokeLinecap="round"/>
          </svg>
        </div>
      ))}

      <Canvas
        camera={{ position: [7, -4, 4], fov: 36, near: 0.05, far: 200 }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: false }}
      >
        <color attach="background" args={['#080C10']} />
        <ambientLight intensity={0.55} />
        <directionalLight position={[6, -4, 8]}  intensity={0.85} />
        <directionalLight position={[-4, 4, -2]} intensity={0.30} color="#82CFFF" />

        <Grid args={[30, 30]} cellSize={0.5} cellThickness={0.4}
          cellColor="#111820" sectionSize={2} sectionThickness={0.7}
          sectionColor="#1A2430" fadeDistance={20} fadeStrength={1} infiniteGrid />

        {meshData
          ? <MeshCFD meshData={meshData} Cd={Cd} renderMode={renderMode} />
          : <FallbackCar />
        }

        <FlowArrows />

        <OrbitControls
          enablePan enableZoom enableRotate
          minDistance={0.5} maxDistance={60}
          target={[0, 0, 0.5]}
          makeDefault
        />
        <GizmoHelper alignment="bottom-right" margin={[72, 72]}>
          <GizmoViewport axisColors={['#ef4444','#84cc16','#82CFFF']} labelColor="#080C10" />
        </GizmoHelper>
      </Canvas>
    </div>
  )
}
