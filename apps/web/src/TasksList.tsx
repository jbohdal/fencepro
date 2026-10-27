/**
 * My tasks and reminders (from automations, or made by hand elsewhere), on
 * the Today screen. A prepared text opens the phone's messages with the words
 * filled in; a link opens; "Mark done" marks it done on the server (Undo on the row for a few seconds). Overdue and
 * today's come first; "Show more" pages on. The Done view lists the ones closed
 * in the last 14 days and why ("Closed by itself on …", or marked done).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { api, openPdf, type Task } from './automationsApi'
import { toast } from './toast'

const LINK = /(sms:[^\s]+|https?:\/\/[^\s]+|\/api\/automations\/[^\s]+)/g

function Description({ text }: { text: string }) {
  const parts = text.split(LINK)
  return (
    <p className="text-sm text-gray-600 whitespace-pre-line break-words">
      {parts.map((p, i) => {
        if (/^sms:/.test(p)) return <a key={i} href={p} className="btn btn-primary btn-sm my-1" data-task-sms>Send the text</a>
        if (/^https?:\/\//.test(p)) return <a key={i} href={p} target="_blank" rel="noreferrer" className="inline-block max-w-full truncate align-bottom underline text-[color:var(--color-brand)]">{p.replace(/^https?:\/\//, '').slice(0, 48)}</a>
        if (/^\/api\/automations\//.test(p)) return <button key={i} type="button" className="underline text-[color:var(--color-brand)]" onClick={() => openPdf(p).catch(err => toast.error('Could not open it', (err as Error).message))}>Open the PDF</button>
        return <span key={i}>{p}</span>
      })}
    </p>
  )
}

/** "Closed by itself on 10/27/2026: the permit is marked Not needed." on a task the server closed (lib/taskAutoClose.ts). */
const AUTO_CLOSED = /Closed by itself on [^\n]+/

const PAGE = 50
/** How long a task just marked done stays on the list with Undo. */
const UNDO_MS = 8000
const dayOf = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
const wordsDay = (iso: string) => new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' })

