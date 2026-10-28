// Three reviewer findings of Oct 28 2026 (FEATURES 9au), used as the right person on the right screen.
//
//   APP_URL=http://localhost:4092 API_URL=http://localhost:4092 \
//   OWNER_COOKIE=<owner cookie> OFFICE_COOKIE=<office cookie> SALES_COOKIE=<Salesman cookie> E2E_STAFF_COOKIE=x \
//   SHOTS=<folder> [ONLY=1,2,3] node e2e/review-1028-fixes.mjs
//   (cookies: cd apps/portal && npx tsx scripts/dev-session-token.ts --cookie --email <login> --out <file>)
//
//   1. Owner, computer: adds a temp stage in Settings > Operations Stages, a job (materials not ordered) is in it,
//      deletes the stage moving the job to Ready to Pull: the job is in Ready to Pull, its materials still Not ordered.
//   2. Office, computer: Inventory > Catalog, "Green": a borrowed price shows a short "From Black" badge, its detail on
//      a line under the row saying Jonathan enters the green price (never "Type"). The owner's line says to type it.
//   3. Salesman, phone (390 x 844, WebKit): Chain link, Green, then 5 ft with the Height row just above the bottom bar:
//      the note "Green is not offered at 5 ft…" ends up in sight above the bar.
// Makes one test job, one temp stage and one draft quote; removes them at the end and checks the stage list is as it was.

import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import { chromium, webkit } from 'playwright'
import fs from 'fs'
import { signInByCookie } from './lib.mjs'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || APP
const OWNER = process.env.OWNER_COOKIE || ''
const OFFICE = process.env.OFFICE_COOKIE || ''
const SALES = process.env.SALES_COOKIE || ''
const SHOTS = process.env.SHOTS || ''
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean)
if (!OWNER || !OFFICE || !SALES) { console.error('Set OWNER_COOKIE, OFFICE_COOKIE and SALES_COOKIE.'); process.exit(2) }
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })
const want = k => !ONLY.length || ONLY.includes(k)

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }) }
const tag = `REVIEW1028 ${Date.now().toString(36)}`
const H = { 'X-Staff-Request': '1', 'Content-Type': 'application/json' }
const made = { jobs: [], quotes: [], stages: [] }
const shape = l => JSON.stringify(l.stages.map(s => ({ id: s.id, name: s.name, color: s.color, order: s.order, hidden: s.hidden, isFirst: s.isFirst, isComplete: s.isComplete, lane: s.lane })))

async function apiOf(ctx) {
  return async (method, path, data) => {
    const r = await ctx.request.fetch(`${API}${path}`, { method, headers: H, ...(data === undefined ? {} : { data }) })
    const j = await r.json().catch(() => null)
    if (!r.ok()) throw new Error(`${method} ${path}: ${r.status()} ${JSON.stringify(j).slice(0, 300)}`)
    return j?.data ?? j
  }
}

