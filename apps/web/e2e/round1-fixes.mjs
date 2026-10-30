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
//   7. A repair of its own ("Broken or sagging gate", 2 posts): the job page lists the repair items (not 0 ft, 0 sections);
//      the repair quote says "Broken or sagging gate" added the rehang.
//
//   cd apps/web && pnpm -s build
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 E2E_STAFF_COOKIE=<dev owner cookie> (or E2E_ACCESS_TOKEN) \
//   [SHOTS=<folder>] [ONLY=phone|computer] node e2e/round1-fixes.mjs
//   (the cookie: cd apps/portal && npx tsx scripts/dev-session-token.ts --cookie --out <file>)
//
// Review round A (Oct 25): the draft's Good / Better / Best equal the website's three prices (owner on a computer,
// a Salesman on a phone); the website's free visit box ticks from its words and the thank-you follows it; the
// customer's yard photo is on the quote and their Photos; one toast at a time, never over the quote's bar; the
// address lookup and Smart Schedule place Ocala streets the county list lacks; a duplicate invoice is not called
// uploaded; a photo renamed .pdf says why; a repair job's Fence Type says Repair.
//
// Dev only (devOnly.mjs refuses port 4000 and anything not on this Mac). The test lead, its
// card, quote, visit, photo and notification, its repair customer, quote and job, and its Salesman login are
// removed at the end. (It used to read the WT test records; a scrubbed copy of live has none, Oct 26 2026.)

import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import './sharedLock.mjs' // writes a customer, a pipeline card and an appointment on the shared dev copy
import { webkit, chromium, devices } from 'playwright'
import { signInByCookie, makeTestLogin, removeTestLogin } from './lib.mjs'
import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import crypto from 'crypto'
import { toContactStep } from './widgetSteps.mjs'

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
const made = { draft: '', contact: '', card: '', quote: '', appt: '', photos: [], repairContact: '', repairQuote: '', repairJob: '' }
// The Salesman: a login of its own, made in setup() (the WT test logins are not on a scrubbed copy of live).
let SALESMAN = null
const salesmanSignIn = ctx => ctx.request.post(`${API}/api/crm-auth/login`, { headers: { 'X-Staff-Request': '1', 'Content-Type': 'application/json' }, data: { email: SALESMAN?.email, password: SALESMAN?.password, cookie: true } })
const REPAIR_ADDR = '2715 SE 3rd St, Ocala, FL 34471'
const REPAIR_NAME = `E2E Round1 Repair ${Date.now().toString(36)}`
// When this run started (database time), for the vendor invoice it uploads.
const STARTED = psql(`select to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS.MS')`)

const quotesOf = id => Number(psql(`select count(*) from "SavedQuote" where "crmContactId"='${q(id)}' and "deletedAt" is null`))

