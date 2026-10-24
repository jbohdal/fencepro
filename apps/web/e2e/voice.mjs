// Voice entry in a browser on the dev copy.
//
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 \
//   E2E_ACCESS_TOKEN=<dev staff token> VOICE_CLIP=/path/to/phrase.m4a node e2e/voice.mjs
//
// 1. Guided walk: a stand-in for the phone's speech recognition "hears" a
//    scripted conversation, so the prompts, read back, the "fifteen or
//    fifty?" question, a side turned off and "done" are all checked.
// 2. Record and transcribe later: live voice fails with "network", the
//    phone records (a stand-in recorder hands over VOICE_CLIP, a real spoken
//    sentence; test machines have no microphone), the clip waits on the
//    phone while offline, uploads when back online, the Mac transcribes it
//    with whisper.cpp, and Apply fills in the sides.
// Nothing is saved; the test clip is deleted.

import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import { chromium } from 'playwright'
import fs from 'fs'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || 'http://localhost:4001'
const TOKEN = process.env.E2E_ACCESS_TOKEN || ''
const CLIP = process.env.VOICE_CLIP ? fs.readFileSync(process.env.VOICE_CLIP).toString('base64') : ''
const SHOTS = process.env.SHOTS || ''
const local = u => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(u)
if (!local(APP) || !local(API) || /:4000(\/|$)/.test(API)) { console.error('Refusing to run: the dev copy only (localhost, not port 4000).'); process.exit(2) }
if (!TOKEN) { console.error('Set E2E_ACCESS_TOKEN.'); process.exit(2) }

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const api = async (p, init = {}) => {
  const r = await fetch(API + p, { ...init, headers: { Authorization: `Bearer ${TOKEN}`, ...(init.headers || {}) } })
  const j = await r.json().catch(() => ({}))
  return j.data ?? j
}

// Stand-ins for the phone: speech recognition answers from a script, speaking is recorded.
function phoneVoice({ script, failWith, clip }) {
  if (clip) {
    // Stand-in microphone and recorder: "records" the given clip.
    const bytes = Uint8Array.from(atob(clip), c => c.charCodeAt(0))
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) }, configurable: true })
    window.MediaRecorder = class {
      static isTypeSupported(m) { return m === 'audio/mp4' }
      constructor() { this.mimeType = 'audio/mp4' }
      start() {}
      stop() { this.ondataavailable?.({ data: new Blob([bytes], { type: 'audio/mp4' }) }); setTimeout(() => this.onstop?.(), 20) }
    }
  }
  window.__spoken = []
  window.__script = [...script]
  const Fake = class {
    start() {
      setTimeout(() => {
        if (failWith) { this.onerror?.({ error: failWith }); return }
        const next = window.__script.shift()
        if (next === undefined) { this.onend?.(); return }
        this.onresult?.({ results: [[{ transcript: next }]] })
      }, 120)
    }
    abort() {} stop() {}
  }
  for (const k of ['webkitSpeechRecognition', 'SpeechRecognition']) Object.defineProperty(window, k, { value: Fake, configurable: true, writable: true })
  const synth = { speak: u => { window.__spoken.push(u.text); setTimeout(() => u.onend?.(), 30) }, cancel() {}, getVoices: () => [1, 2], speaking: false }
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true })
  window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t } }
}

async function phone(browser, script, failWith) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, permissions: ['microphone'] })
  await ctx.addInitScript(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, TOKEN)
  await ctx.addInitScript(phoneVoice, { script, failWith: failWith ?? null, clip: failWith ? CLIP : '' })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 300)))
  page.on('dialog', d => d.accept().catch(() => {}))
  await page.goto(APP); await page.waitForSelector('[data-tabbar]', { timeout: 30000 }); await sleep(800)
  await page.locator('button:has-text("New quote"):visible').first().click()
  return { ctx, page, errors, b: page.locator('[data-quote-builder]') }
}
async function voiceOn(b) { if ((await b.locator('[data-voice-switch]').getAttribute('aria-checked')) !== 'true') await b.locator('[data-voice-switch]').click() }
async function voiceOff(b) { if ((await b.locator('[data-voice-switch]').getAttribute('aria-checked')) === 'true') { await b.locator('[data-voice-switch]').click(); await sleep(800) } }
// A side's length as its row shows it ("30' 0\"", or "no length").
const len = async (b, name) => (await b.locator(`[data-side="${name}"] [data-side-len]`).textContent().catch(() => '')).trim()
const go = async (b, k) => { await b.locator(`[data-step="${k}"]`).click(); await sleep(200) }

