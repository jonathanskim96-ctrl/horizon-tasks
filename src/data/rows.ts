// Pure mapping between Postgres rows (snake_case JSON) and domain types.
// Anything read from the database is normalized defensively, so a malformed
// row can never crash rendering or inject non-text into the UI.
import type { ChangeSet, ChecklistItem, Completion, Outcome, Task, TaskSnapshot } from '../domain/types'
import { normalizeChecklist, normalizeSnapshot, str } from '../domain/normalize'

export { normalizeChecklist, normalizeSnapshot }

export interface TaskRow {
  id: string
  title: string
  notes: string
  priority: number
  category_id: string
  ongoing: boolean
  due_date: string | null
  checklist: ChecklistItem[]
  parent_id: string | null
  depth: number
  recurrence_every_n_days: number | null
  recurrence_end_date: string | null
  created_at: string
}

export interface CompletionRow {
  id: string
  task_id: string
  parent_id: string | null
  outcome: Outcome
  due_date: string | null
  completed_at: string
  snapshot: TaskSnapshot
}

export const taskFromRow = (r: TaskRow): Task => ({
  id: r.id,
  title: str(r.title),
  notes: str(r.notes),
  priority: r.priority,
  categoryId: r.category_id,
  ongoing: r.ongoing === true,
  dueDate: r.due_date,
  checklist: normalizeChecklist(r.checklist),
  parentId: r.parent_id,
  depth: r.depth,
  recurrence: r.recurrence_every_n_days ? { everyNDays: r.recurrence_every_n_days, endDate: r.recurrence_end_date } : null,
  createdAt: r.created_at,
})

export const taskToRow = (t: Task): TaskRow => ({
  id: t.id,
  title: t.title,
  notes: t.notes,
  priority: t.priority,
  category_id: t.categoryId,
  ongoing: t.ongoing,
  due_date: t.dueDate,
  checklist: t.checklist,
  parent_id: t.parentId,
  depth: t.depth,
  recurrence_every_n_days: t.recurrence?.everyNDays ?? null,
  recurrence_end_date: t.recurrence?.endDate ?? null,
  created_at: t.createdAt,
})

export const completionFromRow = (r: CompletionRow): Completion => ({
  id: r.id,
  taskId: r.task_id,
  parentId: r.parent_id,
  outcome: r.outcome === 'skipped' ? 'skipped' : 'completed',
  dueDate: r.due_date,
  completedAt: r.completed_at,
  snapshot: normalizeSnapshot(r.snapshot),
})

export const completionToRow = (c: Completion): CompletionRow => ({
  id: c.id,
  task_id: c.taskId,
  parent_id: c.parentId,
  outcome: c.outcome,
  due_date: c.dueDate,
  completed_at: c.completedAt,
  snapshot: c.snapshot,
})

/** Arguments for the `apply_changes` RPC. */
export const changeSetToArgs = (cs: ChangeSet) => ({
  inserts: cs.inserts.map(taskToRow),
  updates: cs.updates.map(taskToRow),
  deletes: cs.deletes,
  completions: cs.completions.map(completionToRow),
  history_deletes: cs.historyDeletes,
})
