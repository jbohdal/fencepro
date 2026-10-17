// Drag and drop on the Sales Pipeline board, at desktop and phone sizes.
// See README.md in this folder.
//
// Unlike the other scripts this one needs real pipeline data: a First Contact
// column with a few cards and a Pending Signature column long enough to
// scroll. It moves a handful of cards, so run it on the dev copy only.
//
//   APP_URL=http://localhost:5173 API_URL=http://localhost:4001 \
//     E2E_EMAIL=... E2E_PASSWORD=... node kanban-drag.mjs
//
// E2E_ACCESS_TOKEN (a staff access token for the dev server) can stand in for
// the email and password.
import { chromium } from 'playwright'

const APP = process.env.APP_URL || 'http://localhost:5173'
const API = process.env.API_URL || 'http://localhost:4001'
const EMAIL = process.env.E2E_EMAIL || ''
const PASSWORD = process.env.E2E_PASSWORD || ''
const TOKEN = process.env.E2E_ACCESS_TOKEN || ''
const SHOTS = process.env.E2E_SHOTS || ''

const local = u => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(u)
if (!local(APP) || !local(API)) { console.error('Refusing to run: APP_URL and API_URL must be localhost. This test moves pipeline cards.'); process.exit(2) }
if (/:4000(\/|$)/.test(API)) { console.error('Refusing to run: port 4000 is the live server.'); process.exit(2) }
if (!TOKEN && (!EMAIL || !PASSWORD)) { console.error('Set E2E_EMAIL and E2E_PASSWORD, or E2E_ACCESS_TOKEN.'); process.exit(2) }

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
function check(name, ok, detail = '') { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }

const col = key => `[data-kanban-col="${key}"]`

async function open(browser, phone) {
  const ctx = await browser.newContext(phone
    ? { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, hasTouch: true, isMobile: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-S918U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36' }
    : { viewport: { width: 1440, height: 900 } })
  if (TOKEN) await ctx.addInitScript(t => { localStorage.setItem('crm_access_token', t); if (!localStorage.getItem('crm_refresh_token')) localStorage.setItem('crm_refresh_token', 'e2e') }, TOKEN)
  const page = await ctx.newPage()
  const s = { ctx, page, phone, errors: [], saves: [], sent: [], token: TOKEN }
  page.on('pageerror', e => s.errors.push(String(e).slice(0, 300)))
  page.on('dialog', d => d.accept().catch(() => {}))
  page.on('response', r => { if (r.url() === `${API}/api/pipeline` && r.request().method() !== 'GET') { s.saves.push(r.status()); s.sent.push(r.request().postData()?.length || 0) } })
  page.on('request', r => { const a = r.headers()['authorization']; if (a && r.url().startsWith(API)) s.token = a.replace(/^Bearer /, '') })
  // A stage change asks the server to run automations. The dev data holds real
  // customers, so that request never leaves the browser here.
  await page.route('**/api/automations/trigger', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true,"data":{"matched":0}}' }))
  await page.goto(APP)
  if (!TOKEN) {
    await page.waitForSelector('input[type="email"]', { timeout: 15000 })
    await page.fill('input[type="email"]', EMAIL)
    await page.fill('input[type="password"]', PASSWORD)
    await page.click('button[type="submit"]')
  }
  await page.waitForSelector(phone ? '[data-tabbar]' : '[data-global-appointment]', { timeout: 30000 })
  await goPipeline(s)
  s.touch = phone ? await ctx.newCDPSession(page) : null
  return s
}

async function goPipeline(s) {
  if (s.phone) await s.page.locator('[data-tabbar] button:has-text("Pipeline")').click()
  else await s.page.locator('span:text-is("Sales Pipeline"):visible').first().click()
  await s.page.waitForSelector('[data-kanban-board]', { timeout: 15000 })
  await sleep(500)
}

async function serverLeads(s) {
  const r = await fetch(`${API}/api/pipeline`, { headers: { Authorization: `Bearer ${s.token}` } })
  const j = await r.json()
  return { leads: j.data.leads, version: j.data.version }
}
const stageOnServer = async (s, id) => (await serverLeads(s)).leads.find(l => l.id === id)?.stage

/** One pointer for both sizes: the mouse on desktop, a finger on the phone. */
function pointer(s) {
  let at = { x: 0, y: 0 }
  const touch = (type, pts) => s.touch.send('Input.dispatchTouchEvent', { type, touchPoints: pts })
  return {
    async down(x, y, { hold = true } = {}) {
      at = { x, y }
      if (s.phone) { await touch('touchStart', [{ x, y }]); if (hold) await sleep(450) }   // long press
      else { await s.page.mouse.move(x, y); await s.page.mouse.down() }
    },
    async move(x, y, steps = 6) {
      for (let i = 1; i <= steps; i++) {
        const p = { x: at.x + (x - at.x) * i / steps, y: at.y + (y - at.y) * i / steps }
        if (s.phone) await touch('touchMove', [p]); else await s.page.mouse.move(p.x, p.y)
        await sleep(16)
      }
      at = { x, y }
    },
    async up() { if (s.phone) await touch('touchEnd', []); else await s.page.mouse.up() },
  }
}

const rect = (s, sel) => s.page.locator(sel).first().evaluate(el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height } })
const cardIds = (s, key) => s.page.locator(`${col(key)} [data-kanban-card]`).evaluateAll(els => els.map(e => e.dataset.kanbanCard))
const boardLeft = s => s.page.locator('[data-kanban-board]').evaluate(el => el.scrollLeft)
const colTop = (s, key) => s.page.locator(`${col(key)} [data-kanban-scroll]`).evaluate(el => el.scrollTop)
const shot = async (s, name) => { if (SHOTS) await s.page.screenshot({ path: `${SHOTS}/${s.phone ? 'phone' : 'desktop'}-${name}.png` }) }

