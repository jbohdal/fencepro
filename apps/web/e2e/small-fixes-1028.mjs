// Small broken items found by reviewers (Oct 28 2026, FEATURES 9au), used as the right person on the right screen.
//
//   APP_URL=http://localhost:4094 API_URL=http://localhost:4094 \
//   OFFICE_COOKIE=<office cookie> SALES_COOKIE=<Salesman cookie> OWNER_COOKIE=<owner cookie> E2E_STAFF_COOKIE=x \
//   SHOTS=<folder> [ONLY=1,3,...] node e2e/small-fixes-1028.mjs
//   (cookies: cd apps/portal && npx tsx scripts/dev-session-token.ts --cookie --email <login> --out <file>)
//
// Salesman on a phone (390 x 844, WebKit):
//   1. a best price quote whose runs all take 8 ft panels: one tier card says "Main option", highlighted;
//   7. Chain link, Green, then 5 ft: the picker says Green is not offered at 5 ft and the finish changed;
//   8. a green chain link quote with a gate: the old price heading names the Settings months plainly.
// Owner on a computer: 2. invites an Installer; the email held in the dev outbox says "as Installer".
// Office on a computer (1440 x 900, Chromium):
//   3. Quotes page: a quote opened with Edit and saved opens its window; New quote saved opens its window;
//   4. a job in Permit Pending, locate clear: permit Approved moves it by itself; Job history shows it at once;
//   5. a job with no permit record: the Permit box says Not set, Save off until Needed is picked;
//   6. Inventory > Item Catalog: View only, unit costs as text (no number boxes);
//   9. the street box: "2200 SE Fort King St" suggests the SE street, never W.
// Makes one test customer (SMALLFIX …), its quotes, a job and an invited login; removes them at the end (OWNER_COOKIE).

import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import { chromium, webkit } from 'playwright'
import fs from 'fs'
import { signInByCookie } from './lib.mjs'
import path from 'path'
import { fileURLToPath } from 'url'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || APP
const OFFICE = process.env.OFFICE_COOKIE || ''
const SALES = process.env.SALES_COOKIE || ''
const OWNER = process.env.OWNER_COOKIE || ''
const SHOTS = process.env.SHOTS || ''
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean)
if (!OFFICE || !SALES) { console.error('Set OFFICE_COOKIE and SALES_COOKIE.'); process.exit(2) }
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })
const want = k => !ONLY.length || ONLY.includes(k)

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }) }
const tag = `SMALLFIX ${Date.now().toString(36)}`
const H = { 'X-Staff-Request': '1', 'Content-Type': 'application/json' }
const made = { contacts: [], quotes: [], jobs: [], logins: [] }
// The dev outbox (lib/outboundGate.ts): where this copy puts every email it would have sent.
const OUTBOX = process.env.DEV_OUTBOX || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../portal/logs/dev-outbox.log')

async function apiOf(ctx) {
  return async (method, path, data) => {
    const r = await ctx.request.fetch(`${API}${path}`, { method, headers: H, ...(data === undefined ? {} : { data }) })
    const j = await r.json().catch(() => null)
    if (!r.ok()) throw new Error(`${method} ${path}: ${r.status()} ${JSON.stringify(j).slice(0, 300)}`)
    return j?.data ?? j
  }
}

const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
const quoteBody = (extra = {}) => ({
  customerName: `${tag} Customer`, fenceStyle: 'WV-Auto ND Privacy', runs: [48, 96], corners: 1, ends: 2, sections: 0,
  status: 'DRAFT', finalPrice: 0, date: today, ...extra,
})

