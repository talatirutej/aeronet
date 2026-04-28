// Copyright (c) 2026 Rutej Talati. All rights reserved.

import { useState } from 'react'

const FEATURES = [
  { category:'Models', items:[
    { name:'GP-UPT — Geometry-Preserving Universal Physics Transformer', desc:'State-of-the-art model for DrivAerML. Takes raw STL, predicts full surface pressure and wall shear stress. R² > 0.95 on DrivAerML 484-case test set.', status:'planned', gpu:'NVIDIA A100 40GB or RTX 4090 24GB', vram:'24 GB minimum', trainingTime:'8–12 h on A100 · 24–36 h on RTX 4090', dataset:'DrivAerML 436 training cases + boundary VTP files (500 GB)', effort:'High', impact:'Very High', reference:'NeuralCFD 2025 — Bleeker et al.', tags:['field-prediction','deep-learning','gpu-required'] },
    { name:'ResNet-Tabular-12K — DrivAerStar', desc:'Residual MLP trained on DrivAerStar 12,000 cases (20 CAD parameters). Architecture already implemented. Needs DrivAerStar dataset from Harvard Dataverse.', status:'architecture-ready', gpu:'Any GPU with 8 GB VRAM, or CPU', vram:'8 GB recommended', trainingTime:'2–4 h on RTX 3060', dataset:'DrivAerStar Harvard Dataverse (access request required)', effort:'Medium', impact:'High', reference:'DrivAerStar NeurIPS 2025 — Qiu et al.', tags:['tabular','geometric','gpu-optional'] },
    { name:'Wall Shear Stress Prediction', desc:'Extend AeroNet output from Cp only to include wall shear stress (τx, τy, τz). Enables accurate friction/pressure drag split.', status:'planned', gpu:'Same as GP-UPT', vram:'24 GB', trainingTime:'Additional 4–6 h on top of GP-UPT', dataset:'DrivAerML boundary VTP files', effort:'Medium', impact:'High', tags:['field-prediction','drag-accuracy'] },
    { name:'Image-Based Cd Prediction (ResNeXt)', desc:'Upload a side-view silhouette and get a Cd estimate. Fine-tuned ResNeXt-50. No STL required. R² > 0.84 across car categories.', status:'planned', gpu:'RTX 3060 or better', vram:'8 GB', trainingTime:'2–4 h fine-tuning on DrivAerNet++ renders', dataset:'DrivAerNet++ 8,150 car renders + Cd labels (HuggingFace)', effort:'Medium', impact:'High', reference:'Surrogate Modeling via Depth Renderings — MIT 2024', tags:['vision','no-stl-needed','gpu-required'] },
  ]},
  { category:'3D Viewer', items:[
    { name:'Animated Flow Streamlines', desc:'Particle streamlines over the car surface coloured by velocity magnitude. Three.js instanced mesh, 500+ simultaneous traces.', status:'in-progress', gpu:'None — WebGL only', vram:'2–4 GB browser', trainingTime:'None', dataset:'Existing AeroNet Cp output', effort:'Medium', impact:'Very High', tags:['frontend','webgl','no-training'] },
    { name:'Wind Tunnel Domain Visualisation', desc:'Bounding box wireframe representing the CFD domain. Upstream inlet, downstream outlet, symmetry planes.', status:'in-progress', gpu:'None', vram:'None', trainingTime:'None', dataset:'None', effort:'Low', impact:'High', tags:['frontend','webgl','no-training'] },
    { name:'Wake Region Highlight', desc:'Toggleable overlay on the rear wake zone coloured by Cp. Marks the drag-dominant region.', status:'in-progress', gpu:'None', vram:'None', trainingTime:'None', dataset:'None', effort:'Low', impact:'High', tags:['frontend','webgl'] },
    { name:'Volume Pressure Field (3D Slices)', desc:'Interactable cross-section plane through the air domain. Velocity and pressure in the volume around the car.', status:'planned', gpu:'A100 or H100', vram:'40 GB', trainingTime:'24+ h', dataset:'DrivAerML volume VTU files (25 GB × 484 runs)', effort:'Very High', impact:'Very High', tags:['volume-field','gpu-required','advanced'] },
  ]},
  { category:'Analysis Tools', items:[
    { name:'Design Sensitivity Analysis', desc:'Sweeps all 16 parameters one-by-one, produces a ranked bar chart of Cd sensitivity. Uses GradBoost-DrivAerML. Zero GPU needed.', status:'feasible-now', gpu:'None', vram:'None', trainingTime:'~2 min per full sweep', dataset:'Existing DrivAerML models', effort:'Low', impact:'High', tags:['laptop-feasible','analysis'] },
    { name:'Multi-Fidelity Cd Correction', desc:'Correction model trained on the residual between AeroNet smoke-test predictions and surrogate ground truth.', status:'feasible-now', gpu:'None', vram:'None', trainingTime:'5–10 min', dataset:'Existing prediction history', effort:'Low', impact:'Medium', tags:['laptop-feasible'] },
    { name:'Export to CFD Report (PDF)', desc:'One-click PDF of all analysis: 2D pressure maps, 3D screenshots, Cd table, drag breakdown, comparison table.', status:'planned', gpu:'None', vram:'None', trainingTime:'None', dataset:'None', effort:'Medium', impact:'High', tags:['frontend','no-training'] },
  ]},
]

