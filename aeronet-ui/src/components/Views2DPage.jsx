// Views2DPage.jsx — AeroNet Vehicle Outline Analysis + Benchmarking
// Copyright (c) 2026 Rutej Talati / statinsite.com
//
// Updated:
//   - Compare mode: overlay two car outlines with alignment controls
//   - New geo fields: normWidth, normHeight, trueAspect, bodyType,
//     wasFlipped, roofFlatness, aPillarAngle, underbodyFlatness,
//     greenhouseRatio, wheelbaseNorm, convexityScore
//   - Fixed copy/export: downloads PNG with white background + black stroke
//   - Benchmarking sidebar: proportion metrics with visual bars
//   - M3 black/white theme throughout

import { useCallback, useEffect, useRef, useState } from 'react'
import SideViewSVG     from './SideViewSVG.jsx'
import PipelineOverlay from './PipelineOverlay.jsx'
import SimulationModal from './SimulationModal.jsx'
import CompareOverlay  from './CompareOverlay.jsx'

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const VIEWS = [
  { id:'side', label:'Side', icon:'▭', fullLabel:'Side View' },
]

const STAGES = [
  { id:'prep',    label:'Preprocess', icon:'⚙',  pct:[0,  8]  },
  { id:'rmbg',   label:'RMBG 2.0',   icon:'◉',  pct:[8,  18] },
  { id:'yolo',   label:'YOLO11',     icon:'◎',  pct:[18, 32] },
  { id:'sam3',   label:'SAM3',       icon:'⬡',  pct:[32, 46] },
  { id:'contour',label:'Contour',    icon:'✦',  pct:[46, 60] },
  { id:'enh',    label:'Enhance',    icon:'◈',  pct:[60, 74] },
  { id:'keys',   label:'Keypoints',  icon:'⊞',  pct:[74, 84] },
  { id:'cfd',    label:'Geometry',   icon:'◈',  pct:[84, 92] },
  { id:'done',   label:'Complete',   icon:'✓',  pct:[92,100] },
]

const BACKEND_MSGS = [
  [0,  'Stage 0a: EXIF fix, canvas margin, resize to 1536px…',         'Input normalisation'],
  [8,  'Stage 0b: RMBG 2.0 — foreground extraction…',                  'Separating car from background'],
  [18, 'Stage 1: YOLO11x-seg — vehicle detection…',                    '10% bbox padding applied'],
  [32, 'Stage 2: SAM3 point-prompted mask refinement…',                '5 fg + 4 bg prompt points'],
  [46, 'Stage 3-5: morph close → contour → Canny snap…',              'Constrained to ±5px boundary band'],
  [60, 'Stage 7: Wheel arch detection + smoothing…',                   'Hough on distance transform'],
  [68, 'Stage 7c: Catmull-Rom spline (120sps, 2× Chaikin)…',          'Maximum smoothing'],
  [74, 'Stage 8: Hough wheel geometry…',                               'Wheel centre + radius'],
  [84, 'Stage 9: Aspect-ratio-preserving normalisation…',              'True proportions preserved'],
  [88, 'Stage 9: Orientation detection + benchmarking geometry…',      '15 proportion metrics'],
  [92, 'Quality scoring — convexity + 9 other signals…',              'Checking outline quality'],
  [97, 'Finalising SVG, engineering exports…',                         'Complete — rendering'],
]

const FEAT_COLOR = {
  antenna: '#FFB74D',
  mirror:  '#81C784',
  spoiler: '#E0E0E0',
  wiper:   '#CE93D8',
  detail:  'rgba(255,255,255,0.45)',
}

const BODY_TYPE_ICONS = {
  sports:'🏎', saloon:'🚗', hatchback:'🚙', estate:'🚙',
  suv:'🛻', mpv:'🚐', coupe:'🚗', pickup:'🛻',
}

// ─────────────────────────────────────────────────────────────────────────────
// IMAGE UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

async function prepareImage(file, maxWidth = 1440) {
  return new Promise((resolve) => {
    const img = new window.Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const scale = Math.min(1.0, maxWidth / Math.max(img.width, 900))
      const w = Math.round(img.width  * Math.max(scale, 900/img.width))
      const h = Math.round(img.height * Math.max(scale, 900/img.width))
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,w,h)
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img,0,0,w,h)
      canvas.toBlob(
        blob => resolve(new File([blob], file.name.replace(/\.[^.]+$/,'.png'), {type:'image/png'})),
        'image/png'
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
      const filename = url.split('/').pop()?.split('?')[0] || 'car.png'
      return new File([blob], filename, { type: blob.type.startsWith('image/') ? blob.type : 'image/png' })
    } catch { continue }
  }
  throw new Error('Could not fetch image — download and upload directly')
}

// ─────────────────────────────────────────────────────────────────────────────
// SUBCOMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

function SL({ n, t }) {
  return (
    <div className="md-section-header">
      <span className="md-section-number">{n}</span>
      <div className="md-section-divider"/>
      <span className="md-section-title">{t}</span>
    </div>
  )
}

function DropZone({ viewId, label, icon, file, onFile }) {
  const [drag, setDrag] = useState(false)
  const inputRef = useRef(null)
  const handleDrop = e => {
    e.preventDefault(); setDrag(false)
    const f = e.dataTransfer.files?.[0]
    if (f?.type.startsWith('image/')) onFile(viewId, f)
  }
  return (
    <div className="md-dropzone" data-drag={drag} data-has-file={!!file}
      onClick={() => inputRef.current?.click()}
      onDragOver={e=>{e.preventDefault();setDrag(true)}}
      onDragLeave={()=>setDrag(false)}
      onDrop={handleDrop}>
      <input ref={inputRef} type="file" accept="image/*" style={{display:'none'}}
        onChange={e=>{const f=e.target.files?.[0];if(f)onFile(viewId,f)}}/>
      {file && <div style={{position:'absolute',top:8,right:8,width:8,height:8,borderRadius:'50%',background:'var(--md-success)'}}/>}
      <div style={{fontSize:28,color:file?'var(--md-success)':'var(--md-on-surface-disabled)'}}>{file?'✓':icon}</div>
      <div style={{fontSize:12,fontWeight:500,color:'var(--md-on-surface-variant)',fontFamily:'var(--font-sans)',letterSpacing:'0.5px'}}>{label}</div>
      <div style={{fontSize:11,color:'var(--md-on-surface-disabled)',fontFamily:'var(--font-sans)'}}>
        {file ? file.name.slice(0,18)+(file.name.length>18?'…':'') : 'drop or click'}
      </div>
    </div>
  )
}

