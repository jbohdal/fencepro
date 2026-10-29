// Archive, unarchive, delete and restore a customer, on a phone and a desktop.
//
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 E2E_ACCESS_TOKEN=<dev owner token> node e2e/delete-archive.mjs
//   SHOTS=<folder>   saves dev-archive-customer.png, dev-deleted-records.png,
//                    dev-deleted-records-phone.png, dev-restore-customer.png
//
// On a 360 px phone (WebKit, touch) and a 1440 px desktop (Chromium), signed in
// as the owner, with a test customer that has a pipeline card and a job:
//   - Archive from the customer's page (More): the page says Archived with
//     Unarchive; the pipeline and the operations board no longer have the
//     card or the job; the archived lists (search, reports) do; no Deleted
//     Records row;
//   - Unarchive on the page: all of it is back;
//   - Delete (owner, typing the name): gone from the list and both boards;
//   - Settings > Deleted Records: the row is there, with what went with it,
//     and fits the phone (no sideways scroll);
//   - Restore: the customer, card and job are back.
// Then a salesman (invited for the test) has no Delete and the server refuses
// one from him, while he may archive.
// Dev copy only (port 4001).
import './devOnly.mjs'
import './sharedLock.mjs'
import { webkit, chromium } from 'playwright'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import { execFileSync } from 'child_process'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || 'http://localhost:4001'
const OWNER = process.env.E2E_ACCESS_TOKEN || ''
const SHOTS = process.env.SHOTS || ''
const local = u => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(u)
if (!local(APP) || !local(API) || /:4000(\/|$)/.test(APP) || /:4000(\/|$)/.test(API)) { console.error('Refusing to run: the dev copy only (localhost, not port 4000).'); process.exit(2) }
if (!OWNER) { console.error('Set E2E_ACCESS_TOKEN (an owner login on the dev server).'); process.exit(2) }
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const call = async (token, method, p, body) => {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(`${API}${p}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
      // The API allows 600 requests a minute from one address: wait it out rather than fail.
      if (r.status === 429 && i < 20) { await sleep(5000); continue }
      return { status: r.status, json: await r.json().catch(() => ({})) }
    } catch { if (i >= 30) return { status: 0, json: {} }; await sleep(2000) }
  }
}
const owner = (m, p, b) => call(OWNER, m, p, b)
const psql = sql => execFileSync('psql', ['-d', 'ezbiz_dev', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' }).trim()
const q = s => `'${String(s).replace(/'/g, '')}'`

const state = async (c) => {
  const [list, archived, board, jobs, archivedJobs, logs] = await Promise.all([
    owner('GET', '/api/crm-contacts'), owner('GET', '/api/crm-contacts?archived=1'), owner('GET', '/api/pipeline'),
    owner('GET', '/api/saved-jobs'), owner('GET', '/api/saved-jobs?archived=1'), owner('GET', '/api/deleted-records?type=customer'),
  ])
  return {
    listed: (list.json.data ?? []).some(x => x.id === c.id),
    archived: (archived.json.data ?? []).some(x => x.id === c.id),
    card: (board.json.data?.leads ?? []).some(l => l.id === c.cardId),
    archivedCard: (board.json.data?.archivedLeads ?? []).some(l => l.id === c.cardId),
    job: (jobs.json.data ?? []).some(j => j.id === c.jobId),
    archivedJob: (archivedJobs.json.data ?? []).some(j => j.id === c.jobId),
    logs: (logs.json.data ?? []).filter(r => r.entityId === c.id),
  }
}
const until = async (c, test, tries = 16) => { let s; for (let i = 0; i < tries; i++) { s = await state(c); if (test(s)) return s; await sleep(1000) } return s }

