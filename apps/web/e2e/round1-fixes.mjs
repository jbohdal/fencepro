// Walkthrough round 1 fixes (Oct 24, 2026; ~/Downloads/walkthrough-2026-10-24/REPORT.md, items 5 and 14),
// on the dev copy, the way they are used:
//
// Phone (iPhone size, WebKit = the Safari engine):
//   1. A website lead (drawn on the photo, sent through /p/quote) with a site visit today:
//      Today > the visit > Ready to quote, 186 ft, notes and a photo > "Save and start the quote"
//      opens THE WEBSITE DRAFT (same quote id) on the Yard step, with the customer's drawing
//      and the site visit (footage, notes, the photo); saving it leaves one quote, not two.
//   2. A Salesman's Today: no "Invalid Date" on the tasks; the visit photo's date on the
//      customer's Photos reads as a date.
// Computer (Chrome, 1440 x 900):
//   3. The "Website quote" notification opens the lead's card window.
//   4. The card's New quote opens the same draft (no second quote).
//   5. Inventory > Invoices: a picture picked as a PDF says so; a PDF uploads and says so;
//      an upload the server turns down says why and can be removed.
//   6. Smart Schedule says "sections", never "sec".
//   7. WT Linda Park (repair): the job page lists the repair items (not 0 ft, 0 sections);
//      the repair quote says "Broken or sagging gate" added the rehang.
//
//   cd apps/web && pnpm -s build
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 E2E_STAFF_COOKIE=<dev owner cookie> (or E2E_ACCESS_TOKEN) \
//   [SHOTS=<folder>] [ONLY=phone|computer] node e2e/round1-fixes.mjs
//   (the cookie: cd apps/portal && npx tsx scripts/dev-session-token.ts --cookie --out <file>)
//
// Dev only (devOnly.mjs refuses port 4000 and anything not on this Mac). The test lead, its
// card, quote, visit, photo and notification are removed at the end; WT records are only read.

import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import './sharedLock.mjs' // writes a customer, a pipeline card and an appointment on the shared dev copy
import { webkit, chromium, devices } from 'playwright'
import { signInByCookie } from './lib.mjs'
import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || 'http://localhost:4001'
const COOKIE = process.env.E2E_STAFF_COOKIE || ''
const TOKEN = process.env.E2E_ACCESS_TOKEN || ''
const SHOTS = process.env.SHOTS || ''
const ONLY = process.env.ONLY || ''
const devLocal = u => /^http:\/\/localhost:\d+\/?$/.test(u) && !/:4000\b/.test(u)
if (!devLocal(APP) || !devLocal(API)) { console.error('Refusing to run: the dev copy only.'); process.exit(2) }
if (!COOKIE && !TOKEN) { console.error('Set E2E_STAFF_COOKIE (scripts/dev-session-token.ts --cookie) or E2E_ACCESS_TOKEN.'); process.exit(2) }

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIX = path.resolve(HERE, '../../portal/tests/fixtures/invoices')
const PHOTO = path.resolve(HERE, 'fixtures/test-photo.jpg')
const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const psql = sql => execFileSync('psql', ['-d', 'ezbiz_dev', '-At', '-c', sql], { encoding: 'utf8' }).trim()
const q = s => String(s).replace(/'/g, "''")
const staffHeaders = COOKIE ? { Cookie: `ezbiz_staff=${COOKIE}`, 'X-Staff-Request': '1' } : { Authorization: `Bearer ${TOKEN}`, 'X-Staff-Request': '1' }
const api = async (p, init = {}) => (await (await fetch(API + p, { ...init, headers: { ...staffHeaders, ...(init.body ? { 'Content-Type': 'application/json' } : {}) } })).json())
const widget = async (p, init = {}) => { const r = await fetch(`${API}/p/quote/api${p}`, { ...init, headers: { 'Content-Type': 'application/json' } }); return { status: r.status, body: await r.json() } }
const shot = async (page, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `round1-${name}.png`) }) } }
// The owner, signed in the way the app does (the ezbiz_staff cookie; e2e/lib.mjs).
const signIn = ctx => signInByCookie(ctx, { cookie: COOKIE, token: TOKEN, email: '', password: '', api: API })
function watch(page) {
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)))
  return errors
}