const browser = await chromium.launch()
let clipIds = []
try {
  // ── 1. Guided walk ──
  {
    const { ctx, page, errors, b } = await phone(browser, [
      'thirty with a four foot gate in the middle', // Left return
      'one twenty',                                  // Left side → 15 sections exactly: tape reminder
      'yes',                                         // … keep it
      'fifteen',                                     // Back → "Back: fifteen or fifty?"
      'one fifty',                                   // … the length said again
      'one twenty',                                  // Right side → tape reminder
      'yes',
      'no right return',                             // Right return off
      'note gate code is 4512',                      // then a note
      "what's the total",
      'done',
    ])
    // Remembered per user: off, then on and still on when the quote screen opens again.
    await voiceOff(b)
    check('Voice switch off: typing is the default', (await b.locator('[data-voice-switch]').getAttribute('aria-checked')) === 'false')
    await voiceOn(b); await sleep(1200)
    await b.locator('button[aria-label="Close"]').click(); await sleep(300)
    await page.locator('button:has-text("New quote"):visible').first().click(); await sleep(1500)
    check('the Voice switch is remembered for this user', (await b.locator('[data-voice-switch]').getAttribute('aria-checked')) === 'true')
    await go(b, 'yard')
    await b.locator('[data-shape="backyard"]').click()
    await go(b, 'style')
    await b.locator('select').filter({ hasText: 'Select a fence style' }).selectOption({ label: "White Vinyl Privacy, 6 ft tall, 8 ft panels, No dig" })
    await go(b, 'customer')
    await voiceOn(b)
    await b.locator('[data-voice-walk]').click()
    await page.waitForFunction(() => window.__script.length === 0, null, { timeout: 30000 }).catch(() => {})
    await sleep(1500)
    const spoken = await page.evaluate(() => window.__spoken)
    check('it asks for each side by name', ['Left return?', 'Left side?', 'Back?', 'Right side?', 'Right return?'].every(t => spoken.includes(t)), spoken.slice(0, 6).join(' | '))
    check('it reads back what it understood', spoken.includes('Left return, 30 feet, 4 foot walk gate in the middle'), spoken.find(t => t.startsWith('Left return,')) || 'none')
    check('it asks "fifteen or fifty?" instead of taking 15 ft', spoken.includes('Back: fifteen or fifty?'))
    check('it gives the tape measure reminder on a run that lands on whole sections', spoken.some(t => t.startsWith("Left side 120' 0\" lands right on 15 sections")))
    check('sides filled in: 30, 120, 150, 120', (await len(b, 'Left return')).startsWith("30' 0\"") && (await len(b, 'Left side')).startsWith("120' 0\"") && (await len(b, 'Back')).startsWith("150' 0\"") && (await len(b, 'Right side')).startsWith("120' 0\""),
      [await len(b, 'Left return'), await len(b, 'Back')].join(' | '))
    check('"no right return" turns that side off', (await b.locator('[data-side="Right return"] [data-side-row]').textContent()).includes('· off'))
    await go(b, 'yard')
    // Open the left return (a tap on an open side's row closes it).
    if (!(await b.locator('[data-side-open="true"][data-side="Left return"]').count())) await b.locator('[data-side-row="Left return"]').click()
    check('the walk gate is on the left return', (await b.locator('[data-side="Left return"] [data-side-ends]').textContent()).includes("4' 0\" gate"))
    check('"note …" adds a crew note', (await b.locator('[data-voice-notes]').textContent().catch(() => '')).includes('gate code is 4512'))
    check('"what\'s the total" says footage, sections and price', spoken.some(t => /^\d+ feet, \d+ sections, [\d,]+ dollars\.$/.test(t)), spoken.find(t => / sections, /.test(t)) || 'none')
    check('a mic on the open side for one quick entry', await b.locator('[data-side-open="true"] [data-side-mic]').count() === 1)
    await go(b, 'customer')
    if (SHOTS) { await b.locator('[data-voice-panel]').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${SHOTS}/1-phone-voice-walk.png` }) }
    check('walk: no page errors', errors.length === 0, errors.join(' | '))
    await voiceOff(b)
    await ctx.close()
  }

  // ── Something it cannot understand is shown and said back ──
  {
    const { ctx, page, errors, b } = await phone(browser, ['the trampoline goes here', 'done'])
    await go(b, 'yard')
    await b.locator('[data-shape="backyard"]').click()
    await go(b, 'customer')
    await voiceOn(b)
    await b.locator('[data-voice-walk]').click()
    await page.waitForFunction(() => window.__script.length === 0, null, { timeout: 20000 }).catch(() => {})
    await sleep(800)
    const spoken = await page.evaluate(() => window.__spoken)
    check('not understood: shown on screen', (await b.locator('[data-voice-unknown]').textContent().catch(() => '')).includes('trampoline'))
    check('not understood: said back, nothing guessed', spoken.some(t => t.startsWith('I did not understand')) && (await len(b, 'Left return')) === 'no length')
    check('unknown: no page errors', errors.length === 0, errors.join(' | '))
    await voiceOff(b)
    await ctx.close()
  }

  // ── 2. Live voice fails: record, keep while offline, upload, transcribe on the Mac, apply ──
  if (CLIP) {
    const { ctx, page, errors, b } = await phone(browser, [], 'network')
    await voiceOn(b)
    await go(b, 'yard')
    await b.locator('[data-shape="backyard"]').click()
    await go(b, 'style')
    await b.locator('select').filter({ hasText: 'Select a fence style' }).selectOption({ label: "White Vinyl Privacy, 6 ft tall, 8 ft panels, No dig" })
    await go(b, 'yard')
    // A quick mic on a side tries live voice, gets "network", and offers recording.
    await b.locator('[data-side="Left return"] [data-side-mic]').click(); await sleep(1500)
    await go(b, 'customer')
    check('live voice fails: the panel offers Record instead (never just hides voice)', await b.locator('[data-voice-record], [data-voice-stop-rec]').count() > 0, (await b.locator('[data-voice-status]').textContent().catch(() => '')) || '')
    // The quick mic went straight to recording for the left return; stop that one.
    if (await b.locator('[data-voice-stop-rec]').waitFor({ timeout: 8000 }).then(() => true).catch(() => false)) { await b.locator('[data-voice-stop-rec]').click(); await sleep(800) }
    await ctx.setOffline(true)
    await b.locator('[data-voice-record]').click(); await sleep(1500)
    await b.locator('[data-voice-stop-rec]').click(); await sleep(1500)
    const waitingText = (await b.locator('[data-voice-clips]').textContent().catch(() => '')) || ''
    check('offline: the recording waits on the phone', /recordings? waiting for signal/.test(waitingText), waitingText.slice(0, 120))
    if (SHOTS) { await b.locator('[data-voice-panel]').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${SHOTS}/2-phone-voice-offline.png` }) }
    await ctx.setOffline(false)
    await page.evaluate(() => window.dispatchEvent(new Event('online')))
    let applied = false
    for (let i = 0; i < 30 && !applied; i++) {
      await sleep(2000)
      if (await b.locator('[data-voice-apply]').count()) applied = true
    }
    const clipText = (await b.locator('[data-voice-clips]').textContent().catch(() => '')) || ''
    check('back online: uploaded and transcribed on the Mac', applied && /left side/i.test(clipText), clipText.slice(0, 160))
    if (applied) {
      await b.locator('[data-voice-apply]').first().click(); await sleep(800)
      // 120 ft lands on 15 sections: the tape reminder waits for a tap without live voice.
      const q = (await b.locator('[data-voice-question]').textContent().catch(() => '')) || ''
      check('applying asks the tape question and waits for a tap', q.includes('lands right on 15 sections'), q.slice(0, 120))
      if (SHOTS) { await b.locator('[data-voice-question]').scrollIntoViewIfNeeded().catch(() => {}); await page.screenshot({ path: `${SHOTS}/3a-phone-voice-question.png` }) }
      await b.locator('[data-voice-question] button:has-text("Keep it")').click().catch(() => {}); await sleep(1200)
      check('Apply fills in the sides from the transcript', (await len(b, 'Left side')).startsWith("120' 0\"") && (await len(b, 'Back')).startsWith("150' 0\"") && (await len(b, 'Right return')).startsWith("30' 0\""),
        [await len(b, 'Left side'), await len(b, 'Back'), await len(b, 'Right return')].join(' | '))
    }
    if (SHOTS) { await b.locator('[data-voice-panel]').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${SHOTS}/3-phone-voice-transcribed.png` }) }
    const errs = errors.filter(e => !/Failed to fetch|NetworkError|Load failed/.test(e))
    check('record: no page errors', errs.length === 0, errs.join(' | '))
    const mine = await api('/api/voice/clips')
    clipIds = (Array.isArray(mine) ? mine : []).filter(c => Date.now() - new Date(c.createdAt).getTime() < 10 * 60_000).map(c => c.id)
    await voiceOff(b)
    await ctx.close()
  }

  // ── Settings → Voice: Practice ──
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    await ctx.addInitScript(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, TOKEN)
    const page = await ctx.newPage()
    await page.goto(APP); await page.waitForSelector('[data-global-appointment]', { timeout: 30000 }); await sleep(800)
    await page.locator('span:text-is("Settings"):visible').first().click(); await sleep(400)
    await page.locator('button:text-is("Voice")').click(); await sleep(400)
    await page.locator('[data-practice-input]').fill('ten foot double by the house, back one fifty skip forty for the neighbors fence, purple')
    const out = (await page.locator('[data-practice-result]').textContent()).replace(/\s+/g, ' ')
    check('Practice shows what was understood and what was not', out.includes("Back, 150' 0\", skip 40' 0\" (existing fence)") && out.includes('Did not understand: “purple”'), out)
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/4-settings-voice.png`, fullPage: true })
    await ctx.close()
  }
} catch (e) {
  check('test run finished', false, String(e).split('\n').slice(0, 3).join(' '))
} finally {
  for (const id of clipIds) await api(`/api/voice/clips/${id}`, { method: 'DELETE' })
  await browser.close()
}
const passed = results.filter(Boolean).length
console.log(`\n${passed} of ${results.length} checks passed`)
process.exit(passed === results.length ? 0 : 1)
