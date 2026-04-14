/**
 * Botpress Webchat Embed Configuration
 *
 * Add this to your website's HTML (before </body>).
 * Replace YOUR_BOT_ID with your actual Botpress bot ID from the dashboard.
 *
 * To get your Bot ID:
 * 1. Go to https://app.botpress.cloud
 * 2. Open your bot
 * 3. Go to Channels → Webchat
 * 4. Copy the Bot ID from the embed code
 */

// ── Option 1: Standard embed (paste in HTML) ──

/*
<script src="https://cdn.botpress.cloud/webchat/v2.2/inject.js"></script>
<script src="https://files.bpcontent.cloud/2024/YOUR_BOT_ID/webchat/v2.2/config.js"></script>
<script>
  window.botpress.init({
    botId: 'YOUR_BOT_ID',
    configuration: {
      botName: 'GD Fence Pro',
      botDescription: 'Your fence project assistant',
      website: {
        title: 'GD Fence Pro',
        link: 'https://gdfencepro.com',
      },
      // Colors — match your brand
      color: '#2563eb',           // primary blue
      variant: 'solid',
      themeMode: 'light',
      fontFamily: 'inter',
      radius: 1,
      // Behavior
      showPoweredBy: false,
      enableTranscriptDownload: false,
      // Auto-open after 5 seconds
      showBotInfoPage: false,
      showConversationsButton: false,
    },
  })

  // Auto-open after 5 seconds on first visit
  setTimeout(() => {
    const hasOpened = sessionStorage.getItem('bp_opened')
    if (!hasOpened) {
      window.botpress.open()
      sessionStorage.setItem('bp_opened', 'true')
    }
  }, 5000)
</script>
*/


// ── Option 2: React component (for portal integration) ──

/*
import { useEffect } from 'react'

export function BotpressChat({ botId }) {
  useEffect(() => {
    // Load Botpress webchat script
    const script1 = document.createElement('script')
    script1.src = 'https://cdn.botpress.cloud/webchat/v2.2/inject.js'
    script1.async = true
    document.body.appendChild(script1)

    script1.onload = () => {
      window.botpress.init({
        botId: botId,
        configuration: {
          botName: 'GD Fence Pro',
          color: '#2563eb',
          variant: 'solid',
          themeMode: 'light',
          showPoweredBy: false,
        },
      })

      // Auto-open after 5 seconds
      setTimeout(() => {
        const hasOpened = sessionStorage.getItem('bp_opened')
        if (!hasOpened) {
          window.botpress.open()
          sessionStorage.setItem('bp_opened', 'true')
        }
      }, 5000)
    }

    return () => {
      // Cleanup
      document.body.removeChild(script1)
    }
  }, [botId])

  return null
}
*/
