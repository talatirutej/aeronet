// Copyright (c) 2026 Rutej Talati. All rights reserved.

import { useEffect, useState } from 'react'
import AppBar      from './components/AppBar'
import StatusBar   from './components/StatusBar'
import InputPanel  from './components/InputPanel'
import CarViewer   from './components/CarViewer'
import ResultsPanel from './components/ResultsPanel'
import Views2DPage  from './components/Views2DPage'
import { predict, refreshBackendStatus } from './lib/predict'

const PAGES = [
  { id: '3d',       label: '3D Viewer',      shortcut: '1' },
  { id: '2d',       label: 'Parametric',      shortcut: '2' },
  { id: 'history',  label: 'Run History',     shortcut: '3' },
]

export default function App() {
  const [activePage,      setActivePage]      = useState('3d')
  const [activeModel,     setActiveModel]     = useState('AeroNet-PointNet')
  const [result,          setResult]          = useState(null)
  const [history,         setHistory]         = useState([])
  const [isLoading,       setIsLoading]       = useState(false)
  const [backendStatus,   setBackendStatus]   = useState(null)
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
    }
    refresh()
    const iv = setInterval(refresh, 15_000)
    return () => clearInterval(iv)
  }, [])

  const handleSubmit = async (file, params) => {
    setIsLoading(true)
    try {
      const r = await predict(file, params)
      setResult(r)
      const entry = {
        id: Date.now(), file, params,
        label: `${file.name.replace(/\.[^.]+$/, '')} · ${params.bodyType}`,
        Cd: r.Cd, Cl: r.Cl, inferenceMs: r.inferenceMs,
        source: r._source, result: r,
        timestamp: new Date(),
      }
      setHistory(h => [entry, ...h])
    } catch (e) {
      console.error('Prediction failed:', e)
    } finally {
      setIsLoading(false)
    }
  }

  const renderContent = () => {
    if (activePage === '3d') {
      return (
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '300px 1fr 300px', overflow: 'hidden', gap: '0.5px', background: 'var(--sep)' }}>
          <div style={{ background: 'var(--bg0)', overflow: 'auto' }}>
            <InputPanel onSubmit={handleSubmit} isLoading={isLoading} />
          </div>
          <div style={{ background: '#000', position: 'relative', overflow: 'hidden' }}>
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
          <div style={{ background: 'var(--bg0)', overflow: 'auto' }}>
            <ResultsPanel result={result} history={history} isLoading={isLoading} />
          </div>
        </div>
      )
    }

    if (activePage === '2d') {
      return (
        <div style={{ flex: 1, overflow: 'hidden', background: 'var(--bg0)' }}>
          <Views2DPage
            activeModel={activeModel}
            onModelChange={handleModelChange}
            predictionData={result}
          />
        </div>
      )
    }

    if (activePage === 'history') {
      return (
        <div style={{ flex: 1, overflow: 'auto', background: 'var(--bg0)', padding: '28px 32px' }}>
          <HistoryPage history={history} />
        </div>
      )
    }

    return null
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg0)', overflow: 'hidden' }}>
      <AppBar
        backendStatus={backendStatus}
        activePage={activePage}
        onPageChange={handlePageChange}
        activeModel={activeModel}
        onModelChange={handleModelChange}
      />
      {renderContent()}
      <StatusBar result={result} history={history} activeModel={activeModel} backendStatus={backendStatus} />
    </div>
  )
}

function HistoryPage({ history }) {
  if (history.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh', gap: 12 }}>
        <div style={{ width: 56, height: 56, borderRadius: 14, background: 'var(--bg1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--label3)" strokeWidth="1.5">
            <circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>
          </svg>
        </div>
        <div className="t-headline" style={{ color: 'var(--label2)' }}>No runs yet</div>
        <div className="t-footnote" style={{ color: 'var(--label3)' }}>Run a prediction to see history</div>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <div className="section-label" style={{ marginBottom: 16 }}>Run History — {history.length} predictions</div>
      <div className="ios-card" style={{ overflow: 'hidden' }}>
        {history.map((h, i) => (
          <div key={h.id} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '14px 20px',
            borderBottom: i < history.length - 1 ? '0.5px solid var(--sep)' : 'none'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--bg2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span className="mono t-footnote" style={{ color: 'var(--label3)' }}>
                  {String(history.length - i).padStart(2, '0')}
                </span>
              </div>
              <div>
                <div className="t-subhead" style={{ color: 'var(--label)' }}>{h.label}</div>
                <div className="t-caption1" style={{ color: 'var(--label3)', marginTop: 2 }}>
                  {h.timestamp?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })} ·{' '}
                  {h.inferenceMs} ms ·{' '}
                  <span style={{ color: h.source === 'backend' ? 'var(--green)' : 'var(--orange)' }}>
                    {h.source === 'backend' ? 'backend' : 'mock'}
                  </span>
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 28, alignItems: 'baseline' }}>
              <div style={{ textAlign: 'right' }}>
                <div className="t-caption2" style={{ color: 'var(--label3)' }}>Cd</div>
                <div className="mono t-headline" style={{ color: 'var(--blue)' }}>{h.Cd.toFixed(3)}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="t-caption2" style={{ color: 'var(--label3)' }}>Cl</div>
                <div className="mono t-subhead" style={{ color: 'var(--label2)' }}>{h.Cl?.toFixed(3) ?? '—'}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
