// The Finish setup card: every item's Open lands on the screen (and filter) to do that task.
//
//   E2E_ACCESS_TOKEN=<dev owner token> APP_URL=http://localhost:4001 API_URL=http://localhost:4001 \
//     SHOTS=<folder, optional> node e2e/finish-setup.mjs
//
// Dev only (4001). Reads the list from the server, then for each item that
// is not done clicks its Open on the dashboard card and checks where it
// lands. Writes nothing.
import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import { chromium } from 'playwright'
const APP = process.env.APP_URL || 'http://localhost:4001', API = process.env.API_URL || 'http://localhost:4001'
const TOKEN = process.env.E2E_ACCESS_TOKEN || '', SHOTS = process.env.SHOTS || ''
if (!TOKEN) { console.error('Set E2E_ACCESS_TOKEN.'); process.exit(2) }
// The dev copy (4001) or a worktree's own dev server on another port; never 4000 (live).
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+/.test(API) || !/^http:\/\/(localhost|127\.0\.0\.1):\d+/.test(APP) ||/:4000(\/|$)/.test(API) || /:4000(\/|$)/.test(APP)) { console.error('Dev only (localhost, not 4000).'); process.exit(2) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const api = async p => (await (await fetch(API + p, { headers: { Authorization: `Bearer ${TOKEN}` } })).json()).data

const list = await api('/api/system/setup')
const keys = list.map(i => i.key)
check('items that no longer apply are gone (Abigail width; no Google secret item)', !keys.includes('abigail') && !keys.some(k => /secret/i.test(k)), keys.join(', '))
check('every item with a screen has a link; the Mac-side ones have none', list.every(i => (['xcode', 'uptimerobot', 'offsite-backup'].includes(i.key) ? !i.link : !!i.link)))

const b = await chromium.launch()
const c = await b.newContext({ viewport: { width: 1440, height: 900 } })
await c.addInitScript(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, TOKEN)
const p = await c.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 200)))
const inView = sel => p.locator(sel).first().evaluate(el => { const r = el.getBoundingClientRect(); return r.top >= -2 && r.top < window.innerHeight - 40 }).catch(() => false)

