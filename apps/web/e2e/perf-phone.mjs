// How long the staff app takes to become usable on a phone, screen by screen.
// Read only: it opens screens and reads, nothing else. Every request that is
// not a GET is stopped in the browser before it leaves (and listed).
//
//   TARGET=live node e2e/perf-phone.mjs     the live app at http://localhost:4000,
//        signed in with the 3 hour read only session (~/.ezbiz-readonly-session;
//        make it on the Mac: cd ~/ezbiz/apps/portal && npx tsx scripts/readonly-session.ts).
//        The server itself refuses every save from that session.
//   TARGET=dev  E2E_ACCESS_TOKEN=<dev token> node e2e/perf-phone.mjs   the dev copy (port 4001)
//        (or E2E_STAFF_COOKIE=<cookie>).
//
//   ENGINE=chromium (default) | webkit
//   PHONE=1 (default)  390 x 844, touch, iPhone user agent
//   THROTTLE=1         Chromium only: CPU slowed 4x (a phone's CPU, roughly) and
//                      4G network: 9 Mbps down, 1.5 Mbps up, 170 ms round trip.
//   RUNS=n             repeat and report the median (default 1)
//   CUSTOMER=<id>      the customer page to open (default: the first card's customer)
//   OUT=<file.json>    also write the numbers here
//
// Screens, each timed from the tap (or the page load) to the screen drawn and usable:
//   start      page load (signed in) -> the app's tab bar (every store loaded)
//   pipeline   Pipeline tab          -> the board with its columns and cards
//   customers  Customers tab         -> the list drawn
//   customer   a customer's page     -> its tabs drawn
//   followups  Follow ups tab        -> the list
//   quote      New quote             -> the quote builder open
// Plus: bytes downloaded at start (per API), JS heap and DOM nodes after the
// pipeline is drawn, cards drawn on the board, and long tasks (Chromium).
import { chromium, webkit } from 'playwright'
import fs from 'fs'

const TARGET = process.env.TARGET || 'dev'
const ENGINE = process.env.ENGINE === 'webkit' ? webkit : chromium
const ENGINE_NAME = process.env.ENGINE === 'webkit' ? 'webkit' : 'chromium'
const PHONE = process.env.PHONE !== '0'
const THROTTLE = process.env.THROTTLE === '1' && ENGINE_NAME === 'chromium'
const RUNS = Number(process.env.RUNS || 1)
const sleep = ms => new Promise(r => setTimeout(r, ms))

let APP, cookie = '', token = ''
if (TARGET === 'live') {
  APP = 'http://localhost:4000'
  const file = process.env.READONLY_SESSION_FILE || `${process.env.HOME}/.ezbiz-readonly-session`
  if (!fs.existsSync(file)) { console.error(`No read only sign in at ${file}.`); process.exit(2) }
  cookie = fs.readFileSync(file, 'utf8').trim()
  const me = await fetch(APP + '/api/crm-auth/me', { headers: { Cookie: `ezbiz_staff=${cookie}` } })
  if (!me.ok || !(await me.json()).data?.readOnly) { console.error('The live sign in must be a working read only session. Refusing.'); process.exit(2) }
} else {
  APP = process.env.APP_URL || 'http://localhost:4001'
  const { liveUrlProblem } = await import('./devOnly.mjs')
  const p = liveUrlProblem('APP_URL', APP)
  if (p) { console.error(`Refusing: ${p}. Use TARGET=live for the read only live measurement.`); process.exit(2) }
  cookie = process.env.E2E_STAFF_COOKIE || ''
  token = process.env.E2E_ACCESS_TOKEN || ''
  if (!cookie && !token) { console.error('Set E2E_ACCESS_TOKEN or E2E_STAFF_COOKIE for the dev server.'); process.exit(2) }
}

