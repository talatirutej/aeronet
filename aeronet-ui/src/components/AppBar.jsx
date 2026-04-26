// Copyright (c) 2026 Rutej Talati. All rights reserved.
import { useState, useEffect } from 'react'

const MODEL_REGISTRY = {
  'GradBoost-DrivAerML':    { shortLabel: 'GB · DrivAerML',    badge: 'R² 0.95', badgeColor: '#4ade80', status: 'ready',   page: '2d', description: 'Gradient Boosting · 484 real CFD cases · CV R²=0.9525' },
  'RandomForest-DrivAerML': { shortLabel: 'RF · DrivAerML',    badge: 'R² 0.81', badgeColor: '#4dd8e8', status: 'ready',   page: '2d', description: 'Random Forest · 484 real CFD cases · CV R²=0.8149'   },
  'ResNet-Tabular-12K':     { shortLabel: 'ResNet · 12K',      badge: 'Pending', badgeColor: '#fbbf24', status: 'pending', page: '2d', description: 'Residual MLP · Requires DrivAerStar 12K dataset'        },
  'AeroNet-PointNet':       { shortLabel: 'PointNet++ · 3D',   badge: 'Smoke',   badgeColor: '#fbbf24', status: 'smoke',   page: '3d', description: 'PointNet++ · Physics-Attention · Smoke-test checkpoint' },
}

const NAV = [
  { key: '3d',       label: '3D Predictor',   icon: <CubeIcon /> },
  { key: '2d',       label: '2D Analysis',    icon: <GridIcon /> },
  { key: 'optimise', label: 'Optimise',       icon: <OptIcon />  },
  { key: 'compare',  label: 'Compare',        icon: <SplitIcon />},
  { key: 'roadmap',  label: 'Roadmap',        icon: <MapIcon />  },
]

