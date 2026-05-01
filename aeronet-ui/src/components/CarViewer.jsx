// CarViewer.jsx — 3D pressure viewer for full cars AND car parts.
// Auto-scales camera and point size from the result bbox.
// Copyright (c) 2026 Rutej Talati. All rights reserved.

import { useMemo, useRef, useEffect } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, GizmoHelper, GizmoViewport, Grid } from '@react-three/drei'
import * as THREE from 'three'
import { cpToColor } from '../lib/predict'

// ── Cp → RGB colour (unchanged) ───────────────────────────────────────────────
// Imported from predict.js so the colour ramp stays in one place.

// ── Auto-scaling camera based on bbox ─────────────────────────────────────────

function CameraRig({ bbox }) {
  const { camera, controls } = useThree()
  useEffect(() => {
    if (!bbox) return
    const size   = new THREE.Vector3(
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

    camera.position.set(
      centre.x + dist * 0.7,
      centre.y + dist * 0.5,
      centre.z + dist * 0.6,
    )
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

  // Point size: smaller for parts (bbox diagonal < 1m), larger for full cars
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

  // Slow auto-rotate only when not interacting
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

// ── Empty state (wireframe placeholder) ───────────────────────────────────────

function EmptyState() {
  return (
    <group>
      <mesh position={[0, 0, 0.5]}>
        <boxGeometry args={[4.5, 1.8, 1.2]} />
        <meshBasicMaterial wireframe color="#40484C" transparent opacity={0.45} />
      </mesh>
      <mesh position={[0.3, 0, 1.3]}>
        <boxGeometry args={[2.2, 1.5, 0.8]} />
        <meshBasicMaterial wireframe color="#40484C" transparent opacity={0.3} />
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

// ── Main component ────────────────────────────────────────────────────────────

export default function CarViewer({ data, isLoading }) {
  // data can be:
  //   result.pointCloud  (older shape, full car)
  //   result.viewer.points (newer shape, both car and part)
  const pointsData = data?.viewer?.points ?? data?.pointCloud ?? null
  const bbox       = pointsData?.bbox ?? null
  const isPart     = data?.partType != null

  // Determine camera starting position from bbox diagonal
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
    <div className="relative w-full h-full overflow-hidden cfd-grid" style={{ background: '#0A0A0A' }}>

      {/* Scan animation during inference */}
      {isLoading && (
        <div className="absolute inset-0 z-10 pointer-events-none">
          <div className="absolute inset-x-0 h-px animate-scan"
            style={{ background: '#82CFFF', boxShadow: '0 0 20px 4px rgba(130,207,255,0.6)' }} />
          <div className="absolute inset-0 animate-pulse" style={{ background: 'rgba(130,207,255,0.03)' }} />
        </div>
      )}

      {/* Axis legend */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10
                      bg-m3-surface1 rounded-full px-4 h-8 flex items-center gap-3
                      border border-m3-outlineVar shadow-elev1">
        <span className="text-label-md text-m3-primary uppercase tracking-wider">
          {isPart ? 'Part' : 'Inflow'}
        </span>
        <span className="text-body-sm text-m3-onSurfVar">→ +X</span>
        <span className="w-px h-3 bg-m3-outlineVar" />
        <span className="text-label-md text-m3-onSurfVar uppercase tracking-wider">Up</span>
        <span className="text-body-sm text-m3-onSurfVar">+Z</span>
      </div>

      {/* Part label badge */}
      {isPart && data?.partType && (
        <div className="absolute top-3 left-3 z-10
                        bg-m3-surface1 rounded-lg px-3 py-1.5 border border-m3-outlineVar">
          <div className="text-label-sm text-m3-primary uppercase tracking-wider">Part Mode</div>
          <div className="text-body-sm text-m3-onBg capitalize font-medium">
            {data.partType.replace(/_/g, ' ')}
          </div>
          {data.deltaCd !== undefined && (
            <div className={`text-label-sm font-mono font-bold mt-0.5
              ${data.deltaCd < 0 ? 'text-m3-ok' : 'text-m3-err'}`}>
              ΔCd {data.deltaCd > 0 ? '+' : ''}{data.deltaCd.toFixed(4)}
            </div>
          )}
        </div>
      )}

      {/* Cp colorbar */}
      {pointsData && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2 z-10 animate-fade-in
                        bg-m3-surface1 rounded-lg p-3 flex flex-col items-center gap-2
                        border border-m3-outlineVar shadow-elev1">
          <span className="text-label-sm text-m3-onSurfVar uppercase tracking-wider">Cp</span>
          <div className="w-3 h-36 rounded"
            style={{ background: 'linear-gradient(to bottom, #ef4444, #fbbf24, #84cc16, #22d3ee, #2147d9)' }} />
          <div className="flex flex-col items-center text-label-sm text-m3-onSurfVar font-mono gap-1">
            <span>+1.0</span>
            <div className="flex-1 h-6" />
            <span>-1.5</span>
          </div>
        </div>
      )}

      {/* Status chip */}
      <div className="absolute bottom-3 left-3 z-10
                      bg-m3-surface1 rounded-full px-3 h-7 flex items-center gap-2
                      border border-m3-outlineVar">
        <span className={`w-2 h-2 rounded-full ${pointsData ? 'animate-pulse-slow' : ''}`}
          style={{ background: pointsData ? '#34D399' : '#8A9296' }} />
        <span className="text-label-sm text-m3-onSurfVar uppercase tracking-wider">
          {isLoading ? 'Inferring' : pointsData ? (isPart ? 'Part · Live' : 'Live') : 'Idle'}
        </span>
      </div>

      {/* Corner marks */}
      {['top-3 left-3', 'top-3 right-3 rotate-90', 'bottom-3 right-3 rotate-180', 'bottom-3 left-3 -rotate-90'].map((cls, i) => (
        <div key={i} className={`absolute z-10 pointer-events-none ${cls}`}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M2 7L2 2L7 2" stroke="#82CFFF" strokeWidth="1.5" opacity="0.4" strokeLinecap="round" />
          </svg>
        </div>
      ))}

      <Canvas
        camera={{ position: camPos, fov: 38, near: 0.001, far: 500 }}
        dpr={[1, 2]}
      >
        <color attach="background" args={['#0A0A0A']} />
        <ambientLight intensity={0.4} />
        <directionalLight position={[5, 5, 5]} intensity={0.6} />

        <Grid
          args={[20, 20]} cellSize={0.5} cellThickness={0.5}
          cellColor="#1E1E1E" sectionSize={2} sectionThickness={1}
          sectionColor="#252525" fadeDistance={15} fadeStrength={1} infiniteGrid
        />

        {pointsData
          ? <PointCloudMesh
              positions={pointsData.positions}
              pressures={pointsData.pressures}
              bbox={bbox}
            />
          : <EmptyState />
        }

        <FlowArrow scale={bbox
          ? Math.max(0.2, (bbox.max[0]-bbox.min[0]) * 0.6)
          : 1}
        />

        <OrbitControls enablePan enableZoom enableRotate minDistance={0.05} maxDistance={200}
          target={bbox
            ? [(bbox.min[0]+bbox.max[0])/2, (bbox.min[1]+bbox.max[1])/2, (bbox.min[2]+bbox.max[2])/2]
            : [0, 0, 0.7]}
        />

        {/* Camera auto-adjustment when bbox changes */}
        <CameraRig bbox={bbox} />

        <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
          <GizmoViewport axisColors={['#ef4444', '#84cc16', '#82CFFF']} labelColor="#0A0A0A" />
        </GizmoHelper>
      </Canvas>
    </div>
  )
}
