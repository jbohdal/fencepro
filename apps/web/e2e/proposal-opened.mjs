// Proposal opened, made visible: as a customer on a phone, then as staff, on the dev copy.
//
//   cd apps/web && pnpm -s build
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 E2E_ACCESS_TOKEN=<dev owner token> [E2E_SHOTS=<folder>] node e2e/proposal-opened.mjs
//   The customer: WebKit at 390 x 844 with an iPhone's browser name (default), or the Android emulator's Chrome:
//   adb reverse tcp:4001 tcp:4001; adb forward tcp:9333 localabstract:chrome_devtools_remote; CDP_URL=http://localhost:9333 node e2e/proposal-opened.mjs
//   (the staff side always runs here: Chromium at computer size and WebKit at phone size).
//
//   1. A card in Pending Signature with a sent proposal (three options): the card says "Not opened yet".
//   2. The customer opens the link on a phone, scrolls through the options, dwells on Better and reaches the signature.
//   3. Staff: the card badge "Opened 1× · last …" (computer and phone), the push logged (dev: never delivered),
//      the history with the option looked at longest and "reached the signature", Follow ups "Opened in the last 24h".
//   4. Staff open the same link from the app (Open on the quote): "Staff view", the count unchanged; and in the same
//      browser without the app's mark (the same device as a staff sign in): also a Staff view.
//   5. A reopen 2+ days later (time moved back in the dev database): a second push logged; a reopen within 2 days: none.
// Removes everything it made.
import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import './sharedLock.mjs' // changes the shared pipeline: one such test at a time
import { webkit, chromium } from 'playwright'
import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || 'http://localhost:4001'
const OWNER = process.env.E2E_ACCESS_TOKEN || ''
const SHOTS = process.env.E2E_SHOTS || process.env.SHOTS || ''
const CDP = process.env.CDP_URL || ''
const NAME = CDP ? 'android' : 'webkit'
const local = u => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(u)
if (!local(APP) || !local(API) || /:4000(\/|$)/.test(API) || /:4000(\/|$)/.test(APP)) { console.error('Refusing to run: the dev copy only (localhost, not port 4000).'); process.exit(2) }
if (!OWNER) { console.error('Set E2E_ACCESS_TOKEN (an owner login on the dev server).'); process.exit(2) }
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const shot = async (page, name, opts = {}) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), ...opts }) }
const call = async (method, p, body) => {
  // The dev server restarts when a file is saved (tsx watch): wait for it, up to a minute.
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(`${API}${p}`, { method, headers: { Authorization: `Bearer ${OWNER}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
      return { status: r.status, json: await r.json().catch(() => ({})) }
    } catch (e) { if (i >= 30) throw e; await sleep(2000) }
  }
}
/** Reads and test-only time moves, on the dev database by name. */
const sql = q => execFileSync('psql', ['-d', 'ezbiz_dev', '-At', '-q', '-c', q], { encoding: 'utf8' }).trim()
const lit = s => `'${String(s).replace(/'/g, "''")}'`
async function until(fn, ms = 20000) {
  const end = Date.now() + ms
  let v = await fn()
  while (!v && Date.now() < end) { await sleep(500); v = await fn() }
  return v
}
const floridaDay = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'

const stamp = Date.now().toString(36).slice(-6)
const made = { contacts: [], cards: [], quotes: [] }
const LAST = `Opened ${stamp}`

async function upsertCard(lead) {
  for (let i = 0; i < 8; i++) {
    const v = (await call('GET', '/api/pipeline')).json.data?.version
    const r = await call('PATCH', '/api/pipeline', { upsert: [{ lead }], remove: [], baseVersion: v })
    if (r.status === 200) return
    await sleep(500)
  }
  throw new Error('could not add the card')
}
async function makeCard(first, rep) {
  const c = await call('POST', '/api/crm-contacts', { firstName: first, lastName: LAST, phone: '', serviceAddress: '5708 SW 90th Ln, Ocala, FL 34476', leadSource: 'Referral' })
  const contactId = c.json.data?.id
  if (!contactId) throw new Error(`contact ${c.status} ${c.json.error}`)
  made.contacts.push(contactId)
  const id = `e2e-opened-${stamp}-${made.cards.length}`
  await upsertCard({ id, customerId: contactId, firstName: first, lastName: LAST, phone: '', email: '', address: '5708 SW 90th Ln, Ocala, FL 34476', leadSource: 'Referral', leadTemp: 0, fenceType: '', sections: 0, quotePrice: 8200, crew: '', scheduledDate: '', jobValue: 0, paymentStatus: '', balanceDue: 0, notes: '', stage: 'Pending Signature', createdAt: new Date().toISOString(), lastMoved: floridaDay(), assignedRep: rep })
  made.cards.push(id)
  return { id, contactId, name: `${first} ${LAST}` }
}

const viewsOf = qid => sql(`SELECT json_agg(v ORDER BY "startedAt") FROM (SELECT id, staff, "staffHow", device, "activeMs", "optionMs", "reachedSignature", "pushTrigger", "startedAt" FROM "ProposalView" WHERE "quoteId" = ${lit(qid)}) v`)
const views = qid => JSON.parse(viewsOf(qid) || 'null') ?? []
const effects = qid => sql(`SELECT key || ' ' || coalesce(result->>'logged', '') FROM "AutomationEffect" WHERE key LIKE ${lit(`proposal-opened:${qid}:%`)} ORDER BY "createdAt"`).split('\n').filter(Boolean)
const quoteRow = async qid => (await call('GET', `/api/saved-quotes/${qid}`)).json.data
const board = async () => (await call('GET', '/api/follow-ups/board')).json.data?.cards ?? {}
const longest = o => Object.entries(o || {}).sort((a, b) => b[1] - a[1])[0]?.[0]

// ── Browsers ──
const focusNow = () => execFileSync('adb', ['shell', 'dumpsys', 'window'], { encoding: 'utf8' }).split('\n').find(l => /mCurrentFocus/.test(l)) || ''
if (CDP) { if (!/chrome/i.test(focusNow())) { execFileSync('adb', ['shell', 'am', 'start', '-n', 'com.android.chrome/com.google.android.apps.chrome.Main']); await sleep(1500) } }
const android = CDP ? await chromium.connectOverCDP(CDP) : null
if (android) for (const p of android.contexts()[0].pages()) if (/\/p\//.test(p.url())) await p.close().catch(() => {})
const wk = await webkit.launch()
const cr = await chromium.launch()
const errors = []
const watch = (page, who) => { page.on('pageerror', e => errors.push(`${who}: ${String(e).slice(0, 200)}`)); page.on('dialog', d => d.accept().catch(() => {})) }
const setToken = t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }

/** The customer's phone. WebKit: an iPhone's browser name, never signed in to the app. Android: the emulator's Chrome, its
 *  browser name marked so it is not taken for a staff device the emulator may have used for the app in other tests. */
let customerCtx = null
async function customerPage() {
  if (android) {
    const page = await android.contexts()[0].newPage()
    const cdp = await page.context().newCDPSession(page)
    const ua = await page.evaluate(() => navigator.userAgent)
    await cdp.send('Network.setUserAgentOverride', { userAgent: `${ua} e2e-customer-${stamp}` })
    watch(page, 'android')
    return page
  }
  customerCtx ??= await wk.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IPHONE_UA })
  const page = await customerCtx.newPage()
  watch(page, 'customer')
  return page
}

