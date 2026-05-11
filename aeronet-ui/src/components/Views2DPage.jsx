// Views2DPage.jsx — StatCFD Vehicle Outline Analysis
// Copyright (c) 2026 Rutej Talati / statinsite.com
//
// Architecture:
//   4 independent analysis slots: Side, Front, Top, Rear
//   Each slot has its own: upload zone, run button, geo state, outline
//   All 4 outlines are saved and shown in the left sidebar
//   Switching between views shows the stored outline for that view
//   New upload for any slot only resets that slot

import { useCallback, useEffect, useRef, useState } from 'react'
import SideViewSVG     from './SideViewSVG.jsx'
import FrontViewSVG    from './FrontViewSVG.jsx'
import TopViewSVG      from './TopViewSVG.jsx'
import PipelineOverlay from './PipelineOverlay.jsx'
import SimulationModal from './SimulationModal.jsx'

// ─────────────────────────────────────────────────────────────────────────────
// VIEW DEFINITIONS  — "Underside" renamed to "Rear"
// ─────────────────────────────────────────────────────────────────────────────

const VIEWS = [
  { id: 'side',  label: 'Side View',  icon: '◻', shortLabel: 'Side'  },
  { id: 'front', label: 'Front View', icon: '◈', shortLabel: 'Front' },
  { id: 'top',   label: 'Top View',   icon: '⊟', shortLabel: 'Top'   },
  { id: 'rear',  label: 'Rear View',  icon: '◧', shortLabel: 'Rear'  },
]

const STAGES = [
  { id: 'prep',    label: 'Preprocess', icon: '⚙',  pct: [0,  8]  },
  { id: 'rmbg',   label: 'RMBG 2.0',   icon: '◉',  pct: [8,  28] },
  { id: 'yolo',   label: 'YOLO11',     icon: '◎',  pct: [28, 42] },
  { id: 'sam3',   label: 'SAM3',       icon: '⬡',  pct: [42, 57] },
  { id: 'contour',label: 'Contour',    icon: '✦',  pct: [57, 72] },
  { id: 'keys',   label: 'Keypoints',  icon: '⊞',  pct: [72, 82] },
  { id: 'cfd',    label: 'CFD Geom',   icon: '◈',  pct: [82, 92] },
  { id: 'done',   label: 'Complete',   icon: '✓',  pct: [92, 100]},
]

const BACKEND_MSGS = [
  [0,  'Stage 0a: EXIF fix, canvas margin, resize to 1536px…',     'Input normalisation'],
  [8,  'Stage 0b: RMBG 2.0 — product-photo foreground extraction…','Separating car from background'],
  [28, 'Stage 1: YOLO11x-seg — confirming vehicle + bounding box…','22% better mAP than YOLOv8'],
  [42, 'Stage 2: SAM3 text-prompted concept refinement…',          '"car body and wheels, not shadow"'],
  [57, 'Stage 3-4: underbody edge recovery + ground contact clip…','Recovering sill geometry'],
  [62, 'Stage 5: CHAIN_APPROX_NONE — every boundary pixel traced…','~4000 raw boundary pixels'],
  [70, 'Stage 7: Canny edge snapping — pulling pts to strong edges…','Refining to within ±5px'],
  [75, 'Stage 8-9: arc-length resample → 2000pt, window=3 smooth…','CFD-grade outline ready'],
  [80, 'Stage 10: Hough circles — wheel centre, rim radius, spokes…','Reading wheel geometry'],
  [84, 'Stage 11: Ahmed body params — Cd, CdA, rear slant angle…',  'Ahmed 1984 correlation'],
  [92, 'Quality scoring — 10-signal confidence assessment…',        'Checking segmentation'],
  [97, 'Finalising SVG, engineering exports…',                      'Complete — rendering'],
]

// ─────────────────────────────────────────────────────────────────────────────
// IMAGE UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

async function prepareImage(file, maxWidth = 1440, quality = 0.93) {
  return new Promise((resolve) => {
    const img = new window.Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const scale = Math.min(1.0, maxWidth / Math.max(img.width, 900))
      const w = Math.round(img.width  * Math.max(scale, 900 / img.width))
      const h = Math.round(img.height * Math.max(scale, 900 / img.width))
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h)
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, 0, 0, w, h)
      canvas.toBlob(
        blob => resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' })),
        'image/jpeg', quality
      )
    }
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file) }
    img.src = url
  })
}

async function fetchImageFromUrl(url) {
  const proxies = [
    u => u,
    u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    u => `https://corsproxy.io/?${encodeURIComponent(u)}`,
  ]
  for (const proxy of proxies) {
    try {
      const r = await fetch(proxy(url), { signal: AbortSignal.timeout(8000) })
      if (!r.ok) continue
      const blob = await r.blob()
      if (!blob.type.startsWith('image/') && !blob.type.includes('octet')) continue
      const filename = url.split('/').pop()?.split('?')[0] || 'car.jpg'
      return new File([blob], filename, { type: blob.type.startsWith('image/') ? blob.type : 'image/jpeg' })
    } catch { continue }
  }
  throw new Error('Could not fetch image — download and upload directly')
}

// ─────────────────────────────────────────────────────────────────────────────
// DROP ZONE
// ─────────────────────────────────────────────────────────────────────────────

