// Appointment texts (Settings > Messages; appointmentMessages.ts), on the dev copy,
// on desktop Chrome and on WebKit at phone size.
//
//   cd apps/web && pnpm -s build
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 E2E_ACCESS_TOKEN=<dev owner token> \
//     [SHOTS=<folder>] node e2e/appointment-texts.mjs
//
// 1. Settings > Team: a Direct phone typed in the Edit window is saved as 10
//    digits and shown (352) 555 0142.
// 2. Booked for a rep with a Direct phone: the confirmation shown, the "Text
//    it" link and the calendar invite give that rep's first name and number;
//    the text starts "Getter Done Fence: Hi Kristi," and ends "Reply STOP to opt out."
// 3. Booked for an owner-type login: his name and his phone.
// 4. Booked for a rep with no phone: the company number (352) 789 4314, and a
//    warning on the Booked window.
// 5. Settings > Messages on the desktop: the estimate text edited, the live
//    preview follows, saved; the phone then books and gets the edited words
//    (from the server). Reset to default on the phone; the desktop then gets
//    the default words again.
//
// Makes three test logins (never Christa's or Jonathan's rows), a test customer,
// their appointments, and adds the three to the team list in Settings >
// Appointments. All of it is removed at the end and the settings put back.
// Nothing is sent: the texts open the phone's own texting app, which a test never taps.

