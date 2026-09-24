import { diffDays, isValidISODate } from './dates'
import { subtreeHeight } from './placement'
import { MAX_DEPTH, type Category, type ChecklistItem, type ISODate, type Task } from './types'

/** What a form submits. Loose types on purpose: validation decides. */
export interface TaskInput {
  title: unknown
  notes?: unknown
  priority: unknown
  categoryId: unknown
  ongoing?: unknown
  dueDate?: unknown
  checklist?: unknown
  parentId?: unknown
  recurrence?: { everyNDays: unknown; endDate?: unknown } | null
}

export type FieldErrors = Partial<Record<'title' | 'notes' | 'priority' | 'categoryId' | 'dueDate' | 'parentId' | 'recurrence' | 'checklist', string>>

export type ValidationResult =
  | { ok: true; value: Omit<Task, 'id' | 'createdAt'> }
  | { ok: false; errors: FieldErrors }

export interface ValidationContext {
  categories: Category[]
  tasks: Task[]
  /** When editing, the id of the task being edited (so it can't parent itself). */
  selfId?: string
}

/** Size limits — mirrored by DB constraints in 0002_hardening.sql. */
export const LIMITS = { title: 500, notes: 20000, checklistItems: 100, checklistText: 500 } as const

export function isValidPriority(p: unknown): p is number {
  return typeof p === 'number' && Number.isInteger(p) && p >= 1 && p <= 5
}

/** Validate on write: every task write goes through here first. */
export function validateTask(input: TaskInput, ctx: ValidationContext): ValidationResult {
  const errors: FieldErrors = {}

  const title = typeof input.title === 'string' ? input.title.trim() : ''
  if (!title) errors.title = 'Title is required.'
  else if (title.length > LIMITS.title) errors.title = `Title is too long (max ${LIMITS.title} characters).`

  const notes = input.notes == null ? '' : String(input.notes)
  if (notes.length > LIMITS.notes) errors.notes = `Notes are too long (max ${LIMITS.notes} characters).`

  if (!isValidPriority(input.priority)) errors.priority = 'Priority must be a whole number from 1 to 5.'

  const categoryId = typeof input.categoryId === 'string' ? input.categoryId : ''
  if (!categoryId) errors.categoryId = 'Category is required.'
  else if (!ctx.categories.some((c) => c.id === categoryId)) errors.categoryId = 'That category no longer exists.'

  const ongoing = input.ongoing === true
  let dueDate: ISODate | null = null
  if (input.dueDate != null && input.dueDate !== '') {
    if (isValidISODate(input.dueDate)) dueDate = input.dueDate
    else errors.dueDate = 'Due date is not a valid date.'
  } else if (!ongoing) {
    errors.dueDate = 'Due date is required (unless the task is Forever/ongoing).'
  }

  let checklist: ChecklistItem[] = []
  if (input.checklist != null) {
    if (!Array.isArray(input.checklist)) errors.checklist = 'Checklist is malformed.'
    else
      checklist = input.checklist
        .map((i) => ({ text: String(i?.text ?? '').trim(), done: i?.done === true }))
        .filter((i) => i.text)
    if (checklist.length > LIMITS.checklistItems) errors.checklist = `At most ${LIMITS.checklistItems} checklist items.`
    else if (checklist.some((i) => i.text.length > LIMITS.checklistText))
      errors.checklist = `Checklist items can be at most ${LIMITS.checklistText} characters.`
  }

  let parentId: string | null = null
  let depth = 0
  if (input.parentId != null && input.parentId !== '') {
    const parent = ctx.tasks.find((t) => t.id === input.parentId)
    if (!parent) errors.parentId = 'Parent task no longer exists.'
    else if (ctx.selfId && isSelfOrDescendant(ctx.tasks, ctx.selfId, parent.id))
      errors.parentId = 'A task cannot be nested under itself.'
    else if (parent.depth + 1 > MAX_DEPTH) errors.parentId = `Subtasks can nest at most ${MAX_DEPTH} levels deep.`
    else if (ctx.selfId && parent.depth + 1 + subtreeHeight(ctx.tasks, ctx.selfId) > MAX_DEPTH)
      errors.parentId = `Moving it there would nest its subtasks more than ${MAX_DEPTH} levels deep.`
    else {
      parentId = parent.id
      depth = parent.depth + 1
      if (parent.dueDate && dueDate && diffDays(parent.dueDate, dueDate) > 0)
        errors.dueDate = `A subtask can't be due after its parent (“${parent.title}”, due ${parent.dueDate}).`
    }
  }

  // Editing a parent: it can't move earlier than any of its subtasks.
  if (ctx.selfId && dueDate) {
    const late = ctx.tasks.filter((t) => t.parentId === ctx.selfId && t.dueDate && t.dueDate > dueDate)
    if (late.length)
      errors.dueDate ??= `${late.length === 1 ? `Subtask “${late[0].title}” is` : `${late.length} subtasks are`} due after this date — move ${late.length === 1 ? 'it' : 'them'} first.`
  }

  let recurrence: Task['recurrence'] = null
  if (input.recurrence) {
    const n = input.recurrence.everyNDays
    const end = input.recurrence.endDate
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1)
      errors.recurrence = 'Repeat interval must be a whole number of days (1 or more).'
    else if (end != null && end !== '' && !isValidISODate(end)) errors.recurrence = 'Repeat end date is not a valid date.'
    else if (!dueDate) errors.recurrence = 'A repeating task needs a due date.'
    else {
      const endDate = end ? (end as ISODate) : null
      if (endDate && diffDays(dueDate, endDate) < 0) errors.recurrence = 'Repeat end date is before the due date.'
      else recurrence = { everyNDays: n, endDate }
    }
  }

  if (Object.keys(errors).length) return { ok: false, errors }
  return {
    ok: true,
    value: { title, notes, priority: input.priority as number, categoryId, ongoing, dueDate, checklist, parentId, depth, recurrence },
  }
}

