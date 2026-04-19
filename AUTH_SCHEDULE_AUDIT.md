# Auth & Schedule Audit

## 1. Authentication
- **Portal:** Full JWT auth (bcrypt, access+refresh tokens, role middleware) for Customer model
- **CRM Web App:** NO auth — localStorage dropdown for role switching. Anyone can change role.

## 2. User/Team Tables
- Portal has `Customer` model (passwordHash, role: customer/admin/support_agent)
- Root Prisma has `User` model (clerkId, role: OWNER/ADMIN/SALES/INSTALLER/ACCOUNTING) but unused by web app
- No `user_sessions` or `user_activity_log` tables exist

## 3. Role System
- CRM uses client-side `UserRole` type: owner/admin/salesman/ops_manager/shop — no server enforcement

## 4. Smart Schedule (SmartSchedule.tsx)
- Loads from both `fencepro_jobs` and `fencepro_staging` localStorage
- Address from jobs: `j.customerAddress`, from staging: `s.area || ''`
- Geocodes via `google.maps.Geocoder()` — requires Google Maps loaded
- Uses `@googlemaps/js-api-loader` via mapsLoader.ts
- API key: `VITE_GOOGLE_MAPS_API_KEY` from .env

## 5. Map Failures
- Empty addresses (staging `area` field often blank)
- Silent geocoding failures (no error feedback)
- Assumes `google.maps` global is available before API loads
- No address validation/standardization

## 6. Email System
- SendGrid API (primary) via emailService.ts, falls back to console.log
- Currently not configured (no SENDGRID_API_KEY)
