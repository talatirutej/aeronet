// Copyright (c) 2026 Rutej Talati. All rights reserved.

import { useMemo, useRef, useEffect, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import {
  OrbitControls, GizmoHelper, GizmoViewport, Grid,
  ContactShadows, Environment,
} from '@react-three/drei'
import * as THREE from 'three'
import { cpToColor } from '../lib/predict'

/* ─────────────────────────────────────────────────────────
   Auto-orient: robust algorithm using PCA + heuristics.

   Goal: wheels on ground, nose pointing +X, roof up +Z.

   Strategy:
   1. Compute full bounding box of all positions.
   2. The car's longest dimension is always its LENGTH.
      The shortest dimension is always its HEIGHT (cars are
      wider/longer than they are tall).
      The middle dimension is WIDTH.
   3. Map: longest → world X, middle → world Y, shortest → world Z.
   4. After rotating, shift the mesh DOWN so its minimum Z
      sits at exactly Z=0 (wheels on ground).
   5. The centre X/Y is shifted to world origin.

   This handles all common STL orientations:
   - Car lying on side (length along Y) → rotate
   - Car standing on nose (length along Z) → rotate
   - Car already correct (length along X) → no rotation
───────────────────────────────────────────────────────── */
function computeOrientedTransform(positions) {
  if (!positions || positions.length < 3) {
    return {
      offset: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
    }
  }

  let minX = Infinity, maxX = -Infinity
  let minY = Infinity, maxY = -Infinity
  let minZ = Infinity, maxZ = -Infinity
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i+1], z = positions[i+2]
    if (x < minX) minX = x; if (x > maxX) maxX = x
    if (y < minY) minY = y; if (y > maxY) maxY = y
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
  }

  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const cz = (minZ + maxZ) / 2
  const sx = maxX - minX
  const sy = maxY - minY
  const sz = maxZ - minZ

  const dims = [
    { axis: 0, vec: new THREE.Vector3(1,0,0), size: sx },
    { axis: 1, vec: new THREE.Vector3(0,1,0), size: sy },
    { axis: 2, vec: new THREE.Vector3(0,0,1), size: sz },
  ].sort((a, b) => b.size - a.size)

  const srcX = dims[0].vec.clone()
  const srcY = dims[1].vec.clone()
  const srcZ = dims[2].vec.clone()

  const rotMatrix = new THREE.Matrix4()
  rotMatrix.makeBasis(srcX, srcY, srcZ)
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(rotMatrix)

  const corners = [
    [minX, minY, minZ], [maxX, minY, minZ],
    [minX, maxY, minZ], [maxX, maxY, minZ],
    [minX, minY, maxZ], [maxX, minY, maxZ],
    [minX, maxY, maxZ], [maxX, maxY, maxZ],
  ]
  const qInv = quaternion.clone().invert()
  let newMinZ = Infinity
  const vtmp = new THREE.Vector3()
  for (const [x, y, z] of corners) {
    vtmp.set(x - cx, y - cy, z - cz).applyQuaternion(qInv)
    if (vtmp.z < newMinZ) newMinZ = vtmp.z
  }

  const offset = new THREE.Vector3(-cx, -cy, -cz)
  const groundLift = -newMinZ

  return { offset, quaternion: qInv, groundLift }
}

/* ─────────────────────────────────────────────────────────
   Apply orient transform to a Float32Array of positions
───────────────────────────────────────────────────────── */
function applyOrient(positions, orient) {
  const { offset, quaternion, groundLift } = orient
  const out = new Float32Array(positions.length)
  const v = new THREE.Vector3()
  for (let i = 0; i < positions.length; i += 3) {
    v.set(
      positions[i]   + offset.x,
      positions[i+1] + offset.y,
      positions[i+2] + offset.z,
    ).applyQuaternion(quaternion)
    out[i]   = v.x
    out[i+1] = v.y
    out[i+2] = v.z + groundLift
  }
  return out
}

