// Visit photos reach the quote, the proposal and the job (walkthrough round 2, item 8, and the round 2 review;
// Oct 26, 2026), on the dev copy, the way they are used:
//
// Phone (iPhone size, WebKit = the Safari engine), WT Christa (Salesman):
//   1. Today > her visit > Complete > Ready to quote, notes and 3 photos (one a supplier invoice) > "Save and start
//      the quote": the new quote's camera counts the 3 visit photos; the photos are saved Internal.
//   2. She makes it a repair (Style: Repair, a leaning fence, 2 posts and a gate rehang): the Site visit box still
//      shows the photos with the hint that the customer sees none until ticked. The Photos sheet has "Show these to
//      the customer", nothing ticked.
//   3. Price step: the Live quote shows the repair items (not "0 sections / 0 ft") and a crew time from its man hours.
//   4. Save: the saved quote's window opens with its Send box (not back on Today); it is no wider than the phone;
//      it lists the repair items (no "Walk gates 0"). The Send box shows the 3 photos to tick; the repair's photo
//      check counts only ticked ones, so it is blocked; she ticks two (the invoice stays Internal); Copy link works.
// Computer (Chrome, 1440 x 900), the owner:
//   5. The Quotes list and the customer page's Quotes tab show the repair work, not "0".
//   6. The customer's repair proposal shows the 2 ticked photos with no caption; the invoice's link is refused.
//   7. A new fence proposal for the same customer shows the ticked photos too (it showed none before).
//   8. Sold: the job's Photos and video and the crew packet carry the quote's visit photos (the invoice too for the
//      crew); Photos Uploaded is not ticked by them.
//   9. An older website note's "281 ft (measured)" reads "281 ft" on the customer's Notes tab.
//
//   cd apps/web && pnpm -s build
//   APP_URL=http://localhost:4044 API_URL=http://localhost:4044 E2E_STAFF_COOKIE=<dev owner cookie> \
//   [SHOTS=<folder>] node e2e/visit-photos.mjs
//
// Dev only (devOnly.mjs refuses port 4000 and anything not on this Mac). The test customer, visit, quotes, job,
// packet, notes and photos (rows and files) are removed at the end; WT records are only read.

import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import { webkit, chromium, devices } from 'playwright'
import { signInByCookie } from './lib.mjs'
import { execFileSync } from 'child_process'
import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || 'http://localhost:4001'
const COOKIE = process.env.E2E_STAFF_COOKIE || ''
const TOKEN = process.env.E2E_ACCESS_TOKEN || ''
const SHOTS = process.env.SHOTS || ''
const devLocal = u => /^http:\/\/localhost:\d+\/?$/.test(u) && !/:4000\b/.test(u)
if (!devLocal(APP) || !devLocal(API)) { console.error('Refusing to run: the dev copy only.'); process.exit(2) }
if (!COOKIE && !TOKEN) { console.error('Set E2E_STAFF_COOKIE (scripts/dev-session-token.ts --cookie) or E2E_ACCESS_TOKEN.'); process.exit(2) }

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PHOTO = path.resolve(HERE, 'fixtures/test-photo.jpg')
const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const psql = sql => execFileSync('psql', ['-d', 'ezbiz_dev', '-At', '-c', sql], { encoding: 'utf8' }).trim()
const q = s => String(s).replace(/'/g, "''")
const staffHeaders = COOKIE ? { Cookie: `ezbiz_staff=${COOKIE}`, 'X-Staff-Request': '1' } : { Authorization: `Bearer ${TOKEN}`, 'X-Staff-Request': '1' }
const api = async (p, init = {}) => (await (await fetch(API + p, { ...init, headers: { ...staffHeaders, ...(init.body ? { 'Content-Type': 'application/json' } : {}) } })).json())
const shot = async (page, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `visit-photos-${name}.png`) }) } }
const watch = page => { const errors = []; page.on('pageerror', e => errors.push(String(e).slice(0, 200))); return errors }
const CHRISTA = { email: 'wt-christa@example.invalid', password: 'WT-walk-2026!' }

