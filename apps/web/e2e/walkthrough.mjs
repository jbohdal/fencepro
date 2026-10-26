// Final walkthrough on a phone, start to certificate. Dev only (4001, which
// serves the built app: run `pnpm -s build` in apps/web first).
//
//   E2E_ACCESS_TOKEN=<dev staff token> SHOTS=<folder, optional> node e2e/walkthrough.mjs
//
// A test customer and job are made; then on a 390 px phone: start the
// walkthrough and mark items with no signal (back online, everything arrives
// once), a Needs fixing makes a punch item, the required photos are chosen
// (generated images), the fix is re-photographed, our representative signs
// with a finger on the canvas, the homeowner signs through the link in a
// second browser, and the certificate is made and is in the customer portal.
// Removes what it made (hard deletes on ezbiz_dev only).
import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import { chromium } from 'playwright'
import crypto from 'crypto'
import zlib from 'zlib'
import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'

const APP = process.env.APP_URL || 'http://localhost:4001', TOKEN = process.env.E2E_ACCESS_TOKEN || '', SHOTS = process.env.SHOTS || ''
if (!TOKEN) { console.error('Set E2E_ACCESS_TOKEN.'); process.exit(2) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const api = async (p, init = {}) => {
  const r = await fetch(APP + p, { ...init, headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(init.headers || {}) } })
  return { status: r.status, json: await r.json().catch(() => null) }
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `dev-walkthrough-${name}.png`) }) }
async function until(fn, ms = 30000, every = 500) { const end = Date.now() + ms; for (;;) { const v = await fn().catch(() => null); if (v || Date.now() > end) return v; await sleep(every) } }

/** A real PNG photo, made here (a color with a white stripe). */
function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3, s = Math.abs(x - y) < 6; raw[o] = s ? 255 : rgb[0]; raw[o + 1] = s ? 255 : rgb[1]; raw[o + 2] = s ? 255 : rgb[2] }
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(zlib.crc32(td) >>> 0); return Buffer.concat([l, td, c]) }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
const photo = (name, rgb) => ({ name: `${name}.png`, mimeType: 'image/png', buffer: png(480, 360, rgb) })

/** Sign with a "finger" on a canvas. */
async function draw(page, canvas) {
  await canvas.scrollIntoViewIfNeeded()
  const b = await canvas.boundingBox()
  await page.mouse.move(b.x + 30, b.y + b.height * 0.6); await page.mouse.down()
  for (let i = 1; i <= 12; i++) await page.mouse.move(b.x + 30 + i * (b.width - 60) / 12, b.y + b.height * (0.6 + 0.25 * Math.sin(i)), { steps: 2 })
  await page.mouse.up()
}

