// Pure planners: each turns the current state + a user action into a ChangeSet
// that the `apply_changes` RPC applies atomically. No I/O here.
import { addDays, diffDays } from './dates'
import { descendantsOf } from './placement'
import { validateTask } from './validate'
import { emptyChangeSet, MAX_DEPTH, type Category, type ChangeSet, type Completion, type ISODate, type Outcome, type Snapshot, type Task, type TaskSnapshot } from './types'

export interface Env {
  now: () => string // UTC ISO timestamp
  newId: () => string
}

export const defaultEnv: Env = {
  now: () => new Date().toISOString(),
  newId: () => crypto.randomUUID(),
}

export function snapshotOf(t: Task, tasks: Task[], categories: Category[]): TaskSnapshot {
  const cat = categories.find((c) => c.id === t.categoryId)
  const parent = t.parentId ? tasks.find((p) => p.id === t.parentId) : undefined
  return {
    title: t.title,
    notes: t.notes,
    priority: t.priority,
    categoryId: t.categoryId,
    categoryName: cat?.name ?? '(deleted category)',
    categoryColor: cat?.color ?? '#888888',
    ongoing: t.ongoing,
    dueDate: t.dueDate,
    checklist: t.checklist.map((i) => ({ ...i })),
    parentId: t.parentId,
    parentTitle: parent?.title ?? null,
    depth: t.depth,
    recurrence: t.recurrence ? { ...t.recurrence } : null,
    createdAt: t.createdAt,
  }
}

/** Next due date for a recurring task, counted from its due date (never from today). */
export function nextOccurrenceDate(t: Task): ISODate | null {
  if (!t.recurrence || !t.dueDate) return null
  const next = addDays(t.dueDate, t.recurrence.everyNDays)
  if (t.recurrence.endDate && next > t.recurrence.endDate) return null
  return next
}

/**
 * Where a recurring task's next occurrence goes. It stays under its parent
 * unless it would then be due after the parent, in which case it becomes a
 * top-level task (decision 2026-09-24), keeping the subtask date rule intact.
 */
export function occurrenceParent(tasks: Task[], root: Task, newDue: ISODate): { parentId: string | null; detachedFrom: Task | null } {
  const parent = root.parentId ? tasks.find((t) => t.id === root.parentId) : undefined
  if (!parent) return { parentId: null, detachedFrom: null }
  if (parent.dueDate && newDue > parent.dueDate) return { parentId: null, detachedFrom: parent }
  return { parentId: parent.id, detachedFrom: null }
}

/**
 * Clone `root` and its whole active subtree into a new occurrence due `newDue`.
 * Each descendant keeps its day-gap from its own direct parent's due date.
 * Checklists reset to unchecked. See occurrenceParent for where the root lands.
 */
export function cloneSubtree(tasks: Task[], root: Task, newDue: ISODate, env: Env): Task[] {
  const createdAt = env.now()
  const out: Task[] = []
  const { parentId: rootParent } = occurrenceParent(tasks, root, newDue)
  const depthShift = rootParent === root.parentId ? 0 : -root.depth
  const visit = (orig: Task, newParentId: string | null, due: ISODate | null) => {
    const id = env.newId()
    out.push({
      ...orig,
      id,
      parentId: newParentId,
      depth: orig.depth + depthShift,
      dueDate: due,
      checklist: orig.checklist.map((i) => ({ text: i.text, done: false })),
      // A copied subtask whose own repeat series has ended stops repeating.
      recurrence: orig.recurrence && (!orig.recurrence.endDate || (due && due <= orig.recurrence.endDate)) ? { ...orig.recurrence } : null,
      createdAt,
    })
    for (const child of tasks.filter((c) => c.parentId === orig.id)) {
      let childDue: ISODate | null = null
      if (child.dueDate) {
        // If this node had no due date, fall back to the root's shift.
        const shift = orig.dueDate && due ? diffDays(orig.dueDate, due) : diffDays(root.dueDate!, newDue)
        childDue = addDays(child.dueDate, shift)
      }
      visit(child, id, childDue)
    }
  }
  visit(root, rootParent, newDue)
  return out
}

/**
 * Complete or skip a task. Cascades to all active descendants (the UI warns
 * first when there are open subtasks). A recurring task spawns its next
 * occurrence, including a fresh clone of its subtree.
 */
export function planFinish(
  tasks: Task[],
  categories: Category[],
  taskId: string,
  outcome: Outcome,
  env: Env = defaultEnv,
): ChangeSet {
  const task = tasks.find((t) => t.id === taskId)
  if (!task) throw new Error('Task not found — it may have been completed on another device.')
  const cs = emptyChangeSet()
  const at = env.now()
  const next = nextOccurrenceDate(task)
  if (next) cs.inserts.push(...cloneSubtree(tasks, task, next, env))
  for (const t of [task, ...descendantsOf(tasks, taskId)]) {
    cs.completions.push({
      id: env.newId(),
      taskId: t.id,
      parentId: t.parentId,
      outcome,
      dueDate: t.dueDate,
      completedAt: at,
      snapshot: snapshotOf(t, tasks, categories),
    })
  }
  // Deleting the root cascades to descendants in the DB; list them anyway so
  // the local optimistic state matches.
  cs.deletes.push(task.id, ...descendantsOf(tasks, taskId).map((t) => t.id))
  return cs
}

/** Delete a task and its active descendants. History is untouched. */
export function planDelete(tasks: Task[], taskId: string): ChangeSet {
  const cs = emptyChangeSet()
  cs.deletes.push(taskId, ...descendantsOf(tasks, taskId).map((t) => t.id))
  return cs
}

