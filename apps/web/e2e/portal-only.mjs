// The customer portal shows only what Jonathan listed (Oct 22, 2026): "Photos
// marked Customer (the photos of their yard and survey). Their site plan.
// Billing: payment schedule, invoices, payments, receipts, balance. Their
// signed contract and warranty certificate. Never in the portal: pull sheets,
// material lists, costs, internal notes, internal or crew photos, crew packet,
// follow ups, call logs. Enforce it on the server, not just by hiding tabs."
//
//   cd apps/web && pnpm -s build
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 E2E_ACCESS_TOKEN=<dev owner token> \
//     MEDIA_PHOTO=<a .jpg> node e2e/portal-only.mjs
//   SHOTS=<folder>   saves dev-portal-billing.png, dev-portal-papers.png, dev-portal-quotes-plan.png
//
// The office (API as the owner, and psql on ezbiz_dev for what has no office
// screen to make it from: a call log, a follow up, photos with a set
// visibility, a finished walkthrough's certificate) gives one customer every
// forbidden thing: an internal note, an internal and a crew photo, a sent
// quote with a pull sheet and costs whose proposal options carry a cost
// snapshot, a sold quote and its job (crew and notes on it), an install
// packet, a call log, a follow up, a document kept internal, a photo the office
// uploaded, a payment with an office note. And the allowed things: a photo
// marked Customer, the proposal's site plan, the payment schedule with a
// payment and its receipt, the signed contract, the warranty certificate.
// The customer signs in (desktop Chromium on /#/portal, a 390 x 844 WebKit
// phone through the public door /p/portal/) and opens every portal page.
// Every answer the portal's API gave the browser is recorded: none holds a
// forbidden value or field name (materialCost, laborCost, totalCOGS, gmPct,
// pullSheet, unitCost, ...); nor does any page. The allowed things show.
// Dev copy only (port 4001). Removes everything it made.
import './devOnly.mjs'
import './sharedLock.mjs'
import { chromium, webkit } from 'playwright'
import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || 'http://localhost:4001'
const TOKEN = process.env.E2E_ACCESS_TOKEN || ''
const PHOTO = process.env.MEDIA_PHOTO || ''
const SHOTS = process.env.SHOTS || ''
if (!TOKEN) { console.error('Set E2E_ACCESS_TOKEN (an owner login on the dev server).'); process.exit(2) }
if (!PHOTO || !fs.existsSync(PHOTO)) { console.error('Set MEDIA_PHOTO to a .jpg.'); process.exit(2) }
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const call = async (method, p, body) => {
  const isForm = body instanceof FormData
  const r = await fetch(`${API}${p}`, { method, headers: { Authorization: `Bearer ${TOKEN}`, ...(isForm || body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : isForm ? body : JSON.stringify(body) })
  return { status: r.status, json: await r.json().catch(() => ({})) }
}
const sql = q => execFileSync('psql', ['-d', 'ezbiz_dev', '-At', '-v', 'ON_ERROR_STOP=1', '-c', q]).toString().trim()
const lit = s => `'${String(s).replace(/'/g, "''")}'`
async function until(fn, ms = 20000, every = 400) { const end = Date.now() + ms; for (;;) { const v = await fn().catch(() => null); if (v || Date.now() > end) return v; await sleep(every) } }

const stamp = Date.now().toString(36).slice(-5)
const S = x => `${x} ${stamp}`
const W = { contactId: crypto.randomUUID(), sent: crypto.randomUUID(), sold: crypto.randomUUID(), jobId: crypto.randomUUID(), email: `e2e-portal-only-${stamp}@example.invalid`, cardId: `e2e-only-card-${stamp}`, media: {}, tmp: fs.mkdtempSync(path.join(os.tmpdir(), 'portal-only-')) }
// Never in the portal (values only this run has).
const SECRET = {
  note: S('INTERNAL NOTE gate code'), followUp: S('FOLLOWUP call after payday'), callLog: S('CALLLOG wife decides'), jobNote: S('JOBNOTE dog bites'),
  quoteNote: S('QUOTENOTE thin margin'), payNote: S('PAYNOTE post dated'), part: S('Secret Pull Part'), crew: S('Crew Alpha'), packetNote: S('PACKET gate code'),
  internalDoc: S('internal estimate'), staffPhoto: `office-photo-${stamp}`, internalCaption: S('internal caption'), crewCaption: S('crew caption'),
}
const COST_VALUES = ['1234.56', '987.65', '2469.12', '777.77', '3246.89', '9.87']
const FIELDS = ['materialCost', 'laborCost', 'tearOutCost', 'totalCOGS', 'gmPct', 'pullSheet', 'unitCost', 'unitCostCents', 'totalCostCents', 'pricing', 'layout', 'proposal', 'snapshot',
  'notes', 'crewAssigned', 'recordedBy', 'photoKey', 'senderUser', 'visibility', 'takenBy', 'outcome', 'cardId', 'lastOutcome', 'uploadedBy', 'isVisibleToCustomer']
const fieldRe = new RegExp(`"(${FIELDS.join('|')})"\\s*:`)

let brs = []
try {
  // ── The office ──
  const c = await call('POST', '/api/crm-contacts', { id: W.contactId, firstName: 'E2E Only', lastName: stamp, phone: '3525550179', email: W.email, leadSource: 'Other', serviceAddress: '9 Only Way, Ocala, FL 34470' })
  const note = await call('POST', `/api/crm-contacts/${W.contactId}/notes`, { body: SECRET.note, visibility: 'internal' })
  const sheet = [{ item: SECRET.part, qty: 2, unitCost: 1234.56, total: 2469.12 }]
  const planTitle = S('SITEPLAN')
  const proposal = { version: 1, createdAt: new Date().toISOString(), company: { name: 'Getter Done Fence', phone: '3527894314', email: '' }, customer: { name: `E2E Only ${stamp}`, address: '9 Only Way' }, footageFt: 96, gatesText: '1 walk gate', included: ['96 ft of new fence'], includedNote: '', warranty: '', depositPct: 50, depositNote: '', financing: null, recommended: 0,
    planSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" width="400" height="200"><title>${planTitle}</title><rect x="10" y="10" width="180" height="80" fill="none" stroke="#5E28A1" stroke-width="4"/></svg>`,
    options: [{ label: 'White Vinyl Privacy', fenceStyle: "WV-ND 6'x6' Privacy", finalPrice: 4800, perFoot: 50, sections: 16, snapshot: { materialCost: 987.65, laborCost: 777.77, tearOutCost: 0, totalCOGS: 3246.89, gmPct: 0.31, pullSheet: sheet, runSections: [16] } }] }
  const base = { crmContactId: W.contactId, customerName: `E2E Only ${stamp}`, customerPhone: '3525550179', customerEmail: W.email, customerAddress: '9 Only Way, Ocala, FL 34470', leadSource: 'Other', salesRep: 'E2E', fenceStyle: "WV-ND 6'x6' Privacy",
    corners: 1, ends: 2, materialCost: 2469.12, laborCost: 777.77, tearOutCost: 0, totalCOGS: 3246.89, gmPct: 0.31, pullSheet: sheet, runs: [96], sections: 16, notes: SECRET.quoteNote, pricing: { laborMode: 'subcontractor', subRate: 9.87 }, proposal }
  const q1 = await call('POST', '/api/saved-quotes', { ...base, id: W.sent, date: '2026-10-21', finalPrice: 4800, status: 'SENT' })
  const q2 = await call('POST', '/api/saved-quotes', { ...base, id: W.sold, date: '2026-10-22', finalPrice: 4800, status: 'SOLD' })
  const j = await call('POST', '/api/saved-jobs', { id: W.jobId, quoteId: W.sold, crmContactId: W.contactId, customerName: `E2E Only ${stamp}`, customerAddress: '9 Only Way, Ocala, FL 34470', fenceStyle: "WV-ND 6'x6' Privacy", sections: 16, quotePrice: 4800, contractValue: 4800, status: 'scheduled', scheduledDate: '2026-11-04', crewAssigned: SECRET.crew, notes: SECRET.jobNote })
  const pk = await call('POST', '/api/install-packets', { jobId: W.jobId, snapshot: { style: 'White Vinyl Privacy', pullSheet: [{ item: SECRET.part, qty: 2 }], notes: SECRET.packetNote } })
  W.packet = pk.json.data?.token
  const pay = await call('POST', '/api/payments', { id: `e2eonly${stamp}pay1`, jobId: W.jobId, amountCents: 240000, method: 'check', checkNumber: '4411', note: SECRET.payNote })
  W.receiptToken = pay.json.data?.receipt?.token
  // Office documents and photo: one kept internal, one shared, one photo uploaded on the customer page.
  const doc = (label, visible) => { const fd = new FormData(); fd.append('label', label); fd.append('isVisibleToCustomer', visible ? 'true' : 'false'); fd.append('file', new Blob([`%PDF-1.4 ${label}`], { type: 'application/pdf' }), `${label.replace(/\s/g, '-')}.pdf`); return call('POST', `/api/portal/customer/${W.contactId}/documents`, fd) }
  const d1 = await doc(SECRET.internalDoc, false), d2 = await doc(S('HOA approval'), true)
  W.internalDoc = d1.json.data?.id; W.sharedDoc = d2.json.data?.id
  const pfd = new FormData(); pfd.append('file', new Blob([fs.readFileSync(PHOTO)], { type: 'image/jpeg' }), `${SECRET.staffPhoto}.jpg`); pfd.append('caption', SECRET.staffPhoto)
  W.staffPhoto = (await call('POST', `/api/portal/customer/${W.contactId}/photos`, pfd)).json.data?.id
  const msg = await call('POST', `/api/portal/customer/${W.contactId}/messages`, { body: S('Your fence is on the schedule'), sender: 'E2E Office Person' })
  // No office screen makes these on purpose: rows in the dev database.
  const accountId = sql(`SELECT "accountId" FROM "CrmContact" WHERE id = ${lit(W.contactId)}`)
  const ownerId = sql(`SELECT id FROM "CrmUser" WHERE "crmAccountId" = ${lit(accountId)} AND role = 'super_admin' ORDER BY "createdAt" LIMIT 1`)
  sql(`INSERT INTO "CallLog" (id, "accountId", "cardId", "crmContactId", "userId", outcome, note) VALUES (${lit('e2e-only-call-' + stamp)}, ${lit(accountId)}, ${lit(W.cardId)}, ${lit(W.contactId)}, ${lit(ownerId)}, 'deciding', ${lit(SECRET.callLog)})`)
  sql(`INSERT INTO "CardFollowUp" ("accountId", "cardId", stage, "stageSince", "dueOn", "lastOutcome", "updatedAt") VALUES (${lit(accountId)}, ${lit(W.cardId)}, 'Quoted', '2026-10-20', '2026-10-25', ${lit(SECRET.followUp)}, now())`)
  for (const [vis, cat, cap] of [['customer', 'Before', S('Your yard before')], ['internal', 'Site walk', SECRET.internalCaption], ['crew', 'Progress', SECRET.crewCaption]]) {
    const id = crypto.randomUUID(), f = path.join(W.tmp, `${vis}.jpg`)
    fs.copyFileSync(PHOTO, f)
    sql(`INSERT INTO "MediaItem" (id, "accountId", "clientId", kind, mime, path, bytes, "customerId", "jobId", "takenBy", "takenAt", lat, lng, caption, category, visibility, status, "updatedAt")
      VALUES (${lit(id)}, ${lit(accountId)}, ${lit('e2e-only-' + vis + '-' + stamp)}, 'photo', 'image/jpeg', ${lit(f)}, ${fs.statSync(f).size}, ${lit(W.contactId)}, ${vis === 'crew' ? lit(W.jobId) : 'NULL'}, 'E2E Office Person', now(), 29.18, -82.13, ${lit(cap)}, ${lit(cat)}, ${lit(vis)}, 'ready', now())`)
    W.media[vis] = id
  }
  const cert = path.join(W.tmp, 'certificate.pdf')
  fs.writeFileSync(cert, '%PDF-1.4 warranty certificate')
  sql(`INSERT INTO "Walkthrough" (id, "accountId", "jobId", status, "completedAt", "certificatePath", "updatedAt") VALUES (${lit(crypto.randomUUID())}, ${lit(accountId)}, ${lit(W.jobId)}, 'completed', now(), ${lit(cert)}, now())`)
  const inv = await call('POST', '/api/portal/invite', { crmCustomerId: W.contactId, email: W.email, firstName: 'E2E Only', lastName: stamp })
  const rawToken = ((inv.json.data?.activationUrl || '').match(/token=([0-9a-f]{64})/) || [])[1]
  check('office: every forbidden thing and every allowed thing made for one customer, and a portal invite',
    [c, note, q1, q2, j, pk, pay, d1, d2, msg].every(r => r.status < 300) && !!W.packet && !!W.receiptToken && !!W.staffPhoto && !!rawToken,
    [c, note, q1, q2, j, pk, pay, d1, d2, msg, inv].map(r => r.status).join(','))
  const FORBIDDEN = [...Object.values(SECRET), ...COST_VALUES, W.packet, W.media.internal, W.media.crew, W.internalDoc, W.staffPhoto, W.cardId, 'E2E Office Person']

  // ── The customer, in two browsers ──
  async function customer(type, opts, door, first) {
    const br = await type.launch()
    brs.push(br)
    const ctx = await br.newContext(opts)
    const page = await ctx.newPage()
    const errors = [], bodies = []
    page.on('pageerror', e => errors.push(String(e).slice(0, 300)))
    page.on('response', async r => {
      const u = r.url()
      if (/\/api\/portal\/|\/p\/portal\/api\//.test(u)) bodies.push({ url: u.replace(APP, ''), type: r.headers()['content-type'] || '', text: await r.text().catch(() => '') })
    })
    const root = door ? `${APP}/p/portal/` : `${APP}/`
    if (first) {
      await page.goto(`${root}#/portal/activate?token=${rawToken}`)
      await page.waitForSelector('input[type="password"]', { timeout: 60000 })
      const pw = page.locator('input[type="password"]')
      await pw.nth(0).fill('e2e-only-pass-1'); await pw.nth(1).fill('e2e-only-pass-1')
      await page.locator('form button[type="submit"]').click()
    } else {
      await page.goto(`${root}#/portal/login`)
      await page.waitForSelector('input[type="email"]', { timeout: 60000 })
      await page.locator('input[type="email"]').fill(W.email)
      await page.locator('input[type="password"]').fill('e2e-only-pass-1')
      await page.locator('form button[type="submit"]').click()
    }
    await page.waitForFunction(() => location.hash.startsWith('#/portal/dashboard'), null, { timeout: 30000 })
    return { br, ctx, page, errors, bodies, root }
  }

  const runs = [
    ['desktop', chromium, { viewport: { width: 1280, height: 900 } }, false, true],
    ['phone (public door)', webkit, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }, true, false],
  ]
  for (const [size, type, opts, door, first] of runs) {
    const x = await customer(type, opts, door, first)
    const pageLeaks = []
    for (const p of ['dashboard', 'quotes', 'change-orders', 'projects', 'invoices', 'papers', 'documents', 'photos', 'messages', 'account']) {
      await x.page.goto(`${x.root}#/portal/${p}`)
      await x.page.waitForFunction(() => !document.querySelector('[data-portal-loading]') && !/Loading…/.test(document.querySelector('main')?.innerText || ''), null, { timeout: 20000 }).catch(() => {})
      await sleep(600)
      if (p === 'quotes') {
        for (const d of await x.page.locator('[data-portal-plan]').all()) await d.locator('summary').click()
        await until(async () => x.page.locator('[data-portal-plan-img]').first().evaluate(i => i.complete && i.naturalWidth > 0), 10000)
        if (SHOTS && !door) await x.page.screenshot({ path: path.join(SHOTS, 'dev-portal-quotes-plan.png'), fullPage: true })
      }
      if (SHOTS && !door && p === 'invoices') await x.page.screenshot({ path: path.join(SHOTS, 'dev-portal-billing.png'), fullPage: true })
      if (SHOTS && door && p === 'papers') await x.page.screenshot({ path: path.join(SHOTS, 'dev-portal-papers.png'), fullPage: true })
      const html = await x.page.content()
      for (const v of FORBIDDEN) if (v && html.includes(v)) pageLeaks.push(`${p}: ${v}`)
    }
    check(`${size}: no portal page shows any forbidden thing`, pageLeaks.length === 0, pageLeaks.slice(0, 4).join(' | '))

    // Every answer the portal API gave: no forbidden value or field name.
    const leaks = []
    for (const b of x.bodies) {
      for (const v of FORBIDDEN) if (v && b.text.includes(v)) leaks.push(`${b.url}: ${v}`)
      const f = b.type.includes('json') ? b.text.match(fieldRe) : null
      if (f) leaks.push(`${b.url}: "${f[1]}"`)
    }
    const routes = [...new Set(x.bodies.map(b => b.url.replace(/[?#].*$/, '').replace(/^\/(api\/portal|p\/portal\/api)/, '').replace(/\/[0-9a-f-]{36}(\.\w+)?$/, '/<id>$1')))].sort()
    check(`${size}: no answer of the portal's API holds a forbidden value or field (${x.bodies.length} answers: ${routes.join(' ')})`, leaks.length === 0 && x.bodies.length >= 10, leaks.slice(0, 5).join(' | '))
    check(`${size}: the answers come from the right door`, x.bodies.every(b => door ? b.url.startsWith('/p/portal/api/') : b.url.startsWith('/api/portal/')), [...new Set(x.bodies.map(b => b.url.split('/').slice(0, 3).join('/')))].join(' '))

    // ── What is allowed is there ──
    const api = door ? '/p/portal/api' : '/api/portal'
    const j1 = async p => JSON.parse(x.bodies.filter(b => b.url.split('?')[0] === api + p).pop()?.text || 'null')?.data
    const quotes = await j1('/quotes')
    check(`${size}: quotes: both, price and plain style name, the site plan as an image, the signed contract link`, quotes?.length === 2 && quotes.every(q => q.priceCents === 480000 && !/WV-ND/.test(q.style) && q.hasPlan) && quotes.find(q => q.id === W.sold)?.hasContract === true,
      JSON.stringify(quotes?.map(q => Object.keys(q).join('/'))))
    const planAns = x.bodies.find(b => b.url.includes('/site-plans/'))
    check(`${size}: the site plan image loads and is the proposal's drawing`, !!planAns && /image\/svg\+xml/.test(planAns.type) && planAns.text.includes(planTitle), planAns?.url || 'not loaded')
    const media = await j1('/media')
    const photos = await j1('/photos')
    check(`${size}: photos: the one marked Customer only (not internal, crew or the office's upload)`, media?.map(m => m.id).join() === W.media.customer && Array.isArray(photos) && !photos.some(p => p.id === W.staffPhoto), `${media?.map(m => m.id)} | ${photos?.length}`)
    const billing = await j1('/billing')
    const b0 = billing?.[0]
    check(`${size}: billing: the schedule, invoices, the payment, its receipt link and the balance`, b0?.contractCents === 480000 && b0?.paidCents === 240000 && b0?.balanceCents === 240000 && b0?.invoices?.length >= 2 && b0?.payments?.[0]?.receipt?.link === `/p/r/${W.receiptToken}`, JSON.stringify(b0 && { c: b0.contractCents, p: b0.paidCents, b: b0.balanceCents, n: b0.invoices?.length }))
    await x.page.goto(`${x.root}#/portal/invoices`)
    await x.page.waitForSelector('[data-portal-receipt]', { timeout: 15000 })
    const rHref = await x.page.locator('[data-portal-receipt]').first().getAttribute('href')
    const receipt = await fetch(rHref.replace(/^https?:\/\/[^/]+/, APP))
    check(`${size}: the receipt link on the Billing page opens the receipt`, receipt.status === 200 && rHref.endsWith(`/p/r/${W.receiptToken}`), rHref)
    const papers = await j1('/papers')
    check(`${size}: Contract & Warranty: the signed contract and the warranty certificate`, papers?.contracts?.map(c => c.quoteId).join() === W.sold && papers?.certificates?.map(c => c.jobId).join() === W.jobId, JSON.stringify(papers))
    await x.page.goto(`${x.root}#/portal/papers`)
    await x.page.waitForSelector('[data-portal-contract]', { timeout: 15000 })
    const pdfs = await x.page.evaluate(async () => Promise.all([...document.querySelectorAll('[data-portal-contract],[data-portal-certificate]')].map(async a => {
      const r = await fetch(a.href, { credentials: 'include' }); const t = await r.text(); return `${r.status} ${r.headers.get('content-type')} ${t.slice(0, 5)}`
    })))
    check(`${size}: both PDFs open for the signed in customer`, pdfs.length === 2 && pdfs.every(p => /^200 application\/pdf %PDF-/.test(p)), pdfs.join(' | '))
    const docs = await j1('/documents')
    check(`${size}: documents: the shared one and the receipt, never the internal one`, docs?.some(d => d.id === W.sharedDoc) && !docs.some(d => d.id === W.internalDoc) && docs.some(d => /^receipt-/.test(d.name)), docs?.map(d => d.name).join(', '))
    const projects = await j1('/projects')
    check(`${size}: the job: status and install date only (no crew)`, JSON.stringify(Object.keys(projects?.[0] || {}).sort()) === JSON.stringify(['address', 'id', 'scheduledDate', 'status', 'style']), JSON.stringify(projects?.[0]))
    // Not the customer's: refused.
    const other = sql(`SELECT id FROM "SavedQuote" WHERE "crmContactId" IS NOT NULL AND "crmContactId" <> ${lit(W.contactId)} AND status = 'SOLD' AND "deletedAt" IS NULL LIMIT 1`)
    const refused = await x.page.evaluate(async ({ api, other, packet }) => {
      const st = async u => (await fetch(api + u, { credentials: 'include' })).status
      return [await st(`/contracts/${other}.pdf`), await st(`/site-plans/${other}.svg`), await st('/pull-sheets'), await st(`/install-packets?token=${packet}`), await st('/follow-ups')]
    }, { api: door ? `${APP}/p/portal/api` : `${APP}/api/portal`, other, packet: W.packet })
    check(`${size}: another customer's contract and plan, and any pull sheet, packet or follow up route: refused`, refused.every(s => s === 404 || s === 401), refused.join(','))
    check(`${size}: no page errors`, x.errors.length === 0, x.errors.slice(0, 2).join(' | '))
    await x.br.close()
  }
} catch (e) {
  check('ran to the end', false, String(e).split('\n').slice(0, 3).join(' '))
} finally {
  for (const b of brs) await b.close().catch(() => {})
  try {
    const files = sql(`SELECT "fileKey" FROM "PortalFile" WHERE "crmCustomerId" = ${lit(W.contactId)}`)
    sql(`BEGIN;
      DELETE FROM "PaymentApplication" WHERE "paymentId" IN (SELECT id FROM "ContractPayment" WHERE "jobId" = ${lit(W.jobId)});
      DELETE FROM "Receipt" WHERE "jobId" = ${lit(W.jobId)};
      DELETE FROM "ContractPayment" WHERE "jobId" = ${lit(W.jobId)};
      DELETE FROM "ContractInvoice" WHERE "jobId" = ${lit(W.jobId)};
      DELETE FROM "BillingLog" WHERE "jobId" = ${lit(W.jobId)};
      DELETE FROM "PaymentSchedule" WHERE "jobId" = ${lit(W.jobId)};
      DELETE FROM "Walkthrough" WHERE "jobId" = ${lit(W.jobId)};
      DELETE FROM "InstallPacket" WHERE "jobId" = ${lit(W.jobId)};
      DELETE FROM "MediaItem" WHERE "clientId" LIKE ${lit('e2e-only-%-' + stamp)};
      DELETE FROM "CallLog" WHERE id = ${lit('e2e-only-call-' + stamp)};
      DELETE FROM "CardFollowUp" WHERE "cardId" = ${lit(W.cardId)};
      DELETE FROM "CrmAuditLog" WHERE "entityId" IN (${lit(W.jobId)}, ${lit(W.sold)}, ${lit(W.sent)}, ${lit(W.contactId)}) OR "entityId" IN (SELECT id FROM "ContractPayment" WHERE "jobId" = ${lit(W.jobId)});
      DELETE FROM "JobQuotedCost" WHERE "quoteId" IN (${lit(W.sold)}, ${lit(W.sent)});
      DELETE FROM "AutomationEvent" WHERE "entityId" IN (${lit(W.jobId)}, ${lit(W.sold)}, ${lit(W.sent)}, ${lit(W.contactId)});
      DELETE FROM "JobChecklistItem" WHERE "jobId" = ${lit(W.jobId)};
      DELETE FROM "SavedJob" WHERE id = ${lit(W.jobId)};
      DELETE FROM "SavedQuote" WHERE id IN (${lit(W.sold)}, ${lit(W.sent)});
      DELETE FROM "PortalPhoto" WHERE "crmCustomerId" = ${lit(W.contactId)};
      DELETE FROM "PortalFile" WHERE "crmCustomerId" = ${lit(W.contactId)};
      DELETE FROM "PortalMessage" WHERE "crmCustomerId" = ${lit(W.contactId)};
      DELETE FROM "PortalAccount" WHERE "crmCustomerId" = ${lit(W.contactId)};
      DELETE FROM "Notification" WHERE body LIKE ${lit('%' + W.email + '%')};
      DELETE FROM "CrmContactNote" WHERE "crmContactId" = ${lit(W.contactId)};
      DELETE FROM "CrmContact" WHERE id = ${lit(W.contactId)};
      COMMIT;`)
    void files
    fs.rmSync(path.resolve(process.cwd(), '../portal/uploads/portal', W.contactId), { recursive: true, force: true })
    fs.rmSync(W.tmp, { recursive: true, force: true })
    const left = Number(sql(`SELECT (SELECT count(*) FROM "CrmContact" WHERE id = ${lit(W.contactId)}) + (SELECT count(*) FROM "SavedQuote" WHERE "crmContactId" = ${lit(W.contactId)}) + (SELECT count(*) FROM "SavedJob" WHERE id = ${lit(W.jobId)}) + (SELECT count(*) FROM "Receipt" WHERE "jobId" = ${lit(W.jobId)}) + (SELECT count(*) FROM "MediaItem" WHERE "clientId" LIKE ${lit('e2e-only-%-' + stamp)}) + (SELECT count(*) FROM "PortalAccount" WHERE "crmCustomerId" = ${lit(W.contactId)}) + (SELECT count(*) FROM "CallLog" WHERE id = ${lit('e2e-only-call-' + stamp)})`))
    const folder = fs.existsSync(path.resolve(process.cwd(), '../portal/uploads/portal', W.contactId))
    check('cleaned up (customer, quotes, job, billing, receipt, packet, walkthrough, photos, documents, messages, note, call log, follow up, portal login, files)', left === 0 && !folder, `${left} rows, folder ${folder}`)
  } catch (e) { check('cleaned up', false, String(e).split('\n')[0]) }
  const failed = results.filter(r => !r).length
  console.log(`\n${results.length - failed} of ${results.length} checks passed`)
  process.exit(failed ? 1 : 0)
}
