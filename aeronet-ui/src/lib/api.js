// Copyright (c) 2026 Rutej Talati. All rights reserved.
// AeroNet — neural surrogate model for vehicle aerodynamics.

const DEFAULT_BACKEND = "https://aeronet-osiw.onrender.com"

export function getBackendUrl() {
  return import.meta.env?.VITE_AERONET_BACKEND ?? DEFAULT_BACKEND
}

export async function checkBackendHealth({ timeoutMs = 1500 } = {}) {
  const url = `${getBackendUrl()}/health`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) return { online: false, error: `HTTP ${res.status}` }
    const data = await res.json()
    return { online: true, model: data?.model?.loaded ? data.model : null }
  } catch (e) {
    return { online: false, error: e?.name === "AbortError" ? "timeout" : (e?.message ?? "unknown") }
  } finally {
    clearTimeout(timer)
  }
}

export async function predictRemote(file, params, { timeoutMs = 600_000 } = {}) {
  const url = `${getBackendUrl()}/predict`
  const formData = new FormData()
  formData.append("file", file)
  formData.append("params", JSON.stringify({
    body_type:            params.bodyType,
    u_ref:                params.uRef,
    rho:                  params.rho,
    a_ref:                params.aRef,
    size_factor:          params.sizeFactor,
    yaw_angle_deg:        params.yawAngleDeg        ?? 0,
    ground_clearance_mm:  params.groundClearanceMm  ?? 100,
  }))

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let res
  try {
    res = await fetch(url, { method: "POST", body: formData, signal: controller.signal })
  } catch (e) {
    clearTimeout(timer)
    throw new Error(
      e?.name === "AbortError"
        ? `Backend timed out after ${timeoutMs / 1000}s`
        : `Backend unreachable: ${e?.message ?? "network error"}`
    )
  }
  clearTimeout(timer)

  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try { const err = await res.json(); if (err?.detail) detail = err.detail } catch {}
    throw new Error(`Backend rejected request: ${detail}`)
  }

  const data = await res.json()

  // Convert plain arrays to typed arrays for three-fiber
  if (data?.pointCloud) {
    data.pointCloud.positions = Float32Array.from(data.pointCloud.positions)
    data.pointCloud.pressures = Float32Array.from(data.pointCloud.pressures)
  }
  if (data?.viewer?.points) {
    data.viewer.points.positions = Float32Array.from(data.viewer.points.positions)
    data.viewer.points.pressures = Float32Array.from(data.viewer.points.pressures)
  }
  if (data?.viewer?.mesh) {
    data.viewer.mesh.positions = Float32Array.from(data.viewer.mesh.positions)
    data.viewer.mesh.indices   = Uint32Array.from(data.viewer.mesh.indices)
    data.viewer.mesh.pressures = Float32Array.from(data.viewer.mesh.pressures)
  }
  return data
}
