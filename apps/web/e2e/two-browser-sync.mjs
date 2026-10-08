// Two browser sync test.
//
// Browser A changes every module through the app's own stores. Browser B is a
// brand new browser (empty storage, like a second computer) that logs in and
// must see all of it. Then: a new browser logging in must not wipe anything,
// a save made with an expired login token must still land, and a module that
// failed to load must refuse to save.
//
// Needs an EMPTY test database (it asserts exact counts). See README.md.
import { chromium, newSession, login, ready, reporter } from './lib.mjs'
const { check, finish } = reporter()

const browser = await chromium.launch()
const a = await newSession(browser, 'A')
await login(a); await ready(a)

// ── A writes ──────────────────────────────────────────────────────────────
const made = await a.page.evaluate(async () => {
  const imp = name => { const hit = performance.getEntriesByType('resource').map(e => e.name).filter(n => n.includes('/src/' + name)).pop(); return import(hit ? hit.replace(location.origin, '') : '/src/' + name) }
  const inv = await imp('inventoryStore.ts')
  const cfg = await imp('configStore.ts')
  const vend = await imp('vendorStore.ts')
  const pipe = await imp('pipelineStore.ts')
  const sched = await imp('scheduleStore.ts')
  const cust = await imp('customerStore.ts')
  const quotes = await imp('quoteStore.ts')
  const jobs = await imp('jobStore.ts')
  const cloud = await imp('cloudStorage.ts')
  const checklist = await imp('checklistStore.ts')
  const calc = await imp('materialCalculator.ts')

  // inventory: change one cost
  const items = inv.getInventory().map(i => i.name === '*Vinyl, White, Picket, 62-1/4"' ? { ...i, unitCost: 3.33 } : i)
  inv.saveInventory(items)
  // settings: pricing
  const c = cfg.getConfig()
  cfg.saveConfig({ ...c, company: { ...c.company, name: 'GD Fence Pro' }, pricing: { ...c.pricing, manHourRate: 25, laborMode: 'subcontractor', subRateDefault: 6.5, subRateByCategory: { Vinyl: 7.25 } } })
  // vendor
  const v = vend.createVendor({ name: 'Sync Test Supply', contactName: 'Pat', email: 'pat@example.com', phone: '', address: '', paymentTerms: 'net_30', notes: '', isActive: true })
  // customer → quote → job, all in one tick (the case that used to fail)
  const { customer } = cust.upsertCustomer({ firstName: 'Sync', lastName: 'Tester', phone: '3525550199', email: 'sync@example.com', serviceAddress: '1 Test Rd' })
  const pull = calc.calculateMaterials({ fenceStyle: "WV-ND 6'x6' Privacy", runs: [60], corners: 0, ends: 2, walkGates: 0, dblGates: 0, tearOutSections: 0, tearOutGates: 0 })
  const q = quotes.upsertQuote({ customerId: customer.id, customerName: 'Sync Tester', fenceStyle: "WV-ND 6'x6' Privacy", runs: [60], sections: 10, materialCost: 900, laborCost: 435, totalCOGS: 1335, finalPrice: 2085.94, gmPct: 0.36, pullSheet: pull, status: 'SOLD', pricing: { laborMode: 'subcontractor', subRate: 7.25, subUnit: 'foot', priceMethod: 'cost_factor' } })
  const job = jobs.createJobFromQuote(q)
  jobs.updateJob(job.id, { crewAssigned: 'Crew 1', notes: 'gate code 1234' })
  const items2 = checklist.getChecklistForJob(job.id)
  if (items2[0]) checklist.toggleChecklistItem(job.id, items2[0].id, 'tester')
  // rapid edits on the quote: the last one must win
  quotes.updateQuote(q.id, { notes: 'first' }); quotes.updateQuote(q.id, { notes: 'second' }); quotes.updateQuote(q.id, { notes: 'final note' })
  // pipeline
  const p = pipe.getPipeline()
  pipe.savePipeline([...p.leads, { id: 'lead-sync-1', name: 'Pipeline Lead', customerId: customer.id, stage: 'First Contact', value: 2085 }], p.stages)
  // schedule: add 2 jobs, save 3 times, then remove one
  const s = sched.loadSchedule()
  const j1 = { id: 'sch-1', clientName: 'Sched One', area: 'Ocala', sections: 10, fenceType: 'Vinyl', jobPrice: 2000, tearout: false, crewId: 'crew1', date: '2026-10-12', notes: '', status: 'Scheduled' }
  const j2 = { ...j1, id: 'sch-2', clientName: 'Sched Two', date: '2026-10-13' }
  sched.saveSchedule([...s.jobs, j1, j2], s.settings)
  await new Promise(r => setTimeout(r, 900))
  sched.saveSchedule([...s.jobs, j1, { ...j2, notes: 'moved' }], s.settings)
  await new Promise(r => setTimeout(r, 900))
  sched.saveSchedule([...s.jobs, j1, { ...j2, notes: 'moved again' }], s.settings)
  await new Promise(r => setTimeout(r, 900))
  sched.saveSchedule([...s.jobs, { ...j2, notes: 'moved again' }], s.settings)   // j1 removed
  // browser only data that now lives on the server
  cloud.cloudStorage.setItem('fencepro_jobcosting', JSON.stringify([{ id: 'jc1', quoteId: q.id, completionDate: '2026-10-05', actualLaborHrs: 12, crew: [{ name: 'Sub', hours: 12, rate: 30 }], actualMaterialCost: 880, actualOtherCosts: 0, notes: '' }]))
  cloud.cloudStorage.setItem('fencepro_changeorders', JSON.stringify([{ id: 'co1', jobId: job.id, amount: 350, description: 'extra gate' }]))
  cloud.cloudStorage.setItem('fencepro_siteplans', JSON.stringify([{ id: 'sp1', name: 'Back yard', customerId: customer.id, lines: [], markers: [] }]))
  // billing: invoice + a partial payment
  const billing = await imp('billingStore.ts')
  const invoice = billing.createInvoice({ customerId: customer.id, customerName: 'Sync Tester', jobId: job.id, jobName: 'Sync job', invoiceNumber: 'INV-T-1', title: 'Deposit', status: 'sent', lineItems: [{ id: 'li1', description: '50% deposit', quantity: 1, unitPriceCents: 104297, totalCents: 104297, sortOrder: 0 }], subtotalCents: 104297, taxRate: 0, taxCents: 0, discountCents: 0, totalCents: 104297, amountPaidCents: 0, dueDate: '2026-10-20', issuedDate: '2026-10-07', notes: '' })
  billing.recordPayment({ invoiceId: invoice.id, invoiceNumber: 'INV-T-1', customerId: customer.id, customerName: 'Sync Tester', amountCents: 50000, paymentMethod: 'check', referenceNumber: '1001', paymentDate: '2026-10-07', recordedBy: 'tester', notes: '' })
  await new Promise(r => setTimeout(r, 3500))
  return { customerId: customer.id, quoteId: q.id, jobId: job.id, vendorId: v.id, firstChecklistId: items2[0]?.id, invoiceId: invoice.id }
})
console.log('A wrote. failed requests:', a.log.failed.length ? a.log.failed : 'none')
check('A: no failed requests while saving', a.log.failed.length === 0, a.log.failed.join(', '))

