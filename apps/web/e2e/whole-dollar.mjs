// Whole dollar prices in the quote builder (Jonathan, Oct 21 2026: "round
// every new proposal and contract price to the whole dollar (logged as an
// adjustment out of profit) ... Don't change already sent or signed quotes.").
// On the dev copy (4001 serves the built app: run `pnpm -s build` in apps/web first).
//
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 E2E_ACCESS_TOKEN=<dev owner token> \
//     [SHOTS=<folder>] node e2e/whole-dollar.mjs
//
// A priced quote is copied twice: a Draft and a Sent one (saved before the rule,
// so neither is marked). The owner opens the Draft: the price is whole dollars,
// "Rounded to the whole dollar −$0.xx" is its own line (exactly the Sent one's
// cents today), and saving stores the whole dollar price, the cents and the
// proposal marked whole dollar, every option whole. The Sent one opens with its
// cents and no rounding line. The Draft's proposal link (no staff sign in)
// shows whole dollars, the deposit too.
// Removes everything it made (hard deletes on ezbiz_dev only).
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
const cents = text => { const m = String(text).match(/\$\s?([\d,]+(?:\.\d{2})?)/); return m ? Math.round(parseFloat(m[1].replace(/,/g, '')) * 100) : NaN }
async function until(fn, ms = 20000, every = 500) { const end = Date.now() + ms; for (;;) { const v = await fn().catch(() => null); if (v || Date.now() > end) return v; await sleep(every) } }
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name) }).catch(() => {}) }

const stamp = Date.now().toString(36).slice(-5)
const NAME = `E2E Whole Dollar ${stamp}`
const contactId = crypto.randomUUID(), draftId = crypto.randomUUID(), sentId = crypto.randomUUID()

