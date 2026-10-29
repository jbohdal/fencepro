// Walkthrough round 1 (Oct 25, 2026): each role's login does its day's work, on the dev copy.
//
//   cd apps/web && pnpm -s build
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 E2E_ACCESS_TOKEN=<dev owner token> node e2e/roles-round1.mjs
//
//   Salesman (computer, then an iPhone-size Safari engine phone):
//     - opens a pipeline card whose customer has notes (it used to blank the
//       whole app: dates came out as {} for a prices-only login); the notes,
//       quotes and history show; no "Something went wrong" message;
//     - opens the quote from the card: Proposal with Copy link / Text it / Email it, and its margin (she sees costs);
//     - a quote she saves with no rep is hers (sales rep = her name);
//     - Today opens on her own day; her task list has only tasks named for her.
//   Office Staff (computer): Customers, Sales Pipeline, Quotes, Billing, Portal
//     and Schedule open; "Phone call" and "Walk-in" lead sources in the new
//     customer form; texting consent saves; sees a quote's margin.
//   Installer (iPhone-size Safari engine): lands on My installs; today's
//     install with the customer's notes (no prices), Start, Finish (on the
//     job, with who), makes and opens the crew packet (notes once, the
//     customer's notes on it), photos; the job page has no price, payment or
//     contract; bottom tabs only to pages it can open; More opens its menu.
//   Review round 1 (c), Oct 25: the installer is refused the signed contract PDF and the
//     customers' messages; a note with a dollar amount keeps its words with the amount masked;
//     he gets only his installs' customers; no office controls (New job, Show numbers, Sort:
//     Value, Advance, Hold, Send updated warranty, Book a service call, Invoice Sent); typed
//     /jobs and /staging go to My installs. The Salesman lands on Today; her quote window shows
//     readable dates, says why Email it is grey, and Escape closes it on a computer.
//   No page errors anywhere.
// Dev only (port 4001). Removes the logins, customer, card, quotes, job and schedule entry it made.
import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import { chromium, webkit, devices } from 'playwright'
import crypto from 'crypto'
import { execFileSync } from 'child_process'
const sql = q => execFileSync('psql', ['-d', 'ezbiz_dev', '-At', '-c', q]).toString().trim()
const lit = s => `'${String(s).replace(/'/g, "''")}'`

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || 'http://localhost:4001'
const OWNER = process.env.E2E_ACCESS_TOKEN || ''
const local = u => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(u)
if (!local(APP) || !local(API) || /:4000(\/|$)/.test(API) || /:4000(\/|$)/.test(APP)) { console.error('Refusing to run: the dev copy only (localhost, not port 4000).'); process.exit(2) }
if (!OWNER) { console.error('Set E2E_ACCESS_TOKEN (an owner login on the dev server).'); process.exit(2) }

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const call = async (token, method, p, body) => {
  const r = await fetch(`${API}${p}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await r.text()
  let json = {}; try { json = JSON.parse(text) } catch {}
  return { status: r.status, json, text }
}
const owner = (m, p, b) => call(OWNER, m, p, b)
const stamp = Date.now().toString(36).slice(-6)
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
const made = { users: [], contactId: null, cardId: null, quotes: [], jobId: null, gridId: null }

async function invite(role, last) {
  const email = `e2e-${role}-${stamp}@example.test`
  const inv = await owner('POST', '/api/crm-auth/invite', { firstName: 'E2E', lastName: last, email, role })
  const link = new URL(inv.json.data.inviteUrl)
  made.users.push(email)
  const password = `Rr-${crypto.randomBytes(9).toString('base64url')}`
  const acc = await call('', 'POST', '/api/crm-auth/accept-invite', { token: link.searchParams.get('token'), email, password })
  return { email, password, token: acc.json.data?.accessToken, name: `E2E ${last}` }
}

const chrome = await chromium.launch()
const safari = await webkit.launch()
const errors = []
async function signedIn(login, phone) {
  const ctx = phone ? await safari.newContext({ ...devices['iPhone 13'] }) : await chrome.newContext({ viewport: { width: 1440, height: 900 } })
  const r = await ctx.request.post(`${API}/api/crm-auth/login`, { headers: { 'X-Staff-Request': '1' }, data: { email: login.email, password: login.password, cookie: true } })
  if (!r.ok()) throw new Error(`cookie sign in failed: ${r.status()} ${await r.text()}`)
  const page = await ctx.newPage()
  page.on('pageerror', e => errors.push(`${login.email}: ${String(e).slice(0, 200)}`))
  page.on('dialog', d => d.accept().catch(() => {}))
  // Stage changes ask the server to run automations; the dev data holds real customers, so not here.
  await page.route('**/api/automations/trigger', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true,"data":{"matched":0}}' }))
  return { ctx, page }
}
const go = async (page, p) => { await page.goto(`${APP}${p}`, { waitUntil: 'domcontentloaded' }); await page.waitForSelector('[data-tabbar]', { timeout: 30000 }).catch(() => {}); await sleep(2500) }
const pathOf = page => new URL(page.url()).pathname
const noCrash = async (page, where) => {
  const crashed = await page.locator('[data-screen-error]').count()
  const len = (await page.locator('body').innerText().catch(() => '')).trim().length
  check(`${where}: drawn, no "Something went wrong"`, crashed === 0 && len > 50, `${crashed} error boxes, ${len} characters`)
}

try {
  // ── Setup (owner, through the API) ──
  const contact = await owner('POST', '/api/crm-contacts', { firstName: 'E2E', lastName: `Roles ${stamp}`, phone: `352555${String(Math.floor(Math.random() * 9000) + 1000)}`, serviceAddress: '110 SE Watula Ave, Ocala, FL 34471', notes: 'Keep the side gate shut' })
  made.contactId = contact.json.data?.id ?? null
  const NAME = `E2E Roles ${stamp}`
  await owner('POST', `/api/crm-contacts/${made.contactId}/notes`, { body: 'Website, drawn by customer\nEstimate shown to the customer: $5,000\nCustomer notes: Need it done before Thanksgiving, have 2 dogs. Budget about $4000.' })
  const quote = await owner('POST', '/api/saved-quotes', {
    crmContactId: made.contactId, customerName: NAME, customerPhone: contact.json.data?.phone ?? '', customerAddress: '110 SE Watula Ave, Ocala, FL 34471',
    fenceStyle: "WV-ND 6'x8' Privacy", runs: [120], corners: 0, ends: 2, sections: 15, finalPrice: 5000, status: 'SENT', notes: 'Gate code 1234',
    proposal: { version: 1, options: [{ label: 'White vinyl', fenceStyle: "WV-ND 6'x8' Privacy", finalPrice: 5000, perFoot: 41.67, sections: 15 }] },
  })
  made.quotes.push(quote.json.data?.id)
  made.cardId = `e2e-card-${stamp}`
  const card = { id: made.cardId, firstName: 'E2E', lastName: `Roles ${stamp}`, customerId: made.contactId, quoteId: quote.json.data?.id, stage: 'First Contact', phone: '', email: '', address: '110 SE Watula Ave, Ocala, FL 34471', notes: '', crew: '', jobValue: 5000, quotePrice: 5000, sections: 15, fenceType: '', leadSource: '', assignedRep: '', paymentStatus: '', scheduledDate: '', balanceDue: 0, leadTemp: 0, createdAt: today, lastMoved: today }
  // Other screens may save the board meanwhile: on the version just read, a few tries.
  let addCard = { status: 0 }
  for (let i = 0; i < 5 && addCard.status !== 200; i++) {
    const pipe = (await owner('GET', '/api/pipeline')).json
    addCard = await owner('PATCH', '/api/pipeline', { upsert: [{ lead: card }], remove: [], baseVersion: pipe.data?.version ?? pipe.version })
    if (addCard.status !== 200) await sleep(1000)
  }
  const job = await owner('POST', '/api/saved-jobs', { customerName: NAME, crmContactId: made.contactId, quoteId: quote.json.data?.id, customerAddress: '110 SE Watula Ave, Ocala, FL 34471', fenceStyle: "WV-ND 6'x8' Privacy", sections: 15, totalFeet: 120, notes: 'Gate code 1234', status: 'scheduled', scheduledDate: today, crewAssigned: 'crew1', estimatedDays: 1 })
  made.jobId = job.json.data?.id ?? null
  const grid = await owner('POST', '/api/schedule/jobs', { stagingJobId: made.jobId, clientName: NAME, crewId: 'crew1', date: today, sections: 15, status: 'Scheduled' })
  made.gridId = grid.json.data?.id ?? null
  // An approved change order on the quote (Oct 25 review: the installer's packet left it out): 140 ft, 18 sections, a walk gate.
  if (quote.json.data?.id) sql(`INSERT INTO "ChangeOrder" (id, "accountId", "quoteId", number, status, "approvedAt", "totalCents", work, "createdAt", "updatedAt") SELECT ${lit(crypto.randomUUID())}, "accountId", id, 1, 'approved', now(), 0, ${lit(JSON.stringify({ fenceStyle: "WV-ND 6'x8' Privacy", footage: 140, sections: 18, runs: [120, 20], walkGates: 1, dblGates: 0, layout: { runSections: [15, 3] }, pullSheet: [{ item: 'E2E change order post', qty: 7 }] }))}::jsonb, now(), now() FROM "SavedQuote" WHERE id = ${lit(quote.json.data.id)}`)
  check('setup: customer with notes, quote, pipeline card, job and today\'s crew day', !!made.contactId && !!quote.json.data?.id && addCard.status === 200 && !!made.jobId && !!made.gridId, `${contact.status} ${quote.status} ${addCard.status} ${job.status} ${grid.status}`)

  const sales = await invite('sales_rep', `Salesman ${stamp}`)
  const office = await invite('office_staff', `Office ${stamp}`)
  const crew = await invite('field_crew', `Installer ${stamp}`)
  check('logins: Salesman, Office Staff and Installer', !!sales.token && !!office.token && !!crew.token)
  // The Salesman sees only the Salesman's own and assigned customers (lib/salesScope.ts, Oct 28 2026): the owner
  // assigns this lead to the Salesman (the Assign screen's call), as he does with a new lead.
  const salesId = (await call(sales.token, 'GET', '/api/crm-auth/me')).json.data?.id
  const assigned = await owner('POST', `/api/lead-assign/${made.contactId}`, { to: salesId })
  check('setup: the owner assigns the lead to the Salesman', assigned.status === 200, `${assigned.status} ${assigned.text?.slice(0, 160) ?? ''}`)

  // ── Salesman ──
  for (const phone of [false, true]) {
    const where = phone ? 'salesman phone' : 'salesman computer'
    const { ctx, page } = await signedIn(sales, phone)
    await go(page, `/pipeline?card=${encodeURIComponent(made.cardId)}`)
    if (!(await page.locator('[data-card-quotes]').count())) {
      // Not opened from the address: find the card on the board.
      await page.locator(`text=Roles ${stamp}`).first().click({ timeout: 20000 }).catch(() => {})
      await sleep(2000)
    }
    await page.locator('[data-card-note]').first().waitFor({ timeout: 15000 }).catch(() => {})
    await noCrash(page, `${where}: the card window`)
    check(`${where}: the card shows the customer's note and its quote`, await page.locator('[data-card-note]').count() > 0 && await page.locator(`[data-card-quote="${quote.json.data?.id}"]`).count() === 1)
    await page.locator(`[data-card-quote="${quote.json.data?.id}"]`).click()
    await page.locator('[data-quote-drawer]').waitFor({ timeout: 15000 }).catch(() => {})
    const qd = await page.locator('[data-quote-drawer]').innerText()
    check(`${where}: the quote window shows a readable date, not YYYY-MM-DD`, !/\d{4}-\d{2}-\d{2}/.test(qd.split('\n').slice(0, 4).join(' ')), qd.split('\n').slice(0, 3).join(' | '))
    check(`${where}: Email it greyed says why (no email on the customer)`, /add an email to the customer first/i.test(qd))
    if (!phone) {
      await page.keyboard.press('Escape'); await sleep(800)
      check(`${where}: Escape closes the quote window`, await page.locator('[data-quote-drawer]').count() === 0)
      await page.locator(`[data-card-quote="${quote.json.data?.id}"]`).click()
      await page.locator('[data-quote-drawer]').waitFor({ timeout: 15000 }).catch(() => {})
    }
    check(`${where}: the quote shows Proposal with Copy link, Text it and Email it`, await page.locator('[data-quote-drawer] [data-proposal-send]').count() === 1 && await page.locator('[data-proposal-text]').isVisible() && await page.locator('[data-proposal-copy]').isVisible() && await page.locator('[data-quote-drawer] button:has-text("Email it")').count() === 1)
    // She sees costs since Oct 25, 2026 (Jonathan): the margin is on her quote.
    check(`${where}: her quote shows its margin`, /margin/i.test(await page.locator('[data-quote-drawer]').innerText()))
    await go(page, '/')
    check(`${where}: sign in lands on Today, not the company Dashboard`, pathOf(page) === '/today', pathOf(page))
    await go(page, '/today')
    await noCrash(page, `${where}: Today`)
    const me = (await call(sales.token, 'GET', '/api/crm-auth/me')).json.data
    const myId = me?.id ?? me?.user?.id
    const picked = await page.locator('[data-today] [data-person-filter]').inputValue().catch(() => '')
    check(`${where}: Today opens on her own day`, !!myId && picked === `u:${myId}`, `${picked} vs u:${myId}`)
    check(`${where}: no "Invalid Date" on Today`, !/Invalid Date/.test(await page.locator('body').innerText()))
    await ctx.close()
  }
  const tasksHers = (await call(sales.token, 'GET', '/api/automations/tasks')).json.data ?? []
  const tasksOwner = (await owner('GET', '/api/automations/tasks')).json.data ?? []
  check('salesman: her tasks are only ones named for her (no company tasks that name nobody)', tasksHers.every(t => t.assignedTo && /salesman/i.test(t.assignedTo)) && tasksOwner.length >= tasksHers.length, `${tasksHers.length} hers, ${tasksOwner.length} owner's`)
  const hers = await call(sales.token, 'POST', '/api/saved-quotes', { crmContactId: made.contactId, customerName: NAME, salesRep: '', fenceStyle: "WV-ND 6'x8' Privacy", status: 'DRAFT', notes: '' })
  made.quotes.push(hers.json.data?.id)
  const hersSaved = (await owner('GET', `/api/saved-quotes/${hers.json.data?.id}`)).json.data
  check('salesman: a quote she saves with no rep is credited to her', hersSaved?.salesRep === sales.name, `${hers.status} "${hersSaved?.salesRep}"`)

  // ── Office Staff (computer) ──
  {
    const { ctx, page } = await signedIn(office, false)
    const landed = {}
    for (const p of ['/customers', '/pipeline', '/quotes', '/billing', '/portal-inbox', '/schedule']) { await go(page, p); landed[p] = pathOf(page); await noCrash(page, `office ${p}`) }
    check('office: Customers, Sales Pipeline, Quotes, Billing, Portal and Schedule open', Object.entries(landed).every(([p, at]) => at === p), JSON.stringify(landed))
    await go(page, '/customers/new')
    const phoneCall = page.locator('[data-lead-source-choice="Phone call"]'), walkIn = page.locator('[data-lead-source-choice="Walk-in"]')
    await phoneCall.first().waitFor({ timeout: 15000 }).catch(() => {})
    check('office: the new customer form offers "Phone call" and "Walk-in"', await phoneCall.count() > 0 && await walkIn.count() > 0)
    const consent = await call(office.token, 'POST', `/api/crm-contacts/${made.contactId}/text-consent`, { consent: 'yes' })
    check('office: texting consent saves on the customer', consent.status === 200 && consent.json.data?.textConsent !== undefined, `${consent.status}`)
    await go(page, `/quotes?qv=${quote.json.data?.id}`)
    await page.locator('[data-quote-drawer]').waitFor({ timeout: 15000 }).catch(() => {})
    const drawer = await page.locator('[data-quote-drawer]').innerText().catch(() => '')
    check('office: the quote shows, with Proposal and its margin (the office sees costs)', /margin/i.test(drawer) && await page.locator('[data-quote-drawer] [data-proposal-send]').count() === 1)
    const ls = (await call(office.token, 'GET', '/api/option-lists/leadSources')).json.data
    check('office: "Phone call" and "Walk-in" are built-in lead sources offered in pickers', ['Phone call', 'Walk-in'].every(w => (ls?.options ?? []).some(o => o.id === w && !o.hidden && o.builtIn)))
    await ctx.close()
  }

  // ── Installer (phone) ──
  {
    const { ctx, page } = await signedIn(crew, true)
    await go(page, '/')
    await page.locator('[data-installer-home]').waitFor({ timeout: 20000 }).catch(() => {})
    check('installer: lands on My installs', pathOf(page) === '/my-installs' && await page.locator('[data-installer-home]').count() === 1, pathOf(page))
    await noCrash(page, 'installer home')
    const cardSel = `[data-installs-today] [data-install-card="${made.jobId}"]`
    const c = page.locator(cardSel)
    await c.waitFor({ timeout: 15000 }).catch(() => {})
    check('installer: today\'s install is listed under Today', await c.count() === 1)
    await c.locator('[data-install-customer-notes]').waitFor({ timeout: 15000 }).catch(() => {})
    const notes = await c.locator('[data-install-customer-notes]').innerText().catch(() => '')
    // Round 2 (Oct 26 2026): a sentence about a price ("Budget about $4000.") is dropped for the crew; the rest of the line stays.
    check('installer: the customer\'s notes are on it ("have 2 dogs"), the price sentence dropped, the rest kept', /have 2 dogs\./.test(notes) && /side gate/.test(notes) && !/Budget|left out|4000|\$\s?\d/.test(notes), notes.replace(/\s+/g, ' '))
    // Not his: the signed contract (price and deposit), customers' messages, other customers.
    check('installer: the signed contract PDF is refused', (await call(crew.token, 'GET', `/api/warranties/quote/${quote.json.data?.id}/contract.pdf`)).status === 403)
    check('installer: customers\' portal messages are refused', (await call(crew.token, 'GET', '/api/portal/messages/inbox')).status === 403)
    const theirContacts = (await call(crew.token, 'GET', '/api/crm-contacts')).json.data ?? []
    const allContacts = (await owner('GET', '/api/crm-contacts')).json.data ?? []
    check('installer: only his installs\' customers (not every customer\'s phone and email)', theirContacts.some(c => c.id === made.contactId) && theirContacts.length < 60 && theirContacts.length < allContacts.length, `${theirContacts.length} of ${allContacts.length}`)
    const other = allContacts.find(c => !theirContacts.some(x => x.id === c.id))
    check('installer: another customer by id is not found', !other || (await call(crew.token, 'GET', `/api/crm-contacts/${other.id}/notes`)).status === 404)
    check('installer: no price or cost on the home screen', !/\$\s*\d/.test(await page.locator('[data-installer-home]').innerText()))
    await c.locator('[data-install-start]').click()
    await c.locator('[data-install-started]').waitFor({ timeout: 15000 }).catch(() => {})
    await c.locator('[data-install-finish]').click()
    await sleep(1500)
    const times = (await owner('GET', `/api/install-packets/crew/${made.jobId}`)).json.data?.times ?? []
    check('installer: Start and Finish are saved on the job with who tapped', times.length === 2 && times[0].kind === 'start' && times[1].kind === 'finish' && times.every(t => t.by === crew.name), JSON.stringify(times))
    // The crew packet: made from here when the office has not sent it yet, then opened.
    if (await c.locator('[data-install-packet-make]').count()) { await c.locator('[data-install-packet-make]').click(); await c.locator('[data-install-packet-open]').waitFor({ timeout: 30000 }).catch(() => {}) }
    const href = await c.locator('[data-install-packet-open]').getAttribute('href').catch(() => null)
    check('installer: the install opens its crew packet', !!href && /\/p\/i\//.test(href), String(href))
    if (href) {
      const packet = await ctx.newPage()
      await packet.goto(href.startsWith('http') ? href : `${APP}${href}`)
      const t = await packet.locator('body').innerText()
      check('crew packet: the customer\'s notes are on it', /Customer notes/.test(t) && /have 2 dogs/.test(t) && !/Estimate shown/.test(t) && !/4000/.test(t))
      check('crew packet: the job\'s and the quote\'s note printed once', (t.match(/Gate code 1234/g) || []).length === 1, `${(t.match(/Gate code 1234/g) || []).length} times`)
      check('crew packet: no price', !/\$\s*\d/.test(t))
      check('crew packet made by the installer carries the approved change order (140 ft, 18 sections, walk gate, its pull sheet)', /140 ft/.test(t) && /18 sections/.test(t) && /1 walk gate/.test(t) && /E2E change order post/.test(t), (t.match(/\d+ ft · \d+ sections/) || [''])[0])
      await packet.close()
    }
    // The job page: the work, no price (no Financial, Payments, Change Orders or contract).
    await go(page, `/operations?job=${made.jobId}`)
    await page.locator('[data-job-panel]').waitFor({ timeout: 15000 }).catch(() => {})
    const jobText = await page.locator('[data-job-panel]').innerText().catch(() => '')
    check('installer: the job page shows no price, payment or contract', !/\$\s?(\d|NaN)|Contract Value|Amount Paid|Outstanding/.test(jobText) && /Install packet/.test(jobText), (jobText.match(/.{0,30}\$\s?(\d|NaN).{0,10}/) || [''])[0])
    check('installer: the job page has no office controls', !/Advance to|Advance Stage|\bHold\b|Send updated warranty|Book a service call|Invoice Sent|Update the install packet|Turn off link/.test(jobText), (jobText.match(/Advance to|Advance Stage|\bHold\b|Send updated warranty|Book a service call|Invoice Sent|Update the install packet|Turn off link/) || [''])[0])
    const moved = await call(crew.token, 'PATCH', `/api/saved-jobs/${made.jobId}`, { status: 'on_hold', holdReason: 'test' })
    check('installer: the server refuses a hold or stage move from him', moved.status === 403, `${moved.status}`)
    check('installer: booking a service call is refused', (await call(crew.token, 'POST', '/api/service-tickets', { id: crypto.randomUUID(), jobId: made.jobId, issue: 'leaning_post' })).status === 403)
    await go(page, '/operations')
    const boardText = await page.locator('body').innerText()
    check('installer: the board has no New job, Show numbers or Sort: Value', !/\+ New job|Show numbers|Sort: Value/.test(boardText))
    for (const typed of ['/jobs', '/staging']) { await go(page, typed); check(`installer: typing ${typed} goes to My installs`, pathOf(page) === '/my-installs', pathOf(page)) }
    await go(page, '/my-installs')
    await c.locator('[data-install-photos]').waitFor({ timeout: 15000 }).catch(() => {})
    await c.locator('[data-install-photos]').click()
    check('installer: photos open on the install (progress, completed)', await c.locator('text=Progress and completed photos').count() > 0)
    // Bottom tabs: only pages this login can open; each one opens.
    const tabs = await page.locator('[data-tabbar] button').allInnerTexts()
    check('installer: bottom tabs are Installs, Jobs, Stock and More', JSON.stringify(tabs.map(x => x.trim())) === JSON.stringify(['Installs', 'Jobs', 'Stock', 'More']), JSON.stringify(tabs))
    for (const [label, want] of [['Jobs', '/operations'], ['Stock', '/inventory'], ['Installs', '/my-installs']]) {
      await page.locator(`[data-tabbar] button:has-text("${label}")`).click(); await sleep(2000)
      check(`installer: the ${label} tab opens ${want}`, pathOf(page) === want, pathOf(page))
      await noCrash(page, `installer ${want}`)
    }
    await page.locator('[data-popup-trigger="nav-drawer"]').click(); await sleep(1000)
    const drawer = page.locator('[data-popup="nav-drawer"]')
    check('installer: More opens its menu', /open/.test(await drawer.getAttribute('class') ?? '') && await drawer.locator('button:has-text("My installs")').isVisible())
    await ctx.close()
  }
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
} catch (e) {
  check('ran to the end', false, String(e?.stack ?? e).slice(0, 400))
} finally {
  if (made.gridId) await owner('DELETE', `/api/schedule/jobs/${made.gridId}`).catch(() => {})
  if (made.jobId) await owner('DELETE', `/api/saved-jobs/${made.jobId}`).catch(() => {})
  for (const id of made.quotes.filter(Boolean)) { try { sql(`DELETE FROM "ChangeOrder" WHERE "quoteId" = ${lit(id)}`) } catch { /* none */ } }
  for (const id of made.quotes.filter(Boolean)) await owner('DELETE', `/api/saved-quotes/${id}`).catch(() => {})
  if (made.cardId) await owner('DELETE', `/api/pipeline/cards/${encodeURIComponent(made.cardId)}`).catch(() => {})
  if (made.contactId) await owner('DELETE', `/api/crm-contacts/${made.contactId}`).catch(() => {})
  const users = (await owner('GET', '/api/crm-auth/users')).json.data ?? []
  for (const u of users.filter(x => made.users.includes(x.email))) await owner('DELETE', `/api/crm-auth/users/${u.id}`).catch(() => {})
  await chrome.close(); await safari.close()
}
const failed = results.filter(r => !r).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
