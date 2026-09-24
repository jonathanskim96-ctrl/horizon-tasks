// Defensive normalization of untrusted data (database rows, import files):
// only whitelisted fields, only the right types, so malformed input can never
// crash rendering or smuggle non-text into the UI.
import type { ChecklistItem, Task, TaskSnapshot } from './types'

export const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)
export const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null)
export const int = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isInteger(v) ? v : fallback)

export function normalizeChecklist(v: unknown): ChecklistItem[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((i): i is Record<string, unknown> => typeof i === 'object' && i !== null)
    .map((i) => ({ text: str(i.text), done: i.done === true }))
}

export function normalizeRecurrence(v: unknown): Task['recurrence'] {
  if (typeof v !== 'object' || v === null) return null
  const r = v as Record<string, unknown>
  const n = int(r.everyNDays, 0)
  return n > 0 ? { everyNDays: n, endDate: strOrNull(r.endDate) } : null
}

export function normalizeSnapshot(v: unknown): TaskSnapshot {
  const s = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>
  return {
    title: str(s.title, '(untitled)'),
    notes: str(s.notes),
    priority: int(s.priority, 3),
    categoryId: str(s.categoryId),
    categoryName: str(s.categoryName, '(unknown category)'),
    categoryColor: str(s.categoryColor, '#8b929c'),
    ongoing: s.ongoing === true,
    dueDate: strOrNull(s.dueDate),
    checklist: normalizeChecklist(s.checklist),
    parentId: strOrNull(s.parentId),
    parentTitle: strOrNull(s.parentTitle),
    depth: int(s.depth, 0),
    recurrence: normalizeRecurrence(s.recurrence),
    createdAt: str(s.createdAt),
  }
}