async function setup() {
  // The visit's id, as the page makes it (kept in its memory; no draft is saved before the name and phone).
  made.draft = crypto.randomBytes(18).toString('base64url')
  // The name and phone typed: the lead so far is saved (a photo is kept only with a lead).
  await widget('/partial', { method: 'POST', body: JSON.stringify({ sessionId: made.draft, name: NAME, phone: '352-555-0161', email: 'e2e.round1@example.invalid', address: drawing.address, drawing, pick, step: 3 }) })
  // A photo of the yard, sent with the quote as the website sends it.
  const fd = new FormData()
  fd.append('file', new Blob([fs.readFileSync(PHOTO)], { type: 'image/jpeg' }), 'yard.jpg')
  const up = await (await fetch(`${API}/p/quote/api/photo?sid=${made.draft}`, { method: 'POST', body: fd })).json()
  made.photo = up.url || ''
  const s = await widget('/submit', { method: 'POST', body: JSON.stringify({ draftId: made.draft, name: NAME, phone: '352-555-0161', email: 'e2e.round1@example.invalid', address: drawing.address, drawing, pick, wantsVisit: true, photos: made.photo ? [made.photo] : [] }) })
  // The page is told prices only: the customer, card and quote are found from the website lead.
  const [contact = '', quote = '', card = ''] = psql(`select "crmContactId" || '|' || (payload->>'quoteId') || '|' || (payload->>'cardId') from "IntakeLead" where source='ez_quote' and "sourceRef"='${q(made.draft)}'`).split('|')
  Object.assign(made, { contact, quote, card })
  // The three prices the website showed the customer (Good, Better, Best).
  made.web = Object.fromEntries((s.body.options ?? []).map(o => [o.key, Math.round(o.price * 100)]))
  check('setup: the customer\'s yard photo is on their Photos (from the customer) and on the quote', !!made.photo
    && psql(`select count(*) from "PortalPhoto" where "crmCustomerId"='${q(made.contact)}' and "fileUrl"='${q(made.photo)}' and source='portal_customer' and "deletedAt" is null`) === '1'
    && psql(`select layout::jsonb->'widgetDrawing'->'photos'->>0 from "SavedQuote" where id='${q(made.quote)}'`) === made.photo, made.photo)
  check('setup: the lead\'s notes carry no raw file links', !/\/api\/portal\/files\//.test(psql(`select coalesce(string_agg(body, ' '), '') from "CrmContactNote" where "crmContactId"='${q(made.contact)}'`) + psql(`select notes from "SavedQuote" where id='${q(made.quote)}'`)))
  check('setup: the website lead landed (one customer, one card, one draft quote)', s.status < 300 && made.contact && made.card && made.quote && quotesOf(made.contact) === 1, `${s.status} ${JSON.stringify(s.body).slice(0, 160)}`)
  // A site visit today, for the owner, starting now (Florida day).
  const me = await api('/api/crm-auth/me')
  const user = me.data?.user ?? me.data ?? me.user ?? {}
  const owner = `${user.firstName ?? 'Jonathan'} ${user.lastName ?? 'Bohdal'}`.trim()
  const account = psql(`select "accountId" from "CrmContact" where id='${q(made.contact)}'`)
  made.appt = `e2e-round1-${Date.now().toString(36)}`
  psql(`insert into "CrmAppointment" (id, "accountId", "crmContactId", type, status, "startAt", "endAt", address, "assignedTo", "assignedToUserId", history, source, "updatedAt") values ('${made.appt}', '${q(account)}', '${q(made.contact)}', 'estimate', 'scheduled', now() at time zone 'utc' + interval '5 minutes', now() at time zone 'utc' + interval '65 minutes', '${q(drawing.address)}', '${q(owner)}', ${user.id ? `'${q(user.id)}'` : 'null'}, '[]', 'manual', now())`)
  // A Salesman login of its own (made with the owner's token; removed at the end).
  if (TOKEN) SALESMAN = await makeTestLogin({ role: 'sales_rep', firstName: 'Christa', ownerToken: TOKEN, api: API }).catch(e => { console.log('salesman login not made:', String(e).slice(0, 200)); return null })
  // A repair of its own, sold, with its job (item 7): "Broken or sagging gate" added the rehang; 2 posts typed.
  const rc = await api('/api/crm-contacts', { method: 'POST', body: JSON.stringify({ firstName: 'E2E', lastName: REPAIR_NAME.replace(/^E2E /, ''), phone: '3525550164', email: 'e2e.round1.repair@example.invalid', serviceAddress: REPAIR_ADDR, leadSource: 'Other' }) })
  made.repairContact = rc.data?.id || ''
  const work = { version: 1, type: 'repair', repair: { what: 'gate', items: { replacePost: 2, rehangGate: 1 }, gateKind: 'walk', postType: 'nd', newPostCaps: false }, crew: ['Replace a post: 2. Pull the old post and set a new one.', 'Rehang a gate with new hardware: 1 (walk gate). New hinges and latch.', 'Old posts come out with their pipe and donuts; haul them away.'], description: 'Replace 2 posts, rehang the walk gate with new hinges and latch, haul away the old posts.', needs811: true, warnings: [], priced: {} }
  const rq = await api('/api/saved-quotes', { method: 'POST', body: JSON.stringify({ crmContactId: made.repairContact, customerName: REPAIR_NAME, customerPhone: '3525550164', customerAddress: REPAIR_ADDR, fenceStyle: "WV-ND 6'x8' Privacy", runs: [], corners: 0, ends: 0, sections: 0, finalPrice: 650, status: 'SOLD', work }) })
  made.repairQuote = rq.data?.id || rq.id || ''
  const rj = await api('/api/saved-jobs', { method: 'POST', body: JSON.stringify({ customerName: REPAIR_NAME, crmContactId: made.repairContact, quoteId: made.repairQuote, customerAddress: REPAIR_ADDR, fenceStyle: "WV-ND 6'x8' Privacy", sections: 0, totalFeet: 0, quotePrice: 650, contractValue: 650, status: 'staging' }) })
  made.repairJob = rj.data?.id || ''
  check('setup: a Salesman login and a sold repair with its job, of its own', !!SALESMAN && !!made.repairContact && !!made.repairQuote && !!made.repairJob, `${!!SALESMAN} ${made.repairContact} ${made.repairQuote} ${made.repairJob}`)
  // The Salesman sees only the Salesman's own and assigned customers (lib/salesScope.ts, Oct 28 2026): the owner gives
  // the website lead to the Salesman on the Assign screen (its call). The owner's visit made it his, so he answers
  // Yes to "Already assigned to …: move it?" (replace).
  if (SALESMAN?.id) {
    const r = await fetch(`${API}/api/lead-assign/${made.contact}`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', 'X-Staff-Request': '1' }, body: JSON.stringify({ to: SALESMAN.id, replace: true }) })
    check('setup: the owner assigns the website lead to the Salesman', r.status === 200, `${r.status} ${(await r.text()).slice(0, 160)}`)
  }
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
  // Tapping a visit opens the visit first (d1f303c and 204768f, Oct 26-27 2026: Call, Navigate, New quote,
  // "How did it go?", Change appointment); "How did it go?" opens the outcome form.
  await page.waitForSelector('[data-visit-window], [data-outcome-form]', { timeout: 10000 })
  if (await page.locator('[data-visit-window]').count()) {
    check('phone: tapping the visit opens it, with "How did it go?"', await page.locator('[data-visit-window] [data-visit-outcome]').count() === 1)
    await page.locator('[data-visit-window] [data-visit-outcome]').click()
  }
  await page.waitForSelector('[data-outcome-form]', { timeout: 10000 })
  await page.locator('[data-outcome="ready_to_quote"]').click()
  await page.locator('[data-outcome-form] textarea').fill('Back yard, 2 walk gates. Two dogs.')
  await page.locator('[data-feet]').fill('186')
  await page.locator('[data-outcome-form] input[type=file]').setInputFiles(PHOTO)
  await shot(page, 'phone-1-ready-to-quote')
  await page.locator('[data-save-outcome]').click()
  await page.waitForSelector('[data-step-panel="yard"]:not(.hidden)', { timeout: 30000 })
  await sleep(700)
  // One message at a time, sitting above the quote's bar (never over Next or most of the drawing).
  const t = await page.evaluate(() => {
    const ts = [...document.querySelectorAll('[data-toast]')].map(e => e.getBoundingClientRect())
    const bar = document.querySelector('[data-quote-bar]')?.getBoundingClientRect()
    return { n: ts.length, bottom: ts[0]?.bottom ?? 0, height: ts[0]?.height ?? 0, barTop: bar?.top ?? 0, vh: innerHeight }
  })
  check('phone: one toast at a time after "Save and start the quote", above the quote bar, small', t.n === 1 && t.bottom <= t.barTop + 1 && t.height < t.vh * 0.2, JSON.stringify(t))
  await shot(page, 'phone-1b-one-toast')
  await sleep(1800)
  const url = new URL(page.url())
  check('phone: Ready to quote opens the website draft (the same quote, not a new one)', url.searchParams.get('quote') === made.quote, page.url())
  check('phone: it opens on the Yard step', await page.locator('[data-step="yard"][aria-selected="true"]').count() === 1)
  check('phone: the customer\'s drawing is there', await page.locator('[data-customer-drawing]').isVisible())
  check('phone: the customer\'s own yard photo is on the quote', await page.locator('[data-customer-drawing-photos="1"]').count() === 1)
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

// The opened draft's Good, Better, Best are the prices the website promised (owner: priced in the
// browser; a Salesman: priced on the server). Item 1 of the review: Good read $668 more than the website.
async function tiersMatch(browser, who, phoneSize) {
  const ctx = await browser.newContext(phoneSize ? { ...devices['iPhone 13'] } : { viewport: { width: 1440, height: 900 } })
  if (who === 'owner') await signIn(ctx)
  else {
    const r = await salesmanSignIn(ctx)
    if (!r.ok()) { check(`${who}: signed in`, false, String(r.status())); await ctx.close(); return }
  }
  const page = await ctx.newPage()
  await page.goto(`${APP}/quotes?quote=${encodeURIComponent(made.quote)}`)
  await page.waitForSelector('[data-step="price"]', { timeout: 30000 })
  await page.locator('[data-step="price"]').click()
  await page.waitForFunction(() => document.querySelectorAll('[data-step-panel="price"] [data-tier] [data-tier-price]').length >= 3, null, { timeout: 30000 }).catch(() => {})
  await sleep(1500)
  const shown = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-step-panel="price"] [data-tier]')].map(e => [e.getAttribute('data-tier'), Math.round(Number((e.querySelector('[data-tier-price]')?.textContent || '').replace(/[^\d.]/g, '')) * 100)])))
  const keys = Object.keys(made.web)
  check(`${who} (${phoneSize ? 'phone' : 'computer'}): the draft's Good, Better, Best are the website's prices`, keys.length === 3 && keys.every(k => shown[k] === made.web[k]), `website ${JSON.stringify(made.web)} quote ${JSON.stringify(shown)}`)
  await shot(page, `${who}-${phoneSize ? 'phone' : 'computer'}-tiers`)
  await ctx.close()
}

// The website's free visit box: its words tick it, and the thank-you follows the box. The page's own answers
// are stood in for (the lead saved once the phone is typed, and the send), so nothing is saved and no lead is made.
async function websiteVisitBox(browser) {
  const ctx = await browser.newContext({ ...devices['iPhone 13'] })
  const page = await ctx.newPage()
  let sentBody = null
  await page.route(/gis\.ocalafl\.org/, route => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '{"features":[]}' }))
  await page.route('**/p/quote/api/partial', route => route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ success: true, saved: true }) }))
  await page.route('**/p/quote/api/submit', route => { sentBody = JSON.parse(route.request().postData() || '{}'); return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ success: true, test: false, duplicate: false, options: [{ key: 'better', name: 'Better', text: '', popular: true, fenceStyle: "WV-ND 6'x8' Privacy", styleLabel: 'White Vinyl Privacy', price: 11299, perFoot: 40 }], chosen: { key: 'better', name: 'Better', text: '', popular: true, fenceStyle: "WV-ND 6'x8' Privacy", styleLabel: 'White Vinyl Privacy', price: 11299, perFoot: 40 } }) }) })
  await page.goto(`${APP}/p/quote/`)
  await toContactStep(page, { tap: true })
  await page.waitForSelector('[data-w-visit]', { timeout: 30000 })
  const box = page.locator('[data-w-visit]')
  const before = await box.isChecked()
  await page.locator('[data-w-visit-row] span').tap()
  const afterOne = await box.isChecked()
  check('website (phone): tapping the words "I would like a free visit" ticks or unticks the box', afterOne !== before, `${before} -> ${afterOne}`)
  if (afterOne) await page.locator('[data-w-visit-row] span').tap()
  await page.locator('[data-w-name]').fill('E2E Visit Box')
  await page.locator('[data-w-phone]').fill('352-555-0162')
  await page.locator('[data-w-send]').tap()
  await page.waitForSelector('[data-w-sent-words]', { timeout: 15000 }).catch(() => {})
  const words = await page.locator('[data-w-sent-words]').innerText().catch(() => '')
  check('website (phone): no visit asked: the lead says so and the thank-you does not promise a visit', sentBody?.wantsVisit === false && !/set up a free visit/.test(words) && /about your estimate/.test(words), `${JSON.stringify(sentBody?.wantsVisit)} | ${words}`)
  await shot(page, 'phone-0-website-no-visit')
  await ctx.close()
}

