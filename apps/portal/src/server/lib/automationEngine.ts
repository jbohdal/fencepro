/**
 * Automation Engine
 *
 * Evaluates all active automations when a trigger event occurs.
 * Non-blocking — failures never break the underlying action.
 *
 * Usage:
 *   await fireAutomations('ops_stage_change', { jobId, fromStage, toStage, ... })
 */

import prisma from './prisma.js'
import { sendEmail, applyMergeTags, buildEmailHtml, type MergeData, isEmailServiceConfigured } from './emailService.js'
import { createNotification } from './notificationService.js'
import { sendSms, isSmsServiceConfigured } from './sms.js'

export interface TriggerEvent {
  // Job context
  jobId?: string
  jobName?: string        // customer name or label
  jobAddress?: string
  fenceType?: string
  // Stage context
  fromStage?: string
  toStage?: string
  // People
  assignedRep?: string
  assignedRepEmail?: string
  crewAssigned?: string
  customerId?: string
  customerName?: string
  customerEmail?: string
  customerPhone?: string
  // Dates
  scheduledDate?: string
  // Pricing
  quotePrice?: number
  contractValue?: number
  invoiceAmount?: number
  // Payment
  paymentMethod?: string
  invoiceId?: string
  quoteId?: string
  dealId?: string
  // Extra
  extraData?: Record<string, unknown>
  // Cycle-prevention depth counter
  _chainDepth?: number
}

interface ActionConfig {
  type: string
  // move_ops_stage / move_sales_stage
  targetStage?: string
  // send_email
  emailTo?: string        // 'customer' | 'rep' | 'role:admin' | 'custom:email@example.com'
  emailSubject?: string
  emailBody?: string
  // send_sms
  smsTo?: string          // 'customer' | 'rep' | 'custom:+13215550100'
  smsBody?: string
  // send_notification
  notifyTo?: string       // 'rep' | 'role:admin' | 'role:ops_manager' | user name
  notifyTitle?: string
  notifyBody?: string
  // create_task
  taskTitle?: string
  taskDescription?: string
  taskAssignTo?: string   // user name or role
  taskDueDaysOffset?: number
  taskPriority?: string
  // post_activity_note
  noteText?: string
  noteEntityType?: string // 'customer' | 'job' | 'deal' (defaults based on trigger)
  // fire_webhook
  webhookUrl?: string
  webhookMethod?: string
  webhookHeaders?: Record<string, string>
  // schedule_reminder
  reminderDaysOffset?: number
  reminderMessage?: string
  reminderTo?: string
  // require_checklist_gate
  checklistItem?: string
}

interface ActionResult {
  type: string
  config: ActionConfig
  success: boolean
  result?: string
  error?: string
  reason?: string   // machine-readable failure code
}

const MAX_CHAIN_DEPTH = 5

/** Alias map so callers can use newer / more descriptive names. */
const TRIGGER_ALIASES: Record<string, string> = {
  job_stage_changed: 'ops_stage_change',
  deal_stage_changed: 'sales_stage_change',
  job_rain_day: 'rain_day_flagged',
}

function canonicalTriggerType(t: string): string {
  return TRIGGER_ALIASES[t] || t
}

/**
 * Fire all matching automations for a trigger event.
 * This is the main entry point — call this from any place that changes job/deal state.
 * Always resolves; never throws.
 */
