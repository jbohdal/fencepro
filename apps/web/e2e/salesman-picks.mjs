// The Salesman's fence picker (Jonathan, Nov 2 2026, "so a new Salesman can't get confused"), end to end on the dev
// copy, as Christa on a phone sized WebKit (iPhone): she picks only Material > Style > Height > Color (Finish, Picket
// type) > add ons; never Install or Section width; a choice with one option is not shown; nothing that cannot be
// quoted shows. The main price is the Better option's (the same fence at the same price); she sees no margin. One quote
// per material (vinyl, wood, chain link, aluminum): drawn, picked, saved, sent with Copy link, opened on the customer's
// phone; the vinyl one is signed. Then the owner forces a section width under Advanced. Run `pnpm -s build` first.
//
//   APP_URL=http://localhost:4200 API_URL=http://localhost:4200 E2E_STAFF_COOKIE=<owner cookie> SALES_COOKIE=<Christa's cookie> \
//     [SHOTS=<folder>] node e2e/salesman-picks.mjs
//
// Removes everything it made (hard deletes on ezbiz_dev only, by id).
import './devOnly.mjs'
import { webkit } from 'playwright'
import { execFileSync } from 'child_process'
import fs from 'fs'
import { signInByCookie, pickStyle } from './lib.mjs'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || APP
const OWNER = process.env.E2E_STAFF_COOKIE || ''
const SALES = process.env.SALES_COOKIE || ''
const SHOTS = process.env.SHOTS || ''
if (!OWNER || !SALES) { console.error('Set E2E_STAFF_COOKIE and SALES_COOKIE.'); process.exit(2) }
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const dollars = s => Number(String(s).replace(/[^0-9.]/g, ''))
const sql = q => execFileSync('psql', ['-d', 'ezbiz_dev', '-At', '-c', q]).toString().trim()
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
const run = Date.now().toString(36)
const made = []
const counts = {}
const shot = async (page, name, full = false) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full }).catch(() => {}) }

async function phone(browser, cookie) {
  const ctx = await browser.newContext(PHONE)
  await signInByCookie(ctx, { cookie, api: API })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 300)))
  page.on('dialog', d => d.accept().catch(() => {}))
  return { ctx, page, errors }
}

/** Customer and yard: the 344 ft backyard with a walk gate and a double gate; stops on the Style step. */
async function toStyle(page, name) {
  const sides = [['Left return', '20', 'Walk gate'], ['Left side', '95'], ['Back', '128', 'Double gate'], ['Right side', '95'], ['Right return', '20']]
  const b = page.locator('[data-quote-builder]'), bar = page.locator('[data-quote-bar]')
  await page.goto(`${APP}/quotes`); await page.waitForSelector('[data-tabbar]', { timeout: 30000 }); await sleep(1500)
  await page.locator('button:has-text("New quote"):visible').first().tap(); await sleep(800)
  await b.locator('input[placeholder^="Customer name"]').fill(name)
  await b.locator('input[type="tel"]').first().fill('3525550142').catch(() => {})
  await bar.locator('[data-bar-next]').tap(); await sleep(300)
  await b.locator('[data-shape="backyard"]').tap(); await sleep(300)
  for (const [side, ft, gate] of sides) {
    const open = b.locator(`[data-side-open="true"][data-side="${side}"]`)
    await open.locator('[data-side-length]').tap(); await sleep(150)
    for (const d of ft) { await page.locator(`[data-ftin-pad] [data-pad-key="${d}"]`).tap(); await sleep(60) }
    await page.locator('[data-ftin-pad] [data-pad-done]').tap(); await sleep(150)
    if (gate) { await open.locator(`[data-gate-choice] button:has-text("${gate}")`).tap(); await sleep(200) }
    if (side !== sides[sides.length - 1][0]) { await bar.locator('[data-bar-next]').tap(); await sleep(200) }
  }
  await bar.locator('[data-bar-next]').tap(); await sleep(600)
  return b
}

