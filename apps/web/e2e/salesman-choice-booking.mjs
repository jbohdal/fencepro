// New Customer's "Book estimate now" with the Salesman choice (review Oct 29 2026): the Salesman entered a new
// customer, ticked Book estimate now and picked the owner as Salesman; it saved and went back to the list saying
// the customer leaves the list, and no booking opened and nothing was booked.
// Each step as the person who does it:
//   salesman iPhone (WebKit, iPhone 13): New Customer, picks the owner, Book estimate now, Save: back on the list,
//            told the customer leaves the list once the booking is closed, the booking opens on the customer with
//            "With" on the owner; Book: the estimate is on the server with the owner, the screen says so, and the
//            customer is off the Salesman's list. A second one closed without booking says it was not booked.
//   owner    computer (Chromium 1440 x 900): New Customer, picks Christa, Book estimate now: the booking opens with
//            "With" on Christa; booked with Christa, the customer page behind it.
//   office   computer: the same, picks Christa.
//
// Run (dev copy only; a server serving the built app):
//   cd apps/web && pnpm -s build
//   APP_URL=http://localhost:4099 OWNER_TOKEN_FILE=... OWNER_COOKIE_FILE=... SALES_TOKEN_FILE=... SALES_COOKIE_FILE=...
//     OFFICE_TOKEN_FILE=... OFFICE_COOKIE_FILE=... [SHOTS=<folder>] node e2e/salesman-choice-booking.mjs
// (scripts/dev-session-token.ts [--cookie] --email <login>: jbohdal@, christaf0920@ and aud-office@example.invalid.)
// Makes its own customers (SMBOOK ...) and their appointments and cards, and removes them at the end.
import './devOnly.mjs'
import { webkit, chromium, devices } from 'playwright'
import fs from 'fs'
import crypto from 'crypto'
import { execFileSync } from 'child_process'
import { signInByCookie } from './lib.mjs'

const APP = process.env.APP_URL || 'http://localhost:4099'
const API = process.env.API_URL || APP
const read = n => (process.env[`${n}_FILE`] ? fs.readFileSync(process.env[`${n}_FILE`], 'utf8').trim() : process.env[n] || '')
const T = { owner: read('OWNER_TOKEN'), sales: read('SALES_TOKEN'), office: read('OFFICE_TOKEN') }
const C = { owner: read('OWNER_COOKIE'), sales: read('SALES_COOKIE'), office: read('OFFICE_COOKIE') }
if (Object.values(T).some(v => !v) || Object.values(C).some(v => !v)) { console.error('Set OWNER_, SALES_ and OFFICE_ TOKEN(_FILE) and COOKIE(_FILE).'); process.exit(2) }
const SHOTS = process.env.SHOTS || ''
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })
const DB = 'ezbiz_dev'
const sql = q => execFileSync('psql', ['-d', DB, '-At', '-v', 'ON_ERROR_STOP=1', '-c', q]).toString().trim()
const lit = s => `'${String(s).replace(/'/g, "''")}'`
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function until(fn, ms = 20000) { const end = Date.now() + ms; for (;;) { const v = await fn().catch(() => null); if (v || Date.now() > end) return v; await sleep(400) } }
const call = async (token, method, p, body) => {
  const r = await fetch(`${API}${p}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Staff-Request': '1' }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: r.status, json: await r.json().catch(() => ({})) }
}
let failed = 0
const check = (ok, msg, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}${detail ? `  -- ${detail}` : ''}`); if (!ok) failed++ }
const shot = (page, name) => (SHOTS ? page.screenshot({ path: `${SHOTS}/${name}.png` }).catch(() => {}) : Promise.resolve())

