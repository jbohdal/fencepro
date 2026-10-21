// Customer links are set only by a pick (or Create new), never guessed from a
// phone or email; the quote's property address is the quote's own. On the dev
// copy, desktop Chromium and a phone size WebKit.
//
//   cd apps/web && pnpm -s build
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 E2E_ACCESS_TOKEN=<dev token> node e2e/customer-links.mjs
//
//   1. New lead on the board with another customer's email: the window names
//      them ("Use <name>"); Add Lead without Use makes a NEW customer with
//      what was typed, the card is theirs, and the customer on file is not
//      changed at all.
//   2. The same with their phone and Use pressed: the card is theirs, with
//      their name, the typed property on the card, and their record unchanged.
//   3. Save quote: the Property address shows from the quote's own; taking
//      the customer off (×), picking another customer with another address,
//      and switching to New Customer and back leave it as it was; the saved
//      quote keeps it. New Customer mode: the quote keeps its property, and
//      the new customer (no address typed) gets it as theirs.
// Removes every card, quote and customer it made (through the API).
import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import './sharedLock.mjs' // makes customers, cards and quotes: takes turns with the other tests that change shared data
import { chromium, webkit } from 'playwright'
import crypto from 'crypto'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || 'http://localhost:4001'
const TOKEN = process.env.E2E_ACCESS_TOKEN || ''
if (!/localhost:4001/.test(APP) || !/localhost:4001/.test(API)) { console.error('Refusing to run: the dev copy only (localhost:4001).'); process.exit(2) }
if (!TOKEN) { console.error('Set E2E_ACCESS_TOKEN.'); process.exit(2) }

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const call = async (method, p, body) => {
  const r = await fetch(`${API}${p}`, { method, headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: r.status, json: await r.json().catch(() => ({})) }
}
async function until(fn, ms = 20000) {
  const end = Date.now() + ms
  let v = await fn()
  while (!v && Date.now() < end) { await sleep(500); v = await fn() }
  return v
}
const contacts = async () => (await call('GET', '/api/crm-contacts')).json.data ?? []
const contact = async id => (await contacts()).find(c => c.id === id) ?? null
const leads = async () => (await call('GET', '/api/pipeline')).json.data?.leads ?? []
const quote = async id => (await call('GET', `/api/saved-quotes/${id}`)).json.data ?? null

const stamp = Date.now().toString(36).slice(-6)
const rnd4 = () => String(1000 + crypto.randomInt(9000))
const made = { contacts: [], quotes: [], lasts: [] }
let browser = null, ctx = null

/** A customer made through the API (no card). */
async function makeCustomer(first, last, address) {
  const id = crypto.randomUUID()
  const phone = `(352) 55${crypto.randomInt(10)}-${rnd4()}`
  const email = `e2e-links-${stamp}-${first.toLowerCase()}-${rnd4()}@example.invalid`
  const r = await call('POST', '/api/crm-contacts', { id, firstName: first, lastName: last, phone, email, serviceAddress: address, leadSource: 'Other' })
  if (r.status < 300) made.contacts.push(id)
  made.lasts.push(last)
  return r.status < 300 ? await contact(id) : null
}

/** A draft quote for that customer with its own property address. */
async function makeQuote(c, property) {
  const id = crypto.randomUUID()
  const r = await call('POST', '/api/saved-quotes', {
    id, crmContactId: c.id, customerName: `${c.firstName} ${c.lastName}`, customerPhone: c.phone, customerEmail: c.email, customerAddress: property,
    leadSource: 'Other', salesRep: 'E2E', date: '2026-10-21', status: 'DRAFT', fenceStyle: "WV-ND 6'x6' Privacy",
    runs: [60], corners: 0, ends: 2, walkGates: 0, dblGates: 0, tearOutSections: 0, tearOutGates: 0, adjLaborHrs: 0, hasSalesman: false, priceAdjust: 0,
    sections: 10, materialCost: 1, laborCost: 1, tearOutCost: 0, totalCOGS: 2, finalPrice: 10, gmPct: 0.5, pullSheet: [],
  })
  if (r.status < 300) made.quotes.push(id)
  return r.status < 300 ? id : null
}

async function session(phone) {
  ctx = await (phone ? webkit : chromium).launch().then(b => { browser = b; return b.newContext(phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true } : { viewport: { width: 1440, height: 900 } }) })
  await ctx.addInitScript(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, TOKEN)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 300)))
  page.on('dialog', d => d.accept().catch(() => {}))
  // A new card or a saved quote asks the server to run automations; the dev data holds real customers.
  await page.route('**/api/automations/trigger', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true,"data":{"matched":0}}' }))
  const press = async loc => { await loc.waitFor({ state: 'visible', timeout: 15000 }); if (phone) await loc.tap(); else await loc.click(); await sleep(250) }
  return { page, errors, press }
}

