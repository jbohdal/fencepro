/**
 * Lead sources and customer tags: the model (optionListModel.ts), no database.
 *   - the web and server copies are the same file;
 *   - the one-time list from today's words (live as of Oct 20 2026): Settings
 *     words first and shown, record words after (hidden when no customer in
 *     12 months), capital letter twins linked, Google and Repeat Customer
 *     merged, built-ins hidden;
 *   - optionFor / labelFor / groupKeyFor: reports add merged words together;
 *   - the save rule: an id or linked word kept, a name in any case becomes the
 *     id, anything else as typed (never a guess);
 *   - merge, undo merge, linking a found word, built-ins never merged away.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import {
  optionsFromOld, optionFor, labelFor, groupKeyFor, wordToSave, pickerOptions, mergeOption, undoMerge, linkWord, addOption, foundOnRecords,
  optionsProblem, normalizeOptions, START_MERGES, BUILT_IN_OPTIONS, type RecordWord,
} from '../src/server/lib/optionListModel.js'

const AT = '2026-10-20T12:00:00.000Z'
const SETTINGS = ['Google', 'Facebook', 'Instagram', 'Yard Sign', 'Referral', 'Door Hanger', 'Repeat Customer', 'Nextdoor', 'Other']
// Live, customers (Oct 20 2026); recent: a customer created in the last 12 months has it.
const WORDS: RecordWord[] = [
  ['website/google', 3561, true], ['mysalesman', 1440, true], ['Referral', 434, true], ['repeat business', 213, true], ['yard sign', 84, true],
  ['canvassing', 44, true], ['Billboard maricamp', 27, true], ['facebook', 18, true], ['Google', 20, true], ['billboard 441', 17, true],
  ['vehicle wrap', 8, false], ['Other', 4, true],
].map(([word, count, recentCustomer]) => ({ word: word as string, count: count as number, recentCustomer: recentCustomer as boolean }))

const made = optionsFromOld('leadSources', SETTINGS, WORDS, START_MERGES.leadSources, AT)
const L = made.options

describe('one model, two copies', () => {
  test('apps/web/src/optionListModel.ts is the same file as the server\'s', () => {
    const web = readFileSync(fileURLToPath(new URL('../../web/src/optionListModel.ts', import.meta.url)), 'utf8')
    const server = readFileSync(fileURLToPath(new URL('../src/server/lib/optionListModel.ts', import.meta.url)), 'utf8')
    expect(web).toBe(server)
  })
})

describe('the one-time lead source list (live words)', () => {
  test('Settings words first and shown; record words after, most used first', () => {
    expect(L.map(o => o.id)).toEqual(['Facebook', 'Instagram', 'Yard Sign', 'Referral', 'Door Hanger', 'Nextdoor', 'Other', 'website/google', 'mysalesman', 'repeat business', 'canvassing', 'Billboard maricamp', 'billboard 441', 'vehicle wrap', 'Website Quote', 'Phone (AI receptionist)', 'Website chat', 'Phone call', 'Walk-in'])
    expect(L.filter(o => o.hidden).map(o => o.id)).toEqual(['vehicle wrap', 'Website Quote', 'Phone (AI receptionist)', 'Website chat'])
    // The office's phone and walk-in leads (Oct 25, 2026): built in, and offered in the pickers.
    expect(L.filter(o => o.id === 'Phone call' || o.id === 'Walk-in').map(o => [o.id, o.hidden, o.builtIn])).toEqual([['Phone call', false, true], ['Walk-in', false, true]])
    expect(L.find(o => o.id === 'Instagram')!.hidden).toBe(false)     // a Settings word stays in the forms (Jonathan)
  })
  test('capital letter twins are linked; Google and Repeat Customer merged; built-ins hidden', () => {
    expect(made.caseLinks).toEqual([{ word: 'yard sign', into: 'Yard Sign' }, { word: 'facebook', into: 'Facebook' }])
    expect(made.merged).toEqual([{ from: 'Google', into: 'website/google' }, { from: 'Repeat Customer', into: 'repeat business' }])
    expect(L.filter(o => o.builtIn).map(o => o.id)).toEqual(BUILT_IN_OPTIONS.leadSources)
    expect(optionsProblem(L, 'leadSources')).toBeNull()
  })
  test('every word on records belongs to an option (none found on records)', () => {
    expect(foundOnRecords(L, WORDS)).toEqual([])
  })
  test('tags: the import tags are built in and hidden; Settings tags shown', () => {
    const t = optionsFromOld('customerTags', ['Residential', 'Commercial'], [{ word: 'Imported', count: 2039, recentCustomer: true }, { word: 'JobNimbus', count: 1625, recentCustomer: true }, { word: 'From schedule', count: 25, recentCustomer: true }, { word: 'Residential', count: 3, recentCustomer: true }], [], AT)
    expect(t.options.map(o => [o.id, o.hidden, o.builtIn])).toEqual([['Residential', false, false], ['Commercial', false, false], ['Imported', true, true], ['JobNimbus', true, true], ['From schedule', true, true], ['MyBudgetQuote import', true, true], ['MyBudgetQuote dropoff', true, true]])
  })
})

describe('reading records', () => {
  test('a merged or twin word shows as its option and counts with it', () => {
    expect(labelFor(L, 'Google')).toBe('website/google')
    expect(groupKeyFor(L, 'Google')).toBe('website/google')
    expect(groupKeyFor(L, 'yard sign')).toBe('Yard Sign')
    expect(labelFor(L, 'Repeat Customer')).toBe('repeat business')
    const renamed = L.map(o => (o.id === 'website/google' ? { ...o, name: 'Website / Google' } : o))
    expect(labelFor(renamed, 'Google')).toBe('Website / Google')
    expect(labelFor(renamed, 'website/google')).toBe('Website / Google')
  })
  test('a report adds merged words together', () => {
    const quotes = [...Array(3).fill('website/google'), 'Google', 'Google', 'yard sign', 'Yard Sign', 'Something new']
    const by: Record<string, number> = {}
    for (const w of quotes) { const k = labelFor(L, w); by[k] = (by[k] ?? 0) + 1 }
    expect(by).toEqual({ 'website/google': 5, 'Yard Sign': 2, 'Something new': 1 })
  })
  test('a word no option matches shows as typed; never a guess', () => {
    expect(optionFor(L, 'Gogle')).toBeNull()
    expect(labelFor(L, 'Gogle')).toBe('Gogle')
  })
})

describe('the save rule', () => {
  test('an id or linked word kept; a name in any case becomes the id; anything else as typed', () => {
    expect(wordToSave(L, 'website/google')).toBe('website/google')
    expect(wordToSave(L, 'Google')).toBe('Google')                 // a linked word stays as it is
    expect(wordToSave(L, 'yard sign')).toBe('yard sign')
    expect(wordToSave(L, 'INSTAGRAM')).toBe('Instagram')
    const renamed = L.map(o => (o.id === 'mysalesman' ? { ...o, name: 'My Salesman' } : o))
    expect(wordToSave(renamed, 'my salesman')).toBe('mysalesman')
    expect(wordToSave(L, 'Billbord')).toBe('Billbord')
  })
  test('pickers offer the shown options, and the record\'s own word', () => {
    const p = pickerOptions(L, 'Website Quote')
    expect(p.some(o => o.value === 'Website Quote')).toBe(true)      // the record's built-in word, though hidden
    expect(pickerOptions(L).some(o => o.value === 'Website Quote')).toBe(false)
    expect(pickerOptions(L).some(o => o.value === 'vehicle wrap')).toBe(false)
    expect(pickerOptions(L, 'Google').find(o => o.value === 'Google')!.label).toBe('website/google')
  })
})

describe('merge and undo', () => {
  test('merge, then undo: the option comes back as it was', () => {
    const m = mergeOption(L, 'canvassing', 'Other', AT)
    if (!('list' in m)) throw new Error(m.error)
    expect(m.list.some(o => o.id === 'canvassing')).toBe(false)
    expect(groupKeyFor(m.list, 'canvassing')).toBe('Other')
    const u = undoMerge(m.list, 'Other', 'canvassing')
    if (!('list' in u)) throw new Error(u.error)
    expect(u.list.find(o => o.id === 'canvassing')).toMatchObject({ name: 'canvassing', hidden: false })
    expect(groupKeyFor(u.list, 'canvassing')).toBe('canvassing')
  })
  test('a merged option keeps its own links through merge and undo', () => {
    const m = mergeOption(L, 'Yard Sign', 'Other', AT) as any
    expect(groupKeyFor(m.list, 'yard sign')).toBe('Other')
    const u = undoMerge(m.list, 'Other', 'Yard Sign') as any
    expect(groupKeyFor(u.list, 'yard sign')).toBe('Yard Sign')
  })
  test('the Google merge can be undone', () => {
    const u = undoMerge(L, 'website/google', 'Google') as any
    expect(u.list.find((o: any) => o.id === 'Google')).toMatchObject({ name: 'Google', hidden: false })
    expect(groupKeyFor(u.list, 'Google')).toBe('Google')
  })
  test('built-ins: never merged away; renaming and hiding are fine', () => {
    expect(mergeOption(L, 'Website Quote', 'Other', AT)).toMatchObject({ error: expect.stringMatching(/built in/) })
    expect(optionsProblem(L.filter(o => o.id !== 'Website chat'), 'leadSources')).toMatch(/built in/)
    expect(optionsProblem(L.map(o => (o.id === 'Website Quote' ? { ...o, name: 'Website (drawn)', hidden: false } : o)), 'leadSources')).toBeNull()
    expect(normalizeOptions([], 'customerTags').map(o => o.id)).toEqual(BUILT_IN_OPTIONS.customerTags)
  })
  test('a word found on records: Add, or Merge into (linked; Undo takes the link off)', () => {
    const add = addOption(L, 'Craigslist') as any
    expect(add.list.find((o: any) => o.id === 'Craigslist')).toMatchObject({ hidden: false, builtIn: false })
    const link = linkWord(L, 'Craigslist', 'Other', AT) as any
    expect(groupKeyFor(link.list, 'Craigslist')).toBe('Other')
    expect(groupKeyFor((undoMerge(link.list, 'Other', 'Craigslist') as any).list, 'Craigslist')).toBe('Craigslist')
  })
  test('refused: two options with one name, a word in two options', () => {
    expect(optionsProblem(L.map(o => (o.id === 'Other' ? { ...o, name: 'referral' } : o)), 'leadSources')).toMatch(/Two options are called/)
    expect(optionsProblem(L.map(o => (o.id === 'Other' ? { ...o, alsoMatches: [{ word: 'Google', kind: 'merge' as const }] } : o)), 'leadSources')).toMatch(/is in two options/)
  })
})
