// Fence moves and repairs, end to end on the dev copy (desktop).
//
//   cd apps/web && pnpm -s build
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 E2E_ACCESS_TOKEN=<dev owner token> \
//   MEDIA_PHOTO=<a .jpg> SHOTS=<folder> node e2e/move-repair.mjs
//
//   1. Settings → Moves and Repairs: blank rates are called out; a rate typed
//      is saved on the server (read back through the API), then put back.
//   2. A move: Job type at the Style step, the old line (100 ft, 1 walk gate)
//      drawn dashed on the plan, the internal breakdown (every cost line adds
//      up to the price), save. The proposal cannot be sent with fewer than 2
//      photos until "Send anyway" with a reason. The customer page: plain
//      words, the plan, the photos marked Customer, one price, no cost lines.
//      Accepted: the job's crew packet has the steps, gate hardware, the 811
//      notice and only the NEW material.
//   3. A repair: tree or storm, damaged sections tapped on the plan, "A new
//      fence may be the better deal" with the new fence beside it, added as an
//      option; the customer picks the new fence and the quote becomes a new
//      fence at that price.
//   4. A leaning post: the $350 minimum, said internally only.
//   5. Wood: a new 100 ft wood privacy fence prices 115% of the same vinyl job.
// Screenshots: dev-move-*, dev-repair-*, dev-wood-*, dev-moves-settings*.
// Removes every quote, job and photo it made and puts Settings back.

