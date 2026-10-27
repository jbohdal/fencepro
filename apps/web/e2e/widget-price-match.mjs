// Price match: the same drawn yard priced by the website quote and by the
// quote builder, to the cent, for every style the website offers (every
// material, color and height, each of its options: Good / Better / Best,
// Dig set / No dig, or each wood style).
//
// The website side is test mode (?test=1: nothing saved, no lead). For each
// option, the yard as the website saves it (the builder's layout) goes on a
// throwaway saved quote, the quote builder opens it, and its price is read
// off the screen. The quotes are deleted after.
//
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 E2E_ACCESS_TOKEN=<dev token> node e2e/widget-price-match.mjs

import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import './sharedLock.mjs' // makes saved quotes: takes turns with the other tests that change shared data
import { chromium } from 'playwright'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || 'http://localhost:4001'
const TOKEN = process.env.E2E_ACCESS_TOKEN || ''
if (!/localhost:\d+/.test(APP) || !/localhost:\d+/.test(API)) { console.error('Refusing to run: the dev copy only.'); process.exit(2) }
if (!TOKEN) { console.error('Set E2E_ACCESS_TOKEN.'); process.exit(2) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const api = async (p, init = {}) => (await (await fetch(API + p, { ...init, headers: { Authorization: `Bearer ${TOKEN}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) } })).json())
const widget = async (p, body) => { const r = await fetch(`${API}/p/quote/api${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, test: true }) }); return { status: r.status, body: await r.json() } }

// The yard: a backyard from the house with a walk gate slid 11 ft along the left side, one side typed, and a separate side run.
const at = { lat: 29.185118, lng: -82.134209 }
const lat0 = at.lat * Math.PI / 180
const mLat = 111132.954 - 559.822 * Math.cos(2 * lat0), mLng = 111412.84 * Math.cos(lat0) - 93.5 * Math.cos(3 * lat0)
const ll = (e, n) => ({ lat: at.lat + n * 0.3048 / mLat, lng: at.lng + e * 0.3048 / mLng })
const drawing = { v: 1, address: '110 SE Watula Ave, Ocala, FL 34471', at, runs: [
  { id: 'r1', pts: [ll(-30, 15), ll(-55, 15), ll(-55, 95), ll(55, 95), ll(55, 15), ll(30, 15)], start: 'house', end: 'house', typedFt: [null, null, 112, null, null], gates: [null, { type: 'walk', widthFt: 4, startFt: 11 }, null, null, null] },
  { id: 'r2', pts: [ll(70, -40), ll(70, 30)], start: 'free', end: 'free', typedFt: [null], gates: [{ type: 'double', widthFt: 10, startFt: 20 }] },
] }
const base = { draftId: 'pricematchpricematch00', name: 'E2E Price Match', phone: '3525550100', address: drawing.address, drawing }

const browser = await chromium.launch()
const made = []
const rows = []
try {
  const cfg = await (await fetch(`${API}/p/quote/api/config`)).json()
  const staff = await browser.newContext({ viewport: { width: 1280, height: 950 } })
  await staff.addInitScript(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, TOKEN)
  await staff.route(/USGSNAIPPlus|USGSImageryOnly|\/p\/tiles\/(naip|esri|aerial)\//, r => r.abort())
  const page = await staff.newPage()
  const seen = new Set()
  for (const m of cfg.materials) {
    const colors = m.colors.length ? m.colors.map(c => c.key) : ['']
    for (const color of colors) for (const h of m.heights.filter(x => !m.colors.length || x.colors.includes(color))) {
      const pick = { material: m.material, color, height: h.height, kind: h.kind }
      const first = await widget('/submit', { ...base, pick })
      if (first.status !== 200) { check(`${m.label} ${color} ${h.label}: priced`, false, JSON.stringify(first.body).slice(0, 200)); continue }
      for (const o of first.body.options) {
        if (seen.has(o.fenceStyle)) continue
        seen.add(o.fenceStyle)
        const r = await widget('/submit', { ...base, pick, fenceStyle: o.fenceStyle })
        const pv = r.body.preview
        const q = await api('/api/saved-quotes', { method: 'POST', body: JSON.stringify({
          customerName: 'E2E Price Match', customerPhone: '3525550100', customerAddress: drawing.address, leadSource: 'Website Quote',
          fenceStyle: pv.fenceStyle, runs: pv.runs, corners: pv.corners, ends: pv.ends, walkGates: pv.walkGates, dblGates: pv.dblGates, priceAdjust: pv.priceAdjust,
          sections: 0, status: 'DRAFT', finalPrice: 0, date: new Date().toISOString().slice(0, 10), layout: pv.layout,
        }) })
        const id = q.data?.id ?? q.id
        made.push(id)
        await page.goto(`${APP}/quotes?quote=${id}`); await page.waitForSelector('[data-quote-price]', { timeout: 30000 }); await sleep(1200)
        const builder = Number((await page.locator('[data-quote-price]').first().textContent()).replace(/[$,]/g, ''))
        const same = Math.round(builder * 100) === Math.round(o.price * 100) && Math.round(pv.finalPrice * 100) === Math.round(o.price * 100)
        rows.push({ style: o.fenceStyle, option: `${m.label} ${color} ${h.label}: ${o.name}`, widget: o.price, builder })
        check(`${o.fenceStyle} (${m.label}${color ? ' ' + color : ''} ${h.label}, ${o.name}): widget $${o.price.toFixed(2)} = builder $${builder.toFixed(2)}`, same)
        await api(`/api/saved-quotes/${id}`, { method: 'DELETE' }); made.pop()
        await sleep(2100) // the estimates' limit: 30 a minute
      }
    }
  }
  check('every option the website offers was compared', rows.length >= 10, `${rows.length} styles`)
  console.log('\nSTYLE | widget | builder')
  for (const r of rows) console.log(`${r.style} | ${r.widget.toFixed(2)} | ${r.builder.toFixed(2)}`)
} catch (e) {
  check('test run finished', false, String(e?.message || e).split('\n')[0])
} finally {
  for (const id of made) await api(`/api/saved-quotes/${id}`, { method: 'DELETE' }).catch(() => {})
  await browser.close()
}
const passed = results.filter(Boolean).length
console.log(`\n${passed} of ${results.length} checks passed`)
process.exit(passed === results.length ? 0 : 1)
