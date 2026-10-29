// Unassigned website leads push the owner with a one tap Assign (Jonathan, Oct 28 2026: "Leads: unassigned
// website and phone leads push me right away with a one tap Assign (to me or Christa). They never sit unseen.").
// Each step as the person who does it:
//   website   a customer sends a quote from the company website (the widget's /api/quoting/submit)
//   owner     the push is in the dev outbox (never sent); on his iPhone (WebKit, 390 x 844) the Dashboard says
//             a lead is waiting, a tap opens its Assign screen, one tap gives it to the Salesman
//   salesman  the customer is on the Salesman's list at once; the Salesman cannot assign
//   owner     the banner is gone; the customer's History says who assigned it to whom
//
// Run (dev copy only; a server serving the built app, started with EZ_QUOTE_WIDGET_TOKEN set):
//   cd apps/web && pnpm -s build
//   E2E_ACCESS_TOKEN_FILE=<dev owner token> node e2e/lead-assign.mjs   (or through run-heavy.sh, which sets the widget key)
//   [APP_URL=http://localhost:4001] [WIDGET_TOKEN=<the server's EZ_QUOTE_WIDGET_TOKEN>] [OUTBOX=<apps/portal/logs/dev-outbox.log>]
// Makes its own Salesman login and lead (LEADCHECK ..., @example.invalid) and removes them at the end.
import './devOnly.mjs'
import { webkit, devices } from 'playwright'
import fs from 'fs'
import crypto from 'crypto'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'
import { makeTestLogin, removeTestLogin, signInByCookie } from './lib.mjs'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || APP
const OWNER = process.env.E2E_ACCESS_TOKEN || (process.env.E2E_ACCESS_TOKEN_FILE ? fs.readFileSync(process.env.E2E_ACCESS_TOKEN_FILE, 'utf8').trim() : '')
// run-heavy.sh exports the dev copy's widget key as EZ_QUOTE_WIDGET_TOKEN; the dev outbox is apps/portal/logs/dev-outbox.log.
const WIDGET = process.env.WIDGET_TOKEN || process.env.EZ_QUOTE_WIDGET_TOKEN || ''
const OUTBOX = process.env.OUTBOX || fileURLToPath(new URL('../../portal/logs/dev-outbox.log', import.meta.url))
if (!OWNER || !WIDGET || !OUTBOX) { console.error('Set E2E_ACCESS_TOKEN(_FILE), E2E_STAFF_COOKIE, WIDGET_TOKEN and OUTBOX.'); process.exit(2) }
const DB = 'ezbiz_dev'
const sql = q => execFileSync('psql', ['-d', DB, '-At', '-v', 'ON_ERROR_STOP=1', '-c', q]).toString().trim()
const lit = s => `'${String(s).replace(/'/g, "''")}'`
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function until(fn, ms = 20000) { const end = Date.now() + ms; for (;;) { const v = await fn().catch(() => null); if (v || Date.now() > end) return v; await sleep(400) } }
const call = async (token, method, p, body) => {
  const r = await fetch(`${API}${p}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Staff-Request': '1' }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: r.status, json: await r.json().catch(() => ({})) }
}
let failed = 0
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++ }

const stamp = crypto.randomBytes(3).toString('hex')
const name = `LEADCHECK ${stamp}`
const ref = `leadcheck${stamp}`
let salesman = null, contactId = null, intakeId = null, browser = null

try {
  if (sql('SELECT current_database()') !== DB) throw new Error('not the dev copy')
  salesman = await makeTestLogin({ role: 'sales_rep', firstName: 'LEADCHECK', lastName: `Sales ${stamp}`, ownerToken: OWNER, api: API })

  // The website: a customer sends a quote.
  const before = fs.existsSync(OUTBOX) ? fs.readFileSync(OUTBOX, 'utf8').split('\n').filter(Boolean).length : 0
  const sent = await fetch(`${API}/api/quoting/submit`, { method: 'POST', headers: { Authorization: `Bearer ${WIDGET}`, 'Content-Type': 'application/json' }, body: JSON.stringify({
    customerName: name, customerPhone: `555010${String(parseInt(stamp, 16) % 10000).padStart(4, '0')}`, customerEmail: `leadcheck-${stamp}@example.invalid`,
    address: '110 SE Watula Ave, Ocala, FL 34471', material: 'Vinyl', style: 'Privacy', height: '6ft', color: 'White', linearFeet: 152, submissionId: ref,
  }) })
  check(sent.status === 201, `the website quote is saved (${sent.status})`)
  contactId = sql(`SELECT "crmContactId" FROM "IntakeLead" WHERE "sourceRef" = ${lit(ref)}`)
  intakeId = sql(`SELECT id FROM "IntakeLead" WHERE "sourceRef" = ${lit(ref)}`)
  const pushed = await until(async () => fs.readFileSync(OUTBOX, 'utf8').split('\n').filter(Boolean).slice(before).map(l => JSON.parse(l)).find(l => l.title === `New lead: ${name}`))
  check(!!pushed && pushed.channel === 'push', `one push to the owner, held in the dev outbox: "${pushed?.title}" / "${pushed?.body}"`)
  check(!!pushed && /^Website quote · Ocala · Vinyl, Privacy, 6ft, White, 152 ft\. Tap to assign\./.test(pushed.body), 'it says where from, the town and what they asked for')
  check(!!pushed && pushed.body.includes(`/assign-lead?customer=${contactId}`), 'a tap opens the Assign screen for this lead')

  // The Salesman cannot see it yet, and cannot assign.
  const salesList = await call(salesman.token, 'GET', '/api/crm-contacts')
  check(!(salesList.json.data ?? []).some(c => c.id === contactId), 'before it is assigned, the lead is not on the Salesman\'s list')
  check((await call(salesman.token, 'POST', `/api/lead-assign/${contactId}`, { to: salesman.id })).status === 403, 'the Salesman cannot assign it (403)')

  // The owner's iPhone: the Dashboard says it is waiting; tap, then one tap to assign.
  browser = await webkit.launch()
  const ctx = await browser.newContext({ ...devices['iPhone 13'] })
  await signInByCookie(ctx, { api: API })

  // Tapping the push on an iPhone loads its link fresh: the Assign screen, not the customer page (review Oct 28 2026).
  {
    const fresh = await ctx.newPage()
    await fresh.goto(`${APP}/assign-lead?customer=${encodeURIComponent(contactId)}`, { waitUntil: 'domcontentloaded' })
    const one = fresh.locator(`[data-assign-lead="${contactId}"]`)
    await one.waitFor({ timeout: 45000 }).catch(() => {})
    check(new URL(fresh.url()).pathname === '/assign-lead', `the push's link loaded fresh stays on the Assign screen (${new URL(fresh.url()).pathname})`)
    check(await one.locator(`[data-assign-to="${salesman.id}"]`).isVisible().catch(() => false), 'and shows the Assign buttons for this lead')
    await fresh.screenshot({ path: process.env.SHOTS ? `${process.env.SHOTS}/0-fresh-assign.png` : '/dev/null' }).catch(() => {})
    // The bell entry for the same lead opens the Assign screen too.
    const link = sql(`SELECT link FROM "Notification" WHERE title = ${lit('Website quote: ' + name)} ORDER BY "createdAt" DESC LIMIT 1`)
    check(link === `/assign-lead?customer=${contactId}`, `the bell entry links to the Assign screen (${link})`)
    await fresh.locator('button[aria-label="Notifications"]').first().tap()
    await fresh.locator(`button:has-text("Website quote: ${name}")`).first().tap()
    await fresh.waitForURL(u => u.pathname === '/assign-lead', { timeout: 10000 }).catch(() => {})
    check(new URL(fresh.url()).pathname === '/assign-lead' && new URL(fresh.url()).searchParams.get('customer') === contactId, `tapping the bell entry opens the Assign screen (${new URL(fresh.url()).pathname}${new URL(fresh.url()).search})`)
    await fresh.close()
  }

  const page = await ctx.newPage()
  await page.goto(`${APP}/`, { waitUntil: 'domcontentloaded' })
  const banner = page.locator('[data-waiting-leads]')
  await banner.waitFor({ timeout: 45000 })
  check(/waiting to be assigned/.test(await banner.innerText()), `the owner's Dashboard says: "${(await banner.locator('.font-semibold').first().innerText())}"`)
  await page.screenshot({ path: process.env.SHOTS ? `${process.env.SHOTS}/1-banner.png` : '/dev/null' }).catch(() => {})
  await banner.locator(`button:has-text("${name}")`).tap()
  await page.locator(`[data-assign-lead="${contactId}"]`).waitFor({ timeout: 20000 })
  const btn = page.locator(`[data-assign-lead="${contactId}"] [data-assign-to="${salesman.id}"]`)
  check(await btn.isVisible(), `the Assign screen offers "${await btn.innerText()}"`)
  const all = await page.locator(`[data-assign-lead="${contactId}"] [data-assign-to]`).allInnerTexts()
  check(/\(me\)/.test(all[0] ?? ''), `the owner first, then each Salesman by name: ${all.join(' | ')}`)
  await page.screenshot({ path: process.env.SHOTS ? `${process.env.SHOTS}/2-assign.png` : '/dev/null' }).catch(() => {})
  await btn.tap()
  const done = page.locator(`[data-assign-lead="${contactId}"] [data-lead-assigned]`)
  await done.waitFor({ timeout: 20000 })
  check((await done.innerText()).includes(`Assigned to ${salesman.name}`), `one tap: "${(await done.innerText()).split('\n')[0]}"`)
  await page.screenshot({ path: process.env.SHOTS ? `${process.env.SHOTS}/3-assigned.png` : '/dev/null' }).catch(() => {})

  // The Salesman has it at once.
  const after = await call(salesman.token, 'GET', '/api/crm-contacts')
  check((after.json.data ?? []).some(c => c.id === contactId), 'the lead is on the Salesman\'s customer list right away')
  check(sql(`SELECT "salesRep" FROM "CrmContact" WHERE id = ${lit(contactId)}`) === salesman.name, 'the customer\'s Sales rep is the Salesman')

  // Assigning it again to someone else asks first.
  const again = await call(OWNER, 'POST', `/api/lead-assign/${contactId}`, { to: sql(`SELECT id FROM "CrmUser" WHERE role = 'super_admin' AND status = 'active' ORDER BY "createdAt" LIMIT 1`) })
  check(again.status === 409 && /^Already assigned to /.test(again.json.error), `assigning it again to someone else says so: "${again.json.error}"`)

  // The banner is gone; the History says who assigned it.
  const left = await call(OWNER, 'GET', '/api/lead-assign')
  check(!(left.json.data?.leads ?? []).some(l => l.customerId === contactId), 'it is off the waiting list')
  const hist = await call(OWNER, 'GET', `/api/follow-ups/history?customerId=${contactId}`)
  const line = (hist.json.data ?? []).find(h => h.title === 'Lead assigned')
  check(!!line && line.detail.startsWith(`Lead assigned to ${salesman.name} by `), `the customer's History: "${line?.title}: ${line?.detail}" (${line?.by})`)

  // Moving a lead someone already has asks first, with the names (review Oct 28 2026: one tap moved it at once).
  {
    const ownerRow = sql(`SELECT id || '|' || TRIM(COALESCE("firstName",'') || ' ' || COALESCE("lastName",'')) FROM "CrmUser" WHERE email = 'jbohdal@example.invalid'`).split('|')
    const [ownerId, ownerName] = ownerRow
    const again2 = await ctx.newPage()
    await again2.goto(`${APP}/assign-lead?customer=${encodeURIComponent(contactId)}`, { waitUntil: 'domcontentloaded' })
    const one = again2.locator(`[data-assign-lead="${contactId}"]`)
    await one.locator('[data-lead-has-rep]').waitFor({ timeout: 45000 })
    check((await one.locator('[data-lead-has-rep]').innerText()).includes(salesman.name), `the screen says who has it: "${(await one.locator('[data-lead-has-rep]').innerText()).trim()}"`)
    await one.locator(`[data-assign-to="${ownerId}"]`).tap()
    const ask = one.locator('[data-lead-move-ask]')
    await ask.waitFor({ timeout: 5000 }).catch(() => {})
    const askText = (await ask.innerText().catch(() => '')).split('\n')[0]
    check(askText === `Take this lead from ${salesman.name} and give it to ${ownerName}?`, `a tap on another person asks first: "${askText}"`)
    await sleep(800)
    check(sql(`SELECT "salesRep" FROM "CrmContact" WHERE id = ${lit(contactId)}`) === salesman.name, 'nothing is changed before the answer')
    await ask.locator('[data-lead-move-no]').tap()
    check(!(await ask.isVisible().catch(() => false)) && sql(`SELECT "salesRep" FROM "CrmContact" WHERE id = ${lit(contactId)}`) === salesman.name, 'No leaves it with the Salesman')
    const notesBefore = sql(`SELECT count(*) FROM "CrmContactNote" WHERE "crmContactId" = ${lit(contactId)} AND body LIKE 'Lead assigned to %'`)
    await one.locator(`[data-assign-to="${salesman.id}"]`).tap()
    await one.locator('[data-lead-already-theirs]').waitFor({ timeout: 5000 }).catch(() => {})
    check(/already .*Nothing was changed/.test(await one.locator('[data-lead-already-theirs]').innerText().catch(() => '')), `a tap on the person who has it changes nothing: "${(await one.locator('[data-lead-already-theirs]').innerText().catch(() => '')).trim()}"`)
    await sleep(800)
    check(sql(`SELECT count(*) FROM "CrmContactNote" WHERE "crmContactId" = ${lit(contactId)} AND body LIKE 'Lead assigned to %'`) === notesBefore, 'and writes no new History line')
    await again2.screenshot({ path: process.env.SHOTS ? `${process.env.SHOTS}/4-same-person.png` : '/dev/null' }).catch(() => {})
    await one.locator(`[data-assign-to="${ownerId}"]`).tap()
    await ask.waitFor({ timeout: 5000 })
    await again2.screenshot({ path: process.env.SHOTS ? `${process.env.SHOTS}/5-ask.png` : '/dev/null' }).catch(() => {})
    await ask.locator('[data-lead-move-yes]').tap()
    await one.locator('[data-lead-assigned]').waitFor({ timeout: 20000 })
    check(sql(`SELECT "salesRep" FROM "CrmContact" WHERE id = ${lit(contactId)}`) === ownerName, `Yes moves it: the Sales rep is now ${ownerName}`)
    await again2.close()
  }
} catch (err) {
  failed++
  console.log(`FAIL  ${err?.message || err}`)
} finally {
  await browser?.close().catch(() => {})
  try {
    if (sql('SELECT current_database()') === DB) {
      sql(`DELETE FROM "Notification" WHERE title LIKE ${lit('%' + name + '%')}`)
      sql(`DELETE FROM "IntakeLead" WHERE "sourceRef" = ${lit(ref)}`)
      if (contactId) {
        // The card the owner's phone made for the lead.
        sql(`UPDATE "PipelineState" SET leads = (SELECT COALESCE(jsonb_agg(l), '[]'::jsonb) FROM jsonb_array_elements(leads) l WHERE l->>'customerId' IS DISTINCT FROM ${lit(contactId)}), version = version + 1 WHERE leads @> ${lit(JSON.stringify([{ customerId: contactId }]))}::jsonb`)
        if (intakeId) for (const t of ['CardFollowUp', 'PendingTouch']) sql(`DELETE FROM "${t}" WHERE "cardId" = ${lit('intake-' + intakeId)}`)
        sql(`DELETE FROM "CustomerPossibleMatch" WHERE "contactId" = ${lit(contactId)} OR "matchId" = ${lit(contactId)}`)
        sql(`DELETE FROM "CrmContact" WHERE id = ${lit(contactId)}`)
      }
    }
  } catch (e) { console.log(`cleanup: ${e.message}`) }
  if (salesman) await removeTestLogin(salesman, { ownerToken: OWNER, api: API })
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