/** Bring a column to the top and the board to where it shows. */
async function showCard(s, key) {
  await s.page.locator(`${col(key)} [data-kanban-scroll]`).evaluate(el => { el.scrollTop = 0 })
  await s.page.locator(col(key)).evaluate(el => el.scrollIntoView({ block: 'nearest', inline: 'center' }))
  await sleep(150)
}

/**
 * Pick up the card and carry it to another column, letting the board scroll
 * itself at its edge until that column is on screen. Leaves the card held.
 */
async function carryToColumn(s, p, cardId, destKey) {
  const c = await rect(s, `[data-kanban-card="${cardId}"]`)
  await p.down(c.left + c.width / 2, c.top + Math.min(30, c.height / 2))
  await p.move(c.left + c.width / 2 + 14, c.top + 40, 3)
  const board = await rect(s, '[data-kanban-board]')
  const midY = Math.min(board.bottom - 60, Math.max(board.top + 120, c.top + 40))
  let autoScrolled = false
  for (let i = 0; i < 400; i++) {
    const d = await rect(s, col(destKey))
    const { left, max } = await s.page.locator('[data-kanban-board]').evaluate(el => ({ left: el.scrollLeft, max: el.scrollWidth - el.clientWidth }))
    const inView = d.left >= board.left - 1 && d.right <= board.right + 1
    if (inView || (d.left > board.right && left >= max - 1) || (d.right < board.left && left <= 0)) break
    // Hold the card at the edge on the column's side and wait for the board to move.
    const before = left
    await p.move(d.left > board.left ? board.right - 10 : board.left + 10, midY, 2)
    await sleep(60)
    if ((await boardLeft(s)) !== before) autoScrolled = true
  }
  // Onto the column itself; it may still be sliding, so follow it.
  for (let i = 0; i < 12; i++) {
    const d = await rect(s, col(destKey))
    await p.move(d.left + d.width / 2, midY, 3)
    await sleep(80)
    const now = await rect(s, col(destKey))
    if (now.left <= d.left + d.width / 2 && now.right >= d.left + d.width / 2 && Math.abs(now.left - d.left) < 1) break
  }
  return { autoScrolled, midY }
}

