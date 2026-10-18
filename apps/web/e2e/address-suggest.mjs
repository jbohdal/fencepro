// Address suggestions as an address is typed: Marion County's property list
// on the Mac, then the Census lookup. Dev only (4001), writes nothing.
//
//   E2E_ACCESS_TOKEN=<dev staff token> SHOTS=<folder, optional> node e2e/address-suggest.mjs
import { chromium } from 'playwright'
const APP = 'http://localhost:4001', TOKEN = process.env.E2E_ACCESS_TOKEN || '', SHOTS = process.env.SHOTS || ''
if (!TOKEN) { console.error('Set E2E_ACCESS_TOKEN.'); process.exit(2) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const b = await chromium.launch()
try {
  const api = await (await fetch(`${APP}/api/appointments/geo/suggest?q=${encodeURIComponent('17008 SE 60')}`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json()
  check('suggest: "17008 SE 60" gives 17008 SE 60th St, Ocklawaha, FL 32179', api.data?.[0]?.formatted === '17008 SE 60th St, Ocklawaha, FL 32179' && Number.isFinite(api.data[0].lat), JSON.stringify(api.data?.[0]))
  const rural = await (await fetch(`${APP}/api/appointments/geo/suggest?q=${encodeURIComponent('9161 Northeast 310')}`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json()
  check('rural Fort McCoy, typed the long way: found', rural.data?.[0]?.formatted === '9161 NE 310th Ave, Fort McCoy, FL 32134', rural.data?.[0]?.formatted)
  const noAuth = await fetch(`${APP}/api/appointments/geo/suggest?q=17008`)
  check('suggest needs a staff sign in', noAuth.status === 401, String(noAuth.status))

  // Phone: a new lead from the pipeline, one tap fills street, city, state and ZIP.
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  await c.addInitScript(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, TOKEN)
  await c.route('**/api/**', r => ['GET', 'HEAD'].includes(r.request().method()) ? r.continue() : r.abort())
  const p = await c.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 200)))
  await p.goto(`${APP}/pipeline`); await p.waitForSelector('[data-tabbar]', { timeout: 60000 }); await sleep(1500)
  await p.locator('button[aria-label="New Lead"]').click()
  await p.locator('[data-lead-field="street"]').fill('17008 SE 60'); await sleep(1200)
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/dev-address-suggestions.png` })
  const shown = await p.locator('[data-address-suggestion]').allTextContents()
  check('suggestions show under the street box', shown.length > 0 && /17008 SE 60th St/.test(shown[0]), shown.slice(0, 2).join(' | '))
  await p.locator('[data-address-suggestion]').first().click(); await sleep(300)
  const vals = await p.evaluate(() => ['street', 'city'].map(k => document.querySelector(`[data-lead-field="${k}"]`)?.value))
  const all = await p.evaluate(() => [...document.querySelectorAll('input')].map(i => i.value))
  check('one tap fills street, city, state and ZIP', vals[0] === '17008 SE 60th St' && vals[1] === 'Ocklawaha' && all.includes('FL') && all.includes('32179'), JSON.stringify(vals))
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/dev-address-filled.png` })
  // Typed by hand, nothing matching: kept as typed.
  await p.locator('[data-lead-field="street"]').fill('99999 Nowhere Lane'); await sleep(1200)
  check('an address nothing matches: kept as typed, no suggestions', (await p.locator('[data-lead-field="street"]').inputValue()) === '99999 Nowhere Lane' && (await p.locator('[data-address-suggestion]').count()) === 0)
  check('no page errors', errs.length === 0, errs.join(' | '))
  await c.close()

  // The website instant quote.
  const w = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const wp = await w.newPage()
  await wp.goto(`${APP}/p/quote/`); await wp.waitForSelector('[data-w-address]')
  await wp.locator('[data-w-address]').fill('3995 NE 58'); await sleep(1500)
  const ws = await wp.locator('[data-w-suggestion]').allTextContents()
  check('website instant quote: suggestions as the customer types', ws.length > 0 && /3995 NE 58th Cir/.test(ws[0]), ws.slice(0, 2).join(' | '))
  await wp.locator('[data-w-suggestion]').first().click()
  check('picked: the full address is in the box', (await wp.locator('[data-w-address]').inputValue()) === '3995 NE 58th Cir, Silver Springs, FL 34488')
  if (SHOTS) await wp.screenshot({ path: `${SHOTS}/dev-widget-address-picked.png` })
  await w.close()
} catch (e) {
  check('test run finished', false, String(e?.message || e).slice(0, 200))
}
await b.close()
const failed = results.filter(r => !r).length
console.log(`\n${results.length - failed} of ${results.length} checks passed`)
process.exit(failed ? 1 : 0)
