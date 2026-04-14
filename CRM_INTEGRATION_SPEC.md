# CRM Integration Spec — EZ Budget Module

This document describes the FencePro CRM architecture so the EZ Budget admin console can be integrated as a native first-class module.

---

## 1. Navigation System

### CRM Web App (`apps/web/src/App.tsx`)

Navigation uses a **grouped sidebar** pattern. Groups and items are defined in a `NAV_GROUPS` array:

```typescript
interface NavItem {
  name: string        // page identifier + display label
  icon: string        // emoji icon
  roles: UserRole[]   // which roles can see this item
}

interface NavGroup {
  label: string       // group heading (Sales, Operations, Finance, Admin)
  items: NavItem[]
}
```

**To add a new page:**
1. Add an entry to the appropriate group in `NAV_GROUPS` (or create a new group)
2. Add a conditional render in the main content area: `{active === 'EZ Budget' && <EZBudgetPage />}`
3. Import the page component at the top of App.tsx

**Roles:** `'owner' | 'admin' | 'salesman' | 'ops_manager' | 'shop'`

**Active state styling:** `bg-orange-500 text-white font-medium` (inactive: `text-gray-400 hover:bg-gray-800`)

The sidebar is collapsible (56px wide collapsed, 224px expanded). Group labels hide when collapsed. Items show only icons when collapsed.

### Portal App (`apps/portal/src/client/components/Layout.tsx`)

Simpler flat array:

```typescript
const NAV_ITEMS = [
  { label: 'Dashboard', path: 'dashboard', icon: '📊', roles: ['customer', 'admin', 'support_agent'] },
  // ...
]
```

**Portal roles:** `'customer' | 'admin' | 'support_agent'`

EZ Budget admin belongs in the **CRM web app**, not the portal (portal is customer-facing).

---

## 2. Layout & Page Structure

### CRM Web App Layout

Two-column full-screen flex layout:

```
┌─────────────┬────────────────────────────────────────┐
│  Sidebar    │  Header Bar (white, page title, actions)│
│  (gray-900) ├────────────────────────────────────────┤
│  - Brand    │  Scrollable Content Area               │
│  - Nav      │  (flex-1 overflow-y-auto p-6)          │
│  - Profile  │                                         │
│             │                                         │
└─────────────┴────────────────────────────────────────┘
```

**Key classes:**
- Outer: `flex h-screen bg-gray-50 font-sans`
- Sidebar: `w-56 bg-gray-900 flex flex-col shrink-0` (or `w-16` when collapsed)
- Main: `flex-1 flex flex-col overflow-hidden`
- Header: `bg-white border-b border-gray-200 px-8 py-4`
- Content: `flex-1 overflow-y-auto px-8 py-6`

**Page wrapper pattern:** Pages are standalone components. They receive no layout props — they render directly inside the content area. Common page patterns:

```tsx
export default function MyPage() {
  return (
    <div className="space-y-6">
      {/* KPI strip */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl border border-gray-200 p-5">...</div>
      </div>
      {/* Main content card */}
      <div className="bg-white rounded-2xl border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-100 flex justify-between">
          <h3 className="font-semibold text-gray-900">Title</h3>
          <button className="bg-orange-500 text-white px-4 py-2 rounded-lg text-sm font-medium">Action</button>
        </div>
        <div className="divide-y">{/* rows */}</div>
      </div>
    </div>
  )
}
```

---

## 3. Auth System & Protected Routes

### CRM Web App

**No real auth.** Uses a localStorage-stored user profile for role switching:

```typescript
const stored = localStorage.getItem('fencepro_user')
// { name: string, role: UserRole }
```

Role controls which nav items and pages are visible. No JWT, no backend auth.

### Portal App

**Full JWT auth** with access + refresh tokens:

- **Access token:** 15-minute expiry, stored in localStorage as `portal_access_token`
- **Refresh token:** 7-day expiry, stored as `portal_refresh_token`, rotated on use
- **Middleware:** `requireAuth` validates Bearer token and sets `req.user`
- **Role guard:** `requireRole('admin')` for admin-only routes
- **Account scope:** `enforceAccountScope` ensures customers only see their own data

Since EZ Budget is a CRM module (not portal), routes will be **admin-only** and protected by the CRM's API key auth (same as sync routes) or by JWT if accessed from the portal admin panel.

---

## 4. Database & ORM

### Stack
- **Database:** PostgreSQL (local: `postgresql://...@localhost:5432/fencepro_portal`)
- **ORM:** Prisma (v6.19.x)
- **Schema:** `apps/portal/prisma/schema.prisma`

### Migration Approach
The project uses `prisma db push` (not `prisma migrate`) for schema changes. This is fine for development. The migration history is out of sync, so `db push` is the safe path.

### Schema Conventions
- IDs: `String @id @default(uuid())`
- Timestamps: `createdAt DateTime @default(now())`, `updatedAt DateTime @updatedAt`
- Enums: PascalCase (`LeadStage`, `FollowUpStatus`)
- Indexes: `@@index([field])` on foreign keys and frequently queried fields
- Unique constraints: `@unique` on business keys
- Relations: explicit `@relation(fields: [...], references: [id])` with `onDelete: Cascade` where appropriate
- JSON fields: `Json?` type for flexible data
- Money: stored as `Int` in cents (e.g., `amountCents`)