/** What the picker asks now: each choice shown and its options. */
async function asked(b) {
  const simple = b.locator('[data-style-choices-simple]')
  const materials = await simple.locator('[data-choice-material]').allTextContents()
  const dims = await simple.locator('[data-choice-dim]').evaluateAll(els => {
    const out = {}
    for (const e of els) { const d = e.getAttribute('data-choice-dim'); (out[d] ??= []).push(e.textContent.trim()) }
    return out
  })
  const labels = await simple.locator('p.text-xs.font-semibold').allTextContents()
  return { materials, dims, labels, name: (await simple.locator('[data-style-plain-name]').textContent().catch(() => '')) || '' }
}

async function save(page) {
  await page.locator('[data-quote-bar] [data-save-open]').tap(); await sleep(600)
  await page.locator('[data-save-mode="new"]').tap().catch(() => {}); await sleep(300)
  await page.locator('[data-save-submit]').tap(); await sleep(4000)
}
const quotesNamed = async (ctx, name) => {
  const j = await (await ctx.request.get(`${API}/api/saved-quotes?full=1`)).json()
  return (j.data ?? []).filter(q => q.customerName.startsWith(name))
}

/** Signs the option selected on the customer's page. */
async function sign(page, who) {
  await page.locator('#name').fill(who)
  await page.locator('#sig').scrollIntoViewIfNeeded()
  const sig = await page.locator('#sig').boundingBox()
  const pt = i => ({ clientX: sig.x + 30 + i * 20, clientY: sig.y + 80 + (i % 2 ? -25 : 25), pointerId: 7, pointerType: 'touch', bubbles: true })
  await page.locator('#sig').dispatchEvent('pointerdown', pt(0))
  for (let i = 1; i <= 12; i++) await page.locator('#sig').dispatchEvent('pointermove', pt(i))
  await page.locator('#sig').dispatchEvent('pointerup', pt(12))
  await page.locator('#go').tap(); await sleep(3500)
}

const MATERIALS = [
  { key: 'vinyl', label: 'Vinyl', taps: [['color', 'Tan'], ['height', '8 ft'], ['height', '6 ft'], ['color', 'White']], sign: true },
  { key: 'wood', label: 'Wood', taps: [['picket', 'Alta Premium'], ['picket', 'PT Pine']] },
  { key: 'chain', label: 'Chain link', taps: [['height', '6 ft'], ['height', '4 ft'], ['finish', 'Black'], ['finish', 'Galvanized']] },
  { key: 'alum', label: 'Aluminum', taps: [] },
]