function DropZone({ viewId, label, icon, file, onFile, compact = false }) {
  const [dragover, setDragover] = useState(false)
  const inputRef = useRef(null)
  const handleDrop = e => {
    e.preventDefault(); setDragover(false)
    const f = e.dataTransfer.files?.[0]
    if (f?.type.startsWith('image/')) onFile(viewId, f)
  }
  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={e => { e.preventDefault(); setDragover(true) }}
      onDragLeave={() => setDragover(false)}
      onDrop={handleDrop}
      style={{
        borderRadius: 8,
        border: `0.5px dashed ${dragover ? 'var(--blue)' : file ? 'rgba(48,209,88,0.5)' : 'rgba(255,255,255,0.1)'}`,
        background: dragover ? 'rgba(10,132,255,0.07)' : file ? 'rgba(48,209,88,0.05)' : 'var(--bg1)',
        cursor: 'pointer', transition: 'all 0.15s',
        padding: compact ? '6px 4px' : '8px 4px',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
        position: 'relative', minWidth: 0,
      }}>
      <input ref={inputRef} type="file" accept="image/*" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) onFile(viewId, f) }}/>
      {file && <div style={{ position:'absolute', top:3, right:4, width:5, height:5, borderRadius:'50%', background:'var(--green)'}}/>}
      <div style={{ fontSize: compact ? 12 : 14, color: file ? 'var(--green)' : 'rgba(255,255,255,0.3)' }}>{icon}</div>
      <div style={{ fontSize: 8, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing:'0.06em', textTransform:'uppercase' }}>{label}</div>
      {!compact && <div style={{ fontSize: 7, color: 'var(--text-quaternary)', textAlign:'center' }}>
        {file ? file.name.slice(0,14)+(file.name.length>14?'…':'') : 'drop / click'}
      </div>}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION LABEL
// ─────────────────────────────────────────────────────────────────────────────

function SL({ n, t }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8, marginTop:10 }}>
      <span style={{ fontSize:9, fontWeight:600, color:'var(--blue)', fontFamily:'var(--font-mono)' }}>{n}</span>
      <div style={{ flex:1, height:0.5, background:'var(--sep)' }}/>
      <span style={{ fontSize:9, fontWeight:600, color:'var(--text-quaternary)', letterSpacing:'0.08em', textTransform:'uppercase', fontFamily:'var(--font-mono)' }}>{t}</span>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// OUTLINE THUMBNAIL — small preview for sidebar list
// ─────────────────────────────────────────────────────────────────────────────

function OutlineThumbnail({ geo, label, isActive, onClick }) {
  const W = 120, H = 60, PAD = 6
  const pts = geo?._smoothPts ?? geo?._contourPts ?? []
  let pathD = ''
  if (pts.length > 10) {
    const bboxAspect = geo._bboxAspect ?? 2.2
    const dw = (W - PAD*2) * 0.95
    const dh = Math.min(dw / bboxAspect, H - PAD*2)
    const ox = PAD + ((W - PAD*2) - dw) / 2
    const oy = PAD + ((H - PAD*2) - dh) / 2
    pathD = pts.map(([nx,ny],i) =>
      `${i===0?'M':'L'}${(ox+nx*dw).toFixed(1)},${(oy+ny*dh).toFixed(1)}`
    ).join(' ') + ' Z'
  }
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 8, width: '100%',
      padding: '6px 8px', borderRadius: 7, cursor: 'pointer',
      border: `0.5px solid ${isActive ? 'rgba(10,132,255,0.5)' : 'rgba(255,255,255,0.06)'}`,
      background: isActive ? 'rgba(10,132,255,0.10)' : 'rgba(255,255,255,0.02)',
      transition: 'all 0.15s', marginBottom: 4,
    }}>
      <div style={{ flexShrink:0, width:W, height:H, background:'#070d14', borderRadius:5, overflow:'hidden' }}>
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H}>
          {pathD ? (
            <path d={pathD} fill="none"
              stroke={isActive ? 'rgba(10,132,255,0.9)' : 'rgba(255,255,255,0.55)'}
              strokeWidth="1.2" strokeLinejoin="round" strokeLinecap="round"/>
          ) : (
            <text x={W/2} y={H/2+4} textAnchor="middle"
              fill="rgba(255,255,255,0.12)" fontSize="9"
              fontFamily="'IBM Plex Mono',monospace">no outline</text>
          )}
        </svg>
      </div>
      <div style={{ flex:1, textAlign:'left' }}>
        <div style={{ fontSize:10, fontWeight:700, color: isActive ? 'var(--blue)' : 'var(--text-secondary)', fontFamily:'var(--font-mono)' }}>
          {label}
        </div>
        {geo && (
          <div style={{ fontSize:8, color:'var(--text-quaternary)', fontFamily:'var(--font-mono)', marginTop:2 }}>
            {(geo._contourPts?.length ?? 0)}pt · {geo._method ?? '—'}
          </div>
        )}
        {!geo && (
          <div style={{ fontSize:8, color:'var(--text-quaternary)' }}>not analysed</div>
        )}
      </div>
      {geo && (
        <div style={{
          width:6, height:6, borderRadius:'50%', flexShrink:0,
          background: (geo._quality?.score ?? 0) >= 75 ? 'var(--green)' : 'var(--amber)',
        }}/>
      )}
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// REAR VIEW SVG — synthetic reconstruction from geometry parameters
// ─────────────────────────────────────────────────────────────────────────────

