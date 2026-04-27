// Copyright (c) 2026 Rutej Talati. All rights reserved.

import { useMemo, useRef, useState, useCallback, useEffect } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, GizmoHelper, GizmoViewport, Grid, PerspectiveCamera } from '@react-three/drei'
import * as THREE from 'three'
import { cpToColor } from '../lib/predict'

// ── Camera presets ─────────────────────────────────────────────────────────────
const PRESETS = [
  { id: 'iso',   label: 'ISO',   pos: [6, 4, 3.5],  target: [0, 0, 0.7] },
  { id: 'side',  label: 'Side',  pos: [0, 9, 1.2],  target: [0, 0, 1.2] },
  { id: 'front', label: 'Front', pos: [8, 0, 1.2],  target: [0, 0, 1.2] },
  { id: 'top',   label: 'Top',   pos: [0, 0, 10],   target: [0, 0, 0.7] },
  { id: 'rear',  label: 'Rear',  pos: [-8, 0, 1.2], target: [0, 0, 1.2] },
]

// ── Point cloud ────────────────────────────────────────────────────────────────
function PointCloudMesh({ positions, pressures }) {
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

  return (
    <points geometry={geometry}>
      <pointsMaterial size={0.028} vertexColors sizeAttenuation transparent opacity={0.92} />
    </points>
  )
}

// ── Wireframe car placeholder ──────────────────────────────────────────────────
function WireframeCar() {
  return (
    <group>
      {/* Main body */}
      <mesh position={[0, 0, 0.62]}>
        <boxGeometry args={[4.6, 1.82, 1.24]} />
        <meshBasicMaterial wireframe color="#2C3E42" transparent opacity={0.7} />
      </mesh>
      {/* Cabin */}
      <mesh position={[0.2, 0, 1.44]}>
        <boxGeometry args={[2.1, 1.5, 0.72]} />
        <meshBasicMaterial wireframe color="#243339" transparent opacity={0.5} />
      </mesh>
      {/* Wheels */}
      {[[-1.4, -0.94, 0.32], [-1.4, 0.94, 0.32], [1.4, -0.94, 0.32], [1.4, 0.94, 0.32]].map(([x, y, z], i) => (
        <mesh key={i} position={[x, y, z]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.34, 0.34, 0.22, 24]} />
          <meshBasicMaterial wireframe color="#1a2e33" transparent opacity={0.6} />
        </mesh>
      ))}
    </group>
  )
}

// ── Flow arrows (wind tunnel feel) ────────────────────────────────────────────
function FlowLines() {
  const yPositions = [-0.6, 0, 0.6]
  const zPositions = [0.3, 1.0, 1.7]
  return (
    <group>
      {yPositions.map(y =>
        zPositions.map(z => (
          <group key={`${y}-${z}`} position={[-5, y, z]}>
            <mesh rotation={[0, 0, -Math.PI / 2]}>
              <coneGeometry args={[0.04, 0.18, 8]} />
              <meshBasicMaterial color="#0A84FF" transparent opacity={0.3} />
            </mesh>
            <mesh position={[-0.3, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.008, 0.008, 0.6, 6]} />
              <meshBasicMaterial color="#0A84FF" transparent opacity={0.15} />
            </mesh>
          </group>
        ))
      )}
    </group>
  )
}