const browser = await webkit.launch()
try {
  for (const m of MATERIALS) {
    const christa = await phone(browser, SALES)
    const { page } = christa
    const N = `Picks e2e ${m.key} ${run}`
    const b = await toStyle(page, N)
    const start = await asked(b)
    counts[m.key] = { steps: [] }
    counts[m.key].steps.push({ step: 'Style step opens', materials: start.materials.length, shownMaterials: start.materials })
    check(`${m.label}: no "Or pick from the list" for the Salesman`, (await b.locator('[data-style-list]').count()) === 0)
    check(`${m.label}: only materials that can be quoted (no Other)`, !start.materials.includes('Other') && start.materials.length === 4, start.materials.join(', '))
    await shot(page, `${m.key}-1-material`)
    await b.locator(`[data-choice-material="${m.key}"]`).tap(); await sleep(800)
    let a = await asked(b)
    counts[m.key].steps.push({ step: `tap ${m.label}`, asked: a.dims, fence: a.name })
    check(`${m.label}: never Install, Section width or Grade`, !('install' in a.dims) && !('width' in a.dims) && !('grade' in a.dims), JSON.stringify(a.dims))
    check(`${m.label}: no option greyed or "off"`, (await b.locator('[data-style-choices-simple] [data-choice-state]:not([data-choice-state="ok"])').count()) === 0 && !/\boff\b/i.test(await b.locator('[data-style-choices-simple]').textContent()))
    await shot(page, `${m.key}-2-${m.key}-picked`)
    let i = 3
    for (const [dim, opt] of m.taps) {
      const pickedColor = m.key === 'vinyl' && dim === 'height' && opt === '8 ft' ? await b.locator('[data-choice-dim="color"][aria-pressed="true"]').textContent().catch(() => '') : ''
      const said = pickedColor ? await b.locator('[data-choice-not-made="height"]').allTextContents() : []
      await b.locator(`[data-choice-dim="${dim}"]`, { hasText: opt }).first().tap(); await sleep(700)
      if (pickedColor) {
        // Tan 8 ft tall is not priced on the dev copy: 8 ft says so before the tap, and the tap says the color changed.
        const note = await b.locator('[data-style-changed-note]').textContent().catch(() => '')
        check('Vinyl: Tan, then 8 ft: never a silent switch (8 ft says what it comes in; the change is said)', said.some(t => /^8 ft comes in White only\.$/.test(t)) && /^Tan is not made in 8 ft, so the color is now White\.$/.test(note), `${said.join(' / ')} | ${note}`)
        await shot(page, `${m.key}-${i++}-tan-then-8ft`)
      }
      a = await asked(b)
      counts[m.key].steps.push({ step: `tap ${opt}`, asked: a.dims, fence: a.name })
      await shot(page, `${m.key}-${i++}-${dim}-${opt.replace(/\s+/g, '')}`)
    }
    if (m.key === 'chain') check('Chain link: no "6 ft + 1 ft barbed wire" height', !(a.dims.height ?? []).some(x => /barbed/i.test(x)), JSON.stringify(a.dims))
    if (m.key === 'wood') check('Wood: Style and Picket type only', JSON.stringify(Object.keys(a.dims)) === JSON.stringify(['style', 'picket']) && (await b.locator('[data-style-choices-simple]').textContent()).includes('Picket type'), JSON.stringify(a.dims))
    if (m.key === 'vinyl') check('Vinyl: Style, Height, Color', JSON.stringify(Object.keys(a.dims)) === JSON.stringify(['style', 'height', 'color']), JSON.stringify(a.dims))
    // The Price step.
    await page.locator('[data-quote-bar] [data-bar-next]').tap()
    await b.locator('[data-tiers]').waitFor({ timeout: 15000 }); await sleep(2500)
    const fence = await b.locator('[data-style-choices-simple] [data-style-plain-name]').textContent().catch(() => '')
    const label = await b.locator('[data-step-panel="price"] .bg-gray-900 p').first().textContent()
    const main = dollars(await b.locator('[data-quote-price]').textContent())
    const better = b.locator('[data-tier="better"]')
    const betterPrice = (await better.count()) ? dollars(await better.locator('[data-tier-price]').first().textContent()) : null
    const betterMain = (await better.count()) ? /Main option/.test(await better.locator('[data-tier-main]').textContent()) : false
    const priceText = await b.locator('[data-step-panel="price"]').textContent()
    counts[m.key].price = { fence, label, main, better: betterPrice, betterIsMain: betterMain, cards: await b.locator('[data-tier]').count() }
    check(`${m.label}: the big price reads "Price" (nothing adjusted)`, label.trim() === 'Price', label)
    if (m.key !== 'wood') check(`${m.label}: the main price is Better's, and Better is the main option`, betterPrice === main && betterMain, `main $${main}, Better $${betterPrice}`)
    else check('Wood: PT Pine is the main option (Good); Better is Alta Premium, its own fence and price', !betterMain && betterPrice > main, `main $${main}, Better $${betterPrice}`)
    check(`${m.label}: no margin anywhere on the Price step`, (await b.locator('[data-tier-margin]').count()) === 0 && !/margin/i.test(priceText) && !/net profit/i.test(priceText) && !/Where every dollar/i.test(priceText), (priceText.match(/.{30}margin.{30}/i) ?? [''])[0])
    check(`${m.label}: no section width choice on the Price step`, (await b.locator('[data-advanced-width]').count()) === 0 && (await b.locator('[data-width-compare]').count()) === 0)
    check(`${m.label}: "sections", never "panels"`, !/panels/i.test(priceText))
    await shot(page, `${m.key}-${i++}-price`)
    await shot(page, `${m.key}-${i++}-price-full`, true)
    await save(page)
    const q = (await quotesNamed(christa.ctx, N))[0]
    if (q) made.push(q.id)
    check(`${m.label}: saved at the main price`, !!q && Math.round(q.finalPrice) === Math.round(main), q ? `$${q.finalPrice} ${q.fenceStyle}` : 'not saved')
    // Her phone is priced by the server and sends no margin: the costs, margin and each option's pull sheet are the server's.
    const row = q ? sql(`select "totalCOGS" > 0 and "gmPct" > 0 and (select bool_and((o->'snapshot'->>'totalCOGS')::numeric > 0) from jsonb_array_elements(proposal->'options') o) from "SavedQuote" where id = '${q.id}'`) : ''
    check(`${m.label}: saved with the server's costs and margin, every option its own pull sheet`, row === 't', row)
    counts[m.key].saved = q ? { fenceStyle: q.fenceStyle, price: q.finalPrice, options: (q.proposal?.options ?? []).map(o => [o.tier?.key ?? 'own', o.fenceStyle, o.finalPrice]) } : null
    // Sent: Copy link in the quote's window (the Send box).
    await page.waitForSelector('[data-proposal-send]', { timeout: 20000 }).catch(() => {})
    await shot(page, `${m.key}-${i++}-send-box`)
    if (await page.locator('[data-photos-override]').count()) {
      await page.locator('[data-photos-override]').tap(); await sleep(300)
      await page.locator('[data-photos-reason]').fill('Test quote, no photos'); await page.locator('[data-photos-override-ok]').tap(); await sleep(1200)
    }
    await page.locator('[data-proposal-copy]').tap().catch(() => {}); await sleep(2500)
    const token = q ? sql(`select coalesce("shareToken", '') from "SavedQuote" where id = '${q.id}'`) : ''
    check(`${m.label}: sent (Copy link made the customer's link)`, !!token, token ? 'link made' : 'no link')
    await christa.ctx.close()
    if (!token) continue
    // The customer's phone.
    const ctx = await browser.newContext(PHONE)
    const cp = await ctx.newPage()
    const errs = []
    cp.on('pageerror', e => errs.push(String(e).slice(0, 300)))
    await cp.goto(`${API}/p/${token}`); await sleep(1800)
    const cards = await cp.locator('.opt[data-option]').evaluateAll(els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()))
    counts[m.key].customer = cards
    const html = await cp.content()
    check(`${m.label}: the customer reads sections, Most popular, never panels or Recommended`, !/panels|Recommended/i.test(html), '')
    const selected = await cp.locator('.opt[data-option] input:checked').evaluate(e => e.closest('.opt').textContent.replace(/\s+/g, ' ').trim()).catch(() => '')
    check(`${m.label}: the customer's page opens on the quoted option at the quoted price`, selected.includes(`$${Math.round(main).toLocaleString('en-US')}`), selected.slice(0, 160))
    await shot(cp, `${m.key}-${i++}-customer`, true)
    if (m.sign) {
      await sign(cp, 'Picks Customer')
      const done = await cp.locator('[data-accepted]').textContent().catch(() => '')
      await shot(cp, `${m.key}-${i++}-customer-signed`, true)
      const after = sql(`select status || '|' || "finalPrice" from "SavedQuote" where id = '${q.id}'`)
      check(`${m.label}: signed at the main price; the contract opens`, /Vinyl/i.test(done) && after.endsWith(`|${Math.round(main)}`) && (await cp.request.get(`${API}/p/${token}/contract.pdf`)).ok(), `${after}; ${done.slice(0, 120)}`)
    }
    check(`${m.label}: customer page, no errors`, errs.length === 0, errs.join('|'))
    await ctx.close()
  }

  // ── The owner: full picker, and Advanced section width ──
  const owner = await phone(browser, OWNER)
  const { page } = owner
  const N = `Picks e2e owner ${run}`
  const b = await toStyle(page, N)
  check('owner: keeps the full picker and the list', (await b.locator('[data-style-choices-simple]').count()) === 0 && (await b.locator('[data-style-list]').count()) === 1)
  await pickStyle(page, 'White Vinyl Privacy, 6 ft tall, 6 or 8 ft sections \\(best price\\), No dig')
  await shot(page, 'owner-1-style')
  await page.locator('[data-quote-bar] [data-bar-next]').tap()
  await b.locator('[data-tiers]').waitFor({ timeout: 15000 }); await sleep(2500)
  const before = dollars(await b.locator('[data-quote-price]').textContent())
  const ownerText = await b.locator('[data-step-panel="price"]').textContent()
  check('owner: sees margin, the same way on the main and the other cards (price less cost)', /Gross Margin/.test(ownerText) && (await b.locator('[data-tier-margin]').count()) > 0 && /price less cost/.test(await b.locator('[data-tier-margin]').first().textContent()))
  await b.locator('[data-advanced-width] summary').tap(); await sleep(500)
  const ways = await b.locator('[data-advanced-width-pick] option').allTextContents()
  check('owner: Advanced section width offers best price, all 6 ft, all 8 ft', ways.join('|') === 'Best price (6 or 8 ft sections for each run)|All 6 ft sections|All 8 ft sections', ways.join('|'))
  await shot(page, 'owner-2-advanced-width')
  const six = await b.locator('[data-advanced-width-pick] option', { hasText: 'All 6 ft sections' }).getAttribute('value')
  await b.locator('[data-advanced-width-pick]').selectOption(six); await sleep(2500)
  const after = dollars(await b.locator('[data-quote-price]').textContent())
  const bestMain = /Main option/.test(await b.locator('[data-tier="best"] [data-tier-main]').textContent())
  check('owner: all 6 ft forced: the quote is the 6 ft fence (the Best card), at its own price', bestMain && after !== before && after === dollars(await b.locator('[data-tier="best"] [data-tier-price]').first().textContent()), `$${before} to $${after}`)
  await shot(page, 'owner-3-forced-6ft')
  // All 8 ft forced: the no dig option (Better) is the quote's own fence at its price; three cards, never a fourth.
  const eight = await b.locator('[data-advanced-width-pick] option', { hasText: 'All 8 ft sections' }).getAttribute('value')
  await b.locator('[data-advanced-width-pick]').selectOption(eight); await sleep(2500)
  const at8 = dollars(await b.locator('[data-quote-price]').textContent())
  const betterMain8 = /Main option/.test(await b.locator('[data-tier="better"] [data-tier-main]').textContent())
  const better8 = dollars(await b.locator('[data-tier="better"] [data-tier-price]').first().textContent())
  check('owner: all 8 ft forced: Better is the main option at the quote\'s price, three cards', betterMain8 && better8 === at8 && (await b.locator('[data-tier]').count()) === 3, `$${at8}, Better $${better8}`)
  await shot(page, 'owner-4-forced-8ft')
  await save(page)
  const qo = (await quotesNamed(owner.ctx, N))[0]
  if (qo) made.push(qo.id)
  const opts = qo?.proposal?.options ?? []
  check('owner: saved with three options, the main one Better at the quote\'s price, Most popular on it', opts.length === 3 && opts.some(o => o.tier?.key === 'better' && o.fenceStyle === qo.fenceStyle && Math.round(o.finalPrice) === Math.round(qo.finalPrice) && o.badge === 'Most popular'), JSON.stringify(opts.map(o => [o.tier?.key, o.fenceStyle, o.finalPrice, o.badge ?? ''])))
  counts.owner = { bestPrice: before, forced6: after, forced8: at8 }
  check('owner: no page errors', owner.errors.length === 0, owner.errors.join('|'))
  await owner.ctx.close()
} finally {
  await browser.close()
  for (const id of made) {
    for (const t of ['ContractPayment', 'ContractInvoice', 'PaymentSchedule', 'JobQuotedCost', 'SignedDocument', 'ProposalView', 'QuoteOption', 'InventoryPendingOrder', 'SavedJob']) sql(`delete from "${t}" where "quoteId" = '${id}'`)
    sql(`update "BusinessState" set "pendingOrders" = (select coalesce(jsonb_agg(o), '[]'::jsonb) from jsonb_array_elements("pendingOrders") o where o->>'quoteId' is distinct from '${id}') where "pendingOrders" @> '[{"quoteId": "${id}"}]'`)
    const contact = sql(`select coalesce("crmContactId", '') from "SavedQuote" where id = '${id}'`)
    sql(`delete from "CrmAuditLog" where "entityId" = '${id}'`)
    sql(`delete from "SavedQuote" where id = '${id}'`)
    if (contact && sql(`select count(*) from "SavedQuote" where "crmContactId" = '${contact}'`) === '0' && /^Picks e2e/.test(sql(`select "firstName" || ' ' || "lastName" from "CrmContact" where id = '${contact}'`))) sql(`delete from "CrmContact" where id = '${contact}'`)
  }
  console.log(`removed ${made.length} quotes: ${made.join(', ')}`)
  if (SHOTS) fs.writeFileSync(`${SHOTS}/counts.json`, JSON.stringify(counts, null, 1))
}
const failed = results.filter(r => !r).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
