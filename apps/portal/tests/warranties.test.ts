/**
 * Warranties per option (web/src/warranties.ts): which warranty each style
 * gets, the words frozen on a proposal when it is saved and kept once it is
 * sent or signed, the warranty's dates, service call coverage, and the
 * contract PDF carrying the accepted option's words.
 */

import { describe, test, expect } from 'vitest'
import {
  defaultWarrantySettings, warrantySettingsOf, installKeyOf, warrantyForStyle, stampWarranties, signedOptionWarranty, warrantyFromText,
  warrantyPeriod, serviceCoverage, endDateOf, isOneYearText, isNoDigStyle, newWarrantyId,
  LIFETIME_ID, ONE_YEAR_ID, LIFETIME_TEXT, ONE_YEAR_TEXT, WOOD_EXTRA,
} from '../../web/src/warranties'
import { contractPdf, warrantyLines } from '../src/server/lib/contractPdf'
import { pdfText } from './pdfText'

const S = defaultWarrantySettings()
const style = (name: string, material?: string, choices?: Record<string, string>) => ({ name, ...(material ? { material, choices } : {}) })

describe('which warranty each install gets', () => {
  test('starting settings: Lifetime for vinyl no dig, 1 Year for everything else', () => {
    expect(S.list.map(w => [w.id, w.name, w.term])).toEqual([[LIFETIME_ID, 'Lifetime Craftsmanship Warranty', 'lifetime'], [ONE_YEAR_ID, '1 Year Workmanship Warranty', 'years']])
    expect(S.byInstall['vinyl:nd']).toBe(LIFETIME_ID)
    for (const k of ['vinyl:ds', 'alum:nd', 'alum:ds', 'chain:nd', 'chain:ds', 'wood:nd', 'wood:ds', 'other', 'work']) expect(S.byInstall[k]).toBe(ONE_YEAR_ID)
    expect(S.extras.wood).toBe(WOOD_EXTRA)
    expect(LIFETIME_TEXT.startsWith('For as long as you own your home, Getter Done Fence will repair or replace')).toBe(true)
    expect(ONE_YEAR_TEXT).toContain('Workmanship is warranted for 1 year from installation date')
  })

  test('install key from the style: old codes, saved choices, auto mix, wood, Durafence', () => {
    expect(installKeyOf(style("WV-ND 6'x8' Privacy"))).toBe('vinyl:nd')
    expect(installKeyOf(style("TV-DS 6'x6' Privacy"))).toBe('vinyl:ds')
    expect(installKeyOf(style('WV-Auto ND Privacy'))).toBe('vinyl:nd')
    expect(installKeyOf(style('TV-Auto DS Privacy'))).toBe('vinyl:ds')
    expect(installKeyOf(style("WV-ND Bell 4'x6'"))).toBe('vinyl:nd')
    expect(installKeyOf(style("CL - 5' Black"))).toBe('chain:nd')
    expect(installKeyOf(style('chain/4/galv/res/ds', 'chain', { height: '4', finish: 'galv', grade: 'res', install: 'ds' }))).toBe('chain:ds')
    expect(installKeyOf(style('Alum - ND - Emily - 48'))).toBe('alum:nd')
    expect(installKeyOf(style('Alum - DS - Ind Abigail'))).toBe('alum:ds')
    expect(installKeyOf(style('wood/privacy/6/nd/8', 'wood', { style: 'privacy', height: '6', install: 'nd', width: '8' }))).toBe('wood:nd')
    expect(installKeyOf(style('Durafence'))).toBe('other')
    expect(installKeyOf(style('Something new'))).toBe('other')
    expect(isNoDigStyle(style("TV-ND 6'x8' Privacy"))).toBe(true)
    expect(isNoDigStyle(style("CL - 4' Galv"))).toBe(true)
    expect(isNoDigStyle(style("WV-DS 8'x8' Privacy"))).toBe(false)
  })

  test('the option warranty: name, full words, wood gets its extra line, a move or repair its own row', () => {
    const nd = warrantyForStyle(S, style("WV-ND 6'x8' Privacy"))!
    expect(nd).toEqual({ id: LIFETIME_ID, name: 'Lifetime Craftsmanship Warranty', text: LIFETIME_TEXT, term: 'lifetime' })
    const ds = warrantyForStyle(S, style("WV-DS 6'x8' Privacy"))!
    expect(ds).toEqual({ id: ONE_YEAR_ID, name: '1 Year Workmanship Warranty', text: ONE_YEAR_TEXT, term: 'years', years: 1 })
    const wood = warrantyForStyle(S, style('wood/privacy/6/nd/8', 'wood', { install: 'nd' }))!
    expect(wood.text).toBe(`${ONE_YEAR_TEXT}\n${WOOD_EXTRA}`)
    expect(warrantyForStyle(S, style("WV-ND 6'x8' Privacy"), 'repair')!.id).toBe(ONE_YEAR_ID)
  })

  test('saved settings are read, edited mappings win, missing settings are the starting ones', () => {
    expect(warrantySettingsOf({})).toEqual(S)
    const edited = { warranties: { ...S, byInstall: { ...S.byInstall, 'alum:nd': LIFETIME_ID } } }
    expect(warrantyForStyle(warrantySettingsOf(edited), style('Alum - ND - Emily - 48'))!.name).toBe('Lifetime Craftsmanship Warranty')
    expect(newWarrantyId('Lifetime Craftsmanship', ['w-lifetime-craftsmanship'])).toBe('w-lifetime-craftsmanship-2')
  })
})

