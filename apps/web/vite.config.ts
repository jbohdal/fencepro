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
    proxy: {
      // In dev, proxy /api calls to the local portal server
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
})