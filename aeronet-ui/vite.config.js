// Copyright (c) 2026 Rutej Talati. All rights reserved.
// AeroNet — neural surrogate model for vehicle aerodynamics.

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
})
