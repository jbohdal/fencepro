// Budget page: editing numbers, on the dev copy only.
//
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 E2E_ACCESS_TOKEN=<dev owner token> \
//     [SIZES=iphone,phone360,desktop] [SHOTS=<folder>] node e2e/budget-edit.mjs
//
// On an iPhone (WebKit, 390 x 844), a small phone (Chromium, 360 x 780) and a
// computer (Chromium, 1440 x 900), signed in as the owner, on Budget:
//   - every number box is at least 44 px tall, its label is on screen, uses the
//     decimal keypad (inputMode decimal), and the page does not scroll sideways;
//   - tapping a box selects the whole number (bare digits, no "$" or commas);
//     typing replaces it, one key at a time with no reformatting, no cursor jump
//     and no lost focus; Backspace works; "$", commas only after leaving the box;
//     the first key comes right after the tap (no wait), on the 360 phone with
//     the processor slowed 6 times, and a burst typed at once loses no key;
//   - Enter and Tab move to the next box; leaving saves once ("Saved" shows);
//   - the budget plan's margin (overhead + profit), the bucket total, the overhead and labor totals and the
//     % of revenue follow right away;
//   - Undo puts the last change back (and saves that);
//   - "$1,234.50" pasted into an overhead line is $1,234.50; its monthly box
//     follows, and a monthly amount typed sets the yearly one (× 12);
//   - after a reload the numbers are still there.
// The budget is put back exactly as it was at the end (also if a check fails).
import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import { APP, API, signInByCookie, sleep, reporter } from './lib.mjs'
import { chromium, webkit, devices } from 'playwright'
import fs from 'fs'

