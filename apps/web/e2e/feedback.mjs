// "Send feedback" on a phone and on a desktop. Dev only (4001, which serves
// the built app: run `pnpm -s build` in apps/web first).
//
//   E2E_ACCESS_TOKEN=<dev owner token> SHOTS=<folder, optional> node e2e/feedback.mjs
//
// Phone (390 px): tap Send feedback in the top bar, the form opens with a
// picture of the screen, type, Send; it is in the Feedback list once, with
// its picture (tap to see it big), and New / Seen / Done change it. Desktop:
// the same with the answer cut twice mid-send (the server saved it, the phone
// never heard) and once with no signal at all: each arrives exactly once.
// Oct 26 (the feedback inbox): a Salesman (Christa) on an iPhone (WebKit) on a
// customer's page draws on the picture (Mark it, Undo) and sends one line: the
// screen (Customers), the record (Customer: <name>), her role, the device and
// the app version arrive with the marked picture; an installer on his phone
// (My installs) sends one too; the owner's Feedback page opens on New, filters
// Looked at / Fixed / Needs Jonathan, shows the screen and record, and marks.
// Removes what it made (rows, screenshot files, logins and the customer, ezbiz_dev only).
//   APP_URL=http://localhost:4073 to use a worktree's own server.
import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import { chromium, webkit, devices } from 'playwright'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'

const APP = process.env.APP_URL || 'http://localhost:4001', TOKEN = process.env.E2E_ACCESS_TOKEN || '', SHOTS = process.env.SHOTS || ''
if (!TOKEN) { console.error('Set E2E_ACCESS_TOKEN.'); process.exit(2) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const api = async (p, init = {}) => {
  const r = await fetch(APP + p, { ...init, headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(init.headers || {}) } })
  return { status: r.status, json: await r.json().catch(() => null) }
}
const shot = async (page, name, opts = {}) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `dev-feedback-${name}.png`), ...opts }) }
async function until(fn, ms = 40000, every = 500) { const end = Date.now() + ms; for (;;) { const v = await fn().catch(() => null); if (v || Date.now() > end) return v; await sleep(every) } }
const sql = q => execFileSync('psql', ['-d', 'ezbiz_dev', '-At', '-c', q]).toString().trim()

const MARK = `E2E feedback ${crypto.randomUUID().slice(0, 8)}`
const madeUsers = []
let madeContact = null
const mine = async text => ((await api('/api/feedback')).json?.data ?? []).filter(f => f.text === text)

