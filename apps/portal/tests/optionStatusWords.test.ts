/**
 * Settings → Fence styles wording (review, Oct 26 2026): Green, switched off,
 * said only "Not available for quoting: waiting for prices on 8 parts"; the
 * chain link Install "Dig set" row said "waiting for prices on 10 parts… It
 * switches on by itself" while galvanized and black 4 ft dig set were quotable.
 */
import { describe, test, expect } from 'vitest'
import { colorStatusWords, fenceRowWords, waitForPricesWords } from '../../web/src/optionStatusWords'

describe('a color', () => {
  test('switched off says so first, then what prices it waits for', () => {
    expect(colorStatusWords(false, 'prices on 8 parts in Inventory')).toEqual([{ tone: 'off', text: 'Switched off. It is also waiting for prices on 8 parts in Inventory.' }])
    expect(colorStatusWords(false, null)).toEqual([{ tone: 'off', text: 'Switched off: fully priced, switch it on to quote it.' }])
  })
  test('on: waiting, or fully priced', () => {
    expect(colorStatusWords(true, 'prices on 2 parts in Inventory')[0]).toEqual({ tone: 'wait', text: 'Not available for quoting: waiting for prices on 2 parts in Inventory.' })
    expect(colorStatusWords(true, null)[0]).toEqual({ tone: 'ok', text: 'Fully priced: available for quoting' })
  })
})

describe('Dig set (waits for prices): fence by fence', () => {
  const fences = [
    { label: 'Galvanized Chain Link, 4 ft, Residential', unpriced: 0, switchedOff: false },
    { label: 'Black Chain Link, 4 ft, Residential', unpriced: 0, switchedOff: false },
    { label: 'Black Chain Link, 6 ft, Residential', unpriced: 2, switchedOff: false },
    { label: 'Green Chain Link, 4 ft, Residential', unpriced: 8, switchedOff: true },
  ]
  test('says which are quotable now, which switch on by themselves, and which are switched off too', () => {
    const w = waitForPricesWords(true, fences)
    expect(w).toEqual([
      { tone: 'ok', text: 'Available for quoting: Galvanized Chain Link, 4 ft, Residential; Black Chain Link, 4 ft, Residential.' },
      { tone: 'wait', text: 'Waiting for prices in Inventory: Black Chain Link, 6 ft, Residential (2 parts). It switches on by itself once they are in.' },
      { tone: 'wait', text: 'Switched off, and waiting for prices: Green Chain Link, 4 ft, Residential (8 parts).' },
    ])
    expect(w.map(l => l.text).join(' ')).not.toMatch(/waiting for prices on 10 parts/)
  })
  test('every fence priced: available; switched off: says so', () => {
    expect(waitForPricesWords(true, fences.slice(0, 2))).toEqual([{ tone: 'ok', text: 'Fully priced: available for quoting' }])
    expect(waitForPricesWords(false, fences.slice(0, 2))).toEqual([{ tone: 'off', text: 'Switched off: every fence is fully priced, switch it on to quote them.' }])
    expect(waitForPricesWords(false, fences)[0]).toEqual({ tone: 'off', text: 'Switched off.' })
  })
})

describe('a fence row', () => {
  test('a fence switched off says it is switched off', () => {
    expect(fenceRowWords(false, undefined)).toBe('Switched off')
    expect(fenceRowWords(false, 'Green is turned off')).toBe('Switched off. Also: Green is turned off')
    expect(fenceRowWords(true, 'Dig set is waiting for prices on 2 parts in Inventory')).toBe('Not available for quoting: Dig set is waiting for prices on 2 parts in Inventory')
    expect(fenceRowWords(true, undefined)).toBeNull()
  })
})
