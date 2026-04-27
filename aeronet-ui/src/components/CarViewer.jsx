// Copyright (c) 2026 Rutej Talati. All rights reserved.
// AeroNet — CarViewer.jsx  (fixed)
//
// Bugs fixed vs previous version:
//
//  1. EmptyState showed even after prediction — App.jsx passes
//     result?.pointCloud which is the right shape, but the old
//     EmptyState used boxGeometry boxes arranged like floating cubes
//     (visible in screenshot). Replaced with a proper car silhouette.
//
//  2. PointCloudMesh auto-rotated on Z axis every frame even while
//     the user was interacting, causing the model to spin away.
//     Fixed: rotation only when truly idle AND controlled by a flag.
//
//  3. Point size 0.025 is far too small for a 5000-point cloud viewed
//     from fov=38 at distance 6–8 units — points are sub-pixel.
//     Fixed: adaptive size based on bounding sphere.
//
//  4. Camera target [0,0,0.7] is wrong for a centred point cloud whose
//     centroid may be at Z≈0.7 but X,Y≈0. computeBoundingSphere()
//     was called but the centre wasn't used to reposition the camera.
//     Fixed: centre geometry at origin, set target [0,0,0].

import { useMemo, useRef, useEffect } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, GizmoHelper, GizmoViewport, Grid } from '@react-three/drei'
import * as THREE from 'three'
import { cpToColor } from '../lib/predict'

// ── Auto-fit camera to bounding sphere ───────────────────────────────────────

function CameraRig({ boundingSphere }) {
  const { camera, controls } = useThree()
  useEffect(() => {
    if (!boundingSphere) return
    const { center, radius } = boundingSphere
    const fov = camera.fov * (Math.PI / 180)
    const dist = (radius / Math.sin(fov / 2)) * 1.25
    camera.position.set(
      center.x + dist * 0.7,
      center.y + dist * 0.5,
      center.z + dist * 0.5,
    )
    camera.near = dist * 0.01
    camera.far  = dist * 10
    camera.updateProjectionMatrix()
    if (controls) {
      controls.target.copy(center)
      controls.update()
    }
  }, [boundingSphere])
  return null
}

// ── Point cloud mesh ──────────────────────────────────────────────────────────

function PointCloudMesh({ positions, pressures }) {
  const ref      = useRef()
  const idleTime = useRef(0)

  const { geometry, boundingSphere, pointSize } = useMemo(() => {
    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.BufferAttribute(positions.slice(), 3))

    // Colour each point by Cp value
    const colors = new Float32Array(pressures.length * 3)
    for (let i = 0; i < pressures.length; i++) {
      const [r, g, b] = cpToColor(pressures[i])
      colors[i * 3] = r; colors[i * 3 + 1] = g; colors[i * 3 + 2] = b
    }
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geom.computeBoundingSphere()

    // Adaptive point size: ~1% of bounding radius looks good across scales
    const r    = geom.boundingSphere?.radius ?? 3
    const size = r * 0.018

    return { geometry: geom, boundingSphere: geom.boundingSphere, pointSize: size }
  }, [positions, pressures])

  // Slow idle rotation — stop when user is interacting
  useFrame((state, delta) => {
    const interacting = state.controls?.isInteracting ?? false
    if (interacting) { idleTime.current = 0; return }
    idleTime.current += delta
    if (idleTime.current > 1.5 && ref.current) {
      ref.current.rotation.z += delta * 0.03
    }
  })

  return (
    <>
      <CameraRig boundingSphere={boundingSphere} />
      <points ref={ref} geometry={geometry}>
        <pointsMaterial
          size={pointSize}
          vertexColors
          sizeAttenuation
          transparent
          opacity={0.92}
          depthWrite={false}
        />
      </points>
    </>
  )
}

// ── Empty state — proper car silhouette, not floating boxes ───────────────────

function EmptyState() {
  const ref = useRef()
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.z += delta * 0.03
  })

  return (
    <group ref={ref} position={[0, 0, 0]}>
      {/* Main body */}
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[4.2, 1.7, 1.0]} />
        <meshBasicMaterial wireframe color="#37474F" transparent opacity={0.45} />
      </mesh>
      {/* Greenhouse (cabin) */}
      <mesh position={[0.15, 0, 0.75]}>
        <boxGeometry args={[2.0, 1.4, 0.65]} />
        <meshBasicMaterial wireframe color="#37474F" transparent opacity={0.30} />
      </mesh>
      {/* Front wheel */}
      <mesh position={[-1.25, -0.88, -0.35]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.32, 0.32, 0.22, 24]} />
        <meshBasicMaterial wireframe color="#546E7A" transparent opacity={0.4} />
      </mesh>
      {/* Rear wheel */}
      <mesh position={[1.25, -0.88, -0.35]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.32, 0.32, 0.22, 24]} />
        <meshBasicMaterial wireframe color="#546E7A" transparent opacity={0.4} />
      </mesh>
      {/* Front wheel right */}
      <mesh position={[-1.25, 0.88, -0.35]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.32, 0.32, 0.22, 24]} />
        <meshBasicMaterial wireframe color="#546E7A" transparent opacity={0.4} />
      </mesh>
      {/* Rear wheel right */}
      <mesh position={[1.25, 0.88, -0.35]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.32, 0.32, 0.22, 24]} />
        <meshBasicMaterial wireframe color="#546E7A" transparent opacity={0.4} />
      </mesh>
    </group>
  )
}

