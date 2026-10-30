// Messages from Code, Oct 30 2026, each as the person who meets it, on the dev copy.
//
//   cd apps/web && pnpm -s build
//   APP_URL=http://localhost:4090 API_URL=http://localhost:4090 E2E_ACCESS_TOKEN=<dev owner token> node e2e/code-messages.mjs
//
//   Code (the script, apps/portal/scripts/code-message.ts): a needs-answer message with markdown details and a live
//     one are saved; the push is held in the dev outbox (never sent from dev) for the owner's login only.
//   Owner (iPhone-size Safari engine): an orange dot on More; the menu has "Messages from Code" with the unread count;
//     the list shows both, newest first, unread in bold; tapping one opens it with its details drawn (heading, list,
//     bold, code; a <script> in it is plain text) and the count drops; Back closes it; the push's address
//     (/messages-from-code?msg=<id>) opens that message straight away; "I answered this" marks it answered.
//   Owner (computer): the side menu line with its count; the count goes once all are read.
//   Another admin, the office and a Salesman: no menu line, and the address shows "for the owner only" or sends
//     them home; the API answers 403.
//   No page errors.
// Dev only (localhost, never port 4000). Removes everything it made.
import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import { chromium, webkit, devices } from 'playwright'
import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { execFileSync } from 'child_process'
import { makeTestLogin, removeTestLogin, reporter, sleep, ACCESS_TOKEN } from './lib.mjs'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || 'http://localhost:4001'
const local = u => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(u)
if (!local(APP) || !local(API) || /:4000(\/|$)/.test(API) || /:4000(\/|$)/.test(APP)) { console.error('Refusing to run: the dev copy only (localhost, not port 4000).'); process.exit(2) }
const sql = q => execFileSync('psql', ['-d', 'ezbiz_dev', '-At', '-c', q]).toString().trim()
const lit = s => `'${String(s).replace(/'/g, "''")}'`
const PORTAL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../portal')

const stamp = crypto.randomUUID().slice(0, 6)
const T = reporter()
const errors = []
const logins = []
let safari, chrome
let outbox = ''

/** Send a message the way Code does (the script), its push held in a dev outbox file of this run's own. */
function codeMessage(args) {
  const out = execFileSync('pnpm', ['exec', 'tsx', 'scripts/code-message.ts', ...args], { cwd: PORTAL, encoding: 'utf8', env: { ...process.env, OUTBOUND_GATE: 'closed', DEV_OUTBOX_FILE: outbox } })
  return { out, id: out.match(/Saved message (\S+)/)?.[1] }
}

async function signedIn(login, phone) {
  const ctx = phone ? await safari.newContext({ ...devices['iPhone 13'] }) : await chrome.newContext({ viewport: { width: 1440, height: 900 } })
  const r = login
    ? await ctx.request.post(`${API}/api/crm-auth/login`, { headers: { 'X-Staff-Request': '1' }, data: { email: login.email, password: login.password, cookie: true } })
    : await ctx.request.post(`${API}/api/crm-auth/move-over`, { headers: { 'X-Staff-Request': '1', 'Content-Type': 'application/json', Authorization: `Bearer ${ACCESS_TOKEN}` }, data: {} })
  if (!r.ok()) throw new Error(`sign in failed: ${r.status()} ${await r.text()}`)
  const page = await ctx.newPage()
  page.on('pageerror', e => errors.push(`${login?.email ?? 'owner'}: ${String(e).slice(0, 200)}`))
  page.on('dialog', d => d.accept().catch(() => {}))
  return { ctx, page }
}
const go = async (page, p) => { await page.goto(`${APP}${p}`, { waitUntil: 'domcontentloaded' }); await page.waitForSelector('[data-tabbar], [data-global-appointment]', { timeout: 30000 }).catch(() => {}); await sleep(2000) }
const unreadOnLine = async page => Number(await page.locator('[data-nav-badge="Messages from Code"]:visible').first().textContent({ timeout: 1500 }).catch(() => '0')) || 0

