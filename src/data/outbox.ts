// Offline outbox: changes made while offline wait here, in order, and are
// sent when the connection returns. Pure helpers (no I/O) so they're testable.
import { applyLocal } from '../domain/actions'
import type { ChangeSet, Snapshot } from '../domain/types'

export interface OutboxItem {
  id: string
  key: string
  label: string
  cs: ChangeSet
  queuedAt: string
  /**
   * True when a send was attempted and the connection dropped mid-request, so
   * the server may already have applied it. A replay that then hits
   * "already gone / already exists" means it did apply.
   */
  uncertain: boolean
}

export type ReplayOutcome = 'offline' | 'applied' | 'rejected'

const NETWORK = /Can't reach the server|Failed to fetch|NetworkError|Load failed|network connection was lost|offline/i
const ALREADY = /stale:|duplicate key/i

export const isNetworkError = (message: string) => NETWORK.test(message)

/** What a failed send means for an outbox item. */
export function classifyReplayError(message: string, uncertain: boolean): ReplayOutcome {
  if (isNetworkError(message)) return 'offline'
  if (uncertain && ALREADY.test(message)) return 'applied'
  return 'rejected'
}

/** Server data with not-yet-synced local changes layered on top, in order. */
export function withOutbox(server: Snapshot, outbox: OutboxItem[]): Snapshot {
  return outbox.reduce((s, item) => applyLocal(s, item.cs), server)
}
