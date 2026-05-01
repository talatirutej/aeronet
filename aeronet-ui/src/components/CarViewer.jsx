// CarViewer.jsx — 3D pressure viewer for full cars AND car parts.
// Uses project CSS variables only — no Tailwind, no M3 tokens.
// Copyright (c) 2026 Rutej Talati. All rights reserved.

import { useMemo, useRef, useEffect } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, GizmoHelper, GizmoViewport, Grid } from '@react-three/drei'
import * as THREE from 'three'
import { cpToColor } from '../lib/predict'

// ── Auto-scaling camera ───────────────────────────────────────────────────────

function CameraRig({ bbox }) {
  const { camera, controls } = useThree()
  useEffect(() => {
    if (!bbox) return
    const size = new THREE.Vector3(
      bbox.max[0] - bbox.min[0],
      bbox.max[1] - bbox.min[1],
      bbox.max[2] - bbox.min[2],
    )
    const centre = new THREE.Vector3(
      (bbox.min[0] + bbox.max[0]) / 2,
      (bbox.min[1] + bbox.max[1]) / 2,
      (bbox.min[2] + bbox.max[2]) / 2,
    )
    const maxDim = Math.max(size.x, size.y, size.z)
    const dist   = maxDim * 2.2
    camera.position.set(centre.x + dist * 0.7, centre.y + dist * 0.5, centre.z + dist * 0.6)
    camera.near = maxDim * 0.001
    camera.far  = maxDim * 50
    camera.updateProjectionMatrix()
    if (controls) controls.target.copy(centre)
  }, [bbox, camera, controls])
  return null
}

// ── Point cloud ───────────────────────────────────────────────────────────────

function PointCloudMesh({ positions, pressures, bbox }) {
  const ref = useRef()

  const pointSize = useMemo(() => {
    if (!bbox) return 0.025
    const diag = Math.sqrt(
      (bbox.max[0]-bbox.min[0])**2 +
      (bbox.max[1]-bbox.min[1])**2 +
      (bbox.max[2]-bbox.min[2])**2
    )
    return Math.max(0.003, Math.min(0.04, diag * 0.006))
  }, [bbox])

  const geometry = useMemo(() => {
    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const colors = new Float32Array(pressures.length * 3)
    for (let i = 0; i < pressures.length; i++) {
      const [r, g, b] = cpToColor(pressures[i])
      colors[i*3] = r; colors[i*3+1] = g; colors[i*3+2] = b
    }
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geom.computeBoundingSphere()
    return geom
  }, [positions, pressures])

  useFrame((state, delta) => {
    if (ref.current && !state.controls?.isInteracting)
      ref.current.rotation.z += delta * 0.025
  })

  return (
    <points ref={ref} geometry={geometry}>
      <pointsMaterial size={pointSize} vertexColors sizeAttenuation transparent opacity={0.92} />
    </points>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <group>
      <mesh position={[0, 0, 0.5]}>
        <boxGeometry args={[4.5, 1.8, 1.2]} />
        <meshBasicMaterial wireframe color="#3A3A3C" transparent opacity={0.45} />
      </mesh>
      <mesh position={[0.3, 0, 1.3]}>
        <boxGeometry args={[2.2, 1.5, 0.8]} />
        <meshBasicMaterial wireframe color="#3A3A3C" transparent opacity={0.3} />
      </mesh>
    </group>
  )
}

// ── Flow arrow ────────────────────────────────────────────────────────────────

function FlowArrow({ scale = 1 }) {
  const s = scale * 0.7
  return (
    <group position={[-3.5 * scale, 0, 0.7 * scale]}>
      <mesh rotation={[0, 0, -Math.PI / 2]}>
        <coneGeometry args={[0.08 * s, 0.25 * s, 12]} />
        <meshBasicMaterial color="#82CFFF" />
      </mesh>
      <mesh position={[-0.25 * s, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.015 * s, 0.015 * s, 0.5 * s, 8]} />
        <meshBasicMaterial color="#82CFFF" transparent opacity={0.6} />
      </mesh>
    </group>
  )
}

// ── Shared overlay card style ─────────────────────────────────────────────────

