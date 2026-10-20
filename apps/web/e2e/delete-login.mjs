// Deleting a login asks for the login's full name to be typed (Team, ConfirmByTyping),
// as deleting a customer does. Quotes and cards keep their normal confirm.
//
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 E2E_ACCESS_TOKEN=<dev owner token> node e2e/delete-login.mjs
//   SHOTS=<folder>   saves dev-login-delete-type-name.png (the phone, name typed)
//
// On a 360 px phone (WebKit, touch) and a 1440 px desktop (Chromium), signed in as
// the owner: invites a test login (no email goes out: the dev copy has no email
// settings), opens Team, taps Delete on it, and checks
//   - the confirm names the login (first and last name),
//   - the red Delete login button is off until the name is typed (a wrong name keeps
//     it off; capitals and spaces at the ends don't matter),
//   - Cancel keeps the login,
//   - Delete login removes it: the server no longer lists it.
// Dev copy only (port 4001).
import './devOnly.mjs'
import { webkit, chromium } from 'playwright'
import path from 'path'
import fs from 'fs'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || 'http://localhost:4001'
const OWNER = process.env.E2E_ACCESS_TOKEN || ''
const SHOTS = process.env.SHOTS || ''
if (!OWNER) { console.error('Set E2E_ACCESS_TOKEN (an owner login on the dev server).'); process.exit(2) }
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const call = async (method, p, body) => {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(`${API}${p}`, { method, headers: { Authorization: `Bearer ${OWNER}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
      return { status: r.status, json: await r.json().catch(() => ({})) }
    } catch { if (i >= 30) return { status: 0, json: {} }; await sleep(2000) }
  }
}
const users = async () => (await call('GET', '/api/crm-auth/users')).json.data ?? []
const made = []

async function run(engine, width, height) {
  const tag = `${engine} ${width}`
  const stamp = Date.now().toString(36).slice(-5)
  const first = 'E2E', last = `Login Delete ${stamp}`, email = `e2e-login-delete-${stamp}@example.test`
  made.push(email)
  const inv = await call('POST', '/api/crm-auth/invite', { firstName: first, lastName: last, email, role: 'field_crew' })
  const id = (await users()).find(u => u.email === email)?.id
  if (!id) { check(`${tag}: test login made`, false, String(inv.status)); return }
  const browser = await (engine === 'webkit' ? webkit : chromium).launch()
  const phone = width < 640
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: phone ? 3 : 1, hasTouch: phone })
  await ctx.addInitScript(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, OWNER)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)))
  const tap = async loc => { await loc.scrollIntoViewIfNeeded().catch(() => {}); if (!phone) await loc.hover().catch(() => {}); await (phone && engine === 'webkit' ? loc.tap() : loc.click()); await sleep(400) }
  try {
    await page.goto(`${APP}/team`)
    const btn = page.locator(`[data-delete-login="${id}"]`)
    await btn.waitFor({ state: 'attached', timeout: 60000 }); await sleep(600)
    const open = async () => {
      // On a wide screen the row's buttons show on hover.
      if (!phone) await btn.locator('xpath=ancestor::div[contains(@class,"group")]').first().hover().catch(() => {})
      await tap(btn)
      await page.waitForSelector('[data-confirm-typing]', { timeout: 5000 })
    }
    await open()
    const del = page.locator('[data-confirm-delete]'), input = page.locator('[data-confirm-input]')
    check(`${tag}: the confirm names the login`, ((await page.locator('[data-confirm-name]').innerText()).trim()) === `${first} ${last}`)
    check(`${tag}: the button says Delete login`, ((await del.innerText()).trim()) === 'Delete login')
    check(`${tag}: Delete login is off before typing`, await del.isDisabled())
    await input.fill(`${first} ${last.slice(0, -1)}`)
    check(`${tag}: it stays off for a name that does not match`, await del.isDisabled())
    const box = await page.locator('[data-confirm-typing] form').boundingBox()
    check(`${tag}: the confirm is fully on screen`, !!box && box.x >= 0 && box.x + box.width <= width + 0.5 && box.y >= 0 && box.y + box.height <= height + 0.5, box ? `${Math.round(box.x)}..${Math.round(box.x + box.width)} x ${Math.round(box.y)}..${Math.round(box.y + box.height)}` : 'none')
    await tap(page.locator('[data-confirm-cancel]'))
    check(`${tag}: Cancel closes the confirm`, (await page.locator('[data-confirm-typing]').count()) === 0)
    await sleep(500)
    check(`${tag}: Cancel keeps the login`, (await users()).some(u => u.id === id))
    await open()
    await input.fill(`  ${first.toLowerCase()} ${last.toUpperCase()}  `)
    check(`${tag}: Delete login turns on once the name is typed (any capitals, spaces at the ends)`, await del.isEnabled())
    if (SHOTS && phone && engine === 'webkit') await page.screenshot({ path: path.join(SHOTS, 'dev-login-delete-type-name.png') })
    await tap(del)
    let gone = false
    for (let i = 0; i < 20 && !gone; i++) { await sleep(500); gone = !(await users()).some(u => u.id === id) }
    check(`${tag}: the server no longer lists the login`, gone)
    let off = false
    for (let i = 0; i < 20 && !off; i++) { await sleep(300); off = (await btn.count()) === 0 }
    check(`${tag}: the Team list no longer shows it`, off)
    check(`${tag}: no page errors`, errors.length === 0, errors.slice(0, 3).join(' | '))
  } catch (e) {
    check(`${tag}: ran to the end`, false, String(e).split('\n').slice(0, 3).join(' '))
  } finally {
    await browser.close()
  }
}

try {
  await run('webkit', 360, 780)
  await run('chromium', 1440, 900)
} finally {
  // Anything a failed run left behind.
  for (const u of (await users()).filter(x => made.includes(x.email))) await call('DELETE', `/api/crm-auth/users/${u.id}`)
  check('clean up: no test login is left', !(await users()).some(u => made.includes(u.email)))
  const passed = results.filter(Boolean).length
  console.log(`\n${passed} of ${results.length} checks passed`)
  process.exit(passed === results.length ? 0 : 1)
}
