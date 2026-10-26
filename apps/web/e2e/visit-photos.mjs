// Visit photos reach the quote and the proposal (walkthrough round 2, item 8; Oct 26, 2026), on the dev copy,
// the way they are used:
//
// Phone (iPhone size, WebKit = the Safari engine), WT Christa (Salesman):
//   1. Today > her visit > Complete > Ready to quote, notes and 2 photos > "Save and start the quote".
//   2. The new draft's camera button counts the 2 visit photos; the Site visit box shows them.
//   3. In the quote's Photos sheet she marks one Customer (the other stays Internal).
// Computer (Chrome, 1440 x 900), the owner:
//   4. A repair quote for the same customer: its Send box is not blocked (2 of 2 photos, no "Send anyway"),
//      Copy link works; its Photos list shows the visit photos.
//   5. The customer's proposal page shows the one photo marked Customer, never the Internal one,
//      and that photo loads; the Internal one's link is refused.
//
//   cd apps/web && pnpm -s build
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 E2E_STAFF_COOKIE=<dev owner cookie> \
//   [SHOTS=<folder>] node e2e/visit-photos.mjs
//
// Dev only (devOnly.mjs refuses port 4000 and anything not on this Mac). The test customer, visit,
// quote, photos (rows and files) are removed at the end; WT records are only read.

import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import { webkit, chromium, devices } from 'playwright'
import { signInByCookie } from './lib.mjs'
import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || 'http://localhost:4001'
const COOKIE = process.env.E2E_STAFF_COOKIE || ''
const TOKEN = process.env.E2E_ACCESS_TOKEN || ''
const SHOTS = process.env.SHOTS || ''
const devLocal = u => /^http:\/\/localhost:\d+\/?$/.test(u) && !/:4000\b/.test(u)
if (!devLocal(APP) || !devLocal(API)) { console.error('Refusing to run: the dev copy only.'); process.exit(2) }
if (!COOKIE && !TOKEN) { console.error('Set E2E_STAFF_COOKIE (scripts/dev-session-token.ts --cookie) or E2E_ACCESS_TOKEN.'); process.exit(2) }

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PHOTO = path.resolve(HERE, 'fixtures/test-photo.jpg')
const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const psql = sql => execFileSync('psql', ['-d', 'ezbiz_dev', '-At', '-c', sql], { encoding: 'utf8' }).trim()
const q = s => String(s).replace(/'/g, "''")
const staffHeaders = COOKIE ? { Cookie: `ezbiz_staff=${COOKIE}`, 'X-Staff-Request': '1' } : { Authorization: `Bearer ${TOKEN}`, 'X-Staff-Request': '1' }
const api = async (p, init = {}) => (await (await fetch(API + p, { ...init, headers: { ...staffHeaders, ...(init.body ? { 'Content-Type': 'application/json' } : {}) } })).json())
const shot = async (page, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `visit-photos-${name}.png`) }) } }
const watch = page => { const errors = []; page.on('pageerror', e => errors.push(String(e).slice(0, 200))); return errors }
const CHRISTA = { email: 'wt-christa@example.invalid', password: 'WT-walk-2026!' }

const NAME_LAST = `Visit Photos ${Date.now().toString(36)}`
const NAME = `E2E ${NAME_LAST}`
const made = { contact: '', appt: '', quote: '', account: '' }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-visit-photos-'))
const shots2 = ['front-gate.jpg', 'broken-post.jpg'].map(n => { const f = path.join(tmp, n); fs.copyFileSync(PHOTO, f); return f })
const media = () => psql(`select id || '|' || visibility || '|' || coalesce("quoteKey",'') || '|' || coalesce("jobId",'') || '|' || category || '|' || caption from "MediaItem" where "customerId"='${q(made.contact)}' and "deletedAt" is null order by "createdAt"`).split('\n').filter(Boolean).map(r => { const [id, visibility, quoteKey, jobId, category, caption] = r.split('|'); return { id, visibility, quoteKey, jobId, category, caption } })

