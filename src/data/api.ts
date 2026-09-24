// Supabase I/O. Maps between Postgres rows (snake_case) and domain types.
import type { Category, ChangeSet, Snapshot, Task } from '../domain/types'
import { STARTER_CATEGORIES } from '../domain/categories'
import { supabase } from './supabase'

function db() {
  if (!supabase) throw new Error('Supabase is not configured.')
  return supabase
}

/** Throws a readable Error for any Supabase error — never swallow. */
function check<T>(res: { data: T | null; error: { message: string } | null }, what: string): NonNullable<T> {
  if (res.error) throw new Error(`${what} failed: ${res.error.message}`)
  if (res.data == null) throw new Error(`${what} failed: no data returned`)
  return res.data as NonNullable<T>
}

interface TaskRow {
  id: string
  title: string
  notes: string
  priority: number
  category_id: string
  ongoing: boolean
  due_date: string | null
  checklist: Task['checklist']
  parent_id: string | null
  depth: number
  recurrence_every_n_days: number | null
  recurrence_end_date: string | null
  created_at: string
}

const taskFromRow = (r: TaskRow): Task => ({
  id: r.id,
  title: r.title,
  notes: r.notes,
  priority: r.priority,
  categoryId: r.category_id,
  ongoing: r.ongoing,
  dueDate: r.due_date,
  checklist: r.checklist ?? [],
  parentId: r.parent_id,
  depth: r.depth,
  recurrence: r.recurrence_every_n_days ? { everyNDays: r.recurrence_every_n_days, endDate: r.recurrence_end_date } : null,
  createdAt: r.created_at,
})

const taskToRow = (t: Task): TaskRow => ({
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

export async function loadAll(): Promise<Snapshot> {
  const [t, c, h] = await Promise.all([
    db().from('tasks').select('*'),
    db().from('categories').select('*').order('sort_order'),
    db().from('completions').select('*').order('completed_at', { ascending: false }),
  ])
  return {
    tasks: check(t, 'Loading tasks').map(taskFromRow),
    categories: check(c, 'Loading categories').map((r) => ({ id: r.id, name: r.name, color: r.color, sortOrder: r.sort_order })),
    completions: check(h, 'Loading history').map((r) => ({
      id: r.id,
      taskId: r.task_id,
      parentId: r.parent_id,
      outcome: r.outcome,
      dueDate: r.due_date,
      completedAt: r.completed_at,
      snapshot: r.snapshot,
    })),
  }
}

/** Insert one category (already validated). */
export async function createCategory(name: string, color: string, sortOrder: number): Promise<Category> {
  const res = await db().from('categories').insert({ name, color, sort_order: sortOrder }).select().single()
  const r = check<{ id: string; name: string; color: string; sort_order: number }>(res, 'Adding category')
  return { id: r.id, name: r.name, color: r.color, sortOrder: r.sort_order }
}

/** Seeds starter categories the first time only (tracked server-side). */
export async function seedStarterCategories(): Promise<boolean> {
  return check(await db().rpc('seed_starter_categories', { starter: STARTER_CATEGORIES }), 'Seeding categories') as boolean
}

/** Apply a ChangeSet atomically (all or nothing). Callers wrap this in guardedWrite. */
export async function applyChanges(cs: ChangeSet): Promise<void> {
  const { error } = (
    await db().rpc('apply_changes', {
      inserts: cs.inserts.map(taskToRow),
      updates: cs.updates.map(taskToRow),
      deletes: cs.deletes,
      completions: cs.completions.map((c) => ({
        id: c.id,
        task_id: c.taskId,
        parent_id: c.parentId,
        outcome: c.outcome,
        due_date: c.dueDate,
        completed_at: c.completedAt,
        snapshot: c.snapshot,
      })),
      history_deletes: cs.historyDeletes,
    })
  )
  // apply_changes returns void, so check the error only.
  if (error) throw new Error(`Saving failed: ${error.message}`)
}
