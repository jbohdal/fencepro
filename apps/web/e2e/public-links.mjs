// Customer links through the public door (Jonathan, Oct 21 2026: "serve them
// through the public door like proposals. No DNS change needed for that.").
// Only /p (and the two intake paths) reach the internet, so every customer
// link must live under /p/.
//
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 E2E_ACCESS_TOKEN=<dev owner token> \
//     node e2e/public-links.mjs
//   SHOTS=<folder>   saves public-quote.png, public-portal-docs.png
//
// The office (API, as the owner) makes a customer with a sent quote that has
// no proposal, a sent quote with a proposal, a document and an invite. Then:
//   - staff: the quote's "Copy Share Link" gives a /p/<link> address (built
//     like the proposal link), never /#/quote/;
//   - a fresh browser with no staff sign in opens it: the quote view, price
//     and how to accept; the proposal quote's link opens its proposal;
//   - the portal invite is /p/portal/#/portal/activate?token=...: a fresh
//     browser sets a password there, sees the dashboard, its documents and
//     its quotes (View Quote opens /p/<link>), every call it makes is under
//     /p/, the cookie is httpOnly, SameSite=Strict, path /p/portal/api;
//     signs out and back in on /p/portal/#/portal/login;
//   - staff only portal routes under /p/portal/api are refused (404), even
//     with the staff sign in.
// Dev copy only (port 4001). Removes everything it made.
import './devOnly.mjs'
import { chromium } from 'playwright'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || 'http://localhost:4001'
const TOKEN = process.env.E2E_ACCESS_TOKEN || ''
const SHOTS = process.env.SHOTS || ''
if (!TOKEN) { console.error('Set E2E_ACCESS_TOKEN (an owner login on the dev server).'); process.exit(2) }
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const call = async (method, p, body, headers = {}) => {
  const isForm = body instanceof FormData
  const r = await fetch(`${API}${p}`, { method, headers: { Authorization: `Bearer ${TOKEN}`, ...(isForm || body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, body: body === undefined ? undefined : isForm ? body : JSON.stringify(body) })
  return { status: r.status, json: await r.json().catch(() => ({})) }
}
const sql = q => execFileSync('psql', ['-d', 'ezbiz_dev', '-At', '-v', 'ON_ERROR_STOP=1', '-c', q]).toString().trim()
async function until(fn, ms = 20000, every = 400) { const end = Date.now() + ms; for (;;) { const v = await fn().catch(() => null); if (v || Date.now() > end) return v; await sleep(every) } }
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name), fullPage: true }).catch(() => {}) }

const stamp = Date.now().toString(36).slice(-5)
const W = {
  contactId: crypto.randomUUID(), plainQuote: crypto.randomUUID(), propQuote: crypto.randomUUID(),
  name: `E2E Door ${stamp}`, email: `e2e-door-${stamp}@example.invalid`,
}
const origin = new URL(APP).origin

