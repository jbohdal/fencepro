// The customer's phone number on Sales Pipeline cards and at the top of the
// card window, at phone size (390x844, touch) and desktop. See README.md.
//
//   - shown under the address as (352) 555 1234, a tel: link
//   - tapping it calls (the link is followed) and does not open the card
//   - a card with no phone has no number and no empty line: it is the height
//     a card with a number is with the number taken out
//   - the card window shows it under the address
//   - a drag that starts on the number still moves the card; a tap on the
//     rest of the card still opens it
//
// It moves one card and puts it back, so run it on the dev copy only.
//
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 E2E_ACCESS_TOKEN=... node card-phone.mjs
//
// E2E_SHOTS=<folder> saves dev-card-phone.png (phone), dev-card-phone-desktop.png
// and dev-card-window-phone-number.png there.
import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import { chromium } from 'playwright'

const APP = process.env.APP_URL || 'http://localhost:5173'
const API = process.env.API_URL || 'http://localhost:4001'
const TOKEN = process.env.E2E_ACCESS_TOKEN || ''
const SHOTS = process.env.E2E_SHOTS || ''

const local = u => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(u)
if (!local(APP) || !local(API)) { console.error('Refusing to run: APP_URL and API_URL must be localhost. This test moves a pipeline card.'); process.exit(2) }
if (/:4000(\/|$)/.test(API)) { console.error('Refusing to run: port 4000 is the live server.'); process.exit(2) }
if (!TOKEN) { console.error('Set E2E_ACCESS_TOKEN (a staff access token for the dev server).'); process.exit(2) }

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
function check(name, ok, detail = '') { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }

const col = key => `[data-kanban-col="${key}"]`
const FORMAT = /^\(\d{3}\) \d{3} \d{4}$/
const digits = s => String(s || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '')

