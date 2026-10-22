// Dollar adjustment on the quote (Jonathan, Oct 22 2026): "Below [the slider]
// add a Final Price field I can type into directly, or a plus/minus dollar
// field, so I can take $30 off without the price jumping in chunks ... A
// checkbox 'Show as discount on the proposal' controls how the customer sees
// it." On the dev copy (4001 serves the built app: run `pnpm -s build` in apps/web first).
//
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 E2E_ACCESS_TOKEN=<dev owner token> \
//     [PHONE=1] [SHOTS=<folder>] node e2e/price-adjustment.mjs
//
// PHONE=1: the quote builder on a phone sized WebKit (iPhone); else desktop Chromium.
// A priced quote is copied as a new Draft. The owner opens it on the price
// step and types −30 in "± dollars": the price is exactly $30 lower, the
// "Final price" field follows, the margin and net profit after show (profit
// $30 lower). Typing a final price gives exactly that price. With "Show as
// discount on the proposal" ticked and saved, the customer's link shows the
// list price, "Discount −$30" and the final on every option; unticked, the
// final only. The customer accepts on a phone: the quote is sold at the final
// price and the payment schedule's deposit comes from it.
// Removes everything it made (hard deletes on ezbiz_dev only).
import './devOnly.mjs'
import './sharedLock.mjs'
import { chromium, webkit } from 'playwright'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || 'http://localhost:4001'
const TOKEN = process.env.E2E_ACCESS_TOKEN || ''
const SHOTS = process.env.SHOTS || ''
const PHONE = !!process.env.PHONE
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
const sql = q => execFileSync('psql', ['-d', 'ezbiz_dev', '-At', '-c', q]).toString().trim()
const dollars = text => { const m = String(text).replace(/−/g, '-').match(/(-?)\$\s?([\d,]+(?:\.\d{2})?)/); return m ? (m[1] ? -1 : 1) * Math.round(parseFloat(m[2].replace(/,/g, '')) * 100) : NaN }
async function until(fn, ms = 20000, every = 500) { const end = Date.now() + ms; for (;;) { const v = await fn().catch(() => null); if (v || Date.now() > end) return v; await sleep(every) } }
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${PHONE ? 'phone' : 'desk'}-${name}`), fullPage: false }).catch(() => {}) }

const stamp = Date.now().toString(36).slice(-5)
const NAME = `E2E Price Adjust ${stamp}`
const contactId = crypto.randomUUID(), quoteId = crypto.randomUUID()
let jobId = null

const engine = PHONE ? webkit : chromium
const browser = await engine.launch()
const phoneBrowser = PHONE ? browser : await webkit.launch()
try {
  let all = []
  for (let i = 0; i < 30 && !all.length; i++) { all = (await call('GET', '/api/saved-quotes')).json.data ?? []; if (!all.length) await sleep(2000) }
  const template = all.filter(q => !/^E2E/i.test(q.customerName) && Array.isArray(q.pullSheet) && q.pullSheet.length >= 8 && q.totalCOGS > 0 && q.finalPrice > 2000 && !q.work && q.runs?.length && !q.pricing?.finalPrice && !q.pricing?.priceAdjustmentCents && q.pullSheet.some(l => l.item === 'ND, Donut'))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0]
  check('a priced quote to copy', !!template, template ? `${template.fenceStyle}, ${template.runs.length} runs` : 'none')
  if (!template) throw new Error('no template quote')
  const c = await call('POST', '/api/crm-contacts', { id: contactId, firstName: 'E2E', lastName: `Price Adjust ${stamp}`, phone: '3525550178', email: 'e2e-price-adjust@example.invalid', leadSource: 'Other' })
  const priced = ['fenceStyle', 'runs', 'runRails', 'corners', 'ends', 'walkGates', 'dblGates', 'tearOutSections', 'tearOutGates', 'adjLaborHrs', 'hasSalesman', 'priceAdjust', 'sections', 'materialCost', 'laborCost', 'tearOutCost', 'totalCOGS', 'finalPrice', 'gmPct', 'pullSheet']
  const { roundingCents, ...pricing } = template.pricing ?? {}
  void roundingCents
  const body = { ...Object.fromEntries(priced.map(k => [k, template[k]])), pricing: { ...pricing, wholeDollar: true }, layout: { yard: null, runSections: template.layout?.runSections ?? [] } }
  const who = { crmContactId: contactId, customerName: NAME, customerPhone: '3525550178', customerEmail: 'e2e-price-adjust@example.invalid', customerAddress: '30 Discount Dr, Ocala, FL 34470', leadSource: 'Other', salesRep: 'E2E', date: '2026-10-22' }
  const d = await call('POST', '/api/saved-quotes', { id: quoteId, ...body, ...who, status: 'DRAFT' })
  check('set up: a new Draft quote', c.status < 300 && d.status < 300, `${c.status} ${d.status}`)

  const ctx = await browser.newContext(PHONE ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } })
  await ctx.addInitScript(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, TOKEN)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 300)))
  page.on('dialog', dl => dl.accept().catch(() => {}))
  await page.route('**/api/automations/trigger', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' }))
  const open = async () => { await page.goto(`${APP}/?quote=${quoteId}`); await page.waitForSelector('[data-quote-builder] [data-bar-price]', { timeout: 30000 }); await sleep(1500) }
  const barPrice = async () => dollars(await page.locator('[data-bar-price]').first().innerText())
  const save = async () => {
    await page.locator('[data-save-open]').first().click()
    await page.waitForSelector('[data-save-submit]', { timeout: 10000 })
    await page.locator('[data-save-submit]').click()
  }

  // ── Take $30 off ──
  await open()
  const list = await barPrice()
  const box = page.locator('[data-price-adjustment]')
  check('the price step has Final price and ± dollars under the slider', await box.isVisible() && await box.locator('[data-adjust-final]').isVisible() && await box.locator('[data-adjust-dollars]').isVisible(), String(list))
  const gm0 = parseFloat(await page.locator('span', { hasText: /^Gross Margin$/ }).locator('xpath=following-sibling::span[1]').first().innerText().catch(() => 'NaN'))
  const profit0 = dollars(await page.locator('[data-dollar-part="profit"]').innerText())
  await box.locator('[data-adjust-dollars]').fill('30')
  await box.locator('[data-adjust-sign]').click()
  await sleep(600)
  const after = await barPrice()
  check('± dollars: −30 (typed 30, then ±) takes exactly $30 off', after === list - 3000, `${list} → ${after}`)
  check('Final price follows', dollars('$' + await box.locator('[data-adjust-final]').inputValue()) === after, await box.locator('[data-adjust-final]').inputValue())
  const sum = box.locator('[data-adjust-summary]')
  const marginAfter = parseFloat(await sum.locator('[data-adjust-margin]').innerText())
  const profitAfter = dollars(await sum.locator('[data-adjust-profit]').innerText())
  check('the summary: before, Discount −$30, final', dollars(await sum.locator('[data-adjust-list]').innerText()) === list && dollars(await sum.locator('[data-adjust-amount]').innerText()) === -3000 && dollars(await sum.locator('[data-adjust-final-price]').innerText()) === after)
  check('margin and net profit after: profit exactly $30 lower, margin lower', Math.abs(profit0 - profitAfter - 3000) <= 100 && marginAfter < gm0 + 0.001 && /give up \$30(\.00)? of profit/.test(await sum.innerText()), `profit ${profit0} → ${profitAfter}, margin ${gm0}% → ${marginAfter}%`)
  check('where every dollar goes: profit picket shows the lower profit', Math.abs(dollars(await page.locator('[data-dollar-part="profit"]').innerText()) - profitAfter) <= 100)
  await shot(page, 'adjust-1-off30.png')

  // ── Typing a final price gives exactly that price ──
  const typed = Math.round(list / 100) - 57
  await box.locator('[data-adjust-final]').fill(String(typed))
  await sleep(600)
  check('Final price typed: exactly that price, ± dollars says −57', (await barPrice()) === typed * 100 && (await box.locator('[data-adjust-dollars]').inputValue()) === '-57', `${await barPrice()} ${await box.locator('[data-adjust-dollars]').inputValue()}`)
  await box.locator('[data-adjust-dollars]').fill('-30')
  await box.locator('[data-adjust-final]').blur().catch(() => {})
  await sleep(600)
  check('back to −30 in ± dollars', (await barPrice()) === list - 3000)

  // ── Under cost is refused ──
  await box.locator('[data-adjust-dollars]').fill(String(-Math.round(list / 100)))
  await sleep(600)
  check('taking off more than the margin is refused (price unchanged, says under cost)', (await barPrice()) === list && await box.locator('[data-adjust-refused]').isVisible())
  await box.locator('[data-adjust-dollars]').fill('-30')
  await sleep(600)

  // ── Checked: list, Discount, final ──
  await box.locator('[data-adjust-show-discount]').check()
  await save()
  const saved = await until(async () => { const q = (await call('GET', `/api/saved-quotes/${quoteId}`)).json.data; return q?.pricing?.priceAdjustmentCents === -3000 && q.pricing.showDiscountOnProposal === true ? q : null }, 30000)
  check('saved: priceAdjustmentCents −3000 and the box, frozen with the quote; the final price', !!saved && Math.round(saved.finalPrice * 100) === list - 3000 && saved.proposal?.showDiscount === true,
    saved ? `${saved.finalPrice} ${JSON.stringify({ a: saved.pricing.priceAdjustmentCents, s: saved.pricing.showDiscountOnProposal })}` : 'not saved')
  const opts = saved?.proposal?.options ?? []
  check('every option on the proposal carries −$30', opts.length > 0 && opts.every(o => o.adjustmentCents === -3000), opts.map(o => `${o.finalPrice} (${o.adjustmentCents})`).join(', '))
  const t = await call('POST', `/api/saved-quotes/${quoteId}/share-token`)
  const token = t.json.data?.shareToken
  const cust = await phoneBrowser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const cp = await cust.newPage()
  await cp.goto(`${new URL(APP).origin}/p/${token}`)
  await cp.waitForSelector('.price', { timeout: 20000 })
  const n = await cp.locator('.opt').count()
  let allShown = n === opts.length
  for (let i = 0; i < n; i++) {
    const o = cp.locator('.opt').nth(i)
    const l = dollars(await o.locator('[data-list-price]').innerText().catch(() => ''))
    const dsc = await o.locator('[data-discount]').innerText().catch(() => '')
    const f = dollars(await o.locator('[data-final-price]').innerText().catch(() => ''))
    if (!(l === Math.round(opts[i].finalPrice * 100) + 3000 && /Discount\s*−\$30\b/.test(dsc) && f === Math.round(opts[i].finalPrice * 100))) allShown = false
  }
  check('customer page, box ticked: each option shows the list price, Discount −$30 and the final', allShown, `${n} options`)
  await shot(cp, 'adjust-2-proposal-discount.png')

  // ── Unchecked: the final only ──
  await open()
  await page.locator('[data-price-adjustment] [data-adjust-show-discount]').uncheck()
  await save()
  const saved2 = await until(async () => { const q = (await call('GET', `/api/saved-quotes/${quoteId}`)).json.data; return q?.pricing?.priceAdjustmentCents === -3000 && !q.pricing.showDiscountOnProposal ? q : null }, 30000)
  check('saved unticked: still −$30, no discount on the proposal', !!saved2 && Math.round(saved2.finalPrice * 100) === list - 3000 && !saved2.proposal?.showDiscount)
  await cp.goto(`${new URL(APP).origin}/p/${token}`)
  await cp.waitForSelector('.price', { timeout: 20000 })
  const mainText = await cp.locator('main').innerText().catch(async () => cp.locator('body').innerText())
  check('customer page, box unticked: the final price only (no list price, no Discount line)', (await cp.locator('[data-list-price], [data-discount]').count()) === 0 && mainText.includes('$' + ((list - 3000) / 100).toLocaleString('en-US')))
  await shot(cp, 'adjust-3-proposal-final-only.png')

  // ── The customer accepts: sold at the final, the deposit from the final ──
  const rec = saved2.proposal.recommended ?? 0
  const own = saved2.proposal.options.findIndex(o => o.fenceStyle === saved2.fenceStyle)
  const pick = own >= 0 ? own : rec
  await cp.locator('.opt').nth(pick).click(); await sleep(300)
  const pickCents = Math.round(saved2.proposal.options[pick].finalPrice * 100)
  await cp.locator('#name').fill('E2E Price Adjust')
  const sig = await cp.locator('#sig').boundingBox()
  const pt = i => ({ clientX: sig.x + 30 + i * 20, clientY: sig.y + 80 + (i % 2 ? -25 : 25), pointerId: 7, pointerType: 'touch', bubbles: true })
  await cp.locator('#sig').dispatchEvent('pointerdown', pt(0))
  for (let i = 1; i <= 12; i++) await cp.locator('#sig').dispatchEvent('pointermove', pt(i))
  await cp.locator('#sig').dispatchEvent('pointerup', pt(12))
  await cp.locator('#go').click(); await sleep(2500)
  const sold = await until(async () => { const q = (await call('GET', `/api/saved-quotes/${quoteId}`)).json.data; return q?.acceptedAt ? q : null }, 30000)
  check('accepted: sold at the final price, the adjustment kept', !!sold && sold.status === 'SOLD' && Math.round(sold.finalPrice * 100) === pickCents && sold.pricing?.priceAdjustmentCents === -3000, sold ? `${sold.status} ${sold.finalPrice}` : 'not accepted')
  jobId = await until(async () => sql(`SELECT id FROM "SavedJob" WHERE "quoteId" = '${quoteId}' LIMIT 1`) || null, 20000)
  const sched = jobId ? await until(async () => (await call('GET', `/api/payments/job/${jobId}`)).json.data?.schedule ?? null, 20000) : null
  const dep = sched?.invoices?.find(i => i.kind === 'deposit'), fin = sched?.invoices?.find(i => i.kind === 'final')
  const pct = Number(sched?.depositPct)
  const wantDep = Math.floor(Math.round(pickCents * pct / 100) / 100) * 100
  check('payment schedule: the deposit comes from the final price, deposit + final = the final price', !!dep && dep.amountCents === wantDep && dep.amountCents + (fin?.amountCents ?? 0) === pickCents, `${dep?.amountCents} + ${fin?.amountCents} of ${pickCents} at ${pct}%`)
  await cust.close()

  // ── Signed: the builder shows the adjustment, no fields to change it ──
  await open()
  check('signed quote: the adjustment is shown, not editable', (await page.locator('[data-price-adjustment-locked]').count()) === 1 && (await page.locator('[data-adjust-dollars]').count()) === 0)
  check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '))
  await ctx.close()
} catch (e) {
  check('ran to the end', false, String(e).split('\n').slice(0, 3).join(' '))
} finally {
  await browser.close().catch(() => {})
  if (!PHONE) await phoneBrowser.close().catch(() => {})
  try {
    const jl = jobId ? `'${jobId}'` : "'-'"
    sql(`BEGIN;
      DELETE FROM "AutomationEvent" WHERE "entityId" IN ('${quoteId}', '${contactId}', ${jl});
      DELETE FROM "ProposalView" WHERE "quoteId" = '${quoteId}';
      DELETE FROM "JobQuotedCost" WHERE "quoteId" = '${quoteId}';
      DELETE FROM "ContractAdjustment" WHERE "jobId" = ${jl};
      DELETE FROM "JobChecklistItem" WHERE "jobId" = ${jl};
      DELETE FROM "SavedJob" WHERE id = ${jl};
      DELETE FROM "SavedQuote" WHERE id = '${quoteId}';
      DELETE FROM "CrmAuditLog" WHERE "entityId" IN ('${quoteId}', '${contactId}', ${jl});
      UPDATE "BusinessState" SET "pullSheets" = COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements("pullSheets") e WHERE COALESCE(e->>'quoteId', '') <> '${quoteId}'), '[]'::jsonb), version = version + 1 WHERE "pullSheets"::text LIKE '%${quoteId}%';
      COMMIT;`)
    // The accepted job's card and anything else made for this customer.
    const pl = (await call('GET', '/api/pipeline')).json
    const mine = (pl?.data?.leads ?? []).filter(l => l.customerId === contactId || l.quoteId === quoteId).map(l => l.id)
    if (mine.length) await call('PATCH', '/api/pipeline', { upsert: [], remove: mine, baseVersion: pl.data.version })
    await call('DELETE', `/api/crm-contacts/${contactId}`)
    sql(`DELETE FROM "CrmContact" WHERE id = '${contactId}'`)
    const left = Number(sql(`SELECT (SELECT count(*) FROM "SavedQuote" WHERE id = '${quoteId}') + (SELECT count(*) FROM "SavedJob" WHERE "quoteId" = '${quoteId}') + (SELECT count(*) FROM "CrmContact" WHERE id = '${contactId}')`))
    check('cleaned up', left === 0, `${left} rows left`)
  } catch (e) { check('cleaned up', false, String(e).split('\n')[0]) }
  const failed = results.filter(r => !r).length
  console.log(`\n${results.length - failed} of ${results.length} checks passed`)
  process.exit(failed ? 1 : 0)
}
