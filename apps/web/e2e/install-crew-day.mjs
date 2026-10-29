// An install booked on a day the crew does not work (review Oct 28 2026: the server refused a Friday in plain
// words, but the phone said "The server did not accept this appointment ... tell Jonathan" and kept the booking as
// a failed save: a red count, "Couldn't save" in Waiting to save, ghost "All day" entries, and the customer page
// saying "Next appt Fri Oct 30" after a reload). The owner, on his iPhone (WebKit, 390 x 844):
//   1. the booking window says before Book that Fri Oct 30 is not a crew day, and Book waits; Mon Nov 2 is fine;
//   2. with that check unable to run (the weekend jobs list did not load), Book goes to the server, which refuses:
//      the window shows the server's reason and stays open; nothing is kept on the phone (no badge, no entry,
//      nothing after a reload) and nothing is booked or changed on the server.
// Books nothing: the only booking sent is the refused one.
//
// Run (dev copy only; a server serving the built app):
//   cd apps/web && pnpm -s build
//   APP_URL=http://localhost:4092 E2E_ACCESS_TOKEN_FILE=<dev owner token> E2E_STAFF_COOKIE=<dev owner cookie> node e2e/install-crew-day.mjs
import './devOnly.mjs'
import { webkit, devices } from 'playwright'
import fs from 'fs'
import { execFileSync } from 'child_process'
import { signInByCookie } from './lib.mjs'

const APP = process.env.APP_URL || 'http://localhost:4092'
const API = process.env.API_URL || APP
const OWNER = process.env.E2E_ACCESS_TOKEN || (process.env.E2E_ACCESS_TOKEN_FILE ? fs.readFileSync(process.env.E2E_ACCESS_TOKEN_FILE, 'utf8').trim() : '')
if (!OWNER) { console.error('Set E2E_ACCESS_TOKEN(_FILE) and E2E_STAFF_COOKIE.'); process.exit(2) }
const DB = 'ezbiz_dev'
const sql = q => execFileSync('psql', ['-d', DB, '-At', '-v', 'ON_ERROR_STOP=1', '-c', q]).toString().trim()
const lit = s => `'${String(s).replace(/'/g, "''")}'`
const sleep = ms => new Promise(r => setTimeout(r, ms))
let failed = 0
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++ }
const shot = (page, n) => page.screenshot({ path: process.env.SHOTS ? `${process.env.SHOTS}/${n}.png` : '/dev/null' }).catch(() => {})

