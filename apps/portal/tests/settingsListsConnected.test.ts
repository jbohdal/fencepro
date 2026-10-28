/**
 * "Settings lists connected": every list that Settings owns has one source,
 * and no screen keeps its own copy. Jonathan's name for this check (Oct 23,
 * 2026): when a list is changed in Settings, every screen shows the change,
 * because no screen has a list of its own to drift from it.
 *
 * The lists, their one source, and where they are changed are in LISTS below
 * (and in docs/FEATURES.md, "Settings lists connected"). For each list:
 *
 *   (a) no copies: the list's words (its start names, ids, or old built-in
 *       names) do not appear as quoted strings in the app's code, comments
 *       aside, outside the few files that may hold the defaults (`owners`).
 *       A file with `minHits` or more of a list's words is a copy. Known
 *       other uses are listed in `allowed` with why.
 *   (b) connected: each screen that shows the list imports its one store, and
 *       the default constants are imported only by the model, the store and
 *       the seed (never by a screen as its list).
 *
 * The booking team ("With" on appointments) is the company's active logins
 * (Settings > Team); its behaviour on the server is checked on the dev
 * database in bookingTeam.db.test.ts.
 *
 * To add a list Settings owns: add it to LISTS and to docs/FEATURES.md.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { START_IDS } from '../../web/src/pipelineStageModel'
import { START_OPS_STAGES } from '../../web/src/opsStageModel'
import { BUILT_IN_OPTIONS } from '../../web/src/optionListModel'
import { DEFAULT_CONFIG, DEFAULT_FENCE_STYLES as START_STYLES } from '../../web/src/configDefaults'
import { withoutComments } from './fixtures/sourceScan'

const here = path.dirname(fileURLToPath(import.meta.url))
const APPS = path.resolve(here, '../..')
const ROOTS = ['web/src', 'portal/src'].map(r => path.join(APPS, r))

export interface ListSpec {
  /** As Settings names it. */
  name: string
  /** Where it is changed. */
  settings: string
  /** The one store every screen reads (apps/web/src). */
  source: string
  /** Words that make a copy of the list. */
  words: string[]
  /** How many of them in one file make it a copy. */
  minHits: number
  /** Files (from apps/) that may hold the words: the model, the store, the seed and defaults. */
  owners: string[]
  /** Other files that hold some of the words, with why (from apps/). */
  allowed?: Record<string, string>
  /** Default constants only `owners` (and `defaultUsers`) may import. */
  defaults?: string[]
  /** Files besides `owners` that may import the default constants, with why. */
  defaultUsers?: Record<string, string>
  /** Screens that show the list: each imports `source`. */
  screens: string[]
  /** 'screens': only the app's screens (.tsx) are scanned for copies (see Fence Styles). Default: all code. */
  scope?: 'screens'
  /** Code that reads a copy Settings no longer owns (fails anywhere outside owners). */
  forbidden?: Array<[RegExp, string]>
}

const pipelineNames = Object.values(START_IDS)
/** The old Settings lists (configDefaults.ts): the words the lead source and tag lists started from. */
const DEFAULT_CONFIG_LEAD_SOURCES = DEFAULT_CONFIG.leadSources ?? []
const DEFAULT_CONFIG_CUSTOMER_TAGS = DEFAULT_CONFIG.customerTags ?? []
const DEFAULT_FENCE_STYLES = START_STYLES.map(s => s.name)
const opsWords = START_OPS_STAGES.flatMap(s => [s.name, s.id])
  // Ids that are also job statuses or phases are everyday words in the jobs code; the names stay.
  .filter(w => !['scheduled', 'in_progress', 'completed', 'invoiced', 'paid', 'on_hold', 'Scheduled', 'Paid', 'Invoiced', 'Complete', 'In Progress'].includes(w))

