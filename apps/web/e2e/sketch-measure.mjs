// Sketch and measure (Jonathan, Nov 6 2026), end to end on the dev copy, on a phone sized WebKit (iPhone), as the
// owner and as Christa (the Salesman): draw the fence with a finger, type the feet side by side, put the gates in,
// pick the fence, save, and read what was saved (the walk list priced from the sketch, the sketch on it) and what the
// customer sees (the sketch with its feet on the proposal: "Sketch, not to scale. Measurements as listed.").
//   - Owner: a closed backyard with two gates (4 ft single 20 ft from Corner 1, 10 ft double in the middle)
//   - Christa: an open L along the house
//   - Owner: a yard with a tee branch (how far from the corner the branch is)
//   - Owner: two separate fence lines, a farm fence
//   - Owner: a two tone vinyl job
//   - Owner: a fence move (the new line sketched)
//   - Owner: the website quote (the customer's drawing) opens as a sketch, "Started from the customer's drawing, check the feet"
//   - fixing: Undo, remove a corner, add a corner, drag a corner (shape only, never the price), the List view
//
//   APP_URL=http://localhost:4001 [E2E_STAFF_COOKIE=<owner cookie>] [SALES_COOKIE=<Christa's cookie>] [SHOTS=<folder>] node e2e/sketch-measure.mjs
//
// Removes everything it made (hard deletes on ezbiz_dev only, by id).
import './devOnly.mjs'
import { webkit } from 'playwright'
import { execFileSync } from 'child_process'
import crypto from 'crypto'
import fs from 'fs'
import { signInByCookie, pickStyle } from './lib.mjs'
import { devSignIn, DEV_OWNER_EMAIL, DEV_SALES_EMAIL } from './devSignIn.mjs'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || APP
// The customer's page is the server's own (/p/<token>), not the web app's.
const PORTAL = process.env.PORTAL_URL || API
const OWNER = process.env.E2E_STAFF_COOKIE || devSignIn(DEV_OWNER_EMAIL, { cookie: true })
const SALES = process.env.SALES_COOKIE || devSignIn(DEV_SALES_EMAIL, { cookie: true })
const OWNER_TOKEN = process.env.E2E_ACCESS_TOKEN || devSignIn(DEV_OWNER_EMAIL)
const SHOTS = process.env.SHOTS || ''
if (!OWNER || !SALES) { console.error('No owner or Salesman sign in.'); process.exit(2) }
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const sql = q => execFileSync('psql', ['-d', 'ezbiz_dev', '-At', '-F', '|', '-c', q]).toString().trim()
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
const run = Date.now().toString(36)
const made = { quotes: new Set(), contacts: new Set() }
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }).catch(() => {}) }

async function phone(browser, cookie) {
  const ctx = await browser.newContext(PHONE)
  await signInByCookie(ctx, { cookie, api: API })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 300)))
  page.on('dialog', d => d.accept().catch(() => {}))
  return { ctx, page, errors }
}

