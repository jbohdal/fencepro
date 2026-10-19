// Commercial and industrial on hold: the "Available for quoting" switch per style.
//
//   E2E_ACCESS_TOKEN=<dev owner token> EZ_QUOTE_WIDGET_TOKEN=<from apps/portal/.env> \
//     APP_URL=http://localhost:4001 SHOTS=<folder, optional> node e2e/quotable-styles.mjs
//
// Dev only (4001). With the five styles off: Settings shows the switches off,
// the quote builder's style list, the website widget, /api/quotes and
// /api/quoting leave them out (asking for one gets "Call us for commercial
// and industrial fencing"), and a saved CL - Com 6' quote still opens and
// prices. Then CL - Com 6' is switched back on in Settings and comes back in
// each place. The styles and the test quote are put back after.
import { chromium } from 'playwright'
const APP = process.env.APP_URL || 'http://localhost:4001'
const TOKEN = process.env.E2E_ACCESS_TOKEN || '', WIDGET = process.env.EZ_QUOTE_WIDGET_TOKEN || '', SHOTS = process.env.SHOTS || ''
if (!/localhost:4001/.test(APP)) { console.error('Refusing to run: the dev copy only.'); process.exit(2) }
if (!TOKEN || !WIDGET) { console.error('Set E2E_ACCESS_TOKEN and EZ_QUOTE_WIDGET_TOKEN.'); process.exit(2) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const call = async (p, init = {}, token = TOKEN) => (await fetch(APP + p, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) } })).json()
const post = (p, body, token) => call(p, { method: 'POST', body: JSON.stringify(body) }, token)
const MSG = 'Call us for commercial and industrial fencing'
const HELD = ["CL - Com 6'", "CL - Com 6'+1'", "CL - Com 6'+1' Black", 'Alum - DS - Ind Abigail', 'Durafence']
// What the quote builder's list shows: plain names (the codes stay the internal names).
const LABEL = { "CL - Com 6'": 'Galvanized Chain Link, 6 ft, Commercial, No dig', "CL - Com 6'+1'": 'Galvanized Chain Link, 6 ft + 1 ft barbed wire, Commercial, No dig', "CL - Com 6'+1' Black": 'Black Chain Link, 6 ft + 1 ft barbed wire, Commercial, No dig', 'Alum - DS - Ind Abigail': 'Aluminum Industrial Abigail, 6 ft tall, Dig set', Durafence: 'Durafence', "CL - 6' Galv": 'Galvanized Chain Link, 6 ft, Residential, No dig' }
const job = fenceStyle => ({ fenceStyle, runs: [100], corners: 0, ends: 2, walkGates: 0, dblGates: 0 })
const bs = async () => (await call('/api/business-state')).data
async function setQuotable(fn) {
  for (let i = 0; i < 5; i++) {
    const s = await bs()
    const r = await call('/api/business-state', { method: 'PATCH', body: JSON.stringify({ config: { ...s.config, fenceStyles: s.config.fenceStyles.map(st => HELD.includes(st.name) ? { ...st, quotable: fn(st.name) } : st) }, baseVersion: s.version }) })
    if (r.success) return
  }
  throw new Error('could not save the styles')
}
const before = Object.fromEntries((await bs()).config.fenceStyles.filter(s => HELD.includes(s.name)).map(s => [s.name, s.quotable]))
/** The server reads Settings again every few seconds: wait until the estimate for this style answers as expected. */
async function settle(style, quotable) { for (let i = 0; i < 15; i++) { const r = await post('/api/quotes/calculate', { ...job(style), tearOutSections: 0, tearOutGates: 0, adjLaborHrs: 0 }); if (!!r.success === quotable) return; await sleep(1000) } }

