// People who don't finish the website instant quote (Jonathan, Oct 29 2026), end to end on the dev copy,
// the way it is used:
//   customer (iPhone, Safari's engine) types the address, draws the fence on the photo, picks vinyl,
//            types a name and phone, and leaves without pressing the button.
//            Before the name and phone: nothing goes to EZ Biz but the address lookups and the photo, and the
//            browser keeps nothing (no cookie, no localStorage or sessionStorage, nothing in the page address).
//   owner    the lead is on the Sales Pipeline marked "Didn't finish instant quote" (and on the customer's page,
//            with the tag and the History note); the new lead push is in the dev outbox; no text or email went
//            to the customer.
//   customer comes back later (a new visit: nothing remembered), does it again with the same name and phone,
//            and presses "Show my prices".
//   owner    the same customer, card, lead and quote, now the sent website quote; "Didn't finish" is gone; still
//            one push; still no text or email to the customer.
//
//   cd apps/web && pnpm -s build   (the server serves the built app and widget)
//   APP_URL=http://localhost:4094 E2E_STAFF_COOKIE=<dev cookie> [OUTBOX=<the server's dev-outbox.log>] [SHOTS=<folder>] \
//     node e2e/widget-partial-lead.mjs
//   KEEP_PARTIAL=1: stop after the owner's check and leave the unfinished lead on the dev copy (for a look).
//
// The county's lot lines are stubbed (no network needed); the photo comes from the server as usual. Everything
// it makes is removed at the end (unless KEEP_PARTIAL=1).
import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import './sharedLock.mjs' // writes a pipeline card: takes turns with the other tests that change shared data
import { webkit, chromium, devices } from 'playwright'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'
import fs from 'fs'
import path from 'path'
import { signInByCookie } from './lib.mjs'
import { toContactStep } from './widgetSteps.mjs'