const NAME_LAST = `Visit Photos ${Date.now().toString(36)}`
const NAME = `E2E ${NAME_LAST}`
const made = { contact: '', appt: '', quote: '', fence: '', job: '', packet: '', account: '' }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-visit-photos-'))
// The third is the "supplier invoice": it must never reach the customer.
const shots3 = ['front-gate.jpg', 'broken-post.jpg', 'supplier-invoice.jpg'].map(n => { const f = path.join(tmp, n); fs.copyFileSync(PHOTO, f); return f })
const media = () => psql(`select id || '|' || visibility || '|' || coalesce("quoteKey",'') || '|' || coalesce("jobId",'') || '|' || category || '|' || caption from "MediaItem" where "customerId"='${q(made.contact)}' and "deletedAt" is null order by "takenAt", "createdAt"`).split('\n').filter(Boolean).map(r => { const [id, visibility, quoteKey, jobId, category, caption] = r.split('|'); return { id, visibility, quoteKey, jobId, category, caption } })

async function setup() {
  const christa = psql(`select id || '|' || "firstName" || ' ' || "lastName" || '|' || "crmAccountId" from "CrmUser" where email='${CHRISTA.email}'`).split('|')
  if (!christa[0]) throw new Error('WT Christa is not on the dev copy')
  made.account = christa[2]
  made.contact = psql(`insert into "CrmContact" (id, "accountId", "firstName", "lastName", phone, email, "serviceAddress", "updatedAt") values (gen_random_uuid(), '${q(made.account)}', 'E2E', '${q(NAME_LAST)}', '3525550177', 'e2e-visit-photos@example.invalid', '110 SE Watula Ave, Ocala, FL 34471', now()) returning id`).split('\n')[0]
  made.appt = `e2e-visit-photos-${Date.now().toString(36)}`
  psql(`insert into "CrmAppointment" (id, "accountId", "crmContactId", type, status, "startAt", "endAt", address, "assignedTo", "assignedToUserId", history, source, "updatedAt") values ('${made.appt}', '${q(made.account)}', '${q(made.contact)}', 'estimate', 'scheduled', now() at time zone 'utc' + interval '5 minutes', now() at time zone 'utc' + interval '65 minutes', '110 SE Watula Ave, Ocala, FL 34471', '${q(christa[1])}', '${q(christa[0])}', '[]', 'manual', now())`)
  // An older website lead's note, written before "(measured)" was dropped.
  psql(`insert into "CrmContactNote" (id, "crmContactId", "accountId", body, "isPinned", "createdBy", "createdAt", "updatedAt") values (gen_random_uuid(), '${q(made.contact)}', '${q(made.account)}', E'Website quote\\nRun 1 side 1: 281 ft (measured)\\nAsked for an on site estimate: no', false, 'Website quote (drawn by customer)', now(), now())`)
  check('setup: a test customer with a visit today for WT Christa', !!made.contact)
}

/** A copy of a saved quote for the test customer (never sent). */
async function copyQuote(src, extra = {}) {
  const got = await api(`/api/saved-quotes/${src}`)
  if (!got?.success) console.log('read refused:', COOKIE.length, JSON.stringify(got).slice(0, 200))
  const s = got?.data ?? got
  const keep = ['fenceStyle', 'runs', 'runRails', 'layout', 'pricing', 'corners', 'ends', 'walkGates', 'dblGates', 'tearOutSections', 'tearOutGates', 'adjLaborHrs', 'hasSalesman', 'priceAdjust', 'sections', 'materialCost', 'laborCost', 'tearOutCost', 'totalCOGS', 'finalPrice', 'gmPct', 'pullSheet', 'leadSource']
  const body = Object.fromEntries(keep.filter(k => s[k] !== undefined && s[k] !== null).map(k => [k, s[k]]))
  const work = s.work ? { ...s.work } : undefined
  if (work) delete work.photoOverride
  const res = await api('/api/saved-quotes', { method: 'POST', body: JSON.stringify({ ...body, ...(work ? { work } : {}), proposal: s.proposal, crmContactId: made.contact, customerId: made.contact, customerName: NAME, customerPhone: '3525550177', customerEmail: 'e2e-visit-photos@example.invalid', customerAddress: '110 SE Watula Ave, Ocala, FL 34471', status: 'DRAFT', notes: '', ...extra }) })
  if (!(res.data?.id || res.id)) console.log('copy refused:', JSON.stringify(res).slice(0, 300))
  return res.data?.id || res.id || ''
}