function OutlineThumbnail({ geo, label, icon, isActive, onClick }) {
  const TW=96,TH=48,TP=5
  const pts = geo?._smoothPts ?? geo?._contourPts ?? []
  let pathD=''
  if (pts.length>10) {
    const aspect = geo._bboxAspect ?? geo.trueAspect ?? 2.2
    const dw=(TW-TP*2)*0.93, dh=Math.min(dw/aspect,TH-TP*2)
    const ox=TP+((TW-TP*2)-dw)/2, oy=TP+((TH-TP*2)-dh)/2
    pathD=pts.map(([nx,ny],i)=>`${i===0?'M':'L'}${(ox+nx*dw).toFixed(1)},${(oy+ny*dh).toFixed(1)}`).join(' ')+' Z'
  }
  return (
    <button onClick={onClick} style={{
      display:'flex',alignItems:'center',gap:10,width:'100%',
      padding:'8px 10px',borderRadius:12,cursor:'pointer',
      border:`1px solid ${isActive?'var(--md-primary)':'var(--md-outline-variant)'}`,
      background:isActive?'var(--md-primary-container)':'var(--md-surface-container-low)',
      transition:'all 0.2s',marginBottom:4,
    }}>
      <div className="md-card-filled" style={{width:TW,height:TH,flexShrink:0,overflow:'hidden'}}>
        <svg viewBox={`0 0 ${TW} ${TH}`} width={TW} height={TH}>
          <rect width={TW} height={TH} fill="var(--md-surface-container-highest)"/>
          {pathD
            ? <path d={pathD} fill="none" stroke={isActive?'var(--md-primary)':'rgba(255,255,255,0.55)'} strokeWidth="1" strokeLinejoin="round" strokeLinecap="round"/>
            : <text x={TW/2} y={TH/2+4} textAnchor="middle" fill="var(--md-on-surface-disabled)" fontSize="9" fontFamily="var(--font-sans)">{icon}</text>
          }
        </svg>
      </div>
      <div style={{flex:1,textAlign:'left',minWidth:0}}>
        <div style={{fontSize:13,fontWeight:500,color:isActive?'var(--md-on-primary-container)':'var(--md-on-surface)',fontFamily:'var(--font-sans)',marginBottom:2}}>
          {label}
        </div>
        <div style={{fontSize:11,color:'var(--md-on-surface-variant)',fontFamily:'var(--font-mono)'}}>
          {geo
            ? `${geo._contourPts?.length??0}pt · ${geo.bodyType??geo._method??'—'}`
            : 'not analysed'
          }
        </div>
      </div>
      {geo && (
        <div style={{width:8,height:8,borderRadius:'50%',flexShrink:0,
          background:(geo._quality?.score??0)>=75?'var(--md-success)':'var(--md-warning)'}}/>
      )}
    </button>
  )
}

function RearViewSVG({ g }) {
  const W=300,H=220,cx=W/2,gY=H-14
  const wheels=g?._keypoints?.wheels??[]
  const wsAngle=g?.wsAngleDeg??55
  const bh=Math.round(Math.min(120,Math.max(75,(g?.cabinH??0.58)*H*1.1)))
  const bw=Math.round(Math.min(120,Math.max(70,0.50*W)))
  const bodyBot=gY-bh*0.06,bodyTop=bodyBot-bh
  const roofNarrow=Math.max(0.28,Math.min(0.46,0.38-(wsAngle-55)*0.003))
  const roofHW=bw*roofNarrow,shoulderHW=bw*0.50,sillHW=bw*0.46
  const shoulderY=bodyTop+bh*0.55,sillY=bodyTop+bh*0.92
  const rearPath=[
    `M ${cx} ${bodyTop}`,
    `C ${cx-roofHW*0.6} ${bodyTop} ${cx-shoulderHW} ${shoulderY-bh*0.22} ${cx-shoulderHW} ${shoulderY}`,
    `C ${cx-shoulderHW} ${shoulderY+bh*0.12} ${cx-sillHW} ${sillY} ${cx-sillHW*0.80} ${bodyBot}`,
    `L ${cx+sillHW*0.80} ${bodyBot}`,
    `C ${cx+sillHW} ${sillY} ${cx+shoulderHW} ${shoulderY+bh*0.12} ${cx+shoulderHW} ${shoulderY}`,
    `C ${cx+shoulderHW} ${shoulderY-bh*0.22} ${cx+roofHW*0.6} ${bodyTop} ${cx} ${bodyTop}`,
    'Z',
  ].join(' ')
  const wR=wheels.length>=1?Math.max(12,Math.min(22,wheels[0].r/800*W*0.9)):15
  const w1x=cx-shoulderHW*1.05,w2x=cx+shoulderHW*1.05,wY=gY-wR
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',height:'100%'}} preserveAspectRatio="xMidYMid meet">
      <rect width={W} height={H} fill="var(--md-surface)"/>
      <line x1={12} y1={gY} x2={W-12} y2={gY} stroke="var(--md-outline-variant)" strokeWidth="1"/>
      <path d={rearPath} fill="none" stroke="var(--md-primary)" strokeWidth="1.2"/>
      {[[w1x,wY],[w2x,wY]].map(([wx,wy],i)=>(
        <g key={i}>
          <circle cx={wx} cy={wy} r={wR} fill="none" stroke="var(--md-primary)" strokeWidth="1.2"/>
          <circle cx={wx} cy={wy} r={wR*0.5} fill="none" stroke="var(--md-outline)" strokeWidth="0.8"/>
        </g>
      ))}
      <text x={cx} y={H-6} textAnchor="middle" fill="var(--md-on-surface-disabled)"
        fontSize="9" fontFamily="var(--font-mono)" letterSpacing=".12em">REAR</text>
    </svg>
  )
}

