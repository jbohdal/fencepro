// Subcontractors Phase C on a phone sized screen, on the dev copy (Jonathan, Nov 6 2026).
//
//   E2E_ACCESS_TOKEN=<dev owner token> E2E_STAFF_COOKIE=<cookie> E2E_SHOTS=<folder> node e2e/sub-liens.mjs
//
// The customer: a new proposal over $2,500 shows Florida's 713.015 notice in bold capitals before signing; signed.
// The owner: an installed job not paid, its lien clock (day of 90), a notice of intent made (the paper reviewed for
// the run, the mark put back after); the Subs dashboard with the lien clocks and the year's pay (1099 CSV). Its
// customer, quote and job are deleted at the end.

import './devOnly.mjs'
import './sharedLock.mjs'
import { webkit } from 'playwright'
import { signInByCookie } from './lib.mjs'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || 'http://localhost:4001'
const OWNER = process.env.E2E_ACCESS_TOKEN || ''
const SHOTS = process.env.E2E_SHOTS || ''
if (!/^http:\/\/localhost:\d+$/.test(APP) || /:4000$/.test(APP) || /:4000$/.test(API)) { console.error('Refusing to run: the dev copy only (localhost, not port 4000).'); process.exit(2) }
if (!OWNER) { console.error('Set E2E_ACCESS_TOKEN (an owner login on the dev server).'); process.exit(2) }
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const call = async (method, p, body) => {
  const r = await fetch(`${API}${p}`, { method, headers: { Authorization: `Bearer ${OWNER}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await r.text(); let json = {}; try { json = JSON.parse(text) } catch { /* html */ }
  return { status: r.status, json, text }
}
async function until(fn, ms = 20000, every = 500) { const end = Date.now() + ms; for (;;) { const v = await fn().catch(() => null); if (v || Date.now() > end) return v; await sleep(every) } }
const sql = q => execFileSync('psql', ['-d', 'ezbiz_dev', '-At', '-c', q]).toString().trim()
const shot = async (page, name, full = false) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `liens-${name}.png`), fullPage: full }).catch(() => {}) }
const day = d => new Date(Date.now() + d * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })

const stamp = Date.now().toString(36).slice(-5)
const WHO = `Lien ${stamp}`
const contactId = crypto.randomUUID(), quoteId = crypto.randomUUID()
let jobId = crypto.randomUUID()
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
const browser = await webkit.launch()
const errors = []
let reviewWas = 'unknown'
// The company address the papers need (dev's is blank): set for the run, put back after.
let addressWas = null
try {
  const all = (await call('GET', '/api/saved-quotes')).json.data ?? []
  const t = all.filter(q => !/^E2E/i.test(q.customerName) && q.proposal?.options?.length >= 1 && q.finalPrice > 3000 && !q.work && !q.acceptedAt && q.status !== 'SOLD' && Array.isArray(q.pullSheet) && q.pullSheet.length > 4)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0]
  if (!t) throw new Error('no unsent priced quote over $3,000 to copy on dev')
  const priced = ['fenceStyle', 'runs', 'runRails', 'corners', 'ends', 'walkGates', 'dblGates', 'tearOutSections', 'tearOutGates', 'adjLaborHrs', 'hasSalesman', 'priceAdjust', 'sections', 'materialCost', 'laborCost', 'tearOutCost', 'totalCOGS', 'finalPrice', 'gmPct', 'pullSheet', 'pricing']
  await call('POST', '/api/crm-contacts', { id: contactId, firstName: 'E2E', lastName: WHO, phone: '3525550195', serviceAddress: '11 Lien Ln, Ocala, FL 34470', leadSource: 'Other' })
  const prop = { ...t.proposal }
  delete prop.terms; delete prop.lienNotice
  const q = await call('POST', '/api/saved-quotes', { id: quoteId, ...Object.fromEntries(priced.map(k => [k, t[k]])), layout: { yard: null, runSections: t.layout?.runSections ?? [] }, proposal: prop, crmContactId: contactId, customerName: `E2E ${WHO}`, customerPhone: '3525550195', customerAddress: '11 Lien Ln, Ocala, FL 34470', leadSource: 'Other', salesRep: 'E2E', date: day(0), status: 'DRAFT' })
  const saved = (await call('GET', '/api/saved-quotes')).json.data.find(x => x.id === quoteId)
  check('a new quote over $2,500 carries the 713.015 notice', q.status < 300 && /^ACCORDING TO FLORIDA'S CONSTRUCTION LIEN LAW/.test(saved?.proposal?.lienNotice ?? ''), `${q.status} ${q.json.error ?? ''}`)

  // ── The customer, on a phone: the notice before signing ──
  const tk = (await call('POST', `/api/saved-quotes/${quoteId}/share-token`)).json; const token = tk.shareToken ?? tk.data?.shareToken ?? tk.token
  const cust = await browser.newContext(PHONE)
  const cp = await cust.newPage()
  cp.on('pageerror', e => errors.push(`customer: ${e}`))
  await cp.goto(`${API}/p/${token}`)
  await cp.waitForSelector('[data-lien-notice]', { timeout: 20000 })
  const notice = cp.locator('[data-lien-notice] p').first()
  const style = await notice.evaluate(el => { const s = getComputedStyle(el); return { size: parseFloat(s.fontSize), weight: Number(s.fontWeight), upper: s.textTransform } })
  check('the notice: at least 12 point (16 px), bold, capitals', style.size >= 16 && style.weight >= 700 && style.upper === 'uppercase', JSON.stringify(style))
  const order = await cp.evaluate(() => { const n = document.querySelector('[data-lien-notice]'), a = document.querySelector('#accept'); return !!n && !!a && (n.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING) > 0 })
  check('the notice is read before the signature', order)
  await cp.locator('[data-lien-notice]').scrollIntoViewIfNeeded()
  await shot(cp, '01-notice-before-signing')
  const opt = cp.locator('.opt[data-option]').first()
  if (await opt.count()) await opt.click()
  await cp.locator('#name').fill(`E2E ${WHO}`)
  const sig = await cp.locator('#sig').boundingBox()
  const pt = i => ({ clientX: sig.x + 30 + i * 20, clientY: sig.y + 80 + (i % 2 ? -25 : 25), pointerId: 7, pointerType: 'touch', bubbles: true })
  await cp.locator('#sig').dispatchEvent('pointerdown', pt(0))
  for (let i = 1; i <= 12; i++) await cp.locator('#sig').dispatchEvent('pointermove', pt(i))
  await cp.locator('#sig').dispatchEvent('pointerup', pt(12))
  await cp.locator('#go').click()
  await cp.waitForSelector('[data-accepted]', { timeout: 30000 })
  check('signed on the link', true)
  await cust.close()

  // ── The owner: an installed job, nothing paid: the lien clock ──
  const ffd = day(-31)
  const j = await call('POST', '/api/saved-jobs', { id: jobId, quoteId, crmContactId: contactId, customerName: `E2E ${WHO}`, customerAddress: '11 Lien Ln, Ocala, FL 34470', fenceStyle: t.fenceStyle, sections: t.sections, quotePrice: t.finalPrice, contractValue: t.finalPrice, status: 'completed', completedDate: ffd })
  // The job as the server made it (it keeps its own id when the quote already has a job).
  jobId = j.json.data?.id ?? jobId
  sql(`UPDATE "SavedJob" SET "finalFurnishingDate" = '${ffd}', "completedDate" = '${ffd}' WHERE id = '${jobId}'`)
  await call('POST', `/api/payments/job/${jobId}/schedule`)
  check('set up: an installed job, final furnishing date 31 days ago, nothing paid', j.status < 300 && sql(`SELECT "finalFurnishingDate" FROM "SavedJob" WHERE id = '${jobId}'`) === ffd, `${j.status} ${j.json.error ?? ''}`)
  reviewWas = (await call('GET', '/api/subcontractors/settings')).json.data?.reviews?.notice_of_intent ?? null
  addressWas = sql(`SELECT coalesce(config->'company'->>'address', '') FROM "BusinessState" ORDER BY "createdAt" LIMIT 1`)
  if (!addressWas) sql(`UPDATE "BusinessState" SET config = jsonb_set(config, '{company,address}', '"100 Test Rd, Ocala, FL 34470"') WHERE id = (SELECT id FROM "BusinessState" ORDER BY "createdAt" LIMIT 1)`)
  const ctx = await browser.newContext(PHONE)
  await signInByCookie(ctx)
  const page = await ctx.newPage()
  page.on('pageerror', e => errors.push(String(e)))
  await page.goto(`${APP}/operations?job=${jobId}`)
  await page.waitForSelector('[data-lien-clock]', { timeout: 30000 })
  await page.locator('[data-job-lien]').scrollIntoViewIfNeeded()
  const clock = await page.locator('[data-lien-clock]').innerText()
  check('the lien clock: day 31 of 90', /day 31 of 90/.test(clock), clock)
  check('a paper is locked until the attorney review', /attorney review required/.test(await page.locator('[data-lien-paper="notice_of_intent"]').innerText()) && await page.locator('[data-lien-paper="notice_of_intent"]').isDisabled())
  await shot(page, '02-lien-clock-locked')
  await call('POST', '/api/subcontractors/settings/reviewed', { reviewed: true, template: 'notice_of_intent' })
  await page.goto(`${APP}/operations?job=${jobId}`)
  await page.waitForSelector('[data-lien-paper="notice_of_intent"]:not([disabled])', { timeout: 30000 })
  await page.locator('[data-job-lien]').scrollIntoViewIfNeeded()
  const popup = page.waitForEvent('popup', { timeout: 15000 }).catch(() => null)
  await page.locator('[data-lien-paper="notice_of_intent"]').click()
  await popup
  await until(async () => (await page.locator('[data-lien-actions] li').count()) > 0, 15000)
  const act = await page.locator('[data-lien-actions] li').first().innerText()
  check('notice of intent made, kept with its day and how it was sent', /Notice of intent to lien · Certified mail/.test(act), act)
  await shot(page, '03-lien-notice-made')

  // ── The dashboard: lien clocks, contracts without the notice, the year's pay ──
  await page.goto(`${APP}/subcontractors`)
  await page.waitForSelector('[data-dash="liens"]', { timeout: 30000 })
  check('dashboard: the job on the lien clock', (await page.locator('[data-dash="liens"]').innerText()).includes(`E2E ${WHO}`))
  check('dashboard: the year\'s pay with its CSV', (await page.locator('[data-dash-ytd-csv]').count()) === 1)
  await shot(page, '04-dashboard', true)
  check('no page errors', errors.length === 0, errors.join(' | '))
  await ctx.close()
} catch (e) {
  check('ran to the end', false, String(e).split('\n').slice(0, 3).join(' '))
} finally {
  try {
    if (reviewWas === null) await call('POST', '/api/subcontractors/settings/reviewed', { reviewed: false, template: 'notice_of_intent' })
    if (addressWas === '') sql(`UPDATE "BusinessState" SET config = jsonb_set(config, '{company,address}', '""') WHERE id = (SELECT id FROM "BusinessState" ORDER BY "createdAt" LIMIT 1)`)
    sql(`DELETE FROM "LienCase" WHERE "jobId" = '${jobId}'`)
    await call('DELETE', `/api/saved-jobs/${jobId}`)
    await call('DELETE', `/api/saved-quotes/${quoteId}`)
    await call('DELETE', `/api/crm-contacts/${contactId}`)
  } catch (e) { console.log('cleanup:', String(e)) }
  await browser.close()
  const failed = results.filter(r => !r).length
  console.log(failed ? `\n${failed} of ${results.length} failed` : `\nall ${results.length} passed`)
  process.exit(failed ? 1 : 0)
}
