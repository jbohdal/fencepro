// No Twilio (Jonathan, Nov 6 2026), end to end on the dev copy on a phone sized WebKit (iPhone):
//   - a website lead (the real /p/quote/api/submit): its Assign screen (where the new lead push opens) and its card
//     show "Text <name> thanks" with the text written in the sms: link; a tap takes it off both; the owner's Today
//     lists follow ups 1, 2 and 3 with "Send the text"; assigned to Christa, they are on her Today, not the owner's;
//   - a sub's waiting text: "Text <sub> now" on the job and on the Subs dashboard with the words ready; a tap takes
//     it off; "Not needed" too.
// Run `pnpm -s build` first, with the dev server on 4001 started after the change.
//
//   APP_URL=http://localhost:4001 E2E_STAFF_COOKIE=<owner cookie> SALES_COOKIE=<Christa's cookie> [SHOTS=<folder>] node e2e/lead-and-sub-texts.mjs
//
// Removes everything it made (hard deletes on ezbiz_dev only, by id).
import './devOnly.mjs'
import { webkit } from 'playwright'
import { execFileSync } from 'child_process'
import crypto from 'crypto'
import fs from 'fs'
import { signInByCookie } from './lib.mjs'
import { devSignIn, DEV_OWNER_EMAIL, DEV_SALES_EMAIL } from './devSignIn.mjs'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || APP
const OWNER = process.env.E2E_STAFF_COOKIE || devSignIn(DEV_OWNER_EMAIL, { cookie: true })
const SALES = process.env.SALES_COOKIE || devSignIn(DEV_SALES_EMAIL, { cookie: true })
const SHOTS = process.env.SHOTS || ''
if (!OWNER || !SALES) { console.error('No owner or Salesman sign in.'); process.exit(2) }
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const sql = q => execFileSync('psql', ['-d', 'ezbiz_dev', '-At', '-F', '|', '-c', q]).toString().trim()
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
const run = Date.now().toString(36)
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }).catch(() => {}) }
const made = { contacts: [], quotes: [], subs: [], subJobs: [] }
const name = `Leadtext e2e ${run}`

async function phone(browser, cookie) {
  const ctx = await browser.newContext(PHONE)
  await signInByCookie(ctx, { cookie, api: API })
  const errors = []
  let page
  // A fresh tab per screen (WebKit dropped a reused tab now and then).
  const go = async url => {
    if (page) await page.close().catch(() => {})
    page = await ctx.newPage()
    page.on('pageerror', e => errors.push(String(e).slice(0, 300)))
    page.on('dialog', d => d.accept().catch(() => {}))
    // A tap on an sms: link opens Messages on a phone; here it stays on the page (the app's own click still runs).
    await page.addInitScript(() => document.addEventListener('click', e => { const a = e.target?.closest?.('a[href^="sms:"]'); if (a) { window.__sms = a.getAttribute('href'); e.preventDefault() } }, true))
    await page.goto(url); await sleep(3500)
    return page
  }
  return { ctx, go, errors, get page() { return page } }
}

