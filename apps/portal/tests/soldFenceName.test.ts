/**
 * Review Oct 27 2026, without a database: a sold best price fence on the staff screens (the quote window,
 * "Accepted by …", the Order materials task, Schedule install, My installs) says the panels its runs used,
 * as the customer reads it; an unsold draft keeps "(best price)". And a service visit packet shows the
 * walkthrough's newest photo of each spot only.
 */

import { describe, test, expect } from 'vitest'
import { customerFenceName, isSoldQuote, soldRailsOf } from '../src/server/lib/customerFenceName'
import { newestWalkthroughPhotos } from '../src/server/routes/installPacket'
import { styleLabel } from '../../web/src/fenceCatalog'
import { soldStyleLabel } from '../../web/src/soldStyleLabel'

const NAME = 'Tan Vinyl Privacy, 6 ft tall, 6 or 8 ft panels (best price), Dig set'
const opt = (fenceStyle: string, runRails?: string[]) => ({ label: fenceStyle, fenceStyle, finalPrice: 5000, snapshot: { pullSheet: [], ...(runRails ? { runRails } : {}) } })

describe('a sold best price fence on staff screens', () => {
  test('sold or signed: Sold, accepted on the link, or a sold date', () => {
    expect(isSoldQuote({ status: 'SOLD' })).toBe(true)
    expect(isSoldQuote({ status: 'SENT', acceptedAt: '2026-10-27T15:00:00Z' })).toBe(true)
    expect(isSoldQuote({ status: 'DRAFT', soldAt: new Date() })).toBe(true)
    expect(isSoldQuote({ status: 'DRAFT' })).toBe(false)
    expect(isSoldQuote({ status: 'SENT', acceptedAt: null })).toBe(false)
    expect(isSoldQuote(null)).toBe(false)
  })

  test('the runs\' picks: the option of that style that saved them, else the quote\'s own', () => {
    const q = { fenceStyle: NAME, runRails: ['auto', 'auto'], proposal: { options: [opt('Other'), opt(NAME), opt(NAME, ['8ft', '8ft'])] } }
    expect(soldRailsOf(q)).toEqual(['8ft', '8ft'])
    expect(customerFenceName(NAME, soldRailsOf(q))).toBe('Tan Vinyl Privacy, 6 ft tall, 8 ft panels, Dig set')
    // No option saved them: the quote's own picks.
    expect(soldRailsOf({ fenceStyle: NAME, runRails: ['6ft', '8ft'], proposal: { options: [opt(NAME)] } })).toEqual(['6ft', '8ft'])
    // Another style's quote: its picks are not this fence's.
    expect(soldRailsOf({ fenceStyle: 'Other', runRails: ['8ft'] }, NAME)).toBeUndefined()
    expect(soldRailsOf(null)).toBeUndefined()
  })

  test('the web name: the panels used; both widths; without picks "6 ft or 8 ft panels"; never "(best price)"', () => {
    expect(styleLabel(NAME)).toBe(NAME) // a plain name not in Settings stays as written
    expect(soldStyleLabel(NAME, { fenceStyle: NAME, runRails: ['8ft'] })).toBe('Tan Vinyl Privacy, 6 ft tall, 8 ft panels, Dig set')
    expect(soldStyleLabel(NAME, { fenceStyle: NAME, runRails: ['6ft'] })).toBe('Tan Vinyl Privacy, 6 ft tall, 6 ft panels, Dig set')
    expect(soldStyleLabel(NAME, { fenceStyle: NAME, runRails: ['8ft', '6ft'] })).toBe('Tan Vinyl Privacy, 6 ft tall, 6 ft and 8 ft panels, Dig set')
    expect(soldStyleLabel(NAME, null)).toBe('Tan Vinyl Privacy, 6 ft tall, 6 ft or 8 ft panels, Dig set')
    expect(soldStyleLabel(NAME, { fenceStyle: NAME, runRails: ['auto'] })).not.toContain('best price')
    // Any other fence: as written; a saved label is never changed, only the words shown.
    expect(soldStyleLabel('White Vinyl Privacy, 6 ft tall, 8 ft panels, No dig', null)).toBe('White Vinyl Privacy, 6 ft tall, 8 ft panels, No dig')
    expect(soldStyleLabel('', null)).toBe('')
  })
})

describe('a service visit packet\'s walkthrough photos', () => {
  const at = (m: number) => new Date(Date.UTC(2026, 9, 20, 15, m))
  test('the newest of each spot; every other photo kept, in order', () => {
    const rows = [
      { id: 'site', caption: 'Site walk, Oct 20', takenAt: at(0) },
      { id: 'left-1', caption: 'Final walkthrough: Side: Left return', takenAt: at(1) },
      { id: 'back', caption: 'Final walkthrough: Side: Back', takenAt: at(2) },
      { id: 'left-2', caption: 'Final walkthrough: Side: Left return', takenAt: at(3) },
      { id: 'left-3', caption: 'Final walkthrough: Side: Left return', takenAt: at(4) },
      { id: 'crew', caption: '', takenAt: at(5) },
    ]
    expect(newestWalkthroughPhotos(rows).map(r => r.id)).toEqual(['site', 'back', 'left-3', 'crew'])
  })
})
