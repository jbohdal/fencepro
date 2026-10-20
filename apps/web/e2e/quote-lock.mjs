// Signed quotes are locked; sent quotes warn when prices moved. On the dev copy
// (4001 serves the built app: run `pnpm -s build` in apps/web first).
//
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 E2E_ACCESS_TOKEN=<dev owner token> \
//     [SHOTS=<folder>] node e2e/quote-lock.mjs
//
//   1. Signed: the owner opens a Sold quote (computer, then a 390 x 844 phone
//      in WebKit), adds 10 ft, saves: "This quote is signed. Make a change
//      order instead." and "Make a change order". The change order opens filled
//      in ("Add 10 ft of fence") at the price the quote builder shows for the
//      change; approved (computer: in the window; phone: saved as a draft, then
//      approved on the job page), the job page's contract value includes it. The
//      quote's own price never moved.
//   2. Sent: with one Inventory cost raised on dev (put back after), opening a
//      Sent quote and saving asks "Prices changed since this was sent (was $X,
//      now $Y) ..."; "Keep the sent prices" keeps the price and saves the note.
// Removes everything it made (hard deletes on ezbiz_dev only).
import { webkit, chromium } from 'playwright'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || 'http://localhost:4001'
const TOKEN = process.env.E2E_ACCESS_TOKEN || ''
const SHOTS = process.env.SHOTS || process.env.E2E_SHOTS || ''
if (!/localhost:4001/.test(APP) || !/localhost:4001/.test(API)) { console.error('Refusing to run: the dev copy only (localhost:4001).'); process.exit(2) }
if (!TOKEN) { console.error('Set E2E_ACCESS_TOKEN (an owner login on the dev server).'); process.exit(2) }
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const call = async (method, p, body) => {
  // The dev server restarts when someone saves code: a read waits for it (up to a minute).
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(`${API}${p}`, { method, headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
      const out = { status: r.status, json: await r.json().catch(() => ({})) }
      if (method !== 'GET' || r.status < 500 || i >= 30) return out
    } catch (e) { if (i >= 30) throw e }
    await sleep(2000)
  }
}
const sql = q => execFileSync('psql', ['-d', 'ezbiz_dev', '-At', '-c', q]).toString().trim()
const cents = text => { const m = String(text).match(/\$\s?([\d,]+(?:\.\d{2})?)/); return m ? Math.round(parseFloat(m[1].replace(/,/g, '')) * 100) : NaN }
async function until(fn, ms = 20000, every = 1000) { const end = Date.now() + ms; for (;;) { const v = await fn().catch(() => null); if (v || Date.now() > end) return v; await sleep(every) } }
const jobOf = async () => ((await call('GET', '/api/saved-jobs')).json.data ?? []).find(x => x.id === jobId)
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name) }).catch(() => {}) }

const stamp = Date.now().toString(36).slice(-5)
const NAME = `E2E Quote Lock ${stamp}`
const contactId = crypto.randomUUID()
const signedId = crypto.randomUUID(), sentId = crypto.randomUUID(), jobId = crypto.randomUUID()
let invRestore = null

async function session(browser, phone) {
  const ctx = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } })
  await ctx.addInitScript(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, TOKEN)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 300)))
  page.on('dialog', d => d.accept().catch(() => {}))
  await page.route('**/api/automations/trigger', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' }))
  return { ctx, page, errors }
}
async function openQuote(page, id) {
  await page.goto(`${APP}/?quote=${id}`)
  await page.waitForSelector('[data-quote-builder] [data-bar-price]', { timeout: 30000 })
  await sleep(1500)
}
const barPrice = async page => cents(await page.locator('[data-bar-price]').first().innerText())

/** Change the first run's length by `addFt` on the Yard step and come back to Price. */
async function addFeet(page, addFt) {
  await page.locator('[data-quote-builder] [data-step="yard"]').click(); await sleep(400)
  const input = page.locator('[data-quote-builder] input[placeholder="Length in feet"]').first()
  const was = parseFloat(await input.inputValue())
  await input.fill(String(was + addFt)); await sleep(300)
  await page.locator('[data-quote-builder] [data-step="price"]').click(); await sleep(700)
  return was
}
async function saveFromBuilder(page, note) {
  await page.locator('[data-save-open]').click()
  await page.waitForSelector('[data-save-submit]', { timeout: 10000 })
  if (note) await page.locator('textarea[placeholder^="HOA requirements"]').fill(note)
  await page.locator('[data-save-submit]').click()
}