let staffBr, custBr
try {
  // ── The office ──
  const c = await call('POST', '/api/crm-contacts', { id: W.contactId, firstName: 'E2E Door', lastName: stamp, phone: '3525550171', email: W.email, leadSource: 'Other', serviceAddress: '7 Door Way, Ocala, FL 34470' })
  const base = { crmContactId: W.contactId, customerName: W.name, customerPhone: '3525550171', customerEmail: W.email, customerAddress: '7 Door Way, Ocala, FL 34470', leadSource: 'Other', salesRep: 'E2E', fenceStyle: "WV-ND 6'x6' Privacy", corners: 0, ends: 2, materialCost: 1500, laborCost: 900, tearOutCost: 0, totalCOGS: 2400, gmPct: 0.5, pullSheet: [], date: '2026-10-21', runs: [60], sections: 10, walkGates: 1, status: 'SENT' }
  const q1 = await call('POST', '/api/saved-quotes', { ...base, id: W.plainQuote, finalPrice: 4321 })
  const proposal = { version: 1, createdAt: new Date().toISOString(), company: { name: 'Getter Done Fence', phone: '3527894314', email: '' }, customer: { name: W.name, address: '7 Door Way' }, footageFt: 60, gatesText: '1 walk gate', included: ['60 ft of new fence'], includedNote: '', warranty: '', depositPct: 50, depositNote: '', financing: null, recommended: 0, wholeDollar: true,
    options: [{ label: 'White Vinyl Privacy', fenceStyle: "WV-ND 6'x6' Privacy", finalPrice: 5201, perFoot: 86.68, sections: 10, snapshot: { materialCost: 1500, laborCost: 900, tearOutCost: 0, totalCOGS: 2400, gmPct: 0.5, pullSheet: [], runSections: [10], roundingCents: 40 } }] }
  const q2 = await call('POST', '/api/saved-quotes', { ...base, id: W.propQuote, finalPrice: 5201, proposal })
  const fd = new FormData()
  fd.append('label', `Office doc ${stamp}`)
  fd.append('file', new Blob([`%PDF-1.4 door ${stamp}`], { type: 'application/pdf' }), `door-${stamp}.pdf`)
  const doc = await call('POST', `/api/portal/customer/${W.contactId}/documents`, fd)
  const inv = await call('POST', '/api/portal/invite', { crmCustomerId: W.contactId, email: W.email, firstName: 'E2E Door', lastName: stamp })
  const invite = inv.json.data?.activationUrl || ''
  check('office: customer, two sent quotes (one without a proposal), a document and an invite', [c, q1, q2].every(r => r.status < 300) && !!doc.json.data?.id && inv.status === 200, `${c.status} ${q1.status} ${q2.status} ${doc.status} ${inv.status}`)
  check('the portal invite is a link under the public door: /p/portal/#/portal/activate?token=', invite.startsWith(`${origin}/p/portal/#/portal/activate?token=`) && /token=[0-9a-f]{64}$/.test(invite), invite.replace(/token=.*/, 'token=…'))

  // ── Staff: Copy Share Link on the quote without a proposal ──
  staffBr = await chromium.launch()
  const sctx = await staffBr.newContext({ viewport: { width: 1280, height: 900 } })
  await sctx.addInitScript(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, TOKEN)
  await sctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin })
  const sp = await sctx.newPage()
  sp.on('dialog', d => d.accept().catch(() => {}))
  await sp.goto(`${APP}/quotes?qv=${W.plainQuote}`)
  await sp.waitForSelector('[data-quote-drawer]', { timeout: 60000 })
  await sp.getByRole('button', { name: 'Copy Share Link' }).click()
  const shown = await until(async () => {
    const t = await sp.locator('section', { hasText: 'Customer Share Link' }).locator('p.font-mono').textContent().catch(() => '')
    return t && t.includes('/p/') ? t.trim() : null
  }, 20000)
  const copied = await sp.evaluate(() => navigator.clipboard.readText()).catch(() => '')
  const token1 = sql(`SELECT "shareToken" FROM "SavedQuote" WHERE id = '${W.plainQuote}'`)
  check('staff: Copy Share Link gives the quote\'s /p/<link> (built like the proposal link), never /#/quote/', !!token1 && shown === `${origin}/p/${token1}` && copied === shown && !/#\/quote\//.test(shown || ''), `${shown} | ${copied}`)
  await staffBr.close(); staffBr = null

  // ── A customer's browser: no staff sign in ──
  custBr = await chromium.launch()
  const ctx = await custBr.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 300)))
  const r1 = await page.goto(shown)
  await page.waitForSelector('[data-quote-view]', { timeout: 20000 })
  const qText = await page.locator('[data-quote-view]').innerText()
  check('the share link opens with no staff sign in: the quote, its price and how to accept', r1.status() === 200 && /\$4,321/.test(qText) && /White Vinyl Privacy/.test(qText) && /60 ft of fence/.test(qText) && /accept this quote/i.test(qText), qText.replace(/\s+/g, ' ').slice(0, 160))
  await shot(page, 'public-quote.png')
  const t2 = await call('POST', `/api/saved-quotes/${W.propQuote}/share-token`)
  const token2 = t2.json.data?.shareToken
  const r2 = await page.goto(`${origin}/p/${token2}`)
  const pText = await page.locator('main').innerText()
  check('a quote with a proposal: its link is the proposal (whole dollar price and deposit)', r2.status() === 200 && /\$5,201/.test(pText) && /\$2,600/.test(pText) && /Accept this proposal/.test(pText), pText.replace(/\s+/g, ' ').slice(0, 200))

  // ── The portal through the public door ──
  const asked = []
  page.on('request', r => { const u = new URL(r.url()); if (u.origin === origin) asked.push(u.pathname) })
  await page.goto(invite)
  await page.waitForSelector('input[type="password"]', { timeout: 60000 })
  const pw = page.locator('input[type="password"]')
  await pw.nth(0).fill('e2e-door-pass-1'); await pw.nth(1).fill('e2e-door-pass-1')
  await page.locator('form button[type="submit"]').click()
  const inDash = await page.waitForFunction(() => location.hash.startsWith('#/portal/dashboard'), null, { timeout: 30000 }).then(() => true).catch(() => false)
  check('the invite opens on /p/portal/: password set, signed in, the dashboard', inDash && new URL(page.url()).pathname === '/p/portal/', page.url())
  const ck = (await ctx.cookies(`${origin}/p/portal/api/me`)).find(c => c.name === 'ezbiz_portal')
  check('the sign in: an httpOnly, SameSite=Strict cookie for /p/portal/api only', !!ck && ck.httpOnly && ck.sameSite === 'Strict' && ck.path === '/p/portal/api', ck ? `${ck.httpOnly} ${ck.sameSite} ${ck.path}` : 'none')
  const stored = await page.evaluate(() => ({ l: Object.keys(localStorage).length, s: Object.keys(sessionStorage).length, c: document.cookie }))
  check('nothing in the browser\'s storage; the page cannot read the cookie', stored.l === 0 && stored.s === 0 && !stored.c.includes('ezbiz_portal'), JSON.stringify(stored))

  await page.goto(`${origin}/p/portal/#/portal/documents`)
  const docRow = await until(async () => (await page.locator('[data-portal-doc]').count()) > 0, 20000)
  const docText = await page.locator('main').innerText().catch(() => '')
  const href = docRow ? await page.locator('[data-portal-doc]').first().getAttribute('href') : ''
  const fileRes = href ? await page.request.get(new URL(href, origin).href) : null
  check('documents: the office\'s document is listed and opens through /p/portal/api/files', !!docRow && docText.includes(`Office doc ${stamp}`) && !!href && new URL(href, origin).pathname.startsWith('/p/portal/api/files/') && fileRes?.status() === 200, `${href} ${fileRes?.status()}`)
  await shot(page, 'public-portal-docs.png')

  await page.goto(`${origin}/p/portal/#/portal/quotes`)
  await until(async () => (await page.locator('main').innerText()).includes('5,201'), 20000)
  const view = await page.locator('a', { hasText: 'View Quote' }).first().getAttribute('href').catch(() => null)
  check('quotes: both quotes; View Quote opens the quote\'s /p/<link>', !!view && view === `${origin}/p/${token2}`, String(view))

  const outside = asked.filter(p => !p.startsWith('/p/'))
  check('every call the portal page makes is under /p/ (the public door)', asked.length > 5 && outside.length === 0, outside.slice(0, 5).join(' '))

  // Sign out, then back in on the login page under the door.
  await page.locator('[data-portal-signout]').first().click()
  await page.waitForFunction(() => location.hash.startsWith('#/portal/login'), null, { timeout: 20000 })
  await page.goto(`${origin}/p/portal/#/portal/login`)
  await page.waitForSelector('input[type="email"]', { timeout: 20000 })
  await page.locator('input[type="email"]').fill(W.email)
  await page.locator('input[type="password"]').fill('e2e-door-pass-1')
  await page.locator('form button[type="submit"]').click()
  const back = await page.waitForFunction(() => location.hash.startsWith('#/portal/dashboard'), null, { timeout: 30000 }).then(() => true).catch(() => false)
  const me = await page.evaluate(async () => (await fetch('/p/portal/api/me', { credentials: 'include' })).status)
  check('signed out, then signed in again on /p/portal/#/portal/login', back && me === 200, `${back} ${me}`)

  // ── Staff routes are not reachable under the public prefix ──
  const refused = []
  for (const [m, p] of [['GET', '/accounts'], ['POST', '/invite'], ['GET', '/messages/inbox'], ['GET', `/customer/${W.contactId}/documents`], ['POST', `/customer/${W.contactId}/messages`], ['DELETE', '/documents/x']]) {
    const asCustomer = await page.evaluate(async ([m, p]) => (await fetch(`/p/portal/api${p}`, { method: m, credentials: 'include', headers: { 'X-Portal-Request': '1', 'Content-Type': 'application/json' }, body: m === 'GET' ? undefined : '{}' })).status, [m, p])
    const asStaff = (await call(m, `/p/portal/api${p}`, m === 'GET' ? undefined : {})).status
    refused.push(`${m} ${p}: ${asCustomer}/${asStaff}`)
    if (asCustomer !== 404 || asStaff !== 404) check(`staff route refused under /p/portal/api: ${m} ${p}`, false, `${asCustomer}/${asStaff}`)
  }
  check('staff only portal routes under /p/portal/api answer 404, for the customer and even with the staff sign in', refused.every(r => r.endsWith('404/404')), refused.join('; '))
  // The old addresses keep working.
  const oldLogin = await fetch(`${origin}/api/portal/company`)
  check('the old portal API (/api/portal) still answers', oldLogin.status === 200)
  check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '))
} catch (e) {
  check('ran to the end', false, String(e).split('\n').slice(0, 3).join(' '))
} finally {
  await staffBr?.close().catch(() => {})
  await custBr?.close().catch(() => {})
  try {
    sql(`BEGIN;
      DELETE FROM "PortalSession" WHERE "portalAccountId" IN (SELECT id FROM "PortalAccount" WHERE "crmCustomerId" = '${W.contactId}');
      DELETE FROM "PortalInvite" WHERE "accountId" IN (SELECT id FROM "PortalAccount" WHERE "crmCustomerId" = '${W.contactId}');
      DELETE FROM "PortalFile" WHERE "crmCustomerId" = '${W.contactId}';
      DELETE FROM "PortalMessage" WHERE "crmCustomerId" = '${W.contactId}';
      DELETE FROM "PortalAccount" WHERE "crmCustomerId" = '${W.contactId}';
      DELETE FROM "AutomationEvent" WHERE "entityId" IN ('${W.plainQuote}', '${W.propQuote}', '${W.contactId}');
      DELETE FROM "ProposalView" WHERE "quoteId" IN ('${W.plainQuote}', '${W.propQuote}');
      DELETE FROM "SavedQuote" WHERE id IN ('${W.plainQuote}', '${W.propQuote}');
      DELETE FROM "Notification" WHERE body LIKE '%${W.email}%';
      DELETE FROM "CrmAuditLog" WHERE "entityId" IN ('${W.plainQuote}', '${W.propQuote}', '${W.contactId}');
      DELETE FROM "CrmContact" WHERE id = '${W.contactId}';
      COMMIT;`)
    fs.rmSync(path.resolve(process.cwd(), '../portal/uploads/portal', W.contactId), { recursive: true, force: true })
    const left = Number(sql(`SELECT (SELECT count(*) FROM "SavedQuote" WHERE id IN ('${W.plainQuote}', '${W.propQuote}')) + (SELECT count(*) FROM "PortalAccount" WHERE "crmCustomerId" = '${W.contactId}') + (SELECT count(*) FROM "PortalFile" WHERE "crmCustomerId" = '${W.contactId}') + (SELECT count(*) FROM "CrmContact" WHERE id = '${W.contactId}')`))
    check('cleaned up (customer, quotes, portal login and sessions, document, file)', left === 0, `${left} rows left`)
  } catch (e) { check('cleaned up', false, String(e).split('\n')[0]) }
  const failed = results.filter(r => !r).length
  console.log(`\n${results.length - failed} of ${results.length} checks passed`)
  process.exit(failed ? 1 : 0)
}
