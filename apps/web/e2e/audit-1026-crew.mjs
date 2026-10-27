// Feature audit, Oct 26 2026: the installer's phone and operations, each as the person who meets it, on the dev copy.
//
//   cd apps/web && pnpm -s build
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 E2E_ACCESS_TOKEN=<dev owner token> node e2e/audit-1026-crew.mjs
//
//   Installer (iPhone-size Safari engine): his install's card shows 811 "not clear to dig until ..." in red; Start asks
//     "Start anyway?" and goes ahead on yes; a photo picked from the gallery shows at once and after a reload
//     ("(1)", never "(0)"), once; his covered warranty visit (booked with him) is on My installs with its $0 work
//     order and no price; his bell has no "Permit still"; his Operations board has no orange "+".
//   Salesman (iPhone): her visit tapped on Today opens with the Add lead notes, Call, Navigate, New quote and Change
//     appointment; the card window shows the Add lead notes ("On the customer record").
//   Office (computer): a customer's message read on another screen but not answered keeps the bubble's badge and says
//     "Waiting for a reply"; a job in Awaiting Locates with no date is in that column, not Unscheduled; the styles
//     filter has no import codes; Search finds the quote by its number (#XXXXXX); Team's invite says the office sees
//     costs, and the sidebar says "Office".
//   No page errors.
// Dev only (localhost, never port 4000). Removes everything it made.
import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import { chromium, webkit, devices } from 'playwright'
import crypto from 'crypto'
import { execFileSync } from 'child_process'
const sql = q => execFileSync('psql', ['-d', 'ezbiz_dev', '-At', '-c', q]).toString().trim()
const lit = s => `'${String(s).replace(/'/g, "''")}'`

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || 'http://localhost:4001'
const OWNER = process.env.E2E_ACCESS_TOKEN || ''
const PHOTO = process.env.MEDIA_PHOTO || ''
const local = u => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(u)
if (!local(APP) || !local(API) || /:4000(\/|$)/.test(API) || /:4000(\/|$)/.test(APP)) { console.error('Refusing to run: the dev copy only (localhost, not port 4000).'); process.exit(2) }
if (!OWNER || !PHOTO) { console.error('Set E2E_ACCESS_TOKEN (an owner login on the dev server) and MEDIA_PHOTO (a .jpg).'); process.exit(2) }

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
async function until(fn, ms = 20000, every = 500) { const end = Date.now() + ms; for (;;) { const v = await fn().catch(() => null); if (v || Date.now() > end) return v; await sleep(every) } }
const stamp = Date.now().toString(36).slice(-6)
const ymd = d => d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
const today = ymd(new Date())
const plus = (d, n) => { const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10) }
const mdY = d => `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}`
const ADDR = '110 SE Watula Ave, Ocala, FL 34471'
const LEAD_NOTES = 'wants 6 ft white vinyl, ~150 ft, one walk gate'
const made = { users: [], contacts: [], quotes: [], jobs: [], grids: [], appts: [], tickets: [], messages: [] }

async function invite(role, last) {
  const email = `e2e-a1026-${role}-${stamp}@example.test`
  const inv = await owner('POST', '/api/crm-auth/invite', { firstName: 'E2E', lastName: last, email, role })
  const link = new URL(inv.json.data.inviteUrl)
  made.users.push(email)
  const password = `Aa-${crypto.randomBytes(9).toString('base64url')}`
  const acc = await call('', 'POST', '/api/crm-auth/accept-invite', { token: link.searchParams.get('token'), email, password })
  const id = ((await owner('GET', '/api/crm-auth/users')).json.data ?? []).find(u => u.email === email)?.id
  return { email, password, token: acc.json.data?.accessToken, id, name: `E2E ${last}` }
}

async function customer(label, extra = {}) {
  const id = crypto.randomUUID(), cardId = crypto.randomUUID(), last = `A1026 ${label} ${stamp}`
  const phone = `352555${String(Math.floor(Math.random() * 9000) + 1000)}`
  const r = await owner('POST', '/api/crm-contacts', { id, firstName: 'E2E', lastName: last, phone, serviceAddress: ADDR, leadSource: 'Other', notes: extra.notes ?? '',
    lead: { id: cardId, customerId: id, firstName: 'E2E', lastName: last, phone, address: ADDR, stage: 'First Contact', leadSource: 'Other', createdAt: today, lastMoved: today }, leadBefore: null })
  made.contacts.push(id)
  return { id, cardId, name: `E2E ${last}`, phone, ok: r.status === 201 || r.status === 200 }
}