const browser = await chromium.launch()
const phoneBrowser = await webkit.launch()
try {
  // ── Set up: a customer, a Sold quote with its job, and a Sent quote, priced as a real quote is today ──
  // (The dev server restarts when code is saved: ask again for up to a minute.)
  let all = []
  for (let i = 0; i < 30 && !all.length; i++) { all = (await call('GET', '/api/saved-quotes').catch(() => ({ json: {} }))).json.data ?? []; if (!all.length) await sleep(2000) }
  const template = all.filter(q => !/^E2E/i.test(q.customerName) && Array.isArray(q.pullSheet) && q.pullSheet.length >= 8 && q.totalCOGS > 0 && !q.work && q.runs?.length && q.pullSheet.some(l => l.item === 'ND, Donut'))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0]
  check('a priced quote to copy (its inputs and figures)', !!template, template ? `${template.fenceStyle}, ${template.runs.length} runs` : 'none')
  if (!template) throw new Error('no template quote')
  const c = await call('POST', '/api/crm-contacts', { id: contactId, firstName: 'E2E', lastName: `Quote Lock ${stamp}`, phone: '3525550166', email: 'e2e-quote-lock@example.invalid', leadSource: 'Other' })
  // The run list (no drawn yard): the same runs, posts and gates the drawing gave, so the price is the same.
  const priced = ['fenceStyle', 'runs', 'runRails', 'corners', 'ends', 'walkGates', 'dblGates', 'tearOutSections', 'tearOutGates', 'adjLaborHrs', 'hasSalesman', 'priceAdjust', 'sections', 'materialCost', 'laborCost', 'tearOutCost', 'totalCOGS', 'finalPrice', 'gmPct', 'pullSheet', 'pricing']
  const body = { ...Object.fromEntries(priced.map(k => [k, template[k]])), layout: { yard: null, runSections: template.layout?.runSections ?? [] } }
  const who = { crmContactId: contactId, customerName: NAME, customerPhone: '3525550166', customerEmail: 'e2e-quote-lock@example.invalid', customerAddress: '1 Lock Test Way, Ocala, FL 34470', leadSource: 'Other', salesRep: 'E2E', date: '2026-10-20' }
  const s1 = await call('POST', '/api/saved-quotes', { id: signedId, ...body, ...who, status: 'SOLD' })
  const s2 = await call('POST', '/api/saved-quotes', { id: sentId, ...body, ...who, status: 'SENT' })
  const j = await call('POST', '/api/saved-jobs', { id: jobId, quoteId: signedId, crmContactId: contactId, customerName: NAME, fenceStyle: template.fenceStyle, sections: template.sections, quotePrice: template.finalPrice, contractValue: template.finalPrice, status: 'staging' })
  check('set up: customer, Sold quote (signed: quoted cost saved), its job, Sent quote', c.status < 300 && s1.status < 300 && s2.status < 300 && j.status < 300 && sql(`SELECT count(*) FROM "JobQuotedCost" WHERE "quoteId" = '${signedId}'`) === '1',
    `${c.status} ${s1.status} ${s2.status} ${j.status} ${j.json.error ?? ''}`)
  const signedCents = Math.round(template.finalPrice * 100)

  // ── 1. Signed, on a computer: the lock, then a change order filled in from the change ──
  {
    const { ctx, page, errors } = await session(browser, false)
    await openQuote(page, signedId)
    check('computer: the signed quote says its price is locked', await page.locator('[data-quote-locked-banner]').isVisible())
    const p0 = await barPrice(page)
    await addFeet(page, 10)
    const p1 = await barPrice(page)
    check('computer: 10 ft more prices higher in the builder', p1 > p0, `${p0} -> ${p1}`)
    await saveFromBuilder(page)
    const dlg = page.locator('[data-quote-lock-dialog="locked"]')
    await dlg.waitFor({ timeout: 10000 })
    check('computer: saving shows "This quote is signed. Make a change order instead."', (await page.locator('[data-quote-lock-message]').innerText()).trim() === 'This quote is signed. Make a change order instead.')
    check('computer: and "Make a change order"', await page.locator('[data-quote-lock-co]').isVisible())
    await shot(page, 'dev-quote-locked.png')
    await page.locator('[data-quote-lock-co]').click()
    await page.waitForSelector('[data-co-modal]', { timeout: 10000 })
    const firstLine = await page.locator('[data-co-line-description]').first().inputValue()
    const total = cents(await page.locator('[data-co-total]').innerText())
    check('computer: the change order is filled in with the change', /^Add 10 ft of fence/.test(firstLine), firstLine)
    check('computer: priced by the quote builder\'s own math (the change\'s price difference)', total === p1 - p0, `${total} vs ${p1 - p0}`)
    await shot(page, 'dev-change-order.png')
    await page.locator('[data-co-save-approved]').click()
    await sleep(2500)
    const cos = (await call('GET', `/api/change-orders?quoteId=${signedId}`)).json.data ?? []
    check('computer: one change order, approved, saved on the server in cents', cos.length === 1 && cos[0].status === 'approved' && cos[0].totalCents === total && cos[0].scope?.footageFt === 10, JSON.stringify(cos.map(x => [x.status, x.totalCents, x.scope])))
    const q = (await call('GET', `/api/saved-quotes/${signedId}`)).json.data
    check('computer: the signed quote\'s price and runs did not move', Math.round(q.finalPrice * 100) === signedCents && JSON.stringify(q.runs) === JSON.stringify(template.runs), `${q.finalPrice}`)
    const job = (await jobOf())
    check('computer: the job\'s contract value includes it', Math.round(job.contractValue * 100) === signedCents + total, `${job.contractValue}`)
    await page.goto(`${APP}/operations?job=${jobId}`)
    await page.waitForSelector('[data-co-panel]', { timeout: 30000 }); await sleep(1500)
    const row = page.locator('div.flex.justify-between:has(> span:text-is("Contract Value"))').first()
    const shown = cents(await row.innerText())
    check('computer: the job page shows the new contract value', Math.abs(shown - (signedCents + total)) <= 100, `${shown} vs ${signedCents + total}`)
    check('computer: the job page lists the change order, approved', await page.locator('[data-co-row="1"][data-co-status="approved"]').isVisible())
    check('computer: no page errors', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // ── 1b. Signed, on a phone: the lock; a draft change order, approved on the job page ──
  {
    const { ctx, page, errors } = await session(phoneBrowser, true)
    await openQuote(page, signedId)
    const before = (await jobOf()).contractValue
    const p0 = await barPrice(page)
    await addFeet(page, 10)
    const p1 = await barPrice(page)
    await saveFromBuilder(page)
    await page.locator('[data-quote-lock-dialog="locked"]').waitFor({ timeout: 10000 })
    check('phone: the lock message and "Make a change order"', (await page.locator('[data-quote-lock-message]').isVisible()) && (await page.locator('[data-quote-lock-co]').isVisible()))
    await shot(page, 'dev-quote-locked-phone.png')
    await page.locator('[data-quote-lock-co]').click()
    await page.waitForSelector('[data-co-modal]', { timeout: 10000 })
    const total = cents(await page.locator('[data-co-total]').innerText())
    check('phone: filled in at the change\'s price', total === p1 - p0, `${total} vs ${p1 - p0}`)
    await page.locator('[data-co-save-draft]').click()
    await sleep(2500)
    let job = (await jobOf())
    check('phone: a draft does not change the contract value', job.contractValue === before)
    await page.goto(`${APP}/operations?job=${jobId}`)
    await page.waitForSelector('[data-co-row="2"]', { timeout: 30000 }); await sleep(800)
    await page.locator('[data-co-row="2"] [data-co-approve]').click()
    await sleep(2500)
    job = (await jobOf())
    check('phone: approved on the job page, the contract value includes it', Math.round(job.contractValue * 100) === Math.round(before * 100) + total, `${job.contractValue}`)
    const contract = cents(await page.locator('[data-co-contract]').innerText())
    check('phone: the job page\'s change orders show the new contract value', contract === Math.round(job.contractValue * 100), `${contract}`)
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
    check('phone: the job page fits the screen', fits)
    check('phone: no page errors', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // ── 2. Sent: an Inventory cost raised on dev, the warning, "Keep the sent prices" ──
  {
    const idx = sql(`SELECT i - 1 FROM "InventoryState" s, jsonb_array_elements(s.items) WITH ORDINALITY AS e(item, i) WHERE e.item->>'name' = 'ND, Donut' LIMIT 1`)
    const was = sql(`SELECT s.items->${idx}->>'unitCost' FROM "InventoryState" s LIMIT 1`)
    check('an Inventory part on the quote to raise', idx !== '' && was !== '', `ND, Donut at ${was}`)
    invRestore = { idx, was }
    sql(`UPDATE "InventoryState" SET items = jsonb_set(items, '{${idx},unitCost}', to_jsonb(${Number(was) + 1.5}::numeric))`)
    for (const [label, phone] of [['computer', false], ['phone', true]]) {
      const { ctx, page, errors } = await session(phone ? phoneBrowser : browser, phone)
      await openQuote(page, sentId)
      const now = await barPrice(page)
      check(`${label}: the sent quote prices higher today`, now > signedCents, `${signedCents} -> ${now}`)
      await saveFromBuilder(page, `E2E kept sent prices (${label})`)
      await page.locator('[data-quote-lock-dialog="sent"]').waitFor({ timeout: 10000 })
      const msg = await page.locator('[data-quote-sent-message]').innerText()
      check(`${label}: "Prices changed since this was sent (was $X, now $Y)"`, msg.startsWith('Prices changed since this was sent (was ') && cents(msg.match(/\(was (\$[\d,.]+)/)?.[1]) === signedCents && cents(msg.match(/now (\$[\d,.]+)\)/)?.[1]) === now, msg)
      if (!phone) await shot(page, 'dev-quote-sent-prices-changed.png')
      await page.locator('[data-quote-sent-keep]').click()
      await sleep(2500)
      const got = await until(async () => { const r = await call('GET', `/api/saved-quotes/${sentId}`); return r.json.data ? r : null }, 20000)
      const q = got?.json.data ?? {}
      check(`${label}: "Keep the sent prices" kept the price and saved the note`, Math.round(q.finalPrice * 100) === signedCents && q.notes.includes(`E2E kept sent prices (${label})`) && q.status === 'SENT' && !q.needsResend, `${q.finalPrice} ${q.status} ${q.needsResend} ${JSON.stringify(q.notes)}`)
      check(`${label}: no page errors`, errors.length === 0, errors.join(' | '))
      await ctx.close()
    }
  }
} catch (e) {
  check('ran to the end', false, String(e?.stack || e).slice(0, 600))
} finally {
  if (invRestore) {
    sql(`UPDATE "InventoryState" SET items = jsonb_set(items, '{${invRestore.idx},unitCost}', to_jsonb(${invRestore.was}::numeric))`)
    check('the Inventory cost is back as it was', sql(`SELECT s.items->${invRestore.idx}->>'unitCost' FROM "InventoryState" s LIMIT 1`) === invRestore.was)
  }
  const quotes = `'${signedId}', '${sentId}'`
  sql(`DELETE FROM "CrmAuditLog" WHERE "entityType" = 'ChangeOrder' AND "entityId" IN (SELECT id FROM "ChangeOrder" WHERE "quoteId" IN (${quotes}))`)
  sql(`DELETE FROM "ChangeOrder" WHERE "quoteId" IN (${quotes})`)
  sql(`DELETE FROM "JobQuotedCost" WHERE "quoteId" IN (${quotes})`)
  sql(`DELETE FROM "AutomationEvent" WHERE "entityId" IN ('${jobId}', ${quotes}, '${contactId}')`)
  sql(`DELETE FROM "JobChecklistItem" WHERE "jobId" = '${jobId}'`)
  sql(`DELETE FROM "SavedJob" WHERE id = '${jobId}' OR "quoteId" IN (${quotes})`)
  sql(`DELETE FROM "SavedQuote" WHERE id IN (${quotes})`)
  sql(`DELETE FROM "CrmAuditLog" WHERE "entityId" IN ('${jobId}', ${quotes}, '${contactId}')`)
  sql(`UPDATE "BusinessState" SET "pullSheets" = COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements("pullSheets") e WHERE COALESCE(e->>'quoteId', '') NOT IN (${quotes})), '[]'::jsonb), version = version + 1 WHERE "pullSheets"::text LIKE '%${signedId}%' OR "pullSheets"::text LIKE '%${sentId}%'`)
  sql(`DELETE FROM "CrmContact" WHERE id = '${contactId}'`)
  const left = Number(sql(`SELECT (SELECT count(*) FROM "SavedQuote" WHERE id IN (${quotes})) + (SELECT count(*) FROM "ChangeOrder" WHERE "quoteId" IN (${quotes})) + (SELECT count(*) FROM "SavedJob" WHERE id = '${jobId}') + (SELECT count(*) FROM "CrmContact" WHERE id = '${contactId}') + (SELECT count(*) FROM "BusinessState" WHERE "pullSheets"::text LIKE '%${signedId}%')`))
  check('cleaned up (quotes, job, change orders, quoted cost, customer, pull sheet links)', left === 0, `${left} left`)
  await browser.close()
  await phoneBrowser.close()
  const failed = results.filter(r => !r).length
  console.log(`\n${results.length - failed} of ${results.length} checks passed`)
  process.exit(failed ? 1 : 0)
}
