// Florida's lien notice addendum on a phone sized screen, on the dev copy (Jonathan, Nov 6 2026: "prepare the
// signed notice addendum for the 11 contracts not installed yet, locked until I mark it attorney reviewed; don't
// send until then. Leave the installed ones alone.").
//
//   JOB_ID=<a job on the list> E2E_OWNER_COOKIE=<owner cookie> E2E_OFFICE_COOKIE=<office cookie> \
//     APP_URL=http://localhost:4012 API_URL=http://localhost:4012 E2E_SHOTS=<folder> node e2e/lien-notice-addendum.mjs
//
// The office sees it locked (the send buttons say why); the owner marks it reviewed; the office emails it (the
// dev outbox only, apps/portal/logs/dev-outbox.log) and copies the link; the customer opens the link on a phone and
// signs; the signed copy is with the job's Documents; it leaves the owner's list. Afterwards everything it made is
// taken off and the review mark is put back as it was.

import './devOnly.mjs'
import './sharedLock.mjs'
import { webkit } from 'playwright'
import { signInByCookie } from './lib.mjs'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { execFileSync } from 'child_process'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || APP
const JOB = process.env.JOB_ID || ''
const OWNER = process.env.E2E_OWNER_COOKIE || ''
const OFFICE = process.env.E2E_OFFICE_COOKIE || ''
const SHOTS = process.env.E2E_SHOTS || ''
if (!/^http:\/\/localhost:\d+$/.test(APP) || /:4000$/.test(APP) || /:4000$/.test(API)) { console.error('Refusing to run: the dev copy only (localhost, not port 4000).'); process.exit(2) }
if (!JOB || !OWNER || !OFFICE) { console.error('Set JOB_ID, E2E_OWNER_COOKIE and E2E_OFFICE_COOKIE (scripts/dev-session-token.ts --cookie).'); process.exit(2) }
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })

const here = path.dirname(fileURLToPath(import.meta.url))
const OUTBOX = path.resolve(here, '../../portal/logs/dev-outbox.log')
const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
async function until(fn, ms = 20000, every = 400) { const end = Date.now() + ms; for (;;) { const v = await fn().catch(() => null); if (v || Date.now() > end) return v; await sleep(every) } }
const sql = q => execFileSync('psql', ['-d', 'ezbiz_dev', '-At', '-c', q]).toString().trim()
const shot = async (page, name, full = false) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `addendum-${name}.png`), fullPage: full }).catch(() => {}) }
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }

const job = sql(`SELECT "quoteId" || '|' || "accountId" FROM "SavedJob" WHERE id = '${JOB.replace(/'/g, '')}'`).split('|')
const [quoteId, accountId] = job
if (!quoteId) { console.error('No such job on ezbiz_dev.'); process.exit(2) }
if (sql(`SELECT count(*) FROM "LienNoticeAddendum" WHERE "quoteId" = '${quoteId}'`) !== '0') { console.error('This job already has an addendum; pick another (this test takes off what it makes).'); process.exit(2) }
const reviewWas = sql(`SELECT value::text FROM "AccountKeyValue" WHERE "accountId" = '${accountId}' AND key = 'lien-notice-addendum:review'`)
const outboxBefore = fs.existsSync(OUTBOX) ? fs.readFileSync(OUTBOX, 'utf8').split('\n').filter(Boolean).length : 0
const started = new Date().toISOString()

const browser = await webkit.launch()
const errors = []
async function staff(cookie) {
  const ctx = await browser.newContext(PHONE)
  await signInByCookie(ctx, { cookie, api: API })
  const page = await ctx.newPage()
  page.on('pageerror', e => errors.push(String(e)))
  page.on('dialog', d => d.accept())
  return { ctx, page }
}
async function openJob(page) {
  await page.goto(`${APP}/operations?job=${JOB}`)
  await page.waitForSelector('[data-job-lien-addendum]', { timeout: 30000 })
  await page.locator('[data-job-lien-addendum]').scrollIntoViewIfNeeded()
}
const stateOf = page => page.locator('[data-job-lien-addendum]').getAttribute('data-job-lien-addendum')

