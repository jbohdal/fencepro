// Settings: the grouped side menu, the search, the save bar and leaving with
// unsaved changes. On a computer (1440 x 900) and a phone (390 x 844).
//
//   cd apps/web && pnpm -s build
//   E2E_ACCESS_TOKEN=<dev staff token> APP_URL=http://localhost:4001 API_URL=http://localhost:4001 \
//     SHOTS=<folder, optional> node e2e/settings-nav.mjs
//
// Dev only. Checks: the menu has the five groups and every page; the search
// finds a field (Short-run cutoff) and jumps to it; editing it shows the bar;
// Discard puts it back; Save keeps it after a reload; leaving with unsaved
// changes (the menu, the phone's Settings back button, the browser's Back)
// asks first and a No keeps the page and the edit; ?tab= deep links open the
// right page; Reset to defaults asks (cancelled: nothing changes); a page with
// its own list (Pipeline Stages) uses the same bar; phone numbers show as
// (352) 789 4314. The one setting it changes (Quote Optimizer, Short-run
// cutoff) is put back exactly as it was, and checked after a reload.
import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import './sharedLock.mjs' // tests that change shared dev data take turns
import { chromium, signInByCookie, APP, sleep } from './lib.mjs'

const SHOTS = process.env.SHOTS || ''
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }) }

const GROUPS = ['Company', 'Pricing & Products', 'Sales', 'Operations', 'Records']
const PAGES = ['company', 'warranties', 'contract_templates', 'email_templates', 'pricing', 'price_list', 'styles', 'tiers', 'moves', 'optimizer',
  'pipeline', 'leads', 'tags', 'follow_ups', 'appointments', 'messages', 'proposals', 'portal_quote', 'voice', 'ops_stages', 'walkthrough', 'calendar']
