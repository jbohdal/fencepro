// Audit #47 and #48 (Oct 28 2026), used as the right person on a phone (393 x 852, WebKit).
//
//   APP_URL=http://localhost:4094 OFFICE_COOKIE=<office> SALES_COOKIE=<Salesman> OWNER_COOKIE=<owner> \
//   INSTALLER_COOKIE=<Installer> E2E_STAFF_COOKIE=x SHOTS=<folder> node e2e/audit-47-48.mjs
//   (cookies: cd apps/portal && npx tsx scripts/dev-session-token.ts --cookie --email <login> --out <file>)
//
// #47, the office: a job whose 811 locate is saved clear moves on by itself; on her phone she saves the permit
//   Approved (it moves on by itself again), then taps Materials Ordered. The job's Job history says each move,
//   from → to, by her name or "automatically" with the reason, with the Florida date and time, and the
//   materials change; it fits the phone. The owner on a computer sees the same after a reload. An Installer
//   cannot read it.
// #48, the Salesman: Save quote, New Customer, a phone on file with the same name: the quote goes on that
//   customer and an email typed that they have none of is added (said before Save); for a customer with
//   another email on file, the dialog says the typed one is not saved, and theirs stays.
// Makes its own customers, quotes and a job (AUDIT4748 …); removes them at the end (soft delete through the
// app; the dev database rows are removed by the caller with the CLEANUP-TAG printed).

import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import { chromium, webkit } from 'playwright'
import fs from 'fs'
import { signInByCookie } from './lib.mjs'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || APP
const { OFFICE_COOKIE: OFFICE = '', SALES_COOKIE: SALES = '', OWNER_COOKIE: OWNER = '', INSTALLER_COOKIE: INSTALLER = '', SHOTS = '' } = process.env
if (!OFFICE || !SALES || !OWNER) { console.error('Set OFFICE_COOKIE, SALES_COOKIE and OWNER_COOKIE.'); process.exit(2) }
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false }) }
const stamp = Date.now().toString(36)
const tag = `AUDIT4748 ${stamp}`
const H = { 'X-Staff-Request': '1', 'Content-Type': 'application/json' }
const made = { contacts: [], quotes: [], jobs: [] }
const digits4 = () => String(1000 + Math.floor(Math.random() * 8999))