async function dropAndWaitForSave(s, p) {
  const before = s.saves.length
  await p.up()
  for (let i = 0; i < 60 && !(s.saves.length > before && s.saves[s.saves.length - 1] === 200); i++) await sleep(100)
  await sleep(150)
  return s.saves.slice(before)
}

async function run(browser, phone) {
  const size = phone ? 'phone' : 'desktop'
  const s = await open(browser, phone)
  const p = pointer(s)
  const stages = await s.page.locator('[data-kanban-col]').evaluateAll(els => els.map(e => e.dataset.kanbanCol))
  console.log(`\n── ${size} (${s.page.viewportSize().width}x${s.page.viewportSize().height}) ──`)
  await shot(s, '1-board')

  /* layout */
  const lefts = await s.page.locator('[data-kanban-col]').evaluateAll(els => els.map(e => e.getBoundingClientRect().left))
  check(`${size}: stages are columns running left to right`, lefts.every((x, i) => i === 0 || x > lefts[i - 1]) && stages[0] === 'First Contact', stages.join(' > '))
  check(`${size}: Lost Sale and No Answer come after Paid & Closed`, stages.slice(-3).join('|') === 'Paid & Closed|Lost Sale|No Answer')
  const collapsedNow = await s.page.locator('[data-kanban-col][data-collapsed="true"]').evaluateAll(els => els.map(e => e.dataset.kanbanCol))
  check(`${size}: Paid & Closed, Lost Sale and No Answer start collapsed`, collapsedNow.join('|') === 'Paid & Closed|Lost Sale|No Answer', collapsedNow.join(', '))
  const widths = await s.page.locator('[data-kanban-col]:not([data-collapsed])').evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().width)))
  check(`${size}: open columns are 300px wide`, widths.every(w => w === 300), [...new Set(widths)].join(','))
  const pageScroll = await s.page.locator('[data-kanban-board]').evaluate(el => {
    for (let n = el.parentElement; n; n = n.parentElement) if (n.scrollHeight > n.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(n).overflowY)) return n.scrollHeight - n.clientHeight
    return 0
  })
  check(`${size}: the page itself does not scroll, only the board`, pageScroll === 0, `page overflow ${pageScroll}px`)
  const b = await s.page.locator('[data-kanban-board]').evaluate(el => ({ sw: el.scrollWidth, cw: el.clientWidth, barH: el.offsetHeight - el.clientHeight, bottom: el.getBoundingClientRect().bottom, vh: innerHeight }))
  check(`${size}: the board scrolls sideways and ends inside the screen`, b.sw > b.cw && b.bottom <= b.vh, `board ${b.sw}px wide in ${b.cw}px, bottom ${Math.round(b.bottom)} of ${b.vh}`)
  if (!phone) check('desktop: a slim scrollbar runs along the bottom of the board', b.barH > 0 && b.barH <= 12, `${b.barH}px`)
  const long = 'Pending Signature'
  const head = await s.page.locator(`${col(long)} > button`).innerText()
  const longIds = await cardIds(s, long)
  check(`${size}: the column header shows name, count and total`, head.includes(long) && head.includes(String(longIds.length)) && /\$/.test(head), head.replace(/\s+/g, ' '))

  /* scrolling without dragging */
  await showCard(s, long)
  const lr = await rect(s, `${col(long)} [data-kanban-scroll]`)
  if (!phone) {
    await s.page.mouse.move(lr.left + 150, lr.top + 200)
    const left0 = await boardLeft(s)
    await s.page.mouse.wheel(0, 500); await sleep(300)
    const top1 = await colTop(s, long)
    check('desktop: the wheel scrolls the column under the cursor', top1 > 0 && (await boardLeft(s)) === left0, `column moved ${top1}px, board stayed`)
    const headTop = (await rect(s, `${col(long)} > button`)).top
    check('desktop: the header stays put while its column scrolls', Math.abs(headTop - (lr.top - (await rect(s, `${col(long)} > button`)).height)) < 2)
    await s.page.keyboard.down('Shift'); await s.page.mouse.wheel(0, 400); await s.page.keyboard.up('Shift'); await sleep(300)
    const left1 = await boardLeft(s)
    check('desktop: Shift + wheel scrolls the board sideways', left1 !== left0, `${left0} to ${left1}`)
    await s.page.mouse.wheel(400, 0); await sleep(300)
    check('desktop: a sideways swipe scrolls the board sideways', (await boardLeft(s)) !== left1, `${left1} to ${await boardLeft(s)}`)
  } else {
    const left0 = await boardLeft(s)
    await p.down(lr.left + 200, lr.top + 300, { hold: false }); await p.move(lr.left + 20, lr.top + 300, 10); await p.up(); await sleep(500)
    const left1 = await boardLeft(s)
    check('phone: a swipe moves between columns', left1 !== left0, `${left0} to ${Math.round(left1)}`)
    await showCard(s, long)
    const r2 = await rect(s, `${col(long)} [data-kanban-scroll]`)
    await p.down(r2.left + 150, r2.top + 400, { hold: false }); await p.move(r2.left + 150, r2.top + 100, 10); await p.up(); await sleep(500)
    check('phone: a swipe up scrolls the column, no card picked up', (await colTop(s, long)) > 0 && (await cardIds(s, long)).join() === longIds.join())
  }

  /* 1. First Contact -> a column that starts off screen to the right */
  const far = 'Pending Start'
  await s.page.locator('[data-kanban-board]').evaluate(el => { el.scrollLeft = 0 })
  await showCard(s, 'First Contact')
  await s.page.locator('[data-kanban-board]').evaluate(el => { el.scrollLeft = 0 })
  const board = await rect(s, '[data-kanban-board]')
  const farBefore = await rect(s, col(far))
  const [a] = await cardIds(s, 'First Contact')
  let c = await carryToColumn(s, p, a, far)
  const ph1 = await s.page.locator(`${col(far)} [data-kanban-placeholder]`).count()
  await shot(s, '2-held-over-far-column')
  let saves = await dropAndWaitForSave(s, p)
  check(`${size}: First Contact to ${far}, which started off screen to the right`, farBefore.left >= board.right && c.autoScrolled && (await stageOnServer(s, a)) === far,
    `column started at x=${Math.round(farBefore.left)} (board ends ${Math.round(board.right)}), board scrolled itself: ${c.autoScrolled}, saved stage: ${await stageOnServer(s, a)}, saves: ${saves.join(',')}`)
  check(`${size}: a placeholder showed where the card would land`, ph1 === 1)

  /* 2. within the long column, to a spot below the visible area */
  await showCard(s, long)
  const ids = await cardIds(s, long)
  const mover = ids[0], anchor = ids[Math.min(ids.length - 2, 30)]
  const sc = await rect(s, `${col(long)} [data-kanban-scroll]`)
  const anchorBefore = await rect(s, `[data-kanban-card="${anchor}"]`)
  const m = await rect(s, `[data-kanban-card="${mover}"]`)
  await p.down(m.left + m.width / 2, m.top + 30)
  await p.move(m.left + m.width / 2 + 10, m.top + 60, 3)
  let colScrolled = false
  for (let i = 0; i < 400; i++) {
    const an = await rect(s, `[data-kanban-card="${anchor}"]`)
    if (an.bottom < sc.bottom - sc.height * 0.2) break
    const before = await colTop(s, long)
    await p.move(m.left + m.width / 2, sc.bottom - 8, 2)   // hold at the bottom edge
    await sleep(60)
    if ((await colTop(s, long)) !== before) colScrolled = true
  }
  for (let i = 0; i < 12; i++) {
    const an = await rect(s, `[data-kanban-card="${anchor}"]`)
    await p.move(m.left + m.width / 2, an.top + an.height * 0.8, 3)   // lower half: lands just under it
    await sleep(80)
    if (Math.abs((await rect(s, `[data-kanban-card="${anchor}"]`)).top - an.top) < 1) break
  }
  const ph2 = await s.page.locator(`${col(long)} [data-kanban-placeholder]`).count()
  await shot(s, '3-held-deep-in-long-column')
  saves = await dropAndWaitForSave(s, p)
  const after = await cardIds(s, long)
  const onServer = (await serverLeads(s)).leads.filter(l => l.stage === long && l.boardOrder?.stage === long).sort((x, y) => x.boardOrder.rank - y.boardOrder.rank).map(l => l.id)
  check(`${size}: within ${long} (${ids.length} cards) to a spot below the visible area`,
    anchorBefore.top > sc.bottom && colScrolled && after[after.indexOf(anchor) + 1] === mover && onServer[onServer.indexOf(anchor) + 1] === mover,
    `target card started ${Math.round(anchorBefore.top - sc.bottom)}px below the column, column scrolled itself: ${colScrolled}, card moved from position 1 to ${after.indexOf(mover) + 1}, saved order matches: ${onServer[onServer.indexOf(anchor) + 1] === mover}, saves: ${saves.join(',')}`)
  check(`${size}: placeholder shown inside the long column`, ph2 === 1)

  /* 3. into a collapsed column */
  const strip = 'No Answer'
  await s.page.locator('[data-kanban-board]').evaluate(el => { el.scrollLeft = 0 })
  await showCard(s, 'First Contact')
  await s.page.locator('[data-kanban-board]').evaluate(el => { el.scrollLeft = 0 })
  const [d] = await cardIds(s, 'First Contact')
  const stripBefore = await s.page.locator(col(strip)).evaluate(el => ({ collapsed: el.dataset.collapsed === 'true', left: el.getBoundingClientRect().left }))
  c = await carryToColumn(s, p, d, strip)
  const ph3 = await s.page.locator(`${col(strip)} [data-kanban-placeholder]`).count()
  await shot(s, '4-held-over-collapsed-column')
  saves = await dropAndWaitForSave(s, p)
  check(`${size}: dropped into the collapsed ${strip} column`, stripBefore.collapsed && ph3 === 1 && (await stageOnServer(s, d)) === strip,
    `collapsed: ${stripBefore.collapsed}, started at x=${Math.round(stripBefore.left)}, placeholder: ${ph3 === 1}, saved stage: ${await stageOnServer(s, d)}, saves: ${saves.join(',')}`)

  /* 4. onto a column header */
  await s.page.locator('[data-kanban-board]').evaluate(el => { el.scrollLeft = 0 })
  await showCard(s, 'Appointment')
  const [h] = await cardIds(s, 'Appointment')
  await carryToColumn(s, p, h, 'Estimating')
  for (let i = 0; i < 8; i++) {
    const eh = await rect(s, `${col('Estimating')} > button`)
    await p.move(eh.left + eh.width / 2, eh.top + eh.height / 2, 4); await sleep(100)
    if (Math.abs((await rect(s, `${col('Estimating')} > button`)).left - eh.left) < 1) break
  }
  saves = await dropAndWaitForSave(s, p)
  check(`${size}: dropped on the Estimating column header`, (await stageOnServer(s, h)) === 'Estimating', `saved stage: ${await stageOnServer(s, h)}`)

  /* Signed Contract still asks first */
  await showCard(s, 'Estimating')
  const est = await cardIds(s, 'Estimating')
  const q = est[est.length - 1]
  await s.page.locator(`[data-kanban-card="${q}"]`).scrollIntoViewIfNeeded()
  await carryToColumn(s, p, q, 'Signed Contract')
  await p.up(); await sleep(300)
  const asked = await s.page.locator('text=Mark this deal as sold?').count()
  if (asked) await s.page.locator('button:text-is("Cancel")').click()
  await sleep(200)
  check(`${size}: dropping on Signed Contract still asks for confirmation, Cancel leaves the card`, asked === 1 && (await stageOnServer(s, q)) === 'Estimating')

  /* the rest of the card still works */
  await showCard(s, 'Appointment')
  const [k] = await cardIds(s, 'Appointment')
  const eye = s.page.locator(`[data-kanban-card="${k}"] button[aria-label="Quick view"]`)
  if (phone) await eye.tap(); else await eye.click()
  await sleep(400)
  const drawer = (await s.page.locator('text=/move to stage/i').count()) > 0 && (await s.page.locator('button:text-is("Pending Signature")').count()) > 0
  check(`${size}: the eye icon opens the quick view with its stage picker`, drawer)
  await shot(s, '5-quick-view')
  await s.page.keyboard.press('Escape')
  await s.page.reload(); await s.page.waitForSelector(s.phone ? '[data-tabbar]' : '[data-global-appointment]', { timeout: 30000 }); await goPipeline(s)
  await showCard(s, 'Appointment')
  const kc = s.page.locator(`[data-kanban-card="${k}"]`)
  if (phone) await kc.tap({ position: { x: 60, y: 14 } }); else await kc.click({ position: { x: 60, y: 14 } })
  await sleep(700)
  // A card click opens the card window; its "Customer page" button opens the full page.
  const win = (await s.page.locator("[data-card-window]").count()) > 0
  if (win) await s.page.locator('[data-card-open-customer]').click()
  await sleep(700)
  const onCustomer = await s.page.locator('text=/Back to pipeline/i').count()
  check(`${size}: a card click opens the card window, and Customer page opens the full customer page`, win && onCustomer > 0)
  if (onCustomer) { await s.page.locator('text=/Back to pipeline/i').first().click(); await s.page.waitForSelector('[data-kanban-board]'); await sleep(300) }
  // Back returns to the card window it came from; close it.
  if (await s.page.locator('[data-card-window]').count()) { await s.page.locator('[data-card-window] button[aria-label="Close"]').first().click(); await sleep(300) }

  /* collapsed columns are remembered on this device */
  await s.page.locator(`${col('First Contact')} > button`).click()
  await s.page.locator(`${col(strip)} button`).click(); await sleep(200)
  await s.page.reload(); await s.page.waitForSelector(s.phone ? '[data-tabbar]' : '[data-global-appointment]', { timeout: 30000 }); await goPipeline(s)
  const remembered = await s.page.locator('[data-kanban-col][data-collapsed="true"]').evaluateAll(els => els.map(e => e.dataset.kanbanCol))
  check(`${size}: collapsed columns are remembered after a reload`, remembered.includes('First Contact') && !remembered.includes(strip), remembered.join(', '))
  check(`${size}: every move is still there after the reload`,
    (await cardIds(s, far)).includes(a) && (await cardIds(s, strip)).includes(d) && (await cardIds(s, 'Estimating')).includes(h) && (await cardIds(s, long))[after.indexOf(mover)] === mover)
  await s.page.locator(`${col('First Contact')} button`).click()
  await s.page.locator(`${col(strip)} > button`).click(); await sleep(200)

  /* search, filters, list view */
  if (!phone) {
    const name = (await s.page.locator(`[data-kanban-card="${k}"] p`).first().innerText()).trim()
    await s.page.fill('input[placeholder="Search..."]', name); await sleep(300)
    const shown = await s.page.locator('[data-kanban-card]').count()
    check('desktop: search narrows the board', shown >= 1 && shown < 20 && (await s.page.locator(`[data-kanban-card="${k}"]`).count()) === 1, `${shown} cards for "${name}"`)
    await s.page.fill('input[placeholder="Search..."]', ''); await sleep(200)
  }
  await s.page.locator('button:text-is("list")').click(); await sleep(300)
  check(`${size}: list view still opens`, (await s.page.locator('[data-kanban-board]').count()) === 0 && (await s.page.locator(phone ? '.md\\:hidden button' : 'tbody tr').count()) > 10)
  await s.page.locator('button:text-is("board")').click(); await sleep(300)

  check(`${size}: no page errors`, s.errors.length === 0, s.errors.join(' | '))
  return s
}

