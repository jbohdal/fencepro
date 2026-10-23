// Dispatch map pins: real colors per stage and crew, a label on every pin (never "?"), a legend.
//
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 E2E_ACCESS_TOKEN=<dev owner token> node e2e/dispatch.mjs
//
// Writes nothing. To show crews without changing a job, the job list the page
// loads is edited on its way in (page.route): one job gets Schedule's first crew
// by id, one a crew by name only (as Smart Schedule saves it, not in Schedule's
// list). Then, at desktop size and on a phone (390, the legend folded):
//   - every pin's fill is its Operations stage color from Settings (by stage id)
//   - every pin has a label and none is "?"
//   - the crew pins: ring = the crew's color, letters = its initials; the
//     by-name crew has a steady color of its own; no-crew pins: customer's initials
//   - the legend lists each stage on the map with its color, and the crews
// Dev copy only (port 4001).
import './devOnly.mjs'
import { chromium } from 'playwright'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || 'http://localhost:4001'
const TOKEN = process.env.E2E_ACCESS_TOKEN || ''
const local = u => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(u)
if (!local(APP) || !local(API) || /:4000(\/|$)/.test(APP) || /:4000(\/|$)/.test(API)) { console.error('Refusing to run: the dev copy only (localhost, not port 4000).'); process.exit(2) }
if (!TOKEN) { console.error('Set E2E_ACCESS_TOKEN (an owner login on the dev server).'); process.exit(2) }

