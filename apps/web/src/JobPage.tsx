/**
 * The job page, read only, for the Salesman (Jonathan, Oct 28 2026, audit
 * #49: "Open the job page to the Salesman read only, without costs").
 *
 * At /job?id=<job id>. The Salesman opens it from the customer page's Jobs
 * tab and from a sold quote's window ("Open the job"); Operations (the board
 * and other jobs) stays closed to the Salesman. A login that can open
 * Operations is sent to the job's window there instead.
 *
 * What it shows: the customer, the sale price the customer agreed to, the
 * install (day, crew, rep), the stage, materials, the work, the milestones
 * and the job history. Nothing on it changes the job: no stage moves,
 * Advance, hold, materials, scheduling, rain day, notes or ticks. The server
 * sends the Salesman only the Salesman's own jobs, without costs, and refuses
 * the Salesman's job writes (portal lib/salesmanJobs.ts).
 */

import { useEffect, useState } from 'react'
import { fetchJob, type Job } from './jobStore'
import { canOpenOperations } from './permissions'
import { navigate, useNav, openedFrom, goBack } from './nav'
import { stageInfo, stageOf, stagePhase, useOpsStages } from './opsStagesStore'
import { bookedWords } from './ScheduleInstall'
import { loadSchedule, crewName } from './scheduleStore'
import { getQuotes } from './quoteStore'
import { soldStyleLabel } from './soldStyleLabel'
import { styleLabel } from './fenceCatalog'
import { workScope, type SavedWork } from './moveRepair'
import { jobInstallWord } from './jobWork'
import { hasDrawing } from './jobDrawing'
import { CustomerContact, JobMilestones, OpenCustomerProfile } from './JobTruth'
import { JobTimeline } from './ChangeOrders'
import { backLinkWords } from './customerPage'

const MATERIALS_WORDS: Record<string, string> = { not_ordered: 'Not ordered yet', ordered: 'Ordered', received: 'Received', loaded: 'Loaded on the truck' }
const money = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n || 0)

