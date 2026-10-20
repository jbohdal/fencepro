// Operations stages: Settings is the one list, and everything reads it.
//
//   cd apps/web && pnpm -s build
//   E2E_ACCESS_TOKEN=<dev staff token> APP_URL=http://localhost:4001 API_URL=http://localhost:4001 \
//     SHOTS=<folder, optional> node e2e/ops-stages.mjs
//
// Dev only. Makes a test job (Scheduled) and a switched off Operations rule on
// the Scheduled stage, then at desktop size in Settings > Operations Stages:
// renames Scheduled, adds a stage, moves it up before Complete, hides Permit
// Pending, saves. Checks the board's columns and order, the stage filter, the
// job page (stage pill, Advance, the stage buttons) and the rule (its card and
// its stage picker) all show the change, and that the job's stage did not
// change. A second browser at 360 px reloads and sees the same. Then deleting
// the added stage with the job in it asks where the job goes, moves it and
// deletes the stage. Finally the list is put back as it was and everything
// made is removed; checks nothing is left.
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
  const r = await fetch(API + p, { ...init, headers: { Authorization: `Bearer ${TOKEN}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) } })
  return { status: r.status, json: await r.json().catch(() => null) }
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false }) }
const getList = async () => (await call('/api/ops-stages')).json?.data
const putList = async (stages, baseVersion) => call('/api/ops-stages', { method: 'PUT', body: JSON.stringify({ stages, baseVersion }) })
const shape = l => l.stages.map(s => ({ id: s.id, name: s.name, color: s.color, order: s.order, hidden: s.hidden, isFirst: s.isFirst, isComplete: s.isComplete, lane: s.lane }))

const tag = crypto.randomUUID().slice(0, 6)
const NEW_NAME = `E2E Inspect ${tag}`
const original = await getList()
if (!original?.stages?.length) { console.error('GET /api/ops-stages did not answer: is the server on the new code?'); process.exit(1) }
const scheduled = original.stages.find(s => s.id === 'scheduled')
const RENAMED = `${scheduled.name} ${tag}`
let jobId = '', ruleId = '', newId = ''

async function open(browser, width, height, phone) {
  const ctx = await browser.newContext(phone ? { viewport: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width, height } })
  await ctx.addInitScript(t => {
    localStorage.setItem('crm_access_token', t)
    if (!localStorage.getItem('crm_refresh_token')) localStorage.setItem('crm_refresh_token', 'e2e')
    // Every column open, the board view (per device screen preferences, not business data).
    localStorage.setItem('fencepro_ops_collapsed_columns', '{}'); localStorage.setItem('fencepro_ops_view', 'board'); localStorage.setItem('fencepro_ops_show_completed', '0')
  }, TOKEN)
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', e => errs.push(String(e).slice(0, 200)))
  page.on('dialog', d => d.accept().catch(() => {}))
  return { ctx, page, errs }
}
const lanes = page => page.$$eval('[data-kanban-col]', els => els.map(e => e.getAttribute('data-kanban-col')))
const laneLabel = (page, key) => page.locator(`[data-kanban-col="${key}"] button`).first().innerText()
const row = (page, id) => page.locator(`[data-ops-stage-row="${id}"]`)
const noSideScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)

const b = await chromium.launch()
try {
  // ── Test job (Scheduled, with a date so it shows in the Scheduled column) and an Operations rule on Scheduled ──
  const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  const job = await call('/api/saved-jobs', { method: 'POST', body: JSON.stringify({ customerName: `Stage Test ${tag}`, customerAddress: '100 Pecan Dr, Ocala, FL 34472', fenceStyle: "WV-ND 6'x6' Privacy", sections: 10, contractValue: 4100, status: 'scheduled', scheduledDate: tomorrow }) })
  jobId = job.json?.data?.id
  check('test job made, in Scheduled', !!jobId && job.json.data.opsStage === 'scheduled', `${job.status} ${job.json?.data?.opsStage}`)
  const rule = await call('/api/automations/rules', { method: 'POST', body: JSON.stringify({ name: `E2E ${tag} scheduled`, board: 'ops', enabled: false, trigger: { type: 'card_entered', stage: 'scheduled', settleMinutes: 2, onlyWhileInStage: true }, conditions: [], steps: [{ type: 'notify', title: 'Scheduled {name}', body: '', push: false }] }) })
  ruleId = rule.json?.data?.id
  check('test rule made (off), on the Scheduled stage id', !!ruleId && rule.json.data.trigger.stage === 'scheduled', String(rule.status))

  // ── Desktop: edit in Settings ──
  const d = await open(b, 1440, 900, false)
  await d.page.goto(`${APP}/settings?tab=ops_stages`)
  await d.page.waitForSelector('[data-ops-stages-settings]', { timeout: 60000 }); await sleep(600)
  check('Settings shows the stages in order', (await d.page.$$eval('[data-ops-stage-row]', els => els.map(e => e.getAttribute('data-ops-stage-row')))).join() === original.stages.map(s => s.id).join())
  await row(d.page, 'scheduled').locator('[data-ops-stage-name]').fill(RENAMED)
  await d.page.locator('[data-ops-stage-add]').click(); await sleep(200)
  const rows = await d.page.$$eval('[data-ops-stage-row]', els => els.map(e => e.getAttribute('data-ops-stage-row')))
  newId = rows.find(id => !original.stages.some(s => s.id === id)) || ''
  check('Add stage makes a row with a new permanent id', /^stage_[a-z0-9_]{4,40}$/.test(newId), newId)
  await row(d.page, newId).locator('[data-ops-stage-name]').fill(NEW_NAME)
  // Up until it sits just before Complete.
  for (let i = 0; i < 20; i++) {
    const ids = await d.page.$$eval('[data-ops-stage-row]', els => els.map(e => e.getAttribute('data-ops-stage-row')))
    if (ids.indexOf(newId) === ids.indexOf('completed') - 1) break
    await row(d.page, newId).locator('[data-ops-stage-up]').click(); await sleep(80)
  }
  await row(d.page, 'permit_pending').locator('[data-ops-stage-hidden]').check()
  await shot(d.page, 'dev-ops-stages-settings')
  await d.page.locator('[data-ops-stages-save]').first().click()
  await d.page.waitForSelector('[data-ops-stages-save]:has-text("Saved")', { timeout: 15000 }).catch(() => null)
  const saved = await getList()
  const savedIds = saved.stages.map(s => s.id)
  check('saved on the server: renamed, added before Complete, Permit Pending hidden',
    saved.stages.find(s => s.id === 'scheduled')?.name === RENAMED && savedIds.indexOf(newId) === savedIds.indexOf('completed') - 1 && saved.stages.find(s => s.id === 'permit_pending')?.hidden === true && saved.version === original.version + 1,
    `v${saved.version}`)
  const j1 = (await call(`/api/saved-jobs/${jobId}`)).json?.data
  check('the rename did not change the job (same stage id and status)', j1?.opsStage === 'scheduled' && j1?.status === 'scheduled', `${j1?.opsStage} ${j1?.status}`)
  const r1 = (await call('/api/automations/rules')).json?.data?.find(r => r.id === ruleId)
  check('the rename did not change the rule (still the stage id)', r1?.trigger?.stage === 'scheduled')

  // ── The board ──
  await d.page.goto(`${APP}/operations`)
  await d.page.waitForSelector('[data-kanban-col="scheduled"]', { timeout: 60000 }); await sleep(800)
  const want = ['__unscheduled__', ...saved.stages.filter(s => !s.hidden && s.lane === 'main').map(s => s.id), ...saved.stages.filter(s => !s.hidden && s.lane === 'side').map(s => s.id)]
  const got = await lanes(d.page)
  check('board columns follow Settings: order, the new stage, no hidden stage', got.join() === want.join(), got.join(' | '))
  check('board column shows the new name', (await laneLabel(d.page, 'scheduled')).includes(RENAMED))
  check('board shows the added stage by name', (await laneLabel(d.page, newId)).includes(NEW_NAME))
  check('the test job is in the renamed column', (await d.page.locator(`[data-kanban-col="scheduled"] [data-kanban-card="${jobId}"]`).count()) === 1)
  await d.page.locator('[data-kanban-col="scheduled"]').evaluate(el => el.scrollIntoView({ inline: 'start', block: 'nearest' })); await sleep(300)
  await shot(d.page, 'dev-ops-board-from-settings')
  const opts = await d.page.$$eval('[data-ops-stage-filter] option', os => os.map(o => ({ v: o.value, t: o.textContent })))
  check('stage filter lists the renamed and added stages', opts.some(o => o.v === 'scheduled' && o.t === RENAMED) && opts.some(o => o.v === newId && o.t === NEW_NAME))
  check('stage filter marks the hidden stage', opts.some(o => o.v === 'permit_pending' && /\(hidden\)/.test(o.t)))
  await d.page.locator('[data-ops-stage-filter]').first().selectOption('scheduled'); await sleep(400)
  check('filtering on the renamed stage shows the job', (await d.page.locator(`[data-kanban-card="${jobId}"]`).count()) === 1)
  await d.page.locator('[data-ops-stage-filter]').first().selectOption(''); await sleep(200)

  // ── The job page ──
  await d.page.goto(`${APP}/operations?job=${jobId}`)
  await d.page.waitForSelector('[data-ops-advance]', { timeout: 60000 }); await sleep(400)
  check('job page stage pill shows the new name', (await d.page.locator('[data-ops-stage-pill="scheduled"]').first().innerText()).includes(RENAMED))
  const inProgress = saved.stages.find(s => s.id === 'in_progress')
  check('Advance names the next stage from Settings', (await d.page.locator('[data-ops-advance]').innerText()).includes(inProgress.name))
  check('the stage buttons offer the added stage and not the hidden one', (await d.page.locator(`[data-ops-stage-choice="${newId}"]`).count()) === 1 && (await d.page.locator('[data-ops-stage-choice="permit_pending"]').count()) === 0)
  // Move the job into the added stage from the job page.
  await d.page.locator(`[data-ops-stage-choice="${newId}"]`).click()
  let j2 = null
  for (let i = 0; i < 20; i++) { await sleep(500); j2 = (await call(`/api/saved-jobs/${jobId}`)).json?.data; if (j2?.opsStage === newId) break }
  check('moving the job to the added stage saves its id; the status is the one it stands for', j2?.opsStage === newId && j2?.status === 'in_progress', `${j2?.opsStage} ${j2?.status}`)

  // ── The automation ──
  await d.page.goto(`${APP}/automations`)
  await d.page.waitForSelector(`[data-rule="E2E ${tag} scheduled"]`, { timeout: 60000 }); await sleep(400)
  check('the rule card names the stage by its new name', (await d.page.locator(`[data-rule="E2E ${tag} scheduled"]`).innerText()).includes(RENAMED))
  await d.page.locator(`[data-rule="E2E ${tag} scheduled"] [data-edit-rule]`).click()
  await d.page.waitForSelector('[data-trigger-stage]')
  const tOpts = await d.page.$$eval('[data-trigger-stage] option', os => os.map(o => ({ v: o.value, t: o.textContent })))
  const tSel = await d.page.locator('[data-trigger-stage]').inputValue()
  check('the rule\'s stage picker: renamed, added, no hidden stage, still on the same id', tSel === 'scheduled' && tOpts.some(o => o.v === 'scheduled' && o.t === RENAMED) && tOpts.some(o => o.v === newId && o.t === NEW_NAME) && !tOpts.some(o => o.v === 'permit_pending'))
  await d.page.keyboard.press('Escape'); await sleep(300)

  // ── A second browser at 360 px: reload, same list ──
  const m = await open(b, 360, 780, true)
  await m.page.goto(`${APP}/operations`)
  await m.page.waitForSelector('[data-kanban-col="scheduled"]', { timeout: 60000 }); await sleep(800)
  check('phone (second browser): same columns after a reload', (await lanes(m.page)).join() === want.join())
  check('phone: renamed column', (await m.page.locator('[data-kanban-col="scheduled"]').innerText()).includes(RENAMED))
  await m.page.goto(`${APP}/settings?tab=ops_stages`)
  await m.page.waitForSelector('[data-ops-stages-settings]', { timeout: 60000 }); await sleep(600)
  check('phone: Settings shows the saved names', (await row(m.page, 'scheduled').locator('[data-ops-stage-name]').inputValue()) === RENAMED)
  check('phone: Settings fits at 360 px (no sideways scroll)', await noSideScroll(m.page))
  await m.page.locator('[data-ops-stages-settings]').evaluate(el => el.scrollIntoView({ block: 'start' })); await sleep(300)
  await shot(m.page, 'dev-ops-stages-settings-phone')

  // ── Delete the added stage while the job is in it: asked where it goes ──
  await d.page.goto(`${APP}/settings?tab=ops_stages`)
  await d.page.waitForSelector('[data-ops-stages-settings]', { timeout: 60000 }); await sleep(600)
  const refused = await call(`/api/ops-stages/${newId}/delete`, { method: 'POST', body: JSON.stringify({ moveTo: null, baseVersion: saved.version }) })
  check('the server refuses to delete a stage with a job in it', refused.status === 409 && refused.json?.inUse?.jobs?.some(j => j.id === jobId), String(refused.status))
  await row(d.page, newId).locator('[data-ops-stage-delete]').click()
  await d.page.waitForSelector('[data-ops-stage-delete-dialog]', { timeout: 15000 })
  check('deleting asks: it lists the job', (await d.page.locator('[data-ops-stage-delete-dialog]').innerText()).includes(`Stage Test ${tag}`))
  await d.page.locator('[data-ops-stage-delete-moveto]').selectOption('scheduled')
  await shot(d.page, 'dev-ops-stage-delete-ask')
  await d.page.locator('[data-ops-stage-delete-confirm]').click()
  await d.page.waitForSelector('[data-ops-stage-delete-dialog]', { state: 'detached', timeout: 15000 }).catch(() => null)
  const afterDel = await getList()
  const j3 = (await call(`/api/saved-jobs/${jobId}`)).json?.data
  check('stage deleted; the job moved to the stage picked', !afterDel.stages.some(s => s.id === newId) && j3?.opsStage === 'scheduled' && j3?.status === 'scheduled', `${j3?.opsStage} ${j3?.status}`)
  await sleep(500)
  check('Settings no longer shows the deleted stage', (await row(d.page, newId).count()) === 0)

  // ── Rename back, unhide ──
  await row(d.page, 'scheduled').locator('[data-ops-stage-name]').fill(scheduled.name)
  await row(d.page, 'permit_pending').locator('[data-ops-stage-hidden]').uncheck()
  await d.page.locator('[data-ops-stages-save]').first().click()
  await d.page.waitForSelector('[data-ops-stages-save]:has-text("Saved")', { timeout: 15000 }).catch(() => null)
  const back = await getList()
  check('renamed back: the list is as it was', JSON.stringify(shape(back)) === JSON.stringify(shape(original)))

  check('no page errors', d.errs.length === 0 && m.errs.length === 0, [...d.errs, ...m.errs].join(' | '))
  await d.ctx.close(); await m.ctx.close()
} finally {
  // Clean up, then check nothing is left.
  const now = await getList()
  if (now && JSON.stringify(shape(now)) !== JSON.stringify(shape(original))) {
    if (newId && now.stages.some(s => s.id === newId)) await call(`/api/ops-stages/${newId}/delete`, { method: 'POST', body: JSON.stringify({ moveTo: 'scheduled', baseVersion: now.version }) })
    const again = await getList()
    await putList(original.stages, again.version)
  }
  if (ruleId) await call(`/api/automations/rules/${ruleId}`, { method: 'DELETE' })
  if (jobId) await call(`/api/saved-jobs/${jobId}`, { method: 'DELETE' })
  const end = await getList()
  const rules = (await call('/api/automations/rules')).json?.data ?? []
  const jobs = (await call('/api/saved-jobs')).json?.data ?? []
  check('nothing left: stage list as it was, no test stage, rule or job', JSON.stringify(shape(end)) === JSON.stringify(shape(original)) && !end.stages.some(s => s.name.includes(tag)) && !rules.some(r => r.name.includes(tag)) && !jobs.some(j => j.customerName.includes(tag)))
  await b.close()
}
const failed = results.filter(r => !r).length
console.log(`\n${results.length - failed} of ${results.length} checks passed`)
process.exit(failed ? 1 : 0)
