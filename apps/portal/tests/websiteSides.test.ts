/**
 * Older website leads' notes said "281 ft (measured)" for a side drawn on the
 * aerial photo; they are shown without it (display only, round 2 review,
 * Oct 26 2026).
 */

import { describe, test, expect } from 'vitest'
import { plainSideWords } from '../src/server/lib/websiteSides.js'

describe('website sides as shown', () => {
  test('"(measured)" is dropped from a drawn side', () => {
    const old = 'Website quote\n281 ft of Chain link\nRun 1 side 1: 281 ft (measured)\nRun 1 side 2: 70.5 ft (measured)\nAsked for an on site estimate: no'
    expect(plainSideWords(old)).toBe('Website quote\n281 ft of Chain link\nRun 1 side 1: 281 ft\nRun 1 side 2: 70.5 ft\nAsked for an on site estimate: no')
  })
  test('a typed side says the customer typed it, as new notes do', () => {
    expect(plainSideWords('Run 2 side 1: 90 ft (typed, photo said 84 ft)')).toBe('Run 2 side 1: 90 ft (typed by the customer; the photo said 84 ft)')
  })
  test('new notes and anything else are left alone', () => {
    const now = 'Run 1 side 1: 281 ft\nRun 1 side 2: 90 ft (typed by the customer; the photo said 84 ft)'
    expect(plainSideWords(now)).toBe(now)
    expect(plainSideWords('The customer measured it (measured) twice')).toBe('The customer measured it (measured) twice')
    expect(plainSideWords('')).toBe('')
    expect(plainSideWords(null)).toBeNull()
  })
})
