// Change order re-check, round 4 (Oct 26 2026), on the dev copy, on a phone (WebKit 390 x 844).
//
//   APP_URL=http://localhost:4054 E2E_ACCESS_TOKEN=<dev owner token> [E2E_SALES_TOKEN=<dev salesman token>] node e2e/round4-co.mjs
//
// With no E2E_SALES_TOKEN it makes its own Salesman login (lib.mjs makeTestLogin) and removes it at the end.
//
// Set up (API, as the owner): a customer, a Sold quote copied from a priced no dig quote with a yard drawing,
// its job and the crew's packet; CO-1 (one side 10 ft longer) and CO-2 (a walk gate in another side, drawn on
// top of CO-1), both from the drawing, both open.
//
//   1. The job page is open on the phone. The customer signs CO-1 on their link (another device): without a
//      reload, CO-1 shows Approved, the Documents list has its signed PDF, the packet notice names the gate's
//      side... (round 4 item 3).
//   2. "Customer signs on this phone" for CO-2: the new layout (the drawing) and the note that it also shows
//      CO-1's change, the contract before and with it, no cost. Signed: the Documents list has both at once.
//   3. CO-3 left open (from the drawing); "Change order" again: the editor says its drawing includes CO-3, not
//      signed yet; a gate tapped on the drawing never says "make a change order".
//   4. The crew packet: "a walk gate in the <side> (4 ft of fence becomes the gate)".
//   5. The salesman: her Sold quote has no Mark Lost. The office: a walk-in saved shows Last contact at once.
// Removes everything it made.
import './devOnly.mjs'
import { webkit } from 'playwright'
import { signInByCookie, makeTestLogin, removeTestLogin } from './lib.mjs'
import crypto from 'crypto'
import { execFileSync } from 'child_process'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || APP
const OWNER = process.env.E2E_ACCESS_TOKEN || ''
let SALES = process.env.E2E_SALES_TOKEN || ''
const SHOTS = process.env.E2E_SHOTS || ''
if (!/^http:\/\/localhost:\d+$/.test(APP) || /:4000$/.test(APP) || /:4000$/.test(API)) { console.error('Refusing to run: the dev copy only.'); process.exit(2) }
if (!OWNER) { console.error('Set E2E_ACCESS_TOKEN (owner) for the dev server.'); process.exit(2) }

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const call = async (method, p, body, token = OWNER) => {
  const r = await fetch(`${API}${p}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await r.text(); let json = {}; try { json = JSON.parse(text) } catch { /* html */ }
  return { status: r.status, json, text }
}
async function until(fn, ms = 20000, every = 500) { const end = Date.now() + ms; for (;;) { const v = await fn().catch(() => null); if (v || Date.now() > end) return v; await sleep(every) } }
// The Salesman: the one named, or a login of its own (the old WT logins are not on the scrubbed dev copy).
const salesLogin = SALES ? null : await makeTestLogin({ role: 'sales_rep', ownerToken: OWNER, api: API })
if (salesLogin) SALES = salesLogin.token
const salesMe = (await call('GET', '/api/crm-auth/me', undefined, SALES)).json?.data
const SALES_NAME = salesMe ? `${salesMe.firstName} ${salesMe.lastName}` : ''
const sql = q => execFileSync('psql', ['-d', 'ezbiz_dev', '-At', '-c', q]).toString().trim()
const theSide = n => `the ${/(^|\s)(side|return|run)$/i.test(n) ? n : `${n} side`}`
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/r4-${name}.png`, fullPage: false }).catch(() => {}) }
const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120" viewBox="0 0 200 120"><rect x="10" y="10" width="180" height="100" fill="none" stroke="#5E28A1" stroke-width="4"/><text x="100" y="65" font-size="14" text-anchor="middle">New layout</text></svg>'

