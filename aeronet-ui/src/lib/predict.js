// Copyright (c) 2026 Rutej Talati. All rights reserved.
// AeroNet — neural surrogate model for vehicle aerodynamics.

/**
 * Mock prediction backend.
 *
 * Computes plausible Cd/Cl/Cs values from file metadata and a few user
 * parameters. The values are deterministic (same input -> same output) and
 * vary meaningfully across different inputs, so the demo feels real even
 * though no model is running.
 *
 * To swap in a real backend (Tuesday onwards, after the model is trained):
 *   replace `predict()` with a fetch() call to your FastAPI / Flask endpoint
 *   that runs AeroNet inference. Everything else stays the same.
 */

// 32-bit FNV-1a hash — good enough deterministic seed from a string
function hashString(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

// Seeded pseudo-random in [0, 1)
function seededRand(seed) {
  let s = seed >>> 0
  return () => {
    s = Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) >>> 0
    s = Math.imul(s ^ (s >>> 12), 0x297a2d39) >>> 0
    return ((s ^ (s >>> 15)) >>> 0) / 0x100000000
  }
}

const BODY_PROFILES = {
  notchback: { cdBase: 0.298, clBase: 0.04, label: 'Notchback' },
  fastback:  { cdBase: 0.275, clBase: -0.02, label: 'Fastback'  },
  estate:    { cdBase: 0.312, clBase: 0.07, label: 'Estate'    },
  suv:       { cdBase: 0.385, clBase: 0.12, label: 'SUV'       },
  pickup:    { cdBase: 0.420, clBase: 0.14, label: 'Pickup'    },
}

/**
 * Generate a synthetic 3D point cloud + per-point pressure field for the
 * 3D viewer. Uses a parameterized car-shaped surface so different bodies
 * look meaningfully different.
 *
 * Returns:
 *   positions: Float32Array (3 * N) of [x, y, z, x, y, z, ...] in metres
 *   pressures: Float32Array (N)     pressure coefficient Cp at each point
 *   bbox:      { min: [x,y,z], max: [x,y,z] }
 */
export function generatePointCloud({ bodyType = 'fastback', sizeFactor = 1.0, n = 4000, seed = 0 }) {
  const rand = seededRand(seed || 1)
  const positions = new Float32Array(n * 3)
  const pressures = new Float32Array(n)

  // Body proportions in metres (DrivAer-ish baseline).
  const L = 4.6 * sizeFactor   // length (along x = inflow)
  const W = 1.85 * sizeFactor  // width (y)
  const H = 1.42 * sizeFactor  // height (z)

  // Roof shape varies by body type.
  let roofProfile
  switch (bodyType) {
    case 'notchback': roofProfile = (t) => Math.pow(Math.sin(Math.PI * t), 0.6) - 0.15 * Math.max(0, t - 0.7); break
    case 'estate':    roofProfile = (t) => Math.pow(Math.sin(Math.PI * Math.min(t, 0.85)), 0.5); break
    case 'suv':       roofProfile = (t) => Math.pow(Math.sin(Math.PI * Math.min(t, 0.8)), 0.35); break
    case 'pickup':    roofProfile = (t) => (t < 0.55 ? Math.pow(Math.sin(Math.PI * t / 0.55 / 2), 0.4) : 0.3); break
    case 'fastback':
    default:          roofProfile = (t) => Math.pow(Math.sin(Math.PI * t), 0.7); break
  }

  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity

  for (let i = 0; i < n; i++) {
    const t = rand()                                     // along length [0..1]
    const phi = rand() * Math.PI * 2                     // around circumference

    const localH = H * roofProfile(t)
    const localW = W * (0.6 + 0.4 * Math.sin(Math.PI * t))   // pinched at ends

    const x = (t - 0.5) * L
    const y = Math.cos(phi) * localW * 0.5
    const z = (Math.sin(phi) * localH * 0.5) + localH * 0.5  // sit on ground

    positions[i * 3 + 0] = x
    positions[i * 3 + 1] = y
    positions[i * 3 + 2] = z

    // Synthetic pressure coefficient: stagnation at front, suction over roof,
    // wake at rear. Cp roughly in [-1.2, +1.0].
    const cpStag = Math.max(0, 1.0 - 4 * t * t)              // front face
    const cpRoof = -1.2 * Math.sin(Math.PI * t) * Math.pow(Math.abs(Math.sin(phi)), 0.5)
    const cpWake = -0.6 * Math.max(0, t - 0.85) * 5
    pressures[i] = cpStag + cpRoof + cpWake + 0.05 * (rand() - 0.5)

    if (x < minX) minX = x; if (x > maxX) maxX = x
    if (y < minY) minY = y; if (y > maxY) maxY = y
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
  }

  return {
    positions,
    pressures,
    bbox: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
    stats: {
      length: L, width: W, height: H,
      pointCount: n,
    },
  }
}

