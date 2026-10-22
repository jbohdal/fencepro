// The customer portal: signed in by an httpOnly cookie, nothing kept in the
// browser, and customer A never sees customer B (Jonathan, Oct 20, 2026).
//
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 E2E_ACCESS_TOKEN=<dev owner token> \
//     MEDIA_PHOTO=<a .jpg> node e2e/portal-isolation.mjs
//   SHOTS=<folder>   saves dev-portal-signin.png and dev-portal-quotes.png
//
// The office (API, as the owner) makes customers A and B, each with a sent
// quote, a sold quote and its job, a sent change order, a document and a reply
// from the office, and invites both to the portal (the dev copy sends no
// email: with no email settings nothing is sent, the invite answers "not
// sent, email is not set up" and gives the link). Then, each in their own browser
// (A: a 390 x 844 WebKit phone; B: desktop Chromium), the customer sets a
// password on the link, uploads a photo and sends a message. Checked:
//   - the sign in is a cookie the page cannot read (HttpOnly, SameSite=Strict,
//     path /api/portal), and localStorage, sessionStorage and IndexedDB stay
//     empty on every portal page;
//   - every page of A's shows A's quotes, projects, change orders, documents,
//     photos and messages, and nothing of B's;
//   - from A's browser, B's file paths, the office's routes for B and signing
//     B's change order are refused;
//   - a reload keeps A signed in (the server knows the session), an office
//     reply shows after a reload; Sign out ends it, and the old cookie no
//     longer reads anything.
// Dev copy only (port 4001). Removes everything it made.
import './devOnly.mjs'
import { webkit, chromium } from 'playwright'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || 'http://localhost:4001'
const TOKEN = process.env.E2E_ACCESS_TOKEN || ''
const SHOTS = process.env.SHOTS || ''
const PHOTO = process.env.MEDIA_PHOTO || ''
if (!TOKEN) { console.error('Set E2E_ACCESS_TOKEN (an owner login on the dev server).'); process.exit(2) }
if (!PHOTO || !fs.existsSync(PHOTO)) { console.error('Set MEDIA_PHOTO to a .jpg to upload.'); process.exit(2) }
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const call = async (method, p, body, headers = {}) => {
  const isForm = body instanceof FormData
  const r = await fetch(`${API}${p}`, { method, headers: { Authorization: `Bearer ${TOKEN}`, ...(isForm || body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, body: body === undefined ? undefined : isForm ? body : JSON.stringify(body) })
  return { status: r.status, json: await r.json().catch(() => ({})) }
}
// The dev database by name (never live).
const sql = q => execFileSync('psql', ['-d', 'ezbiz_dev', '-At', '-v', 'ON_ERROR_STOP=1', '-c', q]).toString().trim()
async function until(fn, ms = 20000, every = 400) { const end = Date.now() + ms; for (;;) { const v = await fn().catch(() => null); if (v || Date.now() > end) return v; await sleep(every) } }
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name), fullPage: true }).catch(() => {}) }

const stamp = Date.now().toString(36).slice(-5)
const mk = n => ({
  n, contactId: crypto.randomUUID(), sentQuote: crypto.randomUUID(), soldQuote: crypto.randomUUID(), jobId: crypto.randomUUID(),
  name: `E2E Iso ${n} ${stamp}`, email: `e2e-portal-iso-${n.toLowerCase()}-${stamp}@example.invalid`, price: n === 'A' ? 3100 : 7700,
})
const A = mk('A'), B = mk('B')

