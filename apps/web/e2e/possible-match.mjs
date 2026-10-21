// A website lead never attaches to a customer on file (Oct 21, 2026): it
// makes a new customer, and the one on file with the same phone and email is
// offered as a possible match, on the new customer's page and on its pipeline
// card. On the dev copy, desktop Chromium and a phone size WebKit.
//
//   cd apps/web && pnpm -s build
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 E2E_ACCESS_TOKEN=<dev token> node e2e/possible-match.mjs
//
//   1. Customer K on file (made through the API). The website quote (the real
//      /p/quote submit, drawn yard) sent twice with K's phone and email: one
//      new customer N with its card and quote; K unchanged.
//   2. N's page and N's card window: "Possible match: K, <phone>. Use K?".
//   3. Merge on the card: the card and the quote are K's, N is archived and
//      says "Merged into K", K's record is unchanged, the notice is gone.
//   4. K's page: the merge history with N's details; Undo merge: the card and
//      the quote are N's again, N is back, K unchanged.
//   5. N's page again: Not the same person; gone, and still gone after a reload.
// Removes every customer, card, quote, website lead, note, draft, match and
// merge it made.
import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import './sharedLock.mjs' // makes customers, cards and quotes: takes turns with the other tests that change shared data
import { chromium, webkit } from 'playwright'
import { execFileSync } from 'child_process'
import crypto from 'crypto'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || 'http://localhost:4001'
const TOKEN = process.env.E2E_ACCESS_TOKEN || ''
if (!/localhost:4001/.test(APP) || !/localhost:4001/.test(API)) { console.error('Refusing to run: the dev copy only (localhost:4001).'); process.exit(2) }
if (!TOKEN) { console.error('Set E2E_ACCESS_TOKEN.'); process.exit(2) }

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const psql = sql => execFileSync('psql', ['-d', 'ezbiz_dev', '-At', '-c', sql], { encoding: 'utf8' }).trim()
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
const contacts = async (archived = false) => (await call('GET', `/api/crm-contacts${archived ? '?archived=1' : ''}`)).json.data ?? []
const contact = async id => (await contacts()).find(c => c.id === id) ?? null
const leads = async () => (await call('GET', '/api/pipeline')).json.data?.leads ?? []
const quotesOf = async id => ((await call('GET', '/api/saved-quotes')).json.data ?? []).filter(q => q.crmContactId === id)

const stamp = Date.now().toString(36).slice(-6)
const rnd4 = () => String(1000 + crypto.randomInt(9000))
const made = { contacts: [], drafts: [], names: [] }
let browser = null

