import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The website instant quote, served by EZ Biz at /p/quote (behind the public
// door). Built next to the web app: dist/quote-widget.
export default defineConfig({
  root: 'quote-widget',
  base: '/p/quote/',
  plugins: [react(), tailwindcss()],
  build: { outDir: '../dist/quote-widget', emptyOutDir: true },
})