// A yard drawn on the photo at 110 SE Watula Ave (a real Ocala address), as the website sends it.
const at = { lat: 29.185118, lng: -82.134209 }
const ft = (e, n) => ({ lat: at.lat + (n * 0.3048) / 110_860, lng: at.lng + (e * 0.3048) / 97_330 })
const drawing = { v: 1, address: '110 SE Watula Ave, Ocala, FL 34471', at, runs: [
  { id: 'r1', pts: [ft(-30, 15), ft(-55, 15), ft(-55, 95), ft(55, 95), ft(55, 15), ft(30, 15)], start: 'house', end: 'house', typedFt: [null, null, 112, null, null], gates: [null, { type: 'walk', widthFt: 4, startFt: 11 }, null, { type: 'walk', widthFt: 4, startFt: 30 }, null] },
] }
const pick = { material: 'vinyl', color: 'white', height: '6', kind: 'privacy' }
const NAME = `E2E Round1 Lead ${Date.now().toString(36)}`
const made = { draft: '', contact: '', card: '', quote: '', appt: '', photos: [] }
// When this run started (database time), for the vendor invoice it uploads.
const STARTED = psql(`select to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS.MS')`)

const quotesOf = id => Number(psql(`select count(*) from "SavedQuote" where "crmContactId"='${q(id)}' and "deletedAt" is null`))

async function setup() {
  const d = await widget('/draft', { method: 'PUT', body: JSON.stringify({ id: null, data: { step: 2, address: drawing.address, at, drawing, pick: null } }) })
  made.draft = d.body.id
  const s = await widget('/submit', { method: 'POST', body: JSON.stringify({ draftId: made.draft, name: NAME, phone: '352-555-0161', email: 'e2e.round1@example.invalid', address: drawing.address, drawing, pick, wantsVisit: true }) })
  // The page is told prices only: the customer, card and quote are found from the website lead.
  const [contact = '', quote = '', card = ''] = psql(`select "crmContactId" || '|' || (payload->>'quoteId') || '|' || (payload->>'cardId') from "IntakeLead" where source='ez_quote' and "sourceRef"='${q(made.draft)}'`).split('|')
  Object.assign(made, { contact, quote, card })
  check('setup: the website lead landed (one customer, one card, one draft quote)', s.status < 300 && made.contact && made.card && made.quote && quotesOf(made.contact) === 1, `${s.status} ${JSON.stringify(s.body).slice(0, 160)}`)
  // A site visit today, for the owner, starting now (Florida day).
  const me = await api('/api/crm-auth/me')
  const user = me.data?.user ?? me.data ?? me.user ?? {}
  const owner = `${user.firstName ?? 'Jonathan'} ${user.lastName ?? 'Bohdal'}`.trim()
  const account = psql(`select "accountId" from "CrmContact" where id='${q(made.contact)}'`)
  made.appt = `e2e-round1-${Date.now().toString(36)}`
  psql(`insert into "CrmAppointment" (id, "accountId", "crmContactId", type, status, "startAt", "endAt", address, "assignedTo", "assignedToUserId", history, source, "updatedAt") values ('${made.appt}', '${q(account)}', '${q(made.contact)}', 'estimate', 'scheduled', now() at time zone 'utc' + interval '5 minutes', now() at time zone 'utc' + interval '65 minutes', '${q(drawing.address)}', '${q(owner)}', ${user.id ? `'${q(user.id)}'` : 'null'}, '[]', 'manual', now())`)
}

