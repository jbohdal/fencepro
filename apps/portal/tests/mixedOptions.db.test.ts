/**
 * Proposal options of any fence style (Jonathan, Nov 2 2026): "proposal options can be ANY fence style, not just tiers of
 * the same one." One yard, each option priced with its own kit, labor and margin, its own warranty and pull sheet; signing
 * one makes the quote, job, Sales Order, deposit and contract that option; change orders follow it.
 *
 * Against the dev database (DEV_DB=1; refuses any other): its Settings, Inventory, kits and tier sets, and one throwaway
 * quote, signed and removed. Nothing is sent (tests run with the outbound gate shut).
 */

import 'dotenv/config'
import crypto from 'crypto'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')

describe.skipIf(!process.env.DEV_DB || !onDev)('proposal options of any style (dev database)', { timeout: 120_000 }, async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { dataFor, withServerCosts, requestFrom } = await import('../src/server/lib/quotePricing.js')
  const { pricingModule } = await import('../src/server/lib/estimates.js')
  const { resolveIntakeAccountId } = await import('../src/server/lib/intake.js')
  const { stampQuoteWarranties } = await import('../src/server/lib/warranties.js')
  const { acceptQuote, signedPricing, proposalPage, renderProposal } = await import('../src/server/routes/proposal.js')
  const { contractForQuote, acceptedOptionText } = await import('../src/server/lib/contractPdf.js')
  const { optionBlocks, priceOption } = await import('../../web/src/proposal')
  const { ownTierFold } = await import('../../web/src/proposalOptions')
  const { pinnedForMain, offeredCount } = await import('../../web/src/tiers')
  const { overOptionLimit, quoteChangedSince } = await import('../src/server/lib/quotePriceCheck.js')
  const { optionSeen } = await import('../src/server/lib/optionSeen.js')
  const { customerProposal } = await import('../src/server/lib/customerProposal.js')
  const { sectionsForRun } = await import('../../web/src/sectionCount')
  const { orderBasisFor } = await import('../src/server/lib/salesOrders.js')

  const ALUM = 'Alum - ND - Emily - 48', CHAIN = "CL - 4' Galv", VINYL = 'WV-Auto ND Privacy', WOOD = 'wood/stockade/6/pine/ds/8'
  const RUNS = [25, 33, 57, 14]
  let accountId = '', data: any, m: any, sets: any[] = []
  const setOf = (c: string) => sets.find(s => s.category === c)

  const request = (fenceStyle: string, tierSet: any, tierPrefs: any = { off: [], swap: {} }, extra: any = {}) => ({
    fenceStyle, runs: RUNS.map(ft => ({ ft, rail: 'auto' as const })), corners: 2, ends: 4, walkGates: 1, dblGates: 1, gateWidths: { walk: [4], dbl: [8] },
    tearOutSections: 0, tearOutGates: 0, extraLaborHrs: 0, hasSalesman: true, priceAdjust: 0, overrides: {}, jobType: 'new' as const, tierSet, tierPrefs, ...extra,
  })
  const job = (r: any) => m.quoteJobFor(data, r, null)
  const cardOf = (j: any, key: string) => j.proposalOptions.find((o: any) => o.tier?.key === key)
  /** The proposal as a save keeps it: the quote's own option at the quote's price, each option's warranty stamped. */
  async function proposalOf(j: any, r: any, recommended = 0) {
    const options = j.proposalOptions.map((o: any) => (o.fenceStyle === r.fenceStyle ? { ...o, finalPrice: j.totals.price } : { ...o }))
    return stampQuoteWarranties(accountId, { version: 1, options, recommended, wholeDollar: true, depositPct: 0, tierPrefs: r.tierPrefs, tierSet: r.tierSet, footageFt: RUNS.reduce((a, b) => a + b, 0), gatesText: '1 walk gate', included: [] }, null, false) as any
  }

  beforeAll(async () => {
    accountId = (await resolveIntakeAccountId())!
    m = await pricingModule()
    data = await dataFor(accountId)
    sets = (await prisma.proposalTierSet.findMany({ where: { accountId } })).map(r => ({ category: r.category, tiers: r.tiers as any[], popular: r.popular }))
  })

  test('nothing swapped: the automatic options carry nothing new, and own the same price as before', () => {
    const r = request(ALUM, setOf('Aluminum'))
    const j = job(r)
    for (const o of j.proposalOptions) expect(o.tier?.swapped).toBeUndefined()
    expect(j.proposalOptions.map((o: any) => o.tier?.label)).toEqual(['Dig set with concrete', 'No dig'])
    expect(cardOf(j, 'good').tier.blurb).toBe('Standard aluminum post set in concrete.')
    expect(j.proposalOptions.filter((o: any) => o.badge === 'Most popular').map((o: any) => o.tier.key)).toEqual(['better'])
    expect(r.tierPrefs).toEqual({ off: [], swap: {} })
  })

  test('aluminum with a chain link option: its own price, sections per run, parts, name, words and warranty', async () => {
    const r = request(ALUM, setOf('Aluminum'), { off: [], swap: { good: CHAIN } })
    const j = job(r)
    const o = cardOf(j, 'good')
    const alone = job(request(CHAIN, null))
    expect(o.fenceStyle).toBe(CHAIN)
    expect(o.finalPrice).toBe(alone.totals.price)
    expect(o.finalPrice).toBeLessThan(cardOf(j, 'better').finalPrice)
    // Rule 3: per run at this style's own section length, never on the total.
    expect(o.sections).toBe(RUNS.reduce((t, ft) => t + sectionsForRun(ft, 10), 0))
    expect(o.sections).toBe(3 + 4 + 6 + 2)
    expect(o.sections).not.toBe(Math.ceil(129 / 10))
    expect(cardOf(j, 'better').sections).toBe(RUNS.reduce((t, ft) => t + sectionsForRun(ft, 6), 0))
    expect(o.snapshot.pullSheet.map((l: any) => l.item)).toEqual(alone.calc.materials.items.map((l: any) => l.item))
    expect(o.snapshot.pullSheet.some((l: any) => /Emily/i.test(l.item))).toBe(false)
    // Its own name: "Dig set with concrete" is not this fence; the chain link set's own words are.
    expect(o.tier).toMatchObject({ key: 'good', label: 'Chain link', swapped: true, blurb: 'Thick Schedule 40 steel pipe, no concrete.' })
    const p = await proposalOf(j, r)
    const w = p.options.find((x: any) => x.fenceStyle === CHAIN).warranty
    expect(w.name).toBeTruthy()
    expect(optionBlocks(p)).toEqual([])
  })

  test('vinyl best price with a wood option: 3 cards, its own margin and warranty words, never folded', async () => {
    const r = request(VINYL, setOf('Vinyl'), { off: [], swap: { good: WOOD } })
    const j = job(r)
    const o = cardOf(j, 'good')
    expect(o.finalPrice).toBe(job(request(WOOD, null)).totals.price)
    expect(o.tier).toMatchObject({ label: 'Good', swapped: true, blurb: 'Pressure treated pine pickets.' })
    expect(j.ownTierKey).toBe('better')
    const p = await proposalOf(j, r)
    expect(p.options.length).toBe(4)       // the three cards and the quote's own, folded into Better
    const fold = ownTierFold(p.options, { fenceStyle: VINYL }, n => data.config.fenceStyles.find((s: any) => s.name === n), r.tierSet.tiers)
    expect(p.options[fold!.tier].tier.key).toBe('better')
    expect(p.options.find((x: any) => x.fenceStyle === WOOD).warranty.text).toMatch(/No warranty on the wood itself/)
    // Better and Best are the same 6 ft panels on this short yard, so the customer reads two cards, as without the swap.
    expect(offeredCount(j.tiers, VINYL, true)).toBe(m.shownOptions(p.options, fold).length)
  })

  test('a style swapped in is never folded into the quote\'s own option', () => {
    const own = { fenceStyle: VINYL, finalPrice: 8000 }
    const tier = { fenceStyle: "WV-ND 6'x8' Privacy", finalPrice: 8100, tier: { key: 'better' } }
    const styleOf = (n: string) => data.config.fenceStyles.find((s: any) => s.name === n)
    expect(ownTierFold([tier, own], { fenceStyle: VINYL }, styleOf)).not.toBeNull()
    expect(ownTierFold([{ ...tier, tier: { key: 'better', swapped: true } }, own], { fenceStyle: VINYL }, styleOf)).toBeNull()
  })

  test('labor and a per foot price typed for the quote\'s own material do not follow to another material', () => {
    const overrides = { laborCost: 50, subRate: 1, pricePerFoot: 3, priceMethod: 'per_foot' }
    const r = request(ALUM, setOf('Aluminum'), { off: [], swap: { good: CHAIN } }, { overrides })
    const typed = job(r)
    const o = cardOf(typed, 'good')
    expect(o.snapshot.laborCost).toBe(job(request(CHAIN, null)).totals.laborCost)
    expect(o.snapshot.otherMaterial).toBe(true)
    // The same material keeps the quote's choices, as today.
    expect(cardOf(typed, 'better').snapshot.laborCost).toBe(50)
  })

  test('a tee is posted as each option\'s style posts it', () => {
    const base = { ...job(request(CHAIN, null)).calcInput, corners: 2, ends: 4 }
    const vinylInput = { ...base, style: job(request(VINYL, null)).style, extraLinePosts: 1, tees: 1 }
    const chain = job(request(CHAIN, null)).style
    const o = priceOption(vinylInput, chain)
    expect(o.snapshot.posts).toEqual({ corners: 3, ends: 4, teeLinePosts: 0 })
    const plain = job(request(CHAIN, null, undefined, { corners: 3 }))
    expect(o.finalPrice).toBe(plain.totals.price)
  })

  test('add and remove options, Most popular one at most, no dangling pick', () => {
    const set = setOf('Chainlink')
    const added = [{ key: 'added1', style: ALUM }]
    let j = job(request(CHAIN, set, { off: [], swap: {}, added, popular: 'added1' }))
    expect(j.proposalOptions.map((o: any) => o.fenceStyle)).toEqual(["chain/4/galv/res/ds", CHAIN, ALUM])
    expect(j.proposalOptions.filter((o: any) => o.badge).map((o: any) => o.tier.key)).toEqual(['added1'])
    expect(cardOf(j, 'added1').tier).toMatchObject({ label: 'Aluminum', swapped: true })
    // Removed: nothing on the proposal is popular, the set's pick does not stand in for it (null: none).
    j = job(request(CHAIN, set, { off: [], swap: {}, popular: null }))
    expect(j.proposalOptions.filter((o: any) => o.badge)).toEqual([])
    // The popular option taken off: no badge on any option.
    j = job(request(CHAIN, set, { off: ['better'], swap: {}, popular: 'better' }))
    expect(j.proposalOptions.filter((o: any) => o.badge)).toEqual([])
    // Down to one option.
    j = job(request(CHAIN, set, { off: ['good', 'better'], swap: {} }))
    expect(j.proposalOptions.map((o: any) => o.fenceStyle)).toEqual([CHAIN])
    expect(j.proposalOptions[0].tier).toBeUndefined()
  })

  test('a style that is off for quoting is not priced, swapped or added; it says why', () => {
    const j = job(request(CHAIN, setOf('Chainlink'), { off: [], swap: { good: 'Nobody' }, added: [{ key: 'added1', style: 'Nobody' }] }))
    expect(j.proposalOptions.some((o: any) => o.fenceStyle === 'Nobody')).toBe(false)
    expect(j.tiers.find((t: any) => t.spec.key === 'added1').reason).toMatch(/Nobody/)
  })

  test('making another material main keeps every option where it is', () => {
    const r = request(ALUM, setOf('Aluminum'), { off: [], swap: { good: CHAIN } })
    const j = job(r)
    const prefs = pinnedForMain(r.tierPrefs, j.tiers, 'good', CHAIN, 'Aluminum', ALUM, 'better')
    expect(prefs.swap).toEqual({ good: CHAIN, better: ALUM })
    const after = job(request(CHAIN, setOf('Aluminum'), prefs))
    expect(after.proposalOptions.map((o: any) => o.fenceStyle).sort()).toEqual([ALUM, CHAIN].sort())
    expect(cardOf(after, 'better').finalPrice).toBe(cardOf(j, 'better').finalPrice)
    expect(after.totals.price).toBe(cardOf(j, 'good').finalPrice)
  })

  test('the server takes a Salesman\'s save at its own prices, never the phone\'s', async () => {
    const body = (p: any) => ({ priceRequest: request(ALUM, setOf('Aluminum'), { off: [], swap: { good: CHAIN } }), proposal: p })
    const j = job(request(ALUM, setOf('Aluminum'), { off: [], swap: { good: CHAIN } }))
    const options = j.proposalOptions.map((o: any) => ({ ...o, snapshot: undefined, finalPrice: 1 }))
    const stray = { ...options[0], fenceStyle: 'CL - 6\' Black', label: 'x', finalPrice: 1, tier: { key: 'fake', swapped: true } }
    const out = await withServerCosts(accountId, body({ version: 1, options: [...options, stray] }), null)
    expect(out.proposal.options.map((o: any) => o.finalPrice)).toEqual(j.proposalOptions.map((o: any) => (o.fenceStyle === ALUM ? j.totals.price : o.finalPrice)))
    expect(out.proposal.options.some((o: any) => o.tier?.key === 'fake')).toBe(false)
    expect(out.proposal.options[0].snapshot.pullSheet.length).toBeGreaterThan(0)
  })

  test('requestFrom keeps added options and the Most popular pick', () => {
    const { req } = requestFrom({ fenceStyle: ALUM, runs: [10], tees: 2, tierPrefs: { off: [], swap: {}, added: [{ key: 'added1', style: CHAIN }, { key: 3 }], popular: null } }, null, () => null)
    expect(req.tierPrefs).toEqual({ off: [], swap: {}, added: [{ key: 'added1', style: CHAIN }], popular: null })
    expect(req.tees).toBe(2)
  })

  test('a picked style with no warranty or with parts left out is not sent; an automatic or old option is', () => {
    const o = { label: 'Chain Link', tier: { key: 'good', swapped: true }, warranty: { name: 'x' } }
    expect(optionBlocks({ options: [o as any] })).toEqual([])
    expect(optionBlocks({ options: [{ ...o, warranty: undefined } as any] })[0]).toMatch(/no warranty/)
    expect(optionBlocks({ options: [{ ...o, problems: { block: ['No parts are priced for this style.'], warn: [] } } as any] })[0]).toMatch(/No parts/)
    expect(optionBlocks({ options: [{ label: 'Old', tier: { key: 'good' } } as any] })).toEqual([])
  })

  test('a gate width with no parts list of its own is said to staff, on a style picked for the quote', () => {
    const j = job(request(CHAIN, setOf('Chainlink'), { off: [], swap: { good: ALUM } }, { gateWidths: { walk: [5], dbl: [10] } }))
    expect(j.tierCards.good.gates.join(' ')).toMatch(/5 ft walk gate/)
    expect(j.tierCards.good.gates.join(' ')).toMatch(/10 ft double gate/)
  })

  test('signedPricing: an option of another style brings its margin; an old option changes nothing but the rounding', () => {
    const q = { pricing: { costFactor: 0.5, laborCost: 9, overheadPct: 30 }, proposal: { wholeDollar: true } }
    expect(signedPricing(q, { costFactor: 0.6, otherMaterial: true, roundingCents: 12 })).toEqual({ pricing: { costFactor: 0.6, overheadPct: 30, wholeDollar: true, roundingCents: 12 } })
    expect(signedPricing(q, { roundingCents: 12 })).toEqual({ pricing: { ...q.pricing, wholeDollar: true, roundingCents: 12 } })
    expect(signedPricing({ pricing: q.pricing }, {})).toEqual({})
  })

  test('the minimum job price lifts every option, on the server, and nothing above it moves', () => {
    const tiny = { runs: [{ ft: 6, rail: 'auto' as const }], corners: 0, ends: 2, walkGates: 0, dblGates: 0, gateWidths: { walk: [], dbl: [] } }
    const r = request(VINYL, setOf('Vinyl'), { off: [], swap: { good: WOOD } }, tiny)
    const j = job(r)
    expect(j.newMin).toBe(true)
    for (const o of j.proposalOptions) { expect(o.finalPrice).toBe(j.totals.price); expect(o.minimumLifted).toBe(true) }
    expect(j.tiers.every((t: any) => t.option.finalPrice === j.totals.price)).toBe(true)
    expect(j.proposalOptions[0].perFoot).toBeCloseTo(j.totals.price / 6, 1)
    const big = job(request(ALUM, setOf('Aluminum')))
    for (const o of big.proposalOptions) expect(o.minimumLifted).toBeUndefined()
  })

  test('Compare options and Add option cannot pass 3; the automatic options stay as they are', async () => {
    const options = [ALUM, CHAIN, VINYL, WOOD].map((fenceStyle, i) => ({ fenceStyle, label: fenceStyle, finalPrice: 1000 + i, snapshot: { pullSheet: [{ item: fenceStyle, qty: 1 }] } }))
    const over = await overOptionLimit({ fenceStyle: ALUM, proposal: { version: 1, options } }, null)
    expect(over).toMatchObject({ kind: 'refuse', code: 'TOO_MANY_OPTIONS' })
    const auto = options.map((o, i) => (o.fenceStyle === ALUM ? o : { ...o, tier: { key: `t${i}` } }))
    expect(await overOptionLimit({ fenceStyle: ALUM, proposal: { version: 1, options: auto } }, null)).toBeNull()
    expect(await overOptionLimit({ fenceStyle: ALUM, proposal: { version: 1, options: options.slice(0, 3) } }, null)).toBeNull()
    // A proposal that already has more keeps them, or comes down; adding one more is refused.
    const five = [...options, { ...options[1], fenceStyle: "CL - 6' Black", snapshot: { pullSheet: [{ item: 'b', qty: 1 }] } }]
    const was = { fenceStyle: ALUM, status: 'SENT', proposal: { version: 1, options } }
    expect(await overOptionLimit({ fenceStyle: ALUM, proposal: { version: 1, options } }, was)).toBeNull()
    expect(await overOptionLimit({ fenceStyle: ALUM, proposal: { version: 1, options: options.slice(0, 4) } }, { ...was, proposal: { version: 1, options: five } })).toBeNull()
    expect(await overOptionLimit({ fenceStyle: ALUM, proposal: { version: 1, options: five } }, was)).toMatchObject({ code: 'TOO_MANY_OPTIONS' })
  })

  test('odd gates: a warning on every option with no parts list, not only swapped ones, never a block', () => {
    const j = job(request(ALUM, setOf('Aluminum'), undefined, { gateWidths: { walk: [4], dbl: [12] } }))
    expect(j.tierCards.good.gates.join(' ')).toMatch(/12 ft double gate.*two 4 ft leaves/)
    expect(j.tierCards.good.block).toEqual([])
    const chain = job(request(CHAIN, setOf('Chainlink'), undefined, { gateWidths: { walk: [5], dbl: [12] } }))
    expect(chain.tierCards.better.gates).toEqual([])
  })

  test('each option says what the dollar adjustment did; the signed record says what the option took', () => {
    const r = request(ALUM, setOf('Aluminum'), { off: [], swap: { good: CHAIN } }, { overrides: { priceAdjustmentCents: -500000 } })
    const o = cardOf(job(r), 'good')
    expect(o.adjustmentRefused).toBe(true)
    expect(o.adjustmentCents).toBeUndefined()
    expect(o.snapshot.gmPct).toBeGreaterThan(0.2)
    const out = signedPricing({ fenceStyle: ALUM, pricing: { priceAdjustmentCents: -500000, showDiscountOnProposal: true } }, {}, o)
    expect(out.pricing.priceAdjustmentCents).toBeUndefined()
    expect(out.pricing.showDiscountOnProposal).toBeUndefined()
  })

  test('no Most popular: no Recommended label; a proposal saved before keeps its label', async () => {
    const r = request(CHAIN, setOf('Chainlink'), { off: [], swap: {}, popular: null })
    const j = job(r)
    const p = await proposalOf(j, r)
    const q: any = { accountId, acceptedAt: null, fenceStyle: CHAIN, finalPrice: j.totals.price, status: 'SENT', customerName: 'x', proposal: p }
    const html = (x: any) => renderProposal(q, x, 't', 'n', [], null, '', { start: 0 })
    expect(html({ ...p, noRecommendedLabel: true })).not.toContain('>Recommended<')
    expect(html(p)).toContain('>Recommended<')
    expect(html({ ...p, options: [{ ...p.options[0], sections: 1, perFoot: 5 }, p.options[1]] })).toContain('1 section<')
  })

  test('the option check and the save stamp read an option the same way', () => {
    const o = { fenceStyle: CHAIN, finalPrice: 7483.1, tier: { key: 'good' } }
    expect(m.proposalStamp({ options: [o] })).toBe(`${optionSeen(o)}|good`)
  })

  test('two browsers: a save built on older options is refused; the same save twice passes', async () => {
    const was = { options: [{ fenceStyle: ALUM, finalPrice: 100 }] }
    const now = { options: [{ fenceStyle: ALUM, finalPrice: 100 }, { fenceStyle: WOOD, finalPrice: 90, tier: { key: 'added1' } }] }
    const base = m.proposalStamp(was)
    expect(await quoteChangedSince({ proposalBase: base }, { proposal: was }, { proposal: now })).toMatchObject({ code: 'QUOTE_CHANGED' })
    expect(await quoteChangedSince({ proposalBase: base }, { proposal: now }, { proposal: now })).toBeNull()
    expect(await quoteChangedSince({ proposalBase: m.proposalStamp(now) }, { proposal: was }, { proposal: now })).toBeNull()
    expect(await quoteChangedSince({}, { proposal: was }, { proposal: now })).toBeNull()
  })

  test('public JSON carries no staff field, by a list of what stays', () => {
    const o = { label: 'x', fenceStyle: CHAIN, finalPrice: 1, perFoot: 1, sections: 1, badge: 'Most popular', warranty: { name: 'w' }, tier: { key: 'k', label: 'l', blurb: 'b', swapped: true }, minimumLifted: true, adjustmentRefused: true, problems: { block: [], warn: ['x'] }, snapshot: { totalCOGS: 1 }, somethingNew: 1 }
    const p: any = customerProposal({ version: 1, options: [o], tierPrefs: { off: [] }, tierSet: { tiers: [] }, warranty: 'w' })
    const text = JSON.stringify(p)
    for (const word of ['minimumLifted', 'adjustmentRefused', 'problems', 'snapshot', 'swapped', 'somethingNew', 'tierPrefs', 'tierSet']) expect(text).not.toContain(word)
    expect(p.options[0]).toMatchObject({ label: 'x', finalPrice: 1, badge: 'Most popular', tier: { key: 'k', label: 'l', blurb: 'b' }, warranty: { name: 'w' } })
    expect(p.warranty).toBe('w')
  })

  test('a style turned off says so; the option goes back to automatic', () => {
    const j = job(request(ALUM, setOf('Aluminum'), { off: [], swap: { good: 'Nobody' } }))
    const t = j.tiers.find((x: any) => x.spec.key === 'good')
    expect(t.swapOff).toBe('Nobody')
    expect(t.style.name).toBe('Alum - DS - Emily - 48')
    expect(m.quoteView(j).tiers.find((x: any) => x.spec.key === 'good').swapOff).toBe('Nobody')
  })

  describe('signed for the option that is not the quote\'s own', () => {
    const tag = `mix-${crypto.randomUUID().slice(0, 8)}`
    let id = '', token = '', quote: any, chain: any
    beforeAll(async () => {
      const r = request(ALUM, setOf('Aluminum'), { off: [], swap: { good: CHAIN } })
      const j = job(r)
      const p = await proposalOf(j, r, 1)
      p.depositPct = 25
      chain = p.options.find((o: any) => o.fenceStyle === CHAIN)
      token = `${tag}-token`
      quote = await prisma.savedQuote.create({ data: {
        accountId, customerName: `Mixed ${tag}`, customerPhone: '', customerEmail: '', customerAddress: '1 Test Way', date: '2026-11-02', status: 'SENT',
        fenceStyle: ALUM, runs: RUNS, runRails: ['6ft', '6ft', '6ft', '6ft'], sections: j.calc.sections, corners: 2, ends: 4, walkGates: 1, dblGates: 1, tearOutSections: 0, tearOutGates: 0,
        adjLaborHrs: 0, hasSalesman: true, priceAdjust: 0, materialCost: j.totals.materialCost, laborCost: j.totals.laborCost, tearOutCost: 0, totalCOGS: j.totals.totalCOGS, finalPrice: j.totals.price, gmPct: j.totals.gmPct,
        pullSheet: j.pullSheet, pricing: { ...j.pricing, laborCost: 77 }, layout: { yard: null, runSections: j.calc.perRunSections }, proposal: p, shareToken: token, notes: '', leadSource: '', salesRep: '',
      } as any })
      id = quote.id
    })
    afterAll(async () => {
      if (!id) return
      const jobs = await prisma.savedJob.findMany({ where: { quoteId: id }, select: { id: true } })
      const ids = jobs.map(x => x.id)
      for (const t of ['paymentSchedule', 'jobQuotedCost', 'signedDocument']) await (prisma as any)[t].deleteMany({ where: { quoteId: id } }).catch((e: Error) => console.error(t, e.message))
      await prisma.savedJob.deleteMany({ where: { id: { in: ids } } }).catch(() => {})
      await prisma.savedQuote.delete({ where: { id } }).catch(() => {})
    })

    test('the customer page shows each option and picks nothing but what was saved', async () => {
      const q = await prisma.savedQuote.findUnique({ where: { id } })
      const { p, view } = await proposalPage(q as any, q!.proposal as any)
      const html = renderProposal(q, p, token, 'n', [], null, '', view)
      expect(html).toContain('Chain link')
      expect(html).toContain('Thick Schedule 40 steel pipe')
      expect(html).toContain(`$${chain.finalPrice.toLocaleString('en-US')}`)
      expect(html).not.toContain('Standard aluminum post set in concrete')
    })

    test('a page read before the options changed signs nothing, and the page goes to the current options', async () => {
      const q = (await prisma.savedQuote.findUnique({ where: { id } })) as any
      const at = q.proposal.options.findIndex((o: any) => o.fenceStyle === CHAIN)
      const seen = optionSeen(q.proposal.options[at])
      // A place that now holds another fence, or the same fence at another price.
      const swapped = { ...q.proposal, options: [...q.proposal.options].reverse() }
      await prisma.savedQuote.update({ where: { id }, data: { proposal: swapped } })
      const now = await prisma.savedQuote.findUnique({ where: { id } })
      const out = await acceptQuote(now, { option: at, seen, name: 'Too Late' } as any)
      expect(out.status).toBe(409)
      expect(out.json).toMatchObject({ changed: true, reload: true })
      // An option with no fence or no price signs nothing.
      const blank = { ...q.proposal, options: q.proposal.options.map((o: any, i: number) => (i === at ? { ...o, fenceStyle: '' } : o)) }
      await prisma.savedQuote.update({ where: { id }, data: { proposal: blank } })
      const b = await prisma.savedQuote.findUnique({ where: { id } })
      expect((await acceptQuote(b, { option: at, seen: optionSeen((b as any).proposal.options[at]), name: 'Blank' } as any)).status).toBe(409)
      expect((await prisma.savedQuote.findUnique({ where: { id } }))!.acceptedAt).toBeNull()
      await prisma.savedQuote.update({ where: { id }, data: { proposal: swapped } })
      // An old page that names nothing signs nothing either.
      expect((await acceptQuote(now, { option: at, name: 'Old Page' } as any)).status).toBe(409)
      // A save landing between the read and the signing: the check under the lock reads the row, not the page's copy.
      const out2 = await acceptQuote(q, { option: at, seen, name: 'Too Late' } as any)
      expect(out2.status).toBe(409)
      const after = await prisma.savedQuote.findUnique({ where: { id } })
      expect(after!.acceptedAt).toBeNull()
      expect(after!.fenceStyle).toBe(ALUM)
      await prisma.savedQuote.update({ where: { id }, data: { proposal: q.proposal } })
    })

    test('quote, costs, pull sheet, job, deposit, Sales Order, warranty and contract are the signed option', async () => {
      const q = await prisma.savedQuote.findUnique({ where: { id } })
      const at = (q!.proposal as any).options.findIndex((o: any) => o.fenceStyle === CHAIN)
      // A forged price or style in the body is not read: only the option's place.
      const out = await acceptQuote(q, { option: at, seen: optionSeen((q!.proposal as any).options[at]), name: 'Test Customer', finalPrice: 1, fenceStyle: ALUM } as any)
      expect(out.status).toBe(200)
      const s = (await prisma.savedQuote.findUnique({ where: { id } })) as any
      expect(s.fenceStyle).toBe(CHAIN)
      expect(s.finalPrice).toBe(chain.finalPrice)
      expect(s.sections).toBe(chain.sections)
      expect(s.materialCost).toBe(chain.snapshot.materialCost)
      expect(s.pullSheet).toEqual(chain.snapshot.pullSheet)
      expect(s.runRails).toBeNull()
      expect(s.layout.runSections).toEqual(chain.snapshot.runSections)
      expect(s.pricing.costFactor).toBe(chain.snapshot.costFactor)
      expect(s.pricing.laborCost).toBeUndefined()
      const j = await prisma.savedJob.findFirst({ where: { quoteId: id } })
      expect(j).toMatchObject({ fenceStyle: CHAIN, sections: chain.sections })
      expect(j!.contractValue).toBe(chain.finalPrice)
      expect(await contractForQuote(s)).toBeTruthy()
      expect(acceptedOptionText(s)).toMatch(/Chain Link/i)
      const qc = await prisma.jobQuotedCost.findUnique({ where: { accountId_quoteId: { accountId, quoteId: id } } })
      expect(qc).toMatchObject({ fenceStyle: CHAIN, priceCents: Math.round(chain.finalPrice * 100) })
      const so = await orderBasisFor(accountId, id)
      expect(so!.styleName).toMatch(/Chain Link/i)
      expect(JSON.stringify(so!.need)).not.toMatch(/Emily/)
      const plan = await prisma.paymentSchedule.findFirst({ where: { quoteId: id } })
      expect(plan?.signedCents).toBe(Math.round(chain.finalPrice * 100))
      expect(plan?.depositPct).toBe(25)
    })

    test('a change order prices at the signed style and its margin', async () => {
      const s = (await prisma.savedQuote.findUnique({ where: { id } })) as any
      const more = request(s.fenceStyle, null, undefined, {
        runs: [...RUNS.slice(0, 3), RUNS[3] + 20].map(ft => ({ ft, rail: 'auto' as const })),
        overrides: { costFactor: s.pricing.costFactor },
        changeBase: { feet: 129, ends: 4, walkGates: 1, dblGates: 1, runs: RUNS.map(ft => ({ ft, rail: 'auto' })), drawn: null },
      })
      const co = job(more)
      expect(co.style.name).toBe(CHAIN)
      // The same as a plain chain link quote's next version: its margin, its parts.
      const plain = job(request(CHAIN, null, undefined, { runs: more.runs, changeBase: more.changeBase }))
      expect(co.changePrice).toBeGreaterThan(0)
      expect(co.changePrice).toBe(plain.changePrice)
      expect(co.calc.materials.items.some((l: any) => /Emily/.test(l.item))).toBe(false)
    })
  })
})