/* ─────────────────────────────────────────────────────────
   Camera auto-fit + snap-to-view
───────────────────────────────────────────────────────── */
function useCameraParams(data) {
  return useMemo(() => {
    const bbox = data?.viewer?.points?.bbox
             ?? data?.viewer?.mesh?.bbox
             ?? data?.pointCloud?.bbox
    if (!bbox) return { pos: [8, 5, 4], near: 0.01, far: 400, dist: 8, scale: 1 }
    const sx = bbox.max[0] - bbox.min[0]
    const sy = bbox.max[1] - bbox.min[1]
    const sz = bbox.max[2] - bbox.min[2]
    const size = Math.max(sx, sy, sz, 0.01)
    const dist = size * 2.0
    return {
      pos:   [dist * 0.9, dist * 0.7, dist * 0.55],
      near:  Math.max(dist * 0.001, 0.001),
      far:   dist * 120,
      dist,
      scale: size,
    }
  }, [data])
}

/* ─────────────────────────────────────────────────────────
   Camera snap helper — snaps to preset orthographic views
───────────────────────────────────────────────────────── */
function CameraController({ camPos, snapTo, dist }) {
  const { camera, controls } = useThree()
  const fitted  = useRef(false)
  const snapping = useRef(null)

  useEffect(() => {
    fitted.current = false
  }, [camPos?.[0]])

  useEffect(() => {
    if (!snapTo) return
    const d = dist * 1.6
    const targets = {
      side:   [d, 0, dist * 0.3],
      top:    [0, 0, d * 1.2],
      front:  [0, -d, dist * 0.3],
      rear:   [0,  d, dist * 0.3],
      iso:    [d * 0.8, d * 0.6, dist * 0.5],
    }
    snapping.current = targets[snapTo] ?? targets.iso
  }, [snapTo, dist])

  useFrame(() => {
    if (snapping.current) {
      const [tx, ty, tz] = snapping.current
      camera.position.lerp(new THREE.Vector3(tx, ty, tz), 0.12)
      if (controls) controls.update()
      if (camera.position.distanceTo(new THREE.Vector3(tx, ty, tz)) < dist * 0.01) {
        snapping.current = null
      }
      return
    }
    if (fitted.current) return
    camera.position.set(...camPos)
    camera.lookAt(0, 0, 0)
    if (controls) { controls.target.set(0, 0, 0); controls.update() }
    fitted.current = true
  })

  return null
}

/* ─────────────────────────────────────────────────────────
   Renderers
───────────────────────────────────────────────────────── */
function PointCloudMesh({ positions, pressures, pointSize, orient }) {
  const geometry = useMemo(() => {
    const geom = new THREE.BufferGeometry()
    const transformed = applyOrient(positions, orient)
    geom.setAttribute('position', new THREE.BufferAttribute(transformed, 3))
    const colors = new Float32Array(pressures.length * 3)
    for (let i = 0; i < pressures.length; i++) {
      const [r, g, b] = cpToColor(pressures[i])
      colors[i*3] = r; colors[i*3+1] = g; colors[i*3+2] = b
    }
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geom.computeBoundingSphere()
    return geom
  }, [positions, pressures, orient])

  return (
    <points geometry={geometry}>
      <pointsMaterial size={pointSize} vertexColors sizeAttenuation transparent opacity={0.9} />
    </points>
  )
}

function SurfaceMesh({ positions, indices, pressures, orient }) {
  const geometry = useMemo(() => {
    const geom = new THREE.BufferGeometry()
    const transformed = applyOrient(positions, orient)
    geom.setAttribute('position', new THREE.BufferAttribute(transformed, 3))
    geom.setIndex(new THREE.BufferAttribute(indices, 1))
    const colors = new Float32Array(pressures.length * 3)
    for (let i = 0; i < pressures.length; i++) {
      const [r, g, b] = cpToColor(pressures[i])
      colors[i*3] = r; colors[i*3+1] = g; colors[i*3+2] = b
    }
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geom.computeVertexNormals()
    geom.computeBoundingSphere()
    return geom
  }, [positions, indices, pressures, orient])

  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshStandardMaterial
        vertexColors metalness={0.25} roughness={0.45}
        flatShading={false} side={THREE.DoubleSide} envMapIntensity={0.6}
      />
    </mesh>
  )
}

