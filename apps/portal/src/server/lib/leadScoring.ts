/**
 * Lead Scoring Engine
 *
 * Scores leads 0-100 based on qualification signals.
 * Higher score = higher priority for sales team.
 */

interface LeadData {
  fenceType?: string | null
  linearFootage?: number | null
  propertyType?: string | null
  timeline?: string | null
  budgetMin?: number | null  // cents
  budgetMax?: number | null  // cents
  email?: string | null
  phone?: string | null
  address?: string | null
  zipCode?: string | null
}

interface ScoreBreakdown {
  total: number
  timeline: number
  budget: number
  projectSize: number
  contactCompleteness: number
  propertyType: number
  fenceType: number
}

export function scoreLead(data: LeadData): ScoreBreakdown {
  let timeline = 0
  let budget = 0
  let projectSize = 0
  let contactCompleteness = 0
  let propertyType = 0
  let fenceType = 0

  // ── Timeline urgency (0-30 pts) ──
  switch (data.timeline) {
    case 'asap':                timeline = 30; break
    case 'one_to_three_months': timeline = 20; break
    case 'three_to_six_months': timeline = 10; break
    case 'just_looking':        timeline = 3;  break
    default:                    timeline = 5;  break // unknown = some intent
  }

  // ── Budget signal (0-20 pts) ──
  if (data.budgetMax) {
    const budgetDollars = data.budgetMax / 100
    if (budgetDollars >= 10000) budget = 20
    else if (budgetDollars >= 5000) budget = 15
    else if (budgetDollars >= 2000) budget = 10
    else budget = 5
  }

  // ── Project size by footage (0-20 pts) ──
  if (data.linearFootage) {
    if (data.linearFootage >= 300) projectSize = 20
    else if (data.linearFootage >= 150) projectSize = 15
    else if (data.linearFootage >= 75) projectSize = 10
    else projectSize = 5
  }

  // ── Contact completeness (0-15 pts) ──
  if (data.email) contactCompleteness += 4
  if (data.phone) contactCompleteness += 5  // phone = highest intent signal
  if (data.address) contactCompleteness += 3
  if (data.zipCode) contactCompleteness += 3

  // ── Property type (0-10 pts) ──
  if (data.propertyType === 'commercial') propertyType = 10  // higher value
  else if (data.propertyType === 'residential') propertyType = 7

  // ── Fence type (0-5 pts — some types are higher margin) ──
  const highMargin = ['vinyl', 'aluminum', 'ornamental_iron', 'composite']
  const midMargin = ['wood', 'cedar']
  if (data.fenceType && highMargin.includes(data.fenceType)) fenceType = 5
  else if (data.fenceType && midMargin.includes(data.fenceType)) fenceType = 3
  else if (data.fenceType) fenceType = 2

  const total = Math.min(100, timeline + budget + projectSize + contactCompleteness + propertyType + fenceType)

  return { total, timeline, budget, projectSize, contactCompleteness, propertyType, fenceType }
}

/** Determine lead stage based on score and available data */
export function suggestStage(score: number, hasAppointment: boolean): string {
  if (hasAppointment) return 'appointment_scheduled'
  if (score >= 60) return 'qualified'
  return 'new_lead'
}

/** Determine priority label for notifications */
export function leadPriority(score: number): 'high' | 'medium' | 'low' {
  if (score >= 70) return 'high'
  if (score >= 40) return 'medium'
  return 'low'
}
