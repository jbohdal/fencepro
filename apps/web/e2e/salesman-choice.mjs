// The Salesman choice (Jonathan, Oct 28 2026): "when anyone enters a new client or lead (Add lead, New Customer,
// the quote's customer step), there's a "Salesman" choice: me, Christa or any other Salesman. It defaults to
// whoever is entering it. The chosen salesman sees that customer right away. [...] I can change a customer's
// salesman anytime from the customer page."
// Each step as the person who does it, on an iPhone (WebKit, iPhone 13) or a computer (Chromium, 1440 x 900):
//   owner    iPhone: Pipeline, + New Lead, the Salesman choice starts on the owner (me); picks Christa; Add Lead
//   salesman computer: Christa's Customers list, open before the lead was added: one reload and the lead is there
//   salesman iPhone: New Customer starts on Christa (me); saved, it is Christa's. Picking the owner says it leaves
//            Christa's list; saved that way, it does
//   salesman iPhone: a quote's Save, New Customer: starts on Christa (me); the customer and quote are Christa's
//   salesman computer: the customer page shows the Salesman and says only the owner changes it; the
//            server refuses a change in those words
//   owner    computer: New Customer starts on the owner (me); the customer page's Salesman, Change, picks a second
//            Salesman: that Salesman has the customer, Christa no longer
//   office   iPhone: New Customer starts on the owner (D4, Oct 29 2026: "Office entries default to me"); the customer page shows no Change (owner
//            only, Oct 29 2026) and the server refuses the office's change; the owner gives it back to Christa:
//            Christa has it again, the second Salesman no longer
//
// Run (dev copy only; a server serving the built app):
//   cd apps/web && pnpm -s build
//   APP_URL=http://localhost:4094 OWNER_TOKEN_FILE=... OWNER_COOKIE_FILE=... SALES_TOKEN_FILE=... SALES_COOKIE_FILE=...
//     OFFICE_TOKEN_FILE=... OFFICE_COOKIE_FILE=... [SHOTS=<folder>] node e2e/salesman-choice.mjs
// (scripts/dev-session-token.ts [--cookie] --email <login>: jbohdal@, christaf0920@ and aud-office@example.invalid.)
// Makes its own second Salesman login and customers (SMCHOICE ..., @example.invalid) and removes them at the end.
import './devOnly.mjs'
import { webkit, chromium, devices } from 'playwright'
import fs from 'fs'
import crypto from 'crypto'
import { execFileSync } from 'child_process'
import { makeTestLogin, removeTestLogin, signInByCookie } from './lib.mjs'

const APP = process.env.APP_URL || 'http://localhost:4094'
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
const LAST = `SMCHOICE ${stamp}`
const byName = first => sql(`SELECT COALESCE(json_agg(json_build_object('id', id, 'salesRep', "salesRep")), '[]') FROM "CrmContact" WHERE "firstName" = ${lit(first)} AND "lastName" = ${lit(LAST)} AND "deletedAt" IS NULL`)
const contact = async first => until(async () => JSON.parse(byName(first))[0] ?? null)
const sees = async (token, id) => ((await call(token, 'GET', '/api/crm-contacts')).json.data ?? []).some(c => c.id === id)
const made = { quotes: [] }
let second = null, wk = null, cr = null

/** A phone (WebKit, iPhone 13) or a computer (Chromium), signed in by cookie as that person. */
async function open(who, kind) {
  const ctx = kind === 'phone' ? await wk.newContext({ ...devices['iPhone 13'] }) : await cr.newContext({ viewport: { width: 1440, height: 900 } })
  await signInByCookie(ctx, { cookie: C[who] ?? '', token: who === 'second' ? second.token : '', api: API })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)))
  return { ctx, page, errors }
}
/** Done with that phone or computer: closed, as a person puts a phone away (several WebKit phones at once, each
 *  holding the whole company's data, crash WebKit on a test Mac). Its page errors are kept for the end. */
const putAway = s => s.ctx.close().catch(() => {})
const pickedText = sel => sel.evaluate(el => el.options[el.selectedIndex]?.text ?? '')

/**
 * The next screen in a fresh tab of the same phone or computer (still signed in): WebKit under Playwright crashes a
 * tab sent to a new address after a screen that used Back (follow-ups.mjs, job-costing.mjs); a phone does not.
 */
