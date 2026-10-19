// Book appointment: best open times, the time grid, warnings and the address
// check, on a phone and a desktop, with a fake clock. Jonathan's Oct 19 report
// replayed: it is 11:15 AM, he has an appointment at 5 PM in Ocala, and he is
// booking a customer in Dunnellon.
//
//   cd apps/web && pnpm -s build
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 E2E_ACCESS_TOKEN=<dev staff token> \
//     SHOTS=<folder, optional> node e2e/booking.mjs
//
// Dev only (port 4001). Makes three test customers and their appointments on
// a week with nothing booked, sets a test home base for the default person in
// Settings, and removes all of it at the end (the home base is put back).
import { chromium } from 'playwright'
import { execFileSync } from 'child_process'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || 'http://localhost:4001'
const TOKEN = process.env.E2E_ACCESS_TOKEN || ''
const SHOTS = process.env.SHOTS || ''
const local = u => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(u)
if (!local(APP) || !local(API) || /:4000(\/|$)/.test(API) || /:4000(\/|$)/.test(APP)) { console.error('Refusing to run: the dev copy only (localhost, not port 4000).'); process.exit(2) }
if (!TOKEN) { console.error('Set E2E_ACCESS_TOKEN.'); process.exit(2) }

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const api = async (path, init = {}) => {
  const r = await fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(init.headers || {}) } })
  return r.json().catch(() => null)
}

// Monday Nov 2, 2026, 11:15 AM in Florida (EST). The test checks the week is empty first.
const DAY = '2026-11-02', WED = '2026-11-04'
const NOW = new Date('2026-11-02T11:15:00-05:00')
const at = (date, hm) => new Date(`${date}T${hm}:00-05:00`).toISOString()
const HOME = '17008 SE 60th St, Ocklawaha, FL 32179'
const OCALA = { address: '3500 NE 14th St, Ocala, FL 34470', lat: 29.200791, lng: -82.088115 }
const DUNNELLON = '11000 SW 210th Ave, Dunnellon, FL 34431'
const WRONG = '11000 SW 207th Ct, Dunnellon, FL 34431'          // same house number, another street
const NEARBY = { address: '11050 SW 210th Ave, Dunnellon, FL 34431', lat: 29.063166, lng: -82.468588 }
const TAG = `E2E${Date.now().toString(36).slice(-5)}`
const made = { contacts: [], appointments: [] }
let person = 'Jonathan Bohdal'
let origAppointments, accountId = ''

async function open(browser, phone) {
  const ctx = await browser.newContext(phone
    ? { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, hasTouch: true, isMobile: true }
    : { viewport: { width: 1440, height: 900 } })
  await ctx.addInitScript(t => { localStorage.setItem('crm_access_token', t); if (!localStorage.getItem('crm_refresh_token')) localStorage.setItem('crm_refresh_token', 'e2e') }, TOKEN)
  // Stage changes ask the server to run automations; the dev data holds real customers, so not here.
  await ctx.route('**/api/automations/trigger', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' }))
  const page = await ctx.newPage()
  await page.clock.setFixedTime(NOW)
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 300)))
  return { ctx, page, phone, errors }
}

async function settingsHomeBase(browser, value, shot) {
  const s = await open(browser, false)
  await s.page.goto(`${APP}/settings?tab=appointments`)
  await s.page.waitForSelector('[data-appointment-settings]', { timeout: 60000 }); await sleep(800)
  const box = s.page.locator(`[data-home-base="${person}"]`)
  await box.fill('')
  if (value) {
    await box.pressSequentially('17008 SE 60', { delay: 30 })
    await s.page.locator('[data-address-suggestion]').first().waitFor({ timeout: 10000 })
    await s.page.locator('[data-address-suggestion]').first().click()
    await sleep(300)
  }
  await s.page.locator('[data-save-appointment-settings]').click()
  await sleep(2500)
  if (shot && SHOTS) { await s.page.locator(`[data-team-member="${person}"]`).scrollIntoViewIfNeeded(); await s.page.screenshot({ path: `${SHOTS}/dev-home-base-setting.png` }) }
  const val = await box.inputValue()
  const status = await s.page.locator(`[data-team-member="${person}"] [data-home-status]`).textContent().catch(() => '')
  await s.ctx.close()
  return { val, status }
}

