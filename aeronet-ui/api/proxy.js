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

  // Clean headers — do NOT forward Origin/Referer/Host from the browser
  // HF rejects cross-origin headers; server-to-server requests have no origin
  const forwardHeaders = {
    'accept': 'application/json, */*',
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

    // If HF returned HTML error page, return structured JSON instead
    const contentType = hfRes.headers.get('content-type') ?? ''
    if (!hfRes.ok && contentType.includes('text/html')) {
      const text = await hfRes.text()
      console.error(`[proxy] HF ${hfRes.status}:`, text.slice(0, 300))
      res.status(hfRes.status).json({
        error: `HuggingFace returned ${hfRes.status}`,
        detail: text.slice(0, 300),
      })
      return
    }

    for (const [k, v] of hfRes.headers.entries()) {
      if (['content-encoding', 'transfer-encoding', 'connection'].includes(k)) continue
      res.setHeader(k, v)
    }
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.status(hfRes.status)

    const buf = await hfRes.arrayBuffer()
    res.end(Buffer.from(buf))
  } catch (e) {
    console.error('[proxy] Error:', e)
    res.status(502).json({ error: `Proxy error: ${e.message}` })
  }
}
