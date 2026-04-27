// Copyright (c) 2026 Rutej Talati. All rights reserved.

import { useEffect, useState } from 'react'
import AppBar      from './components/AppBar'
import StatusBar   from './components/StatusBar'
import InputPanel  from './components/InputPanel'
import CarViewer   from './components/CarViewer'
import ResultsPanel from './components/ResultsPanel'
import Views2DPage  from './components/Views2DPage'
import OptimisePage from './components/OptimisePage'
import ComparePage  from './components/ComparePage'
import RoadmapPage  from './components/RoadmapPage'
import { predict, refreshBackendStatus } from './lib/predict'

export default function App() {
  const [activePage,      setActivePage]      = useState('3d')
  const [activeModel,     setActiveModel]     = useState('AeroNet-PointNet')
  const [result,          setResult]          = useState(null)
  const [compareResults,  setCompareResults]  = useState([])
  const [history,         setHistory]         = useState([])
  const [isLoading,       setIsLoading]       = useState(false)
  const [backendStatus,   setBackendStatus]   = useState(null)
  const [surrogateStatus, setSurrogateStatus] = useState(null)
  const [viewMode,        setViewMode]        = useState('mesh')
  const [showWake,        setShowWake]        = useState(false)
  const [showTunnel,      setShowTunnel]      = useState(false)

  const handlePageChange = (page) => {
    setActivePage(page)
    if (page === '3d') setActiveModel('AeroNet-PointNet')
    else if (page === '2d' && activeModel === 'AeroNet-PointNet')
      setActiveModel('GradBoost-DrivAerML')
  }

  const handleModelChange = (model) => {
    setActiveModel(model)
    const pageMap = {
      'AeroNet-PointNet':       '3d',
      'GradBoost-DrivAerML':    '2d',
      'RandomForest-DrivAerML': '2d',
      'ResNet-Tabular-12K':     '2d',
    }
    if (pageMap[model]) setActivePage(pageMap[model])
  }

  useEffect(() => {
    const refresh = async () => {
      const status = await refreshBackendStatus()
      setBackendStatus(status)
      if (status?.online) {
        try {
          const r = await fetch('/api/hf/api/status')
          if (r.ok) setSurrogateStatus(await r.json())
        } catch {}
      }
    }
    refresh()
    const iv = setInterval(refresh, 15_000)
    return () => clearInterval(iv)
  }, [])

  const handleRefreshBackend = async () => {
    setBackendStatus(null)
    setBackendStatus(await refreshBackendStatus())
  }

  const handleSubmit = async (file, params) => {
    setIsLoading(true)
    try {
      const r = await predict(file, params)
      setResult(r)
      const entry = {
        id: Date.now(), file, params,
        label: `${file.name.replace(/\.[^.]+$/, '')} · ${params.bodyType}`,
        Cd: r.Cd, Cl: r.Cl, inferenceMs: r.inferenceMs, source: r._source, result: r,
      }
      setHistory(h => [...h, entry])
      setCompareResults(prev => [...prev.slice(-1), entry])
    } catch (e) {
      console.error('Prediction failed:', e)
    } finally {
      setIsLoading(false)
    }
  }

  const renderPage = () => {
    switch (activePage) {
      case '3d':
        return (
          <main style={{ flex: 1, display: 'grid', overflow: 'hidden',
            gridTemplateColumns: '300px 1fr 300px', gap: '1px', background: '#222' }}>
            <aside style={{ overflow: 'auto', padding: 20, background: '#0a0a0a' }}>
              <InputPanel onSubmit={handleSubmit} isLoading={isLoading} />
            </aside>
            <section style={{ position: 'relative', overflow: 'hidden',
              padding: 12, background: '#000' }}>
              <div style={{ width: '100%', height: '100%', borderRadius: 12,
                overflow: 'hidden', border: '1px solid #243339' }}>
                <CarViewer
                  data={result ?? null}
                  isLoading={isLoading}
                  viewMode={viewMode}
                  onViewModeChange={setViewMode}
                  showWake={showWake}
                  onToggleWake={() => setShowWake(w => !w)}
                  showTunnel={showTunnel}
                  onToggleTunnel={() => setShowTunnel(t => !t)}
                />
              </div>
            </section>
            <aside style={{ overflow: 'auto', padding: 20, background: '#0a0a0a' }}>
              <ResultsPanel result={result} history={history} isLoading={isLoading} />
            </aside>
          </main>
        )
      case '2d':
        return (
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <Views2DPage activeModel={activeModel} onModelChange={handleModelChange}
              predictionData={result} />
          </div>
        )
      case 'optimise':
        return (
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <OptimisePage backendOnline={backendStatus?.online} />
          </div>
        )
      case 'compare':
        return (
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <ComparePage history={history} compareResults={compareResults}
              onSubmit={handleSubmit} isLoading={isLoading} />
          </div>
        )
      case 'roadmap':
        return (
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <RoadmapPage />
          </div>
        )
      default:
        return null
    }
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column',
      background: '#000' }}>
      <AppBar
        backendStatus={backendStatus}
        onRefreshBackend={handleRefreshBackend}
        activePage={activePage}
        onPageChange={handlePageChange}
        activeModel={activeModel}
        onModelChange={handleModelChange}
        surrogateStatus={surrogateStatus}
      />
      {renderPage()}
      <StatusBar result={result} history={history} activeModel={activeModel} />
    </div>
  )
}