const made = []
async function makeCustomer(label, salesRep) {
  const stamp = Date.now().toString(36).slice(-5)
  const first = 'E2E', last = `${label} ${stamp}`
  const r = await owner('POST', '/api/crm-contacts', { firstName: first, lastName: last, phone: `352555${String(crypto.randomInt(10000)).padStart(4, '0')}`, serviceAddress: '1 Test Way, Ocala, FL 34470', ...(salesRep ? { salesRep } : {}) })
  const id = r.json.data?.contact?.id ?? r.json.data?.id
  if (!id) return null
  made.push(id)
  const job = await owner('POST', '/api/saved-jobs', { crmContactId: id, customerName: `${first} ${last}`, fenceStyle: 'WV 6ft Privacy', contractValue: 4321 })
  const cardId = `e2e-card-${stamp}-${crypto.randomInt(1e6)}`
  for (let i = 0; i < 5; i++) {
    const v = (await owner('GET', '/api/pipeline')).json.data?.version
    const p = await owner('PATCH', '/api/pipeline', { upsert: [{ lead: { id: cardId, customerId: id, firstName: first, lastName: last, phone: '', email: '', address: '', stage: 'First Contact', createdAt: new Date().toISOString(), lastMoved: new Date().toISOString() } }], remove: [], baseVersion: v })
    if (p.status === 200) break
    await sleep(300)
  }
  return { id, name: `${first} ${last}`, cardId, jobId: job.json.data?.id }
}

async function run(engine, width, height) {
  const tag = `${engine} ${width}`
  const phone = width < 640
  const c = await makeCustomer(phone ? 'Archive Phone' : 'Archive Desk')
  if (!c || !c.jobId) { check(`${tag}: test customer with a card and a job made`, false); return }
  const s0 = await until(c, s => s.listed && s.card && s.job)
  check(`${tag}: the customer, card and job are on the list and both boards`, s0.listed && s0.card && s0.job)

  const browser = await (engine === 'webkit' ? webkit : chromium).launch()
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: phone ? 3 : 1, hasTouch: phone })
  await ctx.addInitScript(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, OWNER)
  const errors = []
  const open = async () => {
    const p = await ctx.newPage()
    p.on('pageerror', e => errors.push(String(e).slice(0, 200)))
    p.on('dialog', d => d.accept().catch(() => {}))
    return p
  }
  let page = await open()
  const tap = async loc => { await loc.scrollIntoViewIfNeeded().catch(() => {}); await (phone && engine === 'webkit' ? loc.tap() : loc.click()); await sleep(400) }
  const noSideScroll = async () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
  try {
    // ── Archive from the record ──
    await page.goto(`${APP}/customers/${c.id}`)
    await page.waitForSelector('[data-customer-tab]', { timeout: 60000 }); await sleep(800)
    await tap(page.locator('[data-popup-trigger="customer-more"]'))
    await tap(page.locator('[data-customer-archive="on"]'))
    await page.waitForSelector('[data-customer-archived]', { timeout: 10000 }).catch(() => {})
    check(`${tag}: the page says Archived, with Unarchive`, await page.locator('[data-customer-unarchive]').isVisible().catch(() => false))
    const s1 = await until(c, s => !s.listed && s.archived && !s.card && !s.job)
    check(`${tag}: archived: off the list, the pipeline and the operations board`, !s1.listed && !s1.card && !s1.job)
    check(`${tag}: archived: still on the archived lists (search and reports)`, s1.archived && s1.archivedCard && s1.archivedJob)
    check(`${tag}: archive writes no Deleted Records row`, s1.logs.length === 0)
    if (SHOTS && phone) await page.screenshot({ path: path.join(SHOTS, 'dev-archive-customer.png') })

    // ── Unarchive on the record ──
    await tap(page.locator('[data-customer-unarchive]'))
    const s2 = await until(c, s => s.listed && s.card && s.job)
    check(`${tag}: unarchived: back on the list and both boards`, s2.listed && s2.card && s2.job && !s2.archived)
    await page.waitForSelector('[data-customer-archived]', { state: 'detached', timeout: 10000 }).catch(() => {})
    check(`${tag}: the Archived note is gone from the page`, (await page.locator('[data-customer-archived]').count()) === 0)

    // ── Delete (owner, typing the name) ──
    await tap(page.locator('[data-popup-trigger="customer-more"]'))
    await tap(page.locator('[data-customer-delete]'))
    await page.waitForSelector('[data-confirm-typing]', { timeout: 5000 })
    check(`${tag}: delete asks for the name to be typed`, await page.locator('[data-confirm-delete]').isDisabled())
    await page.locator('[data-confirm-input]').fill(c.name)
    await tap(page.locator('[data-confirm-delete]'))
    const s3 = await until(c, s => !s.listed && !s.card && !s.job && s.logs.length === 1)
    check(`${tag}: deleted: off the list and both boards`, !s3.listed && !s3.archived && !s3.card && !s3.job)
    check(`${tag}: one Deleted Records row, with the card and the job in it`, s3.logs.length === 1 && s3.logs[0].counts?.savedJob === 1 && s3.logs[0].counts?.['pipeline.leads'] === 1, JSON.stringify(s3.logs[0]?.counts))

    // ── Settings > Deleted Records ──
    // A fresh tab, as when it is opened from the menu later (WebKit at 3x ran out of memory carrying the whole customer list over).
    await page.close()
    page = await open()
    await page.goto(`${APP}/settings?tab=deleted`)
    const row = page.locator(`[data-deleted-row="${c.id}"]`)
    await row.waitFor({ timeout: 20000 })
    check(`${tag}: Deleted Records lists the customer`, (await row.innerText()).includes(c.name))
    check(`${tag}: and says what went with it`, /With it: .*1 job.*1 card|With it: .*1 card.*1 job/.test(await row.innerText()), (await row.innerText()).replace(/\s+/g, ' ').slice(0, 160))
    check(`${tag}: newest first`, (await page.locator('[data-deleted-row]').first().getAttribute('data-deleted-row')) === c.id)
    check(`${tag}: Deleted Records fits the screen (no sideways scroll)`, await noSideScroll())
    await page.locator('[data-deleted-filter]').selectOption('job')
    await sleep(1200)
    check(`${tag}: filter by type hides the customer row`, (await page.locator(`[data-deleted-row="${c.id}"]`).count()) === 0)
    await page.locator('[data-deleted-filter]').selectOption('customer')
    await row.waitFor({ timeout: 20000 })
    if (SHOTS) {
      await page.locator('[data-deleted-records]').evaluate(el => el.scrollIntoView({ block: 'start' }))
      await sleep(400)
      await page.screenshot({ path: path.join(SHOTS, phone ? 'dev-deleted-records-phone.png' : 'dev-deleted-records.png') })
    }

    // ── Restore ──
    await tap(page.locator(`[data-deleted-restore="${c.id}"]`))
    const s4 = await until(c, s => s.listed && s.card && s.job)
    check(`${tag}: restored: the customer, card and job are back`, s4.listed && s4.card && s4.job)
    // The list reads itself again after Restore; if that read met the API's rate limit (this test polls hard), a reload shows it.
    if (!(await page.locator(`[data-deleted-row="${c.id}"] [data-deleted-restored]`).waitFor({ timeout: 10000 }).then(() => true).catch(() => false))) {
      await page.reload(); await page.locator(`[data-deleted-row="${c.id}"] [data-deleted-restored]`).waitFor({ timeout: 20000 }).catch(() => {})
    }
    check(`${tag}: the row says Restored and has no Restore button`, (await page.locator(`[data-deleted-row="${c.id}"] [data-deleted-restored]`).count()) === 1 && (await page.locator(`[data-deleted-restore="${c.id}"]`).count()) === 0)
    if (SHOTS && !phone) await page.screenshot({ path: path.join(SHOTS, 'dev-restore-customer.png') })
    check(`${tag}: no page errors`, errors.length === 0, errors.slice(0, 3).join(' | '))
  } catch (e) {
    check(`${tag}: ran to the end`, false, String(e).split('\n').slice(0, 3).join(' '))
  } finally {
    await browser.close()
  }
}