import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import { chromium, webkit } from 'playwright'
import { execFileSync } from 'child_process'
import fs from 'fs'
import { signInByCookie } from './lib.mjs'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || 'http://localhost:4001'
const TOKEN = process.env.E2E_ACCESS_TOKEN || ''
const SHOTS = process.env.SHOTS || ''
const local = u => /^https?:\/\/(localhost|127\.0\.0\.1):4001(\/|$)/.test(u)
if (!local(APP) || !local(API)) { console.error('Refusing to run: the dev copy only (localhost:4001).'); process.exit(2) }
if (!TOKEN) { console.error('Set E2E_ACCESS_TOKEN (an owner login on the dev server).'); process.exit(2) }
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + String(detail).slice(0, 300) : ''}`) }
const api = async (path, init = {}) => {
  const r = await fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(init.headers || {}) } })
  return { status: r.status, json: await r.json().catch(() => null) }
}
// Every database command names the dev database.
const sql = q => execFileSync('psql', ['-d', 'ezbiz_dev', '-v', 'ON_ERROR_STOP=1', '-Atc', q], { encoding: 'utf8' }).trim()

const TAG = `E2E${Date.now().toString(36).slice(-5)}`
const REPS = {
  alpha: { first: 'Testrep', last: `Alpha ${TAG}`, phone: '352-555-0142', role: 'sales_rep' },
  owner: { first: 'Testowner', last: `Beta ${TAG}`, phone: '3525550101', role: 'admin' },
  nophone: { first: 'Testnophone', last: `Gamma ${TAG}`, phone: null, role: 'sales_rep' },
}
const full = r => `${r.first} ${r.last}`
const DAY = '2026-12-08'   // a Tuesday
const WHEN = 'Tuesday, December 8 at 10:00 AM'
const COMPANY_PHONE = '(352) 789 4314'
const EDITED = 'Hi {customer_first_name}! {rep_first_name} from {company_name} will see you {date_time}. Questions: {rep_phone}'
const ids = {}
let accountId = '', contactId = '', original = { appointments: undefined, appointmentMessages: undefined }
const contexts = []

async function config() { const r = await api('/api/business-state'); return { config: r.json.data.config || {}, version: r.json.data.version } }
async function patchConfig(fn) {
  for (let i = 0; i < 5; i++) {
    const { config: c, version } = await config()
    const r = await api('/api/business-state', { method: 'PATCH', body: JSON.stringify({ config: fn(c), baseVersion: version }) })
    if (r.status === 200) return true
    await sleep(500)
  }
  return false
}
async function waitFor(fn, ms = 15000) {
  const end = Date.now() + ms
  while (Date.now() < end) { if (await fn()) return true; await sleep(400) }
  return false
}

async function setup() {
  const me = await api('/api/crm-auth/me')
  if (me.status !== 200) throw new Error('the owner token does not work')
  accountId = sql(`select "crmAccountId" from "CrmUser" where id = '${me.json.data.id}'`)
  for (const [k, r] of Object.entries(REPS)) {
    ids[k] = sql(`insert into "CrmUser" (id, email, "firstName", "lastName", role, status, "mustChangePassword", "crmAccountId", "updatedAt")
      values (gen_random_uuid(), '${TAG.toLowerCase()}-${k}@example.test', '${r.first}', '${r.last}', '${r.role}', 'active', false, '${accountId}', now()) returning id`).split('\n')[0]
  }
  // The owner-type login's phone through the API (the Team route); Alpha's through the Team screen below.
  const p = await api(`/api/crm-auth/users/${ids.owner}`, { method: 'PATCH', body: JSON.stringify({ phone: REPS.owner.phone }) })
  if (p.status !== 200) throw new Error(`setting a phone: ${p.status} ${JSON.stringify(p.json)}`)
  contactId = sql(`insert into "CrmContact" (id, "accountId", "firstName", "lastName", phone, email, "updatedAt")
    values (gen_random_uuid(), '${accountId}', 'Kristi', '${TAG}', '3525550100', '${TAG.toLowerCase()}@example.test', now()) returning id`).split('\n')[0]
  // The three in the team list (Settings > Appointments); the list as it was is put back at the end.
  const { config: c } = await config()
  original = { appointments: c.appointments, appointmentMessages: c.appointmentMessages }
  const DEFAULT_TEAM = [{ name: 'Jonathan Bohdal', isDefault: true }, { name: 'Alexander Bohdal' }, { name: 'Stacy Mcgovern' }, { name: 'Christopher Lindsey' }]
  const ok = await patchConfig(cur => ({
    ...cur,
    appointments: { ...(cur.appointments || {}), team: [...(cur.appointments?.team?.length ? cur.appointments.team : DEFAULT_TEAM), ...Object.values(REPS).map(r => ({ name: full(r) }))] },
    appointmentMessages: {},
  }))
  if (!ok) throw new Error('could not add the test team members')
}

async function cleanup() {
  for (const ctx of contexts) {
    await ctx.request.post(`${API}/api/crm-auth/logout`, { headers: { 'X-Staff-Request': '1', 'Content-Type': 'application/json' }, data: {} }).catch(() => {})
    await ctx.close().catch(() => {})
  }
  await patchConfig(cur => {
    const next = { ...cur }
    if (original.appointments === undefined) delete next.appointments; else next.appointments = original.appointments
    if (original.appointmentMessages === undefined) delete next.appointmentMessages; else next.appointmentMessages = original.appointmentMessages
    return next
  }).catch(() => false)
  if (contactId) {
    sql(`delete from "CrmAppointment" where "crmContactId" = '${contactId}'`)
    sql(`delete from "CrmContact" where id = '${contactId}'`)
  }
  for (const id of Object.values(ids)) {
    const r = await api(`/api/crm-auth/users/${id}`, { method: 'DELETE' })
    if (r.status !== 200) sql(`delete from "CrmUser" where id = '${id}'`)
  }
  const left = sql(`select count(*) from "CrmUser" where email like '${TAG.toLowerCase()}-%'`) + '/' + sql(`select count(*) from "CrmContact" where "lastName" = '${TAG}'`)
  const { config: c } = await config()
  const teamBack = JSON.stringify(c.appointments) === JSON.stringify(original.appointments)
  const msgsBack = JSON.stringify(c.appointmentMessages) === JSON.stringify(original.appointmentMessages)
  check('cleanup: test logins, customer and appointments removed; Settings put back', left === '0/0' && teamBack && msgsBack, `${left} team ${teamBack} messages ${msgsBack}`)
}

async function open(browser, phone) {
  const ctx = await browser.newContext(phone
    ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true }
    : { viewport: { width: 1440, height: 900 } })
  contexts.push(ctx)
  await signInByCookie(ctx, { token: TOKEN, cookie: '', email: '', password: '' })
  // Stage changes ask the server to run automations; the dev data holds real customers, so not here.
  await ctx.route('**/api/automations/trigger', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' }))
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 300)))
  page.on('dialog', d => d.accept().catch(() => {}))
  const s = { ctx, page, phone, errors, tag: phone ? 'phone webkit' : 'desktop chromium' }
  s.tap = async loc => { await loc.scrollIntoViewIfNeeded().catch(() => {}); if (phone) await loc.tap(); else await loc.click(); await sleep(300) }
  s.shot = async n => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${phone ? 'phone' : 'desktop'}-${n}.png` }) }
  return s
}

