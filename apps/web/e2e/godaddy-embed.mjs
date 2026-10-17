// The instant quote inside a GoDaddy "HTML" section, the way GoDaddy's
// builder wraps pasted code: a <section> with a sandboxed iframe whose
// content is the pasted code in srcdoc (no address of its own, same origin as
// the site), plus GoDaddy's height script. Read only: loads the live widget
// through the public door, sends nothing.
//
//   node e2e/godaddy-embed.mjs            (SHOTS=<folder> for a screenshot)

import { chromium } from 'playwright'

const WIDGET = process.env.WIDGET_URL || 'https://jonathans-mac-mini.tail40fb4a.ts.net:8443/p/quote/'
const SHOTS = process.env.SHOTS || ''
const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }

// Exactly what the designer pastes (from the email).
const EMBED = `<iframe src="${WIDGET}" title="Get an instant fence estimate" style="width:100%;max-width:640px;height:880px;border:0;display:block;margin:0 auto;" allow="camera"></iframe>`
// GoDaddy's wrapper for an HTML section.
const escapeAttr = s => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
const srcdoc = `<script>window.onmessage=function(e){if(e.data==='height'){e.source.postMessage({height:document.body.getBoundingClientRect().height||document.body.scrollHeight},'*')}}<\/script><body style='margin: 0'>${EMBED}</body>`
const page = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Instant Quote</title></head><body style="margin:0;font-family:sans-serif">
<header style="background:#1c1030;color:#fff;padding:12px">Site menu</header>
<section data-aid="HTML_SECTION_RENDERED"><iframe id="gd" title="HTML section" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation allow-top-navigation"
  src="javascript: window.frameElement.getAttribute(&quot;srcdoc&quot;);" srcdoc="${escapeAttr(srcdoc)}" style="width:100%;height:880px;border:0"></iframe></section>
<p style="text-align:center">Prefer to talk to someone? Call us.</p></body></html>`

// Reach the public door by its public address, as a customer's phone does. (On
// the Mac mini itself the name resolves to a private Tailscale address, and
// Chrome will not let a public website frame a private address.)
const PUBLIC_IP = process.env.PUBLIC_IP || ''
const browser = await chromium.launch(PUBLIC_IP ? { args: [`--host-resolver-rules=MAP ${new URL(WIDGET).hostname} ${PUBLIC_IP}`] } : {})
try {
  for (const [label, origin, shouldShow] of [
    ['www.gdfencepro.com', 'https://www.gdfencepro.com', true],
    ['gdfencepro.com', 'https://gdfencepro.com', true],
    ["GoDaddy's editor preview", 'https://websites.godaddy.com', false],
    ['another website', 'https://example-fence-competitor.com', false],
  ]) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
    await ctx.route(`${origin}/instant-quote`, r => r.fulfill({ contentType: 'text/html', body: page }))
    const p = await ctx.newPage()
    await p.goto(`${origin}/instant-quote`); await sleep(5000)
    const widget = p.frames().find(f => f.url().startsWith(WIDGET))
    const shows = !!widget && (await widget.locator('[data-w-address]').count().catch(() => 0)) === 1
    check(`${label}: ${shouldShow ? 'shows' : 'refused'}`, shows === shouldShow, p.frames().map(f => f.url().slice(0, 60)).join(' > '))
    if (shows && SHOTS && label === 'www.gdfencepro.com') await p.screenshot({ path: `${SHOTS}/godaddy-html-section.png` })
    if (shows && label === 'www.gdfencepro.com') {
      // It works inside GoDaddy's sandbox: the estimate call goes out and comes back.
      const ok = await widget.evaluate(async () => (await fetch('/p/quote/api/config')).ok)
      check('inside the GoDaddy sandbox the widget can reach EZ Biz', ok)
    }
    await ctx.close()
  }
} catch (e) {
  check('test run finished', false, String(e?.message || e).split('\n')[0])
} finally { await browser.close() }
const passed = results.filter(Boolean).length
console.log(`\n${passed} of ${results.length} checks passed`)
process.exit(passed === results.length ? 0 : 1)