async function salesmanDates(browser) {
  // The Salesman: her Today's tasks and the visit photo's date, on the Safari engine.
  const ctx = await browser.newContext({ ...devices['iPhone 13'] })
  const r = await salesmanSignIn(ctx)
  if (!r.ok()) { check('salesman: signed in as the test Salesman', false, `${r.status()}`); await ctx.close(); return }
  const page = await ctx.newPage()
  const errors = watch(page)
  await page.goto(`${APP}/today`)
  await page.waitForSelector('[data-today]', { timeout: 30000 })
  await page.waitForSelector('[data-tasks]', { timeout: 20000 }).catch(() => {})
  await sleep(1500)
  const tasks = await page.locator('[data-tasks]').innerText().catch(() => '')
  // Since Oct 25 Today lists only her own tasks (often none): no "Invalid Date" anywhere, and real dates wherever tasks show.
  check('salesman (iPhone): Today\'s tasks have real dates, no "Invalid Date"', !/Invalid Date/.test(tasks) && (/Nothing on your list/.test(tasks) || /due|overdue/.test(tasks)), tasks.split('\n').slice(0, 4).join(' / '))
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
  // A new website lead's bell entry opens its Assign screen (lead-assign push, Oct 28 2026), then the card from there.
  check('computer: the Website quote notification links to the lead\'s Assign screen', link === `/assign-lead?customer=${made.contact}` || link === `/assign-lead?customer=${encodeURIComponent(made.contact)}`, link)
  await page.goto(`${APP}/`)
  await sleep(3000)
  await page.locator('[aria-label="Notifications"]').first().click()
  await page.locator('button', { hasText: `Website quote: ${NAME}` }).first().click()
  await page.waitForSelector(`[data-assign-lead="${made.contact}"]`, { timeout: 20000 }).catch(() => {})
  check('computer: tapping it opens the lead\'s Assign screen', await page.locator(`[data-assign-lead="${made.contact}"]`).isVisible().catch(() => false), page.url())
  await page.goto(`${APP}/pipeline?card=${encodeURIComponent(made.card)}`)
  await page.waitForSelector(`[data-card-window="${made.card}"]`, { timeout: 20000 }).catch(() => {})
  check('computer: the lead\'s card window opens', await page.locator(`[data-card-window="${made.card}"]`).isVisible().catch(() => false), page.url())
  await shot(page, 'computer-1-notification-card')

  // 4. The card's New quote opens the same draft.
  await page.locator(`[data-card-window="${made.card}"] [data-card-new-quote]`).click()
  await page.waitForSelector('[data-step-panel="yard"]:not(.hidden)', { timeout: 20000 }).catch(() => {})
  await sleep(1500)
  check('computer: the card\'s New quote opens the website draft, not a blank quote', new URL(page.url()).searchParams.get('quote') === made.quote && await page.locator('[data-customer-drawing]').isVisible().catch(() => false), page.url())
  check('computer: still one quote for the customer', quotesOf(made.contact) === 1)
  const over = await page.evaluate(() => {
    const a = document.querySelector('[data-toast]')?.getBoundingClientRect()
    const bar = document.querySelector('[data-quote-bar]')?.getBoundingClientRect()
    if (!a || !bar) return { toast: !!a, bar: !!bar, overlap: false }
    return { toast: true, bar: true, overlap: a.bottom > bar.top + 1 }
  })
  check('computer: the toast sits above the quote bar, not over Next', !over.overlap, JSON.stringify(over))
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
  await page.waitForFunction(() => /The invoice (uploaded|was not uploaded|was not added|is not uploaded yet)/.test(document.body.innerText), null, { timeout: 40000 }).catch(() => {})
  const first = await toastText()
  check('computer: a PDF uploads and says so', /The invoice uploaded/.test(first), first.match(/The invoice[^\n]*\n?[^\n]*/)?.[0] ?? '')
  await sleep(3500)
  // Toasts show one at a time and now stay long enough to read (Oct 28 2026): close the first, as the office would.
  for (let i = 0; i < 5 && await page.locator('[data-toast] button').count(); i++) { await page.locator('[data-toast] button').first().click().catch(() => {}); await sleep(300) }
  // The same file again: the Mac refuses it, so it is not called uploaded.
  ;[fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-upload-pdf]')])
  await fc.setFiles(path.join(FIX, 'text.pdf'))
  await page.waitForFunction(() => /The invoice (uploaded|was not added|was not uploaded)/.test(document.body.innerText), null, { timeout: 40000 }).catch(() => {})
  const dup = await toastText()
  check('computer: the same invoice again is "not added" (already uploaded), no green uploaded', /The invoice was not added/.test(dup) && /already uploaded/.test(dup) && !/The invoice uploaded/.test(dup), dup.match(/The invoice[^\n]*\n?[^\n]*/)?.[0] ?? '')
  await sleep(7500)
  // A photo renamed .pdf: said at once, not uploaded.
  const fakePdf = path.join(os.tmpdir(), `e2e-round1-photo-renamed-${process.pid}.pdf`)
  fs.copyFileSync(PHOTO, fakePdf)
  ;[fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-upload-pdf]')])
  await fc.setFiles(fakePdf)
  await page.waitForFunction(() => /named \.pdf but is not a PDF/.test(document.body.innerText), null, { timeout: 20000 }).catch(() => {})
  check('computer: a photo renamed .pdf says it is not a PDF and is not uploaded', /named \.pdf but is not a PDF/.test(await toastText()))
  fs.rmSync(fakePdf, { force: true })
  await sleep(7500)
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

  // 7. A repair job and its quote (its own, made in setup()).
  const linda = [made.repairJob, made.repairQuote]
  if (linda[0]) {
    await page.goto(`${APP}/operations?job=${encodeURIComponent(linda[0])}`)
    await page.waitForSelector('[data-job-work-items]', { timeout: 20000 }).catch(() => {})
    const items = await page.locator('[data-job-work-items]').innerText().catch(() => '')
    check('computer: the repair job lists its items, not 0 ft and 0 sections', /Replace a post: 2/.test(items) && /Rehang a gate/.test(items), items.replace(/\n/g, ' / ').slice(0, 160))
    const fenceType = await page.evaluate(() => [...document.querySelectorAll('div,p,dt,span')].find(e => e.textContent?.trim() === 'Fence Type')?.parentElement?.textContent ?? '')
    check('computer: the repair job\'s Fence Type says Repair (the style as the existing fence)', /Fence Type\s*Repair/.test(fenceType) && /Existing fence/.test(await page.locator('[data-job-work-scope]').evaluate(e => e.parentElement?.textContent ?? '').catch(() => '')), fenceType.slice(0, 80))
    await shot(page, 'computer-6-repair-job')
    await page.goto(`${APP}/quotes?quote=${encodeURIComponent(linda[1])}`)
    await page.waitForSelector('[data-step="style"]', { timeout: 30000 }).catch(() => {})
    await page.locator('[data-step="style"]').click().catch(() => {})
    await page.waitForSelector('[data-repair-starter-note]', { timeout: 15000 }).catch(() => {})
    const note = await page.locator('[data-repair-starter-note]').innerText().catch(() => '')
    check('computer: "Broken or sagging gate" says it added the rehang', /"Broken or sagging gate" added 1 × Rehang a gate with new hardware/.test(note), note)
    check('computer: the rehang row is marked as added by it', await page.locator('[data-repair-item="rehangGate"][data-repair-item-starter="yes"]').count() === 1)
    await shot(page, 'computer-7-repair-note')
  } else check('computer: the test repair job was made', false)

  // The address lookup: a street the county list lacks is not matched to the other end of Florida.
  const sug = await api(`/api/appointments/geo/suggest?q=${encodeURIComponent('2715 SE 3rd St')}`)
  const cities = (sug.data ?? []).map(s => s.city)
  check('computer: the address lookup offers nothing far from Ocala', !cities.some(c => /Homestead|Pompano|Okeechobee/i.test(c)), JSON.stringify(cities))
  check('computer: "2715 SE 3rd St" (no city typed) is offered in Ocala first', sug.data?.[0]?.line1 === '2715 SE 3rd St' && sug.data?.[0]?.city === 'Ocala', JSON.stringify(sug.data?.[0]))
  const sug2 = await api(`/api/appointments/geo/suggest?q=${encodeURIComponent('3300 SE 24th St')}`)
  check('computer: "3300 SE 24th St" is offered in Ocala first, not Webster', sug2.data?.[0]?.city === 'Ocala' && sug2.data?.[0]?.line1 === '3300 SE 24th St', JSON.stringify((sug2.data ?? []).map(s => s.formatted)))
  // Two Ocala addresses the county list has (the repair job's, and the website lead's).
  for (const [who, addr] of [[REPAIR_NAME, REPAIR_ADDR], ['the website lead', drawing.address]]) {
    const p = addr ? (await api(`/api/appointments/geo/lookup?address=${encodeURIComponent(addr)}`)).data : null
    check(`computer: ${who}'s address (${addr}) is placed on the map near Ocala`, !!p && Math.abs(p.lat - 29.18) < 0.1 && Math.abs(p.lng + 82.13) < 0.15, JSON.stringify(p))
  }
  await page.goto(`${APP}/schedule`)
  await sleep(2500)
  await page.getByRole('button', { name: /Smart Schedule/ }).first().click()
  await page.waitForSelector('[data-smart-job]', { timeout: 30000 }).catch(() => {})
  await sleep(3000)
  // Only the rows of the "couldn't be located" box (other runs' test jobs with made up addresses may be in it;
  // reading 400 characters of page text after its heading ran on into the job list below it).
  const unplaced = (await page.locator('[data-geocode-error]').allInnerTexts().catch(() => [])).join(' | ')
  check('computer: Smart Schedule places the test repair job', !unplaced.includes(REPAIR_NAME), unplaced.slice(0, 160))
  await page.keyboard.press('Escape').catch(() => {})
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
      // The visit's photo (since Oct 26 one of the customer's photos and video, lib/quoteMedia.ts): rows and files.
      for (const f of psql(`select path || E'\\n' || coalesce("thumbPath",'') from "MediaItem" where "customerId"='${q(made.contact)}'`).split('\n').filter(Boolean)) if (f.includes(`${path.sep}media${path.sep}`) && fs.existsSync(f)) fs.rmSync(f, { force: true })
      psql(`delete from "MediaItem" where "customerId"='${q(made.contact)}'`)
      psql(`delete from "AutomationEffect" where key in (select 'widget-partial-push:' || id from "IntakeLead" where "crmContactId"='${q(made.contact)}')`)
      psql(`delete from "SavedQuote" where "crmContactId"='${q(made.contact)}'; delete from "IntakeLead" where "crmContactId"='${q(made.contact)}'; delete from "CrmContactNote" where "crmContactId"='${q(made.contact)}'; delete from "AutomationEvent" where "entityId"='${q(made.card)}'; delete from "CardFollowUp" where "cardId"='${q(made.card)}'; delete from "CustomerPossibleMatch" where "contactId"='${q(made.contact)}'; delete from "CrmContact" where id='${q(made.contact)}'`)
    }
    psql(`delete from "Notification" where title='Website quote: ${q(name.trim())}'`)
    // The invoice this run uploaded (and any "already uploaded" refusal of it): refusals first, they point at it.
    const mine = `select "invoiceId" from "VendorInvoiceFile" where "fileName" = 'text.pdf' and "createdAt" >= '${STARTED}'`
    for (const f of psql(`select path from "VendorInvoiceFile" where "invoiceId" in (${mine})`).split('\n').filter(Boolean)) if (fs.existsSync(f) && f.includes(`${path.sep}uploads${path.sep}invoices${path.sep}`)) fs.unlinkSync(f)
    psql(`delete from "VendorInvoice" where status = 'refused' and id in (${mine}); delete from "VendorInvoice" where id in (${mine})`)
    if (made.draft) psql(`delete from "WidgetDraft" where id='${q(made.draft)}'`)
    // Its repair: soft deleted through the app, then the rows removed (anything a row still points at stays soft deleted).
    try {
      if (made.repairJob) { await api(`/api/saved-jobs/${made.repairJob}`, { method: 'DELETE' }); psql(`delete from "AutomationEvent" where "entityId"='${q(made.repairJob)}'; delete from "Notification" where "jobId"='${q(made.repairJob)}'; delete from "SavedJob" where id='${q(made.repairJob)}'`) }
      if (made.repairQuote) psql(`delete from "SavedQuote" where id='${q(made.repairQuote)}'`)
      if (made.repairContact) { await api(`/api/crm-contacts/${made.repairContact}`, { method: 'DELETE' }); psql(`delete from "CrmContactNote" where "crmContactId"='${q(made.repairContact)}'; delete from "CrmContact" where id='${q(made.repairContact)}'`) }
    } catch (e) { console.log('repair cleanup:', String(e?.message || e).slice(0, 160)) }
    // The yard photo's file, if it never reached a customer row.
    const m = /\/intake\/([0-9a-f-]{36}\.(jpg|png|webp|heic))$/.exec(made.photo || '')
    if (m) fs.rmSync(path.resolve(HERE, '../../portal/uploads/intake', m[1]), { force: true })
    check('test records removed', !made.contact || psql(`select count(*) from "CrmContact" where id='${q(made.contact)}'`) === '0')
  } catch (e) { check('test records removed', false, String(e?.message || e).slice(0, 200)) }
}

// Test leads left by a run that died: removed first (only this test's own names).
for (const row of psql(`select "crmContactId" || '|' || coalesce(payload->>'cardId','') || '|' || coalesce(payload->>'quoteId','') || '|' || "sourceRef" from "IntakeLead" where source in ('ez_quote', 'ez_quote_partial') and name like 'E2E Round1 Lead %'`).split('\n').filter(Boolean)) {
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
  if (ONLY !== 'computer') { await websiteVisitBox(wk); await tiersMatch(wk, 'salesman', true); await phone(wk); await salesmanDates(wk) }
  if (ONLY !== 'phone') await tiersMatch(ch, 'owner', false)
  if (ONLY !== 'phone') await computer(ch)
} catch (e) {
  check('test run finished', false, String(e?.message || e).split('\n').slice(0, 3).join(' '))
} finally {
  await cleanup()
  await removeTestLogin(SALESMAN, { ownerToken: TOKEN, api: API })
  await wk.close(); await ch.close()
}
const failed = results.filter(r => !r).length
console.log(`\n${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