const uuid = s => /^[0-9a-f-]{36}$/i.test(s)
const contactId = crypto.randomUUID(), cardId = crypto.randomUUID(), jobId = crypto.randomUUID(), NAME = `Walkthrough ${contactId.slice(0, 6)}`
const b = await chromium.launch()
let walkId = null
try {
  // A customer (with a card) and a sold job: vinyl, one walk gate, no yard layout (the crew sets the sides).
  const c = await api('/api/crm-contacts', { method: 'POST', body: JSON.stringify({ id: contactId, firstName: 'E2E', lastName: NAME, phone: '3525550196', email: 'e2e-walkthrough@example.invalid', leadSource: 'Other', lead: { id: cardId, customerId: contactId, firstName: 'E2E', lastName: NAME, phone: '3525550196', stage: 'First Contact', leadSource: 'Other', createdAt: '2026-10-18', lastMoved: '2026-10-18' }, leadBefore: null }) })
  const j = await api('/api/saved-jobs', { method: 'POST', body: JSON.stringify({ id: jobId, crmContactId: contactId, customerName: `E2E ${NAME}`, customerPhone: '3525550196', customerEmail: 'e2e-walkthrough@example.invalid', customerAddress: '1 Test Way, Ocala, FL 34470', fenceStyle: "WV-ND 6'x6' Privacy", sections: 12, totalFeet: 72, walkGates: 1, dblGates: 0, status: 'in_progress' }) })
  check('test customer and job made', c.status < 300 && j.status < 300, `${c.status} ${j.status}`)

  // The crew's phone: location allowed (Ocala).
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, permissions: ['geolocation', 'clipboard-read', 'clipboard-write'], geolocation: { latitude: 29.1872, longitude: -82.1401, accuracy: 15 } })
  await ctx.addInitScript(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, TOKEN)
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 200)))
  await p.goto(`${APP}/operations?job=${jobId}`); await p.waitForSelector('[data-tabbar]', { timeout: 60000 })
  await p.waitForSelector('[data-walkthrough-panel="none"]', { timeout: 30000 })
  await p.locator('[data-walkthrough-panel]').scrollIntoViewIfNeeded(); await shot(p, 'job-panel')

  // No signal: start it and mark items.
  await ctx.setOffline(true)
  await p.locator('[data-walkthrough-start]').click()
  await p.waitForSelector('[data-walkthrough-screen="open"]')
  const ids = await p.locator('[data-wt-item]').evaluateAll(els => els.map(e => e.getAttribute('data-wt-item')))
  check('vinyl starter checklist: 10 items, in order', ids.length === 10 && ids[0] === 'gates' && ids[9] === 'shown', ids.join(','))
  for (const id of ids.slice(0, 6)) await p.locator(`[data-wt-pass="${id}"]`).click()
  await p.locator('[data-wt-fix="hardware"]').click()
  await p.locator('[data-wt-note="hardware"]').fill('Gate hinge screws loose'); await p.locator('[data-wt-note="hardware"]').blur()
  await sleep(800)
  const waiting = await p.locator('[data-walkthrough-screen] [data-save-status]').first().getAttribute('data-save-status')
  check('no signal: the screen says it is waiting', waiting === 'waiting', waiting)
  check('no signal: a Needs fixing shows on the punch list at once', await p.locator('[data-wt-punch="hardware"]').count() === 1)
  const before = await api(`/api/walkthroughs?jobId=${jobId}`)
  check('no signal: nothing reached the server yet', before.json?.data === null, JSON.stringify(before.json?.data)?.slice(0, 80))
  await p.locator('[data-wt-item="gates"]').scrollIntoViewIfNeeded(); await shot(p, 'offline-checklist')

  // Signal back: everything arrives, once.
  await ctx.setOffline(false)
  const arrived = await until(async () => { const r = await api(`/api/walkthroughs?jobId=${jobId}`); const w = r.json?.data; return w && w.items.filter(i => i.result).length === 6 && w.items.find(i => i.id === 'hardware')?.result === 'fix' && w.punch.length === 1 ? w : null })
  walkId = arrived?.id ?? (await api(`/api/walkthroughs?jobId=${jobId}`)).json?.data?.id ?? null
  check('back online: the walkthrough and all 6 marks arrived (hardware: Needs fixing)', !!arrived, arrived ? '' : JSON.stringify((await api(`/api/walkthroughs?jobId=${jobId}`)).json?.data?.items?.map(i => i.result)))
  check('back online: exactly one punch item, with its note', arrived?.punch?.length === 1 && arrived.punch[0].note === 'Gate hinge screws loose', JSON.stringify(arrived?.punch))
  await until(async () => (await p.locator('[data-walkthrough-screen] [data-save-status="saved"]').count()) > 0, 15000)
  check('the screen says Saved', await p.locator('[data-walkthrough-screen] [data-save-status="saved"]').count() > 0)
  for (const id of ids.slice(6)) await p.locator(`[data-wt-pass="${id}"]`).click()

  // Required photos: 1 side (the crew adds a second), 1 gate, the wide shot.
  await p.locator('[data-stepper="Sides-plus"]').click(); await sleep(300)
  const slots = await p.locator('[data-wt-slot]').evaluateAll(els => els.map(e => e.getAttribute('data-wt-slot')))
  check('required photos: each side, each gate, one wide shot', slots.join(',') === 'side:1,side:2,gate:1,wide', slots.join(','))
  const colors = [[94, 40, 161], [21, 128, 61], [180, 83, 9], [30, 64, 175]]
  for (let i = 0; i < slots.length; i++) await p.locator(`[data-wt-file="slot-${slots[i]}"]`).setInputFiles(photo(slots[i].replace(':', '-'), colors[i]))
  const allUp = await until(async () => (await p.locator('[data-wt-slot-state="uploaded"]').count()) === slots.length ? true : null, 45000)
  check('the 4 required photos uploaded through the media queue', !!allUp, String(await p.locator('[data-wt-slot-state="uploaded"]').count()))
  await p.locator('[data-wt-slot="side:1"]').scrollIntoViewIfNeeded(); await shot(p, 'photos')
  const vis = (await api(`/api/media?jobId=${jobId}`)).json?.data ?? []
  check('required photos are Customer visible', vis.length >= 4 && vis.filter(m => /Final walkthrough/.test(m.caption)).every(m => m.visibility === 'customer'), vis.map(m => m.visibility).join(','))

  // The markup tool on a required photo (opened and closed without saving).
  await p.locator('[data-wt-markup="wide"]').click()
  await p.waitForSelector('[data-markup-editor][data-loaded="yes"]', { timeout: 15000 }).catch(() => null)
  check('mark up opens on a required photo', (await p.locator('[data-markup-editor]').count()) === 1)
  await shot(p, 'markup')
  await p.locator('[data-markup-editor] button[aria-label="Close without saving"]').click()

  // The fix, re-photographed.
  await p.locator('[data-wt-file="punch-hardware"]').setInputFiles(photo('fix', [200, 200, 200]))
  await p.locator('[data-wt-punch-fixed="hardware"]').click()
  check('the punch item is fixed', (await p.locator('[data-wt-punch="hardware"]').getAttribute('data-wt-punch-status')) === 'fixed')

  // Our representative signs: role, name, finger.
  await p.locator('[data-wt-role="Lead installer / Foreman"]').click()
  await p.locator('[data-wt-sign-name="rep"]').fill('Test Foreman')
  await draw(p, p.locator('[data-wt-sign="rep"] [data-wt-sigpad]'))
  await p.locator('[data-wt-sign-save="rep"]').click()
  await p.waitForSelector('[data-wt-signed="rep"]', { timeout: 15000 })
  const repText = await p.locator('[data-wt-signed="rep"]').innerText()
  check('rep signature shows name, role, time and location', /Test Foreman, Lead installer \/ Foreman/.test(repText) && /29\.18720, -82\.14010/.test(repText), repText.replace(/\n/g, ' | '))
  await p.locator('[data-wt-signed="rep"]').scrollIntoViewIfNeeded(); await shot(p, 'signatures')
  const notYet = await until(async () => { const w = (await api(`/api/walkthroughs/${walkId}`)).json?.data; return w?.repSig && w.punch[0]?.status === 'fixed' ? w : null })
  check('not finished without the homeowner', notYet?.status === 'open' && JSON.stringify(notYet?.missing) === JSON.stringify(["Homeowner's signature"]), JSON.stringify(notYet?.missing))
  const refused = await api(`/api/walkthroughs/${walkId}/finish`, { method: 'POST' })
  check('finishing is refused until the homeowner signs', refused.status === 409, String(refused.status))

  // The homeowner is not there: the office copies the link.
  await p.locator('[data-walkthrough-screen] [data-wt-link-copy]').click()
  await p.waitForSelector('[data-walkthrough-screen] [data-wt-link-url]')
  const link = (await p.locator('[data-walkthrough-screen] [data-wt-link-url]').innerText()).trim()
  check('a homeowner link under /p/w/', /^http:\/\/localhost:\d+\/p\/w\/[A-Za-z0-9_-]{20,}$/.test(link), link)
  await p.locator('[data-walkthrough-screen] [data-walkthrough-send]').scrollIntoViewIfNeeded(); await shot(p, 'send-link')

  // The homeowner's own phone (no location allowed), no app, no sign in.
  const hc = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  const hp = await hc.newPage()
  await hp.goto(link)
  check('homeowner sees the checklist and the photos', (await hp.locator('.check li').count()) >= 10 && (await hp.locator('.media img').count()) >= 5, `${await hp.locator('.check li').count()} items, ${await hp.locator('.media img').count()} photos`)
  const imgOk = await hp.locator('.media img').first().evaluate(i => i.complete && i.naturalWidth > 0)
  check('photos load through the public door', imgOk)
  await shot(hp, 'homeowner-link')
  await hp.locator('#name').fill('Pat Homeowner')
  await draw(hp, hp.locator('#sig'))
  await shot(hp, 'homeowner-signing')
  await hp.locator('#go').click()
  await hp.waitForSelector('text=This page is now read only', { timeout: 20000 })
  check('after signing the page is read only', (await hp.locator('#sig').count()) === 0)
  await shot(hp, 'homeowner-signed')
  const again = await fetch(link + '/sign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Someone Else', signature: 'data:image/png;base64,' + png(20, 10, [255, 255, 255]).toString('base64') }) })
  check('a second signature through the link is refused', again.status === 409, String(again.status))
  await hc.close()

  // Finished by the homeowner's signature: the certificate is made.
  const done = await until(async () => { const w = (await api(`/api/walkthroughs/${walkId}`)).json?.data; return w?.status === 'completed' ? w : null })
  check('finished once the homeowner signed', !!done)
  check('homeowner signature: name, Homeowner, signed on their phone, "location not shared"', done?.homeownerSig?.name === 'Pat Homeowner' && done.homeownerSig.via === 'link' && done.homeownerSig.lat === null, JSON.stringify({ ...done?.homeownerSig, image: undefined }))
  await p.reload(); await p.waitForSelector('[data-walkthrough-panel="completed"]', { timeout: 30000 })
  // A reload reopens the walkthrough it was on; otherwise open it from the job.
  await sleep(1000)
  if (!(await p.locator('[data-walkthrough-screen]').count())) await p.locator('[data-walkthrough-open]').click()
  await p.waitForSelector('[data-walkthrough-screen="completed"]')
  await shot(p, 'finished')
  const pdf = await fetch(`${APP}/api/walkthroughs/${walkId}/certificate.pdf`, { headers: { Authorization: `Bearer ${TOKEN}` } })
  const bytes = Buffer.from(await pdf.arrayBuffer())
  check('the Certificate of Completion PDF exists', pdf.status === 200 && bytes.subarray(0, 5).toString() === '%PDF-', `${pdf.status} ${bytes.length} bytes`)
  if (SHOTS && bytes.length) {
    // The certificate's first page as a picture (Quick Look, built into the Mac).
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-cert-')); const f = path.join(tmp, 'certificate.pdf'); fs.writeFileSync(f, bytes)
    try { execFileSync('qlmanage', ['-t', '-s', '1700', '-o', tmp, f], { stdio: 'ignore' }); fs.copyFileSync(path.join(tmp, 'certificate.pdf.png'), path.join(SHOTS, 'dev-walkthrough-certificate.png')) } catch { /* not on a Mac */ }
    fs.rmSync(tmp, { recursive: true, force: true })
  }
  const docs = (await api(`/api/portal/customer/${contactId}/documents`)).json?.data ?? []
  check('the certificate is in the customer portal', docs.some(d => d.label === 'Certificate of Completion' && d.mimeType === 'application/pdf' && d.isVisibleToCustomer), JSON.stringify(docs.map(d => d.label)))
  const events = execFileSync('psql', ['-d', 'ezbiz_dev', '-At', '-c', `SELECT type FROM "AutomationEvent" WHERE "entityId" = '${jobId}' AND type IN ('walkthrough_signed', 'walkthrough_completed', 'punch_list_cleared') ORDER BY type`]).toString().trim().split('\n').filter(Boolean)
  check('events recorded once each', events.join(',') === 'punch_list_cleared,walkthrough_completed,walkthrough_signed', events.join(','))
  check('one walkthrough for the job', execFileSync('psql', ['-d', 'ezbiz_dev', '-At', '-c', `SELECT count(*) FROM "Walkthrough" WHERE "jobId" = '${jobId}'`]).toString().trim() === '1')
  check('no page errors', errs.length === 0, errs.join(' | '))

  // Settings: the templates.
  await p.goto(`${APP}/settings?tab=walkthrough`)
  const settings = await until(async () => (await p.locator('[data-walkthrough-settings]').count()) > 0, 20000)
  check('Settings shows the walkthrough templates', !!settings && (await p.locator('[data-wt-template-item]').count()) >= 1)
  if (settings) {
    // Add, reorder and remove an item (not saved: the dev settings stay as they were).
    await p.locator('[data-wt-template-cat="chain_link"]').click()
    const n0 = await p.locator('[data-wt-template-item]').count()
    await p.locator('[data-wt-template-new]').fill('Fabric tight, no gaps at the bottom'); await p.locator('[data-wt-template-add]').click()
    const n1 = await p.locator('[data-wt-template-item]').count()
    const last = await p.locator('[data-wt-template-item]').last().getAttribute('data-wt-template-item')
    await p.locator(`[data-wt-template-up="${last}"]`).click()
    const order = await p.locator('[data-wt-template-item]').evaluateAll(els => els.map(e => e.getAttribute('data-wt-template-item')))
    check('templates: add an item and move it up', n1 === n0 + 1 && order[order.length - 2] === last, `${n0} -> ${n1}`)
    await p.locator('[data-wt-template-list]').scrollIntoViewIfNeeded(); await shot(p, 'settings-templates')
    await p.locator(`[data-wt-template-remove="${last}"]`).click()
    check('templates: remove it again', (await p.locator('[data-wt-template-item]').count()) === n0)
  }
  await ctx.close()
} catch (e) {
  check('test run finished', false, String(e?.message || e).slice(0, 300))
} finally {
  await b.close()
  // Remove what this made. Dev database only, named on every command.
  try {
    if (![contactId, jobId, cardId].every(uuid)) throw new Error('bad id')
    const sql = (q) => execFileSync('psql', ['-d', 'ezbiz_dev', '-At', '-c', q]).toString().trim()
    const files = sql(`SELECT "certificatePath" FROM "Walkthrough" WHERE "jobId" = '${jobId}' AND "certificatePath" IS NOT NULL UNION ALL SELECT path FROM "MediaItem" WHERE "jobId" = '${jobId}'`).split('\n').filter(Boolean)
    for (const f of files) fs.rmSync(f, { force: true })
    sql(`DELETE FROM "PortalFile" WHERE "crmCustomerId" = '${contactId}'`)
    sql(`DELETE FROM "AutomationEvent" WHERE "entityId" = '${jobId}'`)
    sql(`DELETE FROM "WalkthroughPunchItem" WHERE "jobId" = '${jobId}'`)
    sql(`DELETE FROM "Walkthrough" WHERE "jobId" = '${jobId}'`)
    sql(`DELETE FROM "MediaItem" WHERE "jobId" = '${jobId}' OR "customerId" = '${contactId}'`)
    sql(`DELETE FROM "SavedJob" WHERE id = '${jobId}'`)
    const pl = (await api('/api/pipeline')).json
    const mine = (pl?.data?.leads ?? []).filter(l => l.customerId === contactId).map(l => l.id)
    if (mine.length) await api('/api/pipeline', { method: 'PATCH', body: JSON.stringify({ upsert: [], remove: mine, baseVersion: pl.data.version }) })
    await api(`/api/crm-contacts/${contactId}`, { method: 'DELETE' })
    sql(`DELETE FROM "CrmContact" WHERE id = '${contactId}'`)
    check('cleaned up', sql(`SELECT count(*) FROM "Walkthrough" WHERE "jobId" = '${jobId}'`) === '0')
  } catch (e) { check('cleaned up', false, String(e?.message || e).slice(0, 200)) }
}
const failed = results.filter(r => !r).length
console.log(`\n${results.length - failed} of ${results.length} checks passed`)
process.exit(failed ? 1 : 0)