async function go(s, path) {
  const page = await s.ctx.newPage()
  page.on('pageerror', e => s.errors.push(String(e).slice(0, 200)))
  await s.page.close().catch(() => {})
  s.page = page
  await page.goto(`${APP}${path}`, { waitUntil: 'domcontentloaded' })
  return page
}

/**
 * The customer page's Salesman box (on a phone it is on the Details tab), in a fresh tab of that person's phone or
 * computer. WebKit under Playwright now and then crashes a tab while a customer page loads the whole company's data
 * on the office's iPhone (as payments.mjs, follow-ups.mjs and nightly-walkthrough.mjs note); a direct load in a loop
 * never did (0 of 10). A crashed tab is said in the output and opened once more; a second crash fails the run.
 */
async function salesmanBox(s, id, again = true) {
  const page = await s.ctx.newPage()
  page.on('pageerror', e => s.errors.push(String(e).slice(0, 200)))
  await s.page.close().catch(() => {})
  s.page = page
  try {
    await page.goto(`${APP}/customers/${encodeURIComponent(id)}`, { waitUntil: 'domcontentloaded' })
    const box = page.locator('[data-customer-salesman]:visible').first()
    const tab = page.locator('[data-customer-tab="overview"]').first()
    // A computer shows the box beside the tabs; a phone has it on the Details tab.
    await Promise.race([box.waitFor({ timeout: 60000 }), tab.waitFor({ timeout: 60000 })])
    if (!(await box.isVisible())) { await tab.click(); await box.waitFor({ timeout: 15000 }) }
    return { box, page }
  } catch (err) {
    if (!again || !/crashed/i.test(String(err?.message))) throw err
    console.log(`NOTE  the browser tab crashed opening the customer page (${String(err.message).split('\n')[0]}); opened again in a fresh tab`)
    return salesmanBox(s, id, false)
  }
}