async function signIn(ctx) {
  const u = new URL(APP)
  if (cookie) { await ctx.addCookies([{ name: 'ezbiz_staff', value: cookie, domain: u.hostname, path: '/api', httpOnly: true, secure: false, sameSite: 'Strict' }]); return }
  const r = await ctx.request.post(`${APP}/api/crm-auth/move-over`, { headers: { 'X-Staff-Request': '1', 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, data: {} })
  if (!r.ok()) throw new Error(`dev sign in failed: ${r.status()}`)
}

/** In app navigation, the way the app's own links do it (nav.ts listens for popstate). */
const go = (page, url) => page.evaluate(u => {
  const st = { ez: 1, i: (history.state?.i ?? 0) + 1, depth: 0 }
  history.pushState(st, '', u)
  dispatchEvent(new PopStateEvent('popstate', { state: st }))
}, url)

async function once(browser) {
  const ctx = await browser.newContext(PHONE
    ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: ENGINE_NAME === 'chromium', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' }
    : { viewport: { width: 1440, height: 900 } })
  await signIn(ctx)
  const blocked = []
  await ctx.route('**/*', route => {
    const req = route.request()
    if (req.url().startsWith(APP) && !['GET', 'HEAD', 'OPTIONS'].includes(req.method())) { blocked.push(`${req.method()} ${new URL(req.url()).pathname}`); return route.abort() }
    return route.continue()
  })
  await ctx.addInitScript(() => {
    window.__long = []
    try { new PerformanceObserver(l => { for (const e of l.getEntries()) window.__long.push({ at: Math.round(e.startTime), ms: Math.round(e.duration) }) }).observe({ type: 'longtask', buffered: true }) } catch { /* WebKit: no long task timing */ }
  })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)))
  page.on('dialog', d => d.dismiss().catch(() => {}))
  let cdp = null
  if (ENGINE_NAME === 'chromium') {
    cdp = await ctx.newCDPSession(page)
    await cdp.send('Performance.enable')
    if (THROTTLE) {
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
      await cdp.send('Network.enable')
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 170, downloadThroughput: 9e6 / 8, uploadThroughput: 1.5e6 / 8 })
    }
  }
  const api = []
  const t00 = Date.now()
  if (process.env.DEBUG_URLS) page.on('request', q => { if (q.url().includes('/api/')) console.error(`${Date.now() - t00} ${q.method()} ${q.url().replace(APP, '')}`) })
  page.on('requestfinished', async req => {
    const u = req.url()
    if (!u.startsWith(APP + '/api/')) return
    try {
      const s = await req.sizes()
      const t = req.timing()
      api.push({ path: new URL(u).pathname, bytes: s.responseBodySize + s.responseHeadersSize, ms: Math.round(t.responseEnd), at: Math.round(t.startTime) })
    } catch { /* gone */ }
  })
  const metrics = async () => {
    const dom = await page.evaluate(() => document.getElementsByTagName('*').length)
    let heapMB = null
    if (cdp) { const m = (await cdp.send('Performance.getMetrics')).metrics; heapMB = Math.round((m.find(x => x.name === 'JSHeapUsedSize')?.value ?? 0) / 1e5) / 10 }
    return { dom, heapMB }
  }
  const out = { blocked, errors }

  // 1. Start: signed in, page load -> tab bar.
  const t0 = Date.now()
  await page.goto(APP + '/', { waitUntil: 'commit' })
  await page.waitForSelector(PHONE ? '[data-tabbar]' : '[data-global-appointment]', { timeout: 120000 })
  out.start = Date.now() - t0
  await sleep(300)
  out.startApi = api.slice().sort((a, b) => b.bytes - a.bytes)
  out.startMetrics = await metrics()
  const longBefore = await page.evaluate(() => window.__long.length)

  // 2. Pipeline.
  let t = Date.now()
  if (PHONE) await page.locator('[data-tabbar] button:has-text("Pipeline")').click()
  else await go(page, '/pipeline')
  await page.waitForSelector('[data-kanban-board] [data-kanban-col]', { timeout: 60000 })
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0))))
  out.pipeline = Date.now() - t
  out.pipelineMetrics = { ...(await metrics()), cards: await page.locator('[data-kanban-card]').count(), cols: await page.locator('[data-kanban-col]').count() }
  out.pipelineLong = await page.evaluate(n => window.__long.slice(n), longBefore)

  // 3. A customer's page.
  const cid = process.env.CUSTOMER || await page.evaluate(async () => {
    const r = await fetch('/api/pipeline/board', { credentials: 'include', headers: { 'X-Staff-Request': '1' } }).catch(() => null)
    if (r && r.ok) { const j = await r.json(); for (const c of j.data?.columns ?? []) for (const l of c.cards ?? []) if (l.customerId) return l.customerId }
    const r2 = await fetch('/api/pipeline', { credentials: 'include', headers: { 'X-Staff-Request': '1' } })
    const j2 = await r2.json()
    return (j2.data?.leads ?? []).find(l => l.customerId && l.stage === 'Pending Signature')?.customerId ?? (j2.data?.leads ?? []).find(l => l.customerId)?.customerId
  })
  // 3a. The Customers list (every customer).
  t = Date.now()
  if (PHONE) await page.locator('[data-tabbar] button:has-text("Customers")').click()
  else await go(page, '/customers')
  await page.waitForSelector('[data-customer-count]', { timeout: 60000 })
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0))))
  out.customers = Date.now() - t
  out.customersDom = await page.evaluate(() => document.getElementsByTagName('*').length)

  t = Date.now()
  await go(page, `/customers/${encodeURIComponent(cid)}`)
  await page.waitForSelector('[data-customer-tab]', { timeout: 60000 })
  out.customer = Date.now() - t

  // 4. Follow ups.
  t = Date.now()
  if (PHONE) await page.locator('[data-tabbar] button:has-text("Follow ups")').click()
  else await go(page, '/follow-ups')
  await page.waitForSelector('[data-follow-ups-page]', { timeout: 60000 })
  await page.waitForFunction(() => document.querySelector('[data-follow-up-row], [data-follow-ups-empty]'), null, { timeout: 60000 }).catch(() => {})
  out.followups = Date.now() - t

  // 5. The quote builder (New quote).
  t = Date.now()
  await go(page, '/?quote=new')
  await page.waitForSelector('[data-quote-builder]', { timeout: 60000 })
  out.quote = Date.now() - t

  out.endMetrics = await metrics()
  out.longAll = await page.evaluate(() => window.__long)
  out.allApi = api.slice().sort((a, b) => b.ms - a.ms)
  await ctx.close()
  return out
}

