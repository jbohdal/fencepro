// Bad signal on purpose, for every test phone at once.
//
// A proxy in front of the dev server (default: listen 4010 → 4001). Phones and
// browsers under test open the app through it; the test switches the signal:
//
//   up      pass everything through
//   down    no signal: every connection is cut at once
//   slow3g  about 400 ms each way and 50 KB/s, like weak 3G
//   drop    the request reaches the server (so it saves), then the connection
//           is cut before the answer gets back: a save dropped mid way
//
//   import { startSignal } from './signal.mjs'
//   const signal = await startSignal({ listen: 4010, target: 4001 })
//   signal.set('down'); ...; signal.set('up'); signal.counts()  // requests seen per path
//
// Or on its own: node e2e/signal.mjs 4010 4001, and POST /__signal?mode=down

import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import http from 'http'
import { fileURLToPath } from 'url'
import path from 'path'

export async function startSignal({ listen = 4010, target = 4001, host = '127.0.0.1' } = {}) {
  let mode = 'up'
  const seen = []
  const sockets = new Set()
  const delay = ms => new Promise(r => setTimeout(r, ms))

  const server = http.createServer(async (req, res) => {
    if (req.url.startsWith('/__signal')) {
      const m = new URL(req.url, 'http://x').searchParams.get('mode')
      if (m) set(m)
      res.end(JSON.stringify({ mode }))
      return
    }
    const at = mode
    seen.push({ method: req.method, path: req.url.split('?')[0], mode: at, t: Date.now() })
    if (at === 'down') { req.socket.destroy(); return }
    const chunks = []
    for await (const c of req) chunks.push(c)
    if (at === 'slow3g') await delay(400)
    const up = http.request({ host, port: target, method: req.method, path: req.url, headers: { ...req.headers, host: `${host}:${target}` } }, async upRes => {
      const body = []
      for await (const c of upRes) body.push(c)
      const buf = Buffer.concat(body)
      // Dropped mid way: the server has done the work, the phone never hears back.
      if (mode === 'drop' || mode === 'down') { req.socket.destroy(); return }
      if (at === 'slow3g') await delay(400 + Math.round(buf.length / 50))
      res.writeHead(upRes.statusCode, upRes.headers)
      res.end(buf)
    })
    up.on('error', () => { try { res.writeHead(502); res.end() } catch { /* already cut */ } })
    up.end(Buffer.concat(chunks))
  })
  server.on('connection', s => { sockets.add(s); s.on('close', () => sockets.delete(s)) })
  // Keep-alive connections from before "down" are cut too, as they would be.
  function set(m) {
    mode = m
    if (m === 'down') for (const s of sockets) s.destroy()
  }
  await new Promise(r => server.listen(listen, '127.0.0.1', r))
  return {
    set,
    get mode() { return mode },
    seen,
    counts: (method, path) => seen.filter(x => x.method === method && x.path.startsWith(path)).length,
    close: () => new Promise(r => { for (const s of sockets) s.destroy(); server.close(r) }),
  }
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? '')) {
  const [listen = '4010', target = '4001'] = process.argv.slice(2)
  const s = await startSignal({ listen: +listen, target: +target })
  console.log(`signal proxy on ${listen} -> ${target}; POST /__signal?mode=up|down|slow3g|drop`)
  process.on('SIGINT', () => s.close().then(() => process.exit(0)))
}
