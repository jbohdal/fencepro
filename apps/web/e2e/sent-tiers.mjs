// A sent quote's Price step shows the tiers the customer's proposal shows, and says so truthfully once the yard
// is changed (review Oct 27 2026: Carlton Williams' sent quote read Good $8,780 under "Tiers as they were when this
// proposal was sent", his proposal Good $9,407; after a yard change the line still said "as sent").
//
//   APP_URL=http://localhost:4093 API_URL=http://localhost:4093 E2E_STAFF_COOKIE=<cookie> \
//   QUOTE_ID=<a sent new fence quote with Good / Better / Best, drawn> SIDE="Back" node e2e/sent-tiers.mjs
//
// As the owner, on a computer and an iPhone size screen (WebKit): opens the quote, the Price step's tiers equal
// the proposal's frozen options (read from the API), the line says "As sent"; the yard's SIDE is made 10 ft
// longer, and the line now says these are new prices and what saving does, never "as sent". Nothing is saved
// (the window is closed with "Leave without saving").

import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import { chromium, webkit } from 'playwright'
import { signInByCookie } from './lib.mjs'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || APP
const QUOTE_ID = process.env.QUOTE_ID || ''
const SIDE = process.env.SIDE || 'Back'
if (!QUOTE_ID) { console.error('Set QUOTE_ID.'); process.exit(2) }

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const cents = s => Math.round(Number(String(s).replace(/[^0-9.]/g, '')) * 100)

async function run(browserType, size, tag) {
  const browser = await browserType.launch()
  const phone = size.width < 500
  const ctx = await browser.newContext(phone ? { viewport: size, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: size })
  try {
    await signInByCookie(ctx, { api: API })
    const q = (await (await ctx.request.get(`${API}/api/saved-quotes/${QUOTE_ID}`)).json()).data
    const frozen = {}
    for (const o of q.proposal.options) if (o.tier?.key && !frozen[o.tier.key]) frozen[o.tier.key] = Math.round(o.finalPrice * 100)
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', e => errors.push(String(e).slice(0, 300)))
    page.on('dialog', d => d.accept().catch(() => {}))
    await page.goto(`${APP}/?quote=${QUOTE_ID}`)
    const b = page.locator('[data-quote-builder]')
    await b.waitFor({ timeout: 30000 })
    await sleep(1500)
    await b.locator('[data-step="price"]').click()
    const line = b.locator('[data-tiers-as-sent]')
    await line.waitFor({ timeout: 15000 })
    check(`${tag}: the line says the prices are the proposal's`, await line.getAttribute('data-tiers-as-sent') === 'sent', await line.innerText())
    const shown = {}
    for (const key of Object.keys(frozen)) shown[key] = cents(await b.locator(`[data-tier="${key}"] [data-tier-price]`).innerText())
    check(`${tag}: every tier is the proposal's price`, JSON.stringify(shown) === JSON.stringify(frozen), `builder ${JSON.stringify(shown)} proposal ${JSON.stringify(frozen)}`)

    // A real yard change: SIDE 10 ft longer on the length pad.
    await b.locator('[data-step="yard"]').click()
    await sleep(400)
    const was = (await b.locator(`[data-side="${SIDE}"] [data-side-len]`).innerText()).match(/\d+/)?.[0]
    await b.locator(`[data-side-row="${SIDE}"]`).click()
    await b.locator(`[data-side="${SIDE}"] [data-side-length]`).click()
    for (const k of String(Number(was) + 10)) await page.locator(`[data-ftin-pad] [data-pad-key="${k}"]`).click()
    await page.locator('[data-ftin-pad] [data-pad-done]').click()
    await sleep(800)
    await b.locator('[data-step="price"]').click()
    await sleep(800)
    const kind = await line.getAttribute('data-tiers-as-sent')
    const text = await line.innerText()
    check(`${tag}: after the yard change the line says new prices, not "as sent"`, kind === 'changed' && !/\bas (they were when )?sent\b/i.test(text) && /new prices/.test(text), text)
    const after = {}
    for (const key of Object.keys(frozen)) after[key] = cents(await b.locator(`[data-tier="${key}"] [data-tier-price]`).innerText())
    check(`${tag}: the tiers are priced for the new yard`, Object.keys(frozen).every(k => after[k] !== frozen[k]), JSON.stringify(after))
    check(`${tag}: no page errors`, errors.length === 0, errors.join(' | '))
    await b.locator('[data-quote-close]').click()
    await sleep(800)
    const again = (await (await ctx.request.get(`${API}/api/saved-quotes/${QUOTE_ID}`)).json()).data
    check(`${tag}: nothing saved (the proposal is as sent)`, JSON.stringify(again.proposal.options) === JSON.stringify(q.proposal.options) && again.updatedAt === q.updatedAt)
  } finally {
    await browser.close()
  }
}

