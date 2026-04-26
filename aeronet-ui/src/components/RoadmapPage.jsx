// Copyright (c) 2026 Rutej Talati. All rights reserved.

import { useState } from 'react'

const FEATURES = [
  {
    category: 'Models',
    items: [
      {
        name: 'GP-UPT — Geometry-Preserving Universal Physics Transformer',
        desc: 'State-of-the-art model for DrivAerML. Takes raw STL, predicts full surface pressure and wall shear stress. R² > 0.95 on DrivAerML 484-case test set.',
        status: 'planned',
        gpu: 'NVIDIA A100 40GB or RTX 4090 24GB',
        vram: '24 GB minimum',
        trainingTime: '8–12 h on A100 · 24–36 h on RTX 4090',
        dataset: 'DrivAerML 436 training cases + boundary VTP files (500 GB)',
        effort: 'High',
        impact: 'Very High',
        reference: 'NeuralCFD 2025 — Bleeker et al.',
        tags: ['field-prediction', 'deep-learning', 'gpu-required'],
      },
      {
        name: 'ResNet-Tabular-12K — DrivAerStar',
        desc: 'Residual MLP trained on DrivAerStar 12,000 cases (20 CAD parameters). Architecture already implemented. Needs DrivAerStar dataset from Harvard Dataverse.',
        status: 'architecture-ready',
        gpu: 'Any GPU with 8 GB VRAM, or CPU',
        vram: '8 GB recommended',
        trainingTime: '2–4 h on RTX 3060',
        dataset: 'DrivAerStar Harvard Dataverse (access request required)',
        effort: 'Medium',
        impact: 'High',
        reference: 'DrivAerStar NeurIPS 2025 — Qiu et al.',
        tags: ['tabular', 'geometric', 'gpu-optional'],
      },
      {
        name: 'Wall Shear Stress Prediction',
        desc: 'Extend AeroNet output from Cp only to include wall shear stress (τx, τy, τz). Enables accurate friction/pressure drag split. Requires retraining with DrivAerML boundary VTP labels.',
        status: 'planned',
        gpu: 'Same as GP-UPT',
        vram: '24 GB',
        trainingTime: 'Additional 4–6 h on top of GP-UPT',
        dataset: 'DrivAerML boundary VTP files',
        effort: 'Medium',
        impact: 'High',
        tags: ['field-prediction', 'drag-accuracy'],
      },
      {
        name: 'Image-Based Cd Prediction (ResNeXt)',
        desc: 'Upload a side-view silhouette or depth render and get a Cd estimate. Fine-tuned ResNeXt-50. No STL required. Based on MIT research achieving R² > 0.84 across car categories.',
        status: 'planned',
        gpu: 'RTX 3060 or better',
        vram: '8 GB',
        trainingTime: '2–4 h fine-tuning on DrivAerNet++ renders',
        dataset: 'DrivAerNet++ 8,150 car renders + Cd labels (HuggingFace)',
        effort: 'Medium',
        impact: 'High',
        reference: 'Surrogate Modeling via Depth Renderings — MIT 2024',
        tags: ['vision', 'no-stl-needed', 'gpu-required'],
      },
    ],
  },
  {
    category: '3D Viewer',
    items: [
      {
        name: 'Animated Flow Streamlines',
        desc: 'Particle streamlines over the car surface coloured by velocity magnitude. Three.js instanced mesh, 500+ simultaneous traces. Driven by surface pressure gradient.',
        status: 'in-progress',
        gpu: 'None — WebGL only',
        vram: '2–4 GB browser allocation',
        trainingTime: 'None',
        dataset: 'Existing AeroNet Cp output',
        effort: 'Medium',
        impact: 'Very High',
        tags: ['frontend', 'webgl', 'no-training'],
      },
      {
        name: 'Wind Tunnel Domain Visualisation',
        desc: 'Bounding box wireframe representing the CFD domain. Upstream inlet, downstream outlet, symmetry planes — matching ANSYS and STAR-CCM+ defaults.',
        status: 'in-progress',
        gpu: 'None',
        vram: 'None',
        trainingTime: 'None',
        dataset: 'None',
        effort: 'Low',
        impact: 'High',
        tags: ['frontend', 'webgl', 'no-training'],
      },
      {
        name: 'Wake Region Highlight',
        desc: 'Toggleable overlay on the rear wake zone coloured by Cp. Marks the drag-dominant region. One button, uses existing prediction data.',
        status: 'in-progress',
        gpu: 'None',
        vram: 'None',
        trainingTime: 'None',
        dataset: 'None',
        effort: 'Low',
        impact: 'High',
        tags: ['frontend', 'webgl'],
      },
      {
        name: 'Volume Pressure Field (3D Slices)',
        desc: 'Interactable cross-section plane through the air domain. Velocity and pressure in the volume around the car, not just on the surface. Requires GP-UPT volume mode.',
        status: 'planned',
        gpu: 'A100 or H100',
        vram: '40 GB',
        trainingTime: '24+ h',
        dataset: 'DrivAerML volume VTU files (25 GB × 484 runs)',
        effort: 'Very High',
        impact: 'Very High',
        tags: ['volume-field', 'gpu-required', 'advanced'],
      },
    ],
  },
  {
    category: 'Analysis Tools',
    items: [
      {
        name: 'Design Sensitivity Analysis',
        desc: 'Sweeps all 16 parameters one-by-one, produces a ranked bar chart of Cd sensitivity. Uses GradBoost-DrivAerML. Zero GPU needed.',
        status: 'feasible-now',
        gpu: 'None',
        vram: 'None',
        trainingTime: '~2 min per full sweep',
        dataset: 'Existing DrivAerML models',
        effort: 'Low',
        impact: 'High',
        tags: ['laptop-feasible', 'analysis'],
      },
      {
        name: 'Multi-Fidelity Cd Correction',
        desc: 'Correction model trained on the residual between AeroNet smoke-test predictions and surrogate ground truth. Improves Cd accuracy without retraining PointNet++.',
        status: 'feasible-now',
        gpu: 'None',
        vram: 'None',
        trainingTime: '5–10 min',
        dataset: 'Existing prediction history',
        effort: 'Low',
        impact: 'Medium',
        tags: ['laptop-feasible'],
      },
      {
        name: 'Export to CFD Report (PDF)',
        desc: 'One-click PDF of all analysis: 2D pressure maps, 3D screenshots, Cd table, drag breakdown, comparison table. AeroNet branded engineering report.',
        status: 'planned',
        gpu: 'None',
        vram: 'None',
        trainingTime: 'None',
        dataset: 'None',
        effort: 'Medium',
        impact: 'High',
        tags: ['frontend', 'no-training'],
      },
    ],
  },
]