/** Two browsers: the second saves from a stale copy and must be merged, not overwrite. */
async function mergeCheck(browser) {
  console.log('\n── version check and merge on save ──')
  const A = await open(browser, false), B = await open(browser, false)
  const pa = pointer(A), pb = pointer(B)
  const drop = async (s, p, from, to) => {
    await showCard(s, from)
    const ids = await cardIds(s, from), id = ids[ids.length - 1]
    await s.page.locator(`[data-kanban-card="${id}"]`).scrollIntoViewIfNeeded()
    await carryToColumn(s, p, id, to)
    await dropAndWaitForSave(s, p)
    return id
  }
  const v0 = (await serverLeads(A)).version
  const x = await drop(A, pa, 'Appointment', 'Estimating')
  const y = await drop(B, pb, 'Pending Signature', 'Estimating')   // B never saw A's save
  await sleep(1500)
  const { leads, version } = await serverLeads(A)
  const st = id => leads.find(l => l.id === id)?.stage
  check('merge: a save from a stale browser is refused once, then merged', B.saves.includes(409) && B.saves[B.saves.length - 1] === 200, `browser B saves: ${B.saves.join(',')}`)
  check('merge: a save sends the changed cards, not the whole pipeline', Math.max(...A.sent, ...B.sent) < JSON.stringify(leads).length / 4 || leads.length < 20, `largest save ${Math.max(...A.sent, ...B.sent)} bytes, whole pipeline ${JSON.stringify(leads).length} bytes`)
  check('merge: both moves are on the server', st(x) === 'Estimating' && st(y) === 'Estimating', `version ${v0} to ${version}`)
  await A.ctx.close(); await B.ctx.close()
}