async function phone(browser) {
  const ctx = await browser.newContext({ ...devices['iPhone 13'] })
  await signIn(ctx)
  const page = await ctx.newPage()
  const errors = watch(page)
  await page.goto(`${APP}/today`)
  await page.waitForSelector('[data-today]', { timeout: 30000 })
  await sleep(2500)
  // The visit is the next one, or in today's list.
  const row = page.locator('button', { hasText: NAME }).first()
  const next = page.getByRole('button', { name: /Complete/ }).first()
  if (await row.count()) await row.click(); else await next.click()
  await page.waitForSelector('[data-outcome-form]', { timeout: 10000 })
  await page.locator('[data-outcome="ready_to_quote"]').click()
  await page.locator('[data-outcome-form] textarea').fill('Back yard, 2 walk gates. Two dogs.')
  await page.locator('[data-feet]').fill('186')
  await page.locator('[data-outcome-form] input[type=file]').setInputFiles(PHOTO)
  await shot(page, 'phone-1-ready-to-quote')
  await page.locator('[data-save-outcome]').click()
  await page.waitForSelector('[data-step-panel="yard"]:not(.hidden)', { timeout: 30000 })
  await sleep(2500)
  const url = new URL(page.url())
  check('phone: Ready to quote opens the website draft (the same quote, not a new one)', url.searchParams.get('quote') === made.quote, page.url())
  check('phone: it opens on the Yard step', await page.locator('[data-step="yard"][aria-selected="true"]').count() === 1)
  check('phone: the customer\'s drawing is there', await page.locator('[data-customer-drawing]').isVisible())
  check('phone: the yard is drawn (the website\'s sides)', await page.locator('[data-step-panel="yard"] svg').count() > 0)
  const visit = page.locator(`[data-site-visit="${made.appt}"]`)
  await visit.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {})
  check('phone: the site visit shows its footage and notes', (await visit.locator('[data-site-visit-feet]').getAttribute('data-site-visit-feet').catch(() => '')) === '186' && /Two dogs/.test(await visit.innerText().catch(() => '')))
  await page.waitForSelector(`[data-site-visit="${made.appt}"] [data-site-visit-photos]`, { timeout: 20000 }).catch(() => {})
  check('phone: the visit\'s photo is in the quote', Number(await visit.locator('[data-site-visit-photos]').getAttribute('data-site-visit-photos').catch(() => '0')) >= 1)
  await shot(page, 'phone-2-draft-with-visit')
  check('phone: still one quote for the customer', quotesOf(made.contact) === 1, String(quotesOf(made.contact)))
  check('phone: no page errors', errors.length === 0, errors.join(' | '))
  await ctx.close()
}

async function salesmanDates(browser) {
  // WT Christa (Salesman): her Today's tasks and the visit photo's date, on the Safari engine.
  const ctx = await browser.newContext({ ...devices['iPhone 13'] })
  const r = await ctx.request.post(`${API}/api/crm-auth/login`, { headers: { 'X-Staff-Request': '1', 'Content-Type': 'application/json' }, data: { email: 'wt-christa@example.invalid', password: 'WT-walk-2026!', cookie: true } })
  if (!r.ok()) { check('salesman: signed in as WT Christa', false, `${r.status()}`); await ctx.close(); return }
  const page = await ctx.newPage()
  const errors = watch(page)
  await page.goto(`${APP}/today`)
  await page.waitForSelector('[data-today]', { timeout: 30000 })
  await page.waitForSelector('[data-tasks]', { timeout: 20000 }).catch(() => {})
  await sleep(1500)
  const tasks = await page.locator('[data-tasks]').innerText().catch(() => '')
  check('salesman (iPhone): Today\'s tasks have real dates, no "Invalid Date"', tasks.length > 0 && !/Invalid Date/.test(tasks) && /due|overdue/.test(tasks), tasks.split('\n').slice(0, 4).join(' / '))
  await shot(page, 'phone-3-salesman-tasks')
  // The photo dates as her phone gets them (the cost filter used to turn every date into {}).
  const photos = await (await ctx.request.get(`${API}/api/portal/customer/${made.contact}/photos`, { headers: { 'X-Staff-Request': '1' } })).json().catch(() => null)
  const first = photos?.data?.[0]
  check('salesman (iPhone): a photo\'s date reaches her phone as a date', !!first && typeof first.uploadedAt === 'string' && !Number.isNaN(Date.parse(first.uploadedAt)), JSON.stringify(first?.uploadedAt))
  await page.goto(`${APP}/customers/${made.contact}`)
  await sleep(3000)
  const tab = page.getByRole('button', { name: 'Photos', exact: true }).first()
  if (await tab.count()) { await tab.click().catch(() => {}); await sleep(2500) }
  const text = await page.evaluate(() => document.body.innerText)
  check('salesman (iPhone): no "Invalid Date" on the customer\'s photos', !/Invalid Date/.test(text))
  await shot(page, 'phone-4-salesman-photos')
  check('salesman (iPhone): no page errors', errors.length === 0, errors.join(' | '))
  await ctx.close()
}