export default function TasksList() {
  // Open (overdue and today's first) or Done (closed in the last 14 days, and why); round 6 review, Oct 27 2026.
  const [view, setView] = useState<'open' | 'done'>('open')
  const [shown, setShown] = useState(PAGE)
  const [tasks, setTasks] = useState<Task[] | null>(null)
  const [more, setMore] = useState(false)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    try {
      // One more than is shown: whether there are more to show.
      const list = await api<Task[]>('GET', `/tasks?${view === 'done' ? 'status=completed&days=14&' : ''}limit=${shown + 1}`)
      setTasks(list.slice(0, shown)); setMore(list.length > shown); setError('')
    } catch (err) { setError((err as Error).message) }
  }, [view, shown])
  useEffect(() => { void load(); const t = setInterval(load, 60_000); return () => clearInterval(t) }, [load])
  // Marked done: the row stays a few seconds with Undo (review Oct 27 2026: "Done" read like the Done tab, and a
  // real task was closed by mistake). Undo puts it back as it was (its status before).
  const [closed, setClosed] = useState<Record<string, string>>({})
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  useEffect(() => () => { Object.values(timers.current).forEach(clearTimeout) }, [])
  const forget = (id: string) => { clearTimeout(timers.current[id]); delete timers.current[id]; setClosed(c => { const n = { ...c }; delete n[id]; return n }) }
  async function done(t: Task) {
    setClosed(c => ({ ...c, [t.id]: t.status }))
    timers.current[t.id] = setTimeout(() => { forget(t.id); setTasks(list => list?.filter(x => x.id !== t.id) ?? null) }, UNDO_MS)
    try { await api('PATCH', `/tasks/${t.id}`, { status: 'completed' }) } catch (err) { forget(t.id); toast.error('Could not mark it done', (err as Error).message); void load() }
  }
  async function undo(t: Task) {
    const was = closed[t.id] && closed[t.id] !== 'completed' ? closed[t.id] : 'pending'
    forget(t.id)
    try { await api('PATCH', `/tasks/${t.id}`, { status: was }); toast.success('Back on your list', t.title) } catch (err) { toast.error('Could not undo it', (err as Error).message); void load() }
  }
  function switchTo(v: 'open' | 'done') { if (v === view) return; setView(v); setShown(PAGE); setTasks(null); setMore(false) }
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  const tab = (v: 'open' | 'done', label: string) => (
    <button type="button" role="tab" aria-selected={view === v} onClick={() => switchTo(v)} data-tasks-view={v}
      className={`min-h-[44px] px-3 rounded-lg text-sm font-medium ${view === v ? 'bg-gray-900 text-white' : 'text-gray-700 bg-gray-100'}`}>{label}</button>
  )
  return (
    <section className="bg-white rounded-2xl border border-gray-200" data-tasks data-tasks-showing={view}>
      <div className="px-4 pt-3 pb-1 flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-sm font-semibold text-gray-900">Tasks {view === 'open' && tasks?.length ? <span className="text-gray-500 font-normal">({tasks.length}{more ? '+' : ''})</span> : null}</h2>
        <div className="flex gap-1" role="tablist" aria-label="Which tasks">{tab('open', 'Open')}{tab('done', 'Done')}</div>
      </div>
      {error && <p className="px-4 pb-3 text-sm text-red-700">{error}</p>}
      {!tasks && !error && <p className="px-4 pb-3 text-sm text-gray-500">Loading…</p>}
      {tasks && tasks.length === 0 && <p className="px-4 pb-3 text-sm text-gray-600">{view === 'done' ? 'Nothing closed in the last 14 days.' : 'Nothing on your list.'}</p>}
      {view === 'done' && tasks && tasks.length > 0 && <p className="px-4 pb-1 text-xs text-gray-500">Closed in the last 14 days, newest first.</p>}
      <ul className="divide-y divide-gray-100">
        {tasks?.map(t => {
          if (view === 'done') {
            const auto = t.description?.match(AUTO_CLOSED)?.[0] ?? ''
            const rest = (t.description ?? '').replace(AUTO_CLOSED, '').trim()
            return (
              <li key={t.id} className="px-4 py-3 space-y-1" data-task={t.id} data-task-closed={auto ? 'auto' : 'person'}>
                <p className="text-sm font-semibold text-gray-700">{t.title}</p>
                <p className="text-xs text-gray-500">{[t.jobName, t.assignedTo ? `for ${t.assignedTo}` : ''].filter(Boolean).join(' · ')}</p>
                <p className="text-sm text-green-800" data-task-closed-why>{auto || (t.completedAt ? `Marked done on ${wordsDay(t.completedAt)}.` : 'Marked done.')}</p>
                {rest && <Description text={rest} />}
              </li>
            )
          }
          const due = t.dueDate ? dayOf(t.dueDate) : ''
          if (closed[t.id] !== undefined) return (
            <li key={t.id} className="px-4 py-3 flex gap-3 items-center bg-green-50" data-task={t.id} data-task-just-done>
              <p className="flex-1 min-w-0 text-sm text-green-900"><b>Marked done:</b> {t.title}</p>
              <button type="button" className="btn btn-secondary btn-sm shrink-0 min-h-[44px]" onClick={() => undo(t)} data-task-undo>Undo</button>
            </li>
          )
          return (
            <li key={t.id} className="px-4 py-3 flex gap-3" data-task={t.id}>
              <div className="flex-1 min-w-0 space-y-1">
                <p className="text-sm font-semibold text-gray-900">{t.title}</p>
                <p className="text-xs text-gray-500">{[t.jobName, due ? (due < today ? `overdue (${due})` : due === today ? 'due today' : `due ${due}`) : '', t.assignedTo ? `for ${t.assignedTo}` : ''].filter(Boolean).join(' · ')}</p>
                {t.description && <Description text={t.description} />}
              </div>
              <button type="button" className="btn btn-secondary btn-sm shrink-0" onClick={() => done(t)} data-task-done>Mark done</button>
            </li>
          )
        })}
      </ul>
      {more && <div className="px-4 py-3 border-t border-gray-100"><button type="button" className="btn btn-secondary w-full min-h-[44px]" onClick={() => setShown(n => n + PAGE)} data-tasks-more>Show more</button></div>}
    </section>
  )
}