---

## 5. API Route Structure

### Naming Convention
```
/api/{resource}            GET (list), POST (create)
/api/{resource}/:id        GET (detail), PATCH (update), DELETE
/api/{resource}/stats      GET (aggregated stats)
/api/{resource}/{action}   POST (specific action)
```

### Route File Convention
- File: `src/server/routes/{resource}.ts` (kebab-case)
- Export: `export default router`
- Mount in `index.ts`: `app.use('/api/{resource}', routes)`

### Response Format
```typescript
// Success
{ success: true, data: T }

// Error
{ success: false, error: "Human-readable message" }

// Paginated
{ success: true, data: { items: T[], total, page, pageSize, totalPages } }
```

### Validation
All POST/PATCH bodies validated with Zod at route entry:
```typescript
const schema = z.object({ title: z.string().min(1).max(200) })
// In handler:
const data = schema.parse(req.body)
```

### Audit Logging
Sensitive operations wrapped with `auditLog('action_name')` middleware.

---

## 6. Design System

### Styling
- **Framework:** Tailwind CSS v4.2.2 via `@tailwindcss/vite` plugin
- **No component library.** All UI is custom Tailwind utility classes.
- **No CSS files.** Everything inline.

### Color Palette
| Token | Usage |
|-------|-------|
| `gray-900` | Sidebar background |
| `gray-800` | Sidebar hover |
| `gray-700` | Sidebar borders |
| `gray-400` | Inactive nav text |
| `gray-200` | Card borders |
| `gray-100` | Section borders, hover rows |
| `gray-50` | Page background |
| `orange-500` | Active nav, primary action buttons |
| `blue-600` | Links, secondary actions |
| `green-600` | Success / good status |
| `yellow-600` | Warning status |
| `red-600` | Error / danger status |
| `white` | Cards, header |

### Common Patterns

**Card:**
```html
<div className="bg-white rounded-2xl border border-gray-200">
  <div className="px-6 py-4 border-b border-gray-100">
    <h3 className="font-semibold text-gray-900">Title</h3>
  </div>
  <div className="p-6">{/* content */}</div>
</div>
```

**Button (primary):**
```html
<button className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg text-sm font-medium">
```

**Button (secondary):**
```html
<button className="border border-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm hover:bg-gray-50">
```

**Status badge:**
```html
<span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Active</span>
```

**KPI card:**
```html
<div className="bg-white rounded-2xl border border-gray-200 p-5">
  <p className="text-xs text-gray-400 uppercase tracking-wide">Label</p>
  <p className="text-2xl font-bold text-gray-900 mt-1">$12,345</p>
</div>
```

**Table row:**
```html
<div className="px-6 py-3 flex items-center hover:bg-gray-50 cursor-pointer">
```

**Empty state:**
```html
<div className="text-center py-16 text-gray-400">
  <p className="text-lg font-medium">No items yet</p>
  <p className="text-sm mt-1">Create your first item to get started.</p>
</div>
```

### Icons
Emoji-based. No icon library. Each nav item and feature uses a relevant emoji.

---

## 7. Shared Context & Providers

### CRM Web App
No context providers. All state is local useState + localStorage:

- `fencepro_config` — company info, fence styles, pricing config, margins
- `fencepro_quotes` — all saved quotes
- `fencepro_user` — `{ name, role }`

Access config via:
```typescript
import { getConfig } from './configStore'
const config = getConfig()
// config.company, config.pricing, config.margins, config.fenceStyles
```

### Portal App
- `AuthProvider` wraps entire app, provides `useAuth()` hook
- `useAuth()` returns: `{ user, loading, login, register, logout }`
- `user` object: `{ id, email, firstName, lastName, role, accountId, accountName }`

---

## 8. EZ Budget Integration Points

### Where it lives
EZ Budget admin console belongs in the **CRM web app** (`apps/web/src/`) as a new nav group or under the existing "Sales" or "Admin" group.

The public-facing embeddable widget is separate and will be served as a standalone embed script (not part of the CRM UI).

### Backend
EZ Budget API routes go in the portal backend (`apps/portal/src/server/routes/ez-budget.ts`) since that's where the database and Express server live. The CRM web app will call these via the same proxy pattern used for portal sync.

### Data
New Prisma models prefixed with `EzBudget` go in the existing `schema.prisma`. Use `prisma db push` to apply.

---

## Summary Checklist for New Module

1. [ ] Add Prisma models to `apps/portal/prisma/schema.prisma`
2. [ ] Run `npx prisma db push` to sync database
3. [ ] Create route file at `apps/portal/src/server/routes/ez-budget.ts`
4. [ ] Mount in `apps/portal/src/server/index.ts`
5. [ ] Create page component at `apps/web/src/EZBudgetPage.tsx`
6. [ ] Add nav entry to `NAV_GROUPS` in `apps/web/src/App.tsx`
7. [ ] Add route render: `{active === 'EZ Budget' && <EZBudgetPage />}`
