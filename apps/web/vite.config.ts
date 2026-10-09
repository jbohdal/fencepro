import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The API port for local development comes from VITE_API_PORT (.env.local).
// It defaults to 4000, which on the Mac mini is the LIVE server, so the dev
// folder must set its own port. See GO_LIVE.md, "Live and dev are separate".
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    port: 5173,
    host: true, // bind 0.0.0.0 so tunnels (Cloudflare / ngrok / LAN) can reach us
    allowedHosts: true, // permissive: allow any host header (needed for Cloudflare / ngrok tunnels)
    proxy: {
      '/api': {
        target: `http://localhost:${loadEnv(mode, process.cwd(), 'VITE_').VITE_API_PORT || '4000'}`,
        changeOrigin: true,
      },
    },
  },
}))
