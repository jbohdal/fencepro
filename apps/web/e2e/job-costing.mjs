// Job costing, quote to report, on the dev copy (4001 serves the built app:
// run `pnpm -s build` in apps/web first).
//
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 E2E_ACCESS_TOKEN=<dev owner token> \
//     [MEDIA_PHOTO=<a .jpg>] [E2E_SHOTS=<folder>] [CDP_URL=http://localhost:9333] node e2e/job-costing.mjs
//
//   1. The owner makes a quote (priced figures of the latest priced vinyl quote,
//      for a test customer) with a one option proposal, and sends the link.
//   2. The customer signs it on the public proposal page: the quote is Sold,
//      the job is made, and the quoted cost is saved at signing.
//   3. An Installer (a real login, invited and accepted, removed at the end)
//      does the takeoff on a phone (390 x 844, WebKit; or the Android
//      emulator's Chrome with CDP_URL): one more post, pickets back to the
//      shop, an added broken rail with a photo, sub sections paid, then
//      "Send to the office". Every answer the installer's phone gets from the
//      server is recorded: no cost field and no cost figure anywhere. The
//      server refuses the installer's approve, job cost and report.
//   4. The owner approves; the job page shows quoted vs actual line by line
//      (desktop and phone), and Reports → Job Costing shows the job.
// Removes everything it made (hard deletes on ezbiz_dev only).
import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import { webkit, chromium } from 'playwright'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || 'http://localhost:4001'
const OWNER = process.env.E2E_ACCESS_TOKEN || ''
const SHOTS = process.env.E2E_SHOTS || process.env.SHOTS || ''
const PHOTO = process.env.MEDIA_PHOTO || ''
const CDP = process.env.CDP_URL || ''
if (!/localhost:4001/.test(APP) || !/localhost:4001/.test(API)) { console.error('Refusing to run: the dev copy only (localhost:4001).'); process.exit(2) }
if (!OWNER) { console.error('Set E2E_ACCESS_TOKEN (an owner login on the dev server).'); process.exit(2) }
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const call = async (token, method, p, body) => {
  const r = await fetch(`${API}${p}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: r.status, json: await r.json().catch(() => ({})) }
}
const owner = (m, p, b) => call(OWNER, m, p, b)
async function until(fn, ms = 20000, every = 500) { const end = Date.now() + ms; for (;;) { const v = await fn().catch(() => null); if (v || Date.now() > end) return v; await sleep(every) } }
const sql = q => execFileSync('psql', ['-d', 'ezbiz_dev', '-At', '-c', q]).toString().trim()
const uuid = s => /^[0-9a-f-]{36}$/i.test(s)
/** The cost scrubber's rule (apps/portal/src/server/lib/costRedact.ts): a field named like a cost. */
const COST_KEY = /cost|margin|profit|commission|overhead|wage|^(totalCOGS|cogs|gmPct|materialCents|laborCents|disposalCents|basePriceCents|subRate|manHourRate|unitCost|jobLot|pieceCents|priced|snapshot)$/i
const NOT_A_COST = new Set(['costSource', 'commissionMode'])
const keysOf = (v, out = new Set()) => { if (Array.isArray(v)) v.forEach(x => keysOf(x, out)); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.add(k); keysOf(x, out) } return out }

const stamp = Date.now().toString(36).slice(-6)
const NAME = `Job Costing ${stamp}`
const EMAIL = `e2e-installer-${stamp}@example.test`
const PASSWORD = `In-${crypto.randomBytes(9).toString('base64url')}`
const contactId = crypto.randomUUID(), cardId = crypto.randomUUID(), quoteId = crypto.randomUUID()
const made = { userId: null, jobId: null, takeoffId: null }
/** A real photo: MEDIA_PHOTO, or a small PNG made here. */
const photo = () => PHOTO && fs.existsSync(PHOTO) ? PHOTO : (() => { const f = path.join(process.env.TMPDIR || '/tmp', `jc-${stamp}.png`); fs.writeFileSync(f, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')); return f })()

const browser = await chromium.launch()
const phoneBrowser = CDP ? await chromium.connectOverCDP(CDP) : await webkit.launch()
const NAMEP = CDP ? 'android' : 'webkit'
let template = null
try {
  // ── 1. The owner's quote, with a proposal ──
  const all = (await owner('GET', '/api/saved-quotes')).json.data ?? []
  template = all.filter(q => /^WV/.test(q.fenceStyle) && Array.isArray(q.pullSheet) && q.pullSheet.length >= 8 && q.totalCOGS > 0 && !q.work)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0]
  check('a priced vinyl quote to price from', !!template, template ? `${template.fenceStyle}, ${template.pullSheet.length} lines` : 'none')
  const c = await owner('POST', '/api/crm-contacts', { id: contactId, firstName: 'E2E', lastName: NAME, phone: '3525550193', email: 'e2e-job-costing@example.invalid', leadSource: 'Other', lead: { id: cardId, customerId: contactId, firstName: 'E2E', lastName: NAME, phone: '3525550193', stage: 'Proposal Sent', leadSource: 'Other', createdAt: '2026-10-19', lastMoved: '2026-10-19' }, leadBefore: null })
  const priced = ['fenceStyle', 'runs', 'runRails', 'corners', 'ends', 'walkGates', 'dblGates', 'tearOutSections', 'tearOutGates', 'adjLaborHrs', 'hasSalesman', 'priceAdjust', 'sections', 'materialCost', 'laborCost', 'tearOutCost', 'totalCOGS', 'finalPrice', 'gmPct', 'pullSheet', 'pricing']
  const body = Object.fromEntries(priced.map(k => [k, template[k]]))
  const snapshot = { materialCost: template.materialCost, laborCost: template.laborCost, tearOutCost: template.tearOutCost, totalCOGS: template.totalCOGS, gmPct: template.gmPct, pullSheet: template.pullSheet, runRails: template.runRails }
  const proposal = { version: 1, customer: { name: `E2E ${NAME}`, address: '1 Test Way, Ocala, FL 34470' }, recommended: 0, depositPct: 50, options: [{ label: 'White vinyl privacy', fenceStyle: template.fenceStyle, finalPrice: template.finalPrice, perFoot: 0, sections: template.sections, snapshot }] }
  const q = await owner('POST', '/api/saved-quotes', { id: quoteId, ...body, crmContactId: contactId, customerName: `E2E ${NAME}`, customerPhone: '3525550193', customerEmail: 'e2e-job-costing@example.invalid', customerAddress: '1 Test Way, Ocala, FL 34470', salesRep: 'E2E Salesman', leadSource: 'Other', status: 'SENT', date: '2026-10-19', proposal })
  check('owner: test customer and quote saved', c.status < 300 && q.status < 300, `${c.status} ${q.status} ${q.json.error ?? ''}`)
  const token = (await owner('POST', `/api/saved-quotes/${quoteId}/share-token`)).json.data?.shareToken ?? (await owner('POST', `/api/saved-quotes/${quoteId}/share-token`)).json.shareToken
  check('owner: the proposal link', !!token)
  check('no quoted cost before signing', sql(`SELECT count(*) FROM "JobQuotedCost" WHERE "quoteId" = '${quoteId}'`) === '0')

  // ── 2. The customer signs on the public page ──
  const cc = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const cp = await cc.newPage()
  await cp.goto(`${API}/p/${token}`); await cp.waitForSelector('#go', { timeout: 20000 })
  await cp.locator('#name').fill(`E2E ${NAME}`)
  const sig = await cp.locator('#sig').boundingBox()
  const pt = i => ({ clientX: sig.x + 30 + i * 20, clientY: sig.y + 80 + (i % 2 ? -25 : 25), pointerId: 7, pointerType: 'touch', bubbles: true })
  await cp.locator('#sig').dispatchEvent('pointerdown', pt(0))
  for (let i = 1; i <= 12; i++) await cp.locator('#sig').dispatchEvent('pointermove', pt(i))
  await cp.locator('#sig').dispatchEvent('pointerup', pt(12))
  await cp.locator('#go').click()
  const accepted = await until(async () => (await cp.locator('body').textContent()).includes('Accepted by'), 15000)
  check('customer: signed and accepted on the proposal page', !!accepted)
  await cc.close()
  const snap = sql(`SELECT "signedVia" || '|' || "priceCents" || '|' || "totalCents" || '|' || jsonb_array_length(lines::jsonb) FROM "JobQuotedCost" WHERE "quoteId" = '${quoteId}'`)
  const wantSnap = `proposal|${Math.round(template.finalPrice * 100)}|${Math.round(template.totalCOGS * 100)}|${template.pullSheet.filter(l => l.item).length}`
  check('signing saved the quoted cost once, in cents, as priced', snap === wantSnap, `${snap} vs ${wantSnap}`)
  made.jobId = await until(async () => ((await owner('GET', '/api/saved-jobs')).json.data ?? []).find(j => j.quoteId === quoteId)?.id)
  check('the signed quote became a job', !!made.jobId)
  await owner('PATCH', `/api/saved-jobs/${made.jobId}`, { scheduledDate: '2026-10-15', crewAssigned: 'E2E crew' })

  // ── 3. The installer ──
  const inv = await owner('POST', '/api/crm-auth/invite', { firstName: 'E2E', lastName: `Installer ${stamp}`, email: EMAIL, role: 'field_crew' })
  made.userId = inv.json.data?.id ?? null
  const link = new URL(inv.json.data.inviteUrl)
  const acc = await call('', 'POST', '/api/crm-auth/accept-invite', { token: link.searchParams.get('token'), email: EMAIL, password: PASSWORD })
  const INST = acc.json.data?.accessToken
  check('an Installer login (invited, accepted)', inv.status === 201 && !!INST && acc.json.data?.user?.role === 'field_crew', `${inv.status} ${acc.status}`)

  const ic = CDP ? phoneBrowser.contexts()[0] : await phoneBrowser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true })
  if (CDP) { const p0 = await ic.newPage(); await p0.goto(APP); await p0.evaluate(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, INST); await p0.close() }
  else await ic.addInitScript(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, INST)
  const errors = [], seen = []
  const wire = page => {
    page.on('pageerror', e => errors.push(String(e).slice(0, 200)))
    page.on('dialog', d => d.accept().catch(() => {}))
    // Every answer the installer's phone gets from our server.
    page.on('response', async r => {
      if (!r.url().startsWith(API) || !r.url().includes('/api/')) return
      const ct = r.headers()['content-type'] || ''
      if (!ct.includes('json')) return
      const text = await r.text().catch(() => '')
      seen.push({ url: `${r.request().method()} ${r.url().replace(API, '')}`, status: r.status(), text })
    })
    return page
  }
  let ip = wire(await ic.newPage())
  const small = []
  const tap = async (loc, what) => {
    await loc.scrollIntoViewIfNeeded(); await loc.waitFor({ state: 'visible' })
    const box = await loc.boundingBox()
    if (!box || box.height < 44 || box.width < 44) small.push(`${what} ${box ? `${Math.round(box.width)}x${Math.round(box.height)}` : '?'}`)
    await (CDP ? loc.click() : loc.tap()); await sleep(300)
  }
  await ip.goto(`${APP}/operations?job=${made.jobId}`)
  await ip.waitForSelector('[data-takeoff-panel="none"]', { timeout: 60000 })
  check('installer: the job page has the takeoff, right before the walkthrough', await ip.locator('[data-takeoff-panel] ~ [data-walkthrough-panel]').count() === 1)
  check('installer: no job cost panel on the job page', await ip.locator('[data-job-cost]').count() === 0)
  await tap(ip.locator('[data-takeoff-start]'), 'Start takeoff')
  await ip.waitForSelector('[data-takeoff-screen="draft"]')
  made.takeoffId = await until(async () => (await call(INST, 'GET', `/api/job-costing/takeoff?jobId=${made.jobId}`)).json.data?.id)
  await until(async () => (await ip.locator('[data-takeoff-line]').count()) === template.pullSheet.filter(l => l.item).length)
  const lineCount = await ip.locator('[data-takeoff-line]').count()
  check('takeoff: every pull sheet line, used = pull sheet', lineCount === template.pullSheet.filter(l => l.item).length && (await ip.locator('[data-takeoff-diff="0"]').count()) === lineCount, String(lineCount))
  check('takeoff screen shows no $ amount', !(await ip.locator('[data-takeoff-screen]').innerText()).includes('$'))

  // One more post than the pull sheet.
  const parts = template.pullSheet.map(l => l.item)
  const postPart = parts.find(p => /Post, (Line|End|Corner)/i.test(p)) ?? parts[0]
  const pick = parts.find(p => /Picket/i.test(p)) ?? parts[1]
  const postLine = ip.locator(`[data-takeoff-part="${postPart.replace(/"/g, '\\"')}"]`)
  await tap(postLine.locator('[data-qty-plus^="used:"]'), '+ post')
  check('+ counts one more post: "1 over"', /1 over/.test(await postLine.locator('[data-takeoff-diff]').innerText()))
  // Pickets: 4 fewer used, 4 back to the shop.
  const pickLine = ip.locator(`[data-takeoff-part="${pick.replace(/"/g, '\\"')}"]`)
  for (let i = 0; i < 4; i++) await tap(pickLine.locator('[data-qty-minus^="used:"]'), '− picket')
  await tap(pickLine.locator('[data-takeoff-more]'), 'Returns')
  for (let i = 0; i < 4; i++) await tap(pickLine.locator('[data-qty-plus^="shop:"]'), '+ back to shop')
  check('pickets: 4 under, 4 back to the shop', /4 under/.test(await pickLine.locator('[data-takeoff-diff]').innerText()) && (await pickLine.locator('[data-qty-value^="shop:"]').inputValue()) === '4')
  await postLine.scrollIntoViewIfNeeded()
  if (SHOTS) await ip.screenshot({ path: path.join(SHOTS, CDP ? 'dev-takeoff-android.png' : 'dev-takeoff-phone.png') })

  // An item not on the pull sheet: a broken rail (searched in Inventory), with a photo.
  await tap(ip.locator('[data-takeoff-add]'), 'Add an item')
  await ip.waitForSelector('[data-takeoff-add-sheet]')
  await tap(ip.locator('[data-takeoff-reason="broken"]'), 'Broken')
  await ip.locator('[data-takeoff-search]').fill("white rail 8'")
  await sleep(400)
  const firstHit = ip.locator('[data-takeoff-item]').first()
  const hasHit = await firstHit.count() > 0
  check('add an item: Inventory is searchable on the installer\'s phone', hasHit, String(await ip.locator('[data-takeoff-item]').count()))
  const addedName = hasHit ? (await firstHit.locator('span').first().innerText()).trim() : "white rail 8'"
  if (!CDP && SHOTS) await ip.screenshot({ path: path.join(SHOTS, 'dev-takeoff-add-item.png') })
  await tap(hasHit ? firstHit : ip.locator('[data-takeoff-free]'), 'the item')
  const extra = ip.locator('[data-takeoff-line]').filter({ hasText: 'Broken' }).last()
  await extra.waitFor({ timeout: 10000 })
  check('added on the job: the item, marked Broken, used 1', (await extra.innerText()).includes(addedName) && (await extra.locator('[data-qty-value^="used:"]').inputValue()) === '1', addedName)
  const extraId = await extra.getAttribute('data-takeoff-line')
  await extra.locator('[data-takeoff-file]').setInputFiles(photo())
  const photoShown = await until(async () => (await extra.locator('[data-takeoff-photo]').count()) > 0, 15000)
  check('a photo on the line (through the media queue)', !!photoShown)

  // Labor: sub sections paid.
  await ip.locator('[data-takeoff-labor-mode]').first().scrollIntoViewIfNeeded()
  const subOn = await ip.locator('[data-takeoff-labor-mode="sub"][aria-checked="true"]').count() === 1
  if (!subOn) await tap(ip.locator('[data-takeoff-labor-mode="sub"]'), 'Sub')
  const subUnits = Number(await ip.locator('[data-qty-value="sub-units"]').inputValue())
  check('labor: sub sections paid start at the quote\'s sections', subUnits === template.sections, `${subUnits} vs ${template.sections}`)
  await tap(ip.locator('[data-qty-plus="sub-units"]'), '+ section paid')

  // Everything saved, then sent to the office.
  await until(async () => (await ip.locator('[data-takeoff-screen] [data-save-status="saved"]').count()) > 0, 20000)
  await tap(ip.locator('[data-takeoff-submit]'), 'Send to the office')
  const sent = await until(async () => (await call(INST, 'GET', `/api/job-costing/takeoff?jobId=${made.jobId}`)).json.data?.status === 'submitted' ? true : null, 20000)
  check('installer: sent to the office', !!sent)
  const t = (await call(INST, 'GET', `/api/job-costing/takeoff?jobId=${made.jobId}`)).json.data
  const sl = n => t.lines.find(l => l.part === n)
  check('server has: post +1, pickets −4 with 4 back to shop, the broken item with its photo, sub units +1',
    sl(postPart)?.usedQty === sl(postPart)?.plannedQty + 1 && sl(pick)?.usedQty === sl(pick)?.plannedQty - 4 && sl(pick)?.shopReturnQty === 4
    && t.lines.some(l => l.id === extraId && l.extra && l.reason === 'broken' && l.photoClientId) && t.labor.subUnits === template.sections + 1)
  await until(async () => Object.keys((await call(INST, 'GET', `/api/job-costing/takeoff?jobId=${made.jobId}`)).json.data?.media ?? {}).length > 0, 20000)

  // The server refuses the installer's approve, job cost, report.
  const refused = await Promise.all([
    call(INST, 'POST', `/api/job-costing/takeoff/${made.takeoffId}/approve`, {}),
    call(INST, 'GET', `/api/job-costing/job/${made.jobId}`),
    call(INST, 'GET', '/api/job-costing/report'),
  ])
  check('server: an installer cannot approve or see the job cost or the report (403)', refused.every(r => r.status === 403), refused.map(r => r.status).join(','))
  // Reload the phone once more (job page and takeoff) so its loads are recorded too.
  // (A fresh tab: WebKit under Playwright crashes on page.goto after a screen that used Back, see follow-ups.mjs.)
  { const old = ip; ip = wire(await ic.newPage()); await old.close().catch(() => {}) }
  await ip.goto(`${APP}/operations?job=${made.jobId}&takeoff=${made.jobId}`); await ip.waitForSelector('[data-takeoff-screen]', { timeout: 30000 }); await sleep(1500)
  check('installer: once sent, the crew\'s screen is read only', await ip.locator('[data-takeoff-submit]').count() === 0 && await ip.locator('[data-takeoff-add]').count() === 0)

  // No cost anywhere the installer's phone received.
  const costFields = new Set(), costFigures = []
  const figures = [template.totalCOGS, template.materialCost, template.laborCost].filter(n => n > 0).map(n => String(n))
  const unitCosts = new Set(template.pullSheet.map(l => l.unitCost).filter(n => n > 0))
  for (const r of seen) {
    let j = null; try { j = JSON.parse(r.text) } catch { continue }
    for (const k of keysOf(j)) if (COST_KEY.test(k) && !NOT_A_COST.has(k)) costFields.add(`${k} (${r.url})`)
    // The whole number only (":744" must not match ":7449" or ":744.5"), and say which field held it.
    for (const f of figures) {
      const esc = f.replace('.', '\\.')
      const re = new RegExp(`"([A-Za-z0-9_]+)":"?${esc}(?:\\.0+)?"?(?=[,}\\]])`, 'g')
      let m; while ((m = re.exec(r.text))) costFigures.push(`${m[1]}=${f} in ${r.url}`)
    }
    if (r.url.includes('/api/job-costing/') || r.url.includes('/api/saved-quotes')) {
      // The quote's own unit costs as a value of any field in the takeoff and quote answers.
      const walk = v => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (typeof x === 'number' && !/qty|Qty|units|sections|hours|count|version/i.test(k) && unitCosts.has(x) && x % 1 !== 0) costFigures.push(`${k}=${x} in ${r.url}`); walk(x) } }
      walk(j)
    }
  }
  const tookTakeoff = seen.filter(r => r.url.includes('/api/job-costing/takeoff')).length
  check(`installer: recorded ${seen.length} answers (${tookTakeoff} from the takeoff): no cost field`, seen.length > 10 && tookTakeoff >= 3 && costFields.size === 0, [...costFields].slice(0, 6).join(', '))
  check('installer: no cost figure (the quote\'s cost of goods, material, labor, unit costs)', costFigures.length === 0, costFigures.slice(0, 6).join(', '))
  check('every button tapped is at least 44 x 44', small.length === 0, small.join(', '))
  check('no page errors on the installer\'s phone', errors.length === 0, errors.join(' | '))
  if (CDP) await ip.close(); else await ic.close()

  // ── 4. The owner approves; quoted vs actual; the report ──
  const oc = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await oc.addInitScript(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, OWNER)
  const op = await oc.newPage()
  const oerr = []; op.on('pageerror', e => oerr.push(String(e).slice(0, 200)))
  await op.goto(`${APP}/operations?job=${made.jobId}`)
  await op.waitForSelector('[data-takeoff-panel="submitted"]', { timeout: 60000 })
  await op.waitForSelector('[data-job-cost="submitted"]', { timeout: 30000 })
  check('owner: before approval the job cost is a preview', await op.locator('[data-cost-preview]').count() === 1)
  await op.locator('[data-takeoff-open]').click()
  await op.waitForSelector('[data-takeoff-approve]')
  await op.locator('[data-takeoff-other-labor]').fill('40')
  await op.locator('[data-takeoff-approve]').scrollIntoViewIfNeeded()
  if (SHOTS) await op.screenshot({ path: path.join(SHOTS, 'dev-takeoff-approve.png') })
  await op.locator('[data-takeoff-approve]').click()
  await op.waitForSelector('[data-takeoff-screen="approved"]', { timeout: 20000 })
  check('owner: approved', true)
  const jc = (await owner('GET', `/api/job-costing/job/${made.jobId}`)).json.data
  const a = jc.comparison.actual, qd = jc.comparison.quoted
  const extraRow = jc.comparison.rows.find(r => r.extra)
  check('actual cost frozen: used x landed cost + sub sections paid x rate + other labor', jc.actualCost?.frozen === true && a.totalCents === a.materialCents + a.laborCents + a.tearOutCents + a.otherMaterialCents && /sections paid × \$[\d.]+ \+ \$40\.00 other labor/.test(a.laborMath), a.laborMath)
  check('quoted cost is the quote as signed', qd.totalCents === Math.round(template.totalCOGS * 100) && qd.priceCents === Math.round(template.finalPrice * 100))
  check('line by line: the post +1, pickets −4 (4 back to shop), the added item', jc.comparison.rows.some(r => r.part === postPart && r.qtyDiff === 1) && jc.comparison.rows.some(r => r.part === pick && r.qtyDiff === -4 && r.shopReturnQty === 4) && !!extraRow && extraRow.usedQty === 1)
  await op.locator('button[aria-label="Close the takeoff"]').click()
  await op.waitForSelector('[data-job-cost="approved"]', { timeout: 20000 })
  await op.locator('[data-job-cost]').scrollIntoViewIfNeeded()
  const shown = await op.locator('[data-job-cost]').innerText()
  const usd = c => `${c < 0 ? '-' : ''}$${(Math.abs(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  check('job page: quoted vs actual, profit and margin, line by line', shown.includes(usd(qd.totalCents)) && shown.includes(usd(a.totalCents)) && shown.includes(usd(a.profitCents)) && shown.includes(`${a.marginPct.toFixed(1)}% margin`) && await op.locator('[data-cost-row]').count() >= lineCount + 1)
  if (SHOTS) {
    // The panel's top in view (the toast gone first).
    await sleep(5500)
    await op.locator('[data-job-cost]').evaluate(e => e.scrollIntoView({ block: 'start' }))
    await sleep(300)
    await op.screenshot({ path: path.join(SHOTS, 'dev-job-quoted-vs-actual.png') })
  }
  // On a phone.
  const pc = await webkit.launch().then(b => b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true }).then(c => ({ b, c })))
  await pc.c.addInitScript(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, OWNER)
  const pp = await pc.c.newPage()
  await pp.goto(`${APP}/operations?job=${made.jobId}`)
  await pp.waitForSelector('[data-job-cost="approved"]', { timeout: 60000 })
  await pp.locator('[data-job-cost]').evaluate(e => e.scrollIntoView({ block: 'start' })); await sleep(400)
  const wide = await pp.evaluate(() => document.documentElement.scrollWidth)
  check('job cost on a phone: no sideways scroll', wide <= 390, String(wide))
  if (SHOTS) await pp.screenshot({ path: path.join(SHOTS, 'dev-job-quoted-vs-actual-phone.png') })
  await pc.b.close()

  // Reports → Job Costing.
  await op.goto(`${APP}/reports`)
  await op.locator('[data-report-tab="job_costing"]').click({ timeout: 60000 })
  await op.waitForSelector('[data-job-costing-report]', { timeout: 30000 })
  const row = op.locator(`[data-jc-job="${made.jobId}"]`)
  await row.waitFor({ timeout: 20000 })
  const rowText = await row.innerText()
  check('report: the job, quoted vs actual and profit', rowText.includes(`E2E ${NAME}`) && rowText.includes(usd(a.totalCents)) && rowText.includes(usd(qd.totalCents)), rowText.replace(/\s+/g, ' ').slice(0, 160))
  await op.locator('[data-jc-only-costed]').uncheck()
  check('report: jobs finished before job costing say "No takeoff"', await op.locator('[data-jc-no-takeoff]').filter({ hasText: 'No takeoff' }).count() > 0)
  await op.locator('[data-jc-only-costed]').check()
  if (SHOTS) await op.screenshot({ path: path.join(SHOTS, 'dev-report-job-costing.png'), fullPage: false })
  await op.locator('[data-jc-view="style"]').click()
  check('report by style: plain style name', (await op.locator('[data-jc-groups="Style"]').innerText()).length > 0 && !(await op.locator('[data-jc-groups="Style"]').innerText()).includes("WV-"))
  await op.locator('[data-jc-view="salesman"]').click()
  check('report by salesman', await op.locator('[data-jc-group="E2E Salesman"]').count() === 1)
  await op.locator('[data-jc-view="month"]').click()
  check('report by month', await op.locator('[data-jc-group="Oct 2026"]').count() === 1)
  await op.locator('[data-jc-view="parts"]').click()
  check('report: parts over / under the pull sheet', await op.locator(`[data-jc-part="${postPart.replace(/"/g, '\\"')}"]`).count() === 1 && await op.locator(`[data-jc-part="${pick.replace(/"/g, '\\"')}"]`).count() === 1)
  check('no page errors for the owner', oerr.length === 0, oerr.join(' | '))
  await oc.close()
} catch (e) {
  check('test run finished', false, String(e?.message || e).split('\n').slice(0, 3).join(' '))
} finally {
  await browser.close()
  if (!CDP) await phoneBrowser.close()
  // Remove what this made. Dev database only, named on every command.
  try {
    if (![contactId, cardId, quoteId].every(uuid) || (made.jobId && !/^[A-Za-z0-9-]+$/.test(made.jobId))) throw new Error('bad id')
    const job = made.jobId ?? '-'
    const files = sql(`SELECT path FROM "MediaItem" WHERE "jobId" = '${job}' OR "customerId" = '${contactId}'`).split('\n').filter(Boolean)
    for (const f of files) fs.rmSync(f, { force: true })
    sql(`DELETE FROM "MediaItem" WHERE "jobId" = '${job}' OR "customerId" = '${contactId}'`)
    sql(`DELETE FROM "JobTakeoff" WHERE "jobId" = '${job}'`)
    sql(`DELETE FROM "JobQuotedCost" WHERE "quoteId" = '${quoteId}'`)
    sql(`DELETE FROM "AutomationEvent" WHERE "entityId" IN ('${job}', '${quoteId}', '${cardId}', '${contactId}', 'lead-${quoteId}')`)
    sql(`DELETE FROM "JobChecklistItem" WHERE "jobId" = '${job}'`)
    sql(`DELETE FROM "SavedJob" WHERE id = '${job}'`)
    sql(`DELETE FROM "SavedQuote" WHERE id = '${quoteId}'`)
    sql(`DELETE FROM "Notification" WHERE title = 'Proposal accepted: E2E ${NAME}'`)
    const pl = (await owner('GET', '/api/pipeline')).json
    const mine = (pl?.data?.leads ?? []).filter(l => l.customerId === contactId || l.id === cardId || l.id === `lead-${quoteId}`).map(l => l.id)
    if (mine.length) await owner('PATCH', '/api/pipeline', { upsert: [], remove: mine, baseVersion: pl.data.version })
    await owner('DELETE', `/api/crm-contacts/${contactId}`)
    sql(`DELETE FROM "CrmContact" WHERE id = '${contactId}'`)
    const users = (await owner('GET', '/api/crm-auth/users')).json.data ?? []
    for (const u of users.filter(x => x.email === EMAIL)) await owner('DELETE', `/api/crm-auth/users/${u.id}`)
    const left = ((await owner('GET', '/api/crm-auth/users')).json.data ?? []).filter(x => x.email === EMAIL).length
    check('cleaned up (job, quote, quoted cost, takeoff, photos, customer, installer login)', left === 0 && sql(`SELECT count(*) FROM "JobTakeoff" WHERE "jobId" = '${job}'`) === '0' && sql(`SELECT count(*) FROM "SavedQuote" WHERE id = '${quoteId}'`) === '0')
  } catch (e) { check('cleaned up', false, String(e?.message || e).slice(0, 200)) }
}
const passed = results.filter(Boolean).length
console.log(`\n${passed} of ${results.length} checks passed (${NAMEP})`)
process.exit(passed === results.length ? 0 : 1)
