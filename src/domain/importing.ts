// Import from a JSON export — either the old v4 artifact's export or this
// app's own export. The file is untrusted input: only whitelisted fields are
// read, every task goes through validateTask, and nothing is written until the
// user has seen the preview and confirmed.
import { isValidISODate } from './dates'
import { nextCategoryColor, safeColor } from './categories'
import type { Env } from './actions'
import { EXPORT_APP } from './exporting'
import { normalizeChecklist, normalizeRecurrence } from './normalize'
import { emptyChangeSet, MAX_DEPTH, type Category, type ChangeSet, type ChecklistItem, type Completion, type Recurrence, type Snapshot, type Task } from './types'
import { validateCategoryName, validateTask } from './validate'

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024
export const MAX_IMPORT_ITEMS = 1000 // matches the apply_changes batch cap

interface RawCategory { name: string; color: string }
interface RawTask {
  createdAt: string | null
  srcId: string; title: unknown; notes: unknown; priority: unknown; categoryName: string; ongoing: unknown
  dueDate: unknown; checklist: unknown; srcParentId: string | null; recurrence: { everyNDays: unknown; endDate?: unknown } | null
}
interface RawCompletion {
  srcTaskId: string | null; srcParentId: string | null; title: string; notes: string; priority: number; categoryName: string
  dueDate: string | null; completedAt: string; outcome: 'completed' | 'skipped'; parentTitle: string | null
  /** Extra snapshot detail, present in this app's own exports. */
  checklist: ChecklistItem[]; recurrence: Recurrence | null; ongoing: boolean; createdAt: string
}
export interface ParsedImport {
  format: 'artifact-v4' | 'horizon-tasks'
  categories: RawCategory[]
  tasks: RawTask[]
  completions: RawCompletion[]
}

const obj = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)

/** Parse the file text into a neutral shape. Throws a readable Error. */
export function parseImport(text: string): ParsedImport {
  if (text.length > MAX_IMPORT_BYTES) throw new Error('That file is too large to be an export (over 5 MB).')
  let root: Record<string, unknown>
  try {
    root = obj(JSON.parse(text))
  } catch {
    throw new Error("That file isn't valid JSON. Choose the .json file from Export.")
  }
  const ours = root.app === EXPORT_APP
  if (!Array.isArray(root.tasks) || !Array.isArray(root.categories))
    throw new Error("That file doesn't look like a Horizon Tasks export (no tasks/categories).")

  const catName = new Map<string, string>()
  const categories: RawCategory[] = []
  for (const c of arr(root.categories)) {
    const o = obj(c)
    const name = str(o.name).trim()
    if (!name) continue
    catName.set(str(o.id), name)
    categories.push({ name, color: safeColor(o.color, '') })
  }

  const tasks: RawTask[] = arr(root.tasks)
    .map(obj)
    .filter((o) => o.complete !== true) // artifact kept completed ones out anyway
    .map((o) => {
      const r = obj(o.recurrence)
      return {
        createdAt: typeof o.createdAt === 'string' && !Number.isNaN(Date.parse(o.createdAt)) ? new Date(o.createdAt).toISOString() : null,
        srcId: str(o.id),
        title: o.title, notes: o.notes, priority: o.priority,
        categoryName: catName.get(str(o.categoryId)) ?? '',
        ongoing: o.ongoing, dueDate: o.dueDate ?? null, checklist: o.checklist ?? [],
        srcParentId: strOrNull(o.parentId),
        recurrence: o.recurrence ? { everyNDays: r.everyNDays, endDate: r.endDate ?? null } : null,
      }
    })

  const completions: RawCompletion[] = arr(root.completions).map((c) => {
    const o = obj(c)
    const s = ours ? obj(o.snapshot) : o // ours nests the task fields in `snapshot`
    const at = str(o.completedAt)
    return {
      srcTaskId: strOrNull(o.taskId),
      srcParentId: strOrNull(o.parentId),
      title: str(s.title).trim() || '(untitled)',
      notes: str(s.notes),
      priority: typeof s.priority === 'number' && Number.isInteger(s.priority) && s.priority >= 1 && s.priority <= 5 ? s.priority : 3,
      categoryName: ours ? str(s.categoryName) : (catName.get(str(s.categoryId)) ?? ''),
      dueDate: isValidISODate(o.dueDate) ? o.dueDate : null,
      // The artifact stored a date only; keep it as local noon so it sorts sensibly.
      completedAt: isValidISODate(at) ? `${at}T12:00:00.000Z` : !Number.isNaN(Date.parse(at)) ? new Date(at).toISOString() : '',
      outcome: o.outcome === 'skipped' ? 'skipped' : 'completed',
      parentTitle: strOrNull(s.parentTitle),
      checklist: ours ? normalizeChecklist(s.checklist).filter((i) => i.text.length <= 500).slice(0, 100) : [],
      recurrence: ours ? normalizeRecurrence(s.recurrence) : null,
      ongoing: ours && s.ongoing === true,
      createdAt: ours && typeof s.createdAt === 'string' && !Number.isNaN(Date.parse(s.createdAt)) ? new Date(s.createdAt).toISOString() : '',
    }
  })
  return { format: ours ? 'horizon-tasks' : 'artifact-v4', categories, tasks, completions }
}

/** Categories referenced by the file that don't exist yet (case-insensitive). */
export function missingCategories(p: ParsedImport, existing: Category[]): { name: string; color: string }[] {
  const have = new Set(existing.map((c) => c.name.toLowerCase()))
  const used = new Set([...p.tasks.map((t) => t.categoryName), ...p.completions.map((c) => c.categoryName)].filter(Boolean).map((n) => n.toLowerCase()))
  const out: { name: string; color: string }[] = []
  const pseudo = [...existing]
  for (const c of p.categories) {
    const key = c.name.toLowerCase()
    if (have.has(key) || !used.has(key) || validateCategoryName(c.name, pseudo)) continue
    const color = c.color || nextCategoryColor(pseudo)
    out.push({ name: c.name, color })
    have.add(key)
    pseudo.push({ id: `pending-${key}`, name: c.name, color, sortOrder: pseudo.length })
  }
  return out
}