// SAVE_QUOTE_ID: a throwaway copy of such a quote (it is saved). A note only save asks first when any card the
// customer reads would change; "Keep the sent prices" keeps them and saves the note; "Save new version" puts the
// new prices on and flags it to be sent again; a save that changes nothing the customer reads asks nothing.
async function saves(id) {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  try {
    await signInByCookie(ctx, { api: API })
    const get = async () => (await (await ctx.request.get(`${API}/api/saved-quotes/${id}`)).json()).data
    const good = q => q.proposal.options.find(o => o.tier?.key === 'good').finalPrice
    const start = await get()
    const page = await ctx.newPage()
    page.on('dialog', d => d.accept().catch(() => {}))
    async function saveWithNote(note) {
      await page.goto(`${APP}/?quote=${id}`)
      const b = page.locator('[data-quote-builder]')
      await b.waitFor({ timeout: 30000 })
      await sleep(1500)
      await page.locator('[data-save-open]').click()
      const box = page.locator('textarea').last()
      await box.fill(note)
      await page.locator('[data-save-submit]').click()
      await sleep(800)
      return page.locator('[data-quote-lock-dialog="sent"]')
    }
    async function savedNote(note) { for (let i = 0; i < 20; i++) { const q = await get(); if (q.notes === note) return q; await sleep(500) } return get() }

    let dlg = await saveWithNote('E2E note 1')
    const msg = await dlg.isVisible() ? await page.locator('[data-quote-sent-message]').innerText() : ''
    check('a note only save asks first, naming the card that would change', /Good: \$9,407\.00 then/.test(msg), msg)
    await page.locator('[data-quote-sent-keep]').click()
    let q = await savedNote('E2E note 1')
    check('"Keep the sent prices": Good stays $9,407, the note saves, not flagged', good(q) === good(start) && q.notes === 'E2E note 1' && !q.needsResend && JSON.stringify(q.proposal.options) === JSON.stringify(start.proposal.options), `Good ${good(q)}`)

    dlg = await saveWithNote('E2E note 2')
    check('asked again on the next save', await dlg.isVisible())
    await page.locator('[data-quote-sent-new]').click()
    q = await savedNote('E2E note 2')
    check('"Save new version": the new prices go on and it is flagged to be sent again', good(q) !== good(start) && q.needsResend === true, `Good ${good(q)}`)

    dlg = await saveWithNote('E2E note 3')
    check('nothing the customer reads changes: no question', !(await dlg.isVisible()))
    q = await savedNote('E2E note 3')
    check('and it saved', q.notes === 'E2E note 3')
  } finally {
    await browser.close()
  }
}

await run(chromium, { width: 1440, height: 900 }, 'computer')
await run(webkit, { width: 390, height: 844 }, 'iPhone size')
if (process.env.SAVE_QUOTE_ID) await saves(process.env.SAVE_QUOTE_ID)
const failed = results.filter(r => !r).length
console.log(failed ? `${failed} FAILED` : 'ALL PASSED')
process.exit(failed ? 1 : 0)
