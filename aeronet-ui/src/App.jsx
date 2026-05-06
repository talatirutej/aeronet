// Copyright (c) 2026 Rutej Talati. All rights reserved.
// StatCFD — by statinsite.com

import { useState, useCallback } from 'react'
import AppBar          from './components/AppBar'
import StatusBar       from './components/StatusBar'
import InputPanel      from './components/InputPanel'
import CarViewer       from './components/CarViewer'
import ResultsPanel    from './components/ResultsPanel'
import Views2DPage     from './components/Views2DPage'
import SweepPage       from './components/SweepPage'
import SensitivityPage from './components/SensitivityPage'
import ReportPage      from './components/ReportPage'
import RoadmapPage     from './components/RoadmapPage'
import GlobalAIChat    from './components/GlobalAIChat'
import { predict }     from './lib/predict'

export default function App() {
  const [activeTab,    setActiveTab]    = useState('cfd')
  const [animating,    setAnimating]    = useState(false)
  const [result,       setResult]       = useState(null)
  const [history,      setHistory]      = useState([])
  const [isLoading,    setIsLoading]    = useState(false)
  const [uploadedFile, setUploadedFile] = useState(null)
  const [activeModel,  setActiveModel]  = useState('GradBoost-DrivAerML')
  const [backendStatus]                 = useState(null)

  // meshStats lifted from CarViewer so GlobalAIChat can use them
  const [meshStats, setMeshStats] = useState(null)

  const switchTab = useCallback((id) => {
    if (id === activeTab) return
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
      setHistory(h => [{
        id:          Date.now(),
        label:       `${file.name.replace(/\.[^.]+$/, '')} · ${params.bodyType ?? params.partType ?? 'unknown'}`,
        Cd:          data.Cd,
        inferenceMs: data.inferenceMs,
      }, ...h])
    } catch (e) { console.error(e) }
    finally { setIsLoading(false) }
  }, [])

  const viewerData = result ?? null

  return (
    <div style={{
      height: '100vh',
      display: 'flex',
      flexDirection: 'row',
      background: 'var(--bg0)',
      overflow: 'hidden',
    }}>

      {/* ── Left sidebar ── */}
      <AppBar
        backendStatus={backendStatus}
        activeTab={activeTab}
        onTabChange={switchTab}
        activeModel={activeModel}
        onModelChange={setActiveModel}
      />

      {/* ── Main content ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

        {/* Page */}
        <div style={{
          flex: 1, overflow: 'hidden', position: 'relative',
          animation: animating ? 'pageSlideIn 0.26s cubic-bezier(0.22,1,0.36,1) both' : 'none',
        }}>
          {activeTab === 'cfd' && (
            <main style={{
              display: 'grid', height: '100%',
              gridTemplateColumns: '300px 1fr 300px',
              overflow: 'hidden', gap: '0.5px', background: 'var(--sep)',
            }}>
              <aside style={{ background: 'var(--bg0)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <InputPanel onSubmit={handleSubmit} isLoading={isLoading} />
              </aside>
              <section style={{ background: '#000', position: 'relative', overflow: 'hidden' }}>
                {/* Only mount WebGL canvas when CFD tab is active — prevents Context Lost */}
                {activeTab === 'cfd' && (
                  <CarViewer
                    data={viewerData}
                    isLoading={isLoading}
                    uploadedFile={uploadedFile}
                    onMeshStats={setMeshStats}
                  />
                )}
              </section>
              <aside style={{ background: 'var(--bg0)', overflow: 'hidden' }}>
                <ResultsPanel result={result} history={history} isLoading={isLoading} />
              </aside>
            </main>
          )}
          {activeTab === 'image'       && <div style={{ height: '100%', overflow: 'hidden' }}><Views2DPage /></div>}
          {activeTab === 'sweep'       && <div style={{ height: '100%', overflow: 'hidden' }}><SweepPage activeModel={activeModel} /></div>}
          {activeTab === 'sensitivity' && <div style={{ height: '100%', overflow: 'hidden' }}><SensitivityPage activeModel={activeModel} /></div>}
          {activeTab === 'report'      && <div style={{ height: '100%', overflow: 'hidden' }}><ReportPage result={result} history={history} /></div>}
          {activeTab === 'roadmap'     && <div style={{ height: '100%', overflow: 'hidden' }}><RoadmapPage /></div>}
        </div>

        <StatusBar result={result} history={history} />
      </div>

      {/* ── Global AI chat — bottom right, all pages ── */}
      <GlobalAIChat
        result={result}
        meshStats={meshStats}
        activeTab={activeTab}
      />

      <style>{`
        @keyframes pageSlideIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0);   }
        }
      `}</style>
    </div>
  )
}
