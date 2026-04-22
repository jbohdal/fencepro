/**
 * Operations Stages settings — sortable, editable columns used by the Ops board.
 */

import { useState, useRef } from 'react'
import {
  getOpsStages, saveOpsStages, resetOpsStages,
  type OpsStage,
} from './opsStagesStore'
import { getJobs } from './jobStore'
import { toast } from './toast'

const uid = () => Math.random().toString(36).slice(2, 10)

export default function OperationsStagesSettings() {
  const [stages, setStages] = useState<OpsStage[]>(() => getOpsStages())
  const [dirty, setDirty] = useState(false)
  const dragIndex = useRef<number | null>(null)

  function setAndDirty(next: OpsStage[]) { setStages(next); setDirty(true) }

  function update(id: string, patch: Partial<OpsStage>) {
    setAndDirty(stages.map(s => s.id === id ? { ...s, ...patch } : s))
  }

  function add() {
    const now = new Date().toISOString()
    const next: OpsStage = {
      id: uid(), name: 'New Stage', color: '#f97316',
      sortOrder: stages.length, isFirstStage: false, isCompletionStage: false,
      isActive: true, createdAt: now, updatedAt: now,
    }
    setAndDirty([...stages, next])
  }

  function remove(s: OpsStage) {
    // Forbid deleting if jobs are currently in this stage
    const activeJobs = getJobs().filter(j => (j.status as any) === s.name || (j as any).opsStage === s.name)
    if (activeJobs.length > 0) {
      toast.warning('Cannot delete stage', `${activeJobs.length} active job${activeJobs.length === 1 ? '' : 's'} in "${s.name}". Move them first.`)
      return
    }
    if (!confirm(`Delete "${s.name}"? This cannot be undone.`)) return
    setAndDirty(stages.filter(x => x.id !== s.id))
  }

  function setFirst(id: string) {
    setAndDirty(stages.map(s => ({ ...s, isFirstStage: s.id === id })))
  }

  function onDragStart(i: number) { dragIndex.current = i }
  function onDragOver(e: React.DragEvent) { e.preventDefault() }
  function onDrop(target: number) {
    if (dragIndex.current == null || dragIndex.current === target) return
    const next = [...stages]
    const [moved] = next.splice(dragIndex.current, 1)
    next.splice(target, 0, moved)
    dragIndex.current = null
    setAndDirty(next)
  }

  function handleSave() {
    try {
      saveOpsStages(stages)
      setStages(getOpsStages())
      setDirty(false)
      toast.success('Operations stages saved', 'Board will reflect changes immediately.')
    } catch (err: any) {
      toast.error('Could not save', err?.message)
    }
  }

  function handleReset() {
    if (!confirm('Reset Operations stages to factory defaults?')) return
    const fresh = resetOpsStages()
    setStages(fresh)
    setDirty(false)
    toast.success('Reset to defaults')
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-lg font-bold text-gray-900">Operations Stages</h3>
          <p className="text-sm text-gray-500 mt-1">The columns on the Operations board. Drag to reorder. Jobs on the first stage are where new signed contracts land.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleReset} className="text-xs text-gray-500 border border-gray-200 rounded-lg px-3 py-2 hover:bg-gray-50">Reset defaults</button>
          <button onClick={handleSave} disabled={!dirty}
            className={`text-sm font-semibold px-4 py-2 rounded-lg ${dirty ? 'bg-orange-500 hover:bg-orange-600 text-white' : 'bg-gray-200 text-gray-500'}`}>
            {dirty ? 'Save Changes' : 'Saved'}
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {stages.map((s, i) => (
          <div key={s.id}
            draggable
            onDragStart={() => onDragStart(i)}
            onDragOver={onDragOver}
            onDrop={() => onDrop(i)}
            className="flex items-center gap-3 bg-white border border-gray-200 rounded-xl px-3 py-3 hover:border-orange-300 transition-colors">
            <span className="text-gray-300 cursor-grab select-none text-xl">⋮⋮</span>
            <div className="w-5 h-5 rounded-full border border-gray-200 shrink-0" style={{ backgroundColor: s.color }} />
            <input type="color" value={s.color} onChange={e => update(s.id, { color: e.target.value })}
              className="w-7 h-7 border border-gray-200 rounded cursor-pointer" />
            <input value={s.name} onChange={e => update(s.id, { name: e.target.value })}
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
            <label className="flex items-center gap-1 text-xs text-gray-600">
              <input type="radio" name="firstStage" checked={s.isFirstStage} onChange={() => setFirst(s.id)} />
              First
            </label>
            <label className="flex items-center gap-1 text-xs text-gray-600">
              <input type="checkbox" checked={s.isCompletionStage} onChange={e => update(s.id, { isCompletionStage: e.target.checked })} />
              Done
            </label>
            <label className="flex items-center gap-1 text-xs text-gray-600">
              <input type="checkbox" checked={s.isActive} onChange={e => update(s.id, { isActive: e.target.checked })} />
              Active
            </label>
            <button onClick={() => remove(s)} className="text-red-500 hover:bg-red-50 rounded px-2 py-1">×</button>
          </div>
        ))}
      </div>

      <button onClick={add} className="w-full border-2 border-dashed border-gray-200 hover:border-orange-300 rounded-xl py-3 text-sm text-gray-500 hover:text-orange-500 transition-colors">
        + Add Stage
      </button>

      <div className="flex justify-end">
        <button onClick={handleSave} disabled={!dirty}
          className={`text-sm font-semibold px-4 py-2 rounded-lg ${dirty ? 'bg-orange-500 hover:bg-orange-600 text-white' : 'bg-gray-200 text-gray-500'}`}>
          {dirty ? 'Save Changes' : 'Saved'}
        </button>
      </div>
    </div>
  )
}
