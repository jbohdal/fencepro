import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The customer portal, served by EZ Biz at /p/portal/ (behind the public door,
// routes/portalPublic.ts). Built next to the web app: dist/customer-portal.
export default defineConfig({
  root: 'customer-portal',
  base: '/p/portal/',
  plugins: [react(), tailwindcss()],
  build: { outDir: '../dist/customer-portal', emptyOutDir: true },
})