// Proportion bar for benchmarking sidebar
function PropBar({ label, valA, valB, colorA='#E0E0E0', colorB='#FFB74D', unit='', decimals=2 }) {
  if (valA==null) return null
  const max = Math.max(Math.abs(valA), valB!=null?Math.abs(valB):0, 0.001)
  const wA  = (Math.abs(valA)/max)*100
  const wB  = valB!=null ? (Math.abs(valB)/max)*100 : null
  return (
    <div style={{marginBottom:8}}>
      <div style={{display:'flex',justifyContent:'space-between',marginBottom:2}}>
        <span style={{fontSize:10,color:'var(--md-on-surface-variant)',fontFamily:'var(--font-mono)'}}>{label}</span>
        <div style={{display:'flex',gap:8}}>
          <span style={{fontSize:10,color:colorA,fontFamily:'var(--font-mono)',fontWeight:600}}>{valA.toFixed(decimals)}{unit}</span>
          {valB!=null && <span style={{fontSize:10,color:colorB,fontFamily:'var(--font-mono)',fontWeight:600}}>{valB.toFixed(decimals)}{unit}</span>}
        </div>
      </div>
      <div style={{height:4,background:'var(--md-surface-container-highest)',borderRadius:2,overflow:'hidden',marginBottom:valB!=null?2:0}}>
        <div style={{height:'100%',width:`${wA}%`,background:colorA,borderRadius:2,opacity:0.8}}/>
      </div>
      {valB!=null && (
        <div style={{height:4,background:'var(--md-surface-container-highest)',borderRadius:2,overflow:'hidden'}}>
          <div style={{height:'100%',width:`${wB}%`,background:colorB,borderRadius:2,opacity:0.8}}/>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────

const EMPTY_SLOT = {file:null,geo:null,running:false,progress:{pct:0,msg:'',sub:''},drawDone:false,isDrawing:false,error:null}

export default function Views2DPage({ backend = '' }) {
  const [slots, setSlots] = useState({
    side: {...EMPTY_SLOT},
  })

  const [activeView,   setActiveView]   = useState('side')
  const [analysisMode, setAnalysisMode] = useState('A')
  const [showSep,      setShowSep]      = useState(true)
  const [outlineMode,  setOutlineMode]  = useState('smooth') // 'smooth' | 'technical'
  const [showArches,   setShowArches]   = useState(false)
  const [compareMode,  setCompareMode]  = useState(false)
  const [compareB,     setCompareB]     = useState(null)
  const [copyDone,     setCopyDone]     = useState(false)
  const [showSimModal, setShowSimModal] = useState(false)
  const [urlMode,      setUrlMode]      = useState(false)
  const [urlInput,     setUrlInput]     = useState('')
  const [urlError,     setUrlError]     = useState('')
  const svgRef = useRef(null)

  const getSlot = id => slots[id]
  const setSlot = (id, patch) => setSlots(p => ({...p,[id]:{...p[id],...patch}}))

  const setViewFile = useCallback((viewId, file) => {
    setSlot(viewId, {file,geo:null,error:null,drawDone:false,isDrawing:false,progress:{pct:0,msg:'',sub:''}})
    setActiveView(viewId)
  }, []) // eslint-disable-line

  useEffect(() => {
    const handle = e => {
      const items = Array.from(e.clipboardData?.items??[])
      const imgItem = items.find(i=>i.type.startsWith('image/'))
      if (imgItem) { setViewFile(activeView,imgItem.getAsFile()); return }
      const text = e.clipboardData?.getData('text')??''
      if (/^https?:\/\//i.test(text)) {
        fetchImageFromUrl(text).then(f=>setViewFile(activeView,f)).catch(err=>setSlot(activeView,{error:err.message}))
      }
    }
    window.addEventListener('paste', handle)
    return () => window.removeEventListener('paste', handle)
  }, [activeView, setViewFile]) // eslint-disable-line

  const apiUrl = path => backend ? `${backend}${path}` : `/api${path}`
  const getMsgForPct = pct => {
    const e = [...BACKEND_MSGS].reverse().find(m=>pct>=m[0])
    return e ? {msg:e[1],sub:e[2]} : {msg:'Processing…',sub:''}
  }

  // ── Run analysis ────────────────────────────────────────────────────────────

  const runView = async (viewId) => {
    const slot = getSlot(viewId)
    if (!slot.file) return
    setSlot(viewId,{running:true,error:null,geo:null,drawDone:false,isDrawing:false,progress:{pct:2,msg:'Preparing image…',sub:'Input normalisation'}})
    let uploadFile
    try { uploadFile = await prepareImage(slot.file) } catch { uploadFile = slot.file }

    let jobId=null
    const MAX=8
    for (let attempt=0; attempt<MAX; attempt++) {
      setSlot(viewId,{progress:{pct:5,msg:attempt===0?'Connecting to server…':`Retrying… (${attempt*5}s)`,sub:'Establishing connection'}})
      try {
        const fd=new FormData()
        fd.append('file',uploadFile); fd.append('mode',analysisMode); fd.append('view',viewId)
        const ctrl=new AbortController(), timer=setTimeout(()=>ctrl.abort(),25000)
        let res
        try { res=await fetch(apiUrl('/analyze-contour/start'),{method:'POST',body:fd,signal:ctrl.signal}) }
        finally { clearTimeout(timer) }
        if (res.ok) { jobId=(await res.json()).job_id; break }
        const txt=await res.text().catch(()=>'')
        setSlot(viewId,{running:false,error:`Server error ${res.status}${txt?': '+txt.slice(0,100):''}`}); return
      } catch {
        if (attempt>=MAX-1) { setSlot(viewId,{running:false,error:`Could not reach server after ${MAX*5}s.`}); return }
        await new Promise(r=>setTimeout(r,5000))
      }
    }
    if (!jobId) { setSlot(viewId,{running:false,error:'Failed to start job.'}); return }
    setSlot(viewId,{progress:{pct:10,msg:'Job queued — preprocessing…',sub:'Input normalisation'}})

    const t0=Date.now()
    while (true) {
      await new Promise(r=>setTimeout(r,3000))
      const elapsed=Math.round((Date.now()-t0)/1000)
      let poll
      try {
        const pc=new AbortController(), timer=setTimeout(()=>pc.abort(),10000)
        let res
        try { res=await fetch(apiUrl(`/analyze-contour/result/${jobId}`),{signal:pc.signal}) }
        finally { clearTimeout(timer) }
        if (!res.ok) { setSlot(viewId,{running:false,error:`Poll error ${res.status}`}); return }
        poll=await res.json()
      } catch(e) { setSlot(viewId,{running:false,error:`Connection lost: ${e.message}`}); return }

      const pollStatus = poll.status ?? poll.stage
      const pollMsg    = poll.error  ?? poll.msg ?? ''

      if (pollStatus==='error') { setSlot(viewId,{running:false,error:pollMsg||'Analysis failed'}); return }

      if (pollStatus==='running'||pollStatus==='pending') {
        const pct=Math.min(90,10+elapsed*1.2)
        const {msg,sub}=getMsgForPct(pct)
        setSlot(viewId,{progress:{pct:Math.round(pct),msg:`${msg} (${elapsed}s)`,sub}}); continue
      }

      if (pollStatus==='done') {
        const result=poll.result
        if (!result?.geometry) { setSlot(viewId,{running:false,error:'No vehicle outline found. Use a clear photo.'}); return }
        const cg=result.geometry

        const geo = {
          // ── Core proportions (new — aspect-ratio-preserving) ──────────
          trueAspect:        result.true_aspect       ?? cg.trueAspect      ?? cg.aspectRatio ?? 2.0,
          normWidth:         result.norm_w            ?? cg.normWidth        ?? null,
          normHeight:        result.norm_h            ?? cg.normHeight       ?? null,
          wasFlipped:        result.was_flipped       ?? cg.wasFlipped       ?? false,
          // ── Body classification ────────────────────────────────────────
          bodyType:          cg.bodyType              ?? null,
          ahmedRegime:       cg.ahmedRegime           ?? null,
          // ── Roofline ──────────────────────────────────────────────────
          hoodRatio:         cg.hoodRatio             ?? null,
          cabinRatio:        cg.cabinRatio            ?? null,
          bootRatio:         cg.bootRatio             ?? null,
          roofFlatness:      cg.roofFlatness          ?? null,
          roofPeakOffset:    cg.roofPeakOffset        ?? null,
          // ── Glass + pillar angles ──────────────────────────────────────
          aPillarAngle:      cg.aPillarAngle          ?? null,
          wsAngleDeg:        cg.wsAngleDeg            ?? 58,
          rearSlantAngleDeg: cg.rearSlantAngleDeg     ?? null,
          // ── Stance ────────────────────────────────────────────────────
          rideH:             cg.rideH                ?? cg.groundClearanceNorm ?? 0.08,
          underbodyFlatness: cg.underbodyFlatness     ?? null,
          archDepth:         cg.archDepth             ?? null,
          // ── Greenhouse ────────────────────────────────────────────────
          greenhouseRatio:   cg.greenhouseRatio       ?? null,
          beltlineH:         cg.beltlineH             ?? null,
          // ── Wheels + wheelbase ─────────────────────────────────────────
          wheelbaseNorm:     cg.wheelbaseNorm         ?? null,
          wheelDiamRatio:    cg.wheelDiamRatio        ?? null,
          w1:                cg.w1                    ?? 0.22,
          w2:                cg.w2                    ?? 0.76,
          // ── Quality ───────────────────────────────────────────────────
          convexityScore:    cg.convexityScore        ?? null,
          // ── Front/rear view ───────────────────────────────────────────
          frontalAreaNorm:   cg.frontalAreaNorm       ?? null,
          trackWidthNorm:    cg.trackWidthNorm        ?? null,
          shoulderWidthNorm: cg.shoulderWidthNorm     ?? null,
          symmetryScore:     cg.symmetryScore         ?? null,
          frontalAspect:     cg.frontalAspect         ?? null,
          // ── Contour points ─────────────────────────────────────────────
          _smoothPts:        result.display_outline_pts ?? result.smooth_pts_display ?? result.smooth_pts ?? result.outline_pts ?? result.technical_outline_pts ?? null,
          _contourPts:       result.technical_outline_pts ?? result.smooth_pts_2k ?? result.outline_pts ?? result.display_outline_pts ?? result.smooth_pts_display ?? result.smooth_pts ?? null,
          _hasBothModes:     !!(result.display_outline_pts && result.technical_outline_pts),
          _bboxAspect:       result.bbox ? result.bbox.w/Math.max(1,result.bbox.h) : undefined,
          _keypoints:        result.keypoints,
          _method:           result.method,
          _quality:          result.quality ?? null,
          _viewType:         cg._view ?? viewId,
          // ── Arch ──────────────────────────────────────────────────────
          arch_pts:          result.arch_pts          ?? null,
          arch_bbox_aspect:  result.arch_bbox_aspect  ?? null,
          arch_wheels:       result.arch_wheels       ?? [],
          // ── Features ──────────────────────────────────────────────────
          features:          result.features          ?? [],
          sharp_indices:     result.sharp_indices     ?? [],
          // ── Image dims ────────────────────────────────────────────────
          _imageW:           result._imageW           ?? 1536,
          _imageH:           result._imageH           ?? 768,
          // ── Legacy ────────────────────────────────────────────────────
          aspectRatio:       result.true_aspect       ?? cg.aspectRatio ?? 2.0,
          cabinH:            cg.cabinH               ?? 0.58,
          Cd:                cg.Cd                   ?? null,
          CdA:               cg.CdA                  ?? null,
        }

        // Skip animation delay — set drawDone immediately so outline renders right away
        setSlot(viewId,{running:false,progress:{pct:0,msg:'',sub:''},geo,isDrawing:false,drawDone:true})
        return
      }
    }
  }

  // ── Export helpers ──────────────────────────────────────────────────────────

  const exportSVG = () => {
    const svg = svgRef.current?.querySelector('svg')
    if (!svg) return
    const a=document.createElement('a')
    a.href=URL.createObjectURL(new Blob([svg.outerHTML],{type:'image/svg+xml'}))
    a.download=`aeronet_${activeView}.svg`; a.click()
  }

  const _buildOutlineSVG = (geo, {strokeColor='#111111',strokeWidth=3,bg=true,mode=null}={}) => {
    const pts = (mode==='technical' ? geo._contourPts : null) ?? geo._smoothPts ?? geo._contourPts
    if (!pts?.length) return null

    const normW = geo.normWidth  ?? geo.norm_w  ?? null
    const normH = geo.normHeight ?? geo.norm_h  ?? null
    const PAD = 60

    let CW, CH, d
    if (normW && normH && normW > 0 && normH > 0) {
      // Size the output canvas to the car's true aspect ratio — no dead space.
      // Fix long edge to 1600px, derive other edge from true proportions.
      const trueAspect = normW / normH   // e.g. 3.2 for a saloon
      if (trueAspect >= 1) {
        CW = 1600
        CH = Math.round(CW / trueAspect) + PAD * 2
      } else {
        CH = 1600
        CW = Math.round(CH * trueAspect) + PAD * 2
      }
      // Map [0,normW]→[PAD, CW-PAD],  [0,normH]→[PAD, CH-PAD]
      const scaleX = (CW - PAD * 2) / normW
      const scaleY = (CH - PAD * 2) / normH
      d = pts.map(([nx,ny],i) =>
        `${i===0?'M':'L'}${(PAD + nx*scaleX).toFixed(2)},${(PAD + ny*scaleY).toFixed(2)}`
      ).join(' ') + ' Z'
    } else {
      // Fallback: old behaviour for missing norm metadata
      const bboxAspect = geo._bboxAspect ?? geo.trueAspect ?? 2.4
      CW = 1600; CH = 700
      const dw = (CW-PAD*2)*0.95, dh = Math.min(dw/bboxAspect, CH-PAD*2)
      const ox = PAD+((CW-PAD*2)-dw)/2, oy = PAD+((CH-PAD*2)-dh)/2
      d = pts.map(([nx,ny],i) =>
        `${i===0?'M':'L'}${(ox+nx*dw).toFixed(2)},${(oy+ny*dh).toFixed(2)}`
      ).join(' ') + ' Z'
    }

    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="${CW}" height="${CH}" viewBox="0 0 ${CW} ${CH}">` +
      (bg ? `<rect width="${CW}" height="${CH}" fill="white"/>` : '') +
      `<path d="${d}" fill="none" stroke="${strokeColor}" stroke-width="${strokeWidth}" stroke-linejoin="round" stroke-linecap="round"/>` +
      `</svg>`
    )
  }

  const copyOutline = async () => {
    const geo = getSlot(activeView).geo
    const _hasPoints = geo?._smoothPts?.length || geo?._contourPts?.length
    if (!_hasPoints) return
    const svgStr = _buildOutlineSVG(geo,{strokeColor:'#111111',strokeWidth:3,bg:true,mode:outlineMode})
    if (!svgStr) return
    // Extract actual dimensions from the generated SVG (aspect-correct, not hardcoded)
    const wMatch = svgStr.match(/width="(\d+)"/)
    const hMatch = svgStr.match(/height="(\d+)"/)
    const CW = wMatch ? parseInt(wMatch[1]) : 1600
    const CH = hMatch ? parseInt(hMatch[1]) : 700
    const renderPNG = () => new Promise((resolve,reject) => {
      const img=new window.Image()
      img.onload=()=>{
        const canvas=document.createElement('canvas')
        canvas.width=CW*2; canvas.height=CH*2
        const ctx=canvas.getContext('2d')
        ctx.fillStyle='#ffffff'; ctx.fillRect(0,0,canvas.width,canvas.height)
        ctx.drawImage(img,0,0,canvas.width,canvas.height)
        canvas.toBlob(resolve,'image/png')
      }
      img.onerror=reject
      img.src='data:image/svg+xml;base64,'+btoa(unescape(encodeURIComponent(svgStr)))
    })
    try {
      const png=await renderPNG()
      try { await navigator.clipboard.write([new ClipboardItem({'image/png':png})]) } catch {}
      const a=document.createElement('a')
      a.href=URL.createObjectURL(png)
      a.download=`aeronet_outline_${activeView}.png`
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      setCopyDone(true); setTimeout(()=>setCopyDone(false),3000)
    } catch(err) { exportOutlineSVG() }
  }

  const exportOutlineSVG = () => {
    const geo=getSlot(activeView).geo
    if (!geo?._smoothPts?.length && !geo?._contourPts?.length) return
    const svgStr=_buildOutlineSVG(geo,{strokeColor:'#111111',strokeWidth:2.5,bg:false,mode:outlineMode})
    if (!svgStr) return
    const a=document.createElement('a')
    a.href=URL.createObjectURL(new Blob([svgStr],{type:'image/svg+xml'}))
    a.download=`aeronet_outline_${activeView}.svg`
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
  }

  const exportTransparentPNG = async () => {
    const geo = getSlot(activeView).geo
    if (!geo?._smoothPts?.length && !geo?._contourPts?.length) return
    // bg:false = transparent background SVG
    const svgStr = _buildOutlineSVG(geo, {strokeColor:'#000000', strokeWidth:4, bg:false, mode:outlineMode})
    if (!svgStr) return
    const wMatch = svgStr.match(/width="(\d+)"/)
    const hMatch = svgStr.match(/height="(\d+)"/)
    const CW = wMatch ? parseInt(wMatch[1]) : 1600
    const CH = hMatch ? parseInt(hMatch[1]) : 700
    const img = new window.Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width  = CW * 2
      canvas.height = CH * 2
      const ctx = canvas.getContext('2d')
      // Do NOT fill background — leaves canvas transparent
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      canvas.toBlob(blob => {
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = `aeronet_outline_${activeView}_transparent.png`
        document.body.appendChild(a); a.click(); document.body.removeChild(a)
      }, 'image/png')
    }
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgStr)))
  }

  // ── Derived ─────────────────────────────────────────────────────────────────

  const activeSlot    = getSlot(activeView)
  const isRunning     = activeSlot.running
  const geo           = activeSlot.geo
  const drawDone      = activeSlot.drawDone
  const isDrawing     = activeSlot.isDrawing
  const traceProgress = activeSlot.progress
  const error         = activeSlot.error
  const hasFile       = !!activeSlot.file
  const anyOutline    = !!activeSlot.geo
  const canShowArches = activeView==='side' && !!geo?.arch_pts
  const analysedViews = activeSlot.geo ? [VIEWS[0]] : []
  const canCompare    = false

  // Compare: Car A = activeView slot, Car B = compareB slot
  const geoA = getSlot(activeView)?.geo ?? null
  const geoB = compareB ? getSlot(compareB)?.geo ?? null : null
  const labelA = getSlot(activeView)?.file?.name?.replace(/\.[^.]+$/,'') ?? 'Side View'
  const labelB = null

  const ahmedColor = r=>({attached:'var(--md-success)',intermediate:'var(--md-warning)',critical:'var(--md-error)',separated:'var(--md-error)'}[r]??'var(--md-primary)')

  const renderCanvas = (g,isDrawingFlag,drawDoneFlag) => {
    if (!g) return null
    return <SideViewSVG g={g} showSep={showSep} showArches={showArches} isDrawing={isDrawingFlag} drawDone={drawDoneFlag} outlineMode={outlineMode}/>
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div style={{display:'flex',height:'100%',overflow:'hidden',background:'var(--md-surface)'}}>

      {showSimModal && geo && <SimulationModal geo={geo} onClose={()=>setShowSimModal(false)}/>}

      {/* ══ M3 Navigation Rail — Side only ═══════════════════════════════════ */}
      <nav className="md-nav-rail">
        <div style={{fontSize:18,color:'var(--md-primary)',marginBottom:8,fontWeight:700,fontFamily:'var(--font-mono)'}}>A</div>
        <div style={{width:32,height:1,background:'var(--md-outline-variant)',marginBottom:8}}/>
        <button className="md-nav-rail-item" data-active={true}>
          <div className="md-nav-indicator" style={{position:'relative'}}>
            ▭
            {activeSlot.geo&&!activeSlot.running&&<div style={{position:'absolute',top:4,right:8,width:6,height:6,borderRadius:'50%',background:'var(--md-success)'}}/>}
            {activeSlot.running&&<div style={{position:'absolute',top:4,right:8,width:6,height:6,borderRadius:'50%',background:'var(--md-primary)',animation:'md-pulse 1s ease infinite'}}/>}
          </div>
          <span className="md-nav-label">Side</span>
        </button>
      </nav>

      {/* ══ M3 Side Sheet ════════════════════════════════════════════════════ */}
      <div style={{
        width:272,flexShrink:0,display:'flex',flexDirection:'column',
        borderRight:'1px solid var(--md-outline-variant)',
        background:'var(--md-surface-container-low)',overflow:'hidden',
      }}>
        <div style={{flex:1,overflowY:'auto',padding:'16px 12px'}}>

          {/* 01 — Saved outline */}
          <SL n="01" t="Saved Outline"/>
          <div style={{marginBottom:12}}>
            <OutlineThumbnail
              geo={activeSlot.geo} label="Side View" icon="▭"
              isActive={true} onClick={()=>{}}
            />
          </div>

          {/* 02 — Upload */}
          <SL n="02" t="Upload — Side View"/>
          <div style={{marginBottom:10}}>
            <DropZone viewId="side" label="Side View" icon="▭" file={activeSlot.file} onFile={setViewFile}/>
          </div>

          {/* URL input */}
          {urlMode ? (
            <div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:10}}>
              <div style={{display:'flex',gap:6}}>
                <input autoFocus className="md-text-field" value={urlInput}
                  onChange={e=>setUrlInput(e.target.value)}
                  onKeyDown={e=>{
                    if(e.key==='Enter') fetchImageFromUrl(urlInput).then(f=>{setViewFile(activeView,f);setUrlMode(false)}).catch(err=>setUrlError(err.message))
                    if(e.key==='Escape') setUrlMode(false)
                  }}
                  placeholder="https://example.com/car.jpg" style={{flex:1,fontSize:11}}/>
                <button className="md-btn-tonal" style={{height:40,padding:'0 14px',fontSize:12}}
                  onClick={()=>fetchImageFromUrl(urlInput).then(f=>{setViewFile(activeView,f);setUrlMode(false)}).catch(err=>setUrlError(err.message))}>Go</button>
              </div>
              {urlError&&<div style={{fontSize:11,color:'var(--md-error)',fontFamily:'var(--font-sans)'}}>{urlError}</div>}
              <button className="md-btn-outlined" style={{fontSize:12,height:36}} onClick={()=>{setUrlMode(false);setUrlError('')}}>Cancel</button>
            </div>
          ) : (
            <button className="md-btn-outlined" style={{width:'100%',fontSize:12,height:36,marginBottom:10}} onClick={()=>setUrlMode(true)}>
              🔗 Load from URL
            </button>
          )}

          {/* Analysis mode */}
          <div style={{marginBottom:12}}>
            <div style={{fontSize:11,color:'var(--md-on-surface-variant)',fontFamily:'var(--font-sans)',letterSpacing:'0.5px',marginBottom:8,textTransform:'uppercase'}}>
              Analysis Mode
            </div>
            <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
              {[{id:'A',label:'Silhouette',sub:'~30s'},{id:'B',label:'Panels',sub:'~90s'},{id:'C',label:'Full Aero',sub:'~150s'}].map(m=>(
                <button key={m.id} className="md-chip" data-selected={analysisMode===m.id} onClick={()=>setAnalysisMode(m.id)}>
                  {m.label}
                  <span style={{fontSize:10,opacity:0.6,fontFamily:'var(--font-mono)'}}>{m.sub}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Outline mode toggle — Smooth / Technical */}
          <div style={{marginBottom:10}}>
            <div style={{fontSize:11,color:'var(--md-on-surface-variant)',fontFamily:'var(--font-sans)',letterSpacing:'0.5px',marginBottom:6,textTransform:'uppercase'}}>
              Outline Mode
            </div>
            <div style={{display:'flex',background:'var(--md-surface-container-highest)',borderRadius:10,padding:3,gap:2}}>
              <button
                onClick={()=>setOutlineMode('smooth')}
                style={{
                  flex:1,padding:'6px 0',borderRadius:8,fontSize:11,border:'none',cursor:'pointer',
                  fontFamily:'var(--font-sans)',fontWeight:600,
                  background:outlineMode==='smooth'?'var(--md-primary-container)':'transparent',
                  color:outlineMode==='smooth'?'var(--md-on-primary-container)':'var(--md-on-surface-variant)',
                  transition:'all 0.2s',
                }}
              >
                Smooth
              </button>
              <button
                onClick={()=>setOutlineMode('technical')}
                style={{
                  flex:1,padding:'6px 0',borderRadius:8,fontSize:11,border:'none',cursor:'pointer',
                  fontFamily:'var(--font-sans)',fontWeight:600,
                  background:outlineMode==='technical'?'var(--md-primary-container)':'transparent',
                  color:outlineMode==='technical'?'var(--md-on-primary-container)':'var(--md-on-surface-variant)',
                  transition:'all 0.2s',
                }}
              >
                Technical
              </button>
            </div>
            <div style={{fontSize:10,color:'var(--md-on-surface-disabled)',fontFamily:'var(--font-sans)',marginTop:5,lineHeight:1.4}}>
              {outlineMode==='smooth'?'Max smoothing — for presentations':'Geometry-preserving — for overlays'}
            </div>
          </div>

          {/* Analyse FAB */}
          <button className="md-fab-extended" onClick={()=>runView('side')}
            disabled={!hasFile||isRunning} style={{marginBottom:8}}>
            {isRunning
              ? <><div className="md-spin" style={{width:16,height:16,border:'2px solid rgba(255,255,255,0.3)',borderTopColor:'var(--md-on-primary-container)',borderRadius:'50%'}}/> Analysing…</>
              : <>▶ Analyse</>
            }
          </button>

          {/* CFD Simulation */}
          {drawDone && (
            <button className="md-btn-outlined" style={{width:'100%',height:40,fontSize:13,marginBottom:8,borderColor:'var(--md-success)',color:'var(--md-success)'}}
              onClick={()=>setShowSimModal(true)}>▷ Run CFD Simulation</button>
          )}

          {/* Error */}
          {error && (
            <div style={{borderRadius:12,padding:'10px 14px',marginBottom:10,background:'rgba(242,184,184,0.08)',border:'1px solid rgba(242,184,184,0.20)',color:'var(--md-error)',fontSize:12,lineHeight:1.5,fontFamily:'var(--font-sans)'}}>
              {error}
            </div>
          )}



          {/* 03 — Geometry / Benchmarking */}
          {geo && !compareMode && (
            <>
              <SL n="03" t="Proportions"/>
              <div className="md-card-outlined" style={{padding:'10px 12px',marginBottom:10}}>

                {/* Body type badge */}
                {geo.bodyType && (
                  <div style={{marginBottom:10,display:'flex',alignItems:'center',gap:8}}>
                    <span style={{fontSize:18}}>{BODY_TYPE_ICONS[geo.bodyType]??'🚗'}</span>
                    <div>
                      <div style={{fontSize:13,fontWeight:600,color:'var(--md-on-surface)',fontFamily:'var(--font-sans)',textTransform:'capitalize'}}>{geo.bodyType}</div>
                      {geo.wasFlipped && <div style={{fontSize:10,color:'var(--md-warning)',fontFamily:'var(--font-sans)'}}>⚠ Auto-flipped to right-facing</div>}
                    </div>
                  </div>
                )}

                <div style={{height:1,background:'var(--md-outline-variant)',marginBottom:8}}/>

                {/* True proportions */}
                {geo.trueAspect!=null && (
                  <PropBar label="Length:Height" valA={geo.trueAspect} decimals={2}/>
                )}
                {geo.normHeight!=null && (
                  <PropBar label="Norm. height" valA={geo.normHeight} decimals={3}/>
                )}
                {geo.wheelbaseNorm!=null && (
                  <PropBar label="Wheelbase" valA={geo.wheelbaseNorm} decimals={3}/>
                )}

                <div style={{height:1,background:'var(--md-outline-variant)',margin:'8px 0'}}/>

                {[
                  ['Hood',   geo.hoodRatio,   null, 2],
                  ['Cabin',  geo.cabinRatio,  null, 2],
                  ['Boot',   geo.bootRatio,   null, 2],
                ].filter(([,v])=>v!=null).map(([k,v,,d])=>(
                  <div key={k} className="md-list-item">
                    <span className="md-list-item-label">{k}</span>
                    <span className="md-list-item-value">{(v*100).toFixed(1)}%</span>
                  </div>
                ))}

                <div style={{height:1,background:'var(--md-outline-variant)',margin:'8px 0'}}/>

                {[
                  ['A-pillar',     geo.aPillarAngle,      '°', 1],
                  ['WS rake',      geo.wsAngleDeg,        '°', 1],
                  ['Rear slant',   geo.rearSlantAngleDeg, '°', 1],
                  ['Ride height',  geo.rideH!=null?geo.rideH*100:null, '%', 1],
                  ['Greenhouse',   geo.greenhouseRatio!=null?geo.greenhouseRatio*100:null, '%', 1],
                  ['Roof flat.',   geo.roofFlatness,      '',  3],
                  ['Underbody',    geo.underbodyFlatness,  '',  3],
                  ['Convexity',    geo.convexityScore,     '',  3],
                  ['Pts',          geo._contourPts?.length??null, 'pt', 0],
                  ['Method',       null, null, 0],
                ].filter(([,v])=>v!=null).map(([k,v,u,d])=>(
                  <div key={k} className="md-list-item">
                    <span className="md-list-item-label">{k}</span>
                    <span className="md-list-item-value">{typeof v==='number'?v.toFixed(d):v}{u??''}</span>
                  </div>
                ))}

                {geo._method && (
                  <div className="md-list-item">
                    <span className="md-list-item-label">Method</span>
                    <span className="md-list-item-value" style={{fontSize:9}}>{geo._method}</span>
                  </div>
                )}

                {/* Fine features */}
                {geo.features?.length>0 && (() => {
                  const counts=geo.features.reduce((acc,f)=>({...acc,[f.type]:(acc[f.type]??0)+1}),{})
                  return (
                    <>
                      <div style={{height:1,background:'var(--md-outline-variant)',margin:'8px 0 6px'}}/>
                      {Object.entries(counts).map(([type,count])=>(
                        <div key={type} className="md-list-item">
                          <span className="md-list-item-label">{type}</span>
                          <span className="md-list-item-value" style={{color:FEAT_COLOR[type]??'var(--md-primary)'}}>{count} detected</span>
                        </div>
                      ))}
                    </>
                  )
                })()}
              </div>

              {/* 04 — Quality */}
              <SL n="04" t="Quality"/>
              <div className="md-card-outlined" style={{padding:'12px',marginBottom:10}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
                  <span style={{fontSize:24,fontWeight:300,fontFamily:'var(--font-mono)',color:(geo._quality?.score??0)>=75?'var(--md-success)':'var(--md-warning)'}}>
                    {geo._quality?.score??0}<span style={{fontSize:12,color:'var(--md-on-surface-variant)'}}>/100</span>
                  </span>
                  <span style={{fontSize:11,color:'var(--md-on-surface-variant)',fontFamily:'var(--font-sans)',letterSpacing:'0.5px',textTransform:'uppercase'}}>
                    {geo._quality?.status??'ACCEPTED'}
                  </span>
                </div>
                <div className="md-linear-progress" style={{marginBottom:10}}>
                  <div className="md-linear-progress-bar" style={{width:`${geo._quality?.score??0}%`,background:(geo._quality?.score??0)>=75?'var(--md-success)':'var(--md-warning)'}}/>
                </div>
                {geo._quality?.warnings?.slice(0,3).map((w,i)=>(
                  <div key={i} style={{fontSize:11,color:'var(--md-warning)',marginTop:4,lineHeight:1.4,fontFamily:'var(--font-sans)'}}>{w}</div>
                ))}
              </div>

              {/* 05 — Ahmed body */}
              {geo.ahmedRegime && (
                <>
                  <SL n="05" t="Flow Regime"/>
                  <div className="md-card-outlined" style={{padding:'10px 12px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                    <span style={{fontSize:13,color:'var(--md-on-surface-variant)',fontFamily:'var(--font-sans)'}}>Regime</span>
                    <span style={{fontSize:12,fontWeight:600,fontFamily:'var(--font-mono)',color:ahmedColor(geo.ahmedRegime),background:`${ahmedColor(geo.ahmedRegime)}18`,padding:'3px 10px',borderRadius:99,border:`1px solid ${ahmedColor(geo.ahmedRegime)}44`}}>
                      {geo.ahmedRegime.toUpperCase()} {geo.rearSlantAngleDeg?.toFixed(1)}°
                    </span>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* ══ CENTRE ════════════════════════════════════════════════════════════ */}
      <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>

        {/* Toolbar */}
        {(
          <div style={{
            height:48,flexShrink:0,display:'flex',alignItems:'center',gap:4,padding:'0 12px',
            background:'var(--md-surface-container)',borderBottom:'1px solid var(--md-outline-variant)',
          }}>
            <span style={{fontSize:16,fontWeight:500,color:'var(--md-on-surface)',fontFamily:'var(--font-sans)',marginRight:8}}>
              {VIEWS.find(v=>v.id===activeView)?.fullLabel}
            </span>
            <div style={{width:1,height:20,background:'var(--md-outline-variant)',margin:'0 4px'}}/>

            {/* Sep */}
            <button className="md-icon-btn" data-active={showSep} onClick={()=>setShowSep(p=>!p)} title="Separation lines" style={{fontSize:12}}>⌁</button>



            {/* Arches */}
            <button className="md-icon-btn" data-active={showArches&&canShowArches}
              onClick={()=>canShowArches&&setShowArches(p=>!p)}
              style={{opacity:canShowArches?1:0.35,cursor:canShowArches?'pointer':'default',fontSize:12}}
              title="Wheel arches">⊙</button>

            {/* Diagnostic */}
            {geo && (
              <span style={{fontSize:11,color:'var(--md-on-surface-disabled)',fontFamily:'var(--font-mono)',marginLeft:4}}>
                {geo._contourPts?.length??0}pts
                {geo.bodyType?` · ${geo.bodyType}`:''}
                {geo.wasFlipped?' · flipped':''}
              </span>
            )}

            <div style={{flex:1}}/>

            <button className="md-btn-outlined" style={{height:36,fontSize:12,padding:'0 14px'}}
              onClick={exportSVG} disabled={!geo} title="Download full canvas SVG">↓ SVG</button>
            <button className="md-btn-outlined"
              style={{height:36,fontSize:12,padding:'0 14px',opacity:geo?1:0.35}}
              onClick={exportOutlineSVG} disabled={!geo}
              title="Download black outline SVG — insert into Word via Insert → Pictures">↓ Outline</button>
            <button className="md-btn-outlined"
              style={{height:36,fontSize:12,padding:'0 14px',borderColor:copyDone?'var(--md-success)':'var(--md-outline)',color:copyDone?'var(--md-success)':'var(--md-on-surface-variant)'}}
              onClick={copyOutline} disabled={!geo}
              title="Download PNG with white background">
              {copyDone?'✓ Downloaded':'⎘ PNG'}
            </button>
            <button className="md-btn-outlined"
              style={{height:36,fontSize:12,padding:'0 14px'}}
              onClick={exportTransparentPNG} disabled={!geo}
              title="Download transparent PNG — layer over anything in PowerPoint or Keynote">
              ⎘ PNG (transparent)
            </button>
          </div>
        )}

        {/* Canvas */}
        <div style={{flex:1,position:'relative',overflow:'hidden',background:'var(--md-surface)'}} ref={svgRef}>



          {/* Canvas */}
          {(
            <>
              <PipelineOverlay visible={isRunning} pct={traceProgress.pct} msg={traceProgress.msg} sub={traceProgress.sub} stages={STAGES}/>

              {!geo && !isRunning && (
                <div style={{position:'absolute',inset:0,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:16}}>
                  <div style={{fontSize:48,color:'var(--md-outline-variant)'}}>{VIEWS.find(v=>v.id===activeView)?.icon}</div>
                  <div style={{fontSize:22,fontWeight:400,color:'var(--md-on-surface-variant)',fontFamily:'var(--font-sans)'}}>{VIEWS.find(v=>v.id===activeView)?.fullLabel}</div>
                  <div style={{fontSize:14,color:'var(--md-on-surface-disabled)',textAlign:'center',lineHeight:1.8,fontFamily:'var(--font-sans)'}}>
                    Drop a photo into the {VIEWS.find(v=>v.id===activeView)?.label} slot<br/>then click Analyse
                  </div>
                  {anyOutline && !hasFile && (
                    <div style={{fontSize:12,color:'var(--md-primary)',fontFamily:'var(--font-mono)',opacity:0.6}}>
                      Outline ready — see above
                    </div>
                  )}
                </div>
              )}

              {geo && !isRunning && (
                <div style={{width:'100%',height:'100%'}}>{renderCanvas(geo,isDrawing,drawDone)}</div>
              )}
            </>
          )}
        </div>

        {/* No thumbnail strip — side view only */}
      </div>
    </div>
  )
}
