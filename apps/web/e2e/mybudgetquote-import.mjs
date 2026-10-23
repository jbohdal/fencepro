// The MyBudgetQuote import as Jonathan sees it, on the dev copy, after
// `scripts/mybudgetquote-import.ts --apply` ran there (it writes nothing itself
// until step 5, the Undo).
//
//   cd apps/web && pnpm -s build
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 E2E_ACCESS_TOKEN=<dev owner token> SHOTS=<folder> node e2e/mybudgetquote-import.mjs
//   ... UNDO=1 also presses Undo import at the very end (Settings > Deleted Records), on the desktop, after the phone pass.
//
// WebKit at desktop (1440x900) and phone (390x844) size:
//   1. An imported customer (a First Contact row): the tag, the "MyBudgetQuote
//      history" card (estimate, status), the pinned history note on Notes.
//   2. A flagged one ("contact cleared"): the flags show, in amber.
//   3. Anthony Gonzalez: "Possible match: Ant G".
//   4. The pipeline: No Answer opens, the imported cards are on top in the
//      file's order (order_in_stage), the column count includes them; First
//      Contact holds its imported cards in the file's order too.
//   5. Customers: searching "MyBudgetQuote dropoff" lists the dropoffs.
//   No sideways scrolling on the phone; no page errors.
//   6. (UNDO=1) Settings > Deleted Records > Imports > Undo import, typing UNDO:
//      the import says Undone, its customers are gone from the list, one
//      Import row is in Deleted Records with Restore.
import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import { webkit } from 'playwright'
import fs from 'fs'
import { signInByCookie } from './lib.mjs'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || 'http://localhost:4001'
const TOKEN = process.env.E2E_ACCESS_TOKEN || ''
const SHOTS = process.env.SHOTS || ''
const local = u => /^https?:\/\/(localhost|127\.0\.0\.1):4001(\/|$)/.test(u)
if (!local(APP) || !local(API)) { console.error('Refusing to run: the dev copy only (localhost:4001).'); process.exit(2) }
if (!TOKEN) { console.error('Set E2E_ACCESS_TOKEN (an owner login on the dev server).'); process.exit(2) }
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
let tagNow = ''
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  [${tagNow}] ${name}${detail ? '  -- ' + detail : ''}`) }
const H = { 'X-Staff-Request': '1', 'Content-Type': 'application/json' }
const get = async (ctx, p) => (await (await ctx.request.get(`${API}${p}`, { headers: H })).json()).data

const browser = await webkit.launch()
let undone = false
try {
  for (const [name, width, height] of [['phone', 390, 844], ['desktop', 1440, 900]]) {
    tagNow = `webkit ${name}`
    const phone = width < 640
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: phone ? 3 : 1, hasTouch: phone })
    await signInByCookie(ctx, { token: TOKEN, cookie: '', email: '', password: '' })
    const errors = []
    const page = await ctx.newPage()
    page.on('pageerror', e => errors.push(String(e).slice(0, 200)))
    page.on('dialog', d => d.accept().catch(() => {}))
    const tap = async loc => { await loc.scrollIntoViewIfNeeded().catch(() => {}); await (phone ? loc.tap() : loc.click()); await sleep(400) }
    const noSideScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
    const shot = async n => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-${n}.png` }) }

    // What the server has: the import, its customers, its cards.
    const imports = await get(ctx, '/api/deleted-records/imports')
    const batch = imports.find(b => b.source === 'mybudgetquote' && !b.undoneAt)
    check('an active MyBudgetQuote import on the dev copy', !!batch, batch?.label)
    if (!batch) break
    const contacts = await get(ctx, '/api/crm-contacts')
    const find = (f, l) => contacts.find(c => c.firstName === f && c.lastName === l && (c.tags || []).includes('MyBudgetQuote import'))
    const mandy = find('Mandy', 'Hernandez'), anthony = find('Anthony', 'Gonzalez'), antG = find('Ant', 'G'), carlton = find('Carlton', 'Williams')
    check('the imported customers are on the list (Mandy Hernandez, Anthony Gonzalez, Ant G, Carlton Williams)', !!(mandy && anthony && antG && carlton))
    const pipe = await get(ctx, '/api/pipeline')
    const imported = stage => (pipe.leads || []).filter(l => l.importBatchId === batch.id && l.stage === stage)

    // 1. A First Contact customer: tag, history card, pinned note.
    await page.goto(`${APP}/customers/${mandy.id}`)
    await page.waitForSelector('[data-customer-tab]', { timeout: 60000 }); await sleep(1200)
    check('the customer page shows the tag "MyBudgetQuote import"', await page.locator('[data-customer-tag="MyBudgetQuote import"]').isVisible())
    const hist = page.locator('[data-import-history]')
    await hist.waitFor({ timeout: 15000 }).catch(() => {})
    const histText = await hist.innerText().catch(() => '')
    check('the "MyBudgetQuote history" card: estimate, status, card', /MyBudgetQuote history/.test(histText) && histText.includes('$3,570 to $3,930 (2026-10-17)') && /Received/.test(histText) && /First Contact/.test(histText), histText.slice(0, 120).replace(/\n/g, ' | '))
    check('no sideways scrolling on the customer page', await noSideScroll())
    await shot('customer')
    await tap(page.locator('[data-customer-tab="notes"]'))
    const firstNote = page.locator('[data-note]').first()
    await firstNote.waitFor({ timeout: 15000 }).catch(() => {})
    const noteText = await firstNote.innerText().catch(() => '')
    check('Notes: the pinned "MyBudgetQuote history" note is first', /Pinned/.test(noteText) && /MyBudgetQuote history/.test(noteText) && noteText.includes('Old online estimate $3,570 to $3,930 (2026-10-17)'), noteText.slice(0, 100).replace(/\n/g, ' | '))
    await shot('notes')

    // 2. Flags show on a flagged customer.
    await page.goto(`${APP}/customers/${carlton.id}`)
    await page.waitForSelector('[data-customer-tab]', { timeout: 60000 })
    await page.locator('[data-import-flags]').waitFor({ timeout: 15000 }).catch(() => {})
    const flags = await page.locator('[data-import-flags]').innerText().catch(() => '')
    check('a flagged customer shows its flags ("staff phone/email was entered", "contact cleared")', /staff phone\/email was entered/.test(flags) && /contact cleared/.test(flags), flags.replace(/\n/g, ' | '))
    await shot('flags')

    // 3. Anthony Gonzalez: possible match Ant G.
    await page.goto(`${APP}/customers/${anthony.id}`)
    await page.waitForSelector('[data-customer-tab]', { timeout: 60000 })
    const notice = page.locator(`[data-match-customer="${antG.id}"]`)
    await notice.waitFor({ timeout: 15000 }).catch(() => {})
    check('Anthony Gonzalez shows "Possible match: Ant G" with Merge and Not the same person', await notice.isVisible().catch(() => false) && await notice.locator('[data-merge-match]').isVisible() && await notice.locator('[data-dismiss-match]').isVisible())
    await shot('possible-match')

    // 4. The pipeline: imported cards on top of No Answer, in the file's order.
    await page.goto(`${APP}/pipeline`)
    await page.waitForSelector('[data-kanban-board]', { timeout: 60000 }); await sleep(1500)
    const na = page.locator('[data-kanban-col="No Answer"]')
    if (await na.getAttribute('data-collapsed') === 'true') await tap(na.locator('button').first())
    await page.waitForSelector('[data-kanban-col="No Answer"]:not([data-collapsed]) [data-kanban-card]', { timeout: 20000 }).catch(() => {})
    const naIds = await page.locator('[data-kanban-col="No Answer"] [data-kanban-card]').evaluateAll(els => els.map(e => e.getAttribute('data-kanban-card')))
    const wantNa = imported('No Answer').map(l => l.id)
    // Cards nobody placed by hand come first, newest on top; a few older No Answer cards were never placed in it either and sit among them by date.
    const shownImported = naIds.filter(id => wantNa.includes(id))
    const lastImported = naIds.indexOf(wantNa[wantNa.length - 1])
    check(`No Answer: all ${wantNa.length} imported cards, in the file's order (order_in_stage)`, wantNa.length > 0 && JSON.stringify(shownImported) === JSON.stringify(wantNa), `${naIds.slice(0, lastImported + 1).length - wantNa.length} older unplaced cards sit among them by date`)
    check('No Answer: the imported cards come before the cards placed by hand', naIds.slice(lastImported + 1).every(id => (pipe.leads || []).find(l => l.id === id)?.boardOrder?.stage === 'No Answer'))
    const naCount = Number(await na.locator('[data-kanban-count]').innerText().catch(() => '0'))
    check('No Answer: the count includes them', naCount === (pipe.leads || []).filter(l => l.stage === 'No Answer').length, `${naCount}`)
    const firstCard = await na.locator('[data-kanban-card]').first().innerText().catch(() => '')
    check('No Answer: the top card is the newest row (order_in_stage 1 among cards)', firstCard.includes(imported('No Answer')[0].firstName), firstCard.slice(0, 60).replace(/\n/g, ' | '))
    const fcIds = await page.locator('[data-kanban-col="First Contact"] [data-kanban-card]').evaluateAll(els => els.map(e => e.getAttribute('data-kanban-card')))
    const wantFc = imported('First Contact').map(l => l.id)
    check(`First Contact: the ${wantFc.length} imported cards keep the file's order`, wantFc.length === 5 && JSON.stringify(fcIds.filter(id => wantFc.includes(id))) === JSON.stringify(wantFc))
    check('no sideways scrolling of the page on the pipeline', phone ? await page.evaluate(() => document.body.scrollWidth <= window.innerWidth + 1) : true)
    await shot('pipeline')

    // 5. Customers: search finds the dropoffs by their tag.
    await page.goto(`${APP}/customers`)
    const search = page.locator('input[placeholder="Search customers..."]')
    await search.waitFor({ timeout: 60000 }); await sleep(800)
    await search.fill('MyBudgetQuote dropoff'); await sleep(1200)
    const dropoffs = contacts.filter(c => (c.tags || []).includes('MyBudgetQuote dropoff'))
    const bodyText = await page.locator('body').innerText()
    check(`searching "MyBudgetQuote dropoff" lists the ${dropoffs.length} dropoffs`, dropoffs.length > 0 && bodyText.includes(`${dropoffs.length.toLocaleString('en-US')} of`) || bodyText.includes(`${dropoffs.length} of`), (bodyText.match(/\d[\d,]* of [\d,]+ customers?/) || [''])[0])
    check('no page errors', errors.length === 0, errors.join(' / '))
    await shot('search')

    // 6. Undo import, once, on the desktop.
    if (process.env.UNDO === '1' && !phone && !undone) {
      await page.goto(`${APP}/settings?tab=deleted`)
      const btn = page.locator(`[data-import-undo="${batch.id}"]`)
      await btn.waitFor({ timeout: 60000 })
      await tap(btn)
      await page.locator('[data-confirm-input]').fill('UNDO')
      await tap(page.locator('[data-confirm-delete]'))
      await page.locator(`[data-import-row="${batch.id}"] [data-import-undone]`).waitFor({ timeout: 120000 }).catch(() => {})
      check('Undo import: the import now says Undone', await page.locator(`[data-import-row="${batch.id}"] [data-import-undone]`).isVisible().catch(() => false))
      const row = page.locator(`[data-deleted-row="${batch.id}"][data-deleted-type="import"]`)
      await row.waitFor({ timeout: 20000 }).catch(() => {})
      check('Deleted Records: one Import row with Restore', await row.isVisible().catch(() => false) && await row.locator(`[data-deleted-restore="${batch.id}"]`).isVisible().catch(() => false), (await row.innerText().catch(() => '')).slice(0, 160).replace(/\n/g, ' | '))
      const after = await get(ctx, '/api/crm-contacts')
      check('the imported customers are gone from the list', !after.some(c => (c.tags || []).includes('MyBudgetQuote dropoff')) && !after.some(c => c.id === mandy.id), `${contacts.length} -> ${after.length}`)
      await shot('undone')
      undone = true
    }
    await ctx.close()
  }
} catch (err) {
  check('ran to the end', false, String(err?.stack || err).slice(0, 400))
} finally {
  await browser.close()
}
const failed = results.filter(x => !x).length
console.log(`\n${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
