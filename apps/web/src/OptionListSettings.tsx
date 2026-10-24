/**
 * Settings > Lead Sources and Settings > Customer Tags: one list of options
 * each (optionListsStore). Forms offer the shown options; records keep their
 * words and show the option's name; reports add merged words together.
 *
 * Rename, reorder, hide, add; Merge one option into another (its records count
 * as the other's; Undo merge brings it back); delete an option no record uses.
 * "Found on records, not in the list" lists words that no option matches,
 * with Add or Merge into. Built-in options (the words the website quote, phone
 * agent, chat and imports save) can be renamed and hidden, never deleted or
 * merged away. Owner and admin only (lists.change).
 */

import { useEffect, useMemo, useState } from 'react'
import { useOptions, saveOptions, getWordCounts, getOptions, type OptionDef, type OptionListKind, type WordCount } from './optionListsStore'
import { mergeOption, undoMerge, addOption, linkWord, foundOnRecords, optionsProblem, wordsOf, LIST_LABEL, ONE_LABEL } from './optionListModel'
import { useCan } from './permissions'
import { toast } from './toast'
import { useSettingsPageSave } from './settingsPageSave'

const recs = (n: number) => `${n} record${n === 1 ? '' : 's'}`
const copy = (l: OptionDef[]) => l.map(o => ({ ...o, alsoMatches: o.alsoMatches.map(x => ({ ...x })) }))

