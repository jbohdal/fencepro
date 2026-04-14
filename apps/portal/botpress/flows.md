# Botpress Flow Structure

Build these flows in Botpress Studio. Each flow is a node-based conversation path.

---

## Flow 1: Main (Entry Point)

**Trigger:** Conversation start

**Nodes:**

1. **Welcome Message** (Text)
   > "Hey! 👋 Looking to get a fence quote or have questions about fencing?"
   
   Quick replies:
   - "Get a quote" → Go to `Lead Qualification` flow
   - "I have questions" → Go to `FAQ` flow (AI handles)
   - "Schedule an estimate" → Go to `Booking` flow

---

## Flow 2: Lead Qualification

**Purpose:** Collect project details step by step

**Nodes:**

### 2.1 — Fence Type
**Text:** "Great! What type of fence are you interested in?"

**Quick replies:**
- Vinyl Privacy
- Aluminum  
- Wood
- Chain Link
- Ornamental Iron
- Other / Not Sure

→ Store in variable: `{{fence_type}}`

### 2.2 — Property Type
**Text:** "Is this for a residential or commercial property?"

**Quick replies:**
- Residential
- Commercial

→ Store in variable: `{{property_type}}`

### 2.3 — Linear Footage
**Text:** "Do you have a rough idea of how many linear feet you need? Even a ballpark is helpful."

**Quick replies:**
- Under 100 ft
- 100-200 ft
- 200-300 ft
- 300+ ft
- Not sure

→ Store in variable: `{{linear_footage}}`
→ Map to numeric: Under 100=75, 100-200=150, 200-300=250, 300+=350, Not sure=null

### 2.4 — Zip Code
**Text:** "What's the zip code for the property?"

→ Store in variable: `{{zip_code}}`
→ Validate: 5 digits

### 2.5 — Timeline
**Text:** "When are you looking to get this done?"

**Quick replies:**
- ASAP
- 1-3 months
- 3-6 months
- Just exploring

→ Store in variable: `{{timeline}}`

### 2.6 — Budget (Optional)
**Text:** "Do you have a budget range in mind? Totally fine if not — it just helps us tailor options."

**Quick replies:**
- Under $3,000
- $3,000 - $5,000
- $5,000 - $10,000
- $10,000+
- Not sure yet

→ Store in variable: `{{budget_range}}`

### 2.7 — Get Estimate
→ **Execute Action:** `getEstimate` (calls your API with fence_type + linear_footage)
→ Display the pricing range message from the API response

**Text (from API):** "Based on what you shared, most vinyl privacy projects at 150 linear feet fall between $3,750 and $6,750. We can confirm with a free in-person estimate."

### 2.8 — Offer Booking
**Text:** "Would you like to schedule a free estimate? One of our pros will come out, take measurements, and give you an exact price — no obligation."

**Quick replies:**
- "Yes, let's do it!" → Go to `Booking` flow
- "Not right now" → Go to `Capture Contact` flow

→ **Execute Action:** `submitLead` (sends all collected data to your API)

---

## Flow 3: Booking

**Purpose:** Capture contact info and schedule the estimate

### 3.1 — Name
**Text:** "Awesome! What's your name?"

→ Store: `{{first_name}}`

### 3.2 — Phone
**Text:** "And the best phone number to reach you?"

→ Store: `{{phone}}`
→ Validate: phone format

### 3.3 — Email
**Text:** "And your email? (We'll send a confirmation)"

→ Store: `{{email}}`
→ Validate: email format

### 3.4 — Address
**Text:** "What's the property address for the estimate?"

→ Store: `{{address}}`

### 3.5 — Preferred Time
**Text:** "When works best for the estimate visit?"

**Quick replies:**
- This week
- Next week
- Morning preferred
- Afternoon preferred

→ Store: `{{preferred_time}}`

### 3.6 — Confirm & Submit
→ **Execute Action:** `bookAppointment` (sends to your API)
→ **Execute Action:** `submitLead` (updates lead with contact info)

**Text:** "You're all set, {{first_name}}! 🎉 We'll confirm your estimate shortly. You'll also get a text confirmation at {{phone}}. Is there anything else I can help with?"

---

## Flow 4: Capture Contact (No Booking)

**Purpose:** Get contact info from leads who aren't ready to book

### 4.1 — Soft Ask
**Text:** "No problem at all! If you'd like, I can have one of our team members follow up with more info. What's the best way to reach you?"

**Quick replies:**
- Share my info
- No thanks

### 4.2 — (If share) Capture
**Text:** "What's your name and phone number or email?"

→ Parse into `{{first_name}}`, `{{phone}}` or `{{email}}`
→ **Execute Action:** `submitLead` (sends to API with all collected project data)

**Text:** "Thanks {{first_name}}! Someone from our team will reach out. In the meantime, feel free to come back here if you have any questions!"

### 4.3 — (If no thanks) Close
**Text:** "Totally fine! Feel free to come back anytime. We're here when you're ready. 👍"
→ **Execute Action:** `submitLead` (sends whatever data was collected)

---

## Flow 5: FAQ (AI-Powered)

**Purpose:** Let the AI handle open-ended questions using the personality config

This flow uses Botpress's built-in AI Agent node:
- Routes to the AI with the personality from `ai-personality.md`
- AI can answer questions about materials, timelines, permits, durability, etc.
- After answering, it offers: "Want to get a quote or schedule an estimate?"
- If yes → routes back to Lead Qualification or Booking flow

---

## Flow 6: Human Handoff

**Trigger:** User says "talk to a human", "speak to someone", "real person"

### 6.1 — Acknowledge
**Text:** "Absolutely! Let me connect you with a team member."

### 6.2 — Capture
**Text:** "Can I get your name and phone number so they can reach out?"

→ Store: `{{first_name}}`, `{{phone}}`

### 6.3 — Submit & Notify
→ **Execute Action:** `submitLead` with tag "human_handoff"

**Text:** "Got it, {{first_name}}! Someone from our team will call you at {{phone}} shortly. Thanks for your patience!"

---

## Variable Summary

| Variable | Type | Source |
|----------|------|--------|
| fence_type | string | Quick reply / AI |
| property_type | string | Quick reply |
| linear_footage | number | Quick reply / free text |
| zip_code | string | Free text |
| timeline | string | Quick reply |
| budget_range | string | Quick reply |
| first_name | string | Free text |
| last_name | string | Free text |
| phone | string | Free text |
| email | string | Free text |
| address | string | Free text |
| preferred_time | string | Quick reply |
