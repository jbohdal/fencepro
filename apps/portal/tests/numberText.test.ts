// Numbers typed into a box (apps/web/src/numberText.ts, used by NumberField on
// the Budget page): read to whole cents, shown with "$" and commas only when
// the box is left.
import { describe, it, expect } from 'vitest'
import {
  parseCents, parseNumber, formatCents, editCents, formatNumber, editNumber, readBox, showBox, editBox,
  dollarsToCents, centsToDollars, fractionToPercent, percentToFraction, isBlank,
} from '../../web/src/numberText'

describe('parseCents', () => {
  it('reads a pasted amount with "$" and commas', () => {
    expect(parseCents('$1,234.50')).toBe(123450)
    expect(parseCents(' $1,234.50 ')).toBe(123450)
    expect(parseCents('$ 1,234.50')).toBe(123450)
  })
  it('reads plain amounts, one decimal, no decimals, a lone decimal point', () => {
    expect(parseCents('1234.5')).toBe(123450)
    expect(parseCents('1234')).toBe(123400)
    expect(parseCents('1234.')).toBe(123400)
    expect(parseCents('.5')).toBe(50)
    expect(parseCents('0.07')).toBe(7)
    expect(parseCents('0')).toBe(0)
  })
  it('reads commas only as thousands separators', () => {
    expect(parseCents('1,234')).toBe(123400)
    expect(parseCents('12,345,678.90')).toBe(1234567890)
    expect(parseCents('1 234')).toBe(123400)
    expect(parseCents('1,23')).toBeNull()
    expect(parseCents('12,34.5')).toBeNull()
    expect(parseCents(',5')).toBeNull()
  })
  it('rounds the third decimal to the nearest cent, without float error', () => {
    expect(parseCents('1.005')).toBe(101)
    expect(parseCents('1.004')).toBe(100)
    expect(parseCents('0.1')).toBe(10)
    expect(parseCents('0.29')).toBe(29)
    expect(parseCents('19.99')).toBe(1999)
    expect(parseCents('1234.999')).toBe(123500)
  })
  it('blank, a lone minus and words are not numbers', () => {
    expect(parseCents('')).toBeNull()
    expect(parseCents('   ')).toBeNull()
    expect(parseCents('-')).toBeNull()
    expect(parseCents('$')).toBeNull()
    expect(parseCents('.')).toBeNull()
    expect(parseCents('abc')).toBeNull()
    expect(parseCents('12abc')).toBeNull()
    expect(parseCents('1.2.3')).toBeNull()
  })
  it('reads negatives: a minus before or after "$", or brackets', () => {
    expect(parseCents('-5')).toBe(-500)
    expect(parseCents('-$1,234.50')).toBe(-123450)
    expect(parseCents('$-12.5')).toBe(-1250)
    expect(parseCents('(12.50)')).toBe(-1250)
    expect(parseCents('-0')).toBe(0)
  })
})

describe('parseNumber', () => {
  it('reads percents and plain numbers', () => {
    expect(parseNumber('24.5')).toBe(24.5)
    expect(parseNumber('24.5%')).toBe(24.5)
    expect(parseNumber(' 24.5 % ')).toBe(24.5)
    expect(parseNumber('2,040')).toBe(2040)
    expect(parseNumber('-3')).toBe(-3)
    expect(parseNumber('')).toBeNull()
    expect(parseNumber('-')).toBeNull()
    expect(parseNumber('%')).toBeNull()
  })
})

describe('formatting', () => {
  it('shows money with "$" and commas, cents only when there are some', () => {
    expect(formatCents(123450)).toBe('$1,234.50')
    expect(formatCents(123400)).toBe('$1,234')
    expect(formatCents(61300000)).toBe('$613,000')
    expect(formatCents(5)).toBe('$0.05')
    expect(formatCents(0)).toBe('$0')
    expect(formatCents(-500)).toBe('-$5')
    expect(formatCents(2600, { cents: true })).toBe('$26.00')
  })
  it('puts the bare number in the box for typing: no "$", no commas', () => {
    expect(editCents(123450)).toBe('1234.50')
    expect(editCents(123400)).toBe('1234')
    expect(editCents(5)).toBe('0.05')
    expect(editCents(-1250)).toBe('-12.50')
    expect(editCents(0)).toBe('0')
  })
  it('shows numbers and percents', () => {
    expect(formatNumber(2040)).toBe('2,040')
    expect(formatNumber(21.4, { percent: true })).toBe('21.4%')
    expect(formatNumber(24, { percent: true })).toBe('24%')
    expect(formatNumber(1 / 3, { decimals: 2 })).toBe('0.33')
    expect(editNumber(2040)).toBe('2040')
    expect(editNumber(21.4)).toBe('21.4')
  })
  it('round trips: what the box shows reads back as the same number', () => {
    for (const c of [0, 1, 99, 100, 123450, 61300000, 1234567]) {
      expect(parseCents(formatCents(c))).toBe(c)
      expect(parseCents(editCents(c))).toBe(c)
    }
    for (const p of [0, 21.4, 24, 10.6, 44.25]) expect(parseNumber(showBox('percent', p))).toBe(p)
  })
})

describe('readBox', () => {
  it('an empty box is 0 by default, or refused', () => {
    expect(readBox('money', '')).toEqual({ ok: true, value: 0 })
    expect(readBox('money', '', { blank: null }).ok).toBe(false)
  })
  it('refuses what is not a number, and numbers out of range', () => {
    expect(readBox('money', '-').ok).toBe(false)
    expect(readBox('money', 'abc').ok).toBe(false)
    expect(readBox('money', '-5', { min: 0 }).ok).toBe(false)
    expect(readBox('percent', '120', { min: 0, max: 100 }).ok).toBe(false)
  })
  it('reads money to cents and percents to the decimals kept', () => {
    expect(readBox('money', '$1,234.50')).toEqual({ ok: true, value: 123450 })
    expect(readBox('percent', '21.456%', { decimals: 2 })).toEqual({ ok: true, value: 21.46 })
    expect(readBox('number', '2,040')).toEqual({ ok: true, value: 2040 })
  })
  it('shows and edits by kind', () => {
    expect(showBox('money', 123450)).toBe('$1,234.50')
    expect(editBox('money', 123450)).toBe('1234.50')
    expect(showBox('percent', 24)).toBe('24%')
    expect(editBox('percent', 24)).toBe('24')
    expect(isBlank('  ')).toBe(true)
  })
})

describe('budget units', () => {
  it('dollars and cents convert exactly', () => {
    expect(dollarsToCents(16922)).toBe(1692200)
    expect(dollarsToCents(1234.5)).toBe(123450)
    expect(dollarsToCents(0.1 + 0.2)).toBe(30)
    expect(centsToDollars(123450)).toBe(1234.5)
    expect(centsToDollars(dollarsToCents(613000))).toBe(613000)
  })
  it('fractions and percents convert without float noise', () => {
    expect(fractionToPercent(0.214)).toBe(21.4)
    expect(fractionToPercent(0.106)).toBe(10.6)
    expect(percentToFraction(21.4)).toBe(0.214)
    expect(percentToFraction(24.5)).toBe(0.245)
    expect(percentToFraction(fractionToPercent(0.07))).toBe(0.07)
  })
})
