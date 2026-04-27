// Copyright (c) 2026 Rutej Talati. All rights reserved.
// AeroNet — lib/api.js
// Uses same /api/hf Vercel proxy as predict.js

import { getBackendUrl } from './predict'

/**
 * Analyse a vehicle image via Moondream2 / Qwen2-VL backend.
 * @param {File} imageFile  JPG / PNG / WEBP
 * @returns {Promise<object>}
 */
export async function analyzeImage(imageFile) {
  const fd = new FormData()
  fd.append('file', imageFile)

  const res = await fetch(`${getBackendUrl()}/analyze`, {
    method: 'POST',
    body: fd,
  })
  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try { const err = await res.json(); if (err?.detail) detail = err.detail } catch {}
    throw new Error(`Analysis failed: ${detail}`)
  }
  return res.json()
}

/**
 * Stream a chat message from the backend.
 * @param {string}   message
 * @param {function} onToken  called with each streamed token string
 */
export async function streamChat(message, onToken) {
  const fd = new FormData()
  fd.append('message', message)

  const res = await fetch(`${getBackendUrl()}/chat`, { method: 'POST', body: fd })
  if (!res.ok) throw new Error(`Chat failed: ${res.status}`)

  const reader = res.body.getReader()
  const dec = new TextDecoder()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    onToken(dec.decode(value, { stream: true }))
  }
}
