/**
 * A job's size as its lists show it: the sections of a new fence, the repair
 * work of a repair (from the job's quote, which keeps the work), never
 * "Sections 0" (round 2 review, Oct 26 2026). moveRepair.ts sectionsCell.
 */

import { getQuoteById } from './quoteStore'
import { sectionsCell, sizeText, workSummary, installWord } from './moveRepair'
import { styleLabel } from './fenceCatalog'

const workOf = (job: { quoteId?: string | null }) => (job.quoteId ? getQuoteById(job.quoteId)?.work ?? null : null)

/** Where a list has a "Sections" column: "16", or "Repair: 2 × Replace a post". */
export const jobSectionsCell = (job: { sections?: number | null; quoteId?: string | null }) => sectionsCell(job.sections, workOf(job))

/** In a sentence: "16 sections", or the repair work. */
export const jobSizeText = (job: { sections?: number | null; quoteId?: string | null }) => sizeText(job.sections, workOf(job))

/**
 * What a card or list line calls the work: a repair's or a move's work
 * ("Repair: 1 × Rehang a gate with new hardware"), else the fence style
 * (re-check, Oct 26 2026: repair cards and their Payments showed the style).
 */
export const styleOrWork = (fenceStyle: string | null | undefined, work: Parameters<typeof workSummary>[0]) => workSummary(work) ?? styleLabel(fenceStyle || '')

/** The same for a job or a card, from its quote. */
export const jobStyleOrWork = (job: { fenceStyle?: string | null; quoteId?: string | null }) => styleOrWork(job.fenceStyle, workOf(job))

/** A repair job (its quote's work): Advance passes over Need Drawing, and the office's and crew's words say Repair. */
export const isRepairJob = (job: { quoteId?: string | null } | null | undefined) => !!job && installWord(workOf(job)) === 'Repair'

/** "Install" or "Repair": what the job page, the packet and Schedule call the job's work (workWords.ts installWord). */
export const jobInstallWord = (job: { quoteId?: string | null } | null | undefined) => (job ? installWord(workOf(job)) : 'Install')