async function setup() {
  const christa = psql(`select id || '|' || "firstName" || ' ' || "lastName" || '|' || "crmAccountId" from "CrmUser" where email='${CHRISTA.email}'`).split('|')
  if (!christa[0]) throw new Error('WT Christa is not on the dev copy')
  made.account = christa[2]
  made.contact = psql(`insert into "CrmContact" (id, "accountId", "firstName", "lastName", phone, "serviceAddress", "updatedAt") values (gen_random_uuid(), '${q(made.account)}', 'E2E', '${q(NAME_LAST)}', '3525550177', '110 SE Watula Ave, Ocala, FL 34471', now()) returning id`).split('\n')[0]
  made.appt = `e2e-visit-photos-${Date.now().toString(36)}`
  psql(`insert into "CrmAppointment" (id, "accountId", "crmContactId", type, status, "startAt", "endAt", address, "assignedTo", "assignedToUserId", history, source, "updatedAt") values ('${made.appt}', '${q(made.account)}', '${q(made.contact)}', 'estimate', 'scheduled', now() at time zone 'utc' + interval '5 minutes', now() at time zone 'utc' + interval '65 minutes', '110 SE Watula Ave, Ocala, FL 34471', '${q(christa[1])}', '${q(christa[0])}', '[]', 'manual', now())`)
  check('setup: a test customer with a visit today for WT Christa', !!made.contact)
}

async function phone(browser) {
  const ctx = await browser.newContext({ ...devices['iPhone 13'] })
  const r = await ctx.request.post(`${API}/api/crm-auth/login`, { headers: { 'X-Staff-Request': '1', 'Content-Type': 'application/json' }, data: { ...CHRISTA, cookie: true } })
  if (!r.ok()) { check('phone: signed in as WT Christa', false, String(r.status())); await ctx.close(); return }
  const page = await ctx.newPage()
  const errors = watch(page)
  await page.goto(`${APP}/today`)
  await page.waitForSelector('[data-today]', { timeout: 30000 })
  await sleep(2500)
  const row = page.locator('button', { hasText: NAME }).first()
  if (await row.count()) await row.click(); else await page.getByRole('button', { name: /Complete/ }).first().click()
  await page.waitForSelector('[data-outcome-form]', { timeout: 10000 })
  await page.locator('[data-outcome="ready_to_quote"]').click()
  await page.locator('[data-outcome-form] textarea').fill('Front gate sags, one broken post by the drive.')
  await page.locator('[data-feet]').fill('60')
  await page.locator('[data-outcome-form] input[type=file]').setInputFiles(shots2)
  await shot(page, 'phone-1-visit-two-photos')
  await page.locator('[data-save-outcome]').click()
  // The new quote opens (its bottom bar has the camera button).
  await page.waitForSelector('[data-photos-open]', { timeout: 30000 }).catch(async e => { await shot(page, 'phone-fail-after-save'); throw e })
  // The camera button counts the visit's photos (they upload in the background).
  await page.waitForFunction(() => Number(document.querySelector('[data-photos-open]')?.textContent?.replace(/\D/g, '') || 0) >= 2, null, { timeout: 30000 }).catch(() => {})
  const count = Number((await page.locator('[data-photos-open]').textContent().catch(() => '')).replace(/\D/g, '') || 0)
  check('phone: the new quote\'s camera button counts the 2 visit photos (was 0)', count === 2, String(count))
  await shot(page, 'phone-2-quote-camera-count')
  const visit = page.locator(`[data-site-visit="${made.appt}"]`)
  await page.waitForSelector(`[data-site-visit="${made.appt}"] [data-site-visit-photos]`, { timeout: 30000 }).catch(() => {})
  check('phone: the Site visit box shows both photos', Number(await visit.locator('[data-site-visit-photos]').getAttribute('data-site-visit-photos').catch(() => '0')) === 2)
  // Uploaded as the customer's own photos: Site walk, Internal, not tied to a quote or job.
  await page.waitForFunction(() => document.querySelectorAll('[data-quote-media] [data-media-item="uploaded"]').length >= 2, null, { timeout: 30000 }).catch(() => {})
  const rows = media()
  check('phone: on the server: 2 photos on the customer, Site walk, Internal, captioned "Ready to quote visit"', rows.length === 2 && rows.every(m => m.visibility === 'internal' && !m.quoteKey && !m.jobId && m.category === 'Site walk' && m.caption === 'Ready to quote visit'), JSON.stringify(rows))
  // Mark one Customer from the quote's Photos sheet.
  await page.locator('[data-photos-open]').tap()
  await page.waitForSelector('[data-quote-media] [data-media-item]', { timeout: 10000 })
  await page.locator('[data-quote-media] [data-media-item]').first().tap()
  await page.waitForSelector('[data-viewer-visibility]', { timeout: 10000 })
  await page.locator('[data-viewer-visibility]').selectOption('customer')
  await sleep(1500)
  await shot(page, 'phone-3-mark-customer')
  const after = media()
  check('phone: marking it Customer is saved on the server (one Customer, one Internal)', after.filter(m => m.visibility === 'customer').length === 1 && after.filter(m => m.visibility === 'internal').length === 1, JSON.stringify(after.map(m => m.visibility)))
  check('phone: no page errors', errors.length === 0, errors.join(' | '))
  await ctx.close()
}

