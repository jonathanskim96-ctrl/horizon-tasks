// Supabase I/O. Maps between Postgres rows (snake_case) and domain types.
import type { Category, ChangeSet, Snapshot } from '../domain/types'
import { changeSetToArgs, completionFromRow, taskFromRow } from './rows'
import { safeColor, STARTER_CATEGORIES } from '../domain/categories'
import { supabase } from './supabase'

function db() {
  if (!supabase) throw new Error('Supabase is not configured.')
  return supabase
}

/** Browsers word "no network" differently; say it plainly. */
export function friendlyError(message: string): string {
  return /Failed to fetch|NetworkError|Load failed|network connection was lost|internet connection appears to be offline/i.test(message)
    ? "Can't reach the server — you may be offline."
    : message
}

/** Throws a readable Error for any Supabase error — never swallow. */
function check<T>(res: { data: T | null; error: { message: string } | null }, what: string): NonNullable<T> {
  if (res.error) throw new Error(`${what} failed: ${friendlyError(res.error.message)}`)
  if (res.data == null) throw new Error(`${what} failed: no data returned`)
  return res.data as NonNullable<T>
}

export async function loadAll(): Promise<Snapshot> {
  const [t, c, h] = await Promise.all([
    db().from('tasks').select('*'),
    db().from('categories').select('*').order('sort_order'),
    db().from('completions').select('*').order('completed_at', { ascending: false }),
  ])
  return {
    tasks: check(t, 'Loading tasks').map(taskFromRow),
    categories: check(c, 'Loading categories').map((r) => ({ id: r.id, name: String(r.name), color: safeColor(r.color), sortOrder: r.sort_order })),
    completions: check(h, 'Loading history').map(completionFromRow),
  }
}

/** Insert one category (already validated). */
export async function createCategory(name: string, color: string, sortOrder: number): Promise<Category> {
  const res = await db().from('categories').insert({ name, color, sort_order: sortOrder }).select().single()
  const r = check<{ id: string; name: string; color: string; sort_order: number }>(res, 'Adding category')
  return { id: r.id, name: r.name, color: r.color, sortOrder: r.sort_order }
}

/** Rename/recolor a category (already validated). */
export async function updateCategory(id: string, name: string, color: string): Promise<void> {
  const { data, error } = await db().from('categories').update({ name, color }).eq('id', id).select('id')
  if (error) throw new Error(`Saving category failed: ${friendlyError(error.message)}`)
  if (!data?.length) throw new Error('stale: this category was already changed on another device')
}

/** Delete a category. The database refuses while any active task still uses it. */
export async function deleteCategory(id: string): Promise<void> {
  const { data, error } = await db().from('categories').delete().eq('id', id).select('id')
  if (error) {
    if (/foreign key|violates/i.test(error.message)) throw new Error('Some tasks still use this category — move them first.')
    throw new Error(`Deleting category failed: ${friendlyError(error.message)}`)
  }
  if (!data?.length) throw new Error('stale: this category was already deleted on another device')
}

/** Seeds starter categories the first time only (tracked server-side). */
export async function seedStarterCategories(): Promise<boolean> {
  return check(await db().rpc('seed_starter_categories', { starter: STARTER_CATEGORIES }), 'Seeding categories') as boolean
}

/** Apply a ChangeSet atomically (all or nothing). Callers wrap this in guardedWrite. */
export async function applyChanges(cs: ChangeSet): Promise<void> {
  const { error } = await db().rpc('apply_changes', changeSetToArgs(cs))
  // apply_changes returns void, so check the error only.
  if (error) throw new Error(`Saving failed: ${friendlyError(error.message)}`)
}

/**
 * Live sync: call `onChange` whenever one of this user's rows changes on any
 * device. Realtime enforces RLS, so only the user's own rows produce events.
 * Returns an unsubscribe function. Failures are silent by design: the app
 * also refreshes on focus and every minute, so sync still works without it.
 */
export function subscribeToChanges(onChange: () => void): () => void {
  if (!supabase) return () => {}
  const client = supabase
  const channel = client.channel('horizon-sync')
  for (const table of ['tasks', 'categories', 'completions'])
    channel.on('postgres_changes', { event: '*', schema: 'public', table }, onChange)
  channel.subscribe()
  return () => void client.removeChannel(channel)
}