/** The four names the booking list held before Oct 23, 2026 (appointmentLogic.ts DEFAULT_APPOINTMENT_SETTINGS.team). */
export const OLD_BOOKING_NAMES = ['Jonathan Bohdal', 'Alexander Bohdal', 'Stacy Mcgovern', 'Christopher Lindsey']

export const LISTS: ListSpec[] = [
  {
    name: 'Pipeline Stages',
    settings: 'Settings > Pipeline Stages',
    source: 'pipelineStagesStore.ts',
    words: pipelineNames,
    minHits: 2,
    owners: ['web/src/pipelineStageModel.ts', 'portal/src/server/lib/pipelineStageModel.ts'],
    defaults: ['START_PIPELINE_STAGES', 'START_IDS'],
    defaultUsers: {
      'web/src/pipelineStagesStore.ts': 'the store: the start list until the server answers',
      'portal/src/server/lib/pipelineStages.ts': 'the server: the start list for a company that has none saved',
      'portal/src/server/lib/automations/types.ts': 'the starter automations point at a start stage by its permanent id (a rename in Settings keeps the id)',
    },
    screens: ['SalesPipelineBoard.tsx', 'PipelineCardWindow.tsx', 'PipelineStagesSettings.tsx', 'AppointmentsPage.tsx', 'CustomersPage.tsx', 'FollowUpsPage.tsx', 'FollowUpSettings.tsx', 'JobsPage.tsx', 'AutomationsPage.tsx'],
  },
  {
    name: 'Operations Stages',
    settings: 'Settings > Operations Stages',
    source: 'opsStagesStore.ts',
    words: opsWords,
    minHits: 3,
    owners: ['web/src/opsStageModel.ts', 'portal/src/server/lib/opsStageModel.ts'],
    allowed: {
      'portal/src/server/lib/waitingStageMove.ts': "Jonathan's move rule (Oct 27 2026) names the built in waiting stages it acts on, like opsStageModel's waitingStageOf; the board's list itself is read from Settings",
    },
    defaults: ['START_OPS_STAGES'],
    defaultUsers: {
      'web/src/opsStagesStore.ts': 'the store: the start list until the server answers',
      'portal/src/server/lib/opsStages.ts': 'the server: the start list for a company that has none saved',
      'portal/src/server/lib/automations/context.ts': 'a sales board rule reads no job stage (an ops rule loads the saved list); also the default for the pure helper',
    },
    screens: ['OperationsBoard.tsx', 'OperationsPage.tsx', 'OperationsStagesSettings.tsx', 'DispatchPage.tsx', 'SmartSchedule.tsx', 'AutomationsPage.tsx', 'CustomersPage.tsx'],
  },
  {
    name: 'Lead Sources',
    settings: 'Settings > Lead Sources',
    source: 'optionListsStore.ts',
    // The old Settings words (configDefaults.ts), "Other" aside (an everyday word).
    words: DEFAULT_CONFIG_LEAD_SOURCES.filter(w => w !== 'Other'),
    minHits: 2,
    owners: ['web/src/configDefaults.ts', 'web/src/optionListModel.ts', 'portal/src/server/lib/optionListModel.ts'],
    allowed: {
      'portal/src/server/lib/mybudgetquoteImport.ts': "MyBudgetQuote's own source words, mapped to ours on import",
    },
    defaults: ['BUILT_IN_OPTIONS', 'START_MERGES'],
    defaultUsers: {
      'web/src/optionListsStore.ts': 'the store: which sources the app sets by itself',
      'portal/src/server/lib/optionLists.ts': 'the server: the one time move from the old Settings lists',
    },
    screens: ['CustomersPage.tsx', 'SalesPipelineBoard.tsx', 'QuoteBuilder.tsx', 'QuotesPage.tsx', 'JobsPage.tsx', 'ReportsPage.tsx', 'OptionListSettings.tsx'],
    forbidden: [[/\b(getConfig\(\)|cfg|config)\??\.leadSources\b/, 'the old Settings copy (config.leadSources) is no longer read: optionListsStore.ts']],
  },
  {
    name: 'Customer Tags',
    settings: 'Settings > Customer Tags',
    source: 'optionListsStore.ts',
    // The old Settings words; Residential and Commercial are also chain link grades (fenceCatalog.ts).
    words: [...DEFAULT_CONFIG_CUSTOMER_TAGS.filter(w => !['Residential', 'Commercial', 'Warranty'].includes(w))],
    minHits: 2,
    owners: ['web/src/configDefaults.ts', 'web/src/optionListModel.ts', 'portal/src/server/lib/optionListModel.ts'],
    defaults: ['BUILT_IN_OPTIONS'],
    defaultUsers: {
      'web/src/optionListsStore.ts': 'the store: the tags the app sets by itself',
      'portal/src/server/lib/optionLists.ts': 'the server: the one time move from the old Settings lists',
    },
    screens: ['CustomersPage.tsx', 'OptionListSettings.tsx'],
    forbidden: [[/\b(getConfig\(\)|cfg|config)\??\.customerTags\b/, 'the old Settings copy (config.customerTags) is no longer read: optionListsStore.ts']],
  },
  {
    name: 'Vinyl Colors (and chain link finishes)',
    settings: 'Settings > Price List > Vinyl Colors (the fence choice tree, config.fenceCatalog)',
    source: 'fenceCatalog.ts',
    words: ['White', 'Tan', 'Galvanized'],
    minHits: 2,
    owners: ['web/src/fenceCatalog.ts', 'web/src/legacyStyles.ts', 'web/src/configDefaults.ts'],
    allowed: {
      'web/src/FenceStylesSettings.tsx': 'placeholder text in the add a choice box (an example, not a list)',
      'web/src/materialCalculator.ts': "8 ft tall vinyl part names ('White' or 'Tan' 8 ft parts): a takeoff rule, not the color list",
      'portal/src/server/lib/estimates.ts': "reads the old style codes (WV, TV, Galv) into words for the website's catalog; a color made in Settings has its own name",
    },
    defaults: ['DEFAULT_CATALOG'],
    defaultUsers: {
      'web/src/estimate.ts': 'the server bundle: the default tree for a company that has none saved',
      'web/src/chainDigSet.ts': 'the chain link dig set seed: adds its choices to the default tree',
    },
    screens: ['StyleChoices.tsx', 'FenceStylesSettings.tsx', 'QuoteBuilder.tsx'],
  },
  {
    name: 'Fence Styles',
    settings: 'Settings > Price List > Fence Styles (config.fenceStyles)',
    source: 'configStore.ts',
    words: DEFAULT_FENCE_STYLES,
    minHits: 3,
    // Pricing, takeoff and seed rules are keyed by a style's permanent internal name ("WV-ND 6'x8' Privacy";
    // ported rules, CLAUDE.md rule 9): they are rules, not lists. A screen that lists styles is a copy.
    scope: 'screens',
    owners: ['web/src/configDefaults.ts', 'web/src/legacyStyles.ts', 'web/src/fenceCatalog.ts'],
    allowed: {
      'web/src/FillInTab.tsx': 'Inventory > Fill in: the styles whose gate parts or parts list came over empty (a to do list for those styles, not a style picker)',
    },
    defaults: ['DEFAULT_FENCE_STYLES'],
    defaultUsers: {
      'web/src/QuotePlan.tsx': "a saved quote's panel width when the caller passes no saved style (the style is found by its internal name); listed as a follow up in docs/FEATURES.md",
    },
    screens: ['QuoteBuilder.tsx', 'FenceStylesSettings.tsx'],
  },
  {
    name: 'Booking team ("With" on appointments)',
    settings: 'Settings > Team (the active staff logins; Settings > Appointments keeps only each person\'s home base, by login)',
    source: 'bookingTeamStore.ts',
    words: OLD_BOOKING_NAMES,
    minHits: 1,
    owners: [],
    screens: ['BookingDialog.tsx', 'AppointmentsPage.tsx', 'TodayScreen.tsx', 'ServiceRequests.tsx', 'AppointmentWidgets.tsx'],
    forbidden: [
      [/\b(settings|getAppointmentSettings\(\)|appointments\??)\.team\b/, 'the old names list (Settings > Appointments > Team) is gone: bookingTeamStore.ts'],
      [/\bdefaultPerson\(/, 'the default person is the owner on the booking team: bookingTeamStore.ts defaultMember()'],
    ],
  },
]

/* ── The scan ────────────────────────────────────────────────────────────── */

function files(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name)
    if (statSync(p).isDirectory()) { if (name !== 'node_modules' && name !== 'dist') out.push(...files(p)); continue }
    if (/\.(ts|tsx|mjs|js)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p)
  }
  return out
}

