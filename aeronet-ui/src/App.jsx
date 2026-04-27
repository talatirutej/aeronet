// Copyright (c) 2026 Rutej Talati. All rights reserved.
// AeroNet — App root v3

import { useState, useCallback } from 'react'
import AppBar       from './components/AppBar'
import StatusBar    from './components/StatusBar'
import InputPanel   from './components/InputPanel'
import CarViewer    from './components/CarViewer'
import ResultsPanel from './components/ResultsPanel'
import Views2DPage  from './components/Views2DPage'
import { predict }  from './lib/predict'

const TABS = [
  { id: 'cfd',   label: 'CFD Predictor',  icon: '📐' },
  { id: 'image', label: 'Image Predictor', icon: '🔬' },
]

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
    } catch (e) {
      console.error('Prediction failed:', e)
    } finally {
      setIsLoading(false)
    }
  }, [])

  return (
    <div className="h-screen flex flex-col bg-md-background overflow-hidden">
      <AppBar />

      <div className="flex gap-0 border-b border-md-outline-variant bg-md-surface-container-low shrink-0 px-4">
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-5 py-3 text-label-lg font-medium
                        transition-colors border-b-2 -mb-px
              ${activeTab === tab.id
                ? 'border-md-primary text-md-primary'
                : 'border-transparent text-md-on-surface-variant hover:text-md-on-surface'}`}>
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {activeTab === 'cfd' && (
        <main className="flex-1 grid overflow-hidden"
          style={{ gridTemplateColumns: '320px 1fr 300px' }}>
          <aside className="border-r border-md-outline-variant overflow-hidden flex flex-col bg-md-surface-container-low">
            <InputPanel onSubmit={handleSubmit} isLoading={isLoading} />
          </aside>
          <section className="bg-md-background p-4 overflow-hidden">
            <div className="h-full rounded-xl overflow-hidden shadow-elevation-3">
              <CarViewer data={result} isLoading={isLoading} uploadedFile={uploadedFile} />
            </div>
          </section>
          <aside className="border-l border-md-outline-variant overflow-hidden bg-md-surface-container-low">
            <ResultsPanel result={result} history={history} isLoading={isLoading} />
          </aside>
        </main>
      )}

      {activeTab === 'image' && (
        <div className="flex-1 overflow-hidden">
          <Views2DPage />
        </div>
      )}

      <StatusBar result={result} history={history} />
    </div>
  )
}
