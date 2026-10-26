/**
 * Database-backed contact persistence for the CRM web app.
 *
 * Customers live in Postgres (`/api/crm-contacts`), scoped by company on the
 * server. The screen's copy is in memory (customerStore.ts); a change made
 * without signal waits in the encrypted outbox (outbox.ts) until the server
 * confirms it.
 */

import { isSignedIn, fetchWithAuth, currentUser } from './crmAuth'
import { toast } from './toast'
import { LOCAL_API_ORIGIN } from './apiOrigin'
import { registerKind, enqueue, allOps, pendingFor } from './outbox'
import { sendJson } from './syncHttp'
import { newId } from './recordSync'
import { plainError, plainThrown } from './plainError'
import { untableBody, asTable } from './listTable'

const AUTH_API = (window.location.hostname === 'localhost' ? LOCAL_API_ORIGIN : '')

export interface CrmContactPayload {
  /** Permanent id chosen by the browser for a new contact; the server keeps it. */
  id?: string
  firstName: string
  lastName: string
  email?: string
  phone?: string
  serviceAddress?: string
  billingAddress?: string
  billingDifferent?: boolean
  city?: string
  state?: string
  zip?: string
  leadSource?: string
  salesRep?: string
  firstApptDate?: string
  tags?: string[]
  notes?: string
  jobStatus?: string
  isCompleted?: boolean
}

export interface CrmContactRecord extends CrmContactPayload {
  id: string
  ownerId?: string
  archivedAt?: string | null
  createdAt: string
  updatedAt: string
}

