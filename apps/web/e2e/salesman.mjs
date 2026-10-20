// A salesman's login, from the invite to a day's work, on the dev copy.
//
//   cd apps/web && pnpm -s build
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 E2E_ACCESS_TOKEN=<dev owner token> node e2e/salesman.mjs
//
//   1. The owner invites a Salesman on the Team page (the real invite, with the
//      link shown to copy). A fresh browser opens the link and sets a password.
//   2. The salesman's menu: Today, Pipeline, Customers, Quotes, Appointments,
//      Schedule; no Settings, Team, Automations, Inventory or Billing, and no
//      role switcher.
//   3. Adds a lead, moves its card, starts and saves a quote from the card.
//   4. Not offered: Delete on the customer, the card's lead, Settings (opening
//      /settings goes back to Today and says why).
//   5. Straight to the server with the salesman's own login: deleting the
//      customer or the quote, removing the card, changing settings and prices
//      are refused (403 with a plain sentence).
//   6. Signs in again on a phone (390 x 844) with the password.
// Screenshots (E2E_SHOTS=<folder>): dev-salesman-*.png at both sizes.
// Dev only (port 4001). Removes the user and everything it made.
import { chromium } from 'playwright'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || 'http://localhost:4001'
const OWNER = process.env.E2E_ACCESS_TOKEN || ''
const SHOTS = process.env.E2E_SHOTS || ''
const local = u => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(u)
if (!local(APP) || !local(API) || /:4000(\/|$)/.test(API) || /:4000(\/|$)/.test(APP)) { console.error('Refusing to run: the dev copy only (localhost, not port 4000).'); process.exit(2) }
if (!OWNER) { console.error('Set E2E_ACCESS_TOKEN (an owner login on the dev server).'); process.exit(2) }
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `dev-salesman-${name}.png`) }) }
const call = async (token, method, p, body) => {
  const r = await fetch(`${API}${p}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: r.status, json: await r.json().catch(() => ({})) }
}
const owner = (m, p, b) => call(OWNER, m, p, b)
async function until(fn, ms = 15000) {
  const end = Date.now() + ms
  let v = await fn()
  while (!v && Date.now() < end) { await sleep(500); v = await fn() }
  return v
}

const stamp = Date.now().toString(36).slice(-6)
const EMAIL = `e2e-salesman-${stamp}@example.test`
const PASSWORD = `Sm-${crypto.randomBytes(9).toString('base64url')}`
const LAST = `Salesman Lead ${stamp}`
const made = { userId: null, contactId: null, cardId: null, quoteIds: [] }

const browser = await chromium.launch()
const errors = []
const watch = (page, refused) => {
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)))
  page.on('dialog', d => d.accept().catch(() => {}))
  // Every refusal the salesman's own screens run into while doing allowed work.
  if (refused) page.on('response', r => { if (r.url().startsWith(API) && r.status() === 403) refused.push(`${r.request().method()} ${r.url().replace(API, '')}`) })
}
// Stage changes ask the server to run automations; the dev data holds real customers, so not here.
const noAutomations = page => page.route('**/api/automations/trigger', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true,"data":{"matched":0}}' }))

try {
  // ── 1. The owner invites a salesman, on the Team page ──
  const oc = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await oc.addInitScript(t => { localStorage.setItem('crm_access_token', t); if (!localStorage.getItem('crm_refresh_token')) localStorage.setItem('crm_refresh_token', 'e2e') }, OWNER)
  const op = await oc.newPage(); watch(op)
  await op.goto(`${APP}/team`, { waitUntil: 'domcontentloaded' })
  await op.locator('button:has-text("+ Invite Team Member")').click({ timeout: 60000 })
  const form = op.locator('form:has-text("Invite Team Member")')
  const inputs = form.locator('input[type="text"]')
  await inputs.nth(0).fill('E2E')
  await inputs.nth(1).fill(`Salesman ${stamp}`)
  await form.locator('input[type="email"]').fill(EMAIL)
  await form.locator('input[type="radio"][value="sales_rep"]').check()
  check('invite: Salesman is a role to pick, with what it may do', (await form.innerText()).includes('No settings, prices, team or deleting'))
  await shot(op, 'desktop-invite')
  await form.locator('button[type="submit"]').click()
  const link = await op.locator('[data-invite-url]').inputValue({ timeout: 15000 })
  await shot(op, 'desktop-invite-link')
  check('invite: the link is shown to copy', /\/accept-invite\?token=[0-9a-f]{64}&email=/.test(link))
  // A phone without Tailscale cannot open the link, so the steps come first.
  const steps = await op.locator('[data-invite-steps]').innerText()
  check('invite: Tailscale steps (Play Store and App Store) come before the link', /^Step 1: Install Tailscale/.test(steps.trim()) && steps.includes('play.google.com/store/apps/details?id=com.tailscale.ipn') && steps.includes('apps.apple.com/app/tailscale/id1470499037') && /Step 2: Open this link/.test(steps) && (await op.locator('[data-invite-copy]').textContent()) === 'Copy steps and link', steps.slice(0, 80))
  if (SHOTS) await op.locator('[data-invite-link]').screenshot({ path: path.join(SHOTS, 'dev-invite-steps.png') })
  const users = (await owner('GET', '/api/crm-auth/users')).json.data ?? []
  const row = users.find(u => u.email === EMAIL)
  made.userId = row?.id ?? null
  check('invite: the new login is a sales_rep, waiting for the invite', row?.role === 'sales_rep' && row?.status === 'invited', `${row?.role} ${row?.status}`)
  await oc.close()

  // ── The invited person opens the link and sets a password ──
  const u = new URL(link)
  const sc = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const sp = await sc.newPage()
  const refused = []
  watch(sp, refused); await noAutomations(sp)
  let token = ''
  sp.on('request', r => { const a = r.headers()['authorization']; if (a && r.url().startsWith(API)) token = a.replace(/^Bearer /, '') })
  await sp.goto(`${APP}${u.pathname}${u.search}`, { waitUntil: 'domcontentloaded' })
  await sp.locator('button:has-text("Set Password & Sign In")').waitFor({ timeout: 30000 })
  await shot(sp, 'desktop-set-password')
  const pw = sp.locator('form input[type="password"]')
  await pw.nth(0).fill(PASSWORD)
  await pw.nth(1).fill(PASSWORD)
  await sp.locator('button:has-text("Set Password & Sign In")').click()
  await sp.waitForSelector('[data-global-appointment]', { timeout: 60000 })
  await sleep(1500)
  check('accept invite: signed in straight away', !!token)

  // ── 2. The menu ──
  const navItems = (await sp.locator('.sidebar-desktop nav button').allInnerTexts()).map(t => t.trim()).filter(Boolean)
  const want = ['Today', 'Sales Pipeline', 'Customers', 'Quotes', 'Appointments', 'Schedule']
  const never = ['Settings', 'Team', 'Automations', 'Inventory', 'Billing', 'Integrations', 'Audit Log', 'P&L Statement']
  check('menu: Today, Pipeline, Customers, Quotes, Appointments, Schedule', want.every(w => navItems.includes(w)), navItems.join(', '))
  check('menu: no Settings, Team, Automations, Inventory, Billing', never.every(n => !navItems.includes(n)))
  check('menu: no role switcher, the role is shown', (await sp.locator('.sidebar-desktop select').count()) === 0 && (await sp.locator('.sidebar-desktop [data-role-label]').innerText()).trim() === 'Sales')
  await shot(sp, 'desktop-nav')

  // ── 3. Add a lead, move it, start a quote ──
  await sp.goto(`${APP}/pipeline`, { waitUntil: 'domcontentloaded' })
  await sp.waitForSelector('[data-kanban-col]', { timeout: 60000 }); await sleep(1200)
  await sp.locator('button:has-text("+ New lead")').first().click()
  await sp.locator('[data-lead-field="first-name"]').fill('E2E')
  await sp.locator('[data-lead-field="last-name"]').fill(LAST)
  await sp.locator('[data-lead-field="phone"]').fill(`352555${String(Math.floor(Math.random() * 9000) + 1000)}`)
  await sp.locator('[data-lead-add]').click()
  const card = await until(async () => ((await call(token, 'GET', '/api/pipeline')).json.data?.leads ?? []).find(l => l.lastName === LAST))
  made.cardId = card?.id ?? null
  made.contactId = card?.customerId ?? null
  check('lead: added (customer and card on the server)', !!card && !!card.customerId)
  const board = (await call(token, 'GET', '/api/pipeline')).json.data
  const stageNames = (board.stages ?? []).map(s => (typeof s === 'string' ? s : s.name))
  const target = stageNames.find(n => n && n !== card.stage)
  await sp.locator(`[data-kanban-col] >> text=E2E ${LAST}`).first().click(); await sleep(800)
  await sp.locator('[data-card-window]').waitFor()
  await sp.locator('[data-card-stage]').selectOption({ label: target }).catch(async () => sp.locator('[data-card-stage]').selectOption(target))
  const movedTo = await until(async () => { const l = ((await call(token, 'GET', '/api/pipeline')).json.data?.leads ?? []).find(x => x.id === made.cardId); return l?.stage === target ? l.stage : null })
  check('card: moved to another stage', movedTo === target, `${card.stage} -> ${movedTo}`)
  check('card: no Delete offered', !/\bDelete\b/.test(await sp.locator('[data-card-window]').innerText()))
  await shot(sp, 'desktop-card')
  await sp.locator('[data-card-new-quote]').click()
  const b = sp.locator('[data-quote-builder]')
  await b.waitFor({ timeout: 15000 })
  await b.locator('[data-step="yard"]').click()
  await b.locator('[data-shape="backyard"]').click()
  await b.locator('[data-side="Left return"] [data-side-length]').click()
  for (const [keys, last] of [[['3', '0'], 0], [['1', '2', '0'], 0], [['1', '5', '0'], 0], [['1', '0', '0'], 0], [['3', '0'], 1]]) {
    for (const k of keys) await sp.locator(`[data-ftin-pad] [data-pad-key="${k}"]`).click()
    await sp.locator(last ? '[data-ftin-pad] [data-pad-done]' : '[data-ftin-pad] [data-pad-next]').click()
  }
  await b.locator('[data-step="style"]').click()
  await b.locator('select').filter({ hasText: 'Select a fence style' }).selectOption({ label: "White Vinyl Privacy, 6 ft tall, 8 ft panels, No dig" })
  await b.locator('[data-step="price"]').click()
  await sleep(800)
  await shot(sp, 'desktop-quote')
  await sp.locator('[data-save-open]').click(); await sleep(600)
  await sp.locator('[data-save-submit]').click()
  const quotesFor = async () => ((await call(token, 'GET', '/api/saved-quotes')).json.data ?? []).filter(q => q.crmContactId === made.contactId)
  const quotes = await until(async () => { const q = await quotesFor(); return q.length ? q : null })
  made.quoteIds = (quotes ?? []).map(q => q.id)
  check('quote: started from the card and saved', made.quoteIds.length === 1, String(made.quoteIds.length))
  await sleep(1500)

  // ── 4. Not offered ──
  await sp.goto(`${APP}/?customer=${made.contactId}`, { waitUntil: 'domcontentloaded' })
  await sp.waitForSelector('[data-book-appointment]', { timeout: 30000 }); await sleep(800)
  check('customer: no Delete (the More menu is not there)', (await sp.locator('[data-customer-more]').count()) === 0)
  await shot(sp, 'desktop-customer')
  await sp.goto(`${APP}/settings`, { waitUntil: 'domcontentloaded' })
  const told = await sp.locator('text=Settings is not open to your login').first().waitFor({ timeout: 20000 }).then(() => true, () => false)
  await sleep(300)
  check('settings: opening /settings goes back to Today and says why', told && new URL(sp.url()).pathname === '/today', sp.url())
  check('settings: none of the Settings screen is shown', (await sp.locator('text=Fence styles').count()) === 0)
  await shot(sp, 'desktop-refused')
  await sp.goto(`${APP}/schedule`, { waitUntil: 'domcontentloaded' })
  const viewOnly = await sp.locator('[data-view-only]').first().waitFor({ timeout: 20000 }).then(() => true, () => false)
  check('schedule: shown, marked View only, no Settings button', viewOnly && (await sp.locator('button:text-is("Settings")').count()) === 0)
  await shot(sp, 'desktop-schedule')
  // Every page in the menu opens without the server refusing anything it asks for.
  for (const p of ['/', '/today', '/quotes', '/appointments', '/customers', '/site-plans']) {
    await sp.goto(`${APP}${p}`, { waitUntil: 'domcontentloaded' })
    await sp.waitForSelector('[data-global-appointment]', { timeout: 30000 }); await sleep(2500)
  }
  check('allowed work: nothing the salesman did or opened was refused by the server', refused.length === 0, [...new Set(refused)].join(', '))

  // ── 5. Straight to the server with the salesman's own login ──
  const r1 = await call(token, 'DELETE', `/api/crm-contacts/${made.contactId}`)
  check('API: deleting the customer is refused', r1.status === 403 && r1.json.error === 'Your role cannot delete records. Ask Jonathan.', `${r1.status} ${r1.json.error}`)
  const r2 = await call(token, 'DELETE', `/api/saved-quotes/${made.quoteIds[0]}`)
  check('API: deleting the quote is refused', r2.status === 403, `${r2.status} ${r2.json.error}`)
  const pv = (await call(token, 'GET', '/api/pipeline')).json.data.version
  const r3 = await call(token, 'PATCH', '/api/pipeline', { upsert: [], remove: [made.cardId], baseVersion: pv })
  check('API: removing the card is refused', r3.status === 403, `${r3.status} ${r3.json.error}`)
  const bs = (await call(token, 'GET', '/api/business-state')).json.data
  const r4 = await call(token, 'PATCH', '/api/business-state', { config: { ...(bs.config ?? {}), companyName: 'Changed by salesman' }, baseVersion: bs.version })
  check('API: changing settings is refused', r4.status === 403 && /settings/.test(r4.json.error), `${r4.status} ${r4.json.error}`)
  const inv = (await call(token, 'GET', '/api/inventory-state')).json.data
  const items = (inv.items ?? []).map((it, i) => (i === 0 ? { ...it, unitCost: (it.unitCost ?? 0) + 1 } : it))
  const r5 = await call(token, 'PUT', '/api/inventory-state', { items, bundles: inv.bundles, locations: inv.locations, stockLevels: inv.stockLevels, transactions: inv.transactions, kits: inv.kits, baseVersion: inv.version })
  check('API: changing a price is refused', r5.status === 403 && /prices/.test(r5.json.error), `${r5.status} ${r5.json.error}`)
  const r6 = await call(token, 'POST', '/api/crm-auth/invite', { firstName: 'X', lastName: 'Y', email: `x-${stamp}@example.test`, role: 'admin' })
  check('API: inviting a user is refused', r6.status === 403, `${r6.status} ${r6.json.error}`)
  const list = (await owner('GET', '/api/crm-contacts?limit=10000')).json.data
  const still = (list?.contacts ?? list ?? []).find(c => c.id === made.contactId)
  check('API: the customer is still there', !!still && !still.archivedAt)
  await sc.close()

  // ── 6. On a phone, signing in with the password ──
  const pc = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' })
  const pp = await pc.newPage(); watch(pp); await noAutomations(pp)
  await pp.goto(APP, { waitUntil: 'domcontentloaded' })
  await pp.waitForSelector('input[type="email"]', { timeout: 30000 })
  await pp.fill('input[type="email"]', EMAIL)
  await pp.fill('input[type="password"]', PASSWORD)
  await pp.click('button[type="submit"]')
  await pp.waitForSelector('[data-tabbar]', { timeout: 60000 }); await sleep(1500)
  check('phone: signed in with the password', true)
  await shot(pp, 'phone-today')
  await pp.locator('[data-tabbar] button:has-text("More")').click(); await sleep(600)
  const menuText = await pp.locator('body').innerText()
  check('phone: the menu has no Settings or Team', !/\n(Settings|Team)\n/.test(`\n${menuText}\n`))
  await shot(pp, 'phone-nav')
  await pp.goto(`${APP}/pipeline`, { waitUntil: 'domcontentloaded' })
  await pp.waitForSelector('[data-kanban-col]', { timeout: 60000 }); await sleep(1200)
  await pp.locator(`[data-kanban-col] >> text=E2E ${LAST}`).first().click().catch(() => {})
  await pp.locator('[data-card-window]').waitFor({ timeout: 10000 }).catch(() => {})
  await sleep(600)
  await shot(pp, 'phone-card')
  if (await pp.locator('[data-card-quotes] button, [data-card-quotes] [role="button"]').count()) {
    await pp.locator('[data-card-quotes] button, [data-card-quotes] [role="button"]').first().click().catch(() => {})
    await pp.locator('[data-quote-builder]').waitFor({ timeout: 10000 }).catch(() => {})
    await sleep(800)
  }
  await shot(pp, 'phone-quote')
  await pp.goto(`${APP}/settings`, { waitUntil: 'domcontentloaded' })
  const toldPhone = await pp.locator('text=Settings is not open to your login').first().waitFor({ timeout: 20000 }).then(() => true, () => false)
  check('phone: /settings says it is not open to this login', toldPhone)
  await shot(pp, 'phone-refused')
  await pc.close()
} catch (err) {
  check('ran to the end', false, String(err?.message ?? err).slice(0, 400))
} finally {
  // ── Clean up: the quote, the card, the customer, the user ──
  for (const id of made.quoteIds) await owner('DELETE', `/api/saved-quotes/${id}`).catch(() => {})
  if (made.cardId) {
    for (let i = 0; i < 3; i++) {
      const v = (await owner('GET', '/api/pipeline')).json.data?.version
      const r = await owner('PATCH', '/api/pipeline', { upsert: [], remove: [made.cardId], baseVersion: v })
      if (r.status === 200) break
    }
  }
  if (made.contactId) {
    const appts = ((await owner('GET', '/api/appointments')).json.data ?? []).filter(a => a.crmContactId === made.contactId)
    if (appts.length) console.log(`note: ${appts.length} appointment(s) left on the test customer`)
    await owner('DELETE', `/api/crm-contacts/${made.contactId}`).catch(() => {})
    // The customer's activity lines.
    const kv = (await owner('GET', '/api/kv')).json
    const acts = kv.data?.fencepro_customer_activity
    if (Array.isArray(acts) && acts.some(a => a.customerId === made.contactId)) {
      await owner('PUT', '/api/kv/fencepro_customer_activity', { value: acts.filter(a => a.customerId !== made.contactId), baseVersion: kv.versions.fencepro_customer_activity })
    }
  }
  const users = (await owner('GET', '/api/crm-auth/users')).json.data ?? []
  for (const u of users.filter(x => x.email === EMAIL)) await owner('DELETE', `/api/crm-auth/users/${u.id}`)
  const left = ((await owner('GET', '/api/crm-auth/users')).json.data ?? []).filter(x => x.email === EMAIL).length
  check('clean up: the test login is gone', left === 0)
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
  await browser.close()
  const failed = results.filter(r => !r).length
  console.log(`\n${results.length - failed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}
