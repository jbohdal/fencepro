/**
 * A fence's name as the customer reads it, from its style code: the plain name with the sections its runs used
 * ("8 ft sections", "6 ft and 8 ft sections"), never the office's "(best price)" tag (Jonathan, Nov 6 2026: never
 * "best price" on anything customers see). With a job, its quote gives the runs' picks (lib/customerFenceName.ts).
 */

import prisma from './prisma.js'
import { plainStyleName } from './estimates.js'
import { customerFenceName, soldRailsOf } from './customerFenceName.js'

type QuoteRails = { fenceStyle?: string | null; runRails?: unknown; proposal?: unknown }

export async function customerStyleName(code: string | null | undefined, quote?: QuoteRails | null): Promise<string> {
  const plain = await plainStyleName(code)
  return plain ? customerFenceName(plain, soldRailsOf(quote ?? null, code)) : plain
}

/** A job's fence as the customer reads it: the runs' picks from the job's quote. */
export async function jobStyleName(job: { fenceStyle?: string | null; quoteId?: string | null } | null | undefined): Promise<string> {
  if (!job?.fenceStyle) return ''
  const quote = job.quoteId
    ? await prisma.savedQuote.findUnique({ where: { id: job.quoteId }, select: { fenceStyle: true, runRails: true, proposal: true } }).catch(() => null)
    : null
  return customerStyleName(job.fenceStyle, quote)
}
