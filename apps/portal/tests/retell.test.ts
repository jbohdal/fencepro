/**
 * Retell webhook: signature check and call → lead mapping.
 */
import { describe, test, expect } from 'vitest'
import crypto from 'crypto'
import { verifyRetellSignature, summarizeRetellCall } from '../src/server/lib/retell.js'

const KEY = 'key_test_123'
const sign = (body: string, ts: number, key = KEY) =>
  `v=${ts},d=${crypto.createHmac('sha256', key).update(body + ts).digest('hex')}`

describe('verifyRetellSignature', () => {
  const body = JSON.stringify({ event: 'call_analyzed', call: { call_id: 'c1' } })
  const now = 1_800_000_000_000

  test('accepts a correctly signed, fresh request', () => {
    expect(verifyRetellSignature(body, sign(body, now), KEY, now)).toBe(true)
  })
  test('rejects a missing or malformed header', () => {
    expect(verifyRetellSignature(body, undefined, KEY, now)).toBe(false)
    expect(verifyRetellSignature(body, 'nonsense', KEY, now)).toBe(false)
    expect(verifyRetellSignature(body, `v=${now}`, KEY, now)).toBe(false)
  })
  test('rejects a signature made with another key', () => {
    expect(verifyRetellSignature(body, sign(body, now, 'other'), KEY, now)).toBe(false)
  })
  test('rejects a body that was changed after signing', () => {
    expect(verifyRetellSignature(body + ' ', sign(body, now), KEY, now)).toBe(false)
  })
  test('rejects anything older or newer than five minutes (replay)', () => {
    expect(verifyRetellSignature(body, sign(body, now - 6 * 60_000), KEY, now)).toBe(false)
    expect(verifyRetellSignature(body, sign(body, now + 6 * 60_000), KEY, now)).toBe(false)
    expect(verifyRetellSignature(body, sign(body, now - 4 * 60_000), KEY, now)).toBe(true)
  })
})

describe('summarizeRetellCall', () => {
  const base = {
    call_id: 'c1', direction: 'inbound', from_number: '+13525550177', to_number: '+13525550100',
    start_timestamp: 1_000_000, end_timestamp: 1_150_000, disconnection_reason: 'user_hangup',
    recording_url: 'https://example.com/r.wav',
  }

  test('reads the fields the agent collected, whatever case they are in', () => {
    const r = summarizeRetellCall({ ...base, call_analysis: {
      call_summary: 'Wants a vinyl fence.', user_sentiment: 'Positive',
      custom_analysis_data: { 'Caller Name': 'Carl Caller', service_address: '88 Pine St', FenceType: 'Vinyl privacy', callback_time: 'Tomorrow 10 AM' },
    } })
    expect(r.name).toBe('Carl Caller')
    expect(r.phone).toBe('+13525550177')
    expect(r.address).toBe('88 Pine St')
    expect(r.fenceType).toBe('Vinyl privacy')
    expect(r.callbackAt).toBe('Tomorrow 10 AM')
    expect(r.summary).toMatch(/Callback booked: Tomorrow 10 AM/)
    expect(r.summary).toMatch(/Summary: Wants a vinyl fence\./)
    expect(r.summary).toMatch(/Recording: https:\/\/example\.com\/r\.wav/)
    expect(r.summary).toMatch(/2\.5 min/)
  })

  test('first and last name fields are joined', () => {
    const r = summarizeRetellCall({ ...base, call_analysis: { custom_analysis_data: { first_name: 'Ann', last_name: 'Lee' } } })
    expect(r.name).toBe('Ann Lee')
  })

  test('every collected field is kept in the note even if it is not one we look for', () => {
    const r = summarizeRetellCall({ ...base, call_analysis: { custom_analysis_data: { how_did_you_hear: 'Billboard', in_service_area: true } } })
    expect(r.summary).toMatch(/how_did_you_hear: Billboard/)
    expect(r.summary).toMatch(/in_service_area: true/)
  })

  test('no name collected falls back to the number', () => {
    const r = summarizeRetellCall({ ...base, call_analysis: {} })
    expect(r.name).toBe('Caller +13525550177')
  })

  test('outbound call: the customer is the number that was dialed', () => {
    const r = summarizeRetellCall({ ...base, direction: 'outbound', call_analysis: {} })
    expect(r.phone).toBe('+13525550100')
  })

  test('survives a call with almost nothing in it', () => {
    const r = summarizeRetellCall({ call_id: 'x' })
    expect(r.name).toBe('Unknown caller')
    expect(r.phone).toBe('')
  })
})