// ── B: a brand new browser ────────────────────────────────────────────────
const b = await newSession(browser, 'B')
await login(b); await ready(b)
const seen = await b.page.evaluate(async (made) => {
  const imp = name => { const hit = performance.getEntriesByType('resource').map(e => e.name).filter(n => n.includes('/src/' + name)).pop(); return import(hit ? hit.replace(location.origin, '') : '/src/' + name) }
  const inv = await imp('inventoryStore.ts')
  const cfg = await imp('configStore.ts')
  const vend = await imp('vendorStore.ts')
  const pipe = await imp('pipelineStore.ts')
  const sched = await imp('scheduleStore.ts')
  const cust = await imp('customerStore.ts')
  const quotes = await imp('quoteStore.ts')
  const jobs = await imp('jobStore.ts')
  const cloud = await imp('cloudStorage.ts')
  const checklist = await imp('checklistStore.ts')
  const calc = await imp('materialCalculator.ts')
  const q = quotes.getQuoteById(made.quoteId)
  const job = jobs.getJob(made.jobId)
  const pull = calc.calculateMaterials({ fenceStyle: "WV-ND 6'x6' Privacy", runs: [60], corners: 0, ends: 2, walkGates: 0, dblGates: 0, tearOutSections: 0, tearOutGates: 0 })
  return {
    picketCost: inv.getInventoryUnitCost('*Vinyl, White, Picket, 62-1/4"'),
    picketOnNewPullSheet: pull.find(i => i.item === '*Vinyl, White, Picket, 62-1/4"')?.unitCost,
    pricing: cfg.getConfig().pricing,
    company: cfg.getConfig().company.name,
    vendor: vend.getVendorById(made.vendorId)?.name,
    customer: cust.getCustomerById(made.customerId)?.lastName,
    quote: q ? { status: q.status, notes: q.notes, customerId: q.customerId, pricing: q.pricing, price: q.finalPrice } : null,
    job: job ? { quoteId: job.quoteId, customerId: job.customerId, crew: job.crewAssigned, notes: job.notes } : null,
    checklist: checklist.getChecklistForJob(made.jobId).map(i => ({ id: i.id, done: i.completed ?? i.done ?? i.isComplete })),
    lead: pipe.getPipeline().leads.find(l => l.id === 'lead-sync-1'),
    scheduleJobs: sched.loadSchedule().jobs.map(j => `${j.id}:${j.clientName}:${j.notes}`),
    jobCosting: JSON.parse(cloud.cloudStorage.getItem('fencepro_jobcosting') || '[]'),
    changeOrders: JSON.parse(cloud.cloudStorage.getItem('fencepro_changeorders') || '[]'),
    sitePlans: JSON.parse(cloud.cloudStorage.getItem('fencepro_siteplans') || '[]'),
    invoices: (await imp('billingStore.ts')).getInvoicesForCustomer(made.customerId).map(i => ({ id: i.id, total: i.totalCents, paid: i.amountPaidCents, balance: i.balanceDueCents, status: i.status })),
    payments: (await imp('billingStore.ts')).getPaymentsForCustomer(made.customerId).map(p => p.amountCents),
  }
}, made)

