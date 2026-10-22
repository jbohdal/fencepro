/**
 * Warranty and service requests: the words and the plain rules, no database,
 * so the web app and the server share them (as textConsentModel.ts).
 *
 *   ISSUES        what the customer reports
 *   STAGES        New → Photos requested → Photos received → Scheduled → Fixed → Closed
 *   HINT_RULES    issue → "Likely covered / Likely not covered / Needs a look",
 *                 per kind of warranty (below). A hint only: the owner or the
 *                 office decide covered or not covered, with a reason.
 *   photo link    the text that goes with "Ask for photos", and the link's limits
 *   report        service tickets by month, covered vs not, cost of covered
 *                 work by style and by installer
 */

export const ISSUES = [
  { key: 'leaning_post', label: 'Leaning post' },
  { key: 'damaged_section', label: 'Damaged section' },
  { key: 'gate', label: 'Sagging or broken gate' },
  { key: 'storm_tree', label: 'Storm or tree damage' },
  { key: 'other', label: 'Other' },
] as const
export type Issue = typeof ISSUES[number]['key']
export const ISSUE_KEYS = ISSUES.map(i => i.key) as unknown as readonly [Issue, ...Issue[]]
export const issueLabel = (k: string) => ISSUES.find(i => i.key === k)?.label ?? 'Other'

export const STAGES = [
  { key: 'new', label: 'New', customer: 'Received' },
  { key: 'photos_requested', label: 'Photos requested', customer: 'Waiting for your photos' },
  { key: 'photos_received', label: 'Photos received', customer: 'Photos received, we are taking a look' },
  { key: 'scheduled', label: 'Scheduled', customer: 'Visit scheduled' },
  { key: 'fixed', label: 'Fixed', customer: 'Fixed' },
  { key: 'closed', label: 'Closed', customer: 'Closed' },
] as const
export type Stage = typeof STAGES[number]['key']
export const STAGE_KEYS = STAGES.map(s => s.key) as unknown as readonly [Stage, ...Stage[]]
export const stageLabel = (k: string) => STAGES.find(s => s.key === k)?.label ?? k
export const stageForCustomer = (k: string) => STAGES.find(s => s.key === k)?.customer ?? 'Received'
/** Still being worked (shows in the Service list's open view, Today and Follow ups). */
export const isOpenStage = (k: string) => k !== 'closed'

export type Hint = 'likely_covered' | 'likely_not_covered' | 'needs_look'
export const HINT_LABEL: Record<Hint, string> = { likely_covered: 'Likely covered', likely_not_covered: 'Likely not covered', needs_look: 'Needs a look' }

/**
 * The kind of warranty a job has, for the hints:
 *   lifetime     Lifetime Craftsmanship (vinyl no dig): install failures for as
 *                long as they own the home, high winds included; not trees or
 *                other impact, vehicles, flooding or washouts, changes or
 *                attachments by others, misuse
 *   workmanship  a warranty of years (1 Year Workmanship: dig set and the rest),
 *                still inside its years: defects in workmanship; not impact,
 *                severe weather or misuse
 *   ended        a warranty of years that has run out
 *   none         no warranty on file, or not installed yet, or words that do not say
 */
export type WarrantyKind = 'lifetime' | 'workmanship' | 'ended' | 'none'

export interface HintRule { hint: Hint; why: string }

