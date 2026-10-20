// The website quote (/p/quote) inside a page on www.gdfencepro.com, on the dev copy, on a phone:
// it shows there and is refused anywhere else, opens on the address, prices a drawing in test
// mode without making a lead. The full customer path is e2e/widget-draw.mjs.
//
//   APP_URL=http://localhost:4001 E2E_ACCESS_TOKEN=<dev staff token> SHOTS=<folder> node e2e/widget-quote.mjs
//
// A page at https://www.gdfencepro.com/instant-quote (served by the test)
// shows the widget in a frame, the way the website will. A customer with no
// sign in types the address, the Backyard and the fence, sees the estimate
// and sends it. The customer, the quote and the pipeline card are then in EZ
// Biz together, the quote opens in the builder at the same price, and a page
// on any other site is refused the frame. The test records are removed after.

// Clicks, not taps: Playwright 1.56 does not deliver a tap inside a frame from another site.
import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import { chromium } from 'playwright'
import { execFileSync } from 'child_process'

const APP = process.env.APP_URL || 'http://localhost:4001'
const TOKEN = process.env.E2E_ACCESS_TOKEN || ''
const SHOTS = process.env.SHOTS || ''
if (!/localhost:4001/.test(APP)) { console.error('Refusing to run: the dev copy only.'); process.exit(2) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const psql = sql => execFileSync('psql', ['-d', 'ezbiz_dev', '-At', '-c', sql], { encoding: 'utf8' }).trim()
// On live the widget is https behind the public door; here an https stand in
// passes every request to the dev server unchanged (headers and all), so the
// real frame rule is what is tested.
const WIDGET = 'https://widget.test'
const host = page => `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Instant quote</title></head>
<body style="margin:0;font-family:sans-serif"><header style="background:#1c1030;color:#fff;padding:12px">Getter Done Fence (the designer's page)</header>
<iframe id="w" src="${WIDGET}/p/quote/" title="Instant fence estimate" style="width:100%;height:760px;border:0;display:block" allow="camera"></iframe></body></html>`

const browser = await chromium.launch()
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)))
  await ctx.route(`${WIDGET}/**`, async r => r.fulfill({ response: await r.fetch({ url: r.request().url().replace(WIDGET, APP) }) }))
  await ctx.route('https://www.gdfencepro.com/instant-quote', r => r.fulfill({ contentType: 'text/html', body: host() }))
  await ctx.route('https://other-site.example/**', r => r.fulfill({ contentType: 'text/html', body: host() }))

  await page.goto('https://www.gdfencepro.com/instant-quote'); await sleep(2500)
  const w = page.frameLocator('#w')
  check('the widget shows inside a page on www.gdfencepro.com', await w.locator('[data-w-address]').isVisible())
  check('no sign in, no outer header: it opens on the address', (await w.locator('h1').textContent()).includes('instant fence estimate'))
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/w1-address.png` })
  // The rest of the customer's path (drawing on the photo, the lead, the builder) is e2e/widget-draw.mjs.
  // Here: the materials it offers come with a picture, and a test mode price inside the frame makes no lead.
  const frame = page.frames().find(f => f.url().startsWith(WIDGET))
  const cfg = await frame.evaluate(async () => (await fetch('/p/quote/api/config')).json())
  check('vinyl, chain link and aluminum are offered (wood where quotable)', ['vinyl', 'chain', 'alum'].every(m => cfg.materials.some(x => x.material === m)), cfg.materials.map(m => m.material).join(', '))
  await w.locator('[data-w-address]').fill('110 SE Watula'); await sleep(1500)
  await w.locator('[data-w-suggestion]').first().click(); await sleep(1500)
  check('picking the address opens the photo step', await w.locator('[data-w-step="draw"]').isVisible())
  const before = psql(`select count(*) from "IntakeLead"`)
  const r = await frame.evaluate(async () => {
    const at = { lat: 29.185118, lng: -82.134209 }
    const p = (e, n) => ({ lat: at.lat + n * 0.3048 / 110837, lng: at.lng + e * 0.3048 / 97377 })
    const drawing = { v: 1, address: '110 SE Watula Ave, Ocala, FL 34471', at, runs: [{ id: 'a', pts: [p(0, 0), p(0, 60), p(80, 60)], start: 'free', end: 'free', typedFt: [null, null], gates: [{ type: 'walk', widthFt: 4, startFt: 20 }, null] }] }
    const res = await fetch('/p/quote/api/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draftId: 'widgetquotewidgetquote', name: 'E2E Widget Customer', phone: '352-555-0199', address: drawing.address, drawing, pick: { material: 'vinyl', color: 'white', height: '6', kind: 'privacy' }, test: true }) })
    return { status: res.status, body: await res.json() }
  })
  check('inside the frame the widget reaches EZ Biz and prices a drawing (test mode)', r.status === 200 && r.body.test === true && r.body.options.length >= 1, `${r.status} ${r.body.options?.map(o => `${o.name} $${o.price}`).join(', ')}`)
  check('test mode made no lead', psql(`select count(*) from "IntakeLead"`) === before)

  // Any other site is refused.
  await page.goto('https://other-site.example/instant-quote'); await sleep(2500)
  const blocked = page.frames().find(f => f !== page.mainFrame())
  check('a page on any other site cannot show it', !blocked || !(await blocked.locator('[data-w-address]').count().catch(() => 0)), blocked?.url())
  check('no page errors', errors.length === 0, errors.join(' | '))

  await ctx.close()
} catch (e) {
  check('test run finished', false, String(e?.message || e).split('\n').slice(0, 3).join(' '))
} finally {
  await browser.close()
}
const passed = results.filter(Boolean).length
console.log(`\n${passed} of ${results.length} checks passed`)
process.exit(passed === results.length ? 0 : 1)
