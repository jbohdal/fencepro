# Portal Token Bug Audit

_Date: 2026-04-25_

## Root cause in one sentence

**Portal accounts, invite tokens, and their hashes are stored in the staff user's localStorage** ([portalAccountStore.ts](apps/web/src/portalAccountStore.ts)). When the customer clicks the activation link, **their** browser opens the portal — which has a different `localStorage` — and cannot find the token. The lookup returns null, and the frontend surfaces *"Invalid activation link"*. Every customer attempting to activate has seen this because it is structurally unavoidable with a localStorage-only backing store.

## 1. Token generation

File: [portalAccountStore.ts:55](apps/web/src/portalAccountStore.ts#L55)

```ts
const uid = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10)
function issueToken(): { raw: string; hash: string } {
  const raw = uid() + uid() + uid()  // ~48 chars, base-36 alphabet
  return { raw, hash: weakHash(raw) }
}
```

- **Source of randomness:** `Math.random()` — NOT cryptographically secure.
- **Character set:** base-36 (0-9, a-z) — URL-safe, no encoding needed.
- **Length:** ~48 chars.

## 2. Token storage

Same file, line 23:

```ts
function weakHash(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) { h = ((h << 5) + h) + s.charCodeAt(i); h = h >>> 0 }
  return `wh_${h.toString(16)}_${s.length}`
}
```

- **Hash algorithm:** a djb2-style hash, ~32 bits — **NOT SHA-256**, not cryptographic.
- **Storage location:** `localStorage.fencepro_portal_accounts` keyed by `inviteTokenHash`.
- **Problem:** the staff's browser has this localStorage; the customer's browser does not.

## 3. Activation URL

```ts
export function buildActivationLink(rawToken: string): string {
  return `${window.location.origin}/#/portal/activate?token=${rawToken}`
}
```

- Raw token in the URL (correct approach).
- No encoding needed (base-36 is URL-safe).
- **Anchor-route URL (`/#/portal/activate`)** — works for SPA. This itself is fine.

## 4. Validation

Client-side (no server call):
```ts
export function verifyAndActivate(rawToken: string, password: string): ... {
  const hash = weakHash(rawToken)
  const account = getAccountByTokenHash(hash)
  if (!account) return { ok: false, error: 'Invalid activation link.' }
  ...
}
```

- Hashes the incoming token.
- Looks up in the current browser's localStorage.
- Returns "Invalid activation link" when not found — **the exact error the customer sees**.
- Expiry check runs *after* the lookup, so expired-vs-missing is indistinguishable to the user.

## 5. URL encoding

Not an issue — base-36 tokens don't contain `+`, `/`, `=`, or other URL-unsafe chars. The bug is not encoding-related.

## 6. Error message accuracy

Current errors are vague:
- *"Invalid activation link."* — returned in 4 different situations (not found, weakHash mismatch, record missing). Customer can't tell which.
- *"This activation link has expired."* — only when the record was found AND expired. Customer never sees this today because the lookup always fails first.

## 7. bcrypt misuse

Not happening. We use a custom weak-hash, not bcrypt. But it's still incorrect — any non-cryptographic hash is insufficient for a security-sensitive invite flow. The spec's fix — SHA-256 — is correct.

## 8. Token consumption

On successful activation ([portalAccountStore.ts:130](apps/web/src/portalAccountStore.ts)):
```ts
all[idx] = { ...all[idx], ...,
  inviteTokenHash: undefined, inviteTokenExpiresAt: undefined,
  ... }
```

Token is consumed on first successful use — correct behavior. Second click should get "invalid token" as expected.

## 9. Second click behavior

If the first activation ever succeeds (it can't under the current bug because staff and customer are in different browsers), a second click would return "Invalid activation link" because the hash is cleared. The error surface would be the same as for a never-valid token — that's a gap the new flow should fix with distinct error codes.

## 10. Frontend flow

File: [CustomerPortalApp.tsx ActivatePage](apps/web/src/CustomerPortalApp.tsx)

```ts
const qs = parseHashQuery()
const token = qs.token || ''
// ...
const r = verifyAndActivate(token, password)
if (!r.ok) { setErr(r.error || 'Activation failed.'); return }
```

- Reads token from `window.location.hash` query string.
- Submits on form submit.
- All validation is client-side against localStorage — **no backend call at all**.

## Fix architecture

The audit confirms the spec's approach is exactly right:

1. Move the portal account data plane to the **portal backend** (Prisma + Postgres) so tokens are cross-browser valid.
2. Use `crypto.randomBytes(32).toString('hex')` for raw tokens — 64 hex chars, URL-safe, cryptographically secure.
3. Store only `sha256(rawToken)` in the database column.
4. Activation route: hash incoming token, look up by hash, check expiry, activate.
5. Distinct error codes per failure mode.
6. Invalidate all existing localStorage-backed invites (they could never have worked server-side).
7. Provide Admin panel to re-issue invites.

Proceeding to implementation.
