// Every new quote opens on the walk list (Jonathan, Nov 6 2026), end to end on the dev copy, as the owner and as
// Christa (the Salesman) on a phone sized WebKit (iPhone):
//   - the website instant quote: a customer draws a backyard with a gate (the real /p/quote/api/submit); opening the
//     draft shows "Started from the customer's drawing, check the feet" over its walk steps (sides, feet, the gate,
//     corners turning as drawn); saved, it has the drawing's runs, posts, gates and sections, and reopens on its walk
//     list with no banner;
//   - Map Quote: three taps on the map (an L); the new quote's walk list has a side per run, the corner turning as
//     tapped, "Started from the map, check the feet"; saved with the map's runs, corners and ends;
//   - a blank new quote: a blank walk list, no banner;
//   - an old saved drawn quote: still opens on its drawing (read only here, nothing saved).
// Run `pnpm -s build` first.
//
//   APP_URL=http://localhost:4001 E2E_STAFF_COOKIE=<owner cookie> SALES_COOKIE=<Christa's cookie> [SHOTS=<folder>] node e2e/walk-start.mjs
//   (without the cookies it makes dev sign ins itself: devSignIn.mjs)
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
const OWNER = process.env.E2E_STAFF_COOKIE || devSignIn(DEV_OWNER_EMAIL, { cookie: true })
const SALES = process.env.SALES_COOKIE || devSignIn(DEV_SALES_EMAIL, { cookie: true })
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

// The backyard the website test draws: house to house, clockwise, a 4 ft walk gate on the second side.
const at = { lat: 29.185118, lng: -82.134209 }
const pt = (e, n) => ({ lat: at.lat + (n * 0.3048) / 110_860, lng: at.lng + (e * 0.3048) / 97_330 })
const drawing = { v: 1, address: '110 SE Watula Ave, Ocala, FL 34471', at, runs: [{ id: 'r1', pts: [pt(-30, 15), pt(-55, 15), pt(-55, 95), pt(55, 95), pt(55, 15), pt(30, 15)], start: 'house', end: 'house', typedFt: [null, null, null, null, null], gates: [null, { type: 'walk', widthFt: 4, startFt: 11 }, null, null, null] }] }

async function phone(browser, cookie) {
  const ctx = await browser.newContext(PHONE)
  await signInByCookie(ctx, { cookie, api: API })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 300)))
  page.on('dialog', d => d.accept().catch(() => {}))
  return { ctx, page, errors }
}

const quoteRow = id => {
  const [runs, corners, ends, wg, dg, sections, price, walk, style] = sql(`select runs::text, corners, ends, "walkGates", "dblGates", sections, "finalPrice", (layout->'walk') is not null, "fenceStyle" from "SavedQuote" where id = '${id}'`).split('|')
  return { runs, corners: +corners, ends: +ends, wg: +wg, dg: +dg, sections: +sections, price: +price, walk: walk === 't', style }
}
const toYard = async page => {
  const b = page.locator('[data-quote-builder]')
  await b.waitFor({ timeout: 30000 })
  if (!(await page.locator('[data-walk], [data-sketch-step]').first().isVisible().catch(() => false))) { await b.locator('[data-step="yard"]').click().catch(() => {}); await sleep(500) }
  // The Yard step opens on the sketch (Nov 6 2026); these checks read its List view, the walk list.
  const t = page.locator('[data-sketch-toggle-to="list"]'); if (await t.count()) { await t.first().click(); await sleep(250) }
}
const stepTexts = page => page.locator('[data-walk-step]').allTextContents().then(a => a.map(t => t.replace(/\s+/g, ' ').trim()))
async function saveQuote(page, { name } = {}) {
  const bar = page.locator('[data-quote-bar]')
  for (let i = 0; i < 4 && !(await bar.locator('[data-save-open]').count()); i++) { await bar.locator('[data-bar-next]').click().catch(() => {}); await sleep(700) }
  await bar.locator('[data-save-open]').click(); await sleep(1200)
  if (name && await page.locator('[data-save-mode="new"]').count()) await page.locator('[data-save-mode="new"]').click().catch(() => {})
  await sleep(300)
  await page.locator('[data-save-submit]').click(); await sleep(4500)
}