try {
  // ── The office: prepared, locked; the send buttons say why ──
  const office = await staff(OFFICE)
  await openJob(office.page)
  check('office: the addendum is prepared and locked', await stateOf(office.page) === 'locked', await stateOf(office.page))
  const lockText = await office.page.locator('[data-addendum-locked]').innerText()
  check('office: it says "Locked until Jonathan marks it attorney reviewed."', /Locked until Jonathan marks it attorney reviewed\./.test(lockText), lockText)
  const disabled = await Promise.all(['text', 'email', 'copy'].map(k => office.page.locator(`[data-addendum-${k}]`).isDisabled()))
  check('office: Text it, Email it and Copy link cannot be tapped', disabled.every(Boolean), JSON.stringify(disabled))
  check('office: no review button for the office', (await office.page.locator('[data-addendum-mark]').count()) === 0)
  await office.page.locator('[data-job-lien-addendum] summary').click()
  const words = await office.page.locator('[data-addendum-words]').innerText()
  check('office: the words name the contract and carry the notice', /This addendum is part of the contract between .+ signed .+\$[\d,]+\.\d{2}/.test(words) && /ACCORDING TO FLORIDA'S CONSTRUCTION LIEN LAW/i.test(words), words.slice(0, 160))
  await shot(office.page, '01-office-locked')

  // ── The owner: marks it reviewed by an attorney ──
  const owner = await staff(OWNER)
  await openJob(owner.page)
  check('owner: "Attorney review required" with the mark button', /Attorney review required/.test(await owner.page.locator('[data-addendum-review]').innerText()))
  await owner.page.locator('[data-addendum-mark]').click()
  check('owner: marked reviewed, ready to send', !!(await until(async () => (await stateOf(owner.page)) === 'ready', 15000)), await stateOf(owner.page))
  await shot(owner.page, '02-owner-reviewed')

  // ── The office: email it (dev outbox only), then copy the link ──
  await openJob(office.page)
  check('office: ready to send after the owner marked it', await stateOf(office.page) === 'ready')
  await office.page.locator('[data-addendum-email]').click()
  const held = await until(async () => {
    const lines = fs.existsSync(OUTBOX) ? fs.readFileSync(OUTBOX, 'utf8').split('\n').filter(Boolean).slice(outboxBefore).map(l => JSON.parse(l)) : []
    return lines.find(l => l.channel === 'email' && /Florida construction lien notice/.test(l.title)) ?? null
  }, 15000)
  check('office: Email it landed in the dev outbox, not sent', !!held && /\/p\/ln\/[A-Za-z0-9_-]{20,}/.test(held.body ?? ''), held ? `${held.to}: ${held.title}` : 'nothing in the outbox')
  await sleep(800)
  await shot(office.page, '03-office-email-held')
  check('office: not marked sent when the email was held', await stateOf(office.page) === 'ready', await stateOf(office.page))
  await office.page.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {})
  await office.page.locator('[data-addendum-copy]').click()
  const link = await until(async () => { const t = await office.page.locator('[data-addendum-link]').innerText(); return /\/p\/ln\//.test(t) ? t.trim() : null }, 15000)
  check('office: Copy link shows the link and it is marked sent', !!link && (await until(async () => (await stateOf(office.page)) === 'sent', 10000)), link ?? '')
  await shot(office.page, '04-office-sent')

  // ── The customer, on their phone: reads and signs ──
  const cust = await browser.newContext(PHONE)
  const cp = await cust.newPage()
  cp.on('pageerror', e => errors.push(`customer: ${e}`))
  const url = new URL(link); const local = `${API}${url.pathname}`
  await cp.goto(local)
  await cp.waitForSelector('[data-lien-notice]', { timeout: 20000 })
  const style = await cp.locator('[data-lien-notice] p').first().evaluate(el => { const s = getComputedStyle(el); return { size: parseFloat(s.fontSize), weight: Number(s.fontWeight), upper: s.textTransform } })
  check('customer: the notice in 16 px bold capitals', style.size >= 16 && style.weight >= 700 && style.upper === 'uppercase', JSON.stringify(style))
  const contractLine = await cp.locator('[data-ln-contract]').innerText()
  check('customer: it names the original contract', /This addendum is part of the contract between/.test(contractLine), contractLine)
  const wide = await cp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
  check('customer: no sideways scroll on the phone', wide)
  await shot(cp, '05-customer-link', true)
  const name = (await cp.locator('#name').inputValue()) || 'Customer'
  await cp.locator('#sig').scrollIntoViewIfNeeded()
  const sig = await cp.locator('#sig').boundingBox()
  const pt = i => ({ clientX: sig.x + 30 + i * 20, clientY: sig.y + 60 + (i % 2 ? -20 : 20), pointerId: 7, pointerType: 'touch', bubbles: true })
  await cp.locator('#sig').dispatchEvent('pointerdown', pt(0))
  for (let i = 1; i <= 12; i++) await cp.locator('#sig').dispatchEvent('pointermove', pt(i))
  await cp.locator('#sig').dispatchEvent('pointerup', pt(12))
  await cp.locator('#go').click()
  await cp.waitForSelector('[data-ln-signed]', { timeout: 30000 })
  check('customer: signed on the link', (await cp.locator('[data-ln-signed]').innerText()).includes(`Signed by ${name}`))
  const pdfHref = await cp.locator('[data-ln-pdf]').getAttribute('href')
  const pdf = await cust.request.get(new URL(pdfHref, cp.url()).toString())
  check('customer: their signed copy (PDF)', pdf.ok() && pdf.headers()['content-type'] === 'application/pdf')
  await shot(cp, '06-customer-signed')
  await cust.close()

  // ── The office: signed, the signed copy with the job's Documents ──
  await openJob(office.page)
  check('office: the job says signed', await stateOf(office.page) === 'signed')
  const doc = office.page.locator('[data-signed-doc-kind="lien_notice"]')
  await until(async () => (await doc.count()) > 0, 15000)
  check('office: the signed lien notice is in the job\'s Documents', (await doc.count()) === 1, (await doc.count()) ? await doc.first().innerText() : '')
  await doc.first().scrollIntoViewIfNeeded()
  await shot(office.page, '07-office-documents')
  const popup = office.page.waitForEvent('popup', { timeout: 15000 }).catch(() => null)
  await doc.first().locator('[data-signed-doc-open]').click()
  check('office: the signed copy opens', !!(await popup))

  // ── The owner: it leaves the list of contracts without the notice ──
  await owner.page.goto(`${APP}/subcontractors`)
  await owner.page.waitForSelector('[data-dash="nonotice"]', { timeout: 30000 })
  const box = await owner.page.locator('[data-dash="nonotice"]').innerText()
  check('owner: the dashboard counts it signed, not on the list', /more signed the notice addendum/.test(box), box.slice(0, 200))
  await owner.page.locator('[data-dash="nonotice"]').scrollIntoViewIfNeeded()
  await shot(owner.page, '08-owner-dashboard')
  check('no page errors', errors.length === 0, errors.join(' | '))
  await owner.ctx.close(); await office.ctx.close()
} catch (e) {
  check('ran to the end', false, String(e).split('\n').slice(0, 3).join(' '))
} finally {
  try {
    // Everything it made comes off; the review mark goes back as it was.
    const docs = sql(`SELECT id || '|' || "fileKey" || '|' || coalesce("portalFileId", '') FROM "SignedDocument" WHERE kind = 'lien_notice' AND "quoteId" = '${quoteId}'`).split('\n').filter(Boolean)
    for (const d of docs) {
      const [id, fileKey, portalFileId] = d.split('|')
      fs.rmSync(path.resolve(here, '../../portal', process.env.UPLOAD_DIR || './uploads', fileKey), { force: true })
      sql(`DELETE FROM "SignedDocument" WHERE id = '${id}'`)
      if (portalFileId) sql(`DELETE FROM "PortalFile" WHERE id = '${portalFileId}'`)
    }
    sql(`DELETE FROM "LienNoticeAddendum" WHERE "quoteId" = '${quoteId}'`)
    if (reviewWas) sql(`UPDATE "AccountKeyValue" SET value = '${reviewWas.replace(/'/g, "''")}'::jsonb WHERE "accountId" = '${accountId}' AND key = 'lien-notice-addendum:review'`)
    else sql(`DELETE FROM "AccountKeyValue" WHERE "accountId" = '${accountId}' AND key = 'lien-notice-addendum:review'`)
    sql(`DELETE FROM "CrmAuditLog" WHERE "entityType" IN ('LienNoticeAddendum', 'LienNoticeAddendumReview') AND "createdAt" >= '${started}'`)
  } catch (e) { console.log('cleanup:', String(e)) }
  await browser.close()
  const failed = results.filter(r => !r).length
  console.log(failed ? `\n${failed} of ${results.length} failed` : `\nall ${results.length} passed`)
  process.exit(failed ? 1 : 0)
}
