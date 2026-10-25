// Install packet for the crew, end to end on the dev copy.
//
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 \
//   E2E_ACCESS_TOKEN=<dev staff token> MEDIA_PHOTO=photo.jpg node e2e/install-packet.mjs
//
// Makes a sold job (with a quote, plan and pull sheet) and two photos, one
// shared with the crew and pinned, one internal. Sends the packet from the
// job in Operations, opens it on a phone: customer, map link, plan, runs
// with post spacing, counts, gates, pull sheet quantities and no prices,
// only the crew's photo; saves the 811 ticket; uploads a crew photo (it
// lands Internal on the job); prints; turns the link off. Deletes what it made.

import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import { chromium } from 'playwright'
import fs from 'fs'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || 'http://localhost:4001'
const TOKEN = process.env.E2E_ACCESS_TOKEN || ''
const PHOTO = process.env.MEDIA_PHOTO || ''
const SHOTS = process.env.SHOTS || ''
const local = u => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(u)
if (!local(APP) || !local(API) || /:4000(\/|$)/.test(API)) { console.error('Refusing to run: the dev copy only (localhost, not port 4000).'); process.exit(2) }
if (!TOKEN || !PHOTO) { console.error('Set E2E_ACCESS_TOKEN and MEDIA_PHOTO.'); process.exit(2) }

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const api = async (p, init = {}) => {
  const r = await fetch(API + p, { ...init, headers: { Authorization: `Bearer ${TOKEN}`, ...(init.body && typeof init.body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...(init.headers || {}) } })
  const j = await r.json().catch(() => ({}))
  return j.data ?? j
}
async function uploadPhoto(meta) {
  const buf = fs.readFileSync(PHOTO)
  const clientId = 'e2e-packet-' + Date.now() + Math.random().toString(36).slice(2)
  await api('/api/media/uploads', { method: 'POST', body: JSON.stringify({ clientId, size: buf.length, meta: { kind: 'photo', mime: 'image/jpeg', ...meta } }) })
  await fetch(`${API}/api/media/uploads/${clientId}?offset=0`, { method: 'PUT', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/octet-stream' }, body: buf })
  return api(`/api/media/uploads/${clientId}/finish`, { method: 'POST' })
}

const NAME = 'E2E Packet Test'
const side = (id, name, L, s, e, h, extra = {}) => ({ id, name, on: true, lengthIn: L * 12, startFinish: s, endFinish: e, gate: null, skip: null, heading: h, ...extra })
const yard = { shape: 'backyard', closed: false, sides: [
  side('a', 'Left return', 30, 'house', 'corner', 180, { gate: { type: 'walk', widthIn: 48, position: 'middle' } }),
  side('b', 'Left side', 120, 'corner', 'corner', 90), side('c', 'Back', 150, 'corner', 'corner', 0),
  side('d', 'Right side', 120, 'corner', 'corner', 270), side('e', 'Right return', 30, 'corner', 'house', 180),
] }
let quoteId = null, jobId = null, media = []
const browser = await chromium.launch()
try {
  const quote = await api('/api/saved-quotes', { method: 'POST', body: JSON.stringify({
    customerName: NAME, customerPhone: '3525550100', customerAddress: '5708 SW 90th Ln, Ocala, FL 34476', fenceStyle: "WV-ND 6'x8' Privacy",
    runs: [13, 13, 120, 150, 120, 30], corners: 4, ends: 4, walkGates: 1, dblGates: 0, sections: 57, status: 'SOLD',
    materialCost: 7000, laborCost: 1368, totalCOGS: 8368, finalPrice: 14943.21, gmPct: 0.42,
    pullSheet: [{ item: '*Vinyl, White, Post, Line, 5" x 5" x 78"', qty: 51, unitCost: 11.17, total: 569.67 }, { item: "*Vinyl, White, Rail, 8'", qty: 114, unitCost: 9.26, total: 1055.64 }],
    notes: 'Gate code 4512. Dog in the yard.\nCrew note: sprinkler heads along the back',
    layout: { yard, runSections: [2, 2, 15, 19, 15, 4] },
  }) })
  quoteId = quote.id
  const job = await api('/api/saved-jobs', { method: 'POST', body: JSON.stringify({ quoteId, status: 'scheduled', customerName: NAME, customerPhone: '3525550100', customerAddress: '5708 SW 90th Ln, Ocala, FL 34476', fenceStyle: "WV-ND 6'x8' Privacy", sections: 57, totalFeet: 446, walkGates: 1, scheduledDate: '2026-10-27', crewAssigned: 'Crew A', quotePrice: 14943.21, contractValue: 14943.21 }) })
  jobId = job.id
  media.push(await uploadPhoto({ jobId, caption: 'Gate goes here', category: 'Gate location', visibility: 'crew', pin: { x: -15, y: 3, angle: 0 } }))
  media.push(await uploadPhoto({ jobId, caption: 'Office only, do not share', category: 'Before', visibility: 'internal' }))
  check('setup: a sold job with a quote, plan and two photos', !!quoteId && !!jobId && media.every(m => m.id))

  // ── Send the packet from the job in Operations ──
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await ctx.addInitScript(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, TOKEN)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 300)))
  page.on('dialog', d => d.accept().catch(() => {}))
  await page.goto(APP); await page.waitForSelector('[data-global-appointment]', { timeout: 30000 }); await sleep(1500)
  await page.locator('span:text-is("Operations"):visible').first().click(); await sleep(1200)
  await page.locator('input[aria-label="Search jobs"]').fill(NAME); await sleep(800)
  await page.locator(`text=${NAME}`).first().click(); await sleep(1000)
  await page.locator('[data-packet-send]').click(); await sleep(2500)
  const url = (await page.locator('[data-packet-url]').textContent().catch(() => '')).trim()
  check('Send install packet makes a private link', /\/p\/i\/[\w-]{20,}$/.test(url), url)
  if (SHOTS) { await page.locator('[data-install-packet]').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${SHOTS}/1-job-install-packet.png` }) }
  check('the job offers Open, Text it, Email it and Turn off', await page.locator('[data-packet-open]').count() === 1 && await page.locator('[data-packet-text]').count() === 1 && await page.locator('[data-packet-off]').count() === 1)
  check('office: no page errors', errors.length === 0, errors.join(' | '))
  const token = url.split('/p/i/')[1]

  // ── The crew opens it on a phone, no login ──
  const crew = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  const cp = await crew.newPage()
  const cErrors = []
  cp.on('pageerror', e => cErrors.push(String(e)))
  cp.on('console', m => { if (m.type() === 'error') cErrors.push(m.text()) })
  const res = await cp.goto(`${API}/p/i/${token}`); await sleep(1500)
  const html = await cp.content()
  const text = (await cp.locator('body').textContent()).replace(/\s+/g, ' ')
  check('opens with no login, strict security policy', res.status() === 200 && /default-src 'none'/.test(res.headers()['content-security-policy'] || ''))
  check('customer, phone, map link, install date and crew', text.includes(NAME) && text.includes('Install: 10/27/2026') && text.includes('Crew: Crew A') && /google\.com\/maps\/search\/\?api=1&amp;query=5708/.test(html))
  check('gate codes, notes and crew notes', text.includes('Gate code 4512') && text.includes('Crew notes') && text.includes('sprinkler heads along the back') && text.includes('(352) 555 0100'))
  check('site plan with the photo pin', await cp.locator('.plan svg [data-plan-pin]').count() === 1)
  check('every run with post to post spacing', text.includes("Left return (1 of 2)") && text.includes("6' 6\"") && text.includes("7' 10 3/4\""), text.slice(text.indexOf('Run'), text.indexOf('Run') + 200))
  check('section and post counts, and the gate', text.includes('57 sections') && text.includes('4 corner posts') && text.includes('2 gate posts') && text.includes('Left return: 4 ft walk gate, 13 ft from the house, 13 ft to the Left side corner'))
  check('pull sheet quantities', text.includes('Rail, 8\'') && text.includes('114'))
  // The words a crew can read, and every number from the quote's money, anywhere in the page.
  const money = /14,?943|8,?368|1,?368|7,?000\.|1,?055|569\.67|11\.17|9\.26|unitCost|finalPrice|gmPct/i
  check('no prices, margins or sub pay anywhere', !/\$|margin|sub pay|cost/i.test(text) && !money.test(html), (text.match(/\$[\d,.]+|margin|sub pay|cost/i) || html.match(money) || [''])[0])
  const shown = await cp.locator('.media figure').count()
  check('only the photo shared with the crew, with its caption', shown === 1 && text.includes('Gate goes here') && !text.includes('Office only'))
  check('the photo loads through the public door', await cp.locator('.media img').evaluate(img => img.complete && img.naturalWidth > 0))
  if (SHOTS) await cp.screenshot({ path: `${SHOTS}/2-phone-packet-top.png` })
  if (SHOTS) await cp.screenshot({ path: `${SHOTS}/3-phone-packet-full.png`, fullPage: true })

  // The job's one 811 locate: ticket, called in, good to dig, expires (lib/locates.ts).
  await cp.locator('#ticket').fill('A2610-1234'); await cp.locator('#lcalled').fill('2026-10-16'); await cp.locator('#ldate').fill('2026-10-20'); await cp.locator('#lexp').fill('2099-11-19')
  await cp.locator('#saveLocate').click(); await sleep(800)
  check('the crew saves the 811 ticket', (await cp.locator('#locMsg').textContent()).startsWith('Saved.') && (await cp.locator('#locStatus').getAttribute('data-packet-locate-status')) === 'clear', await cp.locator('#locMsg').textContent())
  const lj = await api(`/api/saved-jobs/${jobId}`)
  check('the packet saved the job\'s own locate', lj.locateTicket === 'A2610-1234' && lj.locatesDate === '2026-10-20' && lj.locatesExpDate === '2099-11-19' && lj.locateCalledDate === '2026-10-16', JSON.stringify([lj.locateTicket, lj.locatesDate, lj.locatesExpDate]))
  await cp.locator('#cat').selectOption('Completed'); await cp.locator('#note').fill('All done, gate swings fine')
  await cp.locator('#files').setInputFiles(PHOTO); await sleep(2500)
  check('the crew uploads a photo from the link', (await cp.locator('#upMsg').textContent()).includes('1 uploaded'))
  check('the crew sees the photo they just sent', await cp.locator('#sent figure img').count() === 1 && (await cp.locator('#sent figcaption').textContent()).startsWith('Sent from this phone'))
  const jobMedia = await api(`/api/media?jobId=${jobId}`)
  const fromCrew = jobMedia.find(m => m.source === 'crew')
  check('it lands on the job as Internal, from the crew', !!fromCrew && fromCrew.visibility === 'internal' && fromCrew.category === 'Completed' && fromCrew.caption === 'All done, gate swings fine')
  if (fromCrew) media.push(fromCrew)
  check('crew page: no errors', cErrors.length === 0, cErrors.join(' | '))

  // Print to PDF works from the page.
  const pdf = await cp.pdf({ format: 'Letter' }).catch(() => null)
  if (pdf && SHOTS) fs.writeFileSync(`${SHOTS}/4-packet-print.pdf`, pdf)
  check('prints to PDF', !!pdf && pdf.length > 20_000, pdf ? `${Math.round(pdf.length / 1024)} KB` : 'no pdf')

  // ── Back at the office: the 811 ticket shows; turn the link off ──
  await page.reload(); await page.waitForSelector('[data-global-appointment]'); await sleep(1200)
  await page.locator('span:text-is("Operations"):visible').first().click(); await sleep(1200)
  await page.locator('input[aria-label="Search jobs"]').fill(NAME); await sleep(800)
  await page.locator(`text=${NAME}`).first().click(); await sleep(1200)
  check('the job shows the 811 ticket from the crew', (await page.locator('[data-locate-ticket]').textContent()) === 'A2610-1234' && (await page.locator('[data-locate-status]').getAttribute('data-locate-status')) === 'clear')
  await page.locator('[data-packet-off]').click(); await sleep(800)
  const offRes = await fetch(`${API}/p/i/${token}`)
  check('a turned off link shows a page with the office phone', offRes.status === 410 && (await offRes.text()).includes('This install packet is not active'))
  await crew.close(); await ctx.close()
} catch (e) {
  check('test run finished', false, String(e).split('\n').slice(0, 3).join(' '))
} finally {
  for (const m of media) await api(`/api/media/${m.id}`, { method: 'DELETE' })
  if (jobId) await api(`/api/saved-jobs/${jobId}`, { method: 'DELETE' })
  if (quoteId) await api(`/api/saved-quotes/${quoteId}`, { method: 'DELETE' })
  await browser.close()
}
const passed = results.filter(Boolean).length
console.log(`\n${passed} of ${results.length} checks passed`)
process.exit(passed === results.length ? 0 : 1)
