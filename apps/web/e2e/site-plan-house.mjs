// Site plan: slide the house, drag one return's meeting point, reset; a label
// on every piece of a split side (no overlaps); gate swing and hinge on the
// plan, in More options and on the install packet; the proposal plan. The
// price never changes. Phone (390x844, real touch) and desktop.
//
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 \
//   E2E_ACCESS_TOKEN=<dev staff token> SHOTS=<folder, optional> node e2e/site-plan-house.mjs
//
// Makes quotes (and one sold job for the install packet), then deletes them.

import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import { chromium } from 'playwright'

const APP = process.env.APP_URL || 'http://localhost:5173'
const API = process.env.API_URL || 'http://localhost:4001'
const TOKEN = process.env.E2E_ACCESS_TOKEN || ''
const SHOTS = process.env.SHOTS || ''
const local = u => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(u)
if (!local(APP) || !local(API) || /:4000(\/|$)/.test(API)) { console.error('Refusing to run: the dev copy only (localhost, not port 4000).'); process.exit(2) }
if (!TOKEN) { console.error('Set E2E_ACCESS_TOKEN.'); process.exit(2) }

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const api = async (p, init = {}) => {
  const r = await fetch(API + p, { ...init, headers: { Authorization: `Bearer ${TOKEN}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) } })
  const j = await r.json().catch(() => ({}))
  return j.data ?? j
}

const side = (id, name, ft, s, e, h, extra = {}) => ({ id, name, on: true, lengthIn: ft * 12, startFinish: s, endFinish: e, gate: null, skip: null, heading: h, ...extra })
const yard = (extra = {}, lens = {}) => ({ shape: 'backyard', closed: false, sides: [
  side('a', 'Left return', lens.a ?? 30, 'house', 'corner', 180, extra.a), side('b', 'Left side', 120, 'corner', 'corner', 90),
  side('c', 'Back', 150, 'corner', 'corner', 0), side('d', 'Right side', 100, 'corner', 'corner', 270),
  side('e', 'Right return', lens.e ?? 30, 'corner', 'house', 180, extra.e),
] })
const made = []
let jobId = null
async function quote(name, y, extra = {}) {
  const runs = y.sides.map(s => s.lengthIn / 12)
  const q = await api('/api/saved-quotes', { method: 'POST', body: JSON.stringify({
    customerName: name, fenceStyle: "WV-ND 6'x8' Privacy", runs, corners: 4, ends: 2, sections: 0, status: 'DRAFT', finalPrice: 0,
    date: new Date().toISOString().slice(0, 10), layout: { yard: y, runSections: [] }, ...extra,
  }) })
  made.push(q.id)
  return q.id
}

/** Every label's box on the drawing (SVG units), and whether any two overlap or one sits on the house. */
const labelCheck = svgSel => page => page.locator(svgSel).first().evaluate(svg => {
  const boxes = [...svg.querySelectorAll('[data-plan-text] text')].map(t => { const b = t.getBBox(); return { t: t.textContent, x0: b.x, y0: b.y, x1: b.x + b.width, y1: b.y + b.height } })
  const hit = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1
  const bad = []
  // Lines of one side label (length, then name) are one block; compare blocks of different labels.
  const groups = [...svg.querySelectorAll('[data-plan-text]')].map(g => [...g.querySelectorAll('text')].map(t => { const b = t.getBBox(); return { t: t.textContent, x0: b.x, y0: b.y, x1: b.x + b.width, y1: b.y + b.height } }))
  for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) for (const a of groups[i]) for (const b of groups[j]) if (hit(a, b)) bad.push(`${a.t} / ${b.t}`)
  const house = svg.querySelector('[data-plan-house]') || svg.querySelector('polygon')
  if (house) { const h = house.getBBox(); const hb = { x0: h.x, y0: h.y, x1: h.x + h.width, y1: h.y + h.height }; for (const a of boxes) if (a.t !== 'House' && hit(a, hb)) bad.push(`${a.t} on the house`) }
  const pieces = [...svg.querySelectorAll('[data-plan-piece]')].map(t => ({ side: t.getAttribute('data-plan-piece'), kind: t.getAttribute('data-piece-kind'), text: t.textContent, x: t.getBBox().x }))
  return { bad, pieces, labels: boxes.map(b => b.t) }
})
const planChecks = labelCheck('[data-plan-wrap] svg[data-site-plan]')

const browser = await chromium.launch()
try {
  // ── Phone, with a finger ─────────────────────────────────────────────────────
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await ctx.addInitScript(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, TOKEN)
  const page = await ctx.newPage()
  const cdp = await ctx.newCDPSession(page)
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 300)))
  page.on('dialog', d => d.accept())
  const openQuote = async (p, id) => {
    await p.goto(`${APP}/quotes?quote=${id}`)
    await p.locator('[data-quote-builder] [data-step="yard"]').click({ timeout: 30000 })
    await p.waitForSelector('[data-plan-wrap] svg', { timeout: 30000 }); await sleep(1200)
    await p.locator('[data-plan-wrap]').scrollIntoViewIfNeeded()
  }
  const shot = async (p, name, sel = '[data-plan-wrap]') => { if (SHOTS) await p.locator(sel).first().screenshot({ path: `${SHOTS}/${name}.png` }) }
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] })
  const center = async loc => { const b = await loc.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 } }
  /** Screen pixels per foot: the house is drawn 30 ft deep. */
  // From the drawing's own units (the house's geometry, no stroke) times the drawing's on-screen scale.
  const pxPerFtOf = p => p.locator('[data-plan-wrap] svg[data-site-plan]').evaluate(svg => svg.querySelector('[data-plan-house]').getBBox().height / 30 * (svg.getBoundingClientRect().width / svg.viewBox.baseVal.width))
  const pxPerFt = () => pxPerFtOf(page)
  /** Finger drag in steps; `mid` runs while the finger is still down. */
  async function fingerDrag(loc, dyFt, mid) {
    await sleep(300)
    const dyPx = dyFt * await pxPerFt()
    // Touch points land on whole pixels; at phone size a foot is only a pixel or so.
    const c0 = await center(loc), c = { x: Math.round(c0.x), y: Math.round(c0.y) }, dy = Math.round(dyPx)
    await touch('touchStart', c.x, c.y)
    for (let k = 1; k <= 12; k++) { await touch('touchMove', c.x, c.y + Math.round((dy * k) / 12)); await sleep(25) }
    await sleep(250)
    if (mid) await mid()
    await touch('touchEnd', 0, 0); await sleep(400)
  }
  const prices = async () => (await page.locator('[data-quote-builder]').textContent()).match(/\$[\d,]+(\.\d\d)?/g)?.join() ?? ''
  const moreFor = async name => {
    if (await page.locator(`[data-side="${name}"] [data-side-body]`).count() === 0) { await page.locator(`[data-side-row="${name}"]`).click(); await sleep(250) }
    if (await page.locator(`[data-side="${name}"] [data-side-options]`).count() === 0) { await page.locator(`[data-side="${name}"] [data-side-more]`).click(); await sleep(250) }
  }
  const meets = async name => {
    await moreFor(name)
    const sel = page.locator(`[data-side="${name}"] [data-meets-house]`)
    return { value: await sel.inputValue(), text: (await sel.locator('option:checked').textContent()).trim() }
  }

  // A. Slide the house 10 ft.
  await openQuote(page, await quote('E2E House slide', yard()))
  const priceBefore = await prices()
  await moreFor('Left side')
  const runsBefore = await page.locator('[data-side-runs]').allTextContents()
  check('no house handle until Adjust the drawing', await page.locator('[data-plan-house-handle]').count() === 0)
  await page.locator('[data-plan-adjust]').click(); await sleep(300)
  await page.locator('[data-plan-wrap]').scrollIntoViewIfNeeded()
  check('a big drag handle on the house and the first time hint', await page.locator('[data-plan-house-handle]').count() === 1
    && (await page.locator('[data-plan-house-hint]').textContent()).includes('Drag the house to where the fence meets it'))
  const handleBox = await page.locator('[data-plan-house-handle]').boundingBox()
  check('the handle is big enough for a finger (44 px or more)', handleBox.width >= 44 && handleBox.height >= 44, `${Math.round(handleBox.width)} px`)
    let liveText = ''
  // Toward the back fence: the returns meet the house further from its back corner.
  await fingerDrag(page.locator('[data-plan-house-handle]'), -10, async () => {
    liveText = (await page.locator('[data-plan-live-label]').textContent().catch(() => '')) || ''
    await shot(page, 'dev-plan-house-drag-phone')
  })
  check('while dragging, a live label in whole feet', liveText === 'Meets the house 10 ft from the back corner', liveText)
  check('the live label goes away when the finger lifts', await page.locator('[data-plan-live-label]').count() === 0)
  check('the hint goes away after the first drag', await page.locator('[data-plan-house-hint]').count() === 0)
  let lm = await meets('Left return'), rm = await meets('Right return')
  check('both returns: "Meets the house at" 10 ft from the back corner', lm.value === 'distance' && rm.value === 'distance' && lm.text === `10' 0" from the back corner` && rm.text === `10' 0" from the back corner`, `${lm.text} | ${rm.text}`)
  await moreFor('Left side')
  check('price, footage and sections unchanged', await prices() === priceBefore && JSON.stringify(await page.locator('[data-side-runs]').allTextContents()) === JSON.stringify(runsBefore))
  let g = await planChecks(page)
  check('side labels keep the typed lengths', ["30' 0\"", "120' 0\"", "150' 0\"", "100' 0\""].every(t => g.labels.includes(t)))
  await page.locator('[data-plan-wrap]').scrollIntoViewIfNeeded()
  await shot(page, 'dev-plan-house-moved')

  // B. One return alone: the left return 4 ft further down the house wall.
  const attach = page.locator('[data-plan-house-attach="Left return"]')
  check('each return has its own handle on the house wall', await attach.count() === 1 && await page.locator('[data-plan-house-attach="Right return"]').count() === 1)
  await fingerDrag(attach, 4, async () => { liveText = (await page.locator('[data-plan-live-label]').textContent().catch(() => '')) || '' })
  check('the live label names the return', liveText === 'Left return meets the house 14 ft from the back corner', liveText)
  lm = await meets('Left return'); rm = await meets('Right return')
  check('only that return moved (14 ft and 10 ft)', lm.text === `14' 0" from the back corner` && rm.text === `10' 0" from the back corner`, `${lm.text} | ${rm.text}`)
  check('price unchanged', await prices() === priceBefore)
  await page.locator('[data-plan-wrap]').scrollIntoViewIfNeeded()
  await shot(page, 'dev-plan-return-attach-drag')
  // More options → drawing: typed in, the handle follows.
  const before = await center(page.locator('[data-plan-house-attach="Right return"]'))
  await moreFor('Right return')
  await page.locator('[data-side="Right return"] [data-meets-house]').selectOption('back'); await sleep(400)
  const after = await center(page.locator('[data-plan-house-attach="Right return"]'))
  check('changing "Meets the house at" in More options moves the drawing', Math.abs(after.y - before.y) > 5, `${Math.round(before.y)} -> ${Math.round(after.y)}`)

  // C. Reset puts both back at the back corners.
  await page.locator('[data-plan-reset]').click(); await sleep(400)
  lm = await meets('Left return'); rm = await meets('Right return')
  check('Reset the drawing: both returns back at the back corners', lm.value === 'back' && rm.value === 'back', `${lm.value} | ${rm.value}`)
  check('price still unchanged', await prices() === priceBefore)

  // D. A 40 ft right return with a 14 ft double gate in the middle.
  await openQuote(page, await quote('E2E Pieces gate', yard({ e: { gate: { type: 'double', widthIn: 168, position: 'middle' } } }, { e: 40 })))
  g = await planChecks(page)
  const rr = g.pieces.filter(p => p.side === 'Right return').sort((a, b) => b.x - a.x)
  check(`40 ft side, 14 ft double gate: 13' / 14' double gate / 13'`, JSON.stringify(rr.map(p => p.text).sort()) === JSON.stringify([`13'`, `13'`, `14' double gate`]), JSON.stringify(rr))
  check('the side keeps its total and name', g.labels.includes(`40' 0"`) && g.labels.some(t => t.startsWith('Right return')))
  check('no label overlaps another or the house (phone)', g.bad.length === 0, g.bad.join(' | '))
  await shot(page, 'dev-plan-piece-labels')

  // E. A gate near the house and a skip on one side.
  const gsId = await quote('E2E Pieces gate skip', yard({ a: { gate: { type: 'walk', widthIn: 48, position: 'start' }, skip: { kind: 'existing', lengthIn: 120, position: 'distance', distanceIn: 288 } } }, { a: 40 }))
  await openQuote(page, gsId)
  g = await planChecks(page)
  const lr = g.pieces.filter(p => p.side === 'Left return').map(p => p.text).sort()
  check('gate near the house and a skip: every piece labeled', JSON.stringify(lr) === JSON.stringify([`10' existing fence`, `12'`, `4' walk gate`, `6'`, `8'`].sort()), JSON.stringify(lr))
  check('no label overlaps another or the house (gate and skip)', g.bad.length === 0, g.bad.join(' | '))
  await shot(page, 'dev-plan-pieces-gate-skip')

  // F. Gate swing: tap the gate while adjusting, then More options.
  const gateAttr = async () => page.locator('[data-plan-wrap] [data-plan-gate="walk"]').evaluate(e => `${e.getAttribute('data-gate-swing')}/${e.getAttribute('data-gate-hinge')}`)
  const p0 = await prices()
  check('default: swings in, hinged on the house end (left, seen from inside)', await gateAttr() === 'in/left', await gateAttr())
  await page.locator('[data-plan-adjust]').click(); await sleep(300)
  const seen = []
  for (let k = 0; k < 4; k++) { await page.locator('[data-plan-gate-tap="Left return"]').tap(); await sleep(250); seen.push(await gateAttr()) }
  check('each tap cycles in/right, out/left, out/right, in/left', seen.join(' ') === 'in/right out/left out/right in/left', seen.join(' '))
  await moreFor('Left return')
  await page.locator('[data-side="Left return"] [data-gate-swing]').selectOption('out'); await sleep(200)
  await page.locator('[data-side="Left return"] [data-gate-hinge]').selectOption('right'); await sleep(300)
  const arcs = await page.locator('[data-plan-wrap] [data-plan-gate="walk"] path').count()
  check('More options: swings out, hinges right; drawn with its hinge post marked', await gateAttr() === 'out/right' && arcs === 1 && await page.locator('[data-plan-wrap] [data-plan-hinge]').count() === 1)
  check('the words under it say so', (await page.locator('[data-side="Left return"] [data-gate-swing-text]').textContent()).startsWith('Swings out, hinges right'))
  check('the price never changes with the swing', await prices() === p0)
  await page.locator('[data-plan-adjust]').click(); await sleep(200)
  await page.locator('[data-plan-wrap]').scrollIntoViewIfNeeded()
  await shot(page, 'dev-plan-gate-swing')
  check('phone: no page errors', errors.length === 0, errors.join(' | '))

  // ── Desktop: the same drag with a mouse, and the proposal plan ───────────────
  const d = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await d.addInitScript(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, TOKEN)
  const dp = await d.newPage()
  const dErrors = []
  dp.on('pageerror', e => dErrors.push(String(e).slice(0, 300)))
  dp.on('dialog', x => x.accept())
  const propId = await quote('E2E Pieces proposal', yard({ e: { gate: { type: 'double', widthIn: 168, position: 'middle', swing: 'out' } }, a: { gate: { type: 'walk', widthIn: 48, position: 'middle', hinge: 'right' } } }, { e: 40 }))
  await openQuote(dp, propId)
  await dp.locator('[data-plan-adjust]').click(); await sleep(300)
  const h = await center(dp.locator('[data-plan-house-handle]'))
  const dppf = await pxPerFtOf(dp)
  await dp.mouse.move(h.x, h.y); await dp.mouse.down()
  for (let k = 1; k <= 10; k++) await dp.mouse.move(h.x, h.y - (6 * dppf * k) / 10)
  await dp.mouse.up(); await sleep(400)
  await dp.locator(`[data-side-row="Left return"]`).click(); await sleep(200); await dp.locator(`[data-side="Left return"] [data-side-more]`).click(); await sleep(200)
  check('desktop: dragging the house with a mouse sets 6 ft', (await dp.locator('[data-side="Left return"] [data-meets-house] option:checked').textContent()).trim() === `6' 0" from the back corner`)
  await dp.locator('[data-plan-reset]').click(); await sleep(300)
  await dp.locator('[data-plan-adjust]').click(); await sleep(300)
  const dg = await labelCheck('[data-plan-wrap] svg[data-site-plan]')(dp)
  check('desktop: no label overlaps', dg.bad.length === 0, dg.bad.join(' | '))
  // The proposal page shows the same drawing the app saves with the proposal.
  const planSvg = await dp.locator('[data-plan-wrap] svg[data-site-plan]').evaluate(s => s.outerHTML)
  await api(`/api/saved-quotes/${propId}`, { method: 'PATCH', body: JSON.stringify({ status: 'SENT', proposal: {
    version: 1, createdAt: new Date().toISOString(), company: { name: 'Getter Done Fence' }, customer: { name: 'E2E Pieces proposal', address: '1 Test Ln, Ocala, FL' }, planSvg,
    footageFt: 450, options: [{ label: "WV-ND 6'x8' Privacy", fenceStyle: "WV-ND 6'x8' Privacy", finalPrice: 9000, perFoot: 20, sections: 55 }],
  } }) })
  const tok = (await api(`/api/saved-quotes/${propId}/share-token`, { method: 'POST' })).shareToken
  const cp = await ctx.newPage()
  await cp.goto(`${API}/p/${tok}`); await sleep(800)
  const pg = await labelCheck('.plan svg')(cp)
  check('proposal: the piece labels and gate swings show', pg.pieces.filter(p => p.side === 'Right return').map(p => p.text).sort().join() === `13',13',14' double gate`
    && await cp.locator('.plan svg [data-plan-gate="double"][data-gate-swing="out,out"]').count() === 1 && await cp.locator('.plan svg [data-plan-hinge]').count() === 3, JSON.stringify(pg.pieces))
  check('proposal: no label overlaps', pg.bad.length === 0, pg.bad.join(' | '))
  await shot(cp, 'dev-plan-proposal-pieces', '.plan')
  await cp.close()

  // ── Install packet: swing and hinge in the gate details, then flipped ─────────
  const pkQuote = await api(`/api/saved-quotes/${gsId}`)
  const pkYard = pkQuote.layout.yard
  pkYard.sides[0].gate = { type: 'walk', widthIn: 48, position: 'start' }
  await api(`/api/saved-quotes/${gsId}`, { method: 'PATCH', body: JSON.stringify({ status: 'SOLD', layout: { yard: pkYard, runSections: [] }, customerAddress: '5708 SW 90th Ln, Ocala, FL 34476' }) })
  const NAME = 'E2E Pieces gate skip'
  const job = await api('/api/saved-jobs', { method: 'POST', body: JSON.stringify({ quoteId: gsId, status: 'scheduled', customerName: NAME, customerAddress: '5708 SW 90th Ln, Ocala, FL 34476', fenceStyle: "WV-ND 6'x8' Privacy", sections: 50, totalFeet: 436, walkGates: 1, scheduledDate: '2026-10-27', crewAssigned: 'Crew A' }) })
  jobId = job.id
  const sendPacket = async () => {
    await dp.goto(APP); await dp.waitForSelector('[data-global-appointment]', { timeout: 30000 }); await sleep(1200)
    await dp.locator('span:text-is("Operations"):visible').first().click(); await sleep(1200)
    await dp.locator('input[aria-label="Search jobs"]').fill(NAME); await sleep(800)
    await dp.locator(`text=${NAME}`).first().click(); await sleep(1000)
    await dp.locator('[data-packet-send]').click(); await sleep(2500)
    return (await dp.locator('[data-packet-url]').textContent()).trim()
  }
  const url = await sendPacket()
  const crew = await ctx.newPage()
  await crew.goto(url.replace(/^https?:\/\/[^/]+/, API)); await sleep(1000)
  let text = (await crew.locator('body').textContent()).replace(/\s+/g, ' ')
  check('install packet: "swings in, hinges left" in the gate details', text.includes(`Left return: 4' 0" walk gate near the house`) && text.includes('swings in, hinges left (as seen from inside the yard)'), text.slice(text.indexOf('Gates'), text.indexOf('Gates') + 220))
  const ig = await labelCheck('.plan svg')(crew)
  check('install packet: every piece labeled, no overlaps', ig.pieces.filter(p => p.side === 'Left return').length === 5 && ig.bad.length === 0, ig.bad.join(' | '))
  await shot(crew, 'dev-plan-install-packet-pieces', '.plan')
  // Flip it: out, hinged right. The price fields are untouched.
  pkYard.sides[0].gate = { type: 'walk', widthIn: 48, position: 'start', swing: 'out', hinge: 'right' }
  const priceQ = (await api(`/api/saved-quotes/${gsId}`)).finalPrice
  await api(`/api/saved-quotes/${gsId}`, { method: 'PATCH', body: JSON.stringify({ layout: { yard: pkYard, runSections: [] } }) })
  await sendPacket()
  await crew.reload(); await sleep(1000)
  text = (await crew.locator('body').textContent()).replace(/\s+/g, ' ')
  check('flipped: the packet says "swings out, hinges right" and draws it', text.includes('swings out, hinges right') && await crew.locator('.plan svg [data-plan-gate="walk"][data-gate-swing="out"][data-gate-hinge="right"]').count() === 1)
  check('flipping the swing never changes the price', (await api(`/api/saved-quotes/${gsId}`)).finalPrice === priceQ)
  if (SHOTS) {
    await crew.locator('.plan').scrollIntoViewIfNeeded()
    await crew.screenshot({ path: `${SHOTS}/dev-install-packet-gate-swing.png` })
    await crew.emulateMedia({ media: 'print' }); await sleep(300)
    await crew.locator('.plan').screenshot({ path: `${SHOTS}/dev-plan-print-pieces.png` })
  }
  const pdf = await crew.pdf({ format: 'Letter' }).catch(() => null)
  check('the packet prints to PDF', !!pdf && pdf.length > 10_000)
  await dp.locator('[data-packet-off]').click().catch(() => {}); await sleep(500)
  check('desktop: no page errors', dErrors.length === 0, dErrors.join(' | '))
  await d.close(); await ctx.close()
} catch (e) {
  check('test run finished', false, String(e?.stack || e).split('\n').slice(0, 4).join(' '))
} finally {
  if (jobId) await api(`/api/saved-jobs/${jobId}`, { method: 'DELETE' })
  for (const id of made) await api(`/api/saved-quotes/${id}`, { method: 'DELETE' })
  await browser.close()
}
const passed = results.filter(Boolean).length
console.log(`\n${passed} of ${results.length} checks passed`)
process.exit(passed === results.length ? 0 : 1)