async function openNewLead(s, phone) {
  await s.page.goto(`${APP}/pipeline`, { waitUntil: 'domcontentloaded' })
  const btn = phone ? s.page.locator('button[aria-label="New Lead"]') : s.page.locator('button:has-text("New lead"):visible').first()
  await btn.waitFor({ timeout: 60000 }); await sleep(1200)
  await s.press(btn)
  await s.page.locator('[data-lead-field="first-name"]').waitFor({ timeout: 10000 })
}

async function openSaveQuote(s, id) {
  await s.page.goto(`${APP}/?quote=${id}`)
  await s.page.waitForSelector('[data-quote-builder] [data-bar-price]', { timeout: 30000 }); await sleep(1000)
  await s.press(s.page.locator('[data-save-open]:visible').first())
  await s.page.locator('[data-quote-property-address]').waitFor({ timeout: 10000 })
}

async function run(phone) {
  const size = phone ? 'phone webkit' : 'desktop chromium'
  console.log(`\n── ${size} ──`)
  const tag = `${phone ? 'P' : 'D'}${stamp}`
  const A = await makeCustomer('Alpha', `Links A ${tag}`, '100 Alpha St, Ocala, FL 34470')
  const B = await makeCustomer('Bravo', `Links B ${tag}`, '200 Bravo Ave, Ocala, FL 34471')
  check(`${size}: set up customers A and B through the API`, !!A && !!B)
  const snapA = JSON.stringify(A), snapB = JSON.stringify(B)
  const s = await session(phone)
  try {
    // ── 1. A's email, Add Lead without Use: a new customer ──
    const LAST1 = `Links New ${tag}`; made.lasts.push(LAST1)
    await openNewLead(s, phone)
    const typedPhone = `(352) 54${crypto.randomInt(10)}-${rnd4()}`
    await s.page.locator('[data-lead-field="first-name"]').fill('Gus')
    await s.page.locator('[data-lead-field="last-name"]').fill(LAST1)
    await s.page.locator('[data-lead-field="phone"]').fill(typedPhone)
    await s.page.locator('[data-lead-field="email"]').fill(A.email)
    const notice1 = await s.page.locator(`[data-possible-match] [data-use-customer="${A.id}"]`).waitFor({ timeout: 10000 }).then(() => true, () => false)
    check(`${size}: A's email typed: the notice names A with a Use button`, notice1 && (await s.page.locator('[data-possible-match]').innerText()).includes(`Alpha Links A ${tag}`), notice1 ? await s.page.locator('[data-possible-match]').innerText() : 'no notice')
    await s.press(s.page.locator('[data-lead-add]'))
    const C = await until(async () => (await contacts()).find(c => c.lastName === LAST1))
    if (C) made.contacts.push(C.id)
    check(`${size}: saved without Use: a NEW customer with the typed name, phone and email`, !!C && C.id !== A.id && C.firstName === 'Gus' && C.phone === typedPhone && C.email === A.email, JSON.stringify(C && { id: C.id, n: C.firstName, p: C.phone, e: C.email }))
    const card1 = C && await until(async () => (await leads()).find(l => l.customerId === C.id))
    check(`${size}: the card links to the new customer, not A`, !!card1 && card1.customerId === C.id && card1.lastName === LAST1, JSON.stringify(card1 && { c: card1.customerId, n: card1.lastName }))
    await sleep(1500)
    check(`${size}: A's record is unchanged (name, phone, email, address, everything)`, JSON.stringify(await contact(A.id)) === snapA)

    // ── 2. A's phone, Use A: the card is A's, A unchanged ──
    const LAST2 = `Links Typed ${tag}`; made.lasts.push(LAST2)
    const leadsBefore = new Set((await leads()).filter(l => l.customerId === A.id).map(l => l.id))
    await openNewLead(s, phone)
    await s.page.locator('[data-lead-field="first-name"]').fill('Other')
    await s.page.locator('[data-lead-field="last-name"]').fill(LAST2)
    await s.page.locator('[data-lead-field="phone"]').fill(A.phone.replace(/\D/g, ''))
    await s.page.locator('[data-lead-field="street"]').fill('55 Card Rd')
    const use = s.page.locator(`[data-possible-match] [data-use-customer="${A.id}"]`)
    const notice2 = await use.waitFor({ timeout: 10000 }).then(() => true, () => false)
    check(`${size}: A's phone typed: the notice names A`, notice2)
    await s.press(use)
    check(`${size}: Use A: the window says the card goes on A's record`, (await s.page.locator(`[data-picked-customer="${A.id}"]`).count()) === 1)
    await s.press(s.page.locator('[data-lead-add]'))
    const card2 = await until(async () => (await leads()).find(l => l.customerId === A.id && !leadsBefore.has(l.id)))
    check(`${size}: the card links to A, with A's name, phone and email and the typed property`, !!card2 && card2.firstName === 'Alpha' && card2.lastName === A.lastName && card2.phone === A.phone && card2.email === A.email && /^55 Card Rd/.test(card2.address),
      JSON.stringify(card2 && { n: `${card2.firstName} ${card2.lastName}`, p: card2.phone, a: card2.address }))
    await sleep(1500)
    check(`${size}: no customer made from the typed name`, !(await contacts()).some(c => c.lastName === LAST2))
    check(`${size}: A's record is unchanged`, JSON.stringify(await contact(A.id)) === snapA)

    // ── 3. Save quote: the property address is the quote's ──
    const PROP = `77 Property Ln ${tag}, Ocala, FL 34480`
    const q1 = await makeQuote(A, PROP)
    check(`${size}: set up a draft quote for A at its own property`, !!q1)
    await openSaveQuote(s, q1)
    const prop = s.page.locator('[data-quote-property-address]')
    check(`${size}: Save quote opens with the quote's property address and A picked`, (await prop.inputValue()) === PROP && (await s.page.locator('[data-clear-customer]').count()) === 1, await prop.inputValue())
    await s.press(s.page.locator('[data-clear-customer]'))
    check(`${size}: customer cleared (×): the property address stays`, (await prop.inputValue()) === PROP, await prop.inputValue())
    await s.page.locator('[data-customer-search]').fill(B.lastName)
    await s.press(s.page.locator(`[data-customer-option="${B.id}"]`))
    check(`${size}: B picked (another address): the property address stays`, (await prop.inputValue()) === PROP, await prop.inputValue())
    await s.press(s.page.locator('[data-save-mode="new"]'))
    const inNew = await prop.inputValue()
    await s.press(s.page.locator('[data-save-mode="search"]'))
    check(`${size}: New Customer and back: the property address stays`, inNew === PROP && (await prop.inputValue()) === PROP, `${inNew} / ${await prop.inputValue()}`)
    await s.press(s.page.locator('[data-save-submit]'))
    const saved1 = await until(async () => { const q = await quote(q1); return q?.crmContactId === B.id ? q : null })
    check(`${size}: saved: the quote is B's, at the original property address`, !!saved1 && saved1.customerAddress === PROP, JSON.stringify(saved1 && { c: saved1.crmContactId, a: saved1.customerAddress }))

    // New Customer mode: the quote keeps its property; the new customer (no address typed) gets it.
    const PROP2 = `88 Second Lot ${tag}, Ocala, FL 34481`
    const LAST3 = `Links Quote New ${tag}`; made.lasts.push(LAST3)
    const q2 = await makeQuote(A, PROP2)
    await openSaveQuote(s, q2)
    await s.press(s.page.locator('[data-save-mode="new"]'))
    check(`${size}: New Customer mode shows the quote's property address`, (await prop.inputValue()) === PROP2, await prop.inputValue())
    await s.page.locator('[data-new-field="first-name"]').fill('Nina')
    await s.page.locator('[data-new-field="last-name"]').fill(LAST3)
    await s.page.locator('[data-new-field="email"]').fill(A.email)
    const notice3 = await s.page.locator(`[data-possible-match] [data-use-customer="${A.id}"]`).waitFor({ timeout: 10000 }).then(() => true, () => false)
    check(`${size}: New Customer with A's email: the notice names A`, notice3)
    await s.press(s.page.locator('[data-save-submit]'))
    const N = await until(async () => (await contacts()).find(c => c.lastName === LAST3))
    if (N) made.contacts.push(N.id)
    const saved2 = N && await until(async () => { const q = await quote(q2); return q?.crmContactId === N.id ? q : null })
    check(`${size}: saved as a new customer (not A), the quote at its own property`, !!N && N.id !== A.id && !!saved2 && saved2.customerAddress === PROP2, JSON.stringify(saved2 && { c: saved2.crmContactId, a: saved2.customerAddress }))
    check(`${size}: the new customer (no address typed) has the property as theirs`, N?.serviceAddress === PROP2, N?.serviceAddress)
    await sleep(1500)
    check(`${size}: A and B are unchanged after both saves`, JSON.stringify(await contact(A.id)) === snapA && JSON.stringify(await contact(B.id)) === snapB)

    // ── 4. A quote from a card linked to X, with Y of the same name on file: X's id, never Y's ──
    const LAST4 = `Links Twin ${tag}`; made.lasts.push(LAST4)
    await openNewLead(s, phone)
    await s.page.locator('[data-lead-field="first-name"]').fill('Twin')
    await s.page.locator('[data-lead-field="last-name"]').fill(LAST4)
    await s.page.locator('[data-lead-field="phone"]').fill(`(352) 53${crypto.randomInt(10)}-${rnd4()}`)
    await s.press(s.page.locator('[data-lead-add]'))
    const X = await until(async () => (await contacts()).find(c => c.lastName === LAST4))
    if (X) made.contacts.push(X.id)
    const cardX = X && await until(async () => (await leads()).find(l => l.customerId === X.id))
    const Y = await makeCustomer('Twin', LAST4, '300 Yankee Rd, Ocala, FL 34472')
    check(`${size}: set up card for X, and Y with the same name`, !!X && !!cardX && !!Y && Y.id !== X.id && `${Y.firstName} ${Y.lastName}` === `${cardX.firstName} ${cardX.lastName}`)
    const snapX = JSON.stringify(await contact(X.id)), snapY = JSON.stringify(Y)
    // The new lead's own saves (its activity line, the follow up board) finish before the page moves on:
    // WebKit reports a fetch cut off by leaving the page as a page error.
    await s.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {}); await sleep(2000)
    await s.page.goto(`${APP}/pipeline?card=${encodeURIComponent(cardX.id)}`, { waitUntil: 'domcontentloaded' })
    await s.press(s.page.locator(`[data-card-window="${cardX.id}"] [data-card-new-quote]`))
    const b = s.page.locator('[data-quote-builder]')
    await b.waitFor({ timeout: 30000 })
    await s.press(b.locator('[data-step="yard"]').first())
    await s.press(b.locator('[data-shape="backyard"]'))
    await s.press(b.locator('[data-side="Left return"] [data-side-length]'))
    for (const [keys, last] of [[['3', '0'], 0], [['1', '2', '0'], 0], [['1', '5', '0'], 0], [['1', '0', '0'], 0], [['3', '0'], 1]]) {
      for (const k of keys) await s.press(s.page.locator(`[data-ftin-pad] [data-pad-key="${k}"]`))
      await s.press(s.page.locator(last ? '[data-ftin-pad] [data-pad-done]' : '[data-ftin-pad] [data-pad-next]'))
    }
    await s.press(b.locator('[data-step="style"]').first())
    await b.locator('select').filter({ hasText: 'Select a fence style' }).selectOption({ label: 'White Vinyl Privacy, 6 ft tall, 8 ft panels, No dig' })
    await s.press(b.locator('[data-step="price"]').first())
    await s.press(s.page.locator('[data-save-open]:visible').first())
    await s.page.locator('[data-quote-property-address]').waitFor({ timeout: 10000 })
    check(`${size}: Save quote opens with the card's customer picked`, (await s.page.locator('[data-clear-customer]').count()) === 1)
    await s.press(s.page.locator('[data-save-submit]'))
    const qx = await until(async () => ((await call('GET', '/api/saved-quotes')).json.data ?? []).find(q => q.crmContactId === X.id || q.crmContactId === Y.id))
    if (qx) made.quotes.push(qx.id)
    check(`${size}: the quote saved with X's id (the card's link), not Y's`, !!qx && qx.crmContactId === X.id, JSON.stringify(qx && { c: qx.crmContactId, x: X.id, y: Y.id }))
    await sleep(1500)
    check(`${size}: X and Y are unchanged`, JSON.stringify(await contact(X.id)) === snapX && JSON.stringify(await contact(Y.id)) === snapY)
    check(`${size}: no page errors`, s.errors.length === 0, s.errors.slice(0, 3).join(' | '))
  } catch (e) {
    check(`${size}: ran to the end`, false, String(e?.stack || e).slice(0, 600))
  } finally {
    await browser?.close().catch(() => {})
  }
}

