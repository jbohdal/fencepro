/**
 * The Salesman's Schedule (Jonathan, Oct 29 2026, D5): "Hide deposit amounts,
 * prices and other customers' phone numbers from Christa's Schedule. She only
 * needs names, addresses and dates."
 *
 * The Schedule stays company wide (Oct 28: "Leave the schedule ... company
 * wide for now"), so the Salesman still sees every install: its customer's
 * name, the address, the dates, the crew, the style, footage and crew days,
 * the stage, permit, 811 and materials. For an install that is not the
 * Salesman's (lib/salesScope.ts), every answer of /api/schedule leaves out:
 *
 *   - money: the board entry's job price, the Ready list's deposit, deposit
 *     paid and whether it is paid (any field costRedact's isPriceKey names);
 *   - the customer's phone and email (any field named phone or email);
 *   - the board entry's notes (free text, which can hold a number or an amount);
 *   - a rain day's prepared text (it is addressed to the customer's phone).
 *
 * The Salesman's own installs (her job, or the customer's phone when the
 * customer is hers) are unchanged. Every other login is unchanged; the
 * Installer still gets no price at all (costRedact.ts).
 *
 * Saving: the Salesman never saves the Schedule. Every write to it (the board,
 * its entries, a booking, a rain day, the rain log) is refused (403) before the
 * body is read, so nothing her phone holds can replace what the office saved
 * (salesmanNeverSavesSchedule below; the permission table already refuses her
 * schedule.change, this keeps it so if that table changes).
 */

import type { SalesScope } from './salesScope.js'
import { isPriceKey, isNoteKey } from './costRedact.js'

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)

/** A customer's phone or email, by field name (phone, customerPhone, email, ...). */
export const isContactKey = (k: string): boolean => /phone|email/i.test(k)

/** Is this install the Salesman's (its job is in the scope)? */
export function installIsHers(s: SalesScope, jobId: unknown): boolean {
  const id = str(jobId)
  return !!id && s.jobIds.has(id)
}

/** May the Salesman have this customer's phone (the job is hers, or the customer is)? */
function contactIsHers(s: SalesScope, jobId: unknown, contactId: unknown): boolean {
  const c = str(contactId)
  return installIsHers(s, jobId) || (!!c && s.contactIds.has(c))
}

/** One entry without money and notes, and without phone and email unless `keepContact`. */
function stripped(e: Record<string, unknown>, keepContact: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(e)) {
    if (isPriceKey(k) || isNoteKey(k)) continue
    if (!keepContact && isContactKey(k)) continue
    out[k] = v
  }
  return out
}

/** A board entry (ScheduledGridJob: stagingJobId, clientName, area, date, jobPrice, notes ...). */
const isBoardEntry = (o: Record<string, unknown>) => 'stagingJobId' in o && 'clientName' in o
/** A Ready to schedule row, or one job's install facts (lib/installScheduling.ts ReadyJob). */
const isReadyRow = (o: Record<string, unknown>) => 'bookedDays' in o && 'customerName' in o
/** A rain day's move (lib/installScheduling.ts RainMove): its text goes to the customer's phone. */
const isRainMove = (o: Record<string, unknown>) => 'startFrom' in o && 'startTo' in o && 'text' in o

/**
 * An answer of /api/schedule as the Salesman receives it (a copy; the input is
 * not changed). Walks the whole answer, so a refusal's or a 409's copy of the
 * board is covered the same way.
 */
export function salesScheduleView<T>(s: SalesScope, body: T): T {
  return walk(s, body) as T
}

function walk(s: SalesScope, v: unknown): unknown {
  if (v instanceof Date) return v
  if (Array.isArray(v)) return v.map(x => walk(s, x))
  if (!isObj(v)) return v
  if (isBoardEntry(v) && !installIsHers(s, v.stagingJobId)) return stripped(v, false)
  if (isReadyRow(v) && !installIsHers(s, v.id)) return stripped(v, contactIsHers(s, v.id, v.crmContactId))
  if (isRainMove(v) && !installIsHers(s, v.jobId)) return { ...v, text: null }
  const out: Record<string, unknown> = {}
  for (const [k, x] of Object.entries(v)) out[k] = walk(s, x)
  return out
}

/** The Schedule's reads that are not saves (a rain day worked out, nothing saved). */
const READS_BY_POST = new Set(['/rain-day/preview'])

/** Does this request save something on the Schedule? */
export function savesSchedule(method: string, path: string): boolean {
  const m = method.toUpperCase()
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return false
  return !READS_BY_POST.has(path.replace(/\/+$/, ''))
}
