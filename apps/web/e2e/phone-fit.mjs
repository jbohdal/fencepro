// Every main screen fits a small phone: nothing cut off, every button reachable.
//
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 E2E_ACCESS_TOKEN=<dev owner token> node e2e/phone-fit.mjs
//
//   BROWSER=webkit|chromium   one engine (both by default)
//   WIDTH=360 HEIGHT=780      the phone size (360 x 780 by default)
//   SCREENS=customer,pipeline only these screens (all by default)
//   SHOTS=<folder> TAG=after  saves dev-phone-<TAG>-<screen>-<WIDTH>.png (WebKit and Android only)
//   On the Android emulator's Chrome: adb reverse tcp:4001 tcp:4001; adb forward tcp:9333
//   localabstract:chrome_devtools_remote; CDP_URL=http://localhost:9333 (WIDTH is applied with
//   Emulation.setDeviceMetricsOverride; WIDTH=native keeps the emulator's own 412).
//
// At 360 x 780 with touch, signed in as the owner, it opens: Today, the Sales
// Pipeline, a card window, a customer, each quote step (Customer, Yard, Style,
// Price, with the bar at the bottom), Follow ups, every Inventory tab, every
// Settings tab, Schedule and a job. Then the customer again as a salesman.
// On each it fails on:
//   - the page scrolling sideways (document.scrollingElement.scrollWidth > innerWidth)
//   - a visible button or link partly off the screen sideways (a box that
//     scrolls sideways on its own, like a wide table or the board, is fine as
//     long as the box itself is on screen)
//   - a button or link cut off by a box that cannot scroll to it
//   - a button or link covered at its middle by something else, after being
//     scrolled into view (a window that is open counts only its own buttons)
//   - words cut off on a button in an action bar
// The customer screen's six main actions (New quote, Call, Text, Navigate,
// Book appointment, Edit) must be on screen without scrolling, and still be on
// screen after scrolling to the bottom. Tapping Call starts "How'd it go?" (the
// pending call reaches the server), which is cleared afterwards.
//
// Dev copy only (port 4001). Makes one test customer with a pipeline card and
// one salesman login, and removes them at the end.
import { webkit, chromium } from 'playwright'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || 'http://localhost:4001'
const OWNER = process.env.E2E_ACCESS_TOKEN || ''
const SHOTS = process.env.SHOTS || ''
const TAG = process.env.TAG || 'after'
const CDP = process.env.CDP_URL || ''
const NATIVE = process.env.WIDTH === 'native'
const W = NATIVE ? 0 : Number(process.env.WIDTH || 360)
const H = Number(process.env.HEIGHT || (W === 390 ? 844 : W === 412 ? 915 : 780))
const ONLY = (process.env.SCREENS || '').split(',').map(s => s.trim()).filter(Boolean)
const local = u => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(u)
if (!local(APP) || !local(API) || /:4000(\/|$)/.test(APP) || /:4000(\/|$)/.test(API)) { console.error('Refusing to run: the dev copy only (localhost, not port 4000).'); process.exit(2) }
if (!OWNER) { console.error('Set E2E_ACCESS_TOKEN (an owner login on the dev server).'); process.exit(2) }
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const want = s => !ONLY.length || ONLY.includes(s)
// The dev server restarts itself when its code changes: wait for it rather than fail.
const call = async (token, method, p, body) => {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(`${API}${p}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
      return { status: r.status, json: await r.json().catch(() => ({})) }
    } catch (e) { if (i >= 30) return { status: 0, json: {} }; await sleep(2000) }
  }
}
const owner = (m, p, b) => call(OWNER, m, p, b)

// ── What is checked on a screen, run in the page ──
// scope: only the buttons inside this element (an open window); null = the whole page.
// bars: action bars whose button words must not be cut off.
function audit({ scope, bars, scroll }) {
  const vw = window.innerWidth, vh = window.innerHeight
  const root = scope ? document.querySelector(scope) : document.body
  const out = { hscroll: Math.max(0, document.scrollingElement.scrollWidth - vw), off: [], cut: [], covered: [], clipped: [], count: 0, missingScope: !root }
  if (!root) return out
  const label = el => {
    const t = (el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') || el.getAttribute('href') || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 40)
    const d = [...el.attributes].find(a => a.name.startsWith('data-'))
    return t + (d ? ` [${d.name}${d.value ? '=' + d.value.slice(0, 20) : ''}]` : '')
  }
  const shown = el => {
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) return false
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      const cs = getComputedStyle(e)
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false
      // A closed slide-in menu waits wholly off the screen: it is not on the page.
      if (cs.position === 'fixed') { const fr = e.getBoundingClientRect(); if (fr.right <= 0 || fr.left >= vw || fr.bottom <= 0 || fr.top >= vh) return false }
    }
    return !el.closest('[aria-hidden="true"], [inert], details:not([open]) > :not(summary)')
  }
  const scrolls = v => v === 'auto' || v === 'scroll'
  // Where the element can be seen: the screen, cut down by every box around it that clips.
  const where = el => {
    const r = el.getBoundingClientRect()
    const cx0 = r.left + r.width / 2, cy0 = r.top + r.height / 2
    // The point followed outwards: once a box can scroll the element into its
    // view, the element counts as being where that box shows it.
    let x = cx0, y = cy0
    let hBox = null, cutBy = null, outOfView = false
    for (let a = el.parentElement; a && a !== document.documentElement && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a)
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
        const ar = a.getBoundingClientRect()
        const outX = x < ar.left - 1 || x > ar.right + 1, outY = y < ar.top - 1 || y > ar.bottom + 1
        const sx = scrolls(cs.overflowX) && a.scrollWidth > a.clientWidth + 1, sy = scrolls(cs.overflowY) && a.scrollHeight > a.clientHeight + 1
        if (sx && !hBox) hBox = a
        if (outX) { if (sx) { outOfView = true; x = Math.min(Math.max(x, ar.left + 1), ar.right - 1) } else if (!cutBy) cutBy = a }
        if (outY) { if (sy) { outOfView = true; y = Math.min(Math.max(y, ar.top + 1), ar.bottom - 1) } else if (!cutBy) cutBy = a }
      }
      if (cs.position === 'fixed') break
    }
    return { r, cx: cx0, cy: cy0, hBox, cutBy, outOfView }
  }
  const hit = (el, x, y) => { const h = document.elementFromPoint(x, y); return !h || el === h || el.contains(h) || (h.closest('label') && h.closest('label').contains(el)) ? null : h }
  const els = [...root.querySelectorAll('button, a[href], [role="button"], summary')].filter(shown)
  out.count = els.length
  const desc = h => h ? `${h.tagName.toLowerCase()}${h.closest('[data-tabbar]') ? ' (tab bar)' : h.closest('[data-customer-actions]') ? ' (customer action bar)' : h.closest('[data-quote-bar]') ? ' (quote bar)' : ''} "${(h.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 30)}"` : ''
  for (const el of els) {
    let w = where(el)
    if (w.r.left < -1 || w.r.right > vw + 1) {
      if (!w.hBox) { out.off.push(`${label(el)} x ${Math.round(w.r.left)}..${Math.round(w.r.right)}`); continue }
      const br = w.hBox.getBoundingClientRect()
      if (br.left < -1 || br.right > vw + 1) { out.off.push(`${label(el)} (in a box ${Math.round(br.width)} wide)`); continue }
    }
    if (w.cutBy) { const b = w.cutBy.getBoundingClientRect(); out.cut.push(`${label(el)} at y ${Math.round(w.r.top)}, box ${Math.round(b.top)}..${Math.round(b.bottom)}`); continue }
    if (!scroll) continue
    // Covered: bring it into view the way a finger would, then look at its middle.
    let over = w.outOfView || w.cy < 0 || w.cy > vh ? 'x' : hit(el, w.cx, w.cy)
    if (over) {
      el.scrollIntoView({ block: 'center', inline: 'nearest' })
      w = where(el)
      if (w.cutBy) { out.cut.push(`${label(el)} (after scrolling)`); continue }
      over = w.cy < 0 || w.cy > vh || w.cx < 0 || w.cx > vw ? 'off' : hit(el, w.cx, w.cy)
      if (over) out.covered.push(`${label(el)} at ${Math.round(w.cx)},${Math.round(w.cy)} under ${over === 'off' ? 'the screen edge' : desc(over)}`)
    }
  }
  for (const sel of bars || []) {
    for (const bar of document.querySelectorAll(sel)) {
      if (!shown(bar)) continue
      for (const el of [bar, ...bar.querySelectorAll('*')]) {
        if (!shown(el) || !el.childNodes.length) continue
        const cs = getComputedStyle(el)
        if ((cs.overflow !== 'visible' || cs.textOverflow === 'ellipsis') && (el.scrollWidth > el.clientWidth + 1)) out.clipped.push(`${label(el)} (${sel})`)
      }
    }
  }
  return out
}

// The customer screen's six main actions: by their data name, or (before the action bar existed) by their words.
const MAIN = [['new-quote', /new quote/i], ['call', /^call$/i], ['text', /^text$/i], ['navigate', /^navigate$/i], ['book', /book appointment/i], ['edit', /^edit$/i]]
function mainActions(main) {
  const vw = window.innerWidth, vh = window.innerHeight
  return main.map(([key, src]) => {
    const re = new RegExp(src, 'i')
    let el = document.querySelector(`[data-customer-action="${key}"]`)
    if (!el) el = [...document.querySelectorAll('button, a[href]')].find(e => re.test((e.innerText || '').trim()) && !e.closest('[data-tabbar]') && e.getBoundingClientRect().width > 0)
    if (!el) return { key, found: false }
    const r = el.getBoundingClientRect()
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2
    const h = cy >= 0 && cy <= vh && cx >= 0 && cx <= vw ? document.elementFromPoint(cx, cy) : null
    // Drawn inside the screen but clipped by its box: elementFromPoint finds something else.
    const onScreen = r.top >= -1 && r.bottom <= vh + 1 && r.left >= -1 && r.right <= vw + 1 && !!h && (h === el || el.contains(h))
    return { key, found: true, onScreen, top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), under: h && !(h === el || el.contains(h)) ? `${h.tagName.toLowerCase()} "${(h.innerText || '').trim().slice(0, 30)}"` : '' }
  })
}

const stamp = Date.now().toString(36).slice(-6)
const made = { contactId: null, cardId: null, userId: null, salesEmail: null }

async function makeCustomer() {
  const v = (await owner('GET', '/api/pipeline')).json.data
  const cardId = `pf${stamp}`
  const today = new Date().toISOString().slice(0, 10)
  const r = await owner('POST', '/api/crm-contacts', {
    firstName: 'E2E', lastName: `Phone Fit ${stamp}`, phone: '3525550199', email: `e2e-phone-fit-${stamp}@example.test`,
    serviceAddress: '1234 SW Long Street Name Road, Ocala, FL 34476', leadSource: 'Referral', tags: ['Test', 'Phone fit'],
    lead: { id: cardId, firstName: 'E2E', lastName: `Phone Fit ${stamp}`, phone: '3525550199', address: '1234 SW Long Street Name Road, Ocala, FL 34476', stage: (v?.stages ?? [])[0] || 'First Contact', createdAt: today, lastMoved: today, leadSource: 'Referral', email: '', notes: '' },
  })
  made.contactId = r.json.data?.contact?.id ?? r.json.data?.id ?? null
  if (made.contactId) made.cardId = cardId
  return made.contactId
}

async function makeSalesman() {
  const email = `e2e-phonefit-${stamp}@example.test`
  const r = await owner('POST', '/api/crm-auth/invite', { firstName: 'E2E', lastName: `Phone Fit ${stamp}`, email, role: 'sales_rep' })
  made.userId = r.json.data?.id ?? null
  made.salesEmail = email
  const u = r.json.data?.inviteUrl ? new URL(r.json.data.inviteUrl) : null
  if (!u) return null
  const pw = `Pf-${crypto.randomBytes(9).toString('base64url')}`
  const a = await call('', 'POST', '/api/crm-auth/accept-invite', { token: u.searchParams.get('token'), email, password: pw })
  return a.json.data?.accessToken ?? null
}

async function cleanup() {
  await owner('DELETE', '/api/follow-ups/pending').catch(() => {})
  if (made.cardId) {
    for (let i = 0; i < 3; i++) {
      const v = (await owner('GET', '/api/pipeline')).json.data?.version
      const r = await owner('PATCH', '/api/pipeline', { upsert: [], remove: [made.cardId], baseVersion: v })
      if (r.status === 200) break
    }
  }
  if (made.contactId) {
    await owner('DELETE', `/api/crm-contacts/${made.contactId}`).catch(() => {})
    const kv = (await owner('GET', '/api/kv')).json
    const acts = kv.data?.fencepro_customer_activity
    if (Array.isArray(acts) && acts.some(a => a.customerId === made.contactId)) {
      await owner('PUT', '/api/kv/fencepro_customer_activity', { value: acts.filter(a => a.customerId !== made.contactId), baseVersion: kv.versions.fencepro_customer_activity })
    }
  }
  if (made.salesEmail) {
    const users = (await owner('GET', '/api/crm-auth/users')).json.data ?? []
    for (const u of users.filter(x => x.email === made.salesEmail)) await owner('DELETE', `/api/crm-auth/users/${u.id}`)
  }
}

// ── One browser at a time ──
async function openSession(name, token) {
  let browser, ctx, page, cdp
  if (name === 'android') {
    browser = await chromium.connectOverCDP(CDP)
    ctx = browser.contexts()[0]
    page = await ctx.newPage()
    if (!NATIVE) {
      cdp = await ctx.newCDPSession(page)
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 0, mobile: true })
    }
    await page.goto(APP)
    await page.evaluate(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, token)
  } else {
    browser = await (name === 'webkit' ? webkit : chromium).launch()
    ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 3, isMobile: name === 'chromium', hasTouch: true })
    await ctx.addInitScript(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, token)
    page = await ctx.newPage()
  }
  // A tel: or sms: link would leave the app: note it and stay (the app's own handlers still run).
  const keepHere = () => {
    window.__tel = window.__tel || []
    window.addEventListener('click', e => {
      const a = e.target instanceof Element ? e.target.closest('a[href^="tel:"], a[href^="sms:"], a[target="_blank"]') : null
      if (a) { window.__tel.push(a.getAttribute('href')); e.preventDefault() }
    }, true)
  }
  if (name === 'android') await page.addInitScript(keepHere); else await ctx.addInitScript(keepHere)
  const errors = [], pending = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)))
  page.on('dialog', d => d.accept().catch(() => {}))
  page.on('request', r => { if (r.url().includes('/api/follow-ups/pending') && r.method() === 'PUT') pending.push(r.postData() || '') })
  await page.route('**/api/automations/trigger', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true,"data":{"matched":0}}' }))
  return { browser, ctx, page, errors, pending, name, cdp, width: NATIVE ? await page.evaluate(() => innerWidth) : W }
}

async function go(s, url, sel) {
  for (let i = 0; ; i++) { try { await s.page.goto(`${APP}${url}`); break } catch (e) { if (i >= 15) throw e; await sleep(2000) } }
  await s.page.waitForSelector('[data-tabbar]', { timeout: 60000 })
  if (sel) await s.page.waitForSelector(sel, { timeout: 30000 })
  await sleep(900)
  // A toast from loading is not part of the screen.
  await s.page.evaluate(() => document.querySelectorAll('[data-toast-close], [aria-label="Dismiss"]').forEach(b => b.click())).catch(() => {})
}
const tapOn = async (s, loc) => { await loc.scrollIntoViewIfNeeded().catch(() => {}); await (s.name === 'webkit' ? loc.tap() : loc.click()); await sleep(600) }

async function shot(s, screen) {
  if (!SHOTS || s.name === 'chromium') return
  const file = s.name === 'android' && (NATIVE || s.width === 412) && screen === 'customer' ? `dev-phone-${TAG}-customer-android.png` : `dev-phone-${TAG}-${screen}-${s.width}${s.name === 'android' ? '-android' : ''}.png`
  await s.page.screenshot({ path: path.join(SHOTS, file) })
}

async function judge(s, screen, opts = {}) {
  const a = await s.page.evaluate(audit, { scope: opts.scope || null, bars: opts.bars || ['[data-tabbar]', '[data-customer-actions]', '[data-quote-bar]'], scroll: true })
  const tag = `${s.name} ${s.width}: ${screen}`
  if (a.missingScope) { check(`${tag}: opens`, false, `no ${opts.scope}`); return a }
  check(`${tag}: no sideways page scroll`, a.hscroll === 0, a.hscroll ? `${a.hscroll}px too wide` : '')
  check(`${tag}: no button off the side of the screen`, a.off.length === 0, a.off.slice(0, 6).join(' | '))
  check(`${tag}: no button cut off by its box`, a.cut.length === 0, a.cut.slice(0, 6).join(' | ') + (a.cut.length > 6 ? ` (+${a.cut.length - 6})` : ''))
  check(`${tag}: no button covered (${a.count} checked)`, a.covered.length === 0, a.covered.slice(0, 6).join(' | ') + (a.covered.length > 6 ? ` (+${a.covered.length - 6})` : ''))
  check(`${tag}: no words cut off in the action bars`, a.clipped.length === 0, a.clipped.slice(0, 6).join(' | '))
  return a
}

async function customerScreen(s, who) {
  await go(s, `/customers/${made.contactId}`, '[data-customer-tab]')
  await shot(s, who === 'owner' ? 'customer' : 'customer-salesman')
  const tag = `${s.name} ${s.width}: customer (${who})`
  const top = await s.page.evaluate(mainActions, MAIN.map(([k, re]) => [k, re.source]))
  const bad = top.filter(m => !m.found || !m.onScreen)
  check(`${tag}: New quote, Call, Text, Navigate, Book appointment and Edit on screen without scrolling`, bad.length === 0, bad.map(m => m.found ? `${m.key} at y ${m.top}..${m.bottom}${m.under ? ` under ${m.under}` : ''}` : `${m.key} missing`).join(', '))
  // Scroll the screen to the bottom: the six stay.
  await s.page.evaluate(() => { const sc = document.querySelector('[data-customer-scroll]') || document.querySelector('[data-page-scroll]'); sc.scrollTop = sc.scrollHeight; document.querySelector('[data-page-scroll]').scrollTop = 1e6 })
  await sleep(400)
  if (who === 'owner') await shot(s, 'customer-scrolled')
  const low = await s.page.evaluate(mainActions, MAIN.map(([k, re]) => [k, re.source]))
  const bad2 = low.filter(m => !m.found || !m.onScreen)
  check(`${tag}: the six stay on screen after scrolling down`, bad2.length === 0, bad2.map(m => m.found ? `${m.key} at y ${m.top}..${m.bottom}${m.under ? ` under ${m.under}` : ''}` : `${m.key} missing`).join(', '))
  const bar = await s.page.evaluate(() => {
    const b = document.querySelector('[data-customer-actions]'), t = document.querySelector('[data-tabbar]')
    if (!b || !t) return null
    return { bar: b.getBoundingClientRect().bottom, tab: t.getBoundingClientRect().top }
  })
  if (bar) check(`${tag}: the action bar sits above the tab bar`, bar.bar <= bar.tab + 1, `${bar.bar} vs ${bar.tab}`)
  await s.page.evaluate(() => { const sc = document.querySelector('[data-page-scroll]'); sc.scrollTop = 0; const c = document.querySelector('[data-customer-scroll]'); if (c) c.scrollTop = 0 })
  await judge(s, `customer (${who})`)
  // Call from the customer screen asks "How'd it go?" like the pipeline card (the pending call reaches the server).
  const callBtn = s.page.locator('[data-customer-action="call"]')
  if (await callBtn.count()) {
    const before = s.pending.length
    await tapOn(s, callBtn)
    const tel = await s.page.evaluate(() => window.__tel || [])
    check(`${tag}: Call is a tel: link and starts the follow up`, tel.some(h => /^tel:\+?1?3525550199$/.test(h)) && s.pending.length > before, `${tel.join(',')} pending ${s.pending.length - before}`)
    await owner('DELETE', '/api/follow-ups/pending')
    const text = s.page.locator('[data-customer-action="text"]')
    await tapOn(s, text)
    const tel2 = await s.page.evaluate(() => window.__tel || [])
    check(`${tag}: Text is an sms: link and starts the follow up`, tel2.some(h => /^sms:/.test(h)) && s.pending.length > before + 1)
    await owner('DELETE', '/api/follow-ups/pending')
    const nav = await s.page.locator('[data-customer-action="navigate"]').getAttribute('href')
    check(`${tag}: Navigate is Google Maps directions to the address`, /google\.com\/maps\/dir\/\?api=1&destination=1234/.test(nav || ''), nav || '')
    if (who === 'owner') {
      await tapOn(s, s.page.locator('[data-customer-action="book"]'))
      const booking = await s.page.locator('[data-booking-dialog], [role="dialog"]:has-text("appointment")').first().isVisible().catch(() => false)
      check(`${tag}: Book appointment opens booking`, booking)
      await s.page.goBack().catch(() => {}); await sleep(500)
      await go(s, `/customers/${made.contactId}`, '[data-customer-tab]')
      await tapOn(s, s.page.locator('[data-customer-action="edit"]'))
      check(`${tag}: Edit opens the form`, await s.page.locator('[data-customer-save]').first().isVisible().catch(() => false))
    }
  }
}

async function ownerScreens(s) {
  if (want('today')) { await go(s, '/today'); await shot(s, 'today'); await judge(s, 'Today') }
  if (want('pipeline')) { await go(s, '/pipeline', '[data-kanban-board]'); await shot(s, 'pipeline'); await judge(s, 'pipeline') }
  if (want('card')) {
    await go(s, `/pipeline?card=${made.cardId}`, '[data-kanban-board]')
    if (!(await s.page.locator('[data-card-window]').count())) await tapOn(s, s.page.locator(`[data-kanban-card="${made.cardId}"]`))
    await s.page.waitForSelector('[data-card-window]', { timeout: 15000 }).catch(() => {})
    await shot(s, 'card'); await judge(s, 'card window', { scope: '[data-card-window]' })
  }
  if (want('customer')) await customerScreen(s, 'owner')
  if (want('quote')) {
    await go(s, `/customers/${made.contactId}`, '[data-customer-tab]')
    const nq = s.page.locator('[data-customer-action="new-quote"]')
    await tapOn(s, (await nq.count()) ? nq : s.page.locator('button:has-text("New quote"):visible').first())
    await s.page.waitForSelector('[data-quote-builder]', { timeout: 20000 })
    for (const step of ['customer', 'yard', 'style', 'price']) {
      await tapOn(s, s.page.locator(`[data-quote-builder] [data-step="${step}"]`))
      if (step === 'style') await s.page.locator('[data-step-panel="style"] select').first().selectOption({ label: 'White Vinyl Privacy, 6 ft tall, 6 ft panels, No dig' }).catch(() => {})
      await s.page.evaluate(() => document.querySelector('[data-quote-builder]')?.scrollTo({ top: 0 }))
      await shot(s, `quote-${step}`); await judge(s, `quote step ${step}`, { scope: '[data-quote-builder]' })
    }
  }
  if (want('follow-ups')) { await go(s, '/follow-ups'); await shot(s, 'follow-ups'); await judge(s, 'Follow ups') }
  if (want('inventory')) {
    await go(s, '/inventory')
    for (const outer of ['Items', 'Sales Orders', 'Operations']) {
      await tapOn(s, s.page.locator(`[data-page-scroll] button:text-is("${outer}")`).first())
      if (outer === 'Items') {
        const inner = await s.page.locator('[data-inv-tab]').count()
          ? await s.page.locator('[data-inv-tab]').evaluateAll(b => b.map(x => x.getAttribute('data-inv-tab')))
          : null
        const names = inner ?? ['Dashboard', 'Catalog', 'Stock', 'History', 'Locations', 'Material Kits', 'Fill in']
        for (const t of names) {
          const loc = inner ? s.page.locator(`[data-inv-tab="${t}"]`) : s.page.locator(`[data-page-scroll] button:has-text("${t}")`).first()
          if (!(await loc.count())) continue
          await tapOn(s, loc); await s.page.evaluate(() => { document.querySelector('[data-page-scroll]').scrollTop = 0 })
          const nm = `inventory-${String(t).toLowerCase().replace(/[^a-z]+/g, '-')}`
          await shot(s, nm); await judge(s, `Inventory ${t}`)
        }
      } else {
        await s.page.evaluate(() => { document.querySelector('[data-page-scroll]').scrollTop = 0 })
        const nm = `inventory-${outer.toLowerCase().replace(/[^a-z]+/g, '-')}`
        await shot(s, nm); await judge(s, `Inventory ${outer}`)
      }
    }
  }
  if (want('settings')) {
    await go(s, '/settings', '[data-settings-tab]')
    const tabs = await s.page.locator('[data-settings-tab]').evaluateAll(b => b.map(x => x.getAttribute('data-settings-tab')))
    for (const t of tabs) {
      await tapOn(s, s.page.locator(`[data-settings-tab="${t}"]`))
      await s.page.evaluate(() => { document.querySelector('[data-page-scroll]').scrollTop = 0 })
      await shot(s, `settings-${t}`); await judge(s, `Settings ${t}`)
    }
  }
  if (want('schedule')) { await go(s, '/schedule'); await shot(s, 'schedule'); await judge(s, 'schedule') }
  if (want('job')) {
    await go(s, '/operations')
    const card = s.page.locator('[data-kanban-card]').first()
    await card.waitFor({ timeout: 20000 }).catch(() => {})
    if (await card.count()) {
      await tapOn(s, card)
      const sheet = '[data-job-detail], div.fixed.inset-y-0.right-0.z-50, [data-bottom-sheet]'
      await s.page.waitForSelector(sheet, { timeout: 10000 }).catch(() => {})
      await sleep(500)
      await shot(s, 'job')
      await judge(s, 'job page', { scope: sheet })
    } else check(`${s.name} ${s.width}: job page opens`, false, 'no job on the Operations board')
  }
}

const engines = CDP ? ['android'] : process.env.BROWSER ? [process.env.BROWSER] : ['webkit', 'chromium']
try {
  if (!(await makeCustomer())) throw new Error('could not make the test customer')
  const salesToken = want('salesman') ? await makeSalesman() : null
  if (want('salesman')) check('salesman login made', !!salesToken)
  for (const name of engines) {
    const s = await openSession(name, OWNER)
    try { await ownerScreens(s) } catch (e) { check(`${name}: owner screens ran to the end`, false, String(e).split('\n').slice(0, 3).join(' ')) }
    check(`${name}: no page errors`, s.errors.length === 0, s.errors.slice(0, 3).join(' | '))
    if (name === 'android') { if (s.cdp) await s.cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => {}); await s.page.close() } else await s.browser.close()
    if (salesToken) {
      const t = await openSession(name, salesToken)
      try { await customerScreen(t, 'salesman') } catch (e) { check(`${name}: salesman customer screen ran to the end`, false, String(e).split('\n').slice(0, 3).join(' ')) }
      if (name === 'android') {
        // Put the emulator's Chrome back on the owner's login.
        await t.page.evaluate(tok => { localStorage.setItem('crm_access_token', tok) }, OWNER)
        if (t.cdp) await t.cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => {})
        await t.page.close()
      } else await t.browser.close()
    }
  }
} catch (e) {
  check('test run finished', false, String(e).split('\n').slice(0, 3).join(' '))
} finally {
  await cleanup()
  const users = made.salesEmail ? ((await owner('GET', '/api/crm-auth/users')).json.data ?? []).filter(x => x.email === made.salesEmail).length : 0
  check('clean up: the test customer, card and login are gone', users === 0)
  const passed = results.filter(Boolean).length
  console.log(`\n${passed} of ${results.length} checks passed (${engines.join(', ')} at ${NATIVE ? 'native' : W} x ${H})`)
  process.exit(passed === results.length ? 0 : 1)
}
