// Lead sources and customer tags: Settings is the one list each; records keep
// their words and show the option's name; merge and undo.
//
//   cd apps/web && pnpm -s build
//   E2E_ACCESS_TOKEN=<dev staff token> APP_URL=http://localhost:4001 API_URL=http://localhost:4001 \
//     SHOTS=<folder, optional> node e2e/option-lists.mjs
//
// Dev only (after the one-time step made the lists). At desktop size in
// Settings > Lead Sources: the Google merge shows with Undo; renames
// website/google, merges canvassing into Other, saves. Checks the server list,
// a customer saved as "Google" shows the new name and still holds "Google".
// Undo merge brings canvassing back; deleting an option in use is refused.
// (What the form pickers offer is checked in tests/optionLists.test.ts.) A second browser at 360 px reloads and sees the
// names; Settings fits. Settings > Customer Tags shows the import tags as
// built in and hidden. Finally both lists are put back exactly as they were.
import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import './sharedLock.mjs' // tests that change shared dev data take turns
import crypto from 'crypto'
import { chromium } from 'playwright'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || 'http://localhost:4001'
const TOKEN = process.env.E2E_ACCESS_TOKEN || ''
const SHOTS = process.env.SHOTS || ''
const local = u => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(u)
if (!local(APP) || !local(API) || /:4000(\/|$)/.test(API)) { console.error('Refusing to run: dev only (localhost, not port 4000).'); process.exit(2) }
if (!TOKEN) { console.error('Set E2E_ACCESS_TOKEN.'); process.exit(2) }

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const call = async (p, init = {}) => {
  const r = await fetch(API + p, { ...init, headers: { Authorization: `Bearer ${init.token || TOKEN}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) } })
  return { status: r.status, json: await r.json().catch(() => null) }
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false }) }
const getAll = async () => (await call('/api/option-lists')).json?.data
const put = async (kind, options, baseVersion, token) => call(`/api/option-lists/${kind}`, { method: 'PUT', body: JSON.stringify({ options, baseVersion }), token })

const tag = crypto.randomUUID().slice(0, 6)
const original = await getAll()
if (!original?.leadSources?.options?.length) { console.error('GET /api/option-lists did not answer: is the server on the new code?'); process.exit(1) }
const wg = original.leadSources.options.find(o => o.id === 'website/google')
if (!wg || !wg.alsoMatches.some(l => l.word === 'Google')) { console.error('Expected the one-time step\'s list (website/google with Google merged).'); process.exit(1) }
const RENAMED = `Website / Google ${tag}`

async function open(browser, width, height, phone) {
  const ctx = await browser.newContext(phone ? { viewport: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width, height } })
  await ctx.addInitScript(t => { localStorage.setItem('crm_access_token', t); if (!localStorage.getItem('crm_refresh_token')) localStorage.setItem('crm_refresh_token', 'e2e') }, TOKEN)
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', e => errs.push(String(e).slice(0, 200)))
  page.on('dialog', d => d.accept().catch(() => {}))
  return { ctx, page, errs }
}
const noSideScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
const sel = id => `[data-option-row="${id.replace(/"/g, '\\"')}"]`

const b = await chromium.launch()
try {
  // ── Desktop: Settings > Lead Sources ──
  const d = await open(b, 1440, 900, false)
  await d.page.goto(`${APP}/settings?tab=leads`)
  await d.page.waitForSelector('[data-option-list="leadSources"]', { timeout: 60000 }); await sleep(800)
  const ids = await d.page.$$eval('[data-option-row]', els => els.map(e => e.getAttribute('data-option-row')))
  check('Settings shows the options in order', ids.join() === original.leadSources.options.map(o => o.id).join())
  check('the Google merge shows, with Undo merge', (await d.page.locator(`${sel('website/google')} [data-option-link="Google"]`).innerText()).includes('merged'))
  check('built-ins are marked and hidden from forms', (await d.page.locator(`${sel('Website Quote')} [data-option-builtin]`).count()) === 1 && await d.page.locator(`${sel('Website Quote')} [data-option-hidden]`).isChecked())
  check('nothing found on records that no option matches', (await d.page.locator('[data-option-found-none]').count()) === 1)
  await shot(d.page, 'dev-lead-sources')
  await d.page.locator(`${sel('website/google')} [data-option-name]`).fill(RENAMED)
  await d.page.locator(`${sel('canvassing')} [data-option-merge]`).selectOption('Other'); await sleep(200)
  check('canvassing merged into Other on screen', (await d.page.locator(sel('canvassing')).count()) === 0 && (await d.page.locator(`${sel('Other')} [data-option-link="canvassing"]`).count()) === 1)
  await d.page.locator(sel('Other')).evaluate(el => el.scrollIntoView({ block: 'center' })); await sleep(200)
  await shot(d.page, 'dev-lead-sources-merge')
  await d.page.locator('[data-option-list-save]').click()
  await d.page.waitForSelector('[data-option-list-save]:has-text("Saved")', { timeout: 15000 }).catch(() => null)
  const s1 = (await getAll()).leadSources
  check('saved: renamed (same id), canvassing linked into Other', s1.options.find(o => o.id === 'website/google')?.name === RENAMED && !s1.options.some(o => o.id === 'canvassing') && s1.options.find(o => o.id === 'Other').alsoMatches.some(l => l.word === 'canvassing'))

  // ── Records show the option's name ──
  const contacts = (await call('/api/crm-contacts')).json?.data ?? []
  const g = contacts.find(c => c.leadSource === 'Google')
  if (g) {
    await d.page.goto(`${APP}/customers/${encodeURIComponent(g.id)}`)
    await d.page.waitForSelector('[data-customer-source]', { timeout: 60000 }); await sleep(300)
    check('a customer saved as "Google" shows the merged option\'s new name', (await d.page.locator('[data-customer-source]').first().innerText()).includes(RENAMED))
    const again = ((await call('/api/crm-contacts')).json?.data ?? []).find(c => c.id === g.id)
    check('and the record still holds its own word', again?.leadSource === 'Google', String(again?.leadSource))
  } else check('a customer saved as "Google" exists on dev to look at', false)

  // ── A salesman cannot change the list ──
  if (process.env.E2E_SALES_TOKEN) check('a salesman cannot save the list (403)', (await put('leadSources', s1.options, s1.version, process.env.E2E_SALES_TOKEN)).status === 403)

  // ── Undo the canvassing merge ──
  await d.page.goto(`${APP}/settings?tab=leads`)
  await d.page.waitForSelector('[data-option-list="leadSources"]', { timeout: 60000 }); await sleep(600)
  await d.page.locator(`${sel('Other')} [data-option-link="canvassing"] [data-option-unmerge]`).click(); await sleep(200)
  await d.page.locator('[data-option-list-save]').click()
  await d.page.waitForSelector('[data-option-list-save]:has-text("Saved")', { timeout: 15000 }).catch(() => null)
  const s2 = (await getAll()).leadSources
  check('Undo merge: canvassing is its own option again', s2.options.some(o => o.id === 'canvassing' && !o.hidden) && !s2.options.find(o => o.id === 'Other').alsoMatches.some(l => l.word === 'canvassing'))
  const del = await put('leadSources', s2.options.filter(o => o.id !== 'mysalesman'), s2.version)
  check('deleting an option that records use is refused (merge it instead)', del.status === 409 && del.json?.code === 'IN_USE', String(del.status))

  // ── A second browser at 360 px ──
  const m = await open(b, 360, 780, true)
  await m.page.goto(`${APP}/settings?tab=leads`)
  await m.page.waitForSelector('[data-option-list="leadSources"]', { timeout: 60000 }); await sleep(600)
  check('phone (second browser): the new name after a reload', (await m.page.locator(`${sel('website/google')} [data-option-name]`).inputValue()) === RENAMED)
  check('phone: Lead Sources fits at 360 px', await noSideScroll(m.page))
  await m.page.goto(`${APP}/settings?tab=tags`)
  await m.page.waitForSelector('[data-option-list="customerTags"]', { timeout: 60000 }); await sleep(600)
  check('phone: Customer Tags fits at 360 px', await noSideScroll(m.page))

  // ── Customer Tags ──
  await d.page.goto(`${APP}/settings?tab=tags`)
  await d.page.waitForSelector('[data-option-list="customerTags"]', { timeout: 60000 }); await sleep(800)
  const tagsOk = await Promise.all(['Imported', 'JobNimbus', 'From schedule', 'MyBudgetQuote import', 'MyBudgetQuote dropoff'].map(async t => (await d.page.locator(`${sel(t)} [data-option-builtin]`).count()) === 1 && await d.page.locator(`${sel(t)} [data-option-hidden]`).isChecked()))
  check('Customer Tags: the import tags are built in and hidden from forms', tagsOk.every(Boolean))
  await shot(d.page, 'dev-customer-tags')

  check('no page errors', d.errs.length === 0 && m.errs.length === 0, [...d.errs, ...m.errs].join(' | '))
  await d.ctx.close(); await m.ctx.close()
} finally {
  const now = await getAll()
  for (const kind of ['leadSources', 'customerTags']) {
    if (JSON.stringify(now[kind].options) !== JSON.stringify(original[kind].options)) await put(kind, original[kind].options, now[kind].version)
  }
  const end = await getAll()
  const same = k => JSON.stringify(end[k].options.map(o => ({ ...o, alsoMatches: o.alsoMatches.map(l => ({ word: l.word, kind: l.kind })) }))) === JSON.stringify(original[k].options.map(o => ({ ...o, alsoMatches: o.alsoMatches.map(l => ({ word: l.word, kind: l.kind })) })))
  check('nothing left: both lists as they were', same('leadSources') && same('customerTags'))
  await b.close()
}
const failed = results.filter(r => !r).length
console.log(`\n${results.length - failed} of ${results.length} checks passed`)
process.exit(failed ? 1 : 0)