import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import './sharedLock.mjs' // changes Settings: takes turns with the other tests that do
import { chromium } from 'playwright'
import fs from 'fs'
import path from 'path'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || 'http://localhost:4001'
const TOKEN = process.env.E2E_ACCESS_TOKEN || ''
const PHOTO = process.env.MEDIA_PHOTO || ''
const SHOTS = process.env.SHOTS || ''
const local = u => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(u)
if (!local(APP) || !local(API) || /:4000(\/|$)/.test(API) || /:4000(\/|$)/.test(APP)) { console.error('Refusing to run: the dev copy only (localhost, not port 4000).'); process.exit(2) }
if (!TOKEN || !PHOTO) { console.error('Set E2E_ACCESS_TOKEN and MEDIA_PHOTO.'); process.exit(2) }
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const api = async (p, init = {}) => {
  const r = await fetch(API + p, { ...init, headers: { Authorization: `Bearer ${TOKEN}`, ...(init.body && typeof init.body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...(init.headers || {}) } })
  const j = await r.json().catch(() => ({}))
  return j.data ?? j
}
const money = t => Number(String(t).replace(/[^\d.-]/g, ''))
async function uploadPhoto(meta) {
  const buf = fs.readFileSync(PHOTO)
  const clientId = 'e2e-move-' + Date.now() + Math.random().toString(36).slice(2)
  await api('/api/media/uploads', { method: 'POST', body: JSON.stringify({ clientId, size: buf.length, meta: { kind: 'photo', mime: 'image/jpeg', takenAt: new Date().toISOString(), ...meta } }) })
  await fetch(`${API}/api/media/uploads/${clientId}?offset=0`, { method: 'PUT', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/octet-stream' }, body: buf })
  return api(`/api/media/uploads/${clientId}/finish`, { method: 'POST' })
}

const CUSTOMER = 'Shawn Collins'
const made = { quotes: [], jobs: [], media: [] }
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
await ctx.addInitScript(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, TOKEN)
const page = await ctx.newPage()
const errors = []
page.on('pageerror', e => errors.push(String(e).slice(0, 300)))
page.on('dialog', d => d.accept().catch(() => {}))
await page.route('**/api/automations/trigger', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' }))
const shot = async (name, loc) => { if (!SHOTS) return; if (loc) await loc.scrollIntoViewIfNeeded().catch(() => {}); await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }) }
const b = page.locator('[data-quote-builder]')

async function home() { await page.goto(APP); await page.waitForSelector('[data-global-appointment]', { timeout: 30000 }); await sleep(900) }
async function settingsTab() { await page.locator('span:text-is("Settings"):visible').first().click(); await sleep(500); await page.locator('[data-settings-tab="moves"]').click(); await sleep(500) }
async function newQuote() { await page.locator('button:has-text("New quote"):visible').first().click(); await sleep(700) }
async function straight(ft, gate) {
  await b.locator('[data-step="yard"]').click()
  await b.locator('[data-shape="straight"]').click(); await sleep(300)
  if (!(await b.locator('[data-side="Fence"] [data-side-length]').isVisible().catch(() => false))) await b.locator('[data-side-row="Fence"]').click()
  await b.locator('[data-side="Fence"] [data-side-length]').click()
  for (const k of String(ft)) await page.locator(`[data-ftin-pad] [data-pad-key="${k}"]`).click()
  await page.locator('[data-ftin-pad] [data-pad-done]').click(); await sleep(300)
  if (gate) {
    if (!(await b.locator('[data-side="Fence"] [data-gate-choice]').isVisible().catch(() => false))) await b.locator('[data-side-row="Fence"]').click()
    await b.locator('[data-side="Fence"] [data-gate-choice] button:has-text("Walk gate")').click(); await sleep(300)
  }
}
async function pickStyle(label) { await b.locator('[data-style-list]').selectOption({ label }); await sleep(400) }
async function save() {
  await page.locator('[data-quote-bar] [data-save-open]').click()
  await page.locator('input[placeholder="Name, phone, or email..."]').fill(CUSTOMER); await sleep(400)
  await page.locator(`text=${CUSTOMER}`).last().click()
  await page.locator('[data-save-submit]').click(); await sleep(2500)
}
async function newest(pred) {
  const list = await api('/api/saved-quotes')
  const q = (Array.isArray(list) ? list : []).filter(x => x.customerName === CUSTOMER && pred(x)).sort((a, z) => String(z.createdAt).localeCompare(String(a.createdAt)))[0]
  if (q && !made.quotes.includes(q.id)) made.quotes.push(q.id)
  return q
}
async function breakdownAddsUp() {
  const lines = await b.locator('[data-work-line]').evaluateAll(els => els.map(e => Number(e.querySelector('.font-semibold')?.textContent.replace(/[^\d.-]/g, ''))))
  const cost = money(await b.locator('[data-work-cost]').textContent())
  return { sum: Math.round(lines.reduce((t, n) => t + n, 0) * 100) / 100, cost }
}

let saved = null
// The dev copy holds live's real pull and disposal rates; the checks below are about blank rates,
// so they are blanked for the run and the Moves and Repairs settings put back exactly afterwards.
const PULL_KEYS = ['pullNdLaborCents', 'pullDsLaborCents', 'pullNdDisposalCents', 'pullDsDisposalCents']
async function setMoveRepair(fn) {
  for (let i = 0; i < 5; i++) {
    const st = await api('/api/business-state')
    const r = await fetch(API + '/api/business-state', { method: 'PATCH', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ config: { ...st.config, moveRepair: fn(st.config.moveRepair) }, baseVersion: st.version }) })
    if (r.ok) return
  }
  throw new Error('could not save the Moves and Repairs settings')
}
const mrBefore = (await api('/api/business-state')).config?.moveRepair
await setMoveRepair(mr => Object.fromEntries(Object.entries(mr ?? {}).filter(([k]) => !PULL_KEYS.includes(k))))
try {
  // ── 1. Settings → Moves and Repairs ──
  await home(); await settingsTab()
  const blankText = (await page.locator('[data-mr-blank]').textContent().catch(() => '')) || ''
  check('Settings: the blank rates are listed', /Pull labor per post, no dig/.test(blankText) && /Disposal per post, dig set/.test(blankText), blankText.slice(0, 120))
  check('Settings: every multiplier and rate with a plain label', await page.locator('[data-move-repair-settings] [data-mr]').count() >= 16)
  await shot('dev-moves-settings')
  const before = (await api('/api/business-state')).config?.moveRepair ?? null
  await page.locator('[data-mr="minimumJobCents"]').fill('375')
  await page.locator('button:has-text("Save Changes")').click(); await sleep(1500)
  const after = (await api('/api/business-state')).config?.moveRepair
  check('Settings: the minimum job price is saved on the server in cents', after?.minimumJobCents === 37500, JSON.stringify(after?.minimumJobCents))
  await page.reload(); await page.waitForSelector('[data-global-appointment]'); await sleep(800); await settingsTab()
  check('Settings: it reads back after a reload (another browser sees it)', (await page.locator('[data-mr="minimumJobCents"]').inputValue()) === '375.00')
  await page.locator('[data-mr="minimumJobCents"]').fill('350')
  await page.locator('button:has-text("Save Changes")').click(); await sleep(1500)
  check('Settings: put back to $350', (await api('/api/business-state')).config?.moveRepair?.minimumJobCents === 35000 && before?.pullNdLaborCents == null)

  // ── 2. A move ──
  await home(); await newQuote()
  await b.locator('input[placeholder^="Customer name"]').fill(CUSTOMER)
  // The new line: 100 ft of fence and a 4 ft walk gate (the side is 104 ft).
  await straight(104, true)
  await b.locator('[data-step="style"]').click(); await sleep(300)
  check('Style step: Job type New fence / Move fence / Repair, New fence first', (await b.locator('[data-job-type-option]').allTextContents()).join(',') === 'New fence,Move fence,Repair' && await b.locator('[data-job-type-option="new"][aria-checked="true"]').count() === 1)
  await b.locator('[data-job-type-option="move"]').click()
  await pickStyle('White Vinyl Privacy, 6 ft tall, 6 ft panels, No dig')
  await b.locator('[data-move-old-ft]').fill('100')
  await b.locator('[data-move-old-walk]').fill('1')
  check('Move: old sections and posts fill in from the footage, per run either side of the gate (2 × 9 = 18 sections, 20 posts)', (await b.locator('[data-move-old-sections]').getAttribute('placeholder')).startsWith('18') && (await b.locator('[data-move-old-posts]').getAttribute('placeholder')).startsWith('20'))
  check('Move: old post type defaults from the style (no dig)', await b.locator('[data-move-panel] [data-post-type="nd"][aria-pressed="true"]').count() === 1)
  await b.locator('[data-move-old-side]').selectOption({ label: 'Fence' }); await sleep(400)
  check('Move: the old line is drawn dashed on the plan', await b.locator('[data-move-old-plan] [data-plan-old-line]').count() === 1)
  await shot('dev-move-1-job-type-and-old-line', b.locator('[data-job-type]'))
  await shot('dev-move-2-old-line-dashed', b.locator('[data-move-old-plan]'))
  await b.locator('[data-step="price"]').click(); await sleep(500)
  const lineKeys = await b.locator('[data-work-line]').evaluateAll(els => els.map(e => e.getAttribute('data-work-line')))
  check('Move: every cost line (removal, gate removal, post pull, disposal, new posts, setting, damage, gate hardware, reinstall, rehang)',
    ['removal', 'removalWalk', 'pull', 'disposal', 'newPosts', 'setting', 'damage', 'gateHardware', 'reinstall', 'rehangWalk'].every(k => lineKeys.includes(k)), lineKeys.join(','))
  const add = await breakdownAddsUp()
  check('Move: the lines add up to the total cost', Math.abs(add.sum - add.cost) < 0.011, `${add.sum} vs ${add.cost}`)
  const warn = (await b.locator('[data-step-panel="price"]').textContent()).replace(/\s+/g, ' ')
  check('Move: blank post pull rates show the missing rate warning; the 811 reminder shows', /No rate per .*pull labor per post \(no dig\), per disposal per post \(no dig\) is set/.test(warn) && /811 locate ticket/.test(warn), warn.slice(warn.indexOf('Check before'), warn.indexOf('Check before') + 300))
  check('Move: same length, so no extra or leftover sections', !lineKeys.includes('extra') && !lineKeys.includes('leftover'))
  const movePrice = money(await b.locator('[data-quote-price]').textContent())
  check('Move: priced (no per foot line, no Good Better Best)', movePrice > 0 && await b.locator('[data-tiers]').count() === 0, String(movePrice))
  await shot('dev-move-3-internal-breakdown', b.locator('[data-work-breakdown]'))
  await save()
  saved = await newest(x => x.work?.type === 'move')
  check('Move saved: job type, inputs and every cost line kept with it', !!saved && saved.work.move.oldFt === 100 && saved.work.priced.lines.length >= 10 && Math.abs(saved.finalPrice - movePrice) < 0.01)
  check('Move saved: the pull sheet is only NEW material (no tear out, no panels beyond the damage allowance)', saved.pullSheet.every(i => !/Tear Out/.test(i.item)) && saved.pullSheet.some(i => /Post, Line/.test(i.item)))
  check('Move saved: the proposal is a move with one option at the price', saved.proposal.kind === 'move' && saved.proposal.options.length === 1 && saved.proposal.options[0].finalPrice === saved.finalPrice && /<svg/.test(saved.proposal.planSvg || '') && /data-plan-old-line/.test(saved.proposal.planSvg))

  // Sending: 2 photos first, or Send anyway with a reason.
  await page.goto(`${APP}/?customer=${saved.crmContactId}`); await page.waitForSelector('[data-global-appointment]'); await sleep(1200)
  await page.locator('button.capitalize', { hasText: /^quotes/i }).first().click(); await sleep(500)
  await page.locator(`text=$${Math.round(saved.finalPrice).toLocaleString('en-US')}`).first().click(); await sleep(1200)
  check('Send: blocked with 0 of 2 photos (Text it and Copy link off)', await page.locator('[data-photos-needed]').count() === 1 && await page.locator('[data-proposal-copy]').isDisabled())
  await shot('dev-move-4-photos-needed', page.locator('[data-proposal-send]'))
  await page.locator('[data-photos-override]').click()
  await page.locator('[data-photos-reason]').fill('Customer sent photos by text')
  await page.locator('[data-photos-override-ok]').click(); await sleep(1500)
  const ov = await api(`/api/saved-quotes/${saved.id}`)
  check('Send anyway: one tap with a reason, kept on the quote', ov.work?.photoOverride?.reason === 'Customer sent photos by text' && await page.locator('[data-photos-overridden]').count() === 1 && !(await page.locator('[data-proposal-copy]').isDisabled()))
  for (const c of ['The old fence, front', 'Where it moves to']) made.media.push(await uploadPhoto({ quoteKey: saved.id, caption: c, category: 'Before', visibility: 'customer' }))
  made.media.push(await uploadPhoto({ quoteKey: saved.id, caption: 'Office only', category: 'Before', visibility: 'internal' }))

  const token = (await api(`/api/saved-quotes/${saved.id}/share-token`, { method: 'POST' })).shareToken
  const res = await fetch(`${API}/p/${token}`)
  const html = await res.text()
  check('Customer page: plain words of the move', html.includes('Fence move proposal') && html.includes('Carefully remove 100 ft of fence and 1 walk gate, reinstall on the new line with all new posts, new gate hardware'))
  check('Customer page: no cost lines, rates or minimum', !/removal|disposal|Damage allowance|Minimum job|materialCost|Cents|Target Margin/i.test(html.replace(/Carefully remove/g, '')))
  const shared = await api(`/api/saved-quotes/share/${token}`).catch(() => null)
  check('Customer data link: the job type only, no work lines', !shared || !shared.work || JSON.stringify(shared.work) === '{"type":"move"}', JSON.stringify(shared?.work))
  const cp = await ctx.newPage()
  cp.on('pageerror', e => errors.push('customer: ' + String(e).slice(0, 200)))
  await cp.setViewportSize({ width: 412, height: 915 })
  await cp.goto(`${API}/p/${token}`); await sleep(1500)
  check('Customer page: the 2 photos marked Customer show (the internal one does not), and load', await cp.locator('img[src*="/media/"]').count() === 2 && await cp.locator('img[src*="/media/"]').first().evaluate(i => i.complete && i.naturalWidth > 0))
  check('Customer page: site plan with the dashed old line, one price', await cp.locator('.plan svg [data-plan-old-line]').count() === 1 && await cp.locator('.opt').count() === 1)
  if (SHOTS) await cp.screenshot({ path: path.join(SHOTS, 'dev-move-5-customer-proposal.png'), fullPage: true })
  // Accept: the job is made, then its crew packet.
  await cp.locator('#name').fill(CUSTOMER)
  const sig = await cp.locator('#sig').boundingBox()
  const pt = i => ({ clientX: sig.x + 30 + i * 20, clientY: sig.y + 80 + (i % 2 ? -25 : 25), pointerId: 7, pointerType: 'touch', bubbles: true })
  await cp.locator('#sig').dispatchEvent('pointerdown', pt(0)); for (let i = 1; i <= 10; i++) await cp.locator('#sig').dispatchEvent('pointermove', pt(i)); await cp.locator('#sig').dispatchEvent('pointerup', pt(10))
  await cp.locator('#go').click(); await sleep(2500)
  const sold = await api(`/api/saved-quotes/${saved.id}`)
  check('Accepted: still a move, at the price', sold.status === 'SOLD' && sold.work?.type === 'move' && sold.finalPrice === saved.finalPrice)
  const job = (await api('/api/saved-jobs')).find(j => j.quoteId === saved.id)
  if (job) made.jobs.push(job.id)
  await page.goto(`${APP}/operations?job=${job?.id}`); await page.waitForSelector('[data-global-appointment]', { timeout: 30000 }); await sleep(2500)
  let packetUrl = ''
  if (await page.locator('[data-packet-send]').count()) { await page.locator('[data-packet-send]').click(); await sleep(2500); packetUrl = (await page.locator('[data-packet-url]').textContent().catch(() => '')).trim() }
  const ptoken = packetUrl.split('/p/i/')[1]
  check('Crew packet: sent from the job', !!ptoken, packetUrl)
  if (ptoken) {
    const crew = await ctx.newPage(); await crew.setViewportSize({ width: 412, height: 915 })
    await crew.goto(`${API}/p/i/${ptoken}`); await sleep(1500)
    const t = (await crew.locator('body').textContent()).replace(/\s+/g, ' ')
    check('Crew packet: label and stack the sections in order, which posts come out and how, gate hardware', t.includes('Fence move: what to do') && t.includes('number each section and gate in order') && t.includes('Pull all 20 old posts (no dig: pull the pipe and donuts)') && t.includes('Gate hardware') && t.includes('Hinge'))
    check('Crew packet: 811 ticket needed, the pull sheet is only the NEW material, no prices', t.includes('an 811 locate ticket is needed') && t.includes('only the NEW material') && !/\$\d/.test(t.replace(/Office[^·]*/, '')))
    check('Crew packet: post spacing on the new line and the dashed old line on the plan', t.includes('Posts apart') && await crew.locator('.plan svg [data-plan-old-line]').count() === 1)
    if (SHOTS) await crew.screenshot({ path: path.join(SHOTS, 'dev-move-6-crew-packet.png'), fullPage: true })
    await crew.close()
  }
  await cp.close()

  // ── 3. A repair: tree or storm, sections tapped, new fence may be better ──
  await home(); await newQuote()
  await b.locator('input[placeholder^="Customer name"]').fill(CUSTOMER)
  await straight(30, false)
  await b.locator('[data-step="style"]').click(); await sleep(300)
  await b.locator('[data-job-type-option="repair"]').click()
  await pickStyle('Tan Vinyl Privacy, 6 ft tall, 6 ft panels, Dig set')
  await b.locator('[data-what="storm"]').click(); await sleep(200)
  check('Repair: "What happened?" fills a starting list (replace a section, a post, haul debris)', await b.locator('[data-repair-item="replaceSection"] [data-stepper-value]').textContent() === '1' && await b.locator('[data-repair-item="replacePost"] [data-stepper-value]').textContent() === '1')
  // A tap on a section of the plan (a straight line has no height, so the tap is sent to it directly).
  for (const k of ['0:0', '0:1', '0:2']) { await b.locator(`[data-repair-plan] [data-plan-section="${k}"]`).dispatchEvent('click'); await sleep(150) }
  check('Repair: tapped sections show red and set the sections to replace (3)', await b.locator('[data-repair-plan] [data-plan-damaged]').count() === 3 && await b.locator('[data-repair-item="replaceSection"] [data-stepper-value]').textContent() === '3')
  await b.locator('[data-toggle="debris-cleared"] input').check()
  await shot('dev-repair-1-what-happened-items', b.locator('[data-repair-panel]'))
  await b.locator('[data-step="price"]').click(); await sleep(500)
  check('Repair: "A new fence may be the better deal" with the new fence price beside it', await b.locator('[data-new-fence-better]').count() === 1 && money(await b.locator('[data-new-fence-price]').textContent()) > 0)
  const rAdd = await breakdownAddsUp()
  check('Repair: dig set post pull and disposal lines, lines add up', (await b.locator('[data-work-line="replacePost:pull"]').textContent()).includes('dig set') && Math.abs(rAdd.sum - rAdd.cost) < 0.011)
  await b.locator('[data-offer-new-fence]').click(); await sleep(300)
  await shot('dev-repair-2-new-fence-may-be-better', b.locator('[data-new-fence-better]'))
  await save()
  const rq = await newest(x => x.work?.type === 'repair' && x.proposal?.options?.length === 2)
  check('Repair saved: two options, Repair and New fence instead; Good Better Best off', rq?.proposal?.options?.[0]?.label === 'Repair' && /^New fence instead/.test(rq?.proposal?.options?.[1]?.label) && !rq.proposal.options.some(o => o.tier))
  const rtoken = (await api(`/api/saved-quotes/${rq.id}/share-token`, { method: 'POST' })).shareToken
  const rp = await ctx.newPage(); await rp.setViewportSize({ width: 412, height: 915 })
  await rp.goto(`${API}/p/${rtoken}`); await sleep(1200)
  const rt = (await rp.locator('body').textContent()).replace(/\s+/g, ' ')
  check('Repair customer page: plain words, two prices, no cost lines', rt.includes('Fence repair proposal') && /replace 3 sections/i.test(rt) && await rp.locator('.opt').count() === 2 && !/disposal|labor/i.test(rt))
  if (SHOTS) await rp.screenshot({ path: path.join(SHOTS, 'dev-repair-3-customer-proposal.png'), fullPage: true })
  await rp.locator('.opt').nth(1).click()
  await rp.locator('#name').fill(CUSTOMER)
  const s2 = await rp.locator('#sig').boundingBox()
  const p2 = i => ({ clientX: s2.x + 30 + i * 20, clientY: s2.y + 80 + (i % 2 ? -25 : 25), pointerId: 7, pointerType: 'touch', bubbles: true })
  await rp.locator('#sig').dispatchEvent('pointerdown', p2(0)); for (let i = 1; i <= 10; i++) await rp.locator('#sig').dispatchEvent('pointermove', p2(i)); await rp.locator('#sig').dispatchEvent('pointerup', p2(10))
  await rp.locator('#go').click(); await sleep(2500)
  const rsold = await api(`/api/saved-quotes/${rq.id}`)
  check('Customer chose the new fence: the quote becomes a new fence at that price', rsold.status === 'SOLD' && rsold.work === null && rsold.finalPrice === rq.proposal.options[1].finalPrice)
  const rjob = (await api('/api/saved-jobs')).find(j => j.quoteId === rq.id)
  if (rjob) made.jobs.push(rjob.id)
  await rp.close()

  // ── 4. A leaning post: the minimum ──
  // Live's repair multipliers (copied to dev) price a leaning post above $350 ($449 on Oct 23), so the
  // minimum is raised to $600 for this step only, to see it applied; put back to $350 right after.
  await setMoveRepair(mr => ({ ...mr, minimumJobCents: 60000 }))
  await home(); await newQuote()
  await b.locator('[data-step="style"]').click(); await sleep(300)
  await b.locator('[data-job-type-option="repair"]').click()
  await pickStyle('White Vinyl Privacy, 6 ft tall, 6 ft panels, No dig')
  await b.locator('[data-what="leaning"]').click(); await sleep(200)
  await b.locator('[data-step="price"]').click(); await sleep(500)
  const leanText = await b.locator('[data-work-breakdown]').textContent().catch(() => '')
  check('Minimum: a leaning post prices at the $600.00 minimum', money(await b.locator('[data-quote-price]').textContent()) === 600, `${await b.locator('[data-quote-price]').textContent()} | ${leanText.slice(0, 300)}`)
  check('Minimum: "Minimum job price applied" shows internally', await b.locator('[data-price-minimum]').count() === 1 && await b.locator('[data-minimum-applied]').count() === 1)
  await shot('dev-repair-4-minimum-applied', b.locator('[data-work-breakdown]'))
  await b.locator('[data-quote-close]').click(); await sleep(500)
  await setMoveRepair(mr => ({ ...mr, minimumJobCents: 35000 }))

  // ── 5. Wood ──
  await home(); await newQuote()
  await straight(100, false)
  await b.locator('[data-step="style"]').click(); await sleep(300)
  await pickStyle('White Vinyl Privacy, 6 ft tall, 6 ft panels, No dig')
  await b.locator('[data-step="price"]').click(); await sleep(400)
  const vinylPrice = money(await b.locator('[data-quote-price]').textContent())
  await b.locator('[data-step="style"]').click(); await sleep(200)
  await pickStyle('Wood Privacy, 6 ft tall, 6 ft panels, No dig')
  await b.locator('[data-step="price"]').click(); await sleep(400)
  const woodPrice = money(await b.locator('[data-quote-price]').textContent())
  // Both prices are rounded down to the whole dollar (Oct 21 2026): the vinyl's dropped cents (under $1) × 1.15, and the wood's own.
  check('Wood: a new 100 ft wood privacy fence is 115% of the same vinyl job (whole dollars, ± rounding)', woodPrice % 1 === 0 && vinylPrice % 1 === 0 && woodPrice - vinylPrice * 1.15 > -1.03 && woodPrice - vinylPrice * 1.15 < 1.18, `${woodPrice} vs ${vinylPrice} × 1.15 = ${(vinylPrice * 1.15).toFixed(2)}`)
  const pull = (await b.locator('text=Pull sheet').locator('..').locator('..').textContent().catch(() => '')) || (await b.textContent())
  check('Wood: the pull sheet names wood parts and carries the wood material line', /Wood, Picket/.test(pull) && /Wood material: White Vinyl Privacy/.test(pull))
  await shot('dev-wood-1-new-fence-quote', b.locator('[data-quote-price]'))
  await b.locator('[data-quote-close]').click(); await sleep(500)

  check('No page errors', errors.length === 0, errors.join(' | '))
} catch (e) {
  check('test run finished', false, String(e).split('\n').slice(0, 3).join(' '))
} finally {
  await setMoveRepair(() => mrBefore).catch(e => console.error('Could not put Moves and Repairs back:', e))
  for (const m of made.media) if (m?.id) await api(`/api/media/${m.id}`, { method: 'DELETE' })
  for (const j of made.jobs) await api(`/api/saved-jobs/${j}`, { method: 'DELETE' })
  for (const q of made.quotes) await api(`/api/saved-quotes/${q}`, { method: 'DELETE' })
  await browser.close()
}
const passed = results.filter(Boolean).length
console.log(`\n${passed} of ${results.length} checks passed`)
process.exit(passed === results.length ? 0 : 1)
