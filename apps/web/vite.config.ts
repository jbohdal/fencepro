import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
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
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
})