try {
  if (sql('SELECT current_database()') !== DB) throw new Error('not the dev copy')
  const me = async t => (await call(t, 'GET', '/api/crm-auth/me')).json.data
  const [owner, christa, office] = [await me(T.owner), await me(T.sales), await me(T.office)]
  const nameOf = u => `${u.firstName} ${u.lastName}`.trim()
  const OWNER = nameOf(owner), CHRISTA = nameOf(christa), OFFICE = nameOf(office)
  check(christa.role === 'sales_rep' && owner.role === 'super_admin' && office.role === 'office_staff', `logins: owner ${OWNER}, Salesman ${CHRISTA}, office ${OFFICE}`)
  second = await makeTestLogin({ role: 'sales_rep', firstName: 'SMCHOICE', lastName: `Second ${stamp}`, ownerToken: T.owner, api: API })
  wk = await webkit.launch()
  cr = await chromium.launch()

  // ── 1. The owner adds a lead on the iPhone and picks Christa; Christa's computer has it after one reload ──
  const christaPc = await open('sales', 'computer')
  await christaPc.page.goto(`${APP}/customers`, { waitUntil: 'domcontentloaded' })
  await christaPc.page.locator('input[placeholder="Search customers..."]').waitFor({ timeout: 60000 })

  const ownerPhone = await open('owner', 'phone')
  {
    const { page } = ownerPhone
    await page.goto(`${APP}/pipeline`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('[data-tabbar]', { timeout: 60000 }); await sleep(1000)
    await page.locator('button[aria-label="New Lead"]').tap()
    await page.locator('[data-lead-field="first-name"]').fill('Gina')
    await page.locator('[data-lead-field="last-name"]').fill(LAST)
    await page.locator('[data-lead-field="phone"]').fill(`352555${String(parseInt(stamp, 16) % 10000).padStart(4, '0')}`)
    const sel = page.locator('[data-salesman-select]')
    await until(async () => (await sel.locator('option').count()) > 1)
    const start = await pickedText(sel)
    check(start === `${OWNER} (me)`, 'Add lead: the Salesman choice starts on the owner, who is entering it', start)
    const options = await sel.locator('option').allInnerTexts()
    check(options.includes(CHRISTA) && options.includes(second.name), `it lists the owner and each Salesman by name`, options.join(' | '))
    await sel.selectOption({ label: CHRISTA })
    const words = await page.locator('[data-salesman-words]').innerText()
    check(words === `${CHRISTA} sees this customer as soon as it is saved.`, 'picking Christa says what happens', words)
    await page.locator('[data-salesman-choice]').scrollIntoViewIfNeeded(); await shot(page, '1-owner-add-lead-christa')
    await page.locator('[data-lead-add]').tap()
  }
  const gina = await contact('Gina')
  await putAway(ownerPhone)
  check(gina?.salesRep === CHRISTA, `the lead is saved with ${CHRISTA} as Salesman`, JSON.stringify(gina))
  const card = sql(`SELECT l->>'assignedRep' FROM "PipelineState" p, jsonb_array_elements(p.leads::jsonb) l WHERE l->>'customerId' = ${lit(gina?.id ?? '')}`)
  check(card === CHRISTA, 'its pipeline card names Christa too', card)
  {
    const { page } = christaPc
    await page.reload({ waitUntil: 'domcontentloaded' })
    const search = page.locator('input[placeholder="Search customers..."]')
    await search.waitFor({ timeout: 60000 }); await search.fill(LAST)
    const there = await page.getByText(`Gina ${LAST}`).first().waitFor({ timeout: 20000 }).then(() => true, () => false)
    check(there, 'Christa\'s computer: after one reload the lead is on Christa\'s Customers list')
    await shot(page, '2-christa-sees-lead')
  }

  // ── 2. Christa enters a New Customer on the iPhone: it starts on Christa ──
  const christaPhone = await open('sales', 'phone')
  {
    let { page } = christaPhone
    await page.goto(`${APP}/customers/new`, { waitUntil: 'domcontentloaded' })
    await page.locator('[data-customer-field="first-name"]').waitFor({ timeout: 60000 })
    await page.locator('[data-customer-field="first-name"]').fill('Kim')
    await page.locator('[data-customer-field="last-name"]').fill(LAST)
    const sel = page.locator('[data-salesman-select]')
    await until(async () => (await sel.locator('option').count()) > 1)
    const start = await pickedText(sel)
    check(start === `${CHRISTA} (me)`, 'Salesman, New Customer: starts on Christa, who is entering it', start)
    // Picking someone else says, before saving, that it leaves Christa's list.
    await sel.selectOption({ label: OWNER })
    const words = await page.locator('[data-salesman-words]').innerText()
    check(/leaves your list, and only the owner can change it back/.test(words), 'picking the owner says it leaves Christa\'s list', words)
    await page.locator('[data-salesman-choice]').scrollIntoViewIfNeeded(); await shot(page, '3-christa-new-customer-other')
    await sel.selectOption({ label: `${CHRISTA} (me)` })
    check(!(await page.locator('[data-salesman-words]').count()), 'back on Christa: no warning')
    await page.locator('[data-customer-save]').tap()
    const kim = await contact('Kim')
    check(kim?.salesRep === CHRISTA, 'saved: Kim is Christa\'s', JSON.stringify(kim))
    await sleep(1500)
    check(await sees(T.sales, kim?.id), 'Kim is on Christa\'s list')

    // Given to the owner: saved with the owner, and it leaves Christa's list and screen.
    page = await go(christaPhone, '/customers/new')
    await page.locator('[data-customer-field="first-name"]').waitFor({ timeout: 60000 })
    await page.locator('[data-customer-field="first-name"]').fill('Lou')
    await page.locator('[data-customer-field="last-name"]').fill(LAST)
    const sel2 = page.locator('[data-salesman-select]')
    await until(async () => (await sel2.locator('option').count()) > 1)
    await sel2.selectOption({ label: OWNER })
    await page.locator('[data-customer-save]').tap()
    const lou = await contact('Lou')
    check(lou?.salesRep === OWNER, 'given to the owner: saved with the owner as Salesman', JSON.stringify(lou))
    const gone = await until(async () => !(await sees(T.sales, lou?.id)))
    check(!!gone, 'and it is not on Christa\'s list (the server leaves it out)')
    await sleep(2500)
    page = await go(christaPhone, '/customers')
    const search = page.locator('input[placeholder="Search customers..."]')
    await search.waitFor({ timeout: 60000 }); await search.fill(LAST); await sleep(800)
    const listed = await page.getByText(`Lou ${LAST}`).count()
    check(listed === 0, 'Christa\'s phone: Lou is off the Customers list')
    await shot(page, '4-christa-list-after-giving-away')
  }

  // ── 3. Christa's quote: Save, New Customer starts on Christa ──
  {
    let { page } = christaPhone
    const qid = crypto.randomUUID()
    const today = new Date().toISOString().slice(0, 10)
    const q = await call(T.sales, 'POST', '/api/saved-quotes', { id: qid, customerName: `Max ${LAST}`, customerAddress: '110 SE Watula Ave, Ocala, FL 34471', date: today, status: 'DRAFT', fenceStyle: "WV-ND 6'x6' Privacy", runs: [60], corners: 0, ends: 2, sections: 10, finalPrice: 10, pullSheet: [] })
    made.quotes.push(qid)
    check(q.status === 201 || q.status === 200, `Christa's draft quote is saved (${q.status})`)
    page = await go(christaPhone, `/?quote=${qid}`)
    await page.waitForSelector('[data-quote-builder] [data-bar-price]', { timeout: 60000 }); await sleep(1500)
    await page.locator('[data-save-open]:visible').first().tap()
    await page.locator('[data-save-mode="new"]').waitFor({ timeout: 15000 })
    await page.locator('[data-save-mode="new"]').tap(); await sleep(300)
    // The name typed on the quote is split on its last space; the two boxes are filled as the Salesman would.
    await page.locator('[data-new-field="first-name"]').fill('Max')
    await page.locator('[data-new-field="last-name"]').fill(LAST)
    const sel = page.locator('[data-salesman-select]')
    await until(async () => (await sel.locator('option').count()) > 1)
    const start = await pickedText(sel)
    check(start === `${CHRISTA} (me)`, 'the quote\'s New Customer: starts on Christa', start)
    await sel.selectOption({ label: second.name })
    const words = await page.locator('[data-salesman-words]').innerText()
    check(/Once saved, this quote and customer leave your list/.test(words), 'picking another Salesman on a quote says the quote and customer leave Christa\'s list', words)
    await sel.selectOption({ label: `${CHRISTA} (me)` })
    await page.locator('[data-salesman-choice]').scrollIntoViewIfNeeded(); await shot(page, '5-christa-quote-new-customer')
    await page.locator('[data-save-submit]').tap()
    const max = await contact('Max')
    check(max?.salesRep === CHRISTA, 'saved: the quote\'s new customer is Christa\'s', JSON.stringify(max))
    const quoteRep = await until(async () => { const r = await call(T.owner, 'GET', `/api/saved-quotes/${qid}`); return r.json.data?.crmContactId === max?.id ? r.json.data.salesRep : null })
    check(quoteRep === CHRISTA, 'and the quote\'s Sales rep is Christa', String(quoteRep))
  }
  await putAway(christaPhone)

  // ── 4. Christa cannot change a saved customer's Salesman, and is told so ──
  {
    const { ctx } = christaPc
    const { box, page } = await salesmanBox(christaPc, gina.id)
    const t = await box.innerText()
    check(t.includes(CHRISTA) && /Only the owner can change the Salesman\./.test(t) && !(await box.locator('[data-customer-salesman-change]').count()), 'Christa\'s customer page: shows Christa, no Change, says only the owner changes it', t.replace(/\n/g, ' / '))
    await shot(page, '6-christa-customer-page')
    const r = await ctx.request.patch(`${API}/api/crm-contacts/${gina.id}`, { headers: { 'X-Staff-Request': '1', 'Content-Type': 'application/json' }, data: { firstName: 'Gina', salesRep: OWNER } })
    const j = await r.json().catch(() => ({}))
    check(r.status() === 403 && /Only the owner can change a customer's Salesman/.test(j.error ?? ''), 'a change sent from Christa\'s login anyway is refused, in those words, nothing saved', `${r.status()} ${j.error}`)
    check(JSON.parse(byName('Gina'))[0]?.salesRep === CHRISTA, 'Gina is still Christa\'s')
  }

  // ── 5. The owner on a computer: New Customer starts on the owner; the customer page moves Gina to the second Salesman ──
  const ownerPc = await open('owner', 'computer')
  {
    const { page } = ownerPc
    await page.goto(`${APP}/customers/new`, { waitUntil: 'domcontentloaded' })
    await page.locator('[data-customer-field="first-name"]').waitFor({ timeout: 60000 })
    const sel = page.locator('[data-salesman-select]')
    await until(async () => (await sel.locator('option').count()) > 1)
    check(await pickedText(sel) === `${OWNER} (me)`, 'owner, New Customer: starts on the owner', await pickedText(sel))
  }
  {
    const { box, page } = await salesmanBox(ownerPc, gina.id)
    check((await box.locator('[data-customer-salesman-name]').innerText()) === CHRISTA, 'Gina\'s page: Salesman Christa')
    await box.locator('[data-customer-salesman-change]').click()
    const pick = box.locator('[data-customer-salesman-select]')
    await pick.waitFor({ timeout: 15000 })
    check(await pickedText(pick) === CHRISTA, 'Change starts on who has it now', await pickedText(pick))
    await pick.selectOption({ label: second.name })
    await box.locator('[data-customer-salesman-save]').click()
    const done = box.locator('[data-customer-salesman-done]')
    await done.waitFor({ timeout: 15000 })
    const said = await done.innerText()
    check(said.startsWith(`${second.name} is the Salesman now and sees this customer. ${CHRISTA} no longer does`), 'saved, and it says who has it now and that Christa no longer does', said)
    await until(async () => (await box.locator('[data-customer-salesman-name]').innerText()) === second.name)
    check((await box.locator('[data-customer-salesman-name]').innerText()) === second.name, 'the page shows the new Salesman')
    await shot(page, '7-owner-changed-salesman')
  }
  check(JSON.parse(byName('Gina'))[0]?.salesRep === second.name, 'Gina\'s Salesman is the second Salesman on the server')
  check(await sees(second.token, gina.id), 'the second Salesman has Gina at once')
  check(!(await sees(T.sales, gina.id)), 'Christa no longer has Gina')
  await putAway(ownerPc)
  const secondPhone = await open('second', 'phone')
  {
    const { page } = secondPhone
    await page.goto(`${APP}/customers`, { waitUntil: 'domcontentloaded' })
    const search = page.locator('input[placeholder="Search customers..."]')
    await search.waitFor({ timeout: 60000 }); await search.fill(LAST)
    check(await page.getByText(`Gina ${LAST}`).first().waitFor({ timeout: 20000 }).then(() => true, () => false), 'the second Salesman\'s iPhone: Gina is on the Customers list')
  }
  await putAway(secondPhone)
  {
    let { page } = christaPc
    page = await go(christaPc, '/customers')
    const search = page.locator('input[placeholder="Search customers..."]')
    await search.waitFor({ timeout: 60000 }); await search.fill(LAST); await sleep(1500)
    check((await page.getByText(`Gina ${LAST}`).count()) === 0, 'Christa\'s computer, one reload: Gina is gone from Christa\'s list')
    check((await page.getByText(`Kim ${LAST}`).count()) > 0, '(Kim, still Christa\'s, is there)')
  }

  // ── 6. The office on an iPhone: New Customer starts on the owner (D4); the customer page gives Gina back to Christa ──
  const officePhone = await open('office', 'phone')
  {
    const { page } = officePhone
    await page.goto(`${APP}/customers/new`, { waitUntil: 'domcontentloaded' })
    await page.locator('[data-customer-field="first-name"]').waitFor({ timeout: 60000 })
    const sel = page.locator('[data-salesman-select]')
    await until(async () => (await sel.locator('option').count()) > 1)
    check(await pickedText(sel) === OWNER, 'office, New Customer: starts on the owner (D4: office entries default to the owner)', await pickedText(sel))
    check(!(await sel.locator('option', { hasText: `${OFFICE} (me)` }).count()), 'office, New Customer: the office login is not a Salesman choice', '')
  }
  // The office's phone again, a fresh session (WebKit under Playwright crashed now and then loading the customer
  // page in the session that had New Customer open; a direct load never did, so it is the harness, not the app).
  await putAway(officePhone)
  const officePhone2 = await open('office', 'phone')
  {
    // Owner only (Oct 29 2026): the office sees the Salesman, no Change, and the server refuses its change.
    const { box, page } = await salesmanBox(officePhone2, gina.id)
    await box.locator('[data-customer-salesman-locked]').waitFor({ timeout: 15000 })
    const t = await box.innerText()
    check(/Only the owner can change the Salesman\./.test(t) && !(await box.locator('[data-customer-salesman-change]').count()), 'the office\'s customer page: no Change, says only the owner changes it', t.replace(/\n/g, ' / '))
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    check(fits, 'the office\'s iPhone: the Salesman box fits the screen')
    await box.scrollIntoViewIfNeeded(); await shot(page, '8-office-no-change')
    const christaId = ((await call(T.owner, 'GET', '/api/crm-contacts/salesmen')).json.data?.choices ?? []).find(c => c.name === CHRISTA)?.id
    const no = await call(T.office, 'POST', `/api/lead-assign/${gina.id}`, { to: christaId, replace: true })
    check(no.status === 403, 'the office\'s change sent anyway is refused (403)', `${no.status} ${no.json?.error}`)
    // The owner gives Gina back to Christa.
    const back = await call(T.owner, 'POST', `/api/lead-assign/${gina.id}`, { to: christaId, replace: true })
    check(back.status === 200, 'the owner gives Gina back to Christa', `${back.status}`)
  }
  check(JSON.parse(byName('Gina'))[0]?.salesRep === CHRISTA, 'Gina is Christa\'s again on the server')
  check(await sees(T.sales, gina.id), 'Christa has Gina again')
  check(!(await sees(second.token, gina.id)), 'the second Salesman no longer has Gina')
  const hist = await call(T.owner, 'GET', `/api/follow-ups/history?customerId=${gina.id}`)
  const lines = (hist.json.data ?? []).filter(h => h.title === 'Lead assigned').map(h => h.detail)
  check(lines.some(l => l === `Lead assigned to ${second.name} by ${OWNER}. It was ${CHRISTA}'s.`) && lines.some(l => l === `Lead assigned to ${CHRISTA} by ${OWNER}. It was ${second.name}'s.`), 'Gina\'s History says who moved it, to whom, from whom', lines.join(' / '))

  for (const [n, s] of Object.entries({ ownerPhone, christaPc, christaPhone, ownerPc, secondPhone, officePhone, officePhone2 })) check(!s.errors.length, `${n}: no page errors`, s.errors.join(' | '))
} catch (err) {
  failed++
  console.log(`FAIL  ${err?.stack || err}`)
} finally {
  await wk?.close().catch(() => {})
  await cr?.close().catch(() => {})
  try {
    if (sql('SELECT current_database()') === DB) {
      const ids = sql(`SELECT COALESCE(string_agg(quote_literal(id), ','), '') FROM "CrmContact" WHERE "lastName" = ${lit(LAST)} OR ("firstName" || ' ' || "lastName") LIKE ${lit(`%${LAST}%`)}`)
      for (const q of made.quotes) sql(`DELETE FROM "SavedQuote" WHERE id = ${lit(q)}`)
      if (ids) {
        sql(`DELETE FROM "SavedQuote" WHERE "crmContactId" IN (${ids})`)
        const cards = sql(`SELECT COALESCE(string_agg(quote_literal(l->>'id'), ','), '') FROM "PipelineState" p, jsonb_array_elements(p.leads::jsonb) l WHERE l->>'customerId' IN (${ids})`)
        if (cards) for (const t of ['CardFollowUp', 'PendingTouch']) sql(`DELETE FROM "${t}" WHERE "cardId" IN (${cards})`)
        sql(`UPDATE "PipelineState" SET leads = (SELECT COALESCE(jsonb_agg(l), '[]'::jsonb) FROM jsonb_array_elements(leads::jsonb) l WHERE NOT (l->>'customerId' IN (${ids}))), version = version + 1 WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(leads::jsonb) l WHERE l->>'customerId' IN (${ids}))`)
        sql(`DELETE FROM "CrmContactNote" WHERE "crmContactId" IN (${ids})`)
        sql(`DELETE FROM "CustomerPossibleMatch" WHERE "contactId" IN (${ids}) OR "matchId" IN (${ids})`)
        sql(`DELETE FROM "CrmContact" WHERE id IN (${ids})`)
      }
    }
  } catch (e) { console.log(`cleanup: ${e.message}`) }
  if (second) await removeTestLogin(second, { ownerToken: T.owner, api: API }).catch(e => console.log(`cleanup login: ${e.message}`))
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
