// Sales Pipeline stages: Settings is the one list, and the board, the card
// window and the customer's stage picker read it.
//
//   cd apps/web && pnpm -s build
//   E2E_ACCESS_TOKEN=<dev staff token> APP_URL=http://localhost:4001 API_URL=http://localhost:4001 \
//     SHOTS=<folder, optional> node e2e/pipeline-stages.mjs
//
// Dev only. Makes a test card in Pending Signature. A second browser at 360 px
// opens the board first. Then at desktop size in Settings > Pipeline Stages:
// renames Signed Contract to "Sold …" and Pending Signature, adds a Selling
// stage with a 40% chance, hides Job Prep, saves. Checks: the list on the
// server, the test card did not move, the board's columns, names and order,
// the card window's stage picker. The phone sees the rename without a reload
// (live refresh, within about a minute), fits at 360 px, and its Settings shows
// the names. A salesman's token cannot save. Deleting the added stage with the
// card in it asks where it goes, moves it and deletes the stage. Finally the
// list is put back as it was and the test card is removed (through the
// deletion system); checks nothing is left.
import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import './sharedLock.mjs' // tests that change shared dev data take turns
import crypto from 'crypto'
import { chromium } from 'playwright'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || 'http://localhost:4001'
const TOKEN = process.env.E2E_ACCESS_TOKEN || ''
const SHOTS = process.env.SHOTS || ''
const local = u => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(u)
if (!local(APP) || !local(API) || /:4000(\/|$)/.test(API)) { console.error('Refusing to run: dev only (localhost, not port 4000).'); process.exit(2) }
if (!TOKEN) { console.error('Set E2E_ACCESS_TOKEN.'); process.exit(2) }

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const call = async (p, init = {}) => {
  const r = await fetch(API + p, { ...init, headers: { Authorization: `Bearer ${init.token || TOKEN}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) } })
  return { status: r.status, json: await r.json().catch(() => null) }
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false }) }
const getList = async () => (await call('/api/pipeline-stages')).json?.data
const putList = async (stages, baseVersion, token) => call('/api/pipeline-stages', { method: 'PUT', body: JSON.stringify({ stages, baseVersion }), token })
const shape = l => l.stages.map(s => ({ id: s.id, name: s.name, color: s.color, order: s.order, hidden: s.hidden, group: s.group, roles: s.roles, finished: s.finished, needsFollowUp: s.needsFollowUp, chancePct: s.chancePct }))
const board = async () => (await call('/api/pipeline')).json?.data
const cardStage = async id => (await board())?.leads?.find(l => l.id === id)?.stage

const tag = crypto.randomUUID().slice(0, 6)
const original = await getList()
if (!original?.stages?.length) { console.error('GET /api/pipeline-stages did not answer: is the server on the new code?'); process.exit(1) }
const SOLD = `Sold ${tag}`
const AWAIT = `Awaiting signature ${tag}`
const ADDED = `Site visit ${tag}`
const cardId = `e2e-stage-${tag}`
let newId = ''

async function open(browser, width, height, phone) {
  const ctx = await browser.newContext(phone ? { viewport: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width, height } })
  await ctx.addInitScript(t => {
    localStorage.setItem('crm_access_token', t)
    if (!localStorage.getItem('crm_refresh_token')) localStorage.setItem('crm_refresh_token', 'e2e')
    // Every column open, the board view, manual order (per device screen preferences, not business data).
    localStorage.setItem('fencepro_pipeline_collapsed_columns', '{}'); localStorage.setItem('fencepro_pipeline_view', 'board'); localStorage.setItem('fencepro_pipeline_sort_v2', 'manual')
  }, TOKEN)
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', e => errs.push(String(e).slice(0, 200)))
  page.on('dialog', d => d.accept().catch(() => {}))
  return { ctx, page, errs }
}
const cols = page => page.$$eval('[data-kanban-col]', els => els.map(e => e.getAttribute('data-kanban-col')))
const colText = (page, key) => page.locator(`[data-kanban-col="${key}"]`).first().innerText()
const row = (page, id) => page.locator(`[data-pipeline-stage-row="${id}"]`)
const noSideScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)

const b = await chromium.launch()
try {
  // ── A test card in Pending Signature ──
  const pipe = await board()
  const lead = { id: cardId, firstName: 'Stage', lastName: `Test ${tag}`, phone: '', email: '', address: '', leadSource: '', leadTemp: 0, fenceType: '', sections: 0, quotePrice: 4100, crew: '', scheduledDate: '', jobValue: 0, paymentStatus: '', balanceDue: 0, notes: '', stage: 'Pending Signature', createdAt: '2026-10-20', lastMoved: '2026-10-20' }
  const made = await call('/api/pipeline', { method: 'PATCH', body: JSON.stringify({ upsert: [{ lead }], remove: [], baseVersion: pipe.version }) })
  check('test card made, in Pending Signature', made.status === 200 && (await cardStage(cardId)) === 'Pending Signature', String(made.status))

  // ── The second browser (phone) opens the board first, and stays open ──
  const m = await open(b, 360, 780, true)
  await m.page.goto(`${APP}/pipeline`)
  await m.page.waitForSelector('[data-kanban-col="Signed Contract"]', { timeout: 60000 }); await sleep(800)

  // ── Desktop: edit in Settings ──
  const d = await open(b, 1440, 900, false)
  await d.page.goto(`${APP}/settings?tab=pipeline`)
  await d.page.waitForSelector('[data-pipeline-stages-settings]', { timeout: 60000 }); await sleep(600)
  check('Settings shows the stages in order', (await d.page.$$eval('[data-pipeline-stage-row]', els => els.map(e => e.getAttribute('data-pipeline-stage-row')))).join() === original.stages.map(s => s.id).join())
  check('Settings names the roles', (await d.page.locator('[data-pipeline-role="signed"]').inputValue()) === 'Signed Contract')
  await row(d.page, 'Signed Contract').locator('[data-pipeline-stage-name]').fill(SOLD)
  await row(d.page, 'Pending Signature').locator('[data-pipeline-stage-name]').fill(AWAIT)
  await d.page.locator('[data-pipeline-stage-add]').click(); await sleep(200)
  const ids = await d.page.$$eval('[data-pipeline-stage-row]', els => els.map(e => e.getAttribute('data-pipeline-stage-row')))
  newId = ids.find(id => !original.stages.some(s => s.id === id)) || ''
  check('Add stage makes a row with a new permanent id', /^stage_[a-z0-9_]{4,40}$/.test(newId), newId)
  await row(d.page, newId).locator('[data-pipeline-stage-name]').fill(ADDED)
  await row(d.page, newId).locator('[data-pipeline-stage-chance]').fill('40')
  // Up until it sits just before Pending Signature.
  for (let i = 0; i < 10; i++) {
    const now = await d.page.$$eval('[data-pipeline-stage-row]', els => els.map(e => e.getAttribute('data-pipeline-stage-row')))
    if (now.indexOf(newId) === now.indexOf('Pending Signature') - 1) break
    await row(d.page, newId).locator('[data-pipeline-stage-up]').click(); await sleep(80)
  }
  await row(d.page, 'Job Prep').locator('[data-pipeline-stage-hidden]').check()
  await d.page.locator('[data-pipeline-stages-settings]').evaluate(el => el.scrollIntoView({ block: 'start' })); await sleep(200)
  await shot(d.page, 'dev-pipeline-stages-settings')
  await d.page.locator('[data-pipeline-stages-save]').first().click()
  await d.page.waitForSelector('[data-pipeline-stages-save]:has-text("Saved")', { timeout: 15000 }).catch(() => null)
  const saved = await getList()
  const sIds = saved.stages.map(s => s.id)
  check('saved on the server: renamed, added before Pending Signature at 40%, Job Prep hidden, roles kept',
    saved.stages.find(s => s.id === 'Signed Contract')?.name === SOLD && saved.stages.find(s => s.id === 'Signed Contract')?.roles.includes('signed') &&
    sIds.indexOf(newId) === sIds.indexOf('Pending Signature') - 1 && saved.stages.find(s => s.id === newId)?.chancePct === 40 &&
    saved.stages.find(s => s.id === 'Job Prep')?.hidden === true && saved.version === original.version + 1, `v${saved.version}`)
  check('the rename did not move the test card (same stage id)', (await cardStage(cardId)) === 'Pending Signature')

  // ── A salesman cannot change the list ──
  const repToken = process.env.E2E_SALES_TOKEN || ''
  if (repToken) {
    const r = await putList(saved.stages, saved.version, repToken)
    check('a salesman cannot save the stages (403)', r.status === 403, String(r.status))
  }

  // ── The board ──
  await d.page.goto(`${APP}/pipeline`)
  await d.page.waitForSelector('[data-kanban-col="Signed Contract"]', { timeout: 60000 }); await sleep(800)
  const pipeNow = await board()
  const used = new Set(pipeNow.leads.map(l => l.stage))
  const want = saved.stages.filter(s => !s.hidden || used.has(s.id)).map(s => s.id)
  const got = await cols(d.page)
  check('board columns follow Settings: order, the new stage, no hidden empty stage', got.join() === want.join(), got.join(' | '))
  check('board column shows the new names', (await colText(d.page, 'Signed Contract')).includes(SOLD) && (await colText(d.page, 'Pending Signature')).includes(AWAIT))
  check('board shows the added stage by name', (await colText(d.page, newId)).includes(ADDED))
  check('the test card is in the renamed column', (await d.page.locator(`[data-kanban-col="Pending Signature"] [data-kanban-card="${cardId}"]`).count()) === 1)
  await d.page.locator('[data-kanban-col="Signed Contract"]').evaluate(el => el.scrollIntoView({ inline: 'center', block: 'nearest' })); await sleep(300)
  await shot(d.page, 'dev-pipeline-renamed-board')
  const oldNames = await d.page.locator('[data-kanban-board]').innerText()
  check('no old name of a renamed stage shows on the board', !/\bSigned Contract\b/.test(oldNames) && !/\bPending Signature\b/.test(oldNames.replace(AWAIT, '')))

  // ── The card window's stage picker ──
  await d.page.goto(`${APP}/pipeline?card=${cardId}`)
  await d.page.waitForSelector('[data-card-stage]', { timeout: 60000 }); await sleep(300)
  const opts = await d.page.$$eval('[data-card-stage] option', os => os.map(o => ({ v: o.value, t: o.textContent })))
  check('card window picker: new names on the same ids, the added stage, no hidden stage',
    opts.some(o => o.v === 'Signed Contract' && o.t === SOLD) && opts.some(o => o.v === newId && o.t === ADDED) && !opts.some(o => o.v === 'Job Prep') && (await d.page.locator('[data-card-stage]').inputValue()) === 'Pending Signature')
  await d.page.keyboard.press('Escape'); await sleep(300)

  // ── The phone sees it without a reload ──
  let live = false
  for (let i = 0; i < 80 && !live; i++) { await sleep(1000); live = (await colText(m.page, 'Signed Contract').catch(() => '')).includes(SOLD) }
  check('phone (second browser, no reload): the renamed column shows within about a minute', live)
  await m.page.reload()
  await m.page.waitForSelector('[data-kanban-col="Signed Contract"]', { timeout: 60000 }); await sleep(800)
  check('phone after a reload: same columns', (await cols(m.page)).join() === want.join())
  check('phone: the board fits at 360 px (no sideways page scroll)', await noSideScroll(m.page))
  await m.page.goto(`${APP}/settings?tab=pipeline`)
  await m.page.waitForSelector('[data-pipeline-stages-settings]', { timeout: 60000 }); await sleep(600)
  check('phone: Settings shows the saved names', (await row(m.page, 'Signed Contract').locator('[data-pipeline-stage-name]').inputValue()) === SOLD)
  check('phone: Settings fits at 360 px (no sideways scroll)', await noSideScroll(m.page))
  await m.page.locator('[data-pipeline-group="selling"]').evaluate(el => el.scrollIntoView({ block: 'start' })); await sleep(300)
  await shot(m.page, 'dev-pipeline-stages-phone')

  // ── Delete the added stage with the card in it: asked where it goes ──
  const p2 = await board()
  const mv = await call('/api/pipeline', { method: 'PATCH', body: JSON.stringify({ upsert: [{ lead: { ...p2.leads.find(l => l.id === cardId), stage: newId } }], remove: [], baseVersion: p2.version }) })
  check('the card moves into the added stage', mv.status === 200 && (await cardStage(cardId)) === newId)
  const unknown = await call('/api/pipeline', { method: 'PATCH', body: JSON.stringify({ upsert: [{ lead: { ...p2.leads.find(l => l.id === cardId), stage: `Nope ${tag}` } }], remove: [], baseVersion: p2.version + 1 }) })
  check('a move into a stage not in the list is refused', unknown.status === 409 && unknown.json?.code === 'UNKNOWN_STAGE', String(unknown.status))
  await d.page.goto(`${APP}/settings?tab=pipeline`)
  await d.page.waitForSelector('[data-pipeline-stages-settings]', { timeout: 60000 }); await sleep(600)
  await row(d.page, newId).locator('[data-pipeline-stage-delete]').click()
  await d.page.waitForSelector('[data-pipeline-stage-delete-dialog]', { timeout: 15000 })
  check('deleting asks: it lists the card', (await d.page.locator('[data-pipeline-stage-delete-dialog]').innerText()).includes(`Test ${tag}`))
  await d.page.locator('[data-pipeline-stage-delete-moveto]').selectOption('Pending Signature')
  await d.page.locator('[data-pipeline-stage-delete-confirm]').click()
  await d.page.waitForSelector('[data-pipeline-stage-delete-dialog]', { state: 'detached', timeout: 15000 }).catch(() => null)
  const afterDel = await getList()
  check('stage deleted; the card moved to the stage picked', !afterDel.stages.some(s => s.id === newId) && (await cardStage(cardId)) === 'Pending Signature')

  // ── Put the names back ──
  await d.page.reload(); await d.page.waitForSelector('[data-pipeline-stages-settings]', { timeout: 60000 }); await sleep(500)
  await row(d.page, 'Signed Contract').locator('[data-pipeline-stage-name]').fill('Signed Contract')
  await row(d.page, 'Pending Signature').locator('[data-pipeline-stage-name]').fill('Pending Signature')
  await row(d.page, 'Job Prep').locator('[data-pipeline-stage-hidden]').uncheck()
  await d.page.locator('[data-pipeline-stages-save]').first().click()
  await d.page.waitForSelector('[data-pipeline-stages-save]:has-text("Saved")', { timeout: 15000 }).catch(() => null)
  check('renamed back: the list is as it was', JSON.stringify(shape(await getList())) === JSON.stringify(shape(original)))

  check('no page errors', d.errs.length === 0 && m.errs.length === 0, [...d.errs, ...m.errs].join(' | '))
  await d.ctx.close(); await m.ctx.close()
} finally {
  const now = await getList()
  if (now && JSON.stringify(shape(now)) !== JSON.stringify(shape(original))) {
    if (newId && now.stages.some(s => s.id === newId)) await call(`/api/pipeline-stages/${newId}/delete`, { method: 'POST', body: JSON.stringify({ moveTo: 'Pending Signature', baseVersion: now.version }) })
    const again = await getList()
    await putList(original.stages, again.version)
  }
  const p = await board()
  if (p?.leads?.some(l => l.id === cardId)) await call('/api/pipeline', { method: 'PATCH', body: JSON.stringify({ upsert: [], remove: [cardId], baseVersion: p.version }) })
  const end = await getList()
  const left = await board()
  check('nothing left: stage list as it was, no test stage or card', JSON.stringify(shape(end)) === JSON.stringify(shape(original)) && !end.stages.some(s => s.name.includes(tag)) && !left.leads.some(l => l.id === cardId))
  await b.close()
}
const failed = results.filter(r => !r).length
console.log(`\n${results.length - failed} of ${results.length} checks passed`)
process.exit(failed ? 1 : 0)
