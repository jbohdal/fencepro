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
//      is Complete by itself, its card is in Job Complete, and the customer
//      page says "Job: Complete".
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
  a: { contactId: crypto.randomUUID(), cardId: crypto.randomUUID(), quoteId: crypto.randomUUID(), first: 'Manny', last: `E2E Truth ${stamp}`, phone: '3525550171', addr: '1301 SE Silver Springs Pl, Ocala, FL 34471', price: 7113.83, jobId: '' },
  b: { contactId: crypto.randomUUID(), cardId: crypto.randomUUID(), quoteId: crypto.randomUUID(), first: 'Bea', last: `E2E Truth ${stamp}`, phone: '3525550172', addr: '4411 SE 31st St, Ocala, FL 34480', price: 3223.0, jobId: '' },
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
  check('two sold jobs made (A and B), each with a payment schedule', okA && okB && (await call('GET', `/api/payments/job/${W.a.jobId}`)).json.data?.schedule?.invoices?.length === 2)
  // A is booked Monday-Tuesday two weeks out; B has a crew packet.
  const start = plus(today, 14)
  sql(`UPDATE "SavedJob" SET "scheduledDate" = ${lit(start)}, "scheduledEndDate" = ${lit(plus(start, 1))}, "crewAssigned" = 'Crew One' WHERE id = ${lit(W.a.jobId)}`)
  packetToken = `e2etruth${stamp}${crypto.randomBytes(8).toString('hex')}`
  sql(`INSERT INTO "InstallPacket" (id, "accountId", "jobId", token, snapshot, "sentAt", "createdAt", "updatedAt") SELECT ${lit(crypto.randomUUID())}, "accountId", id, ${lit(packetToken)}, '{"companyName":"Getter Done Fence"}'::jsonb, now(), now(), now() FROM "SavedJob" WHERE id = ${lit(W.a.jobId)}`)

  // ── Phone: the job page ──
  const ph = await browserPage('phone')
  check('phone: the job page opens', await openJob(ph, W.a.jobId))
  await sleep(1200)
  const fin = await until(async () => { const t = await ph.page.locator('[data-job-payment-status]').textContent(); return /Deposit/.test(t || '') ? t : null })
  check('phone: Financial says the deposit is due (from the payment schedule), not "Not invoiced yet"', !!fin && /^Deposit \$3,556\.92 due \d{2}\/\d{2}\/\d{4}$/.test(fin.trim()) && !(await ph.page.content()).includes('Not invoiced yet'), fin)
  check('phone: Payments shows the same deposit left', (await ph.page.locator('[data-payment-schedule] [data-invoice="deposit"] [data-invoice-balance]').first().getAttribute('data-invoice-balance')) === '355692')
  const call1 = ph.page.locator('[data-job-call]')
  check('phone: the number reads (352) 555 0171, taps to call and to text', (await call1.textContent()).includes('(352) 555 0171') && (await call1.getAttribute('href')) === 'tel:3525550171' && (await ph.page.locator('[data-job-text]').getAttribute('href')).startsWith('sms:3525550171'))
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
  await crew.locator('#lexp').fill(plus(start, 20))
  await crew.locator('#saveLocate').click()
  const crewMsg = await until(async () => { const t = await crew.locator('#locMsg').textContent(); return t?.startsWith('Saved') ? t : null })
  check('packet: the crew saves the new expiration', !!crewMsg, crewMsg || '')

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
  const billing = await until(async () => { await pc.page.locator('[data-customer-tab="billing"]').click(); return (await pc.page.locator('[data-invoice="deposit"] [data-invoice-balance]').first().getAttribute('data-invoice-balance')) === '355692' })
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

  // ── Close out (job A): walkthrough signed, then the final payment ──
  const sig = n => `'{"name":"${n}","role":"Homeowner","signedAt":"${new Date().toISOString()}"}'::jsonb`
  sql(`INSERT INTO "Walkthrough" (id, "accountId", "jobId", status, items, photos, "homeownerSig", "repSig", "signedAt", "createdAt", "updatedAt") SELECT ${lit(crypto.randomUUID())}, "accountId", id, 'open', '[]', '[]', ${sig('Manny')}, ${sig('Jonathan')}, now(), now(), now() FROM "SavedJob" WHERE id = ${lit(W.a.jobId)}`)
  const p1 = await call('POST', '/api/payments', { id: `e2etruth${stamp}a`, jobId: W.a.jobId, amountCents: 355692, method: 'check', checkNumber: '101' })
  const mid = (await call('GET', `/api/saved-jobs/${W.a.jobId}`)).json.data
  check('close out: the deposit alone leaves the job where it is', p1.status === 201 && mid.status === 'staging', mid.status)
  const p2 = await call('POST', '/api/payments', { id: `e2etruth${stamp}b`, jobId: W.a.jobId, amountCents: 355691, method: 'check', checkNumber: '102' })
  const done = (await call('GET', `/api/saved-jobs/${W.a.jobId}`)).json.data
  check('close out: signed and paid in full: Complete by itself', p2.status === 201 && done.status === 'completed' && done.opsStage === 'completed' && done.paymentStatus === 'paid' && /^\d{4}-\d{2}-\d{2}$/.test(done.completedDate || ''), `${done.status} ${done.opsStage} ${done.paymentStatus}`)
  const card = ((await call('GET', '/api/pipeline')).json.data?.leads ?? []).find(l => l.id === W.a.cardId)
  check('close out: the pipeline card is in Job Complete', card?.stage === 'Job Complete', card?.stage)
  await pc.page.goto(`${APP}/customers/${W.a.contactId}`)
  const status = await until(async () => { const t = await pc.page.locator('text=Job Status').locator('xpath=following-sibling::span[1]').textContent(); return /Complete/.test(t || '') ? t : null })
  check('close out: the customer page says Job: Complete', status === 'Job: Complete', status || '')
  check('computer: no errors', pc.errors.length === 0, pc.errors.join(' | '))
} catch (e) {
  check('test run finished', false, String(e).split('\n').slice(0, 3).join(' '))
} finally {
  for (const b of browsers) await b.close().catch(() => {})
  try {
    const jobs = [W.a.jobId, W.b.jobId].filter(Boolean).map(lit).join(',') || "'-'"
    const quotes = [W.a.quoteId, W.b.quoteId].map(lit).join(',')
    const contacts = [W.a.contactId, W.b.contactId].map(lit).join(',')
    sql(`BEGIN;
      DELETE FROM "PortalFile" WHERE "crmCustomerId" IN (${contacts});
      DELETE FROM "Receipt" WHERE "jobId" IN (${jobs});
      DELETE FROM "PaymentApplication" WHERE "paymentId" IN (SELECT id FROM "ContractPayment" WHERE "jobId" IN (${jobs}));
      DELETE FROM "ContractPayment" WHERE "jobId" IN (${jobs});
      DELETE FROM "ContractInvoice" WHERE "jobId" IN (${jobs});
      DELETE FROM "BillingLog" WHERE "jobId" IN (${jobs});
      DELETE FROM "PaymentSchedule" WHERE "jobId" IN (${jobs});
      DELETE FROM "Walkthrough" WHERE "jobId" IN (${jobs});
      DELETE FROM "InstallPacket" WHERE "jobId" IN (${jobs});
      DELETE FROM "Permit" WHERE "jobId" IN (${jobs});
      DELETE FROM "CrmAuditLog" WHERE "entityId" IN (${jobs}, ${quotes}, ${contacts});
      DELETE FROM "JobQuotedCost" WHERE "quoteId" IN (${quotes});
      DELETE FROM "AutomationEvent" WHERE "entityId" IN (${jobs}, ${quotes}, ${contacts}, ${lit(W.a.cardId)}, ${lit(W.b.cardId)});
      DELETE FROM "SavedJob" WHERE id IN (${jobs});
      DELETE FROM "SavedQuote" WHERE id IN (${quotes});
      DELETE FROM "Notification" WHERE body LIKE ${lit(`%E2E Truth ${stamp}%`)} OR title LIKE ${lit(`%E2E Truth ${stamp}%`)};
      COMMIT;`)
    // The milestone ticks of these jobs.
    sql(`UPDATE "BusinessState" SET "jobChecklists" = "jobChecklists" - ${lit(W.a.jobId)} - ${lit(W.b.jobId)}, version = version + 1 WHERE "jobChecklists" ? ${lit(W.a.jobId)} OR "jobChecklists" ? ${lit(W.b.jobId)}`)
    const pl = (await call('GET', '/api/pipeline')).json
    const mine = (pl?.data?.leads ?? []).filter(l => [W.a.contactId, W.b.contactId].includes(l.customerId) || [W.a.cardId, W.b.cardId].includes(l.id)).map(l => l.id)
    if (mine.length) await call('PATCH', '/api/pipeline', { upsert: [], remove: mine, baseVersion: pl.data.version })
    for (const x of [W.a, W.b]) await call('DELETE', `/api/crm-contacts/${x.contactId}`)
    sql(`DELETE FROM "DeletionLog" WHERE "entityId" IN (${contacts}); DELETE FROM "CrmContact" WHERE id IN (${contacts})`)
    const left = Number(sql(`SELECT (SELECT count(*) FROM "SavedJob" WHERE id IN (${jobs})) + (SELECT count(*) FROM "CrmContact" WHERE id IN (${contacts})) + (SELECT count(*) FROM "SavedQuote" WHERE id IN (${quotes})) + (SELECT count(*) FROM "ContractPayment" WHERE "jobId" IN (${jobs}))`))
    check('cleaned up', left === 0, `${left} left`)
  } catch (e) { check('cleaned up', false, String(e?.message || e).slice(0, 300)) }
}
const passed = results.filter(Boolean).length
console.log(`\n${passed} of ${results.length} checks passed`)
process.exit(passed === results.length ? 0 : 1)