check('inventory cost edit reached B', seen.picketCost === 3.33, String(seen.picketCost))
check('a new pull sheet in B uses the edited Inventory cost', seen.picketOnNewPullSheet === 3.33, String(seen.picketOnNewPullSheet))
check('pricing settings reached B', seen.pricing.manHourRate === 25 && seen.pricing.laborMode === 'subcontractor' && seen.pricing.subRateByCategory?.Vinyl === 7.25, JSON.stringify({ r: seen.pricing.manHourRate, m: seen.pricing.laborMode, v: seen.pricing.subRateByCategory }))
check('company settings reached B', seen.company === 'GD Fence Pro')
check('vendor reached B', seen.vendor === 'Sync Test Supply')
check('new customer reached B', seen.customer === 'Tester')
check('quote for the brand new customer was saved', !!seen.quote && seen.quote.status === 'SOLD')
check('quote is linked to its customer', seen.quote?.customerId === made.customerId)
check('quote kept its pricing choices', seen.quote?.pricing?.laborMode === 'subcontractor' && seen.quote?.pricing?.subRate === 7.25)
check('last of three rapid quote edits won', seen.quote?.notes === 'final note', seen.quote?.notes)
check('job reached B, linked to quote and customer', seen.job?.quoteId === made.quoteId && seen.job?.customerId === made.customerId)
check('job edit made right after create reached B', seen.job?.crew === 'Crew 1' && seen.job?.notes === 'gate code 1234')
check('job checklist survives under the same job id', seen.checklist.length > 0 && seen.checklist.some(i => i.id === made.firstChecklistId), `${seen.checklist.length} items`)
check('pipeline lead reached B', seen.lead?.customerId === made.customerId)
check('schedule: no duplicates after 4 saves, removed job is gone', seen.scheduleJobs.length === 1 && seen.scheduleJobs[0] === 'sch-2:Sched Two:moved again', JSON.stringify(seen.scheduleJobs))
check('job costing reached B', seen.jobCosting.length === 1 && seen.jobCosting[0].id === 'jc1')
check('change orders reached B', seen.changeOrders.length === 1 && seen.changeOrders[0].amount === 350)
check('site plans reached B', seen.sitePlans.length === 1)
check('invoice and partial payment reached B', seen.invoices.length === 1 && seen.invoices[0].total === 104297 && seen.invoices[0].paid === 50000 && seen.invoices[0].balance === 54297 && seen.payments[0] === 50000, JSON.stringify(seen.invoices))
check('B: no failed requests', b.log.failed.length === 0, b.log.failed.join(', '))

