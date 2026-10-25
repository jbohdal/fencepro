/**
 * The 811 locate model (lib/locates.ts): the status from the dates, the
 * warnings against the install days, what may be saved, and moving a crew
 * packet's typed ticket onto the job.
 */

import { describe, it, expect } from 'vitest'
import { locateOf, locateStatus, locateWords, locateWarnings, locateShortWarning, cleanLocate, locateFromPacket, locateFields } from '../src/server/lib/locates.js'
import { scheduleWarnings, locatesWords } from '../src/server/lib/installDays.js'

const rec = (r: Partial<ReturnType<typeof locateOf>>) => ({ ticket: null, calledDate: null, goodDate: null, expDate: null, ...r })

describe('the status, worked out from the dates', () => {
  it('Not called with nothing on the job', () => {
    expect(locateStatus(rec({}), '2026-10-25')).toBe('not_called')
    expect(locateWords(rec({}), '2026-10-25').text).toBe('Not called')
  })
  it('Called while the good to dig date is ahead (or not entered)', () => {
    expect(locateStatus(rec({ ticket: '294610232', calledDate: '2026-10-21', goodDate: '2026-10-27' }), '2026-10-25')).toBe('called')
    expect(locateWords(rec({ ticket: '294610232', goodDate: '2026-10-27', expDate: '2026-11-20' }), '2026-10-25').text).toBe('Called, clear to dig 10/27/2026, expires 11/20/2026')
    expect(locateWords(rec({ ticket: '294610232', calledDate: '2026-10-21' }), '2026-10-25').text).toBe('Called 10/21/2026, good to dig date not entered')
  })
  it('Clear to dig from the good to dig date, Expired after the expiration date', () => {
    const r = rec({ ticket: '294610232', goodDate: '2026-10-24', expDate: '2026-11-20' })
    expect(locateStatus(r, '2026-10-24')).toBe('clear')
    expect(locateWords(r, '2026-10-25').text).toBe('Clear to dig, expires 11/20/2026')
    expect(locateStatus(r, '2026-11-20')).toBe('clear')
    expect(locateStatus(r, '2026-11-21')).toBe('expired')
    expect(locateWords(r, '2026-11-21').text).toBe('Expired 11/20/2026')
  })
  it('reads the job fields: locatesDate is the good to dig date, locatesExpDate the expiration', () => {
    expect(locateOf({ locateTicket: ' 294610232 ', locateCalledDate: '2026-10-21', locatesDate: '2026-10-24', locatesExpDate: 'soon' })).toEqual({ ticket: '294610232', calledDate: '2026-10-21', goodDate: '2026-10-24', expDate: null })
    expect(locateFields(rec({ ticket: 'T', goodDate: '2026-10-24' }))).toEqual({ locateTicket: 'T', locateCalledDate: null, locatesDate: '2026-10-24', locatesExpDate: null })
  })
})