export const HINT_RULES: Record<WarrantyKind, Record<Issue, HintRule>> = {
  lifetime: {
    leaning_post: { hint: 'likely_covered', why: 'A post that leans is an install failure, and high winds are covered.' },
    damaged_section: { hint: 'needs_look', why: 'Covered if it failed on its own or in high winds; not if a tree, a vehicle or something else hit it, or someone changed it.' },
    gate: { hint: 'needs_look', why: 'A gate that sags from our install is covered; a gate broken by impact, a vehicle or misuse is not.' },
    storm_tree: { hint: 'needs_look', why: 'High winds are covered; falling trees, other impact, flooding and washouts are not. The photos tell which.' },
    other: { hint: 'needs_look', why: 'Covered when the fence failed because of our install; not impact, vehicles, flooding, changes by others or misuse.' },
  },
  workmanship: {
    leaning_post: { hint: 'likely_covered', why: 'A leaning post inside the warranty years is a workmanship defect.' },
    damaged_section: { hint: 'needs_look', why: 'Covered if it is a defect in our workmanship; impact, severe weather and misuse are not covered.' },
    gate: { hint: 'needs_look', why: 'A gate that sags from our workmanship is covered; one broken by impact or misuse is not.' },
    storm_tree: { hint: 'likely_not_covered', why: 'This warranty does not cover severe weather or impact (trees included).' },
    other: { hint: 'needs_look', why: 'Covered only for defects in our workmanship inside the warranty years.' },
  },
  ended: {
    leaning_post: { hint: 'likely_not_covered', why: 'The warranty has ended.' },
    damaged_section: { hint: 'likely_not_covered', why: 'The warranty has ended.' },
    gate: { hint: 'likely_not_covered', why: 'The warranty has ended.' },
    storm_tree: { hint: 'likely_not_covered', why: 'The warranty has ended.' },
    other: { hint: 'likely_not_covered', why: 'The warranty has ended.' },
  },
  none: {
    leaning_post: { hint: 'needs_look', why: 'No warranty on file for this job: check the signed contract.' },
    damaged_section: { hint: 'needs_look', why: 'No warranty on file for this job: check the signed contract.' },
    gate: { hint: 'needs_look', why: 'No warranty on file for this job: check the signed contract.' },
    storm_tree: { hint: 'needs_look', why: 'No warranty on file for this job: check the signed contract.' },
    other: { hint: 'needs_look', why: 'No warranty on file for this job: check the signed contract.' },
  },
}

/** The kind of warranty for the hints. `end`: the last covered day (YYYY-MM-DD) of a warranty of years; `today` YYYY-MM-DD. */
export function warrantyKindOf(w: { term: string; installDate: string | null; end: string | null }, today: string): WarrantyKind {
  if (w.term === 'lifetime') return w.installDate ? 'lifetime' : 'none'
  if (w.term === 'years') {
    if (!w.installDate) return 'none'
    return w.end && today > w.end ? 'ended' : 'workmanship'
  }
  return 'none'
}

/** The hint for an issue, with the ended date in the words when it has one. */
export function hintFor(kind: WarrantyKind, issue: string, endText?: string | null): HintRule {
  const rule = HINT_RULES[kind][(ISSUE_KEYS as readonly string[]).includes(issue) ? issue as Issue : 'other']
  if (kind === 'ended' && endText) return { hint: rule.hint, why: `The warranty ended ${endText}.` }
  return rule
}

/** Every issue's hint for one job: the request form switches as the issue is picked. */
export function hintsFor(kind: WarrantyKind, endText?: string | null): Record<Issue, HintRule> {
  return Object.fromEntries(ISSUES.map(i => [i.key, hintFor(kind, i.key, endText)])) as Record<Issue, HintRule>
}

// ── The photo link ───────────────────────────────────────────────────────────

/** How long a photo link stays open from the last "Ask for photos". */
export const PHOTO_LINK_DAYS = 14
export const PHOTO_MAX_BYTES = 25 * 1024 * 1024
export const VIDEO_MAX_BYTES = 300 * 1024 * 1024
/** Photos and videos one ticket takes from the customer (link and portal together). */
export const MAX_CUSTOMER_FILES = 30
export const PHOTO_TYPES = /^image\/(jpeg|png|webp|heic|heif)$/
export const VIDEO_TYPES = /^video\/(mp4|quicktime|webm|3gpp)$/

/** Why a file is refused, in plain words; null when it may come in. */
export function uploadRefusal(mime: string, bytes: number, already: number): string | null {
  if (already >= MAX_CUSTOMER_FILES) return `We have all the photos we can take on this request (${MAX_CUSTOMER_FILES}). Please call us if there is more to show.`
  if (PHOTO_TYPES.test(mime)) return bytes > PHOTO_MAX_BYTES ? 'That photo is too large (25 MB at most).' : null
  if (VIDEO_TYPES.test(mime)) return bytes > VIDEO_MAX_BYTES ? 'That video is too long. Please send a short one (300 MB at most, about a minute).' : null
  return 'Please send a photo or a video.'
}