export interface ImportPlan {
  changeSet: ChangeSet
  notes: string[] // every adjustment or skip, shown to the user before confirming
  counts: { tasks: number; completions: number; skipped: number; duplicates: number }
}

/**
 * Build the atomic ChangeSet for an import against the current data
 * (categories must already include any created by `missingCategories`).
 * Exact duplicates of existing items are skipped, so importing twice is safe.
 */
export function planImport(p: ParsedImport, current: Snapshot, env: Env): ImportPlan {
  const cs = emptyChangeSet()
  const notes: string[] = []
  let skipped = 0
  let duplicates = 0
  const catId = (name: string) => current.categories.find((c) => c.name.toLowerCase() === name.toLowerCase())?.id ?? ''
  const newId = new Map<string, string>() // src id → new id
  const accepted: Task[] = []
  const ctxTasks = () => [...current.tasks, ...accepted]
  const byId = new Map(p.tasks.map((t) => [t.srcId, t]))
  const label = (t: RawTask) => `“${str(t.title).trim() || '(untitled)'}”`

  // Depth of each source task by walking its parent chain (with cycle guard).
  const depthOf = (t: RawTask): number => {
    const seen = new Set<string>()
    let d = 0
    let cur = t
    while (cur.srcParentId && byId.has(cur.srcParentId) && !seen.has(cur.srcId)) {
      seen.add(cur.srcId)
      cur = byId.get(cur.srcParentId)!
      d++
      if (d > 50) break
    }
    return d
  }
  const ordered = [...p.tasks].sort((a, b) => depthOf(a) - depthOf(b)) // parents first

  const isDuplicate = (title: string, dueDate: string | null) =>
    current.tasks.some((t) => t.title === title && t.dueDate === dueDate)

  for (const t of ordered) {
    const title = str(t.title).trim()
    if (!title) { skipped++; notes.push('Skipped a task with no title.'); continue }
    if (isDuplicate(title, isValidISODate(t.dueDate) ? t.dueDate : null)) { duplicates++; continue }
    let parentId = t.srcParentId ? (newId.get(t.srcParentId) ?? null) : null
    if (t.srcParentId && !parentId) notes.push(`${label(t)}: its parent wasn't imported, so it's now a top-level task.`)
    const parent = parentId ? accepted.find((a) => a.id === parentId) : undefined
    if (parent && parent.depth + 1 > MAX_DEPTH) {
      notes.push(`${label(t)}: nested too deep, so it's now a top-level task.`)
      parentId = null
    }
    const input = {
      title, notes: t.notes, priority: t.priority, categoryId: catId(t.categoryName),
      ongoing: t.ongoing === true, dueDate: t.dueDate, checklist: t.checklist, parentId, recurrence: t.recurrence,
    }
    let r = validateTask(input, { categories: current.categories, tasks: ctxTasks() })
    if (!r.ok && parentId && r.errors.dueDate && Object.keys(r.errors).length === 1) {
      // Due after its parent: keep the task, but at top level, and say so.
      notes.push(`${label(t)}: due after its parent, so it's now a top-level task.`)
      r = validateTask({ ...input, parentId: null }, { categories: current.categories, tasks: ctxTasks() })
    }
    if (!r.ok) {
      skipped++
      notes.push(`Skipped ${label(t)}: ${Object.values(r.errors).join(' ')}`)
      continue
    }
    const task: Task = { ...r.value, id: env.newId(), createdAt: t.createdAt ?? env.now() }
    if (t.srcId) newId.set(t.srcId, task.id)
    accepted.push(task)
  }
  cs.inserts = accepted

  for (const c of p.completions) {
    if (!c.completedAt) { skipped++; notes.push(`Skipped history entry “${c.title}”: no valid completion date.`); continue }
    if (current.completions.some((h) => h.snapshot.title === c.title && h.completedAt === c.completedAt)) { duplicates++; continue }
    const cat = current.categories.find((x) => x.name.toLowerCase() === c.categoryName.toLowerCase())
    const parentId = c.srcParentId ? (newId.get(c.srcParentId) ?? null) : null
    const entry: Completion = {
      id: env.newId(),
      taskId: env.newId(),
      parentId,
      outcome: c.outcome,
      dueDate: c.dueDate,
      completedAt: c.completedAt,
      snapshot: {
        title: c.title.slice(0, 500), notes: c.notes.slice(0, 20000), priority: c.priority,
        categoryId: cat?.id ?? '', categoryName: cat?.name ?? (c.categoryName || '(unknown category)'), categoryColor: cat?.color ?? '#8b929c',
        ongoing: c.ongoing, dueDate: c.dueDate, checklist: c.checklist, parentId, parentTitle: c.parentTitle, depth: parentId ? 1 : 0,
        recurrence: c.recurrence, createdAt: c.createdAt || c.completedAt,
      },
    }
    cs.completions.push(entry)
  }

  if (cs.inserts.length > MAX_IMPORT_ITEMS || cs.completions.length > MAX_IMPORT_ITEMS)
    throw new Error(`That export has more than ${MAX_IMPORT_ITEMS} tasks or history entries; import isn't supported at that size yet.`)
  return { changeSet: cs, notes, counts: { tasks: cs.inserts.length, completions: cs.completions.length, skipped, duplicates } }
}