async function computer(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await signIn(ctx)
  const page = await ctx.newPage()
  const errors = watch(page)

  // 3. The notification opens the lead.
  const link = psql(`select coalesce(link,'') from "Notification" where title='Website quote: ${q(NAME)}' order by "createdAt" desc limit 1`)
  check('computer: the Website quote notification links to the lead\'s card', link === `/pipeline?card=${encodeURIComponent(made.card)}`, link)
  await page.goto(`${APP}/`)
  await sleep(3000)
  await page.locator('[aria-label="Notifications"]').first().click()
  await page.locator('button', { hasText: `Website quote: ${NAME}` }).first().click()
  await page.waitForSelector(`[data-card-window="${made.card}"]`, { timeout: 20000 }).catch(() => {})
  check('computer: tapping it opens the lead\'s card window', await page.locator(`[data-card-window="${made.card}"]`).isVisible().catch(() => false), page.url())
  await shot(page, 'computer-1-notification-card')

  // 4. The card's New quote opens the same draft.
  await page.locator(`[data-card-window="${made.card}"] [data-card-new-quote]`).click()
  await page.waitForSelector('[data-step-panel="yard"]:not(.hidden)', { timeout: 20000 }).catch(() => {})
  await sleep(1500)
  check('computer: the card\'s New quote opens the website draft, not a blank quote', new URL(page.url()).searchParams.get('quote') === made.quote && await page.locator('[data-customer-drawing]').isVisible().catch(() => false), page.url())
  check('computer: still one quote for the customer', quotesOf(made.contact) === 1)
  await shot(page, 'computer-2-card-draft')
  await page.keyboard.press('Escape').catch(() => {})
  await page.goto(`${APP}/inventory?tab=invoices`)

  // 5. Vendor invoices: every outcome said in words.
  await page.waitForSelector('[data-upload-pdf]', { timeout: 30000 }).catch(async () => { await page.getByRole('button', { name: 'Invoices', exact: true }).first().click(); await page.waitForSelector('[data-upload-pdf]', { timeout: 15000 }) })
  const toastText = async () => (await page.evaluate(() => document.body.innerText))
  let [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-upload-pdf]')])
  await fc.setFiles(path.join(FIX, 'photo.jpg'))
  await sleep(800)
  check('computer: a picture picked under PDF files says it is not a PDF', /photo\.jpg is not a PDF/.test(await toastText()))
  ;[fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-upload-pdf]')])
  await fc.setFiles(path.join(FIX, 'text.pdf'))
  await page.waitForFunction(() => /The invoice (uploaded|was not uploaded|is not uploaded yet)/.test(document.body.innerText), null, { timeout: 30000 }).catch(() => {})
  check('computer: a PDF uploads and says so', /The invoice uploaded/.test(await toastText()))
  await shot(page, 'computer-3-invoice-uploaded')
  // The server turns one down (made to, here): the reason is shown, it can be removed, and nothing else is stuck.
  await page.route('**/api/media/uploads', route => route.request().method() === 'POST'
    ? route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'Not a photo or video this app takes' }) })
    : route.continue())
  ;[fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-pick-photos]')])
  await fc.setFiles(path.join(FIX, 'photo.jpg'))
  check('computer: picked photos wait in a tray that says they are not uploaded yet', await page.locator('[data-pages-hint]').isVisible())
  await page.click('[data-send-pages]')
  await page.waitForSelector('[data-upload-refused]', { timeout: 20000 }).catch(() => {})
  const refusedText = await page.locator('[data-upload-refused]').first().innerText().catch(() => '')
  check('computer: an upload the server turns down says why', /was not uploaded: Not a photo or video this app takes/.test(refusedText) && /was not uploaded/.test(await toastText()), refusedText)
  await shot(page, 'computer-4-invoice-refused')
  await page.unroute('**/api/media/uploads')
  await page.locator('[data-upload-refused-remove]').first().click()
  await sleep(1000)
  check('computer: Remove takes it off this device', await page.locator('[data-upload-refused]').count() === 0)

  // 6. Smart Schedule: sections, not "sec".
  await page.goto(`${APP}/schedule`)
  await sleep(2500)
  await page.getByRole('button', { name: /Smart Schedule/ }).first().click()
  await page.waitForSelector('[data-smart-job]', { timeout: 30000 }).catch(() => {})
  await sleep(1500)
  const smart = await page.evaluate(() => [...document.querySelectorAll('[data-smart-job]')].map(e => e.textContent).join(' | '))
  check('computer: Smart Schedule says "sections", never "sec"', smart.length > 0 && !/\d+ sec\b/.test(smart) && /\d+ sections?/.test(smart), (smart.match(/.{0,40}\d+ sec\b.{0,10}/) ?? [smart.slice(0, 160)])[0])
  await shot(page, 'computer-5-smart-schedule')
  await page.keyboard.press('Escape').catch(() => {})

  // 7. A repair job and its quote (WT Linda Park; read only).
  const linda = psql(`select id || '|' || "quoteId" from "SavedJob" where "customerName" like 'WT Linda Park%' and "deletedAt" is null limit 1`).split('|')
  if (linda[0]) {
    await page.goto(`${APP}/operations?job=${encodeURIComponent(linda[0])}`)
    await page.waitForSelector('[data-job-work-items]', { timeout: 20000 }).catch(() => {})
    const items = await page.locator('[data-job-work-items]').innerText().catch(() => '')
    check('computer: the repair job lists its items, not 0 ft and 0 sections', /Replace a post: 2/.test(items) && /Rehang a gate/.test(items), items.replace(/\n/g, ' / ').slice(0, 160))
    await shot(page, 'computer-6-repair-job')
    await page.goto(`${APP}/quotes?quote=${encodeURIComponent(linda[1])}`)
    await page.waitForSelector('[data-step="style"]', { timeout: 30000 }).catch(() => {})
    await page.locator('[data-step="style"]').click().catch(() => {})
    await page.waitForSelector('[data-repair-starter-note]', { timeout: 15000 }).catch(() => {})
    const note = await page.locator('[data-repair-starter-note]').innerText().catch(() => '')
    check('computer: "Broken or sagging gate" says it added the rehang', /"Broken or sagging gate" added 1 × Rehang a gate with new hardware/.test(note), note)
    check('computer: the rehang row is marked as added by it', await page.locator('[data-repair-item="rehangGate"][data-repair-item-starter="yes"]').count() === 1)
    await shot(page, 'computer-7-repair-note')
  } else check('computer: WT Linda Park is on the dev copy', false)

  // The address lookup: a street the county list lacks is not matched to the other end of Florida.
  const sug = await api(`/api/appointments/geo/suggest?q=${encodeURIComponent('2715 SE 3rd St')}`)
  const cities = (sug.data ?? []).map(s => s.city)
  check('computer: the address lookup offers nothing far from Ocala', !cities.some(c => /Homestead|Pompano|Okeechobee/i.test(c)), JSON.stringify(cities))
  check('computer: no page errors', errors.length === 0, errors.join(' | '))
  await ctx.close()
}

