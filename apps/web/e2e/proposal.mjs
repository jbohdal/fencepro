// Instant proposal, end to end on the dev copy.
//
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 \
//   E2E_ACCESS_TOKEN=<dev staff token> node e2e/proposal.mjs
//
// Settings → Proposals (deposit, financing, a style photo), Compare options
// on a quote, save, then the customer's page on a phone: pick another
// option, sign, accept, and the quote becomes that option as priced. The
// test quote and photo are removed and the settings put back at the end.

import { chromium } from 'playwright'
import fs from 'fs'
import path from 'path'

const APP = process.env.APP_URL || 'http://localhost:5173'
const API = process.env.API_URL || 'http://localhost:4001'
const TOKEN = process.env.E2E_ACCESS_TOKEN || ''
const SHOTS = process.env.SHOTS || ''
const local = u => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(u)
if (!local(APP) || !local(API) || /:4000(\/|$)/.test(API)) { console.error('Refusing to run: the dev copy only (localhost, not port 4000).'); process.exit(2) }
if (!TOKEN) { console.error('Set E2E_ACCESS_TOKEN.'); process.exit(2) }

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const api = async (p, init = {}) => {
  const r = await fetch(API + p, { ...init, headers: { Authorization: `Bearer ${TOKEN}`, ...(init.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...(init.headers || {}) } })
  const j = await r.json().catch(() => ({}))
  return j.data ?? j
}
async function open(browser, phone) {
  const ctx = await browser.newContext(phone ? { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 1000 } })
  await ctx.addInitScript(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, TOKEN)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 300)))
  page.on('dialog', d => d.accept().catch(() => {}))
  await page.route('**/api/automations/trigger', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' }))
  return { ctx, page, errors }
}

