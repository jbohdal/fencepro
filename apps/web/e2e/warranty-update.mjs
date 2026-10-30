// "Send updated warranty", end to end on the dev copy (4001 serves the built
// app: run `pnpm -s build` in apps/web first).
//
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 E2E_ACCESS_TOKEN=<dev owner token> \
//     [E2E_SHOTS=<folder>] node e2e/warranty-update.mjs
//
// Two proposals as they went out before Oct 20, 2026 (one 1 Year block, no
// warranty per option): dig set, no dig, tan no dig.
//   1. Sent, unsigned. Staff (desktop) open the quote, "Send updated warranty",
//      see 1 Year / Lifetime / Lifetime, copy the link. The customer opens it on
//      a desktop and on a phone (WebKit, 390 x 844): the note, a badge per
//      option, prices identical to the link that was sent (which still shows
//      what was sent). The phone accepts the no dig option on the new link: the
//      signed contract has the Lifetime words.
//   2. Sold (accepted on the old link, tan no dig, 1 Year). Staff on a phone
//      (WebKit, 390 x 844) open the job, "Send updated warranty", copy the link.
//      The customer opens it on a phone, types their name, Acknowledge. The job
//      page then shows Lifetime and "Warranty updated on ..."; a second browser
//      sees the same after a reload; the customer's history shows the update
//      sent, opened and acknowledged. The quote's price never changes.
// Removes everything it made (hard deletes on ezbiz_dev only).
import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import './sharedLock.mjs' // makes customers, quotes and jobs on the shared dev copy
import { webkit, chromium } from 'playwright'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import zlib from 'zlib'
import { execFileSync } from 'child_process'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || 'http://localhost:4001'
const OWNER = process.env.E2E_ACCESS_TOKEN || ''
const SHOTS = process.env.E2E_SHOTS || process.env.SHOTS || ''
if (!/localhost:\d+/.test(APP) || !/localhost:\d+/.test(API)) { console.error('Refusing to run: the dev copy only (localhost:4001).'); process.exit(2) }
if (!OWNER) { console.error('Set E2E_ACCESS_TOKEN (an owner login on the dev server).'); process.exit(2) }
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const call = async (method, p, body) => {
  const r = await fetch(`${API}${p}`, { method, headers: { Authorization: `Bearer ${OWNER}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: r.status, json: await r.json().catch(() => ({})) }
}
async function until(fn, ms = 20000, every = 400) { const end = Date.now() + ms; for (;;) { const v = await fn().catch(() => null); if (v || Date.now() > end) return v; await sleep(every) } }
const sql = q => execFileSync('psql', ['-d', 'ezbiz_dev', '-At', '-c', q]).toString().trim()
const uuid = s => /^[0-9a-f-]{36}$/i.test(s)

/** The words in a pdfkit PDF (as apps/portal/tests/pdfText.ts). */
function pdfText(buf) {
  const raw = buf.toString('latin1'), parts = []
  for (const s of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let body = s[1]
    try { body = zlib.inflateSync(Buffer.from(s[1], 'latin1')).toString('latin1') } catch { /* not compressed */ }
    if (!/\bBT\b/.test(body)) continue
    for (const r of body.matchAll(/\[([^\]]*)\]\s*TJ|(<[0-9a-fA-F\s]*>|\([^)]*\))\s*Tj/g)) {
      let out = ''
      for (const m of (r[1] ?? r[2]).matchAll(/<([0-9a-fA-F\s]*)>|\(([^)]*)\)/g)) {
        if (m[1] !== undefined) { const h = m[1].replace(/\s+/g, ''); for (let i = 0; i + 1 < h.length; i += 2) out += String.fromCharCode(parseInt(h.slice(i, i + 2), 16)) } else out += m[2]
      }
      parts.push(out)
    }
  }
  return parts.join(' ').replace(/\x92/g, "'").replace(/\s+/g, ' ').trim()
}

const LIFETIME = 'For as long as you own your home, Getter Done Fence will repair or replace, at no cost to you, any part of this fence that fails because of our installation'
const ONE_YEAR_TEXT = 'Materials are covered by the manufacturer\'s warranty. Workmanship is warranted for 1 year from installation date against defects in workmanship. Warranty does not cover damage from impact, severe weather, or misuse.'
const LIFE = 'Lifetime Craftsmanship Warranty', ONE = '1 Year Workmanship Warranty'
const stamp = Date.now().toString(36).slice(-6)
const NAME = `Wupdate ${stamp}`
const contactId = crypto.randomUUID(), cardId = crypto.randomUUID()
const quoteIds = [crypto.randomUUID(), crypto.randomUUID()]
const jobs = []
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })

const snap = price => ({ materialCost: price * 0.4, laborCost: price * 0.2, tearOutCost: 0, totalCOGS: price * 0.6, gmPct: 0.4, pullSheet: [], runSections: [19] })
const opt = (label, fenceStyle, price) => ({ label, fenceStyle, finalPrice: price, perFoot: Math.round(price / 1.5) / 100, sections: 19, snapshot: snap(price) })
// The second quote at half the price: a different job (proposalAccepted.ts, within 10%).
const OPTS = (k = 1) => [opt('White vinyl privacy, dig set', "WV-DS 6'x8' Privacy", 10655.85 * k), opt('White vinyl privacy, no dig', "WV-ND 6'x8' Privacy", 12900.91 * k), opt('Tan vinyl privacy, no dig', "TV-ND 6'x8' Privacy", 14814.7 * k)]
async function makeOldQuote(id, k = 1) {
  const q = await call('POST', '/api/saved-quotes', {
    id, crmContactId: contactId, customerName: `E2E ${NAME}`, customerPhone: '3525550193', customerEmail: 'e2e-wupdate@example.invalid', customerAddress: '5 Update Way, Ocala, FL 34470',
    fenceStyle: "WV-DS 6'x8' Privacy", runs: [150], sections: 19, corners: 0, ends: 2, walkGates: 1, materialCost: 4000 * k, laborCost: 2000 * k, tearOutCost: 0, totalCOGS: 6000 * k, finalPrice: OPTS(k)[0].finalPrice, gmPct: 0.4,
    pullSheet: [], status: 'SENT', date: today, salesRep: 'E2E Salesman', leadSource: 'Other',
    proposal: { version: 1, customer: { name: `E2E ${NAME}`, address: '5 Update Way, Ocala, FL 34470' }, company: { name: 'Getter Done Fence', phone: '3527894314', email: '' }, footageFt: 150, gatesText: '1 walk gate', included: ['150 ft of new fence'], recommended: 0, depositPct: 50, options: OPTS(k) },
  })
  // As sent before Oct 20, 2026: no warranty per option, one 1 Year block (this test's own quote, on the dev copy).
  sql(`UPDATE "SavedQuote" SET proposal = jsonb_set(proposal, '{options}', (SELECT jsonb_agg(o - 'warranty') FROM jsonb_array_elements(proposal->'options') o)) || jsonb_build_object('warranty', '${ONE_YEAR_TEXT.replace(/'/g, "''")}') WHERE id = '${id}'`)
  const t = (await call('POST', `/api/saved-quotes/${id}/share-token`)).json.data?.shareToken
  return { status: q.status, token: t }
}
async function sign(page, who) {
  await page.locator('#name').fill(who)
  const sig = await page.locator('#sig').boundingBox()
  const pt = i => ({ clientX: sig.x + 30 + i * 20, clientY: sig.y + 80 + (i % 2 ? -25 : 25), pointerId: 7, pointerType: 'touch', bubbles: true })
  await page.locator('#sig').dispatchEvent('pointerdown', pt(0))
  for (let i = 1; i <= 12; i++) await page.locator('#sig').dispatchEvent('pointermove', pt(i))
  await page.locator('#sig').dispatchEvent('pointerup', pt(12))
  await page.locator('#go').click()
  return until(async () => (await page.locator('body').textContent()).includes('Accepted by'), 15000)
}
const quoteRow = id => sql(`SELECT concat_ws('|', status, "finalPrice", "fenceStyle", "materialCost", "laborCost", "totalCOGS", md5(proposal::text)) FROM "SavedQuote" WHERE id = '${id}'`)
const staffContext = async (b, opts) => { const c = await b.newContext(opts); await c.addInitScript(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, OWNER); return c }

const browser = await chromium.launch()
const phoneBrowser = await webkit.launch()
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true }
// The customer's own phone and computer: never the staff device (lib/proposalViews.ts tells staff apart by address and browser).
const CUSTOMER_PHONE = { ...PHONE, userAgent: `Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1 e2e-customer-${stamp}` }
try {
  // ── Setup: a test customer (with a card), a sent proposal and a sold one, both from before the change ──
  const c = await call('POST', '/api/crm-contacts', { id: contactId, firstName: 'E2E', lastName: NAME, phone: '3525550193', email: 'e2e-wupdate@example.invalid', leadSource: 'Other', lead: { id: cardId, customerId: contactId, firstName: 'E2E', lastName: NAME, phone: '3525550193', stage: 'Proposal Sent', leadSource: 'Other', createdAt: today, lastMoved: today }, leadBefore: null })
  const sent = await makeOldQuote(quoteIds[0])
  const sold = await makeOldQuote(quoteIds[1], 0.5)
  const acc = await fetch(`${API}/p/${sold.token}/accept`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ option: 2, name: `E2E ${NAME}`, signature: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' }) })
  jobs.push(await until(async () => ((await call('GET', '/api/saved-jobs')).json.data ?? []).find(j => j.quoteId === quoteIds[1])?.id))
  check('setup: test customer, a sent proposal and a sold one (one old 1 Year block), the sold one a job',
    c.status < 300 && sent.status < 300 && sold.status < 300 && !!sent.token && acc.status === 200 && !!jobs[0])
  const sentBefore = quoteRow(quoteIds[0]), soldBefore = quoteRow(quoteIds[1])

  // ── 1. The sent proposal: staff on a desktop ──
  const dc = await staffContext(browser, { viewport: { width: 1440, height: 1000 } })
  const d = await dc.newPage()
  const errors = []
  d.on('pageerror', e => errors.push(String(e).slice(0, 200)))
  await d.goto(`${APP}/?customer=${contactId}`); await d.waitForSelector('[data-global-appointment]', { timeout: 30000 }); await sleep(1200)
  await d.locator('[data-customer-tab="quotes"]').first().click(); await sleep(500)
  // The sent quote's row on the Quotes tab (the summary tiles above can show the same amount).
  await d.locator(`[data-customer-quote="${quoteIds[0]}"]`).first().click()
  await d.waitForSelector('[data-proposal-send] [data-wu-start]', { timeout: 15000 })
  await d.locator('[data-wu-start]').click()
  await d.waitForSelector('[data-wu-panel] [data-wu-now]')
  const nows = await d.locator('[data-wu-panel] [data-wu-now]').allTextContents()
  check('quote drawer: Send updated warranty shows each option now: 1 Year, Lifetime, Lifetime', JSON.stringify(nows) === JSON.stringify([ONE, LIFE, LIFE]), JSON.stringify(nows))
  check('quote drawer: the no dig options say "was 1 Year", the dig set "no change"', (await d.locator('[data-wu-option="1"]').textContent()).includes(`was ${ONE}`) && (await d.locator('[data-wu-option="0"]').textContent()).includes('no change'))
  check('quote drawer: Text it / Email it / Copy link / Open', await d.locator('[data-wu-text]').count() === 1 && await d.locator('[data-wu-email]').count() === 1 && await d.locator('[data-wu-copy]').count() === 1 && await d.locator('[data-wu-open]').count() === 1)
  if (SHOTS) { await d.locator('[data-wu-panel]').scrollIntoViewIfNeeded(); await d.screenshot({ path: path.join(SHOTS, 'dev-warranty-update-send.png') }) }
  await d.locator('[data-wu-copy]').click()
  const sentUrl = await until(async () => (await d.locator('[data-wu-url]').textContent())?.trim(), 10000)
  check('Copy link: a new link /p/wu/<link>, marked sent', /\/p\/wu\/[A-Za-z0-9_-]{20,}$/.test(sentUrl || '') && !!(await until(async () => /sent .*link copied/.test(await d.locator('[data-wu-status]').textContent()), 8000)), sentUrl)
  check('the sent quote is unchanged', quoteRow(quoteIds[0]) === sentBefore)

  // The customer on a desktop: the note, badges, prices identical to the link that was sent.
  const cd = await browser.newContext({ viewport: { width: 1280, height: 900 }, userAgent: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 e2e-customer-${stamp}` })
  const cp = await cd.newPage()
  await cp.goto(sentUrl.replace(/^https?:\/\/[^/]+/, API)); await cp.waitForSelector('[data-wu-note]', { timeout: 20000 })
  const note = (await cp.locator('[data-wu-note]').textContent()).trim()
  check('customer (desktop): "We\'ve updated the warranty on your fence: Lifetime Craftsmanship Warranty. Your price and everything else stay the same."', note.startsWith(`We've updated the warranty on your fence: ${LIFE}. Your price and everything else stay the same.`), note)
  check('customer (desktop): a badge per option: 1 Year, Lifetime, Lifetime', JSON.stringify(await cp.locator('[data-warranty-badge]').allTextContents()) === JSON.stringify([ONE, LIFE, LIFE]))
  const newPrices = await cp.locator('.opt .price').allTextContents()
  await cp.goto(`${API}/p/${sent.token}`); await cp.waitForSelector('#go')
  const oldPrices = await cp.locator('.opt .price').allTextContents()
  check('prices identical on the new link and the link that was sent', newPrices.length === 3 && JSON.stringify(newPrices) === JSON.stringify(oldPrices), JSON.stringify(newPrices))
  check('the link that was sent still shows what was sent (one 1 Year block, no badges)', await cp.locator('[data-warranty-badge]').count() === 0 && (await cp.locator('#wtext').textContent()).includes('warranted for 1 year'))
  await cd.close()

  // The customer on a phone accepts the no dig option on the new link.
  const pc = await phoneBrowser.newContext(CUSTOMER_PHONE)
  const p = await pc.newPage()
  await p.goto(sentUrl.replace(/^https?:\/\/[^/]+/, API)); await p.waitForSelector('#go', { timeout: 20000 })
  await p.locator('.opt[data-option="1"]').tap(); await sleep(200)
  check('customer (phone): picking the no dig option shows the Lifetime words', (await p.locator('#wname').textContent()) === LIFE && (await p.locator('#wtext').textContent()).startsWith(LIFETIME))
  check('customer (phone): accepted the no dig option on the new link', !!(await sign(p, `E2E ${NAME}`)))
  const contract = pdfText(Buffer.from(await (await fetch(`${sentUrl.replace(/^https?:\/\/[^/]+/, API)}/contract.pdf`)).arrayBuffer()))
  // Signed after the Oct 29 2026 cutover: the contract prints the whole dollar the proposal showed, $12,901.00 (D1); the
  // quote keeps its price as priced (next check).
  check('its signed contract: Lifetime words, the whole dollar shown', contract.includes(LIFE) && contract.includes(LIFETIME) && contract.includes('$12,901.00') && !contract.includes('$12,900.91') && !contract.includes('warranted for 1 year'))
  check('the quote is sold at the option\'s price', /^SOLD\|12900\.91\|WV-ND/.test(quoteRow(quoteIds[0])), quoteRow(quoteIds[0]))
  await pc.close()

  // ── 2. The sold job: staff on a phone ──
  const sc = await staffContext(phoneBrowser, PHONE)
  const s = await sc.newPage()
  s.on('pageerror', e => errors.push(String(e).slice(0, 200)))
  await s.goto(`${APP}/operations?job=${jobs[0]}`); await s.waitForSelector('[data-job-warranty-name]', { timeout: 30000 })
  const box = s.locator('[data-job-warranty-box]')
  check('job page (phone): signed with the 1 Year warranty', (await box.locator('[data-job-warranty-name]').textContent()) === ONE)
  await box.locator('[data-wu-start]').tap()
  await box.locator('[data-wu-panel] [data-wu-now]').waitFor()
  check('job page (phone): Send updated warranty shows the accepted option only: Lifetime, was 1 Year, price unchanged',
    JSON.stringify(await box.locator('[data-wu-now]').allTextContents()) === JSON.stringify([LIFE]) && (await box.locator('[data-wu-option="2"]').textContent()).includes(`was ${ONE}`) && (await box.locator('[data-wu-option="2"]').textContent()).includes('$7,407'))
  await box.locator('[data-wu-copy]').tap()
  const soldUrl = await until(async () => (await box.locator('[data-wu-url]').textContent())?.trim(), 10000)
  check('job page (phone): a new link, marked sent', /\/p\/wu\/[A-Za-z0-9_-]{20,}$/.test(soldUrl || ''), soldUrl)

  // The customer on a phone: the note, their fence and price, Lifetime, Acknowledge.
  const ac = await phoneBrowser.newContext(CUSTOMER_PHONE)
  const a = await ac.newPage()
  await a.goto(soldUrl.replace(/^https?:\/\/[^/]+/, API)); await a.waitForSelector('[data-wu-ack-form]', { timeout: 20000 })
  check('customer (phone): the note names Lifetime, their price unchanged, the Lifetime words',
    (await a.locator('[data-wu-note]').textContent()).includes(`We've updated the warranty on your fence: ${LIFE}. Your price and everything else stay the same.`) &&
    (await a.locator('[data-wu-price]').textContent()) === '$7,407' && (await a.locator('[data-wu-warranty-text]').textContent()).startsWith(LIFETIME) && await a.locator('#sig').count() === 0)
  if (SHOTS) await a.screenshot({ path: path.join(SHOTS, 'dev-warranty-update-customer.png'), fullPage: true })
  await a.locator('#go').tap()
  check('customer (phone): Acknowledge needs a name', /type your name/i.test(await a.locator('#err').textContent()))
  await a.locator('#name').fill(`E2E ${NAME}`)
  await a.locator('#go').tap()
  const acked = await until(async () => (await a.locator('[data-wu-acknowledged]').count()) > 0, 15000)
  check('customer (phone): acknowledged', !!acked && (await a.locator('[data-wu-acknowledged]').textContent()).includes(`Acknowledged by E2E ${NAME}`))
  if (SHOTS) { await a.locator('[data-wu-acknowledged]').scrollIntoViewIfNeeded(); await a.screenshot({ path: path.join(SHOTS, 'dev-warranty-update-ack.png') }) }
  await ac.close()

  // The job page now: Lifetime, "Warranty updated on".
  await s.reload(); await s.waitForSelector('[data-job-warranty-name]', { timeout: 30000 })
  check('job page (phone, after a reload): Lifetime, "Warranty updated on ... acknowledged by"',
    (await box.locator('[data-job-warranty-name]').textContent()) === LIFE && (await box.locator('[data-job-warranty-row="end"]').textContent()) === 'For as long as the customer owns the home' &&
    /Warranty updated on .*acknowledged by E2E/.test(await box.locator('[data-job-warranty-updated]').textContent()))
  check('job page (phone): the update line says sent, opened, acknowledged', await until(async () => /sent .*opened 1 time.*acknowledged by E2E/.test(await box.locator('[data-wu-status]').textContent()), 8000))
  if (SHOTS) { await box.locator('[data-job-warranty-toggle]').tap(); await box.scrollIntoViewIfNeeded(); await box.screenshot({ path: path.join(SHOTS, 'dev-warranty-update-job.png') }) }
  check('the sold quote is unchanged (price, costs, stored proposal)', quoteRow(quoteIds[1]) === soldBefore)
  const signedContract = pdfText(Buffer.from(await (await fetch(`${API}/p/${sold.token}/contract.pdf`)).arrayBuffer()))
  check('its signed contract stays as signed (1 Year)', signedContract.includes('warranted for 1 year') && !signedContract.includes('Lifetime'))
  await sc.close()

  // A second browser (desktop), after a reload, sees the same; the customer's history.
  const bc = await staffContext(browser, { viewport: { width: 1280, height: 900 } })
  const b = await bc.newPage()
  b.on('pageerror', e => errors.push(String(e).slice(0, 200)))
  await b.goto(`${APP}/operations?job=${jobs[0]}`); await b.waitForSelector('[data-job-warranty-updated]', { timeout: 30000 })
  check('second browser: the job shows Lifetime, updated', (await b.locator('[data-job-warranty-name]').textContent()) === LIFE)
  await bc.close()
  const hist = (await call('GET', `/api/follow-ups/history?customerId=${contactId}`)).json.data ?? []
  const titles = hist.map(h => h.title)
  check('customer history: "Warranty update sent (Lifetime Craftsmanship Warranty)" and "Warranty update acknowledged by ..."',
    titles.filter(t => t === `Warranty update sent (${LIFE})`).length === 2 && titles.includes(`Warranty update acknowledged by E2E ${NAME}`) && titles.includes(`Proposal accepted on the warranty update by E2E ${NAME}`), JSON.stringify(titles.filter(t => /arranty/.test(t))))
  check('no page errors', errors.length === 0, errors.join(' | '))
  await dc.close()
} finally {
  await browser.close()
  await phoneBrowser.close()
  // Remove what this made. Dev database only, named on every command.
  try {
    for (const q of quoteIds) jobs.push(sql(`SELECT id FROM "SavedJob" WHERE "quoteId" = '${q}'`) || null)
    const all = [...new Set(jobs.filter(Boolean))]
    if (![contactId, cardId, ...quoteIds].every(uuid) || all.some(j => !/^[A-Za-z0-9-]+$/.test(j))) throw new Error('bad id')
    const jl = all.map(j => `'${j}'`).join(',') || "'-'"
    const ql = quoteIds.map(q => `'${q}'`).join(',')
    sql(`DELETE FROM "WarrantyUpdate" WHERE "quoteId" IN (${ql})`)
    sql(`DELETE FROM "ProposalView" WHERE "quoteId" IN (${ql})`)
    sql(`DELETE FROM "JobQuotedCost" WHERE "quoteId" IN (${ql})`)
    sql(`DELETE FROM "AutomationEvent" WHERE "entityId" IN (${jl}, ${ql}, '${cardId}', '${contactId}', ${quoteIds.map(q => `'lead-${q}'`).join(',')})`)
    sql(`DELETE FROM "JobChecklistItem" WHERE "jobId" IN (${jl})`)
    sql(`DELETE FROM "SavedJob" WHERE id IN (${jl})`)
    sql(`DELETE FROM "SavedQuote" WHERE id IN (${ql})`)
    sql(`DELETE FROM "Notification" WHERE title IN ('Proposal accepted: E2E ${NAME}', 'Warranty update acknowledged: E2E ${NAME}')`)
    const pl = (await call('GET', '/api/pipeline')).json
    const mine = (pl?.data?.leads ?? []).filter(l => l.customerId === contactId || l.id === cardId || quoteIds.some(q => l.id === `lead-${q}`)).map(l => l.id)
    if (mine.length) await call('PATCH', '/api/pipeline', { upsert: [], remove: mine, baseVersion: pl.data.version })
    await call('DELETE', `/api/crm-contacts/${contactId}`)
    sql(`DELETE FROM "CrmContact" WHERE id = '${contactId}'`)
    check('cleaned up (quotes, jobs, warranty updates, customer, card)', sql(`SELECT count(*) FROM "SavedQuote" WHERE id IN (${ql})`) === '0' && sql(`SELECT count(*) FROM "WarrantyUpdate" WHERE "quoteId" IN (${ql})`) === '0')
  } catch (e) { check('cleaned up', false, String(e?.message || e).slice(0, 200)) }
}
const passed = results.filter(Boolean).length
console.log(`\n${passed} of ${results.length} checks passed`)
process.exit(passed === results.length ? 0 : 1)
