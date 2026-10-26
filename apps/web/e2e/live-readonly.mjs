// Open every pipeline card, customer, quote and job on LIVE, read only,
// and list any that error.
//
//   node e2e/live-readonly.mjs [cards|customers|quotes ...]   (all three by default)
//
// Read only for certain, twice over: the sign in is a read only session the
// server itself refuses every save with (403), and every request that is not
// a GET is also stopped in the browser before it leaves, and listed (an app
// that writes just from being opened is a finding too). Requests are paced
// to well under the server's limit so the people using it are not slowed.
// Report: ~/Downloads/live-readonly-<date>.txt
//
// The sign in: a 3 hour read only session made on the Mac first (it shows in
// Settings > Team with its end time; nothing here reads the live settings
// file or its secret):
//
//   cd ~/ezbiz/apps/portal && npx tsx scripts/readonly-session.ts
//
// It works only on the Mac itself, straight to the server (localhost:4000),
// not through the Tailscale address, so the page is opened at localhost:4000.

import { chromium } from 'playwright'
import fs from 'fs'

const LIVE = process.env.LIVE_URL || 'http://localhost:4000'
const PAGE = LIVE
const HOME = process.env.HOME
const SESSION_FILE = process.env.READONLY_SESSION_FILE || `${HOME}/.ezbiz-readonly-session`
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(LIVE)) { console.error('LIVE_URL must be http://localhost:<port> (the read only sign in works only on the Mac itself).'); process.exit(2) }
if (!fs.existsSync(SESSION_FILE)) { console.error(`No read only sign in at ${SESSION_FILE}. Make one first: cd ~/ezbiz/apps/portal && npx tsx scripts/readonly-session.ts`); process.exit(2) }
const COOKIE = fs.readFileSync(SESSION_FILE, 'utf8').trim()
const me = await fetch(LIVE + '/api/crm-auth/me', { headers: { Cookie: `ezbiz_staff=${COOKIE}` } })
if (!me.ok) { console.error(`The read only sign in did not work (${me.status}): it ends after 3 hours, or was ended in Settings > Team. Make a new one.`); process.exit(2) }
if (!(await me.json()).data?.readOnly) { console.error('That sign in is not a read only one. Refusing.'); process.exit(2) }

const WHAT = process.argv.slice(2).length ? process.argv.slice(2) : ['cards', 'customers', 'quotes', 'jobs']
const WORKERS = 3
const MAX_PER_MIN = 280
const sleep = ms => new Promise(r => setTimeout(r, ms))
const get = async p => (await (await fetch(LIVE + p, { headers: { Cookie: `ezbiz_staff=${COOKIE}` } })).json()).data

// Pace: requests seen in the last minute, across every worker.
const stamps = []
async function pace() {
  for (;;) {
    const now = Date.now()
    while (stamps.length && stamps[0] < now - 60_000) stamps.shift()
    if (stamps.length < MAX_PER_MIN) return
    await sleep(500)
  }
}

const blocked = []
const problems = []

async function worker(browser, items, label) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const u = new URL(LIVE)
  await ctx.addCookies([{ name: 'ezbiz_staff', value: COOKIE, domain: u.hostname, path: '/api', httpOnly: true, secure: false, sameSite: 'Strict' }])
  await ctx.route('**/*', route => {
    const req = route.request()
    if (!req.url().startsWith(PAGE)) return route.continue()
    if (req.method() !== 'GET' && req.method() !== 'HEAD' && req.method() !== 'OPTIONS') {
      blocked.push(`${req.method()} ${req.url().replace(PAGE, '').split('?')[0]}`)
      return route.abort()
    }
    stamps.push(Date.now())
    return route.continue()
  })
  const page = await ctx.newPage()
  const startErrors = []
  page.on('pageerror', e => startErrors.push(String(e).slice(0, 300)))
  page.on('console', m => { if (m.type() === 'error') startErrors.push(m.text().slice(0, 300)) })
  page.on('requestfailed', r => startErrors.push(`failed ${r.url()} ${r.failure()?.errorText}`))
  let current = null
  const note = (kind, detail) => { if (current) problems.push({ label, item: current, kind, detail: String(detail).slice(0, 240) }) }
  page.on('pageerror', e => note('page error', e))
  page.on('console', m => { if (m.type() === 'error' && !/net::ERR_FAILED|Failed to load resource/.test(m.text())) note('console error', m.text()) })
  page.on('response', r => { if (r.url().startsWith(PAGE) && r.status() >= 400 && r.request().method() === 'GET') note(`server answered ${r.status()}`, r.url().replace(PAGE, '')) })
  await page.goto(PAGE + '/')
  if (!(await page.waitForSelector('[data-page-scroll]', { timeout: 60000 }).then(() => true, () => false))) {
    await page.screenshot({ path: `${process.env.SHOTS || '/tmp'}/live-readonly-start.png` })
    throw new Error(`the app did not open: ${(await page.locator('body').textContent()).replace(/\s+/g, ' ').slice(0, 300)} | blocked so far: ${blocked.join(', ')} | errors: ${startErrors.join(' || ')}`)
  }
  await sleep(2000)
  let i = 10_000
  for (const it of items) {
    await pace()
    current = it
    // Move inside the app (no reload): the address changes, the screen follows, as Back and links do.
    await page.evaluate(([url, n]) => { history.pushState({ ez: 1, i: n, depth: 0 }, '', url); dispatchEvent(new PopStateEvent('popstate', { state: history.state })) }, [it.url, i++])
    await sleep(350)
    const opened = await page.locator(it.expect).count()
    if (!opened) { await sleep(900); if (!(await page.locator(it.expect).count())) note('did not open', it.url) }
    const toastErr = await page.locator('.bg-red-600').allTextContents().catch(() => [])
    for (const t of toastErr) note('error shown', t.replace(/\s+/g, ' '))
    const txt = (await page.locator('body').textContent().catch(() => '')) || ''
    if (/not found|Failed to fetch|\bundefined\b|\bNaN\b|Invalid Date/.test(txt)) {
      const m = txt.match(/.{0,40}(not found|Failed to fetch|\bundefined\b|\bNaN\b|Invalid Date).{0,40}/)
      if (m) note('odd text on screen', m[0].replace(/\s+/g, ' '))
    }
    current = null
  }
  await ctx.close()
}

