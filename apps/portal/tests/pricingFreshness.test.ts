/**
 * Broken list #58: an app already open keeps the prices it loaded. The phone's
 * change check (web pricingFreshness.ts), the reprice before save, the outbox
 * keeping a quote the server sent back (409 PRICES_CHANGED), and the server's
 * fingerprints of the price data (lib/pricingStamp.ts).
 */

import { describe, test, expect, beforeEach } from 'vitest'
import {
  _resetPricingForTests, notePricingPart, registerPricingReload, heldPricingStamp, changedPricingParts, checkPricing,
  repriceOutcome, draftPriceLine, priceText, samePrice, isServerStamp, fenceOffLine, type ServerStamp,
} from '../../web/src/pricingFreshness'
import { _resetForTests, startOutbox, registerKind, enqueue, allOps, statusOf, retry, type Op, type OutboxStorage, type SendResult } from '../../web/src/outbox'
import { businessPart, inventoryPart, tierPart, joinStamp, canonical } from '../src/server/lib/pricingStamp'

const stamp = (business: string, inventory: string, tiers: string): ServerStamp => ({ stamp: `${business}.${inventory}.${tiers}`, business, inventory, tiers })

describe('the phone notices price changes (pricingFreshness.ts)', () => {
  beforeEach(() => _resetPricingForTests())

  test('the stamp is the three parts the stores hold; unknown until all three are read', () => {
    expect(heldPricingStamp()).toBeNull()
    notePricingPart('business', 'b1')
    notePricingPart('inventory', 'i1')
    expect(heldPricingStamp()).toBeNull()
    notePricingPart('tiers', 't1')
    expect(heldPricingStamp()).toBe('b1.i1.t1')
    // An answer without a part (an older server) leaves the part as it was.
    notePricingPart('business', undefined)
    expect(heldPricingStamp()).toBe('b1.i1.t1')
  })

  test('only the parts that differ are changed; one not read yet counts as changed', () => {
    expect(changedPricingParts({ business: 'b1', inventory: 'i1', tiers: 't1' }, stamp('b1', 'i1', 't1'))).toEqual([])
    expect(changedPricingParts({ business: 'b1', inventory: 'i1', tiers: 't1' }, stamp('b2', 'i1', 't1'))).toEqual(['business'])
    expect(changedPricingParts({ business: 'b1', inventory: null, tiers: 't1' }, stamp('b1', 'i1', 't2'))).toEqual(['inventory', 'tiers'])
  })

  test('the check reads again only what changed, and the stamp follows', async () => {
    notePricingPart('business', 'b1'); notePricingPart('inventory', 'i1'); notePricingPart('tiers', 't1')
    const reads: string[] = []
    registerPricingReload('business', async () => { reads.push('business'); notePricingPart('business', 'b2') })
    registerPricingReload('inventory', async () => { reads.push('inventory') })
    registerPricingReload('tiers', async () => { reads.push('tiers') })
    // The owner raised a price: Settings changed, Inventory and tiers did not.
    const r = await checkPricing(async () => stamp('b2', 'i1', 't1'))
    expect(r).toEqual({ checked: true, changed: ['business'] })
    expect(reads).toEqual(['business'])
    expect(heldPricingStamp()).toBe('b2.i1.t1')
    // Nothing changed since: nothing is read.
    const again = await checkPricing(async () => stamp('b2', 'i1', 't1'))
    expect(again.changed).toEqual([])
    expect(reads).toEqual(['business'])
  })

  test('no signal: nothing is compared or read, and the save goes on (the server checks it)', async () => {
    let read = 0
    registerPricingReload('business', async () => { read++ })
    expect(await checkPricing(async () => null)).toEqual({ checked: false, changed: [] })
    expect(await checkPricing(async () => { throw new Error('Failed to fetch') })).toEqual({ checked: false, changed: [] })
    expect(read).toBe(0)
  })

  test('two checks at once share one ask', async () => {
    let asked = 0
    const slow = async () => { asked++; await new Promise(r => setTimeout(r, 10)); return stamp('b', 'i', 't') }
    await Promise.all([checkPricing(slow), checkPricing(slow), checkPricing(slow)])
    expect(asked).toBe(1)
  })

  test('a stamp answer is checked before it is used', () => {
    expect(isServerStamp(stamp('a', 'b', 'c'))).toBe(true)
    expect(isServerStamp({ stamp: 'x' })).toBe(false)
    expect(isServerStamp(null)).toBe(false)
  })
})

