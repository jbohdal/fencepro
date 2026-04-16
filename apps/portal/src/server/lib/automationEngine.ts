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
import { sendEmail, applyMergeTags, buildEmailHtml, type MergeData } from './emailService.js'
import { createNotification } from './notificationService.js'
import { sendSms } from './sms.js'

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
  customerName?: string
  customerEmail?: string
  customerPhone?: string
  // Dates
  scheduledDate?: string
  // Pricing
  quotePrice?: number
  contractValue?: number
  // Extra
  extraData?: Record<string, unknown>
}

interface ActionConfig {
  type: string
  // move_ops_stage / move_sales_stage
  targetStage?: string
  // send_email
  emailTo?: string        // 'customer' | 'rep' | 'role:admin' | 'custom:email@example.com'
  emailSubject?: string
  emailBody?: string
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
}

/**
 * Fire all matching automations for a trigger event.
 * This is the main entry point — call this from any place that changes job/deal state.
 */
export async function fireAutomations(
  triggerType: string,
  event: TriggerEvent,
): Promise<void> {
  try {
    // Load all active automations for this trigger type
    const automations = await prisma.automation.findMany({
      where: { isActive: true, triggerType: triggerType as any },
    })

    if (automations.length === 0) return

    // Build merge data for templates
    const mergeData: MergeData = {
      customer_name: event.customerName || event.jobName || '',
      job_address: event.jobAddress || '',
      scheduled_date: event.scheduledDate || '',
      rep_name: event.assignedRep || '',
      job_stage: event.toStage || '',
      job_id: event.jobId || '',
      company_name: process.env.COMPANY_NAME || 'GD Fence Pro',
      quote_price: event.quotePrice ? `$${event.quotePrice.toLocaleString()}` : '',
    }

    // Evaluate each automation
    for (const automation of automations) {
      try {
        // Check if trigger conditions match
        if (!matchesTrigger(automation, event)) continue

        // Check optional conditions
        if (automation.conditions && !matchesConditions(automation.conditions as any, event)) continue

        // Execute actions
        const actions = automation.actions as unknown as ActionConfig[]
        const results: ActionResult[] = []
        let allSuccess = true

        for (const action of actions) {
          const result = await executeAction(action, event, mergeData)
          results.push(result)
          if (!result.success) allSuccess = false
        }

        // Log the run
        await prisma.automationRunLog.create({
          data: {
            automationId: automation.id,
            automationName: automation.name,
            jobId: event.jobId || null,
            jobName: event.jobName || null,
            triggerType,
            actionsExecuted: JSON.parse(JSON.stringify(results)),
            status: allSuccess ? 'success' : results.some(r => r.success) ? 'partial' : 'failed',
            errorMessage: results.filter(r => r.error).map(r => r.error).join('; ') || null,
          },
        })

        // Update automation stats
        await prisma.automation.update({
          where: { id: automation.id },
          data: { lastFiredAt: new Date(), fireCount: { increment: 1 } },
        })

        console.log(`[Automation] "${automation.name}" fired for ${event.jobName || event.jobId || 'unknown'} — ${allSuccess ? 'success' : 'partial'}`)
      } catch (err) {
        console.error(`[Automation] "${automation.name}" error:`, err)
        // Log failure but don't break
        await prisma.automationRunLog.create({
          data: {
            automationId: automation.id,
            automationName: automation.name,
            jobId: event.jobId || null,
            jobName: event.jobName || null,
            triggerType,
            actionsExecuted: JSON.parse(JSON.stringify([])),
            status: 'failed',
            errorMessage: err instanceof Error ? err.message : String(err),
          },
        }).catch(() => {})
      }
    }
  } catch (err) {
    // Engine-level failure must never break the caller
    console.error('[Automation Engine] Fatal error:', err)
  }
}

/** Check if an automation's trigger config matches the event */
function matchesTrigger(automation: any, event: TriggerEvent): boolean {
  const config = automation.triggerConfig as Record<string, unknown> || {}

  // Stage-change triggers: check fromStage and/or toStage
  if (automation.triggerType === 'sales_stage_change' || automation.triggerType === 'ops_stage_change') {
    if (config.toStage && config.toStage !== event.toStage) return false
    if (config.fromStage && config.fromStage !== event.fromStage) return false
    return true
  }

  // Simple triggers: job_created, job_assigned, job_scheduled, etc. — always match if active
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
async function executeAction(action: ActionConfig, event: TriggerEvent, mergeData: MergeData): Promise<ActionResult> {
  const result: ActionResult = { type: action.type, config: action, success: false }

  try {
    switch (action.type) {
      case 'send_email': {
        let toEmail = ''
        if (action.emailTo === 'customer') toEmail = event.customerEmail || ''
        else if (action.emailTo === 'rep') toEmail = event.assignedRepEmail || ''
        else if (action.emailTo?.startsWith('role:')) {
          // For role-based emails, create notification instead (no email DB for CRM users)
          const role = action.emailTo.replace('role:', '')
          await createNotification({
            recipientRole: role,
            title: applyMergeTags(action.emailSubject || 'Automation', mergeData),
            body: applyMergeTags(action.emailBody || '', mergeData),
            type: 'automation',
            jobId: event.jobId,
          })
          result.success = true
          result.result = `Notification sent to role: ${role}`
          return result
        } else if (action.emailTo?.startsWith('custom:')) {
          toEmail = action.emailTo.replace('custom:', '')
        }

        if (!toEmail) {
          result.error = 'No email address available'
          return result
        }

        const subject = applyMergeTags(action.emailSubject || 'Update from {{company_name}}', mergeData)
        const body = buildEmailHtml(applyMergeTags(action.emailBody || '', mergeData))
        const emailResult = await sendEmail({ to: toEmail, subject, body })
        result.success = emailResult.success
        result.result = `Email sent to ${toEmail}`
        if (emailResult.error) result.error = emailResult.error
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
        // Store as a notification that acts as an activity log entry
        await createNotification({
          title: 'Activity',
          body: applyMergeTags(action.noteText || '', mergeData),
          type: 'info',
          jobId: event.jobId,
        })
        result.success = true
        result.result = 'Activity note posted'
        break
      }

      case 'fire_webhook': {
        if (!action.webhookUrl) {
          result.error = 'No webhook URL configured'
          return result
        }

        const webhookBody = {
          event: event,
          automation: { type: action.type },
          timestamp: new Date().toISOString(),
        }

        const webhookRes = await fetch(action.webhookUrl, {
          method: action.webhookMethod || 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...action.webhookHeaders,
          },
          body: JSON.stringify(webhookBody),
        })

        result.success = webhookRes.ok
        result.result = `Webhook ${webhookRes.status}: ${action.webhookUrl}`
        if (!webhookRes.ok) result.error = `Webhook returned ${webhookRes.status}`
        break
      }

      case 'move_ops_stage':
      case 'move_sales_stage': {
        // These return data for the caller to apply — the engine doesn't directly
        // modify localStorage (that's frontend). It logs the intent.
        result.success = true
        result.result = `Stage move requested: → ${action.targetStage}`
        // The frontend will read the run log and apply stage changes
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
        // Store as metadata — the frontend checks this before allowing transition
        result.success = true
        result.result = `Gate set: "${action.checklistItem}" required`
        break
      }

      default:
        result.error = `Unknown action type: ${action.type}`
    }
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err)
    console.error(`[Automation Action] ${action.type} error:`, err)
  }

  return result
}
