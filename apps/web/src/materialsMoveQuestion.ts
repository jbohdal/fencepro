/**
 * Moving a job into Materials Ordered or Ready to Pull records its materials
 * (opsStageModel fieldsForStage: Ordered, Received). Round 2 review, Oct 28
 * 2026: from Materials Ordered, "Advance to Ready to Pull" marked materials
 * Received that were never ordered, in one tap. Every hand move (Advance, the
 * card's Move to, the stage buttons, a drag, a bulk move) now asks first when
 * the move would record more than the job's materials say, and says where the
 * real record comes from (the Sales Order). A job whose materials already say
 * so is moved without a question. The job's Sales Order is marked the same
 * by the server (portal lib/materialsFromOrders.ts ordersFollowJobMaterials,
 * audit #54). No imports: the portal tests use it too.
 */

const SAID: Record<string, string> = { not_ordered: 'not ordered yet', ordered: 'ordered, not received yet' }

/** The question to ask before moving `job` into `stageId`, or null when the move records nothing new. */
export function materialsMoveQuestion(stageId: string, stageName: string, job: { materialsStatus?: string | null; customerName?: string | null }): string | null {
  const m = job.materialsStatus || 'not_ordered'
  const who = job.customerName ? `${job.customerName}'s` : "This job's"
  if (stageId === 'ready_to_pull' && (m === 'not_ordered' || m === 'ordered')) {
    return `${who} materials are ${SAID[m]}. Moving it to ${stageName} records them as Received, and its Sales Order (Inventory > Sales Orders) as Received too.\n\nOnly do this if the materials really are in. Marking its Sales Order Received records it and moves the job by itself.\n\nMark the materials Received and move it?`
  }
  if (stageId === 'materials_ordered' && m === 'not_ordered') {
    return `${who} materials are not ordered yet. Moving it to ${stageName} records them as Ordered, and its Sales Order (Inventory > Sales Orders) as Ordered too.\n\nMarking its Sales Order Ordered records it, and moves a drawn job here by itself.\n\nMark the materials Ordered and move it?`
  }
  return null
}

/** One question for a bulk move: how many of the jobs it would record materials for, or null for none. */
export function bulkMaterialsMoveQuestion(stageId: string, stageName: string, jobs: Array<{ materialsStatus?: string | null }>): string | null {
  const n = jobs.filter(j => materialsMoveQuestion(stageId, stageName, { materialsStatus: j.materialsStatus }) !== null).length
  if (!n) return null
  const what = stageId === 'ready_to_pull' ? 'Received' : 'Ordered'
  return `${n} of the ${jobs.length} selected job${jobs.length === 1 ? '' : 's'} do not have materials ${what.toLowerCase()} yet. Moving them to ${stageName} records their materials as ${what}, and their Sales Orders too.\n\nMove them and mark the materials ${what}?`
}
