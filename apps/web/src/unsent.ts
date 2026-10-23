/**
 * What this phone holds that has not reached the office yet, for one person:
 * changes (outbox.ts), photos, video and invoice files (mediaStore.ts) and
 * voice clips (voiceClient.ts). Signing out asks first when this is not zero
 * (App.tsx); what waits stays on the phone, encrypted (vault.ts), and goes
 * the next time the same person signs in here.
 */

import { waitingFor } from './outbox'
import { waitingCount } from './mediaStore'
import { waitingClips } from './voiceClient'

export async function unsentCount(userId: string | null): Promise<number> {
  const [media, clips] = await Promise.all([
    waitingCount(userId).catch(() => 0),
    waitingClips(undefined, userId).then(l => l.length).catch(() => 0),
  ])
  return waitingFor(userId) + media + clips
}