const browser = await chromium.launch()
let quoteId = ''
try {
  await setQuotable(() => false)
  await settle("CL - Com 6'", false)

  // ── Server: every customer door leaves them out ──
  const styles = (await call('/api/quotes/styles')).data.map(s => s.name)
  check('/api/quotes/styles (chat) leaves the five out', HELD.every(h => !styles.includes(h)) && styles.includes("CL - 6' Galv"), `${styles.length} styles`)
  const qStyles = (await call('/api/quoting/styles', {}, WIDGET)).styles.map(s => s.name)
  check('/api/quoting/styles (phone agent, EZ Quote) leaves the five out', HELD.every(h => !qStyles.includes(h)))
  const wcfg = await (await fetch(`${APP}/p/quote/api/config`)).json()
  const wApps = JSON.stringify(wcfg.materials)
  check('website widget: no commercial chain link, no Industrial Abigail', !wcfg.materials.some(m => m.material === 'chain-link-commercial') && !/Ind Abigail/.test(wApps))
  check('website widget: offers "Commercial / Industrial" with the message and the business phone', wcfg.onHold?.message === MSG && !!wcfg.onHold?.phone, JSON.stringify(wcfg.onHold))
  for (const s of HELD) {
    const w = await (await fetch(`${APP}/p/quote/api/estimate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(job(s)) })).json()
    const q = await post('/api/quoting/estimate', job(s), WIDGET)
    const quick = await post('/api/quotes/quick-estimate', { fenceStyle: s, linearFootage: 100 })
    check(`${s}: widget, phone agent and chat all answer "${MSG}"`, w.error === MSG && q.message === MSG && quick.data?.message === MSG && !q.estimate && !w.estimate, `${w.error} | ${q.message} | ${quick.data?.message}`)
  }
  const ok = await post('/api/quoting/estimate', job("CL - 6' Galv"), WIDGET)
  check('other styles still estimate', ok.success && ok.estimate > 0)

  // ── Settings: the switch ──
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await ctx.addInitScript(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, TOKEN)
  const page = await ctx.newPage()
  const errs = []; page.on('pageerror', e => errs.push(String(e).slice(0, 200)))
  page.on('dialog', d => d.accept().catch(() => {}))
  await page.route('**/api/automations/trigger', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' }))
  await page.goto(`${APP}/settings?tab=styles`); await page.waitForSelector('[data-style-quotable]', { timeout: 60000 }); await sleep(800)
  const sw = await page.locator('[data-style-quotable]').evaluateAll(els => els.map(e => [e.getAttribute('data-style-quotable'), e.getAttribute('aria-checked')]))
  check('Settings → Fence Styles: "Available for quoting" off for exactly the five', sw.filter(([, on]) => on === 'false').map(([n]) => n).sort().join('|') === [...HELD].sort().join('|'), sw.filter(([, on]) => on === 'false').map(([n]) => n).join(', '))
  if (SHOTS) {
    await page.locator('[data-style-quotable="CL - Com 6\'"]').scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${SHOTS}/dev-style-quotable-switch.png` })
  }

  // ── Quote builder: a new quote does not offer them ──
  const pickerNames = async () => (await page.locator('[data-step-panel="style"] select').first().locator('option').allTextContents()).map(t => t.trim())
  await page.goto(`${APP}/quotes?quote=new`); await page.waitForSelector('[data-quote-builder]', { timeout: 60000 }); await sleep(800)
  await page.locator('[data-step="style"]').first().click(); await sleep(500)
  let names = await pickerNames()
  check('quote builder: a new quote\'s style list leaves the five out', HELD.every(h => !names.some(n => n.startsWith(LABEL[h]))) && names.includes(LABEL["CL - 6' Galv"]), `${names.length - 1} styles`)

  // ── A saved quote on CL - Com 6' still opens and prices ──
  const made = await post('/api/saved-quotes', { customerName: 'E2E Commercial on hold', ...job("CL - Com 6'"), runs: [150, 80], corners: 1, ends: 2, sections: 0, status: 'DRAFT', finalPrice: 0, date: '2026-10-19' })
  quoteId = made.data?.id
  await page.goto(`${APP}/quotes?quote=${quoteId}`); await page.waitForSelector('[data-quote-price]', { timeout: 60000 }); await sleep(1500)
  const price = Number((await page.locator('[data-quote-price]').textContent()).replace(/[$,\s]/g, ''))
  await page.locator('[data-step="style"]').first().click(); await sleep(500)
  names = await pickerNames()
  const chosen = await page.locator('[data-step-panel="style"] select').first().evaluate(s => s.options[s.selectedIndex]?.textContent)
  check('saved CL - Com 6\' quote: opens with its style, marked "Not available for new quotes"', chosen === `${LABEL["CL - Com 6'"]} (Not available for new quotes)` && await page.locator('[data-style-not-quotable]').isVisible(), chosen)
  check('saved CL - Com 6\' quote: still prices', price > 0, `$${price}`)
  check('saved CL - Com 6\' quote: the other on hold styles are still not offered', HELD.slice(1).every(h => !names.some(n => n.startsWith(LABEL[h]))))
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/dev-quote-style-picker.png` })
  await page.goto(`${APP}/`); await sleep(500)

  // ── The widget on a phone: Commercial / Industrial says to call ──
  const wctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  const w = await wctx.newPage()
  await w.goto(`${APP}/p/quote/`); await w.waitForSelector('[data-w-address]', { timeout: 30000 })
  await w.locator('[data-w-address]').fill('201 SE 3rd St, Ocala, FL 34471')
  await w.locator('[data-w-next]').click(); await sleep(4000)
  if (await w.locator('[data-w-step="address"]').count()) await w.locator('[data-w-next]').click()
  await w.locator('[data-w-shape="straight"]').click(); await sleep(400)
  await w.locator('[data-w-side] [data-w-length]').first().click()
  for (const k of '100') await w.locator(`[data-ftin-pad] [data-pad-key="${k}"]`).click()
  await w.locator('[data-ftin-pad] [data-pad-done]').click(); await sleep(200)
  await w.locator('[data-w-step="yard"] [data-w-next]').click(); await sleep(400)
  check('widget: commercial chain link is not a material choice', await w.locator('[data-w-material="chain-link-commercial"]').count() === 0)
  await w.locator('[data-w-material="commercial-industrial"]').click(); await sleep(300)
  const line = await w.locator('[data-w-on-hold]').textContent().catch(() => '')
  check('widget: picking Commercial / Industrial shows the message and the phone', line.startsWith(MSG) && /\(\d{3}\) \d{3}-\d{4}/.test(line), line)
  check('widget: no estimate can be asked for it', await w.locator('[data-w-step="fence"] [data-w-next]').isDisabled())
  if (SHOTS) await w.screenshot({ path: `${SHOTS}/dev-widget-commercial.png` })
  await wctx.close()

  // ── Switched back on in Settings: back everywhere ──
  await page.goto(`${APP}/settings?tab=styles`); await page.waitForSelector('[data-style-quotable]', { timeout: 60000 }); await sleep(800)
  await page.locator('[data-style-quotable="CL - Com 6\'"]').click()
  await page.locator('button:has-text("Save Changes")').click(); await sleep(2500)
  const saved = (await bs()).config.fenceStyles.find(s => s.name === "CL - Com 6'")
  check('the switch saves: CL - Com 6\' available for quoting', saved?.quotable === true)
  await settle("CL - Com 6'", true)
  const styles2 = (await call('/api/quotes/styles')).data.map(s => s.name)
  const wcfg2 = await (await fetch(`${APP}/p/quote/api/config`)).json()
  const q2 = await post('/api/quoting/estimate', job("CL - Com 6'"), WIDGET)
  check('back on: chat and phone agent list it and estimate it', styles2.includes("CL - Com 6'") && q2.success && q2.estimate > 0, `$${q2.estimate}`)
  check('back on: the widget offers Commercial Chain Link again', wcfg2.materials.some(m => m.material === 'chain-link-commercial' && JSON.stringify(m).includes("CL - Com 6'")))
  await page.goto(`${APP}/quotes?quote=new`); await page.waitForSelector('[data-quote-builder]', { timeout: 60000 }); await sleep(800)
  await page.locator('[data-step="style"]').first().click(); await sleep(500)
  names = await pickerNames()
  check('back on: the quote builder offers it for new quotes, unmarked', names.includes(LABEL["CL - Com 6'"]) && !names.includes(LABEL["CL - Com 6'+1'"]))
  check('no page errors', errs.length === 0, errs.join(' | '))
} catch (e) {
  check('test run finished', false, String(e?.message || e).split('\n').slice(0, 3).join(' '))
} finally {
  if (quoteId) await fetch(`${APP}/api/saved-quotes/${quoteId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${TOKEN}` } })
  await setQuotable(n => before[n]).catch(e => check('styles put back', false, String(e)))
  await browser.close()
}
const failed = results.filter(r => !r).length
console.log(`\n${results.length - failed} of ${results.length} checks passed`)
process.exit(failed ? 1 : 0)
