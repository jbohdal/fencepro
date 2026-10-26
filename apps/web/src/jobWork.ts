/**
 * A job's size as its lists show it: the sections of a new fence, the repair
 * work of a repair (from the job's quote, which keeps the work), never
 * "Sections 0" (round 2 review, Oct 26 2026). moveRepair.ts sectionsCell.
 */

import { getQuoteById } from './quoteStore'
import { sectionsCell, sizeText } from './moveRepair'

const workOf = (job: { quoteId?: string | null }) => (job.quoteId ? getQuoteById(job.quoteId)?.work ?? null : null)

/** Where a list has a "Sections" column: "16", or "Repair: 2 × Replace a post". */
export const jobSectionsCell = (job: { sections?: number | null; quoteId?: string | null }) => sectionsCell(job.sections, workOf(job))

/** In a sentence: "16 sections", or the repair work. */
export const jobSizeText = (job: { sections?: number | null; quoteId?: string | null }) => sizeText(job.sections, workOf(job))