const STATUS = {
  'in-progress':        { label:'In Progress',        color:'#40CBE0', bg:'rgba(64,203,224,0.1)',  border:'rgba(64,203,224,0.2)' },
  'architecture-ready': { label:'Architecture Ready', color:'#BF5AF2', bg:'rgba(191,90,242,0.1)', border:'rgba(191,90,242,0.2)' },
  'feasible-now':       { label:'CPU Only',            color:'#30D158', bg:'rgba(48,209,88,0.1)',  border:'rgba(48,209,88,0.2)'  },
  'planned':            { label:'Planned',             color:'#FFD60A', bg:'rgba(255,214,10,0.08)', border:'rgba(255,214,10,0.2)' },
}
const IMPACT_COLOR = { 'Very High':'#30D158', 'High':'#0A84FF', 'Medium':'#FFD60A' }
const FILTER_TAGS = [
  { key:null,              label:'All'           },
  { key:'laptop-feasible', label:'CPU Only'      },
  { key:'no-training',     label:'No Training'   },
  { key:'gpu-required',    label:'GPU Required'  },
  { key:'field-prediction',label:'Field Predict' },
  { key:'frontend',        label:'Frontend'      },
]
const STATS = [
  { label:'CPU Only',    value:'5', color:'#30D158' },
  { label:'GPU Required',value:'4', color:'#FF453A' },
  { label:'In Progress', value:'3', color:'#40CBE0' },
  { label:'Planned',     value:'7', color:'#FFD60A' },
]

