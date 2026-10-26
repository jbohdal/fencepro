// The customer page (redesign, Oct 26 2026), on a computer (Chromium 1440 x 900)
// and an iPhone 13 (WebKit), with a customer who has a lot: 60 notes and 110 photos.
//
//   - The header is always at the top: name, the full property address (a maps
//     link), phone, email, rep, lead source, and the main actions (in the header
//     on a computer, the bar at the bottom on a phone).
//   - Every tab opens, says so in the address (?tab=; none for Activity), and nothing on the page has
//     a scroll box of its own: the page scrolls, the header and the tabs stay put.
//   - Long lists draw a page at a time with Show more (notes, photos, activity).
//   - ?tab= opens that tab (a link, a reload; ?tab=messages is the Portal tab),
//     Back closes Edit and stays on the customer, Text asks for a yes to texts.
//
//   APP_URL=http://localhost:4042 API_URL=http://localhost:4042 E2E_STAFF_COOKIE=$(cat cookie) node e2e/customer-page.mjs
//   ONLY=computer | ONLY=phone      one of the two
//   SHOTS=<folder>                  a screenshot per step
//
// Dev copy only. Its customer, notes and photos are removed at the end.
import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import './sharedLock.mjs' // makes a customer: takes turns with the other tests that change shared data
import { webkit, devices } from 'playwright'
import { execFileSync } from 'child_process'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { chromium, APP, API, sleep, signInByCookie, reporter, STAFF_COOKIE } from './lib.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PHOTO = fs.readFileSync(path.join(HERE, 'fixtures', 'test-photo.jpg'))
const SHOTS = process.env.SHOTS || ''
const ONLY = process.env.ONLY || ''
const NOTES = 60, PHOTOS = 110
const ADDRESS = '1349 SE 32nd St, Ocala, FL 34471'
const { check, finish } = reporter()
const psql = sql => execFileSync('psql', ['-d', 'ezbiz_dev', '-At', '-c', sql], { encoding: 'utf8' }).trim()

// The API as the signed in test login (the same cookie the browsers get).
const H = { 'X-Staff-Request': '1', ...(STAFF_COOKIE ? { Cookie: `ezbiz_staff=${STAFF_COOKIE}` } : {}) }
async function call(method, p, body, raw) {
  const r = await fetch(API + p, { method, headers: { ...H, 'Content-Type': raw ? 'application/octet-stream' : 'application/json' }, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) })
  const json = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`${method} ${p}: ${r.status} ${JSON.stringify(json).slice(0, 200)}`)
  return json
}
if (!STAFF_COOKIE) { console.error('Set E2E_STAFF_COOKIE (apps/portal/scripts/dev-session-token.ts --cookie).'); process.exit(2) }

const id = crypto.randomUUID()
const stamp = Date.now().toString(36).slice(-5)
const browsers = []

/** Every element in the customer page that scrolls on its own (none should). Windows over the page (position: fixed) are left out. */
const nestedScrollers = () => {
  const root = document.querySelector('[data-customer-detail]')
  if (!root) return ['no customer page']
  const out = []
  for (const el of root.querySelectorAll('*')) {
    if (el.closest('[data-customer-actions]') || /^(TEXTAREA|SELECT|INPUT)$/.test(el.tagName)) continue
    let fixed = false
    for (let a = el; a && a !== root; a = a.parentElement) if (getComputedStyle(a).position === 'fixed') { fixed = true; break }
    if (fixed) continue
    const oy = getComputedStyle(el).overflowY
    if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1) {
      out.push(`${el.tagName.toLowerCase()}${el.getAttribute('class') ? '.' + el.getAttribute('class').split(' ').slice(0, 3).join('.') : ''} (${el.clientHeight}px showing ${el.scrollHeight}px)`)
    }
  }
  return out
}

async function session(kind) {
  const phone = kind === 'phone'
  const b = await (phone ? webkit : chromium).launch(); browsers.push(b)
  const ctx = await b.newContext(phone ? { ...devices['iPhone 13'] } : { viewport: { width: 1440, height: 900 } })
  await signInByCookie(ctx)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 300)))
  page.on('dialog', d => d.accept().catch(() => {}))
  const tap = async loc => { await loc.waitFor({ state: 'visible', timeout: 20000 }); if (phone) await loc.tap(); else await loc.click(); await sleep(400) }
  const shot = async name => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `${kind}-${name}.png`) }) } }
  return { kind, phone, ctx, page, errors, tap, shot }
}