const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const get = async p => (await (await fetch(`${API}${p}`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json()).data

const stages = (await get('/api/ops-stages')).stages
const crews = (await get('/api/schedule/settings')).crews || []
const jobs = await get('/api/saved-jobs')
const onMap = jobs.filter(j => !j.deletedAt && !j.archivedAt && (j.status === 'staging' || j.status === 'scheduled'))
if (onMap.length < 2 || !crews.length) { console.error(`Needs at least two staging jobs (has ${onMap.length}) and one Schedule crew (has ${crews.length}).`); process.exit(2) }
const BY_ID = onMap[0].id, BY_NAME = onMap[1].id
const NAME_CREW = 'Juan Bravo'
const CLASS_HEX = { 'bg-blue-500': '#3B82F6', 'bg-purple-500': '#8B5CF6', 'bg-green-500': '#22C55E', 'bg-orange-500': '#5E28A1', 'bg-pink-500': '#EC4899', 'bg-teal-500': '#14B8A6', 'bg-red-500': '#EF4444', 'bg-indigo-500': '#6366F1', 'bg-yellow-500': '#EAB308', 'bg-cyan-500': '#06B6D4' }
const crewHex = CLASS_HEX[crews[0].color] || crews[0].color

async function run(name, viewport, phone) {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: phone ? 3 : 1, isMobile: phone, hasTouch: phone })
  await ctx.addInitScript(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, TOKEN)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)))
  await page.route('**/api/automations/trigger', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true,"data":{"matched":0}}' }))
  // Read only: any change the page tries to save to a job is answered here, not sent.
  await page.route('**/api/saved-jobs**', async r => {
    if (r.request().method() !== 'GET') return r.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true,"data":null}' })
    const res = await r.fetch()
    const body = await res.json()
    if (Array.isArray(body.data)) for (const j of body.data) {
      if (j.id === BY_ID) j.crewAssigned = crews[0].id
      if (j.id === BY_NAME) j.crewAssigned = NAME_CREW
    }
    await r.fulfill({ response: res, body: JSON.stringify(body) })
  })
  await page.goto(`${APP}/dispatch`)
  await page.waitForSelector('[data-dispatch-map] .leaflet-container', { timeout: 60000 })
  await page.waitForFunction(() => document.querySelectorAll('[data-dispatch-pin]').length > 0, null, { timeout: 30000 }).catch(() => {})
  await sleep(1500)
  const pins = await page.evaluate(() => [...document.querySelectorAll('[data-dispatch-pin]')].map(p => ({
    id: p.getAttribute('data-dispatch-pin'), stage: p.getAttribute('data-stage'), crew: p.getAttribute('data-crew'), label: p.getAttribute('data-label'),
    fill: p.querySelector('[data-pin-fill]')?.getAttribute('fill'), ring: p.querySelector('[data-pin-ring]')?.getAttribute('stroke'),
    dashed: !!p.querySelector('[data-pin-ring]')?.getAttribute('stroke-dasharray'), text: p.querySelector('[data-pin-label]')?.textContent,
  })))
  const tag = `${name}`
  check(`${tag}: pins on the map (${pins.length})`, pins.length >= 2)
  check(`${tag}: no pin labelled "?" and every pin has a label`, pins.every(p => p.label && p.label !== '?' && p.text === p.label), pins.filter(p => !p.label || p.label === '?').map(p => p.id).join(', '))
  const wrongFill = pins.filter(p => { const st = stages.find(s => s.id === p.stage); return !st || st.color.toLowerCase() !== (p.fill || '').toLowerCase() })
  check(`${tag}: every pin is its Operations stage color (Settings, by id)`, wrongFill.length === 0, wrongFill.map(p => `${p.id.slice(0, 12)} ${p.stage} ${p.fill}`).join(' | '))
  check(`${tag}: more than one look (not every pin the same)`, new Set(pins.map(p => `${p.fill}|${p.ring}|${p.label}`)).size > 1)
  const a = pins.find(p => p.id === BY_ID), b = pins.find(p => p.id === BY_NAME)
  const initials = n => { const w = n.trim().split(/[\s_-]+/); return w.length === 1 ? (/^\d+$/.test(w[0]) ? w[0] : w[0].slice(0, 2).toUpperCase()) : w.slice(0, 3).map(x => /^\d+$/.test(x) ? x : x[0].toUpperCase()).join('').slice(0, 3) }
  if (a) check(`${tag}: a job with Schedule's ${crews[0].name}: ring ${crewHex}, letters ${initials(crews[0].name)}`, a.crew === crews[0].id && a.ring?.toLowerCase() === crewHex.toLowerCase() && a.label === initials(crews[0].name) && !a.dashed, JSON.stringify(a))
  else check(`${tag}: the job with ${crews[0].name} has a pin`, false, 'no address found for it')
  if (b) check(`${tag}: a crew saved by name (${NAME_CREW}) gets its own steady color and letters JB`, b.crew === NAME_CREW && b.label === 'JB' && !!b.ring && b.ring !== '#6B7280' && !b.dashed, JSON.stringify(b))
  const none = pins.filter(p => !p.crew)
  check(`${tag}: no-crew pins: dashed ring, customer's initials`, none.every(p => p.dashed && /^[A-Z0-9]{1,2}$/.test(p.label)), none.filter(p => !p.dashed).map(p => p.id).join(', '))
  // The legend: folded on a phone, open on a computer.
  const toggle = page.locator('[data-dispatch-legend-toggle]')
  check(`${tag}: legend there (${phone ? 'folded' : 'open'} at first)`, (await toggle.count()) === 1 && (await toggle.getAttribute('aria-expanded')) === (phone ? 'false' : 'true'))
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') { await toggle.click(); await sleep(300) }
  const legend = await page.evaluate(() => ({
    stages: [...document.querySelectorAll('[data-legend-stage]')].map(e => ({ id: e.getAttribute('data-legend-stage'), color: getComputedStyle(e.querySelector('span')).backgroundColor })),
    crews: [...document.querySelectorAll('[data-legend-crew]')].map(e => e.getAttribute('data-legend-crew')),
  }))
  const rgb = h => { const n = parseInt(h.slice(1), 16); return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})` }
  const pinStages = [...new Set(pins.map(p => p.stage))]
  check(`${tag}: legend lists each stage on the map in its color (${pinStages.join(', ')})`, pinStages.every(id => legend.stages.some(l => l.id === id && l.color === rgb(stages.find(s => s.id === id).color))), JSON.stringify(legend.stages))
  check(`${tag}: legend lists the crews and "no crew"`, legend.crews.includes(crews[0].id) && (!b || legend.crews.includes(NAME_CREW)) && legend.crews.includes(''), legend.crews.join(', '))
  check(`${tag}: no page errors`, errors.length === 0, errors.slice(0, 3).join(' | '))
  await browser.close()
}

try {
  await run('desktop 1280', { width: 1280, height: 860 }, false)
  await run('phone 390', { width: 390, height: 844 }, true)
} catch (e) { check('test ran to the end', false, String(e).split('\n').slice(0, 3).join(' ')) }
const passed = results.filter(Boolean).length
console.log(`\n${passed} of ${results.length} checks passed`)
process.exit(passed === results.length ? 0 : 1)