const stamp = Date.now().toString(36).slice(-5)
const WHO = `CO R4 ${stamp}`
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
const X = { contactId: crypto.randomUUID(), quoteId: crypto.randomUUID(), jobId: crypto.randomUUID(), cardId: crypto.randomUUID() }
const walkInLast = `R4 Walkin ${stamp}`
const browser = await webkit.launch()
const errors = []
try {
  // ── Set up ──
  const all = (await call('GET', '/api/saved-quotes')).json.data ?? []
  const plain = s => s && s.on !== false && s.lengthIn >= 96 && !s.gate && !s.skip
  const tpl = all.filter(q => !/^E2E/i.test(q.customerName) && Array.isArray(q.pullSheet) && q.pullSheet.length >= 8 && q.totalCOGS > 0 && !q.work && /^WV-ND 6'x8'/.test(q.fenceStyle) && (q.layout?.yard?.sides ?? []).filter(plain).length >= 2)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0]
  if (!tpl) throw new Error('no priced no dig quote with two plain sides on dev')
  const priced = ['fenceStyle', 'runs', 'runRails', 'corners', 'ends', 'walkGates', 'dblGates', 'tearOutSections', 'tearOutGates', 'adjLaborHrs', 'hasSalesman', 'priceAdjust', 'sections', 'materialCost', 'laborCost', 'tearOutCost', 'totalCOGS', 'finalPrice', 'gmPct', 'pullSheet', 'pricing']
  const c = await call('POST', '/api/crm-contacts', { id: X.contactId, firstName: 'E2E', lastName: WHO, phone: '3525550193', serviceAddress: '9 Round Four Ln, Ocala, FL 34470', leadSource: 'Other', lead: { id: X.cardId, customerId: X.contactId, firstName: 'E2E', lastName: WHO, phone: '3525550193', stage: 'Signed Contract', leadSource: 'Other', quoteId: X.quoteId, createdAt: today, lastMoved: today }, leadBefore: null })
  const q = await call('POST', '/api/saved-quotes', { id: X.quoteId, ...Object.fromEntries(priced.map(k => [k, tpl[k]])), layout: tpl.layout, crmContactId: X.contactId, customerName: `E2E ${WHO}`, customerPhone: '3525550193', customerAddress: '9 Round Four Ln, Ocala, FL 34470', leadSource: 'Other', salesRep: SALES_NAME, date: today, status: 'SOLD' })
  const j = await call('POST', '/api/saved-jobs', { id: X.jobId, quoteId: X.quoteId, crmContactId: X.contactId, customerName: `E2E ${WHO}`, customerAddress: '9 Round Four Ln, Ocala, FL 34470', fenceStyle: tpl.fenceStyle, sections: tpl.sections, totalFeet: Math.round(tpl.runs.reduce((s, f) => s + f, 0)), walkGates: tpl.walkGates, dblGates: tpl.dblGates, quotePrice: tpl.finalPrice, contractValue: tpl.finalPrice, status: 'scheduled', scheduledDate: '2026-11-09', scheduledEndDate: '2026-11-10', estimatedDays: 2, crewAssigned: `E2E crew ${stamp}` })
  const pk = await call('POST', '/api/install-packets', { jobId: X.jobId, snapshot: { style: tpl.fenceStyle, pullSheet: tpl.pullSheet.filter(l => !l.moneyOnly).map(l => ({ item: l.item, qty: l.qty })) } })
  check('set up: Sold quote with a yard drawing, its job, the crew\'s packet', c.status < 300 && q.status < 300 && j.status < 300 && pk.status === 200, `${c.status} ${q.status} ${j.status} ${pk.status} (${tpl.customerName})`)
  const yard0 = tpl.layout.yard
  const [s1, s2] = yard0.sides.filter(plain)
  const yard1 = { ...yard0, sides: yard0.sides.map(s => (s.id === s1.id ? { ...s, lengthIn: s.lengthIn + 120 } : s)) }
  const yard2 = { ...yard1, sides: yard1.sides.map(s => (s.id === s2.id ? { ...s, gate: { type: 'walk', widthIn: 48, position: 'middle' } } : s)) }
  const request = extra => ({ fenceStyle: tpl.fenceStyle, runs: tpl.runs.map(ft => ({ ft, rail: 'auto' })), corners: tpl.corners, ends: tpl.ends, walkGates: tpl.walkGates, dblGates: tpl.dblGates, tearOutSections: 0, tearOutGates: 0, extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0, overrides: {}, jobType: 'new', ...extra })
  const co1 = (await call('POST', '/api/change-orders', { jobId: X.jobId, reason: 'Longer side', lines: [{ id: 'r4a', description: `Add 10 ft of fence (${s1.name} ${s1.lengthIn / 12} ft → ${s1.lengthIn / 12 + 10} ft)`, amountCents: 49200 }], work: { request: request({}), layout: { ...tpl.layout, yard: yard1 }, planSvg: SVG } })).json.data
  const co2 = (await call('POST', '/api/change-orders', { jobId: X.jobId, reason: 'Gate', lines: [{ id: 'r4b', description: `Add 1 walk gate in ${theSide(s2.name)} (4 ft of fence becomes the gate)`, amountCents: 89200 }], work: { request: request({ walkGates: (tpl.walkGates || 0) + 1 }), layout: { ...tpl.layout, yard: yard2 }, planSvg: SVG } })).json.data
  check('set up: CO-1 and CO-2 from the drawing, open', co1?.number === 1 && co2?.number === 2 && (co2.alsoInDrawing ?? []).some(a => a.number === 1), JSON.stringify([co1?.status, co2?.status, co2?.alsoInDrawing]))
  const sent1 = await call('PATCH', `/api/change-orders/${co1.id}`, { baseVersion: co1.version, status: 'sent' })
  const link1 = (await call('POST', `/api/change-orders/${co1.id}/link`, {})).json.data?.token

  // ── 1. The owner's phone: the job page open while the customer signs on their link ──
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await signInByCookie(ctx, { cookie: '', email: '', password: '', token: OWNER, api: API })
  let page = await ctx.newPage()
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)))
  page.on('dialog', d => d.accept().catch(() => {}))
  await page.goto(`${APP}/operations?job=${X.jobId}`)
  await page.waitForSelector(`[data-job-panel="${X.jobId}"] [data-co-row="1"]`, { timeout: 40000 })
  check('job page: CO-1 Sent before the customer signs', await page.locator('[data-co-row="1"]').getAttribute('data-co-status') === 'sent', sent1.status)
  const signed1 = await call('POST', `/p/co/${link1}/sign`, { name: 'Pat Customer', signature: SIG }, '')
  const t0 = Date.now()
  const approved = await until(async () => (await page.locator('[data-co-row="1"]').getAttribute('data-co-status')) === 'approved', 40000)
  check('job page: CO-1 shows Approved without a reload', approved, `${signed1.status} after ${Math.round((Date.now() - t0) / 1000)} s`)
  const docShown = await until(async () => (await page.locator('[data-signed-doc-kind="change_order"]').count()) === 1, 15000)
  check('job page: its signed PDF is in Documents without a reload', docShown)
  const notice = await until(async () => { const t = await page.locator('[data-packet-outdated]').innerText(); return /CO-1/.test(t) ? t : null }, 15000)
  check('job page: the packet notice names CO-1 without a reload', !!notice, notice ?? '')
  await shot(page, '1-job-after-link-sign')

  // ── 2. Signed on this phone: CO-2 ──
  await page.locator('[data-co-row="2"] [data-co-sign-here]').click()
  await page.waitForSelector('[data-co-sign-sheet]', { timeout: 10000 })
  const plan = await until(async () => (await page.locator('[data-co-sign-plan] img').count()) === 1, 10000)
  const sheetText = await page.locator('[data-co-sign-sheet]').innerText()
  check('signing sheet: the new layout (the drawing) shows', plan)
  check('signing sheet: says the drawing also shows CO-1\'s change, signed separately', /also shows CO-1's change \(.+\): not part of this change order \(CO-1, signed separately\)/.test(sheetText), sheetText.slice(0, 400))
  const before = Math.round(tpl.finalPrice * 100) + 49200
  const money = c => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`
  check('signing sheet: contract now (with CO-1) and the new total', sheetText.includes(money(before)) && (await page.locator('[data-co-sign-new-contract]').innerText()).includes(money(before + 89200)))
  check('signing sheet: no cost on it', !/cost|margin|labor/i.test(sheetText))
  await shot(page, '2-sign-sheet')
  await page.locator('[data-co-sign-name]').fill('Pat Customer')
  // The sheet is taller than the phone now (Why, the drawing and its note above the box): scroll the box into view first.
  await page.locator('[data-co-sign-sheet] canvas').scrollIntoViewIfNeeded(); await sleep(300)
  const box = await page.locator('[data-co-sign-sheet] canvas').boundingBox()
  await page.mouse.move(box.x + 20, box.y + 40); await page.mouse.down(); for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + 20 + i * 20, box.y + 40 + (i % 2 ? 20 : -10)); await page.mouse.up()
  await page.locator('[data-co-sign-submit]').click()
  const both = await until(async () => (await page.locator('[data-signed-doc-kind="change_order"]').count()) === 2, 10000)
  check('signed in person: both signed PDFs are in Documents at once', both, both ? '' : `${await page.locator('[data-signed-doc-kind="change_order"]').count()} shown; ${(await page.locator('[data-co-sign-sheet]').innerText().catch(() => 'sheet closed')).split('\n').filter(l => /sign|error|refused|could not|try/i.test(l)).slice(-3).join(' / ')}`)
  if (!both) await shot(page, '2b-after-sign')
  const notice2 = await until(async () => { const t = await page.locator('[data-packet-outdated]').innerText(); return /CO-2/.test(t) ? t : null }, 10000)
  check('signed in person: the packet notice names CO-2 and the gate\'s side', !!notice2 && notice2.includes(`walk gate in ${theSide(s2.name)}`), notice2 ?? '')

  // ── 3. CO-3 open; Change order again ──
  const yard3 = { ...yard2, sides: yard2.sides.map(s => (s.id === s1.id ? { ...s, lengthIn: s.lengthIn + 60 } : s)) }
  const co3 = (await call('POST', '/api/change-orders', { jobId: X.jobId, reason: 'A bit more', lines: [{ id: 'r4c', description: 'Add 5 ft of fence', amountCents: 20000 }], work: { request: request({ walkGates: (tpl.walkGates || 0) + 1 }), layout: { ...tpl.layout, yard: yard3 }, planSvg: SVG } })).json.data
  // A new tab (a long WebKit session can crash when a page is loaded over it again).
  await page.close()
  page = await ctx.newPage()
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)))
  page.on('dialog', d => d.accept().catch(() => {}))
  await page.goto(`${APP}/operations?job=${X.jobId}`)
  await page.waitForSelector(`[data-co-button="${X.quoteId}"]`, { timeout: 30000 })
  await page.locator(`[data-co-button="${X.quoteId}"]`).click()
  const note = await until(async () => { const t = await page.locator('[data-co-open-in-drawing]').innerText(); return t || null }, 20000)
  check('change order editor: says its drawing includes CO-3, not signed yet', !!note && /This drawing includes CO-3 \(.+\), not signed yet/.test(note), note ?? '')
  await shot(page, '3-editor-note')
  const grip = page.locator('[data-plan-gate-grip]').first()
  if (await grip.count()) await grip.click({ force: true }).catch(() => {})
  await sleep(600)
  const body = await page.locator('[data-quote-builder]').innerText()
  check('change order editor: never says "Signed: make a change order"', !/Signed: make a change order/.test(body), (body.match(/Gates stay[^\n]*/) ?? [''])[0])
  await call('PATCH', `/api/change-orders/${co3.id}`, { baseVersion: co3.version, status: 'void' })

  // ── 4. The crew packet ──
  const staffPk = (await call('GET', `/api/install-packets?jobId=${X.jobId}`)).json.data
  const crew = (await call('GET', `/p/i/${staffPk.token}`, undefined, '')).text
  check('crew packet: the gate by its side', crew.includes(`added a walk gate in ${theSide(s2.name)}`) && !/added a walk gate and removed/.test(crew))
  // Runs by side name: tests/changeOrderFlow.db.test.ts (this set up prices the change orders from the signed runs,
  // so their runs do not match the drawing and the packet rightly keeps "Run 1").
  await ctx.close()

  // ── 5. The salesman's sold quote; the office's walk-in ──
  const sctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await signInByCookie(sctx, { cookie: '', email: '', password: '', token: SALES, api: API })
  const sp = await sctx.newPage()
  sp.on('pageerror', e => errors.push(String(e).slice(0, 200)))
  await sp.goto(`${APP}/quotes?qv=${X.quoteId}`)
  const drawer = await until(async () => (await sp.locator('[data-quote-drawer]').count()) > 0, 30000)
  await sleep(800)
  check('salesman: her Sold quote opens, with no Mark Lost', drawer && (await sp.getByText('Mark Lost', { exact: true }).count()) === 0)
  await shot(sp, '5-sales-sold-quote')
  await sctx.close()
  const octx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await signInByCookie(octx, { cookie: '', email: '', password: '', token: OWNER, api: API })
  const op = await octx.newPage()
  op.on('pageerror', e => errors.push(String(e).slice(0, 200)))
  await op.goto(`${APP}/customers/new`)
  await op.locator('[data-customer-field="first-name"]').waitFor({ timeout: 30000 })
  await op.locator('[data-customer-field="first-name"]').fill('E2E')
  await op.locator('[data-customer-field="last-name"]').fill(walkInLast)
  await op.locator('[data-lead-source-choice="Walk-in"]').first().click()
  await op.locator('[data-customer-save]').click()
  const last = await until(async () => { const t = await op.locator('[data-customer-summary-item="last-contact"]').innerText(); return /None|…/.test(t) ? null : t }, 15000)
  check('office: a walk-in just saved shows Last contact without a reload', !!last, (last ?? '').replace(/\s+/g, ' '))
  await shot(op, '5-walkin')
  await octx.close()
  check('no page errors', errors.length === 0, errors.join(' | '))
} catch (e) {
  check('ran to the end', false, String(e?.stack ?? e).slice(0, 400))
} finally {
  await browser.close()
  // Clean up what was made.
  const walkIn = sql(`SELECT id FROM "CrmContact" WHERE "lastName" = '${walkInLast}'`).split('\n').filter(Boolean)
  const jobs = `'${X.jobId}'`
  try {
    sql(`DELETE FROM "SignedDocument" WHERE "quoteId" = '${X.quoteId}'`)
    sql(`DELETE FROM "CrmAuditLog" WHERE "entityId" IN (SELECT id FROM "ChangeOrder" WHERE "quoteId" = '${X.quoteId}') OR "entityId" IN (${jobs}, '${X.quoteId}', '${X.contactId}'${walkIn.map(i => `, '${i}'`).join('')})`)
    sql(`DELETE FROM "ChangeOrder" WHERE "quoteId" = '${X.quoteId}'`)
    sql(`DELETE FROM "Notification" WHERE "jobId" IN (${jobs})`)
    sql(`DELETE FROM "InstallPacket" WHERE "jobId" IN (${jobs})`)
    sql(`DELETE FROM "PaymentApplication" WHERE "paymentId" IN (SELECT id FROM "ContractPayment" WHERE "jobId" IN (${jobs}))`)
    for (const t of ['ContractPayment', 'ContractInvoice', 'BillingLog', 'PaymentSchedule', 'JobChecklistItem']) { try { sql(`DELETE FROM "${t}" WHERE "jobId" IN (${jobs})`) } catch { /* no such table or column */ } }
    sql(`DELETE FROM "AutomationEvent" WHERE "entityId" IN (${jobs}, '${X.quoteId}', '${X.cardId}', '${X.contactId}'${walkIn.map(i => `, '${i}'`).join('')})`)
    sql(`DELETE FROM "SavedJob" WHERE id IN (${jobs})`)
    sql(`DELETE FROM "JobQuotedCost" WHERE "quoteId" = '${X.quoteId}'`)
    sql(`DELETE FROM "SavedQuote" WHERE id = '${X.quoteId}'`)
    const pl = (await call('GET', '/api/pipeline')).json
    const ids = [X.contactId, ...walkIn]
    const cards = (pl?.data?.leads ?? []).filter(l => ids.includes(l.customerId) || l.id === X.cardId).map(l => l.id)
    if (cards.length) await call('PATCH', '/api/pipeline', { upsert: [], remove: cards, baseVersion: pl.data.version })
    for (const id of ids) { await call('DELETE', `/api/crm-contacts/${id}`); sql(`DELETE FROM "CrmContact" WHERE id = '${id}'`) }
    check('cleaned up (change orders, documents, packet, job, quote, customers, cards)', sql(`SELECT count(*) FROM "ChangeOrder" WHERE "quoteId" = '${X.quoteId}'`) === '0' && sql(`SELECT count(*) FROM "CrmContact" WHERE id IN (${ids.map(i => `'${i}'`).join(', ')})`) === '0')
  } catch (e) { console.log('cleanup:', String(e).slice(0, 300)) }
  await removeTestLogin(salesLogin, { ownerToken: OWNER, api: API })
  const failed = results.filter(r => !r).length
  console.log(`\n${results.length - failed}/${results.length} passed`)
  process.exit(failed ? 1 : 0)
}
