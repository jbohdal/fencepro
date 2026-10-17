// The instant quote embedded on the REAL gdfencepro.com home page (loaded
// live from the site's own server), using exactly the code in the designer
// email. Read only: nothing on the site changes; the code is added to the
// page in this test browser only.
//
//   SITE_IP=91.246.36.201 PUBLIC_IP=<public door ip> SHOTS=<folder> node e2e/real-site-embed.mjs
import { chromium } from 'playwright'
const WIDGET = 'https://jonathans-mac-mini.tail40fb4a.ts.net:8443/p/quote/'
const EMBED = `<iframe src="${WIDGET}" title="Get an instant fence estimate" style="width:100%;max-width:640px;height:880px;border:0;display:block;margin:0 auto;" allow="camera"></iframe>`
const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (n, ok, d = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  -- ' + d : ''}`) }
const rules = [process.env.SITE_IP && `MAP gdfencepro.com ${process.env.SITE_IP}`, process.env.SITE_IP && `MAP www.gdfencepro.com ${process.env.SITE_IP}`, process.env.PUBLIC_IP && `MAP ${new URL(WIDGET).hostname} ${process.env.PUBLIC_IP}`].filter(Boolean)
const browser = await chromium.launch({ args: rules.length ? [`--host-resolver-rules=${rules.join(',')}`] : [] })
try {
  for (const [label, url, vp] of [['phone', 'https://www.gdfencepro.com/', { width: 390, height: 844, isMobile: true, hasTouch: true }], ['computer', 'https://gdfencepro.com/', { width: 1280, height: 900 }]]) {
    const { width, height, ...rest } = vp
    const ctx = await browser.newContext({ viewport: { width, height }, ...rest })
    const p = await ctx.newPage()
    await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }); await sleep(2500)
    const real = (await p.title()).includes('Getter Done Fence')
    check(`${label}: the real website loads (${new URL(p.url()).host})`, real, await p.title())
    // Where the designer would put it: a section on the page, with the call line under it.
    await p.evaluate(html => { const s = document.createElement('section'); s.id = 'instant-quote'; s.innerHTML = html + '<p style="text-align:center">Prefer to talk to someone? Call (352) 789-4314.</p>'; (document.querySelector('main') || document.body).prepend(s); s.scrollIntoView() }, EMBED)
    await sleep(6000)
    const f = p.frames().find(x => x.url().startsWith(WIDGET))
    const shows = !!f && (await f.locator('[data-w-address]').count().catch(() => 0)) === 1
    check(`${label}: the instant quote shows inside the real gdfencepro.com page`, shows, p.frames().map(x => x.url().slice(0, 50)).join(' > '))
    if (shows) check(`${label}: and works there (the estimate service answers)`, await f.evaluate(async () => (await fetch('/p/quote/api/config')).ok))
    if (process.env.SHOTS) await p.screenshot({ path: `${process.env.SHOTS}/real-site-${label}.png` })
    await ctx.close()
  }
} catch (e) { check('test run finished', false, String(e?.message || e).split('\n')[0]) } finally { await browser.close() }
const passed = results.filter(Boolean).length
console.log(`\n${passed} of ${results.length} checks passed`)
process.exit(passed === results.length ? 0 : 1)