async function openCustomer(s, query = '') {
  await s.page.goto(`${APP}/customers/${id}${query}`, { waitUntil: 'domcontentloaded' })
  await s.page.waitForSelector('[data-customer-header]', { timeout: 90000 })
  await s.page.waitForSelector('[data-customer-tab-panel]', { timeout: 30000 })
  await sleep(1500)
}
const tabOfUrl = page => new URL(page.url()).searchParams.get('tab')

async function run(s) {
  const { page, tap, kind } = s
  await openCustomer(s)
  await s.shot('header')

  // ── The header ──
  const head = page.locator('[data-customer-header]')
  const addr = head.locator('[data-customer-address]')
  check(`${kind}: the header shows the full property address`, (await addr.innerText()).includes(ADDRESS), await addr.innerText())
  check(`${kind}: tapping the address opens maps`, /^https:\/\/www\.google\.com\/maps\//.test(await addr.getAttribute('href') || ''), await addr.getAttribute('href'))
  check(`${kind}: the header shows the phone (a tel: link), email, rep and lead source`,
    (await head.locator('[data-customer-header-phone]').getAttribute('href'))?.startsWith('tel:')
    && (await head.locator('[data-customer-email]').innerText()) === 'redesign.e2e@example.com'
    && (await head.locator('[data-customer-rep]').innerText()).includes('Rep:')
    && (await head.locator('[data-customer-source]').count()) === 1)
  const bar = s.phone ? page.locator('[data-customer-actions]') : head
  const actions = ['new-quote', 'call', 'text', 'navigate', 'book', 'edit']
  const shown = []
  for (const a of actions) if (await bar.locator(`[data-customer-action="${a}"]`).isVisible().catch(() => false)) shown.push(a)
  check(`${kind}: New quote, Call, Text, Navigate, Book and Edit are on screen (${s.phone ? 'the bar at the bottom' : 'the header'})`, shown.length === actions.length, shown.join(','))
  const textAllowed = async () => bar.locator('[data-customer-action="text"]').getAttribute('data-text-allowed')
  for (let i = 0; i < 30 && await textAllowed() === 'checking'; i++) await sleep(500)
  check(`${kind}: Text asks for a yes to texts first (no yes on record)`, await textAllowed() === 'no', await textAllowed())
  check(`${kind}: the summary row (open quotes, jobs, balance, next appointment, last contact)`,
    (await page.locator('[data-customer-summary] [data-customer-summary-item]').evaluateAll(els => els.map(e => e.getAttribute('data-customer-summary-item')))).join(',').startsWith('open-quotes,jobs,balance,next-appointment,last-contact'))

  // ── Every tab, and no box of its own anywhere ──
  const tabs = await page.locator('[data-customer-tab]').evaluateAll(els => els.map(e => e.getAttribute('data-customer-tab')))
  const want = ['activity', 'quotes', 'jobs', 'appointments', 'billing', 'costing', 'photos', 'files', 'pullsheets', 'notes', 'portal', ...(s.phone ? ['overview'] : [])]
  check(`${kind}: the tabs, most used first`, JSON.stringify(tabs) === JSON.stringify(want), tabs.join(','))
  if (!s.phone) check(`${kind}: the contact details and texting answer are in the column on the left`, await page.locator('[data-customer-side] [data-customer-details] [data-text-consent]').count() === 1)
  const bad = []
  for (const t of tabs) {
    await tap(page.locator(`[data-customer-tab="${t}"]`))
    await sleep(1200)
    // Activity is the first tab: its address needs no ?tab=.
    const open = await page.locator(`[data-customer-tab-panel="${t}"]`).count() === 1 && (await page.locator(`[data-customer-tab="${t}"]`).getAttribute('aria-selected')) === 'true' && tabOfUrl(page) === (t === 'activity' ? null : t)
    const nested = await page.evaluate(nestedScrollers)
    if (!open || nested.length) bad.push(`${t}: ${open ? '' : 'did not open '}${nested.join('; ')}`)
    await s.shot(`tab-${t}`)
  }
  check(`${kind}: every tab opens, with ?tab= in the address, and nothing scrolls inside the page`, bad.length === 0, bad.join(' | '))

  // ── Notes: the page scrolls, the header and tabs stay at the top; a page of notes with Show more ──
  await tap(page.locator('[data-customer-tab="notes"]'))
  await page.waitForSelector('[data-note]', { timeout: 30000 })
  check(`${kind}: Notes draws 30 at first, with Show more`, await page.locator('[data-note]').count() === 30 && await page.locator('[data-show-more="notes"]').isVisible())
  await page.evaluate(() => { document.querySelector('[data-page-scroll]').scrollTop += 2500 })
  await sleep(600)
  const stuck = await page.evaluate(() => {
    const sc = document.querySelector('[data-page-scroll]').getBoundingClientRect()
    const h = document.querySelector('[data-customer-header]').getBoundingClientRect()
    const t = document.querySelector('[data-customer-tabs]').getBoundingClientRect()
    return { scTop: Math.round(sc.top), hTop: Math.round(h.top), hBottom: Math.round(h.bottom), tTop: Math.round(t.top), scrolled: document.querySelector('[data-page-scroll]').scrollTop }
  })
  check(`${kind}: scrolled down, the header stays at the top and the tabs right under it`, stuck.scrolled > 1000 && Math.abs(stuck.hTop - stuck.scTop) <= 2 && Math.abs(stuck.tTop - stuck.hBottom) <= 2, JSON.stringify(stuck))
  await s.shot('notes-scrolled')
  await tap(page.locator('[data-show-more="notes"]'))
  check(`${kind}: Show more draws the next 30 (all 60)`, await page.locator('[data-note]').count() === NOTES && await page.locator('[data-show-more="notes"]').count() === 0)
  // A tab picked while scrolled down opens at its top, right under the tabs.
  await tap(page.locator('[data-customer-tab="activity"]'))
  await sleep(1500)
  const atTop = await page.evaluate(() => {
    const t = document.querySelector('[data-customer-tabs]').getBoundingClientRect()
    const p = document.querySelector('[data-customer-tab-panel]').getBoundingClientRect()
    return { gap: Math.round(p.top - t.bottom) }
  })
  check(`${kind}: a tab picked while scrolled down opens at its top`, atTop.gap >= 0 && atTop.gap < 40, JSON.stringify(atTop))
  check(`${kind}: Activity draws 25 at first, with Show more`, await page.locator('[data-customer-tab-panel] [data-history-item]').count() === 25 && await page.locator('[data-show-more="history"]').isVisible())

  // ── Photos: thumbnails, the newest 60, Show earlier ──
  await tap(page.locator('[data-customer-tab="photos"]'))
  await page.waitForSelector('[data-media-item]', { timeout: 30000 })
  await sleep(800)
  const imgs = await page.locator('[data-media-item] img').evaluateAll(els => els.map(e => ({ lazy: e.getAttribute('loading'), src: e.getAttribute('src') || '' })))
  check(`${kind}: Photos draws the newest 60 of ${PHOTOS}, lazy loaded`, imgs.length === 60 && imgs.every(i => i.lazy === 'lazy'), `${imgs.length}`)
  check(`${kind}: the photos are thumbnails`, imgs.every(i => /\/thumb\b|thumb/.test(i.src)), imgs[0]?.src.slice(0, 120))
  await tap(page.locator('[data-show-more="media"]'))
  check(`${kind}: Show earlier draws the rest`, await page.locator('[data-media-item]').count() === PHOTOS)
  check(`${kind}: after Show more, still nothing scrolls inside the page`, (await page.evaluate(nestedScrollers)).length === 0)

  // ── Links: ?tab= opens that tab, the old ?tab=messages is Portal, a reload keeps the tab ──
  await openCustomer(s, '?tab=photos')
  check(`${kind}: /customers/<id>?tab=photos opens Photos`, await page.locator('[data-customer-tab-panel="photos"]').count() === 1)
  await openCustomer(s, '?tab=messages')
  check(`${kind}: ?tab=messages opens the Portal tab (portal access and messages)`, await page.locator('[data-customer-tab-panel="portal"] [data-portal-access]').count() === 1 && await page.locator('[data-customer-tab-panel="portal"] [data-customer-messages]').count() === 1)
  await tap(page.locator('[data-customer-tab="jobs"]'))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-customer-tab-panel]', { timeout: 60000 })
  check(`${kind}: a reload keeps the tab`, await page.locator('[data-customer-tab-panel="jobs"]').count() === 1 && tabOfUrl(page) === 'jobs')

  // ── Edit, then Back (or Escape on a computer): back on the customer, same tab ──
  await tap(bar.locator('[data-customer-action="edit"]'))
  await page.waitForSelector('[data-customer-save]', { timeout: 10000 })
  if (s.phone) await page.goBack(); else await page.keyboard.press('Escape')
  await sleep(1200)
  const back = await page.locator('[data-customer-save]').count() === 0 && await page.locator('[data-customer-tab-panel="jobs"]').count() === 1
  if (!back && !s.phone) { await page.goBack(); await sleep(1200) }
  check(`${kind}: ${s.phone ? 'Back' : 'Escape or Back'} closes Edit and the customer is back on the same tab`, await page.locator('[data-customer-save]').count() === 0 && await page.locator('[data-customer-tab-panel="jobs"]').count() === 1 && new URL(page.url()).pathname === `/customers/${id}`)
  check(`${kind}: no page errors`, s.errors.length === 0, s.errors.join(' | '))
}

