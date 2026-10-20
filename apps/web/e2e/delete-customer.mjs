// Delete customer asks for the customer's name to be typed.
//
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 E2E_ACCESS_TOKEN=<dev owner token> node e2e/delete-customer.mjs
//   SHOTS=<folder>   saves dev-delete-customer-type-name.png (the phone, name typed)
//
// On a 360 px phone (WebKit, touch) and a 1440 px desktop (Chromium), signed in as
// the owner: makes a test customer, opens More, chooses Delete customer, and checks
//   - the menu is fully on screen,
//   - the red Delete button is off until the name is typed (a wrong name keeps it
//     off; capitals and spaces at the ends don't matter),
//   - Cancel keeps the customer,
//   - Delete removes it: the screen goes back to the list and the server no longer
//     lists the customer.
// Dev copy only (port 4001).
import './devOnly.mjs'
import { webkit, chromium } from 'playwright'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import { execFileSync } from 'child_process'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || 'http://localhost:4001'
const OWNER = process.env.E2E_ACCESS_TOKEN || ''
const SHOTS = process.env.SHOTS || ''
const local = u => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(u)
if (!local(APP) || !local(API) || /:4000(\/|$)/.test(APP) || /:4000(\/|$)/.test(API)) { console.error('Refusing to run: the dev copy only (localhost, not port 4000).'); process.exit(2) }
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
const listed = async id => ((await call('GET', '/api/crm-contacts')).json.data ?? []).some(c => c.id === id)
const made = []
// The dev database by name (never live). The app only archives a deleted customer;
// the test removes the rows afterwards so nothing it made is left behind.
const psql = sql => execFileSync('psql', ['-d', 'ezbiz_dev', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' }).trim()
const removeRows = ids => {
  if (!ids.length) return
  const list = ids.map(id => `'${String(id).replace(/'/g, '')}'`).join(',')
  psql(`begin; delete from "IntakeLead" where "crmContactId" in (${list}); delete from "SavedQuote" where "crmContactId" in (${list}); delete from "CrmContactNote" where "crmContactId" in (${list}); delete from "PendingTouch" where "crmContactId" in (${list}); delete from "CallLog" where "crmContactId" in (${list}); delete from "CrmContact" where id in (${list}); commit;`)
}

async function run(engine, width, height) {
  const tag = `${engine} ${width}`
  const stamp = Date.now().toString(36).slice(-5)
  const first = 'E2E', last = `Typed Delete ${stamp}`
  const r = await call('POST', '/api/crm-contacts', { firstName: first, lastName: last, phone: `352555${String(crypto.randomInt(10000)).padStart(4, '0')}`, serviceAddress: '1 Test Way, Ocala, FL 34470' })
  const id = r.json.data?.contact?.id ?? r.json.data?.id
  if (!id) { check(`${tag}: test customer made`, false, String(r.status)); return }
  made.push(id)
  const browser = await (engine === 'webkit' ? webkit : chromium).launch()
  const phone = width < 640
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: phone ? 3 : 1, hasTouch: phone })
  await ctx.addInitScript(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, OWNER)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)))
  const tap = async loc => { await loc.scrollIntoViewIfNeeded().catch(() => {}); await (phone && engine === 'webkit' ? loc.tap() : loc.click()); await sleep(400) }
  try {
    await page.goto(`${APP}/customers/${id}`)
    await page.waitForSelector('[data-customer-tab]', { timeout: 60000 }); await sleep(800)
    const open = async () => {
      await tap(page.locator('[data-popup-trigger="customer-more"]'))
      const box = await page.locator('[data-popup="customer-more"]').boundingBox()
      const vw = width
      check(`${tag}: More opens fully on screen`, !!box && box.x >= 0 && box.x + box.width <= vw + 0.5 && box.y + box.height <= height + 0.5, box ? `${Math.round(box.x)}..${Math.round(box.x + box.width)} x ${Math.round(box.y)}..${Math.round(box.y + box.height)}` : 'no menu')
      await tap(page.locator('[data-customer-delete]'))
      await page.waitForSelector('[data-confirm-typing]', { timeout: 5000 })
    }
    await open()
    const del = page.locator('[data-confirm-delete]'), input = page.locator('[data-confirm-input]')
    check(`${tag}: the confirm names the customer`, ((await page.locator('[data-confirm-name]').innerText()).trim()) === `${first} ${last}`)
    check(`${tag}: Delete is off before typing`, await del.isDisabled())
    await input.fill(`${first} ${last.slice(0, -1)}`)
    check(`${tag}: Delete stays off for a name that does not match`, await del.isDisabled())
    // Cancel keeps the customer.
    await tap(page.locator('[data-confirm-cancel]'))
    check(`${tag}: Cancel closes the confirm`, (await page.locator('[data-confirm-typing]').count()) === 0)
    await sleep(800)
    check(`${tag}: Cancel keeps the customer`, await listed(id))
    await open()
    await input.fill(`  ${first.toLowerCase()} ${last.toUpperCase()}  `)
    check(`${tag}: Delete turns on once the name is typed (any capitals, spaces at the ends)`, await del.isEnabled())
    if (SHOTS && phone && engine === 'webkit') await page.screenshot({ path: path.join(SHOTS, 'dev-delete-customer-type-name.png') })
    await tap(del)
    await page.waitForURL(u => /\/customers\/?(\?|$)/.test(new URL(u).pathname + new URL(u).search), { timeout: 10000 }).catch(() => {})
    check(`${tag}: after Delete the screen is back on the customer list`, /\/customers\/?$/.test(new URL(page.url()).pathname), page.url())
    let gone = false
    for (let i = 0; i < 20 && !gone; i++) { await sleep(750); gone = !(await listed(id)) }
    check(`${tag}: the server no longer lists the customer`, gone)
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
  for (const id of made) await call('DELETE', `/api/crm-contacts/${id}`)
  try { removeRows(made); check('clean up: the test customers are gone from the database', psql(`select count(*) from "CrmContact" where id in (${made.map(i => `'${i}'`).join(',') || "''"})`) === '0') }
  catch (e) { check('clean up: the test customers are gone from the database', false, String(e).split('\n')[0]) }
  const passed = results.filter(Boolean).length
  console.log(`\n${passed} of ${results.length} checks passed`)
  process.exit(passed === results.length ? 0 : 1)
}
