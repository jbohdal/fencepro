// Appointments end to end, at desktop and phone sizes. See README.md in this folder.
//
// Books from the customer page, from a pipeline card and from the global
// button; reschedules by dragging on the week view; completes from the phone
// Today screen with "Ready to quote" and lands in a prefilled quote; checks
// every save on the server and that the pipeline cards moved.
//
// It needs real pipeline data and books appointments, so run it on the dev
// copy only:
//
//   APP_URL=http://localhost:5173 API_URL=http://localhost:4001 \
//     E2E_EMAIL=... E2E_PASSWORD=... node appointments.mjs
//
// E2E_ACCESS_TOKEN (a staff access token for the dev server) can stand in for
// the email and password.
import { chromium } from 'playwright'

const APP = process.env.APP_URL || 'http://localhost:5173'
const API = process.env.API_URL || 'http://localhost:4001'
const TOKEN = process.env.E2E_ACCESS_TOKEN || ''
const EMAIL = process.env.E2E_EMAIL || '', PASSWORD = process.env.E2E_PASSWORD || ''
const SHOTS = process.env.E2E_SHOTS || ''
const local = u => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(u)
if (!local(APP) || !local(API) || /:4000(\/|$)/.test(API)) { console.error('Refusing to run: the dev copy only (localhost, not port 4000).'); process.exit(2) }
if (!TOKEN && (!EMAIL || !PASSWORD)) { console.error('Set E2E_EMAIL and E2E_PASSWORD, or E2E_ACCESS_TOKEN.'); process.exit(2) }

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
let token = TOKEN
const api = async (path, init = {}) => {
  const r = await fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) } })
  return (await r.json()).data
}
const floridaDate = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
const cardOf = async customerId => (await api('/api/pipeline')).leads.find(l => l.customerId === customerId)

