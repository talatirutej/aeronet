/**
 * App.jsx — AeroNet root layout v3
 *
 * Three tabs:
 *   1. CFD Predictor  — geometric sliders → surrogate model → 3D viewer with REAL mesh
 *   2. Image Predictor — photo → Moondream2 → 4-view 2D reconstruction + Cd
 *   3. 3D CAD Viewer  — standalone STL/OBJ/PLY viewer with Cp overlay
 *
 * Changes:
 *   - CarViewer now receives `uploadedFile` prop → renders ACTUAL mesh geometry
 *   - ImagePredictor is replaced by ImagePredictor2D (dedicated full page)
 *   - New standalone 3D CAD tab for pure mesh inspection
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import AppBar          from './components/AppBar'
import StatusBar       from './components/StatusBar'
import InputPanel      from './components/InputPanel'
import CarViewer       from './components/CarViewer'
import ResultsPanel    from './components/ResultsPanel'
import ImagePredictor2D from './components/ImagePredictor2D'
import { predict }     from './lib/predict'
import { checkHealth } from './lib/api'

// ── Tab definitions ──────────────────────────────────────────────────────────

const TABS = [
  { id: 'cfd',    label: 'CFD Predictor',    icon: '📐' },
  { id: 'image',  label: 'Image Predictor',  icon: '🔬' },
  { id: 'viewer', label: '3D CAD Viewer',    icon: '🧊' },
]

// ── Standalone CAD viewer (no prediction, just mesh + controls) ──────────────

function CadViewer() {
  const [file, setFile]   = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef(null)

  const acceptFile = (f) => {
    if (!f) return
    const ext = f.name.split('.').pop().toLowerCase()
    if (!['stl', 'obj', 'ply'].includes(ext)) return
    setFile(f)
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Sidebar */}
      <div className="w-56 shrink-0 flex flex-col gap-4 p-4 border-r border-md-outline-variant
                      bg-md-surface-container-low">
        <div className="flex items-center gap-2">
          <span className="text-label-sm text-md-primary font-mono">01</span>
          <div className="flex-1 h-px bg-md-outline-variant" />
          <span className="text-label-sm text-md-on-surface-variant uppercase tracking-wide">Mesh</span>
        </div>

        <div
          className={`rounded-xl border-2 border-dashed cursor-pointer transition-all
            ${dragOver
              ? 'border-md-primary bg-md-primary/10'
              : 'border-md-outline-variant hover:border-md-primary/50'}`}
          style={{ minHeight: 120 }}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); acceptFile(e.dataTransfer.files[0]) }}
          onClick={() => inputRef.current?.click()}
        >
          <input ref={inputRef} type="file" accept=".stl,.obj,.ply" className="hidden"
            onChange={e => acceptFile(e.target.files[0])} />
          <div className="flex flex-col items-center justify-center gap-2 py-8 px-4">
            {file ? (
              <>
                <span className="text-2xl">✅</span>
                <span className="text-label-md text-md-on-surface text-center truncate w-full">
                  {file.name}
                </span>
                <span className="text-label-sm text-md-on-surface-variant">
                  {(file.size / 1024).toFixed(0)} KB
                </span>
              </>
            ) : (
              <>
                <span className="text-2xl">📂</span>
                <span className="text-body-sm text-md-on-surface-variant text-center">
                  Drop STL · OBJ · PLY
                </span>
              </>
            )}
          </div>
        </div>

        {file && (
          <button onClick={() => setFile(null)}
            className="text-label-sm text-md-error hover:text-md-on-error-container transition-colors
                       text-center py-1">
            ✕ Clear mesh
          </button>
        )}

        <div className="mt-2 rounded-lg bg-md-surface-container border border-md-outline-variant p-3 space-y-2">
          <div className="text-label-sm text-md-on-surface-variant">Supported formats</div>
          {[['STL', 'Binary & ASCII'], ['OBJ', 'Wavefront (no MTL)'], ['PLY', 'Binary LE & ASCII']].map(([f, d]) => (
            <div key={f} className="flex justify-between text-label-sm">
              <span className="text-md-primary font-mono">{f}</span>
              <span className="text-md-outline">{d}</span>
            </div>
          ))}
        </div>

        <div className="mt-auto rounded-lg bg-md-surface-container border border-md-outline-variant p-3">
          <div className="text-label-sm text-md-on-surface-variant mb-1">Controls</div>
          <div className="space-y-1 text-label-sm text-md-outline">
            <div>🖱 Drag — rotate</div>
            <div>🖱 Right — pan</div>
            <div>⚙ Scroll — zoom</div>
          </div>
        </div>
      </div>

      {/* Viewer */}
      <div className="flex-1 overflow-hidden">
        <CarViewer data={null} isLoading={false} uploadedFile={file} />
      </div>
    </div>
  )
}

// ── Root App ──────────────────────────────────────────────────────────────────

export default function App() {
  const [activeTab,  setActiveTab]  = useState('cfd')
  const [result,     setResult]     = useState(null)
  const [history,    setHistory]    = useState([])
  const [isLoading,  setIsLoading]  = useState(false)
  const [uploadedFile, setUploadedFile] = useState(null)  // mesh file for 3D viewer
  const [backendOk,  setBackendOk]  = useState(null)

  useEffect(() => {
    checkHealth().then(h => setBackendOk(!!h)).catch(() => setBackendOk(false))
  }, [])

  const handleSubmit = useCallback(async (file, params) => {
    setIsLoading(true)
    setUploadedFile(file)
    try {
      const r = await predict(file, params)
      setResult(r)
      setHistory(h => [...h, {
        id: Date.now(),
        label: `${file.name.replace(/\.[^.]+$/, '')} · ${params.bodyType}`,
        Cd: r.Cd,
        inferenceMs: r.inferenceMs,
      }])
    } catch (e) {
      console.error('Prediction failed:', e)
    } finally {
      setIsLoading(false)
    }
  }, [])

  return (
    <div className="h-screen flex flex-col bg-md-background overflow-hidden">
      <AppBar backendOk={backendOk} />

      {/* Tab bar */}
      <div className="flex gap-0 border-b border-md-outline-variant bg-md-surface-container-low
                      shrink-0 px-4">
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

      {/* ── CFD Predictor ── */}
      {activeTab === 'cfd' && (
        <main className="flex-1 grid overflow-hidden"
          style={{ gridTemplateColumns: '320px 1fr 300px' }}>
          <aside className="border-r border-md-outline-variant overflow-hidden flex flex-col
                            bg-md-surface-container-low">
            <InputPanel onSubmit={handleSubmit} isLoading={isLoading} />
          </aside>
          <section className="bg-md-background p-3 overflow-hidden">
            <div className="h-full rounded-xl overflow-hidden shadow-elevation-3">
              {/* Pass both prediction result AND the uploaded mesh file */}
              <CarViewer
                data={result?.pointCloud ?? null}
                isLoading={isLoading}
                uploadedFile={uploadedFile}
              />
            </div>
          </section>
          <aside className="border-l border-md-outline-variant overflow-hidden bg-md-surface-container-low">
            <ResultsPanel result={result} history={history} isLoading={isLoading} />
          </aside>
        </main>
      )}

      {/* ── Image Predictor 2D ── */}
      {activeTab === 'image' && (
        <div className="flex-1 overflow-hidden">
          <ImagePredictor2D />
        </div>
      )}

      {/* ── 3D CAD Viewer ── */}
      {activeTab === 'viewer' && (
        <div className="flex flex-1 overflow-hidden">
          <CadViewer />
        </div>
      )}

      <StatusBar result={result} history={history} backendOk={backendOk} />
    </div>
  )
}