async function soldJob(label, days, extra = {}) {
  const c = await customer(label)
  const quote = await owner('POST', '/api/saved-quotes', {
    crmContactId: c.id, customerName: c.name, customerPhone: c.phone, customerAddress: ADDR,
    fenceStyle: "WV-ND 6'x8' Privacy", runs: [120], corners: 0, ends: 2, sections: 15, finalPrice: 5000, status: 'SOLD',
    proposal: { version: 1, options: [{ label: 'White vinyl', fenceStyle: "WV-ND 6'x8' Privacy", finalPrice: 5000, perFoot: 41.67, sections: 15 }] },
  })
  const quoteId = quote.json.data?.id
  made.quotes.push(quoteId)
  sql(`UPDATE "SavedQuote" SET "acceptedAt" = now(), "soldAt" = coalesce("soldAt", now()) WHERE id = ${lit(quoteId)}`)
  const booked = days.length > 0
  const job = await owner('POST', '/api/saved-jobs', { customerName: c.name, crmContactId: c.id, quoteId, customerAddress: ADDR, customerPhone: c.phone, fenceStyle: "WV-ND 6'x8' Privacy", sections: 15, totalFeet: 120, quotePrice: 5000, contractValue: 5000,
    status: booked ? 'scheduled' : (extra.status ?? 'staging'), opsStage: extra.opsStage, scheduledDate: booked ? days[0] : '', scheduledEndDate: booked ? days[days.length - 1] : null, crewAssigned: booked ? 'crew1' : '', estimatedDays: Math.max(1, days.length) })
  const jobId = job.json.data?.id
  made.jobs.push(jobId)
  for (const d of days) { const g = await owner('POST', '/api/schedule/jobs', { stagingJobId: jobId, clientName: c.name, crewId: 'crew1', date: d, sections: 15, status: 'Scheduled' }); made.grids.push(g.json.data?.id) }
  return { ...c, quoteId, jobId, ok: c.ok && !!quoteId && !!jobId }
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
  await page.route('**/api/automations/trigger', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true,"data":{"matched":0}}' }))
  return { ctx, page }
}
const go = async (page, p) => { await page.goto(`${APP}${p}`, { waitUntil: 'domcontentloaded' }); await page.waitForSelector('[data-tabbar], [data-global-appointment]', { timeout: 30000 }).catch(() => {}); await sleep(2500) }

