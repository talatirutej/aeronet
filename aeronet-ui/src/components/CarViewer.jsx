// Copyright (c) 2026 Rutej Talati. All rights reserved.

import { useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, GizmoHelper, GizmoViewport, Grid } from '@react-three/drei'
import * as THREE from 'three'
import { cpToColor } from '../lib/predict'

function PointCloudMesh({ positions, pressures }) {
  const ref = useRef()

  const geometry = useMemo(() => {
    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const colors = new Float32Array(pressures.length * 3)
    for (let i = 0; i < pressures.length; i++) {
      const [r, g, b] = cpToColor(pressures[i])
      colors[i * 3] = r; colors[i * 3 + 1] = g; colors[i * 3 + 2] = b
    }
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geom.computeBoundingSphere()
    return geom
  }, [positions, pressures])

  useFrame((state, delta) => {
    if (ref.current && !state.controls?.isInteracting)
      ref.current.rotation.z += delta * 0.035
  })

  return (
    <points ref={ref} geometry={geometry}>
      <pointsMaterial size={0.024} vertexColors sizeAttenuation transparent opacity={0.9} />
    </points>
  )
}

function EmptyState() {
  return (
    <group>
      <mesh position={[0, 0, 0.5]}>
        <boxGeometry args={[4.5, 1.8, 1.2]} />
        <meshBasicMaterial wireframe color="#3A3A3C" transparent opacity={0.6} />
      </mesh>
      <mesh position={[0.3, 0, 1.3]}>
        <boxGeometry args={[2.2, 1.5, 0.8]} />
        <meshBasicMaterial wireframe color="#3A3A3C" transparent opacity={0.35} />
      </mesh>
    </group>
  )
}

function FlowArrow() {
  return (
    <group position={[-3.8, 0, 0.7]}>
      <mesh rotation={[0, 0, -Math.PI / 2]}>
        <coneGeometry args={[0.07, 0.22, 12]} />
        <meshBasicMaterial color="rgba(10,132,255,0.8)" />
      </mesh>
      <mesh position={[-0.22, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.012, 0.012, 0.44, 8]} />
        <meshBasicMaterial color="rgba(10,132,255,0.5)" transparent opacity={0.5} />
      </mesh>
    </group>
  )
}

export default function CarViewer({ data, isLoading }) {
  const pc = data?.pointCloud ?? null

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#050505' }}>

      {/* Grid background overlay */}
      <div className="cfd-grid" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0 }} />

      {/* Scan animation */}
      {isLoading && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 20, pointerEvents: 'none' }}>
          <div className="anim-scan" style={{
            position: 'absolute', insetInline: 0, height: 1,
            background: 'var(--blue)',
            boxShadow: '0 0 18px 3px rgba(10,132,255,0.5)',
          }} />
          <div className="anim-pulse" style={{ position: 'absolute', inset: 0, background: 'rgba(10,132,255,0.03)' }} />
        </div>
      )}

      {/* Top label */}
      <div style={{
        position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
        zIndex: 10,
        background: 'rgba(0,0,0,0.65)',
        backdropFilter: 'blur(12px)',
        border: '0.5px solid var(--sep)',
        borderRadius: 20,
        padding: '4px 16px',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--blue)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Inflow</span>
        <span style={{ fontSize: 11, color: 'var(--label3)' }}>+X</span>
        <span style={{ width: 0.5, height: 10, background: 'var(--sep)', display: 'inline-block' }} />
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--label2)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Up</span>
        <span style={{ fontSize: 11, color: 'var(--label3)' }}>+Z</span>
      </div>

      {/* Cp colorbar */}
      {pc && (
        <div className="anim-in" style={{
          position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)',
          zIndex: 10,
          background: 'rgba(0,0,0,0.65)',
          backdropFilter: 'blur(12px)',
          border: '0.5px solid var(--sep)',
          borderRadius: 12,
          padding: '12px 10px',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
        }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--label3)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Cp</span>
          <div style={{
            width: 10, height: 120, borderRadius: 5,
            background: 'linear-gradient(to bottom, #ef4444, #fb923c, #fbbf24, #4ade80, #22d3ee, #2563eb)',
          }} />
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <span className="mono" style={{ fontSize: 10, color: 'var(--label3)' }}>+1.0</span>
            <span className="mono" style={{ fontSize: 10, color: 'var(--label3)' }}>−1.5</span>
          </div>
        </div>
      )}

      {/* Status pill — bottom left */}
      <div style={{
        position: 'absolute', bottom: 12, left: 12, zIndex: 10,
        background: 'rgba(0,0,0,0.65)',
        backdropFilter: 'blur(12px)',
        border: '0.5px solid var(--sep)',
        borderRadius: 20,
        padding: '4px 12px',
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <span className="status-dot" style={{
          background: isLoading ? 'var(--orange)' : pc ? 'var(--green)' : 'var(--bg4)',
          ...(pc && !isLoading ? { animation: 'pulse 2.5s ease-in-out infinite' } : {}),
        }} />
        <span style={{ fontSize: 11, fontWeight: 500, color: isLoading ? 'var(--orange)' : pc ? 'var(--green)' : 'var(--label3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {isLoading ? 'Inferring' : pc ? 'Live' : 'Idle'}
        </span>
      </div>

      {/* Corner marks */}
      {[
        { cls: { top: 10, left: 10 }, rot: '0deg'   },
        { cls: { top: 10, right: 10 }, rot: '90deg' },
        { cls: { bottom: 10, right: 10 }, rot: '180deg' },
        { cls: { bottom: 10, left: 10 }, rot: '270deg' },
      ].map((c, i) => (
        <div key={i} style={{ position: 'absolute', ...c.cls, zIndex: 10, pointerEvents: 'none', transform: `rotate(${c.rot})` }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M2 6V2H6" stroke="rgba(10,132,255,0.4)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      ))}

      {/* Three.js canvas */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 1 }}>
        <Canvas camera={{ position: [6, 5, 4], fov: 38, near: 0.1, far: 100 }} dpr={[1, 2]}>
          <color attach="background" args={['#050505']} />
          <ambientLight intensity={0.35} />
          <directionalLight position={[5, 5, 5]} intensity={0.5} />

          <Grid
            args={[20, 20]} cellSize={0.5} cellThickness={0.4}
            cellColor="#1C1C1E" sectionSize={2} sectionThickness={0.8}
            sectionColor="#2C2C2E" fadeDistance={16} fadeStrength={1} infiniteGrid
          />

          {pc ? (
            <PointCloudMesh positions={pc.positions} pressures={pc.pressures} />
          ) : (
            <EmptyState />
          )}
          <FlowArrow />

          <OrbitControls enablePan enableZoom enableRotate minDistance={2} maxDistance={20} target={[0, 0, 0.7]} />
          <GizmoHelper alignment="bottom-right" margin={[72, 72]}>
            <GizmoViewport axisColors={['#FF453A', '#30D158', '#0A84FF']} labelColor="#050505" />
          </GizmoHelper>
        </Canvas>
      </div>
    </div>
  )
}
