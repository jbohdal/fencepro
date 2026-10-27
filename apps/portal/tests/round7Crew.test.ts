/**
 * Review Oct 27 2026 (round 7), without a database: the installer's job page after Finish (9) and the
 * work order of a service visit (10).
 */

import { describe, test, expect } from 'vitest'
import { jobFinishedDay, type InstallTime } from '../src/server/lib/crewInstall'
import { serviceVisit } from '../src/server/routes/installPacket'
import { finishedStageWords } from '../../web/src/crewWords'
import { dayText } from '../../web/src/warranties'

const tap = (kind: 'start' | 'finish', day: string, jobDone = false): InstallTime => ({ kind, at: `${day}T15:00:00.000Z`, by: 'Mike', day, ...(jobDone ? { jobDone } : {}) })

describe('9. the installer\'s job page after Finish', () => {
  test('the day the whole job was finished, not a day\'s end', () => {
    expect(jobFinishedDay([tap('start', '2026-10-26'), tap('finish', '2026-10-26')], '2026-10-27')).toBeNull()
    expect(jobFinishedDay([tap('finish', '2026-10-26'), tap('finish', '2026-10-27')], '2026-10-27')).toBe('2026-10-27')
    expect(jobFinishedDay([tap('finish', '2026-10-26', true)], '2026-10-27')).toBe('2026-10-26')
    expect(jobFinishedDay([tap('finish', '2026-10-26')], null)).toBe('2026-10-26')
  })

  test('under the stage: finished, and what it waits for; nothing once closed or before the finish', () => {
    const info = { times: [tap('start', '2026-10-27'), tap('finish', '2026-10-27')], lastDay: '2026-10-27', jobDone: true }
    expect(finishedStageWords({ ...info, closeOut: { closed: false, walkthroughSigned: false, paidInFull: false } }, dayText))
      .toBe('Finished October 27, 2026, waiting on the final walkthrough and the final payment.')
    expect(finishedStageWords({ ...info, closeOut: { closed: false, walkthroughSigned: true, paidInFull: false } }, dayText))
      .toBe('Finished October 27, 2026, waiting on the final payment.')
    expect(finishedStageWords({ ...info, closeOut: { closed: true, walkthroughSigned: true, paidInFull: true } }, dayText)).toBe('')
    expect(finishedStageWords({ ...info, jobDone: false, closeOut: null }, dayText)).toBe('')
  })
})

describe('10. a service visit\'s work order', () => {
  const job = { id: 'job-1', accountId: 'acc', status: 'complete', completedDate: '2026-09-01', scheduledDate: '2026-08-30', scheduledEndDate: null }
  test('covered work on an installed job, or opened from the visit: a service visit', async () => {
    expect(await serviceVisit(job, [{ id: 't1' }], false)).toBe(true)
    expect(await serviceVisit({ ...job, status: 'scheduled', completedDate: null }, [{ id: 't1' }], true)).toBe(true)
  })
  test('no covered work: the install packet as it was', async () => {
    expect(await serviceVisit(job, [], true)).toBe(false)
  })
})