async function cleanup(name = NAME) {
  try {
    if (made.quote) await api(`/api/saved-quotes/${made.quote}`, { method: 'DELETE' })
    if (made.card) { const pipe = await api('/api/pipeline'); await api('/api/pipeline', { method: 'PATCH', body: JSON.stringify({ upsert: [], remove: [made.card], baseVersion: pipe.data.version }) }) }
    if (made.appt) psql(`delete from "CrmAppointment" where id='${q(made.appt)}'`)
    if (made.contact) {
      const keys = psql(`select "fileKey" from "PortalPhoto" where "crmCustomerId"='${q(made.contact)}'`).split('\n').filter(Boolean)
      for (const k of keys) { const f = path.resolve(HERE, '../../portal/uploads', k); if (fs.existsSync(f) && f.includes(`${path.sep}uploads${path.sep}`)) fs.unlinkSync(f) }
      psql(`delete from "PortalPhoto" where "crmCustomerId"='${q(made.contact)}'`)
      psql(`delete from "SavedQuote" where "crmContactId"='${q(made.contact)}'; delete from "IntakeLead" where "crmContactId"='${q(made.contact)}'; delete from "CrmContactNote" where "crmContactId"='${q(made.contact)}'; delete from "AutomationEvent" where "entityId"='${q(made.card)}'; delete from "CardFollowUp" where "cardId"='${q(made.card)}'; delete from "CustomerPossibleMatch" where "contactId"='${q(made.contact)}'; delete from "CrmContact" where id='${q(made.contact)}'`)
    }
    psql(`delete from "Notification" where title='Website quote: ${q(name.trim())}'`)
    // The invoice this run uploaded (and any "already uploaded" refusal of it): refusals first, they point at it.
    const mine = `select "invoiceId" from "VendorInvoiceFile" where "fileName" = 'text.pdf' and "createdAt" >= '${STARTED}'`
    for (const f of psql(`select path from "VendorInvoiceFile" where "invoiceId" in (${mine})`).split('\n').filter(Boolean)) if (fs.existsSync(f) && f.includes(`${path.sep}uploads${path.sep}invoices${path.sep}`)) fs.unlinkSync(f)
    psql(`delete from "VendorInvoice" where status = 'refused' and id in (${mine}); delete from "VendorInvoice" where id in (${mine})`)
    if (made.draft) psql(`delete from "WidgetDraft" where id='${q(made.draft)}'`)
    check('test records removed', !made.contact || psql(`select count(*) from "CrmContact" where id='${q(made.contact)}'`) === '0')
  } catch (e) { check('test records removed', false, String(e?.message || e).slice(0, 200)) }
}

