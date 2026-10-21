/**
 * Settings > Pipeline Stages: the one list of Sales Pipeline stages. The board
 * (columns, names, colors, order), the card window, the customer page,
 * follow ups, appointments, the pipeline value and automations all read it
 * (pipelineStagesStore).
 *
 * Rename, recolor, reorder (the arrows), add, hide, put a stage in a group,
 * give the roles (new cards land here, Appointment, Ready to quote, Signed,
 * Job complete, Lost), mark which stages need a follow up and each Selling
 * stage's chance of closing. Every stage keeps its id for good, so a rename
 * changes no card, follow up, stage rule or automation. Deleting a stage that
 * cards or automations use asks where they go first; the server moves them
 * and deletes the stage in one step. Owner and admin only (lists.change).
 */

import { useEffect, useMemo, useState } from 'react'
import {
  usePipelineStages, savePipelineStages, getStageUsage, deletePipelineStage, getPipelineStages,
  type PipelineStageDef, type StageUsage,
} from './pipelineStagesStore'
import {
  newStageId, stagesProblem, sortedStages, finishedFor, GROUPS, GROUP_LABEL, ROLES, ROLE_LABEL, ROLE_HELP, ROLE_GROUPS, REQUIRED_ROLES,
  type PipelineGroup, type PipelineRole,
} from './pipelineStageModel'
import { getPipeline, getArchivedCards, refreshPipelineNow, PIPELINE_UPDATED_EVENT } from './pipelineStore'
import { refreshBoard } from './followUpStore'
import { useCan } from './permissions'
import { toast } from './toast'
import { useBackLayer } from './nav'

const cardsText = (n: number) => `${n} card${n === 1 ? '' : 's'}`
const copy = (l: PipelineStageDef[]) => sortedStages(l).map(s => ({ ...s, roles: [...s.roles] }))