try {
  // ── A customer with a lot: 60 notes, 110 photos ──
  await call('POST', '/api/crm-contacts', { id, firstName: 'E2E', lastName: `Customer Page ${stamp}`, phone: `(000) 5${crypto.randomInt(10, 99)}-${crypto.randomInt(1000, 9999)}`, email: 'redesign.e2e@example.com', serviceAddress: ADDRESS, leadSource: 'Google', salesRep: 'E2E Rep', tags: [] })
  for (let i = 1; i <= NOTES; i++) await call('POST', `/api/crm-contacts/${id}/notes`, { body: `E2E note ${i}: gate on the left, HOA letter ${i % 2 ? 'asked for' : 'received'}.` })
  for (let i = 0; i < PHOTOS; i++) {
    const clientId = crypto.randomUUID()
    await call('POST', '/api/media/uploads', { clientId, size: PHOTO.length, meta: { kind: 'photo', mime: 'image/jpeg', customerId: id, takenAt: new Date(Date.now() - (PHOTOS - i) * 60_000).toISOString(), category: 'Site walk', caption: `E2E photo ${i + 1}` } })
    await call('PUT', `/api/media/uploads/${clientId}?offset=0`, undefined, PHOTO)
    await call('POST', `/api/media/uploads/${clientId}/finish`, {})
  }
  check('a test customer with 60 notes and 110 photos is made', Number(psql(`select count(*) from "CrmContactNote" where "crmContactId"='${id}'`)) === NOTES && Number(psql(`select count(*) from "MediaItem" where "customerId"='${id}'`)) === PHOTOS)
  // The photos' thumbnails are made on the server: wait for them.
  for (let i = 0; i < 60 && Number(psql(`select count(*) from "MediaItem" where "customerId"='${id}' and "thumbPath" is null`)) > 0; i++) await sleep(1000)

  if (ONLY !== 'phone') await run(await session('computer'))
  if (ONLY !== 'computer') await run(await session('phone'))
} catch (err) {
  check('the run finished', false, String(err?.stack || err).slice(0, 600))
} finally {
  for (const b of browsers) await b.close().catch(() => {})
  try {
    for (const p of psql(`select concat_ws('|', path, "thumbPath", "previewPath", "markupPath") from "MediaItem" where "customerId"='${id}'`).split('\n').filter(Boolean)) {
      for (const f of p.split('|').filter(Boolean)) fs.rmSync(f, { force: true })
    }
    psql(`delete from "MediaItem" where "customerId"='${id}'; delete from "AutomationEvent" where "entityId"='${id}'; delete from "CrmContactNote" where "crmContactId"='${id}'; delete from "CrmContact" where id='${id}'`)
    check('the test customer, notes and photos are removed', Number(psql(`select count(*) from "CrmContact" where id='${id}'`)) === 0)
  } catch (err) { check('the test customer is removed', false, String(err).slice(0, 300)) }
  process.exit(finish())
}
