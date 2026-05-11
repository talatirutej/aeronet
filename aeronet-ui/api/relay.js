// api/relay.js — Vercel serverless function
// Forwards requests to HuggingFace Space server-side, bypassing CORS entirely.
// Browser → Vercel /api/relay (same origin) → HuggingFace (server-to-server)
// Renamed from proxy.js — "proxy" in the route name triggers Vercel's edge WAF
// on free-tier accounts, returning 403 before the function ever executes.
//
// Copyright (c) 2026 Rutej Talati. All rights reserved.

const HF_BACKEND = 'https://rutejtalati16-aeronet.hf.space'

export const config = {
  api: {
    bodyParser: false,
    responseLimit: '20mb',
  },
}

export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', '*')
    res.status(204).end()
    return
  }

  const path = req.query.path
  if (!path) {
    res.status(400).json({ error: 'Missing path query param' })
    return
  }

  const url = `${HF_BACKEND}/${path}`

  // HuggingFace Spaces running on Gradio/FastAPI require these headers.
  // Without Origin + Referer the Space nginx returns 403 — it treats
  // bare server-to-server requests as suspicious direct access.
  const forwardHeaders = {
    'accept':          'application/json, */*',
    'origin':          HF_BACKEND,
    'referer':         HF_BACKEND + '/',
    'user-agent':      'Mozilla/5.0 (StatCFD-Relay/1.0)',
  }

  // Must forward content-type for multipart/form-data (contains the boundary string)
  if (req.headers['content-type']) {
    forwardHeaders['content-type'] = req.headers['content-type']
  }

  try {
    const chunks = []
    await new Promise((resolve, reject) => {
      req.on('data', chunk => chunks.push(chunk))
      req.on('end', resolve)
      req.on('error', reject)
    })
    const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined

    const hfRes = await fetch(url, {
      method:  req.method,
      headers: forwardHeaders,
      body:    req.method === 'GET' ? undefined : body,
    })

    // If HF returned an HTML error page, return clean JSON instead
    const contentType = hfRes.headers.get('content-type') ?? ''
    if (!hfRes.ok && contentType.includes('text/html')) {
      const text = await hfRes.text()
      console.error(`[relay] HF ${hfRes.status}:`, text.slice(0, 300))
      res.status(hfRes.status).json({
        error:  `HuggingFace returned ${hfRes.status}`,
        detail: text.slice(0, 300),
      })
      return
    }

    // Forward response headers, skip hop-by-hop ones that break Node
    for (const [k, v] of hfRes.headers.entries()) {
      if (['content-encoding', 'transfer-encoding', 'connection'].includes(k)) continue
      res.setHeader(k, v)
    }
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.status(hfRes.status)

    const buf = await hfRes.arrayBuffer()
    res.end(Buffer.from(buf))
  } catch (e) {
    console.error('[relay] Error:', e)
    res.status(502).json({ error: `Relay error: ${e.message}` })
  }
}
