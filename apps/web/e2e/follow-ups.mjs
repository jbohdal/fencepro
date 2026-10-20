// Follow ups, as a salesman on a phone, on the dev copy.
//
//   cd apps/web && pnpm -s build
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 E2E_ACCESS_TOKEN=<dev owner token> [E2E_SHOTS=<folder>] node e2e/follow-ups.mjs
//   WebKit at 390 x 844 (as on an iPhone) by default; BROWSER=chromium for Chrome.
//   On the Android emulator's Chrome: adb reverse tcp:4001 tcp:4001;
//   adb forward tcp:9333 localabstract:chrome_devtools_remote; CDP_URL=http://localhost:9333 node e2e/follow-ups.mjs
//   (there the Call tap really opens the phone app, and Back returns to Chrome).
//
// Makes two salesmen (invite + accept, as salesman.mjs does through the screens),
// four cards in Pending Signature (three for salesman A, one for B), then:
//   1. A taps Call on a card, leaves the app and comes back: "How'd it go?";
//      answers No answer.
//   2. The next date is tomorrow; the badges on the board (Overdue 3d, No
//      follow up set; nothing on a card with nothing to show, same height);
//      the Follow ups screen lists them.
//   3. One tap changes the date.
//   4. Log a call: Talked, not now, with a date picked.
//   5. Lost, with a reason: the card moves to Lost Sale.
//   6. No signal: an answer waits on the phone and saves when signal returns.
//   7. Salesman B does not see A's cards on Follow ups (nor A B's).
//   8. The owner sees everyone and filters by rep (computer size).
// Also: text templates (the phone's texting app, never sent by the app), the
// card's history, Settings > Follow ups and the report.
// Removes everything it made (users, customers, cards, call log rows).
import { webkit, chromium } from 'playwright'
import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || 'http://localhost:4001'
const OWNER = process.env.E2E_ACCESS_TOKEN || ''
const SHOTS = process.env.E2E_SHOTS || process.env.SHOTS || ''
const CDP = process.env.CDP_URL || ''
const ENGINE = process.env.BROWSER === 'chromium' ? chromium : webkit
const NAME = CDP ? 'android' : process.env.BROWSER === 'chromium' ? 'chromium' : 'webkit'
const local = u => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(u)
if (!local(APP) || !local(API) || /:4000(\/|$)/.test(API) || /:4000(\/|$)/.test(APP)) { console.error('Refusing to run: the dev copy only (localhost, not port 4000).'); process.exit(2) }
if (!OWNER) { console.error('Set E2E_ACCESS_TOKEN (an owner login on the dev server).'); process.exit(2) }
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }) }
const call = async (token, method, p, body) => {
  const r = await fetch(`${API}${p}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: r.status, json: await r.json().catch(() => ({})) }
}
const owner = (m, p, b) => call(OWNER, m, p, b)
async function until(fn, ms = 20000) {
  const end = Date.now() + ms
  let v = await fn()
  while (!v && Date.now() < end) { await sleep(500); v = await fn() }
  return v
}
const floridaDay = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
const TODAY = floridaDay()

const stamp = Date.now().toString(36).slice(-6)
const made = { users: [], contacts: [], cards: [] }

/** A salesman, made the way the Team page does it: invite, then the invite link sets a password. */
async function makeSalesman(letter) {
  const email = `e2e-follow-${letter.toLowerCase()}-${stamp}@example.test`
  const inv = await owner('POST', '/api/crm-auth/invite', { firstName: 'E2E', lastName: `Follow${letter} ${stamp}`, email, role: 'sales_rep' })
  if (inv.status !== 201) throw new Error(`invite ${inv.status} ${inv.json.error}`)
  made.users.push(inv.json.data.id)
  const u = new URL(inv.json.data.inviteUrl)
  const acc = await call('', 'POST', '/api/crm-auth/accept-invite', { token: u.searchParams.get('token'), email, password: `Fu-${crypto.randomBytes(9).toString('base64url')}` })
  if (!acc.json.data?.accessToken) throw new Error(`accept ${acc.status} ${acc.json.error}`)
  return { id: inv.json.data.id, name: `E2E Follow${letter} ${stamp}`, token: acc.json.data.accessToken }
}

async function makeCard(first, last, rep, phone) {
  const c = await owner('POST', '/api/crm-contacts', { firstName: first, lastName: last, phone, serviceAddress: '5708 SW 90th Ln, Ocala, FL 34476', leadSource: 'Referral' })
  const contactId = c.json.data?.id
  made.contacts.push(contactId)
  const id = `e2e-follow-${stamp}-${made.cards.length}`
  const lead = { id, customerId: contactId, firstName: first, lastName: last, phone, email: '', address: '5708 SW 90th Ln, Ocala, FL 34476', leadSource: 'Referral', leadTemp: 0, fenceType: '', sections: 0, quotePrice: 4200 + made.cards.length * 100, crew: '', scheduledDate: '', jobValue: 0, paymentStatus: '', balanceDue: 0, notes: '', stage: 'Pending Signature', createdAt: new Date().toISOString(), lastMoved: TODAY, assignedRep: rep }
  let r = null
  for (let i = 0; i < 8; i++) {
    const v = (await owner('GET', '/api/pipeline')).json.data?.version
    r = await owner('PATCH', '/api/pipeline', { upsert: [{ lead }], remove: [], baseVersion: v })
    if (r.status === 200) break
    await sleep(500)
  }
  if (r?.status !== 200) throw new Error(`could not add the card: ${r?.status} ${r?.json?.error}`)
  made.cards.push(id)
  return { id, contactId, name: `${first} ${last}`, first }
}

const board = async token => (await call(token, 'GET', '/api/follow-ups/board')).json.data?.cards ?? {}
const listOf = async (token, rep = '') => (await call(token, 'GET', `/api/follow-ups/list${rep ? `?rep=${rep}` : ''}`)).json.data
const idsIn = l => l ? [...l.overdue, ...l.dueToday, ...l.upcoming, ...l.notSet].map(r => r.cardId) : []
const history = async (token, card) => (await call(token, 'GET', `/api/follow-ups/history?cardId=${card.id}&customerId=${card.contactId}`)).json.data ?? []

// ── The phone ──
const focusNow = () => execFileSync('adb', ['shell', 'dumpsys', 'window'], { encoding: 'utf8' }).split('\n').find(l => /mCurrentFocus/.test(l)) || ''
const chromeToFront = () => execFileSync('adb', ['shell', 'am', 'start', '-n', 'com.android.chrome/com.google.android.apps.chrome.Main'])
if (CDP) { if (!/chrome/i.test(focusNow())) { chromeToFront(); await sleep(1500) } }
const browser = CDP ? await chromium.connectOverCDP(CDP) : await ENGINE.launch()
// Tabs this test left open on the emulator before.
if (CDP) for (const p of browser.contexts()[0].pages()) if (/e2e-follow-|\/follow-ups/.test(p.url())) await p.close().catch(() => {})
const errors = []
let A, B, c1, c2, c3, c4
let page = null
try {
  A = await makeSalesman('A')
  B = await makeSalesman('B')
  c1 = await makeCard('Fiona', `Callback ${stamp}`, A.name, '3525550161')
  c2 = await makeCard('Gary', `Lostsale ${stamp}`, A.name, '3525550162')
  c3 = await makeCard('Hana', `Nosignal ${stamp}`, A.name, '3525550163')
  c4 = await makeCard('Ivan', `Other ${stamp}`, B.name, '3525550164')
  // Card 2 three days overdue, card 3 with none set (for the badges).
  await owner('PUT', `/api/follow-ups/cards/${c2.id}/next`, { dueOn: addDays(TODAY, -3) })
  await owner('PUT', `/api/follow-ups/cards/${c3.id}/next`, { dueOn: null })
  const b0 = await board(A.token)
  check('setup: a card entering Pending Signature starts its steps (call on day 2)', b0[c1.id]?.dueOn === addDays(TODAY, 2) && b0[c1.id]?.dueKind === 'call', JSON.stringify(b0[c1.id]?.dueOn))

  const ctx = CDP ? browser.contexts()[0] : await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: NAME === 'chromium', hasTouch: true })
  const setToken = t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }
  if (CDP) { const p0 = await ctx.newPage(); await p0.goto(APP); await p0.evaluate(setToken, A.token); await p0.close() }
  else {
    await ctx.addInitScript(setToken, A.token)
    // A tel: or sms: link would hand off to the phone's app: note where it went and stay (the app's own handlers still run).
    await ctx.addInitScript(() => {
      window.__links = []
      window.addEventListener('click', e => { const a = e.target instanceof Element ? e.target.closest('a[href^="tel:"],a[href^="sms:"]') : null; if (a) { window.__links.push(a.getAttribute('href')); e.preventDefault() } }, true)
    })
  }
  page = null
  /** Open a screen. WebKit under Playwright crashes on page.goto after a window that used Back was closed (the booking
   *  window does it too), so each address is opened in a fresh tab of the same browser (same sign in, same outbox). */
  const go = async url => {
    const old = page
    page = await ctx.newPage()
    page.on('pageerror', e => errors.push(String(e).slice(0, 200)))
    page.on('dialog', d => d.accept().catch(() => {}))
    // Stage changes ask the server to run automations; the dev data holds real customers.
    await page.route('**/api/automations/trigger', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true,"data":{"matched":0}}' }))
    if (old) await old.close().catch(() => {})
    await page.bringToFront().catch(() => {})
    await page.goto(url)
  }
  // On the emulator a Call tap really leaves for the phone app, so the click does not wait for a page to load.
  const tap = async loc => {
    await loc.scrollIntoViewIfNeeded()
    if (CDP) {
      // A real tap at the button's middle; Playwright's own click keeps waiting while the phone app is in front.
      const b = await loc.boundingBox()
      await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2)
    } else await (NAME === 'webkit' ? loc.click() : loc.tap())
    await sleep(300)
  }
  /** Leave the app (the phone app opens) and come back. On the emulator it really happens; here the page is told it was hidden and shown again. */
  const leaveAndReturn = async () => {
    if (CDP) {
      await sleep(2500)
      const focus = execFileSync('adb', ['shell', 'dumpsys', 'window'], { encoding: 'utf8' }).split('\n').find(l => /mCurrentFocus/.test(l)) || ''
      check('Android: Call opened the phone app', /dialer|Dialer|telecom|InCallActivity|DialtactsActivity/i.test(focus), focus.trim().slice(0, 120))
      if (SHOTS) execFileSync('bash', ['-c', `adb exec-out screencap -p > "${path.join(SHOTS, 'dev-followup-android-dialer.png')}"`])
      // Back to the app, as the salesman would after hanging up.
      execFileSync('adb', ['shell', 'input', 'keyevent', 'KEYCODE_BACK']); await sleep(800)
      if (!/chrome/i.test(focusNow())) { chromeToFront(); await sleep(1500) }
      return
    }
    await page.evaluate(async () => {
      const set = v => Object.defineProperty(document, 'visibilityState', { value: v, configurable: true })
      set('hidden'); document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('blur'))
      await new Promise(r => setTimeout(r, 400))
      set('visible'); document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus'))
    })
    await sleep(500)
  }
  const openCard = async card => {
    await go(`${APP}/pipeline?card=${encodeURIComponent(card.id)}`)
    await page.waitForSelector(`[data-card-window="${card.id}"]`, { timeout: 40000 }); await sleep(1200)
  }
  const closeWindow = async () => { await tap(page.locator('[data-card-window] button[aria-label="Close"]').first()); await sleep(400) }

  // ── 1. Call, come back, "How'd it go?", No answer ──
  await go(APP); await page.waitForSelector('[data-tabbar]', { timeout: 40000 }); await sleep(1500)
  check('phone nav: Follow ups is in the tab bar', await page.locator('[data-tabbar] button:has-text("Follow ups")').count() === 1)
  await openCard(c1)
  await tap(page.locator('[data-card-call]'))
  if (!CDP) check('Call opens the phone app with the number (tel:)', (await page.evaluate(() => window.__links.at(-1))) === 'tel:3525550161')
  await leaveAndReturn()
  const prompt = page.locator(`[data-howd-it-go="${c1.id}"]`)
  check("back in the app: How'd it go? is asked", await prompt.isVisible().catch(() => false))
  const answers = await page.locator('[data-answers] [data-answer]').allInnerTexts()
  check('one tap answers: No answer, Left voicemail, Still deciding, Not now, Booked, Signed, Lost', answers.length === 7 && /No answer/.test(answers[0]) && /Lost/.test(answers[6]), answers.join(' | '))
  await shot(page, CDP ? 'dev-followup-android' : 'dev-followup-howd-it-go')
  await page.locator('[data-answer-note]').fill('Rang twice')
  await tap(page.locator('[data-answer="no_answer"]'))
  const due1 = await page.locator('[data-next-due]').getAttribute('data-next-due')

  // ── 2. Next date tomorrow, the badge, the Follow ups screen ──
  check('No answer: next follow up is tomorrow', due1 === addDays(TODAY, 1), due1)
  const saved1 = await until(async () => { const h = await history(A.token, c1); return h.find(x => /Call: No answer/.test(x.title)) })
  check('the answer is a call log entry on the server (who, when, answer, note)', !!saved1 && saved1.by === A.name && /Rang twice/.test(saved1.detail), JSON.stringify(saved1 ?? null).slice(0, 160))
  check('the server has tomorrow too', (await until(async () => (await board(A.token))[c1.id]?.dueOn === addDays(TODAY, 1))) === true)
  await tap(page.locator('[data-answer-done]'))
  check('the card window shows the next follow up', (await page.locator('[data-card-next-follow-up]').getAttribute('data-card-next-follow-up')) === addDays(TODAY, 1))
  await closeWindow()
  await page.waitForSelector('[data-kanban-board]', { timeout: 15000 }); await sleep(1500)
  const badgeIn = async last => { const el = page.locator(`[data-kanban-col="Pending Signature"] >> text=${last}`).first(); const c = el.locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]'); return (await c.locator('[data-card-follow-up]').count()) ? c.locator('[data-card-follow-up]').getAttribute('data-card-follow-up') : null }
  // The board's Pending Signature column, scrolled to the test cards.
  await page.locator('[data-tabbar] button:has-text("Pipeline")').click().catch(() => {})
  await sleep(800)
  const b2 = await badgeIn(`Lostsale ${stamp}`), b3 = await badgeIn(`Nosignal ${stamp}`), b1 = await badgeIn(`Callback ${stamp}`)
  check('badge: "Overdue 3d"', b2 === 'Overdue 3d', String(b2))
  check('badge: "No follow up set" on a Pending Signature card with none', b3 === 'No follow up set', String(b3))
  check('no badge on a card due tomorrow', b1 === null, String(b1))
  const heights = await page.evaluate(([a, b]) => {
    const h = t => { const el = [...document.querySelectorAll('[data-kanban-col="Pending Signature"] p')].find(p => p.textContent.includes(t)); const card = el?.closest('.rounded-xl'); return card ? Math.round(card.getBoundingClientRect().height) : -1 }
    return [h(a), h(b)]
  }, [`Callback ${stamp}`, `Lostsale ${stamp}`])
  check('a card with nothing to show is not made taller', heights[0] > 0 && heights[1] > heights[0], heights.join(' vs '))
  // The same card in the Pending Signature column, to the screenshot.
  await page.locator(`[data-kanban-col="Pending Signature"] >> text=Lostsale ${stamp}`).first().evaluate(el => el.scrollIntoView({ block: 'center' })); await sleep(300)
  await shot(page, 'dev-followup-badges')
  // Filter: Needs follow up.
  await page.locator('button[aria-label="Filter and sort"]').click(); await sleep(300)
  await page.locator('[data-filter-needs-follow-up]').check(); await sleep(600)
  const shownNow = await page.locator('[data-kanban-col="Pending Signature"]').innerText()
  check('pipeline filter "Needs follow up": overdue and none set stay, tomorrow is hidden', shownNow.includes(`Lostsale ${stamp}`) && shownNow.includes(`Nosignal ${stamp}`) && !shownNow.includes(`Callback ${stamp}`))
  await page.locator('[data-filter-needs-follow-up]').uncheck(); await sleep(300)
  await page.locator('button[aria-label="Filter and sort"]').click(); await sleep(300)

  await tap(page.locator('[data-tabbar] button:has-text("Follow ups")'))
  await page.waitForSelector('[data-follow-ups-page]', { timeout: 15000 }); await sleep(1500)
  const inSection = async (sec, card) => (await page.locator(`[data-follow-up-section="${sec}"] [data-follow-up-row="${card.id}"]`).count()) === 1
  check('Follow ups: Overdue lists the overdue card (red)', await inSection('overdue', c2) && /red/.test(await page.locator(`[data-follow-up-section="overdue"] h2`).getAttribute('class')))
  check('Follow ups: Coming up lists tomorrow\'s', await inSection('upcoming', c1))
  check('Follow ups: No follow up set lists the card with none', await inSection('not-set', c3))
  const row1 = await page.locator(`[data-follow-up-row="${c1.id}"]`).innerText()
  check('a row: name, stage, price, last answer, days since contact', row1.includes(`Fiona Callback ${stamp}`) && row1.includes('Pending Signature') && /\$4,200/.test(row1) && row1.includes('No answer') && row1.includes('Contacted today'), row1.replace(/\n/g, ' | '))
  check('a row: one tap Call and Text', (await page.locator(`[data-follow-up-row="${c1.id}"] [data-follow-up-call]`).getAttribute('href')) === 'tel:3525550161' && await page.locator(`[data-follow-up-row="${c1.id}"] [data-follow-up-text]`).isEnabled())
  check('salesman A does not see B\'s card', await page.locator(`[data-follow-up-row="${c4.id}"]`).count() === 0)
  await page.evaluate(() => window.scrollTo(0, 0)); await page.locator('[data-page-scroll]').evaluate(el => el.scrollTo(0, 0)).catch(() => {})
  await shot(page, 'dev-followup-screen')

  // Text templates: the phone's own texting app, the first name filled in.
  await tap(page.locator(`[data-follow-up-row="${c1.id}"] [data-follow-up-text]`))
  const tpl = page.locator('[data-text-templates] [data-template="checking-in"]')
  check('text template: the customer\'s first name is filled in', (await tpl.locator('[data-template-body]').innerText()).startsWith('Hi Fiona,'))
  await shot(page, 'dev-followup-text-template')
  const href = await tpl.getAttribute('href')
  check('text template: opens the texting app with the message ready (sms:), nothing sent by the app', href.startsWith('sms:3525550161?body=Hi%20Fiona'), href.slice(0, 60))
  if (CDP) await page.locator('[data-text-templates] button[aria-label="Close"]').click()
  else { await tap(tpl); await leaveAndReturn() }
  if (!CDP) {
    check('after a text, How\'d it go? is asked too', await page.locator(`[data-howd-it-go="${c1.id}"]`).isVisible().catch(() => false))
    await tap(page.locator('[data-answer-skip]'))
  }

  // ── 3. One tap changes the date ──
  await openCard(c1)
  await tap(page.locator('[data-card-follow-up-section] [data-date-chip="1 week"]'))
  check('one tap: the next follow up is a week out', (await page.locator('[data-card-next-follow-up]').getAttribute('data-card-next-follow-up')) === addDays(TODAY, 7))
  check('and the server has it', (await until(async () => (await board(A.token))[c1.id]?.dueOn === addDays(TODAY, 7))) === true)

  // ── 4. Log a call (made outside the app): Talked, not now, a date picked ──
  await tap(page.locator('[data-card-log-call]'))
  check('Log a call asks the same questions', await page.locator(`[data-howd-it-go="${c1.id}"] h2:has-text("Log a call")`).count() === 1)
  await tap(page.locator('[data-answer="not_now"]'))
  await tap(page.locator('[data-not-now] [data-date-chip="2 weeks"]'))
  await shot(page, 'dev-followup-not-now-date')
  await tap(page.locator('[data-save-not-now]'))
  check('Not now: the next follow up is the day picked', (await page.locator('[data-next-due]').getAttribute('data-next-due')) === addDays(TODAY, 14))
  await tap(page.locator('[data-answer-done]'))
  const h4 = await until(async () => { const h = await history(A.token, c1); return h.some(x => /Talked, not now/.test(x.title)) ? h : null })
  check('logged on the server, with the date', !!h4 && (await board(A.token))[c1.id]?.dueOn === addDays(TODAY, 14))
  // History: newest first, calls with answers and notes.
  await sleep(800)
  await page.locator('[data-card-history]').scrollIntoViewIfNeeded()
  const hist = await page.locator('[data-card-history]').innerText()
  check('card history: calls with answers, newest first', hist.indexOf('Talked, not now') >= 0 && hist.indexOf('Talked, not now') < hist.indexOf('No answer'), hist.replace(/\n/g, ' | ').slice(0, 200))
  await shot(page, 'dev-followup-history')
  await closeWindow()

  // ── 5. Lost, with a reason ──
  await go(`${APP}/follow-ups`); await page.waitForSelector('[data-follow-ups-page]', { timeout: 30000 }); await sleep(1500)
  await tap(page.locator(`[data-follow-up-row="${c2.id}"] [data-follow-up-log]`))
  await tap(page.locator('[data-answer="lost"]'))
  const reasons = await page.locator('[data-lost] [data-lost-reason]').allInnerTexts()
  check('Lost: price, went with someone else, no longer needed, other', reasons.join('|') === 'Price|Went with someone else|No longer needed|Other', reasons.join('|'))
  await shot(page, 'dev-followup-lost-reason')
  await tap(page.locator('[data-lost-reason="competitor"]'))
  const lostStage = await until(async () => ((await owner('GET', '/api/pipeline')).json.data?.leads ?? []).find(l => l.id === c2.id)?.stage === 'Lost Sale')
  check('Lost moves the card to Lost Sale', lostStage === true)
  const h5 = await until(async () => (await history(A.token, c2)).find(x => /Lost \(went with someone else\)/.test(x.title)))
  check('and the reason is in the call log', !!h5)
  check('steps stop on Lost (off the Follow ups list)', !idsIn(await listOf(A.token)).includes(c2.id))

  // ── 6. No signal: the answer waits on the phone and saves when signal returns ──
  await go(`${APP}/follow-ups`); await page.waitForSelector('[data-follow-ups-page]', { timeout: 30000 }); await sleep(1500)
  let offlineWorked = true
  try { await ctx.setOffline(true) } catch { offlineWorked = false }
  if (offlineWorked) {
    await tap(page.locator(`[data-follow-up-row="${c3.id}"] [data-follow-up-call]`))
    await leaveAndReturn()
    check('no signal: How\'d it go? is still asked', await page.locator(`[data-howd-it-go="${c3.id}"]`).isVisible().catch(() => false))
    await tap(page.locator('[data-answer="deciding"]'))
    const due6 = await page.locator('[data-next-due]').getAttribute('data-next-due')
    // Still deciding is 3 days, but the stage's day 2 call comes first.
    check('no signal: the next date shows at once (day 2 step before the 3 days)', due6 === addDays(TODAY, 2), due6)
    await tap(page.locator('[data-answer-done]'))
    await sleep(1500)
    const onServer = (await history(A.token, c3)).some(x => /still deciding/.test(x.title))
    check('no signal: not on the server yet', !onServer)
    check('no signal: the row says Saving…', /Saving…/.test(await page.locator(`[data-follow-up-row="${c3.id}"]`).innerText().catch(() => '')))
    await ctx.setOffline(false)
    const back = await until(async () => (await history(A.token, c3)).some(x => /still deciding/.test(x.title)), 40000)
    check('signal back: the answer saved on the server', back === true)
    check('signal back: the server has the next date', (await until(async () => (await board(A.token))[c3.id]?.dueOn === addDays(TODAY, 2))) === true)
  } else check('no signal test (this browser cannot go offline)', false)

  // ── 7. Salesman B sees only B's ──
  const la = await listOf(A.token), lb = await listOf(B.token)
  check('server: A\'s Follow ups has A\'s cards, not B\'s', idsIn(la).includes(c1.id) && !idsIn(la).includes(c4.id))
  check('server: B\'s Follow ups has B\'s card only, none of A\'s', idsIn(lb).includes(c4.id) && ![c1.id, c3.id].some(id => idsIn(lb).includes(id)))
  check('server: a salesman cannot ask for another rep', !idsIn(await listOf(A.token, B.id)).includes(c4.id))
  if (!CDP) {
    const bctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true })
    await bctx.addInitScript(setToken, B.token)
    const bp = await bctx.newPage()
    await bp.goto(`${APP}/follow-ups`); await bp.waitForSelector('[data-follow-ups-page]', { timeout: 40000 }); await sleep(2000)
    const txt = await bp.locator('[data-follow-ups-page]').innerText()
    check('screen: B sees Ivan, not Fiona or Hana', txt.includes(`Ivan Other ${stamp}`) && !txt.includes(`Fiona Callback ${stamp}`) && !txt.includes(`Hana Nosignal ${stamp}`))
    check('screen: no rep picker for a salesman', await bp.locator('[data-rep-filter]').count() === 0)
    await bctx.close()
  }
  if (!CDP) await ctx.close()

  // ── 8. The owner: everyone, filter by rep (computer), Settings, report ──
  if (!CDP) {
    const octx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    await octx.addInitScript(setToken, OWNER)
    const op = await octx.newPage()
    op.on('pageerror', e => errors.push(String(e).slice(0, 200)))
    await op.goto(`${APP}/follow-ups`); await op.waitForSelector('[data-follow-ups-page]', { timeout: 40000 }); await sleep(2000)
    const opts = await op.locator('[data-rep-filter] option').allInnerTexts()
    check('owner: a rep picker with both salesmen', opts.includes(A.name) && opts.includes(B.name), opts.join(', '))
    await op.locator('[data-rep-filter]').selectOption(A.id); await sleep(2000)
    const ta = await op.locator('[data-follow-ups-page]').innerText()
    check('owner, filtered to A: A\'s cards, not B\'s', ta.includes(`Fiona Callback ${stamp}`) && ta.includes(`Hana Nosignal ${stamp}`) && !ta.includes(`Ivan Other ${stamp}`))
    await shot(op, 'dev-followup-screen-desktop')
    await op.locator('[data-rep-filter]').selectOption(B.id); await sleep(2000)
    const tb = await op.locator('[data-follow-ups-page]').innerText()
    check('owner, filtered to B: only B\'s', tb.includes(`Ivan Other ${stamp}`) && !tb.includes(`Fiona Callback ${stamp}`))
    await octx.close()

    // Phone size for Settings and the report.
    const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true })
    await pctx.addInitScript(setToken, OWNER)
    const pp = await pctx.newPage()
    pp.on('pageerror', e => errors.push(String(e).slice(0, 200)))
    await pp.goto(`${APP}/settings?tab=follow_ups`); await pp.waitForSelector('[data-follow-up-settings]', { timeout: 40000 }); await sleep(1500)
    const ps = pp.locator('[data-steps-stage="Pending Signature"]')
    const kinds = await ps.locator('[data-step-kind]').evaluateAll(els => els.map(e => e.value))
    const days = await ps.locator('[data-step-day]').evaluateAll(els => els.map(e => e.value))
    check('Settings: Pending Signature call 2, text 5, call 10, call 21, then going cold', kinds.join(',') === 'call,text,call,call' && days.join(',') === '2,5,10,21' && (await ps.innerText()).includes('Going cold, keep or close?'), `${kinds} ${days}`)
    check('Settings: Estimating and Appointment have their own steps', await pp.locator('[data-steps-stage="Estimating"] [data-step]').count() === 4 && await pp.locator('[data-steps-stage="Appointment"] [data-step]').count() === 4)
    await ps.scrollIntoViewIfNeeded()
    await shot(pp, 'dev-followup-settings-steps')
    check('Settings: the first follow up shows the count first', /\d+ open cards? in Estimating and Pending Signature/.test(await pp.locator('[data-first-follow-up]').innerText()))
    await pp.goto(`${APP}/reports`); await sleep(2500)
    await pp.locator('button:has-text("Sales Performance")').click(); await sleep(400)
    await pp.locator('[data-report-tab="follow_ups"]').click(); await sleep(2500)
    const rep = await pp.locator('[data-follow-up-report]').innerText()
    check('report: done vs missed, touches to close, dollars with no follow up', /Done on time/.test(rep) && /Missed/.test(rep) && /Average touches to close/.test(rep) && /No follow up set/.test(rep) && rep.includes(A.name))
    await pp.locator('[data-follow-up-report]').scrollIntoViewIfNeeded()
    await shot(pp, 'dev-followup-report')
    await pctx.close()
  }
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
} catch (e) {
  if (SHOTS) await page?.screenshot({ path: path.join(SHOTS, `failed-${NAME}.png`) }).catch(() => {})
  check('test run finished', false, String(e?.stack || e).split('\n').slice(0, 6).join(' '))
} finally {
  // ── Clean up: cards, customers, users, and their follow up rows (dev database by name) ──
  for (let i = 0; i < 5 && made.cards.length; i++) {
    const pipe = (await owner('GET', '/api/pipeline')).json.data
    const extra = (pipe?.leads ?? []).filter(l => made.contacts.includes(l.customerId)).map(l => l.id)
    const r = await owner('PATCH', '/api/pipeline', { upsert: [], remove: [...new Set([...made.cards, ...extra])], baseVersion: pipe?.version })
    if (r.status === 200) break
    await sleep(300)
  }
  for (const id of made.contacts) if (id) await owner('DELETE', `/api/crm-contacts/${id}`).catch(() => {})
  for (const id of made.users) await owner('DELETE', `/api/crm-auth/users/${id}`).catch(() => {})
  try {
    const ids = made.users.map(u => `'${u.replace(/'/g, '')}'`).join(',') || "''"
    const cards = made.cards.map(c => `'${c.replace(/'/g, '')}'`).join(',') || "''"
    execFileSync('psql', ['-d', 'ezbiz_dev', '-q', '-c', `DELETE FROM "CallLog" WHERE "userId" IN (${ids}) OR "cardId" IN (${cards}); DELETE FROM "CardFollowUp" WHERE "cardId" IN (${cards}); DELETE FROM "PendingTouch" WHERE "userId" IN (${ids});`])
  } catch (e) { console.log('note: could not remove the test call log rows:', String(e).slice(0, 120)) }
  const left = ((await owner('GET', '/api/crm-auth/users')).json.data ?? []).filter(u => made.users.includes(u.id)).length
  check('clean up: the test logins are gone', left === 0)
  if (!CDP) await browser.close()
  const passed = results.filter(Boolean).length
  console.log(`\n${passed} of ${results.length} checks passed (${NAME})`)
  process.exit(passed === results.length ? 0 : 1)
}
