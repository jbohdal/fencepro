/**
 * Operations data and the job page.
 *
 * buildUnifiedList turns the Jobs (jobStore) into the one list for the
 * Operations board (OperationsBoard.tsx); DetailPanel is the job
 * page. Stages come from Settings > Operations Stages (opsStagesStore).
 */

import { styleLabel } from './fenceCatalog'
import MediaGallery, { type ShownMedia } from './MediaGallery'
import { getQuotes } from './quoteStore'
import { InstallPacketPanel } from './installPacket'
import PermitPanel from './PermitPanel'
import AutomationRunLog from './AutomationRunLog'
import FinalWalkthroughPanel from './FinalWalkthrough'
import JobTakeoffPanel from './JobTakeoff'
import JobQuotedVsActual from './JobQuotedVsActual'
import JobWarranty from './JobWarranty'
import { ServiceRequestButton, ServiceTicketList } from './ServiceRequests'
import SignedDocuments from './SignedDocuments'
import PaymentsPanel from './Payments'
import { useState, useEffect } from 'react'
import { getJobs, type Job } from './jobStore'
import { useBackLayer } from './nav'
import { stageOf, stageName, stageInfo, stagePhase, nextOpsStage, pickable, useOpsStages } from './opsStagesStore'
import { ChangeOrderPanel, ChangeOrderButton, JobTimeline } from './ChangeOrders'
import { can } from './permissions'
import { archiveRecord, deleteRecord } from './recordArchive'
import { ScheduleInstallButton, bookedWords } from './ScheduleInstall'
import { loadSchedule } from './scheduleStore'

// Unified job type for display
export interface UnifiedJob {
  id: string
  source: 'job'
  customerName: string
  address: string
  fenceType: string
  sections: number
  opsStage: string           // unified stage key
  opsStageLabel: string
  crewAssigned: string
  scheduledDate: string
  contractValue: number
  paymentStatus: string
  amountPaid: number
  notes: string
  salesRep: string
  materialsStatus: string
  drawingComplete: boolean
  locatesDate: string
  locatesExpDate: string
  holdReason: string
  // Raw refs
  rawJob?: Job
}

export function buildUnifiedList(): UnifiedJob[] {
  const jobs = getJobs()
  const result: UnifiedJob[] = []

  // Jobs from jobStore
  for (const j of jobs) {
    const opsStage = stageOf(j)
    result.push({
      id: j.id,
      source: 'job',
      customerName: j.customerName,
      address: j.customerAddress,
      fenceType: j.fenceStyle,
      sections: j.sections,
      opsStage,
      opsStageLabel: stageName(opsStage) || j.status,
      crewAssigned: j.crewAssigned || '',
      scheduledDate: j.scheduledDate || '',
      contractValue: j.contractValue,
      paymentStatus: j.paymentStatus,
      amountPaid: j.amountPaid,
      notes: j.notes || '',
      salesRep: j.salesRep || '',
      materialsStatus: j.materialsStatus,
      drawingComplete: j.drawingComplete,
      locatesDate: j.locatesDate || '',
      locatesExpDate: j.locatesExpDate || '',
      holdReason: j.holdReason || '',
      rawJob: j,
    })
  }

  return result
}

const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)

// ── Detail Panel (Slide-over) ──

// Said in words, not codes.
const MATERIALS_WORDS: Record<string, string> = { not_ordered: 'Not ordered yet', ordered: 'Ordered', received: 'Received', loaded: 'Loaded on the truck' }
const PAYMENT_WORDS: Record<string, string> = { not_invoiced: 'Not invoiced yet', invoiced: 'Invoiced', deposit_paid: 'Deposit paid', partial: 'Partly paid', paid: 'Paid in full' }

