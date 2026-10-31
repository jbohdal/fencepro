// Sliding a gate along its side in the quote builder's yard drawing, on the
// dev copy (4001 serves the built app: run `pnpm -s build` in apps/web first).
//
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 E2E_ACCESS_TOKEN=<dev owner token> \
//   [BROWSER=webkit|chromium] [SHOTS=<folder>] node e2e/gate-slide.mjs
//   WebKit (default): a 390 x 844 phone, the finger as touch pointer events.
//   BROWSER=chromium: a computer, the mouse.
//   Android emulator: adb reverse tcp:4001 tcp:4001; adb forward tcp:9333 localabstract:chrome_devtools_remote;
//   CDP_URL=http://localhost:9333 node e2e/gate-slide.mjs   (a real touch through Chrome's own input)
//
// A backyard (20, 60, 48, 60, 20 ft) with a 5 ft walk gate in the middle of
// the 48 ft Back. Drag the gate toward the Left side corner: the live label
// "12 ft ← [5 ft gate] → 31 ft" and both pieces' sections (8 ft panels, each
// piece rounded up), whole feet; the price is the price of that layout priced
// fresh (the gate typed at that spot on a second quote), the footage never
// changes. Tap a distance and type it; a 6 ft gate keeps its middle. Save,
// reopen: same spot, same price. The proposal and the crew packet show both
// distances. Signed: the drag is refused ("Signed: make a change order") and
// the server refuses a moved gate. Everything made is removed (ezbiz_dev only).