// ── The sketch, by finger ──
/** Drawing units (the 400 × 520 sketch) → the screen. */
const toScreen = (page, pts) => page.locator('[data-sketch-canvas]').evaluate((svg, pts) => {
  // The whole drawing on screen first (a finger can only touch what it sees).
  const r = svg.getBoundingClientRect()
  if (r.top < 0 || r.bottom > window.innerHeight) svg.scrollIntoView({ block: 'center' })
  const m = svg.getScreenCTM()
  return pts.map(([x, y]) => { const p = new DOMPoint(x, y).matrixTransform(m); return [p.x, p.y] })
}, pts)
/** One finger stroke through the corners, with a little wobble, as a hand draws it. */
async function stroke(page, corners) {
  const s = await toScreen(page, corners)
  await page.mouse.move(s[0][0], s[0][1]); await page.mouse.down()
  for (let i = 1; i < s.length; i++) {
    const [ax, ay] = s[i - 1], [bx, by] = s[i]
    for (let k = 1; k <= 14; k++) await page.mouse.move(ax + ((bx - ax) * k) / 14 + (k % 2 ? 0.8 : -0.8), ay + ((by - ay) * k) / 14 + (k % 3 ? 0.6 : -0.6))
  }
  await page.mouse.up(); await sleep(350)
}
async function tapAt(page, x, y) { const [[sx, sy]] = await toScreen(page, [[x, y]]); await page.mouse.click(sx, sy); await sleep(300) }
async function drag(page, [x0, y0], [x1, y1]) {
  const [[ax, ay], [bx, by]] = await toScreen(page, [[x0, y0], [x1, y1]])
  await page.mouse.move(ax, ay); await page.mouse.down()
  for (let k = 1; k <= 10; k++) await page.mouse.move(ax + ((bx - ax) * k) / 10, ay + ((by - ay) * k) / 10)
  await page.mouse.up(); await sleep(350)
}
const mode = async (page, m) => { await page.locator(`[data-sketch-mode="${m}"]`).tap(); await sleep(250) }
/** Feet for each side in turn: type, Next. */
async function feet(page, list) {
  await mode(page, 'feet')
  for (const f of list) {
    const [ft, inch] = String(f).split(' ')
    await page.locator('[data-sketch-feet-input]').fill(ft)
    if (inch) await page.locator('[data-sketch-inches-input]').fill(inch)
    await page.locator('[data-sketch-feet-next]').tap(); await sleep(300)
  }
}
/** A gate on the side through (x, y): width, single or double, feet from its first corner (blank: middle). */
async function gate(page, [x, y], w, kind, at = '') {
  await mode(page, 'gates')
  await tapAt(page, x, y)
  await page.locator(`[data-sketch-gate-width="${w}"]`).tap()
  await page.locator(`[data-sketch-gate-kind="${kind}"]`).tap()
  if (at !== '') await page.locator('[data-sketch-gate-at]').fill(String(at))
  await page.locator('[data-sketch-gate-save]').tap(); await sleep(400)
}
const totalWords = page => page.locator('[data-sketch-total]').innerText().then(t => t.replace(/\s+/g, ' ').trim())

const quoteRow = id => {
  const [runs, corners, ends, wg, dg, sections, price, hasSketch, style, plan] = sql(`select runs::text, corners, ends, "walkGates", "dblGates", sections, "finalPrice", (layout->'walk'->'sketch') is not null, "fenceStyle", coalesce(proposal->>'planSvg', '') from "SavedQuote" where id = '${id}'`).split('|')
  return { runs: JSON.parse(runs || '[]'), corners: +corners, ends: +ends, wg: +wg, dg: +dg, sections: +sections, price: +price, hasSketch: hasSketch === 't', style, plan }
}
const newestQuote = name => sql(`select id from "SavedQuote" where "customerName" = '${name}' and "deletedAt" is null order by "createdAt" desc limit 1`)
async function saveQuote(page) {
  const bar = page.locator('[data-quote-bar]')
  for (let i = 0; i < 4 && !(await bar.locator('[data-save-open]').count()); i++) { await bar.locator('[data-bar-next]').click().catch(() => {}); await sleep(700) }
  await bar.locator('[data-save-open]').click(); await sleep(1200)
  if (await page.locator('[data-save-mode="new"]').count()) await page.locator('[data-save-mode="new"]').click().catch(() => {})
  await sleep(300)
  if (!(await page.locator('[data-save-submit]').count())) { await shot(page, `save-missing-${Date.now()}`); console.log('      save: ' + (await page.locator('[data-quote-bar]').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300)) }
  await page.locator('[data-save-submit]').click(); await sleep(4500)
}