// A repair quote for the customer, as the office saves one (WT2 Linda Park's repair, copied, never sent).
async function repairQuote() {
  const src = psql(`select id from "SavedQuote" where "customerName" like 'WT2 Linda Park%' and work is not null and "deletedAt" is null limit 1`) || psql(`select id from "SavedQuote" where work->>'type'='repair' and proposal->>'kind'='repair' and "deletedAt" is null order by "createdAt" desc limit 1`)
  if (!src) throw new Error('no repair quote on the dev copy to copy')
  const got = await api(`/api/saved-quotes/${src}`)
  const s = got?.data ?? got
  const keep = ['fenceStyle', 'runs', 'runRails', 'layout', 'pricing', 'corners', 'ends', 'walkGates', 'dblGates', 'tearOutSections', 'tearOutGates', 'adjLaborHrs', 'hasSalesman', 'priceAdjust', 'sections', 'materialCost', 'laborCost', 'tearOutCost', 'totalCOGS', 'finalPrice', 'gmPct', 'pullSheet', 'leadSource']
  const body = Object.fromEntries(keep.filter(k => s[k] !== undefined && s[k] !== null).map(k => [k, s[k]]))
  const work = { ...s.work }; delete work.photoOverride
  const res = await api('/api/saved-quotes', { method: 'POST', body: JSON.stringify({ ...body, work, proposal: s.proposal, crmContactId: made.contact, customerId: made.contact, customerName: NAME, customerPhone: '3525550177', customerAddress: '110 SE Watula Ave, Ocala, FL 34471', status: 'DRAFT', notes: '' }) })
  made.quote = res.data?.id || res.id || ''
  check('setup: a repair quote for the customer (not sent)', !!made.quote && psql(`select "crmContactId" from "SavedQuote" where id='${q(made.quote)}'`) === made.contact, JSON.stringify(res).slice(0, 200))
}