async function office(w) {
  const c = await call('POST', '/api/crm-contacts', { id: w.contactId, firstName: 'E2E Iso', lastName: `${w.n} ${stamp}`, phone: w.n === 'A' ? '3525550161' : '3525550162', email: w.email, leadSource: 'Other', serviceAddress: `${w.n === 'A' ? 11 : 22} Iso Way, Ocala, FL 34470` })
  const base = { crmContactId: w.contactId, customerName: w.name, customerPhone: '3525550160', customerEmail: w.email, customerAddress: '1 Iso Way', leadSource: 'Other', salesRep: 'E2E', fenceStyle: "WV-ND 6'x6' Privacy", corners: 0, ends: 2, materialCost: 1500, laborCost: 900, tearOutCost: 0, totalCOGS: 2400, gmPct: 0.5, pullSheet: [] }
  const q1 = await call('POST', '/api/saved-quotes', { ...base, id: w.sentQuote, date: '2026-10-20', runs: [60], sections: 10, finalPrice: w.price, status: 'SENT' })
  const q2 = await call('POST', '/api/saved-quotes', { ...base, id: w.soldQuote, date: '2026-10-18', runs: [96], sections: 16, finalPrice: w.price + 1000, status: 'SOLD' })
  const j = await call('POST', '/api/saved-jobs', { id: w.jobId, quoteId: w.soldQuote, crmContactId: w.contactId, customerName: w.name, fenceStyle: "WV-ND 6'x6' Privacy", sections: 16, quotePrice: w.price + 1000, contractValue: w.price + 1000, status: 'scheduled', scheduledDate: '2026-11-03' })
  const co = (await call('POST', '/api/change-orders', { quoteId: w.soldQuote, reason: `Change for ${w.n} ${stamp}`, lines: [{ id: 'l1', description: `Gate for ${w.n} ${stamp}`, amountCents: 40000 }] })).json.data
  const sent = await call('PATCH', `/api/change-orders/${co.id}`, { baseVersion: co.version, status: 'sent' })
  w.co = co.id
  const fd = new FormData()
  fd.append('label', `Office doc ${w.n} ${stamp}`)
  fd.append('file', new Blob([`%PDF-1.4 office ${w.n}`], { type: 'application/pdf' }), `office-${w.n}.pdf`)
  const doc = await call('POST', `/api/portal/customer/${w.contactId}/documents`, fd)
  w.staffDoc = doc.json.data?.id
  const msg = await call('POST', `/api/portal/customer/${w.contactId}/messages`, { body: `Office says hi to ${w.n} ${stamp}`, sender: 'E2E' })
  w.staffMsg = msg.json.data?.id
  const inv = await call('POST', '/api/portal/invite', { crmCustomerId: w.contactId, email: w.email, firstName: 'E2E Iso', lastName: `${w.n} ${stamp}` })
  w.rawToken = ((inv.json.data?.activationUrl || '').match(/token=([0-9a-f]{64})/) || [])[1]
  check(`office: customer ${w.n} with quotes, job, change order, document, message and invite`, [c, q1, q2, j].every(r => r.status < 300) && sent.status === 200 && !!w.staffDoc && !!w.staffMsg && !!w.rawToken && inv.status === 200,
    [c, q1, q2, j, sent, doc, msg, inv].map(r => r.status).join(','))
  check(`office: customer ${w.n}'s invite says not sent (dev: email not set up), never a fake "sent"`, inv.json.data?.emailSent === false && inv.json.data?.emailNotSetUp === true, JSON.stringify({ emailSent: inv.json.data?.emailSent, emailNotSetUp: inv.json.data?.emailNotSetUp }))
}

/** What the browser keeps: storage (must be empty) and the cookie (must be httpOnly). */
async function browserState(page) {
  return page.evaluate(async () => ({
    local: Object.keys(localStorage), session: Object.keys(sessionStorage),
    idb: indexedDB.databases ? (await indexedDB.databases()).map(d => d.name) : [],
    docCookie: document.cookie,
  }))
}