async function phone(browser) {
  const ctx = await browser.newContext({ ...devices['iPhone 13'] })
  const r = await ctx.request.post(`${API}/api/crm-auth/login`, { headers: { 'X-Staff-Request': '1', 'Content-Type': 'application/json' }, data: { ...CHRISTA, cookie: true } })
  if (!r.ok()) { check('phone: signed in as WT Christa', false, String(r.status())); await ctx.close(); return }
  const page = await ctx.newPage()
  const errors = watch(page)
  page.on('dialog', d => d.accept().catch(() => {}))
  await page.goto(`${APP}/today`)
  await page.waitForSelector('[data-today]', { timeout: 30000 })
  await sleep(2500)
  const row = page.locator('button', { hasText: NAME }).first()
  if (await row.count()) await row.click(); else await page.getByRole('button', { name: /Complete/ }).first().click()
  await page.waitForSelector('[data-outcome-form]', { timeout: 10000 })
  await page.locator('[data-outcome="ready_to_quote"]').click()
  await page.locator('[data-outcome-form] textarea').fill('Front gate sags, two broken posts by the drive.')
  await page.locator('[data-feet]').fill('60')
  await page.locator('[data-outcome-form] input[type=file]').setInputFiles(shots3)
  await shot(page, 'phone-1-visit-three-photos')
  await page.locator('[data-save-outcome]').click()
  // The new quote opens (its bottom bar has the camera button).
  await page.waitForSelector('[data-photos-open]', { timeout: 30000 }).catch(async e => { await shot(page, 'phone-fail-after-save'); throw e })
  await page.waitForFunction(() => Number(document.querySelector('[data-photos-open]')?.textContent?.replace(/\D/g, '') || 0) >= 3, null, { timeout: 30000 }).catch(() => {})
  const count = Number((await page.locator('[data-photos-open]').textContent().catch(() => '')).replace(/\D/g, '') || 0)
  check('phone: the new quote\'s camera button counts the 3 visit photos', count === 3, String(count))
  // A repair: Style > Repair, the style, a leaning fence with 2 posts and a gate rehang.
  const b = page.locator('[data-quote-builder]')
  await b.locator('[data-step="style"]').tap(); await sleep(400)
  await b.locator('[data-job-type-option="repair"]').tap(); await sleep(300)
  await b.locator('[data-style-list]').selectOption({ label: 'White Vinyl Privacy, 6 ft tall, 6 ft panels, No dig' }); await sleep(300)
  await b.locator('[data-what="leaning"]').tap(); await sleep(300)
  await b.locator('[data-repair-starter-add]').tap(); await sleep(200)
  await b.locator('[data-repair-item="resetPost"] button[aria-label^="One more"]').tap(); await sleep(200)
  await b.locator('[data-repair-item="rehangGate"] button[aria-label^="One more"]').tap(); await sleep(200)
  await b.locator('[data-step="yard"]').tap(); await sleep(600)
  const visit = page.locator(`[data-site-visit="${made.appt}"]`)
  await page.waitForFunction(a => document.querySelector(`[data-site-visit="${a}"] [data-site-visit-photos]`)?.getAttribute('data-site-visit-photos') === '3', made.appt, { timeout: 30000 }).catch(() => {})
  check('phone: a repair quote shows the Site visit box with its 3 photos', Number(await visit.locator('[data-site-visit-photos]').getAttribute('data-site-visit-photos').catch(() => '0')) === 3)
  check('phone: ... and says the customer sees none until they are ticked', /sees none of these photos until you tick them/.test(await visit.locator('[data-site-visit-hint]').textContent().catch(() => '')))
  await shot(page, 'phone-2-repair-site-visit')
  // Uploaded as the customer's own photos: Site walk, Internal, not tied to a quote or job.
  await page.waitForFunction(() => document.querySelectorAll('[data-quote-media] [data-media-item="uploaded"]').length >= 3, null, { timeout: 30000 }).catch(() => {})
  const rows = media()
  check('phone: on the server: 3 photos on the customer, Site walk, Internal', rows.length === 3 && rows.every(m => m.visibility === 'internal' && !m.quoteKey && !m.jobId && m.category === 'Site walk'), JSON.stringify(rows.map(m => m.visibility)))

  // The Photos sheet: "Show these to the customer", nothing ticked yet.
  await page.locator('[data-photos-open]').tap()
  await page.waitForSelector('[data-photos-sheet] [data-customer-photo-ticks] [data-photo-tick]', { timeout: 15000 }).catch(() => {})
  const sheetTicks = await page.locator('[data-photos-sheet] [data-customer-photo-ticks] [data-photo-tick]').count()
  const sheetTicked = await page.locator('[data-photos-sheet] [data-customer-photo-ticks] [data-ticked="yes"]').count()
  check('phone: the Photos sheet lists the 3 photos to tick for the customer, none ticked', sheetTicks === 3 && sheetTicked === 0, `${sheetTicks}/${sheetTicked}`)
  await shot(page, 'phone-3-photos-sheet-ticks')
  await page.locator('[data-photos-done]').tap(); await sleep(400)

  // On to the Price step: the Live quote shows the repair, and its crew time.
  for (let i = 0; i < 6 && !(await page.locator('[data-save-open]').count()); i++) { await page.locator('[data-quote-bar] [data-bar-next]').tap(); await sleep(500) }
  const live = await page.locator('[data-live-repair]').textContent().catch(() => '')
  check('phone: the Live quote lists the repair work (not "Total sections 0")', /×/.test(live) && !(await page.locator('text=Total sections').count()), live)
  const crewTime = await page.locator('[data-crew-time]').textContent().catch(() => '')
  check('phone: ... and a crew time from its man hours (not 0.0 hr)', !!crewTime && !/0\.0 hr/.test(crewTime), crewTime)
  await page.locator('[data-live-repair]').scrollIntoViewIfNeeded().catch(() => {})
  await shot(page, 'phone-4-price-live-repair')

  // Save: the saved quote's window opens with its Send box.
  await page.locator('[data-save-open]').tap()
  await page.waitForSelector('[data-save-submit]', { timeout: 10000 })
  await page.locator('[data-save-submit]').tap()
  await page.waitForSelector('[data-quote-drawer] [data-proposal-send]', { timeout: 30000 }).catch(async () => { await shot(page, 'phone-fail-after-quote-save') })
  made.quote = new URL(page.url()).searchParams.get('qv') || ''
  for (let i = 0; i < 20 && made.quote && psql(`select count(*) from "SavedQuote" where id='${q(made.quote)}' and "crmContactId"='${q(made.contact)}'`) !== '1'; i++) await sleep(500)
  check('phone: the quote is saved as a repair', psql(`select work->>'type' from "SavedQuote" where id='${q(made.quote)}'`) === 'repair')
  check('phone: after saving, the quote\'s window opens with Send (not back on Today)', await page.locator('[data-quote-drawer] [data-proposal-send]').count() === 1 && !!made.quote, page.url())
  await sleep(2500)
  const wide = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth
    const panel = document.querySelector('[data-quote-drawer] .slideover-responsive')
    const over = [...document.querySelectorAll('[data-quote-drawer] *')].filter(e => e.getBoundingClientRect().right > vw + 1).length
    return { vw, doc: document.documentElement.scrollWidth, panel: panel ? panel.scrollWidth : 0, over }
  })
  check('phone: the quote window is no wider than the phone', wide.doc <= wide.vw && wide.panel <= wide.vw && wide.over === 0, JSON.stringify(wide))
  check('phone: the quote window lists the repair items (no "Walk gates 0")', await page.locator('[data-quote-drawer] [data-quote-repair-lines] li').count() > 0 && !(await page.locator('[data-quote-drawer]').getByText('Walk gates').count()))
  // The Send box: the photos to tick; the repair's photo check counts only ticked ones.
  await page.waitForSelector('[data-send-photo-ticks] [data-photo-tick]', { timeout: 15000 }).catch(() => {})
  check('phone: the Send box shows the 3 visit photos to tick for the customer', await page.locator('[data-send-photo-ticks] [data-photo-tick]').count() === 3)
  check('phone: the photo check counts no Internal photos (blocked, Copy link off)', await page.locator('[data-photos-needed]').count() === 1 && await page.locator('[data-proposal-copy]').isDisabled())
  check('phone: the photos section does not repeat the list while the Send box shows it', await page.locator('[data-quote-photos] [data-customer-photo-ticks]').count() === 0)
  await page.locator('[data-send-photo-ticks]').scrollIntoViewIfNeeded()
  await shot(page, 'phone-5-send-box-ticks')
  // Tick two photos, one tap each; the third (the invoice) is left alone.
  const ticks = page.locator('[data-send-photo-ticks] [data-photo-tick]')
  for (let i = 0; i < 2; i++) { await ticks.nth(i).tap(); await page.waitForFunction(n => document.querySelectorAll('[data-send-photo-ticks] [data-ticked="yes"]').length >= n, i + 1, { timeout: 10000 }).catch(() => {}); await sleep(800) }
  await page.waitForFunction(() => !document.querySelector('[data-photos-needed]'), null, { timeout: 10000 }).catch(() => {})
  const after = media()
  check('phone: two taps: two photos Customer, the third (the invoice) still Internal', after.filter(m => m.visibility === 'customer').length === 2 && after.filter(m => m.visibility === 'internal').length === 1, JSON.stringify(after.map(m => m.visibility)))
  const order = await ticks.evaluateAll(els => els.map(e => e.getAttribute('data-ticked')).join(','))
  check('phone: the photos keep their places: the two tapped are the two ticked', order === 'yes,yes,no', order)
  check('phone: the check is met: Copy link is on, no "Send anyway" needed', await page.locator('[data-photos-needed]').count() === 0 && !(await page.locator('[data-proposal-copy]').isDisabled()))
  await shot(page, 'phone-6-two-ticked')
  await page.locator('[data-proposal-copy]').tap(); await sleep(1500)
  const status = psql(`select status from "SavedQuote" where id='${q(made.quote)}'`)
  check('phone: Copy link works (the quote is Sent)', status === 'SENT', status)
  check('phone: no page errors', errors.length === 0, errors.join(' | '))
  await ctx.close()
}

