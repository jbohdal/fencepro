// Opens every screen and reports console errors, failed requests and blank pages.
import { chromium, newSession, login, sleep, nav, ready } from './lib.mjs'
const PAGES = ['Sales Pipeline','Dashboard','Customers','Quotes','Operations','Schedule','Dispatch','Site Plans','Inventory','P&L Statement','Balance Sheet','Cash Flow','Billing','Accounts Payable','Vendors','Reports','Budget','Team','Bundles','EZ Budget','Automations','Integrations','Portal','Audit Log','Settings']
const browser = await chromium.launch()
const a = await newSession(browser, 'A')
await login(a)
await ready(a)
let bad = 0
for (const p of PAGES) {
  const c0 = a.log.console.length, f0 = a.log.failed.length
  try {
    await nav(a, p)
    await sleep(900)
  } catch (e) { console.log(`${p.padEnd(18)} NAV FAILED ${String(e).slice(0, 80)}`); bad++; continue }
  const text = await a.page.locator('body').innerText()
  const crashed = text.trim().length < 200
  const errs = a.log.console.slice(c0), fails = a.log.failed.slice(f0)
  const banner = /Could not load|not saved|Admin access required|Admin required|Failed to|Not authenticated|migrating|Available after/i.exec(text)
  const status = crashed ? 'BLANK' : (errs.length || fails.length || banner) ? 'ISSUE' : 'ok'
  if (status !== 'ok') bad++
  console.log(`${p.padEnd(18)} ${status}${fails.length ? '  failed: ' + fails.join(', ') : ''}${errs.length ? '  console: ' + errs.map(e => e.slice(0, 110)).join(' || ') : ''}${banner ? '  text: "' + text.slice(Math.max(0, banner.index - 40), banner.index + 90).replace(/\n+/g, ' ') + '"' : ''}`)
}
console.log('pages with issues:', bad, 'of', PAGES.length)
await browser.close()
process.exit(bad ? 1 : 0)