const browser = await webkit.launch()
try {
  // ── A website lead ──
  const phoneNo = `352555${String(Math.floor(Math.random() * 9000) + 1000)}`
  const at = { lat: 29.185118, lng: -82.134209 }
  const pt = (e, n) => ({ lat: at.lat + (n * 0.3048) / 110_860, lng: at.lng + (e * 0.3048) / 97_330 })
  const drawing = { v: 1, address: '110 SE Watula Ave, Ocala, FL 34471', at, runs: [{ id: 'r1', pts: [pt(-30, 15), pt(-55, 15), pt(-55, 95), pt(55, 95), pt(55, 15), pt(30, 15)], start: 'house', end: 'house', typedFt: [null, null, null, null, null], gates: [null, { type: 'walk', widthFt: 4, startFt: 11 }, null, null, null] }] }
  const sub = await fetch(`${API}/p/quote/api/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draftId: crypto.randomBytes(16).toString('hex'), name, phone: phoneNo, email: `leadtext.${run}@example.invalid`, address: drawing.address, drawing, pick: { material: 'vinyl', color: 'white', height: '6', kind: 'privacy' }, wantsVisit: false }) })
  check('a website lead comes in (the real instant quote)', sub.status === 201, String(sub.status))
  await sleep(1500)
  const [qid, cid] = sql(`select id, "crmContactId" from "SavedQuote" where "customerName" = '${name}' and "deletedAt" is null order by "createdAt" desc limit 1`).split('|')
  if (qid) made.quotes.push(qid)
  if (cid) made.contacts.push(cid)
  const tasks = () => sql(`select title || '~' || status || '~' || coalesce("assignedTo", '') from "Task" where "createdBy" like 'lead-texts:${cid}:%' order by "dueDate"`).split('\n').filter(Boolean)
  check('four tasks: the thanks and follow ups 1, 2, 3', tasks().length === 4, tasks().join(' | '))

  const owner = await phone(browser, OWNER)
  let page = await owner.go(`${APP}/assign-lead?customer=${cid}`)
  const btn = page.locator(`[data-assign-lead] [data-lead-thanks="${cid}"]`)
  const href = await btn.getAttribute('href').catch(() => '')
  const body = decodeURIComponent(String(href).replace(/^sms:[^?]*\?body=/, ''))
  check('Owner: the Assign screen (where the push opens) has "Text Leadtext thanks"', /Text Leadtext thanks/.test(await btn.textContent().catch(() => '') || ''))
  check('the text is written: company, thanks, STOP; to the lead\'s phone', href?.startsWith(`sms:${phoneNo}?body=`) && body === "Getter Done Fence: Thanks for reaching out Leadtext! We received your info and we'll confirm your estimate shortly. Reply STOP to opt out.", body)
  await shot(page, 'texts-01-assign-thanks')

  // Its card on the Sales Pipeline: the same button.
  const card = sql(`select x->>'id' from "PipelineState" p, jsonb_array_elements(p.leads::jsonb) x where x->>'customerId' = '${cid}' limit 1`)
  page = await owner.go(`${APP}/pipeline?card=${card}`)
  check('Owner: the lead\'s card has "Text Leadtext thanks"', await page.locator(`[data-card-window] [data-lead-thanks="${cid}"]`).isVisible().catch(() => false))
  await shot(page, 'texts-02-card-thanks')
  await page.locator(`[data-card-window] [data-lead-thanks="${cid}"]`).tap(); await sleep(1500)
  check('the tap opens the text (sms: link) and the button goes', String(await page.evaluate(() => window.__sms)).startsWith(`sms:${phoneNo}`) && !(await page.locator(`[data-lead-thanks="${cid}"]`).count()))
  check('its Today task is done', tasks()[0]?.includes('~completed~'), tasks()[0])
  page = await owner.go(`${APP}/assign-lead?customer=${cid}`)
  check('Owner: the Assign screen no longer shows the thanks', !(await page.locator(`[data-lead-thanks="${cid}"]`).count()))

  // The owner's Today: the follow ups with "Send the text" (follow up 1 is due tomorrow: later in the list).
  sql(`update "Task" set "dueDate" = now() - interval '1 minute' where "createdBy" = 'lead-texts:${cid}:f1'`)
  page = await owner.go(`${APP}/today`)
  // The dev copy's Today has 100 or so old test tasks ahead of it (live has about 35): "Show more" until it shows.
  const more = async p => { for (let i = 0; i < 4 && !(await p.locator(`text=Text ${name}: follow up 1 of 3`).count()); i++) { const b = p.locator('button:has-text("Show more")').first(); if (!(await b.count())) break; await b.tap(); await sleep(1500) } }
  await more(page)
  const f1 = page.locator(`text=Text ${name}: follow up 1 of 3`).first()
  check('Owner: Today lists "Text … follow up 1 of 3"', await f1.isVisible().catch(() => false))
  const row = page.locator('li, div').filter({ has: page.locator(`text=Text ${name}: follow up 1 of 3`) }).last()
  const send = row.locator('[data-task-sms]').first()
  const sendHref = decodeURIComponent(String(await send.getAttribute('href').catch(() => '')))
  check('with "Send the text": the follow up 1 words to the lead', /would you like to schedule a free estimate\?/i.test(sendHref) && sendHref.includes(phoneNo), sendHref.slice(0, 160))
  await shot(page, 'texts-03-today-follow-up')

  // Assigned to Christa: the follow ups are on her Today, not the owner's.
  const r = await owner.page.request.get(`${API}/api/lead-assign/${cid}`)
  const christa = (await r.json()).data.choices.find(c => /Christa/.test(c.name))
  await owner.page.request.post(`${API}/api/lead-assign/${cid}`, { data: { to: christa.id }, headers: { 'X-Staff-Request': '1' } })
  check('assigned to Christa: the open follow ups are hers', tasks().filter(t => /follow up/.test(t)).every(t => /Christa/.test(t)), tasks().join(' | '))
  const sales = await phone(browser, SALES)
  page = await sales.go(`${APP}/today`)
  check('Christa: her Today lists follow up 1 with "Send the text"', await page.locator(`text=Text ${name}: follow up 1 of 3`).first().isVisible().catch(() => false))
  await shot(page, 'texts-04-christa-today')
  page = await owner.go(`${APP}/today`)
  await more(page)
  check('Owner: no longer on the owner\'s Today', !(await page.locator(`text=Text ${name}: follow up 1 of 3`).count()))

  // ── A sub's waiting text (the server side is in tests/subcontractors.db.test.ts) ──
  const account = sql(`select "crmAccountId" from "CrmUser" where role = 'super_admin' and "crmAccountId" is not null order by "createdAt" limit 1`)
  const job = sql(`select j.id || '|' || j."customerName" from "SavedJob" j where j."accountId" = '${account}' and j."deletedAt" is null and j."archivedAt" is null and not exists (select 1 from "SubJob" s where s."jobId" = j.id) order by j."createdAt" desc limit 1`)
  const [jobId, jobCustomer] = job.split('|')
  const subId = crypto.randomUUID(), sjId = crypto.randomUUID(), textId = crypto.randomUUID(), text2 = crypto.randomUUID()
  sql(`insert into "Subcontractor" (id, "accountId", "businessName", phone, email, "updatedAt") values ('${subId}', '${account}', 'Textme Sub ${run}', '(352) 555-0147', 'textme.${run}@example.invalid', now())`)
  made.subs.push(subId)
  const words = `Getter Done Fence: The install at 1 Test Rd moved from 11/16/2026 to 11/17/2026. Open the job: http://localhost:4001/p/sub/x`
  const events = JSON.stringify([
    { at: new Date(Date.now() - 60_000).toISOString(), what: 'Text waiting: Install moved to 11/17/2026', how: 'text waiting', to: '(352) 555-0147', textId, text: words },
    { at: new Date().toISOString(), what: 'Text waiting: 811 ticket is in', how: 'text waiting', to: '(352) 555-0147', textId: text2, text: 'Getter Done Fence: The 811 locate ticket is in.' },
  ]).replace(/'/g, "''")
  sql(`insert into "SubJob" (id, "accountId", "jobId", "subId", "linkNonce", "tokenHash", events, "updatedAt") values ('${sjId}', '${account}', '${jobId}', '${subId}', 'e2e-${run}', 'e2e-${run}', '${events}'::jsonb, now())`)
  made.subJobs.push(sjId)
  page = await owner.go(`${APP}/operations?job=${jobId}`)
  const jobBtn = page.locator(`[data-sub-text-send="${textId}"]`)
  await jobBtn.scrollIntoViewIfNeeded().catch(() => {})
  check(`Owner: the job (${jobCustomer}) shows "Text Textme Sub now" with the words ready`, /Text Textme Sub .* now/.test(await jobBtn.textContent().catch(() => '') || '') && decodeURIComponent(String(await jobBtn.getAttribute('href'))).includes('moved from 11/16/2026 to 11/17/2026'))
  await shot(page, 'texts-05-job-sub-text')
  await jobBtn.tap(); await sleep(1500)
  check('the tap opens the text to the sub and takes it off the job', String(await page.evaluate(() => window.__sms)).startsWith('sms:3525550147') && !(await page.locator(`[data-sub-text="${textId}"]`).count()))
  page = await owner.go(`${APP}/subcontractors`)
  check('Owner: the Subs dashboard shows the other one waiting', await page.locator(`[data-sub-text-send="${text2}"]`).isVisible().catch(() => false) && !(await page.locator(`[data-sub-text="${textId}"]`).count()))
  await shot(page, 'texts-06-dashboard-sub-text')
  await page.locator(`[data-sub-text-dismiss="${text2}"]`).tap(); await sleep(1500)
  page = await owner.go(`${APP}/subcontractors`)
  check('"Not needed": it stays off after a reload', !(await page.locator(`[data-sub-text="${text2}"]`).count()))
  const ev = JSON.parse(sql(`select events::text from "SubJob" where id = '${sjId}'`))
  check('the job\'s sub record says texted and dismissed, by whom', !!ev[0].textedAt && !!ev[1].dismissedAt && !!ev[0].by, JSON.stringify(ev.map(e => [e.textedAt ? 'texted' : '', e.dismissedAt ? 'dismissed' : '', e.by])))

  check('no page errors', owner.errors.length === 0 && sales.errors.length === 0, [...owner.errors, ...sales.errors].join(' | '))
  await owner.ctx.close(); await sales.ctx.close()
} finally {
  await browser.close()
  for (const id of made.subJobs) sql(`delete from "SubJob" where id = '${id}'`)
  for (const id of made.subs) sql(`delete from "Subcontractor" where id = '${id}'`)
  for (const id of made.quotes) {
    for (const t of ['QuoteOption', 'ProposalView', 'SavedJob']) sql(`delete from "${t}" where "quoteId" = '${id}'`)
    sql(`delete from "CrmAuditLog" where "entityId" = '${id}'`)
    sql(`delete from "SavedQuote" where id = '${id}'`)
  }
  for (const c of made.contacts) {
    if (!/^Leadtext/.test(sql(`select "firstName" || ' ' || "lastName" from "CrmContact" where id = '${c}'`))) continue
    sql(`delete from "Task" where "createdBy" like 'lead-texts:${c}:%'`)
    sql(`update "PipelineState" set leads = (select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements(leads::jsonb) x where coalesce(x->>'customerId', '') <> '${c}')`)
    for (const t of ['IntakeLead', 'CrmTextConsent', 'CustomerProperty', 'PendingTouch', 'CrmContactNote', 'CrmAppointment']) { try { sql(`delete from "${t}" where "crmContactId" = '${c}'`) } catch (e) { console.log(`      cleanup ${t}: ${String(e.stderr || e).slice(0, 120)}`) } }
    try { sql(`delete from "Notification" where title like '%${name}%'`) } catch { /* none */ }
    try { sql(`delete from "CrmContact" where id = '${c}'`) } catch (e) { console.log(`      cleanup customer ${c}: ${String(e.stderr || e).slice(0, 160)}`) }
  }
  console.log(`removed ${made.quotes.length} quotes, ${made.contacts.length} customers, ${made.subs.length} subs`)
}
const failed = results.filter(r => !r).length
console.log(`\n${results.length - failed} of ${results.length} passed`)
process.exit(failed ? 1 : 0)