/** Every quoted string in the code (comments aside), trimmed. */
export function literalsOf(src: string): Set<string> {
  const code = withoutComments(src)
  const out = new Set<string>()
  const re = /(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g
  for (let m = re.exec(code); m; m = re.exec(code)) out.add(m[2].replace(/\\(['"`])/g, '$1').trim())
  return out
}

/** The list's words a file holds as quoted strings. */
export const wordsIn = (src: string, words: string[]) => { const lit = literalsOf(src); return [...new Set(words)].filter(w => lit.has(w)) }

/** Does this file hold a copy of the list? */
export const isCopy = (src: string, list: Pick<ListSpec, 'words' | 'minHits'>) => wordsIn(src, list.words).length >= list.minHits

/** Names a file imports. */
export function importedNames(src: string): Array<{ name: string; from: string }> {
  const out: Array<{ name: string; from: string }> = []
  const re = /import\s+(?:type\s+)?(?:[\w$]+\s*,\s*)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g
  for (let m = re.exec(src); m; m = re.exec(src)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim()
      if (name) out.push({ name, from: m[2] })
    }
  }
  return out
}

const imports = (src: string, file: string) => new RegExp(`from\\s*['"]\\./${file.replace(/\.tsx?$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\.tsx?|\\.js)?['"]`).test(src)

const SOURCES = ROOTS.flatMap(r => files(r)).map(f => ({ rel: path.relative(APPS, f).split(path.sep).join('/'), src: readFileSync(f, 'utf8') }))
const WEB = (name: string) => readFileSync(path.join(APPS, 'web/src', name), 'utf8')

/** Problems with one list, in plain lines (empty when connected). */
export function problemsOf(list: ListSpec, sources: Array<{ rel: string; src: string }>): string[] {
  const out: string[] = []
  const owners = new Set(list.owners)
  for (const { rel, src } of sources) {
    if (owners.has(rel)) continue
    const scanned = list.scope !== 'screens' || rel.endsWith('.tsx')
    if (scanned && !list.allowed?.[rel]) {
      const hits = wordsIn(src, list.words)
      if (hits.length >= list.minHits) out.push(`${rel}: keeps its own copy of ${list.name} (${hits.slice(0, 6).map(h => JSON.stringify(h)).join(', ')}). Read ${list.source} instead.`)
    }
    for (const { name, from } of importedNames(src)) {
      if (!list.defaults?.includes(name) || list.defaultUsers?.[rel]) continue
      out.push(`${rel}: imports ${name} from ${from}, the start list of ${list.name}. A screen reads ${list.source}.`)
    }
    const code = withoutComments(src)
    for (const [re, why] of list.forbidden ?? []) {
      const lines = code.split('\n')
      lines.forEach((line, i) => { if (re.test(line)) out.push(`${rel}:${i + 1}: ${line.trim().slice(0, 120)} (${why})`) })
    }
  }
  return out
}

describe('Settings lists connected', () => {
  test('the scan reads the whole app', () => {
    expect(SOURCES.length).toBeGreaterThan(400)
    for (const l of LISTS) expect(l.words.length, l.name).toBeGreaterThanOrEqual(Math.max(1, l.minHits))
  })

  for (const list of LISTS) {
    test(`${list.name}: no screen keeps its own copy, the start list stays in the model and store`, () => {
      expect(problemsOf(list, SOURCES)).toEqual([])
    })
    test(`${list.name}: every screen that shows it reads ${list.source}`, () => {
      const missing = list.screens.filter(s => !imports(WEB(s), list.source))
      expect(missing).toEqual([])
    })
    test(`${list.name}: every allowed file and owner still exists (the allow-list is kept small and true)`, () => {
      const known = new Set(SOURCES.map(s => s.rel))
      const listed = [...list.owners, ...Object.keys(list.allowed ?? {}), ...Object.keys(list.defaultUsers ?? {})]
      expect(listed.filter(f => !known.has(f))).toEqual([])
    })
  }

  test('the booking team: the store reads the server, the screens offer only its members', () => {
    const store = WEB('bookingTeamStore.ts')
    expect(store).toContain("'/api/appointments/team'")
    expect(literalsOf(store).size).toBeLessThan(10)
    // The With select lists the team (and a former team member's kept name), nothing else.
    const dialog = withoutComments(WEB('BookingDialog.tsx'))
    expect(dialog).toMatch(/team\.map\(m => <option key=\{m\.userId\} value=\{m\.userId\}/)
    expect(dialog).not.toMatch(/useState\(\s*\[/)
    // The appointment settings keep no names list.
    const logic = withoutComments(WEB('appointmentLogic.ts'))
    expect(logic).not.toMatch(/^\s*team\s*:/m)
    expect(logic).toMatch(/homes: Record<string, PersonHome>/)
  })

  test('the check catches a planted copy, and skips the same words in a comment', () => {
    const team = LISTS.find(l => l.source === 'bookingTeamStore.ts')!
    const planted = [{ rel: 'web/src/Planted.tsx', src: "const WITH = ['Jonathan Bohdal', 'Stacy Mcgovern']\nexport default WITH\n" }]
    expect(problemsOf(team, planted)).toEqual([expect.stringContaining('web/src/Planted.tsx: keeps its own copy of Booking team')])
    expect(problemsOf(team, [{ rel: 'web/src/Planted.tsx', src: '// once booked with Stacy Mcgovern\nexport {}\n' }])).toEqual([])
    const old = [{ rel: 'web/src/Planted.tsx', src: 'const names = getAppointmentSettings().team.map(t => t.name)\n' }]
    expect(problemsOf(team, old)[0]).toMatch(/Planted\.tsx:1: .*old names list/)

    const stages = LISTS.find(l => l.name === 'Pipeline Stages')!
    expect(problemsOf(stages, [{ rel: 'web/src/Planted.tsx', src: "const COLS = [\n  'First Contact',\n  'Appointment',\n  'Signed Contract',\n]\n" }])).toHaveLength(1)
    expect(problemsOf(stages, [{ rel: 'web/src/Planted.tsx', src: "import { START_PIPELINE_STAGES } from './pipelineStageModel'\n" }])[0]).toMatch(/imports START_PIPELINE_STAGES/)

    const sources = LISTS.find(l => l.name === 'Lead Sources')!
    expect(problemsOf(sources, [{ rel: 'web/src/Planted.tsx', src: "const SOURCES = ['Google', 'Facebook', 'Referral']\n" }])).toHaveLength(1)
    expect(problemsOf(sources, [{ rel: 'web/src/Planted.tsx', src: 'const s = getConfig().leadSources\n' }])[0]).toMatch(/config\.leadSources/)

    const ops = LISTS.find(l => l.name === 'Operations Stages')!
    expect(problemsOf(ops, [{ rel: 'web/src/Planted.tsx', src: "const LANES = ['Awaiting Locates', 'Permit Pending', 'Need Drawing']\n" }])).toHaveLength(1)
  })
})
