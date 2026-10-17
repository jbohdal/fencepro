/**
 * The instant quote watch: one alert after 10 minutes without an answer (not
 * before, not twice), and one when it answers again.
 */
import { describe, test, expect } from 'vitest'
import { createDoorWatch } from '../src/server/lib/doorWatch'

describe('instant quote watch', () => {
  test('alerts once after 10 minutes down, then once when back', async () => {
    let t = Date.parse('2026-10-17T18:00:00Z'), up = true
    const alerts: string[] = []
    const tick = createDoorWatch({ check: async () => up, alert: async title => { alerts.push(title) }, now: () => t })
    expect(await tick()).toBe('up')
    up = false
    const states: string[] = []
    for (let m = 0; m <= 12; m++) { t += 60_000; states.push(await tick()) }
    expect(states.filter(s => s === 'alerted')).toHaveLength(1)
    expect(states.slice(0, 10).every(s => s === 'down')).toBe(true)
    up = true; t += 60_000
    expect(await tick()).toBe('recovered')
    expect(alerts).toEqual(['Instant quote is not answering', 'Instant quote is answering again'])
  })

  test('a short blip (under 10 minutes) raises nothing', async () => {
    let t = 0, up = false
    const alerts: string[] = []
    const tick = createDoorWatch({ check: async () => up, alert: async title => { alerts.push(title) }, now: () => t })
    for (let m = 0; m < 9; m++) { t += 60_000; await tick() }
    up = true; t += 60_000
    expect(await tick()).toBe('up')
    expect(alerts).toEqual([])
  })

  test('a check that throws counts as down', async () => {
    let t = 0
    const tick = createDoorWatch({ check: async () => { throw new Error('offline') }, alert: async () => {}, now: () => t })
    expect(await tick()).toBe('down')
  })
})