export default function PipelineStagesSettings() {
  const saved = usePipelineStages()
  const allowed = useCan('lists.change')
  const [stages, setStages] = useState<PipelineStageDef[]>(() => copy(saved))
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<{ stage: PipelineStageDef; usage: StageUsage } | null>(null)
  const [tick, setTick] = useState(0)

  // Another device saved: show its list unless there are changes here not saved yet.
  useEffect(() => { if (!dirty) setStages(copy(saved)) }, [saved])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const h = () => setTick(t => t + 1)
    window.addEventListener(PIPELINE_UPDATED_EVENT, h)
    return () => window.removeEventListener(PIPELINE_UPDATED_EVENT, h)
  }, [])

  // Cards per stage (on the board and archived).
  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of [...(getPipeline().leads || []), ...getArchivedCards()]) if (l?.stage) m.set(l.stage, (m.get(l.stage) ?? 0) + 1)
    return m
  }, [saved, tick])  // eslint-disable-line react-hooks/exhaustive-deps

  const savedIds = new Set(saved.map(s => s.id))

  function change(next: PipelineStageDef[]) {
    // Order inside each group as shown.
    const n: Record<string, number> = {}
    setStages(sortedStages(next.map(s => ({ ...s }))).map(s => { const o = n[s.group] ?? 0; n[s.group] = o + 1; return { ...s, order: o } }))
    setDirty(true); setError(null)
  }
  function update(id: string, patch: Partial<PipelineStageDef>) { change(stages.map(s => (s.id === id ? { ...s, ...patch } : s))) }
  function setGroup(s: PipelineStageDef, group: PipelineGroup) {
    // Moved to the end of its new group; roles that cannot be in that group come off.
    const order = Math.max(-1, ...stages.filter(x => x.group === group && x.id !== s.id).map(x => x.order)) + 1
    update(s.id, { group, order, roles: s.roles.filter(r => ROLE_GROUPS[r].includes(group)), finished: finishedFor(group, s.finished) })
  }
  function setRole(role: PipelineRole, id: string) {
    change(stages.map(s => ({ ...s, roles: ROLES.filter(r => (r === role ? s.id === id : s.roles.includes(r))) })))
  }
  function move(s: PipelineStageDef, dir: -1 | 1) {
    const same = stages.filter(x => x.group === s.group)
    const at = same.findIndex(x => x.id === s.id)
    const other = same[at + dir]
    if (!other) return
    change(stages.map(x => (x.id === s.id ? { ...x, order: other.order } : x.id === other.id ? { ...x, order: s.order } : x)))
  }

  function add() {
    const id = newStageId([...stages, ...saved])
    const order = Math.max(-1, ...stages.filter(x => x.group === 'selling').map(x => x.order)) + 1
    change([...stages, { id, name: 'New Stage', color: '#f97316', order, hidden: false, group: 'selling', roles: [], finished: false, needsFollowUp: false, chancePct: 10 }])
  }

  async function remove(s: PipelineStageDef) {
    if (!savedIds.has(s.id)) { change(stages.filter(x => x.id !== s.id)); return }   // added here, not saved yet
    if (dirty) { toast.warning('Save first', 'Save or undo your other changes before deleting a stage.'); return }
    const role = s.roles.find(r => (REQUIRED_ROLES as string[]).includes(r))
    if (role) { toast.warning(`"${s.name}" is the ${ROLE_LABEL[role]} stage`, 'Give that role to another stage and save, then delete it.'); return }
    const usage = await getStageUsage(s.id)
    if (!usage) { toast.error('Could not check the stage', 'Check the connection and try again.'); return }
    if (!usage.cards.length && !usage.rules.length && !usage.stageRules.length && !usage.followUps) {
      if (!confirm(`Delete the stage "${s.name}"? No card or automation uses it.${usage.steps ? ' Its follow up steps go with it.' : ''}`)) return
      const r = await deletePipelineStage(s.id, null)
      if (r.ok) toast.success('Stage deleted', s.name)
      else if (r.inUse) setDeleting({ stage: s, usage: r.inUse })
      else toast.error('Could not delete the stage', r.error)
      return
    }
    setDeleting({ stage: s, usage })
  }

  async function handleSave() {
    const next = stages.map(s => ({ ...s, name: s.name.trim() }))
    const problem = stagesProblem(next)
    if (problem) { setError(problem); return }
    setSaving(true)
    const r = await savePipelineStages(next)
    setSaving(false)
    if (r.ok) {
      setDirty(false); setError(null); setStages(copy(getPipelineStages()))
      toast.success('Pipeline stages saved', 'The board shows the change on every device.')
    } else {
      setError(r.error)
      if (r.stale) { setDirty(false); setStages(copy(getPipelineStages())) }
    }
  }

  function handleUndo() { setStages(copy(saved)); setDirty(false); setError(null) }

  const roleOf = (role: PipelineRole) => stages.find(s => s.roles.includes(role))?.id ?? ''

  return (
    <div className="space-y-4" data-pipeline-stages-settings>
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-lg font-bold text-gray-900">Pipeline Stages</h3>
          <p className="text-sm text-gray-500 mt-1">
            The columns on the Sales Pipeline, left to right, in four groups. What each stage is for (its group and roles) is what the app checks,
            so renaming a stage never moves a card or breaks a follow up or automation.
          </p>
          {!allowed && <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2" data-pipeline-stages-readonly>Only the owner or an admin can change the stages.</p>}
        </div>
        {allowed && (
          <div className="flex flex-wrap gap-2 shrink-0">
            {dirty && <button onClick={handleUndo} className="btn btn-secondary" data-pipeline-stages-undo>Undo changes</button>}
            <button onClick={() => void handleSave()} disabled={!dirty || saving} data-pipeline-stages-save className="btn btn-primary disabled:opacity-50">
              {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
            </button>
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2" role="alert" data-pipeline-stages-error>{error}</p>}

      <section className="bg-white border border-gray-200 rounded-xl p-3 space-y-2" data-pipeline-roles>
        <h4 className="text-sm font-semibold text-gray-900">What the stages are for</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {ROLES.map(role => {
            const required = (REQUIRED_ROLES as string[]).includes(role)
            const options = stages.filter(s => ROLE_GROUPS[role].includes(s.group) && (!s.hidden || s.roles.includes(role)))
            return (
              <label key={role} className="block text-sm min-w-0">
                <span className="font-semibold text-gray-800">{ROLE_LABEL[role]}</span>
                <select value={roleOf(role)} disabled={!allowed} onChange={e => setRole(role, e.target.value)} data-pipeline-role={role}
                  className="mt-1 w-full border border-gray-300 rounded-lg h-11 px-2 text-base bg-white">
                  {!required && <option value="">None</option>}
                  {options.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <span className="block text-xs text-gray-500 mt-0.5">{ROLE_HELP[role]}</span>
              </label>
            )
          })}
        </div>
      </section>

      {GROUPS.map(group => {
        const inGroup = stages.filter(s => s.group === group)
        return (
          <section key={group} className="space-y-2" data-pipeline-group={group}>
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mt-4">{GROUP_LABEL[group]}</h4>
            {!inGroup.length && <p className="text-sm text-gray-400">No stages in this group.</p>}
            {inGroup.map((s, i) => (
              <div key={s.id} data-pipeline-stage-row={s.id}
                className={`bg-white border rounded-xl px-3 py-2 space-y-2 ${s.hidden ? 'border-dashed border-gray-300 opacity-80' : 'border-gray-200'}`}>
                <div className="flex items-center gap-2 min-w-0">
                  {allowed && (
                    <div className="flex flex-col shrink-0 -ml-1">
                      <button type="button" onClick={() => move(s, -1)} disabled={i === 0} className="btn btn-quiet btn-sm !min-h-[32px] !px-2" aria-label={`Move ${s.name} up`} data-pipeline-stage-up>▲</button>
                      <button type="button" onClick={() => move(s, 1)} disabled={i === inGroup.length - 1} className="btn btn-quiet btn-sm !min-h-[32px] !px-2" aria-label={`Move ${s.name} down`} data-pipeline-stage-down>▼</button>
                    </div>
                  )}
                  <input type="color" value={s.color} disabled={!allowed} onChange={e => update(s.id, { color: e.target.value })} aria-label={`Color of ${s.name}`}
                    className="w-9 h-9 sm:w-10 sm:h-10 border border-gray-200 rounded cursor-pointer shrink-0" data-pipeline-stage-color />
                  <input value={s.name} disabled={!allowed} onChange={e => update(s.id, { name: e.target.value })} aria-label="Stage name" maxLength={60}
                    className="flex-1 min-w-0 border border-gray-200 rounded-lg px-3 h-10 text-base focus:outline-none focus:ring-2 focus:ring-orange-400" data-pipeline-stage-name />
                  <span className="hidden sm:inline text-xs text-gray-500 shrink-0" title="Cards in this stage now" data-pipeline-stage-count={counts.get(s.id) ?? 0}>{cardsText(counts.get(s.id) ?? 0)}</span>
                </div>
                {s.roles.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {s.roles.map(r => <span key={r} className="chip chip-brand text-xs" data-pipeline-stage-role={r}>{ROLE_LABEL[r]}</span>)}
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="sm:hidden text-xs text-gray-500 min-h-[40px] inline-flex items-center">{cardsText(counts.get(s.id) ?? 0)}</span>
                  <label className="flex items-center gap-1.5 text-xs text-gray-700 min-h-[40px]">
                    Group
                    <select value={s.group} disabled={!allowed} onChange={e => setGroup(s, e.target.value as PipelineGroup)} data-pipeline-stage-group
                      className="border border-gray-300 rounded-lg h-10 px-1 text-sm bg-white max-w-[11rem]">
                      {GROUPS.map(g => <option key={g} value={g}>{GROUP_LABEL[g]}</option>)}
                    </select>
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-gray-700 min-h-[40px]">
                    <input type="checkbox" checked={s.hidden} disabled={!allowed} onChange={e => update(s.id, { hidden: e.target.checked })} data-pipeline-stage-hidden />Hidden
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-gray-700 min-h-[40px]">
                    <input type="checkbox" checked={s.needsFollowUp} disabled={!allowed} onChange={e => update(s.id, { needsFollowUp: e.target.checked })} data-pipeline-stage-followup />Needs a follow up
                  </label>
                  {s.group === 'sold_done' && (
                    <label className="flex items-center gap-1.5 text-xs text-gray-700 min-h-[40px]">
                      <input type="checkbox" checked={s.finished} disabled={!allowed} onChange={e => update(s.id, { finished: e.target.checked })} data-pipeline-stage-finished />Finished
                    </label>
                  )}
                  {s.group === 'selling' && (
                    <label className="flex items-center gap-1.5 text-xs text-gray-700 min-h-[40px]">
                      Chance
                      <input type="number" min={0} max={100} value={s.chancePct} disabled={!allowed} aria-label={`Chance of closing for ${s.name}`}
                        onChange={e => update(s.id, { chancePct: Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0))) })}
                        className="w-16 border border-gray-300 rounded-lg h-10 px-2 text-base" data-pipeline-stage-chance />%
                    </label>
                  )}
                  {allowed && <button type="button" onClick={() => void remove(s)} className="btn btn-quiet btn-sm text-red-600 ml-auto" aria-label={`Delete ${s.name}`} data-pipeline-stage-delete>Delete</button>}
                </div>
              </div>
            ))}
          </section>
        )
      })}

      {allowed && (
        <button onClick={add} data-pipeline-stage-add className="w-full border-2 border-dashed border-gray-200 hover:border-orange-300 rounded-xl py-3 text-sm text-gray-600 hover:text-orange-600 transition-colors">
          + Add stage
        </button>
      )}

      {deleting && (
        <DeleteStageDialog
          stage={deleting.stage}
          usage={deleting.usage}
          options={stages.filter(s => s.id !== deleting.stage.id && !s.hidden)}
          onClose={() => setDeleting(null)}
          onDone={() => { setDeleting(null); setStages(copy(getPipelineStages())); setDirty(false) }}
        />
      )}
    </div>
  )
}

/** A stage in use: which cards and automations use it, and where they go before it is deleted. */
function DeleteStageDialog({ stage, usage, options, onClose, onDone }: {
  stage: PipelineStageDef; usage: StageUsage; options: PipelineStageDef[]; onClose: () => void; onDone: () => void
}) {
  useBackLayer(onClose, { key: 'delete-pipeline-stage' })
  const [moveTo, setMoveTo] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const active = usage.cards.filter(c => !c.archived)
  const archived = usage.cards.length - active.length

  async function go() {
    if (!moveTo) { setError('Pick the stage they go to.'); return }
    setBusy(true)
    const r = await deletePipelineStage(stage.id, moveTo)
    setBusy(false)
    if (!r.ok) { setError(r.error); return }
    // The cards moved on the server: the board and the follow ups read again.
    void refreshPipelineNow()
    void refreshBoard()
    const to = options.find(o => o.id === moveTo)?.name ?? moveTo
    toast.success(`"${stage.name}" deleted`, `${r.moved?.cards ?? 0} card(s), ${r.moved?.rules ?? 0} automation(s) and ${r.moved?.stageRules ?? 0} stage rule(s) now use ${to}.`)
    onDone()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-2xl p-5 max-h-[90vh] overflow-y-auto" role="dialog" aria-label={`Delete ${stage.name}`} data-pipeline-stage-delete-dialog>
        <h3 className="text-base font-bold text-gray-900">Delete “{stage.name}”?</h3>
        <p className="text-sm text-gray-600 mt-1">This stage is in use. Pick the stage they move to; then the stage is deleted. No automation runs for the move, and the cards' follow up dates stay as they are.</p>

        {usage.cards.length > 0 && (
          <div className="mt-3">
            <p className="text-sm font-semibold text-gray-800" data-pipeline-stage-delete-cards={usage.cards.length}>
              {active.length} card{active.length === 1 ? '' : 's'} in this stage{archived ? ` (and ${archived} archived)` : ''}
            </p>
            <ul className="text-sm text-gray-600 mt-1 max-h-32 overflow-y-auto list-disc pl-5">
              {active.slice(0, 50).map(c => <li key={c.id}>{c.name}</li>)}
              {active.length > 50 && <li>and {active.length - 50} more</li>}
            </ul>
          </div>
        )}
        {usage.rules.length > 0 && (
          <div className="mt-3">
            <p className="text-sm font-semibold text-gray-800" data-pipeline-stage-delete-rules={usage.rules.length}>Automations that use it</p>
            <ul className="text-sm text-gray-600 mt-1 list-disc pl-5">{usage.rules.map(r => <li key={r.id}>{r.name}</li>)}</ul>
          </div>
        )}
        {usage.stageRules.length > 0 && (
          <p className="text-sm text-gray-700 mt-3" data-pipeline-stage-delete-stagerules={usage.stageRules.length}>
            Its stage rule ({usage.stageRules.map(r => r.requirements.join(', ')).join('; ')}) moves too, unless the stage you pick already has one; then it is removed.
          </p>
        )}
        {(usage.steps > 0 || usage.followUps > 0) && (
          <p className="text-sm text-gray-700 mt-3" data-pipeline-stage-delete-followups={usage.followUps}>
            {usage.followUps > 0 ? `${usage.followUps} card follow up${usage.followUps === 1 ? '' : 's'} keep their dates. ` : ''}
            {usage.steps > 0 ? 'Its follow up steps move too, unless the stage you pick has its own.' : ''}
          </p>
        )}

        <label className="block text-sm font-semibold text-gray-800 mt-4">Move them to
          <select value={moveTo} onChange={e => { setMoveTo(e.target.value); setError(null) }} className="mt-1 w-full border border-gray-300 rounded-lg h-11 px-2 text-base" data-pipeline-stage-delete-moveto>
            <option value="">Pick a stage…</option>
            {options.map(o => <option key={o.id} value={o.id}>{o.name} ({GROUP_LABEL[o.group]})</option>)}
          </select>
        </label>
        {error && <p className="text-sm text-red-700 mt-2" role="alert">{error}</p>}
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="btn btn-secondary" disabled={busy}>Cancel</button>
          <button onClick={() => void go()} className="btn btn-danger" disabled={busy || !moveTo} data-pipeline-stage-delete-confirm>{busy ? 'Moving…' : 'Move them and delete'}</button>
        </div>
      </div>
    </div>
  )
}