import { predictRemote, checkBackendHealth } from './api'

// In-memory backend status. Updated by checkBackendHealth() calls so we don't
// hit /predict on a known-dead server. The UI also shows this as a status pill.
let _backendStatus = { online: false, model: null, lastChecked: 0 }

export function getBackendStatus() {
  return { ..._backendStatus }
}

/**
 * Refresh the cached backend health. Call from the UI on mount and periodically.
 * Returns the same shape getBackendStatus() returns.
 */
export async function refreshBackendStatus() {
  const result = await checkBackendHealth()
  _backendStatus = {
    online: result.online,
    model: result.model ?? null,
    error: result.error ?? null,
    lastChecked: Date.now(),
  }
  return getBackendStatus()
}

/**
 * Top-level predictor used by the UI. Tries the real backend first; if that
 * fails for any reason, falls back to the mock predictor and tags the result
 * with `_source: 'mock'` so the UI can show an honest indicator.
 *
 * @param {File}   file               the uploaded VTK / STL / mock file
 * @param {object} params             see predictMock for shape
 * @returns {Promise<object>}         prediction with `_source: 'backend' | 'mock'`
 */
export async function predict(file, params) {
  // Quick health check (cached if checked very recently)
  const stale = Date.now() - _backendStatus.lastChecked > 10_000
  if (stale) {
    await refreshBackendStatus()
  }

  // Only try the real backend if it's online AND a model is loaded.
  if (_backendStatus.online && _backendStatus.model) {
    try {
      const result = await predictRemote(file, params)
      return { ...result, _source: 'backend' }
    } catch (e) {
      console.warn('[predict] Backend call failed, falling back to mock:', e.message)
      // Mark backend as offline so we don't keep retrying for the next 10s
      _backendStatus = { ..._backendStatus, online: false, error: e.message, lastChecked: Date.now() }
    }
  }

  const mockResult = await predictMock(file, params)
  return { ...mockResult, _source: 'mock' }
}

/**
 * Mock prediction. Used as fallback when the real backend isn't reachable.
 *
 * Computes plausible Cd/Cl/Cs values from file metadata and a few user
 * parameters. Values are deterministic (same input -> same output) so
 * the UI behaves consistently in offline / mock-only mode.
 */