function FeatureCard({ item }) {
  const [open, setOpen] = useState(false)
  const sc = STATUS[item.status]||STATUS['planned']
  const needsGPU = item.tags?.includes('gpu-required')
  const cpuOnly  = item.tags?.includes('laptop-feasible')||item.tags?.includes('no-training')||item.tags?.includes('webgl')

  return (
    <div style={{
      background:'var(--bg1)', borderRadius:12,
      border: open?'0.5px solid rgba(10,132,255,0.25)':'0.5px solid rgba(255,255,255,0.06)',
      overflow:'hidden',
      transition:'border-color 0.18s, box-shadow 0.18s',
      boxShadow: open?'0 0 0 1px rgba(10,132,255,0.08)':'none',
    }}>
      <div onClick={()=>setOpen(x=>!x)} style={{ padding:'14px 16px', cursor:'pointer', userSelect:'none' }}
        onMouseEnter={e=>!open&&(e.currentTarget.parentElement.style.background='var(--bg2)')}
        onMouseLeave={e=>!open&&(e.currentTarget.parentElement.style.background='var(--bg1)')}>
        <div style={{ display:'flex', alignItems:'flex-start', gap:12 }}>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', marginBottom:6 }}>
              <span style={{ fontSize:14, fontWeight:500, color:'rgba(235,235,245,0.85)', letterSpacing:'-0.2px' }}>{item.name}</span>
              <span style={{ fontSize:11, fontWeight:600, padding:'2px 10px', borderRadius:20, background:sc.bg, color:sc.color, border:`0.5px solid ${sc.border}` }}>{sc.label}</span>
              {cpuOnly&&!needsGPU&&<span style={{ fontSize:11, padding:'2px 8px', borderRadius:20, background:'rgba(48,209,88,0.08)', color:'#30D158', border:'0.5px solid rgba(48,209,88,0.2)' }}>No GPU</span>}
              {needsGPU&&<span style={{ fontSize:11, padding:'2px 8px', borderRadius:20, background:'rgba(255,69,58,0.08)', color:'var(--red)', border:'0.5px solid rgba(255,69,58,0.2)' }}>GPU required</span>}
            </div>
            <p style={{ fontSize:12, color:'rgba(235,235,245,0.38)', lineHeight:1.65, margin:0 }}>{item.desc}</p>
          </div>
          <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:4, flexShrink:0 }}>
            <span style={{ fontSize:12, fontWeight:500, color:IMPACT_COLOR[item.impact]||'rgba(235,235,245,0.5)' }}>{item.impact}</span>
            <span style={{ fontSize:11, color:'rgba(235,235,245,0.25)' }}>{item.effort} effort</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(235,235,245,0.25)" strokeWidth="2"
              style={{ marginTop:4, transform:open?'rotate(180deg)':'none', transition:'transform 0.2s cubic-bezier(0.22,1,0.36,1)' }}>
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </div>
        </div>
      </div>
      {open && (
        <div style={{ borderTop:'0.5px solid var(--sep)', padding:'12px 16px 14px', animation:'fadeUp 0.2s ease both' }}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
            {[['GPU',item.gpu,'var(--red)'],['VRAM',item.vram,'var(--orange)'],['Training Time',item.trainingTime,'var(--blue)'],['Dataset',item.dataset,'rgba(235,235,245,0.6)']].filter(([,v])=>v&&v!=='None').map(([label,value,color])=>(
              <div key={label} style={{ background:'var(--bg2)', borderRadius:9, padding:'9px 12px', border:'0.5px solid rgba(255,255,255,0.05)' }}>
                <div style={{ fontSize:10, fontWeight:600, color:'rgba(235,235,245,0.25)', letterSpacing:'0.06em', textTransform:'uppercase', marginBottom:5 }}>{label}</div>
                <div style={{ fontSize:12, color, lineHeight:1.5 }}>{value}</div>
              </div>
            ))}
          </div>
          {item.reference&&<p style={{ fontSize:11, color:'rgba(235,235,245,0.25)', margin:'10px 0 0', fontStyle:'italic' }}>{item.reference}</p>}
        </div>
      )}
    </div>
  )
}