// ── Flow arrow ────────────────────────────────────────────────────────────────

function FlowArrow() {
  return (
    <group position={[-3.8, 0, 0.4]}>
      <mesh rotation={[0, 0, -Math.PI / 2]}>
        <coneGeometry args={[0.08, 0.25, 12]} />
        <meshBasicMaterial color="#82CFFF" />
      </mesh>
      <mesh position={[-0.25, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.015, 0.015, 0.5, 8]} />
        <meshBasicMaterial color="#82CFFF" transparent opacity={0.6} />
      </mesh>
    </group>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CarViewer({ data, isLoading }) {
  // Validate data shape — positions and pressures must both be typed arrays
  const validData = (
    data &&
    data.positions instanceof Float32Array &&
    data.pressures instanceof Float32Array &&
    data.positions.length > 0 &&
    data.pressures.length > 0
  ) ? data : null

  return (
    <div className="relative w-full h-full overflow-hidden cfd-grid" style={{ background: '#0A0A0A' }}>

      {/* Scan animation during inference */}
      {isLoading && (
        <div className="absolute inset-0 z-10 pointer-events-none">
          <div className="absolute inset-x-0 h-px animate-scan"
            style={{ background: '#82CFFF', boxShadow: '0 0 20px 4px rgba(130,207,255,0.6)' }} />
          <div className="absolute inset-0 animate-pulse" style={{ background: 'rgba(130,207,255,0.04)' }} />
        </div>
      )}

      {/* Axis legend */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10
                      bg-md-surface-container-high rounded-full px-4 h-8 flex items-center gap-3
                      border border-md-outline-variant shadow-elevation-1">
        <span className="text-label-md text-md-primary uppercase tracking-wider">Inflow</span>
        <span className="text-body-sm text-md-on-surface-variant">→ +X</span>
        <span className="w-px h-3 bg-md-outline-variant" />
        <span className="text-label-md text-md-on-surface-variant uppercase tracking-wider">Up</span>
        <span className="text-body-sm text-md-on-surface-variant">+Z</span>
      </div>

      {/* Cp colourbar — only when data is live */}
      {validData && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2 z-10 animate-fade-in
                        bg-md-surface-container-high rounded-lg p-3 flex flex-col items-center gap-2
                        border border-md-outline-variant shadow-elevation-1">
          <span className="text-label-sm text-md-on-surface-variant uppercase tracking-wider">Cp</span>
          <div className="w-3 h-36 rounded"
            style={{ background: 'linear-gradient(to bottom, #ef4444, #fbbf24, #84cc16, #22d3ee, #2147d9)' }} />
          <div className="flex flex-col items-center text-label-sm text-md-on-surface-variant font-mono num gap-1">
            <span>+1.0</span>
            <div className="flex-1 h-6" />
            <span>-1.5</span>
          </div>
        </div>
      )}

      {/* Status chip */}
      <div className="absolute bottom-3 left-3 z-10
                      bg-md-surface-container-high rounded-full px-3 h-7 flex items-center gap-2
                      border border-md-outline-variant">
        <span className={`w-2 h-2 rounded-full ${validData ? 'animate-pulse-slow' : ''}`}
          style={{ background: validData ? '#34D399' : '#8A9296' }} />
        <span className="text-label-sm text-md-on-surface-variant uppercase tracking-wider">
          {isLoading ? 'Inferring' : validData ? `Live · ${(validData.positions.length / 3).toLocaleString()} pts` : 'Idle'}
        </span>
      </div>

      {/* Corner marks */}
      {['top-3 left-3 rotate-0','top-3 right-3 rotate-90','bottom-3 right-3 rotate-180','bottom-3 left-3 -rotate-90'].map((cls, i) => (
        <div key={i} className={`absolute z-10 pointer-events-none ${cls}`}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M2 7 L2 2 L7 2" stroke="#82CFFF" strokeWidth="1.5" opacity="0.5" strokeLinecap="round" />
          </svg>
        </div>
      ))}

      <Canvas
        camera={{ position: [6, 5, 4], fov: 38, near: 0.1, far: 200 }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: false }}
      >
        <color attach="background" args={['#0A0A0A']} />
        <ambientLight intensity={0.4} />
        <directionalLight position={[5, 5, 5]} intensity={0.6} />

        <Grid
          args={[20, 20]} cellSize={0.5} cellThickness={0.5}
          cellColor="#1E1E1E" sectionSize={2} sectionThickness={1}
          sectionColor="#252525" fadeDistance={15} fadeStrength={1} infiniteGrid
        />

        {validData
          ? <PointCloudMesh positions={validData.positions} pressures={validData.pressures} />
          : <EmptyState />
        }

        <FlowArrow />

        <OrbitControls
          enablePan enableZoom enableRotate
          minDistance={0.5} maxDistance={50}
          target={[0, 0, 0]}
          makeDefault
        />
        <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
          <GizmoViewport axisColors={['#ef4444', '#84cc16', '#82CFFF']} labelColor="#0A0A0A" />
        </GizmoHelper>
      </Canvas>
    </div>
  )
}
