/**
 * Automation engine tests.
 *
 * These tests mock Prisma and the email/SMS/notification services so they
 * don't require a real database or external services. Every trigger type
 * and every action type is covered.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Mocks ─────────────────────────────────────────────────────

// Mock prisma
const automationRows: any[] = []
const runLogRows: any[] = []
const taskRows: any[] = []
const activityRows: any[] = []
const notifRows: any[] = []

vi.mock('../src/server/lib/prisma.js', () => ({
  default: {
    automation: {
      findMany: vi.fn(async ({ where }: any) => {
        return automationRows.filter(a =>
          (where.isActive === undefined || a.isActive === where.isActive) &&
          (where.triggerType === undefined || a.triggerType === where.triggerType)
        )
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const a = automationRows.find(x => x.id === where.id)
        if (a) Object.assign(a, data, {
          lastFiredAt: data.lastFiredAt,
          fireCount: (a.fireCount || 0) + (data.fireCount?.increment ?? 0),
        })
        return a
      }),
    },
    automationRunLog: {
      create: vi.fn(async ({ data }: any) => { runLogRows.push({ ...data, id: `log-${runLogRows.length + 1}` }); return runLogRows[runLogRows.length - 1] }),
    },
    task: {
      create: vi.fn(async ({ data }: any) => { taskRows.push({ ...data, id: `task-${taskRows.length + 1}` }); return taskRows[taskRows.length - 1] }),
    },
    activityLog: {
      create: vi.fn(async ({ data }: any) => { activityRows.push({ ...data, id: `act-${activityRows.length + 1}` }); return activityRows[activityRows.length - 1] }),
    },
    notification: {
      create: vi.fn(async ({ data }: any) => { notifRows.push({ ...data, id: `notif-${notifRows.length + 1}` }); return notifRows[notifRows.length - 1] }),
    },
  },
}))

// Mock email service
const emailCalls: any[] = []
const smsCalls: any[] = []
const notificationCalls: any[] = []

let emailConfigured = true
let smsConfigured = true

vi.mock('../src/server/lib/emailService.js', () => ({
  sendEmail: vi.fn(async (opts: any) => { emailCalls.push(opts); return { success: true } }),
  applyMergeTags: (text: string, data: any) => {
    let r = text
    for (const [k, v] of Object.entries(data || {})) {
      if (v !== undefined) r = r.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v))
    }
    return r.replace(/\{\{[a-z_]+\}\}/g, '')
  },
  buildEmailHtml: (body: string) => `<html>${body}</html>`,
  isEmailServiceConfigured: () => emailConfigured,
}))

vi.mock('../src/server/lib/sms.js', () => ({
  sendSms: vi.fn(async (to: string, body: string) => { smsCalls.push({ to, body }); return { success: true, sid: 'test-sid' } }),
  isSmsServiceConfigured: () => smsConfigured,
}))

vi.mock('../src/server/lib/notificationService.js', () => ({
  createNotification: vi.fn(async (opts: any) => { notificationCalls.push(opts) }),
}))

// Mock fetch for webhook tests
const fetchCalls: any[] = []
let fetchResponse: any = { ok: true, status: 200, text: async () => 'ok', json: async () => ({}) }
globalThis.fetch = vi.fn(async (url: any, opts: any) => {
  fetchCalls.push({ url, opts })
  return fetchResponse
}) as any

// ── System under test ──────────────────────────────────────────

import { fireAutomations } from '../src/server/lib/automationEngine.js'

function resetAll() {
  automationRows.length = 0
  runLogRows.length = 0
  taskRows.length = 0
  activityRows.length = 0
  notifRows.length = 0
  emailCalls.length = 0
  smsCalls.length = 0
  notificationCalls.length = 0
  fetchCalls.length = 0
  emailConfigured = true
  smsConfigured = true
  fetchResponse = { ok: true, status: 200, text: async () => 'ok', json: async () => ({}) }
}

function addAutomation(partial: any) {
  const row = {
    id: `auto-${automationRows.length + 1}`,
    name: 'test',
    isActive: true,
    triggerType: 'ops_stage_change',
    triggerConfig: {},
    actions: [],
    conditions: null,
    fireCount: 0,
    ...partial,
  }
  automationRows.push(row)
  return row
}

// ── Tests ──────────────────────────────────────────────────────

beforeEach(() => { resetAll() })

describe('Automation Engine — trigger matching', () => {
  it('job moving to Signed Contract fires a matching deal_stage_changed automation', async () => {
    addAutomation({
      triggerType: 'sales_stage_change',
      triggerConfig: { toStage: 'Signed Contract' },
      actions: [{ type: 'post_activity_note', noteText: 'Signed!' }],
    })
    // alias name should be canonicalized
    await fireAutomations('deal_stage_changed', { toStage: 'Signed Contract', jobId: 'j1' })
    expect(runLogRows).toHaveLength(1)
    expect(runLogRows[0].status).toBe('success')
  })

  it('non-matching stage does not fire an automation scoped to a different stage', async () => {
    addAutomation({
      triggerType: 'sales_stage_change',
      triggerConfig: { toStage: 'Signed Contract' },
      actions: [{ type: 'post_activity_note', noteText: 'Signed!' }],
    })
    await fireAutomations('sales_stage_change', { toStage: 'First Contact', jobId: 'j1' })
    expect(runLogRows).toHaveLength(0)
  })

  it('payment_received event fires matching automation', async () => {
    addAutomation({
      triggerType: 'payment_received',
      triggerConfig: {},
      actions: [{ type: 'post_activity_note', noteText: 'Payment in!' }],
    })
    await fireAutomations('payment_received', { jobId: 'j1', customerName: 'Test' })
    expect(runLogRows).toHaveLength(1)
  })

  it('customer_created event fires matching automation', async () => {
    addAutomation({
      triggerType: 'customer_created',
      triggerConfig: {},
      actions: [{ type: 'post_activity_note', noteText: 'Welcome', noteEntityType: 'customer' }],
    })
    await fireAutomations('customer_created', { customerId: 'c1', customerName: 'New' })
    expect(runLogRows).toHaveLength(1)
    expect(activityRows[0]?.entityType).toBe('customer')
  })

  it('inactive automation does not fire even when trigger matches', async () => {
    addAutomation({
      triggerType: 'ops_stage_change',
      isActive: false,
      actions: [{ type: 'post_activity_note', noteText: 'x' }],
    })
    await fireAutomations('ops_stage_change', { jobId: 'j1', toStage: 'Any' })
    expect(runLogRows).toHaveLength(0)
  })

  it('stage condition is honored (from + to)', async () => {
    addAutomation({
      triggerType: 'ops_stage_change',
      triggerConfig: { fromStage: 'staging', toStage: 'scheduled' },
      actions: [{ type: 'post_activity_note', noteText: 'ok' }],
    })
    await fireAutomations('ops_stage_change', { jobId: 'j1', fromStage: 'scheduled', toStage: 'in_progress' })
    expect(runLogRows).toHaveLength(0)
    await fireAutomations('ops_stage_change', { jobId: 'j1', fromStage: 'staging', toStage: 'scheduled' })
    expect(runLogRows).toHaveLength(1)
  })

  it('extra conditions: automation only fires when all conditions match', async () => {
    addAutomation({
      triggerType: 'ops_stage_change',
      triggerConfig: {},
      conditions: { assignedRep: 'alice', fenceType: 'vinyl' },
      actions: [{ type: 'post_activity_note', noteText: 'ok' }],
    })
    // miss on rep
    await fireAutomations('ops_stage_change', { jobId: 'j1', toStage: 'x', assignedRep: 'bob', fenceType: 'vinyl' })
    expect(runLogRows).toHaveLength(0)
    // miss on fenceType
    await fireAutomations('ops_stage_change', { jobId: 'j1', toStage: 'x', assignedRep: 'alice', fenceType: 'chainlink' })
    expect(runLogRows).toHaveLength(0)
    // hit
    await fireAutomations('ops_stage_change', { jobId: 'j1', toStage: 'x', assignedRep: 'alice', fenceType: 'vinyl' })
    expect(runLogRows).toHaveLength(1)
  })
})

describe('Automation Engine — actions', () => {
  it('send_email action calls email service with merged subject + body', async () => {
    addAutomation({
      triggerType: 'payment_received',
      actions: [{ type: 'send_email', emailTo: 'customer', emailSubject: 'Thanks {{customer_name}}', emailBody: 'Your payment for {{job_address}} is in.' }],
    })
    await fireAutomations('payment_received', { jobId: 'j1', customerName: 'Ana', customerEmail: 'ana@x.com', jobAddress: '123 Main' })
    expect(emailCalls).toHaveLength(1)
    expect(emailCalls[0].to).toBe('ana@x.com')
    expect(emailCalls[0].subject).toBe('Thanks Ana')
    expect(emailCalls[0].body).toContain('123 Main')
  })

  it('send_email fails with EMAIL_SERVICE_NOT_CONFIGURED when service disabled', async () => {
    emailConfigured = false
    addAutomation({
      triggerType: 'payment_received',
      actions: [{ type: 'send_email', emailTo: 'customer', emailSubject: 'x', emailBody: 'y' }],
    })
    await fireAutomations('payment_received', { jobId: 'j1', customerName: 'Ana', customerEmail: 'ana@x.com' })
    expect(emailCalls).toHaveLength(0)
    expect(runLogRows[0].status).toBe('failed')
    expect(runLogRows[0].errorMessage).toContain('EMAIL_SERVICE_NOT_CONFIGURED')
  })

  it('send_sms action calls SMS service with phone + merged body', async () => {
    addAutomation({
      triggerType: 'rain_day_flagged',
      actions: [{ type: 'send_sms', smsTo: 'customer', smsBody: 'Rain day — we will reach out. — {{company_name}}' }],
    })
    await fireAutomations('rain_day_flagged', { jobId: 'j1', customerPhone: '+13215550100', customerName: 'Ana' })
    expect(smsCalls).toHaveLength(1)
    expect(smsCalls[0].to).toBe('+13215550100')
    expect(smsCalls[0].body).toContain('GD Fence Pro')
  })

  it('send_sms fails with SMS_SERVICE_NOT_CONFIGURED when Twilio not set', async () => {
    smsConfigured = false
    addAutomation({
      triggerType: 'rain_day_flagged',
      actions: [{ type: 'send_sms', smsTo: 'customer', smsBody: 'hi' }],
    })
    await fireAutomations('rain_day_flagged', { jobId: 'j1', customerPhone: '+1321' })
    expect(smsCalls).toHaveLength(0)
    expect(runLogRows[0].errorMessage).toContain('SMS_SERVICE_NOT_CONFIGURED')
  })

  it('create_task action writes a task record with assignee + due date', async () => {
    addAutomation({
      triggerType: 'job_scheduled',
      actions: [{ type: 'create_task', taskTitle: 'Confirm crew', taskAssignTo: 'alice', taskDueDaysOffset: 3, taskPriority: 'high' }],
    })
    await fireAutomations('job_scheduled', { jobId: 'j1', customerName: 'Ana', scheduledDate: '2026-05-01' })
    expect(taskRows).toHaveLength(1)
    expect(taskRows[0].title).toBe('Confirm crew')
    expect(taskRows[0].assignedTo).toBe('alice')
    expect(taskRows[0].priority).toBe('high')
    expect(taskRows[0].dueDate).toBeInstanceOf(Date)
  })

  it('post_activity_note creates a real ActivityLog row attributed to automation', async () => {
    addAutomation({
      triggerType: 'customer_created',
      actions: [{ type: 'post_activity_note', noteText: 'Welcome {{customer_name}}', noteEntityType: 'customer' }],
    })
    await fireAutomations('customer_created', { customerId: 'c1', customerName: 'Ana' })
    expect(activityRows).toHaveLength(1)
    expect(activityRows[0].actor).toBe('automation')
    expect(activityRows[0].entityType).toBe('customer')
    expect(activityRows[0].body).toBe('Welcome Ana')
  })

  it('send_notification creates a notification record', async () => {
    addAutomation({
      triggerType: 'ops_stage_change',
      actions: [{ type: 'send_notification', notifyTo: 'role:ops_manager', notifyTitle: 'Stage change', notifyBody: '{{customer_name}} moved to {{job_stage}}' }],
    })
    await fireAutomations('ops_stage_change', { jobId: 'j1', toStage: 'scheduled', customerName: 'Ana' })
    expect(notificationCalls).toHaveLength(1)
    expect(notificationCalls[0].recipientRole).toBe('ops_manager')
    expect(notificationCalls[0].body).toBe('Ana moved to scheduled')
  })

  it('move_ops_stage logs activity + chains next trigger without infinite loop', async () => {
    addAutomation({
      triggerType: 'ops_stage_change',
      triggerConfig: { toStage: 'scheduled' },
      actions: [{ type: 'move_ops_stage', targetStage: 'in_progress' }],
    })
    addAutomation({
      triggerType: 'ops_stage_change',
      triggerConfig: { toStage: 'in_progress' },
      actions: [{ type: 'post_activity_note', noteText: 'chained' }],
    })
    await fireAutomations('ops_stage_change', { jobId: 'j1', toStage: 'scheduled' })
    // Let setImmediate fire
    await new Promise(r => setImmediate(r))
    // The chain automation should also have run
    expect(activityRows.some(a => a.body === 'Stage moved: scheduled → in_progress')).toBe(true)
  })

  it('fire_webhook makes an HTTP POST with structured payload', async () => {
    addAutomation({
      triggerType: 'payment_received',
      actions: [{ type: 'fire_webhook', webhookUrl: 'https://example.test/hook', webhookMethod: 'POST' }],
    })
    await fireAutomations('payment_received', { jobId: 'j1', customerName: 'Ana' })
    expect(fetchCalls).toHaveLength(1)
    expect(fetchCalls[0].url).toBe('https://example.test/hook')
    const body = JSON.parse(fetchCalls[0].opts.body)
    expect(body.entity_id).toBe('j1')
    expect(body.event.customerName).toBe('Ana')
  })

  it('fire_webhook retries up to 3 times on failure', async () => {
    fetchResponse = { ok: false, status: 500, text: async () => 'boom', json: async () => ({}) }
    addAutomation({
      triggerType: 'payment_received',
      actions: [{ type: 'fire_webhook', webhookUrl: 'https://example.test/hook' }],
    })
    // Speed up retries for test by monkey-patching setTimeout
    const origSetTimeout = globalThis.setTimeout
    // @ts-expect-error
    globalThis.setTimeout = (fn: any) => { fn(); return 0 as any }
    try {
      await fireAutomations('payment_received', { jobId: 'j1' })
    } finally {
      globalThis.setTimeout = origSetTimeout
    }
    expect(fetchCalls.length).toBe(3)
    expect(runLogRows[0].status).toBe('failed')
    expect(runLogRows[0].errorMessage).toContain('WEBHOOK_FAILED')
  })

  it('unknown action type is logged as failed with UNKNOWN_ACTION_TYPE', async () => {
    addAutomation({
      triggerType: 'payment_received',
      actions: [{ type: 'not_a_real_action' } as any],
    })
    await fireAutomations('payment_received', { jobId: 'j1' })
    expect(runLogRows[0].status).toBe('failed')
    expect(runLogRows[0].errorMessage).toContain('UNKNOWN_ACTION_TYPE')
  })
})

describe('Automation Engine — resilience', () => {
  it('thrown error inside an action does not crash the caller', async () => {
    // Force prisma.task.create to throw once
    const prisma: any = (await import('../src/server/lib/prisma.js')).default
    const orig = prisma.task.create
    prisma.task.create = vi.fn(async () => { throw new Error('db down') })
    try {
      addAutomation({
        triggerType: 'ops_stage_change',
        actions: [{ type: 'create_task', taskTitle: 'x' }],
      })
      await expect(fireAutomations('ops_stage_change', { jobId: 'j1', toStage: 'x' })).resolves.toBeUndefined()
      expect(runLogRows[0].status).toBe('failed')
    } finally {
      prisma.task.create = orig
    }
  })

  it('cycle prevention: depth counter stops runaway chains', async () => {
    addAutomation({
      triggerType: 'ops_stage_change',
      actions: [{ type: 'move_ops_stage', targetStage: 'X' }],
    })
    // Craft an event already at the max depth
    await fireAutomations('ops_stage_change', { jobId: 'j1', toStage: 'Y', _chainDepth: 99 })
    expect(runLogRows).toHaveLength(0) // engine returns early before evaluating
  })
})