async function computer(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await signInByCookie(ctx, { cookie: COOKIE, token: TOKEN, email: '', password: '', api: API })
  const page = await ctx.newPage()
  const errors = watch(page)
  // Quotes list: the repair's Sections cell is its work.
  await page.goto(`${APP}/quotes`)
  await page.waitForSelector('[data-global-appointment]', { timeout: 30000 }); await sleep(1500)
  const rowSections = await page.locator('tr', { hasText: NAME }).first().locator('[data-label="Sections"]').textContent().catch(() => '')
  check('computer: the Quotes list shows the repair work, not "0"', /^Repair: .*×/.test(rowSections.trim()), rowSections)
  // The customer page's Quotes tab, and its Notes tab.
  await page.goto(`${APP}/customers/${made.contact}`)
  await page.waitForSelector('[data-customer-tab="quotes"]', { timeout: 30000 })
  await page.locator('[data-customer-tab="quotes"]').click(); await sleep(800)
  const tabSections = await page.locator('td[data-label="Sections"]').allTextContents()
  check('computer: the customer page\'s Quotes tab shows the repair work, not "0"', tabSections.some(t => /^Repair: .*×/.test(t.trim())) && !tabSections.some(t => t.trim() === '0'), JSON.stringify(tabSections))
  await shot(page, 'computer-1-customer-quotes-tab')
  await page.locator('[data-customer-tab="notes"]').click()
  await page.waitForSelector('[data-note]', { timeout: 15000 }).catch(() => {})
  const notes = (await page.locator('[data-note]').allInnerTexts().catch(() => [])).join('\n')
  check('computer: the older website note reads "281 ft" without "(measured)"', /Run 1 side 1: 281 ft/.test(notes) && !/\(measured\)/.test(notes), notes.slice(0, 160))
  await shot(page, 'computer-1b-customer-notes')
  check('computer: no page errors', errors.length === 0, errors.join(' | '))

  // The customer's repair proposal: the 2 ticked photos, no caption; the invoice is refused.
  const token = psql(`select "shareToken" from "SavedQuote" where id='${q(made.quote)}'`)
  const shown = media().filter(m => m.visibility === 'customer').map(m => m.id)
  const invoice = media().find(m => m.visibility === 'internal')
  const cp = await ctx.newPage()
  await cp.setViewportSize({ width: 412, height: 915 })
  await cp.goto(`${API}/p/${token}`); await sleep(1500)
  const srcs = await cp.locator('img[src*="/media/"]').evaluateAll(els => els.map(e => e.getAttribute('src').split('/media/')[1]))
  check('customer page: the repair proposal shows the 2 ticked photos, not the invoice', srcs.length === 2 && shown.every(id => srcs.includes(id)), JSON.stringify(srcs))
  check('customer page: the photos load', srcs.length === 2 && (await cp.locator('img[src*="/media/"]').evaluateAll(els => els.every(i => i.complete && i.naturalWidth > 0))))
  const page1 = await cp.content()
  check('customer page: no staff caption ("Ready to quote visit")', !/Ready to quote visit/.test(page1) && !/figcaption/.test(page1))
  const refused = invoice ? (await fetch(`${API}/p/${token}/media/${invoice.id}`)).status : 0
  check('customer page: the Internal invoice\'s link is refused', refused === 404, String(refused))
  if (SHOTS) await cp.screenshot({ path: path.join(SHOTS, 'visit-photos-customer-repair-proposal.png'), fullPage: true })

  // A new fence proposal for the same customer shows the ticked photos too.
  const fenceSrc = psql(`select id from "SavedQuote" where work is null and jsonb_array_length(coalesce(proposal->'options','[]'::jsonb)) > 0 and "deletedAt" is null and "archivedAt" is null order by "createdAt" desc limit 1`)
  made.fence = fenceSrc ? await copyQuote(fenceSrc) : ''
  const ft = made.fence ? (await api(`/api/saved-quotes/${made.fence}/share-token`, { method: 'POST' }))?.data?.shareToken : null
  await cp.goto(`${API}/p/${ft}`); await sleep(1500)
  const fenceSrcs = await cp.locator('img[src*="/media/"]').evaluateAll(els => els.map(e => e.getAttribute('src').split('/media/')[1]))
  check('customer page: a new fence proposal shows the ticked photos too (it showed none)', fenceSrcs.length === 2 && shown.every(id => fenceSrcs.includes(id)), JSON.stringify(fenceSrcs))
  if (SHOTS) await cp.screenshot({ path: path.join(SHOTS, 'visit-photos-customer-fence-proposal.png'), fullPage: true })

  // Sold: the job's Photos and video and the crew packet carry the visit photos.
  const job = await api('/api/saved-jobs', { method: 'POST', body: JSON.stringify({ quoteId: made.quote, crmContactId: made.contact, customerName: NAME, customerPhone: '3525550177', customerAddress: '110 SE Watula Ave, Ocala, FL 34471', fenceStyle: 'repair', quotePrice: 500, contractValue: 500, status: 'staging' }) })
  made.job = job?.data?.id || ''
  const onJob = new Set(((await api(`/api/media?jobId=${made.job}`))?.data ?? []).map(m => m.id))
  check('job: its Photos and video list the quote\'s 3 visit photos', media().every(m => onJob.has(m.id)), `${onJob.size}`)
  await page.goto(`${APP}/operations?job=${made.job}`); await sleep(3000)
  const gallery = await page.locator('[data-media-gallery]').first().innerText().catch(() => '')
  check('job page: "Photos and video (3)"', /Photos and video \(3\)/.test(gallery), gallery.split('\n')[0])
  const milestone = await page.locator('[data-milestone="photos"]').getAttribute('data-milestone-done').catch(() => null)
  check('job page: Photos Uploaded is not ticked by the quote\'s photos', milestone !== 'true' && milestone !== 'yes', String(milestone))
  await shot(page, 'computer-2-job-photos')
  const pk = `e2evp${crypto.randomBytes(12).toString('hex')}`
  made.packet = psql(`insert into "InstallPacket" (id, "accountId", "jobId", token, snapshot, "sentAt", "createdAt", "updatedAt") values (gen_random_uuid(), '${q(made.account)}', '${q(made.job)}', '${pk}', '{"companyName":"Getter Done Fence"}', now(), now(), now()) returning id`).split('\n')[0]
  await cp.goto(`${API}/p/i/${pk}`); await sleep(1500)
  const packetImgs = await cp.locator('.media img').count()
  const packetHtml = await cp.content()
  check('crew packet: only the visit photos shared with the customer show, never an Internal one', packetImgs === 2, String(packetImgs))
  check('crew packet: no price on it', !/\$\s?\d/.test(packetHtml.replace(/<script[\s\S]*?<\/script>/g, '')))
  if (SHOTS) await cp.screenshot({ path: path.join(SHOTS, 'visit-photos-crew-packet.png'), fullPage: true })
  await ctx.close()
}

