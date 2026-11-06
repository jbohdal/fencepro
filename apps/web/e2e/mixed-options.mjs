// Proposal options of any fence style, end to end on the dev copy (Jonathan, Nov 2 2026). As the Salesman on a phone
// (WebKit, iPhone size): one drawn yard, an aluminum quote with a chain link option, and a vinyl quote with a wood
// option; swap styles, add and remove options, pick Most popular, save, send. As the customer: see each option, sign
// the one that is not the quote's own. As the owner: the contract, deposit, Sales Order, pull sheet, warranty and job are
// that option; a change order on it follows it.
//
//   APP_URL=http://localhost:4093 API_URL=http://localhost:4093 E2E_STAFF_COOKIE=<owner cookie value> \
//   SALES_COOKIE=<Salesman cookie value> SHOTS=<folder> node e2e/mixed-options.mjs
//
// Makes throwaway quotes named "Mixed e2e ... <run>" and removes them, and what signing made, by id at the end.
import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import { webkit } from 'playwright'
import { execFileSync } from 'child_process'
import { signInByCookie, pickStyle, walkFence, sidesOf } from './lib.mjs'
import { devSignIn, DEV_SALES_EMAIL } from './devSignIn.mjs'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || APP
const OWNER = process.env.E2E_STAFF_COOKIE || ''
// Not given (the nightly gives the owner's sign in only): the Salesman's made here.
const SALES = process.env.SALES_COOKIE || devSignIn(DEV_SALES_EMAIL, { cookie: true })
const SHOTS = process.env.SHOTS || ''
if (!OWNER || !SALES) { console.error('Set E2E_STAFF_COOKIE and SALES_COOKIE.'); process.exit(2) }

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const dollars = s => Number(String(s).replace(/[^0-9.]/g, ''))
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
const run = Date.now().toString(36)

async function phone(browser, cookie) {
  const ctx = await browser.newContext(PHONE)
  await signInByCookie(ctx, { cookie, api: API })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 300)))
  page.on('dialog', d => d.accept().catch(() => {}))
  return { ctx, page, errors }
}

/** A new quote up to the Price step: the same drawn yard every time. */
async function quoteUpToPrice(page, name, styleText, shape = 'backyard', sides = [['Left return', '20', 'Walk gate'], ['Left side', '95'], ['Back', '128', 'Double gate'], ['Right side', '95'], ['Right return', '20']]) {
  const b = page.locator('[data-quote-builder]'), bar = page.locator('[data-quote-bar]')
  await page.goto(`${APP}/quotes`); await page.waitForSelector('[data-tabbar]', { timeout: 30000 }); await sleep(1500)
  await page.locator('button:has-text("New quote"):visible').first().tap(); await sleep(800)
  await b.locator('input[placeholder^="Customer name"]').fill(name)
  await bar.locator('[data-bar-next]').tap(); await sleep(300)
  await walkFence(page, sidesOf(sides, shape === 'perimeter'))
  await bar.locator('[data-bar-next]').tap(); await sleep(400)
  await pickStyle(page, styleText)
  await bar.locator('[data-bar-next]').tap()
  await b.locator('[data-tiers]').waitFor({ timeout: 15000 })
  await sleep(1500)
  return b
}

