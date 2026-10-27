// Saving a quote at the visit (audit Oct 26 2026, item 22), on the dev copy, the way it is used:
//
// Phone (iPhone size, WebKit = the Safari engine), the Salesman (aud-sales@example.invalid):
//   1. A customer's card in Appointment. Pipeline > the card > New quote: one straight 180 ft side, a style,
//      Save quote.
//   2. The saved quote's window opens with its Send box (Text it, Email it, Copy link), not back on the card.
//   3. The card moved on to the Ready to quote stage (Settings > Pipeline Stages, by role; Estimating to start),
//      and the screen says so.
//
//   cd apps/web && pnpm -s build
//   APP_URL=http://localhost:4083 API_URL=http://localhost:4083 \
//   E2E_STAFF_COOKIE=<dev owner cookie> E2E_SALES_COOKIE=<dev Salesman cookie> [SHOTS=<folder>] node e2e/visit-quote-send.mjs
//   (the cookies: cd apps/portal && npx tsx scripts/dev-session-token.ts --cookie --out <file> [--email aud-sales@example.invalid])
//
// Dev only (devOnly.mjs refuses port 4000 and anything not on this Mac). The test customer, card and quote are
// removed at the end.

import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import { webkit, devices } from 'playwright'
import { signInByCookie } from './lib.mjs'
import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || 'http://localhost:4001'
const OWNER = process.env.E2E_STAFF_COOKIE || ''
const SALES = process.env.E2E_SALES_COOKIE || ''
const SHOTS = process.env.SHOTS || ''
const devLocal = u => /^http:\/\/localhost:\d+\/?$/.test(u) && !/:4000\b/.test(u)
if (!devLocal(APP) || !devLocal(API)) { console.error('Refusing to run: the dev copy only.'); process.exit(2) }
if (!OWNER || !SALES) { console.error('Set E2E_STAFF_COOKIE (owner) and E2E_SALES_COOKIE (a Salesman), from scripts/dev-session-token.ts --cookie.'); process.exit(2) }

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const psql = sql => execFileSync('psql', ['-d', 'ezbiz_dev', '-At', '-c', sql], { encoding: 'utf8' }).trim()
const q = s => String(s).replace(/'/g, "''")
const owner = { Cookie: `ezbiz_staff=${OWNER}`, 'X-Staff-Request': '1' }
const api = async (p, init = {}) => (await (await fetch(API + p, { ...init, headers: { ...owner, ...(init.body ? { 'Content-Type': 'application/json' } : {}) } })).json())
const shot = async (page, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `visit-quote-send-${name}.png`) }) } }

const NAME_LAST = `Visit Send ${Date.now().toString(36)}`
const made = { contact: '', card: '', account: '', quote: '' }
const cardNow = async () => ((await api('/api/pipeline')).data?.leads ?? []).find(l => l.id === made.card)

/** The pipeline, saved on the newest copy (other runs save it at the same time). */
async function patchPipeline(delta) {
  for (let i = 0; i < 10; i++) {
    const p = await api('/api/pipeline')
    const r = await fetch(`${API}/api/pipeline`, { method: 'PATCH', headers: { ...owner, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...delta(p.data.leads), baseVersion: p.data.version }) })
    if (r.status !== 409) return r.status
  }
  return 409
}

async function setup() {
  made.account = psql(`select "crmAccountId" from "CrmUser" where email='aud-sales@example.invalid'`)
  if (!made.account) throw new Error('The AUD Salesman is not on the dev copy')
  made.contact = psql(`insert into "CrmContact" (id, "accountId", "firstName", "lastName", phone, email, "serviceAddress", "updatedAt") values (gen_random_uuid(), '${q(made.account)}', 'E2E', '${q(NAME_LAST)}', '3525550179', 'e2e-visit-send@example.invalid', '3100 SW College Rd, Ocala, FL 34474', now()) returning id`).split('\n')[0]
  made.card = `e2e-visit-send-${Date.now().toString(36)}`
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  const lead = { id: made.card, firstName: 'E2E', lastName: NAME_LAST, phone: '3525550179', email: 'e2e-visit-send@example.invalid', address: '3100 SW College Rd, Ocala, FL 34474', stage: 'Appointment', customerId: made.contact, assignedRep: 'AUD Sales', lastMoved: today, createdAt: today }
  const s = await patchPipeline(() => ({ upsert: [{ lead, before: null }], remove: [] }))
  check('setup: a customer with a card in Appointment', s === 200 && (await cardNow())?.stage === 'Appointment', String(s))
}