async function cleanup() {
  try {
    if (made.contact) {
      for (const f of psql(`select path || E'\\n' || coalesce("thumbPath",'') || E'\\n' || coalesce("markupPath",'') from "MediaItem" where "customerId"='${q(made.contact)}'`).split('\n').filter(Boolean)) if (f.includes(`${path.sep}media${path.sep}`) && fs.existsSync(f)) fs.rmSync(f, { force: true })
      psql(`delete from "MediaItem" where "customerId"='${q(made.contact)}'; delete from "MediaUpload" where meta->>'customerId'='${q(made.contact)}'`)
      psql(`delete from "CrmAppointment" where "crmContactId"='${q(made.contact)}'`)
      if (made.job) {
        psql(`delete from "InstallPacket" where "jobId"='${q(made.job)}'; delete from "ActivityLog" where "entityId"='${q(made.job)}'`)
        for (const t of ['ContractPayment', 'ContractInvoice', 'PaymentSchedule', 'BillingLog', 'ScheduledGridJob', 'Permit', 'Walkthrough']) psql(`delete from "${t}" where "${t === 'ScheduledGridJob' ? 'stagingJobId' : 'jobId'}"='${q(made.job)}'`)
        psql(`delete from "SavedJob" where id='${q(made.job)}'`)
      }
      psql(`delete from "ProposalView" where "quoteId" in (select id from "SavedQuote" where "crmContactId"='${q(made.contact)}')`)
      psql(`delete from "SavedQuote" where "crmContactId"='${q(made.contact)}'`)
      // The pipeline card the visit made or moved (cards live in the board's list).
      const pipe = await api('/api/pipeline')
      const card = (pipe.data?.leads ?? []).filter(l => l.customerId === made.contact || l.crmContactId === made.contact).map(l => l.id)
      if (card.length) {
        await api('/api/pipeline', { method: 'PATCH', body: JSON.stringify({ upsert: [], remove: card, baseVersion: pipe.data.version }) })
        psql(`delete from "AutomationEvent" where "entityId" in (${card.map(c => `'${q(c)}'`).join(',')}); delete from "CardFollowUp" where "cardId" in (${card.map(c => `'${q(c)}'`).join(',')})`)
      }
      psql(`delete from "AutomationEvent" where "entityId"='${q(made.contact)}'${made.job ? ` or "entityId"='${q(made.job)}'` : ''}; delete from "CrmContactNote" where "crmContactId"='${q(made.contact)}'; delete from "CustomerPossibleMatch" where "contactId"='${q(made.contact)}'`)
      psql(`delete from "CrmContact" where id='${q(made.contact)}'`)
    }
    fs.rmSync(tmp, { recursive: true, force: true })
    check('test records removed', !made.contact || psql(`select count(*) from "CrmContact" where id='${q(made.contact)}'`) === '0')
  } catch (e) { check('test records removed', false, String(e?.message || e).slice(0, 200)) }
}

const wk = await webkit.launch()
const ch = await chromium.launch()
try {
  await setup()
  await phone(wk)
  await computer(ch)
} catch (e) {
  check('test run finished', false, String(e?.message || e).split('\n').slice(0, 3).join(' '))
} finally {
  await cleanup()
  await wk.close(); await ch.close()
}
const failed = results.filter(r => !r).length
console.log(`\n${failed ? `${results.length - failed} passed, ${failed} failed` : `${results.length} passed`}`)
process.exit(failed ? 1 : 0)
