// Automations, in the real app at phone size.
//
//   cd apps/web && pnpm -s build
//   E2E_ACCESS_TOKEN=<dev staff token> SHOTS=<folder, optional> node e2e/automations.mjs
//
// Dev only (4001 serves the built app and the API). Makes a test customer
// with a pipeline card and a job, then in the app: builds a rule (card moved
// into Estimating: make a task), tests it in dry run (nothing made), switches
// it on, moves the card in its window, sees the run on the card; switches on
// the Pending Start stage rule, moves the card there and sees it refused with
// what is missing (permit approved) and put back; opens the job's permit
// panel; makes the permit packet PDF. Removes everything it made.
import crypto from 'crypto'
import fs from 'fs'
import { execFileSync } from 'child_process'
import { chromium } from 'playwright'

const APP = 'http://localhost:4001', TOKEN = process.env.E2E_ACCESS_TOKEN || '', SHOTS = process.env.SHOTS || ''
if (!TOKEN) { console.error('Set E2E_ACCESS_TOKEN.'); process.exit(2) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const call = async (p, init = {}) => {
  const r = await fetch(APP + p, { ...init, headers: { Authorization: `Bearer ${TOKEN}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) } })
  return { status: r.status, json: await r.json().catch(() => null), r }
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/dev-automations-${name}.png` }) }

const tag = crypto.randomUUID().slice(0, 6)
const customerId = crypto.randomUUID(), cardId = crypto.randomUUID()
const LAST = `Auto${tag}`
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
let jobId = '', ruleId = ''
const stageRuleBefore = (await call('/api/automations/stage-rules')).json?.data?.find(r => r.board === 'sales' && r.stage === 'Pending Start')

const b = await chromium.launch()
try {
  // A customer, their card (First Contact) and their job.
  const made = await call('/api/crm-contacts', { method: 'POST', body: JSON.stringify({ id: customerId, firstName: 'Erin', lastName: LAST, phone: '3525550142', email: `erin.${tag}@example.com`, serviceAddress: '100 Pecan Dr, Ocala, FL 34472', leadSource: 'Other',
    lead: { id: cardId, customerId, firstName: 'Erin', lastName: LAST, phone: '3525550142', email: `erin.${tag}@example.com`, address: '100 Pecan Dr, Ocala, FL 34472', stage: 'First Contact', leadSource: 'Other', createdAt: today, lastMoved: today }, leadBefore: null }) })
  check('test customer and card made', made.status === 201 || made.status === 200, String(made.status))
  const job = await call('/api/saved-jobs', { method: 'POST', body: JSON.stringify({ customerName: `Erin ${LAST}`, customerAddress: '100 Pecan Dr, Ocala, FL 34472', customerPhone: '3525550142', customerEmail: `erin.${tag}@example.com`, crmContactId: customerId, fenceStyle: "WV-ND 6'x6' Privacy", sections: 14, contractValue: 5200, status: 'staging' }) })
  jobId = job.json?.data?.id
  check('test job made', !!jobId, String(job.status))

  const c = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await c.addInitScript(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, TOKEN)
  const p = await c.newPage()
  const errs = []
  p.on('pageerror', e => errs.push(String(e).slice(0, 200)))
  p.on('dialog', d => d.accept().catch(() => {}))

  // ── The Automations screen ──
  await p.goto(`${APP}/automations`)
  await p.waitForSelector('[data-automations]', { timeout: 60000 }); await sleep(800)
  const starters = await p.locator('[data-rule]').count()
  check('the screen shows the starter rules', starters >= 5, `${starters} rules`)
  check('starter rules are switched off', (await p.locator('[data-rule] [role="switch"][aria-checked="true"]').count()) === 0)
  await shot(p, 'screen')

  // Build a rule: card moved into Estimating, make a task.
  await p.locator('[data-new-rule]').click()
  await p.waitForSelector('[data-rule-editor]')
  await p.locator('[data-rule-name]').fill(`E2E ${tag} measure`)
  await p.locator('[data-trigger-stage]').selectOption('Estimating')
  await p.locator('[data-rule-editor] input[type="number"]').first().fill('0') // no settle time, so the test does not wait 2 minutes
  await p.locator('[data-step="0"] [data-step-title]').fill(`E2E ${tag} measure {first name} at {address}`)
  await p.locator('[data-add-condition]').click()
  await p.locator('[data-condition] input').first().fill('Ocala')
  await shot(p, 'rule-editor')

  // Test it in dry run against the test card: says what would happen, makes nothing.
  const tasksBefore = (await call('/api/automations/tasks?all=1')).json.data.filter(t => t.title.includes(tag)).length
  await p.locator('[data-test-draft]').click()
  await p.waitForSelector('[data-test-panel]')
  await p.locator('[data-sample-search]').fill(LAST); await sleep(900)
  await p.locator('[data-sample-pick]').selectOption(cardId)
  await p.locator('[data-run-test]').click()
  await p.waitForSelector('[data-dry-run-result]', { timeout: 15000 })
  const would = await p.locator('[data-dry-step="0"]').innerText()
  check('dry run says what it would do, with the fields filled', would.includes(`E2E ${tag} measure Erin at 100 Pecan Dr`), would.slice(0, 120))
  check('dry run: the condition is met', (await p.locator('[data-would-run="true"]').count()) === 1)
  await shot(p, 'dry-run')
  check('dry run made nothing', (await call('/api/automations/tasks?all=1')).json.data.filter(t => t.title.includes(tag)).length === tasksBefore)
  check('dry run started no run', (await call(`/api/automations/runs?entityId=${cardId}`)).json.data.length === 0)
  await p.locator('[data-test-panel] button[aria-label="Close"]').click(); await sleep(300)

  // Save, then switch it on from the list.
  await p.locator('[data-save-rule]').click()
  await p.waitForSelector(`[data-rule="E2E ${tag} measure"]`, { timeout: 15000 })
  const rule = (await call('/api/automations/rules')).json.data.find(r => r.name === `E2E ${tag} measure`)
  ruleId = rule?.id
  check('the rule is saved, off', !!rule && rule.enabled === false && rule.trigger.stage === 'Estimating' && rule.conditions[0]?.value === 'Ocala')
  await p.locator(`[data-rule="E2E ${tag} measure"] [role="switch"]`).click(); await sleep(1200)
  check('switched on', (await call('/api/automations/rules')).json.data.find(r => r.id === ruleId)?.enabled === true)

  // ── Move the card in its window; the run shows on the card ──
  await p.goto(`${APP}/pipeline?card=${cardId}`)
  await p.waitForSelector(`[data-card-window="${cardId}"]`, { timeout: 60000 }); await sleep(600)
  await p.locator('[data-card-stage]').selectOption('Estimating')
  let task = null
  for (let i = 0; i < 40 && !task; i++) { await sleep(1000); task = (await call('/api/automations/tasks?all=1')).json.data.find(t => t.title === `E2E ${tag} measure Erin at 100 Pecan Dr, Ocala, FL 34472`) }
  check('moving the card ran the rule on the server: the task is there', !!task, task?.title)
  // The card's run log (it reads again every 20 s; open the card again to see it now).
  await p.goto(`${APP}/pipeline?card=${cardId}`)
  await p.waitForSelector(`[data-run-log="${cardId}"] [data-run-status="succeeded"]`, { timeout: 30000 }).catch(() => null)
  const runShown = await p.locator(`[data-run-log="${cardId}"] [data-run-status="succeeded"]`).count()
  check('the run shows on the card', runShown === 1, `${runShown}`)
  await p.locator(`[data-run-log="${cardId}"] [data-run] button`).first().click(); await sleep(300)
  await p.locator(`[data-run-log="${cardId}"]`).scrollIntoViewIfNeeded()
  await shot(p, 'card-run-log')

  // ── A stage rule refuses a move and says what is missing ──
  await call('/api/automations/stage-rules', { method: 'PUT', body: JSON.stringify({ board: 'sales', stage: 'Pending Start', requirements: [{ type: 'permit_approved' }], enabled: true }) })
  await p.locator('[data-card-stage]').selectOption('Pending Start')
  const blocked = await p.waitForSelector('[data-stage-blocked]', { timeout: 20000 }).catch(() => null)
  check('moving to Pending Start is refused, with what is missing', !!blocked && (await p.locator('[data-stage-blocked] [data-missing="permit_approved"]').count()) === 1)
  await shot(p, 'stage-block')
  await p.locator('[data-stage-blocked] button.btn-primary').click(); await sleep(1500)
  const server = (await call('/api/pipeline')).json.data.leads.find(l => l.id === cardId)
  check('the card stays in Estimating on the server', server?.stage === 'Estimating', server?.stage)
  check('and on screen', (await p.locator('[data-card-stage]').inputValue().catch(() => '')) === 'Estimating', await p.locator('[data-card-stage]').inputValue().catch(() => '?'))
  await sleep(2000)
  const stuck = await p.evaluate(() => new Promise(res => { const r = indexedDB.open('ezbiz-outbox', 1); r.onsuccess = () => { const t = r.result.transaction('ops', 'readonly').objectStore('ops').getAll(); t.onsuccess = () => res(t.result.length) }; r.onerror = () => res(-1) }))
  check('nothing is left retrying in the save queue', stuck === 0, `${stuck} waiting`)

  // ── The job's permit panel, and the packet ──
  await p.goto(`${APP}/operations?job=${jobId}`)
  await p.waitForSelector(`[data-permit-panel="${jobId}"]`, { timeout: 60000 })
  await p.locator('[data-permit-status]').selectOption('applied')
  await p.locator('[data-permit-number]').fill(`E2E-${tag}`)
  await p.locator('[data-permit-save]').click(); await sleep(1500)
  const permit = (await call(`/api/automations/permits/${jobId}`)).json.data.permit
  check('permit saved from the job panel', permit?.status === 'applied' && permit?.permitNumber === `E2E-${tag}` && !!permit?.appliedAt, JSON.stringify(permit && { s: permit.status, n: permit.permitNumber, a: permit.appliedAt }))
  await p.locator(`[data-permit-panel="${jobId}"]`).scrollIntoViewIfNeeded()
  await shot(p, 'permit-panel')
  const pdf = await call(`/api/automations/permits/${jobId}/packet.pdf`).then(x => x.r)
  check('permit packet is a PDF', pdf.headers.get('content-type') === 'application/pdf')
  // The packet's first page, for a job whose quote has a drawn site plan (read only: nothing is saved).
  if (SHOTS) {
    const withPlan = process.env.PACKET_JOB || jobId
    const buf = Buffer.from(await (await fetch(`${APP}/api/automations/permits/${withPlan}/packet.pdf?lookup=1`, { headers: { Authorization: `Bearer ${TOKEN}` } })).arrayBuffer())
    fs.writeFileSync(`${SHOTS}/dev-automations-permit-packet.pdf`, buf)
    try { execFileSync('sips', ['-s', 'format', 'png', '-Z', '1700', `${SHOTS}/dev-automations-permit-packet.pdf`, '--out', `${SHOTS}/dev-automations-permit-packet.png`], { stdio: 'ignore' }) } catch { /* sips only on a Mac */ }
    fs.rmSync(`${SHOTS}/dev-automations-permit-packet.pdf`, { force: true })
  }
  check('no page errors', errs.length === 0, errs.join(' | '))
} catch (e) {
  check('test run finished', false, String(e?.message || e).slice(0, 300))
} finally {
  // Remove what was made, and put the stage rule back as it was.
  if (stageRuleBefore) await call('/api/automations/stage-rules', { method: 'PUT', body: JSON.stringify({ board: 'sales', stage: 'Pending Start', requirements: stageRuleBefore.requirements, enabled: stageRuleBefore.enabled }) })
  const pl = (await call('/api/pipeline')).json
  if (pl?.data?.leads?.some(l => l.id === cardId)) await call('/api/pipeline', { method: 'PATCH', body: JSON.stringify({ upsert: [], remove: [cardId], baseVersion: pl.data.version }) })
  if (ruleId) await call(`/api/automations/rules/${ruleId}`, { method: 'DELETE' })
  // Runs, tasks, the permit and the events have no delete in the app: removed from the dev database by name.
  const ids = [cardId, jobId, customerId].filter(Boolean).map(x => `'${x}'`).join(',')
  const sql = [
    `DELETE FROM "AutomationEffect" WHERE "runId" IN (SELECT id FROM "AutomationRun" WHERE "entityId" IN (${ids}))`,
    `DELETE FROM "AutomationRun" WHERE "entityId" IN (${ids})`,
    `DELETE FROM "AutomationEvent" WHERE "entityId" IN (${ids})`,
    `DELETE FROM "Task" WHERE title LIKE '%${tag}%'`,
    `DELETE FROM "Notification" WHERE "jobId" IN (${ids}) OR title LIKE '%${tag}%'`,
    `DELETE FROM "Permit" WHERE "jobId" IN (${ids})`,
    `DELETE FROM "SavedJob" WHERE id IN (${ids})`,
    `DELETE FROM "CrmContactNote" WHERE "crmContactId" IN (${ids})`,
    `DELETE FROM "CrmContact" WHERE id IN (${ids})`,
  ].join('; ')
  try { execFileSync('psql', ['-d', 'ezbiz_dev', '-q', '-c', sql], { stdio: 'inherit' }) } catch (e) { console.log('cleanup in ezbiz_dev did not finish:', String(e?.message || e).slice(0, 200)) }
  await b.close()
}
const failed = results.filter(r => !r).length
console.log(`\n${results.length - failed} of ${results.length} checks passed`)
process.exit(failed ? 1 : 0)
