// Sales Pipeline columns drawn a page at a time, on the dev copy (it needs a
// board the size of live: thousands of cards, No Answer over 1,000).
//
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 E2E_ACCESS_TOKEN=<dev token> node e2e/pipeline-paging.mjs
//   (or E2E_STAFF_COOKIE). E2E_SHOTS=<folder> saves screenshots.
//
// Desktop Chromium (1440 x 900):
//   1. No Answer, opened, draws 50 cards and "Show 50 more (50 of N)"; N is
//      its header count and the server's count (GET /api/pipeline/board).
//   2. Every column's header count and total match the server's.
//   3. Show more draws 50 more.
//   4. A card dragged from Lost Sale to just below the drawn No Answer
//      cards lands in No Answer on the server and stays in sight.
//   5. A link to a card deep in No Answer (?card=<id>, past the first page) opens its window.
// iPhone size WebKit (390 x 844, a fresh phone):
//   6. No Answer and Lost Sale start folded; opening No Answer draws 50 and Show more.
// The moved card is put back where it was (stage, place) at the end.
import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import { chromium, webkit } from 'playwright'
import { signInByCookie, APP, API, sleep } from './lib.mjs'

const SHOTS = process.env.E2E_SHOTS || ''
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const col = key => `[data-kanban-col="${key}"]`
const fmtUSD = n => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
const NA = 'No Answer', FROM = 'Lost Sale' // the column next to No Answer, so both are in sight

async function open(engine, phone) {
  const browser = await engine.launch()
  const ctx = await browser.newContext(phone
    ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' }
    : { viewport: { width: 1440, height: 900 } })
  await signInByCookie(ctx)
  // A stage change asks the server to run automations; the dev data holds real customers.
  await ctx.route('**/api/automations/trigger', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true,"data":{"matched":0}}' }))
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)))
  page.on('dialog', d => d.accept().catch(() => {}))
  return { browser, ctx, page, phone, errors }
}
const get = async (s, path) => (await s.ctx.request.get(`${API}${path}`)).json()

async function toBoard(s, url = APP + '/pipeline') {
  await s.page.goto(url)
  await s.page.waitForSelector('[data-kanban-board] [data-kanban-col]', { timeout: 60000 })
  await sleep(500)
}
async function unfold(s, key) {
  if (await s.page.locator(`${col(key)}[data-collapsed="true"]`).count()) {
    await s.page.locator(`${col(key)} button`).first().click()
    await s.page.waitForSelector(`${col(key)}:not([data-collapsed]) [data-kanban-card]`, { timeout: 10000 })
  }
}
const drawn = (s, key) => s.page.locator(`${col(key)} [data-kanban-card]`).count()

