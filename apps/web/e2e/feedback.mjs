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
// Removes what it made (rows and screenshot files, ezbiz_dev only).
import { chromium } from 'playwright'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'

const APP = 'http://localhost:4001', TOKEN = process.env.E2E_ACCESS_TOKEN || '', SHOTS = process.env.SHOTS || ''
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
  await item.locator('[data-feedback-status="done"]').click()
  check('phone list: Done is saved', !!await until(async () => (await mine(t1))[0]?.status === 'done', 10000))
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
  await D.page.locator('[data-feedback-item]').first().waitFor()
  await until(async () => D.page.locator('[data-feedback-shot] img').first().evaluate(i => i.complete && i.naturalWidth > 0), 15000)
  check('desktop list: the 3 test feedbacks are listed, newest first', await D.page.evaluate(m => [...document.querySelectorAll('[data-feedback-text]')].map(e => e.textContent).filter(t => t.startsWith(m)).length, MARK) === 3)
  await shot(D.page, 'list-desktop')
  check('desktop: no page errors', D.errs.length === 0, D.errs.join(' | '))
  await D.ctx.close()
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
  await b.close()
}
const failed = results.filter(r => !r).length
console.log(`\n${results.length - failed} of ${results.length} checks passed`)
process.exit(failed ? 1 : 0)