async function customer(browserType, w, ctxOpts) {
  const br = await browserType.launch()
  const ctx = await br.newContext(ctxOpts)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 300)))
  await page.goto(`${APP}/#/portal/activate?token=${w.rawToken}`)
  await page.waitForSelector('input[type="password"]', { timeout: 60000 })
  const pw = page.locator('input[type="password"]')
  await pw.nth(0).fill('e2e-iso-pass-1'); await pw.nth(1).fill('e2e-iso-pass-1')
  await page.locator('form button[type="submit"]').click()
  await page.waitForFunction(() => location.hash.startsWith('#/portal/dashboard'), null, { timeout: 30000 })
  // Upload a photo and send a message, as the customer.
  await page.goto(`${APP}/#/portal/photos`)
  await page.locator('input[type="file"]').setInputFiles(PHOTO)
  await until(async () => (await page.locator('[data-portal-photo]').count()) > 0, 30000)
  w.photo = await page.locator('[data-portal-photo]').first().getAttribute('data-portal-photo')
  await page.goto(`${APP}/#/portal/messages`)
  await page.locator('[data-portal-message-draft]').fill(`Hello from ${w.n} ${stamp}`)
  await page.getByRole('button', { name: 'Send' }).click()
  await until(async () => (await page.locator('[data-portal-message]').count()) >= 2, 20000)
  return { br, ctx, page, errors }
}

