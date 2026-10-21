/**
 * Read-only check of the one-time steps for Pipeline Stages, Lead Sources and
 * Customer Tags (migration:pipeline-stages-one-list-2026-10,
 * migration:option-lists-2026-10). Run it before a deploy (what the steps will
 * write) and after (the lists they wrote): the record counts and the cards'
 * fingerprint must be the same both times.
 *
 *   cd apps/portal && npx tsx scripts/lists-dry-run.ts --db ezbiz_dev
 *   cd apps/portal && npx tsx scripts/lists-dry-run.ts --db ezbiz     # live, read only
 *
 * It only reads: every query goes through psql with
 * PGOPTIONS='-c default_transaction_read_only=on', so the database refuses
 * any write. It writes nothing anywhere and prints counts only (no names,
 * phones or emails).
 *
 * Prints, per company:
 *   - cards per stage (board and archived), and a fingerprint of all cards
 *   - CardFollowUp rows per stage, follow up steps per stage, sales stage
 *     rules and sales automations, by the stage they name
 *   - stage words on records that are not in the list (expected: 0)
 *   - the stage list (planned or saved)
 *   - lead sources and tags: per table, per word and per option, the case
 *     links and merges, the hidden options, and words no option matches
 */

import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import { stagesFromOldLists, normalizeStages, stageIdsInSalesRule, GROUP_LABEL, type PipelineStageDef } from '../src/server/lib/pipelineStageModel.js'
import { optionsFromOld, normalizeOptions, optionFor, START_MERGES, type OptionListKind, type OptionDef } from '../src/server/lib/optionListModel.js'

const argv = process.argv.slice(2)
const db = argv[argv.indexOf('--db') + 1]
if (!argv.includes('--db') || !db || !/^ezbiz(_dev)?$/.test(db)) { console.error('Usage: lists-dry-run.ts --db ezbiz_dev|ezbiz'); process.exit(2) }

