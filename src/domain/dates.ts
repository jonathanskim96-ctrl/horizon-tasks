import type { ISODate } from './types'

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const DAY_MS = 86_400_000

export function isValidISODate(s: unknown): s is ISODate {
  if (typeof s !== 'string') return false
  const m = ISO_RE.exec(s)
  if (!m) return false
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]
}

// All arithmetic is done on UTC midnights so DST never shifts a day.
const toUTC = (iso: ISODate) => {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}
const fromUTC = (ms: number): ISODate => new Date(ms).toISOString().slice(0, 10)

/** Today's date on the device's local calendar. */
export function todayISO(now: Date = new Date()): ISODate {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export const addDays = (iso: ISODate, n: number): ISODate => fromUTC(toUTC(iso) + n * DAY_MS)

/** Whole days from `a` to `b` (positive when b is later). */
export const diffDays = (a: ISODate, b: ISODate): number => Math.round((toUTC(b) - toUTC(a)) / DAY_MS)

/** Sunday–Saturday week containing `iso`. */
export function weekBounds(iso: ISODate): { start: ISODate; end: ISODate } {
  const dow = new Date(toUTC(iso)).getUTCDay()
  const start = addDays(iso, -dow)
  return { start, end: addDays(start, 6) }
}

export function monthBounds(iso: ISODate): { start: ISODate; end: ISODate } {
  const [y, m] = iso.split('-').map(Number)
  return { start: fromUTC(Date.UTC(y, m - 1, 1)), end: fromUTC(Date.UTC(y, m, 0)) }
}

/** Format a UTC timestamp for display in the app's home time zone. */
export function formatTimestamp(ts: string, timeZone = 'America/Los_Angeles'): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ts))
}
