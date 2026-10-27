/**
 * The customer portal's My Projects steps (CustomerPortalApp.tsx), kept apart
 * so they are tested on their own (portal tests/portalSteps.test.ts).
 */

import type { PortalProject } from './portalApiClient'

/** The fence is in: completed, invoiced or paid. */
export const FINISHED_STATUSES = ['completed', 'invoiced', 'paid']

/**
 * The project's steps, each done only when it is: the permit, 811 and
 * materials as recorded on the job (never ticked because of the job's status),
 * the rest by the job's status. Once the fence is in, a step before the
 * install that was never recorded is left off rather than shown waiting.
 */
export function projectSteps(j: Pick<PortalProject, 'status' | 'scheduledDate' | 'steps'>): Array<{ label: string; done: boolean; current: boolean }> {
  const at = mapStatusToMilestone(j.status)
  const st = j.steps
  const finished = at >= 6
  const all: Array<{ label: string; done: boolean }> = [
    { label: 'Quote Accepted', done: true },
    { label: 'Locates Marked (811)', done: st ? st.locates : at > 1 },
    ...(st?.permit === 'not_needed' ? [] : [{ label: 'Permit Approved', done: st ? st.permit === 'done' : at > 2 }]),
    { label: 'Materials Ordered', done: st ? st.materials : at > 3 },
  ]
  const before = finished ? all.filter(s => s.done) : all
  // Scheduled only when an install date was set; a finished job never given one leaves the step off.
  const scheduled = { label: 'Installation Scheduled', done: (at >= 4 && !!j.scheduledDate) || (at === 5) }
  const after = [...(finished && !j.scheduledDate ? [] : [scheduled]), { label: 'Installation Complete', done: at >= 6 }, { label: 'Invoice Sent', done: at >= 7 }, { label: 'Complete', done: at >= 8 }]
  const steps = [...before, ...after]
  // The current step: the first one not done.
  const cur = steps.findIndex(s => !s.done)
  return steps.map((s, i) => ({ ...s, current: i === cur }))
}

export function mapStatusToMilestone(status: string | undefined): number {
  switch (status) {
    case 'staging': return 2
    case 'scheduled': return 4
    case 'in_progress': return 5
    case 'completed': return 6
    case 'invoiced': return 7
    case 'paid': return 8
    default: return 1
  }
}