/** A salesman invited for the test: no Delete on the customer's page, and the server refuses one. */
let salesId = null
async function salesman() {
  const stamp = Date.now().toString(36)
  const email = `e2e-sales-${stamp}@example.test`
  const inv = await owner('POST', '/api/crm-auth/invite', { firstName: 'E2E', lastName: 'Salesman', email, role: 'sales_rep' })
  salesId = inv.json.data?.id ?? null
  const token = new URL(inv.json.data?.inviteUrl ?? 'http://x/').searchParams.get('token')
  const acc = await fetch(`${API}/api/crm-auth/accept-invite`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, email, password: `E2e-${crypto.randomUUID()}` }) }).then(r => r.json()).catch(() => ({}))
  const sales = acc?.data?.accessToken
  if (!sales) { check('salesman: invited and signed in', false, JSON.stringify(acc).slice(0, 120)); return }
  // The Salesman's own customer (Sales rep: the Salesman): one not the Salesman's is not even found (lib/salesScope.ts, Oct 28 2026).
  const c = await makeCustomer('Sales Cannot', `E2E Salesman`)
  const other = await makeCustomer('Not His')
  const salesList = (await call(sales, 'GET', '/api/crm-contacts')).json?.data ?? []
  check('salesman: a customer not the Salesman\'s is not on the list and not found to delete (404)', (await call(sales, 'DELETE', `/api/crm-contacts/${other.id}`)).status === 404 && Array.isArray(salesList) && !salesList.some(x => x.id === other.id) && salesList.some(x => x.id === c.id))
  const del = await call(sales, 'DELETE', `/api/crm-contacts/${c.id}`)
  check('salesman: the server refuses to delete a customer', del.status === 403, String(del.status))
  check('salesman: ...or a card', (await call(sales, 'DELETE', `/api/pipeline/cards/${c.cardId}`)).status === 403)
  check('salesman: ...and cannot read Deleted Records', (await call(sales, 'GET', '/api/deleted-records')).status === 403)
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addInitScript(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, sales)
  const page = await ctx.newPage()
  try {
    await page.goto(`${APP}/customers/${c.id}`)
    await page.waitForSelector('[data-customer-tab]', { timeout: 60000 }); await sleep(800)
    await page.locator('[data-popup-trigger="customer-more"]').click()
    await sleep(300)
    check('salesman: More has Archive but no Delete', (await page.locator('[data-customer-archive]').count()) === 1 && (await page.locator('[data-customer-delete]').count()) === 0)
    await page.goto(`${APP}/settings?tab=deleted`)
    await sleep(2500)
    check('salesman: no Deleted Records in Settings', (await page.locator('[data-deleted-records]').count()) === 0)
  } catch (e) {
    check('salesman: ran to the end', false, String(e).split('\n')[0])
  } finally { await browser.close() }
  const arch = await call(sales, 'POST', `/api/crm-contacts/${c.id}/archive`)
  check('salesman: may archive a customer', arch.status === 200, String(arch.status))
}