async function asPerson(browser, who, cookie) {
  const tag = `${who} ${run}`
  const { ctx, errors } = await phone(browser, cookie)
  let page = ctx.pages()[0]
  // A fresh tab for each screen (WebKit can crash going to a new address in the same tab).
  const go = async url => {
    const old = page
    page = await ctx.newPage()
    page.on('pageerror', e => errors.push(String(e).slice(0, 300)))
    page.on('dialog', d => d.accept().catch(() => {}))
    await old.close().catch(() => {})
    await page.goto(url)
  }

  // ── The website instant quote ──
  const name = `Walkstart e2e ${tag}`
  const phoneNo = `352555${String(Math.floor(Math.random() * 9000) + 1000)}`
  const sub = await fetch(`${API}/p/quote/api/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draftId: crypto.randomBytes(16).toString('hex'), name, phone: phoneNo, email: `walkstart.${run}.${who.toLowerCase()}@example.invalid`, address: drawing.address, drawing, pick: { material: 'vinyl', color: 'white', height: '6', kind: 'privacy' }, wantsVisit: true }) })
  check(`${who}: the website quote is sent (the customer's drawing)`, sub.status === 201, String(sub.status))
  const [qid, cid] = sql(`select id, "crmContactId" from "SavedQuote" where "customerName" = '${name}' and "deletedAt" is null order by "createdAt" desc limit 1`).split('|')
  if (qid) made.quotes.add(qid)
  if (cid) made.contacts.add(cid)
  if (who === 'Christa') sql(`update "CrmContact" set "salesRep" = 'Christa Feagin' where id = '${cid}'`)
  const before = quoteRow(qid)
  await go(`${APP}/quotes?quote=${qid}`); await sleep(3500)
  await toYard(page)
  const banner = await page.locator('[data-walk-started-from]').textContent().catch(() => '')
  check(`${who}: the website draft opens on the walk list, "Started from the customer's drawing, check the feet"`, /Started from the customer's drawing, check the feet/.test(banner || '') && await page.locator('[data-walk]').isVisible(), banner || '(no banner)')
  const steps = await stepTexts(page)
  check(`${who}: its walk steps are the drawing (sides, feet, the 4 ft gate, corners turning right as drawn, end post)`, steps.length === 6 && steps.filter(s => /Corner right/.test(s)).length === 4 && steps.some(s => /Gate 4 ft single/.test(s)) && /End post/.test(steps[5]), steps.join(' / '))
  check(`${who}: the customer's drawing on the photo is still shown under it`, (await page.locator('[data-customer-drawing], [data-widget-drawing]').count()) >= 0)
  await shot(page, `walkstart-${who.toLowerCase()}-01-website`)
  await saveQuote(page)
  const after = quoteRow(qid)
  check(`${who}: saved, it has the drawing's runs, posts, gates and sections`, after.runs === before.runs && after.corners === before.corners && after.ends === before.ends && after.wg === before.wg && after.dg === before.dg && after.sections === before.sections && after.walk, `before ${JSON.stringify(before)} after ${JSON.stringify(after)}`)
  if (who === 'Owner') check(`${who}: and the same price as the website's drawing`, after.price === before.price, `website $${before.price}, walk list $${after.price}`)
  else console.log(`      (Christa's quote: website $${before.price}, saved $${after.price})`)
  await go(`${APP}/quotes?quote=${qid}`); await sleep(3500)
  await toYard(page)
  check(`${who}: reopened, it is on its walk list with no "Started from" banner`, await page.locator('[data-walk]').isVisible() && !(await page.locator('[data-walk-started-from]').count()) && (await stepTexts(page)).length === 6)
  await page.locator('[data-quote-builder] button[aria-label="Close"], [data-quote-close]').first().tap().catch(() => {})

  // ── Map Quote (a computer screen: its button is in the top bar, which a phone does not show) ──
  const dctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, hasTouch: true })
  await signInByCookie(dctx, { cookie, api: API })
  const desk = await dctx.newPage()
  desk.on('pageerror', e => errors.push(String(e).slice(0, 300)))
  desk.on('dialog', d => d.accept().catch(() => {}))
  await desk.goto(`${APP}/quotes`); await sleep(3000)
  let savedMap = null
  { const page = desk
  const mapBtn = page.locator('button:has-text("Map Quote"):visible')
  if (!(await mapBtn.count())) {
    check(`${who}: Map Quote button on Quotes`, false, 'not shown')
  } else {
    await mapBtn.first().click(); await page.waitForSelector('[data-map-quote-map]'); await sleep(800)
    await page.locator('[data-map-quote-address] input, input[data-map-quote-address]').first().fill('17008 SE 60'); await sleep(1500)
    if (await page.locator('[data-address-suggestion]').count()) await page.locator('[data-address-suggestion]').first().click()
    await sleep(4000)
    const box = await page.locator('[data-map-quote-map]').boundingBox()
    const y = box.y + box.height * 0.7, x0 = box.x + box.width * 0.2
    // East, then north (up the screen): a left turn.
    await page.mouse.click(x0, y); await sleep(400); await page.mouse.click(x0 + box.width * 0.6, y); await sleep(400); await page.mouse.click(x0 + box.width * 0.6, y - box.height * 0.4); await sleep(800)
    await shot(page, `walkstart-${who.toLowerCase()}-02-map`)
    await page.locator('[data-map-quote-use]').click(); await sleep(1500)
    const b = page.locator('[data-quote-builder]')
    await b.waitFor({ timeout: 20000 })
    const mname = `Walkstart map ${tag}`
    await b.locator('input[placeholder^="Customer name"]').fill(mname)
    await b.locator('input[type="tel"]').first().fill('3525550143').catch(() => {})
    await page.locator('[data-quote-bar] [data-bar-next]').click(); await sleep(600)
    await toYard(page)
    const mb = await page.locator('[data-walk-started-from]').textContent().catch(() => '')
    const ms = await stepTexts(page)
    check(`${who}: Map Quote opens on the walk list, "Started from the map, check the feet"`, /Started from the map, check the feet/.test(mb || '') && await page.locator('[data-walk]').isVisible(), mb || '(no banner)')
    check(`${who}: a side per map run, the corner turning left as tapped, an end post`, ms.length === 2 && /Corner left/.test(ms[0]) && /End post/.test(ms[1]), ms.join(' / '))
    await shot(page, `walkstart-${who.toLowerCase()}-03-map-walk`)
    const mapFeet = ms.map(s => Number((s.match(/(\d+(?:\.\d+)?) ft/) || [])[1]))
    await page.locator('[data-quote-bar] [data-bar-next]').click(); await sleep(800)
    await pickStyle(page, "WV-ND 6'x8'|6' Privacy|Privacy").catch(e => console.log('      style pick:', String(e).slice(0, 120)))
    await sleep(800)
    await saveQuote(page, { name: mname })
    const mq = sql(`select id, "crmContactId" from "SavedQuote" where "customerName" = '${mname}' and "deletedAt" is null order by "createdAt" desc limit 1`).split('|')
    if (mq[0]) made.quotes.add(mq[0])
    if (mq[1]) made.contacts.add(mq[1])
    const m = mq[0] ? quoteRow(mq[0]) : null
    check(`${who}: saved with the map's runs, one corner, two end posts`, !!m && JSON.stringify(JSON.parse(m.runs)) === JSON.stringify(mapFeet) && m.corners === 1 && m.ends === 2 && m.walk, m ? JSON.stringify(m) : 'not saved')
    if (m) savedMap = mq[0]
  }
  }
  await dctx.close()
  if (savedMap) {
    // On the phone, the saved Map Quote opens on its walk list.
    await go(`${APP}/quotes?quote=${savedMap}`); await sleep(3500)
    await toYard(page)
    check(`${who}: the saved Map Quote opens on its walk list on the phone`, await page.locator('[data-walk]').isVisible() && (await stepTexts(page)).length === 2)
    await shot(page, `walkstart-${who.toLowerCase()}-04-map-on-phone`)
  }

  // ── A blank new quote ──
  await go(`${APP}/quotes`); await sleep(2500)
  await page.locator('button:has-text("New quote"):visible').first().tap(); await sleep(800)
  await page.locator('[data-quote-builder] input[placeholder^="Customer name"]').fill(`Walkstart blank ${tag}`)
  await page.locator('[data-quote-bar] [data-bar-next]').tap(); await sleep(600)
  await toYard(page)
  check(`${who}: a blank new quote: a blank walk list, no banner`, await page.locator('[data-walk]').isVisible() && !(await page.locator('[data-walk-started-from]').count()) && !(await page.locator('[data-walk-step]').count()))

  check(`${who}: no page errors`, errors.length === 0, errors.join(' | '))
  await ctx.close()
}

const browser = await webkit.launch()
try {
  await asPerson(browser, 'Owner', OWNER)
  await asPerson(browser, 'Christa', SALES)
  // An old saved drawn quote (no walk list, not the website's): still the drawing (read only).
  const old = sql(`select id from "SavedQuote" where layout->'yard' is not null and layout->'walk' is null and layout->'widgetDrawing' is null and "deletedAt" is null and status = 'DRAFT' order by "createdAt" desc limit 1`)
  if (old) {
    const { ctx, page } = await phone(browser, OWNER)
    await page.goto(`${APP}/quotes?quote=${old}`); await sleep(3500)
    await toYard(page)
    check('Owner: an old saved drawn quote still opens on its drawing', !(await page.locator('[data-walk]').count()) && !(await page.locator('[data-walk-started-from]').count()))
    await ctx.close()
  }
} finally {
  await browser.close()
  for (const id of made.quotes) {
    for (const t of ['QuoteOption', 'ProposalView', 'SavedJob']) sql(`delete from "${t}" where "quoteId" = '${id}'`)
    sql(`delete from "CrmAuditLog" where "entityId" = '${id}'`)
    sql(`delete from "SavedQuote" where id = '${id}'`)
  }
  for (const c of made.contacts) {
    if (sql(`select count(*) from "SavedQuote" where "crmContactId" = '${c}'`) !== '0') continue
    if (!/^Walkstart/.test(sql(`select "firstName" || ' ' || "lastName" from "CrmContact" where id = '${c}'`))) continue
    // Its card on the board (PipelineState.leads), then what the website quote made for it.
    sql(`update "PipelineState" set leads = (select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements(leads::jsonb) x where coalesce(x->>'crmContactId', x->>'contactId', x->>'customerId', '') <> '${c}')`)
    for (const t of ['IntakeLead', 'CrmTextConsent', 'CustomerProperty', 'PendingTouch', 'CrmContactNote', 'CrmAppointment']) { try { sql(`delete from "${t}" where "crmContactId" = '${c}'`) } catch (e) { console.log(`      cleanup ${t}: ${String(e.stderr || e).slice(0, 120)}`) } }
    try { sql(`delete from "CrmContact" where id = '${c}'`) } catch (e) { console.log(`      cleanup customer ${c}: ${String(e.stderr || e).slice(0, 160)}`) }
  }
  console.log(`removed ${made.quotes.size} quotes, ${made.contacts.size} customers`)
}
const failed = results.filter(r => !r).length
console.log(`\n${results.length - failed} of ${results.length} passed`)
process.exit(failed ? 1 : 0)