function RearViewSVG({ g }) {
  const W = 300, H = 220, cx = W/2, gY = H-14
  const kp     = g?._keypoints
  const wheels = kp?.wheels ?? []
  const wsAngle  = g?.wsAngleDeg ?? 55
  const bh = Math.round(Math.min(120, Math.max(75, (g?.cabinH ?? 0.58) * H * 1.1)))
  const bw = Math.round(Math.min(120, Math.max(70, 0.50 * W)))
  const bodyBot = gY - bh * 0.06
  const bodyTop = bodyBot - bh
  const roofNarrow  = Math.max(0.28, Math.min(0.46, 0.38-(wsAngle-55)*0.003))
  const roofHW      = bw * roofNarrow
  const shoulderHW  = bw * 0.50
  const sillHW      = bw * 0.46
  const shoulderY   = bodyTop + bh * 0.55
  const sillY       = bodyTop + bh * 0.92
  const rearPath = [
    `M ${cx} ${bodyTop}`,
    `C ${cx-roofHW*0.6} ${bodyTop} ${cx-shoulderHW} ${shoulderY-bh*0.22} ${cx-shoulderHW} ${shoulderY}`,
    `C ${cx-shoulderHW} ${shoulderY+bh*0.12} ${cx-sillHW} ${sillY} ${cx-sillHW*0.80} ${bodyBot}`,
    `L ${cx+sillHW*0.80} ${bodyBot}`,
    `C ${cx+sillHW} ${sillY} ${cx+shoulderHW} ${shoulderY+bh*0.12} ${cx+shoulderHW} ${shoulderY}`,
    `C ${cx+shoulderHW} ${shoulderY-bh*0.22} ${cx+roofHW*0.6} ${bodyTop} ${cx} ${bodyTop}`,
    'Z',
  ].join(' ')
  const wscPath = [
    `M ${cx-roofHW*0.88} ${bodyTop+bh*0.08}`,
    `Q ${cx} ${bodyTop+bh*0.04} ${cx+roofHW*0.88} ${bodyTop+bh*0.08}`,
    `L ${cx+shoulderHW*0.82} ${bodyTop+bh*0.55}`,
    `L ${cx-shoulderHW*0.82} ${bodyTop+bh*0.55}`,
    'Z',
  ].join(' ')
  const wR  = wheels.length >= 1 ? Math.max(12, Math.min(22, wheels[0].r/800*W*0.9)) : 15
  const w1x = cx - shoulderHW * 1.05
  const w2x = cx + shoulderHW * 1.05
  const wY  = gY - wR
  const rearLightPath = (side) => {
    const sx = side === 'L' ? cx - shoulderHW : cx + shoulderHW * 0.55
    return `M ${sx} ${bodyTop+bh*0.05} L ${sx} ${bodyTop+bh*0.35}`
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',height:'100%'}} preserveAspectRatio="xMidYMid meet">
      <rect width={W} height={H} fill="#070d14"/>
      <line x1={12} y1={gY} x2={W-12} y2={gY} stroke="rgba(255,255,255,0.05)" strokeWidth="1"/>
      <path d={rearPath}  fill="none" stroke="rgba(10,132,255,0.7)" strokeWidth="1.2"/>
      <path d={wscPath}   fill="none" stroke="rgba(10,132,255,0.32)" strokeWidth=".9"/>
      {['L','R'].map(s => <path key={s} d={rearLightPath(s)} stroke="rgba(255,80,80,0.65)" strokeWidth="3.5" strokeLinecap="round"/>)}
      <rect x={cx-bw*0.12} y={bodyBot-8} width={bw*0.24} height={6} rx="2"
        fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth=".8"/>
      {[[w1x,wY],[w2x,wY]].map(([wcx,wcy],i) => (
        <g key={i}>
          <circle cx={wcx} cy={wcy} r={wR} fill="none" stroke="rgba(10,132,255,0.9)" strokeWidth="1.4"/>
          <circle cx={wcx} cy={wcy} r={wR*0.5} fill="none" stroke="rgba(10,132,255,0.3)" strokeWidth=".8"/>
        </g>
      ))}
      <text x={cx} y={H-4} textAnchor="middle" fill="rgba(255,255,255,0.1)"
        fontSize="9" fontFamily="'IBM Plex Mono',monospace" letterSpacing=".12em">REAR</text>
    </svg>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export default function Views2DPage({ backend = '' }) {
  // Each view slot has: file, geo (outline + geometry), analysis state
  const [slots, setSlots] = useState({
    side:  { file: null, geo: null, running: false, progress: { pct:0,msg:'',sub:'' }, drawDone: false, isDrawing: false, error: null },
    front: { file: null, geo: null, running: false, progress: { pct:0,msg:'',sub:'' }, drawDone: false, isDrawing: false, error: null },
    top:   { file: null, geo: null, running: false, progress: { pct:0,msg:'',sub:'' }, drawDone: false, isDrawing: false, error: null },
    rear:  { file: null, geo: null, running: false, progress: { pct:0,msg:'',sub:'' }, drawDone: false, isDrawing: false, error: null },
  })

  const [activeView,   setActiveView]   = useState('side')
  const [analysisMode, setAnalysisMode] = useState('A')
  const [showSep,      setShowSep]      = useState(true)
  const [copyDone,     setCopyDone]     = useState(false)
  const [showSimModal, setShowSimModal] = useState(false)
  const [urlMode,      setUrlMode]      = useState(null)  // viewId | null
  const [urlInput,     setUrlInput]     = useState('')
  const [urlError,     setUrlError]     = useState('')
  const svgRef = useRef(null)

  // ── Slot helpers ────────────────────────────────────────────────────────────

  const getSlot = (id) => slots[id]
  const setSlot = (id, patch) => setSlots(p => ({ ...p, [id]: { ...p[id], ...patch } }))

  // ── File drop ───────────────────────────────────────────────────────────────

  const setViewFile = useCallback((viewId, file) => {
    setSlot(viewId, {
      file,
      geo: null,      // clear existing outline when new file dropped
      error: null,
      drawDone: false,
      isDrawing: false,
      progress: { pct:0, msg:'', sub:'' },
    })
    setActiveView(viewId)  // switch to the view that just got a file
  }, [])

  // Paste handler — pastes to currently active view
  useEffect(() => {
    const handle = (e) => {
      const items = Array.from(e.clipboardData?.items ?? [])
      const imgItem = items.find(i => i.type.startsWith('image/'))
      if (imgItem) { setViewFile(activeView, imgItem.getAsFile()); return }
      const text = e.clipboardData?.getData('text') ?? ''
      if (/^https?:\/\//i.test(text)) {
        fetchImageFromUrl(text).then(f => setViewFile(activeView, f)).catch(err => setSlot(activeView, { error: err.message }))
      }
    }
    window.addEventListener('paste', handle)
    return () => window.removeEventListener('paste', handle)
  }, [activeView, setViewFile])

  // ── Backend URL ─────────────────────────────────────────────────────────────

  const apiUrl = path => backend ? `${backend}${path}` : `/api${path}`

  const getMsgForPct = pct => {
    const entry = [...BACKEND_MSGS].reverse().find(m => pct >= m[0])
    return entry ? { msg: entry[1], sub: entry[2] } : { msg: 'Processing…', sub: '' }
  }

  // ── Run analysis for a specific view slot ───────────────────────────────────

  const runView = async (viewId) => {
    const slot = getSlot(viewId)
    if (!slot.file) return

    setSlot(viewId, { running: true, error: null, geo: null, drawDone: false, isDrawing: false,
                      progress: { pct:2, msg:'Preparing image…', sub:'Input normalisation' } })

    let uploadFile
    try { uploadFile = await prepareImage(slot.file) } catch { uploadFile = slot.file }

    // Start job with retry
    let jobId = null
    const MAX_ATTEMPTS = 8
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      setSlot(viewId, { progress: {
        pct: 5,
        msg: attempt === 0 ? 'Connecting to server…' : `Retrying… (${attempt*5}s)`,
        sub: 'Establishing connection',
      }})
      try {
        const fd = new FormData()
        fd.append('file', uploadFile)
        fd.append('mode', analysisMode)
        fd.append('view', viewId)   // tells backend which slot: side/front/top/rear
        const ctrl  = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), 25000)
        let res
        try { res = await fetch(apiUrl('/analyze-contour/start'), { method:'POST', body:fd, signal:ctrl.signal }) }
        finally { clearTimeout(timer) }
        if (res.ok) { jobId = (await res.json()).job_id; break }
        const text = await res.text().catch(() => '')
        setSlot(viewId, { running:false, error:`Server error ${res.status}${text?': '+text.slice(0,100):''}` })
        return
      } catch {
        if (attempt >= MAX_ATTEMPTS - 1) {
          setSlot(viewId, { running:false, error:`Could not reach server after ${MAX_ATTEMPTS*5}s. Make sure python app.py is running.` })
          return
        }
        await new Promise(r => setTimeout(r, 5000))
      }
    }
    if (!jobId) { setSlot(viewId, { running:false, error:'Failed to start job.' }); return }

    setSlot(viewId, { progress:{ pct:10, msg:'Job queued — preprocessing…', sub:'Input normalisation' } })

    // Poll for result
    const startTime = Date.now()
    while (true) {
      await new Promise(r => setTimeout(r, 3000))
      const elapsed = Math.round((Date.now() - startTime) / 1000)
      let poll
      try {
        const pc    = new AbortController()
        const timer = setTimeout(() => pc.abort(), 10000)
        let res
        try { res = await fetch(apiUrl(`/analyze-contour/result/${jobId}`), { signal:pc.signal }) }
        finally { clearTimeout(timer) }
        if (!res.ok) { setSlot(viewId, { running:false, error:`Poll error ${res.status}` }); return }
        poll = await res.json()
      } catch (e) { setSlot(viewId, { running:false, error:`Connection lost: ${e.message}` }); return }

      if (poll.status === 'error') { setSlot(viewId, { running:false, error: poll.error ?? 'Analysis failed' }); return }

      if (poll.status === 'running' || poll.status === 'pending') {
        const pct = Math.min(90, 10 + elapsed * 1.2)
        const { msg, sub } = getMsgForPct(pct)
        setSlot(viewId, { progress:{ pct:Math.round(pct), msg:`${msg} (${elapsed}s)`, sub } })
        continue
      }

      if (poll.status === 'done') {
        const result = poll.result
        if (!result?.geometry) {
          setSlot(viewId, { running:false, error:'No vehicle outline found. Use a clear photo.' })
          return
        }
        const cg = result.geometry
        const geo = {
          // ── Common fields (all views) ──────────────────────────────────────
          aspectRatio:       cg.aspectRatio      ?? cg.frontalAspect ?? 2.0,
          wsAngleDeg:        cg.wsAngleDeg       ?? 58,
          rearDrop:          cg.rearDrop         ?? 0.15,
          rideH:             cg.rideH            ?? cg.groundClearanceNorm ?? 0.08,
          archDepth:         cg.archDepth        ?? null,
          Cd:                cg.Cd               ?? null,
          CdA:               cg.CdA              ?? null,
          rearSlantAngleDeg: cg.rearSlantAngleDeg ?? null,
          ahmedRegime:       cg.ahmedRegime      ?? null,
          cabinH:            cg.cabinH           ?? 0.58,
          w1:                cg.w1               ?? 0.22,
          w2:                cg.w2               ?? 0.76,
          // ── Side-view specific ─────────────────────────────────────────────
          hoodRatio:         cg.hoodRatio        ?? null,
          cabinRatio:        cg.cabinRatio       ?? null,
          bootRatio:         cg.bootRatio        ?? null,
          // ── Front/rear-view specific ───────────────────────────────────────
          frontalAreaNorm:   cg.frontalAreaNorm  ?? null,
          trackWidthNorm:    cg.trackWidthNorm   ?? null,
          shoulderWidthNorm: cg.shoulderWidthNorm ?? null,
          roofWidthNorm:     cg.roofWidthNorm    ?? null,
          sillWidthNorm:     cg.sillWidthNorm    ?? null,
          symmetryScore:     cg.symmetryScore    ?? null,
          symmetryWarning:   cg.symmetryWarning  ?? null,
          frontalAspect:     cg.frontalAspect    ?? null,
          // ── View info ─────────────────────────────────────────────────────
          _viewType:         cg._view            ?? viewId,
          // ── Contour data ───────────────────────────────────────────────────
          _contourPts:       result.technical_outline_pts ?? result.outline_pts,
          _smoothPts:        result.display_outline_pts   ?? result.smooth_pts,
          _bboxAspect:       result.bbox ? result.bbox.w / Math.max(1, result.bbox.h) : undefined,
          _keypoints:        result.keypoints,
          _method:           result.method,
          _quality:          result.quality ?? null,
        }

        setSlot(viewId, { running:false, progress:{ pct:0, msg:'', sub:'' }, geo,
                          isDrawing:true, drawDone:false })
        setTimeout(() => {
          setSlot(viewId, { isDrawing:false, drawDone:true })
        }, 2600)
        return
      }
    }
  }

  // ── Export SVG of active view ───────────────────────────────────────────────

  const exportSVG = () => {
    const svg = svgRef.current?.querySelector('svg')
    if (!svg) return
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([svg.outerHTML], { type:'image/svg+xml' }))
    a.download = `statcfd_${activeView}.svg`; a.click()
  }

  // ── Copy outline PNG (outline stroke only, transparent background) ──────────

  const copyOutline = async () => {
    const geo = getSlot(activeView).geo
    if (!geo?._contourPts) return
    const CW = 800, CH = 380, PAD = 24
    const rawPts = geo._smoothPts ?? geo._contourPts
    const bboxAspect   = geo._bboxAspect ?? (CW/CH)
    const canvasAspect = (CW-PAD*2)/(CH-PAD*2)
    let dw, dh
    if (bboxAspect > canvasAspect) { dw=(CW-PAD*2)*0.95; dh=dw/bboxAspect }
    else { dh=(CH-PAD*2)*0.90; dw=dh*bboxAspect; if(dw>(CW-PAD*2)*0.95){dw=(CW-PAD*2)*0.95;dh=dw/bboxAspect} }
    const ox=PAD+((CW-PAD*2)-dw)/2, oy=PAD+((CH-PAD*2)-dh)/2
    const d = rawPts.map(([nx,ny],i) =>
      `${i===0?'M':'L'}${(ox+nx*dw).toFixed(2)},${(oy+ny*dh).toFixed(2)}`
    ).join(' ') + ' Z'
    const svgStr = `<svg xmlns="http://www.w3.org/2000/svg" width="${CW}" height="${CH}" viewBox="0 0 ${CW} ${CH}"><path d="${d}" fill="none" stroke="white" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/></svg>`
    const blob = new Blob([svgStr], { type:'image/svg+xml' })
    const url  = URL.createObjectURL(blob)
    const img  = new window.Image()
    img.onload = async () => {
      URL.revokeObjectURL(url)
      const canvas = document.createElement('canvas')
      canvas.width = CW; canvas.height = CH
      canvas.getContext('2d').drawImage(img, 0, 0)
      canvas.toBlob(async png => {
        try { await navigator.clipboard.write([new ClipboardItem({'image/png':png})]) }
        catch { const a=document.createElement('a'); a.href=URL.createObjectURL(png); a.download='outline.png'; a.click() }
        setCopyDone(true); setTimeout(() => setCopyDone(false), 2200)
      }, 'image/png')
    }
    img.src = url
  }

  // ── Convenience accessors ──────────────────────────────────────────────────

  const activeSlot  = getSlot(activeView)
  const isRunning   = activeSlot.running
  const geo         = activeSlot.geo
  const drawDone    = activeSlot.drawDone
  const isDrawing   = activeSlot.isDrawing
  const traceProgress = activeSlot.progress
  const error       = activeSlot.error
  const hasFile     = !!activeSlot.file
  const anyOutline  = VIEWS.some(v => !!getSlot(v.id).geo)

  const ahmedColor  = r => ({ attached:'#30d158', intermediate:'#ff9f0a', critical:'#ff453a', separated:'#ff453a' }[r] ?? 'var(--blue)')

  // ── Render SVG for current active view ─────────────────────────────────────

  const renderActiveView = (g, isDrawingFlag, drawDoneFlag) => {
    if (activeView === 'side')  return <SideViewSVG  g={g} showSep={showSep} isDrawing={isDrawingFlag} drawDone={drawDoneFlag}/>
    if (activeView === 'front') return <FrontViewSVG g={g}/>
    if (activeView === 'top')   return <TopViewSVG   g={g}/>
    if (activeView === 'rear')  return <RearViewSVG  g={g}/>
    return null
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div style={{ display:'flex', height:'100%', overflow:'hidden', background:'var(--bg0)' }}>

      {/* CFD Simulation Modal */}
      {showSimModal && geo && <SimulationModal geo={geo} onClose={() => setShowSimModal(false)}/>}

      {/* ══════════════════════════════════════════════════════════════════════
          LEFT SIDEBAR — saved outlines list + upload for active view
      ══════════════════════════════════════════════════════════════════════ */}
      <div style={{
        width: 260, flexShrink:0,
        display:'flex', flexDirection:'column',
        borderRight:'0.5px solid var(--sep)',
        overflow:'hidden', background:'var(--bg0)',
      }}>
        <div style={{ flex:1, overflowY:'auto', padding:'12px 10px' }}>

          {/* Saved outlines — always shown, all 4 slots */}
          <SL n="01" t="Saved Outlines"/>
          <div style={{ marginBottom:10 }}>
            {VIEWS.map(v => (
              <OutlineThumbnail
                key={v.id}
                geo={getSlot(v.id).geo}
                label={v.label}
                isActive={activeView === v.id}
                onClick={() => setActiveView(v.id)}
              />
            ))}
          </div>

          {/* Upload for active view */}
          <SL n="02" t={`Upload — ${VIEWS.find(v=>v.id===activeView)?.label}`}/>

          {/* Drop zone for the active view */}
          <div style={{ marginBottom:8 }}>
            <DropZone
              viewId={activeView}
              label={VIEWS.find(v=>v.id===activeView)?.shortLabel}
              icon={VIEWS.find(v=>v.id===activeView)?.icon}
              file={activeSlot.file}
              onFile={setViewFile}
            />
          </div>

          {/* URL input */}
          <div style={{ marginBottom:8 }}>
            {urlMode === activeView ? (
              <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                <div style={{ display:'flex', gap:4 }}>
                  <input autoFocus value={urlInput} onChange={e=>setUrlInput(e.target.value)}
                    onKeyDown={e=>{
                      if(e.key==='Enter') fetchImageFromUrl(urlInput).then(f=>{setViewFile(activeView,f);setUrlMode(null)}).catch(err=>setUrlError(err.message))
                      if(e.key==='Escape') setUrlMode(null)
                    }}
                    placeholder="https://example.com/car.jpg"
                    style={{ flex:1, background:'var(--bg2)', border:`0.5px solid ${urlError?'var(--red)':'rgba(255,255,255,0.1)'}`, borderRadius:7, padding:'5px 7px', color:'var(--text-primary)', fontSize:9, outline:'none', fontFamily:'var(--font-mono)' }}/>
                  <button onClick={()=>fetchImageFromUrl(urlInput).then(f=>{setViewFile(activeView,f);setUrlMode(null)}).catch(err=>setUrlError(err.message))}
                    style={{ padding:'0 7px', borderRadius:7, border:'none', background:'var(--blue)', color:'#fff', fontSize:9 }}>Go</button>
                  <button onClick={()=>{setUrlMode(null);setUrlError('')}}
                    style={{ padding:'0 5px', borderRadius:7, border:'0.5px solid var(--sep)', background:'transparent', color:'var(--text-tertiary)', fontSize:9 }}>✕</button>
                </div>
                {urlError && <span style={{ fontSize:8, color:'var(--red)' }}>{urlError}</span>}
              </div>
            ) : (
              <button onClick={()=>setUrlMode(activeView)} style={{
                width:'100%', height:26, borderRadius:7,
                border:'0.5px solid rgba(255,255,255,0.07)',
                background:'transparent', color:'var(--text-quaternary)',
                fontSize:9, display:'flex', alignItems:'center', justifyContent:'center', gap:5,
              }}>🔗 Load from URL</button>
            )}
          </div>

          {/* Analysis mode */}
          <div style={{ marginBottom:8 }}>
            <div style={{ fontSize:8, color:'var(--text-quaternary)', letterSpacing:'0.08em', textTransform:'uppercase', marginBottom:4, fontFamily:'var(--font-mono)' }}>
              Analysis mode
            </div>
            {[
              { id:'A', label:'◎ Silhouette', desc:'~30s' },
              { id:'B', label:'⊞ Panels',      desc:'~90s' },
              { id:'C', label:'⬡ Full Aero',   desc:'~150s' },
            ].map(m => (
              <button key={m.id} onClick={()=>setAnalysisMode(m.id)} style={{
                display:'flex', justifyContent:'space-between', alignItems:'center',
                width:'100%', padding:'4px 7px', borderRadius:5, marginBottom:2,
                border:`0.5px solid ${analysisMode===m.id?'rgba(10,132,255,0.5)':'transparent'}`,
                background: analysisMode===m.id?'rgba(10,132,255,0.12)':'transparent',
                color: analysisMode===m.id?'var(--blue)':'var(--text-tertiary)',
                fontSize:9, fontFamily:'var(--font-sans)', textAlign:'left',
              }}>
                <span style={{ fontWeight: analysisMode===m.id?600:400 }}>{m.label}</span>
                <span style={{ fontSize:8, color:'var(--text-quaternary)', fontFamily:'var(--font-mono)' }}>{m.desc}</span>
              </button>
            ))}
          </div>

          {/* Analyse button */}
          <button onClick={()=>runView(activeView)} disabled={!hasFile||isRunning} style={{
            width:'100%', height:36, borderRadius:9, border:'none', marginBottom:6,
            background: !hasFile||isRunning ? 'rgba(255,255,255,0.05)' : 'var(--blue)',
            color: !hasFile||isRunning ? 'rgba(255,255,255,0.22)' : '#fff',
            fontSize:12, fontWeight:600,
            display:'flex', alignItems:'center', justifyContent:'center', gap:6,
          }}>
            {isRunning
              ? <><span className="anim-spin" style={{ display:'inline-block',width:11,height:11,border:'2px solid rgba(255,255,255,0.3)',borderTopColor:'#fff',borderRadius:'50%' }}/> Analysing…</>
              : <>▶ Analyse {VIEWS.find(v=>v.id===activeView)?.shortLabel}</>
            }
          </button>

          {/* CFD Simulation button */}
          {drawDone && (
            <button onClick={()=>setShowSimModal(true)} style={{
              width:'100%', padding:'6px', borderRadius:7, marginBottom:6,
              border:'0.5px solid rgba(48,209,88,0.4)', background:'rgba(48,209,88,0.07)',
              color:'var(--green)', fontSize:9, fontWeight:700,
              fontFamily:'var(--font-mono)', letterSpacing:'0.06em',
              display:'flex', alignItems:'center', justifyContent:'center', gap:5,
            }}>
              <span style={{ fontSize:11 }}>▷</span> Run CFD Simulation
            </button>
          )}

          {/* Error */}
          {error && (
            <div style={{ borderRadius:7, padding:'7px 9px', marginBottom:7,
              background:'rgba(255,69,58,0.07)', border:'0.5px solid rgba(255,69,58,0.3)',
              color:'var(--red)', fontSize:9, lineHeight:1.5 }}>
              {error}
            </div>
          )}

          {/* Geometry data for active view */}
          {geo && (
            <>
              <SL n="03" t="Geometry"/>
              <div style={{ background:'var(--bg1)', borderRadius:7, border:'0.5px solid var(--sep)', padding:'7px 9px', marginBottom:7 }}>
                {geo._viewType === 'front' || geo._viewType === 'rear' || geo._viewType === 'front_or_rear' ? (
                  // ── Front / rear view measurements ──────────────────────────
                  [
                    ['Frontal Area', geo.frontalAreaNorm!=null ? geo.frontalAreaNorm.toFixed(4) : '—'],
                    ['Track width',  geo.trackWidthNorm!=null  ? (geo.trackWidthNorm*100).toFixed(1)+'%' : '—'],
                    ['Shoulder w.',  geo.shoulderWidthNorm!=null ? (geo.shoulderWidthNorm*100).toFixed(1)+'%' : '—'],
                    ['Roof width',   geo.roofWidthNorm!=null  ? (geo.roofWidthNorm*100).toFixed(1)+'%' : '—'],
                    ['Ground clr.',  geo.rideH!=null           ? (geo.rideH*100).toFixed(1)+'%' : '—'],
                    ['Symmetry',     geo.symmetryScore!=null   ? geo.symmetryScore.toFixed(3) : '—'],
                    ['Aspect',       (geo.frontalAspect??geo.aspectRatio??0).toFixed(3)],
                    ['Points',       (geo._contourPts?.length??0)+' pt'],
                    ['Method',       geo._method??'—'],
                  ]
                ) : (
                  // ── Side view measurements ────────────────────────────────
                  [
                    ['Points',    (geo._contourPts?.length??0)+' pt'],
                    ['Method',    geo._method??'—'],
                    ['Aspect',    (geo.aspectRatio??0).toFixed(2)],
                    ['WS rake',   (geo.wsAngleDeg??0).toFixed(0)+'°'],
                    ['Rear slant',(geo.rearSlantAngleDeg??0).toFixed(0)+'°'],
                    ['Cd est.',   geo.Cd!=null?(geo.Cd).toFixed(3):'—'],
                    ['CdA',       geo.CdA!=null?(geo.CdA).toFixed(4):'—'],
                    ['Hood',      geo.hoodRatio!=null?((geo.hoodRatio)*100).toFixed(0)+'%':'—'],
                    ['Cabin',     geo.cabinRatio!=null?((geo.cabinRatio)*100).toFixed(0)+'%':'—'],
                    ['Boot',      geo.bootRatio!=null?((geo.bootRatio)*100).toFixed(0)+'%':'—'],
                    ['Ride h.',   geo.rideH!=null?(geo.rideH*100).toFixed(1)+'%':'—'],
                    ['Arch d.',   geo.archDepth!=null?(geo.archDepth*100).toFixed(1)+'%':'—'],
                  ]
                )}.map(([k,v]) => (
                  <div key={k} style={{ display:'flex', justifyContent:'space-between', fontSize:9, padding:'1.5px 0', borderBottom:'0.5px solid rgba(255,255,255,0.04)' }}>
                    <span style={{ fontFamily:'var(--font-mono)', color:'var(--text-quaternary)' }}>{k}</span>
                    <span style={{ fontFamily:'var(--font-mono)', color:'var(--blue)', fontWeight:600 }}>{v}</span>
                  </div>
                ))}
              </div>

              {/* Quality */}
              <SL n="04" t="Quality"/>
              <div style={{ background:'var(--bg1)', borderRadius:7, border:'0.5px solid var(--sep)', padding:'7px 9px' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
                  <span style={{ fontSize:13, fontWeight:700, fontFamily:'var(--font-mono)', color:(geo._quality?.score??0)>=75?'var(--green)':'var(--amber)' }}>
                    {geo._quality?.score??0}/100
                  </span>
                  <span style={{ fontSize:8, color:'var(--text-quaternary)', textTransform:'uppercase', letterSpacing:'0.06em' }}>
                    {geo._quality?.status??'ACCEPTED'}
                  </span>
                </div>
                <div style={{ height:3, borderRadius:2, background:'rgba(255,255,255,0.06)', overflow:'hidden' }}>
                  <div style={{ height:'100%', borderRadius:2, width:`${geo._quality?.score??0}%`,
                    background:(geo._quality?.score??0)>=75?'var(--green)':'var(--amber)', transition:'width 0.6s' }}/>
                </div>
                {geo._quality?.warnings?.slice(0,2).map((w,i) => (
                  <div key={i} style={{ fontSize:8, color:'var(--amber)', marginTop:3, lineHeight:1.4 }}>⚠ {w}</div>
                ))}
              </div>

              {geo.ahmedRegime && (
                <>
                  <SL n="05" t="Ahmed Body"/>
                  <div style={{ background:'var(--bg1)', borderRadius:7, border:'0.5px solid var(--sep)', padding:'7px 9px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <span style={{ fontSize:9, color:'var(--text-tertiary)', fontFamily:'var(--font-mono)' }}>Regime</span>
                    <span style={{ fontSize:9, fontWeight:700, fontFamily:'var(--font-mono)', color:ahmedColor(geo.ahmedRegime),
                      background:`${ahmedColor(geo.ahmedRegime)}1a`, padding:'2px 7px', borderRadius:4 }}>
                      {geo.ahmedRegime.toUpperCase()} {geo.rearSlantAngleDeg?.toFixed(1)}°
                    </span>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          CENTRE — canvas
      ══════════════════════════════════════════════════════════════════════ */}
      <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>

        {/* Toolbar */}
        <div style={{
          height:36, flexShrink:0,
          display:'flex', alignItems:'center', gap:3, padding:'0 10px',
          background:'rgba(0,0,0,0.45)', borderBottom:'0.5px solid var(--sep)',
        }}>
          {/* View tabs */}
          {VIEWS.map(v => {
            const s = getSlot(v.id)
            return (
              <button key={v.id} onClick={()=>setActiveView(v.id)} style={{
                padding:'3px 10px', borderRadius:6, border:'none',
                background: activeView===v.id ? 'rgba(10,132,255,0.18)' : 'transparent',
                color: activeView===v.id ? 'var(--blue)' : s.geo ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.28)',
                fontSize:10, fontWeight: activeView===v.id ? 700 : 400,
                fontFamily:'var(--font-sans)', transition:'all 0.12s',
                position:'relative',
              }}>
                {v.shortLabel}
                {s.geo && (
                  <span style={{ position:'absolute', top:3, right:3, width:4, height:4, borderRadius:'50%', background:'var(--green)' }}/>
                )}
                {s.running && (
                  <span style={{ position:'absolute', top:3, right:3, width:4, height:4, borderRadius:'50%', background:'var(--blue)',
                    animation:'cfd-pressure 1s ease-in-out infinite' }}/>
                )}
              </button>
            )
          })}

          <div style={{ width:0.5, height:14, background:'rgba(255,255,255,0.08)', margin:'0 3px', flexShrink:0 }}/>

          <button onClick={()=>setShowSep(p=>!p)} style={{
            padding:'3px 8px', borderRadius:5, fontSize:9, cursor:'pointer',
            border:`0.5px solid ${showSep?'var(--blue)':'rgba(255,255,255,0.1)'}`,
            background: showSep?'rgba(10,132,255,0.12)':'transparent',
            color: showSep?'var(--blue)':'rgba(255,255,255,0.35)',
            fontFamily:'var(--font-sans)',
          }}>Sep</button>

          {geo && (
            <span style={{ fontSize:8, color:'rgba(255,255,255,0.2)', fontFamily:'var(--font-mono)', marginLeft:4, whiteSpace:'nowrap' }}>
              {VIEWS.find(v=>v.id===activeView)?.shortLabel.toUpperCase()} · {geo._contourPts?.length??0}pts · {geo._method??''}
            </span>
          )}

          <div style={{ flex:1 }}/>

          <button onClick={exportSVG} disabled={!geo} style={{
            padding:'3px 9px', borderRadius:6, fontSize:9,
            border:'0.5px solid rgba(255,255,255,0.1)', background:'transparent',
            color:'rgba(255,255,255,0.4)', opacity:!geo?0.3:1,
          }}>↓ SVG</button>

          <button onClick={copyOutline} disabled={!drawDone} style={{
            padding:'3px 9px', borderRadius:6, fontSize:9,
            border:`0.5px solid ${copyDone?'rgba(48,209,88,0.6)':'rgba(255,255,255,0.1)'}`,
            background: copyDone?'rgba(48,209,88,0.08)':'transparent',
            color: copyDone?'var(--green)':'rgba(255,255,255,0.4)',
            opacity: !drawDone?0.3:1,
            fontFamily:'var(--font-sans)',
          }} title="Copy outline as transparent PNG — stroke only, no fill">
            {copyDone?'✓ Copied':'⎘ Copy Outline'}
          </button>
        </div>

        {/* Canvas */}
        <div style={{ flex:1, position:'relative', overflow:'hidden', background:'var(--bg0)' }} ref={svgRef}>

          {/* Pipeline overlay */}
          <PipelineOverlay
            visible={isRunning}
            pct={traceProgress.pct}
            msg={traceProgress.msg}
            sub={traceProgress.sub}
            stages={STAGES}
          />

          {/* Empty state */}
          {!geo && !isRunning && (
            <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column',
              alignItems:'center', justifyContent:'center', gap:12 }}>
              <div style={{ fontSize:28, color:'rgba(255,255,255,0.08)' }}>
                {VIEWS.find(v=>v.id===activeView)?.icon}
              </div>
              <div style={{ fontSize:12, fontWeight:500, color:'rgba(255,255,255,0.35)' }}>
                {VIEWS.find(v=>v.id===activeView)?.label}
              </div>
              <div style={{ fontSize:9, color:'var(--text-quaternary)', textAlign:'center', lineHeight:1.8 }}>
                Drop a photo into the {VIEWS.find(v=>v.id===activeView)?.shortLabel} slot<br/>
                then click Analyse {VIEWS.find(v=>v.id===activeView)?.shortLabel}
              </div>
              {anyOutline && !hasFile && (
                <div style={{ fontSize:8, color:'rgba(10,132,255,0.5)', fontFamily:'var(--font-mono)' }}>
                  Other views have outlines — see sidebar
                </div>
              )}
            </div>
          )}

          {/* Outline */}
          {geo && !isRunning && (
            <div style={{ width:'100%', height:'100%' }}>
              {renderActiveView(geo, isDrawing, drawDone)}
            </div>
          )}
        </div>

        {/* Thumbnail strip — all 4 views */}
        <div style={{
          height:90, flexShrink:0,
          display:'grid', gridTemplateColumns:'repeat(4,1fr)',
          gap:5, padding:5,
          borderTop:'0.5px solid var(--sep)', background:'var(--bg0)',
        }}>
          {VIEWS.map(v => {
            const s = getSlot(v.id)
            return (
              <button key={v.id} onClick={()=>setActiveView(v.id)} style={{
                borderRadius:8,
                border:`0.5px solid ${activeView===v.id?'rgba(10,132,255,0.55)':'rgba(255,255,255,0.06)'}`,
                background: activeView===v.id?'rgba(10,132,255,0.08)':'rgba(255,255,255,0.02)',
                cursor:'pointer', padding:3, transition:'all 0.15s',
                display:'flex', flexDirection:'column', gap:2, overflow:'hidden',
                position:'relative',
              }}>
                <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center',
                  background:'#070d14', borderRadius:5, overflow:'hidden' }}>
                  {s.geo ? (
                    <div style={{ width:'100%', height:'100%', pointerEvents:'none' }}>
                      {v.id==='side'  && <SideViewSVG  g={s.geo} showSep={false} isDrawing={false} drawDone={s.drawDone}/>}
                      {v.id==='front' && <FrontViewSVG g={s.geo}/>}
                      {v.id==='top'   && <TopViewSVG   g={s.geo}/>}
                      {v.id==='rear'  && <RearViewSVG  g={s.geo}/>}
                    </div>
                  ) : (
                    <span style={{ fontSize:14, color:'rgba(255,255,255,0.06)' }}>{v.icon}</span>
                  )}
                </div>
                <div style={{ fontSize:8, fontWeight:700, textAlign:'center', padding:'1px 0',
                  color: activeView===v.id?'var(--blue)':'rgba(255,255,255,0.2)' }}>
                  {v.shortLabel}
                </div>
                {s.geo && (
                  <div style={{ position:'absolute', top:4, right:4, width:5, height:5,
                    borderRadius:'50%', background:'var(--green)' }}/>
                )}
                {s.running && (
                  <div style={{ position:'absolute', top:4, right:4, width:5, height:5,
                    borderRadius:'50%', background:'var(--blue)',
                    animation:'cfd-pressure 1s ease-in-out infinite' }}/>
                )}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
