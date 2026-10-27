// Warranty and service requests on a phone (ServiceRequests.tsx; server
// routes/serviceTickets.ts, routes/servicePhotosPublic.ts). Jonathan's test list:
//
//   1. Find a past customer from search: "Past customer · Lifetime Craftsmanship
//      Warranty · installed Jun 15, 2026" on the result and on their page.
//   2. Warranty / Service request: the warranty and its words, Leaning post is
//      "Likely covered"; the ticket opens at New.
//   3. Ask for photos: their texting answer (No, with the warning, not blocked),
//      the text opens in the phone's own texting app (an sms: link) with the
//      words and the no login link; the ticket at Photos requested.
//   4. The link in a fresh browser with no login: a photo sent; the ticket at
//      Photos received with the photo (Internal), and the bell for Jonathan and
//      the customer's card owner (the Salesman named on the card).
//   5. Covered, with a reason shown to the customer; the crew packet's $0 work order.
//   6. The visit booked (a Service appointment): Scheduled; the schedule shows it.
//   7. Fixed with crew hours and a part (costed); Closed.
//   8. Not covered from the card window: Make repair quote opens the quote
//      builder in repair mode with the customer; the repair quote shows on the ticket.
//   9. The job page, the Service list, Today, Follow ups and Reports → Service;
//      a second browser sees the same.
//
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 E2E_ACCESS_TOKEN=<owner> MEDIA_PHOTO=<a.jpg> node e2e/service-requests.mjs
//   On the Android emulator's Chrome: adb reverse tcp:4001 tcp:4001;
//   adb forward tcp:9333 localabstract:chrome_devtools_remote; CDP_URL=http://localhost:9333 node e2e/service-requests.mjs
//
// Everything it makes is removed at the end. Dev copy only.
import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import './sharedLock.mjs' // makes customers, quotes, jobs, tickets and appointments on the shared dev copy
import { webkit, chromium } from 'playwright'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'


