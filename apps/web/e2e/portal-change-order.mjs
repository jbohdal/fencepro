// Customers see and sign change orders in the customer portal (Jonathan, Oct 20, 2026).
//
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 E2E_ACCESS_TOKEN=<dev owner token> node e2e/portal-change-order.mjs
//   SHOTS=<folder>   saves dev-portal-change-order.png and dev-portal-change-order-signed.png
//
// The office (API, as the owner) makes a test customer with a Sold quote, its job,
// a sent change order (+$450.00) and a draft one, and invites the customer to the
// portal (the dev copy sends no email: the invite answers with the link). Then, on
// a 390 x 844 phone (WebKit, touch), the customer
//   - sets a password on the invite link and lands in the portal,
//   - sees "Change Orders to Sign" and the change order's lines and total (not the
//     draft), the screen not wider than the phone,
//   - types a name, signs with a finger and taps Approve and sign.
// Checked after: the change order is approved with the name, signature, IP and
// browser; the job's contract value is the quote price + $450.00; the office's job
// page (desktop Chromium) says "Signed by the customer on ...".
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
if (!TOKEN) { console.error('Set E2E_ACCESS_TOKEN (an owner login on the dev server).'); process.exit(2) }
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const call = async (method, p, body) => {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(`${API}${p}`, { method, headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
      const out = { status: r.status, json: await r.json().catch(() => ({})) }
      if (method !== 'GET' || r.status < 500 || i >= 30) return out
    } catch (e) { if (i >= 30) throw e }
    await sleep(2000)
  }
}
// The dev database by name (never live).
const sql = q => execFileSync('psql', ['-d', 'ezbiz_dev', '-At', '-v', 'ON_ERROR_STOP=1', '-c', q]).toString().trim()
async function until(fn, ms = 20000, every = 500) { const end = Date.now() + ms; for (;;) { const v = await fn().catch(() => null); if (v || Date.now() > end) return v; await sleep(every) } }
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name), fullPage: true }).catch(() => {}) }

const stamp = Date.now().toString(36).slice(-5)
const NAME = `E2E Portal CO ${stamp}`
const EMAIL = `e2e-portal-co-${stamp}@example.invalid`
const contactId = crypto.randomUUID(), quoteId = crypto.randomUUID(), jobId = crypto.randomUUID()
const PRICE = 5000

