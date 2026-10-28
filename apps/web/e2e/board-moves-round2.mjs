// The Operations board moves, round 2 (Oct 28 2026), used as the office would, on a dev server:
//
//   APP_URL=http://localhost:4092 E2E_STAFF_COOKIE=<office cookie> OWNER_COOKIE=<owner cookie> \
//   DRAWN_JOB=<id> REPAIR_JOB=<id> ORDER_NAME="Testy Board2 Drawn" SHOTS=<dir> node e2e/board-moves-round2.mjs
//
// A drawn new fence job in Awaiting Locates: the office enters its 811 locate (Clear to dig) and an Approved
// permit; it waits in Need Drawing with "Drawn: order materials" (never Materials Ordered with nothing ordered).
// Advance to Materials Ordered asks first. Its Sales Order marked Ordered: Materials Ordered. Advance to Ready to
// Pull asks first (ordered, not received). Marked Received: Ready to Pull. Each move in the job's history.
// Then the owner adds "  ready to SCHEDULE " in Settings > Operations Stages (+ Add stage puts it after Paid:
// the note offers "Put it before Scheduled"), and a repair whose locate clears goes there.
// Screenshots to SHOTS. Leaves the stage in place (the caller removes it with the test jobs).

import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import { chromium } from 'playwright'
import { signInByCookie } from './lib.mjs'