const STATUS = {
  'in-progress':        { label: 'In Progress',        color: '#4dd8e8', bg: 'rgba(77,216,232,0.08)',  border: 'rgba(77,216,232,0.2)'  },
  'architecture-ready': { label: 'Architecture Ready', color: '#a78bfa', bg: 'rgba(167,139,250,0.08)', border: 'rgba(167,139,250,0.2)' },
  'feasible-now':       { label: 'CPU Only',           color: '#4ade80', bg: 'rgba(74,222,128,0.08)',  border: 'rgba(74,222,128,0.2)'  },
  'planned':            { label: 'Planned',             color: '#fbbf24', bg: 'rgba(251,191,36,0.08)',  border: 'rgba(251,191,36,0.2)'  },
}

const IMPACT_COLOR = {
  'Very High': '#4ade80', 'High': '#84cc16',
  'Medium': '#fbbf24', 'High utility': '#a78bfa',
}

const TAGS = [
  { key: null,               label: 'All' },
  { key: 'laptop-feasible',  label: 'CPU Only' },
  { key: 'no-training',      label: 'No Training' },
  { key: 'gpu-required',     label: 'GPU Required' },
  { key: 'field-prediction', label: 'Field Prediction' },
  { key: 'frontend',         label: 'Frontend' },
]