/** Open the link, scroll through every option, dwell on one, reach the signature, close the page. */
async function customerReads(token, dwellOn, { shotName = '' } = {}) {
  const page = await customerPage()
  await page.goto(`${APP}/p/${token}`)
  await page.waitForSelector('.opt', { timeout: 30000 }); await sleep(800)
  // What this browser holds for the address (on the emulator: the app's own settings from other tests); the page must add nothing.
  const before = await page.evaluate(() => { try { return [...Object.keys(localStorage), ...Object.keys(sessionStorage)].sort().join(',') } catch { return '' } })
  const n = await page.locator('.opt').count()
  for (let i = 0; i < n; i++) { await page.locator('.opt').nth(i).evaluate(el => el.scrollIntoView({ block: 'center' })); await sleep(1500) }
  await page.locator('.opt').nth(dwellOn).evaluate(el => el.scrollIntoView({ block: 'center' }))
  await sleep(14000) // a heartbeat goes at 15 s
  if (shotName && SHOTS) {
    if (android) execFileSync('bash', ['-c', `adb exec-out screencap -p > "${path.join(SHOTS, `${shotName}.png`)}"`])
    else await shot(page, shotName)
  }
  await page.locator('#sig').evaluate(el => el.scrollIntoView({ block: 'center' })); await sleep(1500)
  const box = await page.locator('#sig').boundingBox()
  await page.locator('#sig').dispatchEvent('pointerdown', { clientX: box.x + 40, clientY: box.y + 40, pointerId: 3, pointerType: 'touch', bubbles: true })
  await page.locator('#sig').dispatchEvent('pointerup', { clientX: box.x + 40, clientY: box.y + 40, pointerId: 3, pointerType: 'touch', bubbles: true })
  await sleep(2500) // the 15 s heartbeat
  const after = await page.evaluate(() => { try { return [...Object.keys(localStorage), ...Object.keys(sessionStorage)].sort().join(',') } catch { return '' } })
  const noStorage = android ? after === before : after === ''
  if (android) {
    // A real phone: Home puts the page away (visibilitychange: the last totals go by sendBeacon); then back to Chrome.
    execFileSync('adb', ['shell', 'input', 'keyevent', 'KEYCODE_HOME']); await sleep(2500)
    execFileSync('adb', ['shell', 'am', 'start', '-n', 'com.android.chrome/com.google.android.apps.chrome.Main']); await sleep(1500)
  } else {
    // Leaving the page sends the last totals (sendBeacon on pagehide).
    await page.goto('about:blank').catch(() => {})
    await sleep(1500)
  }
  await page.close().catch(() => {})
  return { options: n, noStorage }
}