const SHOTS = process.env.SHOTS || process.env.E2E_SHOTS || ''
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })
const ONLY = (process.env.SIZES || '').split(',').map(s => s.trim()).filter(Boolean)
const { check, finish } = reporter()
const H = { 'X-Staff-Request': '1', 'Content-Type': 'application/json' }
const MONTHS3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const SIZES = [
  { name: 'iphone', engine: webkit, opts: { ...devices['iPhone 13'] }, phone: true },
  // A busy phone: the processor slowed 6 times (THROTTLE=1 for full speed).
  { name: 'phone360', engine: chromium, opts: { viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, phone: true, throttle: Number(process.env.THROTTLE || 6) },
  { name: 'desktop', engine: chromium, opts: { viewport: { width: 1440, height: 900 } }, phone: false },
].filter(s => !ONLY.length || ONLY.includes(s.name))

// ── The saved budget, read and put back through the API ──
async function readBudget(req) {
  const r = await req.get(`${API}/api/business-state`, { headers: H })
  const j = await r.json()
  return { budget: j.data?.budget, version: j.data?.version }
}
async function putBack(req, budget) {
  for (let i = 0; i < 4; i++) {
    const { version } = await readBudget(req)
    const r = await req.patch(`${API}/api/business-state`, { headers: H, data: { budget, baseVersion: version } })
    if (r.ok()) return true
    await sleep(400)
  }
  return false
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// ── In the page ──
const box = (page, field) => page.locator(`input[data-budget-field="${field}"]:visible`).first()
const state = el => el.evaluate(i => ({ value: i.value, start: i.selectionStart, end: i.selectionEnd, focused: document.activeElement === i, field: document.activeElement?.getAttribute('data-budget-field') }))
const focusedField = page => page.evaluate(() => document.activeElement?.getAttribute('data-budget-field') ?? document.activeElement?.tagName)
const text = async (page, sel) => ((await page.locator(`${sel}:visible`).first().textContent()) ?? '').trim()

// No wait after the tap: the first key comes as fast as a person on a busy
// phone could type it (the select-all must already be there, and the key must
// not be lost to a late one).
async function tapBox(s, el) {
  await el.scrollIntoViewIfNeeded()
  if (s.phone) await el.tap(); else await el.click()
}

/** Types one key at a time; after each, the box shows exactly what was typed, the cursor at its end, still focused. */
async function typeSlowly(page, el, keys) {
  let jumps = 0, shown = ''
  for (let i = 0; i < keys.length; i++) {
    await page.keyboard.type(keys[i])
    await sleep(40)
    const st = await state(el)
    const want = keys.slice(0, i + 1)
    if (st.value !== want || st.start !== want.length || st.end !== want.length || !st.focused) { jumps++; shown = `after "${want}": box "${st.value}", cursor ${st.start}-${st.end}, focused ${st.focused}` }
  }
  return { jumps, shown }
}

async function waitSaved(page, ms = 15000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const st = await page.locator('[data-budget-save]').first().getAttribute('data-budget-save').catch(() => null)
    if (st === 'saved') return true
    await sleep(150)
  }
  return false
}

async function openTab(s, name) {
  const b = s.page.locator(`button:text-is("${name}")`).first()
  if (s.phone) await b.tap(); else await b.click()
  await sleep(400)
}

async function shot(s, label) {
  if (SHOTS) await s.page.screenshot({ path: `${SHOTS}/budget-edit-${s.name}-${label}.png` })
}

/** Boxes on screen: 44 px tall, decimal keypad, inside the screen, the page not scrolling sideways. */
async function fitCheck(s, where) {
  const r = await s.page.evaluate(() => {
    const W = innerWidth
    const boxes = [...document.querySelectorAll('input[data-number-field]')].filter(i => i.offsetParent !== null)
    const short = boxes.filter(i => i.getBoundingClientRect().height < 44).map(i => i.getAttribute('data-budget-field') || i.id)
    const keypad = boxes.filter(i => i.inputMode !== 'decimal' || i.type !== 'text').map(i => i.getAttribute('data-budget-field') || i.id)
    const off = boxes.filter(i => { const b = i.getBoundingClientRect(); return b.right > W + 1 || b.left < -1 }).map(i => i.getAttribute('data-budget-field') || i.id)
    const labels = [...document.querySelectorAll('label[for]')].filter(l => l.offsetParent !== null && document.getElementById(l.htmlFor)?.hasAttribute('data-number-field'))
      .filter(l => { const b = l.getBoundingClientRect(); return b.right > W + 1 || b.left < -1 || b.width < 4 }).map(l => l.textContent)
    return { n: boxes.length, short, keypad, off, labels, sideways: document.scrollingElement.scrollWidth - W }
  })
  check(`${s.name} ${where}: ${r.n} number boxes, each at least 44 px tall`, r.n > 0 && r.short.length === 0, r.short.slice(0, 5).join(', '))
  check(`${s.name} ${where}: decimal keypad on every box`, r.keypad.length === 0, r.keypad.slice(0, 5).join(', '))
  check(`${s.name} ${where}: every box and its label on screen, no sideways scroll`, r.off.length === 0 && r.labels.length === 0 && r.sideways <= 0, `off: ${r.off.slice(0, 4).join(', ')} labels: ${r.labels.join(', ')} sideways ${r.sideways}px`)
}

async function run(s, original) {
  const { page } = s
  await page.goto(`${APP}/budget`)
  await page.waitForSelector('text=Budget & Planning', { timeout: 30000 })
  await page.waitForSelector('input[data-budget-field="revenueGoal"]', { timeout: 30000 })
  await sleep(800)
  await shot(s, '1-budget')
  await fitCheck(s, 'Budget tab')

  const goal = box(page, 'revenueGoal')
  const goalShown = await goal.inputValue()
  const origGoal = Math.round(original.revenueGoal ?? 613000)
  check(`${s.name}: revenue goal shown with "$" and commas when not typed in`, goalShown === `$${origGoal.toLocaleString('en-US')}`, goalShown)

  // Tap: the bare number, all of it selected.
  await tapBox(s, goal)
  let st = await state(goal)
  check(`${s.name}: tapping the revenue goal selects the whole bare number`, st.value === String(origGoal) && st.start === 0 && st.end === st.value.length, JSON.stringify(st))

  // Type over it, one key at a time; Backspace takes the last digit off.
  let t = await typeSlowly(page, goal, '7000001')
  check(`${s.name}: typing 7000001 over it: no reformatting, cursor jump or lost focus`, t.jumps === 0, t.shown)
  await page.keyboard.press('Backspace')
  st = await state(goal)
  check(`${s.name}: Backspace takes off one digit`, st.value === '700000' && st.start === 6, JSON.stringify(st))
  const stat0 = await text(page, '[data-budget-stat="Overhead (budget)"]')
  const pctBefore = await page.locator('[data-budget-stat="Overhead (budget)"]').first().evaluate(e => e.parentElement.lastElementChild.textContent)

  // Enter: saved, formatted, and on to the next box.
  await page.keyboard.press('Enter')
  await sleep(200)
  check(`${s.name}: Enter moves to the next box (Overhead target)`, (await focusedField(page)) === 'overheadPct', await focusedField(page))
  check(`${s.name}: the revenue goal shows $700,000 once left`, (await goal.inputValue()) === '$700,000', await goal.inputValue())
  check(`${s.name}: "Saved" shows after the revenue goal`, await waitSaved(page))
  const pctAfter = await page.locator('[data-budget-stat="Overhead (budget)"]').first().evaluate(e => e.parentElement.lastElementChild.textContent)
  const overheadDollars = Number(stat0.replace(/[$,]/g, ''))
  const wantPct = `${(overheadDollars / 700000 * 100).toFixed(1)}%`
  check(`${s.name}: overhead % of revenue follows the goal right away`, pctAfter.startsWith(wantPct) && pctAfter !== pctBefore, `${pctBefore} → ${pctAfter}, want ${wantPct}`)

  // Overhead target: the next box is already selected; "25." keeps its point while typing.
  const oh = box(page, 'overheadPct')
  st = await state(oh)
  const origOh = Math.round((original.overheadPct ?? 0.24) * 10000) / 100
  check(`${s.name}: the box Enter moved to has its number selected`, st.focused && st.value === String(origOh) && st.start === 0 && st.end === st.value.length, JSON.stringify(st))
  t = await typeSlowly(page, oh, '25.5')
  check(`${s.name}: typing 25.5 keeps the decimal point (no reformat mid-typing)`, t.jumps === 0, t.shown)
  await page.keyboard.press('Tab')
  await sleep(200)
  check(`${s.name}: Tab moves to the next box (Labor target)`, (await focusedField(page)) === 'laborPct', await focusedField(page))
  check(`${s.name}: Overhead target shows 25.5% once left`, (await oh.inputValue()) === '25.5%', await oh.inputValue())
  const np = Math.round((original.netProfitPct ?? 0.106) * 1000) / 10
  const lab = Math.round((original.laborPct ?? 0.214) * 1000) / 10, mat = Math.round((original.materialsPct ?? 0.44) * 1000) / 10
  check(`${s.name}: the budget plan's margin follows right away (25.5% + profit)`, (await text(page, '[data-budget-plan-margin]')) === `${(25.5 + np).toFixed(1)}%`, await text(page, '[data-budget-plan-margin]'))
  check(`${s.name}: the bucket total follows right away`, (await text(page, '[data-budget-bucket-total]')) === `${Math.round((25.5 + lab + mat + np) * 10) / 10}%`, await text(page, '[data-budget-bucket-total]'))
  check(`${s.name}: "Saved" shows after the overhead target`, await waitSaved(page))
  await shot(s, '2-saved')

  // Undo the last change (the overhead target).
  const undo = page.locator('[data-budget-undo]').first()
  check(`${s.name}: Undo is offered for the last change`, await undo.isVisible())
  if (s.phone) await undo.tap(); else await undo.click()
  await sleep(250)
  check(`${s.name}: Undo puts the overhead target back`, (await oh.inputValue()) === `${origOh}%`, await oh.inputValue())
  check(`${s.name}: the budget plan's margin back too`, (await text(page, '[data-budget-plan-margin]')) === `${(origOh + np).toFixed(1)}%`, await text(page, '[data-budget-plan-margin]'))
  check(`${s.name}: the undo is saved`, await waitSaved(page))
  check(`${s.name}: Undo left the revenue goal alone`, (await goal.inputValue()) === '$700,000', await goal.inputValue())

  // Escape puts the old number back without saving.
  await tapBox(s, oh)
  await page.keyboard.type('99')
  await page.keyboard.press('Escape')
  await sleep(150)
  check(`${s.name}: Escape puts the old number back`, (await oh.inputValue()) === `${origOh}%`, await oh.inputValue())

  // Not a number: refused, the old one kept.
  await tapBox(s, oh)
  await page.keyboard.type('-')
  await page.keyboard.press('Tab')
  await sleep(150)
  check(`${s.name}: "-" is refused and the old number kept`, (await oh.inputValue()) === `${origOh}%` && (await oh.getAttribute('aria-invalid')) === 'true', `${await oh.inputValue()} invalid=${await oh.getAttribute('aria-invalid')}`)

  // ── Overhead: paste, yearly ⇄ monthly ──
  await openTab(s, 'Overhead')
  await fitCheck(s, 'Overhead tab')
  await shot(s, '3-overhead')
  const leaf = (original.overhead ?? []).find(o => !o.parentId && !(original.overhead ?? []).some(c => c.parentId === o.id) && o.annual > 0)
  const yearly = box(page, `overhead-${leaf.id}-annual`), monthly = box(page, `overhead-${leaf.id}-monthly`)
  const total0 = Number((await text(page, '[data-budget-overhead-total]')).replace(/[$,]/g, ''))
  await tapBox(s, yearly)
  st = await state(yearly)
  check(`${s.name}: tapping ${leaf.label} yearly selects it all`, st.start === 0 && st.end === st.value.length && st.value === String(leaf.annual), JSON.stringify(st))
  // A real paste on Chromium; WebKit pastes as one piece of text (no clipboard in a test browser).
  let how = 'pasted as one piece of text'
  if (s.engine === chromium) {
    await page.evaluate(() => navigator.clipboard.writeText('$1,234.50'))
    await page.keyboard.press('ControlOrMeta+V')
    await sleep(100)
    if ((await yearly.inputValue()) === '$1,234.50') how = 'real paste from the clipboard'
  }
  if (how !== 'real paste from the clipboard') { await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.insertText('$1,234.50') }
  await sleep(100)
  console.log(`      (${s.name}: ${how})`)
  check(`${s.name}: pasted "$1,234.50" stays as pasted while in the box`, (await yearly.inputValue()) === '$1,234.50', await yearly.inputValue())
  await page.keyboard.press('Enter')
  await sleep(250)
  check(`${s.name}: pasted amount saved as $1,234.50`, (await yearly.inputValue()) === '$1,234.50', await yearly.inputValue())
  st = await state(monthly)
  check(`${s.name}: Enter moves to the monthly box, which follows (1234.50 ÷ 12 = 102.88), selected`, st.focused && st.value === '102.88' && st.start === 0 && st.end === 6, JSON.stringify(st))
  const total1 = Number((await text(page, '[data-budget-overhead-total]')).replace(/[$,]/g, ''))
  check(`${s.name}: overhead total follows right away`, Math.round(total1) === Math.round(total0 - leaf.annual + 1234.5), `${total0} → ${total1}`)
  check(`${s.name}: "Saved" after the paste`, await waitSaved(page))
  t = await typeSlowly(page, monthly, '500')
  check(`${s.name}: typing 500 in the monthly box: no jumps`, t.jumps === 0, t.shown)
  await page.keyboard.press('Tab')
  await sleep(250)
  check(`${s.name}: a monthly $500 sets the yearly to $6,000`, (await yearly.inputValue()) === '$6,000' && (await monthly.inputValue()) === '$500', `${await yearly.inputValue()} / ${await monthly.inputValue()}`)
  check(`${s.name}: "Saved" after the monthly`, await waitSaved(page))
  await shot(s, '4-overhead-linked')

  // ── Crew: rate × hours ──
  await openTab(s, 'Crew & Labor')
  await fitCheck(s, 'Crew tab')
  const emp = (original.employees ?? [])[0]
  if (emp) {
    const rate = box(page, `employee-${emp.id}-rate`)
    await tapBox(s, rate)
    t = await typeSlowly(page, rate, '26.75')
    check(`${s.name}: typing 26.75 in $ an hour: no jumps`, t.jumps === 0, t.shown)
    await page.keyboard.press('Enter')
    await sleep(250)
    check(`${s.name}: Enter moves from $ an hour to hours a year`, (await focusedField(page)) === `employee-${emp.id}-hours`, await focusedField(page))
    const want = `$${Math.round(26.75 * emp.annualHours).toLocaleString('en-US')}`
    check(`${s.name}: yearly cost follows right away (26.75 × ${emp.annualHours})`, (await text(page, `[data-budget-employee-annual="${emp.id}"]`)) === want, `${await text(page, `[data-budget-employee-annual="${emp.id}"]`)} want ${want}`)
    check(`${s.name}: "Saved" after the rate`, await waitSaved(page))
    await shot(s, '5-crew')
  }

  // ── Historic: a month and its year total ──
  await openTab(s, 'Historic Revenue')
  await fitCheck(s, 'Historic tab')
  const year = (original.historic ?? [])[0]
  if (year) {
    const jan = box(page, `historic-${year.year}-0`)
    await tapBox(s, jan)
    t = await typeSlowly(page, jan, '12345')
    check(`${s.name}: typing in Jan ${year.year}: no jumps`, t.jumps === 0, t.shown)
    await page.keyboard.press('Enter')
    await sleep(250)
    check(`${s.name}: Enter moves from Jan to Feb ${year.year}`, (await focusedField(page)) === `historic-${year.year}-1`, await focusedField(page))
    const want = `$${(year.months.reduce((a, b) => a + b, 0) - year.months[0] + 12345).toLocaleString('en-US')}`
    check(`${s.name}: the ${year.year} total follows right away`, (await text(page, `[data-budget-historic-total="${year.year}"]`)) === want, `${await text(page, `[data-budget-historic-total="${year.year}"]`)} want ${want}`)
    check(`${s.name}: "Saved" after Jan`, await waitSaved(page))
    await page.keyboard.press('Escape')
    // A burst right after the tap (no look at the box in between): every key lands, the old number is gone.
    for (const mi of [2, 3, 4]) {
      const m = box(page, `historic-${year.year}-${mi}`)
      await tapBox(s, m)
      await page.keyboard.type('987')
      const v = await m.inputValue()
      check(`${s.name}: tap ${MONTHS3[mi]} and type 987 at once: the box is "987"`, v === '987', `box "${v}"`)
      await page.keyboard.press('Escape')
    }
  }

  // ── Reload: the numbers stuck ──
  await sleep(500)
  const saved = (await readBudget(s.ctx.request)).budget
  check(`${s.name}: the server has every change`, saved.revenueGoal === 700000 && saved.overhead.find(o => o.id === leaf.id)?.annual === 6000 && (!emp || saved.employees.find(e => e.id === emp.id)?.hourlyRate === 26.75) && (!year || saved.historic[0].months[0] === 12345) && saved.overheadPct === original.overheadPct,
    JSON.stringify({ goal: saved.revenueGoal, line: saved.overhead.find(o => o.id === leaf.id)?.annual, rate: saved.employees?.[0]?.hourlyRate, jan: saved.historic?.[0]?.months?.[0], oh: saved.overheadPct }))
  await page.reload()
  await page.waitForSelector('input[data-budget-field="revenueGoal"]', { timeout: 30000 })
  await sleep(600)
  check(`${s.name}: after a reload the revenue goal is $700,000`, (await box(page, 'revenueGoal').inputValue()) === '$700,000', await box(page, 'revenueGoal').inputValue())
  await openTab(s, 'Overhead')
  check(`${s.name}: after a reload ${leaf.label} is $6,000 a year, $500 a month`, (await yearly.inputValue()) === '$6,000' && (await monthly.inputValue()) === '$500', `${await yearly.inputValue()} / ${await monthly.inputValue()}`)
  if (emp) {
    await openTab(s, 'Crew & Labor')
    check(`${s.name}: after a reload the rate is $26.75`, (await box(page, `employee-${emp.id}-rate`).inputValue()) === '$26.75', await box(page, `employee-${emp.id}-rate`).inputValue())
  }
  await openTab(s, 'Budget')
  await shot(s, '6-after-reload')
}

let original = null
const browsers = []
// One signed in context for the API reads and the putting back, open to the end.
const apiBrowser = await chromium.launch()
browsers.push(apiBrowser)
const apiCtx = await apiBrowser.newContext()
await signInByCookie(apiCtx)
const api = apiCtx.request
try {
  original = (await readBudget(api)).budget
  check('the saved budget was read first (to put it back after)', !!original && Array.isArray(original.overhead) && original.overhead.length > 0)
  if (original?.overhead?.length) {
    // The saved budget has no crew (live has none either, Oct 31 2026), so the Crew tab has no number boxes to check:
    // the test adds one made-up team member to its working copy of the budget, and puts the real budget back after.
    const working = (original.employees ?? []).length ? original
      : { ...original, employees: [{ id: 'e2e-budget-crew', name: 'E2E Crew', role: 'Installer', hourlyRate: 20, annualHours: 2040 }] }
    for (const s of SIZES) {
      if (working !== original) check(`${s.name}: a test team member added to the budget for the Crew tab`, await putBack(api, working))
      const browser = await s.engine.launch()
      browsers.push(browser)
      const ctx = await browser.newContext(s.opts)
      if (s.engine === chromium) await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: APP })
      await signInByCookie(ctx)
      const page = await ctx.newPage()
      if (s.throttle > 1) {
        const cdp = await ctx.newCDPSession(page)
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: s.throttle })
        console.log(`      (${s.name}: processor slowed ${s.throttle} times)`)
      }
      const errors = []
      page.on('pageerror', e => errors.push(String(e).slice(0, 200)))
      page.on('dialog', d => d.dismiss().catch(() => {}))
      try { await run({ ...s, ctx, page }, working) } catch (e) {
        check(`${s.name}: ran to the end`, false, String(e).split('\n')[0].slice(0, 300))
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/budget-edit-${s.name}-FAILED.png` }).catch(() => {})
      }
      check(`${s.name}: no errors on the page`, errors.length === 0, errors.join(' | '))
      await ctx.close()
      // Back as it was before the next size.
      const ok = await putBack(api, original)
      check(`${s.name}: budget put back`, ok && same((await readBudget(api)).budget, original))
    }
  }
} finally {
  if (original) {
    try {
      if (!same((await readBudget(api)).budget, original)) await putBack(api, original)
      check('the budget is exactly as it was before the test', same((await readBudget(api)).budget, original))
    } catch (e) { check('the budget is exactly as it was before the test', false, String(e)) }
  }
  for (const b of browsers) await b.close().catch(() => {})
}
process.exit(finish())
