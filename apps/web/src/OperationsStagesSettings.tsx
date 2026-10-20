/**
 * Settings > Operations Stages: the one list of stages. The Operations board
 * (columns and order), its list view and filters, the job page, Advance, the
 * phone views and automations all read it (opsStagesStore).
 *
 * Rename, recolor, reorder (drag, or the arrows on a phone), add, hide, choose
 * the first stage and the Complete stage, and put a stage in the side lanes.
 * Every stage keeps its id for good, so a rename changes no job, automation or
 * stage rule. Deleting a stage that jobs or automations use asks where they go
 * first; the server moves them and deletes the stage in one step.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  useOpsStages, saveOpsStages, getStageUsage, deleteOpsStage, getOpsStages,
  type OpsStageDef, type StageUsage,
} from './opsStagesStore'
import { newStageId, stagesProblem, sortedStages, stageOfJob } from './opsStageModel'
import { getJobs } from './jobStore'
import { toast } from './toast'
import { useBackLayer } from './nav'

const jobsText = (n: number) => `${n} job${n === 1 ? '' : 's'}`
const copy = (l: OpsStageDef[]) => sortedStages(l).map(s => ({ ...s }))

export default function OperationsStagesSettings() {
  const saved = useOpsStages()
  const [stages, setStages] = useState<OpsStageDef[]>(() => copy(saved))
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<{ stage: OpsStageDef; usage: StageUsage } | null>(null)
  const dragIndex = useRef<number | null>(null)

  // Another device saved: show its list unless there are changes here not saved yet.
  useEffect(() => { if (!dirty) setStages(copy(saved)) }, [saved])  // eslint-disable-line react-hooks/exhaustive-deps

  // Jobs per stage, by the same rule the board uses.
  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const j of getJobs()) { const id = stageOfJob(saved, j); m.set(id, (m.get(id) ?? 0) + 1) }
    return m
  }, [saved])

  const savedIds = new Set(saved.map(s => s.id))

  function change(next: OpsStageDef[]) { setStages(next.map((s, i) => ({ ...s, order: i }))); setDirty(true); setError(null) }
  function update(id: string, patch: Partial<OpsStageDef>) { change(stages.map(s => (s.id === id ? { ...s, ...patch } : s))) }
  function setOnly(id: string, flag: 'isFirst' | 'isComplete') { change(stages.map(s => ({ ...s, [flag]: s.id === id }))) }
  function move(from: number, to: number) {
    if (to < 0 || to >= stages.length || from === to) return
    const next = [...stages]
    const [m] = next.splice(from, 1)
    next.splice(to, 0, m)
    change(next)
  }

  function add() {
    const id = newStageId([...stages, ...saved])
    const s: OpsStageDef = { id, name: 'New Stage', color: '#f97316', order: stages.length, hidden: false, isFirst: false, isComplete: false, lane: 'main' }
    // Added before the side lanes, at the end of the board.
    const at = stages.findIndex(x => x.lane === 'side')
    const next = [...stages]
    next.splice(at < 0 ? next.length : at, 0, s)
    change(next)
  }

  async function remove(s: OpsStageDef) {
    if (!savedIds.has(s.id)) { change(stages.filter(x => x.id !== s.id)); return }   // added here, not saved yet
    if (dirty) { toast.warning('Save first', 'Save or undo your other changes before deleting a stage.'); return }
    const usage = await getStageUsage(s.id)
    if (!usage) { toast.error('Could not check the stage', 'Check the connection and try again.'); return }
    if (!usage.jobs.length && !usage.rules.length && !usage.stageRules.length) {
      if (!confirm(`Delete the stage "${s.name}"? No job or automation uses it.`)) return
      const r = await deleteOpsStage(s.id, null)
      if (r.ok) toast.success('Stage deleted', s.name)
      else if (r.inUse) setDeleting({ stage: s, usage: r.inUse })
      else toast.error('Could not delete the stage', r.error)
      return
    }
    setDeleting({ stage: s, usage })
  }

  async function handleSave() {
    const next = stages.map((s, i) => ({ ...s, name: s.name.trim(), order: i }))
    const problem = stagesProblem(next)
    if (problem) { setError(problem); return }
    setSaving(true)
    const r = await saveOpsStages(next)
    setSaving(false)
    if (r.ok) {
      setDirty(false); setError(null); setStages(copy(getOpsStages()))
      toast.success('Operations stages saved', 'The board shows the change on every device.')
    } else {
      setError(r.error)
      // Someone else saved first: their list is on screen; this change has to be made again.
      if (r.stale) { setDirty(false); setStages(copy(getOpsStages())) }
    }
  }

  function handleUndo() { setStages(copy(saved)); setDirty(false); setError(null) }

  const mainCount = stages.filter(s => s.lane === 'main').length

  return (
    <div className="space-y-4" data-ops-stages-settings>
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-lg font-bold text-gray-900">Operations Stages</h3>
          <p className="text-sm text-gray-500 mt-1">
            The columns on the Operations board, left to right, then the side lanes. Drag (or use the arrows) to reorder.
            New jobs land in the <b>First</b> stage; moving a job to the <b>Complete</b> stage marks it complete.
            Renaming a stage never moves a job.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          {dirty && <button onClick={handleUndo} className="btn btn-secondary" data-ops-stages-undo>Undo changes</button>}
          <button onClick={handleSave} disabled={!dirty || saving} data-ops-stages-save className="btn btn-primary disabled:opacity-50">
            {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2" role="alert" data-ops-stages-error>{error}</p>}

      <div className="space-y-2">
        {stages.map((s, i) => {
          const firstSide = s.lane === 'side' && (i === 0 || stages[i - 1].lane !== 'side')
          return (
            <div key={s.id}>
              {firstSide && <p className="text-xs font-semibold text-gray-500 mt-4 mb-1">Side lanes (waiting: the job is on hold)</p>}
              <div
                draggable
                onDragStart={() => { dragIndex.current = i }}
                onDragOver={e => e.preventDefault()}
                onDrop={() => { if (dragIndex.current != null) move(dragIndex.current, i); dragIndex.current = null }}
                data-ops-stage-row={s.id}
                className={`flex flex-wrap items-center gap-2 bg-white border rounded-xl px-3 py-2 transition-colors ${s.hidden ? 'border-dashed border-gray-300 opacity-70' : 'border-gray-200 hover:border-orange-300'}`}>
                <div className="flex items-center gap-2 flex-1 basis-full lg:basis-0 min-w-0">
                <span className="text-gray-300 cursor-grab select-none text-xl hidden md:inline" aria-hidden="true">⋮⋮</span>
                <div className="flex flex-col shrink-0">
                  <button type="button" onClick={() => move(i, i - 1)} disabled={i === 0} className="btn btn-quiet btn-sm !min-h-[32px] !px-2" aria-label={`Move ${s.name} up`} data-ops-stage-up>▲</button>
                  <button type="button" onClick={() => move(i, i + 1)} disabled={i === stages.length - 1} className="btn btn-quiet btn-sm !min-h-[32px] !px-2" aria-label={`Move ${s.name} down`} data-ops-stage-down>▼</button>
                </div>
                <input type="color" value={s.color} onChange={e => update(s.id, { color: e.target.value })} aria-label={`Color of ${s.name}`}
                  className="w-10 h-10 border border-gray-200 rounded cursor-pointer shrink-0" data-ops-stage-color />
                <input value={s.name} onChange={e => update(s.id, { name: e.target.value })} aria-label="Stage name" maxLength={60}
                  className="flex-1 min-w-0 border border-gray-200 rounded-lg px-3 h-10 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" data-ops-stage-name />
                <span className="hidden lg:inline text-xs text-gray-500 w-14 shrink-0 text-right" title="Jobs in this stage now" data-ops-stage-count={counts.get(s.id) ?? 0}>{jobsText(counts.get(s.id) ?? 0)}</span>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 w-full lg:w-auto pl-1">
                  <span className="lg:hidden text-xs text-gray-500 min-h-[40px] inline-flex items-center">{jobsText(counts.get(s.id) ?? 0)}</span>
                  <label className="flex items-center gap-1.5 text-xs text-gray-700 min-h-[40px]">
                    <input type="radio" name="opsFirstStage" checked={s.isFirst} onChange={() => setOnly(s.id, 'isFirst')} disabled={s.lane === 'side'} data-ops-stage-first />First
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-gray-700 min-h-[40px]">
                    <input type="radio" name="opsCompleteStage" checked={s.isComplete} onChange={() => setOnly(s.id, 'isComplete')} disabled={s.lane === 'side'} data-ops-stage-complete />Complete
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-gray-700 min-h-[40px]">
                    <input type="checkbox" checked={s.hidden} onChange={e => update(s.id, { hidden: e.target.checked })} data-ops-stage-hidden />Hidden
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-gray-700 min-h-[40px]">
                    <input type="checkbox" checked={s.lane === 'side'} disabled={s.lane === 'main' && mainCount <= 1}
                      onChange={e => update(s.id, { lane: e.target.checked ? 'side' : 'main', ...(e.target.checked ? { isFirst: false, isComplete: false } : {}) })} data-ops-stage-side />Side lane
                  </label>
                  <button type="button" onClick={() => void remove(s)} className="btn btn-quiet btn-sm text-red-600 ml-auto" aria-label={`Delete ${s.name}`} data-ops-stage-delete>Delete</button>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <button onClick={add} data-ops-stage-add className="w-full border-2 border-dashed border-gray-200 hover:border-orange-300 rounded-xl py-3 text-sm text-gray-600 hover:text-orange-600 transition-colors">
        + Add stage
      </button>

      {deleting && (
        <DeleteStageDialog
          stage={deleting.stage}
          usage={deleting.usage}
          options={stages.filter(s => s.id !== deleting.stage.id && !s.hidden)}
          onClose={() => setDeleting(null)}
          onDone={() => { setDeleting(null); setStages(copy(getOpsStages())); setDirty(false) }}
        />
      )}
    </div>
  )
}

/** A stage in use: which jobs and automations use it, and where they go before it is deleted. */
function DeleteStageDialog({ stage, usage, options, onClose, onDone }: {
  stage: OpsStageDef; usage: StageUsage; options: OpsStageDef[]; onClose: () => void; onDone: () => void
}) {
  useBackLayer(onClose, { key: 'delete-stage' })
  const [moveTo, setMoveTo] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const active = usage.jobs.filter(j => !j.archived)
  const archived = usage.jobs.length - active.length

  async function go() {
    if (!moveTo) { setError('Pick the stage they go to.'); return }
    setBusy(true)
    const r = await deleteOpsStage(stage.id, moveTo)
    setBusy(false)
    if (!r.ok) { setError(r.error); return }
    const to = options.find(o => o.id === moveTo)?.name ?? moveTo
    toast.success(`"${stage.name}" deleted`, `${r.moved?.jobs ?? 0} job(s), ${r.moved?.rules ?? 0} automation(s) and ${r.moved?.stageRules ?? 0} stage rule(s) now use ${to}.`)
    onDone()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-2xl p-5 max-h-[90vh] overflow-y-auto" role="dialog" aria-label={`Delete ${stage.name}`} data-ops-stage-delete-dialog>
        <h3 className="text-base font-bold text-gray-900">Delete “{stage.name}”?</h3>
        <p className="text-sm text-gray-600 mt-1">This stage is in use. Pick the stage they move to; then the stage is deleted. Nothing else about the jobs changes.</p>

        {usage.jobs.length > 0 && (
          <div className="mt-3">
            <p className="text-sm font-semibold text-gray-800" data-ops-stage-delete-jobs={usage.jobs.length}>
              {active.length} job{active.length === 1 ? '' : 's'} in this stage{archived ? ` (and ${archived} removed job${archived === 1 ? '' : 's'})` : ''}
            </p>
            <ul className="text-sm text-gray-600 mt-1 max-h-32 overflow-y-auto list-disc pl-5">
              {active.slice(0, 50).map(j => <li key={j.id}>{j.name}</li>)}
              {active.length > 50 && <li>and {active.length - 50} more</li>}
            </ul>
          </div>
        )}
        {usage.rules.length > 0 && (
          <div className="mt-3">
            <p className="text-sm font-semibold text-gray-800" data-ops-stage-delete-rules={usage.rules.length}>Automations that use it</p>
            <ul className="text-sm text-gray-600 mt-1 list-disc pl-5">{usage.rules.map(r => <li key={r.id}>{r.name}</li>)}</ul>
          </div>
        )}
        {usage.stageRules.length > 0 && (
          <p className="text-sm text-gray-700 mt-3" data-ops-stage-delete-stagerules={usage.stageRules.length}>
            Its stage rule ({usage.stageRules.map(r => r.requirements.join(', ')).join('; ')}) moves too, unless the stage you pick already has one; then it is removed.
          </p>
        )}

        <label className="block text-sm font-semibold text-gray-800 mt-4">Move them to
          <select value={moveTo} onChange={e => { setMoveTo(e.target.value); setError(null) }} className="mt-1 w-full border border-gray-300 rounded-lg h-11 px-2 text-sm" data-ops-stage-delete-moveto>
            <option value="">Pick a stage…</option>
            {options.map(o => <option key={o.id} value={o.id}>{o.name}{o.lane === 'side' ? ' (side lane)' : ''}</option>)}
          </select>
        </label>
        {error && <p className="text-sm text-red-700 mt-2" role="alert">{error}</p>}
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="btn btn-secondary" disabled={busy}>Cancel</button>
          <button onClick={() => void go()} className="btn btn-danger" disabled={busy || !moveTo} data-ops-stage-delete-confirm>{busy ? 'Moving…' : 'Move them and delete'}</button>
        </div>
      </div>
    </div>
  )
}
