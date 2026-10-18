// The website instant quote, end to end on the dev copy, on a phone.
//
//   APP_URL=http://localhost:4001 E2E_ACCESS_TOKEN=<dev staff token> SHOTS=<folder> node e2e/widget-quote.mjs
//
// A page at https://www.gdfencepro.com/instant-quote (served by the test)
// shows the widget in a frame, the way the website will. A customer with no
// sign in types the address, the Backyard and the fence, sees the estimate
// and sends it. The customer, the quote and the pipeline card are then in EZ
// Biz together, the quote opens in the builder at the same price, and a page
// on any other site is refused the frame. The test records are removed after.

// Clicks, not taps: Playwright 1.56 does not deliver a tap inside a frame from another site.
import { chromium } from 'playwright'
import { execFileSync } from 'child_process'

const APP = process.env.APP_URL || 'http://localhost:4001'
const TOKEN = process.env.E2E_ACCESS_TOKEN || ''
const SHOTS = process.env.SHOTS || ''
if (!/localhost:4001/.test(APP)) { console.error('Refusing to run: the dev copy only.'); process.exit(2) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const api = async (p, init = {}) => (await (await fetch(APP + p, { ...init, headers: { Authorization: `Bearer ${TOKEN}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) } })).json())
const psql = sql => execFileSync('psql', ['-d', 'ezbiz_dev', '-At', '-c', sql], { encoding: 'utf8' }).trim()
const NAME = 'E2E Widget Customer'
// On live the widget is https behind the public door; here an https stand in
// passes every request to the dev server unchanged (headers and all), so the
// real frame rule is what is tested.
const WIDGET = 'https://widget.test'
const host = page => `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Instant quote</title></head>
<body style="margin:0;font-family:sans-serif"><header style="background:#1c1030;color:#fff;padding:12px">Getter Done Fence (the designer's page)</header>
<iframe id="w" src="${WIDGET}/p/quote/" title="Instant fence estimate" style="width:100%;height:760px;border:0;display:block" allow="camera"></iframe></body></html>`

const browser = await chromium.launch()
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)))
  await ctx.route(`${WIDGET}/**`, async r => r.fulfill({ response: await r.fetch({ url: r.request().url().replace(WIDGET, APP) }) }))
  await ctx.route('https://www.gdfencepro.com/instant-quote', r => r.fulfill({ contentType: 'text/html', body: host() }))
  await ctx.route('https://other-site.example/**', r => r.fulfill({ contentType: 'text/html', body: host() }))

  await page.goto('https://www.gdfencepro.com/instant-quote'); await sleep(2500)
  const w = page.frameLocator('#w')
  check('the widget shows inside a page on www.gdfencepro.com', await w.locator('[data-w-address]').isVisible())
  check('no sign in, no outer header: it opens on the address', (await w.locator('h1').textContent()).includes('instant fence estimate'))
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/w1-address.png` })

  await w.locator('[data-w-address]').fill('201 SE 3rd St, Ocala, FL 34471')
  await w.locator('[data-w-next]').click(); await sleep(4000)
  // Found: on to the yard. Not found: "Carry on".
  if (await w.locator('[data-w-step="address"]').count()) await w.locator('[data-w-next]').click()
  await w.locator('[data-w-shape="backyard"]').click(); await sleep(400)
  check('the yard: the same Backyard sides as the quote builder', (await w.locator('[data-w-side]').count()) === 5)
  await w.locator('[data-w-side="Left return"] [data-w-length]').click()
  for (const [ft, last] of [['30', false], ['120', false], ['150', false], ['120', false], ['30', true]]) {
    for (const k of ft) await w.locator(`[data-ftin-pad] [data-pad-key="${k}"]`).click()
    await w.locator(last ? '[data-ftin-pad] [data-pad-done]' : '[data-ftin-pad] [data-pad-next]').click(); await sleep(150)
  }
  await w.locator('[data-w-side="Left return"] [data-w-gate] button:has-text("Walk gate")').click()
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/w2-yard.png` })
  await w.locator('[data-w-step="yard"] [data-w-next]').click(); await sleep(300)

  await w.locator('[data-w-material="vinyl"]').click()
  await w.locator('[data-w-style="Privacy, 6 ft sections, no dig"]').click()
  await w.locator('[data-w-height="6ft"]').click(); await w.locator('[data-w-color="White"]').click()
  const photo = await w.locator('[data-w-style="Privacy, 6 ft sections, no dig"] img').count()
  check('style cards use the Settings style photo when there is one, else say a photo is coming', photo === 1 || (await w.locator('[data-w-style="Privacy, 6 ft sections, no dig"]').textContent()).includes('Photo coming soon'))
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/w3-fence.png` })
  await w.locator('[data-w-step="fence"] [data-w-next]').click(); await sleep(2500)

  const estimate = Number(await w.locator('[data-w-estimate]').getAttribute('data-w-estimate'))
  check('the customer gets a price', estimate > 1000, `$${estimate}`)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/w4-estimate.png` })
  await w.locator('[data-w-name]').fill(NAME)
  await w.locator('[data-w-phone]').fill('352-555-0199')
  await w.locator('[data-w-email]').fill('e2e.widget@example.com')
  await w.locator('[data-w-send]').click(); await sleep(3000)
  check('sent: the thank you shows the estimate', (await w.locator('[data-w-sent]').textContent()).includes(`$${estimate.toLocaleString('en-US')}`))
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/w5-sent.png` })

  // In EZ Biz: the customer, the quote and the pipeline card, together.
  const contact = psql(`select id from "CrmContact" where "firstName"='E2E' and "lastName"='Widget Customer' order by "createdAt" desc limit 1`)
  const quote = psql(`select id||'|'||"finalPrice"||'|'||"leadSource"||'|'||coalesce(layout::jsonb->'yard'->>'shape','') from "SavedQuote" where "crmContactId"='${contact}'`)
  const card = psql(`select l->>'id' from "PipelineState", jsonb_array_elements(leads::jsonb) l where l->>'customerId'='${contact}'`)
  const intake = psql(`select status from "IntakeLead" where "crmContactId"='${contact}'`)
  check('the customer, the quote and the pipeline card are all in EZ Biz', !!contact && !!quote && !!card, `${contact} | ${quote} | ${card}`)
  check('the quote keeps the yard and is marked as a website quote; the lead is already on the pipeline', quote.endsWith('|Website Quote|backyard') && intake === 'imported', `${quote} · ${intake}`)
  const quoteId = quote.split('|')[0]
  check('the saved price is the estimate the customer saw', Math.round(Number(quote.split('|')[1])) === estimate)

  // The builder opens it at the same price.
  const staff = await browser.newContext({ viewport: { width: 1280, height: 950 } })
  await staff.addInitScript(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, TOKEN)
  const sp = await staff.newPage()
  await sp.goto(`${APP}/quotes?quote=${quoteId}`); await sp.waitForSelector('[data-quote-price]', { timeout: 30000 }); await sleep(1500)
  const builder = Number((await sp.locator('[data-quote-price]').textContent()).replace(/[$,]/g, ''))
  check('the quote builder prices it the same', Math.round(builder) === estimate, `builder $${builder}, widget $${estimate}`)
  await staff.close()

  // Any other site is refused.
  await page.goto('https://other-site.example/instant-quote'); await sleep(2500)
  const blocked = page.frames().find(f => f !== page.mainFrame())
  check('a page on any other site cannot show it', !blocked || !(await blocked.locator('[data-w-address]').count().catch(() => 0)), blocked?.url())
  check('no page errors', errors.length === 0, errors.join(' | '))

  // Remove the test records.
  if (quoteId) await api(`/api/saved-quotes/${quoteId}`, { method: 'DELETE' })
  const pipe = await api('/api/pipeline')
  if (card) await api('/api/pipeline', { method: 'PATCH', body: JSON.stringify({ upsert: [], remove: [card], baseVersion: pipe.data.version }) })
  psql(`delete from "IntakeLead" where "crmContactId"='${contact}'; delete from "CrmContactNote" where "crmContactId"='${contact}'; delete from "CrmContact" where id='${contact}'`)
  check('test records removed', psql(`select count(*) from "CrmContact" where id='${contact}'`) === '0')
  await ctx.close()
} catch (e) {
  check('test run finished', false, String(e?.message || e).split('\n').slice(0, 3).join(' '))
} finally {
  await browser.close()
}
const passed = results.filter(Boolean).length
console.log(`\n${passed} of ${results.length} checks passed`)
process.exit(passed === results.length ? 0 : 1)
