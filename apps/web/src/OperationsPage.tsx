/**
 * Operations data and the job page.
 *
 * buildUnifiedList turns the Jobs (jobStore) into the one list for the
 * Operations board (OperationsBoard.tsx); DetailPanel is the job
 * page. Stages come from Settings > Operations Stages (opsStagesStore).
 */

import { styleLabel } from './fenceCatalog'
import { soldStyleLabel } from './soldStyleLabel'
import MediaGallery, { type ShownMedia } from './MediaGallery'
import { getQuotes } from './quoteStore'
import { hasDrawing } from './jobDrawing'
import { workScope, type SavedWork } from './moveRepair'
import { isRepairJob, jobInstallWord } from './jobWork'
import { InstallPacketPanel, fetchCrewInstall, crewInstallCached, CREW_INSTALL_EVENT, type CrewInstall } from './installPacket'
import { finishedStageWords } from './crewWords'
import { dayText } from './warranties'
import PermitPanel from './PermitPanel'
import AutomationRunLog from './AutomationRunLog'
import FinalWalkthroughPanel from './FinalWalkthrough'
import JobTakeoffPanel from './JobTakeoff'
import JobQuotedVsActual from './JobQuotedVsActual'
import JobWarranty from './JobWarranty'
import { ServiceRequestButton, ServiceTicketList } from './ServiceRequests'
import SignedDocuments from './SignedDocuments'
import PaymentsPanel from './Payments'
import { useEffect, useState } from 'react'
import { getJobs, refreshJobs, type Job } from './jobStore'
import { useBackLayer } from './nav'
import { stageOf, stageName, stageInfo, stagePhase, nextOpsStage, advanceStage, pickable, useOpsStages, getCompleteOpsStage } from './opsStagesStore'
import { useMilestoneSummary, permitOkOf } from './jobTruthApi'
import { isDonePhase } from './opsStageModel'
import { ChangeOrderPanel, ChangeOrderButton, JobTimeline, useChangeOrdersLive } from './ChangeOrders'
import { can, isCrewLogin } from './permissions'
import { archiveRecord, deleteRecord } from './recordArchive'
import { ScheduleInstallButton, bookedWords } from './ScheduleInstall'
import { loadSchedule, crewName } from './scheduleStore'
import { CustomerContact, LocatePanel, JobMilestones, JobFinancial, OpenCustomerProfile } from './JobTruth'

// Unified job type for display
export interface UnifiedJob {
  id: string
  source: 'job'
  customerName: string
  address: string
  fenceType: string
  /** A repair or a fence move (from its quote), else a new fence. */
  jobKind?: 'repair' | 'move' | null
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
      jobKind: kindOfQuote(j.quoteId),
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

/** A repair or a fence move, from the job's quote (moveRepair.ts); null for a new fence. */
export function kindOfQuote(quoteId: string | null | undefined): 'repair' | 'move' | null {
  const t = quoteId ? (getQuotes().find(q => q.id === quoteId) as { work?: { type?: string } | null } | undefined)?.work?.type : null
  return t === 'repair' || t === 'move' ? t : null
}

/** The job has its drawing: marked drawn, or its quote has a builder yard or the customer's website drawing (jobDrawing.ts, the server's jobHasDrawing). */
export function jobIsDrawn(j: { drawingComplete?: boolean; rawJob?: { drawingComplete?: boolean | null; quoteId?: string | null } }): boolean {
  const quoteId = j.rawJob?.quoteId
  const quote = quoteId ? getQuotes().find(q => q.id === quoteId) as { layout?: { yard?: unknown; widgetDrawing?: unknown } | null } | undefined : null
  return hasDrawing({ drawingComplete: j.rawJob?.drawingComplete ?? j.drawingComplete }, quote)
}

/** How the board names the job's fence: "Repair · White Vinyl …" for a repair or move; a sold best price job names its panels (soldStyleLabel). */
export function fenceText(j: { fenceType: string; jobKind?: 'repair' | 'move' | null; rawJob?: { quoteId?: string | null } }): string {
  const quoteId = j.rawJob?.quoteId
  const style = soldStyleLabel(j.fenceType, quoteId ? getQuotes().find(q => q.id === quoteId) as any : null)
  if (!j.jobKind) return style
  return [j.jobKind === 'repair' ? 'Repair' : 'Fence move', style].filter(Boolean).join(' · ')
}

const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)

