// The website quote drawn on the photo, through the PUBLIC door (Funnel 8443,
// the LIVE server), the way a customer's phone reaches it from
// www.gdfencepro.com, in TEST MODE ONLY (?test=1): address → the real photo
// → draw a backyard with a gate → slide the gate → vinyl → contact → the
// prices. Nothing is saved: test mode writes no draft and no lead, every
// request that is not a GET must carry test mode or it is stopped before it
// leaves, and the live database is only read (read only session) to prove no
// lead was made.
//
// Run only after the deploy, with Jonathan's OK:
//   PUBLIC_WIDGET_TEST=1 [PUBLIC_IP=<public door ip>] [SHOTS=<folder>] node e2e/widget-draw-public.mjs
//
// Not guarded by devOnly.mjs on purpose (like live-readonly.mjs): it is read
// only by design and never signs in.

import { webkit, chromium } from 'playwright'
import { execSync } from 'child_process'
import fs from 'fs'

if (process.env.PUBLIC_WIDGET_TEST !== '1') { console.error('Refusing to run: set PUBLIC_WIDGET_TEST=1 (live server, test mode only, after the deploy, with Jonathan\'s OK).'); process.exit(2) }
const WIDGET = process.env.WIDGET_URL || 'https://jonathans-mac-mini.tail40fb4a.ts.net:8443/p/quote/'
const PAGE = `${WIDGET}?test=1`
const SHOTS = process.env.SHOTS || ''
const HOST = 'https://www.gdfencepro.com/instant-quote'
const NAME = 'E2E Public Door Test'
const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
/** Live database, read only. */
const leads = () => Number(execSync(`PGOPTIONS='-c default_transaction_read_only=on' psql -d ezbiz -At -c "select count(*) from \\"IntakeLead\\" where name='${NAME}'"`).toString().trim())
const host = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0"><header style="background:#1c1030;color:#fff;padding:10px">Getter Done Fence</header>
<iframe id="w" src="${PAGE}" title="Get an instant fence estimate" style="width:100%;max-width:640px;height:880px;border:0;display:block;margin:0 auto;" allow="camera"></iframe></body></html>`

const before = leads()
const blocked = []
const args = process.env.PUBLIC_IP ? { args: [`--host-resolver-rules=MAP ${new URL(WIDGET).hostname} ${process.env.PUBLIC_IP}`] } : {}
for (const [label, engine, opts] of [['iPhone (WebKit)', webkit, { viewport: { width: 390, height: 844 }, hasTouch: true }], ['Android (Chromium)', chromium, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }]]) {
  const browser = await engine.launch(engine === chromium ? args : {})
  try {
    const ctx = await browser.newContext(opts)
    // Read only: a request that is not a GET goes out only when it is test mode. The stand-in for the
    // website page is answered here too: Playwright runs the route added last first, so a separate
    // route for it would never be reached and the real website would load instead.
    await ctx.route('**/*', r => {
      const q = r.request()
      if (q.url() === HOST) return r.fulfill({ contentType: 'text/html', body: host })
      if (q.method() === 'GET' || q.method() === 'HEAD' || q.method() === 'OPTIONS') return r.continue()
      const body = q.postData() || ''
      const ok = q.url().startsWith(WIDGET) && (/"test":true/.test(body) || /[?&]test=1/.test(q.url()))
      if (!ok) { blocked.push(`${q.method()} ${q.url()}`); return r.abort() }
      return r.continue()
    })
    const page = await ctx.newPage()
    await page.goto(HOST); await sleep(4000)
    const w = page.frameLocator('#w')
    check(`${label}: the widget opens in test mode inside the website's frame`, await w.locator('[data-w-test-banner]').isVisible().catch(() => false))
    await w.locator('[data-w-address]').fill('110 SE Watula'); await sleep(2500)
    await w.locator('[data-w-suggestion]').first().click(); await sleep(1000)
    await w.locator('[data-w-step="draw"] .leaflet-tile-loaded').first().waitFor({ timeout: 45000 }).catch(() => {})
    await sleep(6000)
    check(`${label}: the real aerial photo loads on the house`, (await w.locator('[data-w-step="draw"] .leaflet-tile-loaded').count()) > 0)
    if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: `${SHOTS}/public-${label.split(' ')[0]}-photo.png` }) }
    const box = await w.locator('.leaflet-container').boundingBox()
    const c = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    for (const [dx, dy] of [[-40, 20], [-70, 20], [-70, -80], [70, -80], [70, 20], [40, 20]]) { await page.mouse.click(c.x + dx, c.y + dy); await sleep(400) }
    await w.locator('[data-w-done]').click(); await sleep(400)
    await w.locator('[data-w-add-gate]').click(); await page.mouse.click(c.x - 70, c.y - 30); await sleep(400)
    await w.locator('[data-w-gate-size="walk-4"]').click(); await sleep(300)
    const g = await w.locator('[data-w-gate-mark]').boundingBox()
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2); await page.mouse.down(); await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2 + 25, { steps: 6 }); await page.mouse.up(); await sleep(300)
    check(`${label}: a backyard with a gate, slid along its side`, (await w.locator('[data-w-point]').count()) === 6 && (await w.locator('[data-w-gate-mark]').count()) === 1)
    await w.locator('[data-w-step="draw"] [data-w-next]').click(); await sleep(300)
    await w.locator('[data-w-material="vinyl"]').click(); await sleep(300)
    await w.locator('[data-w-step="fence"] [data-w-next]').click(); await sleep(300)
    await w.locator('[data-w-name]').fill(NAME); await w.locator('[data-w-phone]').fill('352-555-0100')
    await w.locator('[data-w-send]').click()
    await w.locator('[data-w-option]').first().waitFor({ timeout: 45000 }).catch(() => {})
    const opts2 = await w.locator('[data-w-option]').count()
    check(`${label}: the prices show (test mode)`, opts2 >= 1)
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/public-${label.split(' ')[0]}-price.png` })
    await ctx.close()
  } catch (e) { check(`${label}: run finished`, false, String(e?.message || e).split('\n')[0]) }
  await browser.close()
}
check('nothing that writes left the browser (only test mode calls)', blocked.length === 0, blocked.join(' | '))
check('no lead was made on live', leads() === before, `before ${before}, after ${leads()}`)
const passed = results.filter(Boolean).length
console.log(`\n${passed} of ${results.length} checks passed`)
process.exit(passed === results.length ? 0 : 1)