async function openBooking(s, customerId) {
  await s.page.goto(`${APP}/`)
  await s.page.waitForSelector(s.phone ? '[data-tabbar]' : '[data-global-appointment]', { timeout: 60000 }); await sleep(1200)
  await s.page.evaluate(id => window.dispatchEvent(new CustomEvent('ezbiz:book-appointment', { detail: { customerId: id } })), customerId)
  const dlg = s.page.locator('[data-booking-dialog]')
  await dlg.waitFor()
  await dlg.locator('[data-field="date"]').fill(DAY)
  return dlg
}

const toMin = t => { const m = /(\d+):(\d+)\s*(AM|PM)/i.exec(t); if (!m) return NaN; return (Number(m[1]) % 12 + (/pm/i.test(m[3]) ? 12 : 0)) * 60 + Number(m[2]) }

async function bookingRun(browser, phone, dunnellonId) {
  const tag = phone ? 'phone' : 'desktop'
  const s = await open(browser, phone)
  const dlg = await openBooking(s, dunnellonId)

  // The time box starts empty, never the clock time.
  check(`${tag}: the time box starts empty`, (await dlg.locator('[data-field="time"]').textContent()).trim() === 'Pick a time')

  // Address: the customer's address and an earlier appointment's address are different streets.
  const mm = dlg.locator('[data-address-mismatch]')
  await mm.waitFor({ timeout: 8000 }).catch(() => {})
  const mmText = (await mm.textContent().catch(() => '')) || ''
  check(`${tag}: different streets are a clear warning`, /These are different streets, check the address/.test(mmText) && mmText.includes('SW 207th Ct') && mmText.includes('SW 210th Ave'), mmText.slice(0, 160))
  check(`${tag}: no pin until an address is picked`, (await dlg.locator('text=Pin in the wrong place?').count()) === 0)
  if (phone && SHOTS) { await mm.scrollIntoViewIfNeeded(); await s.page.screenshot({ path: `${SHOTS}/dev-booking-address-mismatch.png` }) }
  await dlg.locator('[data-use-address="typed"]').click()
  check(`${tag}: picking one clears the warning`, (await mm.count()) === 0)

  // Best open times, each explained, the first labeled Best.
  await dlg.locator('[data-option-line]').first().waitFor({ timeout: 15000 })
  await sleep(700)
  const opts = await dlg.locator('[data-option]').evaluateAll(els => els.map(e => ({ time: e.getAttribute('data-option'), text: e.textContent, best: !!e.querySelector('[data-best]') })))
  const lines = opts.map(o => o.text)
  console.log('      options:\n        ' + lines.join('\n        '))
  const startMins = opts.map(o => { const [h, m] = o.time.split(':').map(Number); return h * 60 + m })
  check(`${tag}: three options`, opts.length === 3, String(opts.length))
  const spare = l => { const t = l.split('·').at(-1); if (/right on time/.test(t)) return 0; const h = Number(/(\d+) hr/.exec(t)?.[1] || 0), m = Number(/(\d+) min/.exec(t)?.[1] || 0); return h * 60 + m }
  check(`${tag}: ranked: Best leaves the least dead time before the 5 PM`, lines.every(l => spare(lines[0]) <= spare(l)), lines.map(spare).join(','))
  check(`${tag}: the first is labeled Best, the others not`, opts[0]?.best && !opts.slice(1).some(o => o.best))
  check(`${tag}: every option explains itself (leave home, drive, then the drive to the 5 PM)`, lines.every(l => /Leave home \d+:\d\d · \d+ min drive · \d+:\d\d to \d+:\d\d · then \d+ min to .*Ocala Test.* \(5:00\)/.test(l)), lines[0])
  const homeDrive = Number(/· (\d+) min drive/.exec(lines[0] || '')?.[1] || 0)
  const earliest = Math.ceil((11 * 60 + 15 + homeDrive) / 15) * 15
  check(`${tag}: nothing before now plus the drive (11:15 + ${homeDrive} min)`, startMins.every(m => m >= earliest), startMins.join(','))
  check(`${tag}: 15 minute steps`, startMins.every(m => m % 15 === 0))
  const toAshley = Number(/then (\d+) min to/.exec(lines[0] || '')?.[1] || 0)
  check(`${tag}: each leaves the gap and the drive before the 5 PM`, startMins.every(m => m + 60 + 15 + toAshley <= 17 * 60), `drive ${toAshley}`)
  check(`${tag}: no option labeled the old way`, !lines.some(l => /^.*Before .*, \d+ min drive$/.test(l)))

  // Existing appointment shows its real time on the timeline, with drives.
  const appt = await dlg.locator('[data-timeline-appt]').allTextContents()
  check(`${tag}: the 5 PM block shows its time`, appt.some(t => t.startsWith('5:00')), appt.join('|'))
  const dayList = await dlg.locator('[data-day-item]').allTextContents()
  check(`${tag}: the day list gives the real time`, dayList.some(t => /5:00 to 6:00 PM · Ocala Test/.test(t)), dayList.join('|'))

  // Other days nearby.
  const others = await dlg.locator('[data-other-day]').allTextContents()
  check(`${tag}: another day this week nearby is offered`, others.some(t => /^Wed \d+:\d\d · \d+ min from Nearby Test/.test(t)), others.join('|'))

  if (phone && SHOTS) { await dlg.locator('[data-suggestions]').scrollIntoViewIfNeeded(); await s.page.screenshot({ path: `${SHOTS}/dev-booking-best-times-phone.png` }) }

  // Tap Best: the time box takes it, the timeline shows it with the drives.
  await dlg.locator('[data-option]').first().click()
  const boxText = (await dlg.locator('[data-field="time"]').textContent()).trim()
  check(`${tag}: tapping Best fills the time box`, toMin(boxText) === startMins[0], boxText)
  check(`${tag}: drive times on the timeline`, (await dlg.locator('[data-timeline-drive]').count()) >= 2 && (await dlg.locator('[data-timeline-new]').count()) === 1)
  check(`${tag}: Best fits, so no warning`, (await dlg.locator('[data-time-warning]').count()) === 0)

  // The grid: 15 minute steps inside work hours, clashes greyed with the reason.
  await dlg.locator('[data-field="time"]').click()
  await dlg.locator('[data-time-grid]').waitFor()
  const cells = await dlg.locator('[data-grid-time]').evaluateAll(els => els.map(e => ({ t: e.getAttribute('data-grid-time'), ok: e.getAttribute('data-ok') === '1', reason: e.querySelector('[data-grid-reason]')?.textContent || '', title: e.getAttribute('title') })))
  const mins = cells.map(c => { const [h, m] = c.t.split(':').map(Number); return h * 60 + m })
  check(`${tag}: grid in 15 minute steps`, mins.every((m, i) => i === 0 || m - mins[i - 1] === 15) && mins.every(m => m % 15 === 0), `${cells[0]?.t}..${cells.at(-1)?.t}`)
  const five = cells.find(c => c.t === '17:00')
  check(`${tag}: 5:00 PM is greyed: clashes with the Ocala appointment`, five && !five.ok && /Ocala/.test(five.reason) && /Clashes with/.test(five.title), JSON.stringify(five))
  const four = cells.find(c => c.t === '16:00')
  check(`${tag}: 4:00 PM is greyed: not enough time to drive there`, four && !four.ok && /Not enough time to drive to/.test(four.title), JSON.stringify(four))
  const past = cells.find(c => c.t === '10:00')
  check(`${tag}: 10:00 AM is greyed: already past`, past && !past.ok && /past/.test(past.reason))
  check(`${tag}: the Best time is not greyed`, cells.find(c => c.t === opts[0].time)?.ok === true)
  if (phone && SHOTS) { await dlg.locator('[data-time-grid]').scrollIntoViewIfNeeded(); await s.page.screenshot({ path: `${SHOTS}/dev-booking-time-grid-phone.png` }) }

  // Picked anyway: a clear warning before Book, and Book still works.
  await dlg.locator('[data-grid-time="16:00"]').click()
  const warn0 = (await dlg.locator('[data-time-warning]').textContent().catch(() => '')) || ''
  check(`${tag}: 4:00 PM picked anyway: not enough drive time, warned before Book`, /Check this time: 4:00 PM/.test(warn0) && /Not enough time to drive to/.test(warn0), warn0.slice(0, 200))
  await dlg.locator('[data-field="time"]').click()
  await dlg.locator('[data-grid-time="16:30"]').click()
  const warn = (await dlg.locator('[data-time-warning]').textContent().catch(() => '')) || ''
  check(`${tag}: a clashing time warns before Book`, /Check this time: 4:30 PM/.test(warn) && /Clashes with Ocala Test/.test(warn) && /You can still book it/.test(warn), warn.slice(0, 200))
  check(`${tag}: Book is still allowed`, await dlg.locator('[data-save]').isEnabled())
  if (SHOTS && !phone) { await dlg.locator('[data-time-warning]').scrollIntoViewIfNeeded(); await s.page.screenshot({ path: `${SHOTS}/dev-booking-clash-warning.png` }) }

  // Typed by hand: the 6:16 PM from the report.
  await dlg.locator('[data-field="time"]').click()
  await dlg.locator('[data-typed-time]').fill('6:16 pm')
  await dlg.locator('[data-typed-time]').press('Enter')
  const warn2 = (await dlg.locator('[data-time-warning]').textContent().catch(() => '')) || ''
  check(`${tag}: typed 6:16 PM warns: after work hours and too soon after the Ocala appointment`, /after work hours/.test(warn2) && /Not enough time to get here from/.test(warn2), warn2.slice(0, 220))

  if (!phone) {
    // Book the Best time and check the server has it.
    await dlg.locator('[data-option]').first().click()
    if (SHOTS) await s.page.screenshot({ path: `${SHOTS}/dev-booking-desktop.png` })
    await dlg.locator('[data-save]').click()
    await s.page.locator('[data-booked]').waitFor({ timeout: 15000 })
    const list = await api('/api/appointments')
    const mine = (list?.data || []).filter(a => a.crmContactId === dunnellonId && a.startAt && a.startAt.startsWith('2026-11-02'))
    mine.forEach(a => made.appointments.push(a.id))
    check('desktop: booked at the Best time, on the server', mine.length === 1 && mine[0].startAt === at(DAY, opts[0].time), mine.map(a => a.startAt).join(','))
  }
  check(`${tag}: no page errors`, s.errors.length === 0, s.errors.join(' | '))
  await s.ctx.close()
}

