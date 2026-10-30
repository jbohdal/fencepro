// Texting consent, on the dev copy:
//   1. The customer page: a new customer shows "Texts: Not asked"; Record yes
//      (verbal) on desktop Chromium shows "Yes, verbal, recorded by <name>";
//      a second browser (phone size WebKit) opens the customer and sees the
//      same, presses Record no; the desktop reloads and shows No, with both
//      answers in the history.
//   2. The website quote: the checkbox is there with the exact words, the
//      Terms link opens gdfencepro.com/terms.cfm in a new tab, and it starts
//      unchecked. Sent checked, the new customer is Texts: Yes (website
//      checkbox, the words stored); sent unchecked, Texts: No.
//
//   cd apps/web && pnpm -s build
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 E2E_ACCESS_TOKEN=<dev token> node e2e/text-consent.mjs
//
// The website quotes are real dev leads (as in widget-draw.mjs): the customer
// walks to the name and phone (e2e/widgetSteps.mjs; nothing is saved before
// them, so there is no draft to start from). Removes every customer, card and
// quote it made.
import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import './sharedLock.mjs' // makes customers, cards and quotes: takes turns with the other tests that change shared data
import { chromium, webkit } from 'playwright'
import { execFileSync } from 'child_process'
import crypto from 'crypto'
import { toContactStep } from './widgetSteps.mjs'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || 'http://localhost:4001'
const TOKEN = process.env.E2E_ACCESS_TOKEN || ''
// The dev copy (4001), or a worktree's own dev server on another local port; never live (4000).
if (!/^http:\/\/localhost:\d+$/.test(APP) || !/^http:\/\/localhost:\d+$/.test(API) || /:4000$/.test(APP) || /:4000$/.test(API)) { console.error('Refusing to run: the dev copy only (localhost, not 4000).'); process.exit(2) }
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

const WORDING = 'Text me updates about my quote and installation. Msg frequency varies. Msg and data rates may apply. Reply STOP to opt out. Terms: gdfencepro.com/terms.cfm'
const stamp = Date.now().toString(36).slice(-6)
// Area code 000 is never a real number: no real customer on the dev copy has it.
const fakePhone = () => `(000) 5${crypto.randomInt(10, 99)}-${crypto.randomInt(1000, 9999)}`
const made = { contacts: [], cards: [], quotes: [], drafts: [] }
const browsers = []

async function staffSession(phone) {
  const b = await (phone ? webkit : chromium).launch(); browsers.push(b)
  const ctx = await b.newContext(phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true } : { viewport: { width: 1440, height: 900 } })
  await ctx.addInitScript(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, TOKEN)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 300)))
  const press = async loc => { await loc.waitFor({ state: 'visible', timeout: 15000 }); if (phone) await loc.tap(); else await loc.click(); await sleep(300) }
  return { ctx, page, errors, press }
}
const stateOf = async page => (await page.locator('[data-text-consent]').first().getAttribute('data-text-consent'))
const wordsOf = async page => (await page.locator('[data-text-consent-state]').first().textContent())?.trim() ?? ''
async function openCustomer(s, id) {
  // The texting answer is with the contact details: the column on the left on a computer, the Details tab on a phone.
  await s.page.goto(`${APP}/customers/${id}?tab=overview`, { waitUntil: 'domcontentloaded' })
  await s.page.locator('[data-customer-detail] [data-text-consent]:not([data-text-consent="loading"])').first().waitFor({ timeout: 60000 })
}

