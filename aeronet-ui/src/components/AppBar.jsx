// Copyright (c) 2026 Rutej Talati. All rights reserved.
// AppBar → collapsed left sidebar with full/icon modes

import { useState } from 'react'

const SURROGATE_MODELS = [
  { id: 'GradBoost-DrivAerML',    label: 'GradBoost',    sub: 'R²=0.953' },
  { id: 'RandomForest-DrivAerML', label: 'RandomForest', sub: 'R²=0.815' },
  { id: 'ResNet-Tabular-12K',     label: 'ResNet',       sub: 'Pending'  },
]

// Icons as tiny inline SVGs — avoids any icon library dep
const Icon = ({ name }) => {
  const icons = {
    menu:        <><rect x="3" y="5"  width="18" height="1.5" rx="0.75" fill="currentColor"/><rect x="3" y="11" width="18" height="1.5" rx="0.75" fill="currentColor"/><rect x="3" y="17" width="18" height="1.5" rx="0.75" fill="currentColor"/></>,
    collapse:    <><path d="M15 6L9 12L15 18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/></>,
    cfd:         <><circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="1.2" fill="none"/><path d="M5 12h14M12 5v14" stroke="currentColor" strokeWidth="1" opacity="0.5"/><circle cx="12" cy="12" r="2" fill="currentColor" opacity="0.6"/></>,
    image:       <><rect x="4" y="4" width="16" height="16" rx="3" stroke="currentColor" strokeWidth="1.2" fill="none"/><circle cx="9" cy="9" r="1.5" fill="currentColor" opacity="0.6"/><path d="M4 16l4-4 3 3 3-4 5 5" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinejoin="round"/></>,
    sweep:       <><path d="M4 20L10 8l4 6 3-4 3 10" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" fill="none"/></>,
    sensitivity: <><path d="M12 4v16M4 12h16" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/><path d="M7 7l10 10M17 7L7 17" stroke="currentColor" strokeWidth="1" opacity="0.4" strokeLinecap="round"/></>,
    report:      <><rect x="5" y="3" width="14" height="18" rx="2" stroke="currentColor" strokeWidth="1.2" fill="none"/><path d="M9 8h6M9 12h6M9 16h4" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.6"/></>,
    roadmap:     <><path d="M4 6h16M4 12h12M4 18h8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/><circle cx="19" cy="12" r="2" fill="currentColor" opacity="0.5"/><circle cx="15" cy="18" r="2" fill="currentColor" opacity="0.5"/></>,
  }
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
      {icons[name]}
    </svg>
  )
}

const TABS = [
  { id: 'cfd',         label: 'CFD Predictor',   icon: 'cfd',         group: 'Simulation' },
  { id: 'image',       label: 'Image Predictor',  icon: 'image',       group: 'Simulation' },
  { id: 'sweep',       label: 'Param Sweep',      icon: 'sweep',       group: 'Analysis'   },
  { id: 'sensitivity', label: 'Sensitivity',      icon: 'sensitivity', group: 'Analysis'   },
  { id: 'report',      label: 'Report',           icon: 'report',      group: 'Export'     },
  { id: 'roadmap',     label: 'Roadmap',          icon: 'roadmap',     group: 'Export'     },
]

const GROUPS = ['Simulation', 'Analysis', 'Export']