export function DetailPanel({ job, onClose, onAdvance, onHold, onUnhold, onMoveStage, onUpdate }: {
  job: UnifiedJob
  onClose: () => void
  onAdvance: () => void
  onHold: () => void
  onUnhold: () => void
  onMoveStage: (stage: string) => void
  onUpdate: (updates: Partial<Job>) => void
}) {
  // Its own address (?job=<id>): Back closes it, a reload reopens it.
  useBackLayer(onClose, { key: 'job', params: { job: job.id } })
  useOpsStages()
  const stage = stageInfo(job.opsStage)
  const inSideLane = stagePhase(job.opsStage) === 'on_hold'
  const canAdvance = !inSideLane && !!nextOpsStage(job.opsStage)
  // The stages a job can go to; a hidden stage the job is in still shows, so you can see where it is.
  const choices = pickable()
  if (stage && !choices.some(s => s.id === stage.id)) choices.push(stage)
  const isJobSource = job.source === 'job'
  const seesPrices = can('prices.view')

  return (
    <div className="fixed inset-y-0 right-0 w-full lg:w-[480px] bg-white shadow-2xl border-l border-gray-200 z-50 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between bg-gray-50">
        <div>
          <h2 className="text-lg font-bold text-gray-900">{job.customerName}</h2>
          <span className="px-2 py-0.5 rounded-full text-xs font-semibold text-white" style={{ backgroundColor: stage?.color ?? '#9ca3af' }} data-ops-stage-pill={job.opsStage}>{stage?.name ?? job.opsStageLabel}</span>
        </div>
        <div className="flex items-center gap-1">
          {/* Change order on a signed job: the yard drawing or typed lines (ChangeOrders.tsx). */}
          {isJobSource && seesPrices && job.rawJob?.quoteId && <ChangeOrderButton quoteId={job.rawJob.quoteId} customerName={job.customerName} className="btn btn-secondary btn-sm min-h-[48px]" />}
          <button onClick={onClose} className="min-w-[48px] min-h-[48px] inline-grid place-items-center text-gray-400 hover:text-gray-600 text-xl">×</button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        {/* Customer Info */}
        <Section title="Customer">
          <Field label="Name" value={job.customerName} />
          <Field label="Address" value={job.address} />
          {job.rawJob?.customerPhone && <Field label="Phone" value={job.rawJob.customerPhone} />}
          {job.rawJob?.customerEmail && <Field label="Email" value={job.rawJob.customerEmail} />}
        </Section>

        {/* Crew & Schedule: near the top, the install is what the office does next with a sold job */}
        <Section title="Crew & Schedule">
          {isJobSource ? (
            <div data-job-schedule>
              {/* One way to schedule: the Schedule install window (start day, crew, crew days on work days, the stage, the text). */}
              <Field label="Install" value={job.scheduledDate ? bookedWords(job.scheduledDate, job.rawJob?.scheduledEndDate, loadSchedule().settings.workDays) : 'Not scheduled'} />
              <Field label="Crew" value={job.crewAssigned || 'Not assigned'} />
              <Field label="Sales Rep" value={job.salesRep} />
              {can('schedule.change') && !inSideLane && <div className="mt-2"><ScheduleInstallButton jobId={job.id} scheduledDate={job.scheduledDate} /></div>}
            </div>
          ) : (
            <>
              <Field label="Crew" value={job.crewAssigned || 'Not assigned'} />
              <Field label="Scheduled" value={job.scheduledDate || 'Not scheduled'} />
            </>
          )}
        </Section>

        {/* Scope */}
        <Section title="Scope of Work">
          <Field label="Fence Type" value={styleLabel(job.fenceType)} />
          <Field label="Sections" value={String(job.sections)} />
          {job.rawJob && <Field label="Total Feet" value={String(job.rawJob.totalFeet || 0)} />}
          {job.rawJob && <Field label="Walk Gates" value={String(job.rawJob.walkGates)} />}
          {job.rawJob && <Field label="Double Gates" value={String(job.rawJob.dblGates)} />}
        </Section>

        {/* Operations Status */}
        <Section title="Operations Stage">
          <div className="flex flex-wrap gap-1">
            {choices.map(s => (
              <button key={s.id} onClick={() => onMoveStage(s.id)} disabled={!isJobSource || job.opsStage === s.id} data-ops-stage-choice={s.id}
                className={`px-3 min-h-[48px] min-w-[48px] rounded-lg text-xs font-medium transition ${
                  job.opsStage === s.id ? 'text-white' : 'border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-30'
                }`}
                style={job.opsStage === s.id ? { backgroundColor: s.color } : { borderLeft: `4px solid ${s.color}` }}>
                {s.name}{s.lane === 'side' ? ' (side lane)' : ''}
              </button>
            ))}
          </div>
        </Section>

        {isJobSource && (
          <div className="mt-5">
            <JobMedia job={job} />
          </div>
        )}

        {/* Job costing: the takeoff right before the walkthrough; quoted vs actual for the owner and office. */}
        {isJobSource && job.rawJob && <JobTakeoffPanel job={job.rawJob} />}
        {isJobSource && job.rawJob && <FinalWalkthroughPanel job={job.rawJob} />}
        {isJobSource && <JobQuotedVsActual jobId={job.id} />}
        {/* The payment schedule from the contract, Payment received and receipts (Payments.tsx). */}
        {/* The Installer sees the work, never a price (Jonathan, Oct 25, 2026): no payments, contract, change orders or history of them. */}
        {isJobSource && seesPrices && <Section title="Payments"><PaymentsPanel jobId={job.id} /></Section>}
        {/* Warranty and service requests on this fence (ServiceRequests.tsx). */}
        {isJobSource && <Section title="Warranty and service"><div className="space-y-2" data-job-service><ServiceRequestButton jobId={job.id} /><ServiceTicketList jobId={job.id} title="Requests on this job" /></div></Section>}
        {/* The warranty it was signed with, its dates, and whether service calls on it are covered. */}
        {isJobSource && job.rawJob && <JobWarranty job={job.rawJob} />}
        {/* The signed contract and signed change orders of this job, as stored at signing (SignedDocuments.tsx). */}
        {isJobSource && seesPrices && <div className="mt-3"><SignedDocuments which={{ jobId: job.id }} heading="Documents" /></div>}

        {isJobSource && (
          <Section title="Install packet">
            <InstallPacketPanel jobId={job.id} job={{ fenceStyle: job.fenceType, notes: job.notes, walkGates: job.rawJob?.walkGates, dblGates: job.rawJob?.dblGates, customerName: job.customerName }}
              quote={job.rawJob?.quoteId ? getQuotes().find(q => q.id === job.rawJob!.quoteId) : undefined} />
          </Section>
        )}

        {isJobSource && <Section title="Permit"><PermitPanel jobId={job.id} /></Section>}
        {isJobSource && <AutomationRunLog entityId={job.id} />}

        {/* Readiness Checklist */}
        <Section title="Milestone Checklist">
          {isJobSource ? <MilestoneChecklist jobId={job.id} /> : <p className="text-xs text-gray-400">Only available for Job records.</p>}
        </Section>

        {/* Derived readiness hints (from legacy job fields) */}
        <Section title="Readiness Signals">
          <CheckItem label="Locates" done={!!job.locatesDate} detail={job.locatesDate ? `Good: ${job.locatesDate} • Exp: ${job.locatesExpDate}` : 'Not called'} />
          <CheckItem label="Drawing" done={job.drawingComplete} />
          <CheckItem label="Materials" done={job.materialsStatus === 'received' || job.materialsStatus === 'loaded'} detail={MATERIALS_WORDS[job.materialsStatus] ?? job.materialsStatus} />
          <CheckItem label="Pull Sheet" done={job.rawJob?.pullSheetPulled || false} />
        </Section>

        {/* Pricing & Payment */}
        {seesPrices && <Section title="Financial">
          <Field label="Contract Value" value={fmt(job.contractValue)} />
          <Field label="Amount Paid" value={fmt(job.amountPaid)} />
          <Field label="Outstanding" value={fmt(job.contractValue - job.amountPaid)} />
          <Field label="Payment Status" value={PAYMENT_WORDS[job.paymentStatus] ?? job.paymentStatus} />
        </Section>}

        {/* Change orders: the signed quote is locked, changes to the work go here; approved ones are in the contract value. */}
        {isJobSource && seesPrices && job.rawJob?.quoteId && (
          <Section title="Change Orders">
            <ChangeOrderPanel quoteId={job.rawJob.quoteId} originalPrice={job.rawJob.quotePrice || 0} customerName={job.customerName} />
          </Section>
        )}

        {/* The job's history: contract, change orders, payment schedule, pull sheet revisions; a schedule warning (ChangeOrders.tsx). */}
        {isJobSource && seesPrices && <Section title="Job history"><JobTimeline jobId={job.id} /></Section>}

        {/* Notes */}
        <Section title="Notes">
          {isJobSource ? (
            <textarea value={job.notes} onChange={e => onUpdate({ notes: e.target.value })} rows={3}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          ) : (
            <p className="text-sm text-gray-600">{job.notes || 'No notes'}</p>
          )}
        </Section>

        {/* Hold info */}
        {inSideLane && job.holdReason && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3">
            <p className="text-xs font-semibold text-red-700">Hold Reason</p>
            <p className="text-sm text-red-600 mt-1">{job.holdReason}</p>
          </div>
        )}

        {isJobSource && <JobArchiveDelete job={job} onClose={onClose} />}
      </div>

      {/* Footer actions */}
      {isJobSource && (
        <div className="px-6 py-4 border-t border-gray-200 flex gap-2">
          {inSideLane ? (
            <button onClick={onUnhold} className="flex-1 bg-green-600 hover:bg-green-700 text-white py-2 rounded-lg text-sm font-medium">Resume</button>
          ) : (
            <>
              <button onClick={onAdvance} disabled={!canAdvance} data-ops-advance
                className="btn btn-primary flex-1 disabled:opacity-40">
                {canAdvance ? `Advance to ${nextOpsStage(job.opsStage)!.name} →` : 'Advance Stage →'}
              </button>
              <button onClick={onHold}
                className="px-4 py-2 border border-red-200 text-red-600 rounded-lg text-sm font-medium hover:bg-red-50">
                Hold
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Archive (everyday: off the board, kept for search and reports; Unarchive is
 * on the customer's page) and Delete (owner, admin: to Settings > Deleted
 * Records with its schedule entries, appointments and invoices).
 */
function JobArchiveDelete({ job, onClose }: { job: UnifiedJob; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  const canArchive = can('records.archive') && can('schedule.change')
  const canDelete = can('records.delete')
  if (!canArchive && !canDelete) return null
  async function archive() {
    setBusy(true)
    const r = await archiveRecord('job', job.id)
    setBusy(false)
    if (!r.ok) { toast.error('Not archived', r.error || 'Try again.'); return }
    toast.success('Job archived', 'Off the board. Search and reports still have it; Unarchive is on the customer\'s page.')
    onClose()
  }
  async function remove() {
    if (!confirm(`Delete the job for ${job.customerName || 'this customer'}? Its schedule entries, appointments and invoices go with it. The owner or an admin can restore it from Settings > Deleted Records.`)) return
    setBusy(true)
    const r = await deleteRecord('job', job.id)
    setBusy(false)
    if (!r.ok) { toast.error('Not deleted', r.error || 'Try again.'); return }
    toast.success('Job deleted', 'Restore it from Settings > Deleted Records.')
    onClose()
  }
  return (
    <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100" data-job-record-actions>
      {canArchive && <button className="btn btn-secondary btn-sm min-h-[44px]" disabled={busy} onClick={archive} data-job-archive>Archive job</button>}
      {canDelete && <button className="btn btn-quiet btn-sm min-h-[44px] text-red-700" disabled={busy} onClick={remove} data-job-delete>Delete job…</button>}
    </div>
  )
}

// ── Shared sub-components ──

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-gray-400 mb-2">{title}</h3>
      <div className="space-y-1.5">{children}</div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-900">{value || '—'}</span>
    </div>
  )
}

function CheckItem({ label, done, detail }: { label: string; done: boolean; detail?: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className={`w-4 h-4 rounded-full flex items-center justify-center text-xs ${done ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-400'}`}>
        {done ? '✓' : ''}
      </div>
      <span className={`text-sm ${done ? 'text-gray-900' : 'text-gray-400'}`}>{label}</span>
      {detail && <span className="text-xs text-gray-400 ml-auto">{detail}</span>}
    </div>
  )
}

import { getChecklistForJob, toggleChecklistItem, type ChecklistItem } from './checklistStore'
import { toast } from './toast'

function MilestoneChecklist({ jobId }: { jobId: string }) {
  const [items, setItems] = useState<ChecklistItem[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)

  function reload() { setItems(getChecklistForJob(jobId)) }
  useEffect(() => {
    reload()
    const onUpdate = () => reload()
    window.addEventListener('fencepro:checklist:updated', onUpdate)
    return () => window.removeEventListener('fencepro:checklist:updated', onUpdate)
  }, [jobId])

  function handleToggle(item: ChecklistItem) {
    setBusyId(item.id)
    // Optimistic
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, isComplete: !i.isComplete } : i))
    try {
      const updated = toggleChecklistItem(jobId, item.id, 'user')
      if (!updated) throw new Error('Item not found')
    } catch (err: any) {
      // Revert
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, isComplete: item.isComplete } : i))
      toast.error('Could not update milestone', err?.message || 'Unknown error')
    } finally {
      setBusyId(null)
    }
  }

  const complete = items.filter(i => i.isComplete).length
  const pct = items.length > 0 ? (complete / items.length) * 100 : 0

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-gray-500">{complete} of {items.length} complete</span>
        <div className="flex-1 mx-3 h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div className="h-1.5 bg-orange-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
        </div>
        <span className="text-gray-500">{Math.round(pct)}%</span>
      </div>
      {items.map(item => (
        <label key={item.id}
          className={`flex items-center gap-3 px-2 min-h-[48px] rounded-lg cursor-pointer transition-colors ${item.isComplete ? 'bg-green-50' : 'hover:bg-gray-50'} ${busyId === item.id ? 'opacity-60' : ''}`}>
          <input type="checkbox" checked={item.isComplete}
            onChange={() => handleToggle(item)}
            disabled={busyId === item.id}
            className="w-6 h-6 accent-orange-500 cursor-pointer" />
          <span className={`text-sm flex-1 ${item.isComplete ? 'text-gray-900 line-through' : 'text-gray-700'}`}>{item.label}</span>
          {item.isComplete && item.completedAt && (
            <span className="text-[10px] text-gray-400">{new Date(item.completedAt).toLocaleDateString()}</span>
          )}
        </label>
      ))}
    </div>
  )
}

/** A job's photos and video, with pins on its quote's site plan. */
function JobMedia({ job }: { job: UnifiedJob }) {
  const quote = job.rawJob?.quoteId ? getQuotes().find(q => q.id === job.rawJob!.quoteId) : undefined
  const [, setItems] = useState<ShownMedia[]>([])
  return (
    <MediaGallery where={{ jobId: job.id }} layout={quote?.layout?.yard ?? null} defaultCategory="Progress" title="Photos and video" onItems={setItems} />
  )
}