const browserOffice = await chromium.launch()
const browserPhone = await webkit.launch()
const office = await browserOffice.newContext({ viewport: { width: 1440, height: 900 } })
const phone = await browserPhone.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
try {
  await signInByCookie(office, { cookie: OFFICE, api: API })
  await signInByCookie(phone, { cookie: SALES, api: API })
  const officeApi = await apiOf(office)
  const salesApi = await apiOf(phone)
  const contact = await officeApi('POST', '/api/crm-contacts', { firstName: tag.split(' ')[0], lastName: tag.split(' ')[1], phone: '3525550142', serviceAddress: '2200 SE Fort King St, Ocala, FL 34471', status: 'customer' })
  made.contacts.push(contact.id)
  const customer = { customerId: contact.id, customerName: `${contact.firstName} ${contact.lastName}`, customerPhone: '3525550142', customerAddress: '2200 SE Fort King St, Ocala, FL 34471' }

  // ── 1 and 7: the Salesman on her phone ──────────────────────────────────────
  if (want('1') || want('7') || want('8')) {
    const q = await salesApi('POST', '/api/saved-quotes', quoteBody({ ...customer, salesRep: 'aud-sales' }))
    made.quotes.push(q.id)
    const page = await phone.newPage()
    const errors = []; page.on('pageerror', e => errors.push(String(e).slice(0, 200))); page.on('dialog', d => d.accept().catch(() => {}))
    await page.goto(`${APP}/quotes?quote=${q.id}`)
    const b = page.locator('[data-quote-builder]')
    await b.waitFor({ timeout: 60000 }); await sleep(2500)
    if (want('1')) {
      await b.locator('[data-step="price"]').click(); await sleep(1500)
      const cards = b.locator('[data-tier]')
      await cards.first().waitFor({ timeout: 20000 })
      const mains = await b.locator('[data-tier-main]').allInnerTexts()
      const n = mains.filter(t => t.trim() === 'Main option').length
      const mainCard = b.locator('[data-tier]:has([data-tier-main]:text-is("Main option"))').first()
      const highlighted = n ? /border-orange-500/.test(await mainCard.getAttribute('class') || '') : false
      const name = n ? await mainCard.locator('[data-tier-name]').innerText() : ''
      const style = n ? await mainCard.locator('[data-tier-style]').innerText() : ''
      check('1. uniform yard (48 and 96 ft, 8 ft panels): exactly one card says Main option, highlighted', n === 1 && highlighted, `${mains.join(' | ')} -> ${name}: ${style}`)
      await mainCard.scrollIntoViewIfNeeded().catch(() => {})
      await shot(page, '1-salesman-phone-uniform-yard-main-option')
    }
    if (want('7')) {
      await b.locator('[data-step="style"]').click(); await sleep(800)
      await b.locator('[data-choice-material="chain"]').click(); await sleep(500)
      const green = b.locator('[data-choice-dim="finish"][data-choice-key="green"]')
      const four = b.locator('[data-choice-dim="height"][data-choice-key="4"]')
      if (await four.count()) { await four.click(); await sleep(300) }
      if (!(await green.count())) check('7. Green chain link is in the picker', false, (await b.locator('[data-choice-dim="finish"]').allInnerTexts()).join(','))
      else {
        await green.click(); await sleep(400)
        const before = await b.locator('[data-style-plain-name]').innerText()
        await b.locator('[data-choice-dim="height"][data-choice-key="5"]').click(); await sleep(600)
        const note = b.locator('[data-style-changed-note]')
        const text = (await note.count()) ? await note.innerText() : ''
        const after = await b.locator('[data-style-plain-name]').innerText()
        check('7. Green, then 5 ft: the note says green is not offered at 5 ft and the finish changed', /Green is not offered at 5 ft, so the finish changed to Galvanized/.test(text), `${before} -> ${after}; note: ${text}`)
        await note.scrollIntoViewIfNeeded().catch(() => {})
        await shot(page, '7-salesman-phone-green-5ft-note')
        await b.locator('[data-choice-dim="height"][data-choice-key="4"]').click(); await sleep(400)
        check('7. the next tap clears the note', (await note.count()) === 0)
      }
    }
    if (want('8')) {
      // 8. The old price warning names the months set in Settings (Material prices), in plain words. A green chain link
      // quote with a walk gate: the green gate's price was last confirmed in 2023 on the dev copy.
      const months = (await salesApi('GET', '/api/business-state'))?.config?.pricing?.priceStaleMonths ?? 6
      const g = await salesApi('POST', '/api/saved-quotes', quoteBody({ ...customer, fenceStyle: 'chain/4/green/res/nd', runs: [60, 80], walkGates: 1 }))
      made.quotes.push(g.id)
      await page.goto(`${APP}/quotes?quote=${g.id}`)
      const b8 = page.locator('[data-quote-builder]')
      await b8.waitFor({ timeout: 60000 }); await sleep(2500)
      await b8.locator('[data-step="price"]').click(); await sleep(1500)
      const warn = b8.locator('[data-stale-prices]')
      const head = (await warn.count()) ? await warn.locator('p').first().innerText() : ''
      check(`8. the old price heading names Settings' ${months} months plainly`, new RegExp(`^\\d+ parts? on this quote (has a price|have prices) not confirmed in the last ${months} months?$`).test(head.trim()), head)
      if (await warn.count()) { await warn.scrollIntoViewIfNeeded(); await shot(page, '8-salesman-phone-old-price-heading') }
    }
    check('1/7. no page errors on the phone', errors.length === 0, errors.join(' | '))
    await page.close()
  }

  // ── 3: the office saves from the Quotes page ────────────────────────────────
  if (want('3')) {
    const q = await officeApi('POST', '/api/saved-quotes', quoteBody({ ...customer }))
    made.quotes.push(q.id)
    const page = await office.newPage()
    const errors = []; page.on('pageerror', e => errors.push(String(e).slice(0, 200))); page.on('dialog', d => d.accept().catch(() => {}))
    await page.goto(`${APP}/quotes`)
    await page.waitForSelector('[data-global-appointment]', { timeout: 60000 }); await sleep(1500)
    await page.getByPlaceholder('Search by customer, style, phone, address...').first().fill(tag)
    await sleep(600)
    await page.locator(`tr:has-text("${tag}")`).first().click()
    await page.locator('[data-quote-actions] button:text-is("Edit")').click()
    const b = page.locator('[data-quote-builder]')
    await b.waitFor({ timeout: 30000 }); await sleep(1500)
    await b.locator('[data-save-open]').last().click()
    await page.locator('[data-save-submit]').waitFor({ timeout: 10000 })
    // A quote made through the API for this customer: picked from the search the modal opens with.
    if (await page.locator('[data-save-submit]').isDisabled()) await page.locator(`[data-customer-option="${contact.id}"]`).click()
    await page.locator('[data-save-submit]').click()
    await sleep(2500)
    const url1 = page.url()
    const drawer = await page.locator('button:has-text("Text it")').count()
    check('3. Edit, Update: the quote window opens again (?qv=)', /[?&]qv=/.test(url1) && drawer > 0 && (await b.count()) === 0, url1)
    await shot(page, '3-office-quotes-page-window-after-update')
    // New quote from the Quotes page, saved for the test customer.
    await page.keyboard.press('Escape'); await sleep(600)
    await page.goto(`${APP}/quotes`); await sleep(1500)
    await page.locator('button:has-text("New quote"):visible, button:has-text("New Quote"):visible').first().click()
    await b.waitFor({ timeout: 30000 }); await sleep(1200)
    await b.locator('[data-step="style"]').click(); await sleep(400)
    await b.locator('[data-style-list]').selectOption('auto-wv-nd')
    await sleep(500)
    await b.locator('[data-step="yard"]').click(); await sleep(400)
    await b.locator('[data-shape="straight"]').click(); await sleep(300)
    await b.locator('[data-side-open="true"] [data-side-length]').click()
    for (const k of ['1', '0', '0']) await page.locator(`[data-ftin-pad] [data-pad-key="${k}"]`).click()
    await page.locator('[data-ftin-pad] [data-pad-done]').click(); await sleep(500)
    await b.locator('[data-step="price"]').click(); await sleep(1200)
    await shot(page, '3-office-new-quote-price-step')
    await b.locator('[data-save-open]:visible').first().click()
    const modal = page.locator('[data-save-submit]')
    await modal.waitFor({ timeout: 10000 })
    await page.locator('[data-customer-search]').fill(tag.split(' ')[1]); await sleep(1200)
    await page.locator(`[data-customer-option="${contact.id}"]`).click()
    await sleep(400)
    await modal.click(); await sleep(2500)
    const url2 = page.url()
    const newId = new URL(url2).searchParams.get('qv')
    if (newId) made.quotes.push(newId)
    check('3. New quote, Save quote: its window opens (?qv=)', !!newId && (await page.locator('button:has-text("Text it")').count()) > 0 && (await b.count()) === 0, url2)
    await shot(page, '3-office-quotes-page-window-after-new-quote')
    errors.length && check('3. no page errors', false, errors.join(' | '))
    await page.close()
  }

  // ── 4 and 5: a job window ───────────────────────────────────────────────────
  if (want('4') || want('5')) {
    const job = await officeApi('POST', '/api/saved-jobs', { id: `job-smallfix-${Date.now().toString(36)}`, customerName: customer.customerName, customerAddress: customer.customerAddress, customerPhone: customer.customerPhone, fenceStyle: "WV-ND 6'x8' Privacy", sections: 18, totalFeet: 144, contractValue: 5000, status: 'staging', crmContactId: contact.id, locatesDate: '2026-10-20' })
    made.jobs.push(job.id)
    const page = await office.newPage()
    const errors = []; page.on('pageerror', e => errors.push(String(e).slice(0, 200))); page.on('dialog', d => d.accept().catch(() => {}))
    await page.goto(`${APP}/operations?job=${job.id}`)
    await page.waitForSelector('[data-global-appointment]', { timeout: 60000 })
    const panel = page.locator(`[data-permit-panel="${job.id}"]`)
    await panel.waitFor({ timeout: 30000 }); await sleep(800)
    if (want('5')) {
      const status = await panel.locator('[data-permit-status]').inputValue()
      const shown = await panel.locator('[data-permit-status] option:checked').innerText()
      const saveOff = await panel.locator('[data-permit-save]').isDisabled()
      check('5. no permit record: the box says Not set, Save off', status === '' && shown === 'Not set' && saveOff, `${shown} save ${saveOff ? 'off' : 'on'}`)
      await panel.scrollIntoViewIfNeeded(); await shot(page, '5-office-permit-not-set')
      await panel.locator('[data-permit-status]').selectOption('needed')
      check('5. Needed picked: Save on', await panel.locator('[data-permit-save]').isEnabled())
      await panel.locator('[data-permit-save]').click(); await sleep(1500)
      const saved = await officeApi('GET', `/api/automations/permits/${job.id}`)
      check('5. saved as Needed by the office', saved.permit?.status === 'needed' && /aud-office/.test(saved.permit?.updatedBy || ''), JSON.stringify({ s: saved.permit?.status, by: saved.permit?.updatedBy }))
      check('5. after the save: Not set is gone from the list, Save off again', (await panel.locator('[data-permit-status] option[value=""]').count()) === 0 && await panel.locator('[data-permit-save]').isDisabled())
      await shot(page, '5-office-permit-needed-saved')
    }
    if (want('4')) {
      // The office's day: the job waits in Permit Pending with its 811 locate clear; the permit comes back Approved.
      // Saving it moves the job on by itself (9ar), and the open window's Job history shows that line at once.
      await page.locator('[data-ops-stage-choice]:has-text("Permit Pending")').first().click(); await sleep(2500)
      const hist = page.locator('[data-job-timeline]')
      const before = await hist.innerText()
      await panel.locator('[data-permit-status]').selectOption('approved')
      await panel.locator('[data-permit-save]').click(); await sleep(5000)
      const after = await hist.innerText()
      const stageNow = await page.locator('[data-ops-stage-choice][style*="background-color"]').first().innerText().catch(() => '')
      check('4. permit Approved: the job moved by itself and Job history shows it without reopening the window', /Moved to .* by itself/.test(after) && !/Moved to .* by itself/.test(before), `stage now ${stageNow}; history: ${after.split('\n').slice(0, 4).join(' / ')}`)
      await hist.scrollIntoViewIfNeeded(); await shot(page, '4-office-job-history-after-permit-move')
    }
    check('4/5. no page errors', errors.length === 0, errors.join(' | '))
    await page.close()
  }

  // ── 6: Inventory, view only ─────────────────────────────────────────────────
  if (want('6')) {
    const page = await office.newPage()
    await page.goto(`${APP}/inventory?tab=catalog`)
    await page.waitForSelector('[data-global-appointment]', { timeout: 60000 }); await sleep(1500)
    const catalogTab = page.locator('button:has-text("Catalog")').first()
    if (await catalogTab.count()) { await catalogTab.click(); await sleep(1000) }
    const viewOnly = await page.locator('[data-view-only]').count()
    const boxes = await page.locator('[data-catalog-locked] input[type="number"]').count()
    const texts = await page.locator('[data-unit-cost-readonly]').count()
    check('6. office Inventory: View only, no cost boxes, costs as text', viewOnly > 0 && boxes === 0 && texts > 0, `viewOnly ${viewOnly}, boxes ${boxes}, costs as text ${texts}`)
    await shot(page, '6-office-inventory-view-only')
    await page.close()
  }

  // ── 9: the street box ───────────────────────────────────────────────────────
  if (want('9')) {
    const s = await officeApi('GET', `/api/appointments/geo/suggest?q=${encodeURIComponent('2200 SE Fort King St')}`)
    const lines = s.map(x => x.formatted)
    check('9. "2200 SE Fort King St": the SE street, never W', lines.some(l => /^2200 SE Fort King St, Ocala, FL 34471$/.test(l)) && !lines.some(l => /\bW Fort King/.test(l)), lines.join(' | '))
    const sp = await officeApi('GET', `/api/appointments/geo/suggest?q=${encodeURIComponent('17008 Southe')}`)
    check('9. "17008 Southe" (spelled out, part way): 17008 SE 60th St', sp.some(x => /^17008 SE 60th St/.test(x.formatted)), sp.map(x => x.formatted).join(' | '))
    const page = await office.newPage()
    await page.goto(`${APP}/pipeline`)
    await page.waitForSelector('[data-global-appointment]', { timeout: 60000 }); await sleep(1500)
    await page.locator('button:has-text("+ New lead"):visible, button[aria-label="New Lead"]:visible').first().click()
    await page.locator('[data-lead-field="street"]').fill('2200 SE Fort King St'); await sleep(2000)
    const shown = await page.locator('[data-address-suggestion]').allInnerTexts()
    check('9. the New Lead street box offers 2200 SE Fort King St', shown.some(t => /2200 SE Fort King St/.test(t)) && !shown.some(t => /W Fort King/.test(t)), shown.join(' | '))
    await shot(page, '9-office-address-se-fort-king')
    await page.close()
  }
  // ── 2: the owner invites an Installer (computer) ────────────────────────────
  if (want('2') && OWNER) {
    const ownerCtx = await browserOffice.newContext({ viewport: { width: 1440, height: 900 } })
    await signInByCookie(ownerCtx, { cookie: OWNER, api: API })
    const page = await ownerCtx.newPage()
    await page.goto(`${APP}/team`)
    await page.waitForSelector('[data-global-appointment]', { timeout: 60000 }); await sleep(1200)
    await page.locator('button:has-text("+ Invite Team Member")').click()
    const email = `smallfix-installer-${Date.now().toString(36)}@example.invalid`
    const form = page.locator('form')
    await form.locator('input[type="text"]').nth(0).fill('Smallfix')
    await form.locator('input[type="text"]').nth(1).fill('Installer')
    await form.locator('input[type="email"]').fill(email)
    await form.locator('input[type="radio"][value="field_crew"]').check()
    const sizeBefore = fs.existsSync(OUTBOX) ? fs.statSync(OUTBOX).size : 0
    await form.locator('button[type="submit"]').click(); await sleep(2500)
    await shot(page, '2-owner-team-invite-installer')
    const added = fs.existsSync(OUTBOX) ? fs.readFileSync(OUTBOX, 'utf8').slice(sizeBefore) : ''
    const line = added.split('\n').filter(l => l.includes(email)).pop() || ''
    check('2. the Installer invite (held in the dev outbox) says "as Installer", never "field crew"', /as Installer\b/.test(line) && !/field crew/i.test(line), line.slice(0, 300))
    const u = await (await ownerCtx.request.get(`${API}/api/crm-auth/users`, { headers: H })).json().catch(() => null)
    const id = (u?.data ?? []).find?.(x => x.email === email)?.id
    if (id) made.logins.push({ id, ctx: ownerCtx })
  }
} catch (e) {
  check('ran to the end', false, String(e?.stack || e).slice(0, 600))
} finally {
  // Clean up what this run made.
  try {
    const ownerCtx = await browserOffice.newContext()
    if (OWNER) await signInByCookie(ownerCtx, { cookie: OWNER, api: API })
    const api = await apiOf(OWNER ? ownerCtx : office)
    for (const id of made.jobs) await api('DELETE', `/api/saved-jobs/${id}`).catch(e => console.log('cleanup job', String(e).slice(0, 120)))
    for (const id of made.quotes) await api('DELETE', `/api/saved-quotes/${id}`).catch(e => console.log('cleanup quote', String(e).slice(0, 120)))
    for (const l of made.logins) await l.ctx.request.delete(`${API}/api/crm-auth/users/${l.id}`, { headers: H }).catch(() => {})
    for (const id of made.contacts) await api('DELETE', `/api/crm-contacts/${id}`).catch(e => console.log('cleanup contact', String(e).slice(0, 120)))
  } catch { /* the database cleanup below is the backstop */ }
  console.log(`CLEANUP-TAG ${tag}`)
  await browserOffice.close(); await browserPhone.close()
}
const failed = results.filter(r => !r).length
console.log(`\n${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