let moved = null // { before: card as it was, version }
const desktop = await open(chromium, false)
try {
  const s = desktop
  await toBoard(s)
  const board = await get(s, '/api/pipeline/board?per=50')
  const server = Object.fromEntries(board.data.columns.map(c => [c.stage, c]))
  const naCount = server[NA]?.count ?? 0
  check('dev board is live sized (No Answer over 1,000 cards)', naCount > 1000, `${naCount}`)

  // 1.
  await unfold(s, NA)
  const more = s.page.locator(`[data-kanban-more="${NA}"]`)
  check('No Answer draws 50 cards', (await drawn(s, NA)) === 50, `${await drawn(s, NA)}`)
  const moreText = (await more.textContent())?.replace(/\s+/g, ' ').trim()
  check('Show more says how many', moreText === `Show 50 more (50 of ${naCount})`, moreText)
  const headCount = Number(await s.page.locator(`${col(NA)} [data-kanban-count]`).textContent())
  check('header count = server count', headCount === naCount, `${headCount} vs ${naCount}`)

  // 2.
  const bad = []
  for (const c of board.data.columns) {
    const el = s.page.locator(col(c.stage))
    if (!(await el.count())) { bad.push(`${c.stage}: no column`); continue }
    const text = (await el.first().textContent()) || ''
    const folded = await s.page.locator(`${col(c.stage)}[data-collapsed="true"]`).count()
    const count = folded ? Number(text.match(/^\d+/)?.[0]) : Number(await s.page.locator(`${col(c.stage)} [data-kanban-count]`).textContent())
    if (count !== c.count) bad.push(`${c.stage}: count ${count} vs ${c.count}`)
    if (c.total > 0 && !text.includes(fmtUSD(c.total))) bad.push(`${c.stage}: total ${fmtUSD(c.total)} not shown`)
  }
  check('every column: count and total as the server has them', bad.length === 0, bad.join('; '))

  // 3.
  await more.click()
  await sleep(300)
  check('Show more draws 50 more', (await drawn(s, NA)) === 100, `${await drawn(s, NA)}`)
  if (SHOTS) await s.page.screenshot({ path: `${SHOTS}/paging-desktop.png` })

  // 4. Drag the first Lost Sale card to just below the drawn No Answer cards.
  await unfold(s, FROM)
  const all = await get(s, '/api/pipeline')
  const firstId = await s.page.locator(`${col(FROM)} [data-kanban-card]`).first().getAttribute('data-kanban-card')
  if (!firstId) check('a Lost Sale card to move', false)
  else {
    moved = { before: all.data.leads.find(l => l.id === firstId) }
    await s.page.locator(`${col(NA)} [data-kanban-scroll]`).evaluate(el => { el.scrollTop = el.scrollHeight })
    await s.page.locator(col(NA)).evaluate(el => el.scrollIntoView({ block: 'nearest', inline: 'end' }))
    await sleep(200)
    const from = await s.page.locator(`[data-kanban-card="${firstId}"]`).boundingBox()
    const to = await more.boundingBox()
    await s.page.mouse.move(from.x + from.width / 2, from.y + 20)
    await s.page.mouse.down()
    const tx = to.x + to.width / 2, ty = to.y + 2
    for (let i = 1; i <= 12; i++) { await s.page.mouse.move(from.x + from.width / 2 + (tx - from.x - from.width / 2) * i / 12, from.y + 20 + (ty - from.y - 20) * i / 12); await sleep(20) }
    await sleep(300)
    await s.page.mouse.up()
    let stage = null
    for (let i = 0; i < 30 && stage !== NA; i++) { await sleep(500); stage = (await get(s, '/api/pipeline')).data.leads.find(l => l.id === firstId)?.stage }
    check('card dragged into the paged No Answer column is saved there', stage === NA, stage)
    check('the dropped card is drawn (not hidden under Show more)', (await s.page.locator(`${col(NA)} [data-kanban-card="${firstId}"]`).count()) === 1)
  }

  // 5. A link to a card past the first page.
  const page2 = await get(s, `/api/pipeline/column/${encodeURIComponent(NA)}?offset=200&limit=1`)
  const deepId = page2.data.cards[0]?.id
  await toBoard(s, `${APP}/pipeline?card=${encodeURIComponent(deepId)}`)
  const win = await s.page.waitForSelector(`[data-card-window="${deepId}"]`, { timeout: 15000 }).then(() => true).catch(() => false)
  check('a link to a card deep in No Answer opens its window', win, deepId)
  check('no page errors (desktop)', s.errors.length === 0, s.errors.join(' | '))
} catch (e) {
  check('desktop run', false, String(e).slice(0, 300))
} finally {
  // Put the moved card back: its stage, date and place as they were.
  if (moved?.before) {
    for (let i = 0; i < 3; i++) {
      const cur = await get(desktop, '/api/pipeline')
      const now = cur.data.leads.find(l => l.id === moved.before.id)
      if (!now || now.stage === moved.before.stage) break
      const r = await desktop.ctx.request.patch(`${API}/api/pipeline`, { headers: { 'X-Staff-Request': '1' }, data: { upsert: [{ lead: moved.before }], remove: [], baseVersion: cur.data.version } })
      if (r.ok()) { console.log(`(put ${moved.before.id} back in ${moved.before.stage})`); break }
      await sleep(500)
    }
  }
  await desktop.browser.close()
}

// 6. A fresh phone.
const phone = await open(webkit, true)
try {
  const s = phone
  await s.page.goto(APP + '/')
  await s.page.waitForSelector('[data-tabbar]', { timeout: 60000 })
  await s.page.locator('[data-tabbar] button:has-text("Pipeline")').click()
  await s.page.waitForSelector('[data-kanban-board] [data-kanban-col]', { timeout: 60000 })
  await sleep(500)
  check('phone: No Answer starts folded', (await s.page.locator(`${col(NA)}[data-collapsed="true"]`).count()) === 1)
  check('phone: Lost Sale starts folded', (await s.page.locator(`${col('Lost Sale')}[data-collapsed="true"]`).count()) === 1)
  await unfold(s, NA)
  check('phone: No Answer opened draws 50 and Show more', (await drawn(s, NA)) === 50 && (await s.page.locator(`[data-kanban-more="${NA}"]`).count()) === 1, `${await drawn(s, NA)}`)
  await s.page.locator(`[data-kanban-more="${NA}"]`).tap()
  await sleep(300)
  check('phone: Show more draws 50 more', (await drawn(s, NA)) === 100, `${await drawn(s, NA)}`)
  if (SHOTS) await s.page.screenshot({ path: `${SHOTS}/paging-phone.png` })
  check('no page errors (phone)', s.errors.length === 0, s.errors.join(' | '))
} catch (e) {
  check('phone run', false, String(e).slice(0, 300))
} finally { await phone.browser.close() }

const passed = results.filter(Boolean).length
console.log(`\n${passed}/${results.length} checks passed`)
process.exit(passed === results.length ? 0 : 1)