describe('warnings against the install days', () => {
  const ok = rec({ ticket: '294610232', calledDate: '2026-10-21', goodDate: '2026-10-24', expDate: '2026-11-20' })
  it('nothing when the ticket is clear well before and after the install', () => {
    expect(locateWarnings(ok, '2026-10-26', '2026-10-28')).toEqual([])
    expect(locateShortWarning(ok, '2026-10-26', '2026-10-28')).toBeNull()
  })
  it('no ticket', () => {
    expect(locateWarnings(rec({}), '2026-10-26', '2026-10-26').map(w => w.text)).toEqual(['No 811 locate ticket on the job.'])
    expect(locateShortWarning(rec({}), '2026-10-26', '2026-10-26')).toBe('No 811 ticket')
  })
  it('the install before the good to dig date', () => {
    const w = locateWarnings({ ...ok, goodDate: '2026-10-27' }, '2026-10-26', '2026-10-28')
    expect(w.map(x => x.text)).toEqual(['The install starts 10/26/2026, before the 811 good to dig date (10/27/2026).'])
    expect(locateShortWarning({ ...ok, goodDate: '2026-10-27' }, '2026-10-26', '2026-10-28')).toBe('811 not clear until 10/27')
  })
  it('the ticket expires before the install, before its last day, or within 3 days of the start', () => {
    expect(locateWarnings({ ...ok, expDate: '2026-10-25' }, '2026-10-26', '2026-10-28')[0].text).toBe('The 811 ticket ran out on 10/25/2026, before the install starts.')
    expect(locateWarnings({ ...ok, expDate: '2026-10-27' }, '2026-10-26', '2026-10-28')[0].text).toBe('The 811 ticket runs out on 10/27/2026, before the last crew day (10/28/2026).')
    expect(locateWarnings({ ...ok, expDate: '2026-10-29' }, '2026-10-26', '2026-10-26')[0].text).toBe('The 811 ticket runs out on 10/29/2026, within 3 days of the install start.')
    expect(locateWarnings({ ...ok, expDate: '2026-10-30' }, '2026-10-26', '2026-10-26')).toEqual([])
  })
  it('Schedule install and Ready to schedule use the same warnings (installDays)', () => {
    const facts = { permitStatus: 'approved', locatesDate: '2026-10-24', locatesExpDate: '2026-10-27', locateTicket: '294610232', locateCalledDate: null, deposit: 'paid' as const, materialsStatus: 'received' }
    expect(scheduleWarnings(facts, '2026-10-26', '2026-10-28').map(w => w.text)).toEqual(['The 811 ticket runs out on 10/27/2026, before the last crew day (10/28/2026).'])
    expect(locatesWords({ ...facts, locatesExpDate: '2026-11-20' }, '2026-10-25')).toMatchObject({ state: 'ok', status: 'clear' })
    expect(locatesWords({ ...facts, locatesDate: '2026-10-27' }, '2026-10-25').state).toBe('waiting')
  })
})

describe('what may be saved', () => {
  it('a ticket and dates as typed', () => {
    expect(cleanLocate({ ticket: '294610232', calledDate: '2026-10-21', goodDate: '2026-10-24', expDate: '2026-11-20' })).toEqual({ ok: true, record: { ticket: '294610232', calledDate: '2026-10-21', goodDate: '2026-10-24', expDate: '2026-11-20' } })
    expect(cleanLocate({ ticket: '', calledDate: '', goodDate: '', expDate: '' })).toEqual({ ok: true, record: rec({}) })
  })
  it('refused in plain words', () => {
    expect(cleanLocate({ ticket: '2946<script>' })).toMatchObject({ ok: false })
    expect(cleanLocate({ goodDate: '10/24' })).toEqual({ ok: false, error: 'The good to dig date is not a date.' })
    expect(cleanLocate({ calledDate: '2026-10-25', goodDate: '2026-10-24' })).toEqual({ ok: false, error: 'The good to dig date is before the day it was called in.' })
    expect(cleanLocate({ goodDate: '2026-10-24', expDate: '2026-10-20' })).toEqual({ ok: false, error: 'The expiration date is before the good to dig date.' })
  })
})

describe('a crew packet\'s typed locate, moved onto the job', () => {
  it('Manuel Cotrich: ticket 294610232, 10/24 as the good to dig date', () => {
    expect(locateFromPacket(rec({}), { locateTicket: '294610232', locateDate: '2026-10-24' })).toEqual(rec({ ticket: '294610232', goodDate: '2026-10-24' }))
  })
  it('keeps what the job has, and nothing to move is null', () => {
    expect(locateFromPacket(rec({ ticket: '111', goodDate: '2026-10-20' }), { locateTicket: '294610232', locateDate: '2026-10-24' })).toBeNull()
    expect(locateFromPacket(rec({ ticket: '111' }), { locateTicket: '294610232', locateDate: '2026-10-24' })).toEqual(rec({ ticket: '111', goodDate: '2026-10-24' }))
    expect(locateFromPacket(rec({}), { locateTicket: ' ', locateDate: null })).toBeNull()
  })
})