export default function AppBar({ backendStatus, onRefreshBackend, activePage, onPageChange, activeModel, onModelChange }) {
  const [showModelMenu, setShowModelMenu] = useState(false)

  const isOnline = backendStatus?.online
  const hasModel = backendStatus?.model?.loaded
  const dotColor = isOnline && hasModel ? '#4ade80' : isOnline ? '#fbbf24' : '#f87171'
  const statusLabel = backendStatus === null ? '...' : isOnline && hasModel ? 'Live' : isOnline ? 'No Model' : 'Offline'

  const currentModel = activeModel || 'AeroNet-PointNet'
  const modelInfo = MODEL_REGISTRY[currentModel] || MODEL_REGISTRY['AeroNet-PointNet']

  useEffect(() => {
    if (!showModelMenu) return
    const close = () => setShowModelMenu(false)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [showModelMenu])

  return (
    <header style={{ height: 54, display: 'flex', alignItems: 'center', padding: '0 14px',
      gap: 0, flexShrink: 0, position: 'relative', zIndex: 50,
      background: 'linear-gradient(180deg,#1a2428 0%,#141c1f 100%)',
      borderBottom: '1px solid #1e2b30' }}>

      {/* Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginRight: 18, flexShrink: 0 }}>
        <div style={{ width: 32, height: 32, borderRadius: 9, position: 'relative',
          background: 'linear-gradient(135deg,#004f5e,#003040)', border: '1px solid rgba(77,216,232,0.3)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 2px 10px rgba(77,216,232,0.15)' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
            <path d="M3 12C3 12 7 5 12 5C17 5 21 12 21 12C21 12 17 19 12 19C7 19 3 12 3 12Z" stroke="#4dd8e8" strokeWidth="1.5"/>
            <circle cx="12" cy="12" r="3" fill="#4dd8e8" opacity="0.9"/>
          </svg>
          <span style={{ position:'absolute', inset:0, borderRadius:9, border:'1px solid rgba(77,216,232,0.2)', animation:'pulse 3s ease-in-out infinite', opacity:0.4 }} />
        </div>
        <div>
          <div style={{ fontSize:14, fontWeight:700, color:'#fff', letterSpacing:'-0.02em', lineHeight:1 }}>AeroNet</div>
          <div style={{ fontSize:9, color:'#938f99', letterSpacing:'0.03em' }}>CFD Surrogate</div>
        </div>
      </div>

      {/* Nav */}
      <div style={{ display:'flex', alignItems:'center', gap:1, background:'#050505',
        borderRadius:9, padding:'3px', border:'1px solid #1e2b30', marginRight:12 }}>
        {NAV.map(n => {
          const isRoadmap = n.key === 'roadmap'
          return (
            <button key={n.key} onClick={() => onPageChange(n.key)}
              style={{ display:'flex', alignItems:'center', gap:5, padding:'5px 11px',
                borderRadius:7, border:'none', fontSize:11, fontWeight:500, cursor:'pointer',
                background: activePage === n.key ? '#001f24' : 'transparent',
                color: activePage === n.key ? '#4dd8e8'
                  : isRoadmap ? '#fbbf24' : '#938f99',
                outline: activePage === n.key ? '1px solid #2a5060' : 'none',
                transition:'all 150ms', position:'relative' }}>
              {n.icon}
              {n.label}
              {isRoadmap && (
                <span style={{ fontSize:8, background:'rgba(251,191,36,0.15)',
                  color:'#fbbf24', border:'1px solid rgba(251,191,36,0.3)',
                  borderRadius:3, padding:'0 4px', fontFamily:'Roboto Mono',
                  letterSpacing:'0.04em' }}>NEW</span>
              )}
            </button>
          )
        })}
      </div>

      {/* Model selector */}
      <div style={{ position:'relative' }} onClick={e => e.stopPropagation()}>
        <button onClick={() => setShowModelMenu(m => !m)}
          style={{ display:'flex', alignItems:'center', gap:7, padding:'4px 10px',
            borderRadius:7, background: showModelMenu ? '#001f24' : '#0d0d0d',
            border:`1px solid ${showModelMenu ? '#006874' : '#1c1c1c'}`,
            cursor:'pointer', transition:'all 150ms' }}>
          <span style={{ width:6, height:6, borderRadius:'50%', flexShrink:0,
            background: modelInfo.status === 'ready' ? '#4ade80' : '#fbbf24' }} />
          <div style={{ textAlign:'left' }}>
            <div style={{ fontSize:10, fontWeight:600, color:'#e6e1e5',
              fontFamily:'Roboto Mono', lineHeight:1 }}>{modelInfo.shortLabel}</div>
            <div style={{ fontSize:8, color:'#938f99', marginTop:1 }}>Active model</div>
          </div>
          <span style={{ fontSize:9, fontWeight:600, padding:'1px 5px', borderRadius:3,
            background:`${modelInfo.badgeColor}18`, color:modelInfo.badgeColor,
            border:`1px solid ${modelInfo.badgeColor}33`, fontFamily:'Roboto Mono' }}>
            {modelInfo.badge}
          </span>
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#938f99" strokeWidth="2"
            style={{ transform: showModelMenu ? 'rotate(180deg)' : 'none', transition:'transform 150ms' }}>
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>

        {showModelMenu && (
          <div style={{ position:'absolute', top:'calc(100% + 6px)', left:0, width:320,
            background:'#0d0d0d', borderRadius:11, border:'1px solid #1e2b30',
            boxShadow:'0 8px 32px rgba(0,0,0,0.5)', overflow:'hidden', zIndex:100 }}>
            <div style={{ padding:'8px 12px', borderBottom:'1px solid #1a2830',
              fontSize:9, fontWeight:500, letterSpacing:'0.08em', textTransform:'uppercase', color:'#938f99' }}>
              Select Model
            </div>
            {/* 3D group */}
            <ModelGroup title="3D Field Prediction" subtitle="Requires STL upload">
              <ModelRow key="AeroNet-PointNet" modelKey="AeroNet-PointNet"
                info={MODEL_REGISTRY['AeroNet-PointNet']}
                active={currentModel === 'AeroNet-PointNet'}
                onClick={() => { onModelChange('AeroNet-PointNet'); setShowModelMenu(false) }} />
            </ModelGroup>
            {/* 2D group */}
            <ModelGroup title="2D Parametric Surrogate" subtitle="Geometric sliders + STL outline">
              {['GradBoost-DrivAerML','RandomForest-DrivAerML','ResNet-Tabular-12K'].map(k => (
                <ModelRow key={k} modelKey={k} info={MODEL_REGISTRY[k]}
                  active={currentModel === k}
                  onClick={() => { if (MODEL_REGISTRY[k].status !== 'pending') { onModelChange(k); setShowModelMenu(false) }}} />
              ))}
            </ModelGroup>
            <div style={{ padding:'6px 12px', borderTop:'1px solid #1a2830',
              fontSize:9, color:'#49454f', lineHeight:1.5 }}>
              ResNet-Tabular-12K requires DrivAerStar dataset. See Roadmap page.
            </div>
          </div>
        )}
      </div>

      <div style={{ flex:1 }} />

      {/* Right chips */}
      <div style={{ display:'flex', alignItems:'center', gap:7 }}>
        {activePage === '2d' && (
          <div style={{ fontSize:10, color:'#4dd8e8', fontFamily:'Roboto Mono',
            padding:'3px 9px', borderRadius:9999, background:'rgba(77,216,232,0.06)',
            border:'1px solid rgba(77,216,232,0.2)' }}>
            DrivAerML · 484 CFD cases
          </div>
        )}
        <button onClick={onRefreshBackend}
          style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'4px 10px',
            borderRadius:9999, background:'#1c1c1c', border:'1px solid #243339',
            fontSize:10, fontWeight:500, color:'#938f99', cursor:'pointer', transition:'all 150ms' }}
          onMouseOver={e=>{ e.currentTarget.style.borderColor='#4dd8e8'; e.currentTarget.style.color='#4dd8e8' }}
          onMouseOut={e=>{ e.currentTarget.style.borderColor='#222'; e.currentTarget.style.color='#938f99' }}>
          <span style={{ width:5, height:5, borderRadius:'50%', background:dotColor,
            animation: isOnline ? 'pulse 2s infinite' : 'none' }} />
          {statusLabel}
        </button>
        <div style={{ fontSize:10, fontWeight:600, padding:'3px 9px', borderRadius:9999,
          background: modelInfo.status==='ready' ? 'rgba(74,222,128,0.08)' : 'rgba(251,191,36,0.1)',
          border: modelInfo.status==='ready' ? '1px solid rgba(74,222,128,0.25)' : '1px solid rgba(251,191,36,0.25)',
          color: modelInfo.status==='ready' ? '#4ade80' : '#fbbf24',
          fontFamily:'Roboto Mono' }}>
          {modelInfo.shortLabel}
        </div>
      </div>
    </header>
  )
}