let phone, desk
try {
  // ── The office: customer, Sold quote, job, change orders, portal invite ──
  const c = await call('POST', '/api/crm-contacts', { id: contactId, firstName: 'E2E Portal', lastName: `CO ${stamp}`, phone: '3525550144', email: EMAIL, leadSource: 'Other' })
  check('test customer made', c.status < 300, String(c.status))
  const q = await call('POST', '/api/saved-quotes', {
    id: quoteId, crmContactId: contactId, customerName: NAME, customerPhone: '3525550144', customerEmail: EMAIL, customerAddress: '1 Portal Test Way, Ocala, FL 34470',
    leadSource: 'Other', salesRep: 'E2E', date: '2026-10-20', fenceStyle: "WV-ND 6'x6' Privacy", runs: [96], sections: 16, corners: 0, ends: 2,
    materialCost: 1500, laborCost: 900, tearOutCost: 0, totalCOGS: 2400, finalPrice: PRICE, gmPct: 0.52, pullSheet: [], status: 'SOLD',
  })
  check('Sold quote made', q.status < 300, String(q.status))
  const j = await call('POST', '/api/saved-jobs', { id: jobId, quoteId, crmContactId: contactId, customerName: NAME, fenceStyle: "WV-ND 6'x6' Privacy", sections: 16, quotePrice: PRICE, contractValue: PRICE, status: 'staging' })
  check('job made', j.status < 300, String(j.status))
  const mk = async (reason, lines) => (await call('POST', '/api/change-orders', { quoteId, reason, lines })).json.data
  const co = await mk('Add a walk gate on the side yard', [{ id: 'g1', description: "4 ft walk gate, white vinyl", amountCents: 52500 }, { id: 'g2', description: 'One section less where the gate goes', amountCents: -7500 }])
  const draft = await mk('Not sent yet', [{ id: 'd1', description: 'Draft line', amountCents: 10000 }])
  const sent = await call('PATCH', `/api/change-orders/${co.id}`, { baseVersion: co.version, status: 'sent' })
  check('change order sent (the draft stays a draft)', sent.status === 200 && !!draft?.id, String(sent.status))
  const inv = await call('POST', '/api/portal/invite', { crmCustomerId: contactId, email: EMAIL, firstName: 'E2E Portal', lastName: `CO ${stamp}` })
  const url = inv.json.data?.activationUrl || ''
  const rawToken = (url.match(/token=([0-9a-f]{64})/) || [])[1]
  check('portal invite made (its link comes back; no email in dev)', !!rawToken, String(inv.status))
  if (!rawToken) throw new Error('no invite link')

  // ── The customer's phone ──
  const wk = await webkit.launch()
  phone = wk
  const ctx = await wk.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 300)))
  await page.goto(`${APP}/#/portal/activate?token=${rawToken}`)
  await page.waitForSelector('input[type="password"]', { timeout: 60000 })
  const pw = page.locator('input[type="password"]')
  await pw.nth(0).fill('e2e-portal-pass-1'); await pw.nth(1).fill('e2e-portal-pass-1')
  await page.locator('form button[type="submit"]').tap()
  await page.waitForFunction(() => location.hash.startsWith('#/portal/dashboard'), null, { timeout: 30000 })
  const card = await until(async () => (await page.locator('[data-portal-co-waiting]').count()) > 0, 20000)
  check('phone: the dashboard says a change order is waiting to sign', !!card)
  await page.goto(`${APP}/#/portal/change-orders`)
  await page.waitForSelector(`[data-portal-co="${co.id}"]`, { timeout: 30000 }); await sleep(600)
  const cards = await page.locator('[data-portal-co]').evaluateAll(els => els.map(e => e.getAttribute('data-portal-co')))
  check('phone: the sent change order is shown, the draft is not', cards.includes(co.id) && !cards.includes(draft.id), cards.join(','))
  const box = page.locator(`[data-portal-co="${co.id}"]`)
  const text = await box.innerText()
  check('phone: its lines and total are shown', /4 ft walk gate, white vinyl/.test(text) && /\$525\.00/.test(text) && /−\$75\.00/.test(text) && (await box.locator('[data-portal-co-total]').innerText()).trim() === '$450.00', text.replace(/\s+/g, ' ').slice(0, 200))
  check('phone: no cost on the screen', !/cost|margin|profit/i.test(text))
  const wide = await page.evaluate(() => document.documentElement.scrollWidth)
  check('phone: the screen is not wider than the phone', wide <= 390, `${wide}px`)
  await shot(page, 'dev-portal-change-order.png')

  // Sign: name (typed again), a finger signature, Approve and sign.
  await box.locator('[data-portal-co-name]').fill(`  ${NAME}  `)
  const pad = box.locator('canvas')
  await pad.scrollIntoViewIfNeeded()
  const b = await pad.boundingBox()
  await page.mouse.move(b.x + 30, b.y + b.height * 0.6)
  await page.mouse.down()
  for (let i = 1; i <= 12; i++) await page.mouse.move(b.x + 30 + i * (b.width - 60) / 12, b.y + b.height * (0.6 + (i % 2 ? -0.25 : 0.15)))
  await page.mouse.up()
  await box.locator('[data-portal-co-approve]').tap()
  const signedUi = await until(async () => (await page.locator(`[data-portal-co="${co.id}"][data-portal-co-status="approved"] [data-portal-co-signed]`).count()) > 0, 20000)
  check('phone: after Approve and sign it shows approved and signed', !!signedUi, signedUi ? (await page.locator(`[data-portal-co="${co.id}"] [data-portal-co-signed]`).innerText()).trim() : 'not shown')
  await shot(page, 'dev-portal-change-order-signed.png')
  check('phone: no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))

  // ── The server ──
  const row = sql(`SELECT status || '|' || coalesce("signedBy",'') || '|' || ("signature" LIKE 'data:image/png;base64,%') || '|' || coalesce("signedVia",'') || '|' || ("signedAt" IS NOT NULL) || '|' || (coalesce("signedIp",'') <> '') || '|' || coalesce("signedUserAgent",'') FROM "ChangeOrder" WHERE id = '${co.id}'`).split('|')
  check('server: approved, with the typed name, the signature, when, the IP and the browser', row[0] === 'approved' && row[1] === NAME && row[2] === 'true' && row[3] === 'portal' && row[4] === 'true' && row[5] === 'true' && /AppleWebKit/.test(row[6] || ''), row.slice(0, 6).join(' | '))
  const job = ((await call('GET', '/api/saved-jobs')).json.data ?? []).find(x => x.id === jobId)
  check("server: the job's contract value is the quote price + the change order", job?.contractValue === PRICE + 450 && job?.changeOrderTotal === 450, `${job?.contractValue} / ${job?.changeOrderTotal}`)

  // ── The office ──
  const ch = await chromium.launch()
  desk = ch
  const octx = await ch.newContext({ viewport: { width: 1440, height: 900 } })
  await octx.addInitScript(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, TOKEN)
  const op = await octx.newPage()
  const oerr = []
  op.on('pageerror', e => oerr.push(String(e).slice(0, 300)))
  await op.route('**/api/automations/trigger', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' }))
  await op.goto(`${APP}/operations?job=${jobId}`)
  await op.waitForSelector('[data-co-panel]', { timeout: 60000 })
  const officeSigned = await until(async () => (await op.locator('[data-co-row="1"][data-co-status="approved"] [data-co-customer-signed]').count()) > 0, 20000)
  const words = officeSigned ? (await op.locator('[data-co-row="1"] [data-co-customer-signed]').innerText()).trim() : ''
  check('office: the job page says "Signed by the customer on ..."', /^Signed by the customer on .+2026/.test(words) && words.includes(NAME), words)
  const contract = officeSigned ? (await op.locator('[data-co-contract]').innerText()).trim() : ''
  check('office: the contract value includes it', contract === '$5,450.00' || contract === '$5,450', contract)
  check('office: no page errors', oerr.length === 0, oerr.slice(0, 3).join(' | '))
} catch (e) {
  check('ran to the end', false, String(e).split('\n').slice(0, 3).join(' '))
} finally {
  await phone?.close().catch(() => {})
  await desk?.close().catch(() => {})
  try {
    sql(`BEGIN;
      DELETE FROM "CrmAuditLog" WHERE "entityType" = 'ChangeOrder' AND "entityId" IN (SELECT id FROM "ChangeOrder" WHERE "quoteId" = '${quoteId}');
      DELETE FROM "ChangeOrder" WHERE "quoteId" = '${quoteId}';
      DELETE FROM "JobQuotedCost" WHERE "quoteId" = '${quoteId}';
      DELETE FROM "AutomationEvent" WHERE "entityId" IN ('${jobId}', '${quoteId}', '${contactId}');
      DELETE FROM "JobChecklistItem" WHERE "jobId" = '${jobId}';
      DELETE FROM "SavedJob" WHERE id = '${jobId}' OR "quoteId" = '${quoteId}';
      DELETE FROM "SavedQuote" WHERE id = '${quoteId}';
      DELETE FROM "PortalAccount" WHERE "crmCustomerId" = '${contactId}';
      DELETE FROM "CrmAuditLog" WHERE "entityId" IN ('${jobId}', '${quoteId}', '${contactId}');
      UPDATE "BusinessState" SET "pullSheets" = COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements("pullSheets") e WHERE COALESCE(e->>'quoteId', '') <> '${quoteId}'), '[]'::jsonb), version = version + 1 WHERE "pullSheets"::text LIKE '%${quoteId}%';
      DELETE FROM "CrmContact" WHERE id = '${contactId}';
      COMMIT;`)
    const left = Number(sql(`SELECT (SELECT count(*) FROM "SavedQuote" WHERE id = '${quoteId}') + (SELECT count(*) FROM "ChangeOrder" WHERE "quoteId" = '${quoteId}') + (SELECT count(*) FROM "SavedJob" WHERE id = '${jobId}') + (SELECT count(*) FROM "PortalAccount" WHERE "crmCustomerId" = '${contactId}') + (SELECT count(*) FROM "CrmContact" WHERE id = '${contactId}')`))
    check('cleaned up (customer, quote, job, change orders, portal login)', left === 0, `${left} left`)
  } catch (e) { check('cleaned up', false, String(e).split('\n')[0]) }
  const failed = results.filter(r => !r).length
  console.log(`\n${results.length - failed} of ${results.length} checks passed`)
  process.exit(failed ? 1 : 0)
}