export async function fireAutomations(
  triggerType: string,
  event: TriggerEvent,
): Promise<void> {
  const canonical = canonicalTriggerType(triggerType)

  // Cycle prevention
  const depth = event._chainDepth ?? 0
  if (depth > MAX_CHAIN_DEPTH) {
    console.warn(`[Automation] Chain depth ${depth} exceeded for ${canonical} — aborting to prevent loop.`)
    return
  }

  try {
    const automations = await prisma.automation.findMany({
      where: { isActive: true, triggerType: canonical as any },
    })
    if (automations.length === 0) return

    const mergeData: MergeData = {
      customer_name: event.customerName || event.jobName || '',
      job_address: event.jobAddress || '',
      scheduled_date: event.scheduledDate || '',
      rep_name: event.assignedRep || '',
      job_stage: event.toStage || '',
      deal_stage: event.toStage || '',
      job_id: event.jobId || '',
      company_name: process.env.COMPANY_NAME || 'GD Fence Pro',
      quote_price: event.quotePrice ? `$${event.quotePrice.toLocaleString()}` : '',
      quote_total: event.quotePrice ? `$${event.quotePrice.toLocaleString()}` : '',
      invoice_amount: event.invoiceAmount != null ? `$${event.invoiceAmount.toLocaleString()}` : '',
      payment_method: event.paymentMethod || '',
    }

    for (const automation of automations) {
      try {
        if (!matchesTrigger(automation, event)) continue
        if (automation.conditions && !matchesConditions(automation.conditions as any, event)) continue

        const actions = automation.actions as unknown as ActionConfig[]
        const results: ActionResult[] = []
        let allSuccess = true

        for (const action of actions) {
          const result = await executeAction(action, event, mergeData, depth)
          results.push(result)
          if (!result.success) allSuccess = false
        }

        await prisma.automationRunLog.create({
          data: {
            automationId: automation.id,
            automationName: automation.name,
            jobId: event.jobId || null,
            jobName: event.jobName || null,
            triggerType: canonical,
            actionsExecuted: JSON.parse(JSON.stringify(results)),
            status: allSuccess ? 'success' : results.some(r => r.success) ? 'partial' : 'failed',
            errorMessage: results.filter(r => r.error || r.reason).map(r => r.reason ? `${r.reason}: ${r.error || ''}` : r.error).join('; ') || null,
          },
        })

        await prisma.automation.update({
          where: { id: automation.id },
          data: { lastFiredAt: new Date(), fireCount: { increment: 1 } },
        })

        console.log(`[Automation] "${automation.name}" fired for ${event.jobName || event.jobId || 'unknown'} — ${allSuccess ? 'success' : 'partial/failed'}`)
      } catch (err) {
        console.error(`[Automation] "${automation.name}" error:`, err)
        await prisma.automationRunLog.create({
          data: {
            automationId: automation.id,
            automationName: automation.name,
            jobId: event.jobId || null,
            jobName: event.jobName || null,
            triggerType: canonical,
            actionsExecuted: JSON.parse(JSON.stringify([])),
            status: 'failed',
            errorMessage: err instanceof Error ? err.message : String(err),
          },
        }).catch(() => {})
      }
    }
  } catch (err) {
    console.error('[Automation Engine] Fatal error:', err)
  }
}

/** Check if an automation's trigger config matches the event */
function matchesTrigger(automation: any, event: TriggerEvent): boolean {
  const config = automation.triggerConfig as Record<string, unknown> || {}

  if (automation.triggerType === 'sales_stage_change' || automation.triggerType === 'ops_stage_change') {
    if (config.toStage && config.toStage !== event.toStage) return false
    if (config.fromStage && config.fromStage !== event.fromStage) return false
    return true
  }
  return true
}

/** Check optional conditions */
function matchesConditions(conditions: Record<string, unknown>, event: TriggerEvent): boolean {
  if (conditions.assignedRep && conditions.assignedRep !== event.assignedRep) return false
  if (conditions.fenceType && conditions.fenceType !== event.fenceType) return false
  if (conditions.businessHoursOnly) {
    const hour = new Date().getHours()
    if (hour < 8 || hour > 18) return false
  }
  return true
}