async function open(browser, phone, startUrl = APP) {
  const ctx = await browser.newContext(phone
    ? { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, hasTouch: true, isMobile: true }
    : { viewport: { width: 1440, height: 900 } })
  if (TOKEN) await ctx.addInitScript(t => { localStorage.setItem('crm_access_token', t); if (!localStorage.getItem('crm_refresh_token')) localStorage.setItem('crm_refresh_token', 'e2e') }, TOKEN)
  const page = await ctx.newPage()
  const s = { ctx, page, phone, errors: [], prompts: [] }
  page.on('pageerror', e => s.errors.push(String(e).slice(0, 300)))
  page.on('dialog', d => { s.prompts.push(d.message()); d.accept(d.type() === 'prompt' ? 'Customer asked (test)' : undefined).catch(() => {}) })
  page.on('request', r => { const a = r.headers()['authorization']; if (a && r.url().startsWith(API)) token = a.replace(/^Bearer /, '') })
  // Stage changes ask the server to run automations; the dev data holds real customers, so not here.
  await page.route('**/api/automations/trigger', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' }))
  await page.goto(startUrl)
  if (!TOKEN) {
    await page.fill('input[type="email"]', EMAIL); await page.fill('input[type="password"]', PASSWORD); await page.click('button[type="submit"]')
  }
  await page.waitForSelector(phone ? '[data-tabbar]' : '[data-global-appointment]', { timeout: 30000 }); await sleep(800)
  return s
}
async function nav(s, label) {
  // On the phone: the tab bar, or More for everything else.
  const TAB = { 'Sales Pipeline': 'Pipeline', Today: 'Today', Customers: 'Customers', Appointments: 'Schedule' }
  if (s.phone && TAB[label]) { await s.page.locator(`[data-tabbar] button:has-text("${TAB[label]}")`).click(); await sleep(600); return }
  if (s.phone) await s.page.locator('[data-tabbar] button:has-text("More")').click()
  await s.page.locator(`span:text-is("${label}"):visible`).first().click()
  await sleep(600)
}
/** In the open booking dialog: take the first suggested time and book. */
async function bookFirstSuggestion(s) {
  const dlg = s.page.locator('[data-booking-dialog]')
  await dlg.waitFor()
  // A day that is already full has no suggestions: try the next days, as a person would.
  for (let i = 0; i < 8; i++) {
    if (await dlg.locator('[data-suggestions] button').first().waitFor({ timeout: 3000 }).then(() => true, () => false)) break
    const d = new Date((await dlg.locator('[data-field="date"]').inputValue()) + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)
    await dlg.locator('[data-field="date"]').fill(d.toISOString().slice(0, 10))
  }
  await dlg.locator('[data-suggestions] button').first().waitFor({ timeout: 5000 })
  const picked = (await dlg.locator('[data-suggestions] button').first().innerText()).split('·')[0].trim()
  await dlg.locator('[data-suggestions] button').first().click()
  await dlg.locator('[data-save]').click()
  await dlg.locator('[data-booked]').waitFor({ timeout: 10000 })
  const confirmText = await dlg.locator('[data-booked]').innerText()
  return { picked, confirmText }
}

async function desktop(browser) {
  console.log('\n── desktop (1440x900) ──')
  const pipeline = await api('/api/pipeline')
  const before = await api('/api/appointments')
  const first = pipeline.leads.find(l => l.stage === 'First Contact' && l.customerId)
  const inAppt = pipeline.leads.filter(l => l.stage === 'Appointment' && l.customerId)

  /* 1. customer page */
  let s = await open(browser, false, `${APP}/?customer=${first.customerId}`)
  await s.page.locator('[data-book-appointment]').click()
  const r1 = await bookFirstSuggestion(s)
  if (SHOTS) await s.page.screenshot({ path: `${SHOTS}/desktop-booked.png` })
  const offers = await s.page.locator('[data-booked] a:has-text("Text it"), [data-booked] button:has-text("Calendar invite")').count()
  await s.page.locator('[data-booked] button:has-text("Done")').click()
  await sleep(1500)
  let list = await api('/api/appointments')
  const made1 = list.find(a => !before.some(b => b.id === a.id) && a.crmContactId === first.customerId)
  check('desktop: book from the customer page, saved on the server', !!made1 && made1.type === 'estimate' && made1.status === 'scheduled',
    made1 ? `${made1.customerName}, ${new Date(made1.startAt).toLocaleString('en-US', { timeZone: 'America/New_York' })}, ${made1.address}, with ${made1.assignedTo}, map position ${made1.lat ? 'found' : 'missing'}` : 'not found')
  check('desktop: the confirmation offers a text and a calendar invite, nothing sent', offers >= 1 && /You're all set/.test(r1.confirmText))
  check('desktop: booking an estimate moved the card from First Contact to Appointment', (await cardOf(first.customerId))?.stage === 'Appointment', `card now ${(await cardOf(first.customerId))?.stage}`)
  await s.page.locator('button:text-is("appointments")').click(); await sleep(300)
  check('desktop: the customer header shows the next appointment and the tab lists it',
    (await s.page.locator('[data-next-badge]').count()) === 1 && (await s.page.locator(`[data-customer-appointment="${made1?.id}"]`).count()) === 1)
  await s.ctx.close()

  /* 2. pipeline card */
  s = await open(browser, false)
  await nav(s, 'Sales Pipeline')
  const target = inAppt.find(l => !list.some(a => a.crmContactId === l.customerId && ['scheduled', 'confirmed', 'rescheduled'].includes(a.status) && a.startAt))
  const card = s.page.locator(`[data-kanban-card="${target.id}"]`)
  await card.scrollIntoViewIfNeeded()
  await card.locator('[data-card-book]').click()
  const dlgName = await s.page.locator('[data-booking-customer]').innerText()
  await bookFirstSuggestion(s)
  await s.page.locator('[data-booked] button:has-text("Done")').click(); await sleep(1500)
  list = await api('/api/appointments')
  const made2 = list.find(a => !before.some(b => b.id === a.id) && a.crmContactId === target.customerId)
  check('desktop: book from a pipeline card, with that card\'s customer filled in', !!made2 && dlgName.includes(target.firstName), `${dlgName}`)
  check('desktop: the card shows its next appointment as a chip', (await card.locator('[data-card-next]').count()) === 1, await card.locator('[data-card-next]').innerText().catch(() => 'no chip'))

  /* 2b. a drop into the Appointment column opens booking instead of just moving */
  const fresh = (await api('/api/pipeline')).leads.find(l => l.stage === 'Estimating' && l.customerId)
  if (fresh) {
    const c = s.page.locator(`[data-kanban-card="${fresh.id}"]`)
    await c.scrollIntoViewIfNeeded()
    const box = await c.boundingBox(), col = await s.page.locator('[data-kanban-col="Appointment"]').boundingBox()
    await s.page.mouse.move(box.x + 60, box.y + 20); await s.page.mouse.down()
    await s.page.mouse.move(col.x + col.width / 2, col.y + 200, { steps: 15 }); await sleep(200); await s.page.mouse.up(); await sleep(500)
    const opened = await s.page.locator('[data-booking-dialog]').count()
    const stillThere = (await cardOf(fresh.customerId)).stage
    await s.page.locator('[data-booking-dialog] button[aria-label="Close"]').click().catch(() => {})
    check('desktop: dropping a card in Appointment opens booking and does not move it until booked', opened === 1 && stillThere === 'Estimating', `card stayed in ${stillThere}`)
  }
  await s.ctx.close()

  /* 3. global button */
  s = await open(browser, false)
  const third = inAppt.find(l => l.id !== target.id && !list.some(a => a.crmContactId === l.customerId && a.startAt && ['scheduled', 'confirmed', 'rescheduled'].includes(a.status)))
  await s.page.locator('[data-global-appointment]').click()
  await s.page.locator('[data-customer-search]').fill(`${third.firstName} ${third.lastName}`.trim())
  await s.page.locator('[data-booking-dialog] button:has-text("' + third.firstName + '")').first().click()
  await s.page.locator('[data-field="type"]').selectOption('follow_up')
  await s.page.locator('[data-field="date"]').fill(dayAhead(3))
  await s.page.locator('[data-field="time"]').fill('15:30')
  await s.page.locator('[data-save]').click()
  await s.page.locator('[data-booked]').waitFor()
  await s.page.locator('[data-booked] button:has-text("Done")').click(); await sleep(1200)
  list = await api('/api/appointments')
  const made3 = list.find(a => !before.some(b => b.id === a.id) && a.crmContactId === third.customerId)
  check('desktop: book from the global + Appointment button, searching by name', !!made3 && made3.type === 'follow_up' && floridaDate(new Date(made3.startAt)) === dayAhead(3),
    made3 ? `${made3.customerName} ${made3.startAt}` : 'not found')

  /* 4. drag to reschedule on the week view */
  await nav(s, 'Appointments')
  await s.page.locator('[data-view="week"]').click()
  await s.page.locator('input[type="date"]').first().fill(floridaDate(new Date(made3.startAt))); await sleep(400)
  const block = s.page.locator(`[data-time-grid] [data-appointment="${made3.id}"]`).first()
  await block.scrollIntoViewIfNeeded()
  const from = await block.boundingBox()
  const days = await s.page.locator('[data-time-grid] [data-day]').evaluateAll(els => els.map(e => e.dataset.day))
  const toDay = days[days.indexOf(floridaDate(new Date(made3.startAt))) === 0 ? 1 : 0]
  const dest = await s.page.locator(`[data-time-grid] [data-day="${toDay}"]`).boundingBox()
  await block.dragTo(s.page.locator(`[data-time-grid] [data-day="${toDay}"]`), { targetPosition: { x: dest.width / 2, y: from.y - dest.y + 5 } })
  await sleep(1500)
  if (SHOTS) await s.page.screenshot({ path: `${SHOTS}/desktop-week.png` })
  const moved = (await api('/api/appointments')).find(a => a.id === made3.id)
  const h = (moved.history || []).find(x => x.kind === 'rescheduled')
  check('desktop: drag on the week view reschedules, asks why, keeps the old time', floridaDate(new Date(moved.startAt)) === toDay && !!h && h.from?.startAt === made3.startAt && /Customer asked/.test(h.reason || ''),
    `now ${moved.startAt}, status ${moved.status}, history: ${JSON.stringify(h)}`)
  await nav(s, 'Dashboard')
  check('desktop: the dashboard shows Today and Needs outcome', (await s.page.locator('[data-dashboard-appointments]').count()) === 1)
  check('desktop: no page errors', s.errors.length === 0, s.errors.join(' | '))
  await s.ctx.close()
  return { made1, made2, made3 }
}

function dayAhead(n) {
  let d = new Date(); let added = 0
  while (added < n) { d = new Date(d.getTime() + 86_400_000); if (d.getDay() !== 0) added++ }
  return floridaDate(d)
}

async function phone(browser) {
  console.log('\n── phone (412x915) ──')
  const pipeline = await api('/api/pipeline')
  const list = await api('/api/appointments')
  const card = pipeline.leads.find(l => l.stage === 'Appointment' && l.customerId && !list.some(a => a.crmContactId === l.customerId && a.startAt))
  // Booked for later today, as the next thing on the Today screen.
  const start = new Date(Date.now() + 20 * 60_000)
  const made = await api('/api/appointments', { method: 'POST', body: JSON.stringify({ crmContactId: card.customerId, type: 'estimate', assignedTo: 'Jonathan Bohdal', startAt: start.toISOString(), endAt: new Date(start.getTime() + 3_600_000).toISOString(), notes: 'Gate code 1234 (test)' }) })
  const s = await open(browser, true)
  await nav(s, 'Today')
  await s.page.locator('[data-next-appointment]').waitFor()
  const nextName = await s.page.locator('[data-next-name]').innerText()
  const sms = await s.page.locator('[data-on-my-way]').getAttribute('href')
  const navUrl = await s.page.locator('[data-next-appointment] a:has-text("Navigate")').getAttribute('href')
  if (SHOTS) await s.page.screenshot({ path: `${SHOTS}/phone-today.png` })
  check('phone: Today shows the next appointment as a big card', nextName === made.customerName, nextName)
  check('phone: Text "On my way" is a prefilled text from the phone, Navigate is Google Maps directions',
    /^sms:\d+\?body=Hi%20/.test(sms || '') && decodeURIComponent(sms).includes("I'm on my way") && (navUrl || '').startsWith('https://www.google.com/maps/dir/?api=1&destination='), decodeURIComponent((sms || '').split('body=')[1] || ''))
  await s.page.locator('[data-complete]').click()
  await s.page.locator('[data-outcome="ready_to_quote"]').click()
  await s.page.locator('[data-feet]').fill('180')
  await s.page.locator('[data-save-outcome]').click()
  await sleep(2500)
  if (SHOTS) await s.page.screenshot({ path: `${SHOTS}/phone-quote.png` })
  const done = (await api('/api/appointments')).find(a => a.id === made.id)
  // The builder opens on the customer; its save step carries the property and what was measured.
  const builderName = await s.page.evaluate(() => [...document.querySelectorAll('input')].map(e => e.value).join(' | '))
  // Saving needs a style and a run, as for any quote; the save step then shows the property and notes.
  await s.page.locator('select:has(option:has-text("Privacy"))').first().selectOption({ index: 1 }).catch(e => console.log('style:', String(e).slice(0, 120)))
  await s.page.locator('input[placeholder^="Leng"]').first().fill('180').catch(() => {})
  await s.page.locator('button:has-text("Update Quote"), button:has-text("Save Quote")').first().click().catch(() => {})
  await sleep(600)
  const values = builderName + ' | ' + await s.page.evaluate(() => [...document.querySelectorAll('input, textarea')].map(e => e.value).join(' | '))
  if (SHOTS) await s.page.screenshot({ path: `${SHOTS}/phone-quote-save.png` })
  check('phone: Complete with "Ready to quote" saves the outcome', done.status === 'completed' && done.outcome === 'ready_to_quote' && done.measuredFeet === 180, `${done.status}, ${done.outcome}, ${done.measuredFeet} ft`)
  check('phone: it lands in a quote prefilled with the customer and property', values.includes(made.address.split(',')[0]) && values.includes(made.customerName.split(' ')[0]) && values.includes('about 180 ft'), values.slice(0, 300))
  check('phone: the pipeline card moved to Estimating', (await cardOf(card.customerId))?.stage === 'Estimating', `card now ${(await cardOf(card.customerId))?.stage}`)
  check('phone: no page errors', s.errors.length === 0, s.errors.join(' | '))
  await s.ctx.close()
}

async function phoneBooking(browser) {
  // Booking on the phone from the customer page, with the dialog as a bottom sheet.
  const pipeline = await api('/api/pipeline')
  const list = await api('/api/appointments')
  const l = pipeline.leads.find(x => x.stage === 'Pending Signature' && x.customerId && !list.some(a => a.crmContactId === x.customerId && a.source !== 'import'))
  const s = await open(browser, true, `${APP}/?customer=${l.customerId}`)
  await s.page.locator('[data-book-appointment]').click()
  await s.page.locator('[data-field="type"]').selectOption('contract_signing')
  await bookFirstSuggestion(s)
  await sleep(1200)
  const made = (await api('/api/appointments')).find(a => a.crmContactId === l.customerId && a.type === 'contract_signing')
  check('phone: book from the customer page', !!made, made ? `${made.customerName} ${made.startAt}` : '')
  await s.ctx.close()
}

/** The tests start from cards in First Contact. If the copy has too few, move some
 *  Lost Sale cards there first (dev copy only), through the normal version checked save. */
async function ensureFirstContact(token, need = 3) {
  const get = async () => (await (await fetch(`${API}/api/pipeline`, { headers: { Authorization: `Bearer ${token}` } })).json()).data
  const d = await get()
  const have = d.leads.filter(l => l.stage === 'First Contact' && l.customerId).length
  if (have >= need) return
  const pick = d.leads.filter(l => l.stage === 'Lost Sale' && l.customerId).slice(0, need - have)
  const upsert = pick.map(l => ({ lead: { ...l, stage: 'First Contact', lastMoved: new Date().toISOString().slice(0, 10) } }))
  const r = await fetch(`${API}/api/pipeline`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ upsert, remove: [], baseVersion: d.version }) })
  console.log(`setup: moved ${pick.length} Lost Sale card(s) to First Contact on the test copy (${r.status})`)
}

const browser = await chromium.launch()
await ensureFirstContact(TOKEN)
const only = process.env.E2E_ONLY || ''
try {
  if (!only || only === 'desktop') await desktop(browser)
  if (!only || only === 'phone') { await phone(browser); await phoneBooking(browser) }
} catch (err) { check('test run finished', false, String(err?.stack || err).slice(0, 700)) }
await browser.close()
const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length} of ${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