describe('reprice before save', () => {
  test('the reviewer\'s case: $5,350 at the old prices, $5,662 now: shown and confirmed, never saved silently', () => {
    const r = repriceOutcome(5350, 5662, { name: '8 ft White Vinyl Privacy', available: true })
    expect(r).toEqual({ kind: 'confirm', line: 'Prices changed since you opened this quote. It is now $5,662 (was $5,350).' })
  })

  test('the same price after the new data: saved as it is', () => {
    expect(repriceOutcome(5350, 5350, { name: 'x', available: true })).toEqual({ kind: 'save' })
    expect(repriceOutcome(5350.004, 5350, { name: 'x', available: true }).kind).toBe('save')
  })

  test('every price removed (the fence is off for quoting): nothing is saved, pick another fence', () => {
    const r = repriceOutcome(5350, 0, { name: '8 ft White Vinyl Privacy', available: false })
    expect(r.kind).toBe('gone')
    expect((r as { line: string }).line).toBe('8 ft White Vinyl Privacy is off for quoting now (switched off in Settings, or its prices were removed). Pick another fence.')
  })

  test('a fence off for quoting: one sentence, with its reason, on the Price step and in the dialog', () => {
    expect(fenceOffLine('6 ft panels, no dig', 'switched off in Settings')).toBe('6 ft panels, no dig is off for quoting now (switched off in Settings). Pick another fence.')
    expect(repriceOutcome(5350, 0, { name: '6 ft panels, no dig', available: false, why: 'switched off in Settings' })).toEqual({ kind: 'gone', line: fenceOffLine('6 ft panels, no dig', 'switched off in Settings') })
  })

  test('a draft opened after a price change says so; unchanged, it says nothing', () => {
    expect(draftPriceLine(5350, 5662)).toBe('Prices changed since this quote was saved. It is now $5,662 (was $5,350).')
    expect(draftPriceLine(5350, 5350)).toBeNull()
    // Not priced yet (no style, no runs): nothing to say.
    expect(draftPriceLine(5350, 0)).toBeNull()
    // A quote whose first save was sent back (never on the server): since it was opened, not saved.
    expect(draftPriceLine(5350, 5662, 'opened')).toBe('Prices changed since you opened this quote. It is now $5,662 (was $5,350).')
  })

  test('prices read in plain dollars, cents only when there are any', () => {
    expect(priceText(5662)).toBe('$5,662')
    expect(priceText(1234.5)).toBe('$1,234.50')
    expect(samePrice(10.001, 10)).toBe(true)
    expect(samePrice(10.01, 10)).toBe(false)
  })
})

describe('the outbox keeps a quote the server sent back for new prices', () => {
  function phoneStorage(): OutboxStorage {
    const map = new Map<string, Op>()
    return { all: async () => [...map.values()].map(o => JSON.parse(JSON.stringify(o))), put: async o => { map.set(o.id, JSON.parse(JSON.stringify(o))) }, remove: async id => { map.delete(id) } }
  }
  const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 5)) }

  test('409 PRICES_CHANGED: kept as Couldn\'t save with the reason, not sent again; the next save replaces it and is still a create', async () => {
    _resetForTests()
    const got: Op[] = []
    let answer: (op: Op) => SendResult = () => ({ ok: false, status: 409, code: 'PRICES_CHANGED', error: 'Prices changed since this quote was priced. Open it to see the new price, then save it again.' })
    for (const k of ['quote.create', 'quote.update']) registerKind(k, { send: async op => { got.push(op); return answer(op) }, what: () => 'This quote' })
    await startOutbox('u1', { storage: phoneStorage() })
    await enqueue({ key: 'quote:q1', kind: 'quote.create', payload: { id: 'q1', finalPrice: 5350, pricingStamp: 'old' }, label: 'Christa test, new quote' })
    await settle()
    const s = statusOf(['quote:q1'])
    expect(s.status).toBe('failed')
    expect(s.error).toMatch(/Prices changed since this quote was priced/)
    expect(got.length).toBe(1)
    // Not sent again on its own.
    await settle()
    expect(got.length).toBe(1)
    // Opened and saved again at today's price: that copy takes its place, and goes as a create.
    answer = () => ({ ok: true })
    await enqueue({ key: 'quote:q1', kind: 'quote.update', payload: { id: 'q1', finalPrice: 5662, pricingStamp: 'new' }, label: 'Christa test, quote changes' })
    await settle()
    expect(got.length).toBe(2)
    expect(got[1].kind).toBe('quote.create')
    expect((got[1].payload as any).finalPrice).toBe(5662)
    expect(allOps().length).toBe(0)
  })
})

