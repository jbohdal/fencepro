// Round 3 walkthrough fixes (Oct 26 2026), on the dev copy, as the office at computer size.
//
//   APP_URL=http://localhost:4001 E2E_ACCESS_TOKEN=<dev token> [CUSTOMER_ID=<a customer with a job>] [SHOTS=<folder>] node e2e/round3.mjs
//
// The customer page: no "Saved" chip in the header; the Jobs tab reads its
// Scheduled day in words and its row opens the job in Operations. With no
// CUSTOMER_ID it makes its own customer (@example.invalid) with a scheduled job
// and removes both at the end; the page itself saves nothing.

import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import { chromium } from 'playwright'
import crypto from 'crypto'

const APP = process.env.APP_URL || 'http://localhost:4001'
const TOKEN = process.env.E2E_ACCESS_TOKEN || ''
let CUSTOMER = process.env.CUSTOMER_ID || ''
const SHOTS = process.env.SHOTS || ''
if (!/^http:\/\/localhost:\d+\/?$/.test(APP) || /:4000\b/.test(APP)) { console.error('Refusing to run: the dev copy only.'); process.exit(2) }
if (!TOKEN) { console.error('Set E2E_ACCESS_TOKEN.'); process.exit(2) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }

const call = async (p, init = {}) => {
  const r = await fetch(APP.replace(/\/$/, '') + p, { ...init, headers: { Authorization: `Bearer ${TOKEN}`, 'X-Staff-Request': '1', ...(init.body ? { 'Content-Type': 'application/json' } : {}) } })
  return { status: r.status, json: await r.json().catch(() => null) }
}
// Its own customer with a job scheduled on a crew day, unless one was named.
let madeCustomer = '', madeJob = ''
if (!CUSTOMER) {
  const tag = crypto.randomUUID().slice(0, 6)
  madeCustomer = crypto.randomUUID()
  const c = await call('/api/crm-contacts', { method: 'POST', body: JSON.stringify({ id: madeCustomer, firstName: 'Round3', lastName: `E2E ${tag}`, phone: '3525550163', email: `round3.${tag}@example.invalid`, serviceAddress: '100 Pecan Dr, Ocala, FL 34472', leadSource: 'Other' }) })
  const j = await call('/api/saved-jobs', { method: 'POST', body: JSON.stringify({ customerName: `Round3 E2E ${tag}`, customerAddress: '100 Pecan Dr, Ocala, FL 34472', customerPhone: '3525550163', crmContactId: madeCustomer, fenceStyle: "WV-ND 6'x6' Privacy", sections: 10, contractValue: 4000, status: 'scheduled', scheduledDate: '2026-12-08' }) })
  madeJob = j.json?.data?.id || ''
  if (!(c.status === 200 || c.status === 201) || !madeJob) { console.error(`Could not make the test customer and job: ${c.status} ${j.status}`); process.exit(1) }
  CUSTOMER = madeCustomer
}

const browser = await chromium.launch()
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addInitScript(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, TOKEN)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)))
  await page.goto(`${APP}/customers/${encodeURIComponent(CUSTOMER)}?tab=jobs`)
  await page.waitForSelector('[data-customer-name]', { timeout: 30000 }); await sleep(1500)
  check('the customer header shows no "Saved" chip', await page.locator('[data-save-status="saved"]:visible').count() === 0)
  const row = page.locator('[data-customer-job]').first()
  await row.waitFor({ timeout: 15000 }).catch(() => {})
  const text = (await row.innerText().catch(() => '')).replace(/\s+/g, ' ')
  check('the Jobs row reads its day in words, not 2026-10-26', !!text && !/\d{4}-\d{2}-\d{2}/.test(text), text)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/round3-customer-jobs.png` })
  await row.click()
  await page.waitForURL(/\/operations\?job=/, { timeout: 15000 }).catch(() => {})
  check('the row opens the job in Operations', /\/operations\?job=/.test(page.url()), page.url())
  await page.waitForSelector('[data-job-panel]', { timeout: 15000 }).catch(() => {})
  check('the job window is open', await page.locator('[data-job-panel]').count() > 0)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/round3-job-opened.png` })
  check('no page errors', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
  if (madeJob) await call(`/api/saved-jobs/${madeJob}`, { method: 'DELETE' })
  if (madeCustomer) await call(`/api/crm-contacts/${madeCustomer}`, { method: 'DELETE' })
}
console.log(`\n${results.filter(Boolean).length} of ${results.length} checks passed`)
process.exit(results.every(Boolean) ? 0 : 1)