try {
  // ── Set up (owner, through the API) ──
  const crew = await invite('field_crew', `Installer ${stamp}`)
  const sales = await invite('sales_rep', `Sales ${stamp}`)
  const office = await invite('office_staff', `Office ${stamp}`)
  const A = await soldJob('Locate', [today])
  const good = plus(today, 3)
  const loc = await owner('PUT', `/api/saved-jobs/${A.jobId}/locate`, { ticket: '294610777', calledDate: today, goodDate: good, expDate: plus(today, 30) })
  // B: a finished job with a covered warranty request, its visit booked with the installer tomorrow.
  const B = await soldJob('Warranty', [], { status: 'paid' })
  sql(`UPDATE "SavedJob" SET status = 'paid', "opsStage" = 'paid', "completedDate" = ${lit(plus(today, -40))} WHERE id = ${lit(B.jobId)}`)
  const visitAt = new Date(`${plus(today, 1)}T13:30:00Z`).toISOString()
  const appt = await owner('POST', '/api/appointments', { crmContactId: B.id, type: 'warranty', startAt: visitAt, address: ADDR, assignedToUserId: crew.id, notes: 'Gate latch sticks. Quoted $350 if it had not been covered.' })
  made.appts.push(appt.json.data?.id)
  const ticketId = crypto.randomUUID()
  sql(`INSERT INTO "ServiceTicket" (id, "accountId", "jobId", "crmContactId", issue, notes, stage, decision, "warrantyName", "appointmentId", "updatedAt") SELECT ${lit(ticketId)}, "accountId", id, ${lit(B.id)}, 'gate', 'Latch does not catch.', 'scheduled', 'covered', 'Lifetime Craftsmanship Warranty', ${lit(appt.json.data?.id)}, now() FROM "SavedJob" WHERE id = ${lit(B.jobId)}`)
  made.tickets.push(ticketId)
  // C: a lead typed by the office with notes, her visit tomorrow.
  const C = await customer('Lead', { notes: LEAD_NOTES })
  const visit = await owner('POST', '/api/appointments', { crmContactId: C.id, type: 'estimate', startAt: new Date(`${plus(today, 1)}T14:00:00Z`).toISOString(), address: ADDR, assignedToUserId: sales.id, notes: 'measure back yard' })
  made.appts.push(visit.json.data?.id)
  // D: a job waiting for locates, no install date.
  const D = await soldJob('Awaiting', [], { opsStage: 'awaiting_locates' })
  sql(`UPDATE "SavedJob" SET "opsStage" = 'awaiting_locates', status = 'staging' WHERE id = ${lit(D.jobId)}`)
  // A permit reminder about A (the office's), as made now.
  sql(`INSERT INTO "Notification" (id, title, body, type, "jobId", "recipientRole") VALUES (${lit(crypto.randomUUID())}, ${lit(`Permit still Needed: ${A.name}`)}, '', 'warning', ${lit(A.jobId)}, 'office')`)
  // A customer's portal message, read on another screen 6 s later, not answered.
  const msgId = crypto.randomUUID()
  sql(`INSERT INTO "PortalMessage" (id, "crmCustomerId", "senderType", body, "isReadByStaff", "readByStaffAt", "isReadByCustomer") VALUES (${lit(msgId)}, ${lit(B.id)}, 'customer', ${lit(`A1026 ${stamp}: one gate latch sticks a little`)}, true, now(), true)`)
  made.messages.push(msgId)
  check('setup: installer, Salesman and Office logins; a job booked today with 811 good to dig later; a covered warranty visit with the installer; a lead with notes and her visit; a job in Awaiting Locates',
    !!crew.id && !!sales.id && !!office.id && A.ok && B.ok && C.ok && D.ok && loc.status === 200 && !!appt.json.data?.id && !!visit.json.data?.id, `${loc.status} ${appt.status} ${visit.status}`)

  // ── Installer (phone) ──
  {
    const { ctx, page } = await signedIn(crew, true)
    const asked = []
    page.on('dialog', d => { asked.push(d.message()); d.accept().catch(() => {}) })
    await go(page, '/my-installs')
    const a = page.locator(`[data-installs-today] [data-install-card="${A.jobId}"]`)
    await a.waitFor({ timeout: 20000 }).catch(() => {})
    const warn = await a.locator('[data-install-locate-warn]').innerText().catch(() => '')
    check('installer: the card says 811 is not clear to dig until the good to dig date', warn.includes(`not clear to dig until ${mdY(good)}`), warn)
    await a.locator('[data-install-start]').tap()
    await until(async () => asked.length > 0 || null, 5000)
    await a.locator('[data-install-started]').waitFor({ timeout: 15000 }).catch(() => {})
    check('installer: Start asks "Start anyway?" and goes ahead on yes', /Start anyway/.test(asked[0] ?? '') && await a.locator('[data-install-started]').isVisible().catch(() => false), asked[0] ?? 'not asked')

    // Photos: picked from the gallery, shown at once and after a reload; once.
    await a.locator('[data-install-photos]').tap()
    await a.locator('[data-media-pick] input[type="file"]').setInputFiles(PHOTO)
    const shown = await until(async () => /\((\d+)\)/.exec(await a.locator('[data-media-gallery]').innerText())?.[1] === '1' && (await a.locator('[data-media-item="uploaded"]').count()) === 1 || null, 30000)
    check('installer: the photo he picked is listed, uploaded', !!shown, await a.locator('[data-media-gallery]').innerText().catch(() => ''))
    await go(page, '/my-installs')
    await a.locator('[data-install-photos]').tap()
    const after = await until(async () => { const t = await a.locator('[data-media-gallery]').innerText(); return /\(1\)/.test(t) ? t : null }, 15000)
    check('installer: after a reload his photo is still there ("(1)", not "(0)")', !!after, await a.locator('[data-media-gallery]').innerText().catch(() => ''))
    check('installer: saved once', Number(sql(`SELECT count(*) FROM "MediaItem" WHERE "jobId" = ${lit(A.jobId)} AND "deletedAt" IS NULL`)) === 1)

    // His warranty visit.
    const v = page.locator(`[data-crew-visit="${appt.json.data?.id}"]`)
    await v.waitFor({ timeout: 15000 }).catch(() => {})
    const vt = await v.innerText().catch(() => '')
    check('installer: the covered warranty visit booked with him is on My installs, with its $0 work order', /Warranty visit/i.test(vt) && /no charge to the customer/.test(vt) && vt.includes(B.name) && /Latch does not catch/.test(vt), vt.replace(/\n/g, ' | '))
    check('installer: no price on the visit', !/\$\s?\d|350/.test(vt))
    check('installer: Navigate and Call on the visit', (await v.locator('[data-visit-navigate]').getAttribute('href') ?? '').includes('maps') && (await v.locator('[data-visit-call]').getAttribute('href') ?? '').startsWith('tel:'))

    // His bell, and his Operations board.
    const bell = await call(crew.token, 'GET', '/api/automations/notifications')
    check('installer: no "Permit still" on his bell', !(bell.json.data?.notifications ?? []).some(n => /^Permit still/.test(n.title)), String(bell.status))
    await go(page, '/operations')
    check('installer: no orange "+" (New job) on his Operations board', (await page.locator('button[aria-label="New Job"]').count()) === 0)
    await ctx.close()
  }

  // ── Salesman (phone) ──
  {
    const { ctx, page } = await signedIn(sales, true)
    await go(page, '/today')
    const row = page.locator(`[data-today-upcoming="${visit.json.data?.id}"]`)
    await row.waitFor({ timeout: 20000 }).catch(() => {})
    await row.tap()
    const w = page.locator(`[data-visit-window="${visit.json.data?.id}"]`)
    await w.waitFor({ timeout: 10000 }).catch(() => {})
    const wt = await w.innerText().catch(() => '')
    check('Salesman: her visit opens with the notes typed in Add lead and the booking\'s', wt.includes(LEAD_NOTES) && wt.includes('measure back yard'), wt.replace(/\n/g, ' | '))
    check('Salesman: the visit has Call, Navigate, New quote and Change appointment', await w.locator('[data-visit-call]').isVisible() && await w.locator('[data-visit-navigate]').isVisible() && await w.locator('[data-visit-new-quote]').isVisible() && await w.locator('[data-visit-edit]').isVisible())
    await w.locator('[data-visit-edit]').tap()
    check('Salesman: Change appointment opens the booking form', await page.getByText('Change appointment').first().isVisible({ timeout: 10000 }).catch(() => false))
    // Today's visit: the big card at the top opens it too.
    const todayVisit = await owner('POST', '/api/appointments', { crmContactId: C.id, type: 'estimate', startAt: new Date(Date.now() + 2 * 3_600_000).toISOString(), address: ADDR, assignedToUserId: sales.id, notes: 'today visit' })
    made.appts.push(todayVisit.json.data?.id)
    if (ymd(new Date(Date.now() + 2 * 3_600_000)) === today) {
      await go(page, '/today')
      await page.locator('[data-next-open]').tap().catch(() => {})
      check('Salesman: tapping the big next visit card opens the visit', await page.locator('[data-visit-window]').isVisible({ timeout: 8000 }).catch(() => false))
    }
    await go(page, `/pipeline?card=${C.cardId}`)
    const card = page.locator(`[data-card-window="${C.cardId}"]`)
    await card.waitFor({ timeout: 30000 }).catch(() => {})
    const notes = await card.locator('[data-card-record-notes]').innerText().catch(() => '')
    check('Salesman: the card window shows the Add lead notes (not "No notes yet")', notes.includes(LEAD_NOTES) && !(await card.locator('[data-card-notes]').innerText().catch(() => '')).includes('No notes yet'), notes)
    await ctx.close()
  }

  // ── Office (computer) ──
  {
    const { ctx, page } = await signedIn(office, false)
    await go(page, '/customers')
    const badge = await until(async () => page.locator('[data-messages-badge]').getAttribute('data-messages-badge'), 15000)
    check('office: the Customer messages bubble has a badge for a message read elsewhere but not answered', Number(badge) >= 1, String(badge))
    await page.locator('button[aria-label="Customer messages"]').click()
    const th = page.locator(`[data-messages-thread="${B.id}"]`)
    check('office: the thread says "Waiting for a reply"; the summary is not "All caught up"', /Waiting for a reply/.test(await th.innerText().catch(() => '')) && !/All caught up/.test(await page.locator('[data-messages-summary]').innerText().catch(() => '')))
    await page.keyboard.press('Escape')

    await go(page, '/operations')
    const lane = page.locator('#opslane-awaiting_locates, [id="opslane-awaiting-locates"]')
    const inLane = await until(async () => (await page.locator(`[id^="opslane-awaiting"]`).innerText()).includes(D.name) || null, 15000)
    const inUnscheduled = (await page.locator('[id^="opslane-__unscheduled"], [id^="opslane-unscheduled"]').innerText().catch(() => '')).includes(D.name)
    check('office: a job in Awaiting Locates with no date is in that column, not Unscheduled', !!inLane && !inUnscheduled, String(await lane.count()))
    const styles = await page.locator('select').filter({ hasText: 'All styles' }).first().locator('option').allInnerTexts().catch(() => [])
    check('office: the styles filter shows plain names, no import codes', styles.length > 1 && !styles.some(s => /^(AG|WVSDS|wvnd|galvcl|BoB|WV-ND|TV-ND|CL)$|^(WV-ND|TV-ND)/.test(s)), styles.join(', '))

    const num = A.quoteId.slice(-6).toUpperCase()
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k')
    const box = page.locator('[data-global-search] input').first()
    if (!(await box.isVisible().catch(() => false))) await page.getByText('Search customers').first().click().catch(() => {})
    await box.fill(`#${num}`)
    const hit = await until(async () => (await page.locator('[data-global-search]').innerText()).includes(A.name) || null, 8000)
    check('office: Search finds the quote by the number on it', !!hit, `#${num}`)
    await page.keyboard.press('Escape')

    check('office: the sidebar names the role "Office"', (await page.locator('[data-role-label]:visible').first().innerText().catch(() => '')).trim() === 'Office')
    await ctx.close()
  }
  {
    // The owner's Team invite form.
    const ctx = await chrome.newContext({ viewport: { width: 1440, height: 900 } })
    const r = await ctx.request.post(`${API}/api/crm-auth/move-over`, { headers: { 'X-Staff-Request': '1', Authorization: `Bearer ${OWNER}`, 'Content-Type': 'application/json' }, data: {} })
    const page = await ctx.newPage()
    page.on('pageerror', e => errors.push(`owner: ${String(e).slice(0, 200)}`))
    await go(page, '/team')
    await page.getByRole('button', { name: /Invite Team Member/ }).first().click().catch(() => {})
    const form = await page.locator('body').innerText()
    check('owner: the invite says the office and the Salesman see costs; the Installer sees no prices', r.ok() && /Office[\s\S]*Sees costs and margins/.test(form) && /Installer[\s\S]*Sees no prices and no costs/.test(form) && !/Prices only/.test(form))
    await ctx.close()
  }
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
} catch (e) {
  check('ran to the end', false, String(e).slice(0, 400))
} finally {
  const ids = made.jobs.filter(Boolean)
  try {
    if (made.messages.length) sql(`DELETE FROM "PortalMessage" WHERE id IN (${made.messages.map(lit).join(',')})`)
    if (made.tickets.length) sql(`DELETE FROM "ServiceTicket" WHERE id IN (${made.tickets.map(lit).join(',')})`)
    if (ids.length) {
      const inJobs = ids.map(lit).join(',')
      sql(`DELETE FROM "MediaItem" WHERE "jobId" IN (${inJobs})`)
      for (const t of ['ContractPayment', 'ContractInvoice', 'BillingLog', 'PaymentSchedule', 'Walkthrough', 'InstallPacket', 'Permit']) sql(`DELETE FROM "${t}" WHERE "jobId" IN (${inJobs})`)
      sql(`DELETE FROM "ActivityLog" WHERE "entityId" IN (${inJobs})`)
      sql(`DELETE FROM "Notification" WHERE "jobId" IN (${inJobs})`)
    }
    if (made.appts.filter(Boolean).length) sql(`DELETE FROM "CrmAppointment" WHERE id IN (${made.appts.filter(Boolean).map(lit).join(',')})`)
  } catch (e) { console.error('cleanup (sql):', String(e).slice(0, 200)) }
  for (const g of made.grids.filter(Boolean)) await owner('DELETE', `/api/schedule/jobs/${g}`).catch(() => {})
  for (const id of ids) await owner('DELETE', `/api/saved-jobs/${id}`).catch(() => {})
  for (const id of made.quotes.filter(Boolean)) await owner('DELETE', `/api/saved-quotes/${id}`).catch(() => {})
  try { for (const c of made.contacts) { const cards = sql(`SELECT l->>'id' FROM "PipelineState" s, jsonb_array_elements(s.leads) l WHERE l->>'customerId' = ${lit(c)}`).split('\n').filter(Boolean); for (const id of cards) await owner('DELETE', `/api/pipeline/cards/${encodeURIComponent(id)}`).catch(() => {}) } } catch (e) { console.error('cleanup (cards):', String(e).slice(0, 200)) }
  for (const id of made.contacts.filter(Boolean)) await owner('DELETE', `/api/crm-contacts/${id}`).catch(() => {})
  const users = (await owner('GET', '/api/crm-auth/users')).json.data ?? []
  for (const u of users.filter(x => made.users.includes(x.email))) await owner('DELETE', `/api/crm-auth/users/${u.id}`).catch(() => {})
  await chrome.close(); await safari.close()
}
const failed = results.filter(r => !r).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