const browser = await chromium.launch()
let quoteId = null, photoId = null
const TAN = "TV-ND 6'x8' Privacy", SIX = "WV-ND 6'x6' Privacy", OWN = "WV-ND 6'x8' Privacy"
async function setProposalSettings(page, dep, months, apr) {
  await page.goto(APP); await page.waitForSelector('[data-global-appointment]', { timeout: 30000 }); await sleep(800)
  await page.locator('span:text-is("Settings"):visible').first().click(); await sleep(500)
  await page.locator('button:text-is("Proposals")').click(); await sleep(400)
  await page.locator('[data-deposit-pct]').fill(dep)
  await page.locator('[data-fin-months]').fill(months)
  await page.locator('[data-fin-apr]').fill(apr)
  await page.locator('button:has-text("Save Changes")').click(); await sleep(1200)
}
try {
  // ── Settings: deposit, financing and a photo for the tan style ──
  const d = await open(browser, false)
  await setProposalSettings(d.page, '50', '60', '9.99')
  const form = new FormData()
  form.append('styleName', TAN)
  form.append('photo', new Blob([fs.readFileSync(path.resolve('public/icon-512.png'))], { type: 'image/png' }), 'tan.png')
  photoId = (await api('/api/style-photos', { method: 'POST', body: form })).id
  await d.page.reload(); await d.page.waitForSelector('[data-global-appointment]'); await sleep(800)
  await d.page.locator('span:text-is("Settings"):visible').first().click(); await sleep(400)
  await d.page.locator('button:text-is("Proposals")').click(); await sleep(800)
  check('Settings: the tan style shows its photo', await d.page.locator(`[data-style-photo="${TAN}"] img`).count() === 1)
  if (SHOTS) await d.page.screenshot({ path: `${SHOTS}/1-settings-proposals.png`, fullPage: true })

  // ── Phone: a quote, compare options, offer two more, save ──
  const s = await open(browser, true)
  const p = s.page
  await p.goto(APP); await p.waitForSelector('[data-tabbar]', { timeout: 30000 }); await sleep(800)
  await p.locator('button:has-text("New quote"):visible').first().click()
  const b = p.locator('[data-quote-builder]')
  await b.locator('[data-step="yard"]').click()
  await b.locator('[data-shape="backyard"]').click()
  await b.locator('[data-side="Left return"] [data-side-length]').click()
  for (const [keys, last] of [[['3', '0'], 0], [['1', '2', '0'], 0], [['1', '5', '0'], 0], [['1', '2', '0'], 0], [['3', '0'], 1]]) {
    for (const k of keys) await p.locator(`[data-ftin-pad] [data-pad-key="${k}"]`).click()
    await p.locator(last ? '[data-ftin-pad] [data-pad-done]' : '[data-ftin-pad] [data-pad-next]').click()
  }
  await b.locator('[data-side-row="Left return"]').click()
  await b.locator('[data-side="Left return"] [data-gate-choice] button:has-text("Walk gate")').click()
  await b.locator('[data-step="style"]').click()
  await b.locator('select').filter({ hasText: 'Select a fence style' }).selectOption({ label: OWN }); await sleep(400)
  await b.locator('[data-step="price"]').click()
  // Good, Better, Best show under the price with no taps.
  const tierNames = await b.locator('[data-tier]').evaluateAll(els => els.map(e => e.getAttribute('data-tier')))
  const tierPrice = async k => Number((await b.locator(`[data-tier="${k}"] [data-tier-price]`).textContent()).replace(/[^\d.]/g, ''))
  check('tiers: Good, Better, Best show under the price', tierNames.join(',') === 'good,better,best', tierNames.join(','))
  check('tiers: Better is marked Most popular and priced above Good', (await b.locator('[data-tier="better"]').textContent()).includes('Most popular') && await tierPrice('better') > await tierPrice('good'),
    `good ${await tierPrice('good')}, better ${await tierPrice('better')}`)
  check('tiers: each says which width prices lower', (await b.locator('[data-tier="good"] [data-tier-width]').textContent()).includes('ft wide prices lower for this yard'))
  if (SHOTS) { await b.locator('[data-tiers]').scrollIntoViewIfNeeded(); await p.screenshot({ path: `${SHOTS}/2a-phone-good-better-best.png` }) }
  await b.locator('[data-compare-toggle]').click(); await sleep(500)
  const rows = await b.locator('[data-compare-row]').count()
  const sixRow = (await b.locator(`[data-compare-row="${SIX}"]`).textContent()).replace(/\s+/g, ' ')
  // Every active 6 ft tall vinyl style: white/tan × no dig/dig set × 6/8 wide.
  check('compare: white vs tan, no dig vs dig set, 6 vs 8 wide', rows >= 7 && rows <= 8, `${rows} rows`)
  check('compare: shows what each costs against this quote', /\+\$[\d,]+\.\d\d/.test(sixRow), sixRow)
  await b.locator(`[data-compare-row="${TAN}"] input`).check()
  await b.locator(`[data-compare-row="${SIX}"] input`).check()
  if (SHOTS) { await b.locator('[data-compare]').scrollIntoViewIfNeeded(); await p.screenshot({ path: `${SHOTS}/2-phone-compare-options.png` }) }
  await p.locator('[data-quote-bar] [data-save-open]').click()
  await p.locator('input[placeholder="Name, phone, or email..."]').fill('Shawn Collins'); await sleep(400)
  await p.locator('text=Shawn Collins').last().click()
  await p.locator('button:has-text("Save quote")').last().click(); await sleep(2500)
  check('phone: no page errors while quoting', s.errors.length === 0, s.errors.join(' | '))
  await s.ctx.close()

  const list = await api('/api/saved-quotes')
  const q = (Array.isArray(list) ? list : []).filter(x => x.customerName === 'Shawn Collins' && x.proposal?.options?.length >= 3 && !x.acceptedAt).sort((a, z) => String(z.createdAt).localeCompare(String(a.createdAt)))[0]
  quoteId = q?.id
  const offered = q ? q.proposal.options.map(o => o.fenceStyle) : []
  check('saved: Good, Better, Best first, then the extra option ticked', q.proposal.options.slice(0, 3).map(o => o.tier?.label).join(',') === 'Good,Better,Best' && offered.includes(OWN) && offered.includes(TAN) && offered.includes(SIX), offered.join(' | '))
  check('saved: Most popular (Better) is the recommended option', q.proposal.recommended === 1 && q.proposal.options[1].badge === 'Most popular')
  check('the proposal carries the site plan, deposit and financing', !!q?.proposal.planSvg?.startsWith('<svg') && q.proposal.depositPct === 50 && q.proposal.financing?.months === 60)
  const sixIndex = offered.indexOf(SIX), tanIndex = offered.indexOf(TAN)
  const sixOpt = q.proposal.options[sixIndex]
  const token = (await api(`/api/saved-quotes/${quoteId}/share-token`, { method: 'POST' })).shareToken
  const again = (await api(`/api/saved-quotes/${quoteId}/share-token`, { method: 'POST' })).shareToken
  check('a link already made keeps working (same link the second time)', token === again)

  // ── The customer's page on a phone ──
  const res = await fetch(`${API}/p/${token}`)
  const html = await res.text()
  check('customer page: strict security policy', /default-src 'none'/.test(res.headers.get('content-security-policy') || ''))
  check('customer page: no costs, margin or pull sheet in it', !html.includes(String(q.totalCOGS)) && !/materialCost|totalCOGS|pullSheet|gmPct|Picket, 62/.test(html))
  const c = await open(browser, true)
  await c.page.goto(`${API}/p/${token}`); await sleep(1200)
  const pageText = (await c.page.locator('body').textContent()).replace(/\s+/g, ' ')
  const opts = await c.page.locator('.opt').count()
  check('customer page: every option offered, tiers side by side, Better marked Most popular', opts === offered.length && await c.page.locator('.opts.tiers').count() === 1 && (await c.page.locator('.opt').nth(1).textContent()).includes('Most popular'))
  check('customer page: each tier says what makes it better', ['Dig set: posts set in concrete.', 'No dig: steel pipe driven deep, no concrete, faster install.'].every(t => pageText.includes(t)))
  check('customer page: site plan, monthly payment, deposit, warranty, what is included', ['Site plan', 'As low as $', '/month for 60 months', 'Deposit', '50% to schedule', 'Warranty', "What's included", '446 ft of new fence'].every(t => pageText.includes(t)), pageText.slice(0, 200))
  check('customer page: the tan option shows its style photo', await c.page.locator('.opt').nth(tanIndex).locator('img.photo').count() === 1)
  if (SHOTS) await c.page.screenshot({ path: `${SHOTS}/3-customer-proposal-top.png` })
  await c.page.locator('.opt').nth(sixIndex).click(); await sleep(200)
  const dep = (await c.page.locator('#deposit b').textContent()).trim()
  check('choosing an option updates the deposit', dep === '$' + Math.round(sixOpt.finalPrice / 2).toLocaleString('en-US'), dep)
  await c.page.locator('#name').fill('Shawn Collins')
  const sig = await c.page.locator('#sig').boundingBox()
  // A finger signature: pointer events as a phone sends them.
  const pt = (i) => ({ clientX: sig.x + 30 + i * 20, clientY: sig.y + 80 + (i % 2 ? -25 : 25), pointerId: 7, pointerType: 'touch', bubbles: true })
  await c.page.locator('#sig').dispatchEvent('pointerdown', pt(0))
  for (let i = 1; i <= 12; i++) await c.page.locator('#sig').dispatchEvent('pointermove', pt(i))
  await c.page.locator('#sig').dispatchEvent('pointerup', pt(12))
  if (SHOTS) { await c.page.locator('#accept').scrollIntoViewIfNeeded(); await c.page.screenshot({ path: `${SHOTS}/4-customer-sign.png` }) }
  await c.page.locator('#go').click(); await sleep(2000)
  const err = (await c.page.locator('#err').textContent().catch(() => '')) || ''
  if (err) console.log('page said:', err)
  const after = (await c.page.locator('body').textContent()).replace(/\s+/g, ' ')
  check('customer page: accepted, with the option and price', after.includes('Accepted by Shawn Collins') && after.includes(sixOpt.label), after.slice(after.indexOf('Accepted'), after.indexOf('Accepted') + 160))
  if (SHOTS) await c.page.screenshot({ path: `${SHOTS}/5-customer-accepted.png` })
  check('customer page: read only after accepting (no Accept button)', await c.page.locator('#go').count() === 0)
  check('customer page: no page errors', c.errors.length === 0, c.errors.join(' | '))
  const twice = await fetch(`${API}/p/${token}/accept`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ option: 0, name: 'Someone else', signature: 'data:image/png;base64,iVBORw0KGgo=' }) })
  check('cannot be accepted twice', twice.status === 409, String(twice.status))
  await c.ctx.close()

  const sold = await api(`/api/saved-quotes/${quoteId}`)
  check('the quote is sold as the chosen option, priced as it was offered', sold.status === 'SOLD' && sold.fenceStyle === SIX && sold.finalPrice === sixOpt.finalPrice && sold.chosenOption === sixIndex,
    `${sold.status} ${sold.fenceStyle} ${sold.finalPrice} vs ${sixOpt.finalPrice}`)
  check('its pull sheet and sections per run are that option\'s', sold.sections === sixOpt.sections && sold.layout.runSections.join(',') === sixOpt.snapshot.runSections.join(',') && sold.pullSheet.some(i => /Rail, 6'/.test(i.item)))

  const pipe = await api('/api/pipeline')
  const card = pipe.leads.find(l => l.customerId === sold.crmContactId && l.stage === 'Signed Contract')
  check('the pipeline card moved to Signed Contract with the price', !!card && card.jobValue === sixOpt.finalPrice, card ? `${card.stage} ${card.jobValue}` : 'no card')
  const notes = await api('/api/automations/notifications')
  const note = (notes.notifications || []).find(n => n.title === 'Proposal accepted: Shawn Collins')
  check('an in app notification says who accepted what', !!note && note.body.includes(sixOpt.label), note?.body || 'none')

  // ── Back in the app: the quote shows the customer's choice ──
  await d.page.goto(`${APP}/?customer=${sold.crmContactId}`); await d.page.waitForSelector('[data-global-appointment]'); await sleep(1200)
  await d.page.locator('button.capitalize', { hasText: /^quotes/i }).first().click(); await sleep(500)
  await d.page.locator(`text=$${Math.round(sold.finalPrice).toLocaleString('en-US')}`).first().click(); await sleep(800)
  const chosenText = (await d.page.locator('[data-proposal-chosen]').textContent().catch(() => '')) || ''
  check('the saved quote shows who accepted which option', chosenText.includes('Accepted by Shawn Collins') && chosenText.includes(sixOpt.label), chosenText)
  check('and Text it / Email it / Open buttons, with the link date', await d.page.locator('[data-proposal-text]').count() === 1 && await d.page.locator('[data-proposal-open]').count() === 1 && /Link works until/.test(await d.page.locator('[data-link-state]').textContent()))
  await d.page.locator('[data-link-off]').click(); await sleep(800)
  check('Turn off link: the quote says it is off', /Link turned off/.test(await d.page.locator('[data-link-state]').textContent()))
  const offRes = await fetch(`${API}/p/${token}`)
  const offHtml = await offRes.text()
  check('a turned off link shows a friendly page with the phone number', offRes.status === 410 && offHtml.includes('This link is no longer active') && /tel:\d+/.test(offHtml))
  if (SHOTS) { await d.page.locator('[data-proposal-send]').scrollIntoViewIfNeeded(); await d.page.screenshot({ path: `${SHOTS}/6-quote-proposal-block.png` }) }
  check('desktop: no page errors', d.errors.length === 0, d.errors.join(' | '))
  await setProposalSettings(d.page, '', '', '')
  await d.ctx.close()
} catch (e) {
  check('test run finished', false, String(e).split('\n').slice(0, 3).join(' '))
} finally {
  // Accepting online makes a job: remove it with the quote.
  if (quoteId) for (const j of (await api('/api/saved-jobs')).filter(j => j.quoteId === quoteId)) await api(`/api/saved-jobs/${j.id}`, { method: 'DELETE' })
  if (quoteId) await api(`/api/saved-quotes/${quoteId}`, { method: 'DELETE' })
  if (photoId) await api(`/api/style-photos/${photoId}`, { method: 'DELETE' })
  await browser.close()
}
const passed = results.filter(Boolean).length
console.log(`\n${passed} of ${results.length} checks passed`)
process.exit(passed === results.length ? 0 : 1)