// The drawn yard (Ocala City Hall's point), as the website sends it: a backyard with a walk gate.
const AT = { lat: 29.185118, lng: -82.134209 }
const ll = (e, n) => {
  const lat0 = AT.lat * Math.PI / 180
  const mLat = 111132.954 - 559.822 * Math.cos(2 * lat0) + 1.175 * Math.cos(4 * lat0)
  const mLng = 111412.84 * Math.cos(lat0) - 93.5 * Math.cos(3 * lat0)
  return { lat: AT.lat + n * 0.3048 / mLat, lng: AT.lng + e * 0.3048 / mLng }
}
const DRAWING = { v: 1, address: '110 SE Watula Ave, Ocala, FL 34471', at: AT, runs: [
  { id: 'r1', pts: [ll(-30, 15), ll(-55, 15), ll(-55, 95), ll(55, 95), ll(55, 15), ll(30, 15)], start: 'house', end: 'house', typedFt: [null, null, 112, null, null], gates: [null, { type: 'walk', widthFt: 4, startFt: 11 }, null, null, null] },
] }
const ip = `10.${crypto.randomInt(250)}.${crypto.randomInt(250)}.${crypto.randomInt(250)}`
async function websiteQuote(draftId, name, phone, email) {
  const r = await fetch(`${API}/p/quote/api/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
    body: JSON.stringify({ draftId, name, phone, email, address: DRAWING.address, drawing: DRAWING, pick: { material: 'vinyl', color: 'white', height: '6', kind: 'privacy' }, wantsVisit: false }) })
  return r.status
}

async function session(phone) {
  browser = await (phone ? webkit : chromium).launch()
  const ctx = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true } : { viewport: { width: 1440, height: 900 } })
  await ctx.addInitScript(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, TOKEN)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 300)))
  page.on('dialog', d => d.accept().catch(() => {}))
  await page.route('**/api/automations/trigger', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true,"data":{"matched":0}}' }))
  const press = async loc => { await loc.waitFor({ state: 'visible', timeout: 15000 }); if (phone) await loc.tap(); else await loc.click(); await sleep(250) }
  return { page, errors, press }
}

async function run(phone) {
  const size = phone ? 'phone webkit' : 'desktop chromium'
  console.log(`\n── ${size} ──`)
  const tag = `${phone ? 'P' : 'D'}${stamp}`
  // ── 1. K on file; the website quote with K's phone and email, twice ──
  const kId = crypto.randomUUID()
  const kPhone = `(352) 55${crypto.randomInt(10)}-${rnd4()}`
  const kEmail = `e2e-match-${tag.toLowerCase()}-${rnd4()}@example.invalid`
  const KLAST = `Match Kept ${tag}`, NLAST = `Match New ${tag}`
  made.names.push(KLAST, NLAST)
  const mk = await call('POST', '/api/crm-contacts', { id: kId, firstName: 'Kara', lastName: KLAST, phone: kPhone, email: kEmail, serviceAddress: '1 Kept Ln, Ocala, FL 34470', leadSource: 'Other' })
  if (mk.status < 300) made.contacts.push(kId)
  const K = await contact(kId)
  check(`${size}: customer K made through the API`, !!K)
  const snapK = JSON.stringify(K)
  const draftId = crypto.randomBytes(18).toString('base64url')
  made.drafts.push(draftId)
  const s1 = await websiteQuote(draftId, `Nate ${NLAST}`, kPhone.replace(/\D/g, ''), kEmail.toUpperCase())
  const s2 = await websiteQuote(draftId, `Nate ${NLAST}`, kPhone.replace(/\D/g, ''), kEmail.toUpperCase())
  const news = (await contacts()).filter(c => c.lastName === NLAST)
  const N = news[0]
  if (N) made.contacts.push(N.id)
  check(`${size}: the website quote sent twice makes ONE new customer, not K`, s1 === 201 && s2 === 200 && news.length === 1 && N.id !== kId, `${s1} ${s2} ${news.length}`)
  const card = N && await until(async () => (await leads()).find(l => l.customerId === N.id))
  const [quote] = N ? await quotesOf(N.id) : []
  check(`${size}: N has its card and its quote`, !!card && !!quote)
  check(`${size}: K's record is unchanged`, JSON.stringify(await contact(kId)) === snapK)

  const s = await session(phone)
  try {
    // ── 2. The notice on N's page and N's card ──
    await s.page.goto(`${APP}/customers/${N.id}`)
    const notice = s.page.locator(`[data-possible-match-notice][data-match-customer="${kId}"]`)
    await notice.waitFor({ timeout: 30000 }).catch(() => {})
    const text = (await notice.count()) ? await notice.innerText() : ''
    check(`${size}: N's page: "Possible match: Kara ${KLAST}, <phone>. Use Kara ${KLAST}?"`, text.includes(`Possible match: Kara ${KLAST}`) && text.includes(`Use Kara ${KLAST}?`) && /\(352\) 55\d[ -]\d{4}/.test(text), text.replace(/\n/g, ' | ').slice(0, 200))
    check(`${size}: N's page has Merge and Not the same person`, (await notice.locator('[data-merge-match]').count()) === 1 && (await notice.locator('[data-dismiss-match]').count()) === 1)

    await s.page.goto(`${APP}/pipeline?card=${encodeURIComponent(card.id)}`, { waitUntil: 'domcontentloaded' })
    const cardNotice = s.page.locator(`[data-card-window="${card.id}"] [data-possible-match-notice][data-match-customer="${kId}"]`)
    const onCard = await cardNotice.waitFor({ timeout: 30000 }).then(() => true, () => false)
    check(`${size}: the card window shows the same notice`, onCard && (await cardNotice.innerText()).includes(`Use Kara ${KLAST}?`))

    // ── 3. Merge on the card ──
    await s.press(cardNotice.locator('[data-merge-match]'))
    const moved = await until(async () => (await leads()).find(l => l.id === card.id)?.customerId === kId)
    const q1 = (await call('GET', `/api/saved-quotes/${quote.id}`)).json.data
    check(`${size}: merged: the card and the quote are K's`, !!moved && q1?.crmContactId === kId, JSON.stringify({ card: (await leads()).find(l => l.id === card.id)?.customerId, quote: q1?.crmContactId }))
    const nNow = (await contacts(true)).find(c => c.id === N.id)
    check(`${size}: N is kept, archived, merged into K`, !!nNow && !!nNow.archivedAt && nNow.mergedIntoId === kId && !(await contact(N.id)))
    check(`${size}: K's record is unchanged by the merge`, JSON.stringify(await contact(kId)) === snapK)
    const gone = await until(async () => (await s.page.locator(`[data-card-window="${card.id}"] [data-possible-match-notice]`).count()) === 0, 15000)
    check(`${size}: the notice is gone from the card`, !!gone)
    // The card window's own reads finish before the page moves on (WebKit reports a fetch cut off by leaving as a page error).
    await s.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {}); await sleep(1500)

    await s.page.goto(`${APP}/customers/${N.id}`)
    const into = await s.page.locator(`[data-merged-into="${kId}"]`).waitFor({ timeout: 30000 }).then(() => true, () => false)
    if (!into && process.env.SHOTS) await s.page.screenshot({ path: `${process.env.SHOTS}/merged-into-${tag}.png` })
    check(`${size}: N's page says "Merged into Kara ${KLAST}"`, into && (await s.page.locator(`[data-merged-into="${kId}"]`).innerText()).includes(`Merged into Kara ${KLAST}`), into ? '' : s.page.url())

    // ── 4. K's page: history and Undo merge ──
    await s.page.goto(`${APP}/customers/${kId}`)
    const row = s.page.locator('[data-merge-history] [data-merge-row]').first()
    await row.waitFor({ timeout: 30000 }).catch(() => {})
    const rowText = (await row.count()) ? await row.innerText() : ''
    check(`${size}: K's page lists the merge with N's details and what moved`, rowText.includes(`Nate ${NLAST}`) && rowText.toLowerCase().includes(kEmail) && /1 quote/.test(rowText) && /1 card/.test(rowText), rowText.replace(/\n/g, ' | ').slice(0, 240))
    await s.press(row.locator('[data-undo-merge]'))
    const back = await until(async () => (await leads()).find(l => l.id === card.id)?.customerId === N.id)
    const q2 = (await call('GET', `/api/saved-quotes/${quote.id}`)).json.data
    check(`${size}: undone: the card and the quote are N's again`, !!back && q2?.crmContactId === N.id)
    const nBack = await contact(N.id)
    check(`${size}: N is back on the customer list, not merged`, !!nBack && !nBack.archivedAt && !nBack.mergedIntoId)
    check(`${size}: K's record is unchanged by the undo`, JSON.stringify(await contact(kId)) === snapK)
    const marked = await until(async () => (await s.page.locator('[data-merge-row][data-merge-undone="yes"]').count()) === 1, 15000)
    check(`${size}: K's history shows the merge undone, with no Undo button`, !!marked && (await s.page.locator('[data-merge-row] [data-undo-merge]').count()) === 0)

    // ── 5. Not the same person ──
    await s.page.goto(`${APP}/customers/${N.id}`)
    const again = s.page.locator(`[data-possible-match-notice][data-match-customer="${kId}"]`)
    const offered = await again.waitFor({ timeout: 30000 }).then(() => true, () => false)
    check(`${size}: after the undo the possible match is offered again`, offered)
    await s.press(again.locator('[data-dismiss-match]'))
    const hidden = await until(async () => (await s.page.locator('[data-possible-match-notice]').count()) === 0, 15000)
    await s.page.reload(); await s.page.locator('[data-customer-detail]').waitFor({ timeout: 30000 }); await sleep(2500)
    check(`${size}: Not the same person: gone, and still gone after a reload`, !!hidden && (await s.page.locator('[data-possible-match-notice]').count()) === 0)
    check(`${size}: K is still unchanged`, JSON.stringify(await contact(kId)) === snapK)
    await s.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {}); await sleep(1000)
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
  // ── Clean up: cards, quotes, website leads, notes, drafts, matches, merges, customers ──
  const names = new Set(made.names)
  for (const c of [...await contacts(), ...await contacts(true)]) if (names.has(c.lastName) && !made.contacts.includes(c.id)) made.contacts.push(c.id)
  const ids = new Set(made.contacts)
  const list = [...ids].map(i => `'${i}'`).join(',') || "''"
  let cardIds = []
  for (let i = 0; i < 3; i++) {
    const pipe = (await call('GET', '/api/pipeline')).json.data
    const cards = (pipe?.leads ?? []).filter(l => ids.has(l.customerId) || names.has(l.lastName) || [...names].some(n => `${l.firstName} ${l.lastName}`.includes(n))).map(l => l.id)
    cardIds = [...new Set([...cardIds, ...cards])]
    if (!cards.length) break
    if ((await call('PATCH', '/api/pipeline', { upsert: [], remove: cards, baseVersion: pipe.version })).status === 200) break
  }
  const cardList = cardIds.map(i => `'${i}'`).join(',') || "''"
  const drafts = made.drafts.map(d => `'${d}'`).join(',') || "''"
  psql(`delete from "CustomerMerge" where "keptId" in (${list}) or "mergedId" in (${list});
    delete from "CustomerPossibleMatch" where "contactId" in (${list}) or "matchId" in (${list});
    delete from "IntakeLead" where "crmContactId" in (${list}) or "sourceRef" in (${drafts});
    delete from "CrmContactNote" where "crmContactId" in (${list});
    delete from "CrmTextConsent" where "crmContactId" in (${list});
    delete from "SavedQuote" where "crmContactId" in (${list});
    delete from "AutomationRun" where "entityId" in (${list}) or "entityId" in (${cardList});
    delete from "AutomationEvent" where "entityId" in (${list}) or "entityId" in (${cardList});
    delete from "CardFollowUp" where "cardId" in (${cardList});
    delete from "WidgetDraft" where id in (${drafts});
    delete from "CrmAuditLog" where "entityId" in (${list});
    delete from "CrmContact" where id in (${list});`)
  for (const n of names) psql(`delete from "Notification" where title = 'Website quote: Nate ${n.replace(/'/g, "''")}'`)
  const left = Number(psql(`select (select count(*) from "CrmContact" where id in (${list})) + (select count(*) from "SavedQuote" where "crmContactId" in (${list})) + (select count(*) from "CustomerPossibleMatch" where "contactId" in (${list})) + (select count(*) from "CustomerMerge" where "keptId" in (${list}))`))
  const cardsLeft = (await leads()).filter(l => ids.has(l.customerId)).length
  check('clean up: every test customer, card, quote, lead, match and merge removed', left + cardsLeft === 0, `${left} rows, ${cardsLeft} cards`)
  const failed = results.filter(r => !r).length
  console.log(`\n${results.length - failed} of ${results.length} checks passed`)
  process.exit(failed ? 1 : 0)
}
