/**
 * Botpress Custom Action: Submit Lead
 *
 * Sends collected lead data to the FencePro backend API.
 * Call this at the end of qualification or when contact info is captured.
 *
 * Setup in Botpress Studio:
 * 1. Go to Code → Actions → Create new
 * 2. Paste this code
 * 3. Name it: submitLead
 */

const axios = require('axios')

const submitLead = async () => {
  const API_BASE = bp.botConfig?.apiBaseUrl || process.env.API_BASE_URL || 'http://localhost:4000'
  const WEBHOOK_SECRET = bp.botConfig?.webhookSecret || process.env.BOTPRESS_WEBHOOK_SECRET || ''

  // Map quick-reply values to API format
  const timelineMap = {
    'ASAP': 'asap',
    'asap': 'asap',
    '1-3 months': 'one_to_three_months',
    '3-6 months': 'three_to_six_months',
    'Just exploring': 'just_looking',
    'just_looking': 'just_looking',
  }

  const footageMap = {
    'Under 100 ft': 75,
    'under_100': 75,
    '100-200 ft': 150,
    '100_200': 150,
    '200-300 ft': 250,
    '200_300': 250,
    '300+ ft': 350,
    '300_plus': 350,
  }

  const budgetMap = {
    'Under $3,000': { min: 0, max: 300000 },
    'under_3k': { min: 0, max: 300000 },
    '$3,000 - $5,000': { min: 300000, max: 500000 },
    '3k_5k': { min: 300000, max: 500000 },
    '$5,000 - $10,000': { min: 500000, max: 1000000 },
    '5k_10k': { min: 500000, max: 1000000 },
    '$10,000+': { min: 1000000, max: 2000000 },
    '10k_plus': { min: 1000000, max: 2000000 },
  }

  const fenceTypeMap = {
    'Vinyl Privacy': 'vinyl',
    'vinyl': 'vinyl',
    'Aluminum': 'aluminum',
    'aluminum': 'aluminum',
    'Wood': 'wood',
    'wood': 'wood',
    'Chain Link': 'chain_link',
    'chain_link': 'chain_link',
    'Ornamental Iron': 'ornamental_iron',
    'ornamental_iron': 'ornamental_iron',
    'Composite': 'composite',
    'composite': 'composite',
    'Cedar': 'cedar',
    'cedar': 'cedar',
  }

  try {
    const vars = event.state.session || {}
    const footage = footageMap[vars.linear_footage] || parseInt(vars.linear_footage) || undefined
    const budget = budgetMap[vars.budget_range]
    const timeline = timelineMap[vars.timeline] || vars.timeline
    const fenceType = fenceTypeMap[vars.fence_type] || vars.fence_type

    const payload = {
      firstName: vars.first_name || undefined,
      lastName: vars.last_name || undefined,
      email: vars.email || undefined,
      phone: vars.phone || undefined,
      address: vars.address || undefined,
      zipCode: vars.zip_code || undefined,
      fenceType: fenceType || undefined,
      linearFootage: footage || undefined,
      propertyType: vars.property_type?.toLowerCase() || undefined,
      timeline: timeline || undefined,
      budgetMin: budget?.min || undefined,
      budgetMax: budget?.max || undefined,
      botpressConversationId: event.conversationId,
      source: 'website_chat',
    }

    // Remove undefined values
    Object.keys(payload).forEach(key => {
      if (payload[key] === undefined) delete payload[key]
    })

    const headers = { 'Content-Type': 'application/json' }
    if (WEBHOOK_SECRET) headers['x-botpress-secret'] = WEBHOOK_SECRET

    const response = await axios.post(`${API_BASE}/api/leads`, payload, { headers })

    // Store the lead ID for later use (e.g., booking)
    event.state.session.leadId = response.data?.data?.id
    event.state.session.leadScore = response.data?.data?.score
    event.state.session.leadPriority = response.data?.data?.priority

    console.log(`[submitLead] Lead ${response.data?.data?.action}: ID=${response.data?.data?.id}, Score=${response.data?.data?.score}`)
  } catch (error) {
    console.error('[submitLead] Error:', error.message)
    // Don't break the conversation on API error
  }
}

return submitLead()