export default function OptionListSettings({ kind }: { kind: OptionListKind }) {
  const saved = useOptions(kind)
  const allowed = useCan('lists.change')
  const [list, setList] = useState<OptionDef[]>(() => copy(saved))
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [words, setWords] = useState<WordCount[] | null>(null)
  const [adding, setAdding] = useState('')
  const one = ONE_LABEL[kind]

  useEffect(() => { if (!dirty) setList(copy(saved)) }, [saved])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void getWordCounts(kind).then(setWords) }, [kind, saved])

  const countOf = useMemo(() => {
    const m = new Map((words ?? []).map(w => [w.word, w.count]))
    return (o: OptionDef) => wordsOf(o).reduce((t, w) => t + (m.get(w) ?? 0), 0)
  }, [words])
  const found = useMemo(() => foundOnRecords(list, words ?? []), [list, words])
  const now = () => new Date().toISOString()

  useSettingsPageSave(dirty, () => handleSave(), () => { setList(copy(saved)); setDirty(false); setError(null) })

  function change(next: OptionDef[]) { setList(next.map((o, i) => ({ ...o, order: i }))); setDirty(true); setError(null) }
  function update(id: string, patch: Partial<OptionDef>) { change(list.map(o => (o.id === id ? { ...o, ...patch } : o))) }
  function move(i: number, to: number) { if (to < 0 || to >= list.length) return; const n = [...list]; const [x] = n.splice(i, 1); n.splice(to, 0, x); change(n) }
  function apply(r: { list: OptionDef[] } | { error: string }) { if ('error' in r) { setError(r.error); return false } change(r.list); return true }
  function merge(fromId: string, intoId: string) {
    if (!intoId) return
    const from = list.find(o => o.id === fromId), into = list.find(o => o.id === intoId)
    if (from && into && apply(mergeOption(list, fromId, intoId, now()))) toast.info(`"${from.name}" merged into "${into.name}"`, 'Save to keep it. Undo merge brings it back.')
  }
  function remove(o: OptionDef) {
    if (o.builtIn) { setError(`"${o.name}" is built in; it can be renamed or hidden, not deleted.`); return }
    if (countOf(o) > 0) { setError(`"${o.name}" is on ${recs(countOf(o))}. Merge it into another ${one} instead (its records then count as that one).`); return }
    change(list.filter(x => x.id !== o.id))
  }

  async function handleSave() {
    const next = list.map((o, i) => ({ ...o, name: o.name.trim(), order: i }))
    const problem = optionsProblem(next, kind)
    if (problem) { setError(problem); return }
    setSaving(true)
    const r = await saveOptions(kind, next)
    setSaving(false)
    if (r.ok) { setDirty(false); setError(null); setList(copy(getOptions(kind))); toast.success(`${LIST_LABEL[kind]} saved`, 'Every device shows the change.') }
    else { setError(r.error); if (r.stale) { setDirty(false); setList(copy(getOptions(kind))) } }
  }

  return (
    <div className="space-y-4" data-option-list={kind}>
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
        <div className="min-w-0">
          <h3 data-settings-dup-title className="text-lg font-bold text-gray-900">{LIST_LABEL[kind]}</h3>
          <p className="text-sm text-gray-500 mt-1">
            The {one}s forms offer. Records keep the word they were saved with and show the {one}'s name here, so renaming changes every record's name at once.
            Merge joins two {one}s: reports add them together, and Undo merge splits them again.
          </p>
          {!allowed && <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2" data-option-list-readonly>Only the owner or an admin can change this list.</p>}
        </div>
        {allowed && (
          <div className="flex flex-wrap gap-2 shrink-0">
            {dirty && <button onClick={() => { setList(copy(saved)); setDirty(false); setError(null) }} className="btn btn-secondary" data-option-list-undo>Undo changes</button>}
            <button onClick={() => void handleSave()} disabled={!dirty || saving} className="btn btn-primary disabled:opacity-50" data-option-list-save>{saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}</button>
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2" role="alert" data-option-list-error>{error}</p>}

      <div className="space-y-2">
        {list.map((o, i) => (
          <div key={o.id} data-option-row={o.id} className={`bg-white border rounded-xl px-3 py-2 space-y-2 ${o.hidden ? 'border-dashed border-gray-300' : 'border-gray-200'}`}>
            <div className="flex items-center gap-2 min-w-0">
              {allowed && (
                <div className="flex flex-col shrink-0 -ml-1">
                  <button type="button" onClick={() => move(i, i - 1)} disabled={i === 0} className="btn btn-quiet btn-sm !min-h-[32px] !px-2" aria-label={`Move ${o.name} up`} data-option-up>▲</button>
                  <button type="button" onClick={() => move(i, i + 1)} disabled={i === list.length - 1} className="btn btn-quiet btn-sm !min-h-[32px] !px-2" aria-label={`Move ${o.name} down`} data-option-down>▼</button>
                </div>
              )}
              <input value={o.name} disabled={!allowed} onChange={e => update(o.id, { name: e.target.value })} maxLength={60} aria-label={`Name of ${o.name}`}
                className="flex-1 min-w-0 border border-gray-200 rounded-lg px-3 h-10 text-base focus:outline-none focus:ring-2 focus:ring-orange-400" data-option-name />
              <span className="hidden sm:inline text-xs text-gray-500 shrink-0" data-option-count={words ? countOf(o) : ''}>{words ? recs(countOf(o)) : '…'}</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-700">
              <span className="sm:hidden text-gray-500 min-h-[40px] inline-flex items-center">{words ? recs(countOf(o)) : '…'}</span>
              {o.builtIn && <span className="chip chip-brand" data-option-builtin title="The app saves this one on its own">Built in</span>}
              {o.name !== o.id && <span className="text-gray-500 break-all">Saved as “{o.id}”</span>}
              <label className="flex items-center gap-1.5 min-h-[40px]">
                <input type="checkbox" checked={o.hidden} disabled={!allowed} onChange={e => update(o.id, { hidden: e.target.checked })} data-option-hidden />Hidden from forms
              </label>
              {allowed && !o.builtIn && (
                <select value="" onChange={e => merge(o.id, e.target.value)} aria-label={`Merge ${o.name} into`} data-option-merge
                  className="border border-gray-300 rounded-lg h-10 px-1 text-sm bg-white max-w-[12rem]">
                  <option value="">Merge into…</option>
                  {list.filter(x => x.id !== o.id).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              )}
              {allowed && !o.builtIn && <button type="button" onClick={() => remove(o)} className="btn btn-quiet btn-sm text-red-600 ml-auto" data-option-delete aria-label={`Delete ${o.name}`}>Delete</button>}
            </div>
            {o.alsoMatches.length > 0 && (
              <ul className="text-xs text-gray-600 space-y-1" data-option-links>
                {o.alsoMatches.map(l => (
                  <li key={l.word} className="flex flex-wrap items-center gap-2" data-option-link={l.word}>
                    <span>Also counts “{l.word}” {l.kind === 'case' ? '(the same in other capital letters)' : l.was ? `(merged: ${l.was.name})` : '(found on records)'}</span>
                    {allowed && l.kind === 'merge' && (
                      <button type="button" className="btn btn-quiet btn-sm !min-h-[32px]" data-option-unmerge onClick={() => apply(undoMerge(list, o.id, l.word))}>Undo merge</button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>

      {allowed && (
        <div className="flex flex-wrap gap-2">
          <input value={adding} onChange={e => setAdding(e.target.value)} maxLength={60} placeholder={`New ${one}`} aria-label={`New ${one}`}
            className="flex-1 min-w-0 border border-gray-200 rounded-lg px-3 h-11 text-base" data-option-new />
          <button type="button" className="btn btn-secondary" data-option-add onClick={() => { if (apply(addOption(list, adding))) setAdding('') }}>+ Add</button>
        </div>
      )}

      <section className="bg-white border border-gray-200 rounded-xl p-3 space-y-2" data-option-found>
        <h4 className="text-sm font-semibold text-gray-900">Found on records, not in the list</h4>
        <p className="text-xs text-gray-500">Words saved on customers, quotes, jobs or cards that no {one} matches. They show as typed until you add or merge them; nothing is matched for you.</p>
        {words === null ? <p className="text-sm text-gray-500">Counting…</p> : !found.length ? <p className="text-sm text-gray-500" data-option-found-none>None.</p> : (
          <ul className="space-y-2">
            {found.map(f => (
              <li key={f.word} className="flex flex-wrap items-center gap-2 text-sm" data-option-found-word={f.word}>
                <span className="font-medium text-gray-900 break-all">“{f.word}”</span>
                <span className="text-xs text-gray-500">{recs(f.count)}</span>
                {allowed && (
                  <span className="flex flex-wrap gap-2 ml-auto">
                    <button type="button" className="btn btn-secondary btn-sm" data-option-found-add onClick={() => apply(addOption(list, f.word))}>Add</button>
                    <select value="" aria-label={`Merge ${f.word} into`} data-option-found-merge className="border border-gray-300 rounded-lg h-10 px-1 text-sm bg-white max-w-[12rem]"
                      onChange={e => { if (e.target.value) apply(linkWord(list, f.word, e.target.value, now())) }}>
                      <option value="">Merge into…</option>
                      {list.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </select>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
