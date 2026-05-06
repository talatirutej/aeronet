// GlobalAIChat.jsx — StatCFD AI floating assistant
// Bottom-right persistent button, opens a full chat panel.
// Receives live simulation context (Cd, mesh stats, etc.) from App.
// Powered by OpenRouter via /chat endpoint.
// Copyright (c) 2026 Rutej Talati. All rights reserved.

import { useState, useRef, useEffect, useCallback } from 'react'

const BACKEND = import.meta.env?.VITE_AERONET_BACKEND ?? 'http://127.0.0.1:8000'

const SUGGESTIONS = [
  "What does my Cd value mean?",
  "How can I reduce drag on this shape?",
  "Explain the pressure coefficient scale",
  "What causes wake separation?",
  "How does ground clearance affect Cd?",
  "Compare my result to production cars",
]

// StatCFD logo mark — σ (sigma) stylised as a CFD symbol
const StatCFDMark = ({ size = 20, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    {/* σ shape — open flow symbol */}
    <path
      d="M18 5H8.5C6 5 4 7 4 9.5C4 12 6 14 8.5 14H15.5C18 14 20 16 20 18.5C20 19.9 19.3 21 18 21H6"
      stroke={color} strokeWidth="2" strokeLinecap="round"
    />
    <circle cx="19" cy="5" r="1.5" fill={color} opacity="0.7" />
  </svg>
)

export default function GlobalAIChat({ result, meshStats, activeTab }) {
  const [open,     setOpen]     = useState(false)
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      text: "Hello! I'm StatCFD AI — your aerodynamics co-pilot. I can explain simulation results, interpret Cd values, suggest design improvements, and help you understand CFD physics. What would you like to explore?",
    }
  ])
  const [input,    setInput]    = useState('')
  const [busy,     setBusy]     = useState(false)
  const [pulse,    setPulse]    = useState(false)
  const [hasNew,   setHasNew]   = useState(false)
  const endRef  = useRef(null)
  const inputRef= useRef(null)

  // Pulse the button when new results arrive
  useEffect(() => {
    if (!result) return
    setPulse(true)
    if (!open) setHasNew(true)
    const t = setTimeout(() => setPulse(false), 2000)
    return () => clearTimeout(t)
  }, [result?.Cd])

  // Auto-focus input when panel opens
  useEffect(() => {
    if (open) {
      setHasNew(false)
      setTimeout(() => inputRef.current?.focus(), 120)
    }
  }, [open])

  // Inject a context note when new result arrives and panel is open
  useEffect(() => {
    if (!result || !open) return
    const note = `New prediction: Cd ${result.Cd}${result.bodyTypeLabel ? ` · ${result.bodyTypeLabel}` : ''}${result.confidence ? ` · ${Math.round(result.confidence*100)}% confidence` : ''}`
    setMessages(m => {
      // Don't duplicate if last system msg is the same
      const last = m[m.length-1]
      if (last?.role === 'system' && last.text === note) return m
      return [...m, { role: 'system', text: note }]
    })
  }, [result?.Cd, open])

  const buildContext = useCallback(() => {
    const ctx = {}
    if (result?.Cd)         ctx.Cd = result.Cd
    if (result?.Cl)         ctx.Cl = result.Cl
    if (result?.confidence) ctx.confidence = result.confidence
    if (result?.bodyTypeLabel) ctx.bodyType = result.bodyTypeLabel
    if (result?._source)    ctx.source = result._source
    if (meshStats?.faceCount) ctx.meshFaces = meshStats.faceCount
    if (meshStats?.dims) ctx.meshDims = `${meshStats.dims.length}m × ${meshStats.dims.width}m × ${meshStats.dims.height}m`
    if (activeTab)          ctx.currentPage = activeTab
    return JSON.stringify(ctx)
  }, [result, meshStats, activeTab])

  const buildHistory = useCallback(() => {
    return JSON.stringify(
      messages
        .filter(m => m.role !== 'system')
        .slice(-8)
        .map(m => ({ role: m.role, content: m.text }))
    )
  }, [messages])

  const send = async (text) => {
    const msg = (text ?? input).trim()
    if (!msg || busy) return
    setInput('')
    setMessages(m => [...m, { role: 'user', text: msg }, { role: 'assistant', text: '' }])
    setBusy(true)

    let buffer = ''
    try {
      const fd = new FormData()
      fd.append('message', msg)
      fd.append('context', buildContext())
      fd.append('history', buildHistory())

      const res = await fetch(`${BACKEND}/chat`, { method: 'POST', body: fd })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const reader = res.body.getReader()
      const dec    = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += dec.decode(value, { stream: true })
        setMessages(m => {
          const copy = [...m]
          copy[copy.length-1] = { role: 'assistant', text: buffer }
          return copy
        })
        endRef.current?.scrollIntoView({ behavior: 'smooth' })
      }
    } catch (e) {
      setMessages(m => {
        const copy = [...m]
        copy[copy.length-1] = {
          role: 'assistant',
          text: `StatCFD AI is not reachable. Make sure the backend is running and OPENROUTER_API_KEY is set. (${e.message})`
        }
        return copy
      })
    }
    setBusy(false)
  }

  const clearChat = () => {
    setMessages([{
      role: 'assistant',
      text: "Chat cleared. What would you like to know about your simulation?",
    }])
  }

  // Visible messages (exclude system notes from the chat bubbles)
  const visibleMessages = messages.filter(m => m.role !== 'system')

  return (
    <>
      {/* ── Chat panel ── */}
      {open && (
        <div style={{
          position: 'fixed',
          bottom: 72,
          right: 16,
          width: 360,
          height: 540,
          zIndex: 1000,
          display: 'flex',
          flexDirection: 'column',
          background: 'rgba(8,9,11,0.98)',
          backdropFilter: 'blur(28px)',
          WebkitBackdropFilter: 'blur(28px)',
          border: '0.5px solid rgba(255,255,255,0.09)',
          borderRadius: 16,
          boxShadow: '0 8px 60px rgba(0,0,0,0.6), 0 0 0 0.5px rgba(10,132,255,0.15)',
          animation: 'fadeUp 0.22s cubic-bezier(0.22,1,0.36,1) both',
          overflow: 'hidden',
        }}>

          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '13px 14px',
            borderBottom: '0.5px solid rgba(255,255,255,0.07)',
            flexShrink: 0,
            background: 'rgba(255,255,255,0.02)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <div style={{
                width: 30, height: 30, borderRadius: 8,
                background: 'rgba(10,132,255,0.15)',
                border: '0.5px solid rgba(10,132,255,0.35)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <StatCFDMark size={16} color="var(--blue)" />
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1, letterSpacing: '-0.2px' }}>
                  Stat<span style={{ color: 'var(--blue)' }}>CFD</span> AI
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>
                  statinsite.com · Aerodynamics Assistant
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button onClick={clearChat} title="Clear chat" style={{
                background:'none',border:'none',cursor:'pointer',padding:'5px 6px',borderRadius:6,
                color:'var(--text-quaternary)',fontSize:10,fontFamily:"'IBM Plex Sans',sans-serif",
              }}
              onMouseEnter={e=>{e.currentTarget.style.color='var(--text-tertiary)';e.currentTarget.style.background='rgba(255,255,255,0.05)'}}
              onMouseLeave={e=>{e.currentTarget.style.color='var(--text-quaternary)';e.currentTarget.style.background='none'}}>
                Clear
              </button>
              <button onClick={() => setOpen(false)} style={{
                background:'none',border:'none',cursor:'pointer',padding:5,borderRadius:6,
                color:'var(--text-tertiary)',display:'flex',alignItems:'center',
              }}
              onMouseEnter={e=>e.currentTarget.style.color='var(--text-primary)'}
              onMouseLeave={e=>e.currentTarget.style.color='var(--text-tertiary)'}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
          </div>

          {/* Live context strip */}
          {(result || meshStats) && (
            <div style={{
              display: 'flex', gap: 5, padding: '7px 13px', flexWrap: 'wrap', flexShrink: 0,
              borderBottom: '0.5px solid rgba(255,255,255,0.05)',
              background: 'rgba(10,132,255,0.03)',
            }}>
              {result?.Cd && (
                <span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 6, background: 'rgba(10,132,255,0.12)', color: 'var(--blue)', fontFamily:"'IBM Plex Mono',monospace" }}>
                  Cd {result.Cd}
                </span>
              )}
              {result?.bodyTypeLabel && (
                <span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 6, background: 'rgba(255,255,255,0.06)', color: 'var(--text-tertiary)' }}>
                  {result.bodyTypeLabel}
                </span>
              )}
              {meshStats?.faceCount && (
                <span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 6, background: 'rgba(48,209,88,0.1)', color: 'var(--green)', fontFamily:"'IBM Plex Mono',monospace" }}>
                  {meshStats.faceCount.toLocaleString()} faces
                </span>
              )}
              {result?.confidence && (
                <span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 6, background: 'rgba(255,159,10,0.1)', color: 'var(--orange)', fontFamily:"'IBM Plex Mono',monospace" }}>
                  {Math.round(result.confidence*100)}% conf
                </span>
              )}
              <span style={{ fontSize: 9, color: 'var(--text-quaternary)', alignSelf: 'center', marginLeft: 2 }}>
                live context
              </span>
            </div>
          )}

          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {visibleMessages.map((msg, i) => (
              <div key={i} style={{
                maxWidth: '88%',
                alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                background: msg.role === 'user'
                  ? 'rgba(10,132,255,0.18)'
                  : 'rgba(255,255,255,0.05)',
                border: `0.5px solid ${msg.role === 'user' ? 'rgba(10,132,255,0.28)' : 'rgba(255,255,255,0.07)'}`,
                borderRadius: msg.role === 'user' ? '13px 13px 3px 13px' : '3px 13px 13px 13px',
                padding: '9px 12px',
                fontSize: 12.5,
                lineHeight: 1.58,
                color: msg.role === 'user' ? 'rgba(255,255,255,0.9)' : 'var(--text-secondary)',
              }}>
                {msg.text || (
                  <span style={{ display: 'inline-flex', gap: 3, alignItems: 'center' }}>
                    {[0, 160, 320].map(d => (
                      <span key={d} style={{
                        width: 5, height: 5, borderRadius: '50%',
                        background: 'var(--blue)',
                        animation: `pulse 1.4s ease-in-out ${d}ms infinite`,
                      }} />
                    ))}
                  </span>
                )}
              </div>
            ))}
            <div ref={endRef} />
          </div>

          {/* Suggestion chips */}
          {visibleMessages.length <= 2 && (
            <div style={{
              padding: '6px 12px', flexShrink: 0,
              display: 'flex', gap: 5, flexWrap: 'wrap',
              borderTop: '0.5px solid rgba(255,255,255,0.05)',
            }}>
              {SUGGESTIONS.slice(0, 4).map((s, i) => (
                <button key={i} onClick={() => send(s)} style={{
                  fontSize: 10.5, padding: '5px 10px', borderRadius: 8, cursor: 'pointer',
                  background: 'rgba(255,255,255,0.04)',
                  border: '0.5px solid rgba(255,255,255,0.09)',
                  color: 'var(--text-tertiary)',
                  fontFamily: "'IBM Plex Sans', sans-serif",
                  transition: 'all 0.12s',
                  textAlign: 'left',
                  lineHeight: 1.3,
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background='rgba(10,132,255,0.1)'
                  e.currentTarget.style.color='var(--blue)'
                  e.currentTarget.style.borderColor='rgba(10,132,255,0.3)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background='rgba(255,255,255,0.04)'
                  e.currentTarget.style.color='var(--text-tertiary)'
                  e.currentTarget.style.borderColor='rgba(255,255,255,0.09)'
                }}>
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* Input row */}
          <div style={{
            padding: '10px 12px',
            borderTop: '0.5px solid rgba(255,255,255,0.07)',
            display: 'flex', gap: 8, flexShrink: 0,
            background: 'rgba(255,255,255,0.01)',
          }}>
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
              placeholder="Ask anything about aerodynamics…"
              style={{
                flex: 1,
                background: 'rgba(255,255,255,0.06)',
                border: '0.5px solid rgba(255,255,255,0.1)',
                borderRadius: 10, padding: '9px 12px',
                color: 'var(--text-primary)', fontSize: 13,
                outline: 'none',
                fontFamily: "'IBM Plex Sans', sans-serif",
                transition: 'border-color 0.15s',
              }}
              onFocus={e => e.target.style.borderColor = 'rgba(10,132,255,0.5)'}
              onBlur={e  => e.target.style.borderColor = 'rgba(255,255,255,0.1)'}
            />
            <button
              onClick={() => send()}
              disabled={!input.trim() || busy}
              style={{
                width: 36, height: 36, borderRadius: 10, border: 'none', cursor: 'pointer',
                background: input.trim() && !busy ? 'var(--blue)' : 'rgba(255,255,255,0.07)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'background 0.15s', flexShrink: 0,
              }}
            >
              {busy
                ? <span style={{ width: 12, height: 12, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.25)', borderTopColor: '#fff', animation: 'spin 0.85s linear infinite' }} />
                : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
              }
            </button>
          </div>

          {/* Footer brand */}
          <div style={{
            textAlign: 'center', padding: '5px 0 8px',
            fontSize: 9.5, color: 'rgba(255,255,255,0.14)',
            fontFamily: "'IBM Plex Sans', sans-serif",
            flexShrink: 0,
          }}>
            StatCFD · statinsite.com · © 2026 Rutej Talati
          </div>
        </div>
      )}

      {/* ── Floating trigger button ── */}
      <button
        onClick={() => setOpen(o => !o)}
        title="StatCFD AI Assistant"
        style={{
          position: 'fixed',
          bottom: 16,
          right: 16,
          width: 48,
          height: 48,
          borderRadius: 14,
          border: `0.5px solid ${open ? 'rgba(10,132,255,0.5)' : 'rgba(255,255,255,0.12)'}`,
          cursor: 'pointer',
          background: open
            ? 'rgba(10,132,255,0.22)'
            : 'rgba(14,16,18,0.95)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1001,
          transition: 'all 0.18s cubic-bezier(0.22,1,0.36,1)',
          boxShadow: open
            ? '0 0 0 3px rgba(10,132,255,0.15), 0 8px 32px rgba(0,0,0,0.5)'
            : '0 4px 24px rgba(0,0,0,0.5)',
          transform: pulse ? 'scale(1.1)' : open ? 'scale(1.04)' : 'scale(1)',
        }}
        onMouseEnter={e => { if (!open) e.currentTarget.style.borderColor='rgba(10,132,255,0.4)' }}
        onMouseLeave={e => { if (!open) e.currentTarget.style.borderColor='rgba(255,255,255,0.12)' }}
      >
        {open
          ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth="2.2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          : <StatCFDMark size={20} color={hasNew ? '#0A84FF' : 'rgba(255,255,255,0.7)'} />
        }

        {/* Unread dot */}
        {hasNew && !open && (
          <span style={{
            position: 'absolute', top: 8, right: 8,
            width: 8, height: 8, borderRadius: '50%',
            background: 'var(--blue)',
            boxShadow: '0 0 6px var(--blue)',
            animation: 'pulse 2s ease-in-out infinite',
          }} />
        )}
      </button>
    </>
  )
}