describe('frozen on the proposal', () => {
  const styles = [style("WV-DS 6'x8' Privacy"), style("WV-ND 6'x8' Privacy"), style("TV-ND 6'x8' Privacy")]
  const styleOf = (n: string) => styles.find(s => s.name === n)
  const gbb = () => ({
    version: 1, recommended: 1, warranty: 'Contract Templates words',
    options: [
      { label: 'Good', fenceStyle: "WV-DS 6'x8' Privacy", finalPrice: 9000, tier: { key: 'good' } },
      { label: 'Better', fenceStyle: "WV-ND 6'x8' Privacy", finalPrice: 10000, tier: { key: 'better' } },
      { label: 'Best', fenceStyle: "TV-ND 6'x8' Privacy", finalPrice: 11000, tier: { key: 'best' } },
    ],
  })

  test('a new proposal: each option its own warranty, the Warranty words the recommended option\'s', () => {
    const p = stampWarranties(gbb(), S, styleOf, null, false)
    expect(p.options.map((o: any) => o.warranty.name)).toEqual(['1 Year Workmanship Warranty', 'Lifetime Craftsmanship Warranty', 'Lifetime Craftsmanship Warranty'])
    expect(p.warranty).toBe(LIFETIME_TEXT)
  })

  test('sent: a Settings edit does not change the words; a new option gets today\'s', () => {
    const sent = stampWarranties(gbb(), S, styleOf, null, false)
    const edited = warrantySettingsOf({ warranties: { ...S, list: S.list.map(w => (w.id === LIFETIME_ID ? { ...w, name: 'Edited name', text: 'Edited words' } : w)) } })
    const again = stampWarranties(JSON.parse(JSON.stringify({ ...gbb(), options: [...gbb().options, { label: 'Tan', fenceStyle: "TV-ND 6'x8' Privacy", finalPrice: 12000 }] })), edited, styleOf, sent, true)
    expect(again.options.slice(0, 3).map((o: any) => o.warranty)).toEqual(sent.options.map((o: any) => o.warranty))
    expect(again.options[3].warranty.text).toBe('Edited words')
    expect(again.warranty).toBe(LIFETIME_TEXT)
    // Not sent yet: today's words.
    expect(stampWarranties(gbb(), edited, styleOf, sent, false).options[1].warranty.text).toBe('Edited words')
  })

  test('sent before warranties were per option: it keeps its one block of words and no badges', () => {
    const old = { ...gbb(), warranty: ONE_YEAR_TEXT }
    const again = stampWarranties({ ...gbb(), warranty: 'anything new' }, S, styleOf, old, true)
    expect(again.options.every((o: any) => o.warranty === undefined)).toBe(true)
    expect(again.warranty).toBe(ONE_YEAR_TEXT)
  })

  test('the signed option: the accepted one, else the quote\'s own style, else the old block of words', () => {
    const p = stampWarranties(gbb(), S, styleOf, null, false)
    expect(signedOptionWarranty({ proposal: p, chosenOption: 1 })!.warranty.name).toBe('Lifetime Craftsmanship Warranty')
    expect(signedOptionWarranty({ proposal: p, chosenOption: 0 })!.warranty.name).toBe('1 Year Workmanship Warranty')
    expect(signedOptionWarranty({ proposal: p, chosenOption: null, fenceStyle: "WV-DS 6'x8' Privacy" })!.warranty.id).toBe(ONE_YEAR_ID)
    const old = signedOptionWarranty({ proposal: { ...gbb(), warranty: ONE_YEAR_TEXT }, chosenOption: 1 }, S)!
    expect(old.from).toBe('proposal')
    expect(old.warranty).toMatchObject({ id: ONE_YEAR_ID, term: 'years', years: 1 })
    expect(warrantyFromText('Lifetime Craftsmanship Warranty. For as long as you own your home or our sign is on the fence...')!.term).toBe('lifetime')
    expect(isOneYearText(ONE_YEAR_TEXT)).toBe(true)
    expect(isOneYearText(LIFETIME_TEXT)).toBe(false)
  })
})