export default function JobPage() {
  const nav = useNav()
  const id = nav.params.get('id') ?? ''
  useOpsStages()
  const [job, setJob] = useState<Job | null>(null)
  const [error, setError] = useState('')
  const [tries, setTries] = useState(0)

  // The office, the owner and the Installer have the job's window in Operations.
  const toOperations = !!id && canOpenOperations()
  useEffect(() => {
    if (toOperations) navigate(`/operations?job=${encodeURIComponent(id)}`, { replace: true })
  }, [toOperations, id])

  useEffect(() => {
    if (!id || toOperations) return
    let live = true
    setError('')
    void fetchJob(id).then(r => {
      if (!live) return
      if (r.ok) setJob(r.job)
      else { setJob(null); setError(r.error) }
    })
    return () => { live = false }
  }, [id, toOperations, tries])

  // The office moves the job, orders materials and books the install: the page reads it again when the jobs change.
  useEffect(() => {
    const h = () => setTries(t => t + 1)
    window.addEventListener('fencepro:jobs:updated', h)
    return () => window.removeEventListener('fencepro:jobs:updated', h)
  }, [])

  const back = openedFrom()
  const backButton = (
    <button type="button" onClick={() => goBack('/customers')} data-job-page-back
      className="flex items-center gap-2 min-h-[44px] text-sm font-semibold text-orange-600">
      <span aria-hidden>←</span><span>{backLinkWords(back)}</span>
    </button>
  )

  if (toOperations) return null
  if (!id) return <div className="max-w-2xl mx-auto space-y-3">{backButton}<p className="text-sm text-gray-700">No job was named. Open a job from the customer's Jobs tab.</p></div>
  if (error) return (
    <div className="max-w-2xl mx-auto space-y-3" data-job-page-error>
      {backButton}
      <p className="text-sm text-gray-800">{error}</p>
      <button type="button" className="btn btn-secondary min-h-[44px]" onClick={() => setTries(t => t + 1)}>Try again</button>
    </div>
  )
  if (!job) return <div className="max-w-2xl mx-auto space-y-3">{backButton}<p className="text-sm text-gray-500">Loading the job…</p></div>

  const stageId = stageOf(job)
  const stage = stageInfo(stageId)
  const onHold = stagePhase(stageId) === 'on_hold'
  const W = jobInstallWord(job)
  const quote = job.quoteId ? getQuotes().find(q => q.id === job.quoteId) : undefined
  const scope = workScope((quote as { work?: SavedWork | null } | undefined)?.work ?? null)

  return (
    <div className="max-w-2xl mx-auto space-y-4 pb-6" data-job-page={job.id} data-job-read-only>
      {backButton}
      <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-gray-900 break-words">{job.customerName || 'Job'}</h1>
            <p className="text-sm text-gray-600 break-words">{job.customerAddress}</p>
          </div>
          <span className="shrink-0 px-2 py-0.5 rounded-full text-xs font-semibold text-white" style={{ backgroundColor: stage?.color ?? '#9ca3af' }} data-ops-stage-pill={stageId}>{stage?.name ?? job.status}</span>
        </div>
        <p className="text-xs text-gray-500">Read only. The office moves the job, orders the materials and books the {W.toLowerCase()}.</p>
      </div>

      {onHold && job.holdReason && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3" data-job-hold>
          <p className="text-xs font-semibold text-red-700">On hold</p>
          <p className="text-sm text-red-700 mt-1">{job.holdReason}</p>
        </div>
      )}

      <Card title="Customer">
        <Row label="Name" value={job.customerName} />
        <Row label="Address" value={job.customerAddress} />
        <CustomerContact job={job} />
        {job.customerEmail && <Row label="Email" value={job.customerEmail} />}
      </Card>

      <Card title="Sale">
        <Row label="Sold for" value={money(job.contractValue || job.quotePrice)} attr="data-job-sold-for" />
        {job.changeOrderTotal ? <Row label="Change orders" value={`${job.changeOrderTotal > 0 ? '+' : '−'}${money(Math.abs(job.changeOrderTotal))}`} /> : null}
        <Row label="Sales Rep" value={job.salesRep} />
      </Card>

      <Card title={W}>
        <Row label={W} value={job.scheduledDate ? bookedWords(job.scheduledDate, job.scheduledEndDate, loadSchedule().settings.workDays) : 'Not scheduled yet'} attr="data-job-install-day" />
        <Row label="Crew" value={crewName(job.crewAssigned) || 'Not assigned yet'} />
        {job.completedDate && <Row label="Finished" value={job.completedDate} />}
      </Card>

      <Card title="Materials">
        <Row label="Materials" value={MATERIALS_WORDS[job.materialsStatus] ?? job.materialsStatus} attr="data-job-materials" />
        <Row label="Pull sheet" value={job.pullSheetPulled ? 'Pulled' : 'Not pulled yet'} />
        <Row label="Drawing" value={hasDrawing({ drawingComplete: job.drawingComplete }, quote as any) ? 'Done' : 'Not yet'} />
      </Card>

      <Card title="The work">
        {scope ? (
          <div data-job-work-scope={scope.title}>
            <Row label="Job" value={scope.title} />
            {job.fenceStyle && <Row label="Existing fence" value={styleLabel(job.fenceStyle)} />}
            <ul className="mt-1 space-y-1 text-sm text-gray-800 list-disc pl-5">{scope.items.map((t, i) => <li key={i}>{t}</li>)}</ul>
          </div>
        ) : (
          <>
            <Row label="Fence" value={soldStyleLabel(job.fenceStyle, quote as any)} />
            <Row label="Sections" value={String(job.sections)} />
            <Row label="Total feet" value={String(job.totalFeet || 0)} />
            <Row label="Walk gates" value={String(job.walkGates)} />
            <Row label="Double gates" value={String(job.dblGates)} />
          </>
        )}
      </Card>

      <Card title="Milestones"><JobMilestones job={job} /></Card>

      <Card title="Job history"><JobTimeline jobId={job.id} refreshKey={`${stageId}|${job.updatedAt ?? ''}`} /></Card>

      {job.notes && (
        <Card title="Notes"><p className="text-sm text-gray-800 whitespace-pre-wrap break-words" data-job-notes>{job.notes}</p></Card>
      )}

      <OpenCustomerProfile job={job} from="Job" />
    </div>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-2xl border border-gray-200 p-4">
      <h2 className="text-xs font-semibold text-gray-500 mb-2">{title}</h2>
      <div className="space-y-1.5">{children}</div>
    </section>
  )
}

function Row({ label, value, attr }: { label: string; value: string; attr?: string }) {
  return (
    <div className="flex justify-between gap-3 text-sm" {...(attr ? { [attr]: '' } : {})}>
      <span className="text-gray-500 shrink-0">{label}</span>
      <span className="font-medium text-gray-900 text-right break-words min-w-0">{value || '—'}</span>
    </div>
  )
}
