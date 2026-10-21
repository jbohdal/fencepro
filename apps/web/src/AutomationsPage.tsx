/**
 * Automations: rules Jonathan builds as WHEN (a trigger) + IF (optional
 * conditions) + THEN (steps, with waits between them), stage rules (what a
 * card needs before it can enter a stage), what needs attention (failed runs,
 * with Run again), and the switches for push to this phone and for Gmail.
 *
 * Everything is kept on the server (/api/automations); runs happen there from
 * a durable queue, not in this browser. Phone first; comfortable on desktop.
 */

import { usePipelineStages, stageName } from './pipelineStagesStore'
import { pickableStages as pickablePipelineStages } from './pipelineStageModel'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, EVENT_LABEL, FIELD_LABEL, minutesText, STEP_LABEL, triggerText, type Board, type Condition, type DryRun, type Meta, type Rule, type Run, type StageRule, type Step, type Trigger } from './automationsApi'
import { RunCard } from './AutomationRunLog'
import { pushState, turnOffPush, turnOnPush, type PushState } from './pushSubscribe'
import { toast } from './toast'
import { useBackLayer, useNav } from './nav'
import { useOpsStages } from './opsStagesStore'
import { pickableStages, stageById } from './opsStageModel'
import { ArrowDown, ArrowUp, Bell, FlaskConical, Mail, Pencil, Plus, Trash2, X } from 'lucide-react'

const input = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-base sm:text-sm bg-white'
const label = 'block text-xs font-semibold text-gray-700 mb-1'

type Draft = Omit<Rule, 'id'> & { id?: string }

const NEW_STEP: Record<string, () => Step> = {
  create_task: () => ({ type: 'create_task', title: '', description: '', assignTo: '', dueInDays: 0 }),
  notify: () => ({ type: 'notify', title: '', body: '', push: true }),
  email_customer: () => ({ type: 'email_customer', subject: '', body: 'Hi {first name},\n\n' }),
  prepare_text: () => ({ type: 'prepare_text', body: 'Hi {first name}, ', assignTo: '' }),
  move_card: () => ({ type: 'move_card', stage: '' }),
  add_checklist: () => ({ type: 'add_checklist', items: [] }),
  request_signature: () => ({ type: 'request_signature', what: 'walkthrough', via: 'text' }),
  start_walkthrough: () => ({ type: 'start_walkthrough' }),
  final_invoice: () => ({ type: 'final_invoice', dueInDays: 7 }),
  permit_packet: () => ({ type: 'permit_packet', assignTo: '' }),
  wait: () => ({ type: 'wait', minutes: 24 * 60 }),
  webhook: () => ({ type: 'webhook', url: 'https://' }),
}

function Switch({ on, onChange, label: aria, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={aria} disabled={disabled} onClick={() => onChange(!on)}
      className={`relative inline-flex h-8 w-14 shrink-0 items-center rounded-full transition ${on ? 'bg-green-600' : 'bg-gray-300'} disabled:opacity-50`}>
      <span className={`inline-block h-6 w-6 rounded-full bg-white shadow transition ${on ? 'translate-x-7' : 'translate-x-1'}`} />
    </button>
  )
}