const APP = process.env.APP_URL
const DRAWN = process.env.DRAWN_JOB, REPAIR = process.env.REPAIR_JOB
const SHOTS = process.env.SHOTS
const ORDER_NAME = process.env.ORDER_NAME || 'Testy Board2 Drawn'
if (!APP || !DRAWN || !REPAIR || !SHOTS) { console.error('Set APP_URL, DRAWN_JOB, REPAIR_JOB, SHOTS.'); process.exit(2) }

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const fl = d => d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
const today = fl(new Date()), exp = fl(new Date(Date.now() + 28 * 86_400_000))
let n = 0
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${String(++n).padStart(2, '0')}-${name}.png` })

async function session(cookie) {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await signInByCookie(ctx, { api: APP, cookie })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 300)))
  const dialogs = []
  // The answer to the next question: false = Cancel.
  let answer = true
  page.on('dialog', d => { dialogs.push(d.message()); (answer ? d.accept() : d.dismiss()).catch(() => {}) })
  return { browser, ctx, page, errors, dialogs, setAnswer: a => { answer = a } }
}

const jobOf = async (ctx, id) => ((await (await ctx.request.get(`${APP}/api/saved-jobs`)).json()).data).find(j => j.id === id)
const pill = page => page.locator('[data-job-panel] [data-ops-stage-pill]').first()

async function openJob(page, id) {
  await page.goto(`${APP}/operations?job=${id}`)
  await page.locator(`[data-job-panel="${id}"]`).waitFor({ timeout: 60000 })
  await sleep(1200)
}

async function saveLocate(page) {
  await page.locator('[data-locate-edit]').click()
  await page.locator('[data-locate-input="ticket"]').fill('302610280417')
  await page.locator('[data-locate-input="called"]').fill(today)
  await page.locator('[data-locate-input="good"]').fill(today)
  await page.locator('[data-locate-input="exp"]').fill(exp)
  await page.locator('[data-locate-save]').click()
  await sleep(2500)
}

async function markOrder(page, status) {
  await page.goto(`${APP}/inventory`)
  await page.locator('[data-inventory-tab="sales_orders"]').click()
  await sleep(1200)
  await page.locator(`button:has-text("${ORDER_NAME}")`).first().click()
  await sleep(600)
  await page.locator(`button:text-is("${status === 'ordered' ? 'Mark Ordered' : 'Mark Received'}")`).click()
  await sleep(3000)
}

async function board(page, name) {
  await page.goto(`${APP}/operations`)
  await page.locator(`text=${name}`).first().waitFor({ timeout: 60000 })
  await sleep(1500)
}

async function history(page) {
  const t = await page.locator('[data-job-panel]').innerText()
  return t.split('\n').filter(l => /by itself/.test(l))
}

// ── The drawn job, as the office ──
{
  const s = await session(process.env.E2E_STAFF_COOKIE)
  const { page, ctx } = s
  try {
    await board(page, 'Testy Board2 Drawn')
    await shot(page, 'board-drawn-job-awaiting-locates')
    await openJob(page, DRAWN)
    check('drawn job starts in Awaiting Locates', (await pill(page).innerText()).trim() === 'Awaiting Locates')

    await saveLocate(page)
    await page.locator('[data-job-locate]').first().scrollIntoViewIfNeeded().catch(() => {})
    await shot(page, 'drawn-locate-clear-permit-pending')
    check('locate Clear to dig → Permit Pending', (await jobOf(ctx, DRAWN))?.opsStage === 'permit_pending')

    await page.locator('[data-permit-status]').selectOption('approved')
    await page.locator('[data-permit-save]').click()
    await sleep(3000)
    await openJob(page, DRAWN)
    const j = await jobOf(ctx, DRAWN)
    check('permit Approved → Need Drawing (not Materials Ordered), nothing ordered', j?.opsStage === 'need_drawing' && j?.materialsStatus === 'not_ordered', `${j?.opsStage} ${j?.materialsStatus}`)
    check('the job window says Need Drawing', (await pill(page).innerText()).trim() === 'Need Drawing')
    const h1 = await history(page)
    check('history says it is drawn and when it moves on', h1.some(l => /Moved to Need Drawing by itself: permit is Approved\. Already drawn: it moves to Materials Ordered when its Sales Order is marked Ordered\./.test(l)), h1.join(' | '))
    await page.locator('[data-job-panel]').getByText('Readiness Signals').first().scrollIntoViewIfNeeded().catch(() => {})
    await shot(page, 'drawn-need-drawing-window-history')

    // Advance to Materials Ordered asks first; Cancel leaves it.
    s.setAnswer(false)
    const adv = page.locator('[data-ops-advance]')
    check('Advance offers Materials Ordered', /Advance to Materials Ordered/.test(await adv.innerText()), await adv.innerText())
    await adv.click()
    await sleep(1200)
    check('Advance to Materials Ordered asks first (not ordered yet)', /materials are not ordered yet\. Moving it to Materials Ordered records them as Ordered/.test(s.dialogs.at(-1) || ''), s.dialogs.at(-1))
    check('Cancel: it stays in Need Drawing', (await jobOf(ctx, DRAWN))?.opsStage === 'need_drawing')
    s.setAnswer(true)

    await board(page, 'Testy Board2 Drawn')
    const card = page.locator('[data-ops-card-drawn]').first()
    check('the card says "Drawn: order materials"', (await card.count()) > 0 && /Drawn: order materials/.test(await card.innerText()))
    await card.scrollIntoViewIfNeeded()
    await shot(page, 'board-drawn-card-in-need-drawing')

    // Sales Order Ordered.
    await markOrder(page, 'ordered')
    await shot(page, 'sales-order-marked-ordered')
    const o = await jobOf(ctx, DRAWN)
    check('Sales Order Ordered → Materials Ordered', o?.opsStage === 'materials_ordered' && o?.materialsStatus === 'ordered', `${o?.opsStage} ${o?.materialsStatus}`)
    await openJob(page, DRAWN)
    check('the job window says Materials Ordered', (await pill(page).innerText()).trim() === 'Materials Ordered')
    check('history: moved to Materials Ordered by the order', (await history(page)).some(l => /Moved to Materials Ordered by itself: materials ordered \(Sales Order marked Ordered\) and the drawing is done\./.test(l)))

    // Advance to Ready to Pull asks (ordered, not received); Cancel leaves it.
    s.setAnswer(false)
    await page.locator('[data-ops-advance]').click()
    await sleep(1200)
    check('Advance to Ready to Pull asks first (ordered, not received)', /materials are ordered, not received yet\. Moving it to Ready to Pull records them as Received/.test(s.dialogs.at(-1) || ''), s.dialogs.at(-1))
    const still = await jobOf(ctx, DRAWN)
    check('Cancel: still Materials Ordered, materials still Ordered', still?.opsStage === 'materials_ordered' && still?.materialsStatus === 'ordered')
    s.setAnswer(true)
    await shot(page, 'drawn-materials-ordered-window')

    await markOrder(page, 'received')
    const r = await jobOf(ctx, DRAWN)
    check('Sales Order Received → Ready to Pull', r?.opsStage === 'ready_to_pull' && r?.materialsStatus === 'received', `${r?.opsStage} ${r?.materialsStatus}`)
    await openJob(page, DRAWN)
    const h = await history(page)
    check('history has every move, in order', h.length >= 4, h.join(' | '))
    await page.locator('[data-job-panel]').getByText('Job history').first().scrollIntoViewIfNeeded().catch(() => {})
    await shot(page, 'drawn-ready-to-pull-history')
    check('office: no page errors', s.errors.length === 0, s.errors.join(' | '))
  } finally { await s.browser.close() }
}

// ── Ready to Schedule, added by the owner ──
{
  const s = await session(process.env.OWNER_COOKIE)
  const { page } = s
  try {
    await page.goto(`${APP}/settings?tab=ops_stages`)
    await page.locator('[data-ops-stages-settings]').waitFor({ timeout: 60000 })
    await sleep(800)
    await page.locator('[data-ops-stage-add]').click()
    const added = page.locator('[data-ops-stage-row^="stage_"]').last()
    await added.locator('[data-ops-stage-name]').fill('  ready to SCHEDULE ')
    await sleep(300)
    const note = added.locator('[data-ready-to-schedule-note]')
    check('added at the end: the note says it is not before Scheduled and offers to put it there', (await note.getAttribute('data-ready-to-schedule-note')) === 'move' && /Put it before Scheduled/.test(await note.innerText()), await note.innerText())
    await added.scrollIntoViewIfNeeded()
    await shot(page, 'settings-ready-to-schedule-added-at-end')
    await added.locator('[data-ready-to-schedule-move]').click()
    await sleep(300)
    const moved = page.locator('[data-ops-stage-row^="stage_"]').filter({ has: page.locator('[data-ready-to-schedule-note]') }).first()
    check('after the button: the note says repairs move here', (await moved.locator('[data-ready-to-schedule-note]').getAttribute('data-ready-to-schedule-note')) === 'ok')
    const rows = await page.locator('[data-ops-stage-row]').evaluateAll(els => els.map(e => e.getAttribute('data-ops-stage-row')))
    const at = rows.findIndex(r => r.startsWith('stage_'))
    check('it sits between Ready to Pull and Scheduled', rows[at - 1] === 'ready_to_pull' && rows[at + 1] === 'scheduled', rows.join(','))
    await page.locator('[data-ops-stages-save]').click()
    await sleep(2000)
    await moved.scrollIntoViewIfNeeded()
    await shot(page, 'settings-ready-to-schedule-saved')
    check('owner: no page errors', s.errors.length === 0, s.errors.join(' | '))
  } finally { await s.browser.close() }
}

// ── The repair, as the office ──
{
  const s = await session(process.env.E2E_STAFF_COOKIE)
  const { page, ctx } = s
  try {
    await openJob(page, REPAIR)
    await saveLocate(page)
    const j = await jobOf(ctx, REPAIR)
    check('repair, locate Clear to dig (permit Not needed) → the added Ready to Schedule stage', /^stage_/.test(j?.opsStage || '') && j?.status === 'staging', `${j?.opsStage} ${j?.status}`)
    await openJob(page, REPAIR)
    check('the job window names it', /ready to SCHEDULE/.test(await pill(page).innerText()), await pill(page).innerText())
    check('history: moved to it by itself', (await history(page)).some(l => /Moved to ready to SCHEDULE by itself: 811 locate is clear to dig\./.test(l)))
    await shot(page, 'repair-in-ready-to-schedule-window')
    await board(page, 'Testy Board2 Repair')
    await page.locator('text=Testy Board2 Repair').first().scrollIntoViewIfNeeded()
    await shot(page, 'board-repair-in-ready-to-schedule')
    check('office: no page errors (repair)', s.errors.length === 0, s.errors.join(' | '))
  } finally { await s.browser.close() }
}

const failed = results.filter(r => !r).length
console.log(`\n${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
