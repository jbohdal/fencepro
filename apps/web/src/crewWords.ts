/**
 * Words for the crew's Start and Finish taps (round 2b, Oct 26 2026). Kept
 * apart from installPacket.tsx so the tests can read them.
 */

import type { CrewInstall, InstallTime } from './installPacket'

/**
 * A Finish tap in words for the job page (round 2b, Oct 26 2026): the job
 * finished ("Finished the job": a one day job's Finish, Finish on the last
 * crew day, or "We finished the whole job") apart from a day's end ("Finished
 * day 1 of 2").
 */
export function finishWords(t: InstallTime, info: Pick<CrewInstall, 'lastDay' | 'crewDays'> | null | undefined): string {
  if (t.kind === 'start') {
    const days = info?.crewDays ?? []
    const n = days.indexOf(t.day)
    return days.length > 1 && n >= 0 ? `Started day ${n + 1} of ${days.length}` : 'Started'
  }
  const last = info?.lastDay ?? null
  if (t.jobDone || !last || t.day >= last) return 'Finished the job'
  const days = info?.crewDays ?? []
  const n = days.indexOf(t.day)
  return n >= 0 && days.length > 1 ? `Finished day ${n + 1} of ${days.length}` : 'Finished for the day'
}

/** What the installer's card says once the job is finished: from the real close out, never a step already done. */
export function jobDoneWords(c: CrewInstall['closeOut'] | null | undefined): string {
  if (!c) return 'Job finished.'
  if (c.closed) return 'Job finished and closed out.'
  if (!c.walkthroughSigned && !c.paidInFull) return 'Job finished. Waiting for the final walkthrough and the final payment; then it closes by itself.'
  if (!c.walkthroughSigned) return 'Job finished. Waiting for the final walkthrough to be signed.'
  if (!c.paidInFull) return 'Job finished. Waiting for the final payment.'
  return 'Job finished.'
}

