// Round 2b (Oct 26, 2026): the reviewer's job flow findings, each as the person who meets them, on the dev copy.
//
//   cd apps/web && pnpm -s build
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 E2E_ACCESS_TOKEN=<dev owner token> node e2e/round2b.mjs
//
//   Installer (iPhone-size Safari engine): Start and "Finish the job" on a one day job (walkthrough signed, final
//     payment not in): the card says "Job finished. Waiting for the final payment."; after the office takes it,
//     "Job finished and closed out."; his job page's notes have no price sentence ("saw an estimate of", "quoted");
//     opening his jobs and making a packet asks no change orders (no 403).
//   Office (computer): the job window open, the final payment taken from it: the window shows Paid at once, with
//     no Advance, Hold or Move install; a save from the window's old copy that moves the stage is refused (409);
//     install times read "Finished the job" (one day job) and "Finished day 1 of 2"; the footer names the crew's
//     finish; Schedule: Ready to schedule and Schedule install say the repair's work, the crew warning names a job
//     dated the old way (install dates, no entries), the month card of a repair says its work, a Paid job's
//     install opens without Move install; going back from Paid asks Reopen first.
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
async function until(fn, ms = 20000, every = 500) { const end = Date.now() + ms; for (;;) { const v = await fn().catch(() => null); if (v || Date.now() > end) return v; await sleep(every) } }
const stamp = Date.now().toString(36).slice(-6)
const ymd = d => d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
const today = ymd(new Date())
const plus = (d, n) => { const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10) }
const dow = d => new Date(`${d}T12:00:00Z`).getUTCDay()
const nextCrewDay = d => { let x = plus(d, 1); while (![1, 2, 3, 4].includes(dow(x))) x = plus(x, 1); return x }
const day2 = nextCrewDay(today)
// A crew day a week or more ahead, for the job dated the old way.
let dX = plus(today, 7); while (![1, 2, 3, 4].includes(dow(dX))) dX = plus(dX, 1)
const ADDR = '110 SE Watula Ave, Ocala, FL 34471'
const WEB_NOTE = 'Website, drawn by customer. The customer drew the fence on the aerial photo of the property and saw an estimate of $4,321 (Better). Confirm every measurement on site.\nCustomer was quoted $5,200.\nGate code 4411.'
const REPAIR = { version: 1, type: 'repair', repair: { what: 'gate', items: { rehangGate: 1 }, gateKind: 'walk', postType: 'nd', newPostCaps: false }, crew: ['Rehang the walk gate with new hardware'], description: 'Rehang a gate', needs811: false, warnings: [], priced: {} }
const made = { users: [], contacts: [], cards: [], quotes: [], jobs: [], grids: [] }

async function invite(role, last) {
  const email = `e2e-r2b-${role}-${stamp}@example.test`
  const inv = await owner('POST', '/api/crm-auth/invite', { firstName: 'E2E', lastName: last, email, role })
  const link = new URL(inv.json.data.inviteUrl)
  made.users.push(email)
  const password = `Rr-${crypto.randomBytes(9).toString('base64url')}`
  const acc = await call('', 'POST', '/api/crm-auth/accept-invite', { token: link.searchParams.get('token'), email, password })
  return { email, password, token: acc.json.data?.accessToken, name: `E2E ${last}` }
}