const fmtPhone = raw => { let d = String(raw ?? '').replace(/\D/g, ''); if (d.length === 11 && d.startsWith('1')) d = d.slice(1); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)} ${d.slice(6)}` : String(raw ?? '').trim() }

async function open(b, phone) {
  const ctx = await b.newContext(phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } })
  await signInByCookie(ctx)
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', e => errs.push(String(e).slice(0, 200)))
  // Dialogs: answered by `answer` (true = OK); every message is kept.
  const s = { ctx, page, errs, answer: true, dialogs: [] }
  page.on('dialog', d => { s.dialogs.push(d.message()); (s.answer ? d.accept() : d.dismiss()).catch(() => {}) })
  return s
}
const bar = page => page.locator('[data-settings-savebar]:has([data-settings-save])')
const shortRun = page => page.locator('[data-settings-page="optimizer"] [data-opt-short-run]')
const pageOpen = async (page, key) => page.locator(`[data-settings-page="${key}"]`).isVisible().catch(() => false)
const noSideScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)

const b = await chromium.launch()
let original = null
let restoreWith = null
try {
  for (const phone of [false, true]) {
    const who = phone ? 'phone' : 'computer'
    const s = await open(b, phone)
    const { page } = s
    restoreWith = s

    // ── The menu ──
    await page.goto(`${APP}/settings`)
    await page.waitForSelector('[data-settings-menu]', { timeout: 60000 }); await sleep(800)
    const groups = await page.$$eval('[data-settings-menu] h2', els => els.map(e => e.textContent.trim()))
    check(`${who}: the menu has the five groups`, GROUPS.every(g => groups.some(x => x.toLowerCase() === g.toLowerCase())), groups.join(' | '))
    const keys = await page.$$eval('[data-settings-tab]', els => els.map(e => e.getAttribute('data-settings-tab')))
    check(`${who}: every page is in the menu`, PAGES.every(k => keys.includes(k)), PAGES.filter(k => !keys.includes(k)).join(','))
    check(`${who}: each item has a one line description`, await page.$$eval('[data-settings-tab]', els => els.every(e => e.querySelectorAll('span span').length === 2 && e.querySelectorAll('span span')[1].textContent.trim().length > 5)))
    if (phone) {
      check('phone: /settings shows the list first (no page open)', await page.locator('[data-settings-tab="company"]').isVisible() && !(await page.locator('[data-settings-page]').count()))
    } else {
      check('computer: /settings opens Company next to the menu', await pageOpen(page, 'company') && await page.locator('[data-settings-tab="company"][aria-pressed="true"]').count() === 1)
    }
    check(`${who}: no sideways scroll`, await noSideScroll(page))
    await shot(page, `${who}-settings`)

    // ── Phone format and the address warning (Company) ──
    if (phone) { await page.locator('[data-settings-tab="company"]').click(); await page.waitForSelector('[data-settings-page="company"]'); await sleep(400) }
    const phoneShown = await page.locator('[data-company-phone]').inputValue()
    check(`${who}: the company phone is written like (352) 789 4314`, phoneShown === fmtPhone(phoneShown), phoneShown)
    const addr = await page.evaluate(() => [...document.querySelectorAll('[data-settings-page="company"] input')].map(i => i.value))
    const warn = await page.locator('[data-company-address-warning]').count()
    const streetEmpty = !(await page.locator('[data-settings-page="company"] label:text-is("Street Address") + input').inputValue()).trim()
    const cityEmpty = !(await page.locator('[data-settings-page="company"] label:text-is("City") + input').inputValue()).trim()
    const zipEmpty = !(await page.locator('[data-settings-page="company"] label:text-is("ZIP") + input').inputValue()).trim()
    check(`${who}: the address warning shows exactly when street, city or ZIP is empty`, (warn === 1) === (streetEmpty || cityEmpty || zipEmpty), `warning ${warn}, empty: street ${streetEmpty} city ${cityEmpty} zip ${zipEmpty} (${addr.length} fields)`)
    if (phone) { await page.locator('[data-settings-back]').click(); await page.waitForSelector('[data-settings-tab="company"]', { state: 'visible' }); await sleep(300) }
    if (phone) check('phone: Back returns to the list', await page.locator('[data-settings-tab="pricing"]').isVisible() && !(await page.locator('[data-settings-page]').count()))

    // ── Search finds a setting and jumps to it ──
    await page.locator('[data-settings-search]').fill('lead sources')
    check(`${who}: search by page name finds Lead Sources`, await page.locator('[data-settings-hit="leads"]').first().isVisible())
    await page.locator('[data-settings-search]').fill('zzqx')
    check(`${who}: a search that matches nothing says so`, /No setting matches/.test(await page.locator('[data-settings-results]').innerText()))
    await page.locator('[data-settings-search]').fill('short-run')
    await sleep(200)
    const hit = page.locator('[data-settings-hit="optimizer"]').first()
    check(`${who}: search "short-run" finds Short-run cutoff on Quote Optimizer`, await hit.isVisible() && /Short-run cutoff/.test(await hit.innerText()))
    await shot(page, `${who}-search`)
    await hit.click()
    await page.waitForSelector('[data-settings-page="optimizer"]', { timeout: 20000 }); await sleep(1200)
    check(`${who}: the pick opens Quote Optimizer (?tab=optimizer)`, page.url().includes('tab=optimizer'), page.url())
    const inView = await shortRun(page).evaluate(el => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight })
    const focused = await shortRun(page).evaluate(el => document.activeElement === el)
    check(`${who}: it jumps to the field (in view, cursor in it)`, inView && focused, `inView ${inView} focused ${focused}`)

    // ── Edit, the bar, Discard ──
    if (original === null) original = await shortRun(page).inputValue()
    const changed = String(Number(original) >= 12 ? Number(original) - 1 : Number(original) + 1)
    check(`${who}: no bar before an edit`, await bar(page).count() === 0)
    await shortRun(page).fill(changed); await sleep(300)
    check(`${who}: editing a field shows "Unsaved changes · Save · Discard"`, await bar(page).isVisible() && /Unsaved changes/.test(await bar(page).innerText()) && await page.locator('[data-settings-discard]').isVisible())
    await shot(page, `${who}-unsaved-bar`)
    await page.locator('[data-settings-discard]').click(); await sleep(300)
    check(`${who}: Discard puts the value back and hides the bar`, await shortRun(page).inputValue() === original && await bar(page).count() === 0, await shortRun(page).inputValue())

    // ── Leaving with unsaved changes asks ──
    await shortRun(page).fill(changed); await sleep(200)
    s.answer = false; s.dialogs.length = 0
    if (phone) await page.locator('[data-settings-back]').click()
    else await page.locator('[data-settings-tab="pricing"]').click()
    await sleep(600)
    check(`${who}: leaving by ${phone ? 'the Settings back button' : 'the menu'} asks first`, s.dialogs.some(m => /Leave without saving/.test(m)), s.dialogs.join(' / '))
    check(`${who}: No keeps the page and the edit`, await pageOpen(page, 'optimizer') && await shortRun(page).inputValue() === changed && page.url().includes('tab=optimizer'), page.url())
    s.dialogs.length = 0
    await page.goBack(); await sleep(900)
    check(`${who}: the browser's Back asks first too`, s.dialogs.some(m => /Leave without saving/.test(m)), s.dialogs.join(' / '))
    check(`${who}: No on Back stays on the page with the edit`, await pageOpen(page, 'optimizer') && await shortRun(page).inputValue() === changed, page.url())
    // Yes: leaves, and the edit is dropped.
    s.answer = true; s.dialogs.length = 0
    if (phone) await page.locator('[data-settings-back]').click()
    else await page.locator('[data-settings-tab="pricing"]').click()
    await sleep(900)
    check(`${who}: Yes leaves the page`, s.dialogs.length === 1 && !(await pageOpen(page, 'optimizer')), `${s.dialogs.length} dialogs, ${page.url()}`)
    await page.goto(`${APP}/settings?tab=optimizer`); await page.waitForSelector('[data-settings-page="optimizer"]', { timeout: 30000 }); await sleep(800)
    check(`${who}: the edit left behind was not saved`, await shortRun(page).inputValue() === original, await shortRun(page).inputValue())

    // ── Save persists after a reload ──
    await shortRun(page).fill(changed); await sleep(200)
    await page.locator('[data-settings-save]').click(); await sleep(2000)
    check(`${who}: after Save the bar goes away`, await bar(page).count() === 0)
    await page.reload(); await page.waitForSelector('[data-settings-page="optimizer"]', { timeout: 30000 }); await sleep(1200)
    check(`${who}: the saved value is there after a reload`, await shortRun(page).inputValue() === changed, await shortRun(page).inputValue())
    // Put it back exactly.
    await shortRun(page).fill(original); await sleep(200)
    await page.locator('[data-settings-save]').click(); await sleep(2000)
    await page.reload(); await page.waitForSelector('[data-settings-page="optimizer"]', { timeout: 30000 }); await sleep(1200)
    check(`${who}: put back to ${original}`, await shortRun(page).inputValue() === original, await shortRun(page).inputValue())

    // ── Reset asks to confirm (cancelled) ──
    s.answer = false; s.dialogs.length = 0
    await page.locator('[data-settings-reset]').click(); await sleep(400)
    check(`${who}: Reset to defaults asks first`, s.dialogs.some(m => /Reset Quote Optimizer/.test(m)), s.dialogs.join(' / '))
    check(`${who}: cancelled Reset changes nothing`, await shortRun(page).inputValue() === original && await bar(page).count() === 0)
    check(`${who}: no global Reset button any more`, await page.locator('button:text-is("Reset to defaults")').count() === 1 && await page.locator('[data-settings-reset]').count() === 1)
    await page.goto(`${APP}/settings?tab=company`); await page.waitForSelector('[data-settings-page="company"]', { timeout: 30000 }); await sleep(500)
    check(`${who}: a page without defaults has no Reset`, await page.locator('[data-settings-reset]').count() === 0)
    s.answer = true

    // ── A page with its own list uses the same bar (Pipeline Stages; discarded, never saved) ──
    await page.goto(`${APP}/settings?tab=pipeline`); await page.waitForSelector('[data-pipeline-stages-settings]', { timeout: 60000 }); await sleep(800)
    const nameBox = page.locator('[data-pipeline-stage-row] [data-pipeline-stage-name]').first()
    const was = await nameBox.inputValue()
    await nameBox.fill(`${was} test`); await sleep(300)
    check(`${who}: Pipeline Stages shows the same bar`, await bar(page).isVisible())
    await page.locator('[data-settings-discard]').click(); await sleep(400)
    check(`${who}: Discard puts the stage name back`, await nameBox.inputValue() === was && await bar(page).count() === 0, await nameBox.inputValue())

    // ── ?tab= deep links ──
    for (const k of ['leads', 'deleted', 'tiers', 'calendar', 'price_list', 'walkthrough']) {
      await page.goto(`${APP}/settings?tab=${k}`)
      await page.waitForSelector(`[data-settings-page="${k}"]`, { timeout: 60000 }).catch(() => {})
      check(`${who}: /settings?tab=${k} opens that page`, await pageOpen(page, k) && await page.locator(`[data-settings-tab="${k}"][aria-pressed="true"]`).count() === 1)
    }
    // Opening a page and changing nothing never shows the bar (no false "Unsaved changes").
    if (!phone) {
      const falseAlarms = []
      for (const k of [...PAGES, 'change_log', 'deleted']) {
        await page.goto(`${APP}/settings?tab=${k}`)
        await page.waitForSelector(`[data-settings-page="${k}"]`, { timeout: 60000 }).catch(() => {})
        await sleep(1500)
        if (await bar(page).count()) falseAlarms.push(k)
      }
      check('computer: no page shows the bar before anything is changed', falseAlarms.length === 0, falseAlarms.join(','))
    }
    await page.goto(`${APP}/settings?settings=calendar`); await page.waitForSelector('[data-settings-page="calendar"]', { timeout: 30000 }).catch(() => {})
    check(`${who}: the older ?settings=calendar link still opens Google Calendar`, await pageOpen(page, 'calendar'))
    await page.goto(`${APP}/settings?tab=pricing&focus=sub-rates`); await sleep(2500)
    check(`${who}: ?focus=sub-rates still scrolls to Subcontractor rates`, await page.locator('[data-settings-focus="sub-rates"]').evaluate(el => { const r = el.getBoundingClientRect(); return r.top >= -5 && r.top < window.innerHeight }))
    check(`${who}: no sideways scroll on a page`, await noSideScroll(page))
    check(`${who}: no page errors`, s.errs.length === 0, s.errs.join(' | '))
    await s.ctx.close()
    restoreWith = null
  }
} catch (e) {
  check('ran to the end', false, String(e).slice(0, 300))
  // Put the one changed setting back if the run stopped half way.
  if (restoreWith && original !== null) {
    try {
      const { page } = restoreWith
      restoreWith.answer = true
      await page.goto(`${APP}/settings?tab=optimizer`); await page.waitForSelector('[data-settings-page="optimizer"]', { timeout: 30000 }); await sleep(800)
      if (await shortRun(page).inputValue() !== original) { await shortRun(page).fill(original); await page.locator('[data-settings-save]').click(); await sleep(2000) }
      console.log('put back Short-run cutoff to', original)
    } catch (e2) { console.log('COULD NOT PUT BACK Short-run cutoff to', original, String(e2).slice(0, 200)) }
  }
}
await b.close()
const failed = results.filter(r => !r).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
