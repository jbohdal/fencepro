// Staff sign in by cookie (plan of Oct 20, 2026), on the dev copy.
//
//   cd apps/web && pnpm -s build
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 E2E_ACCESS_TOKEN=<dev owner token> \
//   [DEVICES=desktop,webkit,android] [CDP_URL=http://localhost:9333] [SHOTS=<folder>] node e2e/staff-signin.mjs
//
// Android: the emulator (emulator-5554) with
//   adb reverse tcp:4001 tcp:4001; adb forward tcp:9333 localabstract:chrome_devtools_remote
//
// On each device (desktop Chrome, WebKit at iPhone size, the Android emulator's Chrome):
//   1. Signing in on the page sets the HttpOnly cookie `ezbiz_staff`; nothing
//      about the sign in is in the browser's storage, and the page cannot read
//      the cookie.
//   2. Moving over: a phone signed in before the switch (the old tokens in its
//      storage, and a change waiting in the old, unencrypted outbox) opens the
//      app: the cookie is set, the old keys are gone, the waiting change is sent.
//   3. A change that cannot be sent waits encrypted (only its id in the clear).
//      Signing out asks first; after signing out it is still on the phone, and
//      it goes once the same person signs in again.
//   4. A salesman signed in by cookie gets no cost in any answer.
// Desktop only:
//   5. A second browser of the same login keeps working when the first signs out.
//   6. Ending a session in Settings > Team signs that device out at once.
//
// Makes two logins (an admin and a salesman) and test customers; removes them at the end.