const browser = await chromium.launch()
const t0 = Date.now()
const totals = {}
try {
  const plan = []
  if (WHAT.includes('cards')) {
    const leads = (await get('/api/pipeline')).leads
    totals.cards = leads.length
    plan.push(...leads.map(l => ({ kind: 'card', name: `${l.firstName} ${l.lastName}`.trim(), id: l.id, url: `/pipeline?card=${encodeURIComponent(l.id)}`, expect: `[data-card-window="${l.id}"]` })))
  }
  if (WHAT.includes('customers')) {
    const cs = await get('/api/crm-contacts')
    totals.customers = cs.length
    plan.push(...cs.map(c => ({ kind: 'customer', name: `${c.firstName} ${c.lastName}`.trim(), id: c.id, url: `/customers/${encodeURIComponent(c.id)}`, expect: '[data-customer-tab="activity"]' })))
  }
  if (WHAT.includes('quotes')) {
    const qs = await get('/api/saved-quotes')
    totals.quotes = qs.length
    plan.push(...qs.map(q => ({ kind: 'quote', name: q.customerName, id: q.id, url: `/quotes?qv=${encodeURIComponent(q.id)}`, expect: 'div.fixed.inset-0.z-50.flex' })))
  }
  if (WHAT.includes('jobs')) {
    const d = await get('/api/saved-jobs')
    const js = (Array.isArray(d) ? d : d?.jobs ?? []).filter(j => !j.archivedAt)
    totals.jobs = js.length
    // Operations at desktop size opens the job in the side panel.
    plan.push(...js.map(j => ({ kind: 'job', name: j.customerName, id: j.id, url: `/operations?job=${encodeURIComponent(j.id)}`, expect: 'div.fixed.inset-y-0.right-0.z-50' })))
  }
  if (process.env.LIMIT) { const n = +process.env.LIMIT; const by = k => plan.filter(p => p.kind === k).slice(0, n); plan.splice(0, plan.length, ...by('card'), ...by('customer'), ...by('quote'), ...by('job')) }
  // A check on the checker: records that do not exist must be reported.
  if (process.env.CONTROL) plan.push(
    { kind: 'card', name: 'CONTROL missing card', id: 'nope', url: '/pipeline?card=nope-123', expect: '[data-card-window="nope-123"]' },
    { kind: 'customer', name: 'CONTROL missing customer', id: 'nope', url: '/customers/nope-123', expect: '[data-customer-tab="activity"]' },
    { kind: 'quote', name: 'CONTROL missing quote', id: 'nope', url: '/quotes?qv=nope-123', expect: 'div.fixed.inset-0.z-50.flex' },
    { kind: 'job', name: 'CONTROL missing job', id: 'nope', url: '/operations?job=nope-123', expect: 'div.fixed.inset-y-0.right-0.z-50' },
  )
  const per = Math.ceil(plan.length / WORKERS)
  await Promise.all(Array.from({ length: WORKERS }, (_, w) => worker(browser, plan.slice(w * per, (w + 1) * per), `worker ${w + 1}`)))
} finally {
  await browser.close()
}

const day = new Date().toISOString().slice(0, 10)
const lines = [
  `Live, read only: every pipeline card, customer, quote and job opened (${day})`,
  `Opened: ${Object.entries(totals).map(([k, v]) => `${v} ${k}`).join(', ')} in ${Math.round((Date.now() - t0) / 60000)} minutes.`,
  `Changes the app tried to send just from being opened (all stopped): ${blocked.length ? [...new Set(blocked)].map(b => `${b} x${blocked.filter(x => x === b).length}`).join('; ') : 'none'}`,
  `Problems: ${problems.length}`,
  ...problems.map(p => `- ${p.item.kind} ${p.item.name || '(no name)'} [${p.item.id}]: ${p.kind}: ${p.detail}`),
]
// The duplicate check (read only on the server), in the same report.
const dups = await get('/api/system/duplicates').catch(() => null)
lines.push(`Duplicate check: ${dups ? (dups.length ? `${dups.length} found` : 'nothing found') : 'did not run'}`, ...(dups ?? []).map(f => `- ${f.title}: ${f.detail}`))
if (!process.env.CONTROL) fs.writeFileSync(`${HOME}/Downloads/live-readonly-${day}.txt`, lines.join('\n') + '\n')
console.log(lines.slice(0, 4).join('\n'))
const byKind = {}
for (const p of problems) byKind[`${p.item.kind}: ${p.kind}`] = (byKind[`${p.item.kind}: ${p.kind}`] ?? 0) + 1
console.log(byKind)