const desk = await chromium.launch()
const mobile = await webkit.launch()
const owner = await desk.newContext({ viewport: { width: 1440, height: 900 } })
const office = await desk.newContext({ viewport: { width: 1440, height: 900 } })
const phone = await mobile.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
await signInByCookie(owner, { cookie: OWNER, api: API })
await signInByCookie(office, { cookie: OFFICE, api: API })
await signInByCookie(phone, { cookie: SALES, api: API })
const ownerApi = await apiOf(owner)
const original = await ownerApi('GET', '/api/ops-stages')
try {
  // ── 1: the owner deletes a temp stage with a job in it ─────────────────────
  if (want('1')) {
    const job = await ownerApi('POST', '/api/saved-jobs', { customerName: `${tag} Temp Stage Job`, customerAddress: '100 Pecan Dr, Ocala, FL 34472', fenceStyle: "WV-ND 6'x6' Privacy", sections: 10, contractValue: 4100, status: 'staging', materialsStatus: 'not_ordered', locatesDate: '2026-10-20' })
    made.jobs.push(job.id)
    const page = await owner.newPage()
    const errs = []; page.on('pageerror', e => errs.push(String(e).slice(0, 200)))
    await page.goto(`${APP}/settings?tab=ops_stages`)
    await page.waitForSelector('[data-ops-stages-settings]', { timeout: 60000 }); await sleep(800)
    await page.locator('[data-ops-stage-add]').click(); await sleep(300)
    const ids = await page.$$eval('[data-ops-stage-row]', els => els.map(e => e.getAttribute('data-ops-stage-row')))
    const newId = ids.find(id => !original.stages.some(s => s.id === id)) || ''
    made.stages.push(newId)
    await page.locator(`[data-ops-stage-row="${newId}"] [data-ops-stage-name]`).fill(`Temp ${tag}`)
    // Up until it sits just before Scheduled (a waiting stage).
    for (let i = 0; i < 20; i++) {
      const now = await page.$$eval('[data-ops-stage-row]', els => els.map(e => e.getAttribute('data-ops-stage-row')))
      if (now.indexOf(newId) === now.indexOf('scheduled') - 1 || now.indexOf(newId) < now.indexOf('scheduled')) break
      await page.locator(`[data-ops-stage-row="${newId}"] [data-ops-stage-up]`).click(); await sleep(80)
    }
    await page.locator('[data-ops-stages-save]').first().click()
    await page.waitForSelector('[data-ops-stages-save]:has-text("Saved")', { timeout: 15000 }).catch(() => null)
    const moved = await ownerApi('PATCH', `/api/saved-jobs/${job.id}`, { opsStage: newId })
    check('1. temp stage saved; the job is in it, materials Not ordered', moved.opsStage === newId && moved.materialsStatus === 'not_ordered', `${moved.opsStage} ${moved.materialsStatus}`)
    await page.reload(); await page.waitForSelector('[data-ops-stages-settings]', { timeout: 60000 }); await sleep(800)
    await page.locator(`[data-ops-stage-row="${newId}"] [data-ops-stage-delete]`).click()
    const dlg = page.locator('[data-ops-stage-delete-dialog]')
    await dlg.waitFor({ timeout: 15000 })
    const words = await dlg.innerText()
    check('1. the delete box lists the job and says nothing else changes', words.includes(`${tag} Temp Stage Job`) && /Nothing else about the jobs changes/.test(words))
    await page.locator('[data-ops-stage-delete-moveto]').selectOption('ready_to_pull')
    await shot(page, '1-owner-delete-temp-stage-move-to-ready-to-pull')
    await page.locator('[data-ops-stage-delete-confirm]').click()
    await dlg.waitFor({ state: 'detached', timeout: 15000 }).catch(() => null)
    await sleep(500)
    const after = await ownerApi('GET', `/api/saved-jobs/${job.id}`)
    check('1. the job moved to Ready to Pull; its materials are still Not ordered (not Received)', after.opsStage === 'ready_to_pull' && after.status === 'staging' && after.materialsStatus === 'not_ordered', `${after.opsStage} ${after.status} ${after.materialsStatus}`)
    const list = await ownerApi('GET', '/api/ops-stages')
    check('1. the temp stage is gone', !list.stages.some(s => s.id === newId))
    if (!list.stages.some(s => s.id === newId)) made.stages.pop()
    // The job's window on the board says what the materials really are.
    await page.goto(`${APP}/operations?job=${job.id}`)
    await sleep(4000)
    await shot(page, '1-owner-job-after-delete-materials-not-ordered')
    check('1. no page errors', errs.length === 0, errs.join(' | '))
    await page.close()
  }

  // ── 2: Inventory "From Black" rows ────────────────────────────────────────
  if (want('2')) {
    for (const [who, ctx] of [['office', office], ['owner', owner]]) {
      const page = await ctx.newPage()
      await page.goto(`${APP}/inventory?tab=catalog`)
      await page.waitForSelector('[data-global-appointment]', { timeout: 60000 }); await sleep(1500)
      const catalogTab = page.locator('button:has-text("Catalog")').first()
      if (await catalogTab.count()) { await catalogTab.click(); await sleep(1000) }
      await page.locator('input[placeholder="Search items..."]').fill('Green'); await sleep(800)
      const badge = page.locator('[data-from-black-badge]').first()
      const nBadges = await page.locator('[data-from-black-badge]').count()
      if (!nBadges) { check(`2. ${who}: a From Black row is there`, false); await page.close(); continue }
      await badge.scrollIntoViewIfNeeded()
      const id = await badge.getAttribute('data-from-black-badge')
      const badgeText = await badge.innerText()
      const cell = page.locator(`[data-price-item="${id}"]`)
      const h = (await cell.boundingBox())?.height ?? 999
      // The same height as a plain row's (one with a dated price) for the same login.
      const plain = (await page.locator('[data-price-age="fresh"]').first().boundingBox())?.height ?? 0
      const note = await page.locator(`tr[data-follows-black="${id}"]`).innerText()
      check(`2. ${who}: "From Black" badge on one line; the row is no taller than a plain one`, badgeText.trim() === 'From Black' && h <= plain + 2, `badge "${badgeText}", row ${Math.round(h)} px, plain row ${Math.round(plain)} px, ${nBadges} rows`)
      if (who === 'office') check('2. office: the line under the row says Jonathan enters the green price, never to type one', /Jonathan enters the green price\./.test(note) && !/Type/.test(note), note)
      else check('2. owner: the line under the row says to type this part\'s own price', /Type this part's own price in Unit Cost/.test(note), note)
      await badge.evaluate(el => el.scrollIntoView({ block: 'center' })); await sleep(300)
      await shot(page, `2-${who}-inventory-from-black`)
      await page.close()
    }
  }

  // ── 3: the Salesman on a phone, Green then 5 ft ───────────────────────────
  if (want('3')) {
    const salesApi = await apiOf(phone)
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
    const q = await salesApi('POST', '/api/saved-quotes', { customerName: `${tag} Customer`, customerAddress: '100 Pecan Dr, Ocala, FL 34472', fenceStyle: 'WV-Auto ND Privacy', runs: [50], corners: 0, ends: 2, sections: 0, status: 'DRAFT', finalPrice: 0, date: today, salesRep: 'aud-sales' })
    made.quotes.push(q.id)
    // 390 x 844 (the check asked for) and 390 x 667 (the reviewer's C7 screen, where the Finish row sat under the bar).
    for (const [w, h] of [[390, 844], [390, 667]]) {
      const ctx = h === 844 ? phone : await mobile.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
      if (ctx !== phone) await signInByCookie(ctx, { cookie: SALES, api: API })
      const page = await ctx.newPage()
      const errs = []; page.on('pageerror', e => errs.push(String(e).slice(0, 200))); page.on('dialog', d => d.accept().catch(() => {}))
      await page.goto(`${APP}/quotes?quote=${q.id}`)
      const b = page.locator('[data-quote-builder]')
      await b.waitFor({ timeout: 60000 }); await sleep(2500)
      await b.locator('[data-step="style"]').click(); await sleep(800)
      await b.locator('[data-choice-material="chain"]').click(); await sleep(500)
      const four = b.locator('[data-choice-dim="height"][data-choice-key="4"]')
      if (await four.count()) { await four.click(); await sleep(300) }
      await b.locator('[data-choice-dim="finish"][data-choice-key="green"]').click(); await sleep(500)
      const scrollOf = () => page.evaluate(() => {
        const btn = document.querySelector('[data-choice-dim="height"][data-choice-key="5"]')
        let box = btn.parentElement
        while (box && !(/(auto|scroll)/.test(getComputedStyle(box).overflowY) && box.scrollHeight > box.clientHeight)) box = box.parentElement
        return Math.round(box ? box.scrollTop : window.scrollY)
      })
      // Where the note would sit without the scroll: the Finish row's bottom, against the bar.
      const finishBottom = await page.evaluate(() => Math.round(document.querySelector('[data-choice-dim="finish"]').getBoundingClientRect().bottom))
      const barTop0 = await page.evaluate(() => Math.round(document.querySelector('[data-quote-bar]').getBoundingClientRect().top))
      const before = await scrollOf()
      await shot(page, `3-salesman-phone-${h}-before-5ft-tap`)
      await b.locator('[data-choice-dim="height"][data-choice-key="5"]').tap(); await sleep(1200)
      const note = b.locator('[data-style-changed-note]')
      const text = (await note.count()) ? await note.innerText() : ''
      const pos = await page.evaluate(() => {
        const n = document.querySelector('[data-style-changed-note]')?.getBoundingClientRect()
        const bar = document.querySelector('[data-quote-bar]')?.getBoundingClientRect()
        return n && bar ? { top: Math.round(n.top), bottom: Math.round(n.bottom), barTop: Math.round(bar.top) } : null
      })
      const after = await scrollOf()
      check(`3. ${w}x${h}: Green, then 5 ft: the note says so`, /Green is not offered at 5 ft, so the finish changed to Galvanized/.test(text), text)
      check(`3. ${w}x${h}: the note is in sight, above the bottom bar`, !!pos && pos.top >= 0 && pos.bottom <= pos.barTop,
        `${JSON.stringify(pos)}; Finish row bottom was ${finishBottom}, bar top ${barTop0}; scrolled ${after - before} px`)
      await shot(page, `3-salesman-phone-${h}-green-5ft-note-above-bar`)
      check(`3. ${w}x${h}: no page errors`, errs.length === 0, errs.join(' | '))
      await page.close()
      if (ctx !== phone) await ctx.close()
    }
  }
} finally {
  try {
    for (const id of made.stages) {
      const l = await ownerApi('GET', '/api/ops-stages')
      if (l.stages.some(s => s.id === id)) await ownerApi('POST', `/api/ops-stages/${id}/delete`, { moveTo: 'awaiting_locates', baseVersion: l.version }).catch(e => console.log('cleanup stage', String(e).slice(0, 160)))
    }
    for (const id of made.jobs) await ownerApi('DELETE', `/api/saved-jobs/${id}`).catch(e => console.log('cleanup job', String(e).slice(0, 120)))
    for (const id of made.quotes) await ownerApi('DELETE', `/api/saved-quotes/${id}`).catch(e => console.log('cleanup quote', String(e).slice(0, 120)))
    const end = await ownerApi('GET', '/api/ops-stages')
    check('cleanup: the stage list is as it was (ids, names, order, flags)', shape(end) === shape(original))
  } catch (e) { console.log('cleanup', String(e).slice(0, 200)) }
  console.log(`CLEANUP-TAG ${tag}`)
  await desk.close(); await mobile.close()
}
const failed = results.filter(r => !r).length
console.log(`\n${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