export default function AutomationsPage() {
  const nav = useNav()
  const [meta, setMeta] = useState<Meta | null>(null)
  const [rules, setRules] = useState<Rule[] | null>(null)
  const [stageRules, setStageRules] = useState<StageRule[]>([])
  const [failed, setFailed] = useState<Run[]>([])
  const [recent, setRecent] = useState<Run[]>([])
  const [focusRun, setFocusRun] = useState<Run | null>(null)
  const [editing, setEditing] = useState<Draft | null>(null)
  const [testing, setTesting] = useState<Draft | null>(null)
  const [error, setError] = useState('')
  const [push, setPush] = useState<PushState | 'checking'>('checking')
  const runParam = nav.params.get('run')

  const load = useCallback(async () => {
    try {
      const [m, r, s, f, rec] = await Promise.all([
        api<Meta>('GET', '/meta'), api<Rule[]>('GET', '/rules'), api<StageRule[]>('GET', '/stage-rules'),
        api<Run[]>('GET', '/runs?status=failed&limit=20'), api<Run[]>('GET', '/runs?limit=25'),
      ])
      setMeta(m); setRules(r); setStageRules(s); setFailed(f); setRecent(rec); setError('')
    } catch (err) { setError((err as Error).message) }
  }, [])
  useEffect(() => { void load() }, [load])
  useEffect(() => { pushState().then(setPush).catch(() => setPush('unsupported')) }, [])
  useEffect(() => {
    if (!runParam) { setFocusRun(null); return }
    api<Run[]>('GET', `/runs?id=${encodeURIComponent(runParam)}`).then(r => setFocusRun(r[0] ?? null)).catch(() => setFocusRun(null))
  }, [runParam])
  useEffect(() => {
    const g = nav.params.get('gmail')
    if (g === 'connected') toast.success('Gmail connected', nav.params.get('detail') ?? '')
    if (g === 'error') toast.error('Gmail was not connected', nav.params.get('detail') ?? '')
  }, [nav.params])

  // Operations stages come from Settings > Operations Stages (kept current on screen); rules keep the stage id.
  const opsList = useOpsStages()
  const opsLabel = useCallback((k: string) => stageById(opsList, k)?.name ?? meta?.opsStages.find(s => s.key === k)?.label ?? k, [meta, opsList])
  const admin = !!meta?.isAdmin
  // The pickers offer the shown stages in their Settings order.
  const salesList = usePipelineStages()
  const shown = useMemo(() => meta && { ...meta, opsStages: pickableStages(opsList).map(s => ({ key: s.id, label: s.name })), salesStages: pickablePipelineStages(salesList).map(s => ({ key: s.id, label: s.name })) }, [meta, opsList, salesList])

  async function toggle(rule: Rule, enabled: boolean) {
    setRules(rs => rs?.map(r => r.id === rule.id ? { ...r, enabled } : r) ?? null)
    try { await api('PATCH', `/rules/${rule.id}/enabled`, { enabled }); toast.success(enabled ? 'Rule on' : 'Rule paused', rule.name) }
    catch (err) { toast.error('Could not switch it', (err as Error).message); void load() }
  }
  async function remove(rule: Rule) {
    if (!window.confirm(`Delete "${rule.name}"? Runs still waiting for it stop.`)) return
    try { await api('DELETE', `/rules/${rule.id}`); setRules(rs => rs?.filter(r => r.id !== rule.id) ?? null) }
    catch (err) { toast.error('Could not delete it', (err as Error).message) }
  }
  async function pushOn() {
    try { await turnOnPush(); setPush('on'); toast.success('Push is on for this phone'); await api('POST', '/push/test') }
    catch (err) { toast.error('Push is not on', (err as Error).message); setPush(await pushState().catch(() => 'unsupported' as const)) }
  }
  async function pushOff() { await turnOffPush().catch(() => null); setPush(await pushState().catch(() => 'off' as const)) }
  async function connectGmail() {
    try { const { url } = await api<{ url: string }>('GET', `/gmail/connect-url?returnTo=${encodeURIComponent(window.location.origin)}`); window.location.href = url }
    catch (err) { toast.error('Gmail cannot be connected here', (err as Error).message) }
  }
  async function disconnectGmail() {
    if (!window.confirm('Disconnect Gmail? Email steps will fail until it is connected again.')) return
    try { await api('POST', '/gmail/disconnect'); void load() } catch (err) { toast.error('Could not disconnect', (err as Error).message) }
  }

  if (error && !meta) return <div className="max-w-3xl mx-auto bg-white rounded-2xl border border-red-200 p-6 text-red-700" role="alert">{error} <button className="btn btn-secondary btn-sm ml-2" onClick={load}>Try again</button></div>
  if (!meta || !shown || !rules) return <div className="max-w-3xl mx-auto p-6 text-gray-500">Loading automations…</div>

  return (
    <div className="max-w-3xl mx-auto space-y-5 pb-24" data-automations>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Automations</h1>
          <p className="text-sm text-gray-600">When something happens, do the next steps for you. Texts to customers are never sent by themselves: you get them ready to tap.</p>
        </div>
        {admin && <button type="button" className="btn btn-primary shrink-0" onClick={() => setEditing({ name: '', board: 'sales', enabled: false, trigger: { type: 'card_entered', stage: meta.salesStages[0]?.key ?? '', settleMinutes: 2, onlyWhileInStage: true }, conditions: [], steps: [NEW_STEP.create_task()] })} data-new-rule><Plus size={18} aria-hidden="true" />New rule</button>}
      </div>

      {focusRun && (
        <section className="bg-white rounded-2xl border-2 border-[color:var(--color-brand)] px-4 py-2" data-focus-run>
          <ul><RunCard run={focusRun} open onChanged={() => { void load(); api<Run[]>('GET', `/runs?id=${focusRun.id}`).then(r => setFocusRun(r[0] ?? null)) }} /></ul>
        </section>
      )}

      <section className="grid sm:grid-cols-2 gap-3">
        <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-2" data-push-box>
          <p className="flex items-center gap-2 text-sm font-semibold text-gray-900"><Bell size={18} aria-hidden="true" />Push to this phone</p>
          <p className="text-sm text-gray-600">{
            push === 'on' ? 'On. Failed automations and notify steps come here.'
              : push === 'needs-install' ? 'On iPhone: add the app to the home screen (Share, Add to Home Screen), open it from there, then turn push on.'
              : push === 'denied' ? 'Blocked in this phone\'s settings for this app. Allow notifications there, then come back.'
              : push === 'unsupported' ? 'This browser cannot get push. Use Chrome on Android, or the app from the iPhone home screen.'
              : push === 'checking' ? 'Checking…' : 'Off on this phone.'}</p>
          {push === 'on'
            ? <div className="flex gap-2"><button type="button" className="btn btn-secondary btn-sm" onClick={() => api('POST', '/push/test').then(() => toast.success('Test push sent')).catch(err => toast.error('Test push failed', (err as Error).message))}>Send a test</button><button type="button" className="btn btn-quiet btn-sm" onClick={pushOff}>Turn off</button></div>
            : <button type="button" className="btn btn-secondary btn-sm" disabled={push === 'unsupported' || push === 'checking'} onClick={pushOn} data-push-on>Turn on push</button>}
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-2" data-gmail-box>
          <p className="flex items-center gap-2 text-sm font-semibold text-gray-900"><Mail size={18} aria-hidden="true" />Email from Gmail</p>
          <p className="text-sm text-gray-600">{meta.gmail.connected ? `Connected: emails go from ${meta.gmail.email}.` : meta.gmail.configured ? 'Not connected. Email steps fail with "Gmail is not connected" until it is.' : 'Gmail is not connected (Google is not set up in this copy of the app). Email steps fail clearly until it is.'}</p>
          {admin && (meta.gmail.connected
            ? <button type="button" className="btn btn-quiet btn-sm" onClick={disconnectGmail}>Disconnect</button>
            : <button type="button" className="btn btn-secondary btn-sm" disabled={!meta.gmail.configured} onClick={connectGmail}>Connect Gmail</button>)}
        </div>
      </section>

      {failed.length > 0 && (
        <section className="bg-white rounded-2xl border border-red-200 px-4 py-3" data-needs-attention>
          <h2 className="text-sm font-semibold text-red-800">Needs attention ({failed.length})</h2>
          <ul className="divide-y divide-gray-100">{failed.map(r => <RunCard key={r.id} run={r} onChanged={load} />)}</ul>
        </section>
      )}

      <section className="space-y-2" data-rules>
        <h2 className="text-sm font-semibold text-gray-900">Rules</h2>
        {rules.length === 0 && <p className="text-sm text-gray-600">No rules yet.</p>}
        {rules.map(r => (
          <article key={r.id} className="bg-white rounded-2xl border border-gray-200 p-4" data-rule={r.name}>
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900">{r.name}</p>
                <p className="text-sm text-gray-600"><span className="chip chip-brand mr-1">{r.board === 'sales' ? 'Sales' : 'Operations'}</span>When: {triggerText(r.trigger, r.board, opsLabel)}</p>
                {r.conditions.length > 0 && <p className="text-sm text-gray-600">If: {r.conditions.map(c => conditionText(c, r.board, opsLabel)).join(' and ')}</p>}
                <p className="text-sm text-gray-600">Then: {r.steps.map(s => s.type === 'wait' ? `wait ${minutesText(s.minutes)}` : STEP_LABEL[s.type]?.toLowerCase()).join(' → ')}</p>
                {r.runs30d && Object.keys(r.runs30d).length > 0 && <p className="text-xs text-gray-500 mt-1">Last 30 days: {Object.entries(r.runs30d).map(([k, v]) => `${v} ${k}`).join(', ')}</p>}
              </div>
              <Switch on={r.enabled} onChange={v => toggle(r, v)} label={`${r.enabled ? 'Pause' : 'Switch on'} ${r.name}`} disabled={!admin} />
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              {admin && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(r)} data-edit-rule><Pencil size={15} aria-hidden="true" />Edit</button>}
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setTesting(r)} data-test-rule><FlaskConical size={15} aria-hidden="true" />Test</button>
              {admin && <button type="button" className="btn btn-quiet btn-sm text-red-700" onClick={() => remove(r)}><Trash2 size={15} aria-hidden="true" />Delete</button>}
            </div>
          </article>
        ))}
      </section>

      <StageRulesSection meta={shown} rules={stageRules} onChanged={load} admin={admin} opsLabel={opsLabel} />

      <section className="bg-white rounded-2xl border border-gray-200 px-4 py-3" data-recent-runs>
        <h2 className="text-sm font-semibold text-gray-900">Recent runs</h2>
        {recent.length === 0 ? <p className="text-sm text-gray-600 mt-1">Nothing has run yet.</p> : <ul className="divide-y divide-gray-100">{recent.map(r => <RunCard key={r.id} run={r} onChanged={load} />)}</ul>}
      </section>

      {editing && <RuleEditor meta={shown} draft={editing} opsLabel={opsLabel} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load() }} onTest={d => setTesting(d)} />}
      {testing && <TestPanel meta={shown} rule={testing} opsLabel={opsLabel} onClose={() => setTesting(null)} />}
    </div>
  )
}