const FRIDAY = '2026-10-30', MONDAY = '2026-11-02'
let browser = null
try {
  if (sql('SELECT current_database()') !== DB) throw new Error('not the dev copy')
  const weekend = await (await fetch(`${API}/api/schedule/weekend-jobs`, { headers: { Authorization: `Bearer ${OWNER}`, 'X-Staff-Request': '1' } })).json()
  const skip = (weekend.data ?? []).map(lit).join(',') || `''`
  const [jobId, customerId] = sql(`SELECT j.id || '|' || j."crmContactId" FROM "SavedJob" j JOIN "CrmContact" c ON c.id = j."crmContactId" AND c."deletedAt" IS NULL
    WHERE j."deletedAt" IS NULL AND j."archivedAt" IS NULL AND j.id NOT IN (${skip}) ORDER BY j."updatedAt" DESC LIMIT 1`).split('|')
  if (!jobId || !customerId) throw new Error('no job with a customer on the dev copy')
  const jobBefore = sql(`SELECT "scheduledDate" || '|' || COALESCE("scheduledEndDate", '') || '|' || "opsStage" || '|' || "crewAssigned" FROM "SavedJob" WHERE id = ${lit(jobId)}`)
  const apptsBefore = sql(`SELECT count(*) FROM "CrmAppointment" WHERE "crmContactId" = ${lit(customerId)}`)

  browser = await webkit.launch()
  // No service worker, so the one request made to fail in step 2 is seen by the test.
  const ctx = await browser.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block' })
  await signInByCookie(ctx, { api: API })
  const page = await ctx.newPage()
  await page.goto(`${APP}/customers/${encodeURIComponent(customerId)}`, { waitUntil: 'domcontentloaded' })
  await page.locator('text=Next appt').first().waitFor({ timeout: 45000 })
  const nextBefore = (await page.locator('text=Next appt').first().locator('xpath=..').innerText()).replace(/\s+/g, ' ')
  const open = date => page.evaluate(d => window.dispatchEvent(new CustomEvent('ezbiz:book-appointment', { detail: d })), { customerId, type: 'install', jobId, date })
  const dlg = page.locator('[data-booking-dialog]')

  // 1. Said before Book.
  await open(FRIDAY)
  await dlg.waitFor({ timeout: 15000 })
  const said = dlg.locator('[data-booking-refused="day"]')
  await said.waitFor({ timeout: 15000 }).catch(() => {})
  const saidText = await said.innerText().catch(() => '')
  check(/^Installs go on crew days \(Monday to Thursday\)\. Fri, Oct 30 is not one\./.test(saidText), `before Book, the window says: "${saidText}"`)
  check(await dlg.locator('[data-save]').isDisabled(), 'and Book waits for a crew day')
  await shot(page, 'crewday-1-said')
  await dlg.locator('[data-field="date"]').fill(MONDAY)
  await sleep(300)
  check(!(await dlg.locator('[data-booking-refused]').isVisible().catch(() => false)) && await dlg.locator('[data-save]').isEnabled(), 'Mon Nov 2: no warning, Book can be tapped')
  await dlg.locator('button[aria-label="Close"]').tap()
  await dlg.waitFor({ state: 'detached', timeout: 5000 })

  // 2. The check cannot run (the weekend jobs list did not load): the server refuses, the window says why.
  await page.route('**/api/schedule/weekend-jobs', r => r.fulfill({ status: 503, contentType: 'application/json', body: '{"success":false,"error":"busy"}' }))
  await open(FRIDAY)
  await dlg.waitFor({ timeout: 15000 })
  await sleep(500)
  check(!(await dlg.locator('[data-booking-refused]').isVisible().catch(() => false)), 'without the weekend jobs list, nothing is said before Book (the server decides)')
  await dlg.locator('[data-save]').tap()
  const refused = dlg.locator('[data-booking-refused="server"]')
  await refused.waitFor({ timeout: 20000 }).catch(() => {})
  const refusedText = await refused.innerText().catch(() => '')
  check(/^Not booked\. Installs go on crew days \(Monday to Thursday\)\. Fri, Oct 30 is not one\. Pick a crew day/.test(refusedText), `the window shows the server's reason: "${refusedText}"`)
  check(!/did not accept|tell Jonathan/i.test(await page.locator('body').innerText()), 'no "The server did not accept ... tell Jonathan" anywhere')
  check(await dlg.isVisible() && !(await page.locator('[data-booked]').count()), 'the window stays open to change the day')
  await shot(page, 'crewday-2-refused')
  await sleep(1500)
  check(!(await page.locator('[data-sync-badge]').count()), 'no waiting or "Couldn\'t save" badge: nothing is kept on the phone')
  check(sql(`SELECT count(*) FROM "CrmAppointment" WHERE "crmContactId" = ${lit(customerId)}`) === apptsBefore, 'nothing booked on the server')
  // Changing the day clears the reason.
  await dlg.locator('[data-field="date"]').fill('2026-11-03')
  await sleep(300)
  check(!(await refused.isVisible().catch(() => false)), 'changing the day clears the reason')
  await dlg.locator('button[aria-label="Close"]').tap()
  await dlg.waitFor({ state: 'detached', timeout: 5000 })
  const nextNow = (await page.locator('text=Next appt').first().locator('xpath=..').innerText()).replace(/\s+/g, ' ')
  check(nextNow === nextBefore && !/Oct 30/.test(nextNow), `the customer page's Next appt is unchanged: "${nextNow}"`)

  // After a reload: still nothing kept.
  await page.unroute('**/api/schedule/weekend-jobs')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('text=Next appt').first().waitFor({ timeout: 45000 })
  await sleep(2000)
  const afterReload = (await page.locator('text=Next appt').first().locator('xpath=..').innerText()).replace(/\s+/g, ' ')
  check(afterReload === nextBefore && !/Oct 30/.test(afterReload), `after a reload, Next appt is still "${afterReload}"`)
  check(!(await page.locator('[data-sync-badge]').count()), 'after a reload, no badge')
  check(sql(`SELECT "scheduledDate" || '|' || COALESCE("scheduledEndDate", '') || '|' || "opsStage" || '|' || "crewAssigned" FROM "SavedJob" WHERE id = ${lit(jobId)}`) === jobBefore, 'the job is as it was')
  await shot(page, 'crewday-3-reload')
} catch (err) {
  failed++
  console.log(`FAIL  ${err?.message || err}`)
} finally {
  await browser?.close().catch(() => {})
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