try {
  await run('webkit', 360, 780)
  await run('chromium', 1440, 900)
  await salesman()
} finally {
  // Remove what the test made (dev database, by name), Deleted Records rows of these test records included.
  try {
    if (made.length) {
      const list = made.map(q).join(',')
      const jobs = `select id from "SavedJob" where "crmContactId" in (${list})`
      psql(`begin;
        delete from "DeletionLog" where "entityId" in (${list}) or "entityId" in (${jobs});
        delete from "ScheduledGridJob" where "stagingJobId" in (${jobs});
        delete from "CrmAppointment" where "crmContactId" in (${list});
        delete from "SavedJob" where "crmContactId" in (${list});
        delete from "SavedQuote" where "crmContactId" in (${list});
        delete from "IntakeLead" where "crmContactId" in (${list});
        delete from "CrmContactNote" where "crmContactId" in (${list});
        delete from "PendingTouch" where "crmContactId" in (${list});
        delete from "CallLog" where "crmContactId" in (${list});
        delete from "CardFollowUp" where "cardId" like 'e2e-card-%';
        update "PipelineState" set leads = coalesce((select jsonb_agg(l) from jsonb_array_elements(leads::jsonb) l where l->>'customerId' not in (${list})), '[]'::jsonb), "archivedLeads" = coalesce((select jsonb_agg(l) from jsonb_array_elements("archivedLeads"::jsonb) l where l->>'customerId' not in (${list})), '[]'::jsonb), version = version + 1;
        delete from "CrmContact" where id in (${list});
        commit;`)
    }
    if (salesId) psql(`begin; delete from "CrmUserSession" where "userId" = ${q(salesId)}; delete from "CrmUserActivity" where "userId" = ${q(salesId)}; delete from "PushSubscription" where "userId" = ${q(salesId)}; delete from "CrmUser" where id = ${q(salesId)}; commit;`)
    check('clean up: the test customers are gone from the database', psql(`select count(*) from "CrmContact" where id in (${made.map(q).join(',') || "''"})`) === '0')
  } catch (e) { check('clean up', false, String(e).split('\n')[0]) }
  const passed = results.filter(Boolean).length
  console.log(`\n${passed} of ${results.length} checks passed`)
  process.exit(passed === results.length ? 0 : 1)
}
