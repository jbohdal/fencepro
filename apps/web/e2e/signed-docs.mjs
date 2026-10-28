// Signed documents, end to end on the dev copy (4001 serves the built app:
// run `pnpm -s build` in apps/web first).
//
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 E2E_ACCESS_TOKEN=<dev owner token> \
//     [E2E_SHOTS=<folder>] node e2e/signed-docs.mjs
//
//   1. A customer signs a proposal on a phone (WebKit 390 x 844), through a
//      proxy as Tailscale Funnel sends it (X-Forwarded-For): the signed
//      contract PDF is stored once, with the name, that IP and the time on its
//      last page; signing again does not make a second.
//   2. The office on a desktop and on a phone-size WebKit: Documents on the
//      customer page (Files), on the quote (the quote window and the quote
//      drawer) and on the job page show it with the signed date and signer;
//      "Signed contract (PDF)" opens the stored copy (the same bytes).
//   3. The customer's portal: Contract & Warranty lists the stored signed PDF
//      and it opens.
// Removes everything it made (hard deletes on ezbiz_dev only, named on every command).
import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import './sharedLock.mjs' // makes customers, quotes, jobs and portal logins on the shared dev copy
import { webkit, chromium } from 'playwright'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import zlib from 'zlib'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || 'http://localhost:4001'
const OWNER = process.env.E2E_ACCESS_TOKEN || ''
const SHOTS = process.env.E2E_SHOTS || process.env.SHOTS || ''
const UPLOAD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../portal', process.env.UPLOAD_DIR || 'uploads')
// The dev copy (4001) or a worktree's own dev server on another port; never 4000 (live).
if (!/^http:\/\/localhost:\d+$/.test(APP) || !/^http:\/\/localhost:\d+$/.test(API) || /:4000$/.test(APP) || /:4000$/.test(API)) { console.error('Refusing to run: the dev copy only (localhost, not 4000).'); process.exit(2) }
if (!OWNER) { console.error('Set E2E_ACCESS_TOKEN (an owner login on the dev server).'); process.exit(2) }
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const call = async (method, p, body) => {
  const r = await fetch(`${API}${p}`, { method, headers: { Authorization: `Bearer ${OWNER}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: r.status, json: await r.json().catch(() => ({})) }
}
async function until(fn, ms = 20000, every = 400) { const end = Date.now() + ms; for (;;) { const v = await fn().catch(() => null); if (v || Date.now() > end) return v; await sleep(every) } }
const sql = q => execFileSync('psql', ['-d', 'ezbiz_dev', '-At', '-v', 'ON_ERROR_STOP=1', '-c', q]).toString().trim()
const uuid = s => /^[0-9a-f-]{36}$/i.test(s)
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name), fullPage: true }).catch(() => {}) }

/** The words in a pdfkit PDF (as apps/portal/tests/pdfText.ts); `last`: only the last page. */
function pdfText(buf, last = false) {
  const raw = buf.toString('latin1'), pages = []
  for (const s of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let body = s[1]
    try { body = zlib.inflateSync(Buffer.from(s[1], 'latin1')).toString('latin1') } catch { /* not compressed */ }
    if (!/\bBT\b/.test(body)) continue
    const parts = []
    for (const r of body.matchAll(/\[([^\]]*)\]\s*TJ|(<[0-9a-fA-F\s]*>|\([^)]*\))\s*Tj/g)) {
      let out = ''
      for (const m of (r[1] ?? r[2]).matchAll(/<([0-9a-fA-F\s]*)>|\(([^)]*)\)/g)) {
        if (m[1] !== undefined) { const h = m[1].replace(/\s+/g, ''); for (let i = 0; i + 1 < h.length; i += 2) out += String.fromCharCode(parseInt(h.slice(i, i + 2), 16)) } else out += m[2]
      }
      parts.push(out)
    }
    pages.push(parts.join(' '))
  }
  return (last ? pages.slice(-1) : pages).join(' ').replace(/\x92/g, "'").replace(/\s+/g, ' ').trim()
}
const sha = b => crypto.createHash('sha256').update(b).digest('hex')

const stamp = Date.now().toString(36).slice(-6)
const NAME = `E2E Signed Docs ${stamp}`
const SIGNER = `Pat Signer ${stamp}`
const EMAIL = `e2e-signed-${stamp}@example.invalid`
const FUNNEL_IP = '203.0.113.61'
const contactId = crypto.randomUUID(), quoteId = crypto.randomUUID()
let jobId = null
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
const snap = price => ({ materialCost: price * 0.4, laborCost: price * 0.2, tearOutCost: 0, totalCOGS: price * 0.6, gmPct: 0.4, pullSheet: [], runSections: [19] })
const opt = (tier, fenceStyle, price) => ({ label: `${tier} option`, fenceStyle, finalPrice: price, perFoot: Math.round(price / 1.5) / 100, sections: 19, tier: { key: tier.toLowerCase(), label: tier, blurb: '' }, snapshot: snap(price) })

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

/**
 * Click a "Signed contract (PDF)" button: the app fetches the stored PDF with
 * the staff sign in and shows it in a new tab (a blob address). What that tab
 * shows is read back from the tab itself.
 */
async function openPdf(page, button) {
  // The page finishes loading first (the job page fills in as its data arrives).
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
  await button.scrollIntoViewIfNeeded().catch(() => {}); await sleep(600)
  const [resp, tab] = await Promise.all([
    page.waitForResponse(r => /\/api\/signed-documents\/[^/]+\/pdf$/.test(r.url()), { timeout: 20000 }),
    page.context().waitForEvent('page', { timeout: 20000 }),
    button.click(),
  ])
  let buf = Buffer.alloc(0), err = ''
  // A browser that shows PDFs shows the blob in the tab; headless Chromium saves it as a download instead.
  const shown = tab.waitForURL(u => String(u).startsWith('blob:'), { timeout: 15000 })
    .then(() => tab.evaluate(async () => { const a = new Uint8Array(await (await fetch(location.href)).arrayBuffer()); let s = ''; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000)); return btoa(s) }))
    .then(b64 => Buffer.from(b64, 'base64'))
  const saved = tab.waitForEvent('download', { timeout: 15000 }).then(async d => fs.readFileSync(await d.path()))
  try { buf = await Promise.any([shown, saved]) } catch (e) { err = String(e?.errors?.map(x => x.message).join(' / ') || e).slice(0, 200) }
  await tab.close().catch(() => {})
  return { type: resp.headers()['content-type'] || '', buf, err }
}

const desk = await chromium.launch()
const wk = await webkit.launch()
let stored = null
try {
  // ── Setup: a customer, a sent Good / Better proposal with its link, a portal invite ──
  const c = await call('POST', '/api/crm-contacts', { id: contactId, firstName: 'E2E Signed', lastName: `Docs ${stamp}`, phone: '3525550166', email: EMAIL, leadSource: 'Other' })
  const q = await call('POST', '/api/saved-quotes', {
    id: quoteId, crmContactId: contactId, customerName: NAME, customerPhone: '3525550166', customerEmail: EMAIL, customerAddress: '3 Signed Docs Way, Ocala, FL 34470',
    fenceStyle: "WV-ND 6'x8' Privacy", runs: [150], sections: 19, corners: 0, ends: 2, walkGates: 1, materialCost: 4000, laborCost: 2000, tearOutCost: 0, totalCOGS: 6000, finalPrice: 10000, gmPct: 0.4,
    pullSheet: [], status: 'SENT', date: today, salesRep: 'E2E Salesman', leadSource: 'Other',
    proposal: { version: 1, customer: { name: NAME, address: '3 Signed Docs Way, Ocala, FL 34470' }, company: { name: 'Getter Done Fence', phone: '3527894314', email: '' }, footageFt: 150, gatesText: '1 walk gate', included: ['150 ft of new fence'], recommended: 1, depositPct: 50, options: [opt('Good', "WV-DS 6'x8' Privacy", 9000), opt('Better', "WV-ND 6'x8' Privacy", 10000)] },
  })
  const token = (await call('POST', `/api/saved-quotes/${quoteId}/share-token`)).json.data?.shareToken
  const inv = await call('POST', '/api/portal/invite', { crmCustomerId: contactId, email: EMAIL, firstName: 'E2E Signed', lastName: `Docs ${stamp}` })
  const invite = ((inv.json.data?.activationUrl || '').match(/token=([0-9a-f]{64})/) || [])[1]
  check('setup: customer, sent proposal with its link, portal invite', c.status < 300 && q.status < 300 && !!token && !!invite, `${c.status} ${q.status} ${inv.status}`)

  // ── 1. The customer signs on a phone, through the public door (one proxy: X-Forwarded-For) ──
  const pc = await wk.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, extraHTTPHeaders: { 'X-Forwarded-For': FUNNEL_IP } })
  const p = await pc.newPage()
  await p.goto(`${API}/p/${token}`); await p.waitForSelector('#go', { timeout: 20000 })
  await p.locator('.opt[data-option="1"]').tap(); await sleep(200)
  check('phone: the customer accepted Better and signed', !!(await sign(p, SIGNER)))
  const rows = sql(`SELECT id, "fileKey", "signedIp", "signedBy", COALESCE("jobId", ''), COALESCE("portalFileId", ''), sha256 FROM "SignedDocument" WHERE "quoteId" = '${quoteId}'`).split('\n').filter(Boolean)
  stored = rows[0]?.split('|') ?? null
  check('server: one signed contract stored, signed by the typed name, from the IP the proxy passed on', rows.length === 1 && stored[2] === FUNNEL_IP && stored[3] === SIGNER && !!stored[4] && !!stored[5], rows.join(' / '))
  jobId = stored?.[4] || null
  const file = stored ? fs.readFileSync(path.join(UPLOAD, stored[1])) : Buffer.alloc(0)
  const last = pdfText(file, true)
  check('the stored PDF\'s last page: the signer, the IP, the time with its zone, the option and price', last.includes(`Signed by ${SIGNER}`) && last.includes(`IP address ${FUNNEL_IP}`) && /Date and time [A-Z][a-z]+ \d{1,2}, 2026 at \d{1,2}:\d{2}:\d{2} [AP]M E[DS]T/.test(last) && last.includes('Accepted Better option at $10,000.00') && !last.includes('Better: '), last.slice(-260)) // the plain fence name, never the tier word (a24eba1, review Oct 27 2026)
  // Sent again (the answer was lost): it stands, and no second document.
  const again = await fetch(`${API}/p/${token}/accept`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': FUNNEL_IP }, body: JSON.stringify({ option: 1, name: SIGNER, signature: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' }) })
  check('a repeat accept stands and makes no second document', again.status === 200 && sql(`SELECT count(*) FROM "SignedDocument" WHERE "quoteId" = '${quoteId}'`) === '1')
  await pc.close()

  // ── 2. The office: desktop and a phone-size WebKit ──
  for (const [label, browser, size] of [['desktop', desk, { viewport: { width: 1440, height: 1000 } }], ['phone', wk, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }]]) {
    const ctx = await browser.newContext(size)
    await ctx.addInitScript(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, OWNER)
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', e => errors.push(String(e).slice(0, 200)))
    page.on('dialog', x => x.accept().catch(() => {}))
    await page.route('**/api/automations/trigger', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' }))

    // The customer page: Files → Documents.
    await page.goto(`${APP}/customers/${contactId}`)
    await page.waitForSelector('[data-customer-tab="files"]', { timeout: 60000 })
    await page.locator('[data-customer-tab="files"]').click()
    const row = page.locator(`[data-signed-docs] [data-signed-doc="${stored?.[0]}"]`)
    if (!(await row.waitFor({ timeout: 30000 }).then(() => true).catch(() => false))) {
      await shot(page, `dev-signed-docs-customer-missing-${label}.png`)
      console.log(`  (${label}: not shown after 30 s; ${await page.locator('[data-signed-docs]').count()} Documents sections, url ${page.url()}; reloading once)`)
      await page.reload(); await page.waitForSelector('[data-customer-tab="files"]', { timeout: 60000 }); await page.locator('[data-customer-tab="files"]').click()
      await row.waitFor({ timeout: 30000 }).catch(() => null)
    }
    const rowText = (await row.innerText().catch(() => '')).replace(/\s+/g, ' ')
    const signedOn = new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'long', day: 'numeric', year: 'numeric' })
    check(`${label}: the customer page's Documents shows the contract, signed date and signer`, (await row.getAttribute('data-signed-doc-kind', { timeout: 2000 }).catch(() => null)) === 'contract' && rowText.includes(`Signed ${signedOn} by ${SIGNER}`) && rowText.includes('Contract'), rowText)
    check(`${label}: the signed PDF is not listed again under other documents`, (await page.locator('table tr', { hasText: 'Signed contract - ' }).count()) === 0)
    await shot(page, `dev-signed-docs-customer-${label}.png`)
    const pdf1 = await openPdf(page, row.locator('[data-signed-doc-open]'))
    check(`${label}: "Signed contract (PDF)" opens the stored copy`, pdf1.type.includes('application/pdf') && sha(pdf1.buf) === stored?.[6], `${pdf1.type} ${pdf1.buf.length} ${pdf1.err || ''}`)

    // The job page.
    await page.goto(`${APP}/operations?job=${jobId}`)
    const jrow = page.locator(`[data-signed-docs] [data-signed-doc="${stored?.[0]}"]`)
    await jrow.waitFor({ timeout: 60000 }).catch(() => null)
    const jtext = await jrow.innerText().catch(() => '')
    if (!jtext) await shot(page, `dev-signed-docs-job-missing-${label}.png`)
    check(`${label}: the job page's Documents shows it`, jtext.includes(`by ${SIGNER}`), jtext ? '' : `${page.url()} docs sections: ${await page.locator('[data-signed-docs]').count()}`)
    const pdf2 = await openPdf(page, jrow.locator('[data-signed-doc-open]'))
    check(`${label}: it opens from the job page`, sha(pdf2.buf) === stored?.[6])
    await shot(page, `dev-signed-docs-job-${label}.png`)

    // The quote: the quote window's header, and the quote drawer.
    await page.goto(`${APP}/?quote=${quoteId}`)
    const link = page.locator(`[data-quote-builder] [data-signed-doc-link="${stored?.[0]}"]`)
    await link.waitFor({ timeout: 60000 }).catch(() => null)
    check(`${label}: the quote window shows "Signed contract (PDF)" with who signed`, (await link.innerText().catch(() => '')).includes('Signed contract (PDF)') && (await link.innerText().catch(() => '')).includes(SIGNER))
    const pdf3 = await openPdf(page, link)
    check(`${label}: it opens from the quote`, sha(pdf3.buf) === stored?.[6])
    await shot(page, `dev-signed-docs-quote-${label}.png`)
    await page.goto(`${APP}/quotes?qv=${quoteId}`)
    const drow = page.locator(`[data-signed-docs] [data-signed-doc="${stored?.[0]}"]`)
    await drow.waitFor({ timeout: 60000 }).catch(() => null)
    check(`${label}: the quote drawer's Signed documents shows it`, (await drow.innerText().catch(() => '')).includes(`by ${SIGNER}`))
    check(`${label}: no page errors`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // ── 3. The customer's portal (phone): Contract & Warranty lists the stored signed PDF ──
  const portal = await wk.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })
  const pp = await portal.newPage()
  await pp.goto(`${APP}/#/portal/activate?token=${invite}`)
  await pp.waitForSelector('input[type="password"]', { timeout: 60000 })
  const pw = pp.locator('input[type="password"]')
  await pw.nth(0).fill('e2e-signed-pass-1'); await pw.nth(1).fill('e2e-signed-pass-1')
  await pp.locator('form button[type="submit"]').tap()
  await pp.waitForFunction(() => location.hash.startsWith('#/portal/dashboard'), null, { timeout: 30000 })
  await pp.goto(`${APP}/#/portal/papers`)
  const card = pp.locator(`[data-portal-signed-doc="${stored?.[0]}"]`)
  // A loaded machine can miss the list on the first open right after signing in: reload once, as a person would.
  if (!(await card.waitFor({ timeout: 15000 }).then(() => true, () => false))) { await pp.reload(); await card.waitFor({ timeout: 30000 }).catch(() => null) }
  const cardText = (await card.innerText().catch(() => '')).replace(/\s+/g, ' ')
  check('portal: Contract & Warranty lists the signed contract with its date and signer', cardText.includes('Signed contract') && cardText.includes(`by ${SIGNER}`), cardText)
  check('portal: the contract is not listed twice (the stored copy stands for it)', (await pp.locator(`[data-portal-contract="${quoteId}"]`).count()) === 0)
  const href = await card.getAttribute('href')
  const got = href ? await pp.request.get(new URL(href, APP).toString()) : null
  check('portal: it opens: the stored signed PDF', !!got && (got.headers()['content-type'] || '').includes('pdf') && sha(Buffer.from(await got.body())) === stored?.[6])
  await shot(pp, 'dev-signed-docs-portal.png')
  await portal.close()
} catch (e) {
  check('ran to the end', false, String(e?.stack || e).split('\n').slice(0, 3).join(' '))
} finally {
  await desk.close().catch(() => {})
  await wk.close().catch(() => {})
  // Remove what this made. Dev database only, named on every command.
  try {
    if (![contactId, quoteId].every(uuid) || (jobId && !/^[A-Za-z0-9-]+$/.test(jobId))) throw new Error('bad id')
    const keys = sql(`SELECT "fileKey" FROM "SignedDocument" WHERE "quoteId" = '${quoteId}'`).split('\n').filter(Boolean)
    for (const k of keys) { fs.rmSync(path.join(UPLOAD, k), { force: true }); try { fs.rmdirSync(path.dirname(path.join(UPLOAD, k))) } catch { /* not empty */ } }
    try { fs.rmdirSync(path.join(UPLOAD, 'signed')) } catch { /* not empty */ }
    const j = jobId ? `'${jobId}'` : "'-'"
    sql(`BEGIN;
      DELETE FROM "SignedDocument" WHERE "quoteId" = '${quoteId}';
      DELETE FROM "PortalFile" WHERE "crmCustomerId" = '${contactId}';
      DELETE FROM "PaymentApplication" WHERE "paymentId" IN (SELECT id FROM "ContractPayment" WHERE "jobId" = ${j});
      DELETE FROM "ContractPayment" WHERE "jobId" = ${j};
      DELETE FROM "ContractInvoice" WHERE "jobId" = ${j};
      DELETE FROM "BillingLog" WHERE "jobId" = ${j};
      DELETE FROM "PaymentSchedule" WHERE "jobId" = ${j};
      DELETE FROM "ProposalView" WHERE "quoteId" = '${quoteId}';
      DELETE FROM "JobQuotedCost" WHERE "quoteId" = '${quoteId}';
      DELETE FROM "AutomationEvent" WHERE "entityId" IN (${j}, '${quoteId}', '${contactId}', 'lead-${quoteId}');
      DELETE FROM "JobChecklistItem" WHERE "jobId" = ${j};
      DELETE FROM "SavedJob" WHERE id = ${j} OR "quoteId" = '${quoteId}';
      DELETE FROM "SavedQuote" WHERE id = '${quoteId}';
      DELETE FROM "PortalAccount" WHERE "crmCustomerId" = '${contactId}';
      DELETE FROM "CrmAuditLog" WHERE "entityId" IN (${j}, '${quoteId}', '${contactId}');
      DELETE FROM "Notification" WHERE title = 'Proposal accepted: ${NAME}';
      COMMIT;`)
    const pl = (await call('GET', '/api/pipeline')).json
    const mine = (pl?.data?.leads ?? []).filter(l => l.customerId === contactId || l.id === `lead-${quoteId}`).map(l => l.id)
    if (mine.length) await call('PATCH', '/api/pipeline', { upsert: [], remove: mine, baseVersion: pl.data.version })
    await call('DELETE', `/api/crm-contacts/${contactId}`)
    sql(`DELETE FROM "CrmContact" WHERE id = '${contactId}'`)
    const left = Number(sql(`SELECT (SELECT count(*) FROM "SavedQuote" WHERE id = '${quoteId}') + (SELECT count(*) FROM "SignedDocument" WHERE "quoteId" = '${quoteId}') + (SELECT count(*) FROM "SavedJob" WHERE "quoteId" = '${quoteId}') + (SELECT count(*) FROM "PortalFile" WHERE "crmCustomerId" = '${contactId}') + (SELECT count(*) FROM "PortalAccount" WHERE "crmCustomerId" = '${contactId}') + (SELECT count(*) FROM "CrmContact" WHERE id = '${contactId}')`))
    check('cleaned up (customer, quote, job, signed document and its file, portal login)', left === 0 && keys.every(k => !fs.existsSync(path.join(UPLOAD, k))), `${left} left`)
  } catch (e) { check('cleaned up', false, String(e?.message || e).slice(0, 200)) }
}
const passed = results.filter(Boolean).length
console.log(`\n${passed} of ${results.length} checks passed`)
process.exit(passed === results.length ? 0 : 1)