let brA, brB
try {
  await office(A)
  await office(B)
  const a = await customer(webkit, A, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })
  brA = a.br
  const b = await customer(chromium, B, { viewport: { width: 1280, height: 900 } })
  brB = b.br
  check('both customers signed in, uploaded a photo and sent a message', !!A.photo && !!B.photo)

  // ── The cookie, and nothing in the browser ──
  const cookies = await a.ctx.cookies(APP + '/api/portal/me')
  const ck = cookies.find(c => c.name === 'ezbiz_portal')
  check('sign in: an httpOnly, SameSite=Strict cookie for /api/portal only', !!ck && ck.httpOnly && ck.sameSite === 'Strict' && ck.path === '/api/portal', ck ? `${ck.httpOnly} ${ck.sameSite} ${ck.path}` : 'none')

  // ── A's every page: A's things, nothing of B's ──
  const bWords = [B.name, `Gate for B ${stamp}`, `Office doc B ${stamp}`, `Office says hi to B ${stamp}`, `Hello from B ${stamp}`, '22 Iso Way', '$7,700', '$8,700']
  const bIds = [B.contactId, B.sentQuote, B.soldQuote, B.jobId, B.co, B.staffDoc, B.staffMsg, B.photo]
  const pages = ['dashboard', 'quotes', 'change-orders', 'projects', 'invoices', 'documents', 'photos', 'messages', 'account']
  const seen = {}
  let leaks = [], stored = []
  for (const p of pages) {
    await a.page.goto(`${APP}/#/portal/${p}`)
    await a.page.waitForFunction(() => !document.querySelector('[data-portal-loading]') && !/Loading…/.test(document.querySelector('main')?.innerText || ''), null, { timeout: 20000 }).catch(() => {})
    await sleep(500)
    const html = await a.page.content()
    for (const x of [...bWords, ...bIds]) if (html.includes(x)) leaks.push(`${p}: ${x}`)
    seen[p] = await a.page.evaluate(() => [...document.querySelectorAll('[data-portal-quote],[data-portal-project],[data-portal-co],[data-portal-doc],[data-portal-photo],[data-portal-message]')]
      .map(e => [...e.attributes].find(x => /^data-portal-(quote|project|co|doc|photo|message)$/.test(x.name))?.value))
    const st = await browserState(a.page)
    if (st.local.length || st.session.length || st.idb.length || /ezbiz_portal/.test(st.docCookie)) stored.push(`${p}: ${JSON.stringify(st)}`)
    if (p === 'quotes') await shot(a.page, 'dev-portal-quotes.png')
  }
  check("A's pages show nothing of B's (names, amounts, addresses, ids)", leaks.length === 0, leaks.slice(0, 5).join(' | '))
  check("A's quotes page: A's sent and sold quotes", JSON.stringify([...seen.quotes].sort()) === JSON.stringify([A.sentQuote, A.soldQuote].sort()), seen.quotes.join(','))
  check("A's projects, change orders, documents, photos: A's own", seen.projects.join() === A.jobId && seen['change-orders'].join() === A.co && seen.documents.join() === A.staffDoc && seen.photos.join() === A.photo, `${seen.projects} | ${seen['change-orders']} | ${seen.documents} | ${seen.photos}`)
  check("A's messages: A's own and the office's reply to A", seen.messages.length === 2 && seen.messages.includes(A.staffMsg), seen.messages.join(','))
  check('nothing in localStorage, sessionStorage or IndexedDB on any portal page; the page cannot read the cookie', stored.length === 0, stored.slice(0, 2).join(' | '))
  const stB = await browserState(b.page)
  check("B's browser keeps nothing either", !stB.local.length && !stB.session.length && !stB.idb.length, JSON.stringify(stB))

  // ── From A's browser, B's things directly ──
  const bPhotos = (await call('GET', `/api/portal/customer/${B.contactId}/photos`)).json.data ?? []
  const bKey = bPhotos.find(p => p.id === B.photo)?.fileKey || ''
  const tries = await a.page.evaluate(async ({ api, bKey, bContact, bCo, bPhoto }) => {
    const get = async (u, init = {}) => (await fetch(api + u, { credentials: 'include', ...init })).status
    return {
      bareFile: await get(`/api/portal/files/${encodeURIComponent(bKey)}`),
      officePhotos: await get(`/api/portal/customer/${bContact}/photos`),
      officeMessages: await get(`/api/portal/customer/${bContact}/messages`),
      deletePhoto: await get(`/api/portal/photos/${bPhoto}`, { method: 'DELETE', headers: { 'X-Portal-Request': '1' } }),
      signCo: await get(`/api/portal/change-orders/${bCo}/sign`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Portal-Request': '1' }, body: JSON.stringify({ name: 'Intruder', signature: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==' }) }),
      noHeader: await get('/api/portal/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: 'no header' }) }),
    }
  }, { api: API, bKey, bContact: B.contactId, bCo: B.co, bPhoto: B.photo })
  check("from A's browser: B's file path, the office's routes for B, deleting B's photo, signing B's change order are refused",
    tries.bareFile === 404 && tries.officePhotos === 401 && tries.officeMessages === 401 && tries.deletePhoto === 401 && tries.signCo === 404 && !!bKey, JSON.stringify(tries))
  check('a write without the portal header is refused (cross site)', tries.noHeader === 403, String(tries.noHeader))
  check("B's change order still waits for B; B's photo is still there", sql(`SELECT status FROM "ChangeOrder" WHERE id = '${B.co}'`) === 'sent' && sql(`SELECT count(*) FROM "PortalPhoto" WHERE id = '${B.photo}' AND "deletedAt" IS NULL`) === '1')

  // ── Reload: still signed in (the server's session); the office's new reply shows ──
  await call('POST', `/api/portal/customer/${A.contactId}/messages`, { body: `Second reply to A ${stamp}`, sender: 'E2E' })
  await a.page.goto(`${APP}/#/portal/messages`)
  await a.page.reload()
  const replyShown = await until(async () => (await a.page.content()).includes(`Second reply to A ${stamp}`), 20000)
  check('after a reload A is still signed in and sees the office reply', !!replyShown)

  // ── Sign out: the session ends ──
  const before = (await a.ctx.cookies(APP + '/api/portal/me')).find(c => c.name === 'ezbiz_portal')?.value || ''
  await a.page.goto(`${APP}/#/portal/dashboard`)
  await a.page.locator('[data-portal-signout]').click()
  await a.page.waitForFunction(() => location.hash.startsWith('#/portal/login'), null, { timeout: 20000 })
  await a.page.waitForSelector('input[type="email"]', { timeout: 20000 })
  await shot(a.page, 'dev-portal-signin.png')
  const oldCookie = await fetch(`${API}/api/portal/quotes`, { headers: { Cookie: `ezbiz_portal=${before}` } })
  await a.page.reload()
  const stillOut = await until(async () => (await a.page.locator('input[type="email"]').count()) > 0, 20000)
  check('Sign out ends the session: the old cookie reads nothing, a reload shows the sign in page', oldCookie.status === 401 && !!stillOut && !!before, String(oldCookie.status))
  check('no page errors', a.errors.length === 0 && b.errors.length === 0, [...a.errors, ...b.errors].slice(0, 3).join(' | '))
} catch (e) {
  check('ran to the end', false, String(e).split('\n').slice(0, 3).join(' '))
} finally {
  await brA?.close().catch(() => {})
  await brB?.close().catch(() => {})
  try {
    for (const w of [A, B]) {
      sql(`BEGIN;
        DELETE FROM "CrmAuditLog" WHERE "entityType" = 'ChangeOrder' AND "entityId" IN (SELECT id FROM "ChangeOrder" WHERE "quoteId" = '${w.soldQuote}');
        DELETE FROM "ChangeOrder" WHERE "quoteId" = '${w.soldQuote}';
        DELETE FROM "JobQuotedCost" WHERE "quoteId" IN ('${w.soldQuote}', '${w.sentQuote}');
        DELETE FROM "AutomationEvent" WHERE "entityId" IN ('${w.jobId}', '${w.soldQuote}', '${w.sentQuote}', '${w.contactId}');
        DELETE FROM "JobChecklistItem" WHERE "jobId" = '${w.jobId}';
        DELETE FROM "SavedJob" WHERE id = '${w.jobId}' OR "quoteId" IN ('${w.soldQuote}', '${w.sentQuote}');
        DELETE FROM "SavedQuote" WHERE id IN ('${w.soldQuote}', '${w.sentQuote}');
        DELETE FROM "PortalPhoto" WHERE "crmCustomerId" = '${w.contactId}';
        DELETE FROM "PortalFile" WHERE "crmCustomerId" = '${w.contactId}';
        DELETE FROM "PortalMessage" WHERE "crmCustomerId" = '${w.contactId}';
        DELETE FROM "PortalAccount" WHERE "crmCustomerId" = '${w.contactId}';
        DELETE FROM "Notification" WHERE body LIKE '%${w.email}%';
        DELETE FROM "CrmAuditLog" WHERE "entityId" IN ('${w.jobId}', '${w.soldQuote}', '${w.sentQuote}', '${w.contactId}');
        UPDATE "BusinessState" SET "pullSheets" = COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements("pullSheets") e WHERE COALESCE(e->>'quoteId', '') NOT IN ('${w.soldQuote}', '${w.sentQuote}')), '[]'::jsonb), version = version + 1 WHERE "pullSheets"::text LIKE '%${w.soldQuote}%' OR "pullSheets"::text LIKE '%${w.sentQuote}%';
        DELETE FROM "CrmContact" WHERE id = '${w.contactId}';
        COMMIT;`)
      fs.rmSync(path.resolve(process.cwd(), '../portal/uploads/portal', w.contactId), { recursive: true, force: true })
    }
    const ids = [A, B].flatMap(w => [w.contactId])
    const left = Number(sql(`SELECT (SELECT count(*) FROM "SavedQuote" WHERE "crmContactId" IN ('${ids.join("','")}')) + (SELECT count(*) FROM "SavedJob" WHERE id IN ('${A.jobId}', '${B.jobId}')) + (SELECT count(*) FROM "PortalAccount" WHERE "crmCustomerId" IN ('${ids.join("','")}')) + (SELECT count(*) FROM "PortalPhoto" WHERE "crmCustomerId" IN ('${ids.join("','")}')) + (SELECT count(*) FROM "PortalFile" WHERE "crmCustomerId" IN ('${ids.join("','")}')) + (SELECT count(*) FROM "PortalMessage" WHERE "crmCustomerId" IN ('${ids.join("','")}')) + (SELECT count(*) FROM "CrmContact" WHERE id IN ('${ids.join("','")}'))`))
    const files = [A, B].filter(w => fs.existsSync(path.resolve(process.cwd(), '../portal/uploads/portal', w.contactId))).length
    check('cleaned up (customers, quotes, jobs, change orders, portal logins and sessions, photos, documents, messages, files)', left === 0 && files === 0, `${left} rows, ${files} folders left`)
  } catch (e) { check('cleaned up', false, String(e).split('\n')[0]) }
  const failed = results.filter(r => !r).length
  console.log(`\n${results.length - failed} of ${results.length} checks passed`)
  process.exit(failed ? 1 : 0)
}
