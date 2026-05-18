import { useEffect } from 'react'
import Views2DPage from './components/Views2DPage'

export default function App() {
  useEffect(() => {
    fetch('https://rutejtalati16-statcontour.hf.space/health').catch(() => {})
  }, [])

  return (
    <div style={{ height: '100vh', overflow: 'hidden' }}>
      <Views2DPage backend="https://rutejtalati16-statcontour.hf.space" />
    </div>
  )
}
