/**
 * Botpress Custom Action: Book Appointment
 *
 * Sends booking data to the FencePro backend to create an appointment.
 *
 * Setup in Botpress Studio:
 * 1. Go to Code → Actions → Create new
 * 2. Paste this code
 * 3. Name it: bookAppointment
 */

const axios = require('axios')

const bookAppointment = async () => {
  const API_BASE = bp.botConfig?.apiBaseUrl || process.env.API_BASE_URL || 'http://localhost:4000'
  const WEBHOOK_SECRET = bp.botConfig?.webhookSecret || process.env.BOTPRESS_WEBHOOK_SECRET || ''

  try {
    const vars = event.state.session || {}

    // Calculate a scheduled time based on preference
    const now = new Date()
    let scheduledAt = new Date(now)

    const pref = (vars.preferred_time || '').toLowerCase()
    if (pref.includes('this week')) {
      // Next business day
      scheduledAt.setDate(now.getDate() + (now.getDay() >= 5 ? 8 - now.getDay() : 1))
      scheduledAt.setHours(10, 0, 0, 0)
    } else if (pref.includes('next week')) {
      // Next Monday
      const daysUntilMonday = ((8 - now.getDay()) % 7) || 7
      scheduledAt.setDate(now.getDate() + daysUntilMonday)
      scheduledAt.setHours(10, 0, 0, 0)
    } else {
      // Default: 2 business days from now
      scheduledAt.setDate(now.getDate() + 2)
      if (scheduledAt.getDay() === 0) scheduledAt.setDate(scheduledAt.getDate() + 1)
      if (scheduledAt.getDay() === 6) scheduledAt.setDate(scheduledAt.getDate() + 2)
      scheduledAt.setHours(10, 0, 0, 0)
    }

    // Adjust for morning/afternoon preference
    if (pref.includes('afternoon')) {
      scheduledAt.setHours(14, 0, 0, 0)
    } else if (pref.includes('morning')) {
      scheduledAt.setHours(9, 0, 0, 0)
    }

    const payload = {
      leadId: vars.leadId || undefined,
      botpressConversationId: event.conversationId,
      firstName: vars.first_name || undefined,
      lastName: vars.last_name || undefined,
      email: vars.email || undefined,
      phone: vars.phone || undefined,
      address: vars.address || undefined,
      scheduledAt: scheduledAt.toISOString(),
      duration: 60,
      type: 'estimate',
      notes: `Preferred time: ${vars.preferred_time || 'not specified'}. Fence type: ${vars.fence_type || 'not specified'}.`,
    }

    // Remove undefined values
    Object.keys(payload).forEach(key => {
      if (payload[key] === undefined) delete payload[key]
    })

    const headers = { 'Content-Type': 'application/json' }
    if (WEBHOOK_SECRET) headers['x-botpress-secret'] = WEBHOOK_SECRET

    const response = await axios.post(`${API_BASE}/api/appointments`, payload, { headers })

    event.state.session.appointmentId = response.data?.data?.id
    event.state.session.appointmentDate = scheduledAt.toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric',
    })

    console.log(`[bookAppointment] Booked: ${response.data?.data?.id} for ${scheduledAt.toISOString()}`)
  } catch (error) {
    console.error('[bookAppointment] Error:', error.message)
    event.state.session.appointmentError = true
  }
}

return bookAppointment()