const APP = process.env.APP_URL || 'http://localhost:4001'
const SHOTS = process.env.SHOTS || ''
const KEEP = process.env.KEEP_PARTIAL === '1'
const OUTBOX = process.env.OUTBOX || fileURLToPath(new URL('../../portal/logs/dev-outbox.log', import.meta.url))
if (!/^http:\/\/localhost:\d+$/.test(APP) || /:4000$/.test(APP)) { console.error('Refusing to run: the dev copy only.'); process.exit(2) }
const sql = q => execFileSync('psql', ['-d', 'ezbiz_dev', '-At', '-v', 'ON_ERROR_STOP=1', '-c', q], { encoding: 'utf8' }).trim()
if (sql('select current_database()') !== 'ezbiz_dev') { console.error('not the dev copy'); process.exit(2) }
const lit = s => `'${String(s).replace(/'/g, "''")}'`
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function until(fn, ms = 20000) { const end = Date.now() + ms; for (;;) { const v = await fn().catch(() => null); if (v || Date.now() > end) return v; await sleep(400) } }
let failed = 0
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`); if (!ok) failed++ }
const shot = async (page, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name) }) } }
const outbox = () => { try { return fs.readFileSync(OUTBOX, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) } catch { return [] } }

const NAME = 'TEST PARTIAL 1029'
const PHONE = '(352) 555-0129'
const ADDRESS_TYPED = '110 SE Watula'

/** One visit to the widget as the customer: address, drawing, vinyl; then the name and phone. Returns what it saw. */
async function customerVisit(browser, { send }) {
  const ctx = await browser.newContext({ ...devices['iPhone 13'] })
  // The county's lot lines (an outside service): none here.
  await ctx.route(/gis\.ocalafl\.org/, r => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '{"features":[]}' }))
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)))
  const sent = []
  page.on('request', r => { if (r.url().startsWith(APP + '/p/quote/api/')) sent.push({ method: r.method(), path: new URL(r.url()).pathname.replace('/p/quote/api', ''), body: r.postData() || '' }) })
  const kept = async () => ({
    cookies: (await ctx.cookies()).map(c => c.name),
    storage: await page.evaluate(() => localStorage.length + sessionStorage.length),
    url: page.url(),
  })
  await page.goto(`${APP}/p/quote/`)
  await toContactStep(page, { tap: true, address: ADDRESS_TYPED })
  await sleep(1500)
  const beforeContact = { requests: [...sent], ...(await kept()) }
  await page.locator('[data-w-name]').fill(NAME)
  await page.locator('[data-w-phone]').fill(PHONE)
  // A moment after the phone is typed, the lead so far is saved.
  const saved = await until(async () => sent.some(r => r.method === 'POST' && r.path === '/partial'), 8000)
  await sleep(1500)
  const afterContact = await kept()
  await shot(page, send ? 'partial-5-back-contact.png' : 'partial-1-customer-typed-phone.png')
  let sentOk = null
  if (send) {
    const res = page.waitForResponse(r => r.url().includes('/p/quote/api/submit'), { timeout: 30000 })
    await page.locator('[data-w-send]').tap()
    sentOk = (await res).status()
    await page.locator('[data-w-sent]').waitFor({ timeout: 30000 })
    await shot(page, 'partial-6-back-sent.png')
  } else {
    // They leave: another site in the same tab (the page is hidden and closed; the beacon goes).
    await page.goto('about:blank')
    await sleep(1500)
  }
  await ctx.close()
  return { beforeContact, saved, afterContact, sentOk, errors, partialSaves: sent.filter(r => r.path === '/partial').length }
}

/** Everything this run made on the dev copy: the customer, its card, quotes, lead, notes, the push records. */
function removeTestRecords() {
  const ids = sql(`select string_agg(id, ',') from "CrmContact" where "firstName"='TEST' and "lastName"='PARTIAL 1029'`).split(',').filter(Boolean)
  if (!ids.length) return 0
  const inList = ids.map(lit).join(',')
  const leads = sql(`select coalesce(string_agg(id, ','), '') from "IntakeLead" where "crmContactId" in (${inList})`).split(',').filter(Boolean)
  sql(`update "PipelineState" set leads = (select coalesce(jsonb_agg(l), '[]'::jsonb) from jsonb_array_elements(leads::jsonb) l where coalesce(l->>'customerId','') not in (${inList})), version = version + 1 where exists (select 1 from jsonb_array_elements(leads::jsonb) l where l->>'customerId' in (${inList}))`)
  if (leads.length) sql(`delete from "AutomationEffect" where key in (${leads.map(l => lit(`widget-partial-push:${l}`)).join(',')})`)
  sql(`delete from "AutomationEffect" where key like 'lead-repush:%' and split_part(key, ':', 2) in (${inList})`)
  sql(`delete from "SavedQuote" where "crmContactId" in (${inList})`)
  sql(`delete from "IntakeLead" where "crmContactId" in (${inList})`)
  sql(`delete from "CrmContactNote" where "crmContactId" in (${inList})`)
  sql(`delete from "CustomerPossibleMatch" where "contactId" in (${inList}) or "matchId" in (${inList})`)
  sql(`delete from "Notification" where title like '%${NAME}%'`)
  sql(`delete from "CrmContact" where id in (${inList})`)
  return ids.length
}

const wb = await webkit.launch()
const desk = await chromium.launch()
try {
  const leftover = removeTestRecords()
  if (leftover) console.log(`(removed ${leftover} ${NAME} customer(s) left from an earlier run)`)
  const box0 = outbox().length

  // ── 1. The customer types the phone, then leaves ──────────────────────────
  const v1 = await customerVisit(wb, { send: false })
  const early = v1.beforeContact
  check('before the name and phone: no save of any kind went to EZ Biz (only config, address suggestions, prices off)',
    !early.requests.some(r => r.method !== 'GET' || /draft|partial/.test(r.path)), early.requests.map(r => `${r.method} ${r.path}`).join(', '))
  check('before the name and phone: the browser keeps nothing (no cookie, no local or session storage, nothing in the address)',
    early.cookies.length === 0 && early.storage === 0 && !/[?&]draft=/.test(early.url), JSON.stringify({ cookies: early.cookies, storage: early.storage, url: early.url.replace(APP, '') }))
  check('the moment the name and phone are typed, the lead is saved', !!v1.saved, `${v1.partialSaves} save(s) from the page`)
  check('still nothing kept in the browser after the phone', v1.afterContact.cookies.length === 0 && v1.afterContact.storage === 0 && !/[?&]draft=/.test(v1.afterContact.url))
  check('no page errors (first visit)', v1.errors.length === 0, v1.errors.join(' | '))

  const row = await until(async () => {
    const r = sql(`select id || '|' || source || '|' || "crmContactId" || '|' || coalesce(payload->>'cardId','') || '|' || coalesce(payload->>'quoteId','') || '|' || address || '|' || "fenceType" || '|' || coalesce(estimate::text,'') from "IntakeLead" where name=${lit(NAME)} and "deletedAt" is null`)
    return r || null
  })
  const [leadId, source, contactId, cardId, quoteId, address, fence, estimate] = (row || '').split('|')
  check('the lead is "Didn\'t finish instant quote" with the address, the fence, the drawing and the estimate',
    source === 'ez_quote_partial' && /Watula/.test(address) && /^Vinyl/.test(fence) && Number(estimate) > 0 && !!quoteId, `${source} · ${address} · ${fence} · $${estimate}`)
  const summary = sql(`select summary from "IntakeLead" where id=${lit(leadId)}`)
  check('its note says how far they got and what they entered', /^Didn't finish instant quote/.test(summary) && /Got as far as: 4\. Price/.test(summary) && /Drawn on the photo: \d+ ft/.test(summary), summary.split('\n').slice(0, 3).join(' / '))
  check('one customer, tagged "Didn\'t finish instant quote"', sql(`select count(*) from "CrmContact" where "firstName"='TEST' and "lastName"='PARTIAL 1029'`) === '1' && /Didn't finish instant quote/.test(sql(`select tags::text from "CrmContact" where id=${lit(contactId)}`)))
  const card = JSON.parse(sql(`select l::text from "PipelineState", jsonb_array_elements(leads::jsonb) l where l->>'id'=${lit(cardId)}`) || '{}')
  check('one card on the Sales Pipeline, marked unfinished', card.unfinishedQuote === true && /^Didn't finish instant quote/.test(card.notes || ''), card.notes)
  const push = await until(async () => outbox().slice(box0).find(m => m.channel === 'push' && m.title === `New lead: ${NAME}`), 15000)
  check('the owner\'s new lead push (held in the dev outbox), saying it is an unfinished quote', !!push && /^Didn't finish instant quote · Ocala · Vinyl/.test(push.body || ''), push ? `${push.title} / ${push.body}` : 'none')
  const toCustomer = outbox().slice(box0).filter(m => m.channel === 'text' || m.channel === 'email')
  check('no text or email to the customer for starting', toCustomer.length === 0, toCustomer.map(m => `${m.channel} ${m.title}`).join(', '))

  // ── 2. The owner sees it ──────────────────────────────────────────────────
  const octx = await desk.newContext({ viewport: { width: 1440, height: 900 } })
  await signInByCookie(octx, { api: APP })
  const op = await octx.newPage()
  await op.goto(`${APP}/pipeline`)
  await op.locator('[aria-label="Search this pipeline"]').waitFor({ timeout: 30000 })
  await op.locator('[aria-label="Search this pipeline"]').fill(NAME)
  const cardEl = op.locator(`[data-card-id="${cardId}"]`)
  await cardEl.waitFor({ timeout: 20000 }).catch(() => {})
  check('owner: the card is on the Sales Pipeline with "Didn\'t finish instant quote"', await cardEl.locator('[data-card-unfinished]').isVisible().catch(() => false))
  const banner = await op.getByText(/Didn't finish instant quote/).count()
  check('owner: the waiting list (unassigned) says it too', banner >= 2, `${banner} places on the page`)
  await shot(op, 'partial-2-owner-pipeline.png')
  await op.goto(`${APP}/customers?customer=${encodeURIComponent(contactId)}`)
  await op.locator(`[data-customer-tag="Didn't finish instant quote"]`).first().waitFor({ timeout: 20000 }).catch(() => {})
  check('owner: the customer page shows the tag', await op.locator(`[data-customer-tag="Didn't finish instant quote"]`).first().isVisible().catch(() => false))
  await shot(op, 'partial-3-owner-customer.png')
  await op.goto(`${APP}/assign-lead?customer=${encodeURIComponent(contactId)}`)
  await op.getByText(/Didn't finish instant quote/).first().waitFor({ timeout: 20000 }).catch(() => {})
  check('owner: the push opens the Assign screen, which says "Didn\'t finish instant quote"', await op.getByText(/Didn't finish instant quote/).first().isVisible().catch(() => false))
  await shot(op, 'partial-4-owner-assign.png')

  if (KEEP) {
    console.log(`\nKEEP_PARTIAL=1: left on the dev copy: ${NAME} (customer ${contactId}, card ${cardId}).`)
  } else {
    // ── 3. They come back another day and finish ────────────────────────────
    const v2 = await customerVisit(wb, { send: true })
    check('coming back: a new visit remembers nothing in the browser', v2.beforeContact.cookies.length === 0 && v2.beforeContact.storage === 0)
    check('coming back and pressing "Show my prices": the quote is sent', v2.sentOk === 201, String(v2.sentOk))
    check('no page errors (second visit)', v2.errors.length === 0, v2.errors.join(' | '))
    await sleep(1500)
    const after = sql(`select id || '|' || source || '|' || "crmContactId" || '|' || coalesce(payload->>'cardId','') || '|' || coalesce(payload->>'quoteId','') from "IntakeLead" where name=${lit(NAME)} and "deletedAt" is null`)
    check('the same lead, updated (not a second one): now the sent website quote', after === `${leadId}|ez_quote|${contactId}|${cardId}|${quoteId}`, after)
    check('still one customer, and the tag is gone', sql(`select count(*) from "CrmContact" where "firstName"='TEST' and "lastName"='PARTIAL 1029'`) === '1' && !/Didn't finish/.test(sql(`select tags::text from "CrmContact" where id=${lit(contactId)}`)))
    const card2 = JSON.parse(sql(`select l::text from "PipelineState", jsonb_array_elements(leads::jsonb) l where l->>'id'=${lit(cardId)}`) || '{}')
    const cards = sql(`select count(*) from "PipelineState", jsonb_array_elements(leads::jsonb) l where l->>'customerId'=${lit(contactId)}`)
    check('the same card, no longer marked unfinished', cards === '1' && !card2.unfinishedQuote && /^Website, drawn by customer/.test(card2.notes || ''), card2.notes?.split('\n')[0])
    check('one quote', sql(`select count(*) from "SavedQuote" where "crmContactId"=${lit(contactId)}`) === '1')
    await sleep(2000)
    const pushes = outbox().slice(box0).filter(m => m.channel === 'push' && m.title === `New lead: ${NAME}`)
    check('still one push to the owner (no second one for finishing)', pushes.length === 1, String(pushes.length))
    const toCustomer2 = outbox().slice(box0).filter(m => m.channel === 'text' || m.channel === 'email')
    check('still no text or email to the customer', toCustomer2.length === 0, toCustomer2.map(m => `${m.channel} ${m.title}`).join(', '))
    await op.goto(`${APP}/pipeline`)
    await op.locator('[aria-label="Search this pipeline"]').fill(NAME)
    await op.locator(`[data-card-id="${cardId}"]`).waitFor({ timeout: 20000 }).catch(() => {})
    check('owner: the card no longer says "Didn\'t finish"', (await op.locator(`[data-card-id="${cardId}"]`).count()) === 1 && !(await op.locator(`[data-card-id="${cardId}"] [data-card-unfinished]`).count()))
    await shot(op, 'partial-7-owner-finished.png')
  }
  await octx.close()
} catch (e) {
  check('test run finished', false, String(e?.message || e).split('\n').slice(0, 3).join(' '))
} finally {
  await wb.close(); await desk.close()
  if (!KEEP) { const n = removeTestRecords(); console.log(`(removed ${n} test customer(s))`) }
}
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed')
process.exit(failed ? 1 : 0)
