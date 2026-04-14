# FencePro Customer Portal

Full-stack customer-facing portal that integrates with the FencePro CRM system.

## Tech Stack
- **Backend**: Node.js + Express + TypeScript
- **Database**: PostgreSQL + Prisma ORM
- **Auth**: JWT access + refresh tokens with bcrypt password hashing
- **File Storage**: Local filesystem (swappable to S3)
- **CRM**: Adapter pattern — swap between FencePro, HubSpot, Salesforce, Zoho

## Quick Start

### 1. Start the database
```bash
docker compose up -d postgres
```

### 2. Install dependencies
```bash
pnpm install
```

### 3. Set up environment
```bash
cp .env.example .env
# Edit .env with your values (defaults work for local dev)
```

### 4. Run database migrations
```bash
pnpm db:push
```

### 5. Seed demo data
```bash
pnpm db:seed
```

### 6. Start the server
```bash
pnpm dev
```

Server runs on `http://localhost:4000`

### Demo Credentials
| Role | Email | Password |
|------|-------|----------|
| Customer | demo@customer.com | demo1234 |
| Admin | admin@gdfencepro.com | admin1234 |

## API Endpoints

### Auth
| Method | Path | Description |
|--------|------|-------------|
| POST | /api/auth/login | Login with email/password |
| POST | /api/auth/register | Register new customer |
| POST | /api/auth/refresh | Refresh access token |
| POST | /api/auth/logout | Invalidate refresh token |
| GET | /api/auth/me | Get current user profile |

### Dashboard
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/dashboard | Summary KPIs + recent activity |

### Tickets
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/tickets | List tickets (account-scoped) |
| GET | /api/tickets/:id | Ticket detail with comments |
| POST | /api/tickets | Create new ticket |
| POST | /api/tickets/:id/comments | Reply to ticket |

### Invoices
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/invoices | List invoices (account-scoped) |
| GET | /api/invoices/:id/pdf | Download invoice PDF |

### Documents
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/documents | List documents |
| POST | /api/documents | Upload file (multipart/form-data) |
| GET | /api/documents/:id/download | Download file |
| DELETE | /api/documents/:id | Soft delete |

### Contracts
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/contracts | List active contracts |

### Admin (requires admin role)
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/admin/accounts | List all accounts |
| PATCH | /api/admin/customers/:id/portal | Toggle portal access |
| GET | /api/admin/accounts/:id/documents | View account documents |
| GET | /api/admin/audit-logs | View audit logs |
| GET | /api/admin/impersonate/:customerId | Impersonate customer |

## CRM Adapter Guide

The CRM integration uses an adapter pattern. To add a new CRM provider:

1. Create a new file at `src/server/lib/crm/adapters/yourcrm.ts`
2. Implement the `CrmAdapter` interface from `src/types/index.ts`
3. Register it in `src/server/lib/crm/client.ts` switch statement
4. Set `CRM_PROVIDER=yourcrm` in `.env`

The interface requires these methods:
- `getAccount(externalId)` — fetch account details
- `getTickets(accountId)` — list tickets
- `getInvoices(accountId)` — list invoices
- `getContracts(accountId)` — list contracts
- `createTicket(accountId, data)` — create a ticket
- `addTicketComment(ticketId, body, authorName)` — add comment

All CRM calls include retry logic with exponential backoff and 5-minute caching.

## Security
- JWT auth on all API routes
- Account scoping enforced at middleware level (Customer A cannot access Customer B's data)
- Rate limiting: login (5/15min), uploads (10/hr), API (100/min)
- Helmet.js security headers
- File validation (type + size) before storage
- Virus scan hook (placeholder — wire to ClamAV in production)
- Full audit log of all actions with IP + timestamp
- Soft deletes (nothing hard-deleted)
- Files stored outside web root

## Environment Variables
See `.env.example` for the complete list with descriptions.