async function home(s) {
  await s.page.goto(`${APP}/`)
  await s.page.waitForSelector(s.phone ? '[data-tabbar]' : '[data-global-appointment]', { timeout: 60000 })
  await sleep(1200)
}

/** Book an estimate for the test customer with this person; returns what the Booked window shows. */
async function book(s, person, shot) {
  await home(s)
  await s.page.evaluate(id => window.dispatchEvent(new CustomEvent('ezbiz:book-appointment', { detail: { customerId: id, type: 'estimate' } })), contactId)
  const dlg = s.page.locator('[data-booking-dialog]')
  await dlg.waitFor({ timeout: 15000 })
  await dlg.locator('[data-field="person"]').selectOption(person)
  await dlg.locator('[data-field="date"]').fill(DAY)
  await s.tap(dlg.locator('[data-field="time"]'))
  await dlg.locator('[data-typed-time]').fill('10:00 am')
  await dlg.locator('[data-typed-time]').press('Enter')
  await sleep(300)
  await s.tap(dlg.locator('[data-save]'))
  await dlg.locator('[data-booked="saved"]').waitFor({ timeout: 20000 })
  const text = ((await dlg.locator('[data-confirmation-text]').textContent()) || '').trim()
  const href = (await dlg.locator('[data-text-it]').getAttribute('href').catch(() => '')) || ''
  const smsBody = href.includes('?body=') ? decodeURIComponent(href.split('?body=')[1]) : ''
  const warning = (await dlg.locator('[data-rep-phone-warning]').count()) ? ((await dlg.locator('[data-rep-phone-warning]').textContent()) || '').trim() : ''
  const mail = (await dlg.locator('[data-email-it]').getAttribute('href').catch(() => '')) || ''
  // The calendar invite: what the page hands the browser to download.
  await s.page.evaluate(() => {
    window.__ics = null
    const orig = URL.createObjectURL
    URL.createObjectURL = function (b) { b.text().then(t => { window.__ics = t }); return orig.call(URL, b) }
  })
  await s.tap(dlg.locator('[data-ics-invite]'))
  await waitFor(() => s.page.evaluate(() => !!window.__ics), 5000)
  const ics = (await s.page.evaluate(() => window.__ics)) || ''
  if (shot) await s.shot(shot)
  await s.tap(dlg.locator('[data-booked-done]'))
  return { text, smsBody, warning, mail, ics: ics.replace(/\\,/g, ',').replace(/\\;/g, ';') }
}

async function teamDirectPhone(s) {
  await s.page.goto(`${APP}/team`)
  const row = s.page.locator(`[data-direct-phone="${ids.alpha}"]`)
  await row.waitFor({ timeout: 30000 })
  check(`${s.tag}: Team shows "No Direct phone" for a login without one`, /No Direct phone/.test(await row.textContent()))
  await s.page.locator(`[data-edit-user="${ids.alpha}"]`).click({ force: true })
  const box = s.page.locator('[data-edit-direct-phone]')
  await box.waitFor()
  await box.fill(REPS.alpha.phone)
  await box.blur()
  check(`${s.tag}: the Direct phone box writes it (352) 555 0142`, (await box.inputValue()) === '(352) 555 0142', await box.inputValue())
  await s.page.locator('[data-save-user]').click()
  await waitFor(async () => /\(352\) 555 0142/.test((await row.textContent().catch(() => '')) || ''))
  check(`${s.tag}: Team shows Direct phone (352) 555 0142`, /Direct phone \(352\) 555 0142/.test(await row.textContent()), await row.textContent())
  check(`${s.tag}: kept on the server as 10 digits`, sql(`select phone from "CrmUser" where id = '${ids.alpha}'`) === '3525550142')
  await s.shot('team-direct-phone')
}

