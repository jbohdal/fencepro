// One source of truth on the job page (walkthrough round 1, Oct 25 2026), on
// a computer (Chrome, 1440) and a phone (WebKit, iPhone size):
//
//   1. A sold job with its payment schedule: the job page's Financial says the
//      deposit is due (never "Not invoiced yet"), the same as Payments and the
//      customer's Billing.
//   2. The phone shows "(352) 555 0171", taps to call and to text; "Open
//      customer profile" opens the customer's page.
//   3. 811: the job says Not called; the office adds the ticket on the job
//      page (phone): Clear to dig; the Locate Complete milestone follows it
//      (no tick box); the crew packet shows the same ticket and dates; the
//      crew changes the expiration on the packet and the job page (computer,
//      a second browser) shows it. A ticket running out within 3 days of the
//      install is warned on the job.
//   4. Milestones: Permit Approved follows the Permit (no tick box); Photos
//      Uploaded ticked by hand shows "Ticked by hand".
//   5. The Complete stage button on the job page moves the job (job B).
//   6. Close out (job A): walkthrough signed, then the final payment: the job
//      is Complete and then Paid by itself, its card is in Paid & Closed, and
//      the customer page says "Job: Paid".
//
//   APP_URL=http://localhost:4022 API_URL=http://localhost:4022 E2E_ACCESS_TOKEN=<dev owner> E2E_STAFF_COOKIE=<cookie> SHOTS=<folder> node e2e/job-truth.mjs
//
// Dev copy only (never port 4000). Everything made is removed at the end.
import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import './sharedLock.mjs' // makes customers, quotes and jobs on the shared dev copy
import { chromium, webkit } from 'playwright'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'
import { signInByCookie } from './lib.mjs'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || APP
const TOKEN = process.env.E2E_ACCESS_TOKEN || ''
const SHOTS = process.env.SHOTS || ''
if (!/^http:\/\/localhost:\d+$/.test(APP) || /:4000$/.test(APP) || /:4000$/.test(API)) { console.error('Refusing to run: the dev copy only (localhost, not 4000).'); process.exit(2) }
if (!TOKEN) { console.error('Set E2E_ACCESS_TOKEN (an owner login on the dev server).'); process.exit(2) }
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const call = async (method, p, body) => {
  const r = await fetch(`${API}${p}`, { method, headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: r.status, json: await r.json().catch(() => ({})) }
}
const sql = q => execFileSync('psql', ['-d', 'ezbiz_dev', '-At', '-c', q]).toString().trim()
const lit = s => `'${String(s).replace(/'/g, "''")}'`
async function until(fn, ms = 20000, every = 400) { const end = Date.now() + ms; for (;;) { const v = await fn().catch(() => null); if (v || Date.now() > end) return v; await sleep(every) } }
let shotN = 0
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${String(++shotN).padStart(2, '0')}-${name}.png`), fullPage: false }).catch(() => {}) }

const stamp = Date.now().toString(36).slice(-6)
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
const plus = (d, n) => { const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10) }
const W = {
  a: { contactId: crypto.randomUUID(), cardId: crypto.randomUUID(), quoteId: crypto.randomUUID(), first: 'Manny', last: `E2E Truth ${stamp}`, phone: '3525550171', addr: '1301 SE Silver Springs Pl, Ocala, FL 34471', price: 7113.83, jobId: '' },  // billed $7,114 (whole dollar, D1 Oct 29 2026): deposit $3,557, final $3,557
  b: { contactId: crypto.randomUUID(), cardId: crypto.randomUUID(), quoteId: crypto.randomUUID(), first: 'Bea', last: `E2E Truth ${stamp}`, phone: '3525550172', addr: '4411 SE 31st St, Ocala, FL 34480', price: 3223.0, jobId: '' },
  // C: a quote sent, the card in First Contact; the office marks it Sold in the app.
  c: { contactId: crypto.randomUUID(), cardId: crypto.randomUUID(), quoteId: crypto.randomUUID(), first: 'Cal', last: `E2E Truth ${stamp}`, phone: '3525550173', addr: '9020 SW 103rd Ln, Ocala, FL 34481', price: 2945.0, jobId: '' },
}
const nameOf = x => `${x.first} ${x.last}`
const browsers = []
let packetToken = ''

async function makeSoldJob(x, extra = {}) {
  const feet = 160, sections = 20
  const c = await call('POST', '/api/crm-contacts', { id: x.contactId, firstName: x.first, lastName: x.last, phone: x.phone, email: `e2e-truth-${stamp}-${x.first.toLowerCase()}@example.invalid`, serviceAddress: x.addr, leadSource: 'Other',
    lead: { id: x.cardId, customerId: x.contactId, firstName: x.first, lastName: x.last, phone: x.phone, address: x.addr, stage: 'Signed Contract', leadSource: 'Other', quoteId: x.quoteId, createdAt: today, lastMoved: today }, leadBefore: null })
  const q = await call('POST', '/api/saved-quotes', {
    id: x.quoteId, crmContactId: x.contactId, customerName: nameOf(x), customerPhone: x.phone, customerAddress: x.addr,
    fenceStyle: "TV-ND 6'x8' Privacy", runs: [feet], sections, corners: 0, ends: 2, walkGates: 0, materialCost: 2500, laborCost: 1100, totalCOGS: 3600, finalPrice: x.price, gmPct: 0.35,
    pullSheet: [], status: 'SENT', date: today, salesRep: 'E2E Salesman', leadSource: 'Other',
  })
  const sold = await call('PATCH', `/api/saved-quotes/${x.quoteId}`, { status: 'SOLD' })
  const j = await call('POST', '/api/saved-jobs', { quoteId: x.quoteId, crmContactId: x.contactId, customerName: nameOf(x), customerPhone: x.phone, customerAddress: x.addr, fenceStyle: "TV-ND 6'x8' Privacy", sections, totalFeet: feet, quotePrice: x.price, contractValue: x.price, status: 'staging', materialsStatus: 'received', salesRep: 'E2E Salesman', ...extra })
  x.jobId = j.json.data?.id || ''
  return [c, q, sold, j].every(r => r.status < 300) && !!x.jobId
}

async function browserPage(kind) {
  const phone = kind === 'phone'
  const br = phone ? await webkit.launch() : await chromium.launch()
  browsers.push(br)
  const ctx = await br.newContext(phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 950 } })
  await signInByCookie(ctx, { api: API })
  // Call and text hand off to the phone: the link is recorded, nothing leaves.
  await ctx.addInitScript(() => {
    window.__links = []
    window.addEventListener('click', e => { const a = e.target instanceof Element ? e.target.closest('a[href^="sms:"],a[href^="tel:"]') : null; if (a) { window.__links.push(a.getAttribute('href')); e.preventDefault() } }, true)
  })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)))
  page.on('dialog', d => d.accept().catch(() => {}))
  return { br, ctx, page, errors, phone }
}
async function openJob(s, jobId) {
  await s.page.goto(`${APP}/operations?job=${encodeURIComponent(jobId)}`)
  return !!(await until(async () => (await s.page.locator('[data-job-locate]').count()) > 0, 30000))
}
const minTap = async (loc) => { const b = await loc.boundingBox(); return b ? Math.round(Math.min(b.width, b.height)) : 0 }

try {
  const okA = await makeSoldJob(W.a)
  const okB = await makeSoldJob(W.b)
  // A said yes to texts (B and C did not).
  await call('POST', `/api/crm-contacts/${W.a.contactId}/text-consent`, { consent: 'yes' })
  const cc = await call('POST', '/api/crm-contacts', { id: W.c.contactId, firstName: W.c.first, lastName: W.c.last, phone: W.c.phone, email: `e2e-truth-${stamp}-cal@example.invalid`, serviceAddress: W.c.addr, leadSource: 'Other',
    lead: { id: W.c.cardId, customerId: W.c.contactId, firstName: W.c.first, lastName: W.c.last, phone: W.c.phone, address: W.c.addr, stage: 'First Contact', leadSource: 'Other', createdAt: today, lastMoved: today }, leadBefore: null })
  const cq = await call('POST', '/api/saved-quotes', { id: W.c.quoteId, crmContactId: W.c.contactId, customerName: nameOf(W.c), customerPhone: W.c.phone, customerAddress: W.c.addr, fenceStyle: "WV-ND 6'x8' Privacy", runs: [96], sections: 12, corners: 0, ends: 2, walkGates: 0, materialCost: 1000, laborCost: 600, totalCOGS: 1600, finalPrice: W.c.price, gmPct: 0.35, pullSheet: [], status: 'SENT', date: today, salesRep: 'E2E Salesman', leadSource: 'Other' })
  // Its proposal (what the quote builder saves): one option.
  sql(`UPDATE "SavedQuote" SET proposal = ${lit(JSON.stringify({ version: 1, options: [{ label: 'Good', fenceStyle: "WV-ND 6'x8' Privacy", finalPrice: W.c.price, sections: 12 }], depositPct: 50 }))}::jsonb WHERE id = ${lit(W.c.quoteId)}`)
  check('C: a sent quote, its card in First Contact', cc.status < 300 && cq.status < 300, `${cc.status} ${cq.status} ${JSON.stringify(cq.json).slice(0, 200)}`)
  check('two sold jobs made (A and B), each with a payment schedule', okA && okB && (await call('GET', `/api/payments/job/${W.a.jobId}`)).json.data?.schedule?.invoices?.length === 2)
  // A is booked Monday-Tuesday two weeks out; B has a crew packet.
  const start = plus(today, 14)
  sql(`UPDATE "SavedJob" SET "scheduledDate" = ${lit(start)}, "scheduledEndDate" = ${lit(plus(start, 1))}, "crewAssigned" = 'crew1' WHERE id = ${lit(W.a.jobId)}`)
  packetToken = `e2etruth${stamp}${crypto.randomBytes(8).toString('hex')}`
  sql(`INSERT INTO "InstallPacket" (id, "accountId", "jobId", token, snapshot, "sentAt", "createdAt", "updatedAt") SELECT ${lit(crypto.randomUUID())}, "accountId", id, ${lit(packetToken)}, '{"companyName":"Getter Done Fence"}'::jsonb, now(), now(), now() FROM "SavedJob" WHERE id = ${lit(W.a.jobId)}`)

  // ── Phone: the job page ──
  const ph = await browserPage('phone')
  check('phone: the job page opens', await openJob(ph, W.a.jobId))
  await sleep(1200)
  const fin = await until(async () => { const t = await ph.page.locator('[data-job-payment-status]').textContent(); return /Deposit/.test(t || '') ? t : null })
  check('phone: Financial says the deposit is due (from the payment schedule), not "Not invoiced yet"', !!fin && /^Deposit \$3,557\.00 due \d{2}\/\d{2}\/\d{4}$/.test(fin.trim()) && !(await ph.page.content()).includes('Not invoiced yet'), fin)
  check('phone: Payments shows the same deposit left', (await ph.page.locator('[data-payment-schedule] [data-invoice="deposit"] [data-invoice-balance]').first().getAttribute('data-invoice-balance')) === '355700')
  const call1 = ph.page.locator('[data-job-call]')
  // Text: framed "Getter Done Fence: Hi Manny, " ... "Reply STOP to opt out." and only with a yes on record (recorded in setup).
  const textHref = await until(async () => ph.page.locator('[data-job-text]').getAttribute('href'))
  const textBody = textHref ? decodeURIComponent(textHref.split('body=')[1] || '') : ''
  check('phone: the number reads (352) 555 0171, taps to call and to text (framed, with STOP)', (await call1.textContent()).includes('(352) 555 0171') && (await call1.getAttribute('href')) === 'tel:3525550171' && !!textHref && textHref.startsWith('sms:3525550171') && textBody === 'Getter Done Fence: Hi Manny,  Reply STOP to opt out.', textBody)
  check('phone: call and text are big enough to tap (44 px)', (await minTap(call1)) >= 44 && (await minTap(ph.page.locator('[data-job-text]'))) >= 44)
  const loc0 = await ph.page.locator('[data-job-locate]').getAttribute('data-job-locate')
  const locMs0 = await until(async () => ph.page.locator('[data-milestone="locate"]').getAttribute('data-milestone-done'))
  check('phone: 811 Not called, and Locate Complete not done with no tick box', loc0 === 'not_called' && locMs0 === 'no' && (await ph.page.locator('[data-milestone="locate"] [data-milestone-tick]').count()) === 0, `${loc0} ${locMs0}`)
  const warn0 = await ph.page.locator('[data-locate-warnings]').textContent().catch(() => '')
  check('phone: the job warns there is no 811 ticket for the install', /No 811 locate ticket on the job/.test(warn0 || ''), warn0)
  await shot(ph.page, 'phone-job-before-locate')
  // The office adds the ticket on the job page.
  await ph.page.locator('[data-locate-edit]').scrollIntoViewIfNeeded()
  await ph.page.locator('[data-locate-edit]').tap()
  await ph.page.locator('[data-locate-input="ticket"]').fill('294610232')
  await ph.page.locator('[data-locate-input="called"]').fill(plus(today, -4))
  await ph.page.locator('[data-locate-input="good"]').fill(plus(today, -1))
  await ph.page.locator('[data-locate-input="exp"]').fill(plus(start, 2))
  await shot(ph.page, 'phone-locate-form')
  await ph.page.locator('[data-locate-save]').tap()
  const st1 = await until(async () => (await ph.page.locator('[data-job-locate]').getAttribute('data-job-locate')) === 'clear')
  check('phone: saved; the 811 status is Clear to dig (worked out from the dates)', !!st1 && (await ph.page.locator('[data-locate-ticket]').textContent()) === '294610232')
  const warn1 = await until(async () => { const t = await ph.page.locator('[data-locate-warnings]').textContent(); return /within 3 days/.test(t || '') ? t : null })
  check('phone: the ticket running out within 3 days of the install is warned', !!warn1, warn1 || '')
  const locMs1 = await until(async () => (await ph.page.locator('[data-milestone="locate"]').getAttribute('data-milestone-done')) === 'yes' ? 'yes' : null)
  check('phone: Locate Complete is done by itself, from the locate', locMs1 === 'yes' && (await ph.page.locator('[data-milestone="locate"]').getAttribute('data-milestone-by')) === 'data')
  check('phone: Permit Approved follows the permit (no tick box, not done)', (await ph.page.locator('[data-milestone="permit"]').getAttribute('data-milestone-done')) === 'no' && (await ph.page.locator('[data-milestone="permit"] [data-milestone-tick]').count()) === 0)
  await ph.page.locator('[data-milestone="photos"] [data-milestone-tick]').tap()
  const hand = await until(async () => (await ph.page.locator('[data-milestone="photos"]').getAttribute('data-milestone-by')) === 'hand' ? await ph.page.locator('[data-milestone="photos"] [data-milestone-detail]').textContent() : null)
  check('phone: Photos Uploaded ticked by hand says so', !!hand && /^Ticked by hand by /.test(hand), hand || '')
  await shot(ph.page, 'phone-milestones')
  check('phone: no errors on the job page', ph.errors.length === 0, ph.errors.join(' | '))

  // ── The crew packet shows the same locate; the crew changes the expiration ──
  const pk = await fetch(`${API}/p/i/${packetToken}`).then(r => r.text())
  check('packet: the same ticket and dates as the job', pk.includes('value="294610232"') && pk.includes(`value="${plus(start, 2)}"`) && pk.includes('data-packet-locate-status="clear"'))
  const crewCtx = await (await chromium.launch().then(b => { browsers.push(b); return b })).newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const crew = await crewCtx.newPage()
  await crew.goto(`${API}/p/i/${packetToken}`)
  // The locate on file is shown in words; "Change the locate" opens the boxes (round 2).
  await crew.locator('[data-packet-locate-edit]').click()
  await crew.locator('#lexp').fill(plus(start, 20))
  await crew.locator('#saveLocate').click()
  const crewMsg = await until(async () => { const t = await crew.locator('#locMsg').textContent(); return t?.startsWith('Saved') ? t : null })
  check('packet: the crew saves the new expiration', !!crewMsg, crewMsg || '')
  // The table on file shows the new expiration at once, the boxes closed (round 2b: it kept the old dates until a reload).
  const expShown = await until(async () => (await crew.locator('[data-packet-locate-exp]').textContent())?.trim() === `${plus(start, 20).slice(5, 7)}/${plus(start, 20).slice(8, 10)}/${plus(start, 20).slice(0, 4)}`)
  check('packet: the 811 table shows the saved expiration without a reload, boxes closed', !!expShown && !(await crew.locator('#locForm').isVisible()) && /Saved by Crew \(install packet\)/.test(await crew.locator('[data-packet-locate-by]').textContent() || ''))

  // ── Computer, a second browser: sees the crew's change ──
  const pc = await browserPage('computer')
  check('computer: the job page opens', await openJob(pc, W.a.jobId))
  const exp2 = await until(async () => { const t = await pc.page.locator('[data-locate-exp]').textContent(); return t?.trim() === `${plus(start, 20).slice(5, 7)}/${plus(start, 20).slice(8, 10)}/${plus(start, 20).slice(0, 4)}` ? t : null })
  check('computer: the expiration the crew typed shows on the job (one record)', !!exp2, exp2 || '')
  check('computer: no 3-day warning any more', !(await pc.page.locator('[data-locate-warnings]').count()) || !/within 3 days/.test(await pc.page.locator('[data-locate-warnings]').textContent()))
  check('computer: Photos Uploaded still ticked by hand (saved on the server)', (await pc.page.locator('[data-milestone="photos"]').getAttribute('data-milestone-by')) === 'hand')
  await shot(pc.page, 'computer-job-page')

  // ── Open customer profile ──
  await pc.page.locator('[data-job-open-customer]').scrollIntoViewIfNeeded()
  await pc.page.locator('[data-job-open-customer]').click()
  const onCustomer = await until(async () => pc.page.url().includes(`/customers/${W.a.contactId}`))
  check('computer: Open customer profile opens the customer page', !!onCustomer, pc.page.url())
  const billing = await until(async () => { await pc.page.locator('[data-customer-tab="billing"]').click(); return (await pc.page.locator('[data-invoice="deposit"] [data-invoice-balance]').first().getAttribute('data-invoice-balance')) === '355700' })
  check('computer: the customer\'s Billing shows the same deposit due', !!billing)

  // ── The Complete stage button (job B) ──
  check('computer: job B opens', await openJob(pc, W.b.jobId))
  await pc.page.locator('[data-ops-stage-choice="completed"]').scrollIntoViewIfNeeded()
  await pc.page.locator('[data-ops-stage-choice="completed"]').click()
  const pill = await until(async () => (await pc.page.locator(`[data-job-panel="${W.b.jobId}"] [data-ops-stage-pill]`).getAttribute('data-ops-stage-pill')) === 'completed')
  check('computer: the Complete button moves the job on the panel at once', !!pill, await pc.page.locator(`[data-job-panel="${W.b.jobId}"] [data-ops-stage-pill]`).getAttribute('data-ops-stage-pill').catch(() => 'no panel'))
  const savedB = await until(async () => (await call('GET', `/api/saved-jobs/${W.b.jobId}`)).json.data?.status === 'completed')
  check('computer: the server has it Complete', !!savedB, (await call('GET', `/api/saved-jobs/${W.b.jobId}`)).json.data?.status)
  await shot(pc.page, 'computer-complete-button')

  // ── A finished job is not advanced by hand ──
  check('computer: Complete job B shows where it is, no "Advance to Invoiced"', (await pc.page.locator(`[data-job-panel="${W.b.jobId}"] [data-ops-advance]`).count()) === 0 && (await pc.page.locator(`[data-job-panel="${W.b.jobId}"] [data-ops-done]`).count()) === 1)

  // ── Job A: crew name, and the deposit overdue once its day has passed ──
  check('computer: job A opens', await openJob(pc, W.a.jobId))
  const crewMs = await until(async () => { const t = await pc.page.locator('[data-milestone="crew"] [data-milestone-detail]').textContent(); return t && /Crew 1/.test(t) ? t : null })
  check('computer: Crew Assigned shows the crew\'s name, never "crew1"', !!crewMs && !/crew1/.test(crewMs), crewMs || '')
  check('computer: Job Started comes from the install (not started before its first crew day)', (await pc.page.locator('[data-milestone="started"]').getAttribute('data-milestone-done')) === 'no')
  sql(`UPDATE "ContractInvoice" SET "dueDate" = ${lit(plus(today, -5))} WHERE "jobId" = ${lit(W.a.jobId)} AND kind = 'deposit'`)
  await pc.page.goto(`${APP}/billing`)
  const ar = await until(async () => { const v = Number(await pc.page.locator('[data-ar-overdue]').getAttribute('data-ar-overdue')); return v >= 355700 ? v : null }, 30000)
  check('Billing: Accounts Receivable counts the overdue deposit from the payment schedule', !!ar && (await pc.page.locator(`[data-ar-row="${nameOf(W.a)}"]`).count()) === 1, String(ar))
  await pc.page.locator('button:text-is("Overdue")').click()
  const od = await until(async () => (await pc.page.locator('[data-overdue-invoice]').filter({ hasText: nameOf(W.a) }).count()) === 1)
  check('Billing: the Overdue tab lists it, 5 days overdue', !!od && /5d overdue/.test(await pc.page.locator('[data-overdue-invoice]').filter({ hasText: nameOf(W.a) }).textContent()))
  await shot(pc.page, 'billing-overdue')
  check('computer: job A opens again', await openJob(pc, W.a.jobId))
  const finOd = await until(async () => { const t = await pc.page.locator('[data-job-payment-status]').textContent(); return /overdue since/.test(t || '') ? t : null })
  check('computer: the job\'s Financial says the deposit is overdue (same rule as Billing)', !!finOd && /\(5 days\)/.test(finOd), finOd || '')
  check('computer: Payments marks the deposit Overdue', (await pc.page.locator('[data-invoice="deposit"] [data-invoice-overdue]').first().getAttribute('data-invoice-overdue')) === '5')

  // ── The Schedule month shows A from its dates (no board entries), not in Ready to schedule ──
  await pc.page.goto(`${APP}/schedule`)
  const startMonth = new Date(`${start}T12:00:00Z`).getUTCMonth(), nowMonth = new Date(`${today}T12:00:00Z`).getUTCMonth()
  if (startMonth !== nowMonth) { await pc.page.locator('[data-month-next]').click(); await sleep(500) }
  const onMonth = await until(async () => (await pc.page.locator(`[data-install-entry="${W.a.jobId}"][data-install-from-dates="yes"]`).count()) >= 1, 30000)
  check('Schedule: job A shows on the month from its install dates (it has no board entries)', !!onMonth)
  check('Schedule: job A is not in Ready to schedule', (await pc.page.locator('[data-ready-panel]').textContent()).indexOf(nameOf(W.a)) < 0)
  await shot(pc.page, 'schedule-month')

  // ── The proposal: Text it opens the texting app for any customer with a phone (C has no yes to texts) ──
  await pc.page.goto(`${APP}/quotes?qv=${encodeURIComponent(W.c.quoteId)}`)
  const textBtn = pc.page.locator('[data-quote-drawer] [data-proposal-text]')
  await until(async () => (await textBtn.count()) > 0 && await textBtn.isEnabled(), 30000)
  // Text it sets the page's location to the sms: link; Chrome has no texting app, so it shows as a request that goes nowhere.
  const smsSeen = []
  const onRequest = r => { if (r.url().startsWith('sms:')) smsSeen.push(r.url()) }
  pc.page.on('request', onRequest)
  await textBtn.click()
  const opened = await until(async () => smsSeen.find(t => t.startsWith('sms:3525550173')) ?? null, 15000)
  pc.page.off('request', onRequest)
  check('proposal: no yes to texts on record, Text it still opens the text (framed, with the link), no block, no "call them"',
    !!opened && /Getter%20Done%20Fence%3A%20Hi%20/.test(opened) && /Reply%20STOP%20to%20opt%20out/.test(opened) && (await pc.page.locator('[data-proposal-text-blocked], [data-proposal-call]').count()) === 0, (opened || smsSeen.join(' | ')).slice(0, 200))

  // ── Mark as Sold in the app: the card follows, no false toast ──
  const net = []
  pc.page.on('response', r => { if (/\/api\/(saved-|pipeline|business)/.test(r.url()) && r.request().method() !== 'GET') { const line = `${r.request().method()} ${r.url().replace(API, '')} ${r.status()}`; if (r.status() >= 400) r.text().then(t => net.push(line + ' ' + t.slice(0, 300))).catch(() => net.push(line)); else net.push(line) } })
  pc.page.on('console', m => { if (/quote|job|sold/i.test(m.text())) net.push('console: ' + m.text().slice(0, 200)) })
  await pc.page.locator('button:text-is("Mark as Sold")').click()
  const cardC = await until(async () => { const l = ((await call('GET', '/api/pipeline')).json.data?.leads ?? []).find(x => x.id === W.c.cardId); return l?.stage === 'Job Prep' ? l : null }, 30000)
  check('Mark as Sold: the card moves from First Contact to Signed Contract, then follows the job to Job Prep, with the quote on it', !!cardC && cardC.quoteId === W.c.quoteId)
  await sleep(3000)
  const falseToast = await pc.page.locator('text=Someone changed this on another phone').count()
  check('Mark as Sold: no "Someone changed this on another phone" toast', falseToast === 0)
  check('Mark as Sold: the phone saves no pipeline (the server moves the card): no PATCH /api/pipeline, no 409', !net.some(l => /PATCH \/api\/pipeline/.test(l)) && !net.some(l => / 409/.test(l)), net.join(' | '))
  W.c.jobId = (await until(async () => sql(`SELECT id FROM "SavedJob" WHERE "quoteId" = ${lit(W.c.quoteId)} AND "deletedAt" IS NULL`) || null, 30000)) || ''
  const qs = sql(`SELECT status FROM "SavedQuote" WHERE id = ${lit(W.c.quoteId)}`)
  check('Mark as Sold: the quote is Sold and its job is made', !!W.c.jobId && qs === 'SOLD', `job ${W.c.jobId || 'none'}, quote ${qs}; ${net.join(' | ')}`)

  // ── Phones as the app writes them, on the pages customers and crews see ──
  const pkt = await fetch(`${API}/p/i/${packetToken}`).then(r => r.text())
  check('packet: phones written (352) 555 0171, never with a dash', pkt.includes('(352) 555 0171') && !/\(\d{3}\) \d{3}-\d{4}/.test(pkt))

  // ── Close out (job A): walkthrough signed, then the final payment ──
  // Installed: its crew days are past (a job never installed is not closed out by itself; tests/jobTruth.db.test.ts).
  sql(`UPDATE "SavedJob" SET "scheduledDate" = ${lit(plus(today, -2))}, "scheduledEndDate" = ${lit(plus(today, -1))} WHERE id = ${lit(W.a.jobId)}`)
  const sig = n => `'{"name":"${n}","role":"Homeowner","signedAt":"${new Date().toISOString()}"}'::jsonb`
  sql(`INSERT INTO "Walkthrough" (id, "accountId", "jobId", status, items, photos, "homeownerSig", "repSig", "signedAt", "createdAt", "updatedAt") SELECT ${lit(crypto.randomUUID())}, "accountId", id, 'open', '[]', '[]', ${sig('Manny')}, ${sig('Jonathan')}, now(), now(), now() FROM "SavedJob" WHERE id = ${lit(W.a.jobId)}`)
  const p1 = await call('POST', '/api/payments', { id: `e2etruth${stamp}a`, jobId: W.a.jobId, amountCents: 355700, method: 'check', checkNumber: '101' })
  const mid = (await call('GET', `/api/saved-jobs/${W.a.jobId}`)).json.data
  check('close out: the deposit alone leaves the job where it is', p1.status === 201 && mid.status === 'staging', mid.status)
  const p2 = await call('POST', '/api/payments', { id: `e2etruth${stamp}b`, jobId: W.a.jobId, amountCents: 355700, method: 'check', checkNumber: '102' })
  const done = (await call('GET', `/api/saved-jobs/${W.a.jobId}`)).json.data
  // Round 2 (Oct 26): Complete, and the balance being zero, on to Paid by itself.
  check('close out: signed and paid in full: Complete then Paid by itself', p2.status === 201 && done.status === 'paid' && done.opsStage === 'paid' && done.paymentStatus === 'paid' && /^\d{4}-\d{2}-\d{2}$/.test(done.completedDate || ''), `${done.status} ${done.opsStage} ${done.paymentStatus}`)
  const card = ((await call('GET', '/api/pipeline')).json.data?.leads ?? []).find(l => l.id === W.a.cardId)
  check('close out: paid in full and done, the pipeline card is in Paid & Closed', card?.stage === 'Paid & Closed', card?.stage)
  await pc.page.goto(`${APP}/customers/${W.a.contactId}`)
  const status = await until(async () => { const t = await pc.page.locator('text=Job Status').locator('xpath=following-sibling::span[1]').textContent(); return /Paid/.test(t || '') ? t : null })
  check('close out: the customer page says Job: Paid', status === 'Job: Paid', status || '')
  check('computer: no errors', pc.errors.length === 0, pc.errors.join(' | '))
} catch (e) {
  check('test run finished', false, String(e).split('\n').slice(0, 3).join(' '))
} finally {
  for (const b of browsers) await b.close().catch(() => {})
  try {
    const jobs = [W.a.jobId, W.b.jobId, W.c.jobId].filter(Boolean).map(lit).join(',') || "'-'"
    const quotes = [W.a.quoteId, W.b.quoteId, W.c.quoteId].map(lit).join(',')
    const contacts = [W.a.contactId, W.b.contactId, W.c.contactId].map(lit).join(',')
    sql(`BEGIN;
      DELETE FROM "PortalFile" WHERE "crmCustomerId" IN (${contacts});
      DELETE FROM "Receipt" WHERE "jobId" IN (${jobs});
      DELETE FROM "PaymentApplication" WHERE "paymentId" IN (SELECT id FROM "ContractPayment" WHERE "jobId" IN (${jobs}));
      DELETE FROM "ContractPayment" WHERE "jobId" IN (${jobs});
      DELETE FROM "ContractInvoice" WHERE "jobId" IN (${jobs});
      DELETE FROM "BillingLog" WHERE "jobId" IN (${jobs});
      DELETE FROM "PaymentSchedule" WHERE "jobId" IN (${jobs});
      DELETE FROM "Walkthrough" WHERE "jobId" IN (${jobs});
      DELETE FROM "CrmTextConsent" WHERE "crmContactId" IN (${contacts});
      DELETE FROM "ActivityLog" WHERE "entityId" IN (${jobs});
      DELETE FROM "InstallPacket" WHERE "jobId" IN (${jobs});
      DELETE FROM "Permit" WHERE "jobId" IN (${jobs});
      DELETE FROM "CrmAuditLog" WHERE "entityId" IN (${jobs}, ${quotes}, ${contacts});
      DELETE FROM "JobQuotedCost" WHERE "quoteId" IN (${quotes});
      DELETE FROM "AutomationEvent" WHERE "entityId" IN (${jobs}, ${quotes}, ${contacts}, ${lit(W.a.cardId)}, ${lit(W.b.cardId)}, ${lit(W.c.cardId)});
      DELETE FROM "ScheduledGridJob" WHERE "stagingJobId" IN (${jobs});
      DELETE FROM "PendingTouch" WHERE "cardId" IN (${lit(W.a.cardId)}, ${lit(W.b.cardId)}, ${lit(W.c.cardId)});
      DELETE FROM "SavedJob" WHERE id IN (${jobs});
      DELETE FROM "SavedQuote" WHERE id IN (${quotes});
      DELETE FROM "Notification" WHERE body LIKE ${lit(`%E2E Truth ${stamp}%`)} OR title LIKE ${lit(`%E2E Truth ${stamp}%`)};
      COMMIT;`)
    // The milestone ticks of these jobs.
    for (const id of [W.a.jobId, W.b.jobId, W.c.jobId].filter(Boolean)) sql(`UPDATE "BusinessState" SET "jobChecklists" = "jobChecklists" - ${lit(id)}, version = version + 1 WHERE "jobChecklists" ? ${lit(id)}`)
    // C's pending order and pull sheet (made by Mark as Sold).
    sql(`UPDATE "BusinessState" SET "pendingOrders" = COALESCE((SELECT jsonb_agg(x) FROM jsonb_array_elements("pendingOrders") x WHERE x->>'quoteId' IS DISTINCT FROM ${lit(W.c.quoteId)}), '[]'::jsonb), "pullSheets" = COALESCE((SELECT jsonb_agg(x) FROM jsonb_array_elements("pullSheets") x WHERE x->>'quoteId' IS DISTINCT FROM ${lit(W.c.quoteId)}), '[]'::jsonb), version = version + 1 WHERE "pendingOrders"::text LIKE ${lit(`%${W.c.quoteId}%`)} OR "pullSheets"::text LIKE ${lit(`%${W.c.quoteId}%`)}`)
    const pl = (await call('GET', '/api/pipeline')).json
    const mine = (pl?.data?.leads ?? []).filter(l => [W.a.contactId, W.b.contactId, W.c.contactId].includes(l.customerId) || [W.a.cardId, W.b.cardId, W.c.cardId].includes(l.id)).map(l => l.id)
    if (mine.length) await call('PATCH', '/api/pipeline', { upsert: [], remove: mine, baseVersion: pl.data.version })
    for (const x of [W.a, W.b, W.c]) await call('DELETE', `/api/crm-contacts/${x.contactId}`)
    sql(`DELETE FROM "DeletionLog" WHERE "entityId" IN (${contacts}); DELETE FROM "CrmContact" WHERE id IN (${contacts})`)
    const left = Number(sql(`SELECT (SELECT count(*) FROM "SavedJob" WHERE id IN (${jobs})) + (SELECT count(*) FROM "CrmContact" WHERE id IN (${contacts})) + (SELECT count(*) FROM "SavedQuote" WHERE id IN (${quotes})) + (SELECT count(*) FROM "ContractPayment" WHERE "jobId" IN (${jobs}))`))
    check('cleaned up', left === 0, `${left} left`)
  } catch (e) { check('cleaned up', false, String(e?.message || e).slice(0, 300)) }
}
const passed = results.filter(Boolean).length
console.log(`\n${passed} of ${results.length} checks passed`)
process.exit(passed === results.length ? 0 : 1)