const stamp = crypto.randomBytes(3).toString('hex')
const LAST = `SMBOOK ${stamp}`
const contact = async first => until(async () => JSON.parse(sql(`SELECT COALESCE(json_agg(json_build_object('id', id, 'salesRep', "salesRep")), '[]') FROM "CrmContact" WHERE "firstName" = ${lit(first)} AND "lastName" = ${lit(LAST)} AND "deletedAt" IS NULL`))[0] ?? null)
const apptsOf = id => JSON.parse(sql(`SELECT COALESCE(json_agg(json_build_object('id', id, 'type', type, 'assignedTo', "assignedTo", 'assignedToUserId', "assignedToUserId", 'startAt', "startAt")), '[]') FROM "CrmAppointment" WHERE "crmContactId" = ${lit(id)} AND "deletedAt" IS NULL`))
const sees = async (token, id) => ((await call(token, 'GET', '/api/crm-contacts')).json.data ?? []).some(c => c.id === id)
const pickedText = sel => sel.evaluate(el => el.options[el.selectedIndex]?.text ?? '')
const toasts = page => page.locator('[data-toast]').allInnerTexts().then(t => t.join(' / ').replace(/\s+/g, ' '))
/** The message matching `re`, read as a person does: messages show one at a time, each one before it closed with ×. */
async function seeToast(page, re, phone, ms = 30000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const t = await toasts(page).catch(() => '')
    if (re.test(t)) return t
    const x = page.locator('[data-toast] button').first()
    if (t && await x.isVisible().catch(() => false)) await (phone ? x.tap() : x.click()).catch(() => {})
    await sleep(400)
  }
  return null
}
let phones = 0
let wk = null, cr = null
const sessions = {}

async function open(who, kind) {
  const ctx = kind === 'phone' ? await wk.newContext({ ...devices['iPhone 13'] }) : await cr.newContext({ viewport: { width: 1440, height: 900 } })
  await signInByCookie(ctx, { cookie: C[who], token: '', api: API })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)))
  return { ctx, page, errors }
}

/** New Customer as that person: the name, a phone, the Salesman picked, Book estimate now ticked, Save. */
async function newCustomerBooking(s, first, salesman, phone) {
  const { page } = s
  const tap = l => (phone ? l.tap() : l.click())
  await page.goto(`${APP}/customers`, { waitUntil: 'domcontentloaded' })
  await page.locator('input[placeholder="Search customers..."]').waitFor({ timeout: 60000 }); await sleep(800)
  await page.goto(`${APP}/customers/new`, { waitUntil: 'domcontentloaded' })
  await page.locator('[data-customer-field="first-name"]').waitFor({ timeout: 60000 })
  await page.locator('[data-customer-field="first-name"]').fill(first)
  await page.locator('[data-customer-field="last-name"]').fill(LAST)
  // Each its own phone number (one already on file makes it a Possible match for the office).
  await page.locator('input[placeholder="(352) 555-0100"]').fill(`352555${String((parseInt(stamp, 16) + phones++ * 7) % 10000).padStart(4, '0')}`)
  const sel = page.locator('[data-salesman-select]')
  await until(async () => (await sel.locator('option').count()) > 1)
  await sel.selectOption({ label: salesman })
  await tap(page.locator('[data-book-estimate-now] input[type="checkbox"]'))
  await page.locator('[data-book-estimate-now]').scrollIntoViewIfNeeded()
  await tap(page.locator('[data-customer-save]'))
}

/** The booking that opened: its customer, who it is with; a typed time, Book; what the screen says after. */
async function book(s, phone, time = '10:00 am') {
  const { page } = s
  const tap = l => (phone ? l.tap() : l.click())
  const dlg = page.locator('[data-booking-dialog]')
  const opened = await dlg.waitFor({ timeout: 20000 }).then(() => true, () => false)
  if (!opened) return { opened }
  await sleep(1000)
  const customer = await dlg.locator('[data-booking-customer]').innerText().catch(() => '')
  const person = dlg.locator('[data-field="person"]')
  await until(async () => (await person.locator('option').count()) > 1)
  const withName = await pickedText(person)
  const type = await dlg.locator('[data-field="type"]').inputValue()
  await tap(dlg.locator('[data-field="time"]'))
  await dlg.locator('[data-typed-time]').fill(time)
  await dlg.locator('[data-typed-time]').press('Enter')
  await tap(dlg.locator('[data-save]'))
  const booked = await page.locator('[data-booked]').waitFor({ timeout: 20000 }).then(() => true, () => false)
  const said = booked ? (await page.locator('[data-booked]').innerText()).replace(/\s+/g, ' ') : ''
  return { opened, customer, withName, type, booked, said }
}