/** A customer, a Sold and signed quote and its job; booked on `days` for Crew 1 (none: not booked). `oldWay`: install dates, no entries. */
async function soldJob(label, days, extra = {}) {
  const last = `R2b ${label} ${stamp}`
  const contact = await owner('POST', '/api/crm-contacts', { firstName: 'E2E', lastName: last, phone: `352555${String(Math.floor(Math.random() * 9000) + 1000)}`, serviceAddress: ADDR })
  const contactId = contact.json.data?.id
  made.contacts.push(contactId)
  const name = `E2E ${last}`
  const quote = await owner('POST', '/api/saved-quotes', {
    crmContactId: contactId, customerName: name, customerPhone: contact.json.data?.phone ?? '', customerAddress: ADDR,
    fenceStyle: "WV-ND 6'x8' Privacy", runs: [120], corners: 0, ends: 2, sections: 15, finalPrice: 5000, status: 'SOLD', notes: extra.notes ?? '',
    proposal: { version: 1, options: [{ label: 'White vinyl', fenceStyle: "WV-ND 6'x8' Privacy", finalPrice: 5000, perFoot: 41.67, sections: 15 }] },
    ...(extra.quote ?? {}),
  })
  const quoteId = quote.json.data?.id
  made.quotes.push(quoteId)
  sql(`UPDATE "SavedQuote" SET "acceptedAt" = now(), "soldAt" = coalesce("soldAt", now()) WHERE id = ${lit(quoteId)}`)
  const booked = days.length > 0
  const job = await owner('POST', '/api/saved-jobs', { customerName: name, crmContactId: contactId, quoteId, customerAddress: ADDR, fenceStyle: "WV-ND 6'x8' Privacy", sections: extra.sections ?? 15, totalFeet: 120, quotePrice: 5000, contractValue: 5000, notes: extra.notes ?? '',
    status: booked ? 'scheduled' : 'staging', scheduledDate: booked ? days[0] : '', scheduledEndDate: booked ? days[days.length - 1] : null, crewAssigned: booked ? 'crew1' : '', estimatedDays: Math.max(1, days.length) })
  const jobId = job.json.data?.id
  made.jobs.push(jobId)
  if (!extra.oldWay) for (const d of days) { const g = await owner('POST', '/api/schedule/jobs', { stagingJobId: jobId, clientName: name, crewId: 'crew1', date: d, sections: 15, status: 'Scheduled' }); made.grids.push(g.json.data?.id) }
  if (!(await owner('GET', `/api/payments/job/${jobId}`)).json.data?.schedule) await owner('POST', `/api/payments/job/${jobId}/schedule`, {})
  return { contactId, quoteId, jobId, name, ok: !!contactId && !!quoteId && !!jobId }
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
  // Stage changes ask the server to run automations; the dev data holds real customers, so not here.
  await page.route('**/api/automations/trigger', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true,"data":{"matched":0}}' }))
  return { ctx, page }
}
const go = async (page, p) => { await page.goto(`${APP}${p}`, { waitUntil: 'domcontentloaded' }); await page.waitForSelector('[data-tabbar], [data-global-appointment]', { timeout: 30000 }).catch(() => {}); await sleep(2500) }
const jobRow = async id => (await owner('GET', `/api/saved-jobs/${id}`)).json.data