// ── B logging in must not have wiped anything: A reloads and re-checks ──────
await a.page.reload(); await ready(a)
const again = await a.page.evaluate(async (made) => {
  const imp = name => { const hit = performance.getEntriesByType('resource').map(e => e.name).filter(n => n.includes('/src/' + name)).pop(); return import(hit ? hit.replace(location.origin, '') : '/src/' + name) }
  const cfg = await imp('configStore.ts'); const inv = await imp('inventoryStore.ts'); const quotes = await imp('quoteStore.ts'); const vend = await imp('vendorStore.ts')
  return { rate: cfg.getConfig().pricing.manHourRate, cost: inv.getInventoryUnitCost('*Vinyl, White, Picket, 62-1/4"'), quote: !!quotes.getQuoteById(made.quoteId), vendors: vend.getVendors().length, items: inv.getInventory().length }
}, made)
check('a new browser logging in wiped nothing', again.rate === 25 && again.cost === 3.33 && again.quote && again.vendors === 1 && again.items > 200, JSON.stringify(again))

// ── expired login token: the save must still land ──────────────────────────
const before = a.log.api.length
await a.page.evaluate(async () => {
  const imp = name => { const hit = performance.getEntriesByType('resource').map(e => e.name).filter(n => n.includes('/src/' + name)).pop(); return import(hit ? hit.replace(location.origin, '') : '/src/' + name) }
  const auth = await imp('crmAuth.ts'); const cfg = await imp('configStore.ts')
  auth.setTokens('expired.invalid.token', localStorage.getItem('crm_refresh_token'))
  const c = cfg.getConfig(); cfg.saveConfig({ ...c, pricing: { ...c.pricing, manHourRate: 27 } })
  await new Promise(r => setTimeout(r, 2500))
})
const calls = a.log.api.slice(before)
check('expired token: 401, one refresh, save retried and stored', calls.some(c => c.includes('business-state 401')) && calls.filter(c => c.includes('/crm-auth/refresh 200')).length === 1 && calls.some(c => c.includes('PATCH /api/business-state 200')), calls.join(' ; '))
const b2 = await newSession(browser, 'B2'); await login(b2); await ready(b2)
const rate = await b2.page.evaluate(async () => {
  const imp = name => { const hit = performance.getEntriesByType('resource').map(e => e.name).filter(n => n.includes('/src/' + name)).pop(); return import(hit ? hit.replace(location.origin, '') : '/src/' + name) }
  return (await imp('configStore.ts')).getConfig().pricing.manHourRate })
check('the change made with the expired token is on the server', rate === 27, String(rate))

// ── a module that fails to load must refuse to save and say so ─────────────
const c = await newSession(browser, 'C')
await c.ctx.route('**/api/inventory-state', route => route.request().method() === 'GET' ? route.abort() : route.continue())
await login(c); await ready(c)
const banner = await c.page.locator('text=Could not load').first().innerText().catch(() => '')
const before2 = c.log.api.length
await c.page.evaluate(async () => {
  const imp = name => { const hit = performance.getEntriesByType('resource').map(e => e.name).filter(n => n.includes('/src/' + name)).pop(); return import(hit ? hit.replace(location.origin, '') : '/src/' + name) }
  const inv = await imp('inventoryStore.ts'); inv.saveInventory([{ id: 'x', name: 'Only Item', unitCost: 1, category: 'Misc' }]); await new Promise(r => setTimeout(r, 1500)) })
const puts = c.log.api.slice(before2).filter(x => x.startsWith('PUT /api/inventory-state'))
check('load failure shows a banner', /Inventory/.test(banner), banner.slice(0, 90))
check('an unloaded module refuses to save (no PUT sent)', puts.length === 0, puts.join(','))
const b3 = await newSession(browser, 'B3'); await login(b3); await ready(b3)
const items = await b3.page.evaluate(async () => {
  const imp = name => { const hit = performance.getEntriesByType('resource').map(e => e.name).filter(n => n.includes('/src/' + name)).pop(); return import(hit ? hit.replace(location.origin, '') : '/src/' + name) }
  return (await imp('inventoryStore.ts')).getInventory().length })
check('server inventory intact after the refused save', items > 200, String(items))

const code = finish()
await browser.close()
process.exit(code)
