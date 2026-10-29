// Instant proposal, end to end on the dev copy.
//
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 \
//   E2E_ACCESS_TOKEN=<dev staff token> node e2e/proposal.mjs
//
// Settings → Proposals (deposit, financing, a style photo), Compare options
// on a quote, save, then the customer's page on a phone: pick another
// option, sign, accept, and the quote becomes that option as priced. The
// test quote and photo are removed and the settings put back at the end. It quotes a customer
// of its own, with a pipeline card (made through the API and removed at the end), never a real one.

import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import { chromium } from 'playwright'
import fs from 'fs'
import { execFileSync } from 'child_process'
import path from 'path'
import crypto from 'crypto'

const APP = process.env.APP_URL || 'http://localhost:4001'
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
// Its own customer (it used to quote a real customer of the dev copy, Shawn Collins); the signer is Shawn Collins.
const CUST_LAST = `Collins E2E${Date.now().toString(36)}`, CUST = `Shawn ${CUST_LAST}`
const contactId = crypto.randomUUID(), cardId = crypto.randomUUID()
const TAN = "TV-ND 6'x8' Privacy", SIX = "WV-ND 6'x6' Privacy", OWN = "WV-ND 6'x8' Privacy"
async function setProposalSettings(page, dep, months, apr) {
  await page.goto(APP); await page.waitForSelector('[data-global-appointment]', { timeout: 30000 }); await sleep(800)
  await page.locator('span:text-is("Settings"):visible').first().click(); await sleep(500)
  await page.locator('[data-settings-tab="proposals"]').click(); await sleep(400)
  await page.locator('[data-deposit-pct]').fill(dep)
  await page.locator('[data-fin-months]').fill(months)
  await page.locator('[data-fin-apr]').fill(apr)
  // Settings redesign (docs/FEATURES.md 9aa, Oct 23): each page has its own "Save changes" bar, shown only after a change.
  const save = page.locator('[data-settings-save]')
  if (await save.isVisible().catch(() => false)) { await save.click(); await page.waitForFunction(() => !document.querySelector('[data-settings-save]'), null, { timeout: 15000 }).catch(() => {}) }
  await sleep(1200)
}
try {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  await api('/api/crm-contacts', { method: 'POST', body: JSON.stringify({ id: contactId, firstName: 'Shawn', lastName: CUST_LAST, phone: '3525550168', email: 'e2e-proposal@example.invalid', serviceAddress: '110 SE Watula Ave, Ocala, FL 34471', leadSource: 'Other',
    lead: { id: cardId, customerId: contactId, firstName: 'Shawn', lastName: CUST_LAST, phone: '3525550168', stage: 'Pending Signature', leadSource: 'Other', createdAt: today, lastMoved: today }, leadBefore: null }) })
  // ── Settings: deposit, financing and a photo for the tan style ──
  const d = await open(browser, false)
  await setProposalSettings(d.page, '50', '60', '9.99')
  const form = new FormData()
  form.append('styleName', TAN)
  form.append('photo', new Blob([fs.readFileSync(new URL('../public/icon-512.png', import.meta.url))], { type: 'image/png' }), 'tan.png')
  photoId = (await api('/api/style-photos', { method: 'POST', body: form })).id
  await d.page.reload(); await d.page.waitForSelector('[data-global-appointment]'); await sleep(800)
  await d.page.locator('span:text-is("Settings"):visible').first().click(); await sleep(400)
  await d.page.locator('[data-settings-tab="proposals"]').click(); await sleep(800)
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
  await b.locator('select').filter({ hasText: 'Select a fence style' }).selectOption({ label: 'White Vinyl Privacy, 6 ft tall, 8 ft panels, No dig' }); await sleep(400)
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
  // Colors added with Settings > Vinyl Colors (Chai Gray on the dev copy) are compared too, on top of white and tan.
  const keys = await b.locator('[data-compare-row]').evaluateAll(els => els.map(e => e.getAttribute('data-compare-row')))
  const wt = keys.filter(k => /^(WV|TV)-/.test(k)).length
  check('compare: white vs tan, no dig vs dig set, 6 vs 8 wide (plus any added color)', wt >= 7 && wt <= 8, `${rows} rows: ${keys.join(', ')}`)
  check('compare: shows what each costs against this quote', /\+\$[\d,]+\.\d\d/.test(sixRow), sixRow)
  await b.locator(`[data-compare-row="${TAN}"] input`).check()
  await b.locator(`[data-compare-row="${SIX}"] input`).check()
  if (SHOTS) { await b.locator('[data-compare]').scrollIntoViewIfNeeded(); await p.screenshot({ path: `${SHOTS}/2-phone-compare-options.png` }) }
  await p.locator('[data-quote-bar] [data-save-open]').click()
  await p.locator('input[placeholder="Name, phone, or email..."]').fill(CUST); await sleep(600)
  await p.locator(`text=${CUST}`).last().click()
  await p.locator('button:has-text("Save quote")').last().click(); await sleep(2500)
  check('phone: no page errors while quoting', s.errors.length === 0, s.errors.join(' | '))
  await s.ctx.close()

  const list = await api('/api/saved-quotes')
  const q = (Array.isArray(list) ? list : []).filter(x => x.crmContactId === contactId && x.proposal?.options?.length >= 3 && !x.acceptedAt).sort((a, z) => String(z.createdAt).localeCompare(String(a.createdAt)))[0]
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
  check('customer page: each tier says what makes it better', ['Posts set in concrete. Solid fence at the best price.', 'Steel pipe driven deep, no concrete, faster install.', 'More posts per foot for the strongest fence we build.'].every(t => pageText.includes(t)))
  check('customer page: site plan, monthly payment, deposit, warranty, what is included', ['Site plan', 'As low as $', '/month for 60 months', 'Deposit', '50% to schedule', 'Warranty', "What's included", '446 ft of new fence'].every(t => pageText.includes(t)), pageText.slice(0, 200))
  check('customer page: the tan option shows its style photo', await c.page.locator('.opt').nth(tanIndex).locator('img.photo').count() === 1)
  if (SHOTS) await c.page.screenshot({ path: `${SHOTS}/3-customer-proposal-top.png` })
  await c.page.locator('.opt').nth(sixIndex).click(); await sleep(200)
  const dep = (await c.page.locator('#deposit b').textContent()).trim()
  // The deposit as the app works it out (portal lib/paymentMath.ts depositOf): a whole dollar quote's deposit is rounded down to the dollar.
  const depCents = Math.round(Math.round(sixOpt.finalPrice * 100) * 50 / 100)
  const depWant = q.proposal.wholeDollar === true ? '$' + Math.floor(depCents / 100).toLocaleString('en-US') : '$' + (depCents / 100).toLocaleString('en-US', { minimumFractionDigits: depCents % 100 ? 2 : 0, maximumFractionDigits: 2 })
  check('choosing an option updates the deposit', dep === depWant, `${dep} (want ${depWant})`)
  await c.page.locator('#name').fill('Shawn Collins')
  // A finger signature: pointer events as a phone sends them.
  const signOn = async pg => {
    await pg.locator('#sig').scrollIntoViewIfNeeded()
    const sig = await pg.locator('#sig').boundingBox()
    const pt = (i) => ({ clientX: sig.x + 30 + i * 20, clientY: sig.y + 80 + (i % 2 ? -25 : 25), pointerId: 7, pointerType: 'touch', bubbles: true })
    await pg.locator('#sig').dispatchEvent('pointerdown', pt(0))
    for (let i = 1; i <= 12; i++) await pg.locator('#sig').dispatchEvent('pointermove', pt(i))
    await pg.locator('#sig').dispatchEvent('pointerup', pt(12))
  }
  await signOn(c.page)
  if (SHOTS) { await c.page.locator('#accept').scrollIntoViewIfNeeded(); await c.page.screenshot({ path: `${SHOTS}/4-customer-sign.png` }) }
  // A second phone with the proposal open from before it was signed (the other one of the household).
  const stale = await open(browser, true)
  await stale.page.goto(`${API}/p/${token}`); await sleep(1000)
  await c.page.locator('#go').click(); await sleep(2000)
  const err = (await c.page.locator('#err').textContent().catch(() => '')) || ''
  if (err) console.log('page said:', err)
  const after = (await c.page.locator('body').textContent()).replace(/\s+/g, ' ')
  check('customer page: accepted, with the option and price', after.includes('Accepted by Shawn Collins') && after.includes(sixOpt.label), after.slice(after.indexOf('Accepted'), after.indexOf('Accepted') + 160))
  if (SHOTS) await c.page.screenshot({ path: `${SHOTS}/5-customer-accepted.png` })
  check('customer page: read only after accepting (no Accept button)', await c.page.locator('#go').count() === 0)
  // Signed: only the signed option, no "Save $" on the ones not picked, Accepted and the contract near the top (review Oct 27 2026).
  const shownAfter = await c.page.locator('.opt[data-option]').evaluateAll(els => els.map(e => e.getAttribute('data-option')))
  check('customer page after signing: only the signed option, no "Save $"', shownAfter.join() === String(sixIndex) && !after.includes('Save $') && !after.includes('Recommended'), `${shownAfter.join()} vs ${sixIndex}`)
  // Where the customer is after the reload: on the phone's screen, not scrolled down to where the Accept button was.
  const acceptedTop = await c.page.locator('[data-accepted]').boundingBox(), pdfTop = await c.page.locator('[data-contract-pdf]').boundingBox(), optTop = await c.page.locator('.opt[data-option]').first().boundingBox()
  check('customer page after signing: Accepted and the signed contract (PDF) on the first screen, before the fence', !!acceptedTop && !!pdfTop && !!optTop && acceptedTop.y >= 0 && pdfTop.y + pdfTop.height <= 915 && pdfTop.y < optTop.y, `accepted at ${acceptedTop?.y}, pdf at ${pdfTop?.y}, fence at ${optTop?.y}`)
  check('customer page: no page errors', c.errors.length === 0, c.errors.join(' | '))
  const post = (option, name) => fetch(`${API}/p/${token}/accept`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ option, name, signature: 'data:image/png;base64,iVBORw0KGgo=' }) }).then(async r => ({ status: r.status, json: await r.json().catch(() => ({})) }))
  // The same option signed again by someone else of the household: it stands, no error and no bell notice.
  const spouse = await post(sixIndex, 'Pat Collins')
  check('the same option signed again (someone else of the household): accepted as it stands, no error', spouse.status === 200 && spouse.json.success === true, `${spouse.status} ${spouse.json.error ?? ''}`)
  // The second phone, opened before: another option, signed and sent. Refused; the page reloads to what stands, saying why first.
  check('second phone: the page from before still shows every option', await stale.page.locator('.opt[data-option]').count() === offered.length)
  await stale.page.locator('.opt').nth(0).click(); await sleep(200)
  await stale.page.locator('#name').fill('Someone else')
  await signOn(stale.page)
  await stale.page.locator('#go').click()
  await stale.page.waitForSelector('[data-refused]', { timeout: 15000 }).catch(() => {})
  await sleep(500)
  const refusedText = ((await stale.page.locator('[data-refused]').textContent().catch(() => '')) || '').trim()
  const staleText = (await stale.page.locator('body').textContent()).replace(/\s+/g, ' ')
  const rb = await stale.page.locator('[data-refused]').boundingBox().catch(() => null)
  check('second phone: the refusal is on the screen, at the top', !!rb && rb.y >= 0 && rb.y + rb.height <= 915, `at ${rb?.y}`)
  check('second phone: refused, naming the signed option and the number to call', /^This proposal was already accepted for .+\. To make a change, please call us at \(\d{3}\) \d{3} \d{4}\.$/.test(refusedText) && refusedText.includes(`for ${sixOpt.label}.`), refusedText)
  check('second phone: now shows only the signed option, Accepted, and a plain address', await stale.page.locator('.opt[data-option]').count() === 1 && staleText.includes('Accepted by Shawn Collins') && await stale.page.locator('#go').count() === 0 && !stale.page.url().includes('refused='), stale.page.url())
  if (SHOTS) await stale.page.screenshot({ path: `${SHOTS}/5b-second-phone-refused.png` })
  check('second phone: no page errors', stale.errors.length === 0, stale.errors.join(' | '))
  await stale.ctx.close()
  const twice = await post(0, 'Someone else')
  check('cannot be accepted twice (another option)', twice.status === 409 && twice.json.reload === true, `${twice.status} ${twice.json.error}`)
  await c.ctx.close()

  const sold = await api(`/api/saved-quotes/${quoteId}`)
  check('the quote is sold as the chosen option, priced as it was offered', sold.status === 'SOLD' && sold.fenceStyle === SIX && sold.finalPrice === sixOpt.finalPrice && sold.chosenOption === sixIndex,
    `${sold.status} ${sold.fenceStyle} ${sold.finalPrice} vs ${sixOpt.finalPrice}`)
  check('its pull sheet and sections per run are that option\'s', sold.sections === sixOpt.sections && sold.layout.runSections.join(',') === sixOpt.snapshot.runSections.join(',') && sold.pullSheet.some(i => /Rail, 6'/.test(i.item)))

  const pipe = await api('/api/pipeline')
  const card = pipe.leads.find(l => l.customerId === sold.crmContactId && l.stage === 'Signed Contract')
  check('the pipeline card moved to Signed Contract with the price', !!card && card.jobValue === sixOpt.finalPrice, card ? `${card.stage} ${card.jobValue}` : `no card; the customer's cards: ${JSON.stringify(pipe.leads.filter(l => l.customerId === sold.crmContactId || l.id === cardId).map(l => [l.id, l.stage, l.customerId]))}`)
  const notes = await api('/api/automations/notifications')
  const note = (notes.notifications || []).find(n => n.title === `Proposal accepted: ${CUST}`)
  check('an in app notification says who accepted what', !!note && note.body.includes(sixOpt.label), note?.body || 'none')
  // The second signing was refused; the owner and the office hear what was tried (audit fix Oct 27 2026), the essentials in the title.
  const conflicts = (notes.notifications || []).filter(n => n.title.startsWith(`Proposal conflict: ${CUST} `))
  const tried = conflicts[0]
  check('the refused signing is on the bell: who tried what, and what stands, in the title; a warning', conflicts.length === 1 && tried.title === `Proposal conflict: ${CUST} tried ${q.proposal.options[0].label}; ${sixOpt.label} stands` && tried.type === 'warning' && tried.body.startsWith('Someone else tried to accept') && tried.body.includes(`already accepted by Shawn Collins`), conflicts.map(n => n.title).join(' | ') || 'none')
  check('the same option signed again made no notice', !(notes.notifications || []).some(n => n.body?.startsWith('Pat Collins')))
  // Tapping it on a phone: the warning shows whole, and opens the quote on the customer's Quotes tab.
  const o = await open(browser, true)
  await o.page.goto(APP); await o.page.waitForSelector('[data-tabbar]', { timeout: 30000 }); await sleep(1000)
  await o.page.locator('button[aria-label="Notifications"]:visible').first().click(); await sleep(800)
  const bellRow = o.page.locator(`[data-notification-kind="warning"]:has-text("Proposal conflict: ${CUST}")`).first()
  check('bell: the conflict is styled as a warning, its title whole', await bellRow.count() === 1 && (await bellRow.textContent()).includes(`${sixOpt.label} stands`))
  await bellRow.click(); await sleep(2000)
  check('bell: tapping it opens the quote on the customer\'s Quotes tab', o.page.url().includes(`/customers/${sold.crmContactId}`) && o.page.url().includes(`qv=${quoteId}`) && await o.page.locator('[data-proposal-chosen]').count() > 0, o.page.url())
  check('bell on a phone: no page errors', o.errors.length === 0, o.errors.join(' | '))
  await o.ctx.close()

  // ── Back in the app: the quote shows the customer's choice ──
  await d.page.goto(`${APP}/?customer=${sold.crmContactId}`); await d.page.waitForSelector('[data-global-appointment]'); await sleep(1200)
  await d.page.locator('[data-customer-tab="quotes"]').first().click(); await sleep(500)
  // The quote row's price, not the job's "Change order ($…)" button that shows the same amount.
  await d.page.locator(`[data-customer-quote="${quoteId}"]`).first().click(); await sleep(800)
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
  // Its customer and card.
  const pl = await api('/api/pipeline')
  const cards = (pl?.leads ?? []).filter(l => l.customerId === contactId || l.id === cardId).map(l => l.id)
  if (cards.length) await api('/api/pipeline', { method: 'PATCH', body: JSON.stringify({ upsert: [], remove: cards, baseVersion: pl.version }) })
  await api(`/api/crm-contacts/${contactId}`, { method: 'DELETE' })
  // What the app keeps once sold (the job, its payment schedule, the signed quote): removed from the dev copy by id.
  const psql = q => { try { execFileSync('psql', ['-d', 'ezbiz_dev', '-q', '-c', q], { stdio: 'ignore' }) } catch { /* nothing to remove */ } }
  const jobs = `select id from "SavedJob" where "crmContactId" = '${contactId}'`
  for (const t of ['PaymentSchedule', 'ContractPayment', 'ContractInvoice', 'BillingLog', 'JobChecklistItem', 'Notification', 'InstallPacket']) psql(`delete from "${t}" where "jobId" in (${jobs})`)
  psql(`delete from "AutomationEvent" where "entityId" in (${jobs}) or "entityId" = '${cardId}'`)
  psql(`delete from "SavedJob" where "crmContactId" = '${contactId}'`)
  psql(`delete from "SignedDocument" where "quoteId" in (select id from "SavedQuote" where "crmContactId" = '${contactId}')`)
  psql(`delete from "JobQuotedCost" where "quoteId" in (select id from "SavedQuote" where "crmContactId" = '${contactId}')`)
  psql(`delete from "SavedQuote" where "crmContactId" = '${contactId}'`)
  psql(`delete from "Notification" where title = 'Proposal accepted: ${CUST}' or title like 'Proposal conflict: ${CUST} %'`)
  psql(`delete from "CrmContactNote" where "crmContactId" = '${contactId}'; delete from "CrmContact" where id = '${contactId}'`)
  await browser.close()
}
const passed = results.filter(Boolean).length
console.log(`\n${passed} of ${results.length} checks passed`)
process.exit(passed === results.length ? 0 : 1)