function checkDefault(tag, who, r, first, phone) {
  const expected = `Getter Done Fence: Hi Kristi, this is ${first} with Getter Done Fence. You're all set for your fence estimate on ${WHEN}. If anything changes, call or text me directly at ${phone}. Reply STOP to opt out.`
  check(`${tag}: ${who}: the confirmation has ${first}'s name and ${phone}`, r.text === expected, r.text)
  check(`${tag}: ${who}: "Text it" sends the same words`, r.smsBody === r.text, r.smsBody)
  check(`${tag}: ${who}: the email has the subject and the same words, without the text-only parts`,
    r.mail.includes(encodeURIComponent('Your fence estimate with Getter Done Fence')) && decodeURIComponent(r.mail).includes(`Hi Kristi, this is ${first}`) && !decodeURIComponent(r.mail).includes('Reply STOP'), r.mail.slice(0, 160))
  check(`${tag}: ${who}: the calendar invite's description gives ${first} and ${phone}`, r.ics.includes(`DESCRIPTION:Your fence estimate with Getter Done Fence. Questions or changes: call or text ${first} at ${phone}.`), (r.ics.match(/DESCRIPTION:.*/) || [''])[0])
}

async function desktopRun(browser) {
  const s = await open(browser, false)
  await teamDirectPhone(s)

  const alpha = await book(s, full(REPS.alpha), 'booked-rep')
  checkDefault(s.tag, 'rep with a Direct phone', alpha, 'Testrep', '(352) 555 0142')
  check(`${s.tag}: rep with a Direct phone: no warning`, alpha.warning === '', alpha.warning)

  const owner = await book(s, full(REPS.owner))
  checkDefault(s.tag, 'owner-type login', owner, 'Testowner', '(352) 555 0101')

  const none = await book(s, full(REPS.nophone), 'booked-no-phone')
  checkDefault(s.tag, 'rep with no phone', none, 'Testnophone', COMPANY_PHONE)
  check(`${s.tag}: rep with no phone: a warning on the Booked window`, /has no Direct phone saved in Settings > Team, so the text gives the company number, \(352\) 789 4314/.test(none.warning), none.warning)

  // Settings > Messages: edit, live preview, save.
  await s.page.goto(`${APP}/settings?tab=messages`)
  await s.page.waitForSelector('[data-message-settings]', { timeout: 60000 })
  const sec = s.page.locator('[data-message="confirm-estimate"]')
  check(`${s.tag}: Settings > Messages shows the default estimate text`, (await sec.locator('[data-message-input]').inputValue()).startsWith("Hi {customer_first_name}, this is {rep_first_name} with {company_name}. You're all set for your fence estimate"))
  check(`${s.tag}: the preview starts with the company name and ends with the STOP line`, /^Getter Done Fence: Hi Kristi, this is .* Reply STOP to opt out\.$/.test((await sec.locator('[data-message-preview]').textContent()).trim()))
  await sec.locator('[data-message-input]').fill(EDITED)
  const preview = (await sec.locator('[data-message-preview]').textContent()).trim()
  check(`${s.tag}: the live preview follows the edit`, /^Getter Done Fence: Hi Kristi! \S+ from Getter Done Fence will see you \w+day, \w+ \d+ at 10:00 AM\. Questions: .+ Reply STOP to opt out\.$/.test(preview), preview)
  check(`${s.tag}: marked Changed`, (await sec.locator('[data-message-state]').textContent()) === 'Changed')
  await sec.locator('[data-message-input]').fill(EDITED.replace('{rep_phone}', '{rep_phon}'))
  check(`${s.tag}: a mistyped placeholder is named`, /\{rep_phon\}/.test((await sec.locator('[data-message-unknown]').textContent().catch(() => '')) || ''))
  await sec.locator('[data-message-input]').fill(EDITED)
  await s.shot('settings-messages')
  await s.page.locator('[data-save-messages]').click()
  const saved = await waitFor(async () => (await config()).config.appointmentMessages?.confirm?.estimate === EDITED)
  check(`${s.tag}: the edited text is saved on the server`, saved)
  const audit = sql(`select count(*) from "CrmAuditLog" where action = 'settings_changed' and "entityId" = 'business-state/config' and "createdAt" > now() - interval '2 minutes' and "newValues"::text like '%appointmentMessages%'`)
  check(`${s.tag}: the save is in the Change log`, Number(audit) >= 1, audit)

  const edited = await book(s, full(REPS.alpha))
  check(`${s.tag}: the Booked text uses the edited template`, edited.text === `Getter Done Fence: Hi Kristi! Testrep from Getter Done Fence will see you ${WHEN}. Questions: (352) 555 0142 Reply STOP to opt out.`, edited.text)

  // My profile opens with the signed in person's Direct phone box (not saved: that is Jonathan's real row).
  await home(s)
  await s.page.locator('[data-my-profile-open]:visible').first().click()
  check(`${s.tag}: My profile has a Direct phone box`, await s.page.locator('[data-my-profile] [data-my-direct-phone]').isVisible())
  await s.page.locator('[data-my-profile] button:text-is("Cancel")').click()
  check(`${s.tag}: no page errors`, s.errors.length === 0, s.errors.join(' | '))
  return s
}

