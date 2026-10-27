import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { execFileSync } from 'child_process'

// The app's version, sent with "Send feedback": the git commit it was built
// from and the build time (UTC). "unknown" outside a git checkout.
function appVersion(): string {
  let commit = ''
  try { commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() } catch { /* not a git checkout */ }
  return `${commit || 'unknown'} built ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

// The API port for local development comes from VITE_API_PORT (.env.local).
// It defaults to 4000, which on the Mac mini is the LIVE server, so the dev
// folder must set its own port. See GO_LIVE.md, "Live and dev are separate".
export default defineConfig(({ mode }) => ({
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion()),
  },
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
      // The aerial photo tiles (routes/aerialTiles.ts).
      '/p/tiles': {
        target: `http://localhost:${loadEnv(mode, process.cwd(), 'VITE_').VITE_API_PORT || '4000'}`,
        changeOrigin: true,
      },
    },
  },
}))