const browser = await ENGINE.launch()
const runs = []
try {
  for (let i = 0; i < RUNS; i++) runs.push(await once(browser))
} finally { await browser.close() }

const med = k => { const v = runs.map(r => r[k]).sort((a, b) => a - b); return v[Math.floor(v.length / 2)] }
const r = runs[runs.length - 1]
const kb = b => `${Math.round(b / 1024)} KB`
const summary = {
  target: TARGET, engine: ENGINE_NAME, phone: PHONE, throttled: THROTTLE, runs: RUNS,
  ms: { start: med('start'), pipeline: med('pipeline'), customers: med('customers'), customer: med('customer'), followups: med('followups'), quote: med('quote') },
  startApiTop: r.startApi.slice(0, 10).map(a => `${a.path} ${kb(a.bytes)} ${a.ms} ms`),
  startApiTotal: kb(r.startApi.reduce((s, a) => s + a.bytes, 0)),
  startApiCount: r.startApi.length,
  customersDom: r.customersDom, startMetrics: r.startMetrics, pipelineMetrics: r.pipelineMetrics, endMetrics: r.endMetrics,
  longTasks: { count: r.longAll.length, totalMs: r.longAll.reduce((s, x) => s + x.ms, 0), longestMs: Math.max(0, ...r.longAll.map(x => x.ms)), onPipeline: r.pipelineLong },
  slowestApi: r.allApi.slice(0, 12).map(a => `${a.path} ${a.ms} ms ${kb(a.bytes)}`),
  blocked: [...new Set(runs.flatMap(x => x.blocked))], errors: [...new Set(runs.flatMap(x => x.errors))].slice(0, 5),
}
console.log(JSON.stringify(summary, null, 2))
if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify({ summary, runs }, null, 2))