/** The text "Ask for photos" opens in the phone's own texting app. */
export function photoRequestText(firstName: string, link: string): string {
  const name = firstName.trim() || 'there'
  return `Getter Done Fence: Hi ${name}, sorry to hear about the issue with your fence. Please send us a few photos here so we can take a look: ${link}. Reply STOP to opt out.`
}

// ── Past customer badge ──────────────────────────────────────────────────────

export interface PastCustomerBadge {
  customerId: string
  jobId: string
  warrantyName: string | null
  /** YYYY-MM-DD, null when the job has no install date recorded. */
  installDate: string | null
  /** Completed jobs this customer has. */
  jobs: number
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "Oct 20, 2026" */
export function shortDay(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : day
}

/** "Past customer · Lifetime Craftsmanship Warranty · installed Oct 20, 2026" */
export function badgeText(b: Pick<PastCustomerBadge, 'warrantyName' | 'installDate'>): string {
  return ['Past customer', b.warrantyName || 'No warranty on file', b.installDate ? `installed ${shortDay(b.installDate)}` : ''].filter(Boolean).join(' · ')
}

// ── Report ───────────────────────────────────────────────────────────────────

export interface ReportTicket {
  id: string
  /** YYYY-MM the ticket was made (Ocala). */
  month: string
  decision: 'covered' | 'not_covered' | null
  stage: string
  fenceStyle: string
  installer: string
  /** Covered work's cost, when it was entered at Fixed. */
  costCents: number | null
  laborCents: number | null
  materialCents: number | null
}

export interface MonthRow { month: string; tickets: number; covered: number; notCovered: number; undecided: number; coveredCostCents: number }
export interface CostRow { key: string; tickets: number; costed: number; costCents: number; laborCents: number; materialCents: number; averageCents: number }

export interface ServiceReport {
  totals: { tickets: number; covered: number; notCovered: number; undecided: number; open: number; coveredCostCents: number; costed: number }
  byMonth: MonthRow[]
  byStyle: CostRow[]
  byInstaller: CostRow[]
}

function costRows(tickets: ReportTicket[], keyOf: (t: ReportTicket) => string): CostRow[] {
  const map = new Map<string, CostRow>()
  for (const t of tickets) {
    const key = keyOf(t) || 'Not recorded'
    const r = map.get(key) ?? { key, tickets: 0, costed: 0, costCents: 0, laborCents: 0, materialCents: 0, averageCents: 0 }
    r.tickets++
    if (t.costCents !== null) {
      r.costed++
      r.costCents += t.costCents
      r.laborCents += t.laborCents ?? 0
      r.materialCents += t.materialCents ?? 0
    }
    map.set(key, r)
  }
  return [...map.values()].map(r => ({ ...r, averageCents: r.costed ? Math.round(r.costCents / r.costed) : 0 }))
    .sort((a, b) => b.costCents - a.costCents || b.tickets - a.tickets || a.key.localeCompare(b.key))
}

/** Tickets by month (newest first), covered vs not; covered work's cost by style and by installer (covered tickets only). */
export function serviceReport(tickets: ReportTicket[]): ServiceReport {
  const months = new Map<string, MonthRow>()
  for (const t of tickets) {
    const r = months.get(t.month) ?? { month: t.month, tickets: 0, covered: 0, notCovered: 0, undecided: 0, coveredCostCents: 0 }
    r.tickets++
    if (t.decision === 'covered') { r.covered++; r.coveredCostCents += t.costCents ?? 0 } else if (t.decision === 'not_covered') r.notCovered++
    else r.undecided++
    months.set(t.month, r)
  }
  const covered = tickets.filter(t => t.decision === 'covered')
  return {
    totals: {
      tickets: tickets.length,
      covered: covered.length,
      notCovered: tickets.filter(t => t.decision === 'not_covered').length,
      undecided: tickets.filter(t => !t.decision).length,
      open: tickets.filter(t => isOpenStage(t.stage)).length,
      coveredCostCents: covered.reduce((s, t) => s + (t.costCents ?? 0), 0),
      costed: covered.filter(t => t.costCents !== null).length,
    },
    byMonth: [...months.values()].sort((a, b) => b.month.localeCompare(a.month)),
    byStyle: costRows(covered, t => t.fenceStyle),
    byInstaller: costRows(covered, t => t.installer),
  }
}
