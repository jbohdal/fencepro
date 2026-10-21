// Warranty per option, end to end on the dev copy (4001 serves the built app:
// run `pnpm -s build` in apps/web first).
//
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 E2E_ACCESS_TOKEN=<dev owner token> \
//     [E2E_SHOTS=<folder>] node e2e/warranty.mjs
//
//   1. Settings → Warranties: Lifetime for vinyl no dig, 1 Year for the rest, wood's line.
//   2. A Good / Better / Best proposal on a phone (WebKit, 390 x 844): a badge
//      per option; the Warranty words switch as the customer picks; accepting
//      Better (no dig) puts the Lifetime words in the signed contract PDF.
//   3. The same on a desktop: accepting Good (dig set) puts the 1 Year words in.
//   4. The job page (desktop): the warranty, its start and end; a service call
//      booked on the job is "Covered by warranty"; on the dig set job installed
//      more than a year ago it is "Not covered", and staff can mark it covered
//      with a reason. A second browser sees the same after a reload.
// Removes everything it made (hard deletes on ezbiz_dev only).
import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import './sharedLock.mjs' // makes customers, quotes, jobs and appointments on the shared dev copy
import { webkit, chromium } from 'playwright'
import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import zlib from 'zlib'
import { execFileSync } from 'child_process'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || 'http://localhost:4001'
const OWNER = process.env.E2E_ACCESS_TOKEN || ''
const SHOTS = process.env.E2E_SHOTS || process.env.SHOTS || ''
if (!/localhost:4001/.test(APP) || !/localhost:4001/.test(API)) { console.error('Refusing to run: the dev copy only (localhost:4001).'); process.exit(2) }
if (!OWNER) { console.error('Set E2E_ACCESS_TOKEN (an owner login on the dev server).'); process.exit(2) }
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const call = async (method, p, body) => {
  const r = await fetch(`${API}${p}`, { method, headers: { Authorization: `Bearer ${OWNER}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: r.status, json: await r.json().catch(() => ({})) }
}
async function until(fn, ms = 20000, every = 400) { const end = Date.now() + ms; for (;;) { const v = await fn().catch(() => null); if (v || Date.now() > end) return v; await sleep(every) } }
const sql = q => execFileSync('psql', ['-d', 'ezbiz_dev', '-At', '-c', q]).toString().trim()
const uuid = s => /^[0-9a-f-]{36}$/i.test(s)

/** The words in a pdfkit PDF (as apps/portal/tests/pdfText.ts). */
function pdfText(buf) {
  const raw = buf.toString('latin1'), parts = []
  for (const s of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let body = s[1]
    try { body = zlib.inflateSync(Buffer.from(s[1], 'latin1')).toString('latin1') } catch { /* not compressed */ }
    if (!/\bBT\b/.test(body)) continue
    for (const r of body.matchAll(/\[([^\]]*)\]\s*TJ|(<[0-9a-fA-F\s]*>|\([^)]*\))\s*Tj/g)) {
      let out = ''
      for (const m of (r[1] ?? r[2]).matchAll(/<([0-9a-fA-F\s]*)>|\(([^)]*)\)/g)) {
        if (m[1] !== undefined) { const h = m[1].replace(/\s+/g, ''); for (let i = 0; i + 1 < h.length; i += 2) out += String.fromCharCode(parseInt(h.slice(i, i + 2), 16)) } else out += m[2]
      }
      parts.push(out)
    }
  }
  return parts.join(' ').replace(/\x92/g, "'").replace(/\s+/g, ' ').trim()
}
/** A PDF's first page as a PNG (macOS Quick Look), for the screenshots. */
function pdfShot(buf, name) {
  if (!SHOTS) return
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'warranty-pdf-'))
  const f = path.join(dir, `${name}.pdf`)
  fs.writeFileSync(f, buf)
  try { execFileSync('qlmanage', ['-t', '-s', '1400', '-o', dir, f], { stdio: 'ignore' }); fs.copyFileSync(`${f}.png`, path.join(SHOTS, `${name}.png`)) } catch (e) { console.log(`(no picture of ${name}: ${String(e?.message || e).slice(0, 80)})`) }
  fs.rmSync(dir, { recursive: true, force: true })
}

const LIFETIME = 'For as long as you own your home, Getter Done Fence will repair or replace, at no cost to you, any part of this fence that fails because of our installation'
const ONE_YEAR = 'Workmanship is warranted for 1 year from installation date against defects in workmanship.'
const stamp = Date.now().toString(36).slice(-6)
const NAME = `Warranty ${stamp}`
const contactId = crypto.randomUUID(), cardId = crypto.randomUUID()
const quoteIds = [crypto.randomUUID(), crypto.randomUUID()]
const jobs = []
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
const dayText = d => { const [y, m, dd] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd)).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' }) }

const snap = price => ({ materialCost: price * 0.4, laborCost: price * 0.2, tearOutCost: 0, totalCOGS: price * 0.6, gmPct: 0.4, pullSheet: [], runSections: [19] })
const opt = (tier, fenceStyle, price) => ({ label: `${tier} option`, fenceStyle, finalPrice: price, perFoot: Math.round(price / 1.5) / 100, sections: 19, tier: { key: tier.toLowerCase(), label: tier, blurb: '' }, snapshot: snap(price) })
// The second quote at half the price: a different job, not the same job accepted again (proposalAccepted.ts, within 10%).
const GBB = (k = 1) => [opt('Good', "WV-DS 6'x8' Privacy", 9000 * k), opt('Better', "WV-ND 6'x8' Privacy", 10000 * k), opt('Best', "TV-ND 6'x8' Privacy", 11000 * k)]
async function makeQuote(id, k = 1) {
  const q = await call('POST', '/api/saved-quotes', {
    id, crmContactId: contactId, customerName: `E2E ${NAME}`, customerPhone: '3525550194', customerEmail: 'e2e-warranty@example.invalid', customerAddress: '7 Warranty Way, Ocala, FL 34470',
    fenceStyle: "WV-ND 6'x8' Privacy", runs: [150], sections: 19, corners: 0, ends: 2, walkGates: 1, materialCost: 4000, laborCost: 2000, tearOutCost: 0, totalCOGS: 6000 * k, finalPrice: 10000 * k, gmPct: 0.4,
    pullSheet: [], status: 'SENT', date: today, salesRep: 'E2E Salesman', leadSource: 'Other',
    proposal: { version: 1, customer: { name: `E2E ${NAME}`, address: '7 Warranty Way, Ocala, FL 34470' }, company: { name: 'Getter Done Fence', phone: '3527894314', email: '' }, footageFt: 150, gatesText: '1 walk gate', included: ['150 ft of new fence'], recommended: 1, depositPct: 50, options: GBB(k) },
  })
  const t = (await call('POST', `/api/saved-quotes/${id}/share-token`)).json.data?.shareToken
  return { status: q.status, data: q.json.data, token: t }
}
async function sign(page, who) {
  await page.locator('#name').fill(who)
  const sig = await page.locator('#sig').boundingBox()
  const pt = i => ({ clientX: sig.x + 30 + i * 20, clientY: sig.y + 80 + (i % 2 ? -25 : 25), pointerId: 7, pointerType: 'touch', bubbles: true })
  await page.locator('#sig').dispatchEvent('pointerdown', pt(0))
  for (let i = 1; i <= 12; i++) await page.locator('#sig').dispatchEvent('pointermove', pt(i))
  await page.locator('#sig').dispatchEvent('pointerup', pt(12))
  await page.locator('#go').click()
  return until(async () => (await page.locator('body').textContent()).includes('Accepted by'), 15000)
}
const words = async page => ({ name: (await page.locator('#wname').textContent())?.trim(), text: (await page.locator('#wtext').textContent())?.trim() })

const browser = await chromium.launch()
const phoneBrowser = await webkit.launch()
try {
  // ── Setup: a test customer (with a card) and two sent Good / Better / Best quotes ──
  const c = await call('POST', '/api/crm-contacts', { id: contactId, firstName: 'E2E', lastName: NAME, phone: '3525550194', email: 'e2e-warranty@example.invalid', leadSource: 'Other', lead: { id: cardId, customerId: contactId, firstName: 'E2E', lastName: NAME, phone: '3525550194', stage: 'Proposal Sent', leadSource: 'Other', createdAt: today, lastMoved: today }, leadBefore: null })
  const [q1, q2] = [await makeQuote(quoteIds[0]), await makeQuote(quoteIds[1], 0.5)]
  check('setup: test customer and two sent proposals with links', c.status < 300 && q1.status < 300 && q2.status < 300 && !!q1.token && !!q2.token, `${c.status} ${q1.status} ${q2.status}`)
  check('saved: each option carries its warranty (Good 1 Year, Better and Best Lifetime)', JSON.stringify(q1.data?.proposal?.options?.map(o => o.warranty?.name)) === JSON.stringify(['1 Year Workmanship Warranty', 'Lifetime Craftsmanship Warranty', 'Lifetime Craftsmanship Warranty']))

  // ── 1. Settings → Warranties (desktop) ──
  const dc = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await dc.addInitScript(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, OWNER)
  const d = await dc.newPage()
  const errors = []
  d.on('pageerror', e => errors.push(String(e).slice(0, 200)))
  d.on('dialog', x => x.accept().catch(() => {}))
  await d.goto(`${APP}/settings?tab=warranties`); await d.waitForSelector('[data-warranty-settings]', { timeout: 30000 }); await sleep(600)
  const mapping = await d.locator('[data-warranty-for]').evaluateAll(els => Object.fromEntries(els.map(e => [e.getAttribute('data-warranty-for'), e.value])))
  check('Settings: vinyl no dig → Lifetime; vinyl dig set, aluminum, chain link, wood → 1 Year',
    mapping['vinyl:nd'] === 'lifetime-craftsmanship' && ['vinyl:ds', 'alum:nd', 'alum:ds', 'chain:nd', 'chain:ds', 'wood:nd', 'wood:ds'].every(k => mapping[k] === 'one-year-workmanship'), JSON.stringify(mapping))
  check('Settings: both warranties with their words; wood keeps "No warranty on the wood itself."',
    (await d.locator('[data-warranty="lifetime-craftsmanship"] [data-warranty-text]').inputValue()).startsWith(LIFETIME) &&
    (await d.locator('[data-warranty="one-year-workmanship"] [data-warranty-text]').inputValue()).includes(ONE_YEAR) &&
    (await d.locator('[data-warranty-extra="wood"]').inputValue()) === 'No warranty on the wood itself.')
  if (SHOTS) await d.screenshot({ path: path.join(SHOTS, 'dev-warranty-settings.png'), fullPage: true })

  // ── 2. The customer on a phone (WebKit 390 x 844): badges, the words switch, accept Better ──
  const pc = await phoneBrowser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true })
  const p = await pc.newPage()
  await p.goto(`${API}/p/${q1.token}`); await p.waitForSelector('#go', { timeout: 20000 })
  const badges = await p.locator('[data-warranty-badge]').allTextContents()
  check('phone: a badge on each option (Good 1 Year, Better Lifetime, Best Lifetime)', JSON.stringify(badges) === JSON.stringify(['1 Year Workmanship Warranty', 'Lifetime Craftsmanship Warranty', 'Lifetime Craftsmanship Warranty']), JSON.stringify(badges))
  let w = await words(p)
  check('phone: the Warranty section starts with the recommended option (Better): Lifetime', w.name === 'Lifetime Craftsmanship Warranty' && w.text.startsWith(LIFETIME))
  if (SHOTS) await p.locator('.opts').screenshot({ path: path.join(SHOTS, 'dev-warranty-badges-phone.png') })
  await p.locator('.opt[data-option="0"]').tap(); await sleep(200)
  w = await words(p)
  check('phone: picking Good (dig set) switches the words to 1 Year', w.name === '1 Year Workmanship Warranty' && w.text.includes(ONE_YEAR) && !w.text.includes('as long as you own'))
  if (SHOTS) await p.locator('#warranty').screenshot({ path: path.join(SHOTS, 'dev-warranty-section-switch.png') })
  await p.locator('.opt[data-option="2"]').tap(); await sleep(200)
  check('phone: picking Best switches back to Lifetime', (await words(p)).name === 'Lifetime Craftsmanship Warranty')
  await p.locator('.opt[data-option="1"]').tap(); await sleep(200)
  check('phone: accepted Better', !!(await sign(p, `E2E ${NAME}`)))
  await p.waitForSelector('[data-contract-pdf]', { timeout: 15000 }).catch(() => null)
  w = await words(p)
  check('phone: the accepted page shows Better\'s Lifetime words and that the warranty starts on the install date',
    w.name === 'Lifetime Craftsmanship Warranty' && (await p.locator('[data-warranty-start]').textContent()).includes('Warranty starts on the install date'))
  const pdf1 = Buffer.from(await (await fetch(`${API}/p/${q1.token}/contract.pdf`)).arrayBuffer())
  const t1 = pdfText(pdf1)
  if (process.env.DEBUG_PDF) fs.writeFileSync(process.env.DEBUG_PDF, t1)
  check('signed contract PDF (Better, no dig): the Lifetime words word for word, no 1 Year words', pdf1.subarray(0, 5).toString() === '%PDF-' && t1.includes('Lifetime Craftsmanship Warranty') && t1.includes(LIFETIME) && !t1.includes(ONE_YEAR))
  await pc.close()

  // ── 3. The customer on a desktop: accept Good (dig set) ──
  const cd = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const cp = await cd.newPage()
  await cp.goto(`${API}/p/${q2.token}`); await cp.waitForSelector('#go', { timeout: 20000 })
  check('desktop: the same badges', JSON.stringify(await cp.locator('[data-warranty-badge]').allTextContents()) === JSON.stringify(badges))
  await cp.locator('.opt[data-option="0"]').click(); await sleep(200)
  check('desktop: picking Good switches the words to 1 Year', (await words(cp)).name === '1 Year Workmanship Warranty')
  check('desktop: accepted Good (dig set)', !!(await sign(cp, `E2E ${NAME}`)))
  const pdf2 = Buffer.from(await (await fetch(`${API}/p/${q2.token}/contract.pdf`)).arrayBuffer())
  const t2 = pdfText(pdf2)
  check('signed contract PDF (Good, dig set): the 1 Year words, never Lifetime', t2.includes('1 Year Workmanship Warranty') && t2.includes(ONE_YEAR) && !t2.includes('Lifetime'))
  await cd.close()

  // ── 4. The jobs: installed; the warranty on the job page; service calls ──
  for (const id of quoteIds) jobs.push(await until(async () => ((await call('GET', '/api/saved-jobs')).json.data ?? []).find(j => j.quoteId === id)?.id))
  check('both signed quotes became jobs', jobs.every(Boolean))
  await call('PATCH', `/api/saved-jobs/${jobs[0]}`, { completedDate: today })
  await call('PATCH', `/api/saved-jobs/${jobs[1]}`, { completedDate: '2024-06-03' })
  pdfShot(Buffer.from(await (await fetch(`${API}/p/${q1.token}/contract.pdf`)).arrayBuffer()), 'dev-warranty-contract')
  check('installed: the contract shows the install date', pdfText(Buffer.from(await (await fetch(`${API}/p/${q1.token}/contract.pdf`)).arrayBuffer())).includes(`Warranty starts on the install date: ${dayText(today)}`))

  await d.goto(`${APP}/operations?job=${jobs[0]}`); await d.waitForSelector('[data-job-warranty-name]', { timeout: 30000 })
  const box = d.locator('[data-job-warranty-box]')
  check('job page (Better): Lifetime, starts on the install date, for as long as the customer owns the home',
    (await box.locator('[data-job-warranty-name]').textContent()) === 'Lifetime Craftsmanship Warranty' &&
    (await box.locator('[data-job-warranty-row="start"]').textContent()) === dayText(today) &&
    (await box.locator('[data-job-warranty-row="end"]').textContent()) === 'For as long as the customer owns the home')
  await box.locator('[data-book-service]').click()
  await box.locator('[data-service-day]').fill(today)
  await box.locator('[data-service-notes]').fill('Gate sagging')
  await box.locator('[data-service-save]').click()
  const covered = await until(async () => (await box.locator('[data-service-call] [data-coverage]').first().getAttribute('data-coverage')) === 'covered', 15000)
  check('job page: a service call booked on the job today is "Covered by warranty"', !!covered)
  await box.locator('[data-job-warranty-toggle]').click()
  if (SHOTS) await box.screenshot({ path: path.join(SHOTS, 'dev-warranty-job-page.png') })

  await d.goto(`${APP}/operations?job=${jobs[1]}`); await d.waitForSelector('[data-job-warranty-name]', { timeout: 30000 })
  check('job page (Good, dig set, installed Jun 3, 2024): 1 Year, through June 3, 2025',
    (await box.locator('[data-job-warranty-name]').textContent()) === '1 Year Workmanship Warranty' && (await box.locator('[data-job-warranty-row="end"]').textContent()) === 'Through June 3, 2025')
  await box.locator('[data-book-service]').click()
  await box.locator('[data-service-day]').fill(today)
  await box.locator('[data-service-save]').click()
  const notCovered = await until(async () => (await box.locator('[data-service-call] [data-coverage]').first().getAttribute('data-coverage')) === 'not-covered', 15000)
  check('job page: a service call after the year is "Not covered"', !!notCovered)
  await box.locator('[data-override-covered]').first().click()
  await box.locator('[data-override-reason]').fill('Goodwill: first repair free')
  await box.locator('[data-override-save]').click()
  const overridden = await until(async () => (await box.locator('[data-service-call] [data-coverage]').first().getAttribute('data-coverage')) === 'covered', 10000)
  check('staff can mark it covered with a reason', !!overridden && (await box.locator('[data-service-call]').first().textContent()).includes('Goodwill: first repair free'))

  // A second browser, after a reload, sees the same.
  const sc = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  await sc.addInitScript(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, OWNER)
  const s = await sc.newPage()
  await s.goto(`${APP}/operations?job=${jobs[1]}`); await s.waitForSelector('[data-service-call] [data-coverage]', { timeout: 30000 })
  check('second browser: the service call and its override are there', (await s.locator('[data-service-call] [data-coverage]').first().getAttribute('data-coverage')) === 'covered' && (await s.locator('[data-service-call]').first().textContent()).includes('Goodwill'))
  await sc.close()
  check('no page errors', errors.length === 0, errors.join(' | '))
  await dc.close()
} finally {
  await browser.close()
  await phoneBrowser.close()
  // Remove what this made. Dev database only, named on every command.
  try {
    if (![contactId, cardId, ...quoteIds].every(uuid) || jobs.some(j => j && !/^[A-Za-z0-9-]+$/.test(j))) throw new Error('bad id')
    const jl = jobs.filter(Boolean).map(j => `'${j}'`).join(',') || "'-'"
    const ql = quoteIds.map(q => `'${q}'`).join(',')
    sql(`DELETE FROM "CrmAppointment" WHERE "crmContactId" = '${contactId}'`)
    sql(`DELETE FROM "ProposalView" WHERE "quoteId" IN (${ql})`)
    sql(`DELETE FROM "JobQuotedCost" WHERE "quoteId" IN (${ql})`)
    sql(`DELETE FROM "AutomationEvent" WHERE "entityId" IN (${jl}, ${ql}, '${cardId}', '${contactId}', ${quoteIds.map(q => `'lead-${q}'`).join(',')})`)
    sql(`DELETE FROM "JobChecklistItem" WHERE "jobId" IN (${jl})`)
    sql(`DELETE FROM "SavedJob" WHERE id IN (${jl})`)
    sql(`DELETE FROM "SavedQuote" WHERE id IN (${ql})`)
    sql(`DELETE FROM "Notification" WHERE title = 'Proposal accepted: E2E ${NAME}'`)
    const pl = (await call('GET', '/api/pipeline')).json
    const mine = (pl?.data?.leads ?? []).filter(l => l.customerId === contactId || l.id === cardId || quoteIds.some(q => l.id === `lead-${q}`)).map(l => l.id)
    if (mine.length) await call('PATCH', '/api/pipeline', { upsert: [], remove: mine, baseVersion: pl.data.version })
    await call('DELETE', `/api/crm-contacts/${contactId}`)
    sql(`DELETE FROM "CrmContact" WHERE id = '${contactId}'`)
    check('cleaned up (quotes, jobs, service calls, customer, card)', sql(`SELECT count(*) FROM "SavedQuote" WHERE id IN (${ql})`) === '0' && sql(`SELECT count(*) FROM "CrmAppointment" WHERE "crmContactId" = '${contactId}'`) === '0')
  } catch (e) { check('cleaned up', false, String(e?.message || e).slice(0, 200)) }
}
const passed = results.filter(Boolean).length
console.log(`\n${passed} of ${results.length} checks passed`)
process.exit(passed === results.length ? 0 : 1)
