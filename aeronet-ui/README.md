# AeroNet UI

**React frontend for the AeroNet CFD surrogate model.**

Copyright © 2026 Rutej Talati. All rights reserved.

A dark-themed, engineering-tool-style web interface for uploading vehicle
surface meshes, configuring flow conditions, and visualising predicted
aerodynamic coefficients with a 3D pressure-coloured point cloud viewer.

## Features

- Drag-and-drop upload for surface meshes (VTK / STL / OBJ).
- Configurable flow conditions: inflow velocity, air density, reference
  frontal area, body type, and geometric scale factor.
- Interactive 3D viewer (react-three-fiber): orbit / zoom / pan, point cloud
  coloured by pressure coefficient (Cp), CFD-convention colourbar.
- Live Cd / Cl / Cs readouts with confidence indicator and inference latency.
- Drag-contribution breakdown by car region (front fascia, greenhouse,
  underbody, wheels, mirrors, rear / wake).
- Rolling history of past predictions with quick comparison.
- Mock backend for offline demos; designed for one-line swap to a real
  inference API once a trained model is hosted.

## Aesthetic

- Dark slate base palette (`#0a0e14` background) with cyan accents.
- JetBrains Mono for data and labels, IBM Plex Sans for body.
- IDE-style status bar showing dataset, training metrics, and inference
  telemetry.
- Engineering grid overlay and corner crosshairs in the 3D viewport.
- Cp colour ramp follows standard CFD convention: blue (suction) →
  cyan → green → amber → red (stagnation).

## Setup

Requires Node.js 18 or newer.

```bash
cd aeronet-ui
npm install
npm run dev
```

Opens at `http://localhost:5173`.

To build for production:

```bash
npm run build
npm run preview
```

## Project structure

```
aeronet-ui/
├── src/
│   ├── App.jsx                      three-column layout, state, history
│   ├── main.jsx                     React entry
│   ├── index.css                    Tailwind + custom utility layers
│   ├── components/
│   │   ├── AppBar.jsx               top brand bar
│   │   ├── StatusBar.jsx            IDE-style bottom status bar
│   │   ├── InputPanel.jsx           dropzone, parameters
│   │   ├── CarViewer.jsx            react-three-fiber 3D scene
│   │   └── ResultsPanel.jsx         Cd readout, breakdown, history
│   └── lib/
│       └── predict.js               mock backend (single-file replace point)
├── public/
│   └── favicon.svg
├── index.html
├── package.json
├── tailwind.config.js
├── postcss.config.js
├── vite.config.js
├── LICENSE
└── README.md
```

## Wiring to a real model

The current `src/lib/predict.js` simulates predictions deterministically from
file metadata and parameters, so the UI is fully functional offline. To
connect to a real trained model, replace the `predict()` function with a
`fetch()` call to a backend service (e.g. FastAPI wrapping the AeroNet
PyTorch model):

```javascript
export async function predict(file, params) {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('params', JSON.stringify(params))

  const res = await fetch('http://your-server:8000/predict', {
    method: 'POST',
    body: formData,
  })
  if (!res.ok) throw new Error('Prediction failed')
  return await res.json()
}
```

The expected JSON response shape is documented at the top of the current
`predict()` function. The UI does not need to change.

## License

Proprietary. See `LICENSE`.
