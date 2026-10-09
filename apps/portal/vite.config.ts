import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// The API port for local development comes from VITE_API_PORT (apps/portal/.env.local).
// It defaults to 4000, which on the Mac mini is the LIVE server, so the dev
// folder must set its own port. See GO_LIVE.md, "Live and dev are separate".
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  root: 'src/client',
  publicDir: '../../public',
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src/client') },
  },
  server: {
    host: '0.0.0.0',
    port: 5000,
    allowedHosts: true,
    proxy: {
      '/api': { target: `http://localhost:${loadEnv(mode, __dirname, 'VITE_').VITE_API_PORT || '4000'}`, changeOrigin: true },
    },
  },
}))