const api = async (method, path, body) => {
  const r = await fetch(`${API}${path}`, { method, headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  return { status: r.status, json: await r.json().catch(() => ({})) }
}
const serverLeads = async () => (await api('GET', '/api/pipeline')).json.data
const stageOnServer = async id => (await serverLeads()).leads.find(l => l.id === id)?.stage

async function open(browser, phone) {
  const ctx = await browser.newContext(phone
    ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' }
    : { viewport: { width: 1440, height: 900 } })
  await ctx.addInitScript(t => { localStorage.setItem('crm_access_token', t); if (!localStorage.getItem('crm_refresh_token')) localStorage.setItem('crm_refresh_token', 'e2e') }, TOKEN)
  // A tel: link would hand off to the phone app. Record where it went and stay
  // on the page; capture runs before the app's own handlers, which still run.
  await ctx.addInitScript(() => {
    window.__tel = []
    window.addEventListener('click', e => {
      const a = e.target instanceof Element ? e.target.closest('a[href^="tel:"]') : null
      if (a) { window.__tel.push(a.getAttribute('href')); e.preventDefault() }
    }, true)
  })
  const page = await ctx.newPage()
  const s = { ctx, page, phone, errors: [], saves: [] }
  page.on('pageerror', e => s.errors.push(String(e).slice(0, 300)))
  page.on('dialog', d => d.accept().catch(() => {}))
  page.on('response', r => { if (r.url() === `${API}/api/pipeline` && r.request().method() !== 'GET') s.saves.push(r.status()) })
  // A stage change asks the server to run automations; the dev data holds real customers.
  await page.route('**/api/automations/trigger', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true,"data":{"matched":0}}' }))
  await page.goto(APP)
  await page.waitForSelector(phone ? '[data-tabbar]' : '[data-global-appointment]', { timeout: 30000 })
  if (phone) await page.locator('[data-tabbar] button:has-text("Pipeline")').click()
  else await page.locator('span:text-is("Sales Pipeline"):visible').first().click()
  await page.waitForSelector('[data-kanban-board]', { timeout: 15000 })
  await sleep(600)
  s.touch = phone ? await ctx.newCDPSession(page) : null
  return s
}

function pointer(s) {
  let at = { x: 0, y: 0 }
  const touch = (type, pts) => s.touch.send('Input.dispatchTouchEvent', { type, touchPoints: pts })
  return {
    async down(x, y) { at = { x, y }; if (s.phone) { await touch('touchStart', [{ x, y }]); await sleep(450) } else { await s.page.mouse.move(x, y); await s.page.mouse.down() } },
    async move(x, y, steps = 8) {
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
const showColumn = async (s, key) => {
  await s.page.locator(`${col(key)} [data-kanban-scroll]`).evaluate(el => { el.scrollTop = 0 })
  await s.page.locator(col(key)).evaluate(el => el.scrollIntoView({ block: 'nearest', inline: 'start' }))
  await sleep(250)
}
const cardWindowOpen = s => s.page.locator('[data-card-window]').count()
const tap = async (s, loc, opts) => { if (s.phone) await loc.tap(opts); else await loc.click(opts) }

async function run(browser, phone) {
  const size = phone ? 'phone' : 'desktop'
  console.log(`\n── ${size} ──`)
  const s = await open(browser, phone)
  const p = pointer(s)
  const { leads } = await serverLeads()
  const byId = new Map(leads.map(l => [l.id, l]))

  /* the number on a card */
  const src = 'Appointment'
  await showColumn(s, src)
  const withPhone = await s.page.locator(`${col(src)} [data-kanban-card]:has([data-card-phone])`).evaluateAll(els => els.map(e => e.dataset.kanbanCard))
  check(`${size}: cards with a saved phone show it`, withPhone.length > 0, `${withPhone.length} in ${src}`)
  const id = withPhone[0]
  const link = s.page.locator(`[data-kanban-card="${id}"] [data-card-phone]`)
  const text = (await link.innerText()).trim()
  const href = await link.getAttribute('href')
  const lead = byId.get(id)
  check(`${size}: formatted (352) 555 1234, space and no dash`, FORMAT.test(text), text)
  check(`${size}: it is a tel: link to that number`, href === `tel:${digits(text)}` || href === `tel:1${digits(text)}` || href === `tel:+1${digits(text)}`, href)
  check(`${size}: it is the card's (or its customer's) phone`, !lead?.phone || digits(lead.phone) === digits(text), `${lead?.phone} -> ${text}`)
  const order = await s.page.locator(`[data-kanban-card="${id}"] > div > *`).evaluateAll(els => els.map(e => e.matches('[data-card-phone]') ? 'phone' : e.tagName === 'P' ? 'address' : 'other'))
  check(`${size}: it sits right under the address line`, order[order.indexOf('phone') - 1] === 'address', order.join(','))
  if (SHOTS && phone) await s.page.screenshot({ path: `${SHOTS}/dev-card-phone.png` })
  if (SHOTS && !phone) await s.page.screenshot({ path: `${SHOTS}/dev-card-phone-desktop.png` })

  /* tapping it calls and does not open the card */
  await s.page.evaluate(() => { window.__tel = [] })
  const url0 = s.page.url()
  await tap(s, link)
  await sleep(600)
  const called = await s.page.evaluate(() => window.__tel)
  check(`${size}: tapping the number follows the tel: link`, called.length === 1 && called[0] === href, called.join(','))
  check(`${size}: tapping the number does not open the card`, (await cardWindowOpen(s)) === 0 && !/[?&]card=/.test(s.page.url()) && s.page.url() === url0, s.page.url())
  check(`${size}: and does not pick the card up or save anything`, s.saves.length === 0 && (await stageOnServer(id)) === src)

  /* same height without a phone */
  const shapes = await s.page.locator('[data-kanban-card]').evaluateAll(els => els.map(card => {
    const body = card.firstElementChild
    const ph = body.querySelector(':scope > [data-card-phone]')
    const h = card.getBoundingClientRect().height
    let without = h
    if (ph) { ph.style.display = 'none'; without = card.getBoundingClientRect().height; ph.style.display = '' }
    const shape = [...body.children].filter(c => !c.matches('[data-card-phone]')).map(c => c.className.split(' ')[0] + c.tagName + Math.round(c.getBoundingClientRect().height)).join('|')
    return { id: card.dataset.kanbanCard, phone: !!ph, h: Math.round(h * 10) / 10, without: Math.round(without * 10) / 10, shape }
  }))
  let noPhone = shapes.filter(x => !x.phone)
  if (noPhone.length === 0) {
    // Cards without a phone sit in the collapsed columns at the end; open one.
    for (const key of ['No Answer', 'Paid & Closed', 'Lost Sale']) {
      const ids = new Set(leads.filter(l => l.stage === key && !l.phone).map(l => l.id))
      if (!ids.size) continue
      await s.page.locator(`${col(key)} button`).first().click(); await sleep(500)
      const more = await s.page.locator(`${col(key)} [data-kanban-card]`).evaluateAll(els => els.map(card => {
        const body = card.firstElementChild
        const ph = body.querySelector(':scope > [data-card-phone]')
        let without = card.getBoundingClientRect().height
        if (ph) { ph.style.display = 'none'; without = card.getBoundingClientRect().height; ph.style.display = '' }
        return { id: card.dataset.kanbanCard, phone: !!ph, h: Math.round(card.getBoundingClientRect().height * 10) / 10, without: Math.round(without * 10) / 10, shape: [...body.children].filter(c => !c.matches('[data-card-phone]')).map(c => c.className.split(' ')[0] + c.tagName + Math.round(c.getBoundingClientRect().height)).join('|') }
      }))
      shapes.push(...more)
      await s.page.locator(`${col(key)} > button`).first().click(); await sleep(300)   // collapse it again
      noPhone = shapes.filter(x => !x.phone)
      if (noPhone.length) break
    }
  }
  const pair = noPhone.map(n => [n, shapes.find(x => x.phone && x.shape === n.shape)]).find(([, w]) => w)
  check(`${size}: a card with no phone shows no number and no empty line`, noPhone.length > 0, `${noPhone.length} card(s) with no phone`)
  check(`${size}: a card with no phone is the height it was (a card with a number, minus the number)`, !!pair && Math.abs(pair[0].h - pair[1].without) < 0.6 && pair[1].h > pair[1].without,
    pair ? `no phone ${pair[0].h}px; with phone ${pair[1].h}px, ${pair[1].without}px without the number` : 'no matching pair')

  /* a drag that starts on the number */
  await showColumn(s, src)
  const dest = 'Estimating'
  const r0 = await rect(s, `[data-kanban-card="${id}"] [data-card-phone]`)
  await p.down(r0.left + Math.min(20, r0.width / 2), r0.top + r0.height / 2)
  await p.move(r0.left + 40, r0.top + 30, 4)
  // On a phone the next column is off screen: hold the card at the edge until the board brings it in.
  const board = await rect(s, '[data-kanban-board]')
  const y = Math.min(board.bottom - 80, r0.top + 60)
  for (let i = 0; i < 200; i++) {
    const d = await rect(s, col(dest))
    if (d.left + d.width / 2 < board.right - 20) break
    await p.move(board.right - 8, y, 2); await sleep(60)
  }
  for (let i = 0; i < 12; i++) {
    const d = await rect(s, col(dest))
    await p.move(Math.min(d.left + d.width / 2, board.right - 30), y, 4); await sleep(100)
    if (Math.abs((await rect(s, col(dest))).left - d.left) < 1) break
  }
  const held = await s.page.locator(`${col(dest)} [data-kanban-placeholder]`).count()
  const before = s.saves.length
  await p.up()
  for (let i = 0; i < 60 && !(s.saves.length > before && s.saves[s.saves.length - 1] === 200); i++) await sleep(100)
  await sleep(300)
  const moved = await stageOnServer(id)
  const telAfterDrag = await s.page.evaluate(() => window.__tel.length)
  check(`${size}: a drag that starts on the number moves the card`, held === 1 && moved === dest, `placeholder: ${held}, saved stage: ${moved}`)
  check(`${size}: the drag does not also call`, telAfterDrag === 1, `${telAfterDrag} tel: link(s) followed in all`)
  check(`${size}: the drag does not open the card`, (await cardWindowOpen(s)) === 0)
  // Put it back where it was, through the normal version checked save.
  const d = await serverLeads()
  const now = d.leads.find(l => l.id === id)
  const back = await api('PATCH', '/api/pipeline', { upsert: [{ lead: { ...now, stage: src, lastMoved: lead.lastMoved, boardOrder: lead.boardOrder } }], remove: [], baseVersion: d.version })
  check(`${size}: card put back in ${src}`, back.status === 200 && (await stageOnServer(id)) === src, `status ${back.status}`)
  await s.page.reload(); await s.page.waitForSelector('[data-kanban-board]', { timeout: 30000 }); await sleep(700)

  /* opening the card, and the number in the card window */
  await showColumn(s, src)
  await tap(s, s.page.locator(`[data-kanban-card="${id}"]`), { position: { x: 60, y: 14 } })
  await sleep(700)
  check(`${size}: a tap on the rest of the card still opens it`, (await cardWindowOpen(s)) === 1 && /[?&]card=/.test(s.page.url()))
  const wl = s.page.locator('[data-card-window] [data-card-window-phone]')
  const wText = (await wl.count()) ? (await wl.innerText()).trim() : ''
  const wOrder = (await wl.count()) ? await wl.evaluate(el => el.previousElementSibling?.textContent || '') : ''
  check(`${size}: the card window shows the number under the address`, wText === text && (await wl.getAttribute('href')) === href && wOrder.includes(src), `${wText} under "${wOrder}"`)
  if (SHOTS && phone) await s.page.screenshot({ path: `${SHOTS}/dev-card-window-phone-number.png` })
  await s.page.evaluate(() => { window.__tel = [] })
  await tap(s, wl); await sleep(300)
  check(`${size}: tapping it there calls, and the window stays open`, (await s.page.evaluate(() => window.__tel.length)) === 1 && (await cardWindowOpen(s)) === 1)
  await s.page.locator('[data-card-window] button[aria-label="Close"]').first().click(); await sleep(400)
  check(`${size}: the window still closes`, (await cardWindowOpen(s)) === 0)

  check(`${size}: no page errors`, s.errors.length === 0, s.errors.join(' | '))
  await s.ctx.close()
}

const browser = await chromium.launch()
const only = process.env.E2E_ONLY || ''
try {
  if (!only || only === 'phone') await run(browser, true)
  if (!only || only === 'desktop') await run(browser, false)
} catch (err) {
  check('test run finished', false, String(err?.stack || err).slice(0, 600))
}
await browser.close()
// Tapping a number starts a call the app follows up on ("How'd it go?"): clear
// it, so the next test signed in as the same person is not asked.
await api('DELETE', '/api/follow-ups/pending').catch(() => {})
const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length} of ${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