async function call<T>(method: string, path: string, body?: unknown): Promise<{ ok: boolean; data?: T; error?: string; serverTime?: string }> {
  const token = isSignedIn()
  if (!token) return { ok: false, error: 'Not authenticated' }
  try {
    const res = await fetchWithAuth(`${AUTH_API}/api/crm-contacts${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (res.status === 401) {
      // Token expired — handled by global session-expired handler in App.tsx.
      return { ok: false, error: 'Session expired' }
    }
    const json = untableBody(await res.json().catch(() => ({})))
    if (!res.ok || json?.success === false) {
      return { ok: false, error: plainError(res.status, json?.error).message }
    }
    return { ok: true, data: json.data as T, serverTime: typeof json?.serverTime === 'string' ? json.serverTime : undefined }
  } catch (err) {
    return { ok: false, error: plainThrown(err).message }
  }
}

/**
 * The server's clock when the last whole list was read: the stores ask for
 * "changed since then" next, instead of the whole list again (which, read
 * again on the first refresh, cost a phone ~0.5 MB and a full redraw).
 */
let listedAt: string | null = null
export function lastListServerTime(): string | null { return listedAt }

export async function listContacts(): Promise<CrmContactRecord[] | null> {
  // As one table (listTable.ts): the same rows, without each row repeating the field names.
  const r = await call<CrmContactRecord[]>('GET', asTable('/'))
  if (r.ok && r.serverTime) listedAt = r.serverTime
  if (!r.ok) {
    toast.error('Could not load customers from cloud', r.error || plainError(0).message)
    return null
  }
  return r.data || []
}

export async function createContact(payload: CrmContactPayload): Promise<CrmContactRecord | null> {
  const r = await call<CrmContactRecord>('POST', '/', payload)
  if (!r.ok) {
    toast.error('Customer not saved to cloud', r.error || plainError(0).message)
    return null
  }
  return r.data || null
}

export async function updateContact(id: string, payload: Partial<CrmContactPayload>): Promise<CrmContactRecord | null> {
  const r = await call<CrmContactRecord>('PATCH', `/${id}`, payload)
  if (!r.ok) {
    toast.error('Update not saved to cloud', r.error || plainError(0).message)
    return null
  }
  return r.data || null
}

export async function archiveContact(id: string): Promise<boolean> {
  const r = await call('DELETE', `/${id}`)
  if (!r.ok) {
    toast.error('Customer not deleted from cloud', r.error || plainError(0).message)
  }
  return r.ok
}

// ── Notes (sub resource) ──

export interface CrmContactNoteRecord {
  id: string
  crmContactId: string
  accountId: string
  body: string
  isPinned: boolean
  visibility: 'internal' | 'all_staff'
  createdBy: string
  createdById?: string | null
  createdAt: string
  updatedAt: string
  deletedAt?: string | null
  /** The writer's name (from the server). */
  createdByName?: string | null
}

/** Who wrote a note, by name: never a login email. */
export function noteAuthor(n: { createdByName?: string | null; createdBy?: string }): string {
  if (n.createdByName) return n.createdByName
  return n.createdBy && !n.createdBy.includes('@') ? n.createdBy : 'Staff'
}

/** The signed in person's name, from their sign in. */
function myName(): string {
  const p = currentUser()
  return `${p?.firstName ?? ''} ${p?.lastName ?? ''}`.trim() || 'You'
}

export interface CrmContactNotePayload {
  body: string
  isPinned?: boolean
  visibility?: 'internal' | 'all_staff'
}

/** A note shown before the server has it ("Saving…" beside it). */
export type ShownNote = CrmContactNoteRecord & { pending?: boolean }

const noteKey = (id: string) => `note:${id}`
interface NoteCreate { contactId: string; note: CrmContactNoteRecord }
interface NoteEdit { contactId: string; noteId: string; changes: Partial<CrmContactNotePayload> }

/**
 * A customer's notes: what the server has, with this phone's notes and edits
 * that are still on their way put on top. Null only when there is nothing to
 * show at all (no signal and nothing kept here); the screen says so in words.
 */
/** The notes the server last sent for each customer, for when there is no signal. */
const lastServerNotes = new Map<string, CrmContactNoteRecord[]>()

export async function listContactNotes(contactId: string): Promise<ShownNote[] | null> {
  const r = await call<CrmContactNoteRecord[]>('GET', `/${contactId}/notes`)
  if (r.ok) lastServerNotes.set(contactId, r.data || [])
  // No signal: the notes already seen stay on screen, with this phone's new ones on top.
  const known = r.ok ? (r.data || []) : lastServerNotes.get(contactId)
  let rows: ShownNote[] = known ? [...known] : []
  const ops = allOps()
  for (const op of ops) {
    if (op.kind === 'note.create' && (op.payload as NoteCreate).contactId === contactId) {
      const n = (op.payload as NoteCreate).note
      if (!rows.some(x => x.id === n.id)) rows = [{ ...n, pending: true }, ...rows]
    }
    if (op.kind === 'note.update' && (op.payload as NoteEdit).contactId === contactId) {
      const e = op.payload as NoteEdit
      rows = rows.map(x => x.id === e.noteId ? { ...x, ...e.changes, pending: true } : x)
    }
    if (op.kind === 'note.delete' && (op.payload as NoteEdit).contactId === contactId) {
      rows = rows.filter(x => x.id !== (op.payload as NoteEdit).noteId)
    }
  }
  if (!r.ok && !known && rows.length === 0) return null
  return rows
}

/** Changes to this customer's notes still on the way (for the customer's status). */
/** One row of an imported file on this customer (server lib/customerImport.ts): the old system's fields, as the file had them. */
export interface ImportHistoryRecord {
  id: string; source: string; sourceKey: string; matched: boolean; matchedBy: string | null; cardId: string | null
  data: Record<string, unknown>; createdAt: string
}

/** What imports brought for this customer; null when it could not be loaded. */
export async function listImportHistory(contactId: string): Promise<ImportHistoryRecord[] | null> {
  const r = await call<ImportHistoryRecord[]>('GET', `/${contactId}/import-history`)
  return r.ok ? r.data || [] : null
}

export const noteChangeFor = (contactId: string) => (op: { kind: string; payload: any }) => op.kind.startsWith('note.') && op.payload?.contactId === contactId

/** Add a note: on screen and kept on this phone now, on the server as soon as it can be. */
export async function createContactNote(contactId: string, payload: CrmContactNotePayload, by = myName()): Promise<ShownNote> {
  const now = new Date().toISOString()
  const note: CrmContactNoteRecord = {
    id: newId(), crmContactId: contactId, accountId: '', body: payload.body, isPinned: !!payload.isPinned,
    visibility: payload.visibility ?? 'all_staff', createdBy: by, createdByName: by, createdAt: now, updatedAt: now,
  }
  const waitFor = pendingFor(`customer:${contactId}`).some(o => o.kind === 'customer.create') ? [`customer:${contactId}`] : []
  await enqueue<NoteCreate>({ key: noteKey(note.id), kind: 'note.create', payload: { contactId, note }, label: `Note: ${payload.body.slice(0, 40)}${payload.body.length > 40 ? '…' : ''}`, after: waitFor })
  return { ...note, pending: true }
}

export async function updateContactNote(contactId: string, noteId: string, payload: Partial<CrmContactNotePayload>): Promise<boolean> {
  await enqueue<NoteEdit>({ key: noteKey(noteId), kind: 'note.update', payload: { contactId, noteId, changes: payload }, label: 'Note changes' })
  return true
}

export async function deleteContactNote(contactId: string, noteId: string): Promise<boolean> {
  await enqueue<NoteEdit>({ key: noteKey(noteId), kind: 'note.delete', payload: { contactId, noteId, changes: {} }, label: 'Note removed' })
  return true
}

registerKind<NoteCreate>('note.create', {
  what: () => 'This note',
  send: op => sendJson('POST', `/api/crm-contacts/${encodeURIComponent(op.payload.contactId)}/notes`, {
    id: op.payload.note.id, body: op.payload.note.body, isPinned: op.payload.note.isPinned, visibility: op.payload.note.visibility,
  }).then(r => r.result),
})
registerKind<NoteEdit>('note.update', {
  what: () => 'This change to the note',
  send: op => sendJson('PATCH', `/api/crm-contacts/${encodeURIComponent(op.payload.contactId)}/notes/${encodeURIComponent(op.payload.noteId)}`, op.payload.changes).then(r => r.result),
})
registerKind<NoteEdit>('note.delete', {
  what: () => 'Removing the note',
  send: async op => {
    const r = await sendJson('DELETE', `/api/crm-contacts/${encodeURIComponent(op.payload.contactId)}/notes/${encodeURIComponent(op.payload.noteId)}`)
    return r.status === 404 ? { ok: true } : r.result
  },
})
