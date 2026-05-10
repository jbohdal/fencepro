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
    // Allow tunnel hostnames so Vite doesn't reject the request based on Host header.
    allowedHosts: [
      'localhost',
      '.trycloudflare.com',
      '.ngrok.io',
      '.ngrok-free.app',
    ],
    proxy: {
      // In dev, proxy /api calls to the local portal server
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
})