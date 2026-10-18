/**
 * Every error the user sees, in plain words with what to do next. Raw text
 * from the browser or the server ("Failed to fetch", "Contact not found",
 * "String must contain at least 8 character(s)") never reaches the screen.
 */

export type ErrorKind = 'offline' | 'signed-out' | 'not-allowed' | 'gone' | 'conflict' | 'too-big' | 'invalid' | 'server'

export interface PlainError {
  kind: ErrorKind
  /** One sentence: what happened and what to do. */
  message: string
  /** Worth sending again by itself (no signal, server busy). */
  retry: boolean
}

const NETWORK = /failed to fetch|load failed|networkerror|network request failed|network error|the internet connection appears to be offline|err_internet|err_network|err_connection|timed? ?out|abort|econnrefused|econnreset|socket hang up/i

/** Words a server message may use that are safe to show as they are. */
const READABLE = /^[A-Z][^{}<>\[\]_]*[.!?]$/

/** What a failed request means, from its status (0 = never reached the server) and the server's message. */
export function plainError(status: number, serverMessage?: string | null, what = 'This'): PlainError {
  const msg = (serverMessage || '').trim()
  if (status === 0 || NETWORK.test(msg)) {
    return { kind: 'offline', retry: true, message: `No signal right now. ${what} is kept on this phone and will be sent as soon as there is signal.` }
  }
  if (status === 401) return { kind: 'signed-out', retry: true, message: `You have been signed out. Sign in again; ${what.toLowerCase()} is kept on this phone and will be sent after you sign in.` }
  if (status === 403) {
    // The server says in plain words what this login may not do ("Your role cannot change prices. Ask Jonathan.").
    const plain = msg && READABLE.test(msg) && msg.length < 160
    return { kind: 'not-allowed', retry: false, message: plain ? msg : `Your login is not allowed to do this. Ask Jonathan to check your access.` }
  }
  if (status === 404) return { kind: 'gone', retry: false, message: `${what} could not be saved because the record it belongs to is not on the server any more. It may have been deleted on another device.` }
  if (status === 409) return { kind: 'conflict', retry: false, message: `This was changed on another device first. Open it again to see that change, then make yours again if it still applies.` }
  if (status === 413) return { kind: 'too-big', retry: false, message: `That is too big to send. Try a shorter video or fewer photos at once.` }
  if (status === 408 || status === 429 || status >= 500) {
    return { kind: 'server', retry: true, message: `The server is busy or restarting. ${what} is kept on this phone and will be sent again by itself.` }
  }
  // 400 and other refusals: the server's own sentence when it is already plain, otherwise a general one.
  const readable = msg && READABLE.test(msg) && msg.length < 160 && !/string must|expected|invalid_type|zod|undefined|null/i.test(msg)
  return { kind: 'invalid', retry: false, message: readable ? msg : `The server did not accept ${what.toLowerCase()}. Check what was typed and try again. If it keeps happening, tell Jonathan.` }
}

/** For a thrown error (fetch failing, a timeout). */
export function plainThrown(err: unknown, what = 'This'): PlainError {
  const m = err instanceof Error ? `${err.name} ${err.message}` : String(err ?? '')
  return NETWORK.test(m) || (err instanceof TypeError) ? plainError(0, m, what) : plainError(500, m, what)
}

const TECHNICAL = /\b(HTTP \d{3}|TypeError|SyntaxError|Unexpected token|JSON|undefined|null|NaN|stack|ECONN|ENOTFOUND|status code|Internal Server Error|Bad Request|Not Found|not found|Unauthorized|Forbidden|Failed to [a-z]+|String must|Expected [a-z]+|invalid_type|P20\d\d|prisma)\b/i

/**
 * Any message about to be shown, made plain: network failures say "no
 * signal", technical text becomes a sentence with what to do. A sentence that
 * is already plain is left as it is.
 */
export function plainText(msg: unknown, what = 'This'): string {
  const m = (msg instanceof Error ? msg.message : String(msg ?? '')).trim()
  if (!m) return `Something went wrong. Try again; if it keeps happening, tell Jonathan.`
  if (NETWORK.test(m)) return plainError(0, m, what).message
  if (/session expired|not authenticated|log ?in again|signed out/i.test(m)) return plainError(401, m, what).message
  if (TECHNICAL.test(m)) return /not found/i.test(m) ? plainError(404, m, what).message : `Something went wrong on the server. Try again; if it keeps happening, tell Jonathan.`
  return m
}
