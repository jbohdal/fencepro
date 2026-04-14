/**
 * Botpress Custom Action: Save Transcript
 *
 * Sends the full conversation transcript to the FencePro backend.
 * Call this at the end of conversations or before handoff.
 *
 * Setup in Botpress Studio:
 * 1. Go to Code → Actions → Create new
 * 2. Paste this code
 * 3. Name it: saveTranscript
 */

const axios = require('axios')

const saveTranscript = async () => {
  const API_BASE = bp.botConfig?.apiBaseUrl || process.env.API_BASE_URL || 'http://localhost:4000'
  const WEBHOOK_SECRET = bp.botConfig?.webhookSecret || process.env.BOTPRESS_WEBHOOK_SECRET || ''

  try {
    // Get conversation messages from Botpress
    const messages = await bp.events.findEvents({
      conversationId: event.conversationId,
      direction: 'incoming',
    })

    const botMessages = await bp.events.findEvents({
      conversationId: event.conversationId,
      direction: 'outgoing',
    })

    // Combine and sort by timestamp
    const allMessages = [
      ...messages.map(m => ({
        role: 'user',
        content: m.preview || m.payload?.text || '',
        timestamp: m.createdOn,
      })),
      ...botMessages.map(m => ({
        role: 'assistant',
        content: m.preview || m.payload?.text || '',
        timestamp: m.createdOn,
      })),
    ].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))

    const headers = { 'Content-Type': 'application/json' }
    if (WEBHOOK_SECRET) headers['x-botpress-secret'] = WEBHOOK_SECRET

    await axios.post(`${API_BASE}/api/leads/conversation`, {
      botpressConversationId: event.conversationId,
      transcript: allMessages,
    }, { headers })

    console.log(`[saveTranscript] Saved ${allMessages.length} messages for conversation ${event.conversationId}`)
  } catch (error) {
    console.error('[saveTranscript] Error:', error.message)
  }
}

return saveTranscript()
