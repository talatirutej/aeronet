// api.js — unified frontend ↔ backend client
// Copyright (c) 2026 Rutej Talati. All rights reserved.
//
// WHAT EACH ENDPOINT ACTUALLY DOES:
//
//   /surrogate/predict  → REAL sklearn ML (GradBoost, R²=0.9525 on DrivAerML)
//   /surrogate/sweep    → REAL parameter sweep on trained models
//   /predict            → STUB — synthetic point cloud, hardcoded Cd shape
//   /predict-part       → STUB — part-shaped point cloud, Moondream2 ΔCd
//   /analyze            → REAL Moondream2 vision inference
//
// Both STUBs return the exact shape that CarViewer and ResultsPanel expect,
// so swapping them for real models requires no frontend changes.

const BACKEND = import.meta.env?.VITE_AERONET_BACKEND ?? 'http://127.0.0.1:8000'

// ── Typed array conversion ────────────────────────────────────────────────────
// The backend sends plain JSON arrays; three-fiber needs Float32Array / Uint32Array.

function _typedArrays(data) {
  const toF32 = (arr) => arr instanceof Float32Array ? arr : Float32Array.from(arr ?? [])
  const toU32  = (arr) => arr instanceof Uint32Array  ? arr : Uint32Array.from(arr ?? [])

  if (data?.pointCloud) {
    data.pointCloud.positions = toF32(data.pointCloud.positions)
    data.pointCloud.pressures = toF32(data.pointCloud.pressures)
  }
  if (data?.viewer?.points) {
    data.viewer.points.positions = toF32(data.viewer.points.positions)
    data.viewer.points.pressures = toF32(data.viewer.points.pressures)
  }
  if (data?.viewer?.mesh) {
    data.viewer.mesh.positions = toF32(data.viewer.mesh.positions)
    data.viewer.mesh.indices   = toU32(data.viewer.mesh.indices)
    data.viewer.mesh.pressures = toF32(data.viewer.mesh.pressures)
  }
  return data
}

async function _post(path, formData, timeoutMs = 600_000) {
  const ctrl  = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  let res
  try {
    res = await fetch(`${BACKEND}${path}`, {
      method: 'POST', body: formData, signal: ctrl.signal,
    })
  } catch (e) {
    clearTimeout(timer)
    throw new Error(
      e?.name === 'AbortError'
        ? `Backend timed out after ${timeoutMs / 1000}s`
        : `Backend unreachable: ${e?.message ?? 'network error'}`
    )
  }
  clearTimeout(timer)
  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try { const err = await res.json(); if (err?.detail) detail = err.detail } catch {}
    throw new Error(`Backend error: ${detail}`)
  }
  return res.json()
}

// ── Health check ──────────────────────────────────────────────────────────────

export async function checkBackendHealth({ timeoutMs = 2000 } = {}) {
  const ctrl  = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res  = await fetch(`${BACKEND}/health`, { signal: ctrl.signal })
    if (!res.ok) return { online: false, error: `HTTP ${res.status}` }
    return { online: true }
  } catch (e) {
    return { online: false, error: e?.name === 'AbortError' ? 'timeout' : e?.message }
  } finally {
    clearTimeout(timer)
  }
}

export async function refreshBackendStatus() {
  return checkBackendHealth()
}

// ── Full-car simulation (STUB until PointNet++ checkpoint ready) ───────────────

export async function predictFullCar(file, params) {
  const fd = new FormData()
  fd.append('file', file)
  fd.append('yaw',              params.yawAngleDeg       ?? 0)
  fd.append('speed',            (params.uRef ?? 40) * 3.6)  // m/s → km/h
  fd.append('groundClearance',  params.groundClearanceMm ?? 100)
  fd.append('frontalArea',      params.aRef              ?? 2.37)
  fd.append('bodyType',         params.bodyType          ?? 'fastback')
  fd.append('turbulenceModel',  'k-omega SST')
  return _typedArrays(await _post('/predict', fd))
}

// ── Car-part simulation (STUB, uses Moondream2 ΔCd estimate) ─────────────────

export async function predictPart(file, params) {
  const fd = new FormData()
  if (file && file.size > 0) fd.append('file', file)
  fd.append('partType',      params.partType     ?? 'front_bumper')
  fd.append('partLocation',  params.partLocation ?? 'front')
  fd.append('speed',         (params.uRef ?? 40) * 3.6)
  fd.append('frontalArea',   params.aRef         ?? 2.37)
  fd.append('imageAnalysis', params.imageAnalysis
    ? JSON.stringify(params.imageAnalysis) : '{}')
  return _typedArrays(await _post('/predict-part', fd))
}

// ── Unified predict — routes to the right endpoint based on mode ──────────────

export async function predict(file, params) {
  if (params.mode === 'part') return predictPart(file, params)
  return predictFullCar(file, params)
}

// ── Surrogate model (REAL sklearn inference) ──────────────────────────────────

export async function predictSurrogate(features, activeModel = 'GradBoost-DrivAerML') {
  const res = await fetch(`${BACKEND}/surrogate/predict`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ features, active_model: activeModel }),
  })
  if (!res.ok) throw new Error(`Surrogate predict failed: HTTP ${res.status}`)
  return res.json()
}

export async function sweepSurrogate(param, fixedFeatures, activeModel, nPoints = 40) {
  const res = await fetch(`${BACKEND}/surrogate/sweep`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      param, fixed_features: fixedFeatures,
      active_model: activeModel, n_points: nPoints,
    }),
  })
  if (!res.ok) throw new Error(`Surrogate sweep failed: HTTP ${res.status}`)
  return res.json()
}

export async function getSurrogateStatus() {
  const res = await fetch(`${BACKEND}/surrogate/status`)
  if (!res.ok) return null
  return res.json()
}

// ── Backwards-compatibility aliases ──────────────────────────────────────────
// The existing predict.js in the repo imports these names — keep them working.

export const predictRemote = predictFullCar

// ── Image analysis (REAL Moondream2) ─────────────────────────────────────────

export async function analyzeImage(imageFile) {
  const fd = new FormData()
  fd.append('file', imageFile)
  return _post('/analyze', fd, 120_000)  // 2 min timeout — CPU inference is slow
}