let quoteId = null, token = null, card = null, plain = null
try {
  // ── 1. Set up: a card with a sent proposal, and one without ──
  const sub = JSON.parse(Buffer.from(OWNER.split('.')[1], 'base64url').toString()).sub
  const me = ((await call('GET', '/api/crm-auth/users')).json.data ?? []).find(u => u.id === sub)
  const myName = `${me?.firstName ?? ''} ${me?.lastName ?? ''}`.trim()
  card = await makeCard('Pat', myName)
  plain = await makeCard('Quinn', myName)
  const options = [
    { label: "White Vinyl 6' Privacy, posts in concrete", fenceStyle: "WV-DS 6'x8' Privacy", finalPrice: 7400, perFoot: 49.33, sections: 19, tier: { label: 'Good', blurb: 'Posts set in concrete.' } },
    { label: "White Vinyl 6' Privacy, no dig", fenceStyle: "WV-ND 6'x8' Privacy", finalPrice: 8200, perFoot: 54.67, sections: 19, tier: { label: 'Better', blurb: 'Steel pipe driven deep.' }, badge: 'Most popular' },
    { label: "White Vinyl 6' Privacy, 6 ft panels", fenceStyle: "WV-ND 6'x6' Privacy", finalPrice: 9100, perFoot: 60.67, sections: 25, tier: { label: 'Best', blurb: 'More posts per foot.' } },
  ]
  const q = await call('POST', '/api/saved-quotes', { crmContactId: card.contactId, customerName: card.name, customerPhone: '', customerAddress: '5708 SW 90th Ln, Ocala, FL 34476', fenceStyle: "WV-ND 6'x8' Privacy", runs: [150], corners: 0, ends: 2, sections: 19, status: 'SENT', finalPrice: 8200, date: floridaDay(), salesRep: myName, proposal: { version: 1, company: { name: 'Getter Done Fence' }, customer: { name: card.name, address: '5708 SW 90th Ln, Ocala, FL 34476' }, footageFt: 150, recommended: 1, options } })
  quoteId = q.json.data?.id
  if (!quoteId) throw new Error(`quote ${q.status} ${q.json.error}`)
  made.quotes.push(quoteId)
  token = (await call('POST', `/api/saved-quotes/${quoteId}/share-token`)).json.data?.shareToken
  const b0 = await board()
  check('before: a sent proposal not opened yet', b0[card.id]?.opened?.count === 0, JSON.stringify(b0[card.id]?.opened))
  check('before: a card with no proposal sent has nothing', !b0[plain.id]?.opened)

  // ── 2. The customer on a phone ──
  const html = await (await fetch(`${API}/p/${token}`, { headers: { 'User-Agent': 'facebookexternalhit/1.1' } })).text()
  check('a link preview (no script) is not an open', views(quoteId).length === 0 && /Better/.test(html))
  check('the page\'s script uses no browser storage and no cookies', !/localStorage|sessionStorage|indexedDB|document\.cookie/.test(html))
  const read = await customerReads(token, 1, { shotName: CDP ? 'dev-proposal-opened-android' : '' })
  check(`customer (${NAME}): the page has every option`, read.options === 3)
  check(`customer (${NAME}): nothing kept in the browser's storage`, read.noStorage)
  const v1 = await until(() => { const v = views(quoteId); return v.length === 1 && v[0].reachedSignature && v[0].activeMs > 15000 ? v : null }, 15000) || views(quoteId)
  const one = v1[0] || {}
  check('one open recorded, not staff', v1.length === 1 && one.staff === false, JSON.stringify(v1.map(v => ({ staff: v.staff, how: v.staffHow }))))
  check(`its device is ${CDP ? 'Android' : 'iPhone'}`, one.device === (CDP ? 'Android' : 'iPhone'), one.device)
  check('time per option: Better (the one dwelt on) the longest', longest(one.optionMs) === '1', JSON.stringify(one.optionMs))
  check('the signature reached, time on the page recorded', one.reachedSignature === true && one.activeMs >= 15000, `${one.activeMs} ms`)
  check('counted once', (await quoteRow(quoteId))?.viewCount === 1)
  const e1 = await until(() => effects(quoteId).length >= 1 ? effects(quoteId) : null, 10000) || []
  check('push on the first open, logged on the dev copy (never delivered)', e1.length === 1 && e1[0].startsWith(`proposal-opened:${quoteId}:first`) && /dev copy: push not delivered to .*Proposal opened: Pat/.test(e1[0]), e1.join(' | '))
  const notes = (await call('GET', '/api/automations/notifications')).json.data?.notifications ?? []
  check('the bell has it for the card owner', notes.some(n => n.title === `Proposal opened: ${card.name}`))

  // ── 3. Staff: badge, history, Follow ups ──
  const desk = await cr.newContext({ viewport: { width: 1440, height: 900 } })
  await desk.addInitScript(setToken, OWNER)
  let dp = await desk.newPage(); watch(dp, 'desktop')
  await dp.goto(`${APP}/pipeline`); await dp.waitForSelector('[data-global-appointment]', { timeout: 40000 }); await sleep(2500)
  const cardEl = name => dp.locator(`p:text-is("${name}")`).locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]')
  await cardEl(card.name).first().scrollIntoViewIfNeeded().catch(() => {})
  const badge = await until(async () => (await cardEl(card.name).locator('[data-card-opened]').first().textContent().catch(() => '')) || '', 15000)
  check('computer: the card says "Opened 1× · just now" (or "· last 2m ago")', /^Opened 1× · (just now|last \d+m ago)$/.test(badge), badge)
  check('computer: a card with no proposal sent has no badge', await cardEl(plain.name).locator('[data-card-opened]').count() === 0)
  await cardEl(card.name).first().evaluate(el => el.scrollIntoView({ block: 'center', inline: 'center' }))
  await sleep(300)
  await shot(dp, 'dev-proposal-opened-badge-desktop')

  const phone = await wk.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })
  await phone.addInitScript(setToken, OWNER)
  const pp = await phone.newPage(); watch(pp, 'staff phone')
  await pp.goto(`${APP}/pipeline`); await pp.waitForSelector('[data-tabbar]', { timeout: 40000 }); await sleep(2500)
  const pcard = pp.locator(`p:text-is("${card.name}")`).locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]').first()
  await pcard.evaluate(el => el.scrollIntoView({ block: 'center', inline: 'center' })).catch(() => {})
  await sleep(600)
  const pbadge = await until(async () => (await pcard.locator('[data-card-opened]').textContent().catch(() => '')) || '', 15000)
  check('phone: the card says "Opened 1× · just now" (or "· last 2m ago")', /^Opened 1× · (just now|last )/.test(pbadge), pbadge)
  await shot(pp, 'dev-proposal-opened-badge')
  await phone.close()

  const openWindow = async () => {
    await dp.close().catch(() => {})
    dp = await desk.newPage(); watch(dp, 'desktop')
    await dp.goto(`${APP}/pipeline?card=${encodeURIComponent(card.id)}`)
    await dp.waitForSelector(`[data-card-window="${card.id}"]`, { timeout: 40000 }); await sleep(2500)
  }
  await openWindow()
  const wbadge = (await dp.locator('[data-card-window-opened]').textContent().catch(() => '')) || ''
  check('card window: the same badge', /^Opened 1× · (just now|last )/.test(wbadge), wbadge)
  const hist = async () => (await dp.locator('[data-card-history]').innerText().catch(() => '')).replace(/\s+/g, ' ')
  const h1 = await until(async () => { const h = await hist(); return /Proposal opened on/.test(h) ? h : '' }, 10000)
  const want = `Proposal opened on ${CDP ? 'Android' : 'iPhone'}`
  check('history: the open, its device, the option looked at longest, the signature reached', h1.includes(want) && h1.includes('looked longest at Better ($8,200)') && h1.includes('reached the signature'), h1.slice(0, 260))
  await dp.locator('[data-history-item="proposal_opened"]').first().evaluate(el => el.scrollIntoView({ block: 'center' }))
  await shot(dp, 'dev-proposal-opened-history')

  const fp = await desk.newPage(); watch(fp, 'follow ups')
  await fp.goto(`${APP}/follow-ups`); await fp.waitForSelector('[data-follow-ups-page]', { timeout: 40000 }); await sleep(2500)
  const firstSection = await fp.locator('[data-follow-up-section]').first().getAttribute('data-follow-up-section').catch(() => '')
  const row = (await fp.locator(`[data-follow-up-section="opened-24h"] [data-follow-up-row="${card.id}"]`).innerText().catch(() => '')).replace(/\s+/g, ' ')
  check('Follow ups: "Opened in the last 24h" is the first group and lists the card', firstSection === 'opened-24h' && row.includes(card.name), `${firstSection} | ${row.slice(0, 160)}`)
  check('Follow ups: the row says when, on what and the option looked at longest', /Opened (just now|\d+m ago) on (iPhone|Android) · looked longest at Better \(\$8,200\)/.test(row), row)
  check('Follow ups: the card with no proposal is not in the group', await fp.locator(`[data-follow-up-section="opened-24h"] [data-follow-up-row="${plain.id}"]`).count() === 0)
  await fp.locator('[data-follow-up-section="opened-24h"]').scrollIntoViewIfNeeded()
  await shot(fp, 'dev-followups-opened-24h')
  await fp.close()

  // ── 4. Staff opening the same link: from the app (its mark), and in the same browser without it ──
  await dp.locator(`[data-card-quote="${quoteId}"]`).click(); await sleep(1500)
  const [pop] = await Promise.all([desk.waitForEvent('page', { timeout: 15000 }), dp.locator('[data-proposal-open]').first().click()])
  watch(pop, 'staff proposal')
  await pop.waitForSelector('.opt', { timeout: 20000 }); await sleep(3000)
  check('from the app: the link carries the staff mark, and the page drops it from the address', !/[?&]sp=/.test(pop.url()) && /\/p\//.test(pop.url()), pop.url().replace(token, '<link>'))
  const v2 = await until(() => { const v = views(quoteId); return v.length === 2 ? v : null }, 10000) || views(quoteId)
  check('from the app: a Staff view (the app\'s mark), not counted', v2.length === 2 && v2[1].staff === true && v2[1].staffHow === 'preview' && (await quoteRow(quoteId))?.viewCount === 1, JSON.stringify(v2.map(v => [v.staff, v.staffHow])))
  await pop.close()
  // Another staff computer (its own browser name): it uses the app, then opens the link it was sent, outside the app.
  const other = await cr.newContext({ viewport: { width: 1280, height: 900 }, userAgent: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 office-${stamp}` })
  await other.addInitScript(setToken, OWNER)
  const op = await other.newPage(); watch(op, 'office')
  await op.goto(APP); await op.waitForSelector('[data-global-appointment]', { timeout: 40000 }); await sleep(1500)
  const direct = await other.newPage(); watch(direct, 'staff direct')
  await direct.goto(`${API}/p/${token}`); await direct.waitForSelector('.opt'); await sleep(3000)
  await other.close()
  const v3 = await until(() => { const v = views(quoteId); return v.length === 3 ? v : null }, 10000) || views(quoteId)
  check('same browser, no mark: the device staff signed in from, a Staff view, not counted', v3.length === 3 && v3[2].staff === true && v3[2].staffHow === 'device' && (await quoteRow(quoteId))?.viewCount === 1, JSON.stringify(v3.map(v => [v.staff, v.staffHow])))
  check('staff opens earn no push', effects(quoteId).length === 1)
  await openWindow()
  const h2 = await until(async () => { const h = await hist(); return /Staff view/.test(h) ? h : '' }, 10000)
  check('history: our own opens show as Staff view, the badge still says 1×', /Staff view/.test(h2) && /Opened 1×/.test((await dp.locator('[data-card-window-opened]').textContent().catch(() => '')) || ''), h2.slice(0, 200))
  await dp.locator('[data-history-item="proposal_staff"]').first().evaluate(el => el.scrollIntoView({ block: 'center' }))
  await shot(dp, 'dev-proposal-staff-view')

  // ── 5. Reopens: 2+ days later, and within 2 days ──
  const moveBack = days => sql(`UPDATE "ProposalView" SET "startedAt" = "startedAt" - interval '${days} days', "lastSeenAt" = "lastSeenAt" - interval '${days} days' WHERE "quoteId" = ${lit(quoteId)}; UPDATE "SavedQuote" SET "lastViewedAt" = "lastViewedAt" - interval '${days} days' WHERE id = ${lit(quoteId)}`)
  moveBack(3)
  await customerReads(token, 2)
  const e2 = await until(() => effects(quoteId).length >= 2 ? effects(quoteId) : null, 10000) || effects(quoteId)
  check('a reopen 3 days later: a second push, logged', e2.length === 2 && /:reopen:/.test(e2[1]) && /opened the proposal again\. Back after 3 days/.test(e2[1]), e2.slice(1).join(' | '))
  moveBack(1)
  await customerReads(token, 0)
  await sleep(2000)
  check('a reopen 1 day later: no push', effects(quoteId).length === 2, effects(quoteId).join(' | '))
  check('customer opens counted: 3 (staff never)', (await quoteRow(quoteId))?.viewCount === 3)
  const bLast = await board()
  check('the board says 3×', bLast[card.id]?.opened?.count === 3)

  // Settings: the switch is there and on.
  const sp = await desk.newPage(); watch(sp, 'settings')
  await sp.goto(APP); await sp.waitForSelector('[data-global-appointment]', { timeout: 40000 }); await sleep(800)
  await sp.locator('span:text-is("Settings"):visible').first().click(); await sleep(500)
  await sp.locator('button:text-is("Proposals")').click(); await sleep(500)
  check('Settings → Proposals: "Tell me when a proposal is opened", on', await sp.locator('[data-notify-opened]').isChecked().catch(() => false))
  await desk.close()
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
} catch (e) {
  check('test run finished', false, String(e?.stack || e).split('\n').slice(0, 6).join(' '))
} finally {
  for (let i = 0; i < 5 && made.cards.length; i++) {
    const pipe = (await call('GET', '/api/pipeline')).json.data
    const r = await call('PATCH', '/api/pipeline', { upsert: [], remove: made.cards, baseVersion: pipe?.version })
    if (r.status === 200) break
    await sleep(300)
  }
  for (const id of made.quotes) await call('DELETE', `/api/saved-quotes/${id}`).catch(() => {})
  for (const id of made.contacts) if (id) await call('DELETE', `/api/crm-contacts/${id}`).catch(() => {})
  try {
    for (const id of made.quotes) sql(`DELETE FROM "ProposalView" WHERE "quoteId" = ${lit(id)}; DELETE FROM "AutomationEffect" WHERE key LIKE ${lit(`proposal-opened:${id}:%`)}`)
    sql(`DELETE FROM "Notification" WHERE title LIKE ${lit(`%${LAST}%`)}; DELETE FROM "CardFollowUp" WHERE "cardId" LIKE ${lit(`e2e-opened-${stamp}-%`)}`)
  } catch (e) { console.log('note: could not remove the test rows:', String(e).slice(0, 120)) }
  await wk.close(); await cr.close()
  const passed = results.filter(Boolean).length
  console.log(`\n${passed} of ${results.length} checks passed (${NAME})`)
  process.exit(passed === results.length ? 0 : 1)
}