async function phoneRun(browser) {
  const s = await open(browser, true)
  // Edited on the desktop: the phone gets it from the server.
  const r = await book(s, full(REPS.alpha), 'booked-edited')
  check(`${s.tag}: the edited template reached the phone`, r.text === `Getter Done Fence: Hi Kristi! Testrep from Getter Done Fence will see you ${WHEN}. Questions: (352) 555 0142 Reply STOP to opt out.`, r.text)
  check(`${s.tag}: "Text it" sends the same words`, r.smsBody === r.text)

  const none = await book(s, full(REPS.nophone))
  check(`${s.tag}: rep with no phone: the company number`, none.text.includes(`Questions: ${COMPANY_PHONE}`), none.text)
  check(`${s.tag}: rep with no phone: the warning`, /has no Direct phone saved/.test(none.warning), none.warning)

  const owner = await book(s, full(REPS.owner))
  check(`${s.tag}: owner-type login: his name and his phone`, owner.text.includes('Testowner from Getter Done Fence') && owner.text.includes('(352) 555 0101'), owner.text)

  // Reset to default, on the phone.
  await s.page.goto(`${APP}/settings?tab=messages`)
  await s.page.waitForSelector('[data-message-settings]', { timeout: 60000 })
  const sec = s.page.locator('[data-message="confirm-estimate"]')
  check(`${s.tag}: Settings > Messages shows the edited text`, (await sec.locator('[data-message-input]').inputValue()) === EDITED)
  await s.tap(sec.locator('[data-message-reset]'))
  check(`${s.tag}: Reset to default puts the default back`, (await sec.locator('[data-message-state]').textContent()) === 'Default')
  await s.shot('settings-reset')
  await s.tap(s.page.locator('[data-save-messages]'))
  const reset = await waitFor(async () => !(await config()).config.appointmentMessages?.confirm?.estimate)
  check(`${s.tag}: the reset is saved on the server`, reset)
  const noSideScroll = await s.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
  check(`${s.tag}: Settings > Messages fits the phone`, noSideScroll)
  check(`${s.tag}: no page errors`, s.errors.length === 0, s.errors.join(' | '))
}

let code = 1
const chrome = await chromium.launch()
const safari = await webkit.launch()
try {
  await setup()
  const desk = await desktopRun(chrome)
  await phoneRun(safari)
  // Back on the desktop (a reload, as another computer would): the default words again.
  const back = await book(desk, full(REPS.alpha))
  checkDefault(desk.tag, 'after the reset on the phone', back, 'Testrep', '(352) 555 0142')
} catch (e) {
  check('ran to the end', false, e?.stack || String(e))
} finally {
  await cleanup().catch(e => check('cleanup', false, String(e)))
  await chrome.close(); await safari.close()
  const failed = results.filter(x => !x).length
  console.log(`\n${results.length - failed} of ${results.length} checks passed`)
  code = failed ? 1 : 0
}
process.exit(code)
