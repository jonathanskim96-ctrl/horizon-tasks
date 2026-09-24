// Manual export (a safety net, never automatic). JSON is full fidelity and can
// be re-imported; CSV is for spreadsheets.
import type { Snapshot } from './types'

export const EXPORT_APP = 'horizon-tasks'
export const EXPORT_VERSION = 1

export function toExportJSON(s: Snapshot, exportedAt: string): string {
  return JSON.stringify(
    { app: EXPORT_APP, version: EXPORT_VERSION, exportedAt, categories: s.categories, tasks: s.tasks, completions: s.completions },
    null,
    2,
  )
}

/**
 * One CSV cell. Quotes when needed, and neutralizes spreadsheet formulas
 * (a title like `=HYPERLINK(...)` must not execute when the CSV is opened).
 */
export function csvCell(v: unknown): string {
  let s = v == null ? '' : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCSV(s: Snapshot): string {
  const cat = (id: string) => s.categories.find((c) => c.id === id)?.name ?? ''
  const title = (id: string | null) => (id ? (s.tasks.find((t) => t.id === id)?.title ?? '') : '')
  const rows: unknown[][] = [
    ['status', 'title', 'category', 'priority', 'forever', 'due_date', 'parent', 'repeats_every_days', 'repeat_until', 'notes', 'checklist', 'outcome', 'completed_at'],
  ]
  for (const t of s.tasks)
    rows.push([
      'active', t.title, cat(t.categoryId), t.priority, t.ongoing, t.dueDate ?? '', title(t.parentId),
      t.recurrence?.everyNDays ?? '', t.recurrence?.endDate ?? '', t.notes,
      t.checklist.map((c) => `${c.done ? '[x]' : '[ ]'} ${c.text}`).join(' | '), '', '',
    ])
  for (const c of s.completions)
    rows.push([
      'history', c.snapshot.title, c.snapshot.categoryName, c.snapshot.priority, c.snapshot.ongoing, c.dueDate ?? '',
      c.snapshot.parentTitle ?? '', c.snapshot.recurrence?.everyNDays ?? '', c.snapshot.recurrence?.endDate ?? '',
      c.snapshot.notes, c.snapshot.checklist.map((i) => `${i.done ? '[x]' : '[ ]'} ${i.text}`).join(' | '), c.outcome, c.completedAt,
    ])
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
}