export default function AppBar({ backendStatus, activePage, activeTab, onTabChange, activeModel, onModelChange }) {
  const [collapsed, setCollapsed] = useState(false)
  const isOnline = backendStatus?.online
  const W = collapsed ? 56 : 220

  const statusColor = isOnline === null ? 'var(--text-tertiary)' : isOnline ? 'var(--green)' : 'var(--orange)'
  const statusLabel = isOnline === null ? 'Checking' : isOnline ? 'Online' : 'Mock mode'

  return (
    <aside style={{
      width: W,
      minWidth: W,
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: 'rgba(0,0,0,0.88)',
      backdropFilter: 'blur(24px) saturate(180%)',
      WebkitBackdropFilter: 'blur(24px) saturate(180%)',
      borderRight: '0.5px solid var(--sep)',
      transition: 'width 0.22s cubic-bezier(0.22,1,0.36,1), min-width 0.22s cubic-bezier(0.22,1,0.36,1)',
      overflow: 'hidden',
      zIndex: 100,
      flexShrink: 0,
      position: 'relative',
    }}>

      {/* ── Logo + collapse toggle ── */}
      <div style={{
        height: 52,
        display: 'flex',
        alignItems: 'center',
        padding: collapsed ? '0 14px' : '0 12px 0 14px',
        borderBottom: '0.5px solid var(--sep)',
        gap: 10,
        flexShrink: 0,
        justifyContent: collapsed ? 'center' : 'space-between',
      }}>
        {/* Logo mark */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, overflow: 'hidden', minWidth: 0 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 8, flexShrink: 0,
            background: 'rgba(10,132,255,0.15)',
            border: '0.5px solid rgba(10,132,255,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M2 8C2 5.5 4 3 8 3s6 2.5 6 5-2 5-6 5-6-2.5-6-5z" stroke="var(--blue)" strokeWidth="1.2" fill="none"/>
              <path d="M1 8h14M8 3v10" stroke="var(--blue)" strokeWidth="1" opacity="0.5"/>
              <circle cx="8" cy="8" r="1.5" fill="var(--blue)"/>
            </svg>
          </div>
          {!collapsed && (
            <div style={{ overflow: 'hidden' }}>
              <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.4px', color: 'var(--text-primary)', lineHeight: 1, whiteSpace: 'nowrap' }}>
                AeroNet
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-tertiary)', letterSpacing: '0.06em', textTransform: 'uppercase', marginTop: 2 }}>
                CFD Surrogate
              </div>
            </div>
          )}
        </div>

        {/* Collapse button */}
        {!collapsed && (
          <button onClick={() => setCollapsed(true)} style={{
            width: 26, height: 26, border: 'none', borderRadius: 6, cursor: 'pointer',
            background: 'transparent', color: 'var(--text-tertiary)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'background 0.12s, color 0.12s', flexShrink: 0,
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg2)'; e.currentTarget.style.color = 'var(--text-primary)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-tertiary)' }}
          title="Collapse sidebar">
            <Icon name="collapse" />
          </button>
        )}

        {/* Expand button when collapsed */}
        {collapsed && (
          <button onClick={() => setCollapsed(false)} style={{
            position: 'absolute', bottom: 56, left: '50%', transform: 'translateX(-50%)',
            width: 28, height: 28, border: '0.5px solid var(--sep)', borderRadius: 7, cursor: 'pointer',
            background: 'var(--bg1)', color: 'var(--text-tertiary)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'background 0.12s, color 0.12s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg2)'; e.currentTarget.style.color = 'var(--text-primary)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg1)'; e.currentTarget.style.color = 'var(--text-tertiary)' }}
          title="Expand sidebar">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M9 6L15 12L9 18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        )}
      </div>

      {/* ── Status pill ── */}
      {!collapsed && (
        <div style={{ padding: '10px 12px 6px', flexShrink: 0 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 7,
            padding: '6px 10px', borderRadius: 8,
            background: 'var(--bg1)', border: '0.5px solid var(--sep)',
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
              background: statusColor,
              boxShadow: isOnline ? `0 0 5px ${statusColor}` : 'none',
            }}/>
            <span style={{ fontSize: 12, color: statusColor, fontWeight: 500, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {statusLabel}
            </span>
            <span style={{ fontSize: 10, color: 'var(--text-quaternary)', fontFamily: "'IBM Plex Mono', monospace", whiteSpace: 'nowrap' }}>
              484 cases
            </span>
          </div>
        </div>
      )}

      {/* Collapsed status dot */}
      {collapsed && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 4px' }}>
          <span style={{
            width: 7, height: 7, borderRadius: '50%',
            background: statusColor,
            boxShadow: isOnline ? `0 0 5px ${statusColor}` : 'none',
          }} title={statusLabel} />
        </div>
      )}

      {/* ── Nav groups ── */}
      <nav style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: collapsed ? '6px 8px' : '6px 8px' }}>
        {GROUPS.map((group, gi) => {
          const tabs = TABS.filter(t => t.group === group)
          return (
            <div key={group} style={{ marginBottom: collapsed ? 8 : 4 }}>
              {/* Group label — only when expanded */}
              {!collapsed && (
                <div style={{
                  fontSize: 10, fontWeight: 600, letterSpacing: '0.08em',
                  textTransform: 'uppercase', color: 'var(--text-quaternary)',
                  padding: '8px 8px 4px',
                }}>
                  {group}
                </div>
              )}
              {collapsed && gi > 0 && (
                <div style={{ height: 0.5, background: 'var(--sep)', margin: '4px 0 8px' }} />
              )}

              {tabs.map(tab => {
                const isActive = activeTab === tab.id
                return (
                  <button
                    key={tab.id}
                    onClick={() => onTabChange(tab.id)}
                    title={collapsed ? tab.label : undefined}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: collapsed ? '9px 0' : '8px 10px',
                      justifyContent: collapsed ? 'center' : 'flex-start',
                      borderRadius: 8,
                      border: 'none',
                      cursor: 'pointer',
                      marginBottom: 1,
                      background: isActive ? 'rgba(10,132,255,0.12)' : 'transparent',
                      color: isActive ? 'var(--blue)' : 'var(--text-tertiary)',
                      fontSize: 13,
                      fontWeight: isActive ? 600 : 400,
                      letterSpacing: '-0.2px',
                      fontFamily: "'IBM Plex Sans', sans-serif",
                      transition: 'background 0.14s, color 0.14s',
                      position: 'relative',
                      whiteSpace: 'nowrap',
                      outline: 'none',
                    }}
                    onMouseEnter={e => {
                      if (!isActive) {
                        e.currentTarget.style.background = 'var(--bg2)'
                        e.currentTarget.style.color = 'var(--text-secondary)'
                      }
                    }}
                    onMouseLeave={e => {
                      if (!isActive) {
                        e.currentTarget.style.background = 'transparent'
                        e.currentTarget.style.color = 'var(--text-tertiary)'
                      }
                    }}
                  >
                    {/* Active indicator stripe */}
                    {isActive && (
                      <div style={{
                        position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)',
                        width: 2.5, height: '60%', borderRadius: '0 2px 2px 0',
                        background: 'var(--blue)',
                      }} />
                    )}
                    <span style={{ color: isActive ? 'var(--blue)' : 'inherit', display: 'flex' }}>
                      <Icon name={tab.icon} />
                    </span>
                    {!collapsed && (
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {tab.label}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          )
        })}

        {/* Surrogate model selector — only in expanded mode when on relevant tabs */}
        {!collapsed && (activeTab === 'sweep' || activeTab === 'sensitivity') && (
          <div style={{ marginTop: 8, padding: '0 4px' }}>
            <div style={{
              fontSize: 10, fontWeight: 600, letterSpacing: '0.08em',
              textTransform: 'uppercase', color: 'var(--text-quaternary)',
              padding: '4px 4px 6px',
            }}>
              Model
            </div>
            {SURROGATE_MODELS.map(m => {
              const isActive = activeModel === m.id
              return (
                <button key={m.id} onClick={() => onModelChange(m.id)} style={{
                  width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '6px 10px', borderRadius: 7, border: 'none', cursor: 'pointer',
                  marginBottom: 1,
                  background: isActive ? 'rgba(10,132,255,0.10)' : 'transparent',
                  fontFamily: "'IBM Plex Sans', sans-serif",
                  transition: 'background 0.12s',
                }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--bg2)' }}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
                >
                  <span style={{ fontSize: 12, color: isActive ? 'var(--blue)' : 'var(--text-secondary)', fontWeight: isActive ? 600 : 400 }}>
                    {m.label}
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--text-quaternary)', fontFamily: "'IBM Plex Mono', monospace" }}>
                    {m.sub}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </nav>

      {/* ── Footer copyright ── */}
      <div style={{
        flexShrink: 0,
        borderTop: '0.5px solid var(--sep)',
        padding: collapsed ? '10px 0' : '10px 14px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: collapsed ? 'center' : 'flex-start',
      }}>
        {collapsed ? (
          <span title="© 2026 Rutej Talati" style={{ fontSize: 10, color: 'var(--text-quaternary)', cursor: 'default' }}>©</span>
        ) : (
          <div>
            <div style={{ fontSize: 10, color: 'var(--text-quaternary)', letterSpacing: '-0.1px', lineHeight: 1.4 }}>
              Made by Rutej Talati
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-quaternary)', opacity: 0.6, letterSpacing: '-0.1px' }}>
              © 2026 All rights reserved
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}
