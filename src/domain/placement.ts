import { addDays, diffDays, monthBounds, weekBounds } from './dates'
import type { ISODate, Task } from './types'

// Assumption (confirm): ongoing tasks that carry a due date also appear in the
// date-based tabs (Daily/Weekly/Monthly); only Later explicitly excludes them.

export const isOverdue = (t: Task, today: ISODate) => t.dueDate != null && t.dueDate < today

/** Due today or overdue by any amount — nothing overdue ever disappears from view. */
export const inDaily = (t: Task, today: ISODate) => t.dueDate != null && t.dueDate <= today

/** Due within the current Sunday–Saturday week. */
export function inWeekly(t: Task, today: ISODate) {
  if (!t.dueDate) return false
  const { start, end } = weekBounds(today)
  return t.dueDate >= start && t.dueDate <= end
}

/** Due from today through the next 30 days (forward-looking only). */
export const inMonthlyList = (t: Task, today: ISODate) =>
  t.dueDate != null && t.dueDate >= today && t.dueDate <= addDays(today, 30)

/** Non-ongoing, due after the end of the current calendar month. */
export const inLater = (t: Task, today: ISODate) =>
  !t.ongoing && t.dueDate != null && t.dueDate > monthBounds(today).end

export const inForever = (t: Task) => t.ongoing

/** Per-day counts for a calendar month grid. */
export function monthCounts(tasks: Task[], anyDayInMonth: ISODate, today: ISODate) {
  const { start, end } = monthBounds(anyDayInMonth)
  const days: Record<ISODate, { total: number; overdue: number }> = {}
  for (const t of tasks) {
    if (!t.dueDate || t.dueDate < start || t.dueDate > end) continue
    const d = (days[t.dueDate] ??= { total: 0, overdue: 0 })
    d.total++
    if (isOverdue(t, today)) d.overdue++
  }
  return days
}

// ───────────── sorting ─────────────

const byTitle = (a: Task, b: Task) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
const byDue = (a: Task, b: Task) => {
  if (a.dueDate === b.dueDate) return 0
  if (!a.dueDate) return 1
  if (!b.dueDate) return -1
  return diffDays(b.dueDate, a.dueDate) // earlier first
}

/** Overdue pinned first → priority desc → due date asc → title A–Z. */
export function sortTasks(tasks: Task[], today: ISODate): Task[] {
  return [...tasks].sort(
    (a, b) =>
      Number(isOverdue(b, today)) - Number(isOverdue(a, today)) ||
      b.priority - a.priority ||
      byDue(a, b) ||
      byTitle(a, b),
  )
}

/** Forever tab: priority desc → title A–Z, due date only as tiebreak. */
export function sortForever(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => b.priority - a.priority || byTitle(a, b) || byDue(a, b))
}

// ───────────── hierarchy helpers ─────────────

export const childrenOf = (tasks: Task[], id: string) => tasks.filter((t) => t.parentId === id)

/** All active descendants, parents before children. */
export function descendantsOf(tasks: Task[], id: string): Task[] {
  const out: Task[] = []
  const walk = (pid: string) => {
    for (const c of childrenOf(tasks, pid)) {
      out.push(c)
      walk(c.id)
    }
  }
  walk(id)
  return out
}

/** Breadcrumb of ancestor titles, root first. */
export function breadcrumb(tasks: Task[], t: Task): string[] {
  const out: string[] = []
  let p = t.parentId ? tasks.find((x) => x.id === t.parentId) : undefined
  while (p) {
    out.unshift(p.title)
    p = p.parentId ? tasks.find((x) => x.id === p!.parentId) : undefined
  }
  return out
}