describe('dates and service calls', () => {
  const life = warrantyForStyle(S, style("WV-ND 6'x8' Privacy"))!
  const one = warrantyForStyle(S, style("WV-DS 6'x8' Privacy"))!
  test('period: lifetime has no end; 1 year ends a year on; leap day', () => {
    expect(warrantyPeriod(life, '2026-10-20')).toEqual({ start: '2026-10-20', end: null, endText: 'For as long as the customer owns the home' })
    expect(warrantyPeriod(one, '2026-10-20')).toEqual({ start: '2026-10-20', end: '2027-10-20', endText: 'Through October 20, 2027' })
    expect(warrantyPeriod(one, null).endText).toBe('1 year from the install date')
    expect(endDateOf('2028-02-29', 1)).toBe('2029-02-28')
  })
  test('coverage: within the year covered, after it not, lifetime always, before install not, override wins', () => {
    expect(serviceCoverage(one, '2026-01-10', '2026-12-01')).toMatchObject({ covered: true, label: 'Covered by warranty' })
    expect(serviceCoverage(one, '2025-01-10', '2026-02-01')).toMatchObject({ covered: false, label: 'Not covered' })
    expect(serviceCoverage(life, '2016-01-10', '2026-02-01')).toMatchObject({ covered: true })
    expect(serviceCoverage(life, '2026-11-01', '2026-10-01')).toMatchObject({ covered: false })
    expect(serviceCoverage(one, null, '2026-10-01')).toMatchObject({ covered: null, label: 'Warranty not started' })
    expect(serviceCoverage(one, '2025-01-10', '2026-02-01', { covered: true, reason: 'Goodwill', by: 'Jonathan' })).toMatchObject({ covered: true, overridden: true, why: 'Set by Jonathan: Goodwill' })
  })
})

describe('the contract PDF', () => {
  const base = {
    company: { name: 'Getter Done Fence', phone: '3527894314', email: '' }, customerName: 'Test Customer', address: '1 Main St, Ocala, FL',
    optionLabel: 'White Vinyl Privacy, no dig', tierLabel: 'Better', price: 10000, footageFt: 150, gatesText: '1 walk gate', included: ['150 ft of new fence'], includedNote: '',
    depositPct: 50, depositNote: '', description: '', acceptedBy: 'Test Customer', acceptedAt: new Date('2026-10-20T15:00:00Z'), signedHow: 'link' as const, signature: null,
  }
  test('the accepted option\'s warranty word for word, and the install date once known', async () => {
    const w = warrantyForStyle(S, style("WV-ND 6'x8' Privacy"))!
    const pending = pdfText(await contractPdf({ ...base, warranty: w, installDate: null }))
    expect(pending).toContain('Lifetime Craftsmanship Warranty')
    expect(pending).toContain(LIFETIME_TEXT)
    expect(pending).toContain(warrantyLines(w, null).start)
    const dated = pdfText(await contractPdf({ ...base, warranty: w, installDate: 'November 3, 2026' }))
    expect(dated).toContain('Warranty starts on the install date: November 3, 2026')
    const ds = pdfText(await contractPdf({ ...base, warranty: warrantyForStyle(S, style("WV-DS 6'x8' Privacy")), installDate: null }))
    expect(ds).toContain('1 Year Workmanship Warranty')
    expect(ds).toContain(ONE_YEAR_TEXT)
    expect(ds).not.toContain('Lifetime')
  })
})