export async function predictMock(file, params) {
  // Simulate model latency for realism — real inference on the trained
  // model should take ~50-200ms per case on RTX 4090.
  const latencyMs = 600 + Math.random() * 400
  await new Promise((r) => setTimeout(r, latencyMs))

  const seed = hashString(`${file?.name ?? 'demo'}_${file?.size ?? 0}`)
  const rand = seededRand(seed)
  const profile = BODY_PROFILES[params.bodyType] ?? BODY_PROFILES.fastback

  // Cd driven by body profile + size + light noise. Within +/- 10% of base.
  const sizeEffect = (params.sizeFactor - 1.0) * 0.05         // larger -> slightly more drag
  const noise = (rand() - 0.5) * 0.04
  const Cd = profile.cdBase + sizeEffect + noise

  // Cl driven by profile + ramp-angle-like noise.
  const Cl = profile.clBase + (rand() - 0.5) * 0.03

  // Side force ~ 0
  const Cs = (rand() - 0.5) * 0.005

  // Synthetic drag breakdown by region — realistic proportions.
  const dragBreakdown = [
    { region: 'Front fascia',    fraction: 0.32 + (rand() - 0.5) * 0.04 },
    { region: 'Greenhouse',      fraction: 0.22 + (rand() - 0.5) * 0.03 },
    { region: 'Underbody',       fraction: 0.18 + (rand() - 0.5) * 0.03 },
    { region: 'Wheels',          fraction: 0.14 + (rand() - 0.5) * 0.02 },
    { region: 'Mirrors',         fraction: 0.06 + (rand() - 0.5) * 0.01 },
    { region: 'Rear / wake',     fraction: 0.08 + (rand() - 0.5) * 0.02 },
  ]
  // Renormalize to sum=1
  const totalFrac = dragBreakdown.reduce((s, d) => s + d.fraction, 0)
  dragBreakdown.forEach((d) => { d.fraction /= totalFrac })

  // Generate the point cloud for the 3D viewer.
  const pointCloud = generatePointCloud({
    bodyType: params.bodyType,
    sizeFactor: params.sizeFactor,
    n: 5000,
    seed,
  })

  // Force in newtons
  const qInf = 0.5 * params.rho * params.uRef * params.uRef * params.aRef
  const dragForceN = Cd * qInf
  const liftForceN = Cl * qInf

  // "Confidence" — based on how far inputs are from the training distribution.
  // Mock: drops if u_ref is unusual or sizeFactor is extreme.
  const uDeviation = Math.abs(params.uRef - 40) / 40
  const sizeDeviation = Math.abs(params.sizeFactor - 1.0) / 0.2
  const confidence = Math.max(0.55, Math.min(0.96,
    0.95 - 0.15 * uDeviation - 0.1 * sizeDeviation - 0.02 * rand()
  ))

  return {
    Cd: round(Cd, 4),
    Cl: round(Cl, 4),
    Cs: round(Cs, 4),
    dragForceN: round(dragForceN, 1),
    liftForceN: round(liftForceN, 1),
    qInfPa: round(qInf, 1),
    confidence: round(confidence, 3),
    bodyTypeLabel: profile.label,
    dragBreakdown,
    pointCloud,
    inferenceMs: round(latencyMs, 0),
    timestamp: new Date().toISOString(),
  }
}

function round(x, dp) {
  const m = Math.pow(10, dp)
  return Math.round(x * m) / m
}

/**
 * Convert Cp ∈ [-1.5, +1.0] into an RGB color along the CFD pressure-map
 * convention: blue (suction) → cyan → green → yellow → red (stagnation).
 * Returns an array [r, g, b] with components in [0, 1].
 */
export function cpToColor(cp) {
  const t = Math.max(0, Math.min(1, (cp + 1.5) / 2.5))   // -1.5..+1.0 -> 0..1
  const stops = [
    [0.0, [0.13, 0.27, 0.85]],   // deep blue
    [0.25, [0.13, 0.83, 0.93]],  // cyan
    [0.5, [0.52, 0.80, 0.10]],   // green
    [0.75, [0.98, 0.75, 0.14]],  // amber
    [1.0, [0.94, 0.27, 0.27]],   // red
  ]
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i], [t1, c1] = stops[i + 1]
    if (t <= t1) {
      const f = (t - t0) / (t1 - t0)
      return [c0[0] + (c1[0] - c0[0]) * f, c0[1] + (c1[1] - c0[1]) * f, c0[2] + (c1[2] - c0[2]) * f]
    }
  }
  return [0.94, 0.27, 0.27]
}
