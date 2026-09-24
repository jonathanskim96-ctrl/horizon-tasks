/** ISO calendar date, `YYYY-MM-DD`, local-day semantics (no time, no zone). */
export type ISODate = string

export interface ChecklistItem {
  text: string
  done: boolean
}

export interface Recurrence {
  everyNDays: number
  endDate: ISODate | null
}

export interface Category {
  id: string
  name: string
  color: string
  sortOrder: number
}

/** An active task. Completed/skipped tasks live only in History. */
export interface Task {
  id: string
  title: string
  notes: string
  priority: number
  categoryId: string
  ongoing: boolean
  dueDate: ISODate | null
  checklist: ChecklistItem[]
  parentId: string | null
  depth: number
  recurrence: Recurrence | null
  createdAt: string
}

export type Outcome = 'completed' | 'skipped'

/** Frozen copy of a task at the moment it left the active set. */
export interface TaskSnapshot {
  title: string
  notes: string
  priority: number
  categoryId: string
  categoryName: string
  categoryColor: string
  ongoing: boolean
  dueDate: ISODate | null
  checklist: ChecklistItem[]
  parentId: string | null
  parentTitle: string | null
  depth: number
  recurrence: Recurrence | null
  createdAt: string
}

export interface Completion {
  id: string
  taskId: string
  parentId: string | null
  outcome: Outcome
  dueDate: ISODate | null
  completedAt: string
  snapshot: TaskSnapshot
}

/** A batch of writes applied atomically by the `apply_changes` RPC. */
export interface ChangeSet {
  inserts: Task[]
  updates: Task[]
  deletes: string[]
  completions: Completion[]
  historyDeletes: string[]
}

export const emptyChangeSet = (): ChangeSet => ({
  inserts: [],
  updates: [],
  deletes: [],
  completions: [],
  historyDeletes: [],
})

/** Deepest allowed `depth` (top-level tasks are depth 0). */
export const MAX_DEPTH = 4
