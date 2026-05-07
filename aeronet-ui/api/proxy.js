// api/proxy.js — Vercel serverless function
// Proxies requests to HuggingFace Space server-side, bypassing CORS entirely.
// Browser → Vercel (same origin, no CORS) → HuggingFace (server-to-server, no CORS)
//
// Usage from frontend:
//   POST /api/proxy?path=analyze-contour/start   (with file FormData)
//   GET  /api/proxy?path=analyze-contour/result/JOB_ID
//
// Copyright (c) 2026 Rutej Talati. All rights reserved.

const HF_BACKEND = 'https://rutejtalati16-aeronet.hf.space'

export const config = {
  api: {
    bodyParser: false,        // must be false — we stream the raw body through
    responseLimit: '20mb',
  },
}

export default async function handler(req, res) {
  const path = req.query.path
  if (!path) {
    res.status(400).json({ error: 'Missing path query param' })
    return
  }

  const url = `${HF_BACKEND}/${path}`

  // Forward headers except host
  const forwardHeaders = {}
  for (const [k, v] of Object.entries(req.headers)) {
    if (k === 'host') continue
    forwardHeaders[k] = v
  }

  try {
    // Stream the raw request body through to HF
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

    // Forward response headers
    for (const [k, v] of hfRes.headers.entries()) {
      if (['content-encoding', 'transfer-encoding'].includes(k)) continue
      res.setHeader(k, v)
    }
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.status(hfRes.status)

    // Stream response body back
    const responseBuffer = await hfRes.arrayBuffer()
    res.end(Buffer.from(responseBuffer))
  } catch (e) {
    console.error('[proxy] Error:', e)
    res.status(502).json({ error: `Proxy error: ${e.message}` })
  }
}
