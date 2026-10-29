import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The API runs on :8000 (uvicorn api.app:app); the dev server forwards /api and the GS1 Digital Link
// paths (/01/<GTIN>/10/<lot>, what the garment's QR code holds) to it.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://127.0.0.1:8000', '/01': 'http://127.0.0.1:8000' } },
})