/** Execute a single action */
async function executeAction(action: ActionConfig, event: TriggerEvent, mergeData: MergeData, chainDepth: number): Promise<ActionResult> {
  const result: ActionResult = { type: action.type, config: action, success: false }

  try {
    switch (action.type) {
      case 'send_email': {
        let toEmail = ''
        if (action.emailTo === 'customer') toEmail = event.customerEmail || ''
        else if (action.emailTo === 'rep') toEmail = event.assignedRepEmail || ''
        else if (action.emailTo?.startsWith('role:')) {
          const role = action.emailTo.replace('role:', '')
          await createNotification({
            recipientRole: role,
            title: applyMergeTags(action.emailSubject || 'Automation', mergeData),
            body: applyMergeTags(action.emailBody || '', mergeData),
            type: 'automation',
            jobId: event.jobId,
          })
          result.success = true
          result.result = `Notification sent to role: ${role} (email service bypassed for role broadcasts)`
          return result
        } else if (action.emailTo?.startsWith('custom:')) {
          toEmail = action.emailTo.replace('custom:', '')
        }

        if (!toEmail) {
          result.error = 'No email address available'
          result.reason = 'EMAIL_RECIPIENT_MISSING'
          return result
        }

        if (!isEmailServiceConfigured()) {
          result.error = 'Email service not configured — set SENDGRID_API_KEY or SMTP_* env vars.'
          result.reason = 'EMAIL_SERVICE_NOT_CONFIGURED'
          // Still log a placeholder so we see the attempt
          console.warn(`[Automation Email] Service not configured. Would send to ${toEmail}: "${action.emailSubject}"`)
          return result
        }

        const subject = applyMergeTags(action.emailSubject || 'Update from {{company_name}}', mergeData)
        const body = buildEmailHtml(applyMergeTags(action.emailBody || '', mergeData))
        const emailResult = await sendEmail({ to: toEmail, subject, body })
        result.success = emailResult.success
        result.result = `Email sent to ${toEmail}`
        if (emailResult.error) { result.error = emailResult.error; result.reason = 'EMAIL_SEND_ERROR' }
        break
      }

      case 'send_sms': {
        let toPhone = ''
        if (action.smsTo === 'customer') toPhone = event.customerPhone || ''
        else if (action.smsTo?.startsWith('custom:')) toPhone = action.smsTo.replace('custom:', '')
        else toPhone = action.smsTo || ''

        if (!toPhone) {
          result.error = 'No phone number available'
          result.reason = 'SMS_RECIPIENT_MISSING'
          return result
        }

        if (!isSmsServiceConfigured()) {
          result.error = 'SMS service not configured — set TWILIO_* env vars.'
          result.reason = 'SMS_SERVICE_NOT_CONFIGURED'
          console.warn(`[Automation SMS] Service not configured. Would send to ${toPhone}: "${action.smsBody}"`)
          return result
        }

        const msg = applyMergeTags(action.smsBody || '', mergeData)
        const smsResult = await sendSms(toPhone, msg)
        result.success = smsResult.success
        result.result = `SMS sent to ${toPhone}`
        if (smsResult.error) { result.error = smsResult.error; result.reason = 'SMS_SEND_ERROR' }
        break
      }

      case 'send_notification': {
        let recipientId: string | undefined
        let recipientRole: string | undefined

        if (action.notifyTo === 'rep') recipientId = event.assignedRep
        else if (action.notifyTo?.startsWith('role:')) recipientRole = action.notifyTo.replace('role:', '')
        else recipientId = action.notifyTo

        await createNotification({
          recipientId,
          recipientRole,
          title: applyMergeTags(action.notifyTitle || 'Automation', mergeData),
          body: applyMergeTags(action.notifyBody || '', mergeData),
          type: 'automation',
          link: event.jobId ? `/jobs/${event.jobId}` : undefined,
          jobId: event.jobId,
        })
        result.success = true
        result.result = `Notification sent to ${recipientId || recipientRole || 'all'}`
        break
      }

      case 'create_task': {
        const dueDate = action.taskDueDaysOffset
          ? new Date(Date.now() + action.taskDueDaysOffset * 24 * 60 * 60 * 1000)
          : undefined

        await prisma.task.create({
          data: {
            title: applyMergeTags(action.taskTitle || 'New Task', mergeData),
            description: applyMergeTags(action.taskDescription || '', mergeData),
            assignedTo: action.taskAssignTo?.startsWith('role:') ? undefined : action.taskAssignTo,
            assignedRole: action.taskAssignTo?.startsWith('role:') ? action.taskAssignTo.replace('role:', '') : undefined,
            jobId: event.jobId,
            jobName: event.jobName,
            priority: (action.taskPriority as any) || 'normal',
            dueDate,
            createdBy: `automation:${event.jobId || 'system'}`,
          },
        })
        result.success = true
        result.result = `Task created: ${action.taskTitle}`
        break
      }

      case 'post_activity_note': {
        const entityType = action.noteEntityType
          || (event.jobId ? 'job'
              : event.customerId ? 'customer'
              : event.dealId ? 'deal'
              : event.invoiceId ? 'invoice'
              : event.quoteId ? 'quote'
              : 'job')
        const entityId = event.jobId || event.customerId || event.dealId || event.invoiceId || event.quoteId || ''
        if (!entityId) {
          result.error = 'No entity to attach activity note to'
          result.reason = 'ACTIVITY_TARGET_MISSING'
          return result
        }
        await prisma.activityLog.create({
          data: {
            entityType,
            entityId,
            actor: 'automation',
            body: applyMergeTags(action.noteText || '', mergeData),
            metadata: { triggerStage: event.toStage, jobName: event.jobName } as any,
          },
        })
        result.success = true
        result.result = `Activity note posted on ${entityType} ${entityId}`
        break
      }

      case 'fire_webhook': {
        if (!action.webhookUrl) {
          result.error = 'No webhook URL configured'
          result.reason = 'WEBHOOK_URL_MISSING'
          return result
        }

        const payload = {
          event_type: event.toStage ? `stage_change` : 'automation_event',
          entity_type: event.jobId ? 'job' : event.customerId ? 'customer' : 'unknown',
          entity_id: event.jobId || event.customerId || event.dealId || null,
          timestamp: new Date().toISOString(),
          event,
        }

        const MAX_ATTEMPTS = 3
        const DELAY_MS = 5000
        let lastStatus = 0
        let lastErr = ''
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
          try {
            const controller = new AbortController()
            const timer = setTimeout(() => controller.abort(), 15000)
            const res = await fetch(action.webhookUrl, {
              method: action.webhookMethod || 'POST',
              headers: { 'Content-Type': 'application/json', ...action.webhookHeaders },
              body: JSON.stringify(payload),
              signal: controller.signal,
            })
            clearTimeout(timer)
            lastStatus = res.status
            if (res.ok) {
              result.success = true
              result.result = `Webhook ${res.status} on attempt ${attempt}: ${action.webhookUrl}`
              return result
            }
            lastErr = `HTTP ${res.status}`
          } catch (err: any) {
            lastErr = err?.message || String(err)
          }
          if (attempt < MAX_ATTEMPTS) await new Promise(r => setTimeout(r, DELAY_MS))
        }
        result.success = false
        result.error = `Webhook failed after ${MAX_ATTEMPTS} attempts (last: ${lastStatus || lastErr})`
        result.reason = 'WEBHOOK_FAILED'
        break
      }

      case 'move_ops_stage':
      case 'move_sales_stage': {
        if (!action.targetStage) {
          result.error = 'targetStage missing'
          result.reason = 'STAGE_TARGET_MISSING'
          return result
        }
        if (chainDepth >= MAX_CHAIN_DEPTH) {
          result.error = `Chain depth ${chainDepth} would exceed max ${MAX_CHAIN_DEPTH}`
          result.reason = 'CYCLE_PREVENTION'
          return result
        }
        // Emit a follow-up event so chained automations run. Because the CRM's job/deal
        // storage is client-side (localStorage), the engine cannot directly update a job
        // row; instead, it writes to ActivityLog and fires the follow-up trigger. Clients
        // polling for changes (via the run log) can apply the move client-side.
        await prisma.activityLog.create({
          data: {
            entityType: action.type === 'move_ops_stage' ? 'job' : 'deal',
            entityId: event.jobId || event.dealId || '',
            actor: 'automation',
            body: `Stage moved: ${event.toStage || 'unknown'} → ${action.targetStage}`,
            metadata: { from: event.toStage, to: action.targetStage } as any,
          },
        })
        // Fire chained stage-change trigger with incremented depth
        const chainedType = action.type === 'move_ops_stage' ? 'ops_stage_change' : 'sales_stage_change'
        if (event.toStage !== action.targetStage) {
          setImmediate(() => {
            fireAutomations(chainedType, {
              ...event,
              fromStage: event.toStage,
              toStage: action.targetStage,
              _chainDepth: chainDepth + 1,
            }).catch(err => console.error('[Automation chain] fire error', err))
          })
        }
        result.success = true
        result.result = `Stage move applied: → ${action.targetStage} (chained)`
        break
      }

      case 'schedule_reminder': {
        const reminderDate = action.reminderDaysOffset
          ? new Date(Date.now() + action.reminderDaysOffset * 24 * 60 * 60 * 1000)
          : new Date(Date.now() + 24 * 60 * 60 * 1000)

        await prisma.task.create({
          data: {
            title: 'Reminder',
            description: applyMergeTags(action.reminderMessage || 'Follow up', mergeData),
            assignedTo: action.reminderTo === 'rep' ? event.assignedRep : action.reminderTo,
            jobId: event.jobId,
            jobName: event.jobName,
            priority: 'normal',
            dueDate: reminderDate,
            createdBy: 'automation:reminder',
          },
        })
        result.success = true
        result.result = `Reminder scheduled for ${reminderDate.toLocaleDateString()}`
        break
      }

      case 'require_checklist_gate': {
        result.success = true
        result.result = `Gate set: "${action.checklistItem}" required`
        break
      }

      default:
        result.error = `Unknown action type: ${action.type}`
        result.reason = 'UNKNOWN_ACTION_TYPE'
    }
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err)
    result.reason = result.reason || 'ACTION_EXCEPTION'
    console.error(`[Automation Action] ${action.type} error:`, err)
  }

  return result
}
