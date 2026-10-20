// A phone that keeps the app open takes a new version by itself.
//
//   E2E_ACCESS_TOKEN=<dev staff token> node e2e/app-update.mjs
//
// On the dev server's built app (4001): the page on the server is made to name
// a newer app file. Brought back to the screen with nothing waiting, the app
// reloads by itself. With a quote open and changed (unsaved), it does not:
// "A newer version of EZ Biz is ready" shows, and Update says to finish first.
import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import { chromium } from 'playwright'
const APP = 'http://localhost:4001', TOKEN = process.env.E2E_ACCESS_TOKEN || ''
if (!TOKEN) { console.error('Set E2E_ACCESS_TOKEN.'); process.exit(2) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const b = await chromium.launch()
async function open() {
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  await c.addInitScript(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, TOKEN)
  let newer = false
  // The fetch of "/" the check makes: once "deployed", it names another app file.
  await c.route(`${APP}/`, async r => {
    const res = await r.fetch(); let html = await res.text()
    // Once: after the reload the phone runs what the server has, as it would.
    if (newer && r.request().resourceType() === 'fetch') { newer = false; html = html.replace(/\/assets\/index-[\w-]+\.js/, '/assets/index-NEWER123.js') }
    await r.fulfill({ response: res, body: html })
  })
  const p = await c.newPage()
  await p.goto(APP); await p.waitForSelector('[data-tabbar]', { timeout: 60000 }); await sleep(1500)
  return { c, p, deploy: () => { newer = true } }
}
const backOnScreen = p => p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')) })
try {
  // 1. Nothing waiting: reloads by itself.
  let s = await open()
  await s.p.evaluate(() => { window.__marker = 1 })
  s.deploy()
  const nav = s.p.waitForEvent('framenavigated', { timeout: 15000 }).then(() => true, () => false)
  await backOnScreen(s.p)
  check('back on screen with nothing waiting: the app reloads by itself', await nav)
  await s.p.waitForSelector('[data-tabbar]', { timeout: 60000 })
  check('and it is a fresh page', (await s.p.evaluate(() => window.__marker)) === undefined)
  await s.c.close()

  // 2. A quote open with unsaved changes: it waits and says so.
  s = await open()
  await s.p.locator('[data-tabbar] >> text=Pipeline').first().click(); await sleep(800)
  await s.p.goto(`${APP}/quotes`); await s.p.waitForSelector('[data-tabbar]'); await sleep(1500)
  await s.p.locator('button:has-text("New quote"):visible').first().click(); await s.p.waitForSelector('[data-quote-builder]'); await sleep(500)
  await s.p.locator('[data-quote-builder] input').first().fill('Unsaved Update Test'); await sleep(300)
  await s.p.evaluate(() => { window.__marker = 2 })
  s.deploy()
  await backOnScreen(s.p); await sleep(2500)
  check('unsaved quote open: no reload', (await s.p.evaluate(() => window.__marker)) === 2)
  check('"A newer version of EZ Biz is ready" shows', (await s.p.locator('[data-update-ready]').count()) === 1)
  await s.p.locator('[data-update-ready] button').click(); await sleep(800)
  check('Update while unsaved says to finish first, and keeps the work', (await s.p.evaluate(() => window.__marker)) === 2 && /Not yet/.test(await s.p.locator('body').textContent()))
  await s.c.close()
} catch (e) {
  check('test run finished', false, String(e?.message || e).slice(0, 200))
}
await b.close()
const failed = results.filter(r => !r).length
console.log(`\n${results.length - failed} of ${results.length} checks passed`)
process.exit(failed ? 1 : 0)
