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
// First the screens with a map (Dispatch, the Appointments map, a new site plan):
// the side menu (More), the notifications and messages dropdowns, the search
// dialog and the screen's own dialogs must each be on top of the map, checked at
// nine points where they overlap it (see overlayOverMap); on Dispatch also the
// legend and zoom buttons over the map, and no pin labelled "?".
// On each it fails on:
//   - the page scrolling sideways (document.scrollingElement.scrollWidth > innerWidth)
//   - a visible button or link partly off the screen sideways (a box that
//     scrolls sideways on its own, like a wide table or the board, is fine as
//     long as the box itself is on screen)
//   - a button or link cut off by a box that cannot scroll to it
//   - a button or link covered at its middle by something else, after being
//     scrolled into view (a window that is open counts only its own buttons)
//   - words cut off on a button in an action bar
// Then on each screen it opens every menu, dropdown and popup (see popups()):
// each must open fully on screen (above the tab bar unless drawn over it), every
// button in it reachable (on screen, not covered at its middle), and it must close.
// Screens with known menus (Today, pipeline, customer, Operations) fail if none open.
//
// The customer screen's six main actions (New quote, Call, Text, Navigate,
// Book appointment, Edit) must be on screen without scrolling, and still be on
// screen after scrolling to the bottom. Tapping Call starts "How'd it go?" (the
// pending call reaches the server), which is cleared afterwards.
//
// Dev copy only (port 4001). Makes one test customer with a pipeline card and
// one salesman login, and removes them at the end.
import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import { webkit, chromium } from 'playwright'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { execFileSync } from 'child_process'

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
  // Map pins are left out: on a map, two yards close together overlap by nature.
  const els = [...root.querySelectorAll('button, a[href], [role="button"], summary')].filter(el => shown(el) && !el.closest('.leaflet-marker-pane'))
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
// A phone number of this run's own, so no other test (widget-quote) matches a contact made here.
const PHONE = `352555${String(crypto.randomInt(10000)).padStart(4, '0')}`
const LAST = `Phone Fit ${stamp}`
// The dev database by name (never live): the API only archives a contact, so the
// rows are removed here, the way widget-quote.mjs removes its own.
const psql = sql => execFileSync('psql', ['-d', 'ezbiz_dev', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' }).trim()
const made = { contactId: null, cardId: null, userId: null, salesEmail: null }

async function makeCustomer() {
  const v = (await owner('GET', '/api/pipeline')).json.data
  const cardId = `pf${stamp}`
  const today = new Date().toISOString().slice(0, 10)
  const r = await owner('POST', '/api/crm-contacts', {
    firstName: 'E2E', lastName: LAST, phone: PHONE, email: `e2e-phone-fit-${stamp}@example.test`,
    serviceAddress: '1234 SW Long Street Name Road, Ocala, FL 34476', leadSource: 'Referral', tags: ['Test', 'Phone fit'],
    lead: { id: cardId, firstName: 'E2E', lastName: LAST, phone: PHONE, address: '1234 SW Long Street Name Road, Ocala, FL 34476', stage: (v?.stages ?? [])[0] || 'First Contact', createdAt: today, lastMoved: today, leadSource: 'Referral', email: '', notes: '' },
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

// Removes everything this run made, each step on its own so one failing does not
// stop the rest: the pending call, the card (by id and by name), the contact and
// what hangs off it (quotes the quote steps saved, website intake rows, notes,
// calls, pending touches), its activity entries, and the salesman login.
async function cleanup() {
  const step = async (name, fn) => { try { await fn() } catch (e) { console.log(`clean up: ${name} failed -- ${String(e).split('\n')[0]}`) } }
  await step('pending call', () => owner('DELETE', '/api/follow-ups/pending'))
  await step('card', async () => {
    for (let i = 0; i < 3; i++) {
      const v = (await owner('GET', '/api/pipeline')).json.data
      const ids = (v?.leads ?? []).filter(l => l.id === made.cardId || (l.firstName === 'E2E' && l.lastName === LAST)).map(l => l.id)
      if (!ids.length) break
      const r = await owner('PATCH', '/api/pipeline', { upsert: [], remove: ids, baseVersion: v.version })
      if (r.status === 200) break
    }
  })
  let ids = made.contactId ? [made.contactId] : []
  await step('find contacts', () => { ids = [...new Set([...ids, ...psql(`select id from "CrmContact" where "firstName"='E2E' and "lastName"='${LAST}'`).split('\n').filter(Boolean)])] })
  for (const id of ids) await step(`archive ${id}`, () => owner('DELETE', `/api/crm-contacts/${id}`))
  await step('activity', async () => {
    const kv = (await owner('GET', '/api/kv')).json
    const acts = kv.data?.fencepro_customer_activity
    if (Array.isArray(acts) && acts.some(a => ids.includes(a.customerId))) {
      await owner('PUT', '/api/kv/fencepro_customer_activity', { value: acts.filter(a => !ids.includes(a.customerId)), baseVersion: kv.versions.fencepro_customer_activity })
    }
  })
  if (ids.length) {
    const list = ids.map(id => `'${id.replace(/'/g, '')}'`).join(',')
    await step('contact rows', () => psql(`begin; delete from "IntakeLead" where "crmContactId" in (${list}); delete from "SavedQuote" where "crmContactId" in (${list}); delete from "CrmContactNote" where "crmContactId" in (${list}); delete from "PendingTouch" where "crmContactId" in (${list}); delete from "CallLog" where "crmContactId" in (${list}); delete from "CrmContact" where id in (${list}); commit;`))
  }
  if (made.salesEmail) await step('salesman login', async () => {
    const users = (await owner('GET', '/api/crm-auth/users')).json.data ?? []
    for (const u of users.filter(x => x.email === made.salesEmail)) await owner('DELETE', `/api/crm-auth/users/${u.id}`)
  })
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
  return { browser, ctx, page, errors, pending, name, cdp, token, width: NATIVE ? await page.evaluate(() => innerWidth) : W }
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

// ── Menus, dropdowns and popups: open each one and check it ──
// The triggers: anything marked data-popup-trigger (every PopMenu), aria-haspopup,
// data-menu, a <summary>, aria-expanded, or a button named More / Filter / Sort /
// Actions / Pick / Choose. Those in the header and tab bar are opened on Today and
// the customer screen only (they are the same on every screen).
function listTriggers({ scope, header }) {
  const vw = window.innerWidth, vh = window.innerHeight
  document.querySelectorAll('[data-pf-trigger]').forEach(e => e.removeAttribute('data-pf-trigger'))
  const root = scope ? document.querySelector(scope) : document.body
  if (!root) return []
  const shown = el => {
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) return false
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      const cs = getComputedStyle(e)
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false
      if (cs.position === 'fixed') { const fr = e.getBoundingClientRect(); if (fr.right <= 0 || fr.left >= vw || fr.bottom <= 0 || fr.top >= vh) return false }
    }
    return !el.closest('[aria-hidden="true"], [inert], details:not([open]) > :not(summary)')
  }
  const words = /^(more\b|filter|sort|actions\b|pick |choose )/i
  const set = new Set(root.querySelectorAll('[data-popup-trigger], [aria-haspopup]:not([aria-haspopup="false"]), [data-menu], summary, [aria-expanded]'))
  for (const b of root.querySelectorAll('button')) if (words.test((b.getAttribute('aria-label') || b.innerText || '').trim())) set.add(b)
  const out = []
  let i = 0
  for (const el of set) {
    if (!shown(el) || el.disabled || el.closest('[data-popup]')) continue
    const global = !scope && (!!el.closest('[data-tabbar], header') || !el.closest('[data-page-scroll]'))
    if (global && !header) continue
    // Already open (an expanded row): left as it is.
    if (el.getAttribute('aria-expanded') === 'true') continue
    const menu = el.hasAttribute('data-popup-trigger') || (el.hasAttribute('aria-haspopup') && el.getAttribute('aria-haspopup') !== 'false') || el.hasAttribute('data-menu')
    el.setAttribute('data-pf-trigger', String(i))
    const name = (el.getAttribute('data-popup-trigger') || el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 30)
    out.push({ i: i++, name, menu, global })
  }
  return out
}

// Marks what is open before a tap, so the popup the tap opened can be told apart.
const POPUPS = '[data-popup], [role="menu"], [role="listbox"], [data-bottom-sheet]'
function markOpenPopups(sel) {
  document.querySelectorAll('[data-pf-seen], [data-pf-open]').forEach(e => { e.removeAttribute('data-pf-seen'); e.removeAttribute('data-pf-open') })
  for (const p of document.querySelectorAll(sel)) { const r = p.getBoundingClientRect(); if (r.width > 2 && r.height > 2 && r.right > 0 && r.left < innerWidth) p.setAttribute('data-pf-seen', '1') }
}
function findNewPopup(sel) {
  const vis = p => { const r = p.getBoundingClientRect(); const cs = getComputedStyle(p); return r.width > 2 && r.height > 2 && r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight && cs.visibility !== 'hidden' && cs.display !== 'none' }
  const fresh = [...document.querySelectorAll(sel)].filter(p => !p.hasAttribute('data-pf-seen') && vis(p))
  const p = fresh.find(x => x.hasAttribute('data-popup')) || fresh[0]
  if (!p) return null
  p.setAttribute('data-pf-open', '1')
  return p.getAttribute('data-popup') || p.getAttribute('role') || p.tagName.toLowerCase()
}
function popupIsOpen() {
  const p = document.querySelector('[data-pf-open]')
  if (!p || !p.isConnected) return false
  const r = p.getBoundingClientRect()
  return r.width > 2 && r.right > 1 && r.left < innerWidth - 1 && getComputedStyle(p).visibility !== 'hidden'
}

// The open popup: its box fully on the screen and above the tab bar (unless it is
// drawn over the tab bar), and every button, link and field in it on the screen and
// not covered at its middle (after scrolling it into view inside the popup).
function checkPopup() {
  const vw = window.innerWidth, vh = window.innerHeight
  const p = document.querySelector('[data-pf-open]')
  const out = { box: null, problems: [], items: 0 }
  if (!p) { out.problems.push('popup gone'); return out }
  const r = p.getBoundingClientRect()
  out.box = { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom) }
  if (r.left < -1) out.problems.push(`${Math.round(-r.left)}px off the left`)
  if (r.right > vw + 1) out.problems.push(`${Math.round(r.right - vw)}px off the right`)
  if (r.top < -1) out.problems.push(`${Math.round(-r.top)}px off the top`)
  if (r.bottom > vh + 1) out.problems.push(`${Math.round(r.bottom - vh)}px off the bottom`)
  const tb = document.querySelector('[data-tabbar]')
  const tr = tb ? tb.getBoundingClientRect() : null
  if (tr && tr.height > 2 && getComputedStyle(tb).display !== 'none' && r.bottom > tr.top + 1) {
    const x = Math.min(Math.max(r.left + 4, 1), Math.min(r.right, vw) - 4), y = Math.min(r.bottom, vh) - 3
    const h = document.elementFromPoint(x, y)
    if (!h || !p.contains(h)) out.problems.push(`${Math.round(r.bottom - tr.top)}px under the tab bar`)
  }
  const label = el => (el.getAttribute('aria-label') || el.innerText || el.getAttribute('placeholder') || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 30)
  const shown = el => { const b = el.getBoundingClientRect(); if (b.width < 2 || b.height < 2) return false; for (let e = el; e && e !== p.parentElement; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden') return false } return true }
  const items = [...p.querySelectorAll('button, a[href], [role="button"], [role="menuitem"], summary, input:not([type="hidden"]), select, textarea')].filter(shown)
  out.items = items.length
  for (const el of items) {
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    const b = el.getBoundingClientRect()
    const cx = b.left + b.width / 2, cy = b.top + b.height / 2
    if (b.left < -1 || b.right > vw + 1 || cy < 0 || cy > vh) { out.problems.push(`"${label(el)}" off the screen x ${Math.round(b.left)}..${Math.round(b.right)} y ${Math.round(b.top)}`); continue }
    const h = document.elementFromPoint(cx, cy)
    if (!h || !(h === el || el.contains(h) || (h.closest('label') && h.closest('label').contains(el)))) out.problems.push(`"${label(el)}" covered by ${h ? h.tagName.toLowerCase() + (h.closest('[data-tabbar]') ? ' (tab bar)' : '') : 'nothing'}`)
  }
  return out
}

// Opens each menu on the screen, checks it, and closes it. min: the screen has known
// menus, so at least this many must open. Expanders (a row that opens in place) are
// tapped too, at most six a screen: the page must still not run off the side.
async function popups(s, screen, opts = {}) {
  const tag = `${s.name} ${s.width}: ${screen}`
  const triggers = await s.page.evaluate(listTriggers, { scope: opts.scope || null, header: !!opts.header })
  let opened = 0, expanders = 0
  const names = []
  for (const t of triggers) {
    if (!t.menu && expanders >= 6) continue
    const trig = s.page.locator(`[data-pf-trigger="${t.i}"]`)
    if (!(await trig.count())) continue
    await s.page.evaluate(markOpenPopups, POPUPS)
    try { await tapOn(s, trig) } catch (e) { check(`${tag}: "${t.name}" can be tapped`, false, String(e).split('\n')[0]); continue }
    await sleep(300)
    const found = await s.page.evaluate(findNewPopup, POPUPS)
    if (!found) {
      if (t.menu) { check(`${tag}: "${t.name}" opens its popup`, false, 'nothing opened'); continue }
      // An expander: what it opened must not push anything off the side.
      expanders++
      const a = await s.page.evaluate(audit, { scope: opts.scope || null, bars: [], scroll: false })
      if (a.hscroll || a.off.length) check(`${tag}: opening "${t.name}" keeps everything on screen`, false, `${a.hscroll}px sideways; ${a.off.slice(0, 3).join(' | ')}`)
      if (await trig.count() && (await trig.getAttribute('aria-expanded')) === 'true') await tapOn(s, trig).catch(() => {})
      continue
    }
    opened++
    names.push(found)
    if (opts.shotFor && opts.shotFor[found] && SHOTS) await s.page.screenshot({ path: path.join(SHOTS, opts.shotFor[found]) })
    const c = await s.page.evaluate(checkPopup)
    check(`${tag}: popup "${found}" (from "${t.name}") is fully on screen with its ${c.items} buttons reachable`, c.problems.length === 0,
      `${c.box ? `box ${c.box.left}..${c.box.right} x ${c.box.top}..${c.box.bottom}; ` : ''}${c.problems.slice(0, 5).join(' | ')}`)
    // Close it: its Close button, the button again, Escape, then Back.
    const steps = [
      async () => { const x = s.page.locator('[data-pf-open] [data-popup-close], [data-pf-open] [aria-label^="Close"]').first(); if (await x.count()) await tapOn(s, x) },
      async () => { await tapOn(s, trig) },
      async () => { await s.page.keyboard.press('Escape'); await sleep(400) },
      async () => { await s.page.goBack(); await sleep(800) },
    ]
    let closed = false
    for (const step of steps) {
      if (!(await s.page.evaluate(popupIsOpen))) { closed = true; break }
      await step().catch(() => {})
    }
    if (!closed) closed = !(await s.page.evaluate(popupIsOpen))
    check(`${tag}: popup "${found}" closes`, closed)
  }
  const min = opts.min ?? 0
  const missing = (opts.need || []).filter(n => !names.includes(n))
  check(`${tag}: ${opened} popup${opened === 1 ? '' : 's'} opened (${names.join(', ') || 'none'})${expanders ? `, ${expanders} expander${expanders === 1 ? '' : 's'}` : ''}`, opened >= min && !missing.length,
    [min && opened < min ? `expected at least ${min}` : '', missing.length ? `did not open: ${missing.join(', ')}` : ''].filter(Boolean).join('; '))
  s.popupCounts = s.popupCounts || []
  s.popupCounts.push(`${screen}: ${opened}${expanders ? ` (+${expanders} expanders)` : ''}`)
  return opened
}

// ── Maps never cover a menu, sheet, dialog or dropdown ──
// A Leaflet map draws with z-index up to 1000 inside; layers.css shuts every map
// in its own layer so it stays under the page's overlays. Checked by looking at
// several points where the overlay and the map overlap: the overlay must be what
// is there. While checking, every part of the map takes taps (tiles normally let
// taps through, which would hide a map drawn on top).
function overlayOverMap({ overlays, map }) {
  const vis = e => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 2 && r.height > 2 && cs.visibility !== 'hidden' && cs.display !== 'none' && r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight }
  const m = [...document.querySelectorAll(map)].find(vis)
  if (!m) return { error: `no map (${map})` }
  const els = overlays.flatMap(sel => [...document.querySelectorAll(sel)].filter(vis))
  if (!els.length) return { error: `no overlay (${overlays.join(', ')})` }
  const mr = m.getBoundingClientRect()
  const cut = r => ({ left: Math.max(r.left, mr.left, 0), right: Math.min(r.right, mr.right, innerWidth), top: Math.max(r.top, mr.top, 0), bottom: Math.min(r.bottom, mr.bottom, innerHeight) })
  const area = els.map(e => cut(e.getBoundingClientRect())).find(a => a.right - a.left > 8 && a.bottom - a.top > 8)
  if (!area) return { error: 'the overlay does not reach over the map here' }
  const style = document.createElement('style')
  style.textContent = '.leaflet-container, .leaflet-container * { pointer-events: auto !important; }'
  document.head.appendChild(style)
  const bad = []
  let n = 0
  for (const fx of [0.15, 0.5, 0.85]) for (const fy of [0.15, 0.5, 0.85]) {
    const x = area.left + (area.right - area.left) * fx, y = area.top + (area.bottom - area.top) * fy
    const h = document.elementFromPoint(x, y)
    n++
    if (!h || !els.some(e => e === h || e.contains(h))) bad.push(`${Math.round(x)},${Math.round(y)} shows ${h ? (h.closest('.leaflet-container') ? 'the map (' + (h.className?.baseVal ?? h.className) + ')' : h.tagName.toLowerCase()) : 'nothing'}`.slice(0, 90))
  }
  style.remove()
  return { n, bad }
}

async function overMap(s, screen, what, overlays, map = '.leaflet-container') {
  await sleep(400)
  const r = await s.page.evaluate(overlayOverMap, { overlays, map })
  check(`${s.name} ${s.width}: ${screen}: ${what} is on top of the map${r.n ? ` (${r.n} points)` : ''}`, !r.error && r.bad.length === 0, r.error || r.bad.slice(0, 4).join(' | '))
}

const closeAll = async s => {
  for (let i = 0; i < 3; i++) {
    const open = await s.page.evaluate(() => !!document.querySelector('.mobile-nav-drawer.open, [data-popup]:not([data-popup="nav-drawer"]), [data-global-search]'))
    if (!open) return
    await s.page.keyboard.press('Escape').catch(() => {}); await sleep(300)
    const x = s.page.locator('.mobile-nav-drawer.open [aria-label="Close menu"]')
    if (await x.count()) await tapOn(s, x)
    const back = s.page.locator('[data-popup-backdrop]')
    if (await back.count()) await back.first().click({ position: { x: 5, y: 5 } }).catch(() => {})
    await sleep(300)
  }
}

// On a screen showing a map: the side menu (More), the header's dropdowns, the
// search dialog, and the screen's own sheets and dialogs over the map.
async function mapOverlays(s, screen) {
  await tapOn(s, s.page.locator('[data-tabbar] [data-popup-trigger="nav-drawer"]'))
  await overMap(s, screen, 'the side menu (More)', ['.mobile-nav-drawer.open'])
  if (screen === 'Dispatch' && SHOTS && s.name === 'webkit') await s.page.screenshot({ path: path.join(SHOTS, `dispatch-menu-${TAG}.png`) })
  await closeAll(s)
  for (const name of ['notifications', 'messages']) {
    const trig = s.page.locator(`[data-popup-trigger="${name}"]:visible`).first()
    if (!(await trig.count())) { check(`${s.name} ${s.width}: ${screen}: the ${name} dropdown is there`, false); continue }
    await tapOn(s, trig)
    await overMap(s, screen, `the ${name} dropdown`, [`[data-popup="${name}"]`, '[data-popup-backdrop]'])
    await closeAll(s)
  }
  await tapOn(s, s.page.locator('[data-header-search]:visible').first())
  await overMap(s, screen, 'the search dialog', ['div:has(> [data-global-search])'])
  await closeAll(s)
}

async function mapScreens(s) {
  if (want('dispatch')) {
    await go(s, '/dispatch', '[data-dispatch-map] .leaflet-container')
    await mapOverlays(s, 'Dispatch')
    // The legend and the zoom buttons sit over the map (inside its layer).
    await overMap(s, 'Dispatch', 'the legend button', ['[data-dispatch-legend-toggle]'])
    await overMap(s, 'Dispatch', 'the zoom buttons', ['.leaflet-control-zoom'], '[data-dispatch-map] .leaflet-container')
    const t = s.page.locator('[data-dispatch-legend-toggle]')
    if ((await t.getAttribute('aria-expanded')) !== 'true') await tapOn(s, t)
    await overMap(s, 'Dispatch', 'the open legend', ['[data-dispatch-legend-body]'])
    const pins = await s.page.evaluate(() => [...document.querySelectorAll('[data-dispatch-pin]')].map(p => p.getAttribute('data-label')))
    check(`${s.name} ${s.width}: Dispatch: pins have a label, none "?" (${pins.length} pins)`, pins.every(l => l && l !== '?'), pins.filter(l => !l || l === '?').length + ' bad')
    if (SHOTS && s.name === 'webkit') await s.page.screenshot({ path: path.join(SHOTS, `dispatch-pins-${TAG}.png`) })
    await tapOn(s, t) // fold the legend: open, it covers part of the map on purpose
    await judge(s, 'Dispatch')
  }
  if (want('appointments-map')) {
    await go(s, '/appointments', '[data-view="map"]')
    await tapOn(s, s.page.locator('[data-view="map"]'))
    await s.page.waitForSelector('[data-day-map] .leaflet-container', { timeout: 20000 }).catch(() => {})
    await s.page.locator('[data-day-map]').scrollIntoViewIfNeeded().catch(() => {})
    await mapOverlays(s, 'Appointments map')
  }
  if (want('site-plan-map')) {
    // Each dialog over the map, from a freshly loaded Site Plans page and a new tool.
    // Closing a dialog there goes Back, which can leave the page; so each starts over.
    for (const [btn, what] of [['Open', 'the saved plans dialog'], ['Save', 'the save dialog']]) {
      await go(s, '/site-plans')
      await tapOn(s, s.page.locator('button:has-text("Create New Site Plan")').first())
      await s.page.waitForSelector('[data-site-plan-map].leaflet-container', { timeout: 30000 }).catch(() => {})
      await tapOn(s, s.page.locator(`[data-site-plan-tool] button:text-is("${btn}")`).first())
      await overMap(s, 'Site plan', what, ['[data-site-plan-tool] > div.fixed.inset-0'], '[data-site-plan-map]')
      const back = s.page.locator('[data-site-plan-tool] > div.fixed.inset-0').last()
      if (await back.count()) await back.click({ position: { x: 3, y: 3 }, timeout: 3000 }).catch(() => {})
      await sleep(800)
    }
  }
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
  // Every menu on the customer screen, the header's too; the owner's More holds Delete customer.
  await popups(s, `customer (${who})`, {
    header: true, min: 1, need: who === 'owner' ? ['customer-more', 'notifications', 'nav-drawer'] : ['nav-drawer'],
    shotFor: who === 'owner' && s.name !== 'chromium' ? { 'customer-more': s.name === 'android' ? `dev-more-menu-after-${NATIVE ? 'native-' : ''}android.png` : `dev-more-menu-after-${s.width}.png` } : null,
  })
  await go(s, `/customers/${made.contactId}`, '[data-customer-tab]')
  // Call from the customer screen asks "How'd it go?" like the pipeline card (the pending call reaches the server).
  const callBtn = s.page.locator('[data-customer-action="call"]')
  if (await callBtn.count()) {
    const before = s.pending.length
    await tapOn(s, callBtn)
    const tel = await s.page.evaluate(() => window.__tel || [])
    check(`${tag}: Call is a tel: link and starts the follow up`, tel.some(h => new RegExp(`^tel:\\+?1?${PHONE}$`).test(h)) && s.pending.length > before, `${tel.join(',')} pending ${s.pending.length - before}`)
    await call(s.token, 'DELETE', '/api/follow-ups/pending') // as whoever tapped Call, not the owner
    const text = s.page.locator('[data-customer-action="text"]')
    await tapOn(s, text)
    const tel2 = await s.page.evaluate(() => window.__tel || [])
    check(`${tag}: Text is an sms: link and starts the follow up`, tel2.some(h => /^sms:/.test(h)) && s.pending.length > before + 1)
    await call(s.token, 'DELETE', '/api/follow-ups/pending') // as whoever tapped Call, not the owner
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
  await mapScreens(s)
  if (want('today')) {
    await go(s, '/today'); await shot(s, 'today'); await judge(s, 'Today')
    await popups(s, 'Today', { header: true, min: 3, need: ['messages', 'notifications', 'nav-drawer'],
      shotFor: s.name === 'webkit' ? { notifications: `dev-notifications-after-${s.width}.png`, messages: `dev-messages-after-${s.width}.png` } : null })
  }
  if (want('pipeline')) { await go(s, '/pipeline', '[data-kanban-board]'); await shot(s, 'pipeline'); await judge(s, 'pipeline'); await popups(s, 'pipeline', { min: 1, need: ['filter'] }) }
  if (want('card')) {
    await go(s, `/pipeline?card=${made.cardId}`, '[data-kanban-board]')
    if (!(await s.page.locator('[data-card-window]').count())) await tapOn(s, s.page.locator(`[data-kanban-card="${made.cardId}"]`))
    await s.page.waitForSelector('[data-card-window]', { timeout: 15000 }).catch(() => {})
    await shot(s, 'card'); await judge(s, 'card window', { scope: '[data-card-window]' }); await popups(s, 'card window', { scope: '[data-card-window]' })
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
      await shot(s, `quote-${step}`); await judge(s, `quote step ${step}`, { scope: '[data-quote-builder]' }); await popups(s, `quote step ${step}`, { scope: '[data-quote-builder]' })
    }
  }
  if (want('follow-ups')) { await go(s, '/follow-ups'); await shot(s, 'follow-ups'); await judge(s, 'Follow ups'); await popups(s, 'Follow ups') }
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
          await shot(s, nm); await judge(s, `Inventory ${t}`); await popups(s, `Inventory ${t}`)
        }
      } else {
        await s.page.evaluate(() => { document.querySelector('[data-page-scroll]').scrollTop = 0 })
        const nm = `inventory-${outer.toLowerCase().replace(/[^a-z]+/g, '-')}`
        await shot(s, nm); await judge(s, `Inventory ${outer}`); await popups(s, `Inventory ${outer}`)
      }
    }
  }
  if (want('settings')) {
    await go(s, '/settings', '[data-settings-tab]')
    const tabs = await s.page.locator('[data-settings-tab]').evaluateAll(b => b.map(x => x.getAttribute('data-settings-tab')))
    for (const t of tabs) {
      await tapOn(s, s.page.locator(`[data-settings-tab="${t}"]`))
      await s.page.evaluate(() => { document.querySelector('[data-page-scroll]').scrollTop = 0 })
      await shot(s, `settings-${t}`); await judge(s, `Settings ${t}`); await popups(s, `Settings ${t}`)
    }
  }
  if (want('schedule')) { await go(s, '/schedule'); await shot(s, 'schedule'); await judge(s, 'schedule'); await popups(s, 'schedule') }
  if (want('job')) {
    await go(s, '/operations')
    const card = s.page.locator('[data-kanban-card]').first()
    await card.waitFor({ timeout: 20000 }).catch(() => {})
    await popups(s, 'Operations board', { min: 1, need: ['filter'] })
    await go(s, '/operations'); await card.waitFor({ timeout: 20000 }).catch(() => {})
    if (await card.count()) {
      await tapOn(s, card)
      const sheet = '[data-job-detail], div.fixed.inset-y-0.right-0.z-50, [data-bottom-sheet]'
      await s.page.waitForSelector(sheet, { timeout: 10000 }).catch(() => {})
      await sleep(500)
      await shot(s, 'job')
      await judge(s, 'job page', { scope: sheet }); await popups(s, 'job page', { scope: sheet })
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
    console.log(`${name}: popups opened per screen -- ${(s.popupCounts || []).join('; ')}`)
    if (name === 'android') { if (s.cdp) await s.cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => {}); await s.page.close() } else await s.browser.close()
    if (salesToken) {
      const t = await openSession(name, salesToken)
      try { await customerScreen(t, 'salesman') } catch (e) { check(`${name}: salesman customer screen ran to the end`, false, String(e).split('\n').slice(0, 3).join(' ')) }
      console.log(`${name} (salesman): popups opened -- ${(t.popupCounts || []).join('; ')}`)
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
  let rows = '?'
  try { rows = psql(`select count(*) from "CrmContact" where ("firstName"='E2E' and "lastName"='${LAST}') or phone='${PHONE}'`) } catch {}
  const cards = ((await owner('GET', '/api/pipeline')).json.data?.leads ?? []).filter(l => l.lastName === LAST).length
  check('clean up: the test customer, card and login are gone', users === 0 && rows === '0' && cards === 0, `logins ${users}, contacts ${rows}, cards ${cards}`)
  const passed = results.filter(Boolean).length
  console.log(`\n${passed} of ${results.length} checks passed (${engines.join(', ')} at ${NATIVE ? 'native' : W} x ${H})`)
  process.exit(passed === results.length ? 0 : 1)
}
