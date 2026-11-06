// Voice entry in a browser on the dev copy.
//
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 \
//   E2E_ACCESS_TOKEN=<dev staff token> VOICE_CLIP=/path/to/phrase.m4a node e2e/voice.mjs
//
// 1. The walk list: a stand-in for the phone's speech recognition "hears"
//    each length said at the mic by the feet box; what it heard is shown,
//    nothing is guessed, and the tape measure mark shows on its step.
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
  // ── 1. The walk list (Nov 5 2026): the mic by the feet box at each step ──
  {
    const { ctx, page, errors, b } = await phone(browser, ['thirty feet', 'one twenty', 'the trampoline goes here'])
    // Remembered per user: off, then on and still on when the quote screen opens again.
    await voiceOff(b)
    check('Voice switch off: typing is the default', (await b.locator('[data-voice-switch]').getAttribute('aria-checked')) === 'false')
    await voiceOn(b); await sleep(1200)
    await b.locator('button[aria-label="Close"]').click(); await sleep(300)
    await page.locator('button:has-text("New quote"):visible').first().click(); await sleep(1500)
    check('the Voice switch is remembered for this user', (await b.locator('[data-voice-switch]').getAttribute('aria-checked')) === 'true')
    check('the voice panel says where to talk: the mic by the feet box', (await b.locator('[data-voice-walk-list]').textContent().catch(() => '')).includes('tap the mic by the feet box') && (await b.locator('[data-voice-walk]').isDisabled().catch(() => true)))
    await go(b, 'yard')
    const feet = async () => b.locator('[data-walk-feet]').inputValue()
    const msg = async () => (await b.locator('[data-walk-msg]').textContent().catch(() => '')) || ''
    await b.locator('[data-walk-voice]').click(); await sleep(900)
    check('"thirty feet" fills the feet box and says what it heard', (await feet()) === '30' && /Heard 30 ft/.test(await msg()), `${await feet()} | ${await msg()}`)
    await b.locator('[data-walk-corner]').click(); await b.locator('[data-walk-right]').click(); await sleep(300)
    await b.locator('[data-walk-voice]').click(); await sleep(900)
    check('"one twenty" fills 120', (await feet()) === '120', await feet())
    await b.locator('[data-walk-end]').click(); await sleep(300)
    check('the two steps are on the list', (await b.locator('[data-walk-step]').allInnerTexts()).join(' | ').includes('Side 2: 120 ft, End post'))
    await b.locator('[data-walk-another]').click(); await sleep(300)
    await b.locator('[data-walk-voice]').click(); await sleep(900)
    check('not understood: said plainly on screen, nothing guessed', /no feet in it\. Type the feet instead/.test(await msg()) && (await feet()) === '', await msg())
    await go(b, 'style')
    await b.locator('select').filter({ hasText: 'Select a fence style' }).selectOption({ label: "White Vinyl Privacy, 6 ft tall, 8 ft sections, No dig" })
    await go(b, 'yard')
    check('120 ft at 8 ft wide: the tape measure mark on that step', await b.locator('[data-walk-step] [data-tape-flag]').count() === 1)
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/1-phone-voice-walk-list.png` })
    check('walk list voice: no page errors', errors.length === 0, errors.join(' | '))
    await go(b, 'customer')
    await voiceOff(b)
    await ctx.close()
  }

  // ── 2. Live voice fails: record, keep while offline, upload, transcribe on the Mac, apply ──
  // It fills in a drawn yard's named sides: a quote drawn before the walk list (Nov 5 2026). A new quote is walked,
  // and the walk list's mic is live voice only, so this runs only when asked (VOICE_DRAWN=1).
  if (CLIP && process.env.VOICE_DRAWN) {
    const { ctx, page, errors, b } = await phone(browser, [], 'network')
    await voiceOn(b)
    await go(b, 'yard')
    await b.locator('[data-shape="backyard"]').click()
    await go(b, 'style')
    await b.locator('select').filter({ hasText: 'Select a fence style' }).selectOption({ label: "White Vinyl Privacy, 6 ft tall, 8 ft sections, No dig" })
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
    await page.locator('[data-settings-tab="voice"]').click(); await sleep(400)
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
