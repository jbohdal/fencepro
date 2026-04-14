/**
 * Botpress Custom Action: Get Estimate
 *
 * Calls the FencePro Quote Engine API to calculate a REAL estimate
 * using the same pricing formulas as the CRM.
 *
 * Setup in Botpress Studio:
 * 1. Go to Code → Actions → Create new
 * 2. Paste this code
 * 3. Name it: getEstimate
 */

const axios = require('axios')

const getEstimate = async () => {
  const API_BASE = bp.botConfig?.apiBaseUrl || process.env.API_BASE_URL || 'http://localhost:4000'

  // Map customer-friendly names to CRM fence style names
  const styleMap = {
    // Vinyl
    'vinyl': "WV-ND 6'x6' Privacy",
    'vinyl privacy': "WV-ND 6'x6' Privacy",
    'vinyl 6x6': "WV-ND 6'x6' Privacy",
    'vinyl 6x8': "WV-ND 6'x8' Privacy",
    'white vinyl': "WV-ND 6'x6' Privacy",
    'tan vinyl': "TV-ND 6'x6' Privacy",
    'vinyl no dig': "WV-ND 6'x6' Privacy",
    'vinyl dig set': "WV-DS 6'x6' Privacy",
    // Aluminum
    'aluminum': "Alum - ND - Emily - 48",
    'aluminium': "Alum - ND - Emily - 48",
    'aluminum fence': "Alum - ND - Emily - 48",
    // Chain link
    'chain link': "CL - 6' Galv",
    'chainlink': "CL - 6' Galv",
    'chain link 4': "CL - 4' Galv",
    'chain link 5': "CL - 5' Galv",
    'chain link 6': "CL - 6' Galv",
    'black chain link': "CL - 6' Black",
    'commercial chain link': "CL - Com 6'",
    // Wood
    'wood': "WV-ND 6'x6' Privacy", // Fallback — wood not in material calc yet
    'cedar': "WV-ND 6'x6' Privacy", // Fallback
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

  try {
    const vars = event.state.session || {}
    const rawType = (vars.fence_type || '').toLowerCase().trim()
    const fenceStyle = styleMap[rawType]
    const footage = footageMap[vars.linear_footage] || parseInt(vars.linear_footage) || 150

    if (!fenceStyle) {
      // Style not mapped — fall back to generic pricing
      event.state.session.estimateMessage = `I don't have exact pricing for "${vars.fence_type}" in our system yet, but I can get you an accurate quote with a free in-person estimate. Want me to schedule one?`
      return
    }

    const response = await axios.post(`${API_BASE}/api/quotes/quick-estimate`, {
      fenceStyle,
      linearFootage: footage,
      walkGates: 1,
      dblGates: 0,
    })

    const data = response.data?.data
    if (data) {
      event.state.session.estimateMessage = data.message
      event.state.session.estimatePrice = data.estimatedPrice
      event.state.session.estimatePricePerFoot = data.pricePerFoot
      event.state.session.estimateSections = data.sections
    } else {
      event.state.session.estimateMessage = "I wasn't able to calculate a price right now. Want me to schedule a free in-person estimate instead?"
    }

    console.log(`[getEstimate] ${fenceStyle} @ ${footage}ft → $${data?.estimatedPrice}`)
  } catch (error) {
    console.error('[getEstimate] Error:', error.message)
    event.state.session.estimateMessage = "I had trouble pulling up pricing, but our team can give you an exact number with a free estimate visit. Want me to set that up?"
  }
}

return getEstimate()