function conditionText(c: Condition, board: Board, opsLabel: (k: string) => string): string {
  const f = FIELD_LABEL[c.field] ?? c.field
  if (c.field === 'price') {
    const v = c.value ?? {}
    const d = (n: number | null | undefined) => n == null ? '' : '$' + Math.round(n / 100).toLocaleString('en-US')
    return v.minCents != null && v.maxCents != null ? `price ${d(v.minCents)} to ${d(v.maxCents)}` : v.minCents != null ? `price at least ${d(v.minCents)}` : `price at most ${d(v.maxCents)}`
  }
  if (c.field === 'permit_required') return c.value === true || c.value === 'true' ? 'a permit is required' : 'no permit is required'
  const val = c.field === 'stage' ? (board === 'ops' ? opsLabel(String(c.value)) : stageName(String(c.value))) : String(c.value)
  const op = c.op === 'is_not' ? 'is not' : c.op === 'has' ? 'has' : c.op === 'has_not' ? 'does not have' : c.op === 'contains' ? 'contains' : 'is'
  return `${f.toLowerCase()} ${op} ${val}`
}

// ── Rule editor ──────────────────────────────────────────────────────────────

function RuleEditor({ meta, draft: initial, opsLabel, onClose, onSaved, onTest }: { meta: Meta; draft: Draft; opsLabel: (k: string) => string; onClose: () => void; onSaved: () => void; onTest: (d: Draft) => void }) {
  useBackLayer(onClose, { key: 'rule' })
  const [d, setD] = useState<Draft>(() => JSON.parse(JSON.stringify(initial)))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // One id per new rule, chosen when the editor opens: Save tapped again (or
  // sent again after the answer was lost) returns the rule already made.
  const [newRuleId] = useState(() => crypto.randomUUID())
  const saving = useRef(false)
  const offered = d.board === 'sales' ? meta.salesStages : meta.opsStages
  // A rule on a hidden stage still shows that stage, by its name.
  // Stages the rule already names that the pickers no longer offer (hidden): kept, with their names.
  const inUse = [(d.trigger as any).stage, ...d.conditions.filter(c => c.field === 'stage').map(c => c.value), ...d.steps.map(s => (s as any).type === 'move_card' ? (s as any).stage : null)]
  const stages = [...offered, ...[...new Set(inUse.filter((k): k is string => typeof k === 'string' && !!k && !offered.some(o => o.key === k)))].map(k => ({ key: k, label: d.board === 'ops' ? opsLabel(k) : stageName(k) }))]
  const setT = (t: Partial<Trigger>) => setD(x => ({ ...x, trigger: { ...x.trigger, ...t } }))

  function setBoard(board: Board) {
    const first = board === 'sales' ? meta.salesStages[0]?.key ?? '' : meta.opsStages[0].key
    setD(x => ({ ...x, board, trigger: 'stage' in x.trigger && x.trigger.type !== 'event' && x.trigger.type !== 'date_offset' ? { ...x.trigger, stage: first } : x.trigger, steps: x.steps.map(s => s.type === 'move_card' ? { ...s, stage: '' } : s) }))
  }
  function setTriggerType(type: Trigger['type']) {
    const stage = stages[0]?.key
    const t: Trigger = type === 'card_entered' ? { type, stage, settleMinutes: 2, onlyWhileInStage: true }
      : type === 'card_left' ? { type, stage }
      : type === 'in_stage_days' ? { type, stage, days: 3 }
      : type === 'date_offset' ? { type, dateField: 'install', days: 2, when: 'before' }
      : { type, event: 'proposal_accepted' }
    setD(x => ({ ...x, trigger: t }))
  }
  const setStep = (i: number, s: Step) => setD(x => ({ ...x, steps: x.steps.map((o, k) => k === i ? s : o) }))
  const moveStep = (i: number, by: number) => setD(x => { const s = [...x.steps]; const j = i + by; if (j < 0 || j >= s.length) return x; [s[i], s[j]] = [s[j], s[i]]; return { ...x, steps: s } })

  async function save() {
    if (saving.current) return
    saving.current = true
    setBusy(true); setError('')
    try {
      const body = { name: d.name.trim(), board: d.board, enabled: d.enabled, trigger: d.trigger, conditions: d.conditions, steps: d.steps }
      if (d.id) await api('PUT', `/rules/${d.id}`, body); else await api('POST', '/rules', { ...body, id: newRuleId })
      toast.success('Rule saved', d.name)
      onSaved()
    } catch (err) { setError((err as Error).message) } finally { saving.current = false; setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-stretch md:items-center justify-center md:p-6" data-rule-editor>
      <div role="dialog" aria-modal="true" aria-label="Rule" className="bg-gray-50 w-full md:max-w-2xl md:rounded-2xl shadow-2xl flex flex-col max-h-full md:max-h-[92vh]">
        <div className="bg-white border-b border-gray-200 px-4 pt-[calc(12px+env(safe-area-inset-top))] md:pt-4 pb-3 flex items-center gap-2">
          <h2 className="flex-1 text-lg font-bold text-gray-900">{d.id ? 'Edit rule' : 'New rule'}</h2>
          <button type="button" className="btn btn-quiet btn-icon" aria-label="Close" onClick={onClose}><X size={22} aria-hidden="true" /></button>
        </div>
        <div className="overflow-y-auto px-4 py-4 space-y-5">
          <div className="space-y-3">
            <div><label className={label} htmlFor="rule-name">Name</label><input id="rule-name" className={input} value={d.name} onChange={e => setD(x => ({ ...x, name: e.target.value }))} placeholder="Sold: order materials" data-rule-name /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className={label}>Board</label>
                <select className={input} value={d.board} onChange={e => setBoard(e.target.value as Board)} data-rule-board><option value="sales">Sales pipeline (cards)</option><option value="ops">Operations (jobs)</option></select></div>
              <div className="flex items-end gap-2 pb-1"><Switch on={d.enabled} onChange={v => setD(x => ({ ...x, enabled: v }))} label="Rule on" /><span className="text-sm text-gray-700">{d.enabled ? 'On' : 'Off'}</span></div>
            </div>
          </div>

          <fieldset className="bg-white rounded-2xl border border-gray-200 p-4 space-y-3">
            <legend className="px-1 text-sm font-bold text-gray-900">When</legend>
            <select className={input} value={d.trigger.type} onChange={e => setTriggerType(e.target.value as Trigger['type'])} data-trigger-type>
              <option value="card_entered">{d.board === 'sales' ? 'A card moves into a stage' : 'A job moves into a stage'}</option>
              <option value="card_left">{d.board === 'sales' ? 'A card moves out of a stage' : 'A job moves out of a stage'}</option>
              <option value="in_stage_days">It has been in a stage for X days</option>
              <option value="date_offset">X days before or after a date</option>
              <option value="event">Something happens</option>
            </select>
            {['card_entered', 'card_left', 'in_stage_days'].includes(d.trigger.type) && (
              <div><label className={label}>Stage</label>
                <select className={input} value={d.trigger.stage} onChange={e => setT({ stage: e.target.value })} data-trigger-stage>{stages.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}</select></div>
            )}
            {d.trigger.type === 'in_stage_days' && <div><label className={label}>Days</label><input type="number" min={1} className={input} value={d.trigger.days} onChange={e => setT({ days: Math.max(1, Number(e.target.value) || 1) })} /></div>}
            {d.trigger.type === 'card_entered' && (
              <div className="grid grid-cols-2 gap-2">
                <div><label className={label}>Settle time (min)</label><input type="number" min={0} className={input} value={d.trigger.settleMinutes} onChange={e => setT({ settleMinutes: Math.max(0, Number(e.target.value) || 0) })} /></div>
                <label className="flex items-center gap-2 text-sm text-gray-700 pt-5"><input type="checkbox" className="h-5 w-5" checked={!!d.trigger.onlyWhileInStage} onChange={e => setT({ onlyWhileInStage: e.target.checked })} />Stop if it leaves the stage</label>
                <p className="col-span-2 text-xs text-gray-500">Runs after the settle time only if it is still there, and once per card and stage in 24 hours, so quick drags back and forth do nothing extra.</p>
              </div>
            )}
            {d.trigger.type === 'date_offset' && (
              <div className="grid grid-cols-3 gap-2">
                <div><label className={label}>Days</label><input type="number" min={0} className={input} value={d.trigger.days} onChange={e => setT({ days: Math.max(0, Number(e.target.value) || 0) })} /></div>
                <div><label className={label}>Before / after</label><select className={input} value={d.trigger.when} onChange={e => setT({ when: e.target.value as 'before' | 'after' })}><option value="before">before</option><option value="after">after</option></select></div>
                <div><label className={label}>Date</label><select className={input} value={d.trigger.dateField} onChange={e => setT({ dateField: e.target.value as any })}><option value="install">Install date</option><option value="appointment">Appointment</option><option value="proposal_sent">Proposal sent</option></select></div>
              </div>
            )}
            {d.trigger.type === 'event' && (
              <select className={input} value={d.trigger.event} onChange={e => setT({ event: e.target.value })} data-trigger-event>{meta.events.map(ev => <option key={ev} value={ev}>{EVENT_LABEL[ev] ?? ev}</option>)}</select>
            )}
          </fieldset>

          <fieldset className="bg-white rounded-2xl border border-gray-200 p-4 space-y-3">
            <legend className="px-1 text-sm font-bold text-gray-900">If (optional)</legend>
            {d.conditions.length === 0 && <p className="text-sm text-gray-600">Every card. Add a condition to narrow it.</p>}
            {d.conditions.map((c, i) => (
              <ConditionRow key={i} c={c} stages={stages} onChange={nc => setD(x => ({ ...x, conditions: x.conditions.map((o, k) => k === i ? nc : o) }))} onRemove={() => setD(x => ({ ...x, conditions: x.conditions.filter((_, k) => k !== i) }))} />
            ))}
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setD(x => ({ ...x, conditions: [...x.conditions, { field: 'city', op: 'is', value: 'Ocala' }] }))} data-add-condition><Plus size={15} aria-hidden="true" />Add condition</button>
          </fieldset>

          <fieldset className="bg-white rounded-2xl border border-gray-200 p-4 space-y-3">
            <legend className="px-1 text-sm font-bold text-gray-900">Then</legend>
            <p className="text-xs text-gray-500">Fields you can use in text: {meta.templateFields.map(f => `{${f}}`).join(' ')}</p>
            {d.steps.map((s, i) => (
              <div key={i} className="rounded-xl border border-gray-200 p-3 space-y-2" data-step={i}>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-gray-500 w-5">{i + 1}</span>
                  <select className={input} value={s.type} onChange={e => setStep(i, NEW_STEP[e.target.value]())} data-step-type>{Object.keys(NEW_STEP).map(t => <option key={t} value={t}>{STEP_LABEL[t]}</option>)}</select>
                  <button type="button" className="btn btn-quiet btn-icon" aria-label="Move up" onClick={() => moveStep(i, -1)}><ArrowUp size={16} aria-hidden="true" /></button>
                  <button type="button" className="btn btn-quiet btn-icon" aria-label="Move down" onClick={() => moveStep(i, 1)}><ArrowDown size={16} aria-hidden="true" /></button>
                  <button type="button" className="btn btn-quiet btn-icon text-red-700" aria-label="Remove step" onClick={() => setD(x => ({ ...x, steps: x.steps.filter((_, k) => k !== i) }))}><Trash2 size={16} aria-hidden="true" /></button>
                </div>
                <StepFields s={s} meta={meta} stages={stages} onChange={ns => setStep(i, ns)} />
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setD(x => ({ ...x, steps: [...x.steps, NEW_STEP.create_task()] }))} data-add-step><Plus size={15} aria-hidden="true" />Add step</button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setD(x => ({ ...x, steps: [...x.steps, NEW_STEP.wait()] }))}><Plus size={15} aria-hidden="true" />Add a wait</button>
            </div>
          </fieldset>
          {error && <p className="text-sm text-red-700" role="alert" data-rule-error>{error}</p>}
        </div>
        <div className="bg-white border-t border-gray-200 px-4 py-3 pb-[calc(12px+env(safe-area-inset-bottom))] flex gap-2">
          <button type="button" className="btn btn-primary flex-1" disabled={busy || !d.name.trim()} onClick={save} data-save-rule>{busy ? 'Saving…' : 'Save'}</button>
          <button type="button" className="btn btn-secondary" onClick={() => onTest(d)} data-test-draft><FlaskConical size={16} aria-hidden="true" />Test</button>
        </div>
      </div>
    </div>
  )
}

function ConditionRow({ c, stages, onChange, onRemove }: { c: Condition; stages: Array<{ key: string; label: string }>; onChange: (c: Condition) => void; onRemove: () => void }) {
  const setField = (field: Condition['field']) => onChange(
    field === 'price' ? { field, op: 'between', value: { minCents: null, maxCents: null } }
      : field === 'permit_required' ? { field, op: 'is', value: true }
      : field === 'tag' ? { field, op: 'has', value: '' }
      : field === 'stage' ? { field, op: 'is', value: stages[0]?.key ?? '' }
      : field === 'style' ? { field, op: 'contains', value: '' }
      : { field, op: 'is', value: '' })
  const dollars = (cents: number | null | undefined) => cents == null ? '' : String(Math.round(cents / 100))
  const cents = (v: string) => v.trim() === '' ? null : Math.round(Number(v) * 100)
  return (
    <div className="flex flex-wrap items-center gap-2" data-condition>
      <select className={`${input} w-auto`} value={c.field} onChange={e => setField(e.target.value as Condition['field'])}>{Object.entries(FIELD_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      {c.field === 'price' ? (
        <>
          <input inputMode="numeric" className={`${input} w-28`} placeholder="Min $" value={dollars(c.value?.minCents)} onChange={e => onChange({ ...c, value: { ...c.value, minCents: cents(e.target.value) } })} />
          <span className="text-sm text-gray-500">to</span>
          <input inputMode="numeric" className={`${input} w-28`} placeholder="Max $" value={dollars(c.value?.maxCents)} onChange={e => onChange({ ...c, value: { ...c.value, maxCents: cents(e.target.value) } })} />
        </>
      ) : c.field === 'permit_required' ? (
        <select className={`${input} w-auto`} value={String(c.value)} onChange={e => onChange({ ...c, value: e.target.value === 'true' })}><option value="true">Yes</option><option value="false">No</option></select>
      ) : (
        <>
          <select className={`${input} w-auto`} value={c.op} onChange={e => onChange({ ...c, op: e.target.value })}>
            {(c.field === 'tag' ? [['has', 'has'], ['has_not', 'does not have']] : c.field === 'style' ? [['contains', 'contains'], ['is', 'is'], ['is_not', 'is not']] : [['is', 'is'], ['is_not', 'is not']]).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          {c.field === 'stage'
            ? <select className={`${input} w-auto`} value={String(c.value)} onChange={e => onChange({ ...c, value: e.target.value })}>{stages.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}</select>
            : <input className={`${input} flex-1 min-w-[8rem]`} value={String(c.value ?? '')} onChange={e => onChange({ ...c, value: e.target.value })} placeholder={c.field === 'county' ? 'Marion' : c.field === 'city' ? 'Ocala' : ''} />}
        </>
      )}
      <button type="button" className="btn btn-quiet btn-icon text-red-700" aria-label="Remove condition" onClick={onRemove}><Trash2 size={16} aria-hidden="true" /></button>
    </div>
  )
}

function PersonPicker({ value, onChange, meta }: { value: string; onChange: (v: string) => void; meta: Meta }) {
  const known = ['', '{salesman}', ...meta.people.map(p => p.name)]
  const [other, setOther] = useState(!known.includes(value))
  return (
    <div><label className={label}>For</label>
      <select className={input} value={other ? '__other' : value} onChange={e => { const v = e.target.value; setOther(v === '__other'); onChange(v === '__other' ? '' : v) }}>
        <option value="">Anyone (on everyone's list)</option><option value="{salesman}">The card's salesman</option>
        {meta.people.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
        <option value="__other">Someone else…</option>
      </select>
      {other && <input className={`${input} mt-2`} value={value} onChange={e => onChange(e.target.value)} placeholder="Name" />}
    </div>
  )
}

function StepFields({ s, meta, stages, onChange }: { s: Step; meta: Meta; stages: Array<{ key: string; label: string }>; onChange: (s: Step) => void }) {
  const set = (k: string, v: unknown) => onChange({ ...s, [k]: v })
  switch (s.type) {
    case 'create_task': return (
      <div className="space-y-2">
        <input className={input} value={s.title} onChange={e => set('title', e.target.value)} placeholder="Order materials for {name}" data-step-title />
        <textarea className={input} rows={2} value={s.description} onChange={e => set('description', e.target.value)} placeholder="Details (optional)" />
        <div className="grid grid-cols-2 gap-2"><PersonPicker value={s.assignTo} onChange={v => set('assignTo', v)} meta={meta} />
          <div><label className={label}>Due in (days)</label><input type="number" min={0} className={input} value={s.dueInDays} onChange={e => set('dueInDays', Math.max(0, Number(e.target.value) || 0))} /></div></div>
      </div>)
    case 'notify': return (
      <div className="space-y-2">
        <input className={input} value={s.title} onChange={e => set('title', e.target.value)} placeholder="{name} moved to {stage}" data-step-title />
        <input className={input} value={s.body} onChange={e => set('body', e.target.value)} placeholder="More (optional)" />
        <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" className="h-5 w-5" checked={s.push} onChange={e => set('push', e.target.checked)} />Also push to my phone</label>
      </div>)
    case 'email_customer': return (
      <div className="space-y-2">
        <input className={input} value={s.subject} onChange={e => set('subject', e.target.value)} placeholder="Subject" />
        <textarea className={input} rows={5} value={s.body} onChange={e => set('body', e.target.value)} />
        {!meta.gmail.connected && <p className="text-xs text-amber-700">Gmail is not connected: this step will fail until it is.</p>}
      </div>)
    case 'prepare_text': return (
      <div className="space-y-2">
        <textarea className={input} rows={3} value={s.body} onChange={e => set('body', e.target.value)} />
        <PersonPicker value={s.assignTo} onChange={v => set('assignTo', v)} meta={meta} />
        <p className="text-xs text-gray-500">Makes a task with the text ready: you tap Send the text and it opens your messages filled in.</p>
      </div>)
    case 'move_card': return (
      <select className={input} value={s.stage} onChange={e => set('stage', e.target.value)}><option value="">Pick a stage…</option>{stages.map(st => <option key={st.key} value={st.key}>{st.label}</option>)}</select>)
    case 'add_checklist': return (
      <div><label className={label}>Items, one per line</label><textarea className={input} rows={3} value={(s.items as string[]).join('\n')} onChange={e => set('items', e.target.value.split('\n').map(x => x.trim()).filter(Boolean))} /></div>)
    case 'request_signature': return (
      <div className="grid grid-cols-2 gap-2">
        <select className={input} value={s.what} onChange={e => set('what', e.target.value)}><option value="walkthrough">Final walkthrough</option><option value="proposal">Proposal</option></select>
        <select className={input} value={s.via} onChange={e => set('via', e.target.value)}><option value="text">Prepared text</option><option value="email">Email</option></select>
      </div>)
    case 'start_walkthrough': return <p className="text-xs text-gray-500">{meta.walkthroughInstalled ? 'Starts the job\'s final walkthrough.' : 'The Final walkthrough feature is not installed yet; this step will fail clearly until it is.'}</p>
    case 'final_invoice': return <div><label className={label}>Due in (days)</label><input type="number" min={0} className={input} value={s.dueInDays} onChange={e => set('dueInDays', Math.max(0, Number(e.target.value) || 0))} /><p className="text-xs text-gray-500 mt-1">A draft for the balance, in Billing. You check and send it.</p></div>
    case 'permit_packet': return <div className="space-y-1"><PersonPicker value={s.assignTo} onChange={v => set('assignTo', v)} meta={meta} /><p className="text-xs text-gray-500">Makes the packet PDF (site plan, contract, owner, parcel ID) and a task with the county's permit portal link. Reminders come until the permit is Approved. Nothing is filed for you.</p></div>
    case 'wait': {
      const unit = s.minutes % 1440 === 0 ? 1440 : s.minutes % 60 === 0 ? 60 : 1
      return (
        <div className="grid grid-cols-2 gap-2">
          <input type="number" min={1} className={input} value={s.minutes / unit} onChange={e => set('minutes', Math.max(1, Math.round(Number(e.target.value) || 1)) * unit)} data-wait-amount />
          <select className={input} value={unit} onChange={e => set('minutes', Math.max(1, Math.round(s.minutes / unit)) * Number(e.target.value))}><option value={1}>minutes</option><option value={60}>hours</option><option value={1440}>days</option></select>
        </div>)
    }
    case 'webhook': return <div><input className={input} value={s.url} onChange={e => set('url', e.target.value)} placeholder="https://" /><p className="text-xs text-gray-500 mt-1">Posts the card's details as JSON (10 second limit), tried again if it fails, with the same Idempotency-Key each time.</p></div>
    default: return null
  }
}

// ── Test (dry run) ───────────────────────────────────────────────────────────

function TestPanel({ meta, rule, opsLabel, onClose }: { meta: Meta; rule: Draft; opsLabel: (k: string) => string; onClose: () => void }) {
  useBackLayer(onClose, { key: 'ruletest' })
  const [q, setQ] = useState('')
  const [samples, setSamples] = useState<Array<{ id: string; name: string; stage: string; address: string }>>([])
  const [pick, setPick] = useState('')
  const [result, setResult] = useState<DryRun | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const t = setTimeout(() => {
      api<typeof samples>('GET', `/samples?board=${rule.board}&q=${encodeURIComponent(q)}`).then(s => { setSamples(s); if (!pick && s[0]) setPick(s[0].id) }).catch(err => setError((err as Error).message))
    }, 250)
    return () => clearTimeout(t)
  }, [q, rule.board]) // eslint-disable-line react-hooks/exhaustive-deps
  async function run() {
    setBusy(true); setError(''); setResult(null)
    try { setResult(await api<DryRun>('POST', '/rules/test', { entityId: pick, rule: { name: rule.name, board: rule.board, trigger: rule.trigger, conditions: rule.conditions, steps: rule.steps } })) }
    catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }
  const picked = useMemo(() => samples.find(s => s.id === pick), [samples, pick])
  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-stretch md:items-center justify-center md:p-6" data-test-panel>
      <div role="dialog" aria-modal="true" aria-label="Test the rule" className="bg-gray-50 w-full md:max-w-xl md:rounded-2xl shadow-2xl flex flex-col max-h-full md:max-h-[92vh]">
        <div className="bg-white border-b border-gray-200 px-4 pt-[calc(12px+env(safe-area-inset-top))] md:pt-4 pb-3 flex items-center gap-2">
          <div className="flex-1 min-w-0"><h2 className="text-lg font-bold text-gray-900">Test: {rule.name || 'new rule'}</h2><p className="text-xs text-gray-600">Dry run: shows what would happen. Nothing is done or sent.</p></div>
          <button type="button" className="btn btn-quiet btn-icon" aria-label="Close" onClick={onClose}><X size={22} aria-hidden="true" /></button>
        </div>
        <div className="overflow-y-auto px-4 py-4 space-y-3">
          <div><label className={label}>{rule.board === 'sales' ? 'Card' : 'Job'} to test with</label>
            <input className={input} value={q} onChange={e => setQ(e.target.value)} placeholder="Search by name or address" data-sample-search />
            <select className={`${input} mt-2`} value={pick} onChange={e => setPick(e.target.value)} data-sample-pick>{samples.map(s => <option key={s.id} value={s.id}>{s.name} · {s.stage}</option>)}</select>
          </div>
          <button type="button" className="btn btn-primary w-full" disabled={!pick || busy} onClick={run} data-run-test>{busy ? 'Testing…' : `Test with ${picked?.name ?? '…'}`}</button>
          {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
          {result && (
            <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-3" data-dry-run-result>
              <p className="text-sm text-gray-700"><span className="font-semibold">{result.entity.name}</span> ({rule.board === 'ops' ? opsLabel(result.entity.stage) : stageName(result.entity.stage)}). Runs {result.trigger}.</p>
              {result.conditions.length > 0 && (
                <ul className="space-y-1">{result.conditions.map((c, i) => <li key={i} className={`text-sm ${c.ok ? 'text-green-800' : 'text-red-700'}`}>{c.ok ? '✓' : '✗'} {FIELD_LABEL[c.field] ?? c.field}: {c.actual}</li>)}</ul>
              )}
              <p className={`text-sm font-semibold ${result.wouldRun ? 'text-green-800' : 'text-red-700'}`} data-would-run={result.wouldRun}>{result.wouldRun ? 'It would run these steps:' : 'It would not run: a condition is not met. The steps would be:'}</p>
              <ol className="space-y-2">{result.steps.map(s => (
                <li key={s.index} className="text-sm text-gray-800 whitespace-pre-line" data-dry-step={s.index}>
                  <span className="font-semibold">{s.index + 1}.</span> {s.would}
                  {s.warning && <span className="block text-amber-800 bg-amber-50 rounded-lg px-2 py-1 mt-1">{s.warning}</span>}
                </li>
              ))}</ol>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Stage rules ──────────────────────────────────────────────────────────────

function StageRulesSection({ meta, rules, onChanged, admin, opsLabel }: { meta: Meta; rules: StageRule[]; onChanged: () => void; admin: boolean; opsLabel: (k: string) => string }) {
  const [adding, setAdding] = useState<{ board: Board; stage: string } | null>(null)
  async function save(r: { board: Board; stage: string; requirements: Array<{ type: string }>; enabled: boolean }) {
    try { await api('PUT', '/stage-rules', r); onChanged() } catch (err) { toast.error('Could not save the stage rule', (err as Error).message) }
  }
  async function remove(r: StageRule) {
    if (!window.confirm(`Remove the rule for ${r.stage}?`)) return
    try { await api('DELETE', `/stage-rules/${r.id}`); onChanged() } catch (err) { toast.error('Could not remove it', (err as Error).message) }
  }
  return (
    <section className="space-y-2" data-stage-rules>
      <h2 className="text-sm font-semibold text-gray-900">Stage rules</h2>
      <p className="text-sm text-gray-600">A card cannot be moved into these stages until what is ticked is done. A move that is refused goes back, and the app says what is missing.</p>
      {rules.map(r => {
        const reqs = new Set(r.requirements.map(x => x.type))
        return (
          <article key={r.id} className="bg-white rounded-2xl border border-gray-200 p-4" data-stage-rule={`${r.board}:${r.stage}`}>
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900"><span className="chip chip-brand mr-1">{r.board === 'sales' ? 'Sales' : 'Operations'}</span>Into {r.board === 'ops' ? opsLabel(r.stage) : stageName(r.stage)}</p>
                <div className="mt-2 grid sm:grid-cols-2 gap-1">
                  {meta.requirements.map(q => (
                    <label key={q.type} className="flex items-center gap-2 text-sm text-gray-700 min-h-[36px]">
                      <input type="checkbox" className="h-5 w-5" disabled={!admin} checked={reqs.has(q.type)} onChange={e => {
                        const next = e.target.checked ? [...r.requirements, { type: q.type }] : r.requirements.filter(x => x.type !== q.type)
                        if (next.length) void save({ board: r.board, stage: r.stage, requirements: next, enabled: r.enabled })
                        else toast.info('Keep at least one', 'Remove the rule instead if nothing is needed.')
                      }} />{q.label}
                    </label>
                  ))}
                </div>
              </div>
              <Switch on={r.enabled} disabled={!admin} onChange={v => save({ board: r.board, stage: r.stage, requirements: r.requirements, enabled: v })} label={`${r.enabled ? 'Turn off' : 'Turn on'} the ${r.stage} rule`} />
            </div>
            {admin && <button type="button" className="btn btn-quiet btn-sm text-red-700 mt-2" onClick={() => remove(r)}><Trash2 size={15} aria-hidden="true" />Remove</button>}
          </article>
        )
      })}
      {admin && (adding ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-4 grid grid-cols-2 gap-2">
          <select className={input} value={adding.board} onChange={e => setAdding({ board: e.target.value as Board, stage: '' })}><option value="sales">Sales pipeline</option><option value="ops">Operations</option></select>
          <select className={input} value={adding.stage} onChange={e => setAdding({ ...adding, stage: e.target.value })}>
            <option value="">Stage…</option>
            {(adding.board === 'sales' ? meta.salesStages : meta.opsStages).map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <button type="button" className="btn btn-primary btn-sm" disabled={!adding.stage} onClick={() => { void save({ ...adding, requirements: [{ type: 'permit_approved' }], enabled: false }); setAdding(null) }}>Add</button>
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => setAdding(null)}>Cancel</button>
        </div>
      ) : <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAdding({ board: 'sales', stage: '' })}><Plus size={15} aria-hidden="true" />Add a stage rule</button>)}
    </section>
  )
}