/** Move every active task in one category to another (before deleting it). */
export function planReassignCategory(tasks: Task[], fromId: string, toId: string): ChangeSet {
  const cs = emptyChangeSet()
  cs.updates = tasks.filter((t) => t.categoryId === fromId).map((t) => ({ ...t, categoryId: toId }))
  return cs
}

/**
 * Restore a History entry into active tasks (keeping its original id), under
 * its original parent if that still exists, otherwise at top level.
 */
export function planRestore(
  tasks: Task[],
  categories: Category[],
  c: Completion,
  env: Env = defaultEnv,
  /** Category to use when the original one has since been deleted. */
  categoryOverride?: string,
): ChangeSet {
  if (tasks.some((t) => t.id === c.taskId)) throw new Error('This task is already active.')
  const categoryId = categoryOverride ?? c.snapshot.categoryId
  if (!categories.some((cat) => cat.id === categoryId)) throw new CategoryGoneError(c.snapshot.categoryName)
  const s = c.snapshot
  const input = {
    title: s.title, notes: s.notes, priority: s.priority, categoryId, ongoing: s.ongoing,
    dueDate: s.dueDate, checklist: s.checklist, recurrence: s.recurrence,
  }
  // Reattach under the original parent when it still exists and the result is
  // valid (depth, due date ≤ parent's); otherwise restore at top level.
  const parent = c.parentId ? tasks.find((t) => t.id === c.parentId) : undefined
  let r = parent ? validateTask({ ...input, parentId: parent.id }, { categories, tasks }) : null
  if (!r || !r.ok) r = validateTask({ ...input, parentId: null }, { categories, tasks })
  if (!r.ok) throw new Error(`It can't be restored: ${Object.values(r.errors).join(' ')}`)
  const cs = emptyChangeSet()
  cs.inserts.push({ ...r.value, id: c.taskId, createdAt: env.now() })
  cs.historyDeletes.push(c.id)
  return cs
}

/** Restoring needs a category choice: the original was deleted. */
export class CategoryGoneError extends Error {
  categoryName: string
  constructor(categoryName: string) {
    super(`Its category “${categoryName}” no longer exists — choose another to restore it.`)
    this.name = 'CategoryGoneError'
    this.categoryName = categoryName
  }
}

/** Why a restore didn't reattach under its original parent (null if it did or had none). */
export function restoreDetachReason(tasks: Task[], c: Completion, restored: Task): string | null {
  if (!c.parentId || restored.parentId) return null
  const parent = tasks.find((t) => t.id === c.parentId)
  if (!parent) return null
  return parent.depth + 1 > MAX_DEPTH
    ? `“${parent.title}” is nested too deep`
    : `it's due after “${parent.title}”${parent.dueDate ? ` (${parent.dueDate})` : ''}`
}

/** "X of Y done" for direct children of the current occurrence only. */
export function subtaskProgress(tasks: Task[], completions: Completion[], taskId: string) {
  const open = tasks.filter((t) => t.parentId === taskId).length
  const done = completions.filter((c) => c.parentId === taskId && c.outcome === 'completed').length
  return { done, total: open + done }
}

/** Create a new task from validated fields. */
export function planCreate(value: Omit<Task, 'id' | 'createdAt'>, env: Env = defaultEnv): ChangeSet {
  const cs = emptyChangeSet()
  cs.inserts.push({ ...value, id: env.newId(), createdAt: env.now() })
  return cs
}

/** Create several tasks in one atomic write (Quick Add). */
export function planCreateMany(values: Omit<Task, 'id' | 'createdAt'>[], env: Env = defaultEnv): ChangeSet {
  const cs = emptyChangeSet()
  cs.inserts = values.map((v) => ({ ...v, id: env.newId(), createdAt: env.now() }))
  return cs
}

/** Permanently delete one History entry (the only irreversible action). */
export function planDeleteHistory(completionId: string): ChangeSet {
  const cs = emptyChangeSet()
  cs.historyDeletes.push(completionId)
  return cs
}

/**
 * Replace a task's editable fields with validated ones. When the task moves to
 * a different nesting level, its whole subtree's depths shift with it
 * (parents first, so each row still matches its parent in the database).
 */
export function planUpdate(existing: Task, value: Omit<Task, 'id' | 'createdAt'>, tasks: Task[] = []): ChangeSet {
  const cs = emptyChangeSet()
  cs.updates.push({ ...existing, ...value })
  const shift = value.depth - existing.depth
  if (shift) for (const d of descendantsOf(tasks, existing.id)) cs.updates.push({ ...d, depth: d.depth + shift })
  return cs
}

/** Toggle one checklist item. */
export function planToggleChecklist(existing: Task, index: number): ChangeSet {
  const cs = emptyChangeSet()
  cs.updates.push({ ...existing, checklist: existing.checklist.map((c, i) => (i === index ? { ...c, done: !c.done } : c)) })
  return cs
}

/** Mirror a successfully applied ChangeSet into local state. */
export function applyLocal(s: Snapshot, cs: ChangeSet): Snapshot {
  const gone = new Set(cs.deletes)
  const updated = new Map(cs.updates.map((t) => [t.id, t]))
  const historyGone = new Set(cs.historyDeletes)
  return {
    ...s,
    tasks: [...s.tasks.filter((t) => !gone.has(t.id)).map((t) => updated.get(t.id) ?? t), ...cs.inserts],
    completions: [...cs.completions, ...s.completions].filter((c) => !historyGone.has(c.id)),
  }
}