const browser = await chromium.launch()
try {
  let all = []
  for (let i = 0; i < 30 && !all.length; i++) { all = (await call('GET', '/api/saved-quotes')).json.data ?? []; if (!all.length) await sleep(2000) }
  // Priced from cost: a price set by hand does not move with footage.
  const template = all.filter(q => !/^E2E/i.test(q.customerName) && !(q.pricing?.finalPrice > 0) && Array.isArray(q.pullSheet) && q.pullSheet.length >= 8 && q.totalCOGS > 0 && !q.work && q.runs?.length && !q.pricing?.finalPrice && q.pullSheet.some(l => l.item === 'ND, Donut'))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0]
  check('a priced quote to copy', !!template, template ? `${template.fenceStyle}, ${template.runs.length} runs` : 'none')
  if (!template) throw new Error('no template quote')
  const c = await call('POST', '/api/crm-contacts', { id: contactId, firstName: 'E2E', lastName: `Whole Dollar ${stamp}`, phone: '3525550177', email: 'e2e-whole-dollar@example.invalid', leadSource: 'Other' })
  const priced = ['fenceStyle', 'runs', 'runRails', 'corners', 'ends', 'walkGates', 'dblGates', 'tearOutSections', 'tearOutGates', 'adjLaborHrs', 'hasSalesman', 'priceAdjust', 'sections', 'materialCost', 'laborCost', 'tearOutCost', 'totalCOGS', 'finalPrice', 'gmPct', 'pullSheet']
  // Its pricing choices without any whole dollar mark: a quote saved before the rule.
  const { wholeDollar, roundingCents, ...pricing } = template.pricing ?? {}
  void wholeDollar; void roundingCents
  const body = { ...Object.fromEntries(priced.map(k => [k, template[k]])), pricing, layout: { yard: null, runSections: template.layout?.runSections ?? [] } }
  const who = { crmContactId: contactId, customerName: NAME, customerPhone: '3525550177', customerEmail: 'e2e-whole-dollar@example.invalid', customerAddress: '9 Whole Dollar Way, Ocala, FL 34470', leadSource: 'Other', salesRep: 'E2E', date: '2026-10-21' }
  const d = await call('POST', '/api/saved-quotes', { id: draftId, ...body, ...who, status: 'DRAFT' })
  const s = await call('POST', '/api/saved-quotes', { id: sentId, ...body, ...who, status: 'SENT' })
  check('set up: a Draft and a Sent copy, saved before the rule', c.status < 300 && d.status < 300 && s.status < 300, `${c.status} ${d.status} ${s.status}`)

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addInitScript(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, TOKEN)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 300)))
  page.on('dialog', d => d.accept().catch(() => {}))
  await page.route('**/api/automations/trigger', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' }))
  const open = async id => { await page.goto(`${APP}/?quote=${id}`); await page.waitForSelector('[data-quote-builder] [data-bar-price]', { timeout: 30000 }); await sleep(1500) }

  // ── The Sent one: as the customer saw it (to the cent), no rounding line ──
  await open(sentId)
  // The bar shows the customer's sent price; the builder's own price at today's costs is on data-builder-cents.
  const sentToday = Number(await page.locator('[data-bar-price]').first().getAttribute('data-builder-cents'))
  check('Sent before the rule: opens priced to the cent, no rounding line', Number.isFinite(sentToday) && (await page.locator('[data-quote-rounding]').count()) === 0, String(sentToday))
  await page.goto(`${APP}/quotes`); await sleep(800)

  // ── The Draft: whole dollars, the cents as their own line ──
  await open(draftId)
  const draftPrice = cents(await page.locator('[data-bar-price]').first().innerText())
  const expectRound = sentToday % 100
  check('Draft: the price is the same job rounded down to the whole dollar', draftPrice === sentToday - expectRound && draftPrice % 100 === 0, `${draftPrice} vs ${sentToday}`)
  const line = page.locator('[data-quote-rounding]')
  const lineShown = expectRound > 0 ? (await line.isVisible()) && cents(await page.locator('[data-quote-rounding-amount]').innerText()) === expectRound : (await line.count()) === 0
  check('the staff see "Rounded to the whole dollar −$0.xx" (out of profit), then the margin', lineShown, expectRound > 0 ? await line.innerText().catch(() => '') : 'no cents today')
  await shot(page, 'whole-dollar-builder.png')
  await page.locator('[data-save-open]').click()
  await page.waitForSelector('[data-save-submit]', { timeout: 10000 })
  await page.locator('[data-save-submit]').click()
  const saved = await until(async () => { const q = (await call('GET', `/api/saved-quotes/${draftId}`)).json.data; return q?.pricing?.wholeDollar === true ? q : null }, 30000)
  check('saved: the whole dollar price, the cents kept with the quote, the proposal marked whole dollar', !!saved && Math.round(saved.finalPrice * 100) === draftPrice && saved.pricing.roundingCents === expectRound && saved.proposal?.wholeDollar === true,
    saved ? `${saved.finalPrice} ${JSON.stringify({ w: saved.pricing.wholeDollar, r: saved.pricing.roundingCents })} ${saved.proposal?.wholeDollar}` : 'not saved')
  const opts = saved?.proposal?.options ?? []
  check('every proposal option is whole dollars', opts.length > 0 && opts.every(o => Math.round(o.finalPrice * 100) % 100 === 0), opts.map(o => o.finalPrice).join(', '))
  const sentAfter = (await call('GET', `/api/saved-quotes/${sentId}`)).json.data
  check('the Sent quote did not change', sentAfter.finalPrice === template.finalPrice && sentAfter.pricing?.wholeDollar === undefined, `${sentAfter.finalPrice}`)

  // ── The customer's page (no staff sign in): whole dollars, the deposit too ──
  const t = await call('POST', `/api/saved-quotes/${draftId}/share-token`)
  const cust = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const cp = await cust.newPage()
  await cp.goto(`${new URL(APP).origin}/p/${t.json.data.shareToken}`)
  await cp.waitForSelector('.price', { timeout: 20000 })
  const main = await cp.locator('main').innerText()
  const shownPrices = [...main.matchAll(/\$[\d,]+(\.\d{2})?/g)].map(m => m[0])
  const dep = await cp.locator('#deposit b').innerText().catch(() => '')
  check('the proposal shows no cents anywhere (prices, a foot, deposit)', shownPrices.length > 0 && shownPrices.every(p => !/\.\d{2}$/.test(p)), shownPrices.slice(0, 6).join(' '))
  if (dep) {
    const pct = Number(await cp.locator('#deposit').getAttribute('data-pct'))
    const chosen = Math.round(opts[saved.proposal.recommended ?? 0].finalPrice * 100)
    check('the deposit: whole dollars, as the payment schedule makes it', cents(dep) === Math.floor(Math.round(chosen * pct / 100) / 100) * 100, `${dep} at ${pct}% of ${chosen / 100}`)
  }
  await shot(cp, 'whole-dollar-proposal.png')
  await cust.close()
  check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '))
  await ctx.close()
} catch (e) {
  check('ran to the end', false, String(e).split('\n').slice(0, 3).join(' '))
} finally {
  await browser.close().catch(() => {})
  try {
    sql(`BEGIN;
      DELETE FROM "AutomationEvent" WHERE "entityId" IN ('${draftId}', '${sentId}', '${contactId}');
      DELETE FROM "ProposalView" WHERE "quoteId" IN ('${draftId}', '${sentId}');
      DELETE FROM "JobQuotedCost" WHERE "quoteId" IN ('${draftId}', '${sentId}');
      DELETE FROM "SavedQuote" WHERE id IN ('${draftId}', '${sentId}');
      DELETE FROM "CrmAuditLog" WHERE "entityId" IN ('${draftId}', '${sentId}', '${contactId}');
      UPDATE "BusinessState" SET "pullSheets" = COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements("pullSheets") e WHERE COALESCE(e->>'quoteId', '') NOT IN ('${draftId}', '${sentId}')), '[]'::jsonb), version = version + 1 WHERE "pullSheets"::text LIKE '%${draftId}%' OR "pullSheets"::text LIKE '%${sentId}%';
      DELETE FROM "CrmContact" WHERE id = '${contactId}';
      COMMIT;`)
    const left = Number(sql(`SELECT (SELECT count(*) FROM "SavedQuote" WHERE id IN ('${draftId}', '${sentId}')) + (SELECT count(*) FROM "CrmContact" WHERE id = '${contactId}')`))
    check('cleaned up', left === 0, `${left} rows left`)
  } catch (e) { check('cleaned up', false, String(e).split('\n')[0]) }
  const failed = results.filter(r => !r).length
  console.log(`\n${results.length - failed} of ${results.length} checks passed`)
  process.exit(failed ? 1 : 0)
}