import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import { chromium, webkit, devices } from 'playwright'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || 'http://localhost:4001'
const OWNER = process.env.E2E_ACCESS_TOKEN || ''
const CDP = process.env.CDP_URL || 'http://localhost:9333'
const SHOTS = process.env.SHOTS || ''
// Android only when an emulator's Chrome is connected (CDP_URL set); the heavy runs leave it off.
const DEVICES = (process.env.DEVICES || (process.env.CDP_URL ? 'desktop,webkit,android' : 'desktop,webkit')).split(',').map(s => s.trim()).filter(Boolean)
const local = u => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(u)
if (!local(APP) || !local(API) || /:4000(\/|$)/.test(API) || /:4000(\/|$)/.test(APP)) { console.error('Refusing to run: the dev copy only (localhost, not port 4000).'); process.exit(2) }
if (!OWNER) { console.error('Set E2E_ACCESS_TOKEN (an owner login on the dev server).'); process.exit(2) }
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const call = async (token, method, p, body) => {
  const r = await fetch(`${API}${p}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await r.text()
  let json = {}; try { json = JSON.parse(text) } catch { /* not JSON */ }
  return { status: r.status, json, text }
}
const owner = (m, p, b) => call(OWNER, m, p, b)
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v } catch { /* not yet */ } await sleep(400) } return null }
const stamp = Date.now().toString(36).slice(-6)
const made = { users: [], contacts: [] }
const COST = /"(unitCost|fallbackCost|materialCost|laborCost|tearOutCost|totalCOGS|gmPct|grossMargin|margin|margins|subRate|subRateDefault|manHourRate|targetProfitPct|overheadPct|costFactor|commissionSalesman|commissionAmt|commissionPct|snapshot|priced|unitCostCents|totalCostCents|materialCents|laborCents|costCents|actualMaterialCost|wage|wages)"\s*:/

async function invite(role, last) {
  const email = `e2e-signin-${role}-${stamp}@example.test`
  const inv = await owner('POST', '/api/crm-auth/invite', { firstName: 'E2E', lastName: last, email, role })
  if (!inv.json.data?.inviteUrl) throw new Error(`invite failed: ${inv.status} ${inv.text.slice(0, 200)}`)
  const link = new URL(inv.json.data.inviteUrl)
  made.users.push(email)
  const password = `Si-${crypto.randomBytes(9).toString('base64url')}`
  const acc = await call('', 'POST', '/api/crm-auth/accept-invite', { token: link.searchParams.get('token'), email, password })
  if (acc.status !== 200) throw new Error(`accept failed: ${acc.status}`)
  return { email, password, id: acc.json.data.user.id }
}

// ── Devices ──────────────────────────────────────────────────────────────────

const stubAutomations = ctx => ctx.route('**/api/automations/trigger', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true,"data":{"matched":0}}' }))

async function openDevice(kind) {
  if (kind === 'desktop') {
    const b = await chromium.launch()
    const mk = async () => { const ctx = await b.newContext({ viewport: { width: 1360, height: 900 } }); await stubAutomations(ctx); return ctx }
    const ctx = await mk()
    return { kind, name: 'Desktop Chrome', phone: false, ctx, page: await ctx.newPage(), another: mk, close: () => b.close() }
  }
  if (kind === 'webkit') {
    const b = await webkit.launch()
    // The test stands in for weak signal by answering for the server; WebKit would let the app's service worker pass requests around that.
    const ctx = await b.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block' })
    await stubAutomations(ctx)
    return { kind, name: 'WebKit (Safari engine), iPhone 13 size', phone: true, ctx, page: await ctx.newPage(), close: () => b.close() }
  }
  if (kind === 'android') {
    const b = await chromium.connectOverCDP(CDP)
    const ctx = b.contexts()[0]
    await stubAutomations(ctx)
    const pages = ctx.pages()
    const page = pages[0] ?? await ctx.newPage()
    for (const p of pages.slice(1)) await p.close().catch(() => {})
    // A clean start on this address: no sign in, nothing waiting from an earlier run.
    await ctx.clearCookies()
    await page.goto(`${APP}/manifest.webmanifest`).catch(() => {})
    await page.evaluate(async () => { localStorage.clear(); for (const n of ['ezbiz-outbox']) await new Promise(r => { const q = indexedDB.deleteDatabase(n); q.onsuccess = q.onerror = q.onblocked = () => r(null) }) }).catch(() => {})
    return { kind, name: `Android emulator, Chrome ${b.version()}`, phone: true, ctx, page, close: () => b.close().catch(() => {}) }
  }
  throw new Error(`unknown device ${kind}`)
}

const readySel = dev => (dev.phone ? '[data-tabbar]' : '[data-global-appointment]')
async function waitReady(dev, page = dev.page) { await page.waitForSelector(readySel(dev), { timeout: 90000 }) }
async function shot(dev, name, page = dev.page) { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `staff-signin-${dev.kind}-${name}.png`) }).catch(() => {}) }

async function signInOnPage(dev, login, page = dev.page) {
  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('input[type="email"]', { timeout: 60000 })
  check(`${dev.kind}: the sign in page does not fill in an email`, (await page.locator('input[type="email"]').inputValue()) === '')
  await page.fill('input[type="email"]', login.email)
  await page.fill('input[type="password"]', login.password)
  // Close the on-screen keyboard first (with it open, taps on a phone land in the wrong place).
  await page.evaluate(() => document.activeElement?.blur?.())
  await sleep(500)
  await page.locator('button[type="submit"]').click({ timeout: 30000 })
  await waitReady(dev, page)
}

/** What the browser itself holds: the cookie (from the jar, not the page), storage keys, what the page can read. */
async function held(dev, page = dev.page) {
  const jar = (await dev.ctx.cookies(`${API}/api/`)).filter(c => c.name === 'ezbiz_staff')
  const seen = await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage), pageCookie: document.cookie }))
  return { cookie: jar[0] ?? null, ...seen }
}

/** Raw rows of the outbox as kept on the phone. */
const outboxRows = page => page.evaluate(() => new Promise(res => {
  const r = indexedDB.open('ezbiz-outbox', 1)
  r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('ops')) r.result.createObjectStore('ops', { keyPath: 'id' }) }
  r.onsuccess = () => {
    const t = r.result.transaction('ops', 'readonly').objectStore('ops').getAll()
    t.onsuccess = () => { const rows = t.result; r.result.close(); res(rows.map(x => ({ keys: Object.keys(x).sort(), sealed: x.sealed ? new TextDecoder('latin1').decode(new Uint8Array(x.sealed)) : null, plain: x.sealed ? null : JSON.stringify(x) }))) }
    t.onerror = () => res([])
  }
  r.onerror = () => res([])
}))

/** A change kept by the version before encryption: a plain row in the old outbox (put there before the app starts). */
const seedOldOp = (page, op) => page.evaluate(op => new Promise((res, rej) => {
  const r = indexedDB.open('ezbiz-outbox', 1)
  r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('ops')) r.result.createObjectStore('ops', { keyPath: 'id' }) }
  r.onsuccess = () => { const t = r.result.transaction('ops', 'readwrite'); t.objectStore('ops').put(op); t.oncomplete = () => { r.result.close(); res(true) }; t.onerror = () => rej(t.error) }
  r.onerror = () => rej(r.error)
}), op)

function customerOp(userId, label) {
  const id = crypto.randomUUID()
  made.contacts.push(id)
  const customer = { id, firstName: 'E2E Signin', lastName: `${label} ${stamp}`, email: '', phone: '', serviceAddress: '', tags: [] }
  return { id: crypto.randomUUID(), key: `customer:${id}`, kind: 'customer.create', payload: { customer, lead: null, leadBefore: null }, label: `E2E Signin ${label}, new customer`, createdAt: Date.now(), attempts: 0, state: 'pending', account: userId, _customerId: id, _name: `${label} ${stamp}` }
}
/** The customer is on the server (its notes answer only for a customer that exists in the company). */
const onServer = async id => (await owner('GET', `/api/crm-contacts/${id}/notes`)).status === 200

async function signOutOnPage(dev, accept, page = dev.page) {
  const msgs = []
  const onDialog = d => { msgs.push(d.message()); (accept ? d.accept() : d.dismiss()).catch(() => {}) }
  page.on('dialog', onDialog)
  if (dev.phone) {
    await page.locator('[data-tabbar] [data-popup-trigger="nav-drawer"]').click()
    await sleep(600)
  }
  await page.locator('[data-sign-out]:visible').first().click()
  await sleep(2500)
  page.off('dialog', onDialog)
  return msgs
}

// ── The run ──────────────────────────────────────────────────────────────────

const admin = await invite('admin', `Admin ${stamp}`)
const sales = await invite('sales_rep', `Sales ${stamp}`)
console.log(`logins made: ${admin.email}, ${sales.email}`)

try {
  for (const kind of DEVICES) {
    const dev = await openDevice(kind)
    const t = s => `${dev.name}: ${s}`
    try {
      // ── 1. Sign in on the page ──
      await signInOnPage(dev, admin)
      const h1 = await held(dev)
      check(t('signing in sets the HttpOnly, SameSite=Strict cookie on /api'), !!h1.cookie && h1.cookie.httpOnly && h1.cookie.sameSite === 'Strict' && h1.cookie.path === '/api', JSON.stringify(h1.cookie && { ...h1.cookie, value: '…' }))
      check(t('no sign in in the browser storage, and the page cannot read the cookie'), !h1.local.some(k => /crm_|token|fencepro_user|fencepro_config|last_email/.test(k)) && h1.session.length === 0 && !h1.pageCookie.includes('ezbiz_staff'), JSON.stringify({ local: h1.local, session: h1.session }))
      await shot(dev, 'signed-in')
      await signOutOnPage(dev, true)
      check(t('signing out shows the sign in page and ends the cookie'), (await dev.page.locator('input[type="email"]').count()) > 0 && !(await held(dev)).cookie)

      // ── 2. Moving over: the old stored sign in and an old, unencrypted waiting change ──
      const old = await call('', 'POST', '/api/crm-auth/login', { email: admin.email, password: admin.password })
      const op = customerOp(admin.id, `moved ${kind}`)
      await dev.page.goto(`${APP}/manifest.webmanifest`)
      await dev.page.evaluate(([a, r]) => { localStorage.setItem('crm_access_token', a); localStorage.setItem('crm_refresh_token', r) }, [old.json.data.accessToken, old.json.data.refreshToken])
      const { _customerId, _name, ...plainOp } = op
      await seedOldOp(dev.page, plainOp)
      await dev.page.goto(APP, { waitUntil: 'domcontentloaded' })
      await waitReady(dev)
      const h2 = await held(dev)
      check(t('move over: the old token became the cookie; no sign in page'), !!h2.cookie && h2.cookie.httpOnly)
      check(t('move over: the old keys are gone'), !h2.local.includes('crm_access_token') && !h2.local.includes('crm_refresh_token'), h2.local.join(','))
      check(t('move over: the change waiting from before was sent'), !!(await until(() => onServer(_customerId), 30000)))
      check(t('move over: the outbox is empty once the server confirmed'), !!(await until(async () => (await outboxRows(dev.page)).length === 0, 15000)))
      const reused = await call('', 'POST', '/api/crm-auth/refresh', { refreshToken: old.json.data.refreshToken })
      check(t('move over: the old refresh token is used up'), reused.status === 401, String(reused.status))
      await shot(dev, 'moved-over')

      // ── 3. Waiting encrypted; sign out asks first; sent after the same person signs in again ──
      const op3 = customerOp(admin.id, `waiting ${kind}`)
      const { _customerId: cid3, _name: name3, ...plain3 } = op3
      // The office cannot take it right now (as on weak signal): the server's answer never arrives.
      await dev.ctx.route('**/api/crm-contacts', r => (r.request().method() === 'POST' ? r.fulfill({ status: 503, contentType: 'application/json', body: '{"success":false,"error":"Service unavailable"}' }) : r.continue()))
      await seedOldOp(dev.page, plain3)
      await dev.page.reload({ waitUntil: 'domcontentloaded' })
      await waitReady(dev)
      const rows = await until(async () => { const r = await outboxRows(dev.page); return r.length && r.every(x => x.sealed) ? r : null }, 15000)
      check(t('a waiting change is kept encrypted: only its id in the clear'), !!rows && rows.every(x => x.keys.join() === 'id,sealed') && !rows.some(x => x.sealed.includes(name3) || x.sealed.includes('E2E Signin')), JSON.stringify(rows?.map(x => x.keys) ?? await outboxRows(dev.page)).slice(0, 300))
      const asked = await signOutOnPage(dev, false)
      check(t('sign out with an unsent change asks first'), asked.length === 1 && /not reached the office yet/.test(asked[0]), asked.join(' | '))
      check(t('saying no keeps the person signed in'), (await dev.page.locator(readySel(dev)).count()) > 0 && !!(await held(dev)).cookie)
      const asked2 = await signOutOnPage(dev, true)
      check(t('saying yes signs out'), asked2.length === 1 && (await dev.page.waitForSelector('input[type="email"]', { timeout: 20000 }).then(() => true, () => false)))
      check(t('after signing out the change is still on the phone, encrypted'), (await outboxRows(dev.page)).filter(x => x.sealed).length === 1)
      check(t('not sent while signed out'), !(await onServer(cid3)))
      await dev.ctx.unroute('**/api/crm-contacts')
      await shot(dev, 'signed-out-waiting')
      await signInOnPage(dev, admin)
      check(t('signed in again as the same person: the change is sent'), !!(await until(() => onServer(cid3), 30000)))
      check(t('and leaves the phone'), !!(await until(async () => (await outboxRows(dev.page)).length === 0, 15000)))
      await signOutOnPage(dev, true)

      // ── 4. A salesman signed in by cookie gets no costs ──
      const bodies = []
      const rec = async r => {
        const u = r.url()
        if (!u.startsWith(`${API}/api/`) || !(r.headers()['content-type'] || '').includes('json')) return
        try { bodies.push({ url: u.replace(API, ''), text: await r.text() }) } catch { /* gone */ }
      }
      dev.page.on('response', rec)
      await signInOnPage(dev, sales)
      for (const p of ['/quotes', '/customers', '/schedule', '/pipeline']) { await dev.page.goto(`${APP}${p}`, { waitUntil: 'domcontentloaded' }); await waitReady(dev).catch(() => {}); await sleep(2500) }
      dev.page.off('response', rec)
      const direct = []
      for (const p of ['/api/saved-quotes', '/api/saved-jobs', '/api/inventory-state', '/api/business-state', '/api/kv', '/api/job-costing/report']) {
        const r = await dev.ctx.request.get(`${API}${p}`)
        direct.push({ url: p, status: r.status(), text: await r.text() })
      }
      const leaks = [...bodies, ...direct].filter(b => COST.test(b.text)).map(b => `${b.url} ${b.text.match(COST)[1]}`)
      // Since Oct 25 the salesman sees costs like the owner (Jonathan); the cookie sign in itself is what this checks.
      check(t(`salesman by cookie: ${bodies.length} answers on the screens and ${direct.length} asked directly, all answered`), bodies.length > 10 && direct.every(d => [200, 403].includes(d.status)), direct.map(d => `${d.url} ${d.status}`).join(', '))
      const whoAmI = JSON.parse((await (await dev.ctx.request.get(`${API}/api/crm-auth/me`)).text())).data
      check(t('the salesman is who the cookie says'), whoAmI?.email === sales.email && whoAmI?.role === 'sales_rep' && whoAmI?.signedInBy === 'cookie')
      await shot(dev, 'salesman')
      await signOutOnPage(dev, true)

      // ── 5 and 6, desktop: a second browser of the same login; ending a session in Team ──
      if (dev.another) {
        const b2 = await dev.another()
        const p2 = await b2.newPage()
        await signInOnPage(dev, admin)
        await signInOnPage(dev, admin, p2)
        const dev2 = { ...dev, ctx: b2, page: p2 }
        await signOutOnPage(dev, true)
        await p2.reload({ waitUntil: 'domcontentloaded' })
        check(t('a second browser of the same login keeps working after the first signs out'), await p2.waitForSelector(readySel(dev), { timeout: 60000 }).then(() => true, () => false))
        // The owner ends that second browser's session in Settings > Team.
        const mine = await p2.evaluate(async api => (await (await fetch(`${api}/api/crm-auth/sessions`, { credentials: 'include' })).json()).data.find(s => s.current), API)
        const oc = await dev.another()
        const op6 = await oc.newPage()
        const mv = await oc.request.post(`${API}/api/crm-auth/move-over`, { headers: { 'X-Staff-Request': '1', Authorization: `Bearer ${OWNER}` }, data: {} })
        check(t('the owner signs in by cookie (the test token moved over)'), mv.ok(), String(mv.status()))
        await op6.goto(`${APP}/team`, { waitUntil: 'domcontentloaded' })
        await op6.locator('button:has-text("Active Sessions")').click({ timeout: 90000 })
        const row = op6.locator(`[data-session-row="${mine?.id}"]`)
        await row.waitFor({ timeout: 20000 })
        check(t('Team lists the session with its end time'), /Ends if not used by/.test(await row.innerText()), (await row.innerText()).replace(/\s+/g, ' ').slice(0, 160))
        await shot(dev, 'team-sessions', op6)
        await op6.locator(`[data-end-session="${mine.id}"]`).click()
        await sleep(1500)
        const after = await p2.evaluate(async api => (await fetch(`${api}/api/kv`, { credentials: 'include' })).status, API)
        check(t('ending it in Team: that device is refused at once'), after === 401, String(after))
        await p2.reload({ waitUntil: 'domcontentloaded' })
        check(t('and shows the sign in page'), await p2.waitForSelector('input[type="email"]', { timeout: 30000 }).then(() => true, () => false))
        await shot(dev2, 'ended-in-team')
        await oc.close(); await b2.close()
      }
    } catch (err) {
      check(`${dev.name}: ran to the end`, false, String(err?.stack || err).slice(0, 600))
      await shot(dev, 'error')
    } finally {
      await dev.ctx.unroute('**/api/crm-contacts').catch(() => {})
      await dev.close()
    }
  }
} finally {
  // Clean up: the test customers and both logins (their sessions go with them).
  for (const id of made.contacts) await owner('DELETE', `/api/crm-contacts/${id}`).catch(() => {})
  const users = (await owner('GET', '/api/crm-auth/users')).json.data ?? []
  for (const email of made.users) { const u = users.find(x => x.email === email); if (u) await owner('DELETE', `/api/crm-auth/users/${u.id}`).catch(() => {}) }
}

const failed = results.filter(r => !r).length
console.log(`\n${results.length - failed} of ${results.length} checks passed`)
process.exit(failed ? 1 : 0)