async function open(b, viewport, phone) {
  const ctx = await b.newContext({ viewport, deviceScaleFactor: phone ? 3 : 1, isMobile: phone, hasTouch: phone })
  await ctx.addInitScript(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, TOKEN)
  await ctx.route('**/api/automations/trigger', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' }))
  const page = await ctx.newPage(); const errs = []
  page.on('pageerror', e => errs.push(String(e).slice(0, 200)))
  return { ctx, page, errs }
}

/** Tap Send feedback, wait for the form, type. */
async function fill(page, text) {
  await page.locator('[data-feedback-button]:visible').click()
  await page.waitForSelector('[data-feedback-form]', { timeout: 30000 })
  await page.fill('#feedback-text', text)
}

const b = await chromium.launch()
try {
  // ── Phone ──
  const P = await open(b, { width: 390, height: 844 }, true)
  await P.page.goto(`${APP}/customers`); await P.page.waitForSelector('[data-tabbar]', { timeout: 60000 })
  await sleep(1500)
  const btn = P.page.locator('[data-feedback-button]:visible')
  check('phone: Send feedback is in the top bar', await btn.count() === 1)
  const bb = await btn.boundingBox(), tab = await P.page.locator('[data-tabbar]').boundingBox()
  check('phone: it does not cover the tab bar', !!bb && !!tab && bb.y + bb.height <= tab.y, JSON.stringify(bb))
  await shot(P.page, 'button-phone')

  const t1 = `${MARK} phone: the customer list should show the town`
  await fill(P.page, t1)
  const thumb = P.page.locator('[data-feedback-thumb] img')
  check('phone: the form shows the picture of the screen', await thumb.count() === 1 && await thumb.evaluate(i => i.naturalWidth > 300))
  const shotInfo = await thumb.evaluate(i => ({ w: i.naturalWidth, h: i.naturalHeight, bytes: Math.round(i.src.length * 0.75) }))
  check('phone: the picture is a JPEG at most 1600 px wide', shotInfo.w <= 1600 && shotInfo.w >= 390 && /^data:image\/jpeg/.test(await thumb.getAttribute('src')), JSON.stringify(shotInfo))
  await shot(P.page, 'form-phone')
  await P.page.click('[data-feedback-send]')
  await P.page.waitForSelector('[data-feedback-form]', { state: 'detached', timeout: 20000 })
  const got = await until(async () => { const m = await mine(t1); return m.length ? m : null })
  check('phone: it arrived once, with its picture', got?.length === 1 && got[0].hasScreenshot, JSON.stringify(got?.map(f => f.hasScreenshot)))
  check('phone: page, screen, device and app file were recorded', got?.[0]?.path === '/customers' && /390x844 @3x/.test(got?.[0]?.screen) && /Mobile|iPhone|Android|Chrome/.test(got?.[0]?.userAgent) && /\/assets\/index-/.test(got?.[0]?.appFile), JSON.stringify({ path: got?.[0]?.path, screen: got?.[0]?.screen, appFile: got?.[0]?.appFile }))

  // The list on the phone.
  await P.page.goto(`${APP}/feedback`); await P.page.waitForSelector('[data-feedback-page]', { timeout: 30000 })
  const item = P.page.locator(`[data-feedback-item="${got?.[0]?.id}"]`)
  await item.waitFor({ timeout: 15000 })
  const img = item.locator('[data-feedback-shot] img')
  await until(async () => (await img.count()) && await img.evaluate(i => i.complete && i.naturalWidth > 0), 15000)
  check('phone list: it shows with its picture', await img.count() === 1 && await img.evaluate(i => i.naturalWidth > 0))
  await P.page.evaluate(() => document.querySelector('[data-page-scroll]')?.scrollTo(0, 0))
  await shot(P.page, 'list-phone')
  await img.click()
  check('phone list: tapping the picture shows it big', await P.page.locator('[data-feedback-big] img').waitFor({ timeout: 5000 }).then(() => true, () => false))
  await P.page.locator('[data-feedback-big] button[aria-label="Close"]').click()
  check('phone list: the list opens on New', await P.page.locator('[data-feedback-filter="new"][aria-selected="true"]').count() === 1)
  await item.locator('[data-feedback-status="done"]').click()
  check('phone list: Fixed is saved', !!await until(async () => (await mine(t1))[0]?.status === 'done', 10000))
  check('phone list: once Fixed it leaves the New list', !!await until(async () => (await item.count()) === 0, 5000))
  await P.page.locator('[data-feedback-filter="done"]').click()
  await item.waitFor({ timeout: 5000 }).catch(() => {})
  check('phone list: it is under Fixed', await item.count() === 1)
  await item.locator('[data-feedback-path]').click()
  await sleep(800)
  check('phone list: the page link opens that page', new URL(P.page.url()).pathname === '/customers', P.page.url())
  check('phone: no page errors', P.errs.length === 0, P.errs.join(' | '))
  await P.ctx.close()

  // ── Desktop: the answer is cut mid-send, twice ──
  const D = await open(b, { width: 1440, height: 900 }, false)
  await D.page.goto(`${APP}/sales-pipeline`); await D.page.waitForSelector('[data-global-appointment]', { timeout: 60000 })
  await sleep(1500)
  let cut = 0, reached = 0
  await D.ctx.route('**/api/feedback', async r => {
    if (r.request().method() !== 'POST') return r.continue()
    reached++
    if (cut < 2) { cut++; await r.fetch().catch(() => null); return r.abort('connectionreset') }
    return r.continue()
  })
  const t2 = `${MARK} desktop: the answer was cut`
  await fill(D.page, t2)
  check('desktop: the form shows the picture of the screen', await D.page.locator('[data-feedback-thumb] img').count() === 1)
  await D.page.click('[data-feedback-send]')
  await D.page.waitForSelector('[data-feedback-form]', { state: 'detached', timeout: 20000 })
  const arrived = await until(async () => reached >= 3 && (await mine(t2)).length === 1, 60000)
  await sleep(1500)
  check('desktop: answer cut twice, it reached the server 3 times and is saved once', !!arrived && (await mine(t2)).length === 1, `reached ${reached}, rows ${(await mine(t2)).length}`)
  await D.ctx.unroute('**/api/feedback')

  // ── Desktop: no signal at all, then signal back ──
  const t3 = `${MARK} desktop: sent with no signal`
  await fill(D.page, t3)
  await D.page.locator('[data-feedback-remove-shot]').click()
  check('desktop: the picture can be removed', await D.page.locator('[data-feedback-thumb]').count() === 0 && await D.page.locator('[data-feedback-noshot]').isVisible())
  await D.ctx.setOffline(true)
  await D.page.click('[data-feedback-send]')
  await D.page.waitForSelector('[data-feedback-form]', { state: 'detached', timeout: 20000 })
  await sleep(1500)
  check('desktop: nothing arrives with no signal', (await mine(t3)).length === 0)
  await D.ctx.setOffline(false)
  await D.page.evaluate(() => window.dispatchEvent(new Event('online')))
  const back = await until(async () => { const m = await mine(t3); return m.length ? m : null }, 40000)
  check('desktop: signal back, it arrives once, without a picture', back?.length === 1 && back[0].hasScreenshot === false)

  await D.page.goto(`${APP}/feedback`); await D.page.waitForSelector('[data-feedback-page]', { timeout: 30000 })
  await D.page.locator('[data-feedback-filter="all"]').click()
  await D.page.locator('[data-feedback-item]').first().waitFor()
  await until(async () => D.page.locator('[data-feedback-shot] img').first().evaluate(i => i.complete && i.naturalWidth > 0), 15000)
  check('desktop list: the 3 test feedbacks are listed, newest first', await D.page.evaluate(m => [...document.querySelectorAll('[data-feedback-text]')].map(e => e.textContent).filter(t => t.startsWith(m)).length, MARK) === 3)
  await shot(D.page, 'list-desktop')
  check('desktop: no page errors', D.errs.length === 0, D.errs.join(' | '))
  await D.ctx.close()

  // ── A Salesman (Christa) on an iPhone, and an installer on his ──
  const wk = await webkit.launch()
  try {
    const stamp = crypto.randomUUID().slice(0, 6)
    async function invite(role, last) {
      const email = `e2e-feedback-${role}-${stamp}@example.invalid`
      const inv = await api('/api/crm-auth/invite', { method: 'POST', body: JSON.stringify({ firstName: 'E2E', lastName: last, email, role }) })
      const link = new URL(inv.json.data.inviteUrl)
      madeUsers.push(email)
      const password = `Fb-${crypto.randomBytes(9).toString('base64url')}`
      const acc = await fetch(`${APP}/api/crm-auth/accept-invite`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: link.searchParams.get('token'), email, password }) }).then(r => r.json())
      return { email, password, token: acc.data?.accessToken }
    }
    async function phoneAs(login) {
      const ctx = await wk.newContext({ ...devices['iPhone 13'] })
      const r = await ctx.request.post(`${APP}/api/crm-auth/login`, { headers: { 'X-Staff-Request': '1' }, data: { email: login.email, password: login.password, cookie: true } })
      if (!r.ok()) throw new Error(`sign in failed: ${r.status()}`)
      await ctx.route('**/api/automations/trigger', rr => rr.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' }))
      const page = await ctx.newPage(); const errs = []
      page.on('pageerror', e => errs.push(String(e).slice(0, 200)))
      return { ctx, page, errs }
    }
    const sales = await invite('sales_rep', `Christa ${stamp}`)
    const crew = await invite('field_crew', `Installer ${stamp}`)
    const c = await fetch(`${APP}/api/crm-contacts`, { method: 'POST', headers: { Authorization: `Bearer ${sales.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ firstName: 'E2E', lastName: `Feedback ${stamp}`, phone: '3525550142', serviceAddress: '110 SE Watula Ave, Ocala, FL 34471' }) }).then(r => r.json())
    madeContact = c.data?.id
    check('setup: a Salesman and an installer login, and her customer', !!sales.token && !!crew.token && !!madeContact)

    const S = await phoneAs(sales)
    await S.page.goto(`${APP}/customers/${madeContact}`); await S.page.waitForSelector('[data-tabbar]', { timeout: 60000 })
    await sleep(2500)
    const t4 = `${MARK} salesman: the phone number should be bigger`
    await fill(S.page, t4)
    check('salesman phone: the form shows the picture and says the screen and the record go with it', await S.page.locator('[data-feedback-thumb] img').count() === 1 && /Customers, the customer open/.test(await S.page.locator('[data-feedback-where]').innerText()), await S.page.locator('[data-feedback-where]').innerText().catch(() => ''))
    await S.page.locator('[data-feedback-mark]').tap()
    await S.page.locator('[data-feedback-canvas]').waitFor({ timeout: 5000 })
    const box = await S.page.locator('[data-feedback-canvas]').boundingBox()
    // A finger circles something on the picture (pointer events, as a touch screen sends them).
    async function stroke(dx) {
      await S.page.mouse.move(box.x + box.width * 0.3 + dx, box.y + box.height * 0.3)
      await S.page.mouse.down()
      for (let i = 1; i <= 8; i++) await S.page.mouse.move(box.x + box.width * (0.3 + i * 0.04) + dx, box.y + box.height * (0.3 + Math.sin(i) * 0.05), { steps: 2 })
      await S.page.mouse.up()
    }
    await stroke(0); await stroke(20)
    check('salesman phone: Mark it draws on the picture (Undo shows)', await S.page.locator('[data-feedback-undo]').isVisible())
    await S.page.locator('[data-feedback-undo]').tap()
    check('salesman phone: one mark left after Undo', await S.page.locator('[data-feedback-undo]').isVisible())
    await shot(S.page, 'salesman-marked')
    await S.page.locator('[data-feedback-mark]').tap()
    await S.page.locator('#feedback-text').fill(t4)
    await S.page.locator('[data-feedback-send]').tap()
    await S.page.waitForSelector('[data-feedback-form]', { state: 'detached', timeout: 20000 })
    const sent = await until(async () => { const m = await mine(t4); return m.length ? m : null })
    const f4 = sent?.[0]
    check('salesman: it arrived once, with the screen, the record and its name', sent?.length === 1 && f4.screenTitle === 'Customers' && f4.recordType === 'customer' && f4.recordId === madeContact && f4.recordName === `E2E Feedback ${stamp}`, JSON.stringify({ screenTitle: f4?.screenTitle, recordType: f4?.recordType, recordName: f4?.recordName }))
    check('salesman: her role, the iPhone and the app version', f4?.role === 'sales_rep' && /iPhone/.test(f4?.userAgent) && /built \d{4}-\d{2}-\d{2}/.test(f4?.appVersion), `${f4?.role} ${f4?.appVersion}`)
    const pic = await (async () => {
      const r = await fetch(`${APP}/api/feedback/${f4.id}/screenshot`, { headers: { Authorization: `Bearer ${TOKEN}` } })
      return r.ok ? Buffer.from(await r.arrayBuffer()) : null
    })()
    check('salesman: the marked picture arrived (a JPEG)', !!pic && pic[0] === 0xff && pic[1] === 0xd8)
    check('salesman phone: no page errors', S.errs.length === 0, S.errs.join(' | '))
    await S.ctx.close()

    const I = await phoneAs(crew)
    await I.page.goto(`${APP}/my-installs`); await I.page.waitForSelector('[data-tabbar]', { timeout: 60000 })
    await sleep(2000)
    check('installer phone: Send feedback is in his top bar', await I.page.locator('[data-feedback-button]:visible').count() === 1)
    const t5 = `${MARK} installer: the packet button is hard to find`
    await fill(I.page, t5)
    await I.page.locator('[data-feedback-send]').tap()
    await I.page.waitForSelector('[data-feedback-form]', { state: 'detached', timeout: 20000 })
    const f5 = (await until(async () => { const m = await mine(t5); return m.length ? m : null }))?.[0]
    check('installer: it arrived, with his role and the screen', f5?.role === 'field_crew' && !!f5?.screenTitle, `${f5?.role} ${f5?.screenTitle}`)
    check('installer: he cannot read the feedback list', (await I.ctx.request.get(`${APP}/api/feedback`)).status() === 403)
    check('installer phone: no page errors', I.errs.length === 0, I.errs.join(' | '))
    await I.ctx.close()

    // The owner's list: New first, the screen and the record, Needs Jonathan.
    const O = await open(b, { width: 1440, height: 900 }, false)
    await O.page.goto(`${APP}/feedback`); await O.page.waitForSelector('[data-feedback-page]', { timeout: 30000 })
    const it4 = O.page.locator(`[data-feedback-item="${f4.id}"]`)
    await it4.waitFor({ timeout: 15000 })
    const where = await it4.locator('[data-feedback-where]').innerText().catch(() => '')
    check('owner: her feedback is under New, with the screen and the record', /Screen: Customers/.test(where) && where.includes(`Customer: E2E Feedback ${stamp}`), where)
    await it4.locator('[data-feedback-status="needs_jonathan"]').click()
    check('owner: Needs Jonathan is saved', !!await until(async () => (await mine(t4))[0]?.status === 'needs_jonathan', 10000))
    await O.page.locator('[data-feedback-filter="needs_jonathan"]').click()
    check('owner: the Needs Jonathan filter shows it', await O.page.locator(`[data-feedback-item="${f4.id}"]`).count() === 1 && /Needs Jonathan/.test(await O.page.locator('[data-feedback-filter="needs_jonathan"]').innerText()))
    await O.page.locator('[data-feedback-filter="seen"]').click()
    check('owner: Looked at and Fixed are the other filters', /Looked at/.test(await O.page.locator('[data-feedback-filter="seen"]').innerText()) && /Fixed/.test(await O.page.locator('[data-feedback-filter="done"]').innerText()) && await O.page.locator(`[data-feedback-item="${f4.id}"]`).count() === 0)
    await shot(O.page, 'owner-filters')
    check('owner: no page errors', O.errs.length === 0, O.errs.join(' | '))
    await O.ctx.close()
  } finally { await wk.close() }
} catch (e) {
  check('test run finished', false, String(e?.message || e).slice(0, 300))
} finally {
  // Remove what was made: rows, notifications and screenshot files.
  const like = MARK.replace(/'/g, "''")
  try {
    const files = sql(`SELECT "screenshotPath" FROM "Feedback" WHERE text LIKE '${like}%' AND "screenshotPath" IS NOT NULL`).split('\n').filter(Boolean)
    for (const f of files) fs.rmSync(f, { force: true })
    sql(`DELETE FROM "Notification" WHERE link = '/feedback' AND body LIKE '${like}%'`)
    sql(`DELETE FROM "Feedback" WHERE text LIKE '${like}%'`)
    check('cleaned up', sql(`SELECT count(*) FROM "Feedback" WHERE text LIKE '${like}%'`) === '0')
  } catch (e) { check('cleaned up', false, String(e?.message || e).slice(0, 200)) }
  if (madeContact) await api(`/api/crm-contacts/${madeContact}`, { method: 'DELETE' }).catch(() => {})
  const users = (await api('/api/crm-auth/users')).json?.data ?? []
  for (const u of users.filter(x => madeUsers.includes(x.email))) await api(`/api/crm-auth/users/${u.id}`, { method: 'DELETE' }).catch(() => {})
  await b.close()
}
const failed = results.filter(r => !r).length
console.log(`\n${results.length - failed} of ${results.length} checks passed`)
process.exit(failed ? 1 : 0)