const card = (b, key) => b.locator(`[data-tier="${key}"]`)
const priceOf = async (b, key) => dollars(await card(b, key).locator('[data-tier-price]').textContent())
const swap = async (b, key, text) => {
  const sel = card(b, key).locator('[data-tier-swap]')
  const value = await sel.evaluate((el, t) => [...el.options].find(o => new RegExp(t, 'i').test(o.textContent))?.value, text)
  if (value === undefined) throw new Error(`no style like ${text} in ${(await sel.locator('option').allTextContents()).join(' / ')}`)
  await sel.selectOption(value); await sleep(1500)
}
async function addOption(b, text) {
  const sel = b.locator('[data-option-add] select')
  const value = await sel.evaluate((el, t) => [...el.options].find(o => new RegExp(t, 'i').test(o.textContent))?.value, text)
  await sel.selectOption(value); await sleep(1500)
}
async function save(page, name) {
  await page.locator('[data-quote-bar] [data-save-open]').tap(); await sleep(500)
  await page.locator('[data-save-mode="new"]').tap(); await sleep(300)
  await page.locator('[data-save-submit]').tap(); await sleep(3500)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/saved-${name.split(' ')[2]}.png` })
}
const quotesNamed = async (ctx, name) => {
  const j = await (await ctx.request.get(`${API}/api/saved-quotes?full=1`)).json()
  return (j.data ?? []).filter(q => q.customerName.startsWith(name))
}
async function customerSigns(browser, token, text, shot) {
  const ctx = await browser.newContext(PHONE)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 300)))
  await page.goto(`${API}/p/${token}`); await sleep(1200)
  const cards = await page.locator('.opt[data-option]').evaluateAll(els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()))
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${shot}-page.png`, fullPage: true })
  const target = page.locator('.opt[data-option]', { hasText: new RegExp(text, 'i') }).first()
  await target.locator('input').check({ force: true }); await sleep(300)
  const warranty = await page.locator('#wname').textContent()
  const deposit = await page.locator('#deposit').textContent().catch(() => '')
  await page.locator('#name').fill('Mixed Customer')
  await page.locator('#sig').scrollIntoViewIfNeeded()
  const sig = await page.locator('#sig').boundingBox()
  const pt = i => ({ clientX: sig.x + 30 + i * 20, clientY: sig.y + 80 + (i % 2 ? -25 : 25), pointerId: 7, pointerType: 'touch', bubbles: true })
  await page.locator('#sig').dispatchEvent('pointerdown', pt(0))
  for (let i = 1; i <= 12; i++) await page.locator('#sig').dispatchEvent('pointermove', pt(i))
  await page.locator('#sig').dispatchEvent('pointerup', pt(12))
  await page.locator('#go').tap(); await sleep(3500)
  const done = await page.locator('[data-accepted]').textContent().catch(() => '')
  const after = await page.locator('.opt[data-option]').count()
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${shot}-signed.png`, fullPage: true })
  const pdf = await page.request.get(`${API}/p/${token}/contract.pdf`)
  await ctx.close()
  return { cards, warranty, deposit, done, after, errors, pdfOk: pdf.ok() }
}

const browser = await webkit.launch()
try {
  const christa = await phone(browser, SALES)
  const { page } = christa

  // ── Aluminum with a chain link option ──
  const A = `Mixed e2e alum ${run}`
  let b = await quoteUpToPrice(page, A, 'Aluminum.*No dig')
  check('aluminum: two options start as they always did', (await b.locator('[data-tier]').count()) === 2 && (await card(b, 'better').locator('[data-tier-name]').textContent()) === 'No dig')
  const alumPrice = await priceOf(b, 'better')
  check('the Change style list has every material, by group', (await card(b, 'good').locator('[data-tier-swap] optgroup').evaluateAll(g => g.map(x => x.label))).join() .match(/Vinyl/) && (await card(b, 'good').locator('[data-tier-swap] optgroup').count()) >= 4)
  await swap(b, 'good', 'Galvanized.*4 ft.*No dig|4 ft.*Galvanized.*No dig')
  const clPrice = await priceOf(b, 'good')
  check('chain link option: its own name and a lower price', (await card(b, 'good').locator('[data-tier-name]').textContent()) === 'Chain link' && clPrice < alumPrice, `chain link $${clPrice}, aluminum $${alumPrice}`)
  check('chain link option: its own warranty and the words of its own material', /Warranty:/.test(await card(b, 'good').locator('[data-tier-warranty]').textContent()) && /Schedule 40/.test(await card(b, 'good').locator('[data-tier-text]').textContent()), await card(b, 'good').textContent())
  await addOption(b, 'White Vinyl Privacy.*6 ft tall.*No dig')
  const added = card(b, 'added1')
  check('Add option: a third option of any material', (await b.locator('[data-tier]').count()) === 3 && /Vinyl/.test(await added.locator('[data-tier-name]').textContent()), `$${await priceOf(b, 'added1')}`)
  check('three on the proposal: no more can be added', (await b.locator('[data-option-add]').count()) === 0)
  await added.locator('[data-tier-popular-pick]').tap(); await sleep(1200)
  check('Most popular moves: one at most', (await b.locator('[data-tier-popular]').count()) === 1 && (await added.locator('[data-tier-popular]').count()) === 1)
  if (SHOTS) { await b.locator('[data-tiers]').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${SHOTS}/a-phone-options.png`, fullPage: false }) }
  await added.locator('[data-option-remove]').tap(); await sleep(1500)
  check('Remove: the option is gone and no option is Most popular', (await b.locator('[data-tier]').count()) === 2 && (await b.locator('[data-tier-popular]').count()) === 0)
  await card(b, 'good').locator('[data-tier-popular-pick]').tap(); await sleep(1200)
  check('Most popular on the chain link option', (await card(b, 'good').locator('[data-tier-popular]').count()) === 1)
  check('the main option cannot be unticked', await card(b, 'better').locator('input[type="checkbox"]').isDisabled())
  await save(page, A)
  let q = (await quotesNamed(christa.ctx, A))[0]
  check('saved: two options, the server\'s prices', q?.proposal?.options?.length === 2 && Math.round(q.proposal.options[0].finalPrice) === Math.round(clPrice), JSON.stringify(q?.proposal?.options?.map(o => [o.tier?.label, o.fenceStyle, o.finalPrice, o.warranty?.name, o.badge])))
  const chain = q.proposal.options.find(o => /^CL/.test(o.fenceStyle) || o.fenceStyle.startsWith('chain'))
  check('saved: the chain link option has its own pull sheet, snapshot from the server', chain.snapshot?.pullSheet?.length > 3 && chain.snapshot.totalCOGS > 0 && !chain.snapshot.pullSheet.some(l => /Emily/.test(l.item)))
  check('walked: no site plan picture on the mixed proposal yet (so no one style\'s section count)', !q.proposal.planSvg)
  const ta = (await (await christa.ctx.request.post(`${API}/api/saved-quotes/${q.id}/share-token`, { headers: { 'X-Staff-Request': '1' } })).json()).data
  check('the Salesman gets the link', !!ta?.shareToken)
  await christa.ctx.request.patch(`${API}/api/saved-quotes/${q.id}`, { headers: { 'X-Staff-Request': '1', 'Content-Type': 'application/json' }, data: { status: 'SENT' } })
  const sa = await customerSigns(browser, ta.shareToken, 'Chain link', 'a')
  check('customer: both options, each with its name, price and warranty', sa.cards.length === 2 && sa.cards.some(c => /Chain link/.test(c) && /Warranty/.test(c) && /Most popular/.test(c)) && sa.cards.some(c => /No dig/.test(c) && /Aluminum/i.test(c)), sa.cards.join(' || '))
  check('customer: the warranty and deposit follow the option tapped', !!sa.warranty, `${sa.warranty}; ${sa.deposit}`)
  check('customer: signed, only that fence shows, the contract opens', /Chain Link/i.test(sa.done) && sa.after === 1 && sa.pdfOk, sa.done)
  check('customer: no page errors', sa.errors.length === 0, sa.errors.join('|'))

  // ── As the owner ──
  const owner = await phone(browser, OWNER)
  q = (await (await owner.ctx.request.get(`${API}/api/saved-quotes/${q.id}`)).json()).data
  const q0 = q
  check('owner: the quote is the signed option', q.fenceStyle === chain.fenceStyle && q.finalPrice === chain.finalPrice && q.sections === chain.sections, `${q.fenceStyle} $${q.finalPrice}, ${q.sections} sections`)
  check('owner: costs and pull sheet are the option\'s', q.totalCOGS === chain.snapshot.totalCOGS && JSON.stringify(q.pullSheet) === JSON.stringify(chain.snapshot.pullSheet))
  const jobs = (await (await owner.ctx.request.get(`${API}/api/saved-jobs`)).json()).data ?? []
  const job = jobs.find(j => j.quoteId === q.id)
  check('owner: the job is the signed style and price', job?.fenceStyle === chain.fenceStyle && job?.contractValue === chain.finalPrice, `${job?.fenceStyle} $${job?.contractValue}`)
  const bill = await (await owner.ctx.request.get(`${API}/api/billing/schedule/${job?.id}`)).json().catch(() => null)
  console.log('      schedule:', JSON.stringify(bill?.data ?? bill)?.slice(0, 240))
  await owner.page.goto(`${APP}/?quote=${q.id}`)
  const ob = owner.page.locator('[data-quote-builder]')
  await ob.waitFor({ timeout: 30000 }); await sleep(1500)
  await ob.locator('[data-step="price"]').tap(); await sleep(1500)
  check('owner: the signed quote\'s Price step shows the signed fence and "As signed"', /As signed/.test(await ob.locator('[data-tiers]').textContent()) && Math.round(await priceOf(ob, 'good')) === Math.round(chain.finalPrice), (await ob.locator('[data-tiers]').textContent()).slice(0, 200))
  if (SHOTS) await owner.page.screenshot({ path: `${SHOTS}/a-owner-signed-price.png` })
  check('owner: no page errors', owner.errors.length === 0, owner.errors.join('|'))

  // ── Vinyl with a wood option ──
  const V = `Mixed e2e vinyl ${run}`
  const christa2 = await phone(browser, SALES)
  const page2 = christa2.page
  await christa.ctx.close()
  b = await quoteUpToPrice(page2, V, 'White Vinyl Privacy.*(6 or 8 ft|best price).*No dig')
  const beforeBetter = await priceOf(b, 'better')
  check('vinyl: Good, Better, Best to start', (await b.locator('[data-tier]').count()) === 3)
  await swap(b, 'good', 'Wood.*Stockade.*(pine|PT).*')
  const woodPrice = await priceOf(b, 'good')
  check('wood option: priced, its name stays Good, its own words', woodPrice > 0 && /pine/i.test(await card(b, 'good').locator('[data-tier-text]').textContent()), `$${woodPrice}: ${await card(b, 'good').locator('[data-tier-style]').textContent()}`)
  check('the other options did not move', (await priceOf(b, 'better')) === beforeBetter)
  await swap(b, 'good', 'Automatic')
  check('back to Automatic: as it was', /Dig set|Posts set/i.test(await card(b, 'good').textContent()))
  await swap(b, 'good', 'Wood.*Stockade.*(pine|PT).*')
  // Down to one, then back.
  await card(b, 'good').locator('input[type="checkbox"]').uncheck(); await sleep(800)
  await card(b, 'best').locator('input[type="checkbox"]').uncheck(); await sleep(1200)
  await card(b, 'good').locator('input[type="checkbox"]').check(); await sleep(1200)
  await save(page2, V)
  q = (await quotesNamed(christa2.ctx, V))[0]
  const wood = q.proposal.options.find(o => o.fenceStyle.startsWith('wood'))
  // The Salesman's copy has no margin (costRedact.ts, Nov 3 2026): the cost factor saved on the option is read as the owner.
  const woodOwner = (await (await owner.ctx.request.get(`${API}/api/saved-quotes/${q.id}`)).json()).data.proposal.options.find(o => o.fenceStyle === wood?.fenceStyle)
  check('the Salesman\'s copy of the option has no cost factor or margin; the saved one has them', wood?.snapshot?.costFactor === undefined && wood?.snapshot?.gmPct === undefined && woodOwner?.snapshot?.costFactor > 0 && typeof woodOwner?.snapshot?.gmPct === 'number', `${woodOwner?.snapshot?.costFactor} ${woodOwner?.snapshot?.gmPct}`)
  check('saved: wood at the server\'s price, with the wood warranty line', Math.round(wood?.finalPrice) === Math.round(woodPrice) && /wood itself/.test(wood?.warranty?.text ?? ''), `${wood?.fenceStyle} $${wood?.finalPrice}: ${wood?.warranty?.name}`)
  const tv = (await (await christa2.ctx.request.post(`${API}/api/saved-quotes/${q.id}/share-token`, { headers: { 'X-Staff-Request': '1' } })).json()).data
  const sv = await customerSigns(browser, tv.shareToken, 'Wood|Stockade', 'v')
  check('customer: the options, and the wood one signs', /Accepted/.test(sv.done) && /Stockade|Wood/i.test(sv.done) && sv.pdfOk, `${sv.cards.join(' || ')} >> ${sv.done}`)
  const s2 = (await (await owner.ctx.request.get(`${API}/api/saved-quotes/${q.id}`)).json()).data
  check('owner: the vinyl quote is now the wood option', s2.fenceStyle === wood.fenceStyle && s2.finalPrice === wood.finalPrice && s2.pricing?.costFactor === woodOwner?.snapshot?.costFactor && s2.runRails == null, `${s2.fenceStyle} $${s2.finalPrice} factor ${s2.pricing?.costFactor}`)
  // ── A change order on the signed option follows it ──
  async function changeOrder(quote, word) {
    const fresh = await phone(browser, OWNER) // Playwright's WebKit crashes on a second goto after the quote builder
    const pg = fresh.page
    const jobId = ((await (await owner.ctx.request.get(`${API}/api/saved-jobs`)).json()).data ?? []).find(j => j.quoteId === quote.id)?.id
    await pg.goto(`${APP}/operations?job=${jobId}`)
    await pg.waitForSelector('[data-co-panel]', { timeout: 40000 }); await sleep(1000)
    await pg.locator(`[data-co-button="${quote.id}"]`).first().tap()
    await pg.waitForSelector('[data-quote-builder] [data-bar-price]', { timeout: 30000 }); await sleep(1200)
    // The walk list (Nov 5 2026): the back's stretch after its gate, 59 ft → 79 ft (the back 128 → 148 ft).
    await pg.locator('[data-quote-builder] [data-step="yard"]').tap().catch(() => {}); await sleep(400)
    await pg.locator('[data-walk-step]', { hasText: 'Side 3: 59 ft, Corner' }).first().tap(); await sleep(300)
    await pg.locator('[data-walk-edit-feet]').fill('79')
    await pg.locator('[data-walk-edit-save]').tap(); await sleep(500)
    await pg.locator('[data-quote-bar] [data-co-make]').tap()
    await pg.waitForSelector('[data-co-modal]', { timeout: 20000 }); await sleep(1500)
    const line = await pg.locator('[data-co-line-description]').first().inputValue()
    const amt = Number(await pg.locator('[data-co-line-amount]').first().inputValue())
    if (SHOTS) await pg.screenshot({ path: `${SHOTS}/co-${word}.png` })
    check(`change order on the ${word} option: 20 ft more, at its own price`, /^Add 20 ft/.test(line) && amt > 0 && amt < quote.finalPrice * 0.3, `${line}: $${amt}, the job was $${quote.finalPrice}`)
    await pg.locator('[data-co-reason]').fill('Customer wants 20 ft more')
    await pg.locator('[data-co-save-draft]').tap(); await sleep(2500)
    const list = (await (await owner.ctx.request.get(`${API}/api/change-orders?quoteId=${quote.id}`)).json()).data ?? []
    const work = list[0]?.work
    check(`change order on the ${word} option: its work is the signed style and parts`, work?.fenceStyle === quote.fenceStyle && !(work?.pullSheet ?? []).some(l => /Emily|Vinyl/.test(l.item)), `${work?.fenceStyle}, ${work?.sections} sections`)
    await fresh.ctx.close()
  }
  // ── The main option moves; every option stays ──
  const christa3 = await phone(browser, SALES)
  const M = `Mixed e2e main ${run}`
  b = await quoteUpToPrice(christa3.page, M, 'Aluminum.*No dig')
  await swap(b, 'good', 'Galvanized.*4 ft.*No dig')
  const [cl, al] = [await priceOf(b, 'good'), await priceOf(b, 'better')]
  await card(b, 'good').locator('[data-tier-main]').tap(); await sleep(2500)
  check('Make main on the chain link option: it is the quote now, aluminum stays offered at its price', (await card(b, 'good').locator('[data-tier-main]').textContent()) === 'Main option' && Math.abs(await priceOf(b, 'better') - al) < 2 && Math.abs(await priceOf(b, 'good') - cl) < 2 && dollars(await christa3.page.locator('[data-bar-price]').textContent()) === await priceOf(b, 'good'), `$${await priceOf(b, 'good')} and $${await priceOf(b, 'better')}`)
  await swap(b, 'good', 'Black Chain Link, 4 ft.*No dig'); await sleep(1500)
  check('Change style on the main option: the quote takes that style, the other option stays', Math.abs(await priceOf(b, 'better') - al) < 2 && /Black/.test(await card(b, 'good').locator('[data-tier-style]').textContent()), await card(b, 'good').locator('[data-tier-style]').textContent())
  await save(christa3.page, M)
  const qm = (await quotesNamed(christa3.ctx, M))[0]
  check('saved with the Black chain link main and aluminum', /Black|CL - 4/.test(qm.fenceStyle) && qm.proposal.options.length === 2, JSON.stringify(qm.proposal.options.map(o => [o.tier?.label, o.fenceStyle, o.finalPrice])))
  // Reopened, down to one option: the customer reads one fence and nothing to choose.
  await christa3.ctx.close()
  const christa4 = await phone(browser, SALES)
  await christa4.page.goto(`${APP}/quotes?quote=${qm.id}`)
  const rb = christa4.page.locator('[data-quote-builder]')
  await rb.waitFor({ timeout: 30000 }); await rb.locator('[data-tiers]').waitFor({ timeout: 20000 }); await sleep(2000)
  await card(rb, 'better').locator('input[type="checkbox"]').uncheck(); await sleep(2000)
  await christa4.page.locator('[data-quote-bar] [data-save-open]').tap(); await sleep(600)
  await christa4.page.locator('[data-save-submit]').tap(); await sleep(3000)
  const qo = (await (await christa4.ctx.request.get(`${API}/api/saved-quotes/${qm.id}`)).json()).data
  check('reopened and removed: one option on the proposal, the other gone for good', qo.proposal.options.length === 1 && qo.proposal.options[0].fenceStyle === qm.fenceStyle, JSON.stringify(qo.proposal.options.map(o => o.fenceStyle)))
  const to = (await (await christa4.ctx.request.post(`${API}/api/saved-quotes/${qm.id}/share-token`, { headers: { 'X-Staff-Request': '1' } })).json()).data
  const one = await (await christa4.ctx.request.get(`${API}/p/${to.shareToken}`)).text()
  check('customer, one option: no choice to make, no badge', /Your fence/.test(one) && /data-one-option/.test(one) && !/Most popular|Recommended/.test(one))
  console.log('MAINQUOTE', qm.id)
  await changeOrder(q0, 'chain link')
  await changeOrder(s2, 'wood')
  // ── Fixes from the review (Nov 2) ──
  const fx = await phone(browser, SALES)
  // Clearing Most popular: no option is labeled.
  const C = `Mixed e2e clear ${run}`
  b = await quoteUpToPrice(fx.page, C, 'Aluminum.*No dig')
  await swap(b, 'good', 'Galvanized.*4 ft.*No dig')
  check('heading: two options', (await b.locator('[data-tiers-title]').textContent()).startsWith('Two options'))
  await addOption(b, 'Black Chain Link, 4 ft.*No dig')
  check('heading: not "Two options" with three on', !(await b.locator('[data-tiers-title]').textContent()).startsWith('Two options'), await b.locator('[data-tiers-title]').textContent())
  const taken = await card(b, 'good').locator('[data-tier-swap] option[disabled]').allTextContents()
  check('a style on another card cannot be picked again', taken.some(t => /Aluminum Emily.*No dig/.test(t)) && taken.some(t => /Black Chain Link, 4 ft/.test(t)), taken.join(' / '))
  // Aluminum Emily builds a 10 ft double gate from two 4' x 5' leaves (Jonathan, Nov 3 2026, item 25): nothing to say.
  check('aluminum: a 10 ft double gate needs no note since item 25', !/10 ft double gate/.test(await card(b, 'better').textContent()), (await card(b, 'better').textContent()).match(/.{0,40}double gate.{0,40}/)?.[0] ?? 'no note')
  // The Salesman never sees margin (Jonathan, Nov 2 2026): no margin line on any option.
  check('the Salesman sees no margin on any option', (await b.locator('[data-tier-margin]').count()) === 0 && !/margin/i.test(await b.locator('[data-tiers]').textContent()))
  await b.locator('[data-tier-popular]').first().evaluate(() => {})
  await card(b, 'better').locator('[data-tier-popular-pick]').tap(); await sleep(1500)
  check('Most popular cleared on the card', (await b.locator('[data-tier-popular]').count()) === 0)
  await save(fx.page, C)
  const qc = (await quotesNamed(fx.ctx, C))[0]
  const tc = (await (await fx.ctx.request.post(`${API}/api/saved-quotes/${qc.id}/share-token`, { headers: { 'X-Staff-Request': '1' } })).json()).data
  const cleared = await (await fx.ctx.request.get(`${API}/p/${tc.shareToken}`)).text()
  check('customer, Most popular cleared: no badge at all', !/>Most popular</.test(cleared) && !/>Recommended</.test(cleared))
  check('customer: odd gate words and margins are not on the page', !/parts list|Margin|two 4 ft leaves/.test(cleared))

  // The stale signing: the customer has the page open, the Salesman takes the option off.
  const S = `Mixed e2e stale ${run}`
  const fx2 = await phone(browser, SALES)
  b = await quoteUpToPrice(fx2.page, S, 'Aluminum.*No dig')
  await swap(b, 'good', 'Galvanized.*4 ft.*No dig')
  await save(fx2.page, S)
  const qs = (await quotesNamed(fx2.ctx, S))[0]
  const ts = (await (await fx2.ctx.request.post(`${API}/api/saved-quotes/${qs.id}/share-token`, { headers: { 'X-Staff-Request': '1' } })).json()).data
  await fx2.ctx.request.patch(`${API}/api/saved-quotes/${qs.id}`, { headers: { 'X-Staff-Request': '1', 'Content-Type': 'application/json' }, data: { status: 'SENT' } })
  const custCtx = await browser.newContext(PHONE)
  const cust = await custCtx.newPage()
  await cust.goto(`${API}/p/${ts.shareToken}`); await sleep(1200)
  await cust.locator('.opt[data-option]', { hasText: 'Chain link' }).first().locator('input').check({ force: true }); await sleep(300)
  await cust.locator('#name').fill('Stale Customer')
  await cust.locator('#sig').scrollIntoViewIfNeeded()
  const sb = await cust.locator('#sig').boundingBox()
  const sp = i => ({ clientX: sb.x + 30 + i * 20, clientY: sb.y + 80 + (i % 2 ? -25 : 25), pointerId: 7, pointerType: 'touch', bubbles: true })
  await cust.locator('#sig').dispatchEvent('pointerdown', sp(0))
  for (let i = 1; i <= 12; i++) await cust.locator('#sig').dispatchEvent('pointermove', sp(i))
  await cust.locator('#sig').dispatchEvent('pointerup', sp(12))
  const fx3 = await phone(browser, SALES)
  await fx3.page.goto(`${APP}/quotes?quote=${qs.id}`)
  const eb = fx3.page.locator('[data-quote-builder]')
  await eb.waitFor({ timeout: 30000 }); await eb.locator('[data-tiers]').waitFor({ timeout: 20000 }); await sleep(2500)
  await eb.locator('[data-tiers-use-current]').tap().catch(() => {}); await sleep(1500)
  await card(eb, 'good').locator('input[type="checkbox"]').uncheck(); await sleep(2000)
  await fx3.page.locator('[data-quote-bar] [data-save-open]').tap(); await sleep(800)
  await fx3.page.locator('[data-save-submit]').tap(); await sleep(1500)
  await fx3.page.getByText('Save new version').first().tap(); await sleep(3000)
  const qs2 = (await (await fx3.ctx.request.get(`${API}/api/saved-quotes/${qs.id}`)).json()).data
  check('Save new version: the chain link option is off the proposal', qs2.proposal.options.length === 1 && !qs2.proposal.options.some(o => /^CL/.test(o.fenceStyle)), JSON.stringify(qs2.proposal.options.map(o => [o.fenceStyle, o.finalPrice])))
  await cust.locator('#go').tap(); await sleep(3500)
  const stale = (await (await fx3.ctx.request.get(`${API}/api/saved-quotes/${qs.id}`)).json()).data
  check('the stale page signs nothing', !stale.acceptedAt && stale.status !== 'SOLD' && !/Accepted/.test(await cust.locator('main').textContent().then(t => t.slice(0, 400))))
  check('the page reloads to the current options and says why', (await cust.locator('[data-options-changed]').count()) === 1 && (await cust.locator('.opt[data-option]').count()) === 1, await cust.locator('[data-options-changed]').textContent().catch(() => ''))
  if (SHOTS) await cust.screenshot({ path: `${SHOTS}/stale-refused.png` })
  await custCtx.close()

  // Two browsers: A adds Wood; B, opened first, saves; nothing is lost in silence.
  const fx4 = await phone(browser, SALES), fx5 = await phone(browser, SALES)
  await fx4.page.goto(`${APP}/quotes?quote=${qc.id}`); await fx5.page.goto(`${APP}/quotes?quote=${qc.id}`)
  const ba = fx4.page.locator('[data-quote-builder]'), bb = fx5.page.locator('[data-quote-builder]')
  await ba.waitFor({ timeout: 30000 }); await bb.waitFor({ timeout: 30000 }); await ba.locator('[data-tiers]').waitFor({ timeout: 20000 }); await bb.locator('[data-tiers]').waitFor({ timeout: 20000 }); await sleep(2500)
  await card(ba, 'added1').locator('[data-option-remove]').tap(); await sleep(1500)
  await addOption(ba, 'Wood.*Stockade.*(pine|PT).*')
  await fx4.page.locator('[data-quote-bar] [data-save-open]').tap(); await sleep(800)
  await fx4.page.locator('[data-save-submit]').tap(); await sleep(1500)
  await fx4.page.getByText('Save new version').first().tap(); await sleep(3000) // the link is out, so a save asks first
  check('two browsers: the first save put the Wood option on', ((await (await fx4.ctx.request.get(`${API}/api/saved-quotes/${qc.id}`)).json()).data.proposal.options).some(o => o.fenceStyle.startsWith('wood')))
  await fx5.page.locator('[data-quote-bar] [data-save-open]').tap(); await sleep(800)
  // Said on tapping Save, before anything says the quote is stored.
  await fx5.page.getByText('while you had it open').first().waitFor({ timeout: 12000 }).catch(() => {})
  const both = (await (await fx5.ctx.request.get(`${API}/api/saved-quotes/${qc.id}`)).json()).data
  check('two browsers: the later save did not take the Wood option off', both.proposal.options.some(o => o.fenceStyle.startsWith('wood')), JSON.stringify(both.proposal.options.map(o => o.fenceStyle)))
  const said = await fx5.page.locator('body').textContent()
  check('two browsers: the second person is told', /while you had it open/.test(said) && !/Quote stored/.test(said) && (await fx5.page.locator('[data-save-submit]').count()) === 0, said.match(/.{0,60}while you had it open.{0,60}/)?.[0] ?? '')
  if (SHOTS) await fx5.page.screenshot({ path: `${SHOTS}/two-browsers.png` })

  // A 6 ft yard: every option at the minimum.
  const fx6 = await phone(browser, SALES)
  const T = `Mixed e2e tiny ${run}`
  b = await quoteUpToPrice(fx6.page, T, 'White Vinyl Privacy.*(6 or 8 ft|best price).*No dig', 'straight', [['Fence', '6']])
  await swap(b, 'good', 'Wood.*Stockade.*(pine|PT).*')
  const main = dollars(await fx6.page.locator('[data-bar-price]').textContent())
  const prices = []
  for (const k of await b.locator('[data-tier]').evaluateAll(e => e.map(x => x.getAttribute('data-tier')))) prices.push(await priceOf(b, k))
  check('tiny yard: every option at the minimum, and staff are told', prices.every(p => p === main) && (await b.locator('[data-tier-minimum]').count()) >= 1, `main $${main}, options ${prices.join(', ')}`)
  if (SHOTS) await fx6.page.screenshot({ path: `${SHOTS}/tiny.png` })
  await save(fx6.page, T)
  const qt = (await quotesNamed(fx6.ctx, T))[0]
  check('tiny yard: the stored prices are the minimum', qt.proposal.options.every(o => o.finalPrice === main), JSON.stringify(qt.proposal.options.map(o => o.finalPrice)))

  // A proposal that already holds more than 3 (real ones do): her edit saves and nothing says "Not saved".
  const shareT = (await (await fx6.ctx.request.post(`${API}/api/saved-quotes/${qt.id}/share-token`, { headers: { 'X-Staff-Request': '1' } })).json()).data
  const pub = JSON.stringify((await (await fx6.ctx.request.get(`${API}/api/saved-quotes/share/${shareT.shareToken}`)).json()).data ?? {})
  check('public JSON: no staff fields', pub.includes('finalPrice') && !/minimumLifted|adjustmentRefused|"problems"|snapshot|swapped|tierPrefs|tierSet/.test(pub))
  const extra = qt.proposal.options[0]
  const more = [...qt.proposal.options, { ...extra, fenceStyle: "CL - 4' Galv", label: 'Galvanized Chain Link, 4 ft, Residential, No dig', tier: undefined, finalPrice: 351 }, { ...extra, fenceStyle: "CL - 4' Black", label: 'Black Chain Link, 4 ft, Residential, No dig', tier: undefined, finalPrice: 352 }]
  execFileSync('psql', ['-d', 'ezbiz_dev', '-q', '-c', `update "SavedQuote" set proposal = jsonb_set(proposal::jsonb, '{options}', '${JSON.stringify(more).replace(/'/g, "''")}'::jsonb)::json, "shareToken" = null where id = '${qt.id}' and "customerName" like 'Mixed e2e tiny%'`])
  const fx8 = await phone(browser, SALES)
  await fx8.page.goto(`${APP}/quotes?quote=${qt.id}`)
  const gb = fx8.page.locator('[data-quote-builder]')
  await gb.waitFor({ timeout: 30000 }); await gb.locator('[data-tiers]').waitFor({ timeout: 20000 }); await sleep(2500)
  await fx8.page.locator('[data-quote-bar] [data-save-open]').tap(); await sleep(900)
  await fx8.page.locator('textarea[placeholder^="HOA"]').fill('Gate code 1234')
  await fx8.page.locator('[data-save-submit]').tap(); await sleep(3500)
  const qg = (await (await fx8.ctx.request.get(`${API}/api/saved-quotes/${qt.id}`)).json()).data
  check('a proposal with more than 3: her edit saves, the options stay, nothing refused', qg.notes === 'Gate code 1234' && qg.proposal.options.length > 3 && !/Not saved/.test(await fx8.page.locator('body').textContent()), `${qg.proposal.options.length} options, note: ${qg.notes}`)

  // A sent quote holding an old Best (tan 6x8) as its fourth card, as two real quotes do: a note saves, nothing grows.
  const old = [{ ...extra, finalPrice: 360, tier: { key: 'good', label: 'Good', blurb: '' }, fenceStyle: "WV-DS 6'x8' Privacy" }, { ...extra, finalPrice: 361, tier: { key: 'better', label: 'Better', blurb: '' }, fenceStyle: "WV-ND 6'x8' Privacy" }, { ...extra, finalPrice: 362, tier: { key: 'best', label: 'Best', blurb: '' }, fenceStyle: "TV-ND 6'x8' Privacy" }, { ...extra, tier: undefined, fenceStyle: qg.fenceStyle }]
  execFileSync('psql', ['-d', 'ezbiz_dev', '-q', '-c', `update "SavedQuote" set status = 'SENT', proposal = jsonb_set(proposal::jsonb, '{options}', '${JSON.stringify(old).replace(/'/g, "''")}'::jsonb)::json where id = '${qt.id}' and "customerName" like 'Mixed e2e tiny%'`])
  await fx8.ctx.close()
  const fx9 = await phone(browser, SALES)
  await fx9.page.goto(`${APP}/quotes?quote=${qt.id}`)
  const ob2 = fx9.page.locator('[data-quote-builder]')
  await ob2.waitFor({ timeout: 30000 }); await ob2.locator('[data-tiers]').waitFor({ timeout: 20000 }); await sleep(2500)
  await fx9.page.locator('[data-quote-bar] [data-save-open]').tap(); await sleep(1200)
  await fx9.page.locator('textarea[placeholder^="HOA"]').fill('Old Best note')
  await fx9.page.locator('[data-save-submit]').tap(); await sleep(1500)
  await fx9.page.getByRole('button', { name: 'Keep the sent prices' }).first().tap({ timeout: 3000 }).catch(() => {})
  await sleep(3000)
  const qo2 = (await (await fx9.ctx.request.get(`${API}/api/saved-quotes/${qt.id}`)).json()).data
  check('a sent quote with an old Best: the note saves, the cards stay as sent, nothing refused', qo2.notes === 'Old Best note' && qo2.proposal.options.length === 4 && qo2.proposal.options[2].fenceStyle.startsWith('TV-ND') && !/Not saved/.test(await fx9.page.locator('body').textContent()), `${qo2.proposal.options.length} options`)

  // The same shape from before per option warranties, its link out: Good swapped to Aluminum saves as a new version.
  const oldWords = 'Workmanship is warranted for 1 year from installation date.'
  // The quote's own card with its real name and no tier folded onto it, so Good is not the main card and the save knows the own card as the same option.
  const ownLabel = qt.proposal.options.find(o => o.fenceStyle === qg.fenceStyle)?.label
  const noW = qo2.proposal.options.map(({ warranty, ...o }) => (o.fenceStyle === qg.fenceStyle ? { ...o, label: ownLabel } : o))
  execFileSync('psql', ['-d', 'ezbiz_dev', '-q', '-c', `update "SavedQuote" set proposal = (jsonb_set(jsonb_set(proposal::jsonb, '{options}', '${JSON.stringify(noW).replace(/'/g, "''")}'::jsonb), '{warranty}', '"${oldWords}"'::jsonb) - 'ownTier')::json where id = '${qt.id}' and "customerName" like 'Mixed e2e tiny%'`])
  const tw = (await (await fx9.ctx.request.post(`${API}/api/saved-quotes/${qt.id}/share-token`, { headers: { 'X-Staff-Request': '1' } })).json()).data
  await fx9.ctx.close()
  const fx10 = await phone(browser, SALES)
  await fx10.page.goto(`${APP}/quotes?quote=${qt.id}`)
  const wb = fx10.page.locator('[data-quote-builder]')
  await wb.waitFor({ timeout: 30000 }); await wb.locator('[data-tiers]').waitFor({ timeout: 20000 }); await sleep(2500)
  await swap(wb, 'good', 'Aluminum.*No dig')
  await fx10.page.locator('[data-quote-bar] [data-save-open]').tap(); await sleep(1500)
  await fx10.page.locator('[data-save-submit]').tap({ timeout: 8000 })
  await fx10.page.getByRole('button', { name: /Save new version/ }).first().tap({ timeout: 8000 })
  await sleep(3500)
  const qw = (await (await fx10.ctx.request.get(`${API}/api/saved-quotes/${qt.id}`)).json()).data
  const alumOpt = qw.proposal.options.find(o => o.fenceStyle.startsWith('Alum'))
  check('swapped on an old sent proposal with a link: saved, with its own warranty, the old cards as sent', !!alumOpt?.warranty?.name && qw.proposal.warranty === oldWords && !qw.proposal.options.find(o => o.fenceStyle === qg.fenceStyle)?.warranty && !/Not saved/.test(await fx10.page.locator('body').textContent()), JSON.stringify(qw.proposal.options.map(o => [o.fenceStyle, o.warranty?.name ?? null])))
  const cw = await (await fx10.ctx.request.get(`${API}/p/${tw.shareToken}`)).text()
  check('customer: the new option shows its warranty, the old words are still there', cw.includes(alumOpt?.warranty?.name) && cw.includes(oldWords))

  // Compare options stop at the limit.
  const fx7 = await phone(browser, SALES)
  b = await quoteUpToPrice(fx7.page, `Mixed e2e compare ${run}`, 'White Vinyl Privacy.*6 ft tall.*No dig')
  await b.locator('[data-compare-toggle]').tap(); await sleep(1500)
  const free = await b.locator('[data-compare-row] input:not(:disabled):not(:checked)').count()
  check('Compare options: with 3 on, no more can be ticked', free === 0, `${free} open, ${await b.locator('[data-compare-row]').count()} rows`)

  console.log('QUOTES', JSON.stringify([A, V]), 'jobs', job?.id)
  check('Salesman: no page errors', christa.errors.length + christa2.errors.length + christa4.errors.length === 0, [...christa.errors, ...christa2.errors, ...christa4.errors].join('|'))
} catch (e) {
  check('test run finished', false, String(e?.stack || e).split('\n').slice(0, 4).join(' '))
} finally {
  await browser.close()
  // Everything this run made, by id: its quotes ("Mixed e2e ... <run>"), what signing made, and their customers.
  const q = x => execFileSync('psql', ['-d', 'ezbiz_dev', '-At', '-c', x]).toString().trim()
  const ids = q(`select id from "SavedQuote" where "customerName" like 'Mixed e2e %' and "customerName" like '%${run}'`).split('\n').filter(Boolean)
  for (const id of ids) {
    for (const t of ['ContractPayment', 'ContractInvoice', 'PaymentSchedule', 'JobQuotedCost', 'SignedDocument', 'ProposalView', 'QuoteOption', 'InventoryPendingOrder', 'SavedJob']) q(`delete from "${t}" where "quoteId" = '${id}'`)
    q(`update "BusinessState" set "pendingOrders" = (select coalesce(jsonb_agg(o), '[]'::jsonb) from jsonb_array_elements("pendingOrders") o where o->>'quoteId' is distinct from '${id}') where "pendingOrders" @> '[{"quoteId": "${id}"}]'`)
    const contact = q(`select coalesce("crmContactId", '') from "SavedQuote" where id = '${id}'`)
    q(`delete from "CrmAuditLog" where "entityId" = '${id}'`)
    q(`delete from "SavedQuote" where id = '${id}'`)
    if (contact && q(`select count(*) from "SavedQuote" where "crmContactId" = '${contact}'`) === '0' && /^Mixed e2e/.test(q(`select "firstName" || ' ' || "lastName" from "CrmContact" where id = '${contact}'`))) q(`delete from "CrmContact" where id = '${contact}'`)
  }
  console.log(`removed ${ids.length} quotes: ${ids.join(', ')}`)
}
const passed = results.filter(Boolean).length
console.log(`\n${passed} of ${results.length} checks passed`)
process.exit(passed === results.length ? 0 : 1)
