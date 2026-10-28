/**
 * Moving a job into Materials Ordered or Ready to Pull records its materials
 * (opsStageModel fieldsForStage: Ordered, Received). Round 2 review, Oct 28
 * 2026: from Materials Ordered, "Advance to Ready to Pull" marked materials
 * Received that were never ordered, in one tap. Every hand move (Advance, the
 * card's Move to, the stage buttons, a drag, a bulk move) now asks first when
 * the move would record more than the job's materials say, and says where the
 * real record comes from (the Sales Order). A job whose materials already say
 * so is moved without a question. The server marks the job's pending Sales
 * Order Ordered, never Received (portal lib/materialsFromOrders.ts
 * ordersFollowJobMaterials, audit #54): Mark Received in Inventory also
 * updates the stock counts, so the office marks it Received there. No imports:
 * the portal tests use it too.
 */

const SAID: Record<string, string> = { not_ordered: 'not ordered yet', ordered: 'ordered, not received yet' }

/** The question to ask before moving `job` into `stageId`, or null when the move records nothing new. */
export function materialsMoveQuestion(stageId: string, stageName: string, job: { materialsStatus?: string | null; customerName?: string | null }): string | null {
  const m = job.materialsStatus || 'not_ordered'
  const who = job.customerName ? `${job.customerName}'s` : "This job's"
  if (stageId === 'ready_to_pull' && (m === 'not_ordered' || m === 'ordered')) {
    return `${who} materials are ${SAID[m]}. Moving it to ${stageName} records them as Received.\n\nOnly do this if the materials really are in. Its Sales Order (Inventory > Sales Orders) is marked Ordered, not Received: mark it Received there, so the stock counts follow.\n\nMark the materials Received and move it?`
  }
  if (stageId === 'materials_ordered' && m === 'not_ordered') {
    return `${who} materials are not ordered yet. Moving it to ${stageName} records them as Ordered, and its Sales Order (Inventory > Sales Orders) as Ordered too. Mark it Received there when the materials come in.\n\nMark the materials Ordered and move it?`
  }
  return null
}

/** One question for a bulk move: how many of the jobs it would record materials for, or null for none. */
export function bulkMaterialsMoveQuestion(stageId: string, stageName: string, jobs: Array<{ materialsStatus?: string | null }>): string | null {
  const n = jobs.filter(j => materialsMoveQuestion(stageId, stageName, { materialsStatus: j.materialsStatus }) !== null).length
  if (!n) return null
  const what = stageId === 'ready_to_pull' ? 'Received' : 'Ordered'
  return `${n} of the ${jobs.length} selected job${jobs.length === 1 ? '' : 's'} do not have materials ${what.toLowerCase()} yet. Moving them to ${stageName} records their materials as ${what}${what === 'Received' ? '; their Sales Orders are marked Ordered, not Received: mark them Received in Inventory > Sales Orders, so the stock counts follow' : ', and their Sales Orders too'}.\n\nMove them and mark the materials ${what}?`
}

/**
 * The drawing on a hand move. Moving a job on past Need Drawing by hand
 * records its drawing as done (opsStageModel fieldsForStage, Oct 28 2026), so
 * a job with no drawing waits in Need Drawing until the office moves it on.
 * Review Oct 28 2026: Advance on a job that said "Materials in; waits for its
 * drawing" moved it to Ready to Pull with no question. Now a move that would
 * record the drawing done asks first when the job has no drawing on file (not
 * marked drawn, no yard drawn in the quote builder, no drawing from the
 * website: jobDrawing.ts hasDrawing, the server's jobHasDrawing). A repair
 * needs no drawing (Advance passes over Need Drawing for it) and is not asked.
 */
export interface DrawingFacts {
  /** The move sets the drawing done (the fields it saves have drawingComplete: true). */
  recordsDrawing: boolean
  /** The job has its drawing on file. */
  hasDrawing: boolean
  repair: boolean
}

const asksForDrawing = (f: DrawingFacts) => f.recordsDrawing && !f.hasDrawing && !f.repair

function drawingWords(stageName: string, customerName?: string | null): string {
  return `No drawing on file${customerName ? ` for ${customerName}'s job` : ''}. Moving it to ${stageName} records the drawing as done.`
}

/** The question to ask before a hand move that would record the drawing done, or null. */
export function drawingMoveQuestion(stageName: string, job: { customerName?: string | null }, f: DrawingFacts): string | null {
  return asksForDrawing(f) ? `${drawingWords(stageName, job.customerName)}\n\nMove it?` : null
}

/**
 * The one question before a hand move of one job (Advance, a drag, Move to,
 * the stage buttons): the drawing, the materials, or both in one, or null when
 * the move records nothing new.
 */
export function handMoveQuestion(stageId: string, stageName: string, job: { materialsStatus?: string | null; customerName?: string | null }, f: DrawingFacts): string | null {
  const materials = materialsMoveQuestion(stageId, stageName, job)
  if (!asksForDrawing(f)) return materials
  return materials ? `${drawingWords(stageName, job.customerName)}\n\n${materials}` : drawingMoveQuestion(stageName, job, f)
}

/** One question for a bulk move: the drawings and the materials it would record, or null for none. */
export function bulkHandMoveQuestion(stageId: string, stageName: string, jobs: Array<{ materialsStatus?: string | null } & DrawingFacts>): string | null {
  const materials = bulkMaterialsMoveQuestion(stageId, stageName, jobs)
  const n = jobs.filter(asksForDrawing).length
  if (!n) return materials
  const drawings = `${n} of the ${jobs.length} selected job${jobs.length === 1 ? '' : 's'} ha${n === 1 ? 's' : 've'} no drawing on file. Moving them to ${stageName} records their drawings as done.`
  return materials ? `${drawings}\n\n${materials}` : `${drawings}\n\nMove them?`
}
