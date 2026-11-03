// A move and a repair saved as the Salesman on a phone, with their second option ("Move as is", "New fence instead"):
// the saves a server price check once refused (review Nov 2 2026). Dev copy only.
//
//   APP_URL=http://localhost:4093 API_URL=http://localhost:4093 SALES_COOKIE=<Salesman cookie value> node e2e/mixed-work-saves.mjs
//
// Leaves two quotes named "Mixed e2e work ..." for the caller to remove.
import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import { webkit } from 'playwright'
import { signInByCookie, pickFence } from './lib.mjs'
import { devSignIn, DEV_SALES_EMAIL } from './devSignIn.mjs'

const APP = process.env.APP_URL || 'http://localhost:4001', API = process.env.API_URL || APP
// Not given (the nightly gives the owner's sign in only): the Salesman's made here.
const SALES = process.env.SALES_COOKIE || devSignIn(DEV_SALES_EMAIL, { cookie: true })
if (!SALES) { console.error('Set SALES_COOKIE.'); process.exit(2) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const run = Date.now().toString(36)

const browser = await webkit.launch()
async function quote(name, feet, job) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await signInByCookie(ctx, { cookie: SALES, api: API })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)))
  page.on('dialog', d => d.accept().catch(() => {}))
  const b = page.locator('[data-quote-builder]'), bar = page.locator('[data-quote-bar]')
  await page.goto(`${APP}/quotes`); await page.waitForSelector('[data-tabbar]', { timeout: 30000 }); await sleep(1500)
  await page.locator('button:has-text("New quote"):visible').first().tap(); await sleep(800)
  await b.locator('input[placeholder^="Customer name"]').fill(name)
  await bar.locator('[data-bar-next]').tap(); await sleep(300)
  await b.locator('[data-shape="straight"]').tap(); await sleep(300)
  await b.locator('[data-side-open="true"][data-side="Fence"] [data-side-length]').tap(); await sleep(150)
  for (const d of feet) { await page.locator(`[data-ftin-pad] [data-pad-key="${d}"]`).tap(); await sleep(60) }
  await page.locator('[data-ftin-pad] [data-pad-done]').tap(); await sleep(200)
  await bar.locator('[data-bar-next]').tap(); await sleep(500)
  // Her picker (Nov 2 2026): Material > Style > Height > Color; the width is the best price.
  await pickFence(page, 'vinyl', { style: 'privacy', height: '6', color: 'white' })
  await job(b, page, bar)
  await sleep(1500)
  await page.locator('[data-quote-bar] [data-save-open]').tap(); await sleep(800)
  await page.locator('[data-save-mode="new"]').tap().catch(() => {}); await sleep(300)
  await page.locator('[data-save-submit]').tap(); await sleep(3500)
  const list = (await (await ctx.request.get(`${API}/api/saved-quotes?full=1`)).json()).data ?? []
  const q = list.find(x => x.customerName.startsWith(name))
  const said = await page.locator('body').textContent()
  await ctx.close()
  return { q, refused: /Not saved|Couldn't save/.test(said), errors }
}
try {
  const mv = await quote(`Mixed e2e work move ${run}`, '120', async (b, page, bar) => {
    await b.locator('[data-job-type-option="move"]').tap(); await sleep(400)
    await b.locator('[data-move-old-ft]').fill('100')
    await b.locator('[data-move-old-walk]').fill('0'); await sleep(600)
    await bar.locator('[data-bar-next]').tap(); await sleep(800)
  })
  check('move saved as the Salesman, with Move as is at its own price', !!mv.q && !mv.refused && mv.q.proposal?.options?.length === 2 && mv.q.proposal.options[0].finalPrice !== mv.q.proposal.options[1].finalPrice, JSON.stringify(mv.q?.proposal?.options?.map(o => [o.label.slice(0, 34), o.finalPrice])))
  const rp = await quote(`Mixed e2e work repair ${run}`, '60', async (b, page, bar) => {
    await b.locator('[data-job-type-option="repair"]').tap(); await sleep(400)
    await b.locator('[data-repair-item="replaceSection"] button[aria-label^="One more"]').tap(); await sleep(200)
    await b.locator('[data-repair-item="replaceSection"] button[aria-label^="One more"]').tap(); await sleep(200)
    await bar.locator('[data-bar-next]').tap(); await sleep(1200)
    const offer = b.locator('[data-offer-new-fence]')
    if (await offer.count()) { await offer.tap(); await sleep(1200) }
  })
  check('repair saved as the Salesman', !!rp.q && !rp.refused && rp.q.proposal?.options?.length >= 1, JSON.stringify(rp.q?.proposal?.options?.map(o => [o.label.slice(0, 34), o.finalPrice])))
  check('no page errors', mv.errors.length + rp.errors.length === 0, [...mv.errors, ...rp.errors].join(' | '))
} catch (e) {
  check('test run finished', false, String(e).split('\n').slice(0, 3).join(' '))
} finally { await browser.close() }
const passed = results.filter(Boolean).length
console.log(`\n${passed} of ${results.length} checks passed`)
process.exit(passed === results.length ? 0 : 1)
