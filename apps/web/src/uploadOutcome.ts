/**
 * What became of a file sent from this device (photos, video, vendor
 * invoices; mediaStore.ts), in plain words. Kept apart from mediaStore so it
 * can be tested on its own.
 */

/**
 * The server said no and trying again will not change it (a file it does not
 * take, no permission, too big): 4xx other than "not all bytes yet" (409),
 * "timed out" (408), "slow down" (429) and "signed out" (401, the sign in
 * comes back). A lost signal or a server error is tried again later.
 */
export function refusalOf(status: number, body: any): string | null {
  if (status < 400 || status >= 500 || status === 401 || status === 408 || status === 409 || status === 429) return null
  const said = typeof body?.error === 'string' && body.error.trim() ? body.error.trim() : ''
  return said || (status === 403 ? 'This login is not allowed to upload it.' : status === 413 ? 'The file is too big.' : 'The server would not take this file.')
}

/** The kinds of file a vendor invoice can be: a PDF, or a photo the server takes. */
export const isInvoicePdf = (f: { type: string; name: string }) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
export const isInvoicePhoto = (f: { type: string; name: string }) => /^image\/(jpeg|png|webp|heic|heif)$/.test(f.type) || (!f.type && /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name))

/**
 * Files just saved for upload, after a try: all uploaded, turned down by the
 * server (its reason), or still on this device (no signal or the server could
 * not be reached; they go by themselves later).
 */
export function uploadOutcome(ids: string[], stillHere: Array<{ clientId: string }>, refusedWhy: (id: string) => string | null, online: boolean):
  { kind: 'uploaded' } | { kind: 'refused'; why: string } | { kind: 'waiting'; why: string } {
  const left = ids.filter(id => stillHere.some(f => f.clientId === id))
  if (!left.length) return { kind: 'uploaded' }
  const why = left.map(refusedWhy).find((w): w is string => !!w)
  if (why) return { kind: 'refused', why }
  return { kind: 'waiting', why: online ? 'The server could not be reached. It is saved on this device and uploads by itself; tap Try now to send it again.' : 'No signal. It is saved on this device and uploads as soon as there is signal.' }
}
