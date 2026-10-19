// Double taps on the main create buttons, on a phone, on the dev copy.
//
//   cd apps/web && pnpm -s build
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 E2E_ACCESS_TOKEN=<dev staff token> node e2e/double-tap.mjs
//
// Each button is tapped twice in the same instant (both taps land before the
// screen can grey the button out or close the window), which is harder than
// any thumb. Then the server is asked: exactly one record each.
//   1. New lead (Pipeline +): one customer, one card
//   2. New customer (Customers, Save Customer): one customer, one card
//   3. Save quote (from the lead's card): one quote
//   4. Book an appointment (customer page): one appointment
// Dev only (port 4001); removes what it made.
import { chromium } from 'playwright'
import { execFileSync } from 'child_process'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || 'http://localhost:4001'
const TOKEN = process.env.E2E_ACCESS_TOKEN || ''
const local = u => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(u)
if (!local(APP) || !local(API) || /:4000(\/|$)/.test(API) || /:4000(\/|$)/.test(APP)) { console.error('Refusing to run: the dev copy only (localhost, not port 4000).'); process.exit(2) }
if (!TOKEN) { console.error('Set E2E_ACCESS_TOKEN.'); process.exit(2) }

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
let token = TOKEN
const api = async (path, init = {}) => {
  const r = await fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) } })
  return r.json().catch(() => null)
}
const contactsNamed = async last => {
  const d = (await api('/api/crm-contacts?limit=10000'))?.data
  return (d?.contacts ?? d ?? []).filter(c => c.lastName === last && !c.archivedAt)
}
const cardsNamed = async last => ((await api('/api/pipeline'))?.data?.leads ?? []).filter(l => l.lastName === last)
/** Ask again until the phone's saves have reached the server (or time runs out). */
async function settle(fn, want, ms = 15000) {
  const end = Date.now() + ms
  let v = await fn()
  while (Date.now() < end && v < want) { await sleep(700); v = await fn() }
  await sleep(2500) // a second copy, if any, would arrive by now
  return fn()
}
/** Two taps in the same instant. */
const doubleTap = loc => loc.evaluate(el => { el.click(); el.click() })