function isSelfOrDescendant(tasks: Task[], selfId: string, candidateId: string): boolean {
  let cur: string | null = candidateId
  while (cur) {
    if (cur === selfId) return true
    cur = tasks.find((t) => t.id === cur)?.parentId ?? null
  }
  return false
}

// ───────────── Quick Add ─────────────

export interface QuickAddRow {
  title: string
  dueDate: string
  priority: unknown
  categoryId: string
}

export type QuickAddResult =
  | { ok: true; values: Omit<Task, 'id' | 'createdAt'>[] }
  | { ok: false; rowErrors: Record<number, FieldErrors> }

/**
 * Rows with an empty title are skipped silently. Any titled row with a
 * missing/invalid field blocks the whole batch (all-or-nothing by design).
 */
export function validateQuickAdd(rows: QuickAddRow[], ctx: ValidationContext): QuickAddResult {
  const values: Omit<Task, 'id' | 'createdAt'>[] = []
  const rowErrors: Record<number, FieldErrors> = {}
  rows.forEach((row, i) => {
    if (!row.title.trim()) return
    const r = validateTask({ title: row.title, priority: row.priority, categoryId: row.categoryId, dueDate: row.dueDate }, ctx)
    if (r.ok) values.push(r.value)
    else rowErrors[i] = r.errors
  })
  return Object.keys(rowErrors).length ? { ok: false, rowErrors } : { ok: true, values }
}

/** Validate a new category name. Returns an error message or null. */
export function validateCategoryName(name: string, existing: Category[], selfId?: string): string | null {
  const n = name.trim()
  if (!n) return 'Category name is required.'
  if (n.length > 60) return 'Category name is too long (max 60 characters).'
  if (existing.some((c) => c.id !== selfId && c.name.toLowerCase() === n.toLowerCase())) return `“${n}” already exists.`
  return null
}
