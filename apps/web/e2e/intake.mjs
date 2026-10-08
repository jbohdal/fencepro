// Intake test.
//
// A website quote (EZ Quote widget) and a phone agent call (Retell) arrive
// while the CRM is open. Both must become a customer, a note and a pipeline
// card, repeat contact must not create duplicates, and a second browser must
// see the same thing.
//
// Needs an EMPTY test database (it asserts exact counts). See README.md.
import { chromium, newSession, login, sleep, ready, nav, reporter, API, IMP } from './lib.mjs'
import crypto from 'crypto'
const { check, finish } = reporter()
// Must match the test server's environment.
const WIDGET_TOKEN = process.env.EZ_QUOTE_WIDGET_TOKEN || ''
const RETELL_KEY = process.env.RETELL_API_KEY || ''
if (!WIDGET_TOKEN || !RETELL_KEY) { console.error('Set EZ_QUOTE_WIDGET_TOKEN and RETELL_API_KEY to the values the test server runs with.'); process.exit(2) }

async function websiteQuote(name, phone, estimate) {
  const r = await fetch(`${API}/api/quoting/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${WIDGET_TOKEN}` },
    body: JSON.stringify({ userId: 'uid-1', customerName: name, customerPhone: phone, customerEmail: '', address: '5 Elm St, Ocala', material: 'vinyl', style: 'privacy', height: '6ft', color: 'white', linearFeet: 180, totalEstimate: estimate, requestOnSiteEstimate: true, gateConfig: { walkGates: 1, doubleGates: 1 } }) })
  return r.status
}
async function phoneCall(callId, from, custom) {
  const body = JSON.stringify({ event: 'call_analyzed', call: { call_id: callId, direction: 'inbound', from_number: from, to_number: '+13525550100', start_timestamp: Date.now() - 120000, end_timestamp: Date.now(), call_analysis: { call_summary: 'Wants a fence quote.', custom_analysis_data: custom } } })
  const ts = Date.now()
  const d = crypto.createHmac('sha256', RETELL_KEY).update(body + ts).digest('hex')
  const r = await fetch(`${API}/api/intake/retell`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Retell-Signature': `v=${ts},d=${d}` }, body })
  return r.status
}

const browser = await chromium.launch()
const a = await newSession(browser, 'A')
await login(a); await ready(a)

check('website quote accepted', await websiteQuote('Wendy Website', '(352) 555-0142', 6100) === 201)
check('phone call accepted', await phoneCall('call_1', '+13525550177', { caller_name: 'Carl Caller', fence_type: 'Chain link', callback_time: 'Tomorrow 10 AM' }) === 204)

const pull = async s => s.page.evaluate(`(async () => { ${IMP}; const m = await imp('intakeStore.ts'); const n = await m.syncIntake(); await new Promise(r => setTimeout(r, 1200)); return n })()`)
check('CRM picked up both leads', await pull(a) === 2)
const state = async s => s.page.evaluate(`(async () => { ${IMP}; const p = await imp('pipelineStore.ts'); const c = await imp('customerStore.ts'); return { leads: p.getPipeline().leads.map(l => ({ name: l.firstName + ' ' + l.lastName, src: l.leadSource, stage: l.stage, cid: l.customerId, price: l.quotePrice, notes: l.notes, fence: l.fenceType })), customers: c.getCustomers().map(x => ({ id: x.id, name: x.firstName + ' ' + x.lastName, src: x.leadSource })) } })()`)
let st = await state(a)
const wendy = st.leads.find(l => l.name === 'Wendy Website'), carl = st.leads.find(l => l.name === 'Carl Caller')
check('website quote is a pipeline card with its budget and source', !!wendy && wendy.price === 6100 && wendy.src === 'Website Quote' && wendy.stage === 'First Contact', JSON.stringify(wendy))
check('phone call is a pipeline card with the callback time', !!carl && /callback: Tomorrow 10 AM/.test(carl.notes) && carl.fence === 'Chain link', JSON.stringify(carl))
check('both customers exist and the cards point at them', st.customers.length === 2 && st.customers.some(c => c.id === wendy?.cid) && st.customers.some(c => c.id === carl?.cid))
check('nothing left in the queue', await pull(a) === 0)

// the same people again: no second card, no second customer
await phoneCall('call_2', '+13525550142', {})                      // Wendy calls in
await websiteQuote('Carl Caller', '352-555-0177', 3300)            // Carl uses the website
await phoneCall('call_1', '+13525550177', { caller_name: 'Carl Caller' })   // Retell retries call_1
check('repeat contact picked up', await pull(a) === 2)
st = await state(a)
check('still two customers and two cards after repeat contact', st.customers.length === 2 && st.leads.length === 2, `${st.customers.length} customers, ${st.leads.length} cards`)
check('the existing card got the new activity', /Phone call/.test(st.leads.find(l => l.name === 'Wendy Website')?.notes || '') && /Website quote/.test(st.leads.find(l => l.name === 'Carl Caller')?.notes || ''))

// what the user sees
await nav(a, 'Sales Pipeline'); await sleep(600)
const text = await a.page.locator('body').innerText()
check('cards are visible on the Sales Pipeline screen', /Wendy/.test(text) && /Carl/.test(text))
await nav(a, 'Customers'); await sleep(400)
await a.page.locator(':text-is("Wendy Website"):visible').first().click(); await sleep(900)
await a.page.getByRole('button', { name: /^notes$/i }).click(); await sleep(1500)
const custText = await a.page.locator('body').innerText()
check('the quote details are on the customer (Notes)', /Website quote \(EZ Quote\)/.test(custText) && /180 ft of vinyl/.test(custText), custText.match(/Website quote[^]{0,80}/)?.[0]?.replace(/\n/g, ' | ') || 'not found')

// second browser
const b = await newSession(browser, 'B'); await login(b); await ready(b)
const stB = await state(b)
check('second browser sees the same two cards and customers', stB.leads.length === 2 && stB.customers.length === 2)
check('no failed requests', a.log.failed.length === 0 && b.log.failed.length === 0, [...a.log.failed, ...b.log.failed].join(', '))

const code = finish()
await browser.close()
process.exit(code)
