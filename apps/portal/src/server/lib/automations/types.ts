/**
 * Shapes of automation rules (WHEN + IF + THEN) and stage rules, with plain
 * checks so a bad rule is refused when it is saved, not when it runs.
 */

import { z } from 'zod'
import { START_IDS } from '../pipelineStageModel.js'

export type Board = 'sales' | 'ops'

export const EVENT_TRIGGERS = ['proposal_accepted', 'walkthrough_signed', 'punch_list_cleared', 'payment_received', 'photo_uploaded'] as const
export const DATE_FIELDS = ['install', 'appointment', 'proposal_sent'] as const

export const triggerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('card_entered'), stage: z.string().min(1), settleMinutes: z.number().int().min(0).max(1440).default(2), onlyWhileInStage: z.boolean().default(true) }),
  z.object({ type: z.literal('card_left'), stage: z.string().min(1) }),
  z.object({ type: z.literal('in_stage_days'), stage: z.string().min(1), days: z.number().int().min(1).max(365) }),
  z.object({ type: z.literal('date_offset'), dateField: z.enum(DATE_FIELDS), days: z.number().int().min(0).max(365), when: z.enum(['before', 'after']) }),
  z.object({ type: z.literal('event'), event: z.enum(EVENT_TRIGGERS) }),
])
export type Trigger = z.infer<typeof triggerSchema>

export const CONDITION_FIELDS = ['stage', 'style', 'price', 'city', 'county', 'salesman', 'tag', 'permit_required'] as const
export const conditionSchema = z.object({
  field: z.enum(CONDITION_FIELDS),
  op: z.enum(['is', 'is_not', 'contains', 'between', 'has', 'has_not']),
  /** Text; for price { minCents, maxCents } (either may be missing); for permit_required true/false. */
  value: z.union([z.string(), z.boolean(), z.object({ minCents: z.number().int().nullable().optional(), maxCents: z.number().int().nullable().optional() })]),
})
export type Condition = z.infer<typeof conditionSchema>

export const STEP_TYPES = [
  'create_task', 'notify', 'email_customer', 'prepare_text', 'move_card', 'add_checklist',
  'request_signature', 'start_walkthrough', 'final_invoice', 'permit_packet', 'wait', 'webhook',
] as const
export type StepType = typeof STEP_TYPES[number]

export const stepSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('create_task'), title: z.string().min(1).max(200), description: z.string().max(2000).default(''), assignTo: z.string().default(''), dueInDays: z.number().int().min(0).max(365).default(0) }),
  z.object({ type: z.literal('notify'), title: z.string().min(1).max(200), body: z.string().max(1000).default(''), push: z.boolean().default(true) }),
  z.object({ type: z.literal('email_customer'), subject: z.string().min(1).max(200), body: z.string().min(1).max(10000) }),
  z.object({ type: z.literal('prepare_text'), body: z.string().min(1).max(1000), assignTo: z.string().default('') }),
  z.object({ type: z.literal('move_card'), stage: z.string().min(1) }),
  z.object({ type: z.literal('add_checklist'), items: z.array(z.string().min(1).max(200)).min(1).max(50) }),
  z.object({ type: z.literal('request_signature'), what: z.enum(['walkthrough', 'proposal']), via: z.enum(['text', 'email']) }),
  z.object({ type: z.literal('start_walkthrough') }),
  z.object({ type: z.literal('final_invoice'), dueInDays: z.number().int().min(0).max(120).default(7) }),
  z.object({ type: z.literal('permit_packet'), assignTo: z.string().default('') }),
  z.object({ type: z.literal('wait'), minutes: z.number().int().min(1).max(60 * 24 * 365) }),
  z.object({ type: z.literal('webhook'), url: z.string().url().refine(u => /^https?:\/\//i.test(u), 'The address must start with http:// or https://') }),
])
export type Step = z.infer<typeof stepSchema>

export const ruleSchema = z.object({
  name: z.string().min(1).max(200),
  board: z.enum(['sales', 'ops']),
  enabled: z.boolean().default(false),
  trigger: triggerSchema,
  conditions: z.array(conditionSchema).max(20).default([]),
  steps: z.array(stepSchema).min(1, 'Add at least one step.').max(30),
})
export type RuleInput = z.infer<typeof ruleSchema>

export const REQUIREMENTS = ['permit_approved', 'walkthrough_signed', 'has_install_date', 'has_price', 'has_email', 'materials_ordered', 'paid_in_full'] as const
export type Requirement = typeof REQUIREMENTS[number]
export const REQUIREMENT_LABEL: Record<Requirement, string> = {
  permit_approved: 'Permit approved (or marked not needed)',
  walkthrough_signed: 'Final walkthrough signed',
  has_install_date: 'Install date set',
  has_price: 'Price set',
  has_email: 'Customer email on file',
  materials_ordered: 'Materials ordered',
  paid_in_full: 'Paid in full',
}
export const stageRuleSchema = z.object({
  board: z.enum(['sales', 'ops']),
  stage: z.string().min(1).max(100),
  requirements: z.array(z.object({ type: z.enum(REQUIREMENTS) })).min(1, 'Pick at least one requirement.'),
  enabled: z.boolean().default(false),
})

/** The run's settle time after a card enters a stage, and the window in which one rule runs once per card and stage. */
export const SAME_STAGE_WINDOW_MS = 24 * 3600_000
/** Waits before each new try of a failed step: 1 min, 5 min, 15 min, 1 h. Then the run fails and Jonathan is told. */
export const RETRY_BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000]
export const MAX_ATTEMPTS = RETRY_BACKOFF_MS.length + 1