async function phone(browser) {
  const ctx = await browser.newContext({ ...devices['iPhone 13'] })
  await signInByCookie(ctx, { cookie: SALES, api: API })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)))
  await page.goto(`${APP}/pipeline?card=${encodeURIComponent(made.card)}`)
  await page.waitForSelector(`[data-card-window="${made.card}"]`, { timeout: 30000 })
  await shot(page, '1-card')
  await page.locator(`[data-card-window="${made.card}"] [data-card-new-quote]`).tap()
  // One straight 180 ft side, the first style, then Save.
  const go = async loc => { await loc.tap(); await sleep(350) }
  await page.waitForSelector('[data-step="yard"]', { timeout: 20000 })
  await go(page.locator('[data-step="yard"]'))
  await go(page.locator('[data-shape="straight"]'))
  await go(page.locator('[data-side-length]').first())
  for (const k of ['1', '8', '0']) await go(page.locator(`[data-ftin-pad] [data-pad-key="${k}"]`))
  await go(page.locator('[data-ftin-pad] [data-pad-done]'))
  await go(page.locator('[data-step="style"]'))
  await page.locator('[data-step-panel="style"] select').first().selectOption({ index: 1 })
  await sleep(400)
  for (let i = 0; i < 6 && !(await page.locator('[data-quote-bar] [data-save-open]').count()); i++) { await go(page.locator('[data-quote-bar] [data-bar-next]')) }
  await shot(page, '2-price')
  await go(page.locator('[data-quote-bar] [data-save-open]'))
  await page.waitForSelector('[data-save-submit]', { timeout: 10000 })
  await page.locator('[data-save-submit]').tap()
  await page.waitForSelector('[data-quote-drawer] [data-proposal-send]', { timeout: 30000 }).catch(async () => { await shot(page, 'fail-after-save') })
  made.quote = new URL(page.url()).searchParams.get('qv') || ''
  await shot(page, '3-send')
  check('phone: after saving, the quote\'s window opens with its Send box (not back on the card)', await page.locator('[data-quote-drawer] [data-proposal-send]').count() === 1 && !!made.quote && (await page.locator(`[data-card-window="${made.card}"]`).count()) === 0, page.url())
  for (let i = 0; i < 20 && made.quote && psql(`select count(*) from "SavedQuote" where id='${q(made.quote)}' and "crmContactId"='${q(made.contact)}'`) !== '1'; i++) await sleep(500)
  check('phone: the quote is saved for the customer', psql(`select count(*) from "SavedQuote" where id='${q(made.quote)}' and "crmContactId"='${q(made.contact)}' and status='DRAFT'`) === '1')
  let stage = ''
  for (let i = 0; i < 20; i++) { stage = (await cardNow())?.stage ?? ''; if (stage !== 'Appointment') break; await sleep(500) }
  check('phone: the card moved from Appointment to Estimating (the Ready to quote stage)', stage === 'Estimating', stage)
  const toast = (await page.locator('[data-toast]').allTextContents().catch(() => [])).join(' ')
  check('phone: the screen says the card moved', /Card moved to Estimating/.test(toast), toast.slice(0, 200))
  check('phone: no page errors', errors.length === 0, errors.join(' | '))
  await ctx.close()
}

async function cleanup() {
  try {
    if (made.contact) {
      psql(`delete from "ProposalView" where "quoteId" in (select id from "SavedQuote" where "crmContactId"='${q(made.contact)}')`)
      psql(`delete from "SavedQuote" where "crmContactId"='${q(made.contact)}'`)
      const ids = ((await api('/api/pipeline')).data?.leads ?? []).filter(l => l.customerId === made.contact).map(l => l.id)
      if (ids.length) {
        await patchPipeline(() => ({ upsert: [], remove: ids }))
        psql(`delete from "AutomationEvent" where "entityId" in (${ids.map(c => `'${q(c)}'`).join(',')}); delete from "CardFollowUp" where "cardId" in (${ids.map(c => `'${q(c)}'`).join(',')})`)
      }
      psql(`delete from "AutomationEvent" where "entityId"='${q(made.contact)}'; delete from "CrmContactNote" where "crmContactId"='${q(made.contact)}'; delete from "CustomerPossibleMatch" where "contactId"='${q(made.contact)}'`)
      psql(`delete from "CrmContact" where id='${q(made.contact)}'`)
    }
    check('test records removed', !made.contact || psql(`select count(*) from "CrmContact" where id='${q(made.contact)}'`) === '0')
  } catch (e) { check('test records removed', false, String(e?.message || e).slice(0, 200)) }
}

const wk = await webkit.launch()
try {
  await setup()
  await phone(wk)
} catch (e) {
  check('test run finished', false, String(e?.message || e).split('\n').slice(0, 3).join(' '))
} finally {
  await cleanup()
  await wk.close()
}
const failed = results.filter(r => !r).length
console.log(`\n${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
