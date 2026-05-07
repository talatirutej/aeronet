// api/proxy.js — Vercel serverless function
// Proxies requests to HuggingFace Space server-side, bypassing CORS entirely.
// Browser → Vercel (same origin, no CORS) → HuggingFace (server-to-server)
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
  const path = req.query.path
  if (!path) {
    res.status(400).json({ error: 'Missing path query param' })
    return
  }

  const url = `${HF_BACKEND}/${path}`

  // Build clean headers — only forward content-type and content-length
  // HF rejects requests with browser Origin headers from other domains
  const forwardHeaders = {
    'accept': 'application/json, */*',
    'accept-language': 'en-US,en;q=0.9',
  }

  // Forward content-type for POST requests (needed for multipart/form-data boundary)
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

    // Check if HF returned an HTML error page (403/503 etc)
    const contentType = hfRes.headers.get('content-type') ?? ''
    if (!hfRes.ok && contentType.includes('text/html')) {
      const text = await hfRes.text()
      console.error(`[proxy] HF returned ${hfRes.status} HTML:`, text.slice(0, 200))
      res.status(hfRes.status).json({
        error: `HuggingFace returned ${hfRes.status}`,
        detail: text.slice(0, 300),
      })
      return
    }

    // Forward response headers
    for (const [k, v] of hfRes.headers.entries()) {
      if (['content-encoding', 'transfer-encoding', 'connection'].includes(k)) continue
      res.setHeader(k, v)
    }
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.status(hfRes.status)

    const responseBuffer = await hfRes.arrayBuffer()
    res.end(Buffer.from(responseBuffer))
  } catch (e) {
    console.error('[proxy] Error:', e)
    res.status(502).json({ error: `Proxy error: ${e.message}` })
  }
}