async function apiOf(ctx) {
  return async (method, path, data) => {
    const r = await ctx.request.fetch(`${API}${path}`, { method, headers: H, ...(data === undefined ? {} : { data }) })
    const j = await r.json().catch(() => null)
    if (!r.ok()) throw Object.assign(new Error(`${method} ${path}: ${r.status()} ${JSON.stringify(j).slice(0, 300)}`), { status: r.status() })
    return j?.data ?? j
  }
}
const PHONE = { viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }
const wk = await webkit.launch()
const cr = await chromium.launch()
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
let ownerApi
try {
  const owner = await cr.newContext({ viewport: { width: 1440, height: 900 } })
  await signInByCookie(owner, { cookie: OWNER, api: API })
  ownerApi = await apiOf(owner)
  const office = await wk.newContext(PHONE)
  const officeMe = await signInByCookie(office, { cookie: OFFICE, api: API })
  const officeApi = await apiOf(office)
  const officeName = `${officeMe.firstName ?? ''} ${officeMe.lastName ?? ''}`.trim()

  // ── #47: the office on her phone ──────────────────────────────────────────
  {
    const contact = await officeApi('POST', '/api/crm-contacts', { firstName: 'Dana', lastName: `${tag} Job`, phone: `352555${digits4()}`, serviceAddress: '1 Audit Ln, Ocala, FL 34470', status: 'customer' })
    made.contacts.push(contact.id)
    const job = await officeApi('POST', '/api/saved-jobs', { id: `job-audit47-${stamp}`, customerName: `Dana ${tag} Job`, customerAddress: '1 Audit Ln, Ocala, FL 34470', fenceStyle: "WV-ND 6'x8' Privacy", sections: 12, totalFeet: 96, contractValue: 4321, status: 'staging', opsStage: 'awaiting_locates', crmContactId: contact.id })
    made.jobs.push(job.id)
    // The 811 locate comes back clear (saved by the office): the job moves on to Permit Pending by itself.
    await officeApi('PUT', `/api/saved-jobs/${job.id}/locate`, { ticket: '302610280047', calledDate: today, goodDate: today, expDate: '2099-12-31' })
    const page = await office.newPage()
    const errors = []; page.on('pageerror', e => errors.push(String(e).slice(0, 200))); page.on('dialog', d => d.accept().catch(() => {}))
    await page.goto(`${APP}/operations?job=${job.id}`)
    const panel = page.locator(`[data-job-panel="${job.id}"]`)
    await panel.waitFor({ timeout: 60000 }); await sleep(1500)
    check('47. the job opens on Permit Pending (moved by itself)', (await panel.locator('[data-ops-stage-pill]').getAttribute('data-ops-stage-pill')) === 'permit_pending')
    // The permit comes back Approved: saved in the Permit box, the job moves on by itself.
    const permit = page.locator(`[data-permit-panel="${job.id}"]`)
    await permit.locator('[data-permit-status]').selectOption('approved')
    await permit.locator('[data-permit-save]').tap(); await sleep(4000)
    // She taps Materials Ordered (the order went in by phone).
    await panel.locator('[data-ops-stage-choice="materials_ordered"]').tap(); await sleep(4000)
    const hist = panel.locator('[data-job-timeline]')
    await hist.scrollIntoViewIfNeeded(); await sleep(500)
    const text = await hist.innerText()
    const lines = text.split('\n').filter(Boolean)
    console.log('     Job history:\n       ' + lines.join('\n       '))
    const idx = re => lines.findIndex(l => re.test(l))
    const iMan = idx(new RegExp(`Moved from Need Drawing to Materials Ordered.*${officeName}`))
    const iMat = idx(new RegExp(`Materials: Not ordered yet → Ordered.*${officeName}`))
    const iPermit = idx(/Moved from Permit Pending to Need Drawing automatically permit is Approved\. \(Permit saved, /)
    const iLocate = idx(/Moved from Awaiting Locates to Permit Pending automatically 811 locate is clear to dig\. \(811 locate saved, /)
    check('47. her move, by her name', iMan >= 0, lines[iMan] ?? '')
    check('47. the materials change, by her name', iMat >= 0, lines[iMat] ?? '')
    check('47. the two moves by itself, with the reason', iPermit >= 0 && iLocate >= 0)
    check('47. newest first', iMan < iPermit && iPermit < iLocate, `${iMan} ${iMat} ${iPermit} ${iLocate}`)
    check('47. Florida date and time on the moves', /^[A-Z][a-z]{2} \d{1,2},? (at )?\d{1,2}:\d{2} [AP]M /.test(lines[iMan] ?? ''), lines[iMan] ?? '')
    check('47. one line per move by itself (no second "by itself" line)', !/by itself/.test(text))
    check('47. no email addresses shown when the name is known', !/@example\.invalid/.test(text), text.match(/\S+@\S+/)?.[0] ?? '')
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    const histFits = await hist.evaluate(el => el.scrollWidth <= el.clientWidth + 1)
    check('47. fits a 393 px phone (no sideways scroll)', fits && histFits)
    await shot(page, '47-office-phone-job-history')
    check('47. no page errors', errors.length === 0, errors.join(' | '))
    await page.close()

    // The owner, another browser, after a reload: the same lines.
    const op = await owner.newPage()
    await op.goto(`${APP}/operations?job=${job.id}`)
    const oh = op.locator(`[data-job-panel="${job.id}"] [data-job-timeline]`)
    await oh.waitFor({ timeout: 60000 }); await sleep(1500)
    const ot = await oh.innerText()
    check('47. owner, second browser: sees the moves and who', ot.includes('Moved from Need Drawing to Materials Ordered') && ot.includes('Materials: Not ordered yet → Ordered') && ot.includes(officeName))
    await oh.scrollIntoViewIfNeeded(); await shot(op, '47-owner-desktop-job-history')
    await op.close()

    // An Installer: no Job history, and the server will not give it.
    if (INSTALLER) {
      const crew = await wk.newContext(PHONE)
      await signInByCookie(crew, { cookie: INSTALLER, api: API })
      const r = await crew.request.get(`${API}/api/change-orders/timeline?jobId=${job.id}`, { headers: H })
      check('47. Installer: the job history (it has the contract price) is refused', r.status() === 403, String(r.status()))
      await crew.close()
    }
  }

  // ── #48: the Salesman on her phone ────────────────────────────────────────
  {
    const sales = await wk.newContext(PHONE)
    await signInByCookie(sales, { cookie: SALES, api: API })
    const salesApi = await apiOf(sales)
    const pat = await officeApi('POST', '/api/crm-contacts', { firstName: 'Pat', lastName: `${tag} Noemail`, phone: `352555${digits4()}`, serviceAddress: '48 Pat St, Ocala, FL 34471', status: 'customer' })
    const kim = await officeApi('POST', '/api/crm-contacts', { firstName: 'Kim', lastName: `${tag} Hasemail`, phone: `352555${digits4()}`, email: `kim-${stamp}@example.invalid`, serviceAddress: '48 Kim St, Ocala, FL 34471', status: 'customer' })
    made.contacts.push(pat.id, kim.id)
    const quoteFor = async name => {
      const id = crypto.randomUUID()
      await salesApi('POST', '/api/saved-quotes', { id, customerName: name, customerAddress: '48 New Lot Rd, Ocala, FL 34471', date: today, status: 'DRAFT', fenceStyle: "WV-ND 6'x6' Privacy", runs: [60], corners: 0, ends: 2, sections: 10, finalPrice: 10, pullSheet: [] })
      made.quotes.push(id)
      return id
    }
    const page = await sales.newPage()
    const errors = []; page.on('pageerror', e => errors.push(String(e).slice(0, 200)))
    const openSave = async id => {
      await page.goto(`${APP}/?quote=${id}`)
      await page.waitForSelector('[data-quote-builder] [data-bar-price]', { timeout: 60000 }); await sleep(1500)
      await page.locator('[data-save-open]:visible').first().tap()
      await page.locator('[data-save-mode="new"]').waitFor({ timeout: 15000 })
      await page.locator('[data-save-mode="new"]').tap(); await sleep(300)
    }
    const contactNow = async id => { const all = await ownerApi('GET', '/api/crm-contacts'); return (Array.isArray(all) ? all : all.contacts ?? all.items ?? []).find(c => c.id === id) ?? {} }
    const quoteNow = id => ownerApi('GET', `/api/saved-quotes/${id}`)

    // a. Pat has no email: her phone and a new email typed.
    const q1 = await quoteFor(`Pat ${tag} Noemail`)
    await openSave(q1)
    await page.locator('[data-new-field="phone"]').fill(pat.phone)
    await page.locator('[data-new-field="email"]').fill(`pat-${stamp}@example.invalid`)
    await page.locator('[data-possible-match]').waitFor({ timeout: 10000 })
    const n1 = await page.locator('[data-possible-match]').innerText()
    check('48a. before Save: puts the quote on Pat and says her email is added', /Save puts the quote on Pat/.test(n1) && new RegExp(`no email on file: Save adds pat-${stamp}@example\\.invalid`).test(n1), n1.replace(/\n/g, ' / '))
    await page.locator('[data-possible-match]').scrollIntoViewIfNeeded(); await shot(page, '48a-salesman-email-added')
    await page.locator('[data-save-submit]').tap(); await sleep(4000)
    const p1 = await contactNow(pat.id), qq1 = await quoteNow(q1)
    check('48a. saved: the quote is Pat\'s; her email is added, her phone unchanged', qq1.crmContactId === pat.id && p1.email === `pat-${stamp}@example.invalid` && p1.phone === pat.phone, JSON.stringify({ q: qq1.crmContactId === pat.id, e: p1.email, p: p1.phone }))

    // b. Kim has another email: her phone and a different email typed.
    const q2 = await quoteFor(`Kim ${tag} Hasemail`)
    await openSave(q2)
    await page.locator('[data-new-field="phone"]').fill(kim.phone)
    await page.locator('[data-new-field="email"]').fill(`kim-new-${stamp}@example.invalid`)
    await page.locator('[data-contact-not-saved="email"]').waitFor({ timeout: 10000 })
    const n2 = await page.locator('[data-contact-not-saved="email"]').innerText()
    check('48b. before Save: says the typed email is not saved and theirs stays', n2.includes(`kim-new-${stamp}@example.invalid`) && n2.includes(`kim-${stamp}@example.invalid`), n2)
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    check('48b. fits a 393 px phone', fits)
    await page.locator('[data-possible-match]').scrollIntoViewIfNeeded(); await shot(page, '48b-salesman-email-not-saved')
    await page.locator('[data-save-submit]').tap(); await sleep(4000)
    const k1 = await contactNow(kim.id), qq2 = await quoteNow(q2)
    check('48b. saved: the quote is Kim\'s; her email and phone unchanged', qq2.crmContactId === kim.id && k1.email === kim.email && k1.phone === kim.phone, JSON.stringify({ q: qq2.crmContactId === kim.id, e: k1.email }))
    check('48. no page errors', errors.length === 0, errors.join(' | '))
    await sales.close()
  }
} catch (e) {
  check('ran to the end', false, String(e).slice(0, 400))
} finally {
  try {
    for (const id of made.jobs) await ownerApi('DELETE', `/api/saved-jobs/${id}`).catch(e => console.log('cleanup job', String(e).slice(0, 120)))
    for (const id of made.quotes) await ownerApi('DELETE', `/api/saved-quotes/${id}`).catch(e => console.log('cleanup quote', String(e).slice(0, 120)))
    for (const id of made.contacts) await ownerApi('DELETE', `/api/crm-contacts/${id}`).catch(e => console.log('cleanup contact', String(e).slice(0, 120)))
  } catch { /* the database cleanup by the caller is the backstop */ }
  console.log(`CLEANUP-TAG ${tag}`)
  console.log(`CLEANUP-IDS ${JSON.stringify(made)}`)
  await wk.close(); await cr.close()
}
const failed = results.filter(r => !r).length
console.log(`\n${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