/** A failure that trying again cannot fix (a stage rule blocks the move, nothing to email to). */
export class PermanentStepError extends Error {
  permanent = true
}

/**
 * A step that needs the card's job, run before the job is made: the card
 * reached Signed Contract a moment before the job was saved (the phone saves
 * the job after the move; the proposal link makes it after the signature).
 * Not a failure (audit Oct 26 2026: "There is no job for this card yet" made
 * the owner press Run again): the run waits for the job, is woken when any
 * job is made (hooks.ts wakeJobWaiters) and looks again on JOB_WAIT_BACKOFF_MS,
 * then every hour, for up to JOB_WAIT_MAX_MS; only then it fails.
 */
export class WaitForJobError extends Error {
  waitForJob = true
}
/** The run's lastError while it waits for its job (how the wake up finds it; not shown as an error). */
export const JOB_WAIT_NOTE = 'Waiting for the job to be made for this card.'
export const JOB_WAIT_BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000]
export const JOB_WAIT_MAX_MS = 3 * 24 * 3600_000

/** Jonathan's starter rules; all switched off until he turns them on. Sales stages by their permanent ids (the start stages' old names). */
export const STARTER_RULES: Array<RuleInput & { starter: string }> = [
  {
    starter: 'signed_contract_tasks', name: `${START_IDS.signedContract}: order materials, permit packet, schedule install`, board: 'sales', enabled: false,
    trigger: { type: 'card_entered', stage: START_IDS.signedContract, settleMinutes: 2, onlyWhileInStage: false }, conditions: [],
    steps: [
      { type: 'create_task', title: 'Order materials for {name}', description: '{style}, {address}', assignTo: '', dueInDays: 1 },
      { type: 'permit_packet', assignTo: '' },
      { type: 'create_task', title: 'Schedule the install for {name}', description: '{address}', assignTo: '', dueInDays: 2 },
    ],
  },
  {
    starter: 'install_reminder_email', name: '2 days before install: email the customer a reminder', board: 'ops', enabled: false,
    trigger: { type: 'date_offset', dateField: 'install', days: 2, when: 'before' }, conditions: [],
    steps: [{
      type: 'email_customer', subject: 'Your fence install is on {install date}',
      body: 'Hi {first name},\n\nThis is a reminder that Getter Done Fence is scheduled to install your fence on {install date} at {address}.\n\nPlease make sure gates are unlocked and pets are inside. Reply to this email if anything has changed.\n\nThank you,\nGetter Done Fence',
    }],
  },
  {
    starter: 'job_complete_walkthrough', name: `${START_IDS.jobComplete}: start the final walkthrough`, board: 'sales', enabled: false,
    trigger: { type: 'card_entered', stage: START_IDS.jobComplete, settleMinutes: 2, onlyWhileInStage: true }, conditions: [],
    steps: [{ type: 'start_walkthrough' }],
  },
  {
    starter: 'walkthrough_signed_invoice_review', name: 'Walkthrough signed: final invoice, review request 3 days later', board: 'ops', enabled: false,
    trigger: { type: 'event', event: 'walkthrough_signed' }, conditions: [],
    steps: [
      { type: 'final_invoice', dueInDays: 7 },
      { type: 'wait', minutes: 3 * 24 * 60 },
      {
        type: 'email_customer', subject: 'How did we do, {first name}?',
        body: 'Hi {first name},\n\nThank you for choosing Getter Done Fence. If you are happy with your new fence, a short Google review would mean a lot to our small team.\n\nThank you,\nGetter Done Fence',
      },
    ],
  },
  {
    starter: 'no_answer_follow_up', name: `${START_IDS.noAnswer}: follow up at 2, 5 and 10 days`, board: 'sales', enabled: false,
    trigger: { type: 'card_entered', stage: START_IDS.noAnswer, settleMinutes: 2, onlyWhileInStage: true }, conditions: [],
    steps: [
      { type: 'wait', minutes: 2 * 24 * 60 },
      { type: 'create_task', title: 'Follow up with {name} (2 days, no answer)', description: 'Call or text {phone}', assignTo: '{salesman}', dueInDays: 0 },
      { type: 'wait', minutes: 3 * 24 * 60 },
      { type: 'create_task', title: 'Follow up with {name} (5 days, no answer)', description: 'Call or text {phone}', assignTo: '{salesman}', dueInDays: 0 },
      { type: 'wait', minutes: 5 * 24 * 60 },
      { type: 'create_task', title: 'Last follow up with {name} (10 days, no answer)', description: 'Call or text {phone}', assignTo: '{salesman}', dueInDays: 0 },
    ],
  },
]

export const STARTER_STAGE_RULES: Array<z.infer<typeof stageRuleSchema> & { starter: string }> = [
  { starter: 'pending_start_permit', board: 'sales', stage: START_IDS.pendingStart, requirements: [{ type: 'permit_approved' }], enabled: false },
  { starter: 'job_complete_walkthrough', board: 'sales', stage: START_IDS.jobComplete, requirements: [{ type: 'walkthrough_signed' }], enabled: false },
  { starter: 'ops_complete_walkthrough', board: 'ops', stage: 'completed', requirements: [{ type: 'walkthrough_signed' }], enabled: false },
]
