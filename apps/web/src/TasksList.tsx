/**
 * My tasks and reminders (from automations, or made by hand elsewhere), on
 * the Today screen. A prepared text opens the phone's messages with the words
 * filled in; a link opens; Done marks it done on the server.
 */

import { useCallback, useEffect, useState } from 'react'
import { api, openPdf, type Task } from './automationsApi'
import { toast } from './toast'

const LINK = /(sms:[^\s]+|https?:\/\/[^\s]+|\/api\/automations\/[^\s]+)/g

function Description({ text }: { text: string }) {
  const parts = text.split(LINK)
  return (
    <p className="text-sm text-gray-600 whitespace-pre-line break-words">
      {parts.map((p, i) => {
        if (/^sms:/.test(p)) return <a key={i} href={p} className="btn btn-primary btn-sm my-1" data-task-sms>Send the text</a>
        if (/^https?:\/\//.test(p)) return <a key={i} href={p} target="_blank" rel="noreferrer" className="underline text-[color:var(--color-brand)] break-all">{p.replace(/^https?:\/\//, '').slice(0, 48)}</a>
        if (/^\/api\/automations\//.test(p)) return <button key={i} type="button" className="underline text-[color:var(--color-brand)]" onClick={() => openPdf(p).catch(err => toast.error('Could not open it', (err as Error).message))}>Open the PDF</button>
        return <span key={i}>{p}</span>
      })}
    </p>
  )
}

export default function TasksList() {
  const [tasks, setTasks] = useState<Task[] | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    try { setTasks(await api<Task[]>('GET', '/tasks')); setError('') } catch (err) { setError((err as Error).message) }
  }, [])
  useEffect(() => { void load(); const t = setInterval(load, 60_000); return () => clearInterval(t) }, [load])
  async function done(t: Task) {
    setTasks(list => list?.filter(x => x.id !== t.id) ?? null)
    try { await api('PATCH', `/tasks/${t.id}`, { status: 'completed' }) } catch (err) { toast.error('Could not mark it done', (err as Error).message); void load() }
  }
  if (!tasks && !error) return null
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  return (
    <section className="bg-white rounded-2xl border border-gray-200" data-tasks>
      <h2 className="px-4 pt-3 pb-1 text-sm font-semibold text-gray-900">Tasks {tasks?.length ? <span className="text-gray-500 font-normal">({tasks.length})</span> : null}</h2>
      {error && <p className="px-4 pb-3 text-sm text-red-700">{error}</p>}
      {tasks && tasks.length === 0 && <p className="px-4 pb-3 text-sm text-gray-600">Nothing on your list.</p>}
      <ul className="divide-y divide-gray-100">
        {tasks?.map(t => {
          const due = t.dueDate ? new Date(t.dueDate).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) : ''
          return (
            <li key={t.id} className="px-4 py-3 flex gap-3" data-task={t.id}>
              <div className="flex-1 min-w-0 space-y-1">
                <p className="text-sm font-semibold text-gray-900">{t.title}</p>
                <p className="text-xs text-gray-500">{[t.jobName, due ? (due < today ? `overdue (${due})` : due === today ? 'due today' : `due ${due}`) : '', t.assignedTo ? `for ${t.assignedTo}` : ''].filter(Boolean).join(' · ')}</p>
                {t.description && <Description text={t.description} />}
              </div>
              <button type="button" className="btn btn-secondary btn-sm shrink-0" onClick={() => done(t)} data-task-done>Done</button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