export default function RoadmapPage() {
  const [filter, setFilter] = useState(null)

  return (
    <div style={{ height:'100%', overflowY:'auto', background:'var(--bg0)' }}>
      <div style={{ maxWidth:860, margin:'0 auto', padding:'28px 20px 52px' }}>

        {/* Header */}
        <div style={{ display:'flex', alignItems:'center', gap:14, marginBottom:24 }}>
          <div style={{ width:40, height:40, borderRadius:12, background:'rgba(255,214,10,0.08)', border:'0.5px solid rgba(255,214,10,0.2)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FFD60A" strokeWidth="1.5">
              <path d="M9 20l-5.5-3V7l5.5 3M9 20l6-3M9 20V10M15 17l5.5-3V4L15 7M15 17V7M9 10l6-3"/>
            </svg>
          </div>
          <div>
            <h1 style={{ fontSize:22, fontWeight:700, color:'rgba(235,235,245,0.9)', margin:0, letterSpacing:'-0.5px' }}>Roadmap</h1>
            <p style={{ fontSize:12, color:'rgba(235,235,245,0.3)', margin:'2px 0 0' }}>Upcoming features, GPU requirements, and compute estimates</p>
          </div>
        </div>

        {/* Stat cards */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10, marginBottom:24 }}>
          {STATS.map(s=>(
            <div key={s.label} style={{ background:'var(--bg1)', borderRadius:12, border:'0.5px solid rgba(255,255,255,0.06)', padding:'14px 16px', transition:'border-color 0.15s', cursor:'default' }}
              onMouseEnter={e=>e.currentTarget.style.borderColor=s.color+'44'}
              onMouseLeave={e=>e.currentTarget.style.borderColor='rgba(255,255,255,0.06)'}>
              <div style={{ fontSize:36, fontWeight:300, color:s.color, fontFamily:"'IBM Plex Mono',monospace", lineHeight:1, fontVariantNumeric:'tabular-nums' }}>{s.value}</div>
              <div style={{ fontSize:12, color:'rgba(235,235,245,0.3)', marginTop:6 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Filter chips */}
        <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:20 }}>
          {FILTER_TAGS.map(t=>{
            const active=filter===t.key
            return (
              <button key={String(t.key)} onClick={()=>setFilter(t.key)} style={{
                padding:'5px 16px', borderRadius:20,
                border:`0.5px solid ${active?'rgba(10,132,255,0.45)':'rgba(255,255,255,0.08)'}`,
                background: active?'rgba(10,132,255,0.14)':'transparent',
                color: active?'var(--blue)':'rgba(235,235,245,0.4)',
                fontSize:12, fontWeight:500, cursor:'pointer', transition:'all 0.14s',
                fontFamily:"'IBM Plex Sans',sans-serif",
              }}>{t.label}</button>
            )
          })}
        </div>

        {/* GPU notice */}
        <div style={{ background:'rgba(255,69,58,0.05)', border:'0.5px solid rgba(255,69,58,0.18)', borderRadius:12, padding:'12px 16px', marginBottom:28, display:'flex', gap:12, alignItems:'flex-start' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="1.5" style={{ flexShrink:0, marginTop:1 }}>
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <div>
            <p style={{ fontSize:13, fontWeight:500, color:'var(--red)', margin:'0 0 3px' }}>GPU Requirement Notice</p>
            <p style={{ fontSize:12, color:'rgba(235,235,245,0.35)', margin:0, lineHeight:1.6 }}>
              GPU Required features need a dedicated NVIDIA GPU with ≥24 GB VRAM for training — RTX 4090, A100, or a cloud instance. Inference after training runs on any machine. Features tagged No GPU need no additional compute.
            </p>
          </div>
        </div>

        {/* Sections */}
        {FEATURES.map(section=>{
          const items=filter?section.items.filter(i=>i.tags?.includes(filter)):section.items
          if(!items.length) return null
          return (
            <div key={section.category} style={{ marginBottom:32 }}>
              <div style={{ display:'flex', alignItems:'center', gap:14, marginBottom:12 }}>
                <div style={{ flex:1, height:0.5, background:'rgba(255,255,255,0.06)' }}/>
                <span style={{ fontSize:11, fontWeight:600, letterSpacing:'0.1em', textTransform:'uppercase', color:'rgba(235,235,245,0.3)' }}>{section.category}</span>
                <div style={{ flex:1, height:0.5, background:'rgba(255,255,255,0.06)' }}/>
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                {items.map(item=><FeatureCard key={item.name} item={item}/>)}
              </div>
            </div>
          )
        })}

        {/* Footer */}
        <div style={{ padding:'14px 18px', background:'var(--bg1)', borderRadius:12, border:'0.5px solid rgba(255,255,255,0.05)', marginTop:16 }}>
          <p style={{ fontSize:11, color:'rgba(235,235,245,0.2)', margin:0, lineHeight:1.7 }}>
            DrivAerML is licensed CC-BY-SA. DrivAerStar is CC-BY-NC-SA — commercial use of trained models requires written permission. AeroNet source and trained weights are proprietary. © 2026 Rutej Talati.
          </p>
        </div>
      </div>
      <style>{`@keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}`}</style>
    </div>
  )
}
