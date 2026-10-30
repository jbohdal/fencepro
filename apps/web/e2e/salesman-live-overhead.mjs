// The Salesman prices at the owner's overhead (money, Oct 30 2026). A reviewer
// found Christa's quote for a vinyl yard about 12% under the owner's and the
// website's: live overhead (Settings → Pricing, from the budget) was worked out
// on each phone from the jobs it holds, and hers holds only her own, so she was
// at the typed 30% while the owner was at the live 36.9%.
//
//   APP_URL=http://localhost:<worktree server> E2E_OWNER_COOKIE=<file> E2E_SALES_COOKIE=<file> E2E_SALES_TOKEN=<file> \
//     [SHOTS=<folder>] node e2e/salesman-live-overhead.mjs
//
// The same yard (drawn on the website, test mode: nothing saved there) as a
// new draft of the Salesman's: the owner opens it on a computer, the Salesman
// on an iPhone (WebKit); both builders show the website's price, at the
// overhead in use. The Salesman saves it from her phone: the server has that
// price and that overhead. Her quote and customer are removed (dev only).
import './devOnly.mjs'
import { chromium, webkit } from 'playwright'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || APP
const read = v => (v && fs.existsSync(v) ? fs.readFileSync(v, 'utf8').trim() : v || '')
const OWNER = read(process.env.E2E_OWNER_COOKIE), SALES = read(process.env.E2E_SALES_COOKIE), SALES_TOKEN = read(process.env.E2E_SALES_TOKEN)
const SHOTS = process.env.SHOTS || ''
if (!OWNER || !SALES || !SALES_TOKEN) { console.error('Set E2E_OWNER_COOKIE, E2E_SALES_COOKIE and E2E_SALES_TOKEN (scripts/dev-session-token.ts).'); process.exit(2) }
const envFile = new URL('../../portal/.env', import.meta.url)
if (!/\/ezbiz_dev(\?|")/.test(fs.readFileSync(envFile, 'utf8').match(/^DATABASE_URL=.*$/m)?.[0] ?? '')) { console.error('Refusing to run: apps/portal/.env does not name ezbiz_dev.'); process.exit(2) }
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const asSales = async (method, p, body) => {
  const r = await fetch(`${API}${p}`, { method, headers: { Authorization: `Bearer ${SALES_TOKEN}`, 'X-Staff-Request': '1', 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: r.status, json: await r.json().catch(() => ({})) }
}
async function until(fn, ms = 20000, every = 400) { const end = Date.now() + ms; for (;;) { const v = await fn().catch(() => null); if (v || Date.now() > end) return v; await sleep(every) } }
const money = cents => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`

// A backyard from the house with a walk gate, white vinyl 6 ft privacy.
const at = { lat: 29.185118, lng: -82.134209 }
const ll = (e, n) => ({ lat: at.lat + (n * 0.3048) / 110_860, lng: at.lng + (e * 0.3048) / 97_330 })
const drawing = { v: 1, address: '110 SE Watula Ave, Ocala, FL 34471', at, runs: [{ id: 'r1', pts: [ll(-30, 15), ll(-55, 15), ll(-55, 95), ll(55, 95), ll(55, 15), ll(30, 15)], start: 'house', end: 'house', typedFt: [null, null, null, null, null], gates: [null, { type: 'walk', widthFt: 4, startFt: 11 }, null, null, null] }] }
const pick = { material: 'vinyl', color: 'white', height: '6', kind: 'privacy' }
const tag = Date.now().toString(36).slice(-5)
let quoteId = null
const contactId = crypto.randomUUID()

const chrome = await chromium.launch(), safari = await webkit.launch()
try {
  // The website's price for the yard (test mode).
  const w = async body => { const r = await fetch(`${API}/p/quote/api/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draftId: `sloverhead${tag}0000000`, name: 'E2E Overhead', phone: '3525550100', address: drawing.address, drawing, pick, test: true, ...body }) }); return { status: r.status, body: await r.json() } }
  const first = await w({})
  const opt = first.body.options?.find(o => o.fenceStyle === "WV-ND 6'x6' Privacy") ?? first.body.options?.[0]
  check('the website prices the yard', first.status === 200 && !!opt, opt ? `${opt.fenceStyle} ${money(Math.round(opt.price * 100))}` : JSON.stringify(first.body).slice(0, 200))
  const pv = (await w({ fenceStyle: opt.fenceStyle })).body.preview
  const webCents = Math.round(opt.price * 100)

  // The Salesman's new draft of that yard (not priced yet: the builder prices it on open).
  const c = await asSales('POST', '/api/crm-contacts', { id: contactId, firstName: 'E2E', lastName: `Overhead ${tag}`, phone: '3525550100', email: 'e2e-overhead@example.invalid', leadSource: 'Other', serviceAddress: drawing.address })
  check('her customer', c.status < 300, String(c.status))
  const q = await asSales('POST', '/api/saved-quotes', {
    crmContactId: contactId, customerName: `E2E Overhead ${tag}`, customerPhone: '3525550100', customerAddress: drawing.address, leadSource: 'Other',
    fenceStyle: pv.fenceStyle, runs: pv.runs, corners: pv.corners, ends: pv.ends, walkGates: pv.walkGates, dblGates: pv.dblGates, priceAdjust: pv.priceAdjust,
    sections: 0, status: 'DRAFT', finalPrice: 0, date: new Date().toISOString().slice(0, 10), layout: pv.layout,
  })
  quoteId = q.json.data?.id ?? null
  check('the Salesman\'s new draft of the yard', q.status < 300 && !!quoteId, `${q.status} ${quoteId ?? JSON.stringify(q.json).slice(0, 200)}`)

  const open = async (browser, cookie, view) => {
    const ctx = await browser.newContext(view)
    const u = new URL(API)
    await ctx.addCookies([{ name: 'ezbiz_staff', value: cookie, domain: u.hostname, path: '/api', httpOnly: true, secure: false, sameSite: 'Strict' }])
    await ctx.route(/USGSNAIPPlus|USGSImageryOnly|\/p\/tiles\/(naip|esri|aerial)\//, r => r.abort())
    await ctx.route('**/api/automations/trigger', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' }))
    const page = await ctx.newPage()
    const settings = []
    page.on('response', async r => { if (/\/api\/business-state/.test(r.url()) && r.request().method() === 'GET') settings.push(await r.json().catch(() => null)) })
    page.on('dialog', dl => dl.accept().catch(() => {}))
    await page.goto(`${APP}/quotes?quote=${quoteId}`)
    await page.waitForSelector('[data-quote-builder] [data-bar-price]', { timeout: 45000 })
    await sleep(2500)
    const cents = Number(await page.locator('[data-bar-price]').first().getAttribute('data-builder-cents'))
    return { ctx, page, cents, overhead: settings.map(s => s?.overheadNow?.last12?.pct).find(x => x != null) ?? null }
  }
  const owner = await open(chrome, OWNER, { viewport: { width: 1280, height: 950 } })
  if (SHOTS) await owner.page.screenshot({ path: path.join(SHOTS, 'owner-computer.png') })
  const sales = await open(safari, SALES, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, serviceWorkers: 'block' })
  if (SHOTS) await sales.page.screenshot({ path: path.join(SHOTS, 'salesman-iphone.png') })
  check('the owner\'s builder (computer) shows the website\'s price', owner.cents === webCents, `${money(owner.cents)} vs website ${money(webCents)}, overhead ${owner.overhead}%`)
  check('the Salesman\'s builder (iPhone) shows the same price', sales.cents === owner.cents, `${money(sales.cents)}, overhead ${sales.overhead}%`)
  check('both phones got the same live overhead from the server', sales.overhead != null && sales.overhead === owner.overhead, `${sales.overhead}% / ${owner.overhead}%`)

  // The Salesman saves it from her phone.
  await sales.page.locator('[data-save-open]').first().click()
  const confirm = await until(async () => (await sales.page.locator('[data-price-recheck="confirm"]').count()) ? true : (await sales.page.locator('[data-save-submit]').count()) ? true : null, 20000)
  if (await sales.page.locator('[data-price-recheck-save]').count()) await sales.page.locator('[data-price-recheck-save]').click()
  if (confirm) { await sales.page.waitForSelector('[data-save-submit]', { timeout: 10000 }); await sales.page.locator('[data-save-submit]').click() }
  const saved = await until(async () => { const r = (await asSales('GET', `/api/saved-quotes/${quoteId}`)).json.data; return r && r.finalPrice > 0 ? r : null }, 30000)
  check('her save: the server has the owner\'s price', !!saved && Math.round(saved.finalPrice * 100) === owner.cents, saved ? money(Math.round(saved.finalPrice * 100)) : 'not saved')
  check('...priced at the overhead in use', !!saved && saved.pricing?.overheadPct === owner.overhead, `${saved?.pricing?.overheadPct}%`)
  if (SHOTS) await sales.page.screenshot({ path: path.join(SHOTS, 'salesman-saved.png') })
  await owner.ctx.close(); await sales.ctx.close()
} catch (e) {
  check('ran to the end', false, String(e).slice(0, 400))
} finally {
  // Hard deletes of its own quote and customer (ezbiz_dev only: the .env check above).
  const { execFileSync } = await import('child_process')
  const sql = q => { try { execFileSync('psql', ['-d', 'ezbiz_dev', '-At', '-c', q]) } catch (e) { console.error(String(e).slice(0, 200)) } }
  sql(`delete from "CrmAuditLog" where "entityId" in ('${quoteId}', '${contactId}')`)
  sql(`delete from "SavedQuote" where "crmContactId" = '${contactId}' or id = '${quoteId}'`)
  sql(`delete from "CrmContactNote" where "crmContactId" = '${contactId}'`)
  sql(`delete from "CrmContact" where id = '${contactId}'`)
  await chrome.close(); await safari.close()
}
const failed = results.filter(x => !x).length
console.log(`\n${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
