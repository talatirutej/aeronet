// Copyright (c) 2026 Rutej Talati. All rights reserved.

import { useState, useCallback, useEffect, useRef } from 'react'
import AppBar        from './components/AppBar'
import StatusBar     from './components/StatusBar'
import InputPanel    from './components/InputPanel'
import CarViewer     from './components/CarViewer'
import ResultsPanel  from './components/ResultsPanel'
import Views2DPage   from './components/Views2DPage'
import SweepPage     from './components/SweepPage'
import SensitivityPage from './components/SensitivityPage'
import ReportPage    from './components/ReportPage'
import RoadmapPage   from './components/RoadmapPage'
import { predict }   from './lib/predict'

const TABS = [
  { id: 'cfd',         label: 'CFD Predictor',   group: 'sim'    },
  { id: 'image',       label: 'Image Predictor',  group: 'sim'    },
  { id: 'sweep',       label: 'Param Sweep',      group: 'study'  },
  { id: 'sensitivity', label: 'Sensitivity',      group: 'study'  },
  { id: 'report',      label: 'Report',           group: 'export' },
  { id: 'roadmap',     label: 'Roadmap',          group: 'export' },
]

export default function App() {
  const [activeTab,    setActiveTab]    = useState('cfd')
  const [prevTab,      setPrevTab]      = useState(null)
  const [animating,    setAnimating]    = useState(false)
  const [result,       setResult]       = useState(null)
  const [history,      setHistory]      = useState([])
  const [isLoading,    setIsLoading]    = useState(false)
  const [uploadedFile, setUploadedFile] = useState(null)

  const switchTab = useCallback((id) => {
    if (id === activeTab) return
    setPrevTab(activeTab)
    setAnimating(true)
    setActiveTab(id)
    setTimeout(() => setAnimating(false), 280)
  }, [activeTab])

  const handleSubmit = useCallback(async (file, params) => {
    setIsLoading(true)
    setUploadedFile(file)
    try {
      const data = await predict(file, params)
      setResult(data)
      setHistory(h => [{ id: Date.now(), label: `${file.name.replace(/\.[^.]+$/, '')} · ${params.bodyType}`, Cd: data.Cd, inferenceMs: data.inferenceMs }, ...h])
    } catch(e) { console.error(e) }
    finally { setIsLoading(false) }
  }, [])

  const viewerData = result?.pointCloud ?? null

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg0)', overflow: 'hidden' }}>
      <AppBar />

      {/* Tab bar */}
      <nav style={{
        display: 'flex', alignItems: 'center', gap: 0,
        borderBottom: '0.5px solid var(--sep)',
        background: 'rgba(0,0,0,0.7)',
        backdropFilter: 'blur(20px)',
        flexShrink: 0,
        padding: '0 16px',
        overflow: 'hidden',
      }}>
        {TABS.map((tab, i) => {
          const prev = i > 0 ? TABS[i-1] : null
          const isNewGroup = prev && prev.group !== tab.group
          const isActive = activeTab === tab.id
          return (
            <div key={tab.id} style={{ display: 'flex', alignItems: 'center' }}>
              {isNewGroup && (
                <div style={{ width: 0.5, height: 14, background: 'var(--sep)', margin: '0 6px', flexShrink: 0 }} />
              )}
              <button
                onClick={() => switchTab(tab.id)}
                style={{
                  position: 'relative', display: 'flex', alignItems: 'center',
                  padding: '0 14px', height: 44, border: 'none', cursor: 'pointer',
                  background: 'transparent',
                  color: isActive ? '#fff' : 'rgba(255,255,255,0.4)',
                  fontSize: 13, fontWeight: isActive ? 600 : 400,
                  letterSpacing: '-0.2px',
                  fontFamily: "'IBM Plex Sans', sans-serif",
                  transition: 'color 0.18s ease',
                  whiteSpace: 'nowrap',
                  outline: 'none',
                }}
              >
                {tab.label}
                {/* Active indicator */}
                <div style={{
                  position: 'absolute', bottom: 0, left: 14, right: 14,
                  height: 2, borderRadius: '2px 2px 0 0',
                  background: isActive ? 'var(--blue)' : 'transparent',
                  transform: isActive ? 'scaleX(1)' : 'scaleX(0)',
                  transition: 'transform 0.22s cubic-bezier(0.22,1,0.36,1), background 0.18s',
                  transformOrigin: 'center',
                }} />
              </button>
            </div>
          )
        })}
      </nav>

      {/* Page content with slide animation */}
      <div style={{
        flex: 1, overflow: 'hidden', position: 'relative',
        animation: animating ? 'pageSlideIn 0.26s cubic-bezier(0.22,1,0.36,1) both' : 'none',
      }}>
        {activeTab === 'cfd' && (
          <main style={{ display: 'grid', height: '100%', gridTemplateColumns: '300px 1fr 300px', overflow: 'hidden', gap: '0.5px', background: 'var(--sep)' }}>
            <aside style={{ background: 'var(--bg0)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <InputPanel onSubmit={handleSubmit} isLoading={isLoading} />
            </aside>
            <section style={{ background: '#000', position: 'relative', overflow: 'hidden' }}>
              <CarViewer data={viewerData} isLoading={isLoading} uploadedFile={uploadedFile} />
            </section>
            <aside style={{ background: 'var(--bg0)', overflow: 'hidden' }}>
              <ResultsPanel result={result} history={history} isLoading={isLoading} />
            </aside>
          </main>
        )}
        {activeTab === 'image'       && <div style={{ height: '100%', overflow: 'hidden' }}><Views2DPage /></div>}
        {activeTab === 'sweep'       && <div style={{ height: '100%', overflow: 'hidden' }}><SweepPage /></div>}
        {activeTab === 'sensitivity' && <div style={{ height: '100%', overflow: 'hidden' }}><SensitivityPage /></div>}
        {activeTab === 'report'      && <div style={{ height: '100%', overflow: 'hidden' }}><ReportPage result={result} history={history} /></div>}
        {activeTab === 'roadmap'     && <div style={{ height: '100%', overflow: 'hidden' }}><RoadmapPage /></div>}
      </div>

      <StatusBar result={result} history={history} />

      <style>{`
        @keyframes pageSlideIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}