function ModelGroup({ title, subtitle, children }) {
  return (
    <div style={{ padding:'6px 0' }}>
      <div style={{ padding:'3px 12px 5px', display:'flex', alignItems:'baseline', gap:7 }}>
        <span style={{ fontSize:9, fontWeight:600, color:'#5a7f8a', textTransform:'uppercase', letterSpacing:'0.07em' }}>{title}</span>
        <span style={{ fontSize:9, color:'#49454f' }}>{subtitle}</span>
      </div>
      {children}
    </div>
  )
}

function ModelRow({ modelKey, info, active, onClick }) {
  const [hov, setHov] = useState(false)
  const pending = info.status === 'pending'
  return (
    <button onClick={pending ? undefined : onClick}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ width:'100%', display:'flex', alignItems:'flex-start', gap:8,
        padding:'7px 12px', border:'none', textAlign:'left',
        background: active ? 'rgba(77,216,232,0.08)' : hov && !pending ? '#1a1a1a' : 'transparent',
        cursor: pending ? 'not-allowed' : 'pointer', transition:'all 120ms', opacity: pending ? 0.5 : 1 }}>
      <div style={{ width:7, height:7, borderRadius:'50%', flexShrink:0, marginTop:2,
        background: info.status==='ready' ? '#4ade80' : info.status==='smoke' ? '#fbbf24' : '#49454f' }} />
      <div style={{ flex:1 }}>
        <div style={{ display:'flex', alignItems:'center', gap:5, marginBottom:1 }}>
          <span style={{ fontSize:11, fontWeight:600, color: active ? '#4dd8e8' : '#e6e1e5',
            fontFamily:'Roboto Mono' }}>{info.shortLabel}</span>
          <span style={{ fontSize:8, padding:'1px 4px', borderRadius:3,
            background:`${info.badgeColor}18`, color:info.badgeColor,
            border:`1px solid ${info.badgeColor}33`, fontFamily:'Roboto Mono' }}>
            {info.badge}
          </span>
          {active && <span style={{ fontSize:9, color:'#4dd8e8', marginLeft:'auto' }}>Active</span>}
        </div>
        <div style={{ fontSize:9, color:'#938f99', lineHeight:1.4 }}>{info.description}</div>
      </div>
    </button>
  )
}

function CubeIcon() { return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg> }
function GridIcon() { return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg> }
function OptIcon()  { return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 20V10M18 20V4M6 20v-4"/></svg> }
function SplitIcon(){ return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="8" height="18" rx="1"/><rect x="13" y="3" width="8" height="18" rx="1"/></svg> }
function MapIcon()  { return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M9 20l-5.5-3V7l5.5 3M9 20l6-3M9 20V10M15 17l5.5-3V4L15 7M15 17V7M9 10l6-3"/></svg> }