const stamp = Date.now().toString(36).slice(-6)
const LEAD = `Dbl Lead ${stamp}`, CUST = `Dbl Cust ${stamp}`
const made = { contacts: [], quotes: [] }

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, hasTouch: true, isMobile: true })
await ctx.addInitScript(t => { localStorage.setItem('crm_access_token', t); if (!localStorage.getItem('crm_refresh_token')) localStorage.setItem('crm_refresh_token', 'e2e') }, TOKEN)
const page = await ctx.newPage()
const errors = []
page.on('pageerror', e => errors.push(String(e).slice(0, 200)))
page.on('dialog', d => d.accept().catch(() => {}))
page.on('request', r => { const a = r.headers()['authorization']; if (a && r.url().startsWith(API)) token = a.replace(/^Bearer /, '') })
// Stage changes ask the server to run automations; the dev data holds real customers, so not here.
await page.route('**/api/automations/trigger', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' }))

try {
  // ── 1. New lead ──
  await page.goto(`${APP}/pipeline`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-kanban-col]', { timeout: 60000 }); await sleep(1500)
  await page.locator('button[aria-label="New Lead"]').click()
  await page.locator('[data-lead-field="first-name"]').fill('E2E')
  await page.locator('[data-lead-field="last-name"]').fill(LEAD)
  await page.locator('[data-lead-field="phone"]').fill(`352555${String(Math.floor(Math.random() * 9000) + 1000)}`)
  await doubleTap(page.locator('[data-lead-add]'))
  const leadContacts = await settle(async () => (await contactsNamed(LEAD)).length, 1).then(() => contactsNamed(LEAD))
  made.contacts.push(...leadContacts.map(c => c.id))
  check('new lead tapped twice: one customer', leadContacts.length === 1, String(leadContacts.length))
  const leadCards = await cardsNamed(LEAD)
  check('new lead tapped twice: one pipeline card', leadCards.length === 1, String(leadCards.length))
  const leadCustomerId = leadContacts[0]?.id

  // ── 2. New customer ──
  await page.goto(`${APP}/customers/new`, { waitUntil: 'domcontentloaded' })
  await page.locator('[data-customer-field="first-name"]').waitFor({ timeout: 30000 })
  await page.locator('[data-customer-field="first-name"]').fill('E2E')
  await page.locator('[data-customer-field="last-name"]').fill(CUST)
  await doubleTap(page.locator('[data-customer-save]'))
  const custs = await settle(async () => (await contactsNamed(CUST)).length, 1).then(() => contactsNamed(CUST))
  made.contacts.push(...custs.map(c => c.id))
  check('new customer tapped twice: one customer', custs.length === 1, String(custs.length))
  check('new customer tapped twice: one pipeline card', (await cardsNamed(CUST)).length === 1, String((await cardsNamed(CUST)).length))

  // ── 3. Save quote, from the lead's card ──
  await page.goto(`${APP}/pipeline`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-kanban-col]', { timeout: 60000 }); await sleep(1200)
  await page.locator(`[data-kanban-col] >> text=E2E ${LEAD}`).first().click(); await sleep(800)
  await page.locator('[data-card-new-quote]').click()
  const b = page.locator('[data-quote-builder]')
  await b.waitFor()
  await b.locator('[data-step="yard"]').click()
  await b.locator('[data-shape="backyard"]').click()
  await b.locator('[data-side="Left return"] [data-side-length]').click()
  for (const [keys, last] of [[['3', '0'], 0], [['1', '2', '0'], 0], [['1', '5', '0'], 0], [['1', '0', '0'], 0], [['3', '0'], 1]]) {
    for (const k of keys) await page.locator(`[data-ftin-pad] [data-pad-key="${k}"]`).click()
    await page.locator(last ? '[data-ftin-pad] [data-pad-done]' : '[data-ftin-pad] [data-pad-next]').click()
  }
  await b.locator('[data-step="style"]').click()
  await b.locator('select').filter({ hasText: 'Select a fence style' }).selectOption({ label: "White Vinyl Privacy, 6 ft tall, 8 ft panels, No dig" })
  await b.locator('[data-step="price"]').click()
  await page.locator('[data-save-open]').click(); await sleep(600)
  await doubleTap(page.locator('[data-save-submit]'))
  const quotesFor = async () => ((await api('/api/saved-quotes'))?.data ?? []).filter(q => q.crmContactId === leadCustomerId)
  const quotes = await settle(async () => (await quotesFor()).length, 1).then(quotesFor)
  made.quotes.push(...quotes.map(q => q.id))
  check('save quote tapped twice: one quote', quotes.length === 1, String(quotes.length))

  // ── 4. Book an appointment ──
  await page.goto(`${APP}/?customer=${leadCustomerId}`, { waitUntil: 'domcontentloaded' })
  await page.locator('[data-book-appointment]').click()
  const dlg = page.locator('[data-booking-dialog]')
  await dlg.waitFor()
  for (let i = 0; i < 8; i++) {
    if (await dlg.locator('[data-suggestions] button').first().waitFor({ timeout: 3000 }).then(() => true, () => false)) break
    const d = new Date((await dlg.locator('[data-field="date"]').inputValue()) + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)
    await dlg.locator('[data-field="date"]').fill(d.toISOString().slice(0, 10))
  }
  await dlg.locator('[data-suggestions] button').first().click()
  await doubleTap(dlg.locator('[data-save]'))
  await dlg.locator('[data-booked]').waitFor({ timeout: 15000 }).catch(() => {})
  const apptsFor = async () => ((await api('/api/appointments'))?.data ?? []).filter(a => a.crmContactId === leadCustomerId)
  const appts = await settle(async () => (await apptsFor()).length, 1).then(apptsFor)
  check('book tapped twice: one appointment', appts.length === 1, String(appts.length))

  check('no page errors', errors.length === 0, errors.join(' | '))
} catch (e) {
  check('test run finished', false, String(e?.message || e).slice(0, 300))
} finally {
  await browser.close()
  // The cards, then everything else this made (dev database only, by name).
  for (let i = 0; i < 5; i++) {
    const p = await api('/api/pipeline')
    const mine = (p?.data?.leads ?? []).filter(l => l.lastName === LEAD || l.lastName === CUST).map(l => l.id)
    if (!mine.length) break
    const r = await api('/api/pipeline', { method: 'PATCH', body: JSON.stringify({ upsert: [], remove: mine, baseVersion: p.data.version }) })
    if (r?.success) break
  }
  for (const q of made.quotes) await api(`/api/saved-quotes/${q}`, { method: 'DELETE' })
  const ids = made.contacts.filter(id => /^[A-Za-z0-9_-]+$/.test(id))
  if (ids.length) {
    const list = ids.map(id => `'${id}'`).join(',')
    try {
      execFileSync('psql', ['-d', 'ezbiz_dev', '-q', '-c',
        `DELETE FROM "CrmAppointment" WHERE "crmContactId" IN (${list}); DELETE FROM "CrmContactNote" WHERE "crmContactId" IN (${list}); DELETE FROM "SavedQuote" WHERE "crmContactId" IN (${list}); DELETE FROM "CrmContact" WHERE id IN (${list});`], { stdio: 'pipe' })
    } catch (e) { console.log('cleanup:', String(e?.stderr || e).slice(0, 200)) }
  }
}
const failed = results.filter(r => !r).length
console.log(`\n${results.length - failed} of ${results.length} checks passed`)
process.exit(failed ? 1 : 0)
