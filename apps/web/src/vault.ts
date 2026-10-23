/**
 * Encryption at rest for the offline queues (Jonathan, Oct 20, 2026, answer 1
 * of the sign in plan: "Queue is encrypted at rest, holds nothing but unsent
 * changes, and empties the moment the server confirms").
 *
 * The unsent changes (outbox.ts), photos, video and invoice files
 * (mediaStore.ts) and voice clips (voiceClient.ts) wait in IndexedDB when
 * there is no signal. Each record is sealed with AES-GCM (256 bit key, a new
 * random 12 byte IV per record or piece) before it is written, and opened
 * only when it is shown or sent.
 *
 * The key: made on this device by WebCrypto as NON-EXTRACTABLE and kept in
 * IndexedDB (`ezbiz-vault`) as a CryptoKey object. The browser stores the key
 * material itself; no script, extension API or export can read its bytes out
 * (crypto.subtle.exportKey refuses), and it is never in localStorage or any
 * readable form. So the queue files on the phone's disk, a backup of the
 * browser profile or a copied IndexedDB folder show only sealed bytes.
 *
 * Why not a key from the server per sign in: the queues must survive no
 * signal, the app being closed and the person being signed out ("if signed
 * out they keep everything and send after the same person signs in again"). A
 * key that has to come from the server could not open the queue offline after
 * a restart, and one kept for that would sit in browser storage in readable
 * form. The limit: code running in this page (the app itself) can use the key
 * while the phone is unlocked, as it must to send; that is the same trust the
 * app has with what is on screen.
 *
 * If WebCrypto or IndexedDB is not available (a very old browser, some private
 * windows) nothing is written to the phone: the queues keep what waits for
 * this visit only, and say so (outbox isDurable).
 */

const DB = 'ezbiz-vault', STORE = 'keys', KEY_ID = 'queue-key-1'

export function vaultAvailable(): boolean {
  return typeof indexedDB !== 'undefined' && typeof crypto !== 'undefined' && !!crypto.subtle
}

let keyPromise: Promise<CryptoKey> | null = null

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1)
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE) }
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}

/**
 * The queues' key: the one kept on this device, or a new one kept now. Two
 * tabs starting at once agree on one key: the check and the write are one
 * IndexedDB transaction, so the second finds the first's key and uses it.
 */
export function queueKey(): Promise<CryptoKey> {
  if (!keyPromise) {
    keyPromise = (async () => {
      if (!vaultAvailable()) throw new Error('This browser cannot keep things encrypted on the phone.')
      const fresh = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
      const db = await openDb()
      return await new Promise<CryptoKey>((resolve, reject) => {
        const t = db.transaction(STORE, 'readwrite')
        const s = t.objectStore(STORE)
        let key: CryptoKey = fresh
        const get = s.get(KEY_ID)
        get.onsuccess = () => {
          if (get.result) key = get.result as CryptoKey
          else s.put(fresh, KEY_ID)
        }
        t.oncomplete = () => resolve(key)
        t.onerror = t.onabort = () => reject(t.error ?? new Error('The phone did not keep the key.'))
      })
    })()
    keyPromise.catch(() => { keyPromise = null })
  }
  return keyPromise
}

const IV_BYTES = 12

/** Sealed: the IV, then the AES-GCM ciphertext (with its tag). */
export async function sealBytes(data: ArrayBuffer | Uint8Array): Promise<ArrayBuffer> {
  const key = await queueKey()
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data as BufferSource))
  const out = new Uint8Array(IV_BYTES + ct.length)
  out.set(iv, 0)
  out.set(ct, IV_BYTES)
  return out.buffer
}

/** Opens what sealBytes made; throws if it was changed or sealed with another key. */
export async function openBytes(sealed: ArrayBuffer | Uint8Array): Promise<ArrayBuffer> {
  const key = await queueKey()
  const all = sealed instanceof Uint8Array ? sealed : new Uint8Array(sealed)
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.slice(0, IV_BYTES) }, key, all.slice(IV_BYTES))
}

export async function sealJson(value: unknown): Promise<ArrayBuffer> {
  return sealBytes(new TextEncoder().encode(JSON.stringify(value)))
}

export async function openJson<T>(sealed: ArrayBuffer | Uint8Array): Promise<T> {
  return JSON.parse(new TextDecoder().decode(await openBytes(sealed))) as T
}

/** A sealed piece as kept: a Blob where the phone allows it (kept on disk), else its bytes. */
export type SealedPiece = Blob | ArrayBuffer

export const pieceBytes = async (p: SealedPiece): Promise<ArrayBuffer> => (p instanceof Blob ? p.arrayBuffer() : p)

/** A file sealed in pieces of `size` bytes, each with its own IV, so a big video is never all in memory at once. */
export async function sealBlob(blob: Blob, size: number, asBlobs = true): Promise<SealedPiece[]> {
  const out: SealedPiece[] = []
  for (let at = 0; at < blob.size || (at === 0 && out.length === 0); at += size) {
    const sealed = await sealBytes(await blob.slice(at, at + size).arrayBuffer())
    out.push(asBlobs ? new Blob([sealed]) : sealed)
    if (blob.size === 0) break
  }
  return out
}

/** The file back from its sealed pieces. */
export async function openBlob(pieces: SealedPiece[], type: string): Promise<Blob> {
  const parts: Blob[] = []
  for (const p of pieces) parts.push(new Blob([await openBytes(await pieceBytes(p))]))
  return new Blob(parts, { type })
}
