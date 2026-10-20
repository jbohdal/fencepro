// Every browser test that signs in or saves runs against the dev copy only.
// Imported first by each test (`import './devOnly.mjs'`), before anything
// opens a browser. Refuses, and exits, when APP_URL, API_URL or CDP_URL points
// at the live server: port 4000, the Tailscale name (*.ts.net), a Tailscale
// address (100.64.0.0/10), or any machine other than this one.
//
// Not imported by live-readonly.mjs (read only by design, every non GET is
// stopped) or by godaddy-embed.mjs / real-site-embed.mjs (they load the
// public quote widget the way a customer does and send nothing), or by
// widget-draw-public.mjs (the public door in test mode only, behind
// PUBLIC_WIDGET_TEST=1; any request that is not a GET and not test mode is
// stopped, and live is only read).

const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/

export function liveUrlProblem(name, raw) {
  if (!raw) return null
  let u
  try { u = new URL(raw) } catch { return `${name} is not an address: ${raw}` }
  const port = u.port || (u.protocol === 'https:' ? '443' : '80')
  if (/\.ts\.net$/i.test(u.hostname)) return `${name} is the live Tailscale address (${u.host})`
  const m = u.hostname.match(/^100\.(\d+)\./)
  if (m && Number(m[1]) >= 64 && Number(m[1]) <= 127) return `${name} is a Tailscale address (${u.host})`
  if (!LOCAL.test(u.hostname)) return `${name} is not this machine (${u.host})`
  if (port === '4000') return `${name} is port 4000, the live server`
  return null
}

const problems = [['APP_URL', process.env.APP_URL], ['API_URL', process.env.API_URL], ['CDP_URL', process.env.CDP_URL]]
  .map(([n, v]) => liveUrlProblem(n, v)).filter(Boolean)
if (problems.length) {
  console.error(`Refusing to run: the browser tests write test data and run against the dev copy only (http://localhost:4001). ${problems.join('; ')}.`)
  process.exit(2)
}
