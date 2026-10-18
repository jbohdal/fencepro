// The same new customer sent 3 times under a dropping signal.
//
//   E2E_ACCESS_TOKEN=<dev staff token> node e2e/create-repeat.mjs
//
// Through the bad signal proxy (signal.mjs) in "drop" mode: each send reaches
// the dev server, which saves, and the answer is cut before it gets back, so
// the phone sends again, as the save queue does. The same customer and card
// (one ID each), 3 times; then signal returns and a 4th send gets its answer.
// Passes only with exactly one customer and one pipeline card on the server.
// Then the same for a quote. Dev only (port 4001); removes what it made.
import crypto from 'crypto'
import { startSignal } from './signal.mjs'

const DEV = 'http://localhost:4001', PROXY = 4011
const TOKEN = process.env.E2E_ACCESS_TOKEN || ''
if (!TOKEN) { console.error('Set E2E_ACCESS_TOKEN.'); process.exit(2) }
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const api = async (p, init = {}, base = DEV) => {
  const r = await fetch(base + p, { ...init, headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(init.headers || {}) } })
  return { status: r.status, json: await r.json().catch(() => null) }
}
const signal = await startSignal({ listen: PROXY, target: 4001 })
const via = `http://127.0.0.1:${PROXY}`
const id = crypto.randomUUID(), cardId = crypto.randomUUID(), NAME = `Repeat ${id.slice(0, 6)}`
const body = { id, firstName: 'E2E', lastName: NAME, phone: '3525550198', leadSource: 'Other', lead: { id: cardId, customerId: id, firstName: 'E2E', lastName: NAME, phone: '3525550198', stage: 'First Contact', leadSource: 'Other', createdAt: '2026-10-18', lastMoved: '2026-10-18' }, leadBefore: null }
try {
  signal.set('drop')
  let heard = 0
  for (let i = 0; i < 3; i++) {
    const r = await api('/api/crm-contacts', { method: 'POST', body: JSON.stringify(body) }, via).catch(() => null)
    if (r) heard++
  }
  check('dropping signal: none of the 3 answers reached the phone', heard === 0, `${heard} heard`)
  check('all 3 reached the server', signal.counts('POST', '/api/crm-contacts') === 3, String(signal.counts('POST', '/api/crm-contacts')))
  signal.set('up')
  const last = await api('/api/crm-contacts', { method: 'POST', body: JSON.stringify(body) }, via)
  check('signal back: the 4th send is told it is already saved', last.status === 200 && last.json?.data?.id === id, String(last.status))
  const contacts = (await api('/api/crm-contacts')).json.data.filter(c => c.lastName === NAME)
  check('exactly one customer', contacts.length === 1, String(contacts.length))
  const cards = (await api('/api/pipeline')).json.data.leads.filter(l => l.customerId === id)
  check('exactly one pipeline card', cards.length === 1, String(cards.length))

  // A quote for them, the same way.
  const qid = crypto.randomUUID()
  const quote = { id: qid, crmContactId: id, customerName: `E2E ${NAME}`, fenceStyle: "WV-ND 6'x6' Privacy", runs: [100], corners: 0, ends: 2, walkGates: 0, dblGates: 0, sections: 17, status: 'DRAFT', date: '2026-10-18' }
  signal.set('drop')
  for (let i = 0; i < 3; i++) await api('/api/saved-quotes', { method: 'POST', body: JSON.stringify(quote) }, via).catch(() => null)
  signal.set('up')
  const quotes = (await api('/api/saved-quotes')).json.data.filter(q => q.id === qid || q.customerName === `E2E ${NAME}`)
  check('a quote sent 3 times under drops: exactly one', quotes.length === 1, String(quotes.length))
  await api(`/api/saved-quotes/${qid}`, { method: 'DELETE' })
} catch (e) {
  check('test run finished', false, String(e?.message || e).slice(0, 200))
} finally {
  // Remove the card and the customer.
  const p = (await api('/api/pipeline')).json
  const mine = (p?.data?.leads ?? []).filter(l => l.customerId === id).map(l => l.id)
  if (mine.length) await api('/api/pipeline', { method: 'PATCH', body: JSON.stringify({ upsert: [], remove: mine, baseVersion: p.data.version }) })
  await api(`/api/crm-contacts/${id}`, { method: 'DELETE' })
  await signal.close()
}
const failed = results.filter(r => !r).length
console.log(`\n${results.length - failed} of ${results.length} checks passed`)
process.exit(failed ? 1 : 0)