try {
  // ── 1. The customer page, two browsers ────────────────────────────────────
  const id = crypto.randomUUID()
  const r = await call('POST', '/api/crm-contacts', { id, firstName: 'E2E', lastName: `Consent ${stamp}`, phone: fakePhone(), leadSource: 'Other' })
  if (r.status < 300) made.contacts.push(id)
  check('a test customer is made', r.status < 300, String(r.status))

  const desk = await staffSession(false)
  await openCustomer(desk, id)
  check('desktop: a new customer shows Texts: Not asked', await stateOf(desk.page) === 'unknown' && (await wordsOf(desk.page)).includes('Not asked'), await wordsOf(desk.page))
  await desk.press(desk.page.locator('[data-text-consent-yes]').first())
  await until(async () => await stateOf(desk.page) === 'yes')
  const yesWords = await wordsOf(desk.page)
  check('desktop: Record yes (verbal) shows "Yes, verbal, recorded by <name> on <day>"', /Texts: Yes, verbal, recorded by .+ on [A-Z][a-z]{2} \d{1,2}$/.test(yesWords), yesWords)
  const saved = (await call('GET', `/api/crm-contacts/${id}/text-consent`)).json.data
  check('saved on the server: yes, verbal, with who and when', saved?.textConsent === 'yes' && saved.textConsentSource === 'verbal' && !!saved.textConsentBy && !!saved.textConsentAt && yesWords.includes(saved.textConsentBy))

  const phone = await staffSession(true)
  await openCustomer(phone, id)
  check('phone (second browser): the same answer shows', await stateOf(phone.page) === 'yes' && (await wordsOf(phone.page)) === yesWords, await wordsOf(phone.page))
  const box = await phone.page.locator('[data-text-consent-state]').first().boundingBox()
  check('phone: the answer fits on the screen', !!box && box.x >= 0 && box.x + box.width <= 390, JSON.stringify(box))
  await phone.press(phone.page.locator('[data-text-consent-no]').first())
  await until(async () => await stateOf(phone.page) === 'no')
  check('phone: Record no shows "No, verbal, recorded by ..."', (await wordsOf(phone.page)).startsWith('Texts: No, verbal, recorded by'), await wordsOf(phone.page))

  await desk.page.reload({ waitUntil: 'domcontentloaded' })
  await desk.page.locator('[data-customer-detail] [data-text-consent]:not([data-text-consent="loading"])').first().waitFor({ timeout: 60000 })
  check('desktop after a reload: No', await stateOf(desk.page) === 'no', await wordsOf(desk.page))
  await desk.press(desk.page.locator('[data-text-consent-history-toggle]').first())
  const events = await desk.page.locator('[data-text-consent-history] [data-text-consent-event]').evaluateAll(els => els.map(e => e.getAttribute('data-text-consent-event')))
  check('the history keeps both answers, newest first', JSON.stringify(events) === '["no","yes"]', JSON.stringify(events))
  check('no page errors on the customer page', desk.errors.length === 0 && phone.errors.length === 0, [...desk.errors, ...phone.errors].join(' | '))

  // ── 2. The website quote's checkbox ───────────────────────────────────────
  // The page through an https stand in (its cookie is Secure), as in widget-draw.mjs.
  const WIDGET = 'https://widget.test'
  const wb = await chromium.launch(); browsers.push(wb)
  const at = { lat: 29.185118, lng: -82.134209 }
  const p = (e, n) => ({ lat: at.lat + n * 0.3048 / 110837, lng: at.lng + e * 0.3048 / 97377 })
  const ADDRESS = '110 SE Watula Ave, Ocala, FL 34471'
  const drawing = { v: 1, address: ADDRESS, at, runs: [{ id: 'a', pts: [p(0, 0), p(0, 60), p(80, 60)], start: 'free', end: 'free', typedFt: [null, null], gates: [null, null] }] }
  const pick = { material: 'vinyl', color: 'white', height: '6', kind: 'privacy' }

  async function sendQuote(checked) {
    const ctx = await wb.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })
    // A request still in flight when the page closes is dropped quietly.
    await ctx.route(`${WIDGET}/**`, async rt => { try { await rt.fulfill({ response: await rt.fetch({ url: rt.request().url().replace(WIDGET, APP) }) }) } catch { /* page closed */ } })
    // No outside photo service needed: the price step shows no photo.
    await ctx.route(/USGS|arcgis|gis\.ocalafl/, rt => rt.fulfill({ status: 404, body: '' }))
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', e => errors.push(String(e).slice(0, 300)))
    const popups = []
    ctx.on('page', pg => popups.push(pg))
    await page.goto(`${WIDGET}/p/quote/`)
    // The address, the fence drawn on the photo and vinyl picked, as a customer does.
    await toContactStep(page, { tap: true })
    const label = page.locator('[data-w-text-consent]').first()
    await label.waitFor({ timeout: 30000 })
    const words = (await label.textContent()).replace(/\s+/g, ' ').trim()
    const boxEl = page.locator('[data-w-text-consent-box]').first()
    const link = page.locator('[data-w-terms]').first()
    if (checked) {
      check('widget: the checkbox has exactly the words', words === WORDING, words)
      check('widget: it starts unchecked', !(await boxEl.isChecked()))
      check('widget: the Terms link goes to gdfencepro.com/terms.cfm in a new tab', await link.getAttribute('href') === 'https://gdfencepro.com/terms.cfm' && await link.getAttribute('target') === '_blank')
      await boxEl.check()
    }
    const name = `E2E Consent ${checked ? 'Yes' : 'No'} ${stamp}`
    const ph = fakePhone()
    await page.locator('[data-w-name]').first().fill(name)
    await page.locator('[data-w-phone]').first().fill(ph)
    const sent = page.waitForResponse(res => res.url().includes('/p/quote/api/submit'), { timeout: 30000 })
    await page.locator('[data-w-send]').click()
    const res = await sent
    // The visit's id the page sent (kept in its memory only): the lead's key.
    const d = { id: String(res.request().postDataJSON()?.draftId || '').replace(/[^A-Za-z0-9_-]/g, '') }
    await page.locator('[data-w-sent]').waitFor({ timeout: 30000 })
    check(`widget (${checked ? 'checked' : 'unchecked'}): the quote is sent`, res.status() === 201, String(res.status()))
    const lead = psql(`select "crmContactId" from "IntakeLead" where source='ez_quote' and "sourceRef"='${d.id}'`)
    const payload = lead ? JSON.parse(psql(`select payload::text from "IntakeLead" where source='ez_quote' and "sourceRef"='${d.id}'`)) : {}
    if (lead) { made.contacts.push(lead); if (payload.cardId) made.cards.push(payload.cardId); if (payload.quoteId) made.quotes.push(payload.quoteId) }
    const row = lead ? psql(`select "textConsent", "textConsentSource", "textConsentBy", ("textConsentAt" is not null) from "CrmContact" where id='${lead}'`) : ''
    const hist = lead ? psql(`select consent || '|' || source || '|' || coalesce(wording, '') from "CrmTextConsent" where "crmContactId"='${lead}'`) : ''
    if (checked) {
      check('checked: the new customer is Texts: Yes from the website checkbox, with the time', row === 'yes|website_checkbox|website|t', row)
      check('checked: the exact words are stored with the yes', hist === `yes|website_checkbox|${WORDING}`, hist)
    } else {
      check('unchecked: the new customer is Texts: No (chose not to)', row === 'no|website_checkbox|website|t', row)
      check('unchecked: one history row, a no', hist.split('\n').length === 1 && hist.startsWith('no|website_checkbox|'), hist)
    }
    check(`widget (${checked ? 'checked' : 'unchecked'}): no page errors`, errors.length === 0, errors.join(' | '))
    await ctx.unrouteAll({ behavior: 'ignoreErrors' })
    await ctx.close()
    return lead
  }
  const yesId = await sendQuote(true)
  await sendQuote(false)

  // Staff see the website yes on the customer page.
  if (yesId) {
    await openCustomer(desk, yesId)
    check('the customer page shows "Yes, website checkbox checked on <day>"', /Texts: Yes, website checkbox checked on [A-Z][a-z]{2} \d{1,2}$/.test(await wordsOf(desk.page)), await wordsOf(desk.page))
  }

  // Test mode (?test=1) still makes no lead.
  const before = psql(`select count(*) from "IntakeLead"`)
  const t = await (await fetch(`${API}/p/quote/api/submit?test=1`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draftId: `consenttest${stamp}consenttest`, name: 'E2E Consent Test', phone: fakePhone(), address: ADDRESS, drawing, pick, textConsent: true, test: true }) })).json()
  check('test mode with the box checked makes no lead and no customer', t.test === true && psql(`select count(*) from "IntakeLead"`) === before)
} catch (e) {
  check('test run finished', false, String(e?.message || e).split('\n').slice(0, 3).join(' '))
} finally {
  try {
    for (const q of made.quotes) await call('DELETE', `/api/saved-quotes/${q}`)
    if (made.cards.length) { const pipe = await call('GET', '/api/pipeline'); await call('PATCH', '/api/pipeline', { upsert: [], remove: made.cards, baseVersion: pipe.json.data.version }) }
    // And any customer of this run a failed step did not note.
    for (const c of psql(`select id from "CrmContact" where "lastName" like 'Consent%${stamp}'`).split('\n').filter(Boolean)) if (!made.contacts.includes(c)) made.contacts.push(c)
    const ids = made.contacts.map(c => `'${c}'`).join(',')
    const cards = made.cards.map(c => `'${c}'`).join(',')
    if (cards) psql(`delete from "AutomationEvent" where "entityId" in (${cards}); delete from "CardFollowUp" where "cardId" in (${cards})`)
    if (ids) psql(`delete from "IntakeLead" where "crmContactId" in (${ids}); delete from "CrmContactNote" where "crmContactId" in (${ids}); delete from "SavedQuote" where "crmContactId" in (${ids}); delete from "CrmContact" where id in (${ids})`)
    psql(`delete from "Notification" where title like 'Website quote: E2E Consent % ${stamp}'`)
    if (made.drafts.length) psql(`delete from "WidgetDraft" where id in (${made.drafts.map(d => `'${d}'`).join(',')})`)
    check('test records removed', !ids || psql(`select count(*) from "CrmContact" where id in (${ids})`) === '0')
  } catch (e) { check('test records removed', false, String(e?.message || e).slice(0, 200)) }
  for (const b of browsers) await b.close().catch(() => {})
}
const passed = results.filter(Boolean).length
console.log(`\n${passed} of ${results.length} checks passed`)
process.exit(passed === results.length ? 0 : 1)
