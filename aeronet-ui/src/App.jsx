// Copyright (c) 2026 Rutej Talati. All rights reserved.
// AeroNet — App.jsx v4  (7 pages)

import { useState, useCallback } from 'react'
import AppBar        from './components/AppBar'
import StatusBar     from './components/StatusBar'
import InputPanel    from './components/InputPanel'
import CarViewer     from './components/CarViewer'
import ResultsPanel  from './components/ResultsPanel'
import Views2DPage   from './components/Views2DPage'
import SweepPage     from './components/SweepPage'
import SensitivityPage from './components/SensitivityPage'
import ComparePage   from './components/ComparePage'
import ReportPage    from './components/ReportPage'
import { predict }   from './lib/predict'

const TABS = [
  { id:'cfd',         label:'CFD Predictor',   icon:'📐', group:'sim'     },
  { id:'image',       label:'Image Predictor',  icon:'🔬', group:'sim'     },
  { id:'sweep',       label:'Param Sweep',      icon:'📈', group:'study'   },
  { id:'sensitivity', label:'Sensitivity',      icon:'🧭', group:'study'   },
  { id:'compare',     label:'Compare',          icon:'⊞',  group:'study'   },
  { id:'report',      label:'Report',           icon:'📄', group:'export'  },
]

const GROUP_LABELS = { sim:'Simulation', study:'Study', export:'Export' }

export default function App() {
  const [activeTab,    setActiveTab]    = useState('cfd')
  const [result,       setResult]       = useState(null)
  const [history,      setHistory]      = useState([])
  const [isLoading,    setIsLoading]    = useState(false)
  const [uploadedFile, setUploadedFile] = useState(null)

  const handleSubmit = useCallback(async (file, params) => {
    setIsLoading(true)
    setUploadedFile(file)
    try {
      const data = await predict(file, params)
      setResult(data)
      setHistory(h => [...h, {
        id:          Date.now(),
        label:       `${file.name.replace(/\.[^.]+$/, '')} · ${params.bodyType}`,
        Cd:          data.Cd,
        inferenceMs: data.inferenceMs,
      }])
    } catch(e) { console.error('Prediction failed:', e) }
    finally { setIsLoading(false) }
  }, [])

  const viewerData = result?.pointCloud ?? null

  return (
    <div className="h-screen flex flex-col bg-md-background overflow-hidden">
      <AppBar />

      {/* Tab bar with group separators */}
      <div className="flex items-center gap-0 border-b border-md-outline-variant bg-md-surface-container-low shrink-0 px-4 overflow-x-auto">
        {TABS.map((tab, i) => {
          const prevGroup = i > 0 ? TABS[i-1].group : null
          const isNewGroup = prevGroup && prevGroup !== tab.group
          return (
            <div key={tab.id} className="flex items-center">
              {isNewGroup && <div className="w-px h-5 bg-md-outline-variant mx-2 shrink-0"/>}
              <button onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-3 text-label-lg font-medium
                            transition-colors border-b-2 -mb-px whitespace-nowrap shrink-0
                  ${activeTab === tab.id
                    ? 'border-md-primary text-md-primary'
                    : 'border-transparent text-md-on-surface-variant hover:text-md-on-surface'}`}>
                <span style={{fontSize:14}}>{tab.icon}</span>
                <span>{tab.label}</span>
              </button>
            </div>
          )
        })}
      </div>

      {/* ── CFD Predictor ── */}
      {activeTab === 'cfd' && (
        <main className="flex-1 grid overflow-hidden"
          style={{ gridTemplateColumns: '320px 1fr 300px' }}>
          <aside className="border-r border-md-outline-variant overflow-hidden flex flex-col bg-md-surface-container-low">
            <InputPanel onSubmit={handleSubmit} isLoading={isLoading} />
          </aside>
          <section className="bg-md-background p-4 overflow-hidden">
            <div className="h-full rounded-xl overflow-hidden shadow-elevation-3">
              <CarViewer data={viewerData} isLoading={isLoading} uploadedFile={uploadedFile} />
            </div>
          </section>
          <aside className="border-l border-md-outline-variant overflow-hidden bg-md-surface-container-low">
            <ResultsPanel result={result} history={history} isLoading={isLoading} />
          </aside>
        </main>
      )}

      {activeTab === 'image'       && <div className="flex-1 overflow-hidden"><Views2DPage /></div>}
      {activeTab === 'sweep'       && <div className="flex-1 overflow-hidden"><SweepPage /></div>}
      {activeTab === 'sensitivity' && <div className="flex-1 overflow-hidden"><SensitivityPage /></div>}
      {activeTab === 'compare'     && <div className="flex-1 overflow-hidden"><ComparePage /></div>}
      {activeTab === 'report'      && <div className="flex-1 overflow-hidden"><ReportPage result={result} history={history} /></div>}

      <StatusBar result={result} history={history} />
    </div>
  )
}