// Playwright hides scrollbars in headless mode; the board's own scrollbar is part of what is checked.
/** The tests start from cards in First Contact. If the copy has too few, move some
 *  Lost Sale cards there first (dev copy only), through the normal version checked save. */
async function ensureFirstContact(token, need = 3) {
  const get = async () => (await (await fetch(`${API}/api/pipeline`, { headers: { Authorization: `Bearer ${token}` } })).json()).data
  const d = await get()
  const have = d.leads.filter(l => l.stage === 'First Contact' && l.customerId).length
  if (have >= need) return
  const pick = d.leads.filter(l => l.stage === 'Lost Sale' && l.customerId).slice(0, need - have)
  const upsert = pick.map(l => ({ lead: { ...l, stage: 'First Contact', lastMoved: new Date().toISOString().slice(0, 10) } }))
  const r = await fetch(`${API}/api/pipeline`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ upsert, remove: [], baseVersion: d.version }) })
  console.log(`setup: moved ${pick.length} Lost Sale card(s) to First Contact on the test copy (${r.status})`)
}

const browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] })
await ensureFirstContact(TOKEN, 6)
const only = process.env.E2E_ONLY || ''
try {
  if (!only || only === 'desktop') await (await run(browser, false)).ctx.close()
  if (!only || only === 'phone') await (await run(browser, true)).ctx.close()
  if (!only || only === 'merge') await mergeCheck(browser)
} catch (err) {
  check('test run finished', false, String(err?.stack || err).slice(0, 600))
}
await browser.close()
const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length} of ${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
