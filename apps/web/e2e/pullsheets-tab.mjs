// The Pullsheets tab on the customer page (Oct 22, 2026): it was empty for
// customers with quotes and jobs (Manuel Cotrich), because it read only an old
// side list. Now it lists every quote's and job's pull sheet from the server.
//
//   cd apps/web && pnpm -s build
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 E2E_ACCESS_TOKEN=<dev owner token> node e2e/pullsheets-tab.mjs
//   SHOTS=<folder>   saves dev-pullsheets-owner.png, dev-pullsheets-phone.png, dev-pullsheets-salesman.png
//
// The owner (API) makes a customer with a pipeline card, a Draft quote with a
// pull sheet, a Sold quote with its job, an approved change order that adds
// fence, the job's Final takeoff (sent), and one entry in the old side list
// whose quote is gone ("linked by hand"). A Salesman login is invited and
// signs in. Checked, on desktop Chromium and a 390 x 844 WebKit phone:
//   - the tab lists the three, newest first, with style (plain name),
//     footage, status (Draft, Sold / Signed, Linked by hand) and date;
//   - a tap opens one: the job's pull sheet as signed, with unit costs and
//     totals for the owner, the change order note, the Final takeoff beside it;
//   - Print / PDF downloads the server's PDF (it says Pull Sheet; the owner's
//     has the unit costs);
//   - Share to crew gives the install packet link /p/i/<link>, which opens;
//   - the Salesman sees quantities only: on the screen, in every answer his
//     browser got, from the API called directly, and in his PDF;
//   - Contact details show the phone as (352) 555 0188, a tel: link; tapping
//     it starts the "How'd it go?" call (cleared after with DELETE /api/follow-ups/pending).
// Dev copy only (port 4001). Removes everything it made.
import './devOnly.mjs'
import './sharedLock.mjs'
import { chromium, webkit } from 'playwright'
import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import zlib from 'zlib'
import { execFileSync } from 'child_process'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || 'http://localhost:4001'
const OWNER = process.env.E2E_ACCESS_TOKEN || ''
const SHOTS = process.env.SHOTS || ''
if (!OWNER) { console.error('Set E2E_ACCESS_TOKEN (an owner login on the dev server).'); process.exit(2) }
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const call = async (token, method, p, body) => {
  const r = await fetch(`${API}${p}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) })
  const buf = Buffer.from(await r.arrayBuffer())
  let json = {}; try { json = JSON.parse(buf.toString()) } catch {}
  return { status: r.status, json, text: buf.toString(), buf, type: r.headers.get('content-type') || '' }
}
const owner = (m, p, b) => call(OWNER, m, p, b)
const sql = q => execFileSync('psql', ['-d', 'ezbiz_dev', '-At', '-v', 'ON_ERROR_STOP=1', '-c', q]).toString().trim()
async function until(fn, ms = 20000, every = 300) { const end = Date.now() + ms; for (;;) { const v = await fn().catch(() => null); if (v || Date.now() > end) return v; await sleep(every) } }

/** The words in a pdfkit PDF (tests/pdfText.ts, the same way). */
function pdfText(pdf) {
  const raw = pdf.toString('latin1'), parts = []
  for (const s of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let body = s[1]
    try { body = zlib.inflateSync(Buffer.from(s[1], 'latin1')).toString('latin1') } catch {}
    if (!/\bBT\b/.test(body)) continue
    for (const r of body.matchAll(/\[([^\]]*)\]\s*TJ|(<[0-9a-fA-F\s]*>|\([^)]*\))\s*Tj/g)) {
      let out = ''
      for (const m of (r[1] ?? r[2]).matchAll(/<([0-9a-fA-F\s]*)>|\(([^)]*)\)/g)) {
        if (m[1] !== undefined) { const h = m[1].replace(/\s+/g, ''); for (let i = 0; i + 1 < h.length; i += 2) out += String.fromCharCode(parseInt(h.slice(i, i + 2), 16)) } else out += m[2]
      }
      parts.push(out)
    }
  }
  return parts.join(' ').replace(/\s+/g, ' ')
}

const stamp = Date.now().toString(36).slice(-5)
const W = {
  contactId: crypto.randomUUID(), cardId: crypto.randomUUID(), draft: crypto.randomUUID(), sold: crypto.randomUUID(), jobId: crypto.randomUUID(),
  takeoff: crypto.randomUUID(), handId: `e2e-hand-${stamp}`, handQuote: crypto.randomUUID(),
  last: `PS ${stamp}`, phone: '3525550188', email: `e2e-ps-${stamp}@example.invalid`, users: [],
}
const PART = `E2E PS Post ${stamp}`, HAND = `E2E PS Hand Part ${stamp}`
// Unit costs only this test uses, so a leak is found by value too.
const COSTS = ['13.57', '24.68', '3.21', '1357', '2468', '321']
const sheet = (extra = []) => [{ item: PART, qty: 13, unitCost: 13.57, total: 176.41 }, { item: `E2E PS Panel ${stamp}`, qty: 12, unitCost: 24.68, total: 296.16 }, ...extra]

let browsers = []
try {
  // ── The office (API, owner) ──
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  const c = await owner('POST', '/api/crm-contacts', { id: W.contactId, firstName: 'E2E', lastName: W.last, phone: W.phone, email: W.email, leadSource: 'Other', serviceAddress: '18 Pull Sheet Ln, Ocala, FL 34470',
    lead: { id: W.cardId, customerId: W.contactId, firstName: 'E2E', lastName: W.last, phone: W.phone, email: W.email, address: '18 Pull Sheet Ln, Ocala, FL 34470', stage: 'First Contact', leadSource: 'Other', createdAt: today, lastMoved: today }, leadBefore: null })
  const q = { crmContactId: W.contactId, customerName: `E2E ${W.last}`, customerPhone: W.phone, customerEmail: W.email, customerAddress: '18 Pull Sheet Ln', leadSource: 'Other', salesRep: 'E2E', fenceStyle: "WV-ND 6'x6' Privacy", corners: 1, ends: 2, materialCost: 472.57, laborCost: 900, tearOutCost: 0, totalCOGS: 1372.57, gmPct: 0.5 }
  const q1 = await owner('POST', '/api/saved-quotes', { ...q, id: W.draft, date: '2026-10-21', runs: [60, 36], sections: 13, finalPrice: 3100, status: 'DRAFT', pullSheet: sheet() })
  const q2 = await owner('POST', '/api/saved-quotes', { ...q, id: W.sold, date: '2026-10-22', runs: [96], sections: 12, finalPrice: 4100, status: 'SOLD', pullSheet: sheet() })
  const j = await owner('POST', '/api/saved-jobs', { id: W.jobId, quoteId: W.sold, crmContactId: W.contactId, customerName: `E2E ${W.last}`, customerAddress: '18 Pull Sheet Ln', fenceStyle: "WV-ND 6'x6' Privacy", sections: 12, quotePrice: 4100, contractValue: 4100, status: 'scheduled', scheduledDate: '2026-11-05' })
  const co = await owner('POST', '/api/change-orders', { quoteId: W.sold, reason: `Add 16 ft ${stamp}`, lines: [{ id: 'l1', description: '16 ft more fence', amountCents: 64000 }], scope: { footageFt: 16, sections: 2, walkGates: 1 }, status: 'approved', verbalReason: 'Customer agreed on site' })
  const t = await owner('POST', '/api/job-costing/takeoff', { id: W.takeoff, jobId: W.jobId })
  const sub = await owner('POST', `/api/job-costing/takeoff/${W.takeoff}/submit?jobId=${W.jobId}`, {})
  const accountId = sql(`SELECT "accountId" FROM "CrmContact" WHERE id = '${W.contactId}'`)
  const hand = { id: W.handId, customerId: W.contactId, customerName: `E2E ${W.last}`, quoteId: W.handQuote, quoteName: `WV-ND 6'x6' Privacy — E2E ${W.last}`, versionSnapshot: [{ item: HAND, qty: 5, unitCost: 3.21, total: 16.05 }], versionNumber: 1, linkedAt: '2026-10-01T12:00:00.000Z', linkedBy: 'auto' }
  sql(`UPDATE "BusinessState" SET "pullSheets" = COALESCE("pullSheets", '[]'::jsonb) || '${JSON.stringify([hand]).replace(/'/g, "''")}'::jsonb, version = version + 1 WHERE "accountId" = '${accountId}'`)
  check('office: customer with a card, a Draft quote, a Sold quote and its job, an approved change order, a sent takeoff, a hand linked entry',
    [c, q1, q2, j].every(r => r.status < 300) && co.status === 201 && t.status < 300 && sub.status < 300, [c, q1, q2, j, co, t, sub].map(r => r.status).join(','))

  // A Salesman (the real invite).
  const email = `e2e-ps-sales-${stamp}@example.invalid`
  const inv = await owner('POST', '/api/crm-auth/invite', { firstName: 'E2E', lastName: `Sales ${stamp}`, email, role: 'sales_rep' })
  W.users.push(email)
  const acc = await call('', 'POST', '/api/crm-auth/accept-invite', { token: new URL(inv.json.data.inviteUrl).searchParams.get('token'), email, password: `Ps-${crypto.randomBytes(9).toString('base64url')}` })
  const SALES = acc.json.data?.accessToken
  check('a Salesman login is invited and signed in', !!SALES, String(acc.status))

  // ── The API: owner with costs, Salesman quantities only ──
  const o = await owner('GET', `/api/pull-sheets/customer/${W.contactId}`)
  const entries = o.json.data?.entries ?? []
  check('owner (API): three entries, newest first: the job, the Draft, the hand linked one', entries.map(e => e.id).join() === [`j_${W.jobId}`, `q_${W.draft}`, `h_${W.handId}`].join(), entries.map(e => `${e.id}:${e.status}:${e.date}`).join(' | '))
  const job = entries.find(e => e.kind === 'job')
  check('owner (API): costs on; the job\'s lines have unit costs and totals in cents', o.json.data?.quantitiesOnly === false && job?.lines?.[0]?.unitCostCents === 1357 && job?.totalCostCents === 47257, JSON.stringify(job?.lines?.[0]))
  check('owner (API): the plain style name, footage and statuses', !/WV-ND/.test(job?.style) && job?.footageFt === 96 && entries.map(e => e.status).join() === 'Sold,Draft,Linked by hand', `${job?.style} ${job?.footageFt} ${entries.map(e => e.status)}`)
  check('owner (API): the change order note and the Final takeoff (sent)', /Change order CO-1/.test(job?.changeNote || '') && /\+16 ft/.test(job?.changeNote || '') && job?.finalTakeoff?.status === 'submitted' && job.finalTakeoff.lines.length === 2, job?.changeNote)
  const s = await call(SALES, 'GET', `/api/pull-sheets/customer/${W.contactId}`)
  const costField = /"(unitCost|unitCostCents|totalCostCents|totalCostCents|materialCostCents|totalCost|cost)"\s*:/
  // Since Oct 25 the salesman sees costs like the owner (Jonathan); only the installer sees no prices.
  check('Salesman (API): the same entries, with costs (salesmen may see costs)', s.status === 200 && s.json.data.entries.length === 3 && costField.test(s.text) && s.json.data.entries[0].lines[0].qty === 13,
    `${s.status} ${s.text.match(costField)?.[1] ?? ''} ${COSTS.filter(v => s.text.includes(v))}`)
  const sp = await call(SALES, 'GET', `/api/pull-sheets/customer/${W.contactId}/j_${W.jobId}.pdf`)
  const spText = pdfText(sp.buf)
  check('Salesman (API): his PDF has the parts (with costs, like the owner)', sp.status === 200 && sp.type.includes('application/pdf') && /Pull Sheet/.test(spText) && spText.includes(PART), `${sp.status} ${sp.type} ${sp.buf.length} bytes: ${(spText || sp.buf.subarray(0, 120).toString("latin1")).slice(0, 160)}`)
  const op = await owner('GET', `/api/pull-sheets/customer/${W.contactId}/j_${W.jobId}.pdf`)
  const opText = pdfText(op.buf)
  check('owner (API): the PDF has the unit costs and the total', op.status === 200 && /Unit cost/.test(opText) && opText.includes('$13.57') && opText.includes('$472.57') && /Final takeoff/.test(opText), `${op.status} ${op.type} ${op.buf.length} bytes: ${(opText || op.buf.subarray(0, 120).toString("latin1")).slice(0, 160)}`)
  check('another company\'s or a made up customer: not found', (await owner('GET', `/api/pull-sheets/customer/${crypto.randomUUID()}`)).status === 404)

  // ── The screen ──
  async function openTab(type, token, phone) {
    const br = await type.launch()
    browsers.push(br)
    const ctx = await br.newContext({ acceptDownloads: true, ...(phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } : { viewport: { width: 1366, height: 900 } }) })
    await ctx.addInitScript(tk => { localStorage.setItem('crm_access_token', tk); if (!localStorage.getItem('crm_refresh_token')) localStorage.setItem('crm_refresh_token', 'e2e') }, token)
    // A tel: link would hand off to the phone app: record it and stay (the app's own handler still runs).
    await ctx.addInitScript(() => { window.__tel = []; window.addEventListener('click', e => { const a = e.target instanceof Element ? e.target.closest('a[href^="tel:"]') : null; if (a) { window.__tel.push(a.getAttribute('href')); e.preventDefault() } }, true) })
    const page = await ctx.newPage()
    const errors = [], bodies = []
    page.on('pageerror', e => errors.push(String(e).slice(0, 300)))
    page.on('dialog', d => d.accept().catch(() => {}))
    page.on('response', async r => { if (r.url().startsWith(API + '/api/') && (r.headers()['content-type'] || '').includes('json')) bodies.push({ url: r.url(), text: await r.text().catch(() => '') }) })
    await page.goto(`${APP}/customers/${W.contactId}`)
    await page.waitForSelector('[data-customer-tab="pullsheets"]', { timeout: 60000 })
    await page.locator('[data-customer-tab="pullsheets"]').click()
    await page.waitForSelector('[data-pull-sheet]', { timeout: 30000 })
    return { br, ctx, page, errors, bodies, phone }
  }
  const tap = (x, loc) => (x.phone ? loc.tap() : loc.click())

  for (const [type, phone] of [[chromium, false], [webkit, true]]) {
    const size = phone ? 'phone' : 'desktop'
    const x = await openTab(type, OWNER, phone)
    const rows = await x.page.locator('[data-pull-sheet]').evaluateAll(els => els.map(e => [e.getAttribute('data-pull-sheet'), e.querySelector('[data-pull-sheet-status]')?.textContent, e.textContent]))
    check(`${size} owner: the tab lists the job, the Draft and the hand linked one with status and footage`, rows.map(r => r[0]).join() === [`j_${W.jobId}`, `q_${W.draft}`, `h_${W.handId}`].join() && rows.map(r => r[1]).join() === 'Sold,Draft,Linked by hand' && /96 ft/.test(rows[0][2]) && /96 ft/.test(rows[1][2]), rows.map(r => r[2]).join(' | '))
    await tap(x, x.page.locator(`[data-pull-sheet="j_${W.jobId}"]`))
    const view = x.page.locator(`[data-pull-sheet-view="j_${W.jobId}"]`)
    await view.waitFor({ timeout: 10000 })
    const vt = await view.innerText()
    check(`${size} owner: opened, the pull sheet as signed with Unit cost and Total, the change note, the Final takeoff`, /Unit cost/.test(vt) && vt.includes('$13.57') && (await view.locator('[data-pull-sheet-total]').innerText()).trim() === '$472.57' && (await view.locator('[data-pull-sheet-change]').count()) === 1 && (await view.locator('[data-pull-sheet-takeoff]').count()) === 1, vt.replace(/\s+/g, ' ').slice(0, 220))
    if (SHOTS) await x.page.screenshot({ path: path.join(SHOTS, phone ? 'dev-pullsheets-phone.png' : 'dev-pullsheets-owner.png'), fullPage: !phone })
    // Print / PDF: a download of the server's PDF.
    // On a phone the open sheet runs below the customer's action bar and the tabs: brought to the middle of the
    // screen the way a finger scrolls it (a tap where it first shows lands on the fixed bar; the page has room under it).
    await view.locator('[data-pull-sheet-pdf]').evaluate(b => b.scrollIntoView({ block: 'center' })); await sleep(300)
    const pdfAnswers = []
    x.page.on('response', r => { if (/\.pdf(\?|$)/.test(r.url())) pdfAnswers.push(`${r.status()} ${r.headers()['content-type'] || ''}`) })
    x.page.on('requestfailed', r => { if (/\.pdf(\?|$)/.test(r.url())) pdfAnswers.push(`failed ${r.failure()?.errorText}`) })
    x.page.on('console', m => { if (m.type() === 'error') pdfAnswers.push(`console: ${m.text().slice(0, 120)}`) })
    const [dl] = await Promise.all([
      x.page.waitForEvent('download', { timeout: 20000 }).catch(async e => {
        const said = await x.page.locator('[data-toast]').allInnerTexts().catch(() => [])
        said.push(`button: ${await view.locator('[data-pull-sheet-pdf]').innerText().catch(() => '?')}`)
        said.push(`under its middle: ${await view.locator('[data-pull-sheet-pdf]').evaluate(b => { const r = b.getBoundingClientRect(); const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return `${Math.round(r.left)},${Math.round(r.top)} ${h === b || b.contains(h) ? 'the button' : (h?.outerHTML || 'nothing').slice(0, 160)} (vh ${innerHeight})` }).catch(e => String(e).slice(0, 80))}`)
        throw new Error(`${size}: no download after Print / PDF (the PDF answered: ${pdfAnswers.join(', ') || 'nothing'}; on screen: ${said.join(' | ') || 'no message'}; page ${x.page.url()}) ${String(e.message).split('\n')[0]}`)
      }),
      tap(x, view.locator('[data-pull-sheet-pdf]')),
    ])
    const file = path.join(os.tmpdir(), `ps-${stamp}-${size}.pdf`)
    await dl.saveAs(file)
    const pdf = fs.readFileSync(file)
    fs.rmSync(file, { force: true })
    check(`${size} owner: Print / PDF downloads the PDF`, pdf.subarray(0, 5).toString() === '%PDF-' && /Pull Sheet/.test(pdfText(pdf)) && /\.pdf$/.test(dl.suggestedFilename()), `${dl.suggestedFilename()} (${pdf.length} bytes: ${(pdfText(pdf) || pdf.subarray(0, 80).toString("latin1")).slice(0, 120)})`)
    // Share to crew: the install packet link.
    await tap(x, view.locator('[data-pull-sheet-crew]'))
    const url = await until(async () => { const t = await view.locator('[data-pull-sheet-crew-url]').innerText().catch(() => ''); return /\/p\/i\/[A-Za-z0-9_-]{20,}$/.test(t) ? t : null }, 30000)
    const packet = url ? await fetch(url.replace(/^https?:\/\/[^/]+/, APP)) : null
    const packetHtml = packet ? await packet.text() : ''
    check(`${size} owner: Share to crew gives the install packet link /p/i/<link>, and it opens (no prices)`, !!url && packet?.status === 200 && packetHtml.includes(PART) && !COSTS.some(v => packetHtml.includes(`$${v}`)), url || 'no link')
    // The phone number in Contact details (the column on the left on a computer, the Details tab on a phone).
    if (await x.page.locator('[data-customer-tab="overview"]').count()) await tap(x, x.page.locator('[data-customer-tab="overview"]'))
    const link = x.page.locator('[data-customer-phone]')
    await link.waitFor({ timeout: 10000 })
    const shown = (await link.innerText()).trim(), href = await link.getAttribute('href')
    await owner('DELETE', '/api/follow-ups/pending')
    await tap(x, link)
    const pending = await until(async () => { const r = await owner('GET', '/api/follow-ups/pending'); return r.json.data?.cardId === W.cardId ? r.json.data : null }, 10000)
    const called = await x.page.evaluate(() => window.__tel)
    check(`${size}: Contact details phone is (352) 555 0188, a tel: link; tapping it calls`, shown === '(352) 555 0188' && href === `tel:${W.phone}` && called.includes(href), `${shown} ${href} ${called} ${!!pending}`) // "How'd it go?" only for open sales cards (Oct 25); this customer is sold
    await owner('DELETE', '/api/follow-ups/pending')
    // Back at the top of the page: scrolled down, the pinned header is one line without the contact line (9ag).
    await x.page.evaluate(() => { const sc = document.querySelector('[data-page-scroll]'); if (sc) sc.scrollTop = 0 })
    await x.page.waitForSelector('[data-customer-header][data-compact="no"]', { timeout: 5000 }).catch(() => {})
    const header = await x.page.locator('[data-customer-header-phone]').innerText().catch(() => '')
    check(`${size}: the phone at the top of the customer page is formatted too`, header.trim() === '(352) 555 0188', header)
    check(`${size} owner: no page errors`, x.errors.length === 0, x.errors.slice(0, 2).join(' | '))
    await x.br.close()
  }

  // The Salesman's screen: quantities only, no Share to crew.
  const sx = await openTab(chromium, SALES, false)
  await sx.page.locator(`[data-pull-sheet="j_${W.jobId}"]`).click()
  const sv = sx.page.locator(`[data-pull-sheet-view="j_${W.jobId}"]`)
  await sv.waitFor({ timeout: 10000 })
  const st = await sv.innerText()
  const html = await sx.page.content()
  check('Salesman screen: the parts and quantities show (costs allowed for salesmen)', st.includes(PART), st.replace(/\s+/g, ' ').slice(0, 200)); void html
  const leaks = sx.bodies.filter(b => b.url.includes('/api/pull-sheets') && (costField.test(b.text) || COSTS.some(v => b.text.includes(v))))
  check('Salesman browser: the pull sheet loaded', sx.bodies.some(b => b.url.includes('/api/pull-sheets')), leaks.map(b => b.url).join(' '))
  if (SHOTS) await sx.page.screenshot({ path: path.join(SHOTS, 'dev-pullsheets-salesman.png'), fullPage: true })
  check('Salesman: no page errors', sx.errors.length === 0, sx.errors.slice(0, 2).join(' | '))
} catch (e) {
  check('ran to the end', false, String(e).split('\n').slice(0, 3).join(' '))
} finally {
  for (const b of browsers) await b.close().catch(() => {})
  await owner('DELETE', '/api/follow-ups/pending').catch(() => {})
  try {
    const users = (await owner('GET', '/api/crm-auth/users')).json.data ?? []
    for (const u of users.filter(x => W.users.includes(x.email))) await owner('DELETE', `/api/crm-auth/users/${u.id}`)
    const pl = (await owner('GET', '/api/pipeline')).json
    if (pl?.data?.leads?.some(l => l.id === W.cardId)) await owner('PATCH', '/api/pipeline', { upsert: [], remove: [W.cardId], baseVersion: pl.data.version })
    sql(`BEGIN;
      DELETE FROM "InstallPacket" WHERE "jobId" = '${W.jobId}';
      DELETE FROM "JobTakeoff" WHERE "jobId" = '${W.jobId}';
      DELETE FROM "CrmAuditLog" WHERE "entityId" IN (SELECT id FROM "ChangeOrder" WHERE "quoteId" = '${W.sold}') OR "entityId" IN ('${W.jobId}', '${W.sold}', '${W.draft}', '${W.contactId}', '${W.takeoff}');
      DELETE FROM "ChangeOrder" WHERE "quoteId" = '${W.sold}';
      DELETE FROM "PaymentApplication" WHERE "paymentId" IN (SELECT id FROM "ContractPayment" WHERE "jobId" = '${W.jobId}');
      DELETE FROM "ContractInvoice" WHERE "jobId" = '${W.jobId}';
      DELETE FROM "BillingLog" WHERE "jobId" = '${W.jobId}';
      DELETE FROM "PaymentSchedule" WHERE "jobId" = '${W.jobId}';
      DELETE FROM "JobQuotedCost" WHERE "quoteId" IN ('${W.sold}', '${W.draft}');
      DELETE FROM "AutomationEvent" WHERE "entityId" IN ('${W.jobId}', '${W.sold}', '${W.draft}', '${W.contactId}', '${W.cardId}');
      DELETE FROM "JobChecklistItem" WHERE "jobId" = '${W.jobId}';
      DELETE FROM "SavedJob" WHERE id = '${W.jobId}';
      DELETE FROM "SavedQuote" WHERE id IN ('${W.sold}', '${W.draft}');
      DELETE FROM "CardFollowUp" WHERE "cardId" = '${W.cardId}';
      DELETE FROM "CallLog" WHERE "cardId" = '${W.cardId}';
      UPDATE "BusinessState" SET "pullSheets" = COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements("pullSheets") e WHERE COALESCE(e->>'customerId', '') <> '${W.contactId}'), '[]'::jsonb), version = version + 1 WHERE "pullSheets"::text LIKE '%${W.contactId}%';
      DELETE FROM "CrmContact" WHERE id = '${W.contactId}';
      COMMIT;`)
    const left = Number(sql(`SELECT (SELECT count(*) FROM "SavedQuote" WHERE "crmContactId" = '${W.contactId}') + (SELECT count(*) FROM "SavedJob" WHERE id = '${W.jobId}') + (SELECT count(*) FROM "JobTakeoff" WHERE "jobId" = '${W.jobId}') + (SELECT count(*) FROM "InstallPacket" WHERE "jobId" = '${W.jobId}') + (SELECT count(*) FROM "ChangeOrder" WHERE "quoteId" = '${W.sold}') + (SELECT count(*) FROM "CrmContact" WHERE id = '${W.contactId}') + (SELECT count(*) FROM "CrmUser" WHERE email LIKE 'e2e-ps-sales-${stamp}%') + (SELECT count(*) FROM "BusinessState" WHERE "pullSheets"::text LIKE '%${W.contactId}%')`))
    const card = (await owner('GET', '/api/pipeline')).json.data?.leads?.some(l => l.id === W.cardId)
    check('cleaned up (customer, card, quotes, job, change order, takeoff, packet, hand linked entry, Salesman login)', left === 0 && !card, `${left} rows left, card ${card ? 'left' : 'gone'}`)
  } catch (e) { check('cleaned up', false, String(e).split('\n')[0]) }
  const failed = results.filter(r => !r).length
  console.log(`\n${results.length - failed} of ${results.length} checks passed`)
  process.exit(failed ? 1 : 0)
}
