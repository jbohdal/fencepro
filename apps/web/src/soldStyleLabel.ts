/**
 * A sold fence's name on staff screens. Kept out of fenceCatalog.ts: that file is in the pricing module the
 * server's scripts load from source (tsx), where a web file importing a portal file breaks (Oct 27 2026: the
 * signed contracts backfill failed with "does not provide an export named customerFenceName").
 */

import { customerFenceName, soldRailsOf } from '../../portal/src/server/lib/customerFenceName'
import { styleLabel } from './fenceCatalog'

/**
 * A sold fence's plain name on a staff screen (a job, or a sold or signed quote): a best price fence says the
 * panels its runs used, as the customer reads it ("8 ft panels", "6 ft and 8 ft panels"), not the builder's
 * "6 or 8 ft panels (best price)" tag (lib/customerFenceName.ts). `quote`: the job's quote, for the runs' picks;
 * without it the name reads "6 ft or 8 ft panels". An unsold draft keeps styleLabel. Only the words shown change.
 */
export function soldStyleLabel(name: string | null | undefined, quote?: { fenceStyle?: string | null; runRails?: unknown; proposal?: unknown } | null): string {
  const label = styleLabel(name)
  return label ? customerFenceName(label, soldRailsOf(quote, String(name ?? ''))) : label
}