// Test leads left by a run that died: removed first (only this test's own names).
for (const row of psql(`select "crmContactId" || '|' || coalesce(payload->>'cardId','') || '|' || coalesce(payload->>'quoteId','') || '|' || "sourceRef" from "IntakeLead" where source='ez_quote' and name like 'E2E Round1 Lead %'`).split('\n').filter(Boolean)) {
  const [contact, card, quote, draft] = row.split('|')
  Object.assign(made, { contact, card, quote, draft, appt: '' })
  const name = psql(`select coalesce("firstName",'') || ' ' || coalesce("lastName",'') from "CrmContact" where id='${q(contact)}'`)
  psql(`delete from "CrmAppointment" where "crmContactId"='${q(contact)}' and id like 'e2e-round1-%'`)
  await cleanup(name)
}
Object.assign(made, { draft: '', contact: '', card: '', quote: '', appt: '' })

const wk = await webkit.launch()
const ch = await chromium.launch()
try {
  await setup()
  if (ONLY !== 'computer') { await phone(wk); await salesmanDates(wk) }
  if (ONLY !== 'phone') await computer(ch)
} catch (e) {
  check('test run finished', false, String(e?.message || e).split('\n').slice(0, 3).join(' '))
} finally {
  await cleanup()
  await wk.close(); await ch.close()
}
const failed = results.filter(r => !r).length
console.log(`\n${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
