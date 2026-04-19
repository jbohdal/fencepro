# External Service Setup Instructions

Follow these in priority order. Each section is independent.

---

## Priority 1: SendGrid Email (enables invite emails, password resets, invoice sending)

1. Go to https://sendgrid.com and create a free account (100 emails/day free)
2. After logging in, go to **Settings → API Keys** in the left sidebar
3. Click **Create API Key**, name it `FencePro CRM`, select **Full Access**, click **Create & View**
4. Copy the API key immediately — it won't be shown again
5. SSH into your server: `ssh root@143.198.109.59`
6. Edit the env file: `nano /var/www/fencepro/portal/.env`
7. Add this line: `SENDGRID_API_KEY=your_copied_key_here`
8. Also set: `SMTP_FROM_EMAIL=noreply@systemssyndicate.com`
9. Save (Ctrl+X, Y, Enter) and restart: `pm2 restart fencepro`
10. In SendGrid, go to **Settings → Sender Authentication → Authenticate Your Domain**
11. Follow the wizard — it will give you DNS records to add at GoDaddy for systemssyndicate.com
12. Test by inviting a team member from the CRM → Team page

---

## Priority 2: Rotate Secrets on Server

1. SSH into your server: `ssh root@143.198.109.59`
2. Generate new secrets:
   ```
   openssl rand -hex 32
   ```
   Run this 3 times to get 3 different values.
3. Edit the env file: `nano /var/www/fencepro/portal/.env`
4. Replace these lines with your generated values:
   ```
   JWT_SECRET=paste_first_random_value_here
   JWT_REFRESH_SECRET=paste_second_random_value_here
   CRM_SYNC_KEY=paste_third_random_value_here
   ```
5. Save and restart: `pm2 restart fencepro`
6. You will need to log in again (old tokens become invalid)

---

## Priority 3: Twilio SMS (enables appointment confirmations, follow-ups)

1. Go to https://twilio.com and create an account
2. After verifying, go to the **Console Dashboard**
3. Copy your **Account SID** and **Auth Token** from the dashboard
4. Go to **Phone Numbers → Manage → Buy a Number**
5. Search for a number with SMS capability in your area code, purchase it
6. Copy the number in format `+13525551234`
7. SSH into your server and edit env: `nano /var/www/fencepro/portal/.env`
8. Add these lines:
   ```
   TWILIO_ACCOUNT_SID=your_account_sid
   TWILIO_AUTH_TOKEN=your_auth_token
   TWILIO_FROM_NUMBER=+13525551234
   ```
9. Save and restart: `pm2 restart fencepro`

---

## Priority 4: OpenWeatherMap (enables weather on schedule)

1. Go to https://openweathermap.org and create a free account
2. Go to **My API Keys** in your profile
3. Copy the default key (or generate a new one named `FencePro`)
4. You need to add this to the frontend build. Edit your local `.env`:
   - File: `apps/web/.env`
   - Add: `VITE_OPENWEATHER_API_KEY=your_key_here`
5. Rebuild and redeploy the frontend (or I can do this for you)

---

## Priority 5: Google Maps API Restriction

Your Google Maps key is already working. To secure it:

1. Go to https://console.cloud.google.com
2. Go to **APIs & Services → Credentials**
3. Click on your API key
4. Under **Application restrictions**, select **HTTP referrers**
5. Add: `systemssyndicate.com/*` and `www.systemssyndicate.com/*`
6. Under **API restrictions**, select **Restrict key** and check: Maps JavaScript API, Geocoding API, Places API
7. Click **Save**

---

## Priority 6: Stripe Payments (enables payment links on invoices)

This is for when you want customers to pay online:

1. Go to https://stripe.com and create an account
2. Complete business verification
3. Go to **Developers → API Keys**
4. Copy **Secret Key** and **Publishable Key**
5. Go to **Developers → Webhooks → Add Endpoint**
6. URL: `https://systemssyndicate.com/api/webhooks/inbound/stripe`
7. Select events: `payment_intent.succeeded`, `invoice.paid`, `charge.refunded`
8. Copy the **Signing Secret**
9. Add to server env:
   ```
   STRIPE_SECRET_KEY=sk_live_...
   STRIPE_PUBLISHABLE_KEY=pk_live_...
   STRIPE_WEBHOOK_SECRET=whsec_...
   ```

---

## Priority 7: Google Calendar Sync

1. Go to https://console.cloud.google.com
2. Go to **APIs & Services → OAuth consent screen**, configure for External
3. Go to **Credentials → Create Credentials → OAuth client ID**
4. Application type: **Web application**
5. Add redirect URI: `https://systemssyndicate.com/api/google-calendar/callback`
6. Copy **Client ID** and **Client Secret**
7. Add to server env:
   ```
   GOOGLE_CLIENT_ID=your_client_id
   GOOGLE_CLIENT_SECRET=your_client_secret
   GOOGLE_REDIRECT_URI=https://systemssyndicate.com/api/google-calendar/callback
   ```

---

## Environment Variable Checklist

After completing all setups, your server `.env` should have real values for:

```
DATABASE_URL=postgresql://...  (already set on server)
JWT_SECRET=(64 char random)
JWT_REFRESH_SECRET=(64 char random)
CRM_SYNC_KEY=(32 char random)
NODE_ENV=production
PORT=4000
CLIENT_URL=https://systemssyndicate.com
COMPANY_NAME=GD Fence Pro
SENDGRID_API_KEY=SG.xxx
SMTP_FROM_EMAIL=noreply@systemssyndicate.com
TWILIO_ACCOUNT_SID=ACxxx
TWILIO_AUTH_TOKEN=xxx
TWILIO_FROM_NUMBER=+1xxx
```

Optional (add when ready):
```
VITE_OPENWEATHER_API_KEY=xxx (frontend env)
STRIPE_SECRET_KEY=sk_live_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
GOOGLE_CLIENT_ID=xxx
GOOGLE_CLIENT_SECRET=xxx
```