const browser = await chromium.launch()
try {
  // The week must be empty for the default person.
  const cfg = await api('/api/business-state')
  const team = cfg?.data?.config?.appointments?.team
  person = team?.find(t => t.isDefault)?.name || team?.[0]?.name || person
  origAppointments = cfg?.data?.config?.appointments
  accountId = cfg?.data?.accountId || ''
  const all = (await api('/api/appointments'))?.data || []
  const busy = all.filter(a => a.assignedTo === person && a.startAt && a.startAt >= '2026-11-02' && a.startAt < '2026-11-09' && !['cancelled', 'completed', 'no_show'].includes(a.status))
  if (busy.length) throw new Error(`the test week already has ${busy.length} appointment(s) for ${person}; pick another week`)

  const contact = async (firstName, lastName, serviceAddress) => {
    const r = await api('/api/crm-contacts', { method: 'POST', body: JSON.stringify({ firstName, lastName, phone: '3525550199', serviceAddress, leadSource: 'Referral' }) })
    const id = r?.data?.id || r?.data?.contact?.id
    if (!id) throw new Error('could not make a test customer: ' + JSON.stringify(r).slice(0, 200))
    made.contacts.push(id); return id
  }
  const book = async (crmContactId, startAt, endAt, p) => {
    const r = await api('/api/appointments', { method: 'POST', body: JSON.stringify({ id: crypto.randomUUID(), crmContactId, type: 'estimate', assignedTo: person, address: p.address, lat: p.lat ?? null, lng: p.lng ?? null, startAt, endAt, allDay: false, notes: 'booking.mjs test' }) })
    if (!r?.data?.id) throw new Error('could not book a test appointment: ' + JSON.stringify(r).slice(0, 200))
    made.appointments.push(r.data.id); return r.data.id
  }
  const ocalaId = await contact('Ocala Test', TAG, OCALA.address)
  const dunnellonId = await contact('Dunnellon Test', TAG, DUNNELLON)
  const nearbyId = await contact('Nearby Test', TAG, NEARBY.address)
  await book(ocalaId, at(DAY, '17:00'), at(DAY, '18:00'), OCALA)
  await book(dunnellonId, at('2026-09-15', '10:00'), at('2026-09-15', '11:00'), { address: WRONG })
  await book(nearbyId, at(WED, '10:00'), at(WED, '11:00'), NEARBY)

  const set = await settingsHomeBase(browser, HOME, true)
  check('Settings: home base picked from the county suggestions and found on the map', set.val === HOME && /On the map/.test(set.status || ''), `${set.val} / ${set.status}`)
  const after = (await api('/api/business-state'))?.data?.config?.appointments?.team?.find(t => t.name === person)
  check('Settings: home base kept on the server', after?.homeBase === HOME && Number.isFinite(after?.homeLat), JSON.stringify(after))

  await bookingRun(browser, true, dunnellonId)
  await bookingRun(browser, false, dunnellonId)
} catch (e) {
  check('test run finished', false, String(e?.stack || e).slice(0, 600))
} finally {
  // Put the appointment settings back exactly as they were (version + 1, so open tabs merge it), and remove what this test made.
  if (/^[A-Za-z0-9-]+$/.test(accountId)) {
    const json = origAppointments == null ? null : JSON.stringify(origAppointments).replace(/'/g, "''")
    const sql = `UPDATE "BusinessState" SET config = ${json == null ? `config - 'appointments'` : `jsonb_set(config, '{appointments}', '${json}'::jsonb)`}, version = version + 1 WHERE "accountId" = '${accountId}';`
    try { execFileSync('psql', ['-d', 'ezbiz_dev', '-q', '-c', sql], { stdio: 'pipe' }) } catch (e) { console.log('settings not put back:', String(e?.stderr || e).slice(0, 200)) }
  }
  const ids = made.contacts.filter(id => /^[A-Za-z0-9-]+$/.test(id))
  const appts = made.appointments.filter(id => /^[A-Za-z0-9-]+$/.test(id))
  try {
    const sql = [
      appts.length ? `DELETE FROM "CrmAppointment" WHERE id IN (${appts.map(i => `'${i}'`).join(',')});` : '',
      ids.length ? `DELETE FROM "CrmAppointment" WHERE "crmContactId" IN (${ids.map(i => `'${i}'`).join(',')}); DELETE FROM "CrmContactNote" WHERE "crmContactId" IN (${ids.map(i => `'${i}'`).join(',')}); DELETE FROM "CrmContact" WHERE id IN (${ids.map(i => `'${i}'`).join(',')});` : '',
    ].join(' ')
    if (sql.trim()) execFileSync('psql', ['-d', 'ezbiz_dev', '-q', '-c', sql], { stdio: 'pipe' })
  } catch (e) { console.log('cleanup:', String(e?.stderr || e).slice(0, 200)) }
}
await browser.close()
const failed = results.filter(r => !r).length
console.log(`\n${results.length - failed} of ${results.length} checks passed`)
process.exit(failed ? 1 : 0)