async function computer(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await signInByCookie(ctx, { cookie: COOKIE, token: TOKEN, email: '', password: '', api: API })
  const page = await ctx.newPage()
  const errors = watch(page)
  // Quotes > the customer's repair quote (opens its window with the Send box).
  await page.goto(`${APP}/quotes`)
  await page.waitForSelector('[data-global-appointment]', { timeout: 30000 }); await sleep(1500)
  await page.locator('tr, [role=row], button, a, div', { hasText: NAME }).last().click()
  await page.waitForSelector('[data-proposal-send]', { timeout: 20000 }).catch(async e => { await shot(page, 'computer-fail-open-quote'); throw e })
  await sleep(2500)
  check('computer: the repair quote\'s Send box is not blocked (the visit\'s 2 photos count; no "Send anyway")', await page.locator('[data-photos-needed]').count() === 0 && await page.locator('[data-photos-override]').count() === 0 && !(await page.locator('[data-proposal-copy]').isDisabled()))
  const gallery = await page.locator('[data-media-gallery]').first().innerText().catch(() => '')
  check('computer: the quote\'s Photos list shows the visit photos', /\((\d+)\)/.test(gallery) && Number(gallery.match(/\((\d+)\)/)[1]) >= 2, gallery.split('\n')[0])
  await shot(page, 'computer-1-repair-send-not-blocked')
  await page.locator('[data-proposal-copy]').click(); await sleep(1500)
  const status = psql(`select status from "SavedQuote" where id='${q(made.quote)}'`)
  check('computer: Copy link works without "Send anyway" (the quote is Sent)', status === 'SENT', status)
  check('computer: no page errors', errors.length === 0, errors.join(' | '))

  // The customer's page: only the photo marked Customer.
  const token = psql(`select "shareToken" from "SavedQuote" where id='${q(made.quote)}'`)
  const [cust] = media().filter(m => m.visibility === 'customer')
  const [internal] = media().filter(m => m.visibility === 'internal')
  const cp = await ctx.newPage()
  await cp.setViewportSize({ width: 412, height: 915 })
  await cp.goto(`${API}/p/${token}`); await sleep(1500)
  const srcs = await cp.locator('img[src*="/media/"]').evaluateAll(els => els.map(e => e.getAttribute('src')))
  check('customer page: the visit photo marked Customer shows, the Internal one does not', srcs.length === 1 && !!cust && srcs[0].endsWith(`/media/${cust.id}`), JSON.stringify(srcs))
  check('customer page: that photo loads', srcs.length === 1 && await cp.locator('img[src*="/media/"]').first().evaluate(i => i.complete && i.naturalWidth > 0))
  const refused = internal ? (await fetch(`${API}/p/${token}/media/${internal.id}`)).status : 0
  check('customer page: the Internal photo\'s link is refused', refused === 404, String(refused))
  if (SHOTS) await cp.screenshot({ path: path.join(SHOTS, 'visit-photos-customer-proposal.png'), fullPage: true })
  await ctx.close()
}

async function cleanup() {
  try {
    if (made.contact) {
      for (const f of psql(`select path || E'\\n' || coalesce("thumbPath",'') || E'\\n' || coalesce("markupPath",'') from "MediaItem" where "customerId"='${q(made.contact)}'`).split('\n').filter(Boolean)) if (f.includes(`${path.sep}media${path.sep}`) && fs.existsSync(f)) fs.rmSync(f, { force: true })
      psql(`delete from "MediaItem" where "customerId"='${q(made.contact)}'; delete from "MediaUpload" where meta->>'customerId'='${q(made.contact)}'`)
      psql(`delete from "CrmAppointment" where "crmContactId"='${q(made.contact)}'`)
      psql(`delete from "SavedQuote" where "crmContactId"='${q(made.contact)}'`)
      // The pipeline card the visit made or moved (cards live in the board's list).
      const pipe = await api('/api/pipeline')
      const card = (pipe.data?.leads ?? []).filter(l => l.customerId === made.contact || l.crmContactId === made.contact).map(l => l.id)
      if (card.length) {
        await api('/api/pipeline', { method: 'PATCH', body: JSON.stringify({ upsert: [], remove: card, baseVersion: pipe.data.version }) })
        psql(`delete from "AutomationEvent" where "entityId" in (${card.map(c => `'${q(c)}'`).join(',')}); delete from "CardFollowUp" where "cardId" in (${card.map(c => `'${q(c)}'`).join(',')})`)
      }
      psql(`delete from "AutomationEvent" where "entityId"='${q(made.contact)}'; delete from "CrmContactNote" where "crmContactId"='${q(made.contact)}'; delete from "CustomerPossibleMatch" where "contactId"='${q(made.contact)}'`)
      psql(`delete from "CrmContact" where id='${q(made.contact)}'`)
    }
    fs.rmSync(tmp, { recursive: true, force: true })
    check('test records removed', !made.contact || psql(`select count(*) from "CrmContact" where id='${q(made.contact)}'`) === '0')
  } catch (e) { check('test records removed', false, String(e?.message || e).slice(0, 200)) }
}

const wk = await webkit.launch()
const ch = await chromium.launch()
try {
  await setup()
  await phone(wk)
  await repairQuote()
  await computer(ch)
} catch (e) {
  check('test run finished', false, String(e?.message || e).split('\n').slice(0, 3).join(' '))
} finally {
  await cleanup()
  await wk.close(); await ch.close()
}
const failed = results.filter(r => !r).length
console.log(`\n${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