import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import './sharedLock.mjs' // makes a customer, quotes and a job: takes turns with the other tests that change shared data
import { webkit, chromium } from 'playwright'
import { execFileSync } from 'child_process'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || 'http://localhost:4001'
const TOKEN = process.env.E2E_ACCESS_TOKEN || ''
const SHOTS = process.env.SHOTS || ''
const CDP = process.env.CDP_URL || ''
const ENGINE = CDP ? 'android' : process.env.BROWSER === 'chromium' ? 'chromium' : 'webkit'
const devLocal = u => /^http:\/\/localhost:\d+\/?$/.test(u) && !/:4000\b/.test(u)
if (!devLocal(APP) || !devLocal(API)) { console.error('Refusing to run: the dev copy only.'); process.exit(2) }
if (!TOKEN) { console.error('Set E2E_ACCESS_TOKEN.'); process.exit(2) }
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  [${ENGINE}] ${name}${detail ? '  -- ' + detail : ''}`) }
const sql = q => execFileSync('psql', ['-d', 'ezbiz_dev', '-At', '-c', q]).toString().trim()
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
const cents = text => { const m = String(text).match(/\$\s?([\d,]+(?:\.\d{2})?)/); return m ? Math.round(parseFloat(m[1].replace(/,/g, '')) * 100) : NaN }
const shot = async (page, name, loc) => { if (SHOTS) await (loc ?? page).screenshot({ path: path.join(SHOTS, name) }).catch(() => {}) }

const STYLE = "WV-ND 6'x8' Privacy"   // 8 ft panels
const PANEL_FT = 8
const secs = inches => (inches > 0 ? Math.ceil(inches / 12 / PANEL_FT - 1e-9) : 0)
const stamp = Date.now().toString(36).slice(-5)
const NAME = `E2E Gate Slide ${ENGINE} ${stamp}`
const contactId = crypto.randomUUID(), quoteId = crypto.randomUUID(), freshId = crypto.randomUUID(), jobId = crypto.randomUUID()

const BACK_FT = 48
const side = (name, L, s, e, h, extra = {}) => ({ id: `gs-${name.replace(/\s/g, '').toLowerCase()}`, name, on: true, lengthIn: L * 12, startFinish: s, endFinish: e, gate: null, skip: null, heading: h, ...extra })
const yardWith = gate => ({ shape: 'backyard', closed: false, sides: [
  side('Left return', 20, 'house', 'corner', 180),
  side('Left side', 60, 'corner', 'corner', 90),
  side('Back', BACK_FT, 'corner', 'corner', 0, { gate }),
  side('Right side', 60, 'corner', 'corner', 270),
  side('Right return', 20, 'corner', 'house', 180),
] })

const browser = CDP ? await chromium.connectOverCDP(CDP) : await (ENGINE === 'chromium' ? chromium : webkit).launch()
// The office (sending the crew packet) on a computer.
const desk = ENGINE === 'chromium' ? browser : await chromium.launch()
const phone = ENGINE !== 'chromium'

async function session() {
  const ctx = CDP ? browser.contexts()[0] : await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } })
  await ctx.addInitScript(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, TOKEN)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 300)))
  page.on('dialog', d => d.accept().catch(() => {}))
  await page.route('**/api/automations/trigger', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' }))
  const cdp = CDP ? await ctx.newCDPSession(page) : null
  return { ctx, page, errors, cdp }
}

/** The builder opened again in a new tab (Playwright's WebKit crashes a page sent to a new address from a builder that was typed in; a real phone does not). */
async function reopenTab(s) {
  if (!CDP) {
    const page = await s.ctx.newPage()
    page.on('pageerror', e => s.errors.push(String(e).slice(0, 300)))
    page.on('dialog', d => d.accept().catch(() => {}))
    await page.route('**/api/automations/trigger', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' }))
    await s.page.close({ runBeforeUnload: false }).catch(() => {})
    s.page = page
  }
  return s.page
}

async function openQuote(page, id) {
  await page.goto(`${APP}/?quote=${id}`)
  await page.waitForSelector('[data-quote-builder] [data-bar-price]', { timeout: 30000 })
  await page.locator('[data-quote-builder] [data-step="yard"]').click()
  await page.waitForSelector('[data-plan-wrap] svg[data-site-plan]', { timeout: 30000 }); await sleep(1200)
}
const barPrice = async page => cents(await page.locator('[data-bar-price]').first().innerText())
const footage = async page => Number(((await page.locator('[data-quote-bar]').first().innerText()).match(/([\d.]+) ft ·/) || [])[1])
const gateDist = async page => {
  const el = page.locator('[data-side="Back"] [data-gate-distances]')
  return { before: Number(await el.getAttribute('data-before-in')), after: Number(await el.getAttribute('data-after-in')) }
}
async function openBack(page) {
  if ((await page.locator('[data-side="Back"][data-side-open="true"]').count()) === 0) await page.locator('[data-side-row="Back"]').click()
  await page.waitForSelector('[data-side="Back"] [data-gate-distances]', { timeout: 10000 })
}

/** The Back side and its gate grip on screen (viewport pixels). */
async function geometry(page) {
  await page.locator('[data-plan-wrap]').scrollIntoViewIfNeeded(); await sleep(300)
  // The gate in the middle of the screen (a phone shows only part of the plan under the header).
  await page.evaluate(() => document.querySelector('[data-plan-gate-grip="Back"] circle')?.scrollIntoView({ block: 'center' })); await sleep(500)
  return page.evaluate(() => {
    const svg = document.querySelector('[data-plan-wrap] svg[data-site-plan]')
    const ln = svg.querySelector('[data-plan-side="Back"]')
    const m = svg.getScreenCTM()
    const P = (x, y) => { const p = svg.createSVGPoint(); p.x = x; p.y = y; const q = p.matrixTransform(m); return { x: q.x, y: q.y } }
    const a = P(+ln.getAttribute('x1'), +ln.getAttribute('y1')), b = P(+ln.getAttribute('x2'), +ln.getAttribute('y2'))
    const g = svg.querySelector('[data-plan-gate-grip="Back"]')
    const r = g.querySelector('circle').getBoundingClientRect()
    return { a, b, grip: { x: r.x + r.width / 2, y: r.y + r.height / 2 }, startIn: Number(g.getAttribute('data-gate-start-in')), locked: g.getAttribute('data-gate-locked') === 'true' }
  })
}

/** Drag from → to: a mouse on a computer, a real touch on Android, touch pointer events in WebKit. `mid` runs while still held. */
async function drag(s, from, to, mid) {
  const { page, cdp } = s
  const steps = 12
  const at = k => ({ x: Math.round(from.x + (to.x - from.x) * k / steps), y: Math.round(from.y + (to.y - from.y) * k / steps) })
  if (cdp) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: Math.round(from.x), y: Math.round(from.y), id: 1 }] })
    for (let k = 1; k <= steps; k++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...at(k), id: 1 }] }); await sleep(40) }
    await sleep(300); if (mid) await mid()
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  } else if (!phone) {
    await page.mouse.move(from.x, from.y); await page.mouse.down()
    for (let k = 1; k <= steps; k++) { const p = at(k); await page.mouse.move(p.x, p.y); await sleep(30) }
    await sleep(300); if (mid) await mid()
    await page.mouse.up()
  } else {
    // WebKit has no touch move in Playwright: the same pointer events a finger makes, pointerType "touch".
    const fire = (type, p) => page.evaluate(({ type, p }) => {
      const w = window
      const target = type === 'pointerdown' ? document.elementFromPoint(p.x, p.y) : (w.__gateTarget || document.elementFromPoint(p.x, p.y))
      if (type === 'pointerdown') w.__gateTarget = target
      target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, pointerId: 31, pointerType: 'touch', isPrimary: true, clientX: p.x, clientY: p.y, button: 0, buttons: type === 'pointerup' ? 0 : 1 }))
      if (type === 'pointerup') { target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y })); w.__gateTarget = null }
    }, { type, p })
    await fire('pointerdown', from)
    for (let k = 1; k <= steps; k++) { await fire('pointermove', at(k)); await sleep(30) }
    await sleep(300); if (mid) await mid()
    await fire('pointerup', to)
  }
  await sleep(700)
}

let s = null
try {
  // ── Set up: a customer and a draft quote with the yard; the builder prices it as it opens ──
  const yard0 = yardWith({ type: 'walk', widthIn: 60, position: 'middle' })
  const c = await call('POST', '/api/crm-contacts', { id: contactId, firstName: 'E2E', lastName: `Gate Slide ${ENGINE} ${stamp}`, phone: '3525550177', email: 'e2e-gate-slide@example.invalid', leadSource: 'Other' })
  const base = {
    crmContactId: contactId, customerName: NAME, customerPhone: '3525550177', customerEmail: 'e2e-gate-slide@example.invalid', customerAddress: '1 Gate Slide Way, Ocala, FL 34470',
    leadSource: 'Other', salesRep: 'E2E', date: '2026-10-20', status: 'DRAFT', fenceStyle: STYLE,
    runs: [20, 60, 21.5, 21.5, 60, 20], corners: 4, ends: 4, walkGates: 1, dblGates: 0, tearOutSections: 0, tearOutGates: 0, adjLaborHrs: 0, hasSalesman: false, priceAdjust: 0,
    sections: 27, materialCost: 1, laborCost: 1, tearOutCost: 0, totalCOGS: 2, finalPrice: 10, gmPct: 0.5, pullSheet: [],
  }
  const q1 = await call('POST', '/api/saved-quotes', { id: quoteId, ...base, layout: { yard: yard0, runSections: [3, 8, 3, 3, 8, 3] } })
  check('set up: a customer and a draft quote with a 5 ft gate in the middle of the 48 ft Back', c.status < 300 && q1.status < 300, `${c.status} ${q1.status} ${q1.json.error ?? ''}`)

  s = await session()
  let page = s.page
  await openQuote(page, quoteId)
  await openBack(page)
  const ft0 = await footage(page), price0 = await barPrice(page)
  const d0 = await gateDist(page)
  check('opens with the gate in the middle: 21.5 ft each side, both distances in the side panel', d0.before === 258 && d0.after === 258 && /21\.5 ft from the Left side corner, 21\.5 ft to the Right side corner/.test(await page.locator('[data-side="Back"] [data-gate-where]').innerText()),
    `${d0.before} / ${d0.after}: ${await page.locator('[data-side="Back"] [data-gate-where]').innerText()}`)

  // ── Drag the gate toward the Left side corner, to about 12 ft ──
  let g = await geometry(page)
  const len = Math.hypot(g.b.x - g.a.x, g.b.y - g.a.y), u = { x: (g.b.x - g.a.x) / len, y: (g.b.y - g.a.y) / len }, pxPerFt = len / BACK_FT
  const moveFt = 12 - g.startIn / 12
  let live = null
  await drag(s, g.grip, { x: g.grip.x + u.x * moveFt * pxPerFt, y: g.grip.y + u.y * moveFt * pxPerFt }, async () => {
    const el = page.locator('[data-gate-live]')
    live = (await el.count()) ? {
      text: await el.locator('[data-gate-live-text]').textContent(), sections: await el.locator('[data-gate-live-sections]').textContent(),
      before: Number(await el.getAttribute('data-before-in')), after: Number(await el.getAttribute('data-after-in')),
      bs: Number(await el.getAttribute('data-before-sections')), as: Number(await el.getAttribute('data-after-sections')),
      loupe: await page.locator('[data-plan-loupe]').count(), priceLive: await barPrice(page),
    } : null
    await shot(page, phone ? (CDP ? 'dev-gate-slide-android.png' : 'dev-gate-slide-builder-phone.png') : 'dev-gate-slide-builder-desktop.png', phone ? page : page.locator('[data-layout-editor]'))
  })
  check('while dragging: "12 ft ← [5 ft gate] → 31 ft" style distances show live, in whole feet, adding up to the side',
    !!live && /^\d+ ft ← \[5 ft gate\] → \d+ ft$/.test(live.text) && live.before % 12 === 0 && live.before + 60 + live.after === BACK_FT * 12 && Math.abs(live.before - 144) <= 24, JSON.stringify(live))
  check('while dragging: both pieces\' section counts (each piece rounded up on its own)', !!live && live.bs === secs(live.before) && live.as === secs(live.after) && live.sections.includes(`${live.bs} section`) && live.sections.includes(`${live.as} section`), live ? `${live.sections}` : 'no label')
  if (phone) check('while dragging with a finger: the magnifier shows', !!live && live.loupe === 1)
  const d1 = await gateDist(page)
  check('let go: the gate stays where it was dropped, on the line, whole feet', live && d1.before === live.before && d1.after === live.after, `${d1.before} / ${d1.after}`)
  const runsText = (await page.locator('[data-side="Back"] [data-side-runs]').innerText()).replace(/\s+/g, ' ')
  check('the Back\'s two pieces price as their own runs, sections per piece', runsText.includes(`= ${secs(d1.before)} section`) && runsText.includes(`= ${secs(d1.after)} section`), runsText)
  const ft1 = await footage(page), price1 = await barPrice(page)
  check('footage unchanged by the move', ft1 === ft0 && ft0 === 203, `${ft0} -> ${ft1}`)
  check('the price updated live, while dragging', !!live && live.priceLive === price1, `${live?.priceLive} vs ${price1}`)

  // The same layout priced fresh: a second quote with the gate typed at that spot, opened in the builder.
  const q2 = await call('POST', '/api/saved-quotes', { id: freshId, ...base, customerName: `${NAME} fresh`, layout: { yard: yardWith({ type: 'walk', widthIn: 60, position: 'distance', distanceIn: d1.before }), runSections: [] } })
  {
    const s2 = await session()
    await openQuote(s2.page, freshId)
    const fresh = await barPrice(s2.page), freshFt = await footage(s2.page)
    check('the price is the price of that layout priced fresh (the gate typed there), same footage', q2.status < 300 && fresh === price1 && freshFt === ft1, `${price1} vs fresh ${fresh} (${freshFt} ft)`)
    if (!CDP) await s2.ctx.close(); else await s2.page.close()
  }

  // ── Tap a distance and type it ──
  await page.locator('[data-side="Back"] [data-gate-before]').click()
  for (const k of ['1', '0']) await page.locator(`[data-ftin-pad] [data-pad-key="${k}"]`).click()
  await page.locator('[data-ftin-pad] [data-pad-done]').click(); await sleep(500)
  let d = await gateDist(page)
  check('typed in the side panel: "10 ft from the Left side corner"', d.before === 120 && d.after === 396, `${d.before} / ${d.after}`)
  await page.locator('[data-side="Back"] [data-gate-after]').click()
  for (const k of ['3', '0']) await page.locator(`[data-ftin-pad] [data-pad-key="${k}"]`).click()
  await page.locator('[data-ftin-pad] [data-pad-done]').click(); await sleep(500)
  d = await gateDist(page)
  check('typed from the far end: "30 ft to the Right side corner" (13 ft from the left)', d.after === 360 && d.before === 156, `${d.before} / ${d.after}`)
  // On the drawing: tap the piece's length next to the gate.
  await page.locator('[data-plan-wrap]').scrollIntoViewIfNeeded()
  // In the middle of the screen (on a phone the top of the plan is under the builder's header).
  await page.evaluate(() => document.querySelector('[data-gate-distance-tap="before"]')?.scrollIntoView({ block: 'center' })); await sleep(500)
  await page.locator('[data-gate-distance-tap="before"]').first().click(); await sleep(400)
  const padOpen = await page.locator('[data-ftin-pad]').count()
  if (padOpen) {
    for (const k of ['1', '2']) await page.locator(`[data-ftin-pad] [data-pad-key="${k}"]`).click()
    await page.locator('[data-ftin-pad] [data-pad-done]').click(); await sleep(500)
  }
  d = await gateDist(page)
  check('tapping the distance on the drawing types it: 12 ft', padOpen === 1 && d.before === 144 && d.after === 372, `${padOpen} pad, ${d.before} / ${d.after}`)
  check('footage still unchanged after typing', await footage(page) === ft0)

  // ── A 6 ft gate keeps its middle ──
  const mid0 = d.before + 30
  await openBack(page)
  if ((await page.locator('[data-side="Back"] [data-side-options]').count()) === 0) await page.locator('[data-side="Back"] [data-side-more]').click()
  await page.locator('[data-side="Back"] [data-gate-size="6"]').click(); await sleep(500)
  d = await gateDist(page)
  check('a 6 ft gate keeps its middle where it was and updates both distances', d.before + 36 === mid0 && d.before + 72 + d.after === BACK_FT * 12, `${d.before} / ${d.after}, middle ${d.before + 36} (was ${mid0})`)
  const where = (await page.locator('[data-side="Back"] [data-gate-where]').innerText()).trim()
  check('the side panel says it both ways: "6 ft walk gate, 11.5 ft from the Left side corner, 30.5 ft to the Right side corner"', where === '6 ft walk gate, 11.5 ft from the Left side corner, 30.5 ft to the Right side corner', where)
  check('the width change takes its 1 ft from the fence (203 → 202 ft of fence, the yard the same)', await footage(page) === ft0 - 1, String(await footage(page)))
  const priceSaved = await barPrice(page)

  // ── Save, reopen: same spot, same price ──
  await page.locator('[data-quote-builder] [data-step="price"]').click(); await sleep(500)
  await page.locator('[data-save-open]').first().click()
  await page.waitForSelector('[data-save-submit]', { timeout: 10000 })
  await page.locator('[data-save-submit]').click(); await sleep(3000)
  const saved = (await call('GET', `/api/saved-quotes/${quoteId}`)).json.data
  const sg = saved?.layout?.yard?.sides?.find(x => x.name === 'Back')?.gate
  check('saved in the layout as the builder reads it (distance from the start), at the builder\'s price', sg?.position === 'distance' && sg.distanceIn === 138 && sg.widthIn === 72 && Math.round(saved.finalPrice * 100) === priceSaved, `${JSON.stringify(sg)} ${saved?.finalPrice}`)
  page = await reopenTab(s)
  await openQuote(page, quoteId)
  await openBack(page)
  d = await gateDist(page)
  const priceAgain = await barPrice(page)
  check('reopened: the same position and the same price', d.before === 138 && d.after === 366 && priceAgain === priceSaved, `${d.before} / ${d.after}, ${priceAgain} vs ${priceSaved}`)
  await page.locator('[data-quote-close]').click().catch(() => {}); await sleep(500)

  // ── The proposal: the drawing carries both distances ──
  const tok = (await call('POST', `/api/saved-quotes/${quoteId}/share-token`)).json.data?.shareToken
  {
    const pp = await (await desk.newContext({ viewport: { width: 1000, height: 900 } })).newPage()
    if (tok) await pp.goto(`${API}/p/${tok}`); await sleep(1500)
    const svgText = tok ? (await pp.locator('svg').evaluateAll(els => els.map(e => e.textContent).join(' | '))) : ''
    check('proposal drawing: the gate and both pieces either side of it (11\' 6", 6\' walk gate, 30\' 6")', svgText.includes("6' walk gate") && svgText.includes(`11' 6"`) && svgText.includes(`30' 6"`), tok ? svgText.slice(0, 200) : 'no link')
    if (tok && ENGINE === 'chromium') {
      const plan = pp.locator('svg:has-text("walk gate")').first()
      if (await plan.count()) { await plan.scrollIntoViewIfNeeded(); await sleep(300) }
      await shot(pp, 'dev-gate-slide-proposal.png')
    }
    await pp.context().close()
  }

  // ── The crew packet: the drawing and the words, both ways ──
  const j = await call('POST', '/api/saved-jobs', { id: jobId, quoteId, crmContactId: contactId, status: 'scheduled', customerName: NAME, customerPhone: '3525550177', customerAddress: '1 Gate Slide Way, Ocala, FL 34470', fenceStyle: STYLE, sections: saved.sections, totalFeet: 202, walkGates: 1, scheduledDate: '2026-10-27', crewAssigned: 'Crew A', quotePrice: saved.finalPrice, contractValue: saved.finalPrice })
  {
    const ctx = await desk.newContext({ viewport: { width: 1440, height: 1000 } })
    await ctx.addInitScript(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, TOKEN)
    const op = await ctx.newPage()
    op.on('dialog', dd => dd.accept().catch(() => {}))
    await op.goto(`${APP}/operations?job=${jobId}`)
    await op.waitForSelector('[data-packet-send]', { timeout: 30000 }); await sleep(800)
    await op.locator('[data-packet-send]').click(); await sleep(2500)
    const url = (await op.locator('[data-packet-url]').textContent().catch(() => '')).trim()
    const ptok = url.split('/p/i/')[1]
    const cp = await ctx.newPage()
    await cp.setViewportSize({ width: 412, height: 915 })
    if (ptok) await cp.goto(`${API}/p/i/${ptok}`); await sleep(1500)
    const text = ptok ? (await cp.locator('body').textContent()).replace(/\s+/g, ' ') : ''
    check('crew packet words: "Back: 6 ft walk gate, 11.5 ft from the Left side corner, 30.5 ft to the Right side corner"', j.status < 300 && text.includes('Back: 6 ft walk gate, 11.5 ft from the Left side corner, 30.5 ft to the Right side corner'), (text.match(/Gates.{0,200}/) || [url])[0])
    const planText = ptok ? await cp.locator('.plan svg').first().textContent().catch(() => '') : ''
    check('crew packet drawing: both pieces either side of the gate', planText.includes("6' walk gate") && planText.includes(`11' 6"`) && planText.includes(`30' 6"`), planText.slice(0, 160))
    if (ENGINE === 'chromium' && ptok) {
      const gates = cp.locator('h3:text-is("Gates")')
      if (await gates.count()) await gates.scrollIntoViewIfNeeded()
      await shot(cp, 'dev-gate-slide-crew-packet.png')
    }
    await ctx.close()
  }

  // ── Signed: the drag is refused, and so is a moved gate sent to the server ──
  const sold = await call('PATCH', `/api/saved-quotes/${quoteId}`, { status: 'SOLD' })
  page = await reopenTab(s)
  await openQuote(page, quoteId)
  await openBack(page)
  g = await geometry(page)
  const priceSigned = await barPrice(page)
  let lockText = ''
  await drag(s, g.grip, { x: g.grip.x - u.x * 6 * pxPerFt, y: g.grip.y - u.y * 6 * pxPerFt }, async () => {
    lockText = (await page.locator('[data-plan-live-label]').textContent().catch(() => '')) || ''
  })
  const g2 = await geometry(page)
  d = await gateDist(page)
  check('signed: the drag is refused, "Signed: make a change order"', sold.status < 300 && g.locked && lockText.includes('Signed: make a change order') && g2.startIn === 138 && d.before === 138, `${sold.status} locked=${g.locked} "${lockText}" start ${g2.startIn}`)
  check('signed: the distances cannot be typed either', await page.locator('[data-side="Back"] [data-gate-before]').isDisabled() && (await page.locator('[data-side="Back"] [data-gate-move-hint]').innerText()).includes('Signed: make a change order'))
  check('signed: the price did not move', await barPrice(page) === priceSigned && priceSigned === priceSaved, `${priceSigned} vs ${priceSaved}`)
  const moved = JSON.parse(JSON.stringify(saved.layout))
  moved.yard.sides.find(x => x.name === 'Back').gate.distanceIn = 60
  const refused = await call('PATCH', `/api/saved-quotes/${quoteId}`, { layout: moved })
  const after = (await call('GET', `/api/saved-quotes/${quoteId}`)).json.data
  check('signed: the server refuses a moved gate (409, make a change order) and keeps it where it was', refused.status === 409 && after.layout.yard.sides.find(x => x.name === 'Back').gate.distanceIn === 138, `${refused.status} ${refused.json.error ?? ''}`)
  check('no page errors', s.errors.length === 0, s.errors.join(' | '))
} catch (e) {
  check('ran to the end', false, String(e?.stack || e).slice(0, 600))
} finally {
  const quotes = `'${quoteId}', '${freshId}'`
  try {
    sql(`DELETE FROM "InstallPacket" WHERE "jobId" = '${jobId}'`)
  } catch { /* named differently: removed with the job below */ }
  sql(`DELETE FROM "JobQuotedCost" WHERE "quoteId" IN (${quotes})`)
  sql(`DELETE FROM "AutomationEvent" WHERE "entityId" IN ('${jobId}', ${quotes}, '${contactId}')`)
  sql(`DELETE FROM "JobChecklistItem" WHERE "jobId" = '${jobId}'`)
  sql(`DELETE FROM "SavedJob" WHERE id = '${jobId}' OR "quoteId" IN (${quotes})`)
  sql(`DELETE FROM "SavedQuote" WHERE id IN (${quotes})`)
  sql(`DELETE FROM "CrmAuditLog" WHERE "entityId" IN ('${jobId}', ${quotes}, '${contactId}')`)
  sql(`UPDATE "BusinessState" SET "pullSheets" = COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements("pullSheets") e WHERE COALESCE(e->>'quoteId', '') NOT IN (${quotes})), '[]'::jsonb), version = version + 1 WHERE "pullSheets"::text LIKE '%${quoteId}%'`)
  sql(`DELETE FROM "CrmContact" WHERE id = '${contactId}'`)
  const left = Number(sql(`SELECT (SELECT count(*) FROM "SavedQuote" WHERE id IN (${quotes})) + (SELECT count(*) FROM "SavedJob" WHERE id = '${jobId}') + (SELECT count(*) FROM "CrmContact" WHERE id = '${contactId}')`))
  check('cleaned up (quotes, job, customer)', left === 0, `${left} left`)
  if (s && !CDP) await s.ctx.close().catch(() => {})
  if (s && CDP) await s.page.close().catch(() => {})
  if (desk !== browser) await desk.close()
  await browser.close()
  const failed = results.filter(r => !r).length
  console.log(`\n${results.length - failed} of ${results.length} checks passed`)
  process.exit(failed ? 1 : 0)
}