function q<T = any>(sql: string): T {
  const out = execFileSync('psql', ['-X', '-q', '-d', db, '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], {
    env: { ...process.env, PGOPTIONS: '-c default_transaction_read_only=on' }, maxBuffer: 512 * 1024 * 1024, encoding: 'utf8',
  }).trim()
  return (out ? JSON.parse(out) : null) as T
}
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`
const has = (table: string, column: string) => !!q<boolean>(`select to_json(exists(select 1 from information_schema.columns where table_schema='public' and table_name=${lit(table)} and column_name=${lit(column)}))`)

const hasArchived = has('PipelineState', 'archivedLeads')
const accounts = q<string[]>(`select coalesce(json_agg("accountId"), '[]') from "BusinessState"`)
const now = new Date()
const line = (s = '') => console.log(s)

line(`Database: ${db} (read only)   ${now.toISOString()}`)
for (const a of accounts) {
  const A = lit(a)
  line(`\n=== Company ${a}`)
  const p = q<any>(`select json_build_object('stages', stages, 'leads', leads, 'archived', ${hasArchived ? '"archivedLeads"' : `'[]'::jsonb`}, 'version', version) from "PipelineState" where "accountId"=${A}`) ?? { stages: [], leads: [], archived: [], version: 0 }
  const cfg = q<any>(`select config from "BusinessState" where "accountId"=${A}`) ?? {}
  const kv = q<Record<string, any>>(`select coalesce(json_object_agg(key, value), '{}') from "AccountKeyValue" where "accountId"=${A} and key in ('fencepro_pipeline_stages','fencepro_lead_sources','fencepro_customer_tags','migration:pipeline-stages-one-list-2026-10','migration:option-lists-2026-10')`)
  const leads: any[] = p.leads ?? [], archived: any[] = p.archived ?? []
  const cards = [...leads, ...archived]
  const hash = (v: unknown) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16)

  // ── Stages ──
  const words = new Set<string>(cards.map(l => l?.stage).filter(Boolean))
  const settingsList = Array.isArray(cfg.pipelineStages) ? cfg.pipelineStages : null
  const boardList = Array.isArray(p.stages) ? p.stages : null
  const savedList = Array.isArray(kv['fencepro_pipeline_stages']) && kv['fencepro_pipeline_stages'].every((x: any) => Array.isArray(x?.roles))
  let stages: PipelineStageDef[]
  if (savedList) { stages = normalizeStages(kv['fencepro_pipeline_stages']); line('Stage list: saved (the one-time step has run)') }
  else {
    const made = stagesFromOldLists(settingsList?.length ? settingsList : boardList?.length ? boardList : null, words)
    stages = made.stages
    line(`Stage list: PLANNED from ${settingsList?.length ? 'Settings > Pipeline Stages' : boardList?.length ? 'the board' : 'the start list'}; kept from old lists: ${made.added.join(', ') || 'none'}; hidden start stages: ${made.hiddenStart.join(', ') || 'none'}; hidden from cards only: ${made.fromCards.join(', ') || 'none'}`)
  }
  line(`Migration rows: stages ${kv['migration:pipeline-stages-one-list-2026-10'] ? 'done' : 'not yet'}, option lists ${kv['migration:option-lists-2026-10'] ? 'done' : 'not yet'}`)
  for (const s of stages) line(`  ${s.hidden ? '(hidden) ' : ''}${s.id}  name="${s.name}"  ${GROUP_LABEL[s.group]}${s.roles.length ? '  roles: ' + s.roles.join(',') : ''}${s.finished ? '  finished' : ''}${s.needsFollowUp ? '  needs follow up' : ''}${s.group === 'selling' ? `  ${s.chancePct}%` : ''}  ${s.color}`)

  const per = new Map<string, { board: number; archived: number }>()
  for (const l of leads) { const k = l?.stage ?? '(none)'; const c = per.get(k) ?? { board: 0, archived: 0 }; c.board++; per.set(k, c) }
  for (const l of archived) { const k = l?.stage ?? '(none)'; const c = per.get(k) ?? { board: 0, archived: 0 }; c.archived++; per.set(k, c) }
  line(`Cards: ${leads.length} on the board, ${archived.length} archived${hasArchived ? '' : ' (no archived column yet)'}; pipeline version ${p.version}`)
  for (const [k, c] of [...per].sort((x, y) => y[1].board - x[1].board)) line(`  ${k}: ${c.board}${c.archived ? ` (+${c.archived} archived)` : ''}`)
  line(`Cards fingerprint (sha256 of leads + archived): ${hash([leads, archived])}`)

  const cfu = q<Array<{ stage: string; n: number }>>(`select coalesce(json_agg(x), '[]') from (select stage, count(*)::int n from "CardFollowUp" where "accountId"=${A} group by 1 order by 2 desc) x`)
  const fus = q<any>(`select steps from "FollowUpSettings" where "accountId"=${A}`)
  const sr = q<Array<{ stage: string; n: number }>>(`select coalesce(json_agg(x), '[]') from (select stage, count(*)::int n from "StageRule" where "accountId"=${A} and board='sales' group by 1) x`)
  const rules = q<any[]>(`select coalesce(json_agg(json_build_object('board', board, 'trigger', trigger, 'conditions', conditions, 'steps', steps)), '[]') from "AutomationRule" where "accountId"=${A} and board='sales'`)
  line(`CardFollowUp: ${cfu.reduce((t, r) => t + r.n, 0)} (${cfu.map(r => `${r.stage} ${r.n}`).join(', ') || 'none'})`)
  line(`Follow up steps saved for: ${fus ? Object.keys(fus).map(k => `${k} (${(fus[k] ?? []).length})`).join(', ') || 'none' : 'nothing saved (the defaults)'}`)
  line(`Sales stage rules: ${sr.reduce((t, r) => t + r.n, 0)} (${sr.map(r => r.stage).join(', ') || 'none'})`)
  const ruleIds = rules.flatMap(r => stageIdsInSalesRule(r))
  line(`Sales automations: ${rules.length}; stages they name: ${[...new Set(ruleIds)].join(', ') || 'none'}`)
  const known = new Set(stages.map(s => s.id))
  const unknown = new Set<string>([...words, ...cfu.map(r => r.stage), ...sr.map(r => r.stage), ...ruleIds, ...(fus ? Object.keys(fus) : [])].filter(w => !known.has(w)))
  line(`Stage words not in the list: ${unknown.size}${unknown.size ? ' -> ' + [...unknown].join(', ') : ''}`)

  // ── Lead sources and tags ──
  const since = new Date(now.getTime() - 365 * 86_400_000).toISOString()
  for (const kind of ['leadSources', 'customerTags'] as OptionListKind[]) {
    const tables: Record<string, Map<string, number>> = {}
    const recent = new Set<string>()
    const add = (t: string, w: unknown) => { if (typeof w !== 'string' || !w.trim()) { tables[t] ??= new Map(); tables[t].set('(empty)', (tables[t].get('(empty)') ?? 0) + 1); return } (tables[t] ??= new Map()).set(w, (tables[t].get(w) ?? 0) + 1) }
    if (kind === 'leadSources') {
      for (const r of q<any[]>(`select coalesce(json_agg(json_build_object('w', "leadSource", 'n', n, 'recent', recent)), '[]') from (select "leadSource", count(*)::int n, bool_or("createdAt" >= ${lit(since)}) recent from "CrmContact" where "accountId"=${A} group by 1) x`)) { for (let i = 0; i < r.n; i++) add('customers', r.w); if (r.recent && r.w) recent.add(r.w) }
      for (const r of q<any[]>(`select coalesce(json_agg(json_build_object('w', "leadSource", 'n', n)), '[]') from (select "leadSource", count(*)::int n from "SavedQuote" where "accountId"=${A} group by 1) x`)) for (let i = 0; i < r.n; i++) add('quotes', r.w)
      for (const r of q<any[]>(`select coalesce(json_agg(json_build_object('w', "leadSource", 'n', n)), '[]') from (select "leadSource", count(*)::int n from "SavedJob" where "accountId"=${A} group by 1) x`)) for (let i = 0; i < r.n; i++) add('jobs', r.w)
      for (const l of cards) add('cards', l?.leadSource)
    } else {
      for (const r of q<any[]>(`select coalesce(json_agg(json_build_object('w', t, 'n', n, 'recent', recent)), '[]') from (select t, count(*)::int n, bool_or(c."createdAt" >= ${lit(since)}) recent from "CrmContact" c, jsonb_array_elements_text(case when jsonb_typeof(c.tags::jsonb)='array' then c.tags::jsonb else '[]'::jsonb end) t where c."accountId"=${A} group by 1) x`)) { for (let i = 0; i < r.n; i++) add('customers', r.w); if (r.recent) recent.add(r.w) }
      for (const l of cards) for (const t of Array.isArray(l?.tags) ? l.tags : []) add('cards', t)
    }
    const all = new Map<string, number>()
    for (const m of Object.values(tables)) for (const [w, n] of m) if (w !== '(empty)') all.set(w, (all.get(w) ?? 0) + n)
    const key = kind === 'leadSources' ? 'fencepro_lead_sources' : 'fencepro_customer_tags'
    let options: OptionDef[]
    line(`\n${kind === 'leadSources' ? 'Lead sources' : 'Customer tags'}:`)
    if (Array.isArray(kv[key])) { options = normalizeOptions(kv[key], kind); line('  List: saved (the one-time step has run)') }
    else {
      const made = optionsFromOld(kind, cfg[kind], [...all].map(([word, count]) => ({ word, count, recentCustomer: recent.has(word) })), START_MERGES[kind], now.toISOString())
      options = made.options
      line(`  List: PLANNED. Settings words: ${(cfg[kind] ?? []).join(', ') || 'none'}`)
      line(`  Linked (capital letters): ${made.caseLinks.map(c => `${c.word} -> ${c.into}`).join(', ') || 'none'}`)
      line(`  Merged: ${made.merged.map(m => `${m.from} -> ${m.into}`).join(', ') || 'none'}`)
      line(`  Hidden (no customer in the last 12 months): ${made.hidden.join(', ') || 'none'}`)
    }
    for (const o of options) line(`    ${o.hidden ? '(hidden) ' : ''}${o.builtIn ? '[built in] ' : ''}${o.id}${o.name !== o.id ? ` name="${o.name}"` : ''}${o.alsoMatches.length ? '  also: ' + o.alsoMatches.map(l => `${l.word} (${l.kind})`).join(', ') : ''}`)
    for (const [t, m] of Object.entries(tables)) {
      const total = [...m.values()].reduce((s, n) => s + n, 0)
      line(`  ${t}: ${total} records; ${[...m].sort((x, y) => y[1] - x[1]).map(([w, n]) => `${w} ${n}`).join(', ')}`)
      const byOpt = new Map<string, number>()
      for (const [w, n] of m) { if (w === '(empty)') continue; const o = optionFor(options, w); const k = o ? o.name : `NOT MATCHED: ${w}`; byOpt.set(k, (byOpt.get(k) ?? 0) + n) }
      line(`    by option: ${[...byOpt].sort((x, y) => y[1] - x[1]).map(([w, n]) => `${w} ${n}`).join(', ')}`)
    }
    const unmatched = [...all.keys()].filter(w => !optionFor(options, w))
    line(`  Words on records no option matches: ${unmatched.length}${unmatched.length ? ' -> ' + unmatched.join(', ') : ''}`)
  }
}
