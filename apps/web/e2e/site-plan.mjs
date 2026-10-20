// The site plan in the quote builder: house level, sides straight back, the
// back angled when the sides differ, "Meets the house at", the gentle note for
// measurements that cannot fit, and dragging a corner (drawing only).
//
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 \
//   E2E_ACCESS_TOKEN=<dev staff token> SHOTS=<folder, optional> node e2e/site-plan.mjs
//
// Makes quotes with a drawn backyard, opens each in the builder, then deletes them.

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
const yard = (left, right, back, extra = {}) => ({ shape: 'backyard', closed: false, sides: [
  side('a', 'Left return', 30, 'house', 'corner', 180, extra.a), side('b', 'Left side', left, 'corner', 'corner', 90),
  side('c', 'Back', back, 'corner', 'corner', 0), side('d', 'Right side', right, 'corner', 'corner', 270),
  side('e', 'Right return', 30, 'corner', 'house', 180, extra.e),
] })
const made = []
async function quote(name, y) {
  const runs = y.sides.map(s => s.lengthIn / 12)
  const q = await api('/api/saved-quotes', { method: 'POST', body: JSON.stringify({
    customerName: name, fenceStyle: "WV-ND 6'x8' Privacy", runs, corners: 4, ends: 2, sections: 0, status: 'DRAFT', finalPrice: 0,
    date: new Date().toISOString().slice(0, 10), layout: { yard: y, runSections: [] },
  }) })
  made.push(q.id)
  return q.id
}

/** The plan's geometry as drawn on screen, read from the SVG. */
async function geometry(page) {
  return page.locator('[data-plan-wrap] svg[data-site-plan]').evaluate(svg => {
    const house = svg.querySelector('polygon')
    const pts = house ? house.getAttribute('points').trim().split(/\s+/).map(p => p.split(',').map(Number)) : []
    const purple = [...svg.querySelectorAll('line[stroke="#5E28A1"]')].map(l => ['x1', 'y1', 'x2', 'y2'].map(k => +l.getAttribute(k)))
    const labels = [...svg.querySelectorAll('text')].map(t => t.textContent)
    // Corner posts are the 12 px squares drawn on the plan (the drag handles show only while adjusting).
    const corners = [...svg.querySelectorAll('rect[width="12"][height="12"]')].map(c => [+c.getAttribute('x') + 6, +c.getAttribute('y') + 6])
    return { pts, purple, labels, corners }
  })
}
const level = pts => pts.every((p, i) => { const q = pts[(i + 1) % pts.length]; return Math.abs(p[0] - q[0]) < 0.2 || Math.abs(p[1] - q[1]) < 0.2 })