function EmptyState() {
  return (
    <group>
      <mesh position={[0, 0, 0.6]}>
        <boxGeometry args={[4.5, 1.8, 1.2]} />
        <meshBasicMaterial wireframe color="#2b2930" transparent opacity={0.35} />
      </mesh>
      <mesh position={[0.3, 0, 1.5]}>
        <boxGeometry args={[2.2, 1.5, 0.8]} />
        <meshBasicMaterial wireframe color="#2b2930" transparent opacity={0.25} />
      </mesh>
    </group>
  )
}

/* ─────────────────────────────────────────────────────────
   View snap buttons — replaces the old GizmoViewport
───────────────────────────────────────────────────────── */
function ViewSnapBar({ onSnap, activeSnap }) {
  const views = [
    { key: 'iso',   label: '3/4',   title: 'Isometric view' },
    { key: 'side',  label: 'Side',  title: 'Side view (Y axis)' },
    { key: 'front', label: 'Front', title: 'Front view' },
    { key: 'rear',  label: 'Rear',  title: 'Rear view' },
    { key: 'top',   label: 'Top',   title: 'Plan view (from above)' },
  ]
  return (
    <div style={{
      position: 'absolute', bottom: 14, right: 14, zIndex: 10,
      display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      {/* Axis legend */}
      <div style={{
        background: 'rgba(11,19,24,0.92)', borderRadius: 8,
        border: '1px solid #1e2b30', backdropFilter: 'blur(8px)',
        padding: '8px 10px', marginBottom: 4,
      }}>
        <div style={{ fontSize: 9, color: '#938f99', textTransform: 'uppercase',
          letterSpacing: '0.08em', marginBottom: 6, fontFamily: 'Roboto Mono' }}>
          World Axes
        </div>
        {[
          { label: '+X', desc: 'Nose / Inflow', color: '#ef4444' },
          { label: '+Y', desc: 'Right side',    color: '#84cc16' },
          { label: '+Z', desc: 'Up / Roof',     color: '#4dd8e8' },
        ].map(a => (
          <div key={a.label} style={{ display: 'flex', alignItems: 'center',
            gap: 6, marginBottom: 3 }}>
            <div style={{ width: 18, height: 2, borderRadius: 1,
              background: a.color, flexShrink: 0 }} />
            <span style={{ fontFamily: 'Roboto Mono', fontSize: 10,
              color: a.color, fontWeight: 600 }}>{a.label}</span>
            <span style={{ fontSize: 9, color: '#938f99' }}>{a.desc}</span>
          </div>
        ))}
      </div>

      {/* View snap buttons */}
      <div style={{
        background: 'rgba(11,19,24,0.92)', borderRadius: 8,
        border: '1px solid #1e2b30', backdropFilter: 'blur(8px)',
        padding: 4, display: 'flex', flexDirection: 'column', gap: 2,
      }}>
        <div style={{ fontSize: 9, color: '#938f99', textTransform: 'uppercase',
          letterSpacing: '0.08em', padding: '2px 6px 4px',
          fontFamily: 'Roboto Mono' }}>
          Snap View
        </div>
        {views.map(v => (
          <button key={v.key} onClick={() => onSnap(v.key)} title={v.title}
            style={{
              padding: '5px 10px', borderRadius: 6, border: 'none',
              fontFamily: 'Roboto Mono', fontSize: 10,
              textTransform: 'uppercase', letterSpacing: '0.05em',
              cursor: 'pointer', transition: 'all 120ms', textAlign: 'left',
              background: activeSnap === v.key
                ? 'rgba(77,216,232,0.18)' : 'transparent',
              color: activeSnap === v.key ? '#4dd8e8' : '#938f99',
            }}
            onMouseOver={e => { if (activeSnap !== v.key) e.currentTarget.style.background = 'rgba(77,216,232,0.06)'; e.currentTarget.style.color = '#e6e1e5' }}
            onMouseOut={e => { if (activeSnap !== v.key) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#938f99' }}}>
            {v.label}
          </button>
        ))}
        <div style={{ height: 1, background: '#1a1a1a', margin: '2px 4px' }} />
        <button onClick={() => onSnap(null)} title="Free orbit — no snap"
          style={{ padding: '5px 10px', borderRadius: 6, border: 'none',
            fontFamily: 'Roboto Mono', fontSize: 10,
            textTransform: 'uppercase', letterSpacing: '0.05em',
            cursor: 'pointer', background: 'transparent', color: '#49454f',
            transition: 'all 120ms' }}
          onMouseOver={e => { e.currentTarget.style.color = '#938f99' }}
          onMouseOut={e => { e.currentTarget.style.color = '#49454f' }}>
          Free
        </button>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────
   Main viewer
───────────────────────────────────────────────────────── */
export default function CarViewer({ data, isLoading, viewMode = 'points', onViewModeChange }) {
  const [snapTo,    setSnapTo]    = useState(null)
  const [activeSnap, setActiveSnap] = useState(null)

  const handleSnap = (key) => {
    setSnapTo(key)
    setActiveSnap(key)
    setTimeout(() => setSnapTo(null), 50)
  }

  const points = data?.viewer?.points ?? data
  const mesh   = data?.viewer?.mesh

  const pointsTyped = useMemo(() => {
    if (!points?.positions) return null
    return {
      positions: points.positions instanceof Float32Array ? points.positions : Float32Array.from(points.positions),
      pressures: points.pressures instanceof Float32Array ? points.pressures : Float32Array.from(points.pressures),
    }
  }, [points])

  const meshTyped = useMemo(() => {
    if (!mesh?.positions || !mesh?.indices) return null
    return {
      positions: mesh.positions instanceof Float32Array ? mesh.positions : Float32Array.from(mesh.positions),
      indices:   mesh.indices   instanceof Uint32Array  ? mesh.indices   : Uint32Array.from(mesh.indices),
      pressures: mesh.pressures instanceof Float32Array ? mesh.pressures : Float32Array.from(mesh.pressures),
    }
  }, [mesh])

  const orient = useMemo(() => {
    const src = meshTyped?.positions ?? pointsTyped?.positions
    if (!src) return { offset: new THREE.Vector3(), quaternion: new THREE.Quaternion(), groundLift: 0 }
    return computeOrientedTransform(src)
  }, [meshTyped?.positions, pointsTyped?.positions])

  const effectiveMode = viewMode === 'mesh' && !meshTyped ? 'points' : viewMode
  const hasMeshOption = !!meshTyped
  const cam = useCameraParams(data)

  const gridCell    = Math.max(cam.scale * 0.04, 0.01)
  const gridSection = Math.max(cam.scale * 0.20, 0.05)
  const gridFade    = cam.dist * 5
  const pointSize   = cam.scale * 0.005

  const cpMin = data?.cpStats?.min ?? -1.5
  const cpMax = data?.cpStats?.max ?? 1.0

  const meshStats = mesh?.stats

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%',
      overflow: 'hidden', borderRadius: 12, background: '#050505', cursor: 'crosshair' }}>

      {/* Loading overlay */}
      {isLoading && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 10, pointerEvents: 'none' }}>
          <div style={{ position: 'absolute', left: 0, right: 0, height: 1,
            background: '#4dd8e8', boxShadow: '0 0 18px 4px #4dd8e8',
            animation: 'scan 2.5s ease-in-out infinite' }} />
          <div style={{ position: 'absolute', inset: 0,
            background: 'rgba(77,216,232,0.04)', animation: 'pulse 2s ease-in-out infinite' }} />
        </div>
      )}

      {/* Corner marks */}
      {[0,1,2,3].map(i => <CornerMark key={i} index={i} />)}

      {/* Top bar: mode toggle */}
      <div style={{ position: 'absolute', top: 12, left: '50%',
        transform: 'translateX(-50%)', zIndex: 10,
        display: 'flex', alignItems: 'center', gap: 8 }}>

        {/* Axis indicators */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px',
          background: 'rgba(11,19,24,0.88)', borderRadius: 8,
          border: '1px solid #1e2b30', backdropFilter: 'blur(8px)' }}>
          <AxisPill color="#ef4444" label="X" desc="Inflow" />
          <AxisPill color="#84cc16" label="Y" desc="Right" />
          <AxisPill color="#4dd8e8" label="Z" desc="Up" />
        </div>

        {/* Mode toggle */}
        {data && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '3px 4px',
            background: 'rgba(11,19,24,0.88)', borderRadius: 8,
            border: '1px solid #1e2b30', backdropFilter: 'blur(8px)' }}>
            {['points', 'mesh'].map(m => (
              <button key={m}
                onClick={() => onViewModeChange?.(m)}
                disabled={m === 'mesh' && !hasMeshOption}
                style={{
                  padding: '4px 14px', borderRadius: 6, border: 'none',
                  fontFamily: 'Roboto Mono', fontSize: 10,
                  textTransform: 'uppercase', letterSpacing: '0.06em',
                  cursor: m === 'mesh' && !hasMeshOption ? 'not-allowed' : 'pointer',
                  background: effectiveMode === m ? 'rgba(77,216,232,0.18)' : 'transparent',
                  color: effectiveMode === m ? '#4dd8e8'
                    : m === 'mesh' && !hasMeshOption ? '#1c1c1c' : '#938f99',
                  transition: 'all 150ms',
                }}>
                {m === 'points' ? 'Points' : 'Surface'}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Cp colorbar */}
      {data && (
        <div style={{ position: 'absolute', left: 14, top: '50%',
          transform: 'translateY(-50%)', zIndex: 10,
          padding: '10px 8px', background: 'rgba(11,19,24,0.88)',
          borderRadius: 10, border: '1px solid #1e2b30',
          backdropFilter: 'blur(8px)',
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          gap: 6, animation: 'fadeIn 300ms ease-out' }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: '#cac4d0',
            letterSpacing: '0.06em', fontFamily: 'Roboto Mono' }}>Cp</span>
          <div style={{ width: 10, height: 120, borderRadius: 3,
            background: 'linear-gradient(to bottom, #ef4444, #fb923c, #fbbf24, #84cc16, #22d3ee, #4f46e5)' }} />
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <span style={{ fontFamily: 'Roboto Mono', fontSize: 9, color: '#ef4444' }}>
              {cpMax > 0 ? '+' : ''}{cpMax.toFixed(2)}
            </span>
            <span style={{ fontFamily: 'Roboto Mono', fontSize: 9, color: '#938f99', marginTop: 40, marginBottom: 40 }}>0</span>
            <span style={{ fontFamily: 'Roboto Mono', fontSize: 9, color: '#4f46e5' }}>
              {cpMin.toFixed(2)}
            </span>
          </div>
        </div>
      )}

      {/* Bottom left: status */}
      <div style={{ position: 'absolute', bottom: 14, left: 14, zIndex: 10,
        display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px',
        background: 'rgba(11,19,24,0.88)', borderRadius: 6,
        border: '1px solid #1e2b30', backdropFilter: 'blur(8px)' }}>
        <div style={{ width: 6, height: 6, borderRadius: '50%',
          background: data ? '#4ade80' : '#49454f',
          animation: data ? 'pulse 3s ease-in-out infinite' : 'none' }} />
        <span style={{ fontFamily: 'Roboto Mono', fontSize: 10,
          textTransform: 'uppercase', letterSpacing: '0.07em', color: '#938f99' }}>
          {isLoading ? 'Inferring' : data ? `Live  ${effectiveMode}` : 'Idle'}
        </span>
      </div>

      {/* Bottom centre: mesh stats */}
      {data && effectiveMode === 'mesh' && meshStats && (
        <div style={{ position: 'absolute', bottom: 14, left: '50%',
          transform: 'translateX(-50%)', zIndex: 10,
          padding: '4px 12px', background: 'rgba(11,19,24,0.88)',
          borderRadius: 6, border: '1px solid #1e2b30', backdropFilter: 'blur(8px)' }}>
          <span style={{ fontFamily: 'Roboto Mono', fontSize: 10, color: '#938f99' }}>
            {meshStats.faceCount?.toLocaleString()} faces  {meshStats.vertexCount?.toLocaleString()} verts
          </span>
        </div>
      )}

      {/* Bottom right: view snap panel */}
      <ViewSnapBar onSnap={handleSnap} activeSnap={activeSnap} />

      <Canvas
        shadows
        camera={{ position: cam.pos, fov: 34, near: cam.near, far: cam.far }}
        dpr={Math.min(window.devicePixelRatio, 2)}
        gl={{ antialias: true, powerPreference: 'high-performance', toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.1 }}
        onCreated={({ gl }) => { gl.domElement.addEventListener('webglcontextlost', e => e.preventDefault()) }}
      >
        <color attach="background" args={['#050505']} />
        <Environment files="https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/potsdamer_platz_1k.hdr" />
        <ambientLight intensity={0.4} />
        <directionalLight
          position={[cam.scale * 3, cam.scale * 2, cam.scale * 4]}
          intensity={1.2} castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-far={cam.dist * 10}
          shadow-camera-left={-cam.scale * 3}
          shadow-camera-right={cam.scale * 3}
          shadow-camera-top={cam.scale * 3}
          shadow-camera-bottom={-cam.scale * 3}
        />
        <directionalLight position={[-cam.scale * 2, cam.scale, cam.scale * 2]}
          intensity={0.35} color="#b0e0ff" />
        <directionalLight position={[0, -cam.scale, cam.scale * 0.5]}
          intensity={0.15} color="#4dd8e8" />

        <Grid args={[20, 20]}
          cellSize={gridCell} cellThickness={0.4} cellColor="#1c1c1c"
          sectionSize={gridSection} sectionThickness={0.8} sectionColor="#222"
          fadeDistance={gridFade} fadeStrength={1.2} infiniteGrid position={[0, 0, 0]} />

        {data && (
          <ContactShadows position={[0, 0, -0.002]}
            opacity={0.5} scale={cam.scale * 3}
            blur={2.5} far={cam.scale} color="#000d14" />
        )}

        <CameraController camPos={cam.pos} snapTo={snapTo} dist={cam.dist} />

        {!data ? (
          <EmptyState />
        ) : effectiveMode === 'mesh' && meshTyped ? (
          <SurfaceMesh
            positions={meshTyped.positions} indices={meshTyped.indices}
            pressures={meshTyped.pressures} orient={orient} />
        ) : pointsTyped ? (
          <PointCloudMesh
            positions={pointsTyped.positions} pressures={pointsTyped.pressures}
            pointSize={pointSize} orient={orient} />
        ) : (
          <EmptyState />
        )}

        <OrbitControls makeDefault enablePan enableZoom enableRotate
          autoRotate={!!data} autoRotateSpeed={0.35}
          minDistance={cam.dist * 0.05} maxDistance={cam.dist * 8}
          target={[0, 0, cam.scale * 0.15]}
          dampingFactor={0.07} enableDamping />

        {/* Small XYZ gizmo in bottom right corner — inside Canvas */}
        <GizmoHelper alignment="bottom-right" margin={[170, 170]}>
          <GizmoViewport
            axisColors={['#ef4444', '#84cc16', '#4dd8e8']}
            labelColor="#050505"
            hideNegativeAxes
          />
        </GizmoHelper>
      </Canvas>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────
   Small helpers
───────────────────────────────────────────────────────── */
function AxisPill({ color, label, desc }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <div style={{ width: 3, height: 12, borderRadius: 1.5, background: color }} />
      <span style={{ fontFamily: 'Roboto Mono', fontSize: 10,
        fontWeight: 700, color }}>{label}</span>
      <span style={{ fontSize: 9, color: '#938f99' }}>{desc}</span>
    </div>
  )
}

function CornerMark({ index }) {
  const positions = [
    { top: 12, left: 12 },
    { top: 12, right: 12 },
    { bottom: 12, right: 12 },
    { bottom: 12, left: 12 },
  ]
  const rotations = [0, 90, 180, 270]
  return (
    <div style={{ position: 'absolute', zIndex: 10, pointerEvents: 'none',
      ...positions[index], transform: `rotate(${rotations[index]}deg)` }}>
      <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
        <path d="M2 8 L2 2 L8 2" stroke="#4dd8e8" strokeWidth="1.2" opacity="0.35" />
      </svg>
    </div>
  )
}