try {
  outbox = path.join(os.tmpdir(), `code-messages-e2e-${stamp}.log`)
  const admin = await makeTestLogin({ role: 'admin', firstName: 'E2E', lastName: `Admin ${stamp}` }); logins.push(admin)
  const office = await makeTestLogin({ role: 'office_staff', firstName: 'E2E', lastName: `Office ${stamp}` }); logins.push(office)
  const sales = await makeTestLogin({ role: 'sales_rep', firstName: 'E2E', lastName: `Sales ${stamp}` }); logins.push(sales)
  const ownerId = sql(`select id from "CrmUser" where role = 'super_admin' and status = 'active' order by "createdAt" limit 1`)
  const account = sql(`select "crmAccountId" from "CrmUser" where id = ${lit(ownerId)}`)
  // A phone signed up for push for the owner and for each of the others (fake addresses; the gate holds it anyway).
  for (const [who, id] of [['owner', ownerId], ['admin', admin.id], ['office', office.id], ['sales', sales.id]]) {
    sql(`insert into "PushSubscription"(id, "accountId", "userId", endpoint, p256dh, auth) values (${lit(`e2e-cm-${stamp}-${who}`)}, ${lit(account)}, ${lit(id)}, ${lit(`https://push.example.invalid/e2e-cm-${stamp}/${who}`)}, 'x', 'x')`)
  }

  // ── Code sends ──
  const body = `## The question\n\nThe 5 ft gate on **E2E ${stamp}**: one hinge pair per leaf, or two?\n\n- A: 1 pair per leaf (the rule now)\n- B: 2 pairs per leaf\n\n\`\`\`\nbash ~/ezbiz/deploy/mac/update.sh\n\`\`\`\n\nReply A or B. <script>window.__hacked = 1</script>`
  const bodyFile = path.join(os.tmpdir(), `code-messages-e2e-${stamp}.md`)
  fs.writeFileSync(bodyFile, body)
  const ask = codeMessage(['--kind', 'needs_answer', '--title', `E2E ${stamp} Gate hinges: 1 pair per leaf or 2?`, '--body-file', bodyFile])
  await sleep(50)
  const live = codeMessage(['--kind', 'live', '--title', `E2E ${stamp} Live: Messages from Code`, '--body', 'Deployed and checked.'])
  fs.rmSync(bodyFile, { force: true })
  T.check('the script saves both and says the push went to the owner only', !!ask.id && !!live.id && /Push to the owner only \(1 owner login, \d+ phones?\): sent 0, held [1-9]/.test(ask.out), ask.out.split('\n').filter(l => l.startsWith('Push')).join(' '))
  const held = fs.existsSync(outbox) ? fs.readFileSync(outbox, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(l => l.body?.includes(stamp)) : []
  // One line per phone: the owner may have more than one signed up on the dev copy.
  T.check('the dev outbox has the two pushes, all for the owner\'s phones only', new Set(held.map(h => h.title)).size === 2 && held.every(h => h.to.includes(ownerId) && !h.to.includes(admin.id) && !h.to.includes(office.id) && !h.to.includes(sales.id)), held.map(h => `${h.title}: ${h.to}`).join(' | '))
  T.check('the pushes say what kind and the one line', held.some(h => h.title === 'Needs your answer' && h.body.endsWith('Gate hinges: 1 pair per leaf or 2?')) && held.some(h => h.title === 'Live now'))

  safari = await webkit.launch()
  chrome = await chromium.launch()

  // ── Owner, iPhone ──
  {
    const { ctx, page } = await signedIn(null, true)
    await go(page, '/today')
    T.check('owner phone: an orange dot on More', await page.locator('[data-more-badge]').isVisible().catch(() => false))
    await page.locator('[data-tabbar] button', { hasText: 'More' }).click()
    await sleep(600)
    const line = page.locator('.mobile-nav-drawer button', { hasText: 'Messages from Code' })
    const before = await unreadOnLine(page)
    T.check('owner phone: the menu has Messages from Code with the unread count', await line.isVisible() && before >= 2, `count ${before}`)
    await line.click()
    await page.waitForSelector('[data-code-messages-page]', { timeout: 10000 })
    await sleep(1200)
    const items = await page.locator('[data-code-item]').evaluateAll(els => els.map(e => ({ id: e.getAttribute('data-code-item'), unread: e.hasAttribute('data-unread') })))
    const iAsk = items.findIndex(i => i.id === ask.id), iLive = items.findIndex(i => i.id === live.id)
    T.check('owner phone: both listed, newest first, unread', iLive >= 0 && iAsk > iLive && items[iAsk].unread && items[iLive].unread, `positions ${iLive}, ${iAsk}`)
    const width = await page.evaluate(() => document.documentElement.scrollWidth)
    T.check('owner phone: the list fits the screen (no side scroll)', width <= 390 + 1, `${width}px`)
    await page.locator(`[data-code-item="${ask.id}"]`).click()
    await page.waitForSelector(`[data-code-window="${ask.id}"] [data-code-body]`, { timeout: 10000 })
    const win = page.locator(`[data-code-window="${ask.id}"]`)
    const drawn = await win.evaluate(w => ({ h: !!w.querySelector('[role=heading]'), li: w.querySelectorAll('li').length, b: !!w.querySelector('strong'), pre: !!w.querySelector('pre'), script: !!w.querySelector('script'), text: w.textContent || '' }))
    T.check('owner phone: the details are drawn (heading, list, bold, code)', drawn.h && drawn.li === 2 && drawn.b && drawn.pre)
    T.check('owner phone: a <script> in the details is plain text, not run', !drawn.script && drawn.text.includes('<script>') && !(await page.evaluate(() => window.__hacked)))
    await sleep(800)
    await page.goBack()
    await sleep(800)
    T.check('owner phone: Back closes the message, the list is there', !(await win.isVisible().catch(() => false)) && await page.locator('[data-code-messages-page]').isVisible())
    T.check('owner phone: the opened one is read now', !(await page.locator(`[data-code-item="${ask.id}"]`).getAttribute('data-unread').then(v => v !== null)))
    await page.locator('[data-tabbar] button', { hasText: 'More' }).click()
    await sleep(500)
    const after = await unreadOnLine(page)
    T.check('owner phone: the unread count dropped by one', after === before - 1, `${before} -> ${after}`)
    await page.locator('.mobile-nav-drawer button[aria-label="Close menu"]').click().catch(() => {})
    await page.close()
    // The push's address opens the message itself, loaded fresh as a phone opens a tapped push.
    const page2 = await ctx.newPage()
    page2.on('pageerror', e => errors.push(`owner: ${String(e).slice(0, 200)}`))
    await go(page2, `/messages-from-code?msg=${live.id}`)
    await page2.waitForSelector(`[data-code-window="${live.id}"] [data-code-body]`, { timeout: 10000 }).catch(() => {})
    T.check('owner phone: the push\'s address opens that message', await page2.locator(`[data-code-window="${live.id}"]`).isVisible().catch(() => false))
    await page2.locator(`[data-code-window="${live.id}"] button[aria-label="Close"]`).click().catch(() => {})
    await sleep(600)
    await page2.locator(`[data-code-item="${ask.id}"]`).click()
    await page2.locator(`[data-code-window="${ask.id}"] [data-code-answer]`).click({ timeout: 10000 }).catch(() => {})
    await sleep(800)
    T.check('owner phone: "I answered this" marks it answered', await page2.locator(`[data-code-window="${ask.id}"] [data-code-answered]`).isVisible().catch(() => false) && sql(`select "answeredAt" is not null from "CodeMessage" where id = ${lit(ask.id)}`) === 't')
    await ctx.close()
  }

  // ── Owner, computer ──
  {
    // Everything else unread is read first (the dev copy may hold older ones), so the count can go to none.
    const { ctx, page } = await signedIn(null, false)
    await go(page, '/today')
    const line = page.locator('.sidebar-desktop button', { hasText: 'Messages from Code' })
    T.check('owner computer: the side menu has Messages from Code', await line.isVisible())
    await line.click()
    await page.waitForSelector('[data-code-messages-page]', { timeout: 10000 })
    await sleep(1000)
    for (let i = 0; i < 30; i++) {
      const unread = page.locator('[data-code-item][data-unread]').first()
      if (!(await unread.count())) break
      await unread.click()
      await page.waitForSelector('[data-code-window] [data-code-body], [data-code-window] p.text-red-600', { timeout: 10000 }).catch(() => {})
      await page.locator('[data-code-window] button[aria-label="Close"]').click()
      await sleep(500)
    }
    await sleep(800)
    T.check('owner computer: once all are read, no count on the menu line', !(await page.locator('.sidebar-desktop [data-nav-badge="Messages from Code"]').count()))
    await ctx.close()
  }

  // ── Everyone else ──
  for (const [label, login, phone] of [['another admin', admin, false], ['the office', office, false], ['a Salesman', sales, true]]) {
    const { ctx, page } = await signedIn(login, phone)
    await go(page, '/today')
    if (phone) { await page.locator('[data-tabbar] button', { hasText: 'More' }).click(); await sleep(500) }
    const lines = await page.locator('button:visible', { hasText: 'Messages from Code' }).count()
    T.check(`${label}: no Messages from Code in the menu`, lines === 0)
    await go(page, `/messages-from-code?msg=${ask.id}`)
    await sleep(1000)
    const sees = await page.locator(`[data-code-window], [data-code-item]`).count()
    const told = await page.locator('[data-code-denied]').isVisible().catch(() => false)
    T.check(`${label}: the address shows none of it (owner only, or sent home)`, sees === 0 && (told || !page.url().includes('messages-from-code')), page.url().replace(APP, ''))
    const api = await ctx.request.get(`${API}/api/code-messages/${ask.id}`, { headers: { 'X-Staff-Request': '1' } })
    T.check(`${label}: the API answers 403`, api.status() === 403, String(api.status()))
    await ctx.close()
  }

  T.check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
} catch (err) {
  T.check('ran to the end', false, String(err?.stack || err).slice(0, 400))
} finally {
  try { sql(`delete from "PushSubscription" where id like ${lit(`e2e-cm-${stamp}-%`)}`) } catch { /* already gone */ }
  try { sql(`delete from "CodeMessage" where title like ${lit(`E2E ${stamp}%`)}`) } catch { /* already gone */ }
  for (const l of logins) await removeTestLogin(l)
  if (outbox) fs.rmSync(outbox, { force: true })
  await safari?.close(); await chrome?.close()
}
process.exit(T.finish())
