// Pure planners: each turns the current state + a user action into a ChangeSet
// that the `apply_changes` RPC applies atomically. No I/O here.
import { addDays, diffDays } from './dates'
import { descendantsOf } from './placement'
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
 * Clone `root` and its whole active subtree into a new occurrence due `newDue`.
 * Each descendant keeps its day-gap from its own direct parent's due date.
 * Checklists reset to unchecked.
 */
export function cloneSubtree(tasks: Task[], root: Task, newDue: ISODate, env: Env): Task[] {
  const createdAt = env.now()
  const out: Task[] = []
  const visit = (orig: Task, newParentId: string | null, due: ISODate | null) => {
    const id = env.newId()
    out.push({
      ...orig,
      id,
      parentId: newParentId,
      dueDate: due,
      checklist: orig.checklist.map((i) => ({ text: i.text, done: false })),
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
  visit(root, root.parentId, newDue)
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

/**
 * Restore a History entry into active tasks (keeping its original id), under
 * its original parent if that still exists, otherwise at top level.
 */
export function planRestore(tasks: Task[], categories: Category[], c: Completion, env: Env = defaultEnv): ChangeSet {
  if (tasks.some((t) => t.id === c.taskId)) throw new Error('This task is already active.')
  if (!categories.some((cat) => cat.id === c.snapshot.categoryId))
    throw new Error(`Its category “${c.snapshot.categoryName}” no longer exists — recreate it or pick another first.`)
  const parent = c.parentId ? tasks.find((t) => t.id === c.parentId) : undefined
  const attach = parent && parent.depth + 1 <= MAX_DEPTH ? parent : undefined
  const s = c.snapshot
  const cs = emptyChangeSet()
  cs.inserts.push({
    id: c.taskId,
    title: s.title,
    notes: s.notes,
    priority: s.priority,
    categoryId: s.categoryId,
    ongoing: s.ongoing,
    dueDate: s.dueDate,
    checklist: s.checklist.map((i) => ({ ...i })),
    parentId: attach?.id ?? null,
    depth: attach ? attach.depth + 1 : 0,
    recurrence: s.recurrence ? { ...s.recurrence } : null,
    createdAt: env.now(),
  })
  cs.historyDeletes.push(c.id)
  return cs
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

/** Replace a task's editable fields with validated ones. */
export function planUpdate(existing: Task, value: Omit<Task, 'id' | 'createdAt'>): ChangeSet {
  const cs = emptyChangeSet()
  cs.updates.push({ ...existing, ...value })
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