// ── Camera controller — handles preset jumps ──────────────────────────────────
function CameraController({ preset, controlsRef }) {
  const { camera } = useThree()
  const prevPreset = useRef(null)

  useEffect(() => {
    if (!preset || preset.id === prevPreset.current) return
    prevPreset.current = preset.id
    const [px, py, pz] = preset.pos
    const [tx, ty, tz] = preset.target
    // Smooth lerp to preset
    const startPos = camera.position.clone()
    const endPos = new THREE.Vector3(px, py, pz)
    const startTarget = controlsRef.current?.target.clone() ?? new THREE.Vector3(tx, ty, tz)
    const endTarget = new THREE.Vector3(tx, ty, tz)
    let t = 0
    const step = () => {
      t = Math.min(1, t + 0.06)
      const ease = 1 - Math.pow(1 - t, 3)
      camera.position.lerpVectors(startPos, endPos, ease)
      if (controlsRef.current) {
        controlsRef.current.target.lerpVectors(startTarget, endTarget, ease)
        controlsRef.current.update()
      }
      if (t < 1) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }, [preset])

  return null
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function CarViewer({ data, isLoading }) {
  const pc = data?.pointCloud ?? null
  const controlsRef = useRef(null)
  const [activePreset, setActivePreset] = useState(PRESETS[0])
  const [isDragging, setIsDragging] = useState(false)
  const [ptSize, setPtSize] = useState(1)        // point size multiplier
  const [showGrid, setShowGrid] = useState(true)
  const [showFlow, setShowFlow] = useState(true)

  const jumpToPreset = useCallback((p) => {
    setActivePreset({ ...p, _ts: Date.now() }) // force effect re-run
  }, [])

  return (
    <div
      style={{ position: 'relative', width: '100%', height: '100%', background: '#030608' }}
      onMouseDown={() => setIsDragging(true)}
      onMouseUp={() => setIsDragging(false)}
    >
      {/* ── Scan animation ── */}
      {isLoading && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 20, pointerEvents: 'none' }}>
          <div style={{
            position: 'absolute', insetInline: 0, height: 1,
            background: 'var(--blue)', boxShadow: '0 0 20px 4px rgba(10,132,255,0.55)',
            animation: 'scan 2.4s ease-in-out infinite',
          }} />
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(10,132,255,0.025)', animation: 'pulse 2.5s ease-in-out infinite' }} />
        </div>
      )}

      {/* ── Top bar: view presets ── */}
      <div style={{
        position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
        zIndex: 10, display: 'flex', alignItems: 'center', gap: 2,
        background: 'rgba(3,6,8,0.82)', backdropFilter: 'blur(16px)',
        border: '0.5px solid rgba(255,255,255,0.08)', borderRadius: 10,
        padding: '4px',
      }}>
        {PRESETS.map(p => (
          <button key={p.id} onClick={() => jumpToPreset(p)} style={{
            padding: '4px 12px', borderRadius: 7, border: 'none', cursor: 'pointer',
            background: activePreset?.id === p.id ? 'rgba(10,132,255,0.22)' : 'transparent',
            color: activePreset?.id === p.id ? 'var(--blue)' : 'rgba(235,235,245,0.45)',
            fontSize: 11, fontWeight: 600, letterSpacing: '0.04em',
            fontFamily: "'IBM Plex Sans', sans-serif",
            transition: 'background 0.15s, color 0.15s',
          }}>
            {p.label}
          </button>
        ))}
      </div>

      {/* ── Right toolbar ── */}
      <div style={{
        position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
        zIndex: 10, display: 'flex', flexDirection: 'column', gap: 4,
      }}>
        {/* Cp colorbar */}
        {pc && (
          <div style={{
            background: 'rgba(3,6,8,0.82)', backdropFilter: 'blur(16px)',
            border: '0.5px solid rgba(255,255,255,0.08)', borderRadius: 10,
            padding: '10px 8px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
            marginBottom: 8,
          }}>
            <span style={{ fontSize: 9, fontWeight: 600, color: 'rgba(235,235,245,0.4)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Cp</span>
            <div style={{ position: 'relative', width: 10, height: 110 }}>
              <div style={{
                width: 10, height: 110, borderRadius: 5,
                background: 'linear-gradient(to bottom, #ef4444, #fb923c, #fbbf24, #4ade80, #22d3ee, #3b82f6)',
              }} />
              {['+1.0', ' 0.0', '−1.5'].map((v, i) => (
                <span key={v} style={{
                  position: 'absolute', right: 14,
                  top: i === 0 ? 0 : i === 1 ? '42%' : '100%',
                  transform: 'translateY(-50%)',
                  fontSize: 9, color: 'rgba(235,235,245,0.4)',
                  fontFamily: "'IBM Plex Mono', monospace", whiteSpace: 'nowrap',
                }}>{v}</span>
              ))}
            </div>
          </div>
        )}

        {/* View controls */}
        <div style={{
          background: 'rgba(3,6,8,0.82)', backdropFilter: 'blur(16px)',
          border: '0.5px solid rgba(255,255,255,0.08)', borderRadius: 10,
          padding: '6px', display: 'flex', flexDirection: 'column', gap: 2,
        }}>
          {[
            { label: 'GD', title: 'Grid', active: showGrid, toggle: () => setShowGrid(v => !v) },
            { label: 'FL', title: 'Flow', active: showFlow, toggle: () => setShowFlow(v => !v) },
          ].map(btn => (
            <button key={btn.label} onClick={btn.toggle} title={btn.title} style={{
              width: 32, height: 28, borderRadius: 6, border: 'none', cursor: 'pointer',
              background: btn.active ? 'rgba(10,132,255,0.2)' : 'transparent',
              color: btn.active ? 'var(--blue)' : 'rgba(235,235,245,0.35)',
              fontSize: 9, fontWeight: 700, letterSpacing: '0.04em',
              fontFamily: "'IBM Plex Mono', monospace",
              transition: 'background 0.15s, color 0.15s',
            }}>{btn.label}</button>
          ))}
        </div>
      </div>

      {/* ── Bottom left: status + point count ── */}
      <div style={{
        position: 'absolute', bottom: 12, left: 12, zIndex: 10,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <div style={{
          background: 'rgba(3,6,8,0.82)', backdropFilter: 'blur(16px)',
          border: '0.5px solid rgba(255,255,255,0.08)', borderRadius: 20,
          padding: '4px 12px', display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
            background: isLoading ? 'var(--orange)' : pc ? 'var(--green)' : '#3A3A3C',
            boxShadow: pc && !isLoading ? '0 0 5px var(--green)' : 'none',
            animation: pc && !isLoading ? 'pulse 2.5s ease-in-out infinite' : 'none',
          }} />
          <span style={{ fontSize: 11, fontWeight: 500, color: isLoading ? 'var(--orange)' : pc ? 'var(--green)' : 'rgba(235,235,245,0.3)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            {isLoading ? 'Inferring' : pc ? 'Live' : 'Idle'}
          </span>
        </div>
        {pc && (
          <div style={{
            background: 'rgba(3,6,8,0.82)', backdropFilter: 'blur(16px)',
            border: '0.5px solid rgba(255,255,255,0.08)', borderRadius: 20,
            padding: '4px 12px',
          }}>
            <span style={{ fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", color: 'rgba(235,235,245,0.35)' }}>
              {(pc.positions.length / 3).toLocaleString()} pts
            </span>
          </div>
        )}
      </div>

      {/* ── Bottom right: mouse hint ── */}
      <div style={{
        position: 'absolute', bottom: 12, right: 12, zIndex: 10,
        background: 'rgba(3,6,8,0.82)', backdropFilter: 'blur(16px)',
        border: '0.5px solid rgba(255,255,255,0.08)', borderRadius: 8,
        padding: '5px 10px', display: 'flex', gap: 14,
      }}>
        {[['LMB', 'Rotate'], ['RMB', 'Pan'], ['Scroll', 'Zoom']].map(([key, act]) => (
          <span key={key} style={{ fontSize: 10, color: 'rgba(235,235,245,0.3)', fontFamily: "'IBM Plex Sans', sans-serif" }}>
            <span style={{ color: 'rgba(235,235,245,0.55)', fontWeight: 600 }}>{key}</span> {act}
          </span>
        ))}
      </div>

      {/* ── Corner brackets ── */}
      {[
        { s: { top: 10, left: 10 },    r: 0   },
        { s: { top: 10, right: 10 },   r: 90  },
        { s: { bottom: 10, right: 10 }, r: 180 },
        { s: { bottom: 10, left: 10 },  r: 270 },
      ].map((c, i) => (
        <div key={i} style={{ position: 'absolute', ...c.s, zIndex: 10, pointerEvents: 'none', transform: `rotate(${c.r}deg)` }}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 5V2H5" stroke="rgba(10,132,255,0.35)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      ))}

      {/* ── Three.js Canvas ── */}
      <div style={{ position: 'absolute', inset: 0, cursor: isDragging ? 'grabbing' : 'grab' }}>
        <Canvas
          camera={{ position: [6, 4, 3.5], fov: 40, near: 0.05, far: 200 }}
          dpr={[1, 2]}
          gl={{ antialias: true, alpha: false }}
        >
          <color attach="background" args={['#030608']} />
          <ambientLight intensity={0.5} />
          <directionalLight position={[8, 6, 6]} intensity={0.8} castShadow />
          <directionalLight position={[-4, -2, 3]} intensity={0.2} />

          {showGrid && (
            <Grid
              args={[30, 30]}
              cellSize={0.5} cellThickness={0.3} cellColor="#1a2428"
              sectionSize={2} sectionThickness={0.6} sectionColor="#1e2b30"
              fadeDistance={22} fadeStrength={1.2} infiniteGrid
            />
          )}

          {pc ? (
            <PointCloudMesh positions={pc.positions} pressures={pc.pressures} />
          ) : (
            <WireframeCar />
          )}

          {showFlow && <FlowLines />}

          <CameraController preset={activePreset} controlsRef={controlsRef} />

          <OrbitControls
            ref={controlsRef}
            enablePan={true}
            enableZoom={true}
            enableRotate={true}
            panSpeed={0.8}
            rotateSpeed={0.65}
            zoomSpeed={1.1}
            minDistance={1}
            maxDistance={40}
            target={[0, 0, 0.7]}
            mouseButtons={{
              LEFT: THREE.MOUSE.ROTATE,
              MIDDLE: THREE.MOUSE.DOLLY,
              RIGHT: THREE.MOUSE.PAN,
            }}
            touches={{
              ONE: THREE.TOUCH.ROTATE,
              TWO: THREE.TOUCH.DOLLY_PAN,
            }}
          />

          <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
            <GizmoViewport
              axisColors={['#FF453A', '#30D158', '#0A84FF']}
              labelColor="#fff"
              hideNegativeAxes={false}
            />
          </GizmoHelper>
        </Canvas>
      </div>
    </div>
  )
}