/** What each item's screen must show once its Open is clicked. */
const EXPECT = {
  'sub-rates': async () => {
    const tab = await p.locator('[data-settings-tab="pricing"][aria-pressed="true"]').count()
    await sleep(600)
    return [tab === 1 && await inView('[data-settings-focus="sub-rates"]'), 'Settings, Pricing tab, scrolled to Subcontractor rates']
  },
  'inventory-prices': async () => {
    await p.waitForSelector('[data-price-filter]', { timeout: 20000 })
    const v = await p.locator('[data-price-filter]').inputValue()
    return [v === 'unconfirmed', `Inventory, Catalog, price filter "${v}"`]
  },
  'fill-in': async () => { await p.waitForSelector('[data-fill-in]', { timeout: 20000 }); return [true, 'Inventory, Fill in tab'] },
  'bell-cost': async () => {
    await p.waitForSelector('[data-material-kits]', { timeout: 20000 })
    const style = await p.locator('[data-kit-style]').inputValue()
    const note = await p.locator(`[data-kit-cost-review="WV-ND Bell 4'x6'"]`).count()
    return [style === "WV-ND Bell 4'x6'" && note === 1, `Inventory, Material Kits on "${style}", cost reminder ${note ? 'shown' : 'missing'}`]
  },
  'close-out': async item => {
    await p.waitForSelector('[data-ops-link-filter]', { timeout: 20000 }); await sleep(800)
    const n = Number(await p.locator('[data-ops-link-count]').getAttribute('data-ops-link-count'))
    const want = item.detail.split('. Done')[0].split('; ').length
    const text = await p.locator('main, body').first().innerText()
    const names = item.detail.split('. Done')[0].split('; ').map(x => x.split(':')[0])
    return [n === want && names.every(nm => text.includes(nm)), `Operations list of ${n} job(s): ${names.join(', ')}`]
  },
  'off-schedule': async item => {
    await p.waitForSelector('[data-ops-link-filter]', { timeout: 20000 }); await sleep(800)
    const n = Number(await p.locator('[data-ops-link-count]').getAttribute('data-ops-link-count'))
    const want = Number(item.label.match(/The (\d+) jobs/)?.[1])
    return [n === want && n > 0, `Operations searched "not on GD Schedule": ${n} of ${want}`]
  },
  'schedule-contacts': async item => {
    await p.waitForSelector('[data-customer-filter]', { timeout: 20000 }); await sleep(800)
    const v = await p.locator('[data-customer-filter]').inputValue()
    const n = Number(await p.locator('[data-customer-count]').getAttribute('data-customer-count'))
    const want = Number(item.detail.match(/^(\d+)/)?.[1])
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/dev-customers-missing-contact.png` })
    return [v === 'missing-contact-schedule' && n === want, `Customers filtered "${v}": ${n} shown, card says ${want}`]
  },
  'google-calendar': async () => {
    await p.waitForSelector('[data-calendar-settings]', { timeout: 20000 })
    return [await p.locator('[data-settings-tab="calendar"][aria-pressed="true"]').count() === 1, 'Settings, Google Calendar tab']
  },
  'voice-check': async () => {
    await p.waitForSelector('[data-voice-check]', { timeout: 20000 }); await sleep(600)
    return [await p.locator('[data-settings-tab="voice"][aria-pressed="true"]').count() === 1 && await inView('[data-settings-focus="voice-check"]'), 'Settings, Voice tab, scrolled to Voice check']
  },
}

try {
  await p.goto(`${APP}/`); await p.waitForSelector('[data-finish-setup]', { timeout: 60000 }); await sleep(1000)
  if (SHOTS) { await p.setViewportSize({ width: 1440, height: 1700 }); await sleep(300); await p.locator('[data-finish-setup]').screenshot({ path: `${SHOTS}/dev-finish-setup-card.png` }); await p.setViewportSize({ width: 1440, height: 900 }) }
  for (const item of list) {
    const row = p.locator(`[data-setup-item="${item.key}"]`)
    check(`${item.key}: on the card, ${item.done ? 'ticked' : 'not ticked'} as the server says`, await row.getAttribute('data-done') === String(item.done))
  }
  for (const item of list) {
    if (item.done || !item.link) continue
    if (!EXPECT[item.key]) { check(`${item.key}: has a landing check`, false); continue }
    await p.goto(`${APP}/`); await p.waitForSelector('[data-finish-setup]', { timeout: 60000 }); await sleep(600)
    await p.locator(`[data-setup-item="${item.key}"] [data-setup-open]`).click()
    await sleep(1200)
    const url = new URL(p.url())
    const want = new URL(item.link, APP)
    const sameAddress = url.pathname === want.pathname && [...want.searchParams].every(([k, v]) => url.searchParams.get(k) === v)
    try {
      const [ok, what] = await EXPECT[item.key](item)
      check(`${item.key}: Open lands on ${what}`, ok && sameAddress, `${url.pathname}${url.search}`)
    } catch (e) { check(`${item.key}: Open lands on its screen`, false, String(e?.message || e).slice(0, 200)) }
  }
  // The filter on its own: Customers > "Missing contact info" (no phone and no email), by address and by the select.
  await p.goto(`${APP}/customers?filter=missing-contact`); await p.waitForSelector('[data-customer-filter]', { timeout: 30000 }); await sleep(800)
  const all = Number(await p.locator('[data-customer-count]').getAttribute('data-customer-count'))
  await p.locator('[data-customer-filter]').selectOption('')
  await sleep(300)
  const none = Number(await p.locator('[data-customer-count]').getAttribute('data-customer-count'))
  await p.locator('[data-customer-filter]').selectOption('missing-contact'); await sleep(300)
  check('Customers: "Missing contact info" by address and by the select shows the same list, and All shows everyone', all > 0 && none > all && Number(await p.locator('[data-customer-count]').getAttribute('data-customer-count')) === all && new URL(p.url()).searchParams.get('filter') === 'missing-contact', `${all} of ${none}`)
  check('no page errors', errs.length === 0, errs.join(' | '))
} catch (e) {
  check('test run finished', false, String(e?.message || e).slice(0, 300))
} finally {
  await b.close()
}
const failed = results.filter(r => !r).length
console.log(`\n${results.length - failed} of ${results.length} checks passed`)
process.exit(failed ? 1 : 0)