try {
  if (sql('SELECT current_database()') !== DB) throw new Error('not the dev copy')
  const me = async t => (await call(t, 'GET', '/api/crm-auth/me')).json.data
  const [owner, christa, office] = [await me(T.owner), await me(T.sales), await me(T.office)]
  const nameOf = u => `${u.firstName} ${u.lastName}`.trim()
  const OWNER = nameOf(owner), CHRISTA = nameOf(christa), OFFICE = nameOf(office)
  check(christa.role === 'sales_rep' && owner.role === 'super_admin' && office.role === 'office_staff', `logins: owner ${OWNER}, Salesman ${CHRISTA}, office ${OFFICE}`)
  wk = await webkit.launch()
  cr = await chromium.launch()

  // ── 1. The Salesman on the iPhone gives a new customer to the owner and books the estimate ──
  sessions.salesPhone = await open('sales', 'phone')
  {
    const s = sessions.salesPhone
    await newCustomerBooking(s, 'Ada', `${OWNER}`, true)
    const said = await until(async () => { const t = await toasts(s.page); return /Customer added/.test(t) ? t : null }, 10000)
    check(/Book the estimate now: once you close the booking, they leave your list/.test(said ?? ''), 'Salesman: told the customer is the owner\'s and to book now, before they leave the list', said ?? '')
    const r = await book(s, true)
    check(r.opened, 'Salesman: the booking opens after saving')
    check(r.customer.includes(`Ada ${LAST}`), 'it is for the new customer', r.customer)
    check(r.withName === OWNER, `"With" starts on the owner, the Salesman picked`, r.withName)
    check(r.type === 'estimate', 'an estimate', r.type)
    await shot(s.page, '1-salesman-booked-owner')
    check(r.booked && r.said.includes(`with ${OWNER}`) && r.said.includes(`Ada ${LAST}`), 'Book: the screen says the estimate is booked with the owner', r.said)
    check(new URL(s.page.url()).pathname === '/customers', 'behind it: the Customers list (the customer is not the Salesman\'s)', s.page.url())
    const ada = await contact('Ada')
    check(ada?.salesRep === OWNER, 'Ada is saved with the owner as Salesman', JSON.stringify(ada))
    const ap = await until(async () => { const a = apptsOf(ada.id); return a.length ? a : null })
    check(ap?.length === 1 && ap[0].type === 'estimate' && ap[0].assignedToUserId === owner.id && ap[0].assignedTo === OWNER, 'the server has one estimate for Ada, with the owner', JSON.stringify(ap))
    check(!(await sees(T.sales, ada.id)), 'Ada is off the Salesman\'s list')
    await sleep(2000)
    console.log(`NOTE  Ada's pipeline card stage after the booking: ${sql(`SELECT string_agg(l->>'stage', ',') FROM "PipelineState" p, jsonb_array_elements(p.leads::jsonb) l WHERE l->>'customerId' = ${lit(ada.id)}`)}`)
    check(await sees(T.owner, ada.id), 'and on the owner\'s')
    await s.page.locator('[data-booking-dialog] button[aria-label="Close"]').first().tap()
    await sleep(800)
    check(!/Estimate not booked/.test(await toasts(s.page)), 'closing after booking does not say it was not booked')
  }
  // Closed without booking: it says so, and why.
  await sessions.salesPhone.ctx.close().catch(() => {})
  sessions.salesPhone2 = await open('sales', 'phone')
  {
    const s = sessions.salesPhone2
    await newCustomerBooking(s, 'Bo', `${OWNER}`, true)
    const dlg = s.page.locator('[data-booking-dialog]')
    check(await dlg.waitFor({ timeout: 20000 }).then(() => true, () => false), 'Salesman, a second one: the booking opens')
    await sleep(1000)
    await dlg.locator('button[aria-label="Close"]').first().tap()
    const said = await seeToast(s.page, /Estimate not booked/, true)
    check(new RegExp(`Bo ${LAST} is ${OWNER}'s customer now and is off your list, so you cannot book it later\\. Ask ${OWNER} or the office to book the estimate\\.`).test(said ?? ''), 'closed without booking: the screen says the estimate was not booked and who to ask', said ?? '')
    await shot(s.page, '2-salesman-not-booked')
    const bo = await contact('Bo')
    check(bo && apptsOf(bo.id).length === 0, 'and nothing was booked for Bo')
  }
  await sessions.salesPhone2.ctx.close().catch(() => {})

  // ── 2. The owner and the office on a computer pick Christa and book ──
  for (const [who, first] of [['owner', 'Cy'], ['office', 'Di']]) {
    sessions[who] = await open(who, 'computer')
    const s = sessions[who]
    await newCustomerBooking(s, first, CHRISTA, false)
    const r = await book(s, false, who === 'owner' ? '10:00 am' : '11:00 am')
    check(r.opened, `${who}: the booking opens after saving`)
    check(r.customer.includes(`${first} ${LAST}`), `${who}: it is for the new customer`, r.customer)
    check(r.withName === CHRISTA, `${who}: "With" starts on Christa, the Salesman picked`, r.withName)
    await shot(s.page, `3-${who}-booked-christa`)
    check(r.booked && r.said.includes(`with ${CHRISTA}`), `${who}: Book: the screen says the estimate is booked with Christa`, r.said)
    const c = await contact(first)
    check(c?.salesRep === CHRISTA, `${who}: ${first} is saved with Christa as Salesman`, JSON.stringify(c))
    check(new URL(s.page.url()).pathname === `/customers/${c?.id}`, `${who}: behind it, the customer's page`, s.page.url())
    const ap = await until(async () => { const a = apptsOf(c.id); return a.length ? a : null })
    check(ap?.length === 1 && ap[0].type === 'estimate' && ap[0].assignedToUserId === christa.id && ap[0].assignedTo === CHRISTA, `${who}: the server has one estimate for ${first}, with Christa`, JSON.stringify(ap))
    check(await sees(T.sales, c.id), `${who}: Christa has ${first} on her list`)
    await sleep(2000)
    console.log(`NOTE  ${first}'s pipeline card stage after the booking: ${sql(`SELECT string_agg(l->>'stage', ',') FROM "PipelineState" p, jsonb_array_elements(p.leads::jsonb) l WHERE l->>'customerId' = ${lit(c.id)}`)}`)
    await s.ctx.close().catch(() => {})
  }

  for (const [n, s] of Object.entries(sessions)) check(!s.errors.length, `${n}: no page errors`, s.errors.join(' | '))
} catch (err) {
  failed++
  console.log(`FAIL  ${err?.stack || err}`)
} finally {
  await wk?.close().catch(() => {})
  await cr?.close().catch(() => {})
  try {
    if (sql('SELECT current_database()') === DB) {
      const ids = sql(`SELECT COALESCE(string_agg(quote_literal(id), ','), '') FROM "CrmContact" WHERE "lastName" = ${lit(LAST)}`)
      if (ids) {
        sql(`DELETE FROM "CrmAppointment" WHERE "crmContactId" IN (${ids})`)
        sql(`DELETE FROM "SavedQuote" WHERE "crmContactId" IN (${ids})`)
        const cards = sql(`SELECT COALESCE(string_agg(quote_literal(l->>'id'), ','), '') FROM "PipelineState" p, jsonb_array_elements(p.leads::jsonb) l WHERE l->>'customerId' IN (${ids})`)
        if (cards) for (const t of ['CardFollowUp', 'PendingTouch']) sql(`DELETE FROM "${t}" WHERE "cardId" IN (${cards})`)
        sql(`UPDATE "PipelineState" SET leads = (SELECT COALESCE(jsonb_agg(l), '[]'::jsonb) FROM jsonb_array_elements(leads::jsonb) l WHERE NOT (l->>'customerId' IN (${ids}))), version = version + 1 WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(leads::jsonb) l WHERE l->>'customerId' IN (${ids}))`)
        sql(`DELETE FROM "CrmContactNote" WHERE "crmContactId" IN (${ids})`)
        sql(`DELETE FROM "CustomerPossibleMatch" WHERE "contactId" IN (${ids}) OR "matchId" IN (${ids})`)
        sql(`DELETE FROM "CrmContact" WHERE id IN (${ids})`)
      }
      const left = sql(`SELECT count(*) FROM "CrmContact" WHERE "lastName" = ${lit(LAST)}`)
      console.log(`cleanup: ${left} ${LAST} customers left`)
    }
  } catch (e) { console.log(`cleanup: ${e.message}`) }
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