// ── Detail Panel (Slide-over) ──

// Said in words, not codes.
const MATERIALS_WORDS: Record<string, string> = { not_ordered: 'Not ordered yet', ordered: 'Ordered', received: 'Received', loaded: 'Loaded on the truck' }

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
  // The server moves a job on its own (a payment, the walkthrough signed on the homeowner's phone, the crew's
  // Finish close it out): the window reads the job again when it opens and every 20 seconds while open, so it
  // never offers a move from a stage the job has left (round 2b, Oct 26 2026: a Paid job showed "In Progress").
  useEffect(() => {
    void refreshJobs()
    const t = window.setInterval(() => { void refreshJobs() }, 20_000)
    return () => window.clearInterval(t)
  }, [job.id])
  // Its change orders too (a customer signs one on their link): the documents, packet notice, payments and
  // contract below follow when one changes (ChangeOrders.tsx useChangeOrdersLive, CO_EVENT).
  useChangeOrdersLive(can('prices.view') ? job.rawJob?.quoteId : null)
  const stage = stageInfo(job.opsStage)
  const inSideLane = stagePhase(job.opsStage) === 'on_hold'
  // Complete, Invoiced, Paid: closed. No Move install, no Hold, no Advance; going back is Reopen (owner, office).
  const closed = isDonePhase(stagePhase(job.opsStage))
  // Past Permit Pending when the permit is not needed or issued (the board's summary, read again when the permit is saved).
  useMilestoneSummary()
  const permitOk = permitOkOf(job.id)
  // A repair has no drawing to make: Advance passes over Need Drawing, and the page says Repair, not Install (recheck Oct 27 2026).
  const repair = isRepairJob(job.rawJob)
  const W = jobInstallWord(job.rawJob)
  const canAdvance = !inSideLane && !!advanceStage(job.opsStage, permitOk, repair)
  // The stages a job can go to; a hidden stage the job is in still shows, so you can see where it is.
  const choices = pickable()
  if (stage && !choices.some(s => s.id === stage.id)) choices.push(stage)
  const isJobSource = job.source === 'job'
  const seesPrices = can('prices.view')
  const crew = isCrewLogin()
  // The installer: his Finish under the stage ("Finished October 27, 2026, waiting on the final walkthrough"), from the
  // same crew facts as his home (installPacket.tsx), kept current when he taps Start or Finish.
  const [crewInfo, setCrewInfo] = useState<CrewInstall | null>(() => (crew ? crewInstallCached(job.id) : null))
  useEffect(() => {
    if (!crew || job.source !== 'job') return
    void fetchCrewInstall(job.id).then(r => { if (r) setCrewInfo(r) })
    const on = (e: Event) => { if ((e as CustomEvent).detail?.jobId === job.id) setCrewInfo(crewInstallCached(job.id)) }
    window.addEventListener(CREW_INSTALL_EVENT, on)
    return () => window.removeEventListener(CREW_INSTALL_EVENT, on)
  }, [crew, job.id, job.source])
  const finishedNote = crew ? finishedStageWords(crewInfo, dayText) : ''
  // A repair or move job: its items from the quote (moveRepair.ts workScope).
  const scope = workScope(job.rawJob?.quoteId ? (getQuotes().find(q => q.id === job.rawJob!.quoteId) as { work?: SavedWork | null } | undefined)?.work : null)

  return (
    <div className="fixed inset-y-0 right-0 w-full lg:w-[480px] bg-white shadow-2xl border-l border-gray-200 z-50 flex flex-col overflow-hidden" data-job-panel={job.id}>
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
          {/* "(352) 671 8083": tap to call or text (JobTruth.tsx). */}
          {job.rawJob ? <CustomerContact job={job.rawJob} /> : null}
          {job.rawJob?.customerEmail && <Field label="Email" value={job.rawJob.customerEmail} />}
        </Section>

        {/* Crew & Schedule: near the top, the install is what the office does next with a sold job */}
        <Section title="Crew & Schedule">
          {isJobSource ? (
            <div data-job-schedule>
              {/* One way to schedule: the Schedule install window (start day, crew, crew days on work days, the stage, the text). */}
              <Field label={W} value={job.scheduledDate ? bookedWords(job.scheduledDate, job.rawJob?.scheduledEndDate, loadSchedule().settings.workDays) : 'Not scheduled'} />
              <Field label="Crew" value={crewName(job.crewAssigned) || 'Not assigned'} />
              <Field label="Sales Rep" value={job.salesRep} />
              {can('schedule.change') && !inSideLane && !closed && <div className="mt-2"><ScheduleInstallButton jobId={job.id} scheduledDate={job.scheduledDate} word={W} /></div>}
            </div>
          ) : (
            <>
              <Field label="Crew" value={crewName(job.crewAssigned) || 'Not assigned'} />
              <Field label="Scheduled" value={job.scheduledDate || 'Not scheduled'} />
            </>
          )}
        </Section>

        {/* Scope */}
        <Section title="Scope of Work">
          {scope ? <>
            <Field label="Fence Type" value={scope.title} />
            {job.fenceType && <Field label="Existing fence" value={styleLabel(job.fenceType)} />}
          </> : <Field label="Fence Type" value={soldStyleLabel(job.fenceType, job.rawJob?.quoteId ? getQuotes().find(q => q.id === job.rawJob!.quoteId) as any : null)} />}
          {scope ? (
            // A repair or a move: what the crew does, from the quote (not a new fence's feet and sections).
            <div data-job-work-scope={scope.title}>
              <Field label="Job" value={scope.title} />
              <ul className="mt-1 space-y-1 text-sm text-gray-800 list-disc pl-5" data-job-work-items>
                {scope.items.map((t, i) => <li key={i}>{t}</li>)}
              </ul>
            </div>
          ) : (
            <>
              <Field label="Sections" value={String(job.sections)} />
              {job.rawJob && <Field label="Total Feet" value={String(job.rawJob.totalFeet || 0)} />}
              {job.rawJob && <Field label="Walk Gates" value={String(job.rawJob.walkGates)} />}
              {job.rawJob && <Field label="Double Gates" value={String(job.rawJob.dblGates)} />}
            </>
          )}
        </Section>

        {/* Operations Status */}
        <Section title="Operations Stage">
          {/* The Installer sees the stage; moving it is the office's. */}
          {crew ? <>
            <p className="text-sm text-gray-800" data-ops-stage-readonly>{stage?.name ?? job.opsStageLabel}</p>
            {finishedNote && <p className="text-sm text-green-800 mt-1" data-ops-stage-finished>{finishedNote}</p>}
          </> : (
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
          )}
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
        {isJobSource && <Section title="Warranty and service"><div className="space-y-2" data-job-service>{!crew && <ServiceRequestButton jobId={job.id} />}<ServiceTicketList jobId={job.id} title="Requests on this job" /></div></Section>}
        {/* The warranty it was signed with, its dates, and whether service calls on it are covered. */}
        {isJobSource && job.rawJob && <JobWarranty job={job.rawJob} />}
        {/* The signed contract and signed change orders of this job, as stored at signing (SignedDocuments.tsx). */}
        {isJobSource && seesPrices && <div className="mt-3"><SignedDocuments which={{ jobId: job.id }} heading="Documents" /></div>}

        {isJobSource && (
          <Section title={`${W} packet`}>
            <InstallPacketPanel jobId={job.id} job={{ fenceStyle: job.fenceType, notes: job.notes, walkGates: job.rawJob?.walkGates, dblGates: job.rawJob?.dblGates, customerName: job.customerName }}
              quote={job.rawJob?.quoteId ? getQuotes().find(q => q.id === job.rawJob!.quoteId) : undefined} />
          </Section>
        )}

        {/* The 811 locate: one record, the crew packet edits the same (JobTruth.tsx, portal lib/locates.ts). */}
        {isJobSource && job.rawJob && <Section title="811 locate"><LocatePanel job={job.rawJob} /></Section>}
        {isJobSource && !crew && <Section title="Permit"><PermitPanel jobId={job.id} /></Section>}
        {isJobSource && <AutomationRunLog entityId={job.id} job />}

        {/* The milestones, from the job's records: the locate, the permit, materials, the schedule, the walkthrough, photos, the payment schedule (portal lib/jobReadiness.ts). */}
        <Section title="Milestone Checklist">
          {isJobSource && job.rawJob ? <JobMilestones job={job.rawJob} onMarkInstalled={() => { const done = getCompleteOpsStage(); if (done) onMoveStage(done.id) }} /> : <p className="text-xs text-gray-400">Only available for Job records.</p>}
        </Section>

        {/* What the milestones do not cover. */}
        <Section title="Readiness Signals">
          {/* Drawn in the quote builder or on the website counts too (the same test that moves the card; round 2, Oct 28 2026). */}
          <CheckItem label="Drawing" done={jobIsDrawn(job)} />
          <CheckItem label="Pull Sheet" done={job.rawJob?.pullSheetPulled || false} detail={MATERIALS_WORDS[job.materialsStatus] ? `Materials: ${MATERIALS_WORDS[job.materialsStatus]}` : undefined} />
        </Section>

        {/* Pricing & Payment: from the payment schedule, the same as Payments below and Billing. */}
        {seesPrices && <Section title="Financial">
          {job.rawJob ? <JobFinancial job={job.rawJob} /> : <Field label="Contract Value" value={fmt(job.contractValue)} />}
        </Section>}

        {/* Change orders: the signed quote is locked, changes to the work go here; approved ones are in the contract value. */}
        {isJobSource && seesPrices && job.rawJob?.quoteId && (
          <Section title="Change Orders">
            <ChangeOrderPanel quoteId={job.rawJob.quoteId} originalPrice={job.rawJob.quotePrice || 0} customerName={job.customerName} />
          </Section>
        )}

        {/* The job's history: contract, change orders, payment schedule, pull sheet revisions; a schedule warning (ChangeOrders.tsx). */}
        {isJobSource && seesPrices && <Section title="Job history"><JobTimeline jobId={job.id} refreshKey={`${job.opsStage}|${job.rawJob?.updatedAt ?? ''}`} /></Section>}

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
        {/* The customer's page, as on the Sales Pipeline card window. */}
        {isJobSource && job.rawJob && <OpenCustomerProfile job={job.rawJob} />}
      </div>

      {/* Footer actions */}
      {isJobSource && !crew && !isDonePhase(job.rawJob?.status) && !inSideLane && (
        <p className="px-6 pt-2 text-[11px] text-gray-500 border-t border-gray-200" data-job-closeout-hint>It moves to {getCompleteOpsStage()?.name ?? 'Complete'} by itself once all three are done, in any order: the crew finished the {W.toLowerCase()} (Finish on the last {W.toLowerCase()} day, or its last {W.toLowerCase()} day has passed), the final walkthrough is signed, and it is paid in full.</p>
      )}
      {/* Stage moves and hold are the office's; the Installer has his own Start / Finish on My installs. */}
      {isJobSource && !crew && (
        <div className="px-6 py-4 flex gap-2">
          {inSideLane ? (
            <button onClick={onUnhold} className="flex-1 bg-green-600 hover:bg-green-700 text-white py-2 rounded-lg text-sm font-medium">Resume</button>
          ) : (
            <>
              {/* A finished job (Complete, Invoiced, Paid) is not advanced or held; it says where it is. Going back is a stage button above (Reopen). */}
              {closed ? (
                <p className="flex-1 self-center text-sm font-semibold text-green-700" data-ops-done>{stage?.name ?? 'Complete'}{can('schedule.change') ? <span className="block text-[11px] font-normal text-gray-500">Closed. To reopen it, tap an earlier stage above.</span> : null}</p>
              ) : (
                <button onClick={onAdvance} disabled={!canAdvance} data-ops-advance
                  className="btn btn-primary flex-1 disabled:opacity-40">
                  {canAdvance ? `Advance to ${advanceStage(job.opsStage, permitOk, repair)!.name} →` : 'Advance Stage →'}
                </button>
              )}
              {!closed && <button onClick={onHold} data-ops-hold
                className="px-4 py-2 border border-red-200 text-red-600 rounded-lg text-sm font-medium hover:bg-red-50">
                Hold
              </button>}
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

import { toast } from './toast'

/** A job's photos and video, with pins on its quote's site plan. */
function JobMedia({ job }: { job: UnifiedJob }) {
  const quote = job.rawJob?.quoteId ? getQuotes().find(q => q.id === job.rawJob!.quoteId) : undefined
  const [, setItems] = useState<ShownMedia[]>([])
  return (
    <MediaGallery where={{ jobId: job.id }} layout={quote?.layout?.yard ?? null} defaultCategory="Progress" title="Photos and video" onItems={setItems} />
  )
}
