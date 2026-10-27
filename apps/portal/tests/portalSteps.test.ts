/**
 * The customer portal's My Projects steps (audit Oct 26, 2026: a finished job
 * ticked "Materials Ordered" though nothing was ordered, "Locates Marked"
 * when 811 was only called, and still said "Install starts"):
 *   - the server ticks 811, the permit and materials from the job's records only
 *   - the page leaves off, once the fence is in, a step before the install that was never recorded
 */

import { describe, test, expect } from 'vitest'
import { projectStepsOf } from '../src/server/routes/portal.js'
import { projectSteps, FINISHED_STATUSES } from '../../web/src/portalSteps'

describe('the steps before the install, from the records', () => {
  test('811: marked once the good to dig day has come; called with a later day is not marked', () => {
    expect(projectStepsOf({ locatesDate: '2026-10-29', permit: null, materialsStatus: 'not_ordered' }, '2026-10-26').locates).toBe(false)
    expect(projectStepsOf({ locatesDate: '2026-10-26', permit: null, materialsStatus: 'not_ordered' }, '2026-10-26').locates).toBe(true)
    expect(projectStepsOf({ locatesDate: null, permit: null, materialsStatus: 'not_ordered' }, '2026-10-26').locates).toBe(false)
  })
  test('the permit and the materials as recorded, never from the job\'s status', () => {
    expect(projectStepsOf({ locatesDate: null, permit: 'needed', materialsStatus: 'not_ordered' }, '2026-10-26')).toEqual({ locates: false, permit: 'not_yet', materials: false })
    expect(projectStepsOf({ locatesDate: null, permit: 'approved', materialsStatus: 'ordered' }, '2026-10-26')).toEqual({ locates: false, permit: 'done', materials: true })
    expect(projectStepsOf({ locatesDate: null, permit: 'not_needed', materialsStatus: 'received' }, '2026-10-26').permit).toBe('not_needed')
  })
})

describe('the page', () => {
  test('a finished job with nothing recorded before the install: no false ticks, no waiting steps, installed and paid', () => {
    const s = projectSteps({ status: 'paid', scheduledDate: '2026-10-26', steps: { locates: false, permit: 'not_yet', materials: false } })
    expect(s.map(x => x.label)).toEqual(['Quote Accepted', 'Installation Scheduled', 'Installation Complete', 'Invoice Sent', 'Complete'])
    expect(s.every(x => x.done)).toBe(true)
    expect(FINISHED_STATUSES).toContain('paid')
  })
  test('a finished job never given an install date: no "Installation Scheduled" tick', () => {
    const s = projectSteps({ status: 'completed', scheduledDate: '', steps: { locates: false, permit: 'not_yet', materials: false } })
    expect(s.map(x => x.label)).toEqual(['Quote Accepted', 'Installation Complete', 'Invoice Sent', 'Complete'])
  })
  test('a finished job keeps the steps that were recorded', () => {
    const s = projectSteps({ status: 'completed', scheduledDate: '2026-10-26', steps: { locates: true, permit: 'done', materials: true } })
    expect(s.filter(x => x.done).map(x => x.label)).toEqual(['Quote Accepted', 'Locates Marked (811)', 'Permit Approved', 'Materials Ordered', 'Installation Scheduled', 'Installation Complete'])
  })
  test('a job not installed yet shows every step, ticked only as recorded', () => {
    const s = projectSteps({ status: 'scheduled', scheduledDate: '2026-11-02', steps: { locates: false, permit: 'done', materials: false } })
    expect(s.map(x => [x.label, x.done])).toEqual([
      ['Quote Accepted', true], ['Locates Marked (811)', false], ['Permit Approved', true], ['Materials Ordered', false],
      ['Installation Scheduled', true], ['Installation Complete', false], ['Invoice Sent', false], ['Complete', false],
    ])
    expect(s.find(x => x.current)?.label).toBe('Locates Marked (811)')
  })
})