const browser = await chromium.launch()
try {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await ctx.addInitScript(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, TOKEN)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 300)))
  let asked = null
  page.on('dialog', d => { asked = d.message(); d.accept() })
  const openQuote = async id => {
    await page.goto(`${APP}/quotes?quote=${id}`)
    // A saved quote opens on its price; the plan is on the Yard step.
    await page.locator('[data-quote-builder] [data-step="yard"]').click({ timeout: 30000 })
    await page.waitForSelector('[data-plan-wrap] svg', { timeout: 30000 }); await sleep(1200)
    await page.locator('[data-plan-wrap]').scrollIntoViewIfNeeded()
  }
  const shot = async name => { if (SHOTS) await page.locator('[data-plan-wrap]').screenshot({ path: `${SHOTS}/${name}.png` }) }

  // Left 120, right 100, back 150, returns 30 and 30.
  await openQuote(await quote('E2E Plan uneven', yard(120, 100, 150)))
  let g = await geometry(page)
  check('the house is square and level', g.pts.length === 4 && level(g.pts), JSON.stringify(g.pts))
  const backLine = g.purple.reduce((a, l) => (Math.abs(l[1] - l[3]) > 2 && Math.abs(l[0] - l[2]) > 50 ? l : a), null)
  check('the back is drawn at an angle', !!backLine, JSON.stringify(g.purple.slice(0, 6)))
  check('every side keeps its typed length on its label', ["30' 0\"", "120' 0\"", "150' 0\"", "100' 0\""].every(t => g.labels.includes(t)), g.labels.filter(t => /'/.test(t)).join(' | '))
  check('no "check these measurements" note when the numbers fit', (await page.locator('[data-plan-note]').count()) === 0)
  await shot('1-uneven-sides')
  // Back with nothing changed closes without asking.
  asked = null
  await page.goBack(); await sleep(800)
  check('opening a saved quote and going Back does not ask (nothing changed)', asked === null && (await page.locator('[data-quote-builder]').count()) === 0, String(asked))

  // Equal sides: a clean rectangle.
  await openQuote(await quote('E2E Plan equal', yard(120, 120, 150)))
  g = await geometry(page)
  const ys = new Set(g.corners.map(c => Math.round(c[1])))
  check('equal sides draw a clean rectangle', g.corners.length === 4 && ys.size === 2 && level(g.pts), JSON.stringify(g.corners))
  await shot('2-equal-sides')

  // Meets the house at the front corner.
  await openQuote(await quote('E2E Plan front corner', yard(120, 100, 150, { a: { meetsHouse: { at: 'front' } } })))
  const leftReturn = page.locator('[data-side="Left return"]')
  // "Meets the house at" is behind More options on the open side.
  const moreFor = async name => { await page.locator(`[data-side-row="${name}"]`).click(); await sleep(200); await page.locator(`[data-side="${name}"] [data-side-more]`).click(); await sleep(200) }
  await moreFor('Left return')
  check('a return has "Meets the house at"', (await leftReturn.locator('[data-meets-house]').inputValue()) === 'front' && (await page.locator('[data-side="Back"] [data-meets-house]').count()) === 0)
  g = await geometry(page)
  check('the house stays level with a return at its front corner', level(g.pts))
  await shot('3-meets-front-corner')
  await moreFor('Right return')
  await page.locator('[data-side="Right return"] [data-meets-house]').selectOption('front'); await sleep(400)
  g = await geometry(page)
  check('changing "Meets the house at" redraws, house still level', level(g.pts) && Math.round(g.corners[0][1]) === Math.round(g.corners[3][1]))

  // Numbers that cannot fit: a drawing anyway, and a gentle note.
  await openQuote(await quote('E2E Plan cannot fit', yard(120, 40, 50)))
  const note = await page.locator('[data-plan-note]').first().textContent().catch(() => '')
  g = await geometry(page)
  check('measurements that cannot fit show "Check these measurements"', /^Check these measurements/.test(note), note)
  check('and the plan still draws', g.purple.length >= 5 && level(g.pts))
  await shot('4-check-measurements')

  // Drag a corner: the drawing moves, the footage, labels and price do not.
  await openQuote(await quote('E2E Plan drag', yard(120, 100, 150)))
  const priceBefore = await page.locator('[data-quote-builder]').textContent()
  const runsBefore = await page.locator('[data-side-runs]').allTextContents()
  g = await geometry(page)
  check('no corner handles until Adjust the drawing is tapped', await page.locator('[data-plan-corner]').count() === 0)
  await page.locator('[data-plan-adjust]').click(); await sleep(300)
  g = await geometry(page)
  const corner = page.locator('[data-plan-corner="2"]')
  const box = await corner.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  for (let k = 1; k <= 8; k++) await page.mouse.move(box.x + box.width / 2 - k * 6, box.y + box.height / 2 + k * 3)
  await page.mouse.up(); await sleep(500)
  const g2 = await geometry(page)
  check('dragging a corner moves it on the plan', JSON.stringify(g2.purple) !== JSON.stringify(g.purple))
  check('labels keep the typed lengths', ["30' 0\"", "120' 0\"", "150' 0\"", "100' 0\""].every(t => g2.labels.includes(t)))
  check('footage, sections and price are unchanged', JSON.stringify(await page.locator('[data-side-runs]').allTextContents()) === JSON.stringify(runsBefore)
    && (await page.locator('[data-quote-builder]').textContent()).match(/\$[\d,]+/g)?.join() === priceBefore.match(/\$[\d,]+/g)?.join())
  // The plan refits to the screen after a drag, so compare shape, not pixels.
  const ratio = p => (p[1][0] - p[0][0]) / (p[2][1] - p[1][1])
  check('the house stays square and level, same proportions', g2.pts.length === 4 && level(g2.pts) && Math.abs(ratio(g2.pts) - ratio(g.pts)) < 0.01, `${ratio(g.pts).toFixed(3)} -> ${ratio(g2.pts).toFixed(3)}`)
  await shot('5-corner-dragged')
  check('"Reset the drawing" puts it back', await page.locator('[data-plan-reset]').count() === 1)
  await page.locator('[data-plan-reset]').click(); await sleep(400)
  check('and it is back as typed', JSON.stringify((await geometry(page)).purple) === JSON.stringify(g.purple))
  check('no page errors', errors.length === 0, errors.join(' | '))
  await ctx.close()
} catch (e) {
  check('test run finished', false, String(e?.stack || e).split('\n').slice(0, 4).join(' '))
} finally {
  for (const id of made) await api(`/api/saved-quotes/${id}`, { method: 'DELETE' })
  await browser.close()
}
const passed = results.filter(Boolean).length
console.log(`\n${passed} of ${results.length} checks passed`)
process.exit(passed === results.length ? 0 : 1)
