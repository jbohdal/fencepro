// Back, on a phone and a computer, and the pipeline card's window.
//
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 \
//   E2E_ACCESS_TOKEN=<dev staff token> SHOTS=<folder, optional> node e2e/back-button.mjs
//
// Makes a customer with a pipeline card and a quote, then walks:
//   Pipeline > card > New quote > Back > Back
//   Customers > customer > quote > Back > Back
// and checks Back closes the window on top first, never drops unsaved quote
// work without asking, keeps a screen's filters and scroll, and that
// reloading on a customer, a quote, a card or a job opens that same page.
// Deletes what it made.

import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import { chromium } from 'playwright'

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
  const r = await fetch(API + p, { ...init, headers: { Authorization: `Bearer ${TOKEN}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers || {}) } })
  const j = await r.json().catch(() => ({}))
  return j.data ?? j
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }) }

const FIRST = 'E2E', LAST = `Back ${Date.now().toString(36).slice(-4)}`
const NAME = `${FIRST} ${LAST}`
let contactId = null, leadId = null, quoteId = null

async function session(browser, phone) {
  const ctx = await browser.newContext(phone
    ? { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
    : { viewport: { width: 1440, height: 950 } })
  await ctx.addInitScript(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, TOKEN)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 300)))
  return { ctx, page, errors }
}
const path = page => { const u = new URL(page.url()); return u.pathname + u.search }
async function open(page, url) {
  await page.goto(APP + url)
  await page.waitForSelector('[data-page-scroll]', { timeout: 30000 })
  await sleep(1200)
}
/** Back, the way Android's back button and an iPhone swipe do it. */
async function back(page) { await page.goBack({ waitUntil: 'commit' }).catch(() => {}); await sleep(700) }
const visible = async (page, sel) => (await page.locator(sel).count()) > 0 && await page.locator(sel).first().isVisible()

async function pipelineFlow(browser, phone) {
  const tag = phone ? 'phone' : 'computer'
  const { ctx, page, errors } = await session(browser, phone)
  await open(page, '/pipeline')
  check(`${tag}: the pipeline has its own address`, path(page) === '/pipeline')
  const card = page.locator(`[data-kanban-col] >> text=${NAME}`).first()
  await card.scrollIntoViewIfNeeded(); await card.click(); await sleep(900)
  check(`${tag}: tapping the card opens its window, with its own address`, await visible(page, '[data-card-window]') && path(page).includes(`card=${leadId}`), path(page))
  // What the window has, top to bottom.
  const order = await page.locator('[data-card-window]').evaluate(w => ['[data-card-new-quote]', '[data-card-call]', '[data-card-text]', '[data-card-navigate]', '[data-card-book-appt]', '[data-card-quotes]', '[data-card-next-appt]', '[data-card-notes]', '[data-card-stage]']
    .map(s => w.querySelector(s)?.getBoundingClientRect().top ?? -1))
  check(`${tag}: New quote on top, then Call, Text, Navigate, Book, quotes, next appointment, notes, stage`, order.every(t => t >= 0) && order[0] < order[1] && order[1] === order[2] && order[2] === order[3] && order[3] === order[4] && order[4] < order[5] && order[5] < order[6] && order[6] < order[7] && order[7] < order[8], order.map(Math.round).join(','))
  check(`${tag}: Call and Text use the customer's phone, Navigate the address`,
    (await page.locator('[data-card-call]').getAttribute('href')) === 'tel:3525550142'
    && (await page.locator('[data-card-text]').getAttribute('href')).startsWith('sms:3525550142')
    && (await page.locator('[data-card-navigate]').getAttribute('href')).includes('5708%20SW%2090th%20Ln'))
  const qRow = page.locator(`[data-card-quote="${quoteId}"]`)
  check(`${tag}: the customer's quote is listed with status, price and date`, (await qRow.count()) === 1 && /Draft/.test(await qRow.textContent()) && /\$9,876/.test(await qRow.textContent()))
  if (!phone) {
    await page.locator('[data-card-add-note]').click()
    await page.locator('[data-card-note-text]').fill('Wants the gate on the left')
    await page.locator('[data-card-note-save]').click(); await sleep(1200)
    check(`${tag}: Add note saves and shows the note`, (await page.locator('[data-card-note]').first().textContent()).includes('Wants the gate on the left'))
    const notes = await api(`/api/crm-contacts/${contactId}/notes`)
    check(`${tag}: the note is on the customer record on the server`, Array.isArray(notes) && notes.some(n => n.body === 'Wants the gate on the left'))
  }
  await shot(page, `${tag}-1-card-window`)

  // Pipeline > card > New quote > Back > Back
  await page.locator('[data-card-new-quote]').click(); await sleep(1200)
  check(`${tag}: New quote opens the builder filled in for this customer`, await visible(page, '[data-quote-builder]') && path(page).includes('quote=new') && path(page).includes(`for=${contactId}`), path(page))
  await back(page)
  check(`${tag}: Back closes the quote, the card window is still open`, !(await visible(page, '[data-quote-builder]')) && await visible(page, '[data-card-window]') && path(page).includes(`card=${leadId}`) && !path(page).includes('quote='), path(page))
  await back(page)
  check(`${tag}: Back again closes the card window and stays on the pipeline`, !(await visible(page, '[data-card-window]')) && path(page) === '/pipeline' && await visible(page, `[data-kanban-col] >> text=${NAME}`), path(page))

  // Unsaved quote work is never dropped without asking.
  await card.click(); await sleep(800)
  await page.locator('[data-card-new-quote]').click(); await sleep(1200)
  await page.locator('[data-quote-builder] [data-step="yard"]').click(); await sleep(300)
  await page.locator('[data-shape="backyard"]').click(); await sleep(500)
  let asked = ''
  page.once('dialog', d => { asked = d.message(); d.dismiss() })
  await back(page)
  check(`${tag}: Back with unsaved quote work asks "Leave without saving?"`, asked.startsWith('Leave without saving?'), asked.split('\n')[0])
  check(`${tag}: answering No keeps the quote open, work and address intact`, await visible(page, '[data-quote-builder]') && await visible(page, '[data-layout-editor]') && path(page).includes('quote=new'), path(page))
  page.once('dialog', d => d.accept())
  await back(page)
  check(`${tag}: answering Yes closes it, back to the card window`, !(await visible(page, '[data-quote-builder]')) && await visible(page, '[data-card-window]'))
  // The close button asks too.
  await page.locator('[data-card-new-quote]').click(); await sleep(1200)
  await page.locator('[data-quote-builder] [data-step="yard"]').click(); await sleep(300)
  await page.locator('[data-shape="straight"]').click(); await sleep(400)
  asked = ''
  page.once('dialog', d => { asked = d.message(); d.dismiss() })
  await page.locator('[data-quote-close]').click(); await sleep(400)
  check(`${tag}: the close button asks too`, asked.startsWith('Leave without saving?') && await visible(page, '[data-quote-builder]'))
  page.once('dialog', d => d.accept())
  await page.locator('[data-quote-close]').click(); await sleep(900)
  check(`${tag}: closing with the button takes its history entry with it`, path(page).includes(`card=${leadId}`) && !path(page).includes('quote='), path(page))

  // A popup on the window: Back closes just the popup.
  await page.locator('[data-card-book-appt]').click(); await sleep(1000)
  const bookingOpen = await page.locator('[role="dialog"]').count() > 1 || await visible(page, 'text=Book appointment')
  await back(page)
  check(`${tag}: Back closes the booking popup and leaves the card window open`, bookingOpen && await visible(page, '[data-card-window]') && (await page.locator('[role="dialog"]').count()) === 1)
  await back(page)
  check(`${tag}: and Back again closes the window`, !(await visible(page, '[data-card-window]')) && path(page) === '/pipeline')

  // Deep link: reload on a card.
  await open(page, `/pipeline?card=${encodeURIComponent(leadId)}`)
  check(`${tag}: reloading on a card opens its window`, await visible(page, '[data-card-window]'))
  await back(page)
  check(`${tag}: Back from the reloaded window goes to the pipeline, not out of the app`, path(page) === '/pipeline' && await visible(page, '[data-kanban-col]'))
  check(`${tag}: no page errors`, errors.length === 0, errors.join(' | '))
  await ctx.close()
}

async function customerFlow(browser, phone) {
  const tag = phone ? 'phone' : 'computer'
  const { ctx, page, errors } = await session(browser, phone)
  await open(page, '/')
  if (phone) await page.locator('[data-tabbar] >> text=Customers').click()
  else await page.locator('span:text-is("Customers"):visible').first().click()
  await sleep(1200)
  check(`${tag}: Customers has its own address`, path(page) === '/customers', path(page))
  await page.locator('input[placeholder="Search customers..."]').fill(LAST); await sleep(500)
  await page.locator(`text=${NAME}`).first().click(); await sleep(1000)
  check(`${tag}: a customer has its own address`, path(page) === `/customers/${contactId}`, path(page))
  await page.locator('[data-customer-tab="quotes"]').click(); await sleep(500)
  await page.locator(`text=${'$9,876'}`).first().click(); await sleep(1000)
  check(`${tag}: the quote opens with its own address`, path(page) === `/customers/${contactId}?qv=${quoteId}`, path(page))
  await shot(page, `${tag}-2-customer-quote`)
  await back(page)
  check(`${tag}: Back closes the quote, the customer stays on the Quotes tab`, path(page) === `/customers/${contactId}` && /bg-white/.test(await page.locator('[data-customer-tab="quotes"]').getAttribute('class')) && await visible(page, `text=${'$9,876'}`), path(page))
  await back(page)
  check(`${tag}: Back again returns to the list, search kept`, path(page) === '/customers' && (await page.locator('input[placeholder="Search customers..."]').inputValue()) === LAST, path(page))
  if (phone) {
    // The phone's menu is a window too.
    await page.locator('[data-tabbar] >> text=More').click(); await sleep(500)
    await back(page)
    check(`${tag}: Back closes the menu and stays on Customers`, path(page) === '/customers' && !(await page.locator('.mobile-nav-drawer.open').count()))
  }

  // Deep links: reloading on a customer, a quote, and a job.
  await open(page, `/customers/${contactId}`)
  check(`${tag}: reloading on a customer opens that customer`, await visible(page, `h2:has-text("${NAME}"), h1:has-text("${NAME}")`) || (await page.locator(`text=${NAME}`).count()) > 0)
  await open(page, `/customers/${contactId}?qv=${quoteId}`)
  check(`${tag}: reloading on a customer's quote opens it`, (await page.locator('text=Mark as Sold').count()) > 0)
  await back(page)
  check(`${tag}: Back from there closes the quote and stays on the customer`, path(page) === `/customers/${contactId}` && (await page.locator('text=Mark as Sold').count()) === 0, path(page))
  await open(page, `/quotes?quote=${quoteId}`)
  check(`${tag}: reloading on a quote being edited opens the builder on it`, await visible(page, '[data-quote-builder]') && (await page.locator('[data-quote-builder] h2').textContent()) === 'Edit quote')
  const jobs = await api('/api/saved-jobs')
  const job = Array.isArray(jobs) ? jobs.find(j => j.status === 'scheduled' || j.status === 'staging') ?? jobs[0] : null
  if (job) {
    await open(page, `/operations?job=${job.id}`)
    check(`${tag}: reloading on a job opens it`, (await page.locator('[data-install-packet]').count()) > 0 || (await page.locator('text=Operations Stage').count()) > 0)
  }
  check(`${tag}: no page errors`, errors.length === 0, errors.join(' | '))
  await ctx.close()
}

async function keptScreens(browser) {
  const { ctx, page, errors } = await session(browser, false)
  // Pipeline filter and a trip to the customer page from the card.
  await open(page, '/pipeline')
  const search = page.locator('input[placeholder*="Search"]:visible').first()
  await search.fill(LAST); await sleep(500)
  await page.locator(`[data-kanban-col] >> text=${NAME}`).first().click(); await sleep(800)
  await page.locator('[data-card-open-customer]').click(); await sleep(1200)
  check('computer: the card window opens the customer page', path(page) === `/customers/${contactId}` && (await page.locator('[data-back-to="Sales Pipeline"]').count()) === 1, path(page))
  await page.locator('[data-back-to="Sales Pipeline"]').click(); await sleep(1200)
  check('computer: "Back to pipeline" returns to the card window', path(page).startsWith('/pipeline?card=') && await visible(page, '[data-card-window]'), path(page))
  await back(page)
  check('computer: and then the board, with its search kept', path(page) === '/pipeline' && (await page.locator('input[placeholder*="Search"]:visible').first().inputValue()) === LAST)
  // Scroll position: a long list, another screen, Back.
  await open(page, '/quotes')
  await page.locator('[data-page-scroll]').evaluate(el => { el.scrollTop = 700 })
  await sleep(300)
  const before = await page.locator('[data-page-scroll]').evaluate(el => el.scrollTop)
  await page.locator('span:text-is("Dashboard"):visible').first().click(); await sleep(1000)
  check('computer: a new screen starts at the top', await page.locator('[data-page-scroll]').evaluate(el => el.scrollTop) === 0)
  await back(page); await sleep(600)
  const after = await page.locator('[data-page-scroll]').evaluate(el => el.scrollTop)
  check('computer: Back puts the scroll position back', before > 300 && Math.abs(after - before) < 5, `${before} -> ${after}`)
  check('computer: no page errors', errors.length === 0, errors.join(' | '))
  await ctx.close()
}

const browser = await chromium.launch()
try {
  const c = await api('/api/crm-contacts', { method: 'POST', body: JSON.stringify({ firstName: FIRST, lastName: LAST, phone: '3525550142', serviceAddress: '5708 SW 90th Ln, Ocala, FL 34476', leadSource: 'Referral' }) })
  contactId = c.id
  const pipe = await api('/api/pipeline')
  leadId = `e2e-back-${Date.now()}`
  const today = new Date().toISOString().slice(0, 10)
  const lead = { id: leadId, customerId: contactId, firstName: FIRST, lastName: LAST, phone: '3525550142', email: '', address: '5708 SW 90th Ln, Ocala, FL 34476', leadSource: 'Referral', leadTemp: 0, fenceType: '', sections: 0, quotePrice: 0, crew: '', scheduledDate: '', jobValue: 0, paymentStatus: '', balanceDue: 0, notes: '', stage: 'First Contact', createdAt: new Date().toISOString(), lastMoved: today }
  const r = await fetch(`${API}/api/pipeline`, { method: 'PATCH', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ upsert: [{ lead }], remove: [], baseVersion: pipe.version }) })
  const q = await api('/api/saved-quotes', { method: 'POST', body: JSON.stringify({ crmContactId: contactId, customerName: NAME, customerPhone: '3525550142', customerAddress: '5708 SW 90th Ln, Ocala, FL 34476', fenceStyle: "WV-ND 6'x8' Privacy", runs: [100], corners: 0, ends: 2, sections: 13, status: 'DRAFT', finalPrice: 9876, date: today }) })
  quoteId = q.id
  check('setup: a customer with a pipeline card and a quote', !!contactId && r.ok && !!quoteId)

  await pipelineFlow(browser, true)
  await pipelineFlow(browser, false)
  await customerFlow(browser, true)
  await customerFlow(browser, false)
  await keptScreens(browser)
} catch (e) {
  check('test run finished', false, String(e?.stack || e).split('\n').slice(0, 4).join(' '))
} finally {
  if (quoteId) await api(`/api/saved-quotes/${quoteId}`, { method: 'DELETE' })
  if (leadId) {
    const pipe = await api('/api/pipeline')
    await fetch(`${API}/api/pipeline`, { method: 'PATCH', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ upsert: [], remove: [leadId], baseVersion: pipe.version }) })
  }
  if (contactId) await api(`/api/crm-contacts/${contactId}`, { method: 'DELETE' })
  await browser.close()
}
const passed = results.filter(Boolean).length
console.log(`\n${passed} of ${results.length} checks passed`)
process.exit(passed === results.length ? 0 : 1)