const STATS = [
  { label: 'CPU Only',    value: '5', color: '#4ade80' },
  { label: 'GPU Required', value: '4', color: '#f87171' },
  { label: 'In Progress',  value: '3', color: '#4dd8e8' },
  { label: 'Planned',      value: '7', color: '#fbbf24' },
]

function FeatureCard({ item }) {
  const [open, setOpen] = useState(false)
  const sc = STATUS[item.status] || STATUS['planned']
  const needsGPU = item.tags?.includes('gpu-required')
  const cpuOnly  = item.tags?.includes('laptop-feasible') || item.tags?.includes('no-training') || item.tags?.includes('webgl')

  return (
    <div style={{
      background: '#0a0a0a', borderRadius: 12,
      border: `1px solid ${open ? '#2b2930' : '#1c1c1c'}`,
      overflow: 'hidden', transition: 'border-color 160ms',
    }}>
      <div
        onClick={() => setOpen(x => !x)}
        style={{ padding: '14px 16px', cursor: 'pointer', userSelect: 'none' }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
              <span style={{ fontSize: 14, fontWeight: 500, color: '#e6e1e5', letterSpacing: 0 }}>
                {item.name}
              </span>
              <span style={{
                fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 100,
                background: sc.bg, color: sc.color, border: `1px solid ${sc.border}`,
                letterSpacing: '0.1px',
              }}>
                {sc.label}
              </span>
              {cpuOnly && !needsGPU && (
                <span style={{
                  fontSize: 11, padding: '2px 8px', borderRadius: 100, letterSpacing: '0.1px',
                  background: 'rgba(74,222,128,0.06)', color: '#4ade80',
                  border: '1px solid rgba(74,222,128,0.15)',
                }}>
                  No GPU
                </span>
              )}
              {needsGPU && (
                <span style={{
                  fontSize: 11, padding: '2px 8px', borderRadius: 100, letterSpacing: '0.1px',
                  background: 'rgba(248,113,113,0.06)', color: '#f87171',
                  border: '1px solid rgba(248,113,113,0.15)',
                }}>
                  GPU required
                </span>
              )}
            </div>
            <p style={{ fontSize: 13, color: '#938f99', lineHeight: '20px', margin: 0 }}>
              {item.desc}
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0, paddingTop: 2 }}>
            <span style={{ fontSize: 12, fontWeight: 500, color: IMPACT_COLOR[item.impact] || '#e6e1e5' }}>
              {item.impact}
            </span>
            <span style={{ fontSize: 12, color: '#49454f' }}>{item.effort} effort</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#49454f" strokeWidth="2"
              style={{ marginTop: 4, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }}>
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </div>
        </div>
      </div>

      {open && (
        <div style={{
          borderTop: '1px solid #1c1c1c', padding: '12px 16px 14px',
          animation: 'fadeIn 180ms ease-out',
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {[
              ['GPU', item.gpu, '#f87171'],
              ['VRAM', item.vram, '#fbbf24'],
              ['Training Time', item.trainingTime, '#4dd8e8'],
              ['Dataset', item.dataset, '#cac4d0'],
            ].filter(([, v]) => v && v !== 'None').map(([label, value, color]) => (
              <div key={label} style={{
                background: '#111', borderRadius: 8,
                padding: '8px 12px', border: '1px solid #1c1c1c',
              }}>
                <div style={{
                  fontSize: 11, color: '#49454f', letterSpacing: '0.5px',
                  textTransform: 'uppercase', marginBottom: 4,
                }}>
                  {label}
                </div>
                <div style={{ fontSize: 13, color, lineHeight: '18px' }}>{value}</div>
              </div>
            ))}
          </div>
          {item.reference && (
            <p style={{ fontSize: 12, color: '#49454f', margin: '10px 0 0', fontStyle: 'italic' }}>
              {item.reference}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export default function RoadmapPage() {
  const [filter, setFilter] = useState(null)

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: '#000' }}>
      <div style={{ maxWidth: 860, margin: '0 auto', padding: '28px 24px 48px' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 12,
            background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="1.5">
              <path d="M9 20l-5.5-3V7l5.5 3M9 20l6-3M9 20V10M15 17l5.5-3V4L15 7M15 17V7M9 10l6-3"/>
            </svg>
          </div>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 400, color: '#e6e1e5', margin: 0, letterSpacing: 0 }}>
              Roadmap
            </h1>
            <p style={{ fontSize: 13, color: '#49454f', margin: '2px 0 0', lineHeight: '20px' }}>
              Upcoming features, GPU requirements, and compute estimates
            </p>
          </div>
        </div>

        {/* Stat cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginBottom: 24 }}>
          {STATS.map(s => (
            <div key={s.label} style={{
              background: '#0a0a0a', borderRadius: 12,
              border: '1px solid #1c1c1c', padding: '14px 16px',
            }}>
              <div style={{
                fontSize: 32, fontWeight: 300, color: s.color,
                fontFamily: "'Roboto Mono', monospace", lineHeight: 1,
                fontVariantNumeric: 'tabular-nums',
              }}>
                {s.value}
              </div>
              <div style={{ fontSize: 12, color: '#49454f', marginTop: 6, letterSpacing: '0.5px' }}>
                {s.label}
              </div>
            </div>
          ))}
        </div>

        {/* Filter chips */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 20 }}>
          {TAGS.map(t => {
            const active = filter === t.key
            return (
              <button key={String(t.key)} onClick={() => setFilter(t.key)}
                style={{
                  padding: '6px 16px', borderRadius: 100,
                  border: `1px solid ${active ? '#4dd8e8' : '#2b2930'}`,
                  background: active ? 'rgba(77,216,232,0.08)' : 'transparent',
                  color: active ? '#4dd8e8' : '#938f99',
                  fontSize: 13, fontWeight: 500, letterSpacing: '0.1px',
                  cursor: 'pointer', transition: 'all 140ms', fontFamily: 'inherit',
                }}>
                {t.label}
              </button>
            )
          })}
        </div>

        {/* GPU notice */}
        <div style={{
          background: 'rgba(248,113,113,0.05)', border: '1px solid rgba(248,113,113,0.15)',
          borderRadius: 12, padding: '12px 16px', marginBottom: 28,
          display: 'flex', gap: 12, alignItems: 'flex-start',
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="1.5"
            style={{ flexShrink: 0, marginTop: 1 }}>
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <div>
            <p style={{ fontSize: 13, fontWeight: 500, color: '#f87171', margin: '0 0 4px' }}>
              GPU Requirement Notice
            </p>
            <p style={{ fontSize: 13, color: '#49454f', margin: 0, lineHeight: '20px' }}>
              GPU Required features need a dedicated NVIDIA GPU with ≥24 GB VRAM for training —
              RTX 4090, A100, or a cloud instance. Inference after training runs on any machine.
              Features tagged No GPU need no additional compute.
            </p>
          </div>
        </div>

        {/* Sections */}
        {FEATURES.map(section => {
          const items = filter
            ? section.items.filter(i => i.tags?.includes(filter))
            : section.items
          if (!items.length) return null
          return (
            <div key={section.category} style={{ marginBottom: 32 }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12,
              }}>
                <div style={{ flex: 1, height: 1, background: '#1c1c1c' }} />
                <span style={{
                  fontSize: 11, fontWeight: 500, letterSpacing: '1.5px',
                  textTransform: 'uppercase', color: '#49454f',
                }}>
                  {section.category}
                </span>
                <div style={{ flex: 1, height: 1, background: '#1c1c1c' }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {items.map(item => <FeatureCard key={item.name} item={item} />)}
              </div>
            </div>
          )
        })}

        {/* Footer */}
        <div style={{
          marginTop: 16, padding: '16px 20px', background: '#0a0a0a',
          borderRadius: 12, border: '1px solid #1c1c1c',
        }}>
          <p style={{ fontSize: 12, color: '#49454f', margin: 0, lineHeight: '20px' }}>
            DrivAerML is licensed CC-BY-SA. DrivAerStar is CC-BY-NC-SA — commercial use of trained
            models requires written permission. AeroNet source and trained weights are proprietary.
            © 2026 Rutej Talati.
          </p>
        </div>
      </div>
    </div>
  )
}