async function newQuote(ctx, errors, name) {
  const page = await ctx.newPage()
  page.on('pageerror', e => errors.push(String(e).slice(0, 300)))
  page.on('dialog', d => d.accept().catch(() => {}))
  await page.goto(`${APP}/quotes`); await sleep(2500)
  await page.locator('button:has-text("New quote"):visible').first().tap(); await sleep(900)
  const b = page.locator('[data-quote-builder]')
  await b.locator('input[placeholder^="Customer name"]').fill(name)
  await page.locator('[data-quote-bar] [data-bar-next]').tap(); await sleep(600)
  await page.locator('[data-sketch-canvas]').waitFor({ timeout: 15000 })
  return { page, b }
}
const toStyle = async (b, page, styleText) => {
  await b.locator('[data-step="style"]').tap(); await sleep(400)
  try { await pickStyle(page, styleText) } catch (e) {
    const names = await b.locator('[data-step-panel="style"] [data-style-list] option').allTextContents().catch(() => [])
    console.log(`      no style like ${styleText}; not vinyl in the list: ${names.filter(n => !/Vinyl/.test(n)).join(' | ').slice(0, 1500)}`)
    throw e
  }
  await sleep(500)
}

const browser = await webkit.launch()
try {
  // ── Owner: a closed backyard with two gates ──
  if (!process.env.ONLY_WEBSITE) {
    const { ctx, errors } = await phone(browser, OWNER)
    const name = `Sketch e2e backyard ${run}`
    const { page, b } = await newQuote(ctx, errors, name)
    check('Owner: the Yard step opens on the sketch, "Draw the fence with your finger."', /Draw the fence with your finger/.test(await page.locator('[data-sketch-prompt]').innerText()))
    // Clockwise from the top left, back near the start.
    await stroke(page, [[60, 80], [340, 80], [340, 420], [60, 420], [64, 88]])
    check('Owner: a line back near its start asks "Does the fence close back to the start?"', await page.locator('[data-sketch-ask-close]').isVisible())
    await shot(page, 'sketch-01-drawn')
    await page.locator('[data-sketch-close="yes"]').tap(); await sleep(400)
    check('Owner: closed, 4 sides, every side red until it has feet', await page.locator('[data-sketch-side]').count() === 4 && await page.locator('[data-sketch-problem]').innerText().then(t => /Side 1 has no feet\. Tap it\./.test(t)))
    check('Owner: Done is not allowed until every side has feet', await page.locator('[data-sketch-done]').isDisabled())
    await mode(page, 'feet')
    check('Owner: the feet box asks "Side 1: how many feet?"', /Side 1: how many feet\?/.test(await page.locator('[data-sketch-question]').innerText()))
    await sleep(400)
    const vis = await page.evaluate(() => {
      const side = document.querySelector('[data-sketch-side="1"]')?.getBoundingClientRect(), head = document.querySelector('[data-sketch-total]')?.getBoundingClientRect()
      const box = document.querySelector('[data-sketch-feet-input]')?.getBoundingClientRect(), bar = document.querySelector('[data-quote-bar]')?.getBoundingClientRect()
      let sc = document.querySelector('[data-sketch-canvas]')?.parentElement
      while (sc && !(sc.scrollHeight > sc.clientHeight && /auto|scroll/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement
      return { side: side ? Math.round(side.top) : null, head: head ? Math.round(head.bottom) : null, box: box ? Math.round(box.bottom) : null, bar: bar ? Math.round(bar.top) : null, scroller: sc ? `${sc.tagName}.${String(sc.className).slice(0, 60)} top ${Math.round(sc.scrollTop)}` : 'page', page: Math.round(window.scrollY), vh: window.innerHeight }
    })
    check('Owner: while typing Side 1, Side 1 is on screen below the total and the feet box above the price bar', vis.side != null && vis.side > vis.head && vis.box != null && vis.box <= vis.bar, JSON.stringify(vis))
    await shot(page, 'sketch-02-measuring')
    await feet(page, ['100', '80', '100', '80'])
    check('Owner: the feet show by each side on the sketch', (await page.locator('[data-sketch-feet]').allTextContents()).join(',') === '100 ft,80 ft,100 ft,80 ft')
    // Side 1 is the top (60,80 → 340,80); side 3 the bottom.
    await gate(page, [200, 80], 4, 'walk', 20)
    await mode(page, 'gates'); await tapAt(page, 200, 420)
    await page.locator('[data-sketch-gate-width="10"]').tap(); await page.locator('[data-sketch-gate-kind="double"]').tap()
    check('Owner: a gate says the fence feet either side ("45 ft of fence, the 10 ft gate, then 45 ft")', /45 ft of fence, the 10 ft gate, then 45 ft of fence/.test(await page.locator('[data-sketch-gate-split]').innerText()))
    await shot(page, 'sketch-03-gate')
    await page.locator('[data-sketch-gate-save]').tap(); await sleep(400)
    const tw = await totalWords(page)
    check('Owner: the total at the top: "360 ft walked: 346 ft of fence + 14 ft of gates"', /360 ft walked/.test(tw) && /346 ft of fence \+ 14 ft of gates/.test(tw), tw)
    check('Owner: two gates on the sketch', await page.locator('[data-sketch-gate]').count() === 2)
    check('Owner: Done is allowed', !(await page.locator('[data-sketch-done]').isDisabled()))
    await shot(page, 'sketch-04-finished')
    // List view: the same fence as the walk list.
    await page.locator('[data-sketch-toggle-to="list"]').tap(); await sleep(300)
    const steps = (await page.locator('[data-walk-step]').allTextContents()).map(t => t.replace(/\s+/g, ' '))
    check('Owner: List view is the same fence as the walk list (gate, corners, gate, back to start)', steps.length === 6 && /Gate 4 ft single/.test(steps[0]) && /Back to start/.test(steps[5]) && steps.some(s => /Gate 10 ft double/.test(s)), steps.join(' / '))
    await page.locator('[data-sketch-toggle-to="sketch"]').first().tap(); await sleep(300)
    // Drag a corner: the shape changes, the price does not.
    await b.locator('[data-step="style"]').tap(); await sleep(400)
    await pickStyle(page, 'White Vinyl Privacy, 6 ft tall, 8 ft sections, No dig')
    const price0 = (await page.locator('[data-quote-bar] [data-bar-price]').textContent().catch(() => '')).trim()
    await b.locator('[data-step="yard"]').tap(); await sleep(400)
    await mode(page, 'draw')
    await drag(page, [340, 420], [370, 470])
    await b.locator('[data-step="style"]').tap(); await sleep(400)
    const price1 = (await page.locator('[data-quote-bar] [data-bar-price]').textContent().catch(() => '')).trim()
    check('Owner: dragging a corner changes the shape only, never the price', price0 && price0 === price1, `${price0} / ${price1}`)
    await b.locator('[data-step="yard"]').tap(); await sleep(400)
    await saveQuote(page)
    const id = newestQuote(name); if (id) made.quotes.add(id)
    const q = quoteRow(id)
    check('Owner: saved with the sketch on its walk list', q.hasSketch)
    check('Owner: priced from the typed feet: runs 20/76/80/45/45/80, 4 corners, 1 single and 1 double gate', JSON.stringify(q.runs) === '[20,76,80,45,45,80]' && q.corners === 4 && q.wg === 1 && q.dg === 1, JSON.stringify(q))
    check('Owner: the proposal carries the sketch, "Sketch, not to scale. Measurements as listed."', /Sketch, not to scale\. Measurements as listed\./.test(q.plan) && q.plan.includes('100 ft') && q.plan.includes('10 ft double gate'))
    // What the customer sees.
    const r = await fetch(`${PORTAL}/api/saved-quotes/${id}/share-token`, { method: 'POST', headers: { Authorization: `Bearer ${OWNER_TOKEN}` } })
    const tj = await r.json(); const token = tj.data?.shareToken ?? tj.shareToken
    const cp = await ctx.newPage(); cp.on('pageerror', e => errors.push('customer: ' + String(e).slice(0, 200)))
    await cp.goto(`${PORTAL}/p/${token}`); await sleep(1800)
    const html = await cp.content()
    check('Customer page: the sketch with its feet and gates, "Sketch, not to scale. Measurements as listed."', /Sketch, not to scale\. Measurements as listed\./.test(html) && html.includes('4 ft single gate'), (await cp.innerText('body').catch(() => '')).replace(/\s+/g, ' ').slice(0, 200) + ` token ${token} ${r.status}`)
    const plan = cp.locator('.plan, [data-plan-section]').first()
    if (await plan.count()) { await plan.scrollIntoViewIfNeeded().catch(() => {}); await sleep(300) }
    await shot(cp, 'sketch-05-proposal')
    // Reopened: the sketch as drawn (the dragged corner kept).
    // A fresh tab (WebKit can crash going to a new address in the same tab).
    const re = await ctx.newPage(); re.on('pageerror', e => errors.push(String(e).slice(0, 300)))
    await page.close().catch(() => {})
    await re.goto(`${APP}/quotes?quote=${id}`); await sleep(3500)
    const rb = re.locator('[data-quote-builder]')
    if (!(await re.locator('[data-sketch-canvas]').isVisible().catch(() => false))) { await rb.locator('[data-step="yard"]').tap().catch(() => {}); await sleep(500) }
    const page2 = re
    check('Owner: reopened, it opens on its sketch with its feet', (await page2.locator('[data-sketch-feet]').allTextContents()).join(',') === '100 ft,80 ft,100 ft,80 ft')
    check('Owner: no page errors', !errors.length, errors.join(' | '))
    await ctx.close()
  }

  // ── Christa: an open L along the house, fixing as she goes ──
  if (!process.env.ONLY_WEBSITE) {
    const { ctx, errors } = await phone(browser, SALES)
    const name = `Sketch e2e L ${run}`
    const { page, b } = await newQuote(ctx, errors, name)
    await stroke(page, [[80, 60], [80, 400], [330, 400]])
    check('Christa: an open L asks nothing about closing; its ends are end posts', !(await page.locator('[data-sketch-ask-close]').count()) && (await page.locator('[data-sketch-point^="End post"]').count()) === 2)
    // A stray extra line, then Undo.
    await stroke(page, [[250, 100], [350, 160]])
    check('Christa: a second line is a separate fence line', await page.locator('[data-sketch-side]').count() === 3)
    await page.locator('[data-sketch-undo]').tap(); await sleep(300)
    check('Christa: Undo takes it away', await page.locator('[data-sketch-side]').count() === 2)
    // Put a corner in the long side, then take it out again.
    await tapAt(page, 80, 230)
    await page.locator('[data-sketch-side-split]').tap(); await sleep(300)
    check('Christa: Add a corner here: three sides', await page.locator('[data-sketch-side]').count() === 3)
    await tapAt(page, 80, 230)
    await page.locator('[data-sketch-point-remove]').tap(); await sleep(300)
    check('Christa: Remove this corner: two sides again', await page.locator('[data-sketch-side]').count() === 2)
    await feet(page, ['60 6', '90'])
    await gate(page, [200, 400], 5, 'walk')
    const tw = await totalWords(page)
    check('Christa: 150 ft 6 in walked, 145.5 ft of fence + 5 ft of gates', /150\.5 ft walked/.test(tw) && /145\.5 ft of fence \+ 5 ft of gates/.test(tw), tw)
    await toStyle(b, page, 'White Vinyl Privacy')
    await b.locator('[data-step="yard"]').tap(); await sleep(300)
    await saveQuote(page)
    const id = newestQuote(name); if (id) made.quotes.add(id)
    const q = quoteRow(id)
    check('Christa: saved: 1 corner, a single gate in the middle of the 90 ft side (42.5 + 42.5), the sketch kept', q.corners === 1 && q.wg === 1 && JSON.stringify(q.runs) === '[60.5,42.5,42.5]' && q.hasSketch, JSON.stringify(q))
    check('Christa: no page errors', !errors.length, errors.join(' | '))
    await ctx.close()
  }

  // ── Owner: a tee branch; two separate lines (farm fence); two tone; a move ──
  if (!process.env.ONLY_WEBSITE) {
    const { ctx, errors } = await phone(browser, OWNER)
    // Tee
    {
      const name = `Sketch e2e tee ${run}`
      const { page, b } = await newQuote(ctx, errors, name)
      await stroke(page, [[40, 120], [360, 120], [360, 420]])
      await stroke(page, [[200, 124], [200, 380]])
      check('Tee: a line started on a side is a branch (the tee point shows)', await page.locator('[data-sketch-point="the tee"]').count() === 1)
      await mode(page, 'feet')
      const qs = []
      for (const f of ['120', '80', '60', '50']) { qs.push(await page.locator('[data-sketch-question]').innerText()); await page.locator('[data-sketch-feet-input]').fill(f); await page.locator('[data-sketch-feet-next]').tap(); await sleep(300) }
      check('Tee: asks "How far from End post 1 is the branch?" in its turn', qs.some(t => /How far from End post 1 is the branch/.test(t)), qs.join(' / '))
      await shot(page, 'sketch-06-tee')
      await toStyle(b, page, 'White Vinyl Privacy, 6 ft tall, 8 ft sections, No dig')
      await saveQuote(page)
      const id = newestQuote(name); if (id) made.quotes.add(id)
      const q = quoteRow(id)
      check('Tee: saved as one corner, a branch (runs 120, 80, 50), not cut at the tee', q.corners === 1 && JSON.stringify(q.runs) === '[120,80,50]', JSON.stringify(q))
      await page.close()
    }
    // Two separate fence lines, farm fence
    {
      const name = `Sketch e2e two lines ${run}`
      const { page, b } = await newQuote(ctx, errors, name)
      await stroke(page, [[40, 80], [360, 80]])
      await stroke(page, [[40, 300], [300, 300], [300, 480]])
      await feet(page, ['200', '330', '150'])
      // Farm fence is held until its sub rate per foot is set (Settings → Fence Styles); then a wood fence.
      const farm = await (async () => { await b.locator('[data-step="style"]').tap(); await sleep(400); return (await b.locator('[data-step-panel="style"] [data-style-list] option').allTextContents()).some(n => /No Climb|4 Board/.test(n)) })()
      if (!farm) console.log('      (farm fence is not offered on this copy: no sub rate per foot set; the two lines are priced as wood)')
      await toStyle(b, page, farm ? 'No Climb|4 Board' : 'Wood Stockade, 6 ft tall, 8 ft sections, Dig set, PT Pine')
      await saveQuote(page)
      const id = newestQuote(name); if (id) made.quotes.add(id)
      const q = quoteRow(id)
      check('Two lines (farm fence, or wood when farm is held): 1 corner, 4 end posts, runs 200/330/150', q.corners === 1 && q.ends >= 4 && JSON.stringify(q.runs) === '[200,330,150]' && q.price > 0, JSON.stringify(q))
      await page.close()
    }
    // Two tone vinyl
    {
      const name = `Sketch e2e two tone ${run}`
      const { page, b } = await newQuote(ctx, errors, name)
      await stroke(page, [[60, 100], [340, 100], [340, 400]])
      await feet(page, ['48', '72'])
      await gate(page, [340, 250], 4, 'walk', 0)
      await toStyle(b, page, 'Two Tone')
      await saveQuote(page)
      const id = newestQuote(name); if (id) made.quotes.add(id)
      const q = quoteRow(id)
      check('Two tone: saved and priced from the sketch (a gate at the corner, 0 ft)', /two ?tone/i.test(q.style) && q.wg === 1 && JSON.stringify(q.runs) === '[48,68]' && q.price > 0, JSON.stringify(q))
      await page.close()
    }
    // A move: the new line sketched, the old line typed
    {
      const name = `Sketch e2e move ${run}`
      const { page, b } = await newQuote(ctx, errors, name)
      await stroke(page, [[40, 200], [360, 200]])
      await feet(page, ['104'])
      await gate(page, [200, 200], 4, 'walk')
      await b.locator('[data-step="style"]').tap(); await sleep(400)
      await b.locator('[data-job-type-option="move"]').click(); await sleep(300)
      await pickStyle(page, 'White Vinyl Privacy, 6 ft tall, 6 ft sections, No dig')
      await b.locator('[data-move-old-ft]').fill('100')
      await b.locator('[data-move-old-walk]').fill('1')
      await saveQuote(page)
      const id = newestQuote(name); if (id) made.quotes.add(id)
      const q = quoteRow(id)
      check('Move: saved with the sketched new line and the sketch on the proposal', q.hasSketch && JSON.stringify(q.runs) === '[50,50]' && /Sketch, not to scale/.test(q.plan), JSON.stringify({ ...q, plan: q.plan.length }))
      await page.close()
    }
    check('Owner (tee, two lines, two tone, move): no page errors', !errors.length, errors.join(' | '))
    await ctx.close()
  }

  // ── The website quote opens as a sketch ──
  {
    const { ctx, errors } = await phone(browser, OWNER)
    const at = { lat: 29.185118, lng: -82.134209 }
    const pt = (e, n) => ({ lat: at.lat + (n * 0.3048) / 110_860, lng: at.lng + (e * 0.3048) / 97_330 })
    const drawing = { v: 1, address: '110 SE Watula Ave, Ocala, FL 34471', at, runs: [{ id: 'r1', pts: [pt(-30, 15), pt(-55, 15), pt(-55, 95), pt(55, 95), pt(55, 15), pt(30, 15)], start: 'house', end: 'house', typedFt: [null, null, null, null, null], gates: [null, { type: 'walk', widthFt: 4, startFt: 11 }, null, null, null] }] }
    const name = `Sketch e2e website ${run}`
    const sub = await fetch(`${PORTAL}/p/quote/api/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draftId: crypto.randomBytes(16).toString('hex'), name, phone: `352555${String(Math.floor(Math.random() * 9000) + 1000)}`, email: `sketch.${run}@example.invalid`, address: drawing.address, drawing, pick: { material: 'vinyl', color: 'white', height: '6', kind: 'privacy' }, wantsVisit: true }) })
    check('Website: the customer\'s drawing is sent', sub.status === 201, String(sub.status))
    const [qid, cid] = sql(`select id, "crmContactId" from "SavedQuote" where "customerName" = '${name}' and "deletedAt" is null order by "createdAt" desc limit 1`).split('|')
    if (qid) made.quotes.add(qid)
    if (cid) made.contacts.add(cid)
    const before = quoteRow(qid)
    const page = await ctx.newPage(); page.on('pageerror', e => errors.push(String(e).slice(0, 300)))
    if (process.env.ONLY_WEBSITE) page.on('request', r => { if (/saved-quotes/.test(r.url()) && r.method() !== 'GET') { let w = null; try { w = JSON.parse(r.postData() || '{}').layout?.walk } catch {} console.log('REQ', r.method(), r.url().slice(-60), w ? Object.keys(w).join(',') : 'no walk') } })
    await page.goto(`${APP}/quotes?quote=${qid}`); await sleep(3500)
    const b = page.locator('[data-quote-builder]')
    if (!(await page.locator('[data-sketch-canvas]').isVisible().catch(() => false))) { await b.locator('[data-step="yard"]').tap().catch(() => {}); await sleep(500) }
    const banner = await page.locator('[data-walk-started-from]').textContent().catch(() => '')
    check('Website: opens as a sketch, "Started from the customer\'s drawing, check the feet."', /Started from the customer's drawing, check the feet/.test(banner || '') && await page.locator('[data-sketch-canvas]').isVisible())
    check('Website: the drawing\'s 5 sides with their feet and the gate', await page.locator('[data-sketch-side]').count() === 5 && await page.locator('[data-sketch-gate]').count() === 1 && !(await page.locator('[data-sketch-feet]').allTextContents()).some(t => /\?/.test(t)))
    await shot(page, 'sketch-07-website')
    await saveQuote(page)
    const after = quoteRow(qid)
    check('Website: saved, the same runs, posts, gates, sections and price as the customer\'s drawing', JSON.stringify(after.runs) === JSON.stringify(before.runs) && after.corners === before.corners && after.ends === before.ends && after.wg === before.wg && after.sections === before.sections && after.price === before.price && after.hasSketch, `${JSON.stringify({ ...before, plan: before.plan.length })} / ${JSON.stringify({ ...after, plan: after.plan.length })} walk keys: ${sql(`select string_agg(k, ',') from "SavedQuote", jsonb_object_keys(coalesce(layout->'walk', '{}'::jsonb)) k where id = '${qid}'`)} updated ${sql(`select "updatedAt" from "SavedQuote" where id = '${qid}'`)}`)
    check('Website: no page errors', !errors.length, errors.join(' | '))
    await ctx.close()
  }
} finally {
  await browser.close()
  for (const id of made.quotes) {
    for (const t of ['QuoteOption', 'ProposalView', 'SavedJob']) { try { sql(`delete from "${t}" where "quoteId" = '${id}'`) } catch {} }
    sql(`delete from "CrmAuditLog" where "entityId" = '${id}'`)
    sql(`delete from "SavedQuote" where id = '${id}'`)
  }
  for (const c of made.contacts) {
    if (sql(`select count(*) from "SavedQuote" where "crmContactId" = '${c}'`) !== '0') continue
    if (!/^Sketch e2e/.test(sql(`select "firstName" || ' ' || "lastName" from "CrmContact" where id = '${c}'`))) continue
    sql(`update "PipelineState" set leads = (select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements(leads::jsonb) x where coalesce(x->>'crmContactId', x->>'contactId', x->>'customerId', '') <> '${c}')`)
    for (const t of ['IntakeLead', 'CrmTextConsent', 'CustomerProperty', 'PendingTouch', 'CrmContactNote', 'CrmAppointment']) { try { sql(`delete from "${t}" where "crmContactId" = '${c}'`) } catch (e) { console.log(`      cleanup ${t}: ${String(e.stderr || e).slice(0, 120)}`) } }
    try { sql(`delete from "CrmContact" where id = '${c}'`) } catch (e) { console.log(`      cleanup customer ${c}: ${String(e.stderr || e).slice(0, 160)}`) }
  }
  // Quotes saved with a customer name and no card (new quotes): their customers made on save.
  for (const n of ['backyard', 'L', 'tee', 'two lines', 'two tone', 'move']) {
    for (const c of sql(`select id from "CrmContact" where "firstName" || ' ' || "lastName" like 'Sketch e2e ${n} ${run}%'`).split('\n').filter(Boolean)) {
      if (sql(`select count(*) from "SavedQuote" where "crmContactId" = '${c}'`) !== '0') continue
      sql(`update "PipelineState" set leads = (select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements(leads::jsonb) x where coalesce(x->>'crmContactId', x->>'contactId', x->>'customerId', '') <> '${c}')`)
      for (const t of ['CustomerProperty', 'CrmContactNote']) { try { sql(`delete from "${t}" where "crmContactId" = '${c}'`) } catch {} }
      try { sql(`delete from "CrmContact" where id = '${c}'`) } catch {}
    }
  }
  console.log(`removed ${made.quotes.size} quotes`)
}
const failed = results.filter(r => !r).length
console.log(`\n${results.length - failed} of ${results.length} passed`)
process.exit(failed ? 1 : 0)