try {
  await run(false)
  await run(true)
} finally {
  // ── Clean up: cards, quotes, customers, their activity lines ──
  const lasts = new Set(made.lasts)
  for (const c of await contacts()) if (lasts.has(c.lastName) && !made.contacts.includes(c.id)) made.contacts.push(c.id)
  const ids = new Set(made.contacts)
  for (let i = 0; i < 3; i++) {
    const pipe = (await call('GET', '/api/pipeline')).json.data
    const cards = (pipe?.leads ?? []).filter(l => ids.has(l.customerId) || lasts.has(l.lastName)).map(l => l.id)
    if (!cards.length) break
    if ((await call('PATCH', '/api/pipeline', { upsert: [], remove: cards, baseVersion: pipe.version })).status === 200) break
  }
  for (const q of (await call('GET', '/api/saved-quotes')).json.data ?? []) if (ids.has(q.crmContactId) && !made.quotes.includes(q.id)) made.quotes.push(q.id)
  for (const id of made.quotes) await call('DELETE', `/api/saved-quotes/${id}`).catch(() => {})
  for (const id of ids) await call('DELETE', `/api/crm-contacts/${id}`).catch(() => {})
  const kv = (await call('GET', '/api/kv')).json
  const acts = kv.data?.fencepro_customer_activity
  if (Array.isArray(acts) && acts.some(a => ids.has(a.customerId))) {
    await call('PUT', '/api/kv/fencepro_customer_activity', { value: acts.filter(a => !ids.has(a.customerId)), baseVersion: kv.versions.fencepro_customer_activity })
  }
  const contactsLeft = (await contacts()).filter(c => ids.has(c.id)).length
  const cardsLeft = (await leads()).filter(l => ids.has(l.customerId) || lasts.has(l.lastName)).length
  const quotesLeft = ((await call('GET', '/api/saved-quotes')).json.data ?? []).filter(q => made.quotes.includes(q.id)).length
  check('clean up: test cards, quotes and customers removed', contactsLeft + cardsLeft + quotesLeft === 0, `${contactsLeft} customers, ${cardsLeft} cards, ${quotesLeft} quotes`)
  const failed = results.filter(r => !r).length
  console.log(`\n${results.length - failed} of ${results.length} checks passed`)
  process.exit(failed ? 1 : 0)
}