const OC = {
  background: 'rgba(28,28,30,0.85)',
  backdropFilter: 'blur(12px)',
  WebkitBackdropFilter: 'blur(12px)',
  border: '0.5px solid rgba(255,255,255,0.08)',
  borderRadius: 10,
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CarViewer({ data, isLoading }) {
  const pointsData = data?.viewer?.points ?? data?.pointCloud ?? null
  const bbox       = pointsData?.bbox ?? null
  const isPart     = data?.partType != null

  const camPos = useMemo(() => {
    if (!bbox) return [6, 5, 4]
    const diag = Math.sqrt(
      (bbox.max[0]-bbox.min[0])**2 +
      (bbox.max[1]-bbox.min[1])**2 +
      (bbox.max[2]-bbox.min[2])**2
    )
    const d = diag * 2.2
    return [d*0.7, d*0.5, d*0.6]
  }, [bbox])

  return (
    <div className="cfd-grid" style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', background: '#0A0A0A' }}>

      {/* Scan animation */}
      {isLoading && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 10, pointerEvents: 'none' }}>
          <div className="anim-scan" style={{
            position: 'absolute', left: 0, right: 0, height: 1,
            background: 'var(--teal)',
            boxShadow: '0 0 20px 4px rgba(64,203,224,0.5)',
          }} />
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(64,203,224,0.025)' }} />
        </div>
      )}

      {/* Axis legend — top centre */}
      <div style={{
        ...OC,
        position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
        zIndex: 10, display: 'flex', alignItems: 'center', gap: 10,
        padding: '0 16px', height: 32,
      }}>
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--blue)' }}>
          {isPart ? 'Part' : 'Inflow'}
        </span>
        <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>→ +X</span>
        <div style={{ width: 0.5, height: 12, background: 'var(--sep)' }} />
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>Up</span>
        <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>+Z</span>
      </div>

      {/* Part label badge — top left */}
      {isPart && data?.partType && (
        <div style={{ ...OC, position: 'absolute', top: 12, left: 12, zIndex: 10, padding: '8px 12px' }}>
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--blue)', marginBottom: 3 }}>
            Part Mode
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500, textTransform: 'capitalize' }}>
            {data.partType.replace(/_/g, ' ')}
          </div>
          {data.deltaCd !== undefined && (
            <div style={{
              fontSize: 12, fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, marginTop: 3,
              color: data.deltaCd < 0 ? 'var(--green)' : 'var(--red)',
            }}>
              ΔCd {data.deltaCd > 0 ? '+' : ''}{data.deltaCd.toFixed(4)}
            </div>
          )}
        </div>
      )}

      {/* Cp colorbar — right centre */}
      {pointsData && (
        <div style={{
          ...OC,
          position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
          zIndex: 10, padding: 12,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
          animation: 'fadeIn 0.3s ease both',
        }}>
          <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>Cp</span>
          <div style={{
            width: 10, height: 140, borderRadius: 5,
            background: 'linear-gradient(to bottom, #ef4444, #fbbf24, #84cc16, #22d3ee, #2147d9)',
          }} />
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: "'IBM Plex Mono', monospace" }}>+1.0</span>
            <div style={{ height: 20 }} />
            <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: "'IBM Plex Mono', monospace" }}>-1.5</span>
          </div>
        </div>
      )}

      {/* Status chip — bottom left */}
      <div style={{
        ...OC,
        position: 'absolute', bottom: 12, left: 12, zIndex: 10,
        display: 'flex', alignItems: 'center', gap: 7,
        padding: '0 12px', height: 28, borderRadius: 14,
      }}>
        <span style={{
          width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
          background: pointsData ? 'var(--green)' : 'var(--bg4)',
          boxShadow: pointsData ? '0 0 5px var(--green)' : 'none',
          ...(pointsData ? { animation: 'pulse 2.5s ease-in-out infinite' } : {}),
        }} />
        <span style={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>
          {isLoading ? 'Inferring' : pointsData ? (isPart ? 'Part · Live' : 'Live') : 'Idle'}
        </span>
      </div>

      {/* Corner marks */}
      {[
        { style: { top: 12, left: 12 },  rotate: '0deg'   },
        { style: { top: 12, right: 12 }, rotate: '90deg'  },
        { style: { bottom: 12, right: 12 }, rotate: '180deg' },
        { style: { bottom: 12, left: 12 }, rotate: '270deg' },
      ].map(({ style, rotate }, i) => (
        <div key={i} style={{ position: 'absolute', zIndex: 10, pointerEvents: 'none', ...style }}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ transform: `rotate(${rotate})` }}>
            <path d="M2 7L2 2L7 2" stroke="var(--teal)" strokeWidth="1.5" opacity="0.35" strokeLinecap="round" />
          </svg>
        </div>
      ))}

      {/* Three.js canvas */}
      <Canvas camera={{ position: camPos, fov: 38, near: 0.001, far: 500 }} dpr={[1, 2]}>
        <color attach="background" args={['#0A0A0A']} />
        <ambientLight intensity={0.4} />
        <directionalLight position={[5, 5, 5]} intensity={0.6} />

        <Grid
          args={[20, 20]} cellSize={0.5} cellThickness={0.5}
          cellColor="#1E1E1E" sectionSize={2} sectionThickness={1}
          sectionColor="#252525" fadeDistance={15} fadeStrength={1} infiniteGrid
        />

        {pointsData
          ? <PointCloudMesh positions={pointsData.positions} pressures={pointsData.pressures} bbox={bbox} />
          : <EmptyState />
        }

        <FlowArrow scale={bbox ? Math.max(0.2, (bbox.max[0]-bbox.min[0]) * 0.6) : 1} />

        <OrbitControls
          enablePan enableZoom enableRotate minDistance={0.05} maxDistance={200}
          target={bbox
            ? [(bbox.min[0]+bbox.max[0])/2, (bbox.min[1]+bbox.max[1])/2, (bbox.min[2]+bbox.max[2])/2]
            : [0, 0, 0.7]}
        />

        <CameraRig bbox={bbox} />

        <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
          <GizmoViewport axisColors={['#ef4444', '#84cc16', '#82CFFF']} labelColor="#0A0A0A" />
        </GizmoHelper>
      </Canvas>
    </div>
  )
}