const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || 'http://localhost:4001'
const OWNER = process.env.E2E_ACCESS_TOKEN || ''
const CDP = process.env.CDP_URL || ''
const PHOTO = process.env.MEDIA_PHOTO || ''
const SHOTS = process.env.E2E_SHOTS || ''
const NAME = CDP ? 'android' : 'webkit'
// The dev copy (4001), or a worktree's own dev server on another local port; never live (4000).
if (!/^http:\/\/localhost:\d+$/.test(APP) || !/^http:\/\/localhost:\d+$/.test(API) || /:4000$/.test(APP) || /:4000$/.test(API)) { console.error('Refusing to run: the dev copy only (localhost, not 4000).'); process.exit(2) }
if (!OWNER) { console.error('Set E2E_ACCESS_TOKEN (an owner login on the dev server).'); process.exit(2) }
if (!PHOTO || !fs.existsSync(PHOTO)) { console.error('Set MEDIA_PHOTO (a JPEG to send from the photo link).'); process.exit(2) }
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const call = async (method, p, body, token = OWNER) => {
  const r = await fetch(`${API}${p}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: r.status, json: await r.json().catch(() => ({})) }
}
async function until(fn, ms = 30000, every = 500) { const end = Date.now() + ms; for (;;) { const v = await fn().catch(() => null); if (v || Date.now() > end) return v; await sleep(every) } }
const sql = q => execFileSync('psql', ['-d', 'ezbiz_dev', '-At', '-c', q]).toString().trim()
const uuid = s => /^[0-9a-f-]{36}$/i.test(s)
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `dev-service-${NAME}-${name}.png`) }).catch(() => {}) }

const stamp = Date.now().toString(36).slice(-6)
const WHO = `Service ${NAME} ${stamp}`
const PHONE = '3525550159'
const contactId = crypto.randomUUID(), cardId = crypto.randomUUID(), quoteId = crypto.randomUUID(), repId = crypto.randomUUID()
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
let jobId = null, ticketId = null, notId = null, repairId = null

const browser = CDP ? await chromium.connectOverCDP(CDP) : await webkit.launch()
const desk = await chromium.launch()
try {
  // ── Setup: a customer with a card, a quote sold, its job, installed Jun 15, 2026 (vinyl no dig: Lifetime) ──
  // The card's owner: a throwaway Salesman login, named on the card by its full name (the card keeps a name only).
  const accountOf = JSON.parse(Buffer.from(OWNER.split('.')[1], 'base64url').toString()).crmAccountId
  if (!uuid(repId) || !/^[0-9a-z-]+$/i.test(String(accountOf))) throw new Error('bad ids')
  sql(`INSERT INTO "CrmUser" (id, email, "firstName", "lastName", role, status, "crmAccountId", "updatedAt") VALUES ('${repId}', 'e2e-card-owner-${stamp}@example.invalid', 'E2E', 'Card ${stamp}', 'sales_rep', 'active', '${accountOf}', now())`)
  const c = await call('POST', '/api/crm-contacts', { id: contactId, firstName: 'E2E', lastName: WHO, phone: PHONE, serviceAddress: '9 Warranty Ln, Ocala, FL 34470', leadSource: 'Other', lead: { id: cardId, customerId: contactId, firstName: 'E2E', lastName: WHO, phone: PHONE, stage: 'Signed Contract', leadSource: 'Other', quoteId, createdAt: today, lastMoved: today, assignedRep: `E2E Card ${stamp}` }, leadBefore: null })
  const q = await call('POST', '/api/saved-quotes', {
    id: quoteId, crmContactId: contactId, customerName: `E2E ${WHO}`, customerPhone: PHONE, customerAddress: '9 Warranty Ln, Ocala, FL 34470',
    fenceStyle: "WV-ND 6'x8' Privacy", runs: [120], sections: 15, ends: 2, walkGates: 1, materialCost: 3000, laborCost: 1500, totalCOGS: 4500, finalPrice: 6800, gmPct: 0.34,
    pullSheet: [], status: 'SENT', date: today, salesRep: 'E2E Salesman', leadSource: 'Other',
    proposal: { version: 1, customer: { name: `E2E ${WHO}`, address: '9 Warranty Ln, Ocala, FL 34470' }, company: { name: 'Getter Done Fence', phone: '3527894314', email: '' }, footageFt: 120, gatesText: '1 walk gate', included: [], depositPct: 50,
      options: [{ label: 'White vinyl privacy', fenceStyle: "WV-ND 6'x8' Privacy", finalPrice: 6800, perFoot: 56.67, sections: 15, snapshot: { materialCost: 3000, laborCost: 1500, tearOutCost: 0, totalCOGS: 4500, gmPct: 0.34, pullSheet: [], runSections: [15] } }] },
  })
  const sold = await call('PATCH', `/api/saved-quotes/${quoteId}`, { status: 'SOLD' })
  const j = await call('POST', '/api/saved-jobs', { quoteId, crmContactId: contactId, customerName: `E2E ${WHO}`, customerPhone: PHONE, customerAddress: '9 Warranty Ln, Ocala, FL 34470', fenceStyle: "WV-ND 6'x8' Privacy", quotePrice: 6800, contractValue: 6800, status: 'staging', sections: 15 })
  jobId = j.json.data?.id ?? null
  if (!jobId || !/^[A-Za-z0-9-]+$/.test(jobId)) throw new Error('no job')
  // Installed long ago (the app marks this through its stages; here, straight on the dev database).
  sql(`UPDATE "SavedJob" SET status = 'paid', "completedDate" = '2026-06-15', "crewAssigned" = 'E2E Crew', "updatedAt" = now() WHERE id = '${jobId}'`)
  const consent = await call('POST', `/api/crm-contacts/${contactId}/text-consent`, { consent: 'no' })
  check('setup: customer, card, quote sold, job installed Jun 15, texts: No', c.status < 300 && q.status < 300 && sold.status < 300 && consent.status < 300, `${c.status} ${q.status} ${sold.status} ${consent.status}`)

  // ── The phone ──
  const ctx = CDP ? browser.contexts()[0] : await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: false })
  const setToken = t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }
  if (CDP) { const p0 = await ctx.newPage(); await p0.goto(APP); await p0.evaluate(setToken, OWNER); await p0.close() }
  else await ctx.addInitScript(setToken, OWNER)
  // A text hands off to the phone's texting app: record the link and stay.
  await ctx.addInitScript(() => {
    window.__sms = []
    window.addEventListener('click', e => { const a = e.target instanceof Element ? e.target.closest('a[href^="sms:"]') : null; if (a) { window.__sms.push(a.getAttribute('href')); e.preventDefault() } }, true)
  })
  const errors = []
  let page
  const openPage = async () => {
    if (page) await page.close().catch(() => {})
    page = await ctx.newPage()
    globalThis.__page = page
    page.on('pageerror', e => errors.push(String(e).slice(0, 200)))
    page.on('dialog', d => d.accept().catch(() => {}))
    return page
  }
  const tap = async loc => { await loc.scrollIntoViewIfNeeded(); await loc.waitFor({ state: 'visible', timeout: 20000 }); await (CDP ? loc.click() : loc.tap()); await sleep(250) }
  // Type, then put the phone's keyboard away (the page moves while it closes).
  const type = async (loc, v) => { await loc.fill(v); if (CDP) { await page.evaluate(() => document.activeElement?.blur()); await sleep(600) } }
  const W = () => page.locator('[data-ticket-window]')
  const stageOf = async () => W().getAttribute('data-stage')

  // 1. Find the past customer from search.
  await openPage()
  await page.goto(`${APP}/today`)
  await tap(page.locator('[data-header-search]'))
  await page.locator('[data-global-search] input').fill(`E2E ${WHO}`)
  const badgeLine = page.locator('[data-global-search] [data-search-past-customer]').first()
  await badgeLine.waitFor({ timeout: 20000 }).catch(() => {})
  const want = 'Past customer · Lifetime Craftsmanship Warranty · installed Jun 15, 2026'
  check('search: the result says past customer, the warranty and the install date', (await badgeLine.textContent().catch(() => '')) === want, await badgeLine.textContent().catch(() => 'none'))
  await tap(page.locator('[data-global-search] [role="option"] button').first())
  await page.waitForURL(u => u.pathname === `/customers/${contactId}`, { timeout: 20000 }).catch(() => {})
  const pageBadge = page.locator('[data-customer-detail] [data-past-customer]').first()
  check('customer page: the past customer badge at the top', (await pageBadge.textContent({ timeout: 15000 }).catch(() => '')) === want)
  await shot(page, '1-customer')

  // 2. The request (the customer's Jobs tab).
  await tap(page.locator('[data-customer-tab="jobs"]'))
  await tap(page.locator('[data-customer-service] [data-service-request-button]'))
  const form = page.locator('[data-service-request-form]')
  await form.waitFor({ timeout: 15000 })
  check('request form: the job\'s warranty', (await form.locator('[data-request-warranty-name]').textContent({ timeout: 15000 })) === 'Lifetime Craftsmanship Warranty')
  await tap(form.locator('[data-request-warranty-toggle]'))
  check('request form: the warranty words (high winds covered; not falling trees)', /high winds[\s\S]*Not covered: falling trees/.test(await form.locator('[data-request-warranty-text]').textContent() || ''))
  await tap(form.locator('[data-issue="leaning_post"]'))
  check('Leaning post: Likely covered', await form.locator('[data-hint="likely_covered"]').isVisible())
  await tap(form.locator('[data-issue="storm_tree"]'))
  check('Storm or tree damage: Needs a look', await form.locator('[data-hint="needs_look"]').isVisible())
  await tap(form.locator('[data-issue="leaning_post"]'))
  await type(form.locator('[data-request-notes]'), 'Two posts by the back gate lean')
  await shot(page, '2-form')
  await tap(form.locator('[data-request-save]'))
  await W().waitFor({ timeout: 20000 })
  ticketId = await W().getAttribute('data-ticket-window')
  check('the ticket opens at New', uuid(ticketId || '') && await stageOf() === 'new', `${ticketId} ${await stageOf()}`)

  // 3. Ask for photos.
  check('Photos: the texting answer (No) and the warning, not blocked', await W().locator('[data-ticket-consent="no"]').isVisible() && await W().locator('[data-ticket-consent-warning]').isVisible() && await W().locator('[data-ask-photos]').isEnabled())
  await tap(W().locator('[data-ask-photos]'))
  await until(async () => (await stageOf()) === 'photos_requested', 15000)
  const sms = await until(async () => (await page.evaluate(() => window.__sms))[0], 10000)
  const link = await W().locator('[data-ticket-link-url]').getAttribute('href')
  const body = sms ? decodeURIComponent(sms.split('?body=')[1] || '') : ''
  check('the texting app opens with the words and the link', !!sms && sms.startsWith(`sms:${PHONE}?body=`) && body === `Getter Done Fence: Hi E2E, sorry to hear about the issue with your fence. Please send us a few photos here so we can take a look: ${link}. Reply STOP to opt out.`, body)
  check('the link is on the public door, /p/s/<link>, open 14 days', /\/p\/s\/[A-Za-z0-9_-]{32}$/.test(link || '') && /Open until/.test(await W().locator('[data-ticket-link]').textContent() || ''), link)
  await shot(page, '3-asked')

  // 4. The customer: the link in a fresh browser, no login.
  const fresh = CDP ? await desk.newContext({ viewport: { width: 393, height: 851 }, isMobile: true, hasTouch: true }) : await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true })
  const cust = await fresh.newPage()
  const resp = await cust.goto(link)
  check('the photo page opens with no login', resp?.status() === 200 && /Hi E2E, show us your fence/.test(await cust.locator('h1').textContent() || ''))
  const noLogin = await cust.evaluate(async () => (await fetch('/api/service-tickets')).status)
  check('that browser has no login (the staff API refuses it)', noLogin === 401, String(noLogin))
  await cust.locator('#files').setInputFiles(PHOTO)
  check('the photo sends', !!(await until(async () => /Thank you! 1 sent/.test(await cust.locator('#msg').textContent() || ''), 30000)), await cust.locator('#msg').textContent())
  if (SHOTS) await cust.screenshot({ path: path.join(SHOTS, `dev-service-${NAME}-4-upload.png`) }).catch(() => {})
  await fresh.close()
  await page.reload()
  await W().waitFor({ timeout: 20000 })
  check('the ticket: Photos received, with the photo', await until(async () => (await stageOf()) === 'photos_received' && await W().locator('[data-ticket-photos="1"]').isVisible(), 20000))
  check('the photo is Internal, from the customer, on the job too', sql(`SELECT visibility || '/' || source || '/' || "jobId" FROM "MediaItem" WHERE "serviceTicketId" = '${ticketId}'`) === `internal/customer/${jobId}`)
  const told = sql(`SELECT string_agg("recipientId", ',' ORDER BY "recipientId") FROM "Notification" WHERE link = '/service?ticket=${ticketId}'`).split(',')
  const ownerEmail = sql(`SELECT email FROM "CrmUser" WHERE "crmAccountId" = '${accountOf}' AND role = 'super_admin' ORDER BY "createdAt" LIMIT 1`)
  check('Jonathan and the customer\'s card owner are told, once each (bell; the push in the dev copy is logged, not sent)', told.length === 2 && told.includes(ownerEmail) && told.includes(`e2e-card-owner-${stamp}@example.invalid`), told.join(' '))
  check('the push went to both logins', sql(`SELECT result->>'to' FROM "AutomationEffect" WHERE key LIKE 'service-photos:${ticketId}:%'`).includes(repId))

  // 5. Covered, shared with the customer; the crew packet.
  await tap(W().locator('[data-decide="covered"]'))
  await type(W().locator('[data-decision-reason]'), 'Posts leaned in high winds: install failure')
  await tap(W().locator('[data-decision-shared]'))
  await tap(W().locator('[data-decision-save]'))
  check('decided: Covered, with the reason, shown to the customer', !!(await until(async () => (await W().locator('[data-ticket-decision]').getAttribute('data-ticket-decision')) === 'covered', 15000)) && /Shown to the customer/.test(await W().locator('[data-ticket-decision]').textContent() || ''))
  const send = W().locator('[data-ticket-packet-send]')
  if (await send.isVisible({ timeout: 5000 }).catch(() => false)) await tap(send)
  const packetLink = await until(async () => W().locator('[data-ticket-packet-link]').getAttribute('href'), 20000)
  const packetHtml = packetLink ? await (await fetch(packetLink)).text() : ''
  check('the crew packet shows the no charge work order', packetHtml.includes('Warranty work order: no charge to the customer') && packetHtml.includes(`data-packet-warranty-work="${ticketId}"`))
  await shot(page, '5-covered')

  // 6. Book the visit (a Service appointment).
  await tap(W().locator('[data-ticket-book]'))
  const dlg = page.locator('[data-booking-dialog]')
  await dlg.waitFor({ timeout: 15000 })
  await tap(dlg.locator('[data-field="time"]'))
  const slot = dlg.locator('[data-grid-time][data-ok="1"]').first()
  await tap((await slot.count()) ? slot : dlg.locator('[data-grid-time]').first())
  await tap(dlg.locator('[data-save]'))
  await dlg.locator('[data-booked]').waitFor({ timeout: 20000 })
  await tap(dlg.getByRole('button', { name: 'Done' }))
  const visit = await until(async () => { const v = await W().locator('[data-ticket-visit]').getAttribute('data-ticket-visit'); return v && v !== 'none' ? v : null }, 20000)
  check('the visit booked: Scheduled, a Service appointment on the job', !!visit && await stageOf() === 'scheduled' && sql(`SELECT type || '/' || coalesce("jobId", '') FROM "CrmAppointment" WHERE id = '${visit}'`) === `service/${jobId}`)
  const visitDay = sql(`SELECT to_char("startAt" AT TIME ZONE 'America/New_York', 'YYYY-MM-DD') FROM "CrmAppointment" WHERE id = '${visit}'`)
  await openPage()
  await page.goto(`${APP}/schedule`)
  const day = page.locator('[data-schedule-day]').first()
  await day.waitFor({ timeout: 20000 })
  for (let i = 0; i < 10 && (await day.getAttribute('data-schedule-day')) !== visitDay; i++) await tap(day.getByRole('button', { name: 'Next day' }))
  check('the schedule shows the visit with its request', !!(await until(async () => page.locator(`[data-day-service-ticket="${ticketId}"]`).isVisible(), 20000)), visitDay)
  await shot(page, '6-schedule')

  // 7. Fixed (costed), then Closed.
  await openPage()
  await page.goto(`${APP}/service?ticket=${ticketId}`)
  await W().waitFor({ timeout: 20000 })
  await tap(W().locator('[data-ticket-fixed]'))
  await type(W().locator('[data-fixed-crew-hours="0"]'), '2')
  await type(W().locator('[data-fixed-part="0"]'), 'E2E post cap')
  await type(W().locator('[data-fixed-qty="0"]'), '2')
  await type(W().locator('[data-fixed-unit="0"]'), '3.50')
  await tap(W().locator('[data-fixed-save]'))
  await until(async () => (await stageOf()) === 'fixed', 15000)
  const t1 = (await call('GET', `/api/service-tickets/${ticketId}`)).json.data
  check('Fixed: covered work costed (2 hours at the hourly rate + 2 × $3.50)', t1?.stage === 'fixed' && t1.cost?.hours === 2 && t1.cost.laborCents === 2 * t1.cost.hourlyCostCents && t1.cost.materialCents === 700 && t1.cost.totalCents === t1.cost.laborCents + 700 && await W().locator('[data-ticket-cost]').isVisible(), JSON.stringify(t1?.cost ?? null).slice(0, 200))
  check('Fixed: off the crew packet', !(await (await fetch(packetLink)).text()).includes('Warranty work order'))
  await tap(W().locator('[data-ticket-close]'))
  check('Closed', !!(await until(async () => (await stageOf()) === 'closed', 15000)))
  await shot(page, '7-closed')

  // 8. Not covered, from the card window: a repair quote.
  await openPage()
  await page.goto(`${APP}/pipeline?card=${cardId}`)
  await page.locator(`[data-card-window="${cardId}"]`).waitFor({ timeout: 25000 })
  check('card window: the past customer badge', (await page.locator(`[data-card-window="${cardId}"] [data-past-customer]`).textContent({ timeout: 15000 }).catch(() => '')) === want)
  await tap(page.locator('[data-card-service] [data-service-request-button]'))
  const form2 = page.locator('[data-service-request-form]')
  await form2.waitFor({ timeout: 15000 })
  await tap(form2.locator('[data-issue="storm_tree"]'))
  await type(form2.locator('[data-request-notes]'), 'A neighbor\'s oak fell on two sections')
  await tap(form2.locator('[data-request-save]'))
  await W().waitFor({ timeout: 20000 })
  notId = await W().getAttribute('data-ticket-window')
  await tap(W().locator('[data-decide="not_covered"]'))
  await type(W().locator('[data-decision-reason]'), 'A falling tree is not covered')
  await tap(W().locator('[data-decision-save]'))
  await until(async () => (await W().locator('[data-ticket-decision]').getAttribute('data-ticket-decision')) === 'not_covered', 15000)
  await tap(W().locator('[data-make-repair-quote]'))
  const qb = page.locator('[data-quote-builder]')
  await qb.waitFor({ timeout: 20000 })
  check('Make repair quote: the quote builder in repair mode (the Repair price list)', !!(await until(async () => /Repair · /.test(await qb.innerText()), 10000)))
  check('… with the customer set', (await qb.locator('input').evaluateAll(els => els.map(e => e.value).join('|'))).includes(`E2E ${WHO}`))
  await shot(page, '8-repair-quote')
  await tap(qb.locator('[data-quote-close]'))
  await qb.waitFor({ state: 'detached', timeout: 10000 }).catch(() => {})
  // The repair quote saved for the customer: the ticket shows it.
  repairId = crypto.randomUUID()
  await call('POST', '/api/saved-quotes', { id: repairId, crmContactId: contactId, customerName: `E2E ${WHO}`, customerPhone: PHONE, customerAddress: '9 Warranty Ln, Ocala, FL 34470', fenceStyle: "WV-ND 6'x8' Privacy", runs: [], sections: 2, finalPrice: 640, materialCost: 200, laborCost: 150, totalCOGS: 350, gmPct: 0.45, pullSheet: [], status: 'DRAFT', date: today, work: { version: 1, type: 'repair', repair: { what: 'storm', items: {}, newPostCaps: false, gateKind: 'walk' } } })
  await openPage()
  await page.goto(`${APP}/service?ticket=${notId}`)
  check('the ticket shows its repair quote', !!(await until(async () => /\$640/.test(await page.locator('[data-ticket-repair-quote]').textContent() || ''), 20000)))

  // 9. Where tickets show.
  await openPage()
  await page.goto(`${APP}/operations?job=${jobId}`)
  check('job page: both requests', !!(await until(async () => (await page.locator('[data-job-service] [data-service-ticket]').count()) === 2, 25000)))
  await openPage()
  await page.goto(`${APP}/service`)
  check('Service list: the open request (the closed one under All)', !!(await until(async () => page.locator(`[data-service-page] [data-service-ticket="${notId}"]`).isVisible(), 20000)) && !(await page.locator(`[data-service-ticket="${ticketId}"]`).isVisible()))
  await page.locator('[data-service-filter]').selectOption('all')
  check('Service list, All: the closed one too', !!(await until(async () => page.locator(`[data-service-group="closed"] [data-service-ticket="${ticketId}"]`).isVisible(), 20000)))
  await openPage()
  await page.goto(`${APP}/today`)
  check('Today: the new request needs someone', !!(await until(async () => page.locator(`[data-service-needs] [data-service-ticket="${notId}"]`).isVisible(), 20000)))
  await openPage()
  await page.goto(`${APP}/follow-ups`)
  check('Follow ups: the same', !!(await until(async () => page.locator(`[data-service-needs] [data-service-ticket="${notId}"]`).isVisible(), 20000)))
  await openPage()
  await page.goto(`${APP}/reports`)
  await tap(page.locator('[data-report-tab="service"]'))
  const kpi = page.locator('[data-service-kpi="tickets"]')
  check('Reports → Service: the requests and covered work\'s cost', !!(await until(async () => Number((await kpi.locator('p').nth(1).textContent()) || 0) >= 2, 20000)) && /\$/.test(await page.locator('[data-service-kpi="cost"]').textContent() || ''))
  await shot(page, '9-report')

  // A second browser (desktop, signed in fresh) sees the same after loading.
  const other = await desk.newContext({ viewport: { width: 1280, height: 900 } })
  await other.addInitScript(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, OWNER)
  const p2 = await other.newPage()
  await p2.goto(`${APP}/customers/${contactId}?tab=jobs`)
  check('second browser: the badge and both requests on the customer page', !!(await until(async () => (await p2.locator('[data-customer-service] [data-service-ticket]').count()) === 2 && (await p2.locator('[data-customer-detail] [data-past-customer]').first().textContent()) === want, 25000)))
  await other.close()
  check('no page errors', errors.length === 0, errors.join(' | '))
  if (!CDP) await ctx.close(); else await page.close()
} catch (e) {
  const seen = await globalThis.__page?.evaluate(() => document.body.innerText.slice(0, 600)).catch(() => '') ?? ''
  if (globalThis.__page) await shot(globalThis.__page, 'fail')
  check('ran to the end', false, `${String(e?.message || e).slice(0, 300)} | on screen: ${seen.replace(/\s+/g, ' ').slice(0, 400)}`)
} finally {
  await browser.close().catch(() => {})
  await desk.close()
  // Remove what this made. Dev database only, named on every command.
  try {
    if (![contactId, cardId, quoteId].every(uuid) || (jobId && !/^[A-Za-z0-9-]+$/.test(jobId))) throw new Error('bad id')
    const jl = jobId ? `'${jobId}'` : "'-'"
    const tickets = sql(`SELECT id FROM "ServiceTicket" WHERE "jobId" = ${jl} OR "crmContactId" = '${contactId}'`).split('\n').filter(uuid)
    const tl = tickets.length ? tickets.map(t => `'${t}'`).join(',') : "'-'"
    for (const f of sql(`SELECT path FROM "MediaItem" WHERE "serviceTicketId" IN (${tl}) OR "jobId" = ${jl} OR "customerId" = '${contactId}'`).split('\n').filter(Boolean)) fs.rmSync(f, { force: true })
    sql(`DELETE FROM "MediaItem" WHERE "serviceTicketId" IN (${tl}) OR "jobId" = ${jl} OR "customerId" = '${contactId}'`)
    sql(`DELETE FROM "Notification" WHERE link IN (${tickets.map(t => `'/service?ticket=${t}'`).join(',') || "'-'"})`)
    for (const t of tickets) sql(`DELETE FROM "AutomationEffect" WHERE key LIKE 'service-photos:${t}:%'`)
    sql(`DELETE FROM "ServiceWorkCost" WHERE "ticketId" IN (${tl})`)
    sql(`DELETE FROM "CrmAuditLog" WHERE "entityId" IN (${tl}, ${jl}, '${quoteId}', '${contactId}'${repairId ? `, '${repairId}'` : ''})`)
    sql(`DELETE FROM "ServiceTicket" WHERE id IN (${tl})`)
    sql(`DELETE FROM "InstallPacket" WHERE "jobId" = ${jl}`)
    sql(`DELETE FROM "CrmAppointment" WHERE "crmContactId" = '${contactId}'`)
    sql(`DELETE FROM "JobQuotedCost" WHERE "quoteId" = '${quoteId}'`)
    sql(`DELETE FROM "AutomationEvent" WHERE "entityId" IN (${jl}, '${quoteId}', '${cardId}', '${contactId}')`)
    sql(`DELETE FROM "JobChecklistItem" WHERE "jobId" = ${jl}`)
    sql(`DELETE FROM "SavedJob" WHERE id = ${jl}`)
    sql(`DELETE FROM "ProposalView" WHERE "quoteId" IN (SELECT id FROM "SavedQuote" WHERE "crmContactId" = '${contactId}')`)
    sql(`DELETE FROM "SavedQuote" WHERE "crmContactId" = '${contactId}' OR id = '${quoteId}'`)
    const pl = (await call('GET', '/api/pipeline')).json
    const mine = (pl?.data?.leads ?? []).filter(l => l.customerId === contactId || l.id === cardId).map(l => l.id)
    if (mine.length) await call('PATCH', '/api/pipeline', { upsert: [], remove: mine, baseVersion: pl.data.version })
    await call('DELETE', `/api/crm-contacts/${contactId}`)
    sql(`DELETE FROM "CrmContact" WHERE id = '${contactId}'`)
    if (uuid(repId)) sql(`DELETE FROM "CrmUser" WHERE id = '${repId}' AND email LIKE 'e2e-card-owner-%@example.invalid'`)
    await call('DELETE', '/api/follow-ups/pending').catch(() => {})
    check('cleaned up (tickets, photos, costs, visits, packet, quotes, job, customer, card)', sql(`SELECT count(*) FROM "ServiceTicket" WHERE id IN (${tl})`) === '0' && sql(`SELECT count(*) FROM "SavedJob" WHERE id = ${jl}`) === '0' && sql(`SELECT count(*) FROM "CrmContact" WHERE id = '${contactId}'`) === '0' && sql(`SELECT count(*) FROM "CrmAppointment" WHERE "crmContactId" = '${contactId}'`) === '0')
  } catch (e) { check('cleaned up', false, String(e?.message || e).slice(0, 200)) }
}
const passed = results.filter(Boolean).length
console.log(`\n${passed} of ${results.length} checks passed`)
process.exit(passed === results.length ? 0 : 1)
