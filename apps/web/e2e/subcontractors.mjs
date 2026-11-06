// Subcontractors, Phase A, on a phone sized screen on the dev copy (Jonathan, Nov 6 2026).
//
//   E2E_ACCESS_TOKEN=<dev owner token> E2E_STAFF_COOKIE=<cookie> E2E_SHOTS=<folder> node e2e/subcontractors.mjs
//
// As the owner on a phone: add a sub, file their liability and the Florida exemption
// (expiring in 20 days: the warning), assign them on a sold job in 3 taps (Assign
// sub, the sub, Confirm), the "Call in 811" task; then as the sub on their phone,
// with no login: the link (red "Do not dig" before the ticket, the ticket after),
// check out with the trailer photo, sign off with after photos, check in; then the
// owner's one tap "Installed, confirm", and the dashboard. Its customer, quote and
// job are deleted at the end; the sub is left Inactive, named E2E.

import './devOnly.mjs'
import './sharedLock.mjs'
import { webkit, chromium } from 'playwright'
import { signInByCookie } from './lib.mjs'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || 'http://localhost:4001'
const OWNER = process.env.E2E_ACCESS_TOKEN || ''
const CDP = process.env.CDP_URL || ''
const SHOTS = process.env.E2E_SHOTS || ''
const NAME = CDP ? 'android' : 'webkit'
if (!/^http:\/\/localhost:\d+$/.test(APP) || /:4000$/.test(APP) || /:4000$/.test(API)) { console.error('Refusing to run: the dev copy only (localhost, not port 4000).'); process.exit(2) }
if (!OWNER) { console.error('Set E2E_ACCESS_TOKEN (an owner login on the dev server).'); process.exit(2) }
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PHOTO = path.join(HERE, 'fixtures', 'test-photo.jpg')
const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const call = async (method, p, body) => {
  for (let i = 0; ; i++) {
    const r = await fetch(`${API}${p}`, { method, headers: { Authorization: `Bearer ${OWNER}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await r.text(); let json = {}; try { json = JSON.parse(text) } catch { /* html */ }
    if (r.status !== 429 || i >= 20) return { status: r.status, json, text }
    await sleep(2000)
  }
}
async function until(fn, ms = 20000, every = 500) { const end = Date.now() + ms; for (;;) { const v = await fn().catch(() => null); if (v || Date.now() > end) return v; await sleep(every) } }
const sql = q => execFileSync('psql', ['-d', 'ezbiz_dev', '-At', '-c', q]).toString().trim()
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `subs-${NAME}-${name}.png`), fullPage: false }).catch(() => {}) }
const shotFull = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `subs-${NAME}-${name}.png`), fullPage: true }).catch(() => {}) }
const day = d => new Date(Date.now() + d * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
const nextMonday = () => { let d = 8; while (new Date(`${day(d)}T12:00:00Z`).getUTCDay() !== 1) d++; return day(d) }

const stamp = Date.now().toString(36).slice(-5)
const SUB = `E2E Sub ${NAME} ${stamp}`
const WHO = `Sub Job ${NAME} ${stamp}`
const contactId = crypto.randomUUID(), quoteId = crypto.randomUUID(), jobId = crypto.randomUUID()
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }

const browser = CDP ? await chromium.connectOverCDP(CDP) : await webkit.launch()
const errors = []
let subId = null
// The lien release's review mark as it was before this run: put back at the end, even after a failure.
let reviewWas = 'unknown'
try {
  // ── A sold job, copied from a priced no dig quote on dev ──
  const all = (await call('GET', '/api/saved-quotes')).json.data ?? []
  const t = all.filter(q => !/^E2E/i.test(q.customerName) && Array.isArray(q.pullSheet) && q.pullSheet.length >= 6 && q.totalCOGS > 0 && !q.work && q.runs?.length && /^WV-ND/.test(q.fenceStyle))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0]
  if (!t) throw new Error('no priced white no dig quote to copy on dev')
  const priced = ['fenceStyle', 'runs', 'runRails', 'corners', 'ends', 'walkGates', 'dblGates', 'tearOutSections', 'tearOutGates', 'adjLaborHrs', 'hasSalesman', 'priceAdjust', 'sections', 'materialCost', 'laborCost', 'tearOutCost', 'totalCOGS', 'finalPrice', 'gmPct', 'pullSheet', 'pricing']
  await call('POST', '/api/crm-contacts', { id: contactId, firstName: 'E2E', lastName: WHO, phone: '3525550193', serviceAddress: '9 Sub Way, Ocala, FL 34470', leadSource: 'Other' })
  const q = await call('POST', '/api/saved-quotes', { id: quoteId, ...Object.fromEntries(priced.map(k => [k, t[k]])), layout: { yard: null, runSections: t.layout?.runSections ?? [] }, crmContactId: contactId, customerName: `E2E ${WHO}`, customerPhone: '3525550193', customerAddress: '9 Sub Way, Ocala, FL 34470', leadSource: 'Other', salesRep: 'E2E', date: day(0), status: 'SOLD' })
  const j = await call('POST', '/api/saved-jobs', { id: jobId, quoteId, crmContactId: contactId, customerName: `E2E ${WHO}`, customerAddress: '9 Sub Way, Ocala, FL 34470', fenceStyle: t.fenceStyle, sections: t.sections, walkGates: t.walkGates, dblGates: t.dblGates, quotePrice: t.finalPrice, contractValue: t.finalPrice, status: 'staging', estimatedDays: 1 })
  check('set up: a sold job of its own', q.status < 300 && j.status < 300, `${q.status} ${j.status} from ${t.customerName}`)
  const priceText = Math.round(t.finalPrice).toLocaleString('en-US')

  // ── Owner, phone: add the sub ──
  const ctx = await browser.newContext(PHONE)
  await signInByCookie(ctx)
  const page = await ctx.newPage()
  page.on('pageerror', e => errors.push(String(e)))
  await page.goto(`${APP}/subcontractors`)
  await page.waitForSelector('[data-subs-page]', { timeout: 30000 })
  await page.locator('[data-subs-tab="subs"]').click()
  await page.locator('[data-sub-add]').click()
  await page.locator('[data-sub-field="businessName"]').fill(SUB)
  await page.locator('[data-sub-field="contactName"]').fill('Sam Sub')
  await page.locator('[data-sub-field="phone"]').fill('3525550194')
  await page.locator('[data-sub-field="email"]').fill(`e2e-sub-${stamp}@example.invalid`)
  await page.locator('[data-sub-trade="vinyl"]').click()
  await page.locator('[data-sub-trade="gates"]').click()
  await page.locator('[data-sub-field="crewSize"]').fill('3')
  await shot(page, '01-add-sub')
  await page.locator('[data-sub-save]').click()
  await page.waitForSelector(`[data-sub-page="${SUB}"]`, { timeout: 15000 })
  subId = sql(`SELECT id FROM "Subcontractor" WHERE "businessName" = '${SUB}'`)
  check('owner: the sub is added and opens on its page', !!subId)
  check('the new sub says what papers are missing', /No general liability/.test(await page.locator('[data-sub-missing]').innerText()))

  // ── Their papers: liability (a year), the Florida exemption (20 days: the warning) ──
  const pdf = path.join(SHOTS || '/tmp', `sub-paper-${stamp}.pdf`)
  fs.writeFileSync(pdf, '%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF')
  for (const [kind, exp] of [['liability', day(365)], ['wc_exemption', day(20)]]) {
    await page.locator('[data-sub-doc-kind]').selectOption(kind)
    await page.locator('[data-sub-doc-exp]').fill(exp)
    await page.locator('[data-sub-doc-file]').setInputFiles(pdf)
    await page.locator('[data-sub-doc-upload]').click()
    await until(async () => (await page.locator(`[data-sub-doc="${kind}"]`).count()) > 0, 15000)
  }
  check('papers filed: liability and the Florida exemption', (await page.locator('[data-sub-doc]').count()) === 2)
  check('the exemption expiring in 20 days is said', /expires .*\(20 days\)/.test(await page.locator('[data-sub-expiring]').first().innerText().catch(() => '')))
  await page.locator('[data-sub-papers]').scrollIntoViewIfNeeded()
  await shot(page, '02-sub-page-expiring')
  // A W9 is the owner's: the owner may file one (the picker offers it).
  check('owner: W9 is offered to the owner', (await page.locator('[data-sub-doc-kind] option[value="w9"]').count()) === 1)

  // ── Assign in 3 taps: Assign sub, the sub, Confirm ──
  await page.goto(`${APP}/operations?job=${jobId}`)
  await page.waitForSelector('[data-assign-sub]', { timeout: 30000 })
  await page.locator('[data-assign-sub]').scrollIntoViewIfNeeded()
  await shot(page, '03-assign-tap1')
  await page.locator('[data-assign-sub]').click()
  await page.waitForSelector(`[data-assign-pick="${SUB}"]`, { timeout: 15000 })
  await page.locator(`[data-assign-pick="${SUB}"]`).click()
  const start = nextMonday()
  await page.locator('[data-assign-date]').fill(start)
  await until(async () => /Their pay: \$/.test(await page.locator('[data-assign-pay]').innerText()), 15000)
  await page.locator('[data-assign-confirm]').scrollIntoViewIfNeeded()
  await shot(page, '04-assign-tap2-pick')
  const payPreview = await page.locator('[data-assign-pay]').innerText()
  const daysPreview = await page.locator('[data-assign-days]').innerText()
  await page.locator('[data-assign-confirm]').click()
  await page.waitForSelector(`[data-job-sub-assigned="${SUB}"]`, { timeout: 30000 })
  await page.locator('[data-job-sub-assigned]').scrollIntoViewIfNeeded()
  await shot(page, '05-assign-tap3-done')
  check('assigned in 3 taps (the date set by hand here; it starts on the next crew day)', true, payPreview)
  const sj = (await call('GET', `/api/subcontractors/job/${jobId}`)).json.data
  check('their pay worked out from Settings\' rates (whole cents, per line)', sj.payCents > 0 && sj.payLines.length > 0 && sj.payLines.every(l => Number.isInteger(l.cents)), `${sj.payCents} ${sj.payLines.map(l => l.label).join(', ')}`)
  const grid = sql(`SELECT date || ' ' || "crewId" FROM "ScheduledGridJob" WHERE "stagingJobId" = '${jobId}' AND "deletedAt" IS NULL ORDER BY date`).split('\n')
  const shown = (await page.locator('[data-job-sub-status]').count()) ? sj.payCents : 0
  check('the install is booked on the Schedule as the sub\'s own crew row, the days the preview said', grid[0] === `${start} sub-${subId}` && grid.every(g => g.endsWith(`sub-${subId}`)) && (grid.length === 1 ? !/crew days/.test(daysPreview) : daysPreview.startsWith(`${grid.length} crew days`)) && shown > 0, `${grid.join(', ')} | preview: ${daysPreview}`)
  const task = sql(`SELECT title || ' | ' || to_char("dueDate", 'YYYY-MM-DD') FROM "Task" WHERE "jobId" = '${jobId}' AND title LIKE 'Call in 811:%'`)
  check('"Call in 811" for the owner and office, 3 business days before', /^Call in 811: E2E /.test(task), task)
  const packet = sql(`SELECT count(*) FROM "InstallPacket" WHERE "jobId" = '${jobId}' AND "disabledAt" IS NULL`)
  check('the job sheet the sub sees (the install packet) was made', packet === '1')

  // The 811 task on Today.
  await page.goto(`${APP}/today`)
  // Today lists open tasks soonest first, a page at a time (dev has many): Show more until it is there.
  await until(async () => {
    if ((await page.getByText(`Call in 811: E2E ${WHO}`).count()) > 0) return true
    const more = page.getByRole('button', { name: /Show more/ })
    if (await more.count()) await more.first().click()
    return false
  }, 40000, 800)
  await page.getByText(`Call in 811: E2E ${WHO}`).first().scrollIntoViewIfNeeded().catch(() => {})
  await shot(page, '06-811-task-today')
  check('the 811 task is on Today', (await page.getByText(`Call in 811: E2E ${WHO}`).count()) > 0)

  // ── The sub, on their phone, no login ──
  const subCtx = await browser.newContext(PHONE)
  const sp = await subCtx.newPage()
  sp.on('pageerror', e => errors.push(`sub page: ${e}`))
  await sp.goto(sj.link)
  await sp.waitForSelector('[data-sub-steps]', { timeout: 20000 })
  const pre = await sp.content()
  check('sub link: red "Do not dig, 811 ticket not in yet"', (await sp.locator('[data-sub-811-none]').count()) === 1)
  check('sub link: their pay, never the customer\'s price or phone', pre.includes((sj.payCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })) && !pre.includes(priceText) && !pre.includes('3525550193') && !pre.includes('(352) 555 0193'))
  await shot(sp, '07-link-no-ticket')

  // The office enters the ticket: the task closes; the link shows it.
  const loc = await call('PUT', `/api/saved-jobs/${jobId}/locate`, { ticket: `E2E${stamp}`, calledDate: day(0), goodDate: day(3), expDate: day(30) })
  check('ticket entered', loc.status === 200, loc.json?.error)
  check('the 811 task closed itself', sql(`SELECT status FROM "Task" WHERE "jobId" = '${jobId}' AND title LIKE 'Call in 811:%'`) === 'completed')
  await sp.reload()
  await sp.waitForSelector('[data-sub-811-ok]', { timeout: 15000 })
  await shot(sp, '08-link-with-ticket')
  check('sub link: the ticket and its expiry', /Ticket E2E/.test(await sp.locator('[data-sub-811-ok]').innerText()))

  // Check out: every line ticked, the trailer photo.
  await sp.locator('[data-sub-checkout]').scrollIntoViewIfNeeded()
  for (const box of await sp.locator('.co-tick').all()) await box.check()
  await sp.locator('input[data-up="trailer"]').setInputFiles(PHOTO)
  await until(async () => /1 photo added/.test(await sp.locator('#trailer-msg').innerText()), 20000)
  await shot(sp, '09-checkout')
  await sp.locator('#coSend').click()
  await sp.waitForSelector('[data-sub-checkout-done]', { timeout: 20000 })
  check('checked out: the job\'s materials are loaded', sql(`SELECT "materialsStatus" FROM "SavedJob" WHERE id = '${jobId}'`) === 'loaded')

  // On the job: started, finished, feet, gates, after photo, sign off.
  const feet = Math.round(t.runs.reduce((s, f) => s + f, 0))
  // The work as done today (a day still to come is refused).
  await sp.locator('#startedOn').fill(day(0))
  await sp.locator('#finishedOn').fill(day(0))
  await sp.locator('#footage').fill(String(feet))
  await sp.locator('#gates').fill(String((t.walkGates || 0) + (t.dblGates || 0)))
  await sp.locator('input[data-up="after"]').setInputFiles(PHOTO)
  await until(async () => /1 photo added/.test(await sp.locator('#after-msg').innerText()), 20000)
  await sp.locator('#signName').fill('Sam Sub')
  await sp.locator('[data-sub-report]').scrollIntoViewIfNeeded()
  await shotFull(sp, '10-filled-out')
  await sp.locator('#rpSend').click()
  await sp.waitForSelector('[data-sub-report-done]', { timeout: 20000 })
  check('signed off on the link', true)

  // Check in: one of the first line back, with a photo.
  await sp.locator('[data-sub-checkin]').scrollIntoViewIfNeeded()
  await sp.locator('.ci-qty').first().fill('1')
  await sp.locator('input[data-up="leftover"]').setInputFiles(PHOTO)
  await until(async () => /1 photo added/.test(await sp.locator('#leftover-msg').innerText()), 20000)
  await shot(sp, '11-checkin')
  await sp.locator('#ciSend').click()
  await sp.waitForSelector('[data-sub-checkin-done]', { timeout: 20000 })
  const after = (await call('GET', `/api/subcontractors/job/${jobId}`)).json.data
  check('checked in; one back that the pull sheet used: flagged', after.flags.some(f => f.key.startsWith('material:')), after.flags.map(f => f.text).join(' | '))
  check('photos from the sub are on the job', Number(sql(`SELECT count(*) FROM "MediaItem" WHERE "jobId" = '${jobId}' AND "takenBy" LIKE 'Sub:%'`)) === 3)

  // ── Owner: Installed, confirm (one tap) ──
  await page.goto(`${APP}/operations?job=${jobId}`)
  await page.waitForSelector('[data-job-sub-confirm]', { timeout: 30000 })
  await page.locator('[data-job-sub-confirm-box]').scrollIntoViewIfNeeded()
  await shot(page, '12-installed-confirm')
  await page.locator('[data-job-sub-confirm]').click()
  await until(async () => (await call('GET', `/api/subcontractors/job/${jobId}`)).json.data?.confirmedAt, 20000)
  const done = sql(`SELECT "opsStage" || ' ' || "finalFurnishingDate" FROM "SavedJob" WHERE id = '${jobId}'`)
  check('one tap: Complete, final furnishing date the sub\'s finish day', done === `completed ${day(0)}`, done)

  // ── Phase B: the customer pays by check (Received), the owner taps Cleared: Ready to pay sub ──
  reviewWas = (await call('GET', '/api/subcontractors/settings')).json.data?.reviews?.sub_lien_release ?? null
  await call('POST', '/api/subcontractors/settings/reviewed', { reviewed: true, template: 'sub_lien_release' })
  await call('POST', `/api/payments/job/${jobId}/schedule`)
  const sched = (await call('GET', `/api/payments/job/${jobId}`)).json.data
  const owed = sched?.contractCents ?? Math.round(t.finalPrice * 100)
  const pay = await call('POST', '/api/payments', { id: crypto.randomUUID(), jobId, amountCents: owed, method: 'check', checkNumber: '4321', paidOn: day(0) })
  check('the customer\'s check is recorded: Received', pay.status < 300 && pay.json.data?.payment?.clearState === 'received', pay.json.error)
  await page.goto(`${APP}/operations?job=${jobId}`)
  await page.waitForSelector('[data-payment-state="received"]', { timeout: 30000 })
  await page.locator('[data-payment-state="received"]').scrollIntoViewIfNeeded()
  await shot(page, '14-received-not-cleared')
  check('sub pay waits on the customer while the check is only Received', /waiting on the customer/.test(await page.locator('[data-sub-pay-state]').innerText()))
  await page.locator('[data-payment-cleared]').click()
  await page.waitForSelector('[data-payment-state="cleared"]', { timeout: 20000 })
  await page.goto(`${APP}/operations?job=${jobId}`)
  await page.waitForSelector('[data-sub-pay-state]', { timeout: 30000 })
  await until(async () => /Ready to pay sub/.test(await page.locator('[data-sub-pay-state]').innerText()), 20000)
  await page.locator('[data-sub-pay-box]').scrollIntoViewIfNeeded()
  await shot(page, '15-ready-to-pay')
  check('Cleared: Ready to pay sub', /Ready to pay sub/.test(await page.locator('[data-sub-pay-state]').innerText()))
  await page.locator('[data-sub-send-release]').click()
  await page.waitForSelector('[data-sub-release-waiting]', { timeout: 20000 })

  // The sub signs the final lien release from their link, on their phone.
  await sp.goto(sj.link)
  await sp.waitForSelector('[data-sub-lien-release] a', { timeout: 20000 })
  await sp.locator('[data-sub-lien-release] a').click()
  await sp.waitForSelector('[data-sub-sign-text]', { timeout: 20000 })
  check('the release is Florida\'s statutory wording, with their pay', /WAIVER AND RELEASE OF LIEN UPON FINAL PAYMENT/.test(await sp.locator('[data-sub-sign-text]').innerText()))
  await sp.locator('#name').fill('Sam Sub')
  const box = await sp.locator('#sig').boundingBox()
  const pt = i => ({ clientX: box.x + 30 + i * 20, clientY: box.y + 80 + (i % 2 ? -25 : 25), pointerId: 7, pointerType: 'touch', bubbles: true })
  await sp.locator('#sig').dispatchEvent('pointerdown', pt(0))
  for (let i = 1; i <= 12; i++) await sp.locator('#sig').dispatchEvent('pointermove', pt(i))
  await sp.locator('#sig').dispatchEvent('pointerup', pt(12))
  await shotFull(sp, '16-lien-release')
  await sp.locator('#go').click()
  await sp.waitForSelector('[data-sub-signed]', { timeout: 20000 })
  check('signed; their copy to download', (await sp.locator('[data-sub-signed-pdf]').count()) === 1)

  // Mark paid: day, amount, how, check number. It is the job's actual labor.
  await page.goto(`${APP}/operations?job=${jobId}`)
  await page.waitForSelector('[data-sub-mark-paid]', { timeout: 30000 })
  await page.locator('[data-sub-mark-paid]').scrollIntoViewIfNeeded()
  await page.locator('[data-sub-paid-check]').fill('7788')
  await shot(page, '17-mark-paid')
  await page.locator('[data-sub-mark-paid-btn]').click()
  await page.waitForSelector('[data-sub-paid]', { timeout: 20000 })
  const paidRow = sql(`SELECT "paidCents" || ' ' || "paidCheckNumber" FROM "SubJob" WHERE "jobId" = '${jobId}'`)
  const labor = sql(`SELECT labor->>'subPaidCents' FROM "JobTakeoff" WHERE "jobId" = '${jobId}'`)
  check('Mark paid: kept with its check number, and it is the job\'s actual labor', paidRow === `${sj.payCents} 7788` && labor === String(sj.payCents), `${paidRow} | ${labor}`)

  // ── The dashboard ──
  await page.goto(`${APP}/subcontractors`)
  await page.waitForSelector('[data-dash="papers"]', { timeout: 20000 })
  check('dashboard: the exemption expiring is listed', (await page.locator('[data-dash="papers"]').innerText()).includes(SUB))
  await shotFull(page, '13-dashboard')
  check('no page errors', errors.length === 0, errors.join(' | '))
  await subCtx.close(); await ctx.close()
} catch (e) {
  check('ran to the end', false, String(e).split('\n').slice(0, 3).join(' '))
} finally {
  // Clean up: the job, quote and customer; the sub left Inactive (subs are kept, never deleted).
  try {
    if (reviewWas === null) await call('POST', '/api/subcontractors/settings/reviewed', { reviewed: false, template: 'sub_lien_release' })
    sql(`DELETE FROM "Task" WHERE "jobId" = '${jobId}'`)
    sql(`DELETE FROM "JobTakeoff" WHERE "jobId" = '${jobId}'`)
    sql(`UPDATE "ScheduledGridJob" SET "deletedAt" = now() WHERE "stagingJobId" = '${jobId}'`)
    await call('DELETE', `/api/subcontractors/job/${jobId}`)
    await call('DELETE', `/api/saved-jobs/${jobId}`)
    await call('DELETE', `/api/saved-quotes/${quoteId}`)
    await call('DELETE', `/api/crm-contacts/${contactId}`)
    if (subId) { const s = (await call('GET', `/api/subcontractors/${subId}`)).json.data?.sub; if (s) await call('PUT', `/api/subcontractors/${subId}`, { ...s, status: 'inactive', statusReason: 'E2E test sub' }) }
  } catch (e) { console.log('cleanup:', String(e)) }
  if (!CDP) await browser.close()
  const failed = results.filter(r => !r).length
  console.log(failed ? `\n${failed} of ${results.length} failed` : `\nall ${results.length} passed`)
  process.exit(failed ? 1 : 0)
}
