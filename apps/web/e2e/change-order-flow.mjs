// Change orders, start to finish on a phone (Jonathan, Oct 22 2026). Dev copy
// only (4001 serves the built app: run `pnpm -s build` in apps/web first).
//
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 E2E_ACCESS_TOKEN=<dev owner token> node e2e/change-order-flow.mjs
//   On the Android emulator's Chrome: adb reverse tcp:4001 tcp:4001;
//   adb forward tcp:9333 localabstract:chrome_devtools_remote; CDP_URL=http://localhost:9333 node e2e/change-order-flow.mjs
//   E2E_SHOTS=<folder> saves screenshots.
//
// Set up (API, as the owner): a customer, a quote copied from a real priced
// quote and marked Sold (its quoted cost saved), its job scheduled for one
// day, its install packet sent to the crew. A second one (B) is copied from a
// quote with a yard drawing.
//
//   0. Round 2 review (Oct 26 2026), job B on the phone, as Jonathan: 6 ft more
//      on one side from the job page, counting every tap and every key press:
//      "Change order" opens the drawing at once (no menu; "Type the change
//      instead" is there), the side's length label opens its length pad, the
//      digits, "Make change order" on the pad (no Done first), the required
//      "Reason for the change" (one tap into it, then the typed words, counted
//      apart), Save: under 9 taps and pad keys (Oct 26 2026: was under 8
//      before the reason was required).
//      A footage change that adds no panel is $0 and still saves, saying so.
//      "Customer signs on this phone" covers the whole screen: no cost and no
//      staff name can be read behind it; it shows the new contract total.
//      Signed: the pipeline card's value and the card window follow the contract.
//   1. On a 390 x 844 phone, the job page: "Change order" (top of the job) →
//      "Change the yard drawing": the quote builder opens on the signed quote;
//      12 ft more and a walk gate; Save → "Make a change order", filled in and
//      priced; saved; "Customer signs on this phone": name and a finger
//      signature. Then every item follows: contract rev 2 / CO-1, the job's
//      contract value, scope and crew days (and the schedule warning when it
//      no longer fits), the Final, pull sheet rev 2 with the changes marked
//      (rev 1 kept; the Pullsheets tab shows it), the crew's packet link shows
//      the change and the job page says the packet is out of date, the quoted
//      cost includes it, the warranty is as signed, the signed PDF is in the
//      customer's Documents (portal), the job's contract value is what Reports
//      and the pipeline read, the history and the job timeline say "Change
//      order CO-1 approved: +$… (added 12 ft and a walk gate)".
//   2. A credit, typed on the phone from the pipeline card window, "Approved
//      verbally" with a reason: rev 3, the contract and Final come down, the
//      customer's link says "Not signed by you yet".
//   3. Deposit and Final paid (API); a +$200 change order typed on the phone
//      from the customer page, approved verbally: its own invoice "Change order
//      CO-3", the paid Final unchanged; then a credit after it is all paid
//      (API): a credit on the balance, no paid invoice cut.
//   4. "Type the change" → "Pick from price list" on the phone: "Replace a
//      post" from the Repair price list (quantity 2, priced again as a repair
//      quote prices 2), a catalog item as a credit, and a custom line; saved
//      with each picked line's quantity and source.
// Removes everything it made.
import './devOnly.mjs'
import './sharedLock.mjs'
import { webkit, chromium } from 'playwright'
import { signInByCookie } from './lib.mjs'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || 'http://localhost:4001'
const OWNER = process.env.E2E_ACCESS_TOKEN || ''
const CDP = process.env.CDP_URL || ''
const SHOTS = process.env.E2E_SHOTS || ''
const NAME = CDP ? 'android' : 'webkit'
// The dev copy only: localhost, never port 4000 (devOnly.mjs checks the same; a worktree's own dev server may use another port).
if (!/^http:\/\/localhost:\d+$/.test(APP) || !/^http:\/\/localhost:\d+$/.test(API) || /:4000$/.test(APP) || /:4000$/.test(API)) { console.error('Refusing to run: the dev copy only (localhost, not port 4000).'); process.exit(2) }
if (!OWNER) { console.error('Set E2E_ACCESS_TOKEN (an owner login on the dev server).'); process.exit(2) }
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const call = async (method, p, body) => {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(`${API}${p}`, { method, headers: { Authorization: `Bearer ${OWNER}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
      const text = await r.text()
      let json = {}; try { json = JSON.parse(text) } catch { /* html */ }
      const out = { status: r.status, json, text }
      if (method !== 'GET' || r.status < 500 || i >= 30) return out
    } catch (e) { if (i >= 30) throw e }
    await sleep(2000)
  }
}
async function until(fn, ms = 20000, every = 500) { const end = Date.now() + ms; for (;;) { const v = await fn().catch(() => null); if (v || Date.now() > end) return v; await sleep(every) } }
const sql = q => execFileSync('psql', ['-d', 'ezbiz_dev', '-At', '-c', q]).toString().trim()
const uuid = s => /^[0-9a-f-]{36}$/i.test(s)
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `dev-co-flow-${NAME}-${name}.png`) }).catch(() => {}) }
const cents = text => { const m = String(text).match(/([−-])?\$\s?([\d,]+(?:\.\d{2})?)/); return m ? (m[1] ? -1 : 1) * Math.round(parseFloat(m[2].replace(/,/g, '')) * 100) : NaN }
const PORTAL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../portal')

const stamp = Date.now().toString(36).slice(-5)
const WHO = `CO Flow ${NAME} ${stamp}`
const contactId = crypto.randomUUID(), quoteId = crypto.randomUUID(), jobId = crypto.randomUUID(), cardId = crypto.randomUUID()
// Job B: a quote with a yard drawing (section 0).
const B = { contactId: crypto.randomUUID(), quoteId: crypto.randomUUID(), jobId: crypto.randomUUID(), cardId: crypto.randomUUID() }
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })

const browser = CDP ? await chromium.connectOverCDP(CDP) : await webkit.launch()
let ctx, page
const errors = []
try {
  // ── Set up ──
  let all = []
  for (let i = 0; i < 30 && !all.length; i++) { all = (await call('GET', '/api/saved-quotes')).json.data ?? []; if (!all.length) await sleep(2000) }
  const template = all.filter(q => !/^E2E/i.test(q.customerName) && Array.isArray(q.pullSheet) && q.pullSheet.length >= 8 && q.totalCOGS > 0 && !q.work && q.runs?.length && q.pullSheet.some(l => l.item === 'ND, Donut') && /ND/.test(q.fenceStyle))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0]
  if (!template) throw new Error('no priced no dig quote to copy on dev')
  const priced = ['fenceStyle', 'runs', 'runRails', 'corners', 'ends', 'walkGates', 'dblGates', 'tearOutSections', 'tearOutGates', 'adjLaborHrs', 'hasSalesman', 'priceAdjust', 'sections', 'materialCost', 'laborCost', 'tearOutCost', 'totalCOGS', 'finalPrice', 'gmPct', 'pullSheet', 'pricing']
  const c = await call('POST', '/api/crm-contacts', { id: contactId, firstName: 'E2E', lastName: WHO, phone: '3525550191', email: `e2e-co-flow-${stamp}@example.invalid`, serviceAddress: '5 Change Order Ln, Ocala, FL 34470', leadSource: 'Other', lead: { id: cardId, customerId: contactId, firstName: 'E2E', lastName: WHO, phone: '3525550191', stage: 'Signed Contract', leadSource: 'Other', quoteId, createdAt: today, lastMoved: today }, leadBefore: null })
  const q = await call('POST', '/api/saved-quotes', { id: quoteId, ...Object.fromEntries(priced.map(k => [k, template[k]])), layout: { yard: null, runSections: template.layout?.runSections ?? [] }, crmContactId: contactId, customerName: `E2E ${WHO}`, customerPhone: '3525550191', customerEmail: `e2e-co-flow-${stamp}@example.invalid`, customerAddress: '5 Change Order Ln, Ocala, FL 34470', leadSource: 'Other', salesRep: 'E2E', date: today, status: 'SOLD' })
  const signedCents = Math.round(template.finalPrice * 100)
  const days = Math.max(1, Math.ceil(template.sections / 15))
  const j = await call('POST', '/api/saved-jobs', { id: jobId, quoteId, crmContactId: contactId, customerName: `E2E ${WHO}`, customerAddress: '5 Change Order Ln, Ocala, FL 34470', fenceStyle: template.fenceStyle, sections: template.sections, totalFeet: Math.round(template.runs.reduce((s, f) => s + f, 0)), walkGates: template.walkGates, dblGates: template.dblGates, quotePrice: template.finalPrice, contractValue: template.finalPrice, status: 'scheduled', scheduledDate: '2026-11-02', scheduledEndDate: '2026-11-02', estimatedDays: days, crewAssigned: `E2E crew ${stamp}` })
  const pk = await call('POST', '/api/install-packets', { jobId, snapshot: { style: template.fenceStyle, pullSheet: template.pullSheet.filter(l => !l.moneyOnly).map(l => ({ item: l.item, qty: l.qty })) } })
  const warrantyBefore = (await call('GET', `/api/warranties/job/${jobId}`)).json.data?.warranty?.name
  // B: copied from a priced no dig quote with a yard drawing (one side without a gate to lengthen).
  const plain = side => side && side.lengthIn >= 96 && !side.gate && !side.off && !side.skip
  const templateB = all.filter(q => !/^E2E/i.test(q.customerName) && Array.isArray(q.pullSheet) && q.pullSheet.length >= 8 && q.totalCOGS > 0 && !q.work && /^WV-ND 6'x8'/.test(q.fenceStyle) && q.layout?.yard?.sides?.some(plain))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0]
  if (!templateB) throw new Error('no priced no dig quote with a yard drawing to copy on dev')
  const WHO_B = `${WHO} B`
  const cB = await call('POST', '/api/crm-contacts', { id: B.contactId, firstName: 'E2E', lastName: WHO_B, phone: '3525550192', email: `e2e-co-flow-b-${stamp}@example.invalid`, serviceAddress: '7 Change Order Ln, Ocala, FL 34470', leadSource: 'Other', lead: { id: B.cardId, customerId: B.contactId, firstName: 'E2E', lastName: WHO_B, phone: '3525550192', stage: 'Signed Contract', leadSource: 'Other', quoteId: B.quoteId, createdAt: today, lastMoved: today }, leadBefore: null })
  const qB = await call('POST', '/api/saved-quotes', { id: B.quoteId, ...Object.fromEntries(priced.map(k => [k, templateB[k]])), layout: templateB.layout, crmContactId: B.contactId, customerName: `E2E ${WHO_B}`, customerPhone: '3525550192', customerEmail: `e2e-co-flow-b-${stamp}@example.invalid`, customerAddress: '7 Change Order Ln, Ocala, FL 34470', leadSource: 'Other', salesRep: 'E2E', date: today, status: 'SOLD' })
  const jB = await call('POST', '/api/saved-jobs', { id: B.jobId, quoteId: B.quoteId, crmContactId: B.contactId, customerName: `E2E ${WHO_B}`, customerAddress: '7 Change Order Ln, Ocala, FL 34470', fenceStyle: templateB.fenceStyle, sections: templateB.sections, totalFeet: Math.round(templateB.runs.reduce((s, f) => s + f, 0)), walkGates: templateB.walkGates, dblGates: templateB.dblGates, quotePrice: templateB.finalPrice, contractValue: templateB.finalPrice, status: 'scheduled', scheduledDate: '2026-11-03', scheduledEndDate: '2026-11-04', estimatedDays: Math.max(1, Math.ceil(templateB.sections / 15)), crewAssigned: `E2E crew B ${stamp}` })
  check('set up B: a Sold quote with a yard drawing, its job and card', cB.status < 300 && qB.status < 300 && jB.status < 300, `${cB.status} ${qB.status} ${jB.status} ${templateB.customerName}`)
  check('set up: customer and card, Sold quote (quoted cost saved), its job scheduled for one day, the crew\'s packet', c.status < 300 && q.status < 300 && j.status < 300 && pk.status === 200 && sql(`SELECT count(*) FROM "JobQuotedCost" WHERE "quoteId" = '${quoteId}'`) === '1',
    `${c.status} ${q.status} ${j.status} ${pk.status} ${template.fenceStyle} ${template.sections} sections`)

  // ── The phone ──
  ctx = CDP ? browser.contexts()[0] : await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })
  const setToken = t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }
  if (CDP) { const p0 = await ctx.newPage(); await p0.goto(APP); await p0.evaluate(setToken, OWNER); await p0.close() }
  // The staff cookie, as the app signs in (nothing in the browser's storage).
  else await signInByCookie(ctx, { cookie: '', email: '', password: '', token: OWNER, api: API })
  // A new tab for each screen (a long WebKit session can crash when a page is opened over it again).
  const open = async url => {
    if (page) await page.close().catch(() => {})
    page = await ctx.newPage()
    page.on('pageerror', e => errors.push(String(e).slice(0, 200)))
    page.on('dialog', d => d.accept().catch(() => {}))
    await page.route('**/api/automations/trigger', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' }))
    await page.goto(url)
  }
  // The phone's keyboard closes first (a field still focused keeps the Android page scrolling).
  let taps = 0
  const tap = async loc => { taps++; await page.evaluate(() => document.activeElement?.blur?.()).catch(() => {}); await loc.scrollIntoViewIfNeeded(); await loc.waitFor({ state: 'visible', timeout: 15000 }); await (CDP ? loc.click() : loc.tap()); await sleep(300) }
  const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
  async function sign() {
    const pad = page.locator('[data-co-sign-sheet] canvas')
    await pad.scrollIntoViewIfNeeded()
    const b = await pad.boundingBox()
    await page.mouse.move(b.x + 20, b.y + b.height / 2); await page.mouse.down()
    for (let i = 1; i <= 8; i++) await page.mouse.move(b.x + 20 + i * (b.width - 40) / 8, b.y + b.height / 2 + (i % 2 ? -15 : 15))
    await page.mouse.up(); await sleep(200)
  }

  // ── 0. Jonathan, job B: 6 ft more on a side, every tap and key press counted ──
  {
    // A side where 6 ft more is still the same 8 ft panels (per run rounding) when there is one: the $0 case.
    const side = templateB.layout.yard.sides.find(x => plain(x) && x.lengthIn % 12 === 0 && [1, 2].includes((x.lengthIn / 12) % 8)) ?? templateB.layout.yard.sides.find(plain)
    const ftWasB = Math.floor(side.lengthIn / 12)
    await open(`${APP}/operations?job=${B.jobId}`)
    await page.waitForSelector('[data-co-panel]', { timeout: 40000 }); await sleep(1000)
    taps = 0
    const coBtn = page.locator(`[data-co-button="${B.quoteId}"]`).first()
    check('B: "Change order" on a job with a yard drawing goes straight to the drawing', (await coBtn.getAttribute('data-co-direct')) === 'drawing')
    await tap(coBtn)
    await page.waitForSelector('[data-quote-builder] [data-bar-price]', { timeout: 30000 }); await sleep(1200)
    check('B: no menu first; "Type the change instead" is on the drawing', (await page.locator('[data-co-menu]').count()) === 0 && await page.locator('[data-co-type-instead]').isVisible())
    await shot(page, '0a-drawing')
    // The side's length label on the drawing opens its length pad.
    await tap(page.locator(`[data-plan-label="${side.name}"]`).first())
    await page.waitForSelector('[data-ftin-pad]', { timeout: 10000 })
    for (const d of String(ftWasB + 6)) await tap(page.locator(`[data-ftin-pad] [data-pad-key="${d}"]`))
    await shot(page, '0b-pad')
    // "Make change order" on the pad keeps the length and makes it (no Done first).
    await tap(page.locator('[data-ftin-pad] [data-pad-action]'))
    await page.waitForSelector('[data-co-modal]', { timeout: 15000 })
    const lineB = await page.locator('[data-co-line-description]').first().inputValue()
    const amtB = await page.locator('[data-co-line-amount]').first().inputValue()
    const saveB = page.locator('[data-co-save-draft]')
    // The reason is required (Oct 26 2026): empty, nothing generic filled in; Save is grey and the Save bar says why.
    const reasonB = page.locator('[data-co-reason]')
    check('B: the reason is empty and required: Save is grey and the Save bar says "Type the reason for the change"',
      (await reasonB.inputValue()) === '' && !(await saveB.isEnabled()) && /Type the reason for the change/.test(await page.locator('[data-co-save-bar] [data-co-why-not]').innerText().catch(() => '')))
    await tap(reasonB)
    const whyB = 'Customer wants the side longer'
    await page.keyboard.type(whyB)
    check('B: filled in "Add 6 ft of fence": $0 with "no price change" when it is still the same panels, else priced with the panels added; Save works either way',
      /^Add 6 ft of fence/.test(lineB) && (amtB === '0' ? /still \d+ panels? on that side, no price change/.test(lineB) && await page.locator('[data-co-no-price-change]').isVisible() : /panels? more/.test(lineB) && Number(amtB) > 0) && await saveB.isEnabled(),
      `${lineB} | $${amtB}`)
    await shot(page, '0c-filled')
    const signedQuoteAt = (await call('GET', `/api/saved-quotes/${B.quoteId}`)).json.data?.updatedAt
    await tap(saveB)
    const coB = await until(async () => ((await call('GET', `/api/change-orders?quoteId=${B.quoteId}`)).json.data ?? []).find(x => x.number === 1), 15000)
    // The change order is its own record: the signed quote is not saved again and nothing says "Quote sold, job created"
    // (re-check, Oct 26 2026: the drawing path re-saved the signed quote the same second).
    await sleep(2500)
    const coToasts = await page.locator('[data-toast]').allInnerTexts().catch(() => [])
    const quoteAtAfter = (await call('GET', `/api/saved-quotes/${B.quoteId}`)).json.data?.updatedAt
    check('B: saving the change order from the drawing does not save the signed quote again or say "Quote sold"', !coToasts.some(t => /Quote sold|job created/i.test(t)) && quoteAtAfter === signedQuoteAt, `${coToasts.join(' | ') || 'no toast'} · quote ${signedQuoteAt} -> ${quoteAtAfter}`)
    check(`B: job page to a change order ready to sign in ${taps} taps and pad key presses, every one counted, plus the typed reason (${whyB.length} letters) (under 9)`, taps < 9 && !!coB, `${taps} taps + reason "${whyB}"`)
    check('B: saved with the new drawing: 6 ft more, and the reason as typed', coB?.status === 'draft' && coB?.work && coB?.scope?.footageFt === 6 && coB?.reason === whyB, JSON.stringify({ scope: coB?.scope, reason: coB?.reason }))
    // The customer signs on this phone: nothing of the job page can be read behind the sheet.
    await open(`${APP}/operations?job=${B.jobId}`)
    await page.waitForSelector('[data-co-row="1"] [data-co-sign-here]', { timeout: 30000 })
    const costShown = await page.locator('[data-co-row="1"] [data-co-cost]').count()
    await tap(page.locator('[data-co-row="1"] [data-co-sign-here]'))
    await page.waitForSelector('[data-co-sign-sheet]', { timeout: 10000 }); await sleep(400)
    const behind = await page.evaluate(() => {
      const sheet = document.querySelector('[data-co-sign-sheet]')
      const r = sheet.getBoundingClientRect()
      const covers = r.top <= 0 && r.left <= 0 && r.right >= innerWidth && r.bottom >= innerHeight && getComputedStyle(sheet).backgroundColor === 'rgb(255, 255, 255)'
      // Every point on the screen is the sheet's (nothing of the job page shows through or around it).
      const pts = [[10, 10], [innerWidth / 2, innerHeight / 3], [innerWidth - 10, innerHeight / 2], [20, innerHeight - 20]]
      const all = pts.every(([x, y]) => sheet.contains(document.elementFromPoint(x, y)))
      return { covers, all, text: sheet.innerText }
    })
    check('B: the signing sheet covers the whole screen; no quoted cost, materials, labor or staff name in it', behind.covers && behind.all && !/Quoted cost|materials|labor|By Jonathan|By E2E/i.test(behind.text), `${JSON.stringify({ covers: behind.covers, all: behind.all, costShownOnPage: costShown })}`)
    const total0 = templateB.finalPrice * 100
    check('B: the sheet shows "Why:" with the reason typed', (await page.locator('[data-co-sign-why]').innerText().catch(() => '')) === `Why: ${whyB}`, await page.locator('[data-co-sign-why]').innerText().catch(() => 'none'))
    check('B: the sheet shows the contract now and the new contract total', cents(await page.locator('[data-co-sign-new-contract]').innerText()) === Math.round(total0) + coB.totalCents, await page.locator('[data-co-sign-contract]').innerText())
    await shot(page, '0d-sign-sheet')
    await page.locator('[data-co-sign-name]').fill('Pat Customer')
    await page.locator('[data-co-sign-name]').blur()
    await sign()
    await tap(page.locator('[data-co-sign-submit]'))
    const signedB = await until(async () => { const r = ((await call('GET', `/api/change-orders?quoteId=${B.quoteId}`)).json.data ?? []).find(x => x.number === 1); return r?.status === 'approved' ? r : null }, 20000)
    check('B: signed in person', !!signedB)
    // The pipeline card window: the sold quote reads the contract when change orders changed it.
    if (signedB && signedB.totalCents) {
      await open(`${APP}/pipeline?card=${B.cardId}`)
      const row = await until(async () => (await page.locator(`[data-card-window] [data-card-quote="${B.quoteId}"] [data-card-quote-contract]`).count()) > 0, 30000)
      check('B: the card window shows the contract (signed + change orders)', !!row && // The card shows whole dollars (Oct 29 2026: billing in whole dollars), and B's quote is a copy of a dev quote that has cents.
        Math.abs(cents(await page.locator(`[data-card-quote="${B.quoteId}"] [data-card-quote-contract]`).innerText()) - (Math.round(total0) + signedB.totalCents)) <= 50,
        await page.locator(`[data-card-quote="${B.quoteId}"] [data-card-quote-contract]`).innerText().catch(() => 'no contract line'))
    }
  }

  // ── 1. From the yard drawing: 12 ft and a walk gate, signed on this phone ──
  await open(`${APP}/operations?job=${jobId}`)
  await page.waitForSelector('[data-co-panel]', { timeout: 40000 }); await sleep(1000)
  check('job page: "Change order" at the top of a signed job', await page.locator(`[data-co-button="${quoteId}"]`).first().isVisible())
  await tap(page.locator(`[data-co-button="${quoteId}"]`).first())
  await page.waitForSelector('[data-co-menu]', { timeout: 10000 })
  check('the choice: change the yard drawing, or type the change', (await page.locator('[data-co-from-drawing-start]').isVisible()) && (await page.locator('[data-co-from-lines]').isVisible()))
  await shot(page, '1-menu')
  await tap(page.locator('[data-co-from-drawing-start]'))
  await page.waitForSelector('[data-quote-builder] [data-bar-price]', { timeout: 30000 }); await sleep(1200)
  check('the quote builder opens on the signed quote, on the drawing, saying how to make the change order', /Change order: change the drawing, then tap Make change order/.test(await page.locator('[data-quote-locked-banner]').innerText()))
  // Round 2 (Oct 26 2026): straight from the drawing to the change order; no "Update quote", no status, no lock message.
  const runInput = page.locator('[data-quote-builder] input[placeholder="Length in feet"]').first()
  const ftWas = parseFloat(await runInput.inputValue())
  await runInput.fill(String(ftWas + 12)); await sleep(300)
  const walk = page.locator('[data-quote-builder] label:text-is("Walk gates") + input')
  await walk.fill(String((template.walkGates || 0) + 1)); await sleep(300)
  check('the bar offers "Make change order" on the drawing step, never "Update quote"', (await page.locator('[data-quote-bar] [data-co-make]').isVisible()) && (await page.locator('[data-quote-bar] [data-save-open]').count()) === 0)
  await shot(page, '1b-drawing')
  await tap(page.locator('[data-quote-bar] [data-co-make]'))
  check('no status picker and no "This quote is signed" detour', (await page.locator('[data-save-submit]').count()) === 0 && (await page.locator('[data-quote-lock-dialog]').count()) === 0)
  await page.waitForSelector('[data-co-modal]', { timeout: 10000 })
  const coLines = await page.locator('[data-co-line-description]').evaluateAll(els => els.map(e => e.value))
  const total = cents(await page.locator('[data-co-total]').innerText())
  check('the change order is filled in: 12 ft and a walk gate, priced in whole dollars', coLines.some(l => /^Add 12 ft of fence/.test(l)) && coLines.some(l => /^Add 1 walk gate/.test(l)) && total > 0 && total % 100 === 0, `${coLines.join(' | ')} ${total}`)
  check('it says the drawing goes with it', await page.locator('[data-co-from-drawing]').isVisible())
  check('phone: the change order fits the screen', await fits())
  await page.locator('[data-co-reason]').fill('Customer asked for 12 ft more and a walk gate')
  await shot(page, '2-filled-in')
  await tap(page.locator('[data-co-save-draft]'))
  const co1 = await until(async () => ((await call('GET', `/api/change-orders?quoteId=${quoteId}`)).json.data ?? []).find(x => x.number === 1), 15000)
  check('saved: CO-1, a draft, with the new work (12 ft and a walk gate more)', co1?.status === 'draft' && co1?.work && co1.scope?.footageFt === 12 && co1.scope?.walkGates === 1, JSON.stringify(co1?.scope))
  // Back on the job page: the customer signs on this phone.
  await open(`${APP}/operations?job=${jobId}`)
  await page.waitForSelector('[data-co-row="1"] [data-co-sign-here]', { timeout: 30000 })
  await tap(page.locator('[data-co-row="1"] [data-co-sign-here]'))
  await page.waitForSelector('[data-co-sign-sheet]', { timeout: 10000 })
  await page.locator('[data-co-sign-name]').fill('Pat Customer')
  await page.locator('[data-co-sign-name]').blur() // the phone's keyboard closes, as when the customer taps the pad
  await sign()
  check('phone: the signing sheet fits the screen', await fits())
  await shot(page, '3-sign')
  await tap(page.locator('[data-co-sign-submit]'))
  const signed = await until(async () => { const r = ((await call('GET', `/api/change-orders?quoteId=${quoteId}`)).json.data ?? []).find(x => x.number === 1); return r?.status === 'approved' ? r : null }, 20000)
  check('signed in person: approved, contract rev 2, CO-1, signed by the customer', signed?.contractRev === 2 && signed?.signedVia === 'in_person' && signed?.signedBy === 'Pat Customer', JSON.stringify([signed?.contractRev, signed?.signedVia]))
  check('the job page shows it signed, contract rev 2', !!(await until(async () => (await page.locator('[data-co-row="1"] [data-co-customer-signed]').count()) > 0 && /rev 2/.test(await page.locator('[data-co-contract-rev]').innerText()), 15000)))

  // Everything follows.
  const job = (await call('GET', '/api/saved-jobs')).json.data.find(x => x.id === jobId)
  const newSections = signed.work.sections
  check('contract value: signed + CO-1', Math.round(job.contractValue * 100) === signedCents + total, `${job.contractValue}`)
  check('job scope: 12 ft more, a walk gate more, the new sections', job.totalFeet === Math.round(ftWas + 12 + template.runs.slice(1).reduce((s, f) => s + f, 0)) && job.walkGates === (template.walkGates || 0) + 1 && job.sections === newSections, `${job.totalFeet} ft ${job.walkGates} gates ${job.sections} sections`)
  const needDays = Math.max(1, Math.ceil(newSections / 15))
  check('crew days recalculated', job.estimatedDays === needDays, `${job.estimatedDays} vs ${needDays}`)
  const tl = (await call('GET', `/api/change-orders/timeline?jobId=${jobId}`)).json.data
  check('schedule: warned when the one day booked no longer fits (and only then)', needDays > 1 ? /no longer fits/.test(tl.scheduleWarning || '') : tl.scheduleWarning === null, tl.scheduleWarning || 'fits')
  const s1 = (await call('GET', `/api/payments/job/${jobId}`)).json.data.schedule
  const dep = s1.invoices.find(i => i.kind === 'deposit'), fin = s1.invoices.find(i => i.kind === 'final')
  check('payment schedule: contract with CO-1, the Final follows (logged)', s1.contractCents === signedCents + total && fin.amountCents === s1.contractCents - dep.amountCents && s1.log.some(l => /approved change orders now/.test(l.text)), `${s1.contractCents} ${fin.amountCents}`)
  const sheets = (await call('GET', `/api/pull-sheets/customer/${contactId}`)).json.data.entries
  const e = sheets.find(x => x.kind === 'job')
  check('pull sheet: rev 2 for the crew, what changed marked (the walk gate\'s parts), rev 1 kept', e.revision === 2 && e.revisions.map(r => r.rev).join() === '2,1' && e.changes.some(ch => /Gate/i.test(ch.item) && ch.now > ch.was), `${e.revision} ${e.changes.length} changes`)
  const staff = (await call('GET', `/api/install-packets?jobId=${jobId}`)).json.data
  const packetPage = await fetch(`${API}/p/i/${staff.token}`).then(r => r.text())
  check('install packet: the crew\'s link shows CO-1 and the pull sheet changes; the office sees it is out of date', /data-packet-change-order/.test(packetPage) && /data-packet-co-line/.test(packetPage) && staff.changedBy?.number === 1)
  const qc = sql(`SELECT "totalCents" FROM "JobQuotedCost" WHERE "quoteId" = '${quoteId}'`)
  const jc = (await call('GET', `/api/job-costing/job/${jobId}`)).json.data
  check('job costing: the quoted cost includes CO-1, the price is the contract', jc.comparison.quoted.totalCents === Number(qc) + signed.costDelta.totalCents && jc.comparison.quoted.priceCents === signedCents + total, `${jc.comparison.quoted.totalCents} = ${qc} + ${signed.costDelta.totalCents}`)
  const w = (await call('GET', `/api/warranties/job/${jobId}`)).json.data
  check('warranty: the same install, the same warranty', w.warranty?.name === warrantyBefore && !signed.warrantyAfter, w.warranty?.name)
  const doc = sql(`SELECT d."signedBy" || '|' || coalesce(f."isVisibleToCustomer"::text, '') FROM "SignedDocument" d LEFT JOIN "PortalFile" f ON f.id = d."portalFileId" WHERE d."changeOrderId" = '${signed.id}'`)
  check('customer portal: the signed change order PDF is in their Documents (Contract & Warranty)', doc === 'Pat Customer|true', doc)
  check('reports and pipeline value read the job\'s contract: changeOrderTotal = CO-1', Math.round(job.changeOrderTotal * 100) === total, `${job.changeOrderTotal}`)
  const hist = (await call('GET', `/api/follow-ups/history?customerId=${contactId}`)).json.data.map(x => x.title)
  const line = `Change order CO-1 approved: +$${(total / 100).toLocaleString('en-US')} (added 12 ft and a walk gate), by Pat Customer (signed)`
  check('customer history: "Change order CO-1 approved: +$… (added 12 ft and a walk gate), by …, Oct 22"', hist.some(h => h.startsWith(line)), hist.find(h => /CO-1 approved/.test(h)))
  await open(`${APP}/operations?job=${jobId}`); await page.waitForSelector('[data-job-timeline]', { timeout: 30000 }); await sleep(1000)
  const tlText = await page.locator('[data-job-timeline]').innerText()
  check('job page: the job history says it, with the pull sheet revision', tlText.includes(line) && /Pull sheet rev 2/.test(tlText))
  check('job page: the install packet says it is out of date', await page.locator('[data-packet-outdated]').isVisible())
  check('phone: the job page fits the screen', await fits())
  await shot(page, '4-job-after')
  // The Pullsheets tab on the customer page.
  await open(`${APP}/customers/${contactId}`)
  await page.waitForSelector('[data-customer-tab="pullsheets"]', { timeout: 60000 })
  await tap(page.locator('[data-customer-tab="pullsheets"]'))
  await page.waitForSelector(`[data-pull-sheet="j_${jobId}"]`, { timeout: 30000 })
  await tap(page.locator(`[data-pull-sheet="j_${jobId}"]`))
  const revShown = await until(async () => (await page.locator('[data-pull-sheet-rev="2"]').count()) > 0 && (await page.locator('[data-pull-sheet-changed]').count()) > 0, 15000)
  check('customer page Pullsheets: rev 2 with the changed lines marked', !!revShown)
  await shot(page, '5-pullsheet')

  // ── 2. A credit typed on the phone from the pipeline card window, approved verbally ──
  await open(`${APP}/pipeline?card=${cardId}`)
  const cardCo = await until(async () => (await page.locator(`[data-card-window] [data-co-button="${quoteId}"]`).count()) > 0, 30000)
  check('pipeline card window: "Change order" on the signed quote', !!cardCo)
  // Round 2 review: the card stayed at the signed price. Its window and its face read the contract (signed + CO-1).
  const contractRow = page.locator(`[data-card-window] [data-card-quote="${quoteId}"] [data-card-quote-contract]`)
  check('pipeline card window: the sold quote shows the contract (signed + CO-1)', !!(await until(async () => (await contractRow.count()) > 0, 15000)) && cents(await contractRow.innerText()) === signedCents + total, await contractRow.innerText().catch(() => 'none'))
  await tap(page.locator(`[data-card-window] [data-co-button="${quoteId}"]`).first())
  await tap(page.locator('[data-co-from-lines]'))
  await page.waitForSelector('[data-co-modal]', { timeout: 10000 })
  await page.locator('[data-co-line-description]').first().fill('Credit: no caps on the end posts')
  await page.locator('[data-co-line-kind]').first().selectOption('credit')
  await page.locator('[data-co-line-amount]').first().fill('75')
  await page.locator('[data-co-reason]').fill('End posts without caps, as the customer asked')
  check('the credit shows as −$75.00', cents(await page.locator('[data-co-total]').innerText()) === -7500, await page.locator('[data-co-total]').innerText())
  await tap(page.locator('[data-co-save-approved]'))
  await page.locator('[data-co-verbal-reason]').fill('Customer agreed on the phone')
  await page.locator('[data-co-verbal-reason]').blur()
  await shot(page, '6-credit-verbal')
  await tap(page.locator('[data-co-save-verbal]'))
  const co2 = await until(async () => ((await call('GET', `/api/change-orders?quoteId=${quoteId}`)).json.data ?? []).find(x => x.number === 2 && x.status === 'approved'), 15000)
  check('credit approved verbally: rev 3, the reason kept, not signed by the customer', co2?.contractRev === 3 && co2?.verbalReason === 'Customer agreed on the phone' && !co2?.signedAt && co2?.totalCents === -7500)
  const s2 = (await call('GET', `/api/payments/job/${jobId}`)).json.data.schedule
  check('the contract and the Final come down by $75', s2.contractCents === signedCents + total - 7500 && s2.invoices.find(i => i.kind === 'final').amountCents === fin.amountCents - 7500)
  const link = await call('POST', `/api/change-orders/${co2.id}/link`, {})
  const coPage = await fetch(`${API}/p/co/${link.json.data.token}`).then(r => r.text())
  check('the customer\'s copy: "Not signed by you yet", with the Sign button', /data-co-not-signed/.test(coPage) && /id="go"/.test(coPage) && /Contract rev 3/.test(coPage))
  check('the customer\'s link shows "Why:" with the reason typed', /data-co-why><b>Why:<\/b> End posts without caps, as the customer asked</.test(coPage))
  check('no signed PDF until the customer signs', sql(`SELECT count(*) FROM "SignedDocument" WHERE "changeOrderId" = '${co2.id}'`) === '0')

  await open(`${APP}/pipeline`)
  const face = page.locator(`[data-kanban-card="${cardId}"]`)
  const faceText = await until(async () => (await face.count()) > 0 ? await face.innerText() : null, 30000)
  check('pipeline board: the card\'s value is the contract with the change orders, its rep the quote\'s', !!faceText && cents(faceText) === signedCents + total - 7500 && /E2E/.test(await face.locator('[data-card-rep]').innerText()), String(faceText).replace(/\s+/g, ' ').slice(0, 120))

  // ── 3. After the deposit and Final are paid ──
  const payId = `e2eco${stamp}${NAME}`
  const paid = await call('POST', '/api/payments', { id: payId, jobId, amountCents: s2.contractCents, method: 'check', checkNumber: '5150' })
  check('deposit and Final paid', paid.status === 201)
  await open(`${APP}/customers/${contactId}?tab=jobs`)
  await page.waitForSelector('[data-customer-change-orders]', { timeout: 30000 })
  await tap(page.locator(`[data-customer-change-orders] [data-co-button="${quoteId}"]`))
  await tap(page.locator('[data-co-from-lines]'))
  await page.waitForSelector('[data-co-modal]', { timeout: 10000 })
  await page.locator('[data-co-line-description]').first().fill('Add a 4 ft section by the shed')
  await page.locator('[data-co-line-amount]').first().fill('200')
  await page.locator('[data-co-reason]').fill('Customer wants the shed side closed')
  await tap(page.locator('[data-co-save-approved]'))
  await page.locator('[data-co-verbal-reason]').fill('Agreed on site')
  await page.locator('[data-co-verbal-reason]').blur()
  await tap(page.locator('[data-co-save-verbal]'))
  const co3 = await until(async () => ((await call('GET', `/api/change-orders?quoteId=${quoteId}`)).json.data ?? []).find(x => x.number === 3 && x.status === 'approved'), 15000)
  if (!co3) { await shot(page, 'co3-failed'); console.log('      CO-3 debug:', JSON.stringify({ cos: ((await call('GET', `/api/change-orders?quoteId=${quoteId}`)).json.data ?? []).map(x => [x.number, x.status, x.totalCents]), verbal: await page.locator('[data-co-verbal-reason]').inputValue().catch(() => 'none'), verbalBtnDisabled: await page.locator('[data-co-save-verbal]').isDisabled().catch(() => 'none'), toast: (await page.locator('[role=alert],[role=status],[data-toast]').allInnerTexts().catch(() => [])).join(' | ').slice(0, 300), modal: (await page.locator('[data-co-modal]').innerText().catch(() => 'no modal')).replace(/\s+/g, ' ').slice(0, 600) })) }
  const s3 = (await call('GET', `/api/payments/job/${jobId}`)).json.data.schedule
  const inv3 = s3.invoices.find(i => i.kind === 'change_order')
  check('customer page: CO-3 (+$200) approved verbally after everything was paid', !!co3 && co3.totalCents === 20000)
  check('its own invoice "Change order CO-3" for $200; the paid Final is unchanged', inv3?.label === 'Change order CO-3' && inv3.amountCents === 20000 && inv3.originalCents === 20000 && s3.invoices.find(i => i.kind === 'final').amountCents === s2.invoices.find(i => i.kind === 'final').amountCents, JSON.stringify(inv3))
  check('the balance is that $200', s3.balanceCents === 20000)
  await open(`${APP}/operations?job=${jobId}`)
  const invShown = await until(async () => /Change order CO-3/.test(await page.locator(`[data-payment-schedule="${jobId}"]`).innerText()), 30000)
  check('job page Payments: the "Change order CO-3" invoice is listed', !!invShown)
  const credit = await call('POST', '/api/change-orders', { jobId, reason: 'The run by the shed came out shorter', lines: [{ id: 'c9', description: 'Credit: shorter run by the shed', amountCents: -50000 }], status: 'approved', verbalReason: 'Agreed on site' })
  const s4 = (await call('GET', `/api/payments/job/${jobId}`)).json.data.schedule
  check('a credit after it is paid: the open CO-3 invoice comes off first, the rest is a credit due back; the paid Final not cut',
    credit.status === 201 && s4.invoices.find(i => i.kind === 'final').amountCents === s2.invoices.find(i => i.kind === 'final').amountCents && s4.invoices.find(i => i.kind === 'change_order').amountCents === 0 && s4.balanceCents === -30000 && s4.creditCents === 30000,
    `${s4.balanceCents} ${s4.creditCents}`)

  // ── 4. Picked from the price list on the phone: a Repair price list item (2 of them) and a catalog item as a credit ──
  const list = (await call('GET', `/api/change-orders/pick-list?quoteId=${quoteId}`)).json.data
  const rp = list.items.find(i => i.source === 'repair:replacePost')
  const part = list.items.filter(i => i.group === 'catalog' && i.unitCents > 0 && /^[A-Za-z0-9 ,'"-]+$/.test(i.label)).sort((a, b) => b.label.length - a.label.length)[0]
  const rp2 = (await call('GET', `/api/change-orders/pick-price?quoteId=${quoteId}&source=repair:replacePost&qty=2`)).json.data
  check('pick list (API): the Repair price list priced for the job\'s style, and the catalog', list.fenceStyle === template.fenceStyle && rp?.unitCents > 0 && !!part && rp2?.priceCents > 0, `${list.items.length} items, ${rp?.unitCents} ${part?.label} ${rp2?.priceCents}`)
  await open(`${APP}/operations?job=${jobId}`)
  await page.waitForSelector('[data-co-panel]', { timeout: 40000 }); await sleep(800)
  await tap(page.locator(`[data-co-button="${quoteId}"]`).first())
  await tap(page.locator('[data-co-from-lines]'))
  await page.waitForSelector('[data-co-modal]', { timeout: 10000 })
  await tap(page.locator('[data-co-pick-open]'))
  await page.waitForSelector('[data-co-pick-item="repair:replacePost"]', { timeout: 20000 })
  check('phone: the pick list opens over the change order and fits the screen', (await page.locator('[data-co-pick-sheet]').isVisible()) && await fits())
  check('the Repair price list shows the price for one', cents(await page.locator('[data-co-pick-item="repair:replacePost"] [data-co-pick-price]').innerText()) === rp.unitCents)
  await shot(page, '7-pick-repair')
  await page.locator('[data-co-pick-search]').fill('replace post')
  await tap(page.locator('[data-co-pick-item="repair:replacePost"]'))
  const rpLine = page.locator('[data-co-line]').filter({ has: page.locator('[data-co-line-source="repair:replacePost"]') })
  await rpLine.waitFor({ timeout: 10000 })
  check('picked: a line with its words and price (the empty line replaced)', (await page.locator('[data-co-line]').count()) === 1 && (await rpLine.locator('[data-co-line-description]').inputValue()) === 'Replace a post' && Math.round(parseFloat(await rpLine.locator('[data-co-line-amount]').inputValue()) * 100) === rp.unitCents)
  await rpLine.locator('[data-co-line-qty]').fill('2')
  const repriced = await until(async () => Math.round(parseFloat(await rpLine.locator('[data-co-line-amount]').inputValue()) * 100) === rp2.priceCents && (await rpLine.locator('[data-co-line-description]').inputValue()) === '2 × Replace a post', 15000)
  check('quantity 2: priced again as the repair quote prices 2', !!repriced, await rpLine.locator('[data-co-line-amount]').inputValue())
  await tap(page.locator('[data-co-pick-open]'))
  await tap(page.locator('[data-co-pick-group="catalog"]'))
  await page.locator('[data-co-pick-search]').fill(part.label)
  await page.waitForSelector(`[data-co-pick-item="${part.source}"]`, { timeout: 10000 })
  await shot(page, '8-pick-catalog')
  await tap(page.locator(`[data-co-pick-item="${part.source}"]`))
  const partLine = page.locator('[data-co-line]').filter({ has: page.locator(`[data-co-line-source="${part.source}"]`) })
  await partLine.waitFor({ timeout: 10000 })
  await partLine.locator('[data-co-line-kind]').selectOption('credit')
  await page.locator('[data-co-add-line]').scrollIntoViewIfNeeded()
  await tap(page.locator('[data-co-add-line]'))
  await page.locator('[data-co-line-description]').last().fill('Custom: move the gate stop')
  await page.locator('[data-co-line-amount]').last().fill('40')
  await page.locator('[data-co-reason]').fill('Two posts replaced; the part was not needed')
  const pickTotal = rp2.priceCents - part.unitCents + 4000
  check('the total: 2 posts, the part credited, the custom line', cents(await page.locator('[data-co-total]').innerText()) === pickTotal, await page.locator('[data-co-total]').innerText())
  check('phone: the change order with picked lines fits the screen', await fits())
  await shot(page, '9-picked-lines')
  await tap(page.locator('[data-co-save-draft]'))
  const co5 = await until(async () => ((await call('GET', `/api/change-orders?quoteId=${quoteId}`)).json.data ?? []).find(x => x.number === 5), 15000)
  const l5 = co5?.lines ?? []
  check('saved: each picked line keeps its quantity and source (history); the custom line stays plain',
    co5?.totalCents === pickTotal && l5[0]?.qty === 2 && l5[0]?.source?.ref === 'repair:replacePost' && l5[0]?.source?.fenceStyle === template.fenceStyle && l5[0]?.amountCents === rp2.priceCents
      && l5[1]?.source?.ref === part.source && l5[1]?.source?.kind === 'catalog' && l5[1]?.amountCents === -part.unitCents && l5[2]?.description === 'Custom: move the gate stop' && !l5[2]?.source,
    JSON.stringify(l5.map(l => [l.description, l.qty, l.amountCents, l.source?.ref])))
  check('no page errors', errors.length === 0, errors.join(' | '))
} catch (e) {
  check('ran to the end', false, String(e?.stack || e).slice(0, 400))
  if (page) await shot(page, 'error')
} finally {
  if (CDP) { await page?.close().catch(() => {}) } else await browser.close().catch(() => {})
  if (CDP) await browser.close().catch(() => {})
  for (const ids of [{ contactId, quoteId, jobId, cardId, label: '' }, { ...B, label: ' (B)' }]) await cleanUp(ids)
  const failed = results.filter(r => !r).length
  console.log(`\n${results.length - failed} passed, ${failed} failed (${NAME})`)
  process.exit(failed ? 1 : 0)
}

async function cleanUp({ contactId, quoteId, jobId, cardId, label }) {
  try {
    if (![contactId, quoteId, jobId, cardId].every(uuid)) throw new Error('bad id')
    const jl = `'${jobId}'`
    const fileIds = `SELECT "portalFileId" FROM "SignedDocument" WHERE "quoteId" = '${quoteId}' UNION SELECT "portalFileId" FROM "Receipt" WHERE "jobId" = ${jl}`
    for (const k of sql(`SELECT "fileKey" FROM "PortalFile" WHERE id IN (${fileIds}) UNION SELECT "fileKey" FROM "SignedDocument" WHERE "quoteId" = '${quoteId}'`).split('\n').filter(Boolean)) fs.rmSync(path.join(process.env.UPLOAD_DIR || path.join(PORTAL_DIR, 'uploads'), k), { force: true })
    sql(`DELETE FROM "PortalFile" WHERE id IN (${fileIds})`)
    sql(`DELETE FROM "SignedDocument" WHERE "quoteId" = '${quoteId}'`)
    const pays = `SELECT id FROM "ContractPayment" WHERE "jobId" = ${jl}`
    sql(`DELETE FROM "CrmAuditLog" WHERE "entityId" IN (${pays}) OR "entityId" IN (SELECT id FROM "Receipt" WHERE "jobId" = ${jl}) OR "entityId" IN (SELECT id FROM "ChangeOrder" WHERE "quoteId" = '${quoteId}') OR "entityId" IN (${jl}, '${quoteId}', '${contactId}')`)
    sql(`DELETE FROM "Receipt" WHERE "jobId" = ${jl}`)
    sql(`DELETE FROM "PaymentApplication" WHERE "paymentId" IN (${pays})`)
    sql(`DELETE FROM "ContractPayment" WHERE "jobId" = ${jl}`)
    sql(`DELETE FROM "InstallPacket" WHERE "jobId" = ${jl}`)
    sql(`DELETE FROM "ChangeOrder" WHERE "quoteId" = '${quoteId}'`)
    sql(`DELETE FROM "JobQuotedCost" WHERE "quoteId" = '${quoteId}'`)
    sql(`DELETE FROM "AutomationEvent" WHERE "entityId" IN (${jl}, '${quoteId}', '${cardId}', '${contactId}')`)
    sql(`DELETE FROM "JobChecklistItem" WHERE "jobId" = ${jl}`)
    sql(`DELETE FROM "SavedJob" WHERE id = ${jl}`)
    sql(`DELETE FROM "SavedQuote" WHERE id = '${quoteId}'`)
    const pl = (await call('GET', '/api/pipeline')).json
    const mine = (pl?.data?.leads ?? []).filter(l => l.customerId === contactId || l.id === cardId).map(l => l.id)
    if (mine.length) await call('PATCH', '/api/pipeline', { upsert: [], remove: mine, baseVersion: pl.data.version })
    await call('DELETE', `/api/crm-contacts/${contactId}`)
    sql(`DELETE FROM "CrmContact" WHERE id = '${contactId}'`)
    sql(`DELETE FROM "Notification" WHERE "jobId" = ${jl}`)
    check(`cleaned up${label} (change orders, payments, receipts, files, packet, job, quote, customer, card)`, sql(`SELECT count(*) FROM "ChangeOrder" WHERE "quoteId" = '${quoteId}'`) === '0' && sql(`SELECT count(*) FROM "SavedJob" WHERE id = ${jl}`) === '0' && sql(`SELECT count(*) FROM "CrmContact" WHERE id = '${contactId}'`) === '0')
  } catch (e) { check(`cleaned up${label}`, false, String(e?.message || e).slice(0, 200)) }
}
