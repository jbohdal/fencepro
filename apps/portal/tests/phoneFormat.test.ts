import { describe, test, expect } from 'vitest'
import { formatPhone, telHref } from '../../web/src/phoneFormat'

describe('phone on pipeline cards', () => {
  test('a US number reads (352) 555 1234, a space and no dash, however it was typed', () => {
    for (const raw of ['3525551234', '352-555-1234', '(352) 555-1234', '+1 352 555 1234', '1.352.555.1234']) expect(formatPhone(raw)).toBe('(352) 555 1234')
  })
  test('anything else is shown as typed; nothing for no phone', () => {
    expect(formatPhone('555-1234')).toBe('555-1234')
    expect(formatPhone('')).toBe('')
    expect(formatPhone(null)).toBe('')
  })
  test('the tel: link dials the digits', () => {
    expect(telHref('(352) 555-1234')).toBe('tel:3525551234')
    expect(telHref('+1 352 555 1234')).toBe('tel:+13525551234')
  })
})
