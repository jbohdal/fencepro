# FencePro Lead Chatbot — Botpress Setup

This directory contains everything you need to set up the lead generation chatbot in Botpress Cloud.

## Quick Start

1. Go to https://botpress.cloud and create a free account
2. Create a new bot
3. Follow the setup steps below

## Architecture

```
[Your Website] → [Botpress Cloud Widget] → [Botpress Flows + AI]
                                                 ↓ (webhooks)
                                         [Your Express API]
                                           /api/leads
                                           /api/appointments
                                           /api/pricing-rules
```

## Setup Steps

### 1. Create Bot in Botpress Cloud

- Go to https://app.botpress.cloud
- Click "Create Bot"
- Name it: "GD Fence Pro Assistant" (or your company name)

### 2. Configure AI

- In your bot settings, go to **AI Integration**
- Botpress includes built-in AI (no separate OpenAI key needed)
- Set the AI personality (see `ai-personality.md`)

### 3. Import Flows

- In the Botpress Studio, create the flows described in `flows.md`
- Each flow handles a specific part of the conversation

### 4. Add Custom Actions

- Go to **Code** in the Studio
- Create each action from the `actions/` directory
- These call your backend API

### 5. Configure Webchat

- Go to **Channels** → **Webchat**
- Copy the embed script
- Add it to your website/portal

### 6. Set Variables

In Botpress Studio → Variables, create:

| Variable | Type | Description |
|----------|------|-------------|
| api_base_url | string | Your API URL (e.g., https://api.yoursite.com) |
| webhook_secret | string | Same as BOTPRESS_WEBHOOK_SECRET in .env |

### 7. Test

- Use the Botpress emulator to test the full flow
- Check your server logs for incoming webhook calls
- Verify leads appear in your database

## Files

- `README.md` — this file
- `flows.md` — complete flow structure to build in Botpress Studio
- `ai-personality.md` — AI prompt / personality configuration
- `webchat-config.js` — embed snippet for your website
- `actions/` — custom action code for Botpress
  - `submitLead.js` — sends lead data to your API
  - `getEstimate.js` — fetches pricing from your API
  - `bookAppointment.js` — books estimate appointment
  - `saveTranscript.js` — sends conversation transcript