try {
  // ── Set up (owner, through the API) ──
  const A = await soldJob('Brooks', [today], { notes: WEB_NOTE })
  const C = await soldJob('Carter', [today, day2])
  const R = await soldJob('Linda', [], { quote: { runs: [], sections: 0, work: REPAIR }, sections: 0 })
  const R2 = await soldJob('Rehang', [today], { quote: { runs: [], sections: 2, work: REPAIR }, sections: 2 })
  const M = await soldJob('Manuel', [dX], { oldWay: true })
  const E = await soldJob('Evans', [])
  const office = await invite('office_staff', `Office ${stamp}`)
  const crew = await invite('field_crew', `Installer ${stamp}`)
  // A: the walkthrough signed; everything paid but the final.
  sql(`INSERT INTO "Walkthrough" (id, "accountId", "jobId", status, "homeownerSig", "repSig", "signedAt", "createdAt", "updatedAt") SELECT ${lit(crypto.randomUUID())}, "accountId", id, 'completed', '{"name":"Brooks"}'::jsonb, '{"name":"Jonathan","role":"Owner"}'::jsonb, now(), now(), now() FROM "SavedJob" WHERE id = ${lit(A.jobId)}`)
  const invA = (await owner('GET', `/api/payments/job/${A.jobId}`)).json.data?.schedule?.invoices ?? []
  for (const [i, inv] of invA.slice(0, -1).entries()) await owner('POST', '/api/payments', { id: `e2er2b${stamp}${i}`, jobId: A.jobId, amountCents: inv.amountCents, method: 'check', checkNumber: `70${i}` })
  check('setup: six sold jobs (one day, two day, two repairs, one dated the old way, one waiting), Office and Installer logins; A signed off, all but the final paid',
    [A, C, R, R2, M, E].every(x => x.ok) && !!office.token && !!crew.token && invA.length > 1 && (await jobRow(A.jobId))?.paymentStatus !== 'paid')

  // ── Installer (phone) ──
  const forbidden = []
  {
    const { ctx, page } = await signedIn(crew, true)
    page.on('response', r => { if (/\/api\/change-orders/.test(r.url()) && r.status() === 403) forbidden.push(r.url()) })
    // These test jobs have no 811 locate: Start warns and asks (audit Oct 26 2026); the crew goes ahead.
    const asked811 = []
    page.on('dialog', d => { if (/811/.test(d.message())) { asked811.push(d.message()); d.accept().catch(() => {}) } })
    await go(page, '/my-installs')
    const a = page.locator(`[data-installs-today] [data-install-card="${A.jobId}"]`)
    await a.locator('[data-install-start]').waitFor({ timeout: 20000 }).catch(() => {})
    check('installer: a job with no 811 locate says so on the card', /no 811 locate/i.test(await a.locator('[data-install-locate-warn]').innerText().catch(() => '')))
    await a.locator('[data-install-start]').tap()
    await until(async () => asked811.length > 0 || null, 5000)
    check('installer: Start asks before digging with no 811 locate (a warning, he can go ahead)', /Start anyway/.test(asked811[0] ?? ''), asked811[0] ?? 'not asked')
    await a.locator('[data-install-finish-job]').waitFor({ timeout: 15000 }).catch(() => {})
    await a.locator('[data-install-finish-job]').tap()
    const doneText = await until(async () => { const t = await a.locator('[data-install-job-done]').innerText(); return t ? t : null }, 15000)
    check('installer: after Finish, the card says it waits for the final payment (walkthrough already signed)', /Job finished\. Waiting for the final payment\./.test(doneText ?? ''), doneText ?? '')
    // C: day 1 of 2.
    const c = page.locator(`[data-installs-today] [data-install-card="${C.jobId}"]`)
    await c.locator('[data-install-start]').tap()
    await c.locator('[data-install-finish]').waitFor({ timeout: 15000 }).catch(() => {})
    await c.locator('[data-install-finish]').tap()
    await c.locator('[data-install-started]:has-text("finished for today")').waitFor({ timeout: 15000 }).catch(() => {})
    // A packet made from the card: no change orders asked.
    await c.locator('[data-install-packet-make]').tap().catch(() => {})
    await c.locator('[data-install-packet-open]').waitFor({ timeout: 30000 }).catch(() => {})
    // His job page (Jobs > the job): the notes have no price sentence.
    await go(page, `/operations?job=${A.jobId}`)
    await page.locator(`[data-job-panel="${A.jobId}"] textarea`).waitFor({ timeout: 20000 }).catch(() => {})
    const notes = await page.locator(`[data-job-panel="${A.jobId}"] textarea`).inputValue().catch(() => '')
    check('installer: his job page\'s notes drop the price sentences, keep the rest', !/left out|estimate|quoted|\$/.test(notes) && /Confirm every measurement on site\./.test(notes) && /Gate code 4411\./.test(notes), notes.replace(/\s+/g, ' '))
    check('installer: no 403 asking for change orders (job page, making a packet)', forbidden.length === 0, forbidden.join(' '))
    await ctx.close()
  }

  // ── Office (computer) ──
  {
    const o = await signedIn(office, false)
    const panel = o.page.locator(`[data-job-panel="${A.jobId}"]`)
    await go(o.page, `/operations?job=${A.jobId}`)
    await panel.locator('[data-ops-stage-pill]').waitFor({ timeout: 30000 }).catch(() => {})
    const before = await jobRow(A.jobId)
    check('office: the job window opens In Progress with "Advance to Punch List"', (await panel.locator('[data-ops-stage-pill]').getAttribute('data-ops-stage-pill')) === 'in_progress' && /Advance to Punch List/.test(await panel.locator('[data-ops-advance]').innerText().catch(() => '')))
    check('office: the footer names the crew\'s finish, the walkthrough and the payment', /crew finished the install.*walkthrough is signed.*paid in full/.test(await panel.locator('[data-job-closeout-hint]').innerText().catch(() => '')))
    // Install times: a one day job's Finish is "Finished the job".
    check('office: A\'s install times say "Finished the job"', /Finished the job/.test(await panel.locator('[data-job-install-times]').innerText().catch(() => '')), await panel.locator('[data-job-install-times]').innerText().catch(() => ''))
    // The final payment, taken from the window.
    const recv = panel.locator(`[data-payment-schedule="${A.jobId}"] [data-payment-received]`).first()
    await recv.scrollIntoViewIfNeeded().catch(() => {})
    await recv.click()
    const sheet = o.page.locator('[data-payment-sheet]')
    await sheet.locator('[data-payment-method="check"]').click()
    await sheet.locator('[data-payment-check-number]').fill('7799')
    await sheet.locator('[data-payment-save]').click()
    await o.page.locator('[data-receipt-done]').click({ timeout: 20000 }).catch(() => {})
    const pill = await until(async () => (await panel.locator('[data-ops-stage-pill]').getAttribute('data-ops-stage-pill')) === 'paid', 30000)
    check('office: right after the final payment the open window shows Paid', !!pill, await panel.locator('[data-ops-stage-pill]').getAttribute('data-ops-stage-pill').catch(() => ''))
    check('office: a Paid job has no Advance, no Hold, no Move install', (await panel.locator('[data-ops-advance]').count()) === 0 && (await panel.locator('[data-ops-hold]').count()) === 0 && (await panel.locator('button:has-text("Move install")').count()) === 0 && (await panel.locator('[data-ops-done]').count()) === 1)
    // A save made on the window's old copy that moves the stage: refused, nothing moved.
    const stale = await call(office.token, 'PATCH', `/api/saved-jobs/${A.jobId}`, { ...before, opsStage: 'punch_list', base: before })
    const after = await jobRow(A.jobId)
    check('server: "Advance" from the old copy is refused (409, plain words), the job stays Paid with its completed date', stale.status === 409 && stale.json.code === 'STALE_JOB' && after?.status === 'paid' && !!after?.completedDate, `${stale.status} ${stale.json.error} ${after?.status}`)
    // The installer's card now: closed out.
    {
      const ph = await signedIn(crew, true)
      await go(ph.page, '/my-installs')
      const a = ph.page.locator(`[data-installs-today] [data-install-card="${A.jobId}"] [data-install-job-done]`)
      const t = await until(async () => { const x = await a.innerText(); return /closed out/.test(x) ? x : null }, 20000)
      check('installer: after the final payment the card says "Job finished and closed out."', /Job finished and closed out\./.test(t ?? ''), t ?? await a.innerText().catch(() => 'no card'))
      await ph.ctx.close()
    }
    // C: a day's end.
    await go(o.page, `/operations?job=${C.jobId}`)
    const ct = o.page.locator(`[data-job-panel="${C.jobId}"] [data-job-install-times]`)
    await until(async () => /Finished/.test(await ct.innerText()), 20000)
    check('office: C\'s install times say "Finished day 1 of 2", not "Finished the job"', /Finished day 1 of 2/.test(await ct.innerText().catch(() => '')) && !/Finished the job/.test(await ct.innerText().catch(() => '')), (await ct.innerText().catch(() => '')).replace(/\s+/g, ' '))

    // Schedule.
    await go(o.page, '/schedule')
    const readyR = o.page.locator(`[data-ready-job="${R.jobId}"] [data-ready-scope]`)
    await readyR.waitFor({ timeout: 30000 }).catch(() => {})
    const rText = await readyR.innerText().catch(() => '')
    check('Ready to schedule: the repair says its work, not the fence and sections', /Repair: 1 × Rehang a gate/.test(rText) && !/Privacy|sections/.test(rText), rText)
    const monthR2 = o.page.locator(`[data-install-entry="${R2.jobId}"] [data-install-work]`).first()
    check('the month: the repair\'s card says its work', /Repair/.test(await monthR2.innerText().catch(() => '')), await monthR2.innerText().catch(() => ''))
    // Schedule install for E on the day of the job dated the old way, Crew 1: the warning names it.
    await o.page.locator(`[data-ready-job="${E.jobId}"]`).click()
    const dlg = o.page.locator(`[data-schedule-install="${E.jobId}"]`)
    await dlg.locator('[data-si-start]').waitFor({ timeout: 20000 })
    await dlg.locator('[data-si-start]').fill(dX)
    await dlg.locator('[data-si-crew]').selectOption('crew1')
    const warn = await until(async () => { const t = await dlg.locator('[data-si-warning="crew"]').first().innerText(); return t || null }, 10000)
    check('Schedule install: the crew warning names the job dated the old way (no entries)', new RegExp(M.name).test(warn ?? ''), warn ?? 'no crew warning')
    await dlg.locator('button:has-text("Cancel")').click()
    // The repair in Schedule install.
    await o.page.locator(`[data-ready-job="${R.jobId}"]`).click()
    const dr = o.page.locator(`[data-schedule-install="${R.jobId}"] [data-si-scope]`)
    check('Schedule install: the repair says its work', /Repair: 1 × Rehang a gate/.test(await dr.innerText({ timeout: 20000 }).catch(() => '')), await dr.innerText().catch(() => ''))
    await o.page.locator(`[data-schedule-install="${R.jobId}"] button:has-text("Cancel")`).click()
    // The Paid job's month card: opens without Move install or Take off.
    await o.page.locator(`[data-install-entry="${A.jobId}"]`).first().click()
    const closed = o.page.locator(`[data-schedule-install="${A.jobId}"]`)
    await closed.waitFor({ timeout: 15000 }).catch(() => {})
    await closed.locator('[data-si-closed]').waitFor({ timeout: 15000 }).catch(() => {})
    check('the month: a Paid job\'s install opens read only (no Move install, no Take off)', (await closed.locator('[data-si-closed]').count()) === 1 && (await closed.locator('[data-si-save]').count()) === 0 && (await closed.locator('[data-si-off]').count()) === 0)
    await closed.locator('button:has-text("Close")').last().click().catch(() => {})

    // Going back from Paid: Reopen is asked first; No leaves it Paid, Yes reopens it.
    await go(o.page, `/operations?job=${A.jobId}`)
    let asked = ''
    o.page.once('dialog', d => { asked = d.message(); d.dismiss().catch(() => {}) })
    await o.page.locator(`[data-job-panel="${A.jobId}"] [data-ops-stage-choice="punch_list"]`).click()
    await sleep(1500)
    check('office: moving the Paid job back asks Reopen first; No leaves it Paid', /^Reopen .*Paid \(closed\)/.test(asked) && (await jobRow(A.jobId))?.status === 'paid', asked)
    // No on "Reopen…?" says nothing moved: no green "Moved to" (re-check, Oct 26 2026: it said "Moved to Complete").
    const toastsAfterNo = await o.page.locator('[data-toast]').allInnerTexts().catch(() => [])
    check('office: No on Reopen shows no "Moved to" toast', !toastsAfterNo.some(t => /Moved to/.test(t)), toastsAfterNo.join(' | ') || 'no toast')
    // Yes to Reopen; this job has no drawing on file, so the move then asks about the drawing too (review Oct 28 2026): Yes.
    const yesAsked = []
    const yes = d => { yesAsked.push(d.message()); d.accept().catch(() => {}) }
    o.page.on('dialog', yes)
    await o.page.locator(`[data-job-panel="${A.jobId}"] [data-ops-stage-choice="punch_list"]`).click()
    const reopened = await until(async () => { const j = await jobRow(A.jobId); return j?.opsStage === 'punch_list' ? j : null }, 15000)
    o.page.off('dialog', yes)
    check('office: Yes reopens it (Punch List, no completed date)', !!reopened && !reopened.completedDate, `${reopened?.opsStage} ${reopened?.completedDate}`)
    check('office: Reopen is asked before the drawing question', /^Reopen /.test(yesAsked[0] ?? '') && yesAsked.slice(1).every(m => /^No drawing on file/.test(m)), yesAsked.map(m => m.split('\n')[0]).join(' | '))
    // Yes: "Moved to Punch List" once the server has it.
    const movedToast = await until(async () => { const t = await o.page.locator('[data-toast]').allInnerTexts().catch(() => []); return t.find(x => /Moved to Punch List/.test(x)) ?? null }, 15000)
    check('office: Yes says "Moved to Punch List" once saved', !!movedToast, movedToast ?? 'no toast')

    // A repair's customer texts say "fence repair", never "installation" (re-check, Oct 26 2026): scheduled, then taken off.
    const sch = await owner('POST', '/api/schedule/install', { jobId: R.jobId, start: dX, crew: 'crew1' })
    const sBody = sch.json?.data?.text?.body ?? ''
    check('repair: the "scheduled" text says "your fence repair is scheduled for <weekday>, <date>"', /: Hi \w+, your fence repair is scheduled for [A-Z][a-z]+day, \d\d\/\d\d\/\d{4}\. .*Reply STOP to opt out\.$/.test(sBody) && !/installation/.test(sBody), sBody || `${sch.status} ${sch.json?.error}`)
    const off = await owner('POST', `/api/schedule/install/${R.jobId}/off`, {})
    const oBody = off.json?.data?.text?.body ?? ''
    check('repair: the "taken off" text says "your fence repair date is being changed"', /your fence repair date is being changed/.test(oBody) && !/installation/.test(oBody), oBody || `${off.status} ${off.json?.error}`)

    // A repair's final walkthrough: its repair checklist, headed with the work (not the new fence list and the style).
    await go(o.page, `/operations?job=${R2.jobId}`)
    await o.page.locator('[data-walkthrough-start]').first().click()
    await o.page.waitForSelector('[data-walkthrough-screen="open"]', { timeout: 20000 })
    const wIds = await o.page.locator('[data-wt-item]').evaluateAll(els => els.map(e => e.getAttribute('data-wt-item')))
    check('office: a repair\'s walkthrough checklist is its repair work (gate rehung: the gate latches; area cleaned)', wIds.join(',') === 'repair_rehangGate,gates,cleanup', wIds.join(','))
    const wHead = await o.page.locator('[data-walkthrough-heading]').innerText().catch(() => '')
    check('office: the walkthrough is headed with the repair work', /Repair: 1 × Rehang a gate/.test(wHead) && !/Vinyl/.test(wHead), wHead)
    await o.page.locator('[aria-label="Close the walkthrough"]').click().catch(() => {})

    // The repair's pipeline card and its Payments: the repair work, not the fence style.
    // Its card (the API-made sale has none yet): Signed Contract, the quote's fence style on it as a real card has.
    let r2Card = sql(`SELECT l->>'id' FROM "PipelineState" s, jsonb_array_elements(s.leads) l WHERE l->>'quoteId' = ${lit(R2.quoteId)} LIMIT 1`)
    if (!r2Card) {
      r2Card = `e2e-r2b-rehang-${stamp}`
      for (let i = 0; i < 3; i++) {
        const v = (await owner('GET', '/api/pipeline')).json.data?.version
        const [first, ...rest] = R2.name.split(' ')
        const put = await owner('PATCH', '/api/pipeline', { upsert: [{ lead: { id: r2Card, firstName: first, lastName: rest.join(' '), customerId: R2.contactId, quoteId: R2.quoteId, jobId: R2.jobId, stage: 'Signed Contract', fenceType: "WV-ND 6'x8' Privacy", leadSource: 'Other', createdAt: today, lastMoved: today }, before: null }], remove: [], baseVersion: v })
        if (put.status === 200) break
      }
    }
    await go(o.page, `/pipeline?card=${encodeURIComponent(r2Card)}`)
    const payWork = await until(async () => { const t = await o.page.locator(`[data-card-window="${r2Card}"] [data-payment-schedule-work]`).first().innerText(); return t || null }, 20000)
    check('office: the repair card\'s Payments name the repair work, not the style', /Repair: 1 × Rehang a gate/.test(payWork ?? '') && !/Privacy/.test(payWork ?? ''), payWork ?? `no Payments block (card ${r2Card || 'none'}, window ${await o.page.locator('[data-card-window]').count()}, payments ${await o.page.locator('[data-card-payments]').count()}, url ${o.page.url()})`)
    await o.page.keyboard.press('Escape').catch(() => {})
    await sleep(800)
    const chip = await until(async () => { const t = await o.page.locator(`p:text-is("${R2.name}")`).first().locator("xpath=ancestor::div[contains(@class, 'group')][1]").locator("[data-card-work]").first().innerText(); return t || null }, 15000)
    check('office: the repair card on the board says its work', /Repair: 1 × Rehang a gate/.test(chip ?? '') && !/Privacy/.test(chip ?? ''), chip ?? 'card not on the board')
    await o.ctx.close()
  }

  // ── The 2 day job's crew days, as the card reads them ──
  {
    const r = await call(crew.token, 'GET', `/api/install-packets/crew/${C.jobId}`)
    check('installer: the 2 day job\'s card lists its crew days in order', JSON.stringify(r.json.data?.crewDays) === JSON.stringify([today, day2]), JSON.stringify(r.json.data?.crewDays))
  }

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
} catch (e) {
  check('ran to the end', false, String(e?.stack ?? e).slice(0, 400))
} finally {
  const ids = made.jobs.filter(Boolean)
  try {
    if (ids.length) {
      const inJobs = ids.map(lit).join(',')
      sql(`DELETE FROM "Receipt" WHERE "jobId" IN (${inJobs})`)
      sql(`DELETE FROM "PaymentApplication" WHERE "paymentId" IN (SELECT id FROM "ContractPayment" WHERE "jobId" IN (${inJobs}))`)
      for (const t of ['ContractPayment', 'ContractInvoice', 'BillingLog', 'PaymentSchedule', 'Walkthrough', 'InstallPacket']) sql(`DELETE FROM "${t}" WHERE "jobId" IN (${inJobs})`)
      sql(`DELETE FROM "ActivityLog" WHERE "entityId" IN (${inJobs})`)
      sql(`DELETE FROM "Notification" WHERE "jobId" IN (${inJobs})`)
    }
  } catch (e) { console.error('cleanup (sql):', String(e).slice(0, 200)) }
  for (const g of made.grids.filter(Boolean)) await owner('DELETE', `/api/schedule/jobs/${g}`).catch(() => {})
  for (const id of ids) await owner('DELETE', `/api/saved-jobs/${id}`).catch(() => {})
  for (const id of made.quotes.filter(Boolean)) await owner('DELETE', `/api/saved-quotes/${id}`).catch(() => {})
  // Cards the server made for these sales.
  try { for (const q of made.quotes.filter(Boolean)) { const cards = sql(`SELECT l->>'id' FROM "PipelineState" s, jsonb_array_elements(s.leads) l WHERE l->>'quoteId' = ${lit(q)}`).split('\n').filter(Boolean); for (const c of cards) await owner('DELETE', `/api/pipeline/cards/${encodeURIComponent(c)}`).catch(() => {}) } } catch (e) { console.error('cleanup (cards):', String(e).slice(0, 200)) }
  for (const id of made.contacts.filter(Boolean)) await owner('DELETE', `/api/crm-contacts/${id}`).catch(() => {})
  const users = (await owner('GET', '/api/crm-auth/users')).json.data ?? []
  for (const u of users.filter(x => made.users.includes(x.email))) await owner('DELETE', `/api/crm-auth/users/${u.id}`).catch(() => {})
  await chrome.close(); await safari.close()
}
const failed = results.filter(r => !r).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