describe('a quote sent back for new prices is made again, never stuck', () => {
  function phoneStorage(): OutboxStorage {
    const map = new Map<string, Op>()
    return { all: async () => [...map.values()].map(o => JSON.parse(JSON.stringify(o))), put: async o => { map.set(o.id, JSON.parse(JSON.stringify(o))) }, remove: async id => { map.delete(id) } }
  }
  const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 5)) }

  test('the kind is told (to reprice and confirm); Try again asks it again instead of resending the old copy', async () => {
    _resetForTests()
    const sent: Op[] = [], redone: string[] = []
    const answer = (): SendResult => ({ ok: false, status: 409, code: 'PRICES_CHANGED', error: 'Prices changed since this quote was priced. Open it to see the new price, then save it again.' })
    registerKind('quote.create', { send: async op => { sent.push(op); return answer() }, redo: (op, code) => { redone.push(`${(op.payload as any).id}:${code}`) } })
    await startOutbox('u1', { storage: phoneStorage() })
    await enqueue({ key: 'quote:q9', kind: 'quote.create', payload: { id: 'q9', pricingStamp: 'old' }, label: 'Christa, new quote' })
    await settle()
    expect(redone).toEqual(['q9:PRICES_CHANGED'])
    expect(sent.length).toBe(1)
    await retry()
    await settle()
    // Not sent again with the old stamp: made again.
    expect(sent.length).toBe(1)
    expect(redone).toEqual(['q9:PRICES_CHANGED', 'q9:PRICES_CHANGED'])
    expect(statusOf(['quote:q9']).status).toBe('failed')
  })
})

describe('the server\'s fingerprints of the price data (lib/pricingStamp.ts)', () => {
  const cfg = { fenceStyles: [{ name: 'A', pricePerFoot: 30 }], pricing: { overheadPct: 20 }, company: { name: 'GD' }, voice: { onFor: [] } }

  test('Settings: a price changes it; company details, voice and the proposal words do not', () => {
    const a = businessPart(cfg)
    expect(businessPart({ ...cfg, fenceStyles: [{ name: 'A', pricePerFoot: 31 }] })).not.toBe(a)
    expect(businessPart({ ...cfg, pricing: { overheadPct: 21 } })).not.toBe(a)
    expect(businessPart({ ...cfg, company: { name: 'Other' }, voice: { onFor: ['u1'] }, proposal: { intro: 'Hi' } })).toBe(a)
    // Key order never matters.
    expect(businessPart({ voice: cfg.voice, company: cfg.company, pricing: cfg.pricing, fenceStyles: cfg.fenceStyles })).toBe(a)
  })

  test('the live Overhead % in use counts only while live overhead is on', () => {
    const off = businessPart(cfg, 36.9)
    expect(businessPart(cfg, 37)).toBe(off)
    const live = { ...cfg, pricing: { overheadPct: 20, liveOverhead: { on: true } } }
    expect(businessPart(live, 37)).not.toBe(businessPart(live, 36.9))
  })

  test('Inventory: a part\'s cost or a kit changes it; stock counts and the confirmed date do not', () => {
    const items = [{ id: '1', name: 'Post', unitCost: 13.5, qtyOnHand: 4, priceUpdatedAt: '2026-10-01' }]
    const a = inventoryPart(items, [])
    expect(inventoryPart([{ ...items[0], unitCost: 14 }], [])).not.toBe(a)
    expect(inventoryPart([{ ...items[0], qtyOnHand: 9, priceUpdatedAt: '2026-10-29' }], [])).toBe(a)
    expect(inventoryPart(items, [{ style: 'A', kits: {} }])).not.toBe(a)
  })

  test('Good Better Best: a tier change changes it; the order they come in does not', () => {
    const rows = [{ id: 'b', category: 'Vinyl', tiers: [{ key: 'good' }], popular: null, sortOrder: 1 }, { id: 'a', category: 'Chain', tiers: [], popular: 'good', sortOrder: 0 }]
    expect(tierPart([...rows].reverse())).toBe(tierPart(rows))
    expect(tierPart([{ ...rows[0], tiers: [{ key: 'better' }] }, rows[1]])).not.toBe(tierPart(rows))
  })

  test('the stamp joins the parts in order; canonical text ignores key order', () => {
    expect(joinStamp({ business: 'b', inventory: 'i', tiers: 't' })).toBe('b.i.t')
    expect(canonical({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe(canonical({ a: [2, { c: 2, d: 1 }], b: 1 }))
  })
})
