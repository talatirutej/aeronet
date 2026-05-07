// Copyright (c) 2026 Rutej Talati. All rights reserved.
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react()],
    server: { port: 5173 },
    define: {
      // Explicitly inject at build time so it's never undefined in production
      __AERONET_BACKEND__: JSON.stringify(
        env.VITE_AERONET_BACKEND || 'https://rutejtalati16-aeronet.hf.space'
      ),
    },
  }
})
