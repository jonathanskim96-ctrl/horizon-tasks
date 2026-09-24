import { describe, expect, it } from 'vitest'
import { addDays, diffDays, isValidISODate, monthBounds, todayISO, weekBounds } from './dates'
import { inDaily, inLater, inMonthlyList, inWeekly, monthCounts, parentCandidates, sortForever, sortTasks, breadcrumb } from './placement'
import { validateCategoryName, validateQuickAdd, validateTask } from './validate'
import { applyLocal, restoreDetachReason, cloneSubtree, nextOccurrenceDate, planCreate, planDelete, planFinish, planRestore, planToggleChecklist, planUpdate, subtaskProgress, type Env } from './actions'
import { nextCategoryColor, PALETTE, safeColor } from './categories'
import type { Category, Snapshot, Task } from './types'

const cats: Category[] = [{ id: 'c1', name: 'Admin', color: '#ea580c', sortOrder: 0 }]
let seq = 0
const env: Env = { now: () => '2026-09-24T12:00:00.000Z', newId: () => `new${++seq}` }
const mk = (p: Partial<Task> & { id: string }): Task => ({
  title: p.id, notes: '', priority: 3, categoryId: 'c1', ongoing: false, dueDate: '2026-09-24',
  checklist: [], parentId: null, depth: 0, recurrence: null, createdAt: '2026-09-01T00:00:00Z', ...p,
})
const TODAY = '2026-09-24' // a Thursday

describe('dates', () => {
  it('validates ISO dates strictly', () => {
    expect(isValidISODate('2026-02-29')).toBe(false)
    expect(isValidISODate('2028-02-29')).toBe(true)
    expect(isValidISODate('2026-9-1')).toBe(false)
  })
  it('does day arithmetic across DST', () => {
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02')
    expect(diffDays('2026-03-07', '2026-03-09')).toBe(2)
  })
  it('computes Sun–Sat week and month bounds', () => {
    expect(weekBounds(TODAY)).toEqual({ start: '2026-09-20', end: '2026-09-26' })
    expect(weekBounds('2026-09-20').start).toBe('2026-09-20')
    expect(monthBounds('2026-02-10')).toEqual({ start: '2026-02-01', end: '2026-02-28' })
  })
  it('uses the local calendar day for today', () => {
    expect(todayISO(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
  })
})

describe('validation', () => {
  const ctx = { categories: cats, tasks: [mk({ id: 'p', dueDate: '2026-09-30' })] }
  it('rejects non-integer priority', () => {
    const r = validateTask({ title: 'x', priority: 3.7, categoryId: 'c1', dueDate: TODAY }, ctx)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.priority).toBeTruthy()
    expect(validateTask({ title: 'x', priority: '3', categoryId: 'c1', dueDate: TODAY }, ctx).ok).toBe(false)
  })
  it('requires due date unless ongoing, and a category', () => {
    expect(validateTask({ title: 'x', priority: 3, categoryId: 'c1' }, ctx).ok).toBe(false)
    expect(validateTask({ title: 'x', priority: 3, categoryId: 'c1', ongoing: true }, ctx).ok).toBe(true)
    expect(validateTask({ title: 'x', priority: 3, categoryId: '', ongoing: true }, ctx).ok).toBe(false)
  })
  it('blocks a subtask due after its parent with a visible message', () => {
    const r = validateTask({ title: 'x', priority: 3, categoryId: 'c1', dueDate: '2026-10-01', parentId: 'p' }, ctx)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.dueDate).toMatch(/after its parent/)
    const ok = validateTask({ title: 'x', priority: 3, categoryId: 'c1', dueDate: '2026-09-30', parentId: 'p' }, ctx)
    expect(ok.ok && ok.value.depth).toBe(1)
  })
  it('blocks moving a parent earlier than its subtasks', () => {
    const tasks = [mk({ id: 'p', dueDate: '2026-09-30' }), mk({ id: 'c', parentId: 'p', depth: 1, dueDate: '2026-09-28' })]
    const r = validateTask({ title: 'p', priority: 3, categoryId: 'c1', dueDate: '2026-09-27' }, { categories: cats, tasks, selfId: 'p' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.dueDate).toMatch(/Subtask “c”/)
    expect(validateTask({ title: 'p', priority: 3, categoryId: 'c1', dueDate: '2026-09-28' }, { categories: cats, tasks, selfId: 'p' }).ok).toBe(true)
  })
  it('validates category names', () => {
    expect(validateCategoryName('  ', cats)).toMatch(/required/)
    expect(validateCategoryName('admin', cats)).toMatch(/already exists/)
    expect(validateCategoryName('x'.repeat(61), cats)).toMatch(/too long/)
    expect(validateCategoryName('Gym', cats)).toBe(null)
  })
  it('enforces max depth', () => {
    const deep = mk({ id: 'd', depth: 4, parentId: 'x' })
    const r = validateTask({ title: 'x', priority: 3, categoryId: 'c1', dueDate: TODAY, parentId: 'd' }, { categories: cats, tasks: [deep] })
    expect(r.ok).toBe(false)
  })
  it('validates recurrence', () => {
    expect(validateTask({ title: 'x', priority: 3, categoryId: 'c1', dueDate: TODAY, recurrence: { everyNDays: 1.5 } }, ctx).ok).toBe(false)
    expect(validateTask({ title: 'x', priority: 3, categoryId: 'c1', dueDate: TODAY, recurrence: { everyNDays: 7, endDate: '2026-09-01' } }, ctx).ok).toBe(false)
    const r = validateTask({ title: 'x', priority: 3, categoryId: 'c1', dueDate: TODAY, recurrence: { everyNDays: 7, endDate: '' } }, ctx)
    expect(r.ok && r.value.recurrence).toEqual({ everyNDays: 7, endDate: null })
  })
  it('enforces size limits', () => {
    const base = { priority: 3, categoryId: 'c1', dueDate: TODAY }
    expect(validateTask({ ...base, title: 'x'.repeat(501) }, ctx).ok).toBe(false)
    expect(validateTask({ ...base, title: 'x', notes: 'n'.repeat(20001) }, ctx).ok).toBe(false)
    const items = Array.from({ length: 101 }, (_, i) => ({ text: `i${i}`, done: false }))
    expect(validateTask({ ...base, title: 'x', checklist: items }, ctx).ok).toBe(false)
  })
  it('quick add: skips blank rows, all-or-nothing on invalid rows', () => {
    const row = { title: 'a', dueDate: TODAY, priority: 2, categoryId: 'c1' }
    const blank = { title: '  ', dueDate: '', priority: '', categoryId: '' }
    const good = validateQuickAdd([row, blank, { ...row, title: 'b' }], ctx)
    expect(good.ok && good.values.map((v) => v.title)).toEqual(['a', 'b'])
    const bad = validateQuickAdd([row, { ...row, priority: '' }], ctx)
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(Object.keys(bad.rowErrors)).toEqual(['1'])
  })
})

describe('placement & sorting', () => {
  it('places tasks into tabs', () => {
    const overdueOld = mk({ id: 'old', dueDate: '2025-01-01' })
    expect(inDaily(overdueOld, TODAY)).toBe(true)
    expect(inWeekly(overdueOld, TODAY)).toBe(false)
    expect(inWeekly(mk({ id: 'sun', dueDate: '2026-09-20' }), TODAY)).toBe(true)
    expect(inMonthlyList(mk({ id: 'a', dueDate: '2026-10-24' }), TODAY)).toBe(true)
    expect(inMonthlyList(mk({ id: 'b', dueDate: '2026-10-25' }), TODAY)).toBe(false)
    expect(inLater(mk({ id: 'l', dueDate: '2026-10-01' }), TODAY)).toBe(true)
    expect(inLater(mk({ id: 'l2', dueDate: '2026-09-30' }), TODAY)).toBe(false)
    expect(inLater(mk({ id: 'l3', dueDate: '2026-12-01', ongoing: true }), TODAY)).toBe(false)
  })
  it('sorts overdue first, then priority desc, due asc, title', () => {
    const list = [
      mk({ id: 'B', priority: 5, dueDate: '2026-09-25' }),
      mk({ id: 'A', priority: 5, dueDate: '2026-09-25' }),
      mk({ id: 'late', priority: 1, dueDate: '2026-09-20' }),
      mk({ id: 'early', priority: 5, dueDate: '2026-09-24' }),
    ]
    expect(sortTasks(list, TODAY).map((t) => t.id)).toEqual(['late', 'early', 'A', 'B'])
    expect(sortForever(list).map((t) => t.id)).toEqual(['A', 'B', 'early', 'late'])
  })
  it('counts per day for the calendar', () => {
    const c = monthCounts([mk({ id: 'a', dueDate: '2026-09-01' }), mk({ id: 'b', dueDate: '2026-09-30' })], TODAY, TODAY)
    expect(c['2026-09-01']).toEqual({ total: 1, overdue: 1 })
    expect(c['2026-09-30']).toEqual({ total: 1, overdue: 0 })
  })
  it('builds breadcrumbs', () => {
    const ts = [mk({ id: 'r' }), mk({ id: 'm', parentId: 'r', depth: 1 }), mk({ id: 'leaf', parentId: 'm', depth: 2 })]
    expect(breadcrumb(ts, ts[2])).toEqual(['r', 'm'])
  })
})

describe('recurrence & actions', () => {
  it('advances from the due date, not today, and honours end date', () => {
    const t = mk({ id: 'r', dueDate: '2026-09-01', recurrence: { everyNDays: 7, endDate: '2026-09-10' } })
    expect(nextOccurrenceDate(t)).toBe('2026-09-08')
    expect(nextOccurrenceDate({ ...t, dueDate: '2026-09-08' })).toBe(null)
  })
  it('clones the subtree preserving each gap to its direct parent and resets checklists', () => {
    const tasks = [
      mk({ id: 'r', dueDate: '2026-09-10', recurrence: { everyNDays: 7, endDate: null } }),
      mk({ id: 'c', parentId: 'r', depth: 1, dueDate: '2026-09-08', checklist: [{ text: 'x', done: true }] }),
      mk({ id: 'g', parentId: 'c', depth: 2, dueDate: '2026-09-05' }),
      mk({ id: 'o', parentId: 'r', depth: 1, dueDate: null, ongoing: true }),
      mk({ id: 'og', parentId: 'o', depth: 2, dueDate: '2026-09-09' }),
    ]
    const clones = cloneSubtree(tasks, tasks[0], '2026-09-17', env)
    const byTitle = Object.fromEntries(clones.map((c) => [c.title, c]))
    expect(clones).toHaveLength(5)
    expect(byTitle.c.dueDate).toBe('2026-09-15')
    expect(byTitle.g.dueDate).toBe('2026-09-12')
    expect(byTitle.og.dueDate).toBe('2026-09-16')
    expect(byTitle.c.parentId).toBe(byTitle.r.id)
    expect(byTitle.g.parentId).toBe(byTitle.c.id)
    expect(byTitle.c.checklist).toEqual([{ text: 'x', done: false }])
  })
  it("a copied subtask past its own repeat end date stops repeating", () => {
    const tasks = [
      mk({ id: 'r', dueDate: '2026-09-10', recurrence: { everyNDays: 7, endDate: null } }),
      mk({ id: 'c', parentId: 'r', depth: 1, dueDate: '2026-09-09', recurrence: { everyNDays: 2, endDate: '2026-09-12' } }),
    ]
    const clones = cloneSubtree(tasks, tasks[0], '2026-09-17', env)
    expect(clones[1]).toMatchObject({ dueDate: '2026-09-16', recurrence: null })
  })
  it('finishing cascades completions + deletes and spawns the next occurrence', () => {
    const tasks = [
      mk({ id: 'r', dueDate: '2026-09-10', recurrence: { everyNDays: 7, endDate: null } }),
      mk({ id: 'c', parentId: 'r', depth: 1, dueDate: '2026-09-08' }),
      mk({ id: 'other' }),
    ]
    const cs = planFinish(tasks, cats, 'r', 'skipped', env)
    expect(cs.completions.map((c) => [c.taskId, c.outcome])).toEqual([['r', 'skipped'], ['c', 'skipped']])
    expect(cs.completions[1].snapshot.parentTitle).toBe('r')
    expect(cs.deletes).toEqual(['r', 'c'])
    expect(cs.inserts.map((t) => t.dueDate)).toEqual(['2026-09-17', '2026-09-15'])
    expect(() => planFinish(tasks, cats, 'nope', 'completed', env)).toThrow()
  })
  it('delete cascades to active descendants only', () => {
    const tasks = [mk({ id: 'r' }), mk({ id: 'c', parentId: 'r', depth: 1 }), mk({ id: 'x' })]
    expect(planDelete(tasks, 'r').deletes).toEqual(['r', 'c'])
  })
  it('restore reattaches to an existing parent, else top-level', () => {
    const tasks = [mk({ id: 'p' })]
    const done = planFinish([...tasks, mk({ id: 'c', parentId: 'p', depth: 1 })], cats, 'c', 'completed', env).completions[0]
    const back = planRestore(tasks, cats, done, env)
    expect(back.inserts[0]).toMatchObject({ id: 'c', parentId: 'p', depth: 1 })
    expect(back.historyDeletes).toEqual([done.id])
    expect(planRestore([], cats, done, env).inserts[0]).toMatchObject({ parentId: null, depth: 0 })
    expect(() => planRestore([], [], done, env)).toThrow(/category/)
  })
  it('restore never breaks the subtask date rule: detaches with a reason instead', () => {
    const parent = mk({ id: 'p', dueDate: '2026-10-10' })
    const done = planFinish([parent, mk({ id: 'c', parentId: 'p', depth: 1, dueDate: '2026-10-08' })], cats, 'c', 'completed', env).completions[0]
    // Parent later moved earlier than the completed subtask's due date.
    const moved = { ...parent, dueDate: '2026-10-01' }
    const cs = planRestore([moved], cats, done, env)
    expect(cs.inserts[0]).toMatchObject({ parentId: null, depth: 0 })
    expect(restoreDetachReason([moved], done, cs.inserts[0])).toMatch(/due after “p”/)
    // Still valid → reattached, no reason.
    const ok = planRestore([parent], cats, done, env)
    expect(ok.inserts[0].parentId).toBe('p')
    expect(restoreDetachReason([parent], done, ok.inserts[0])).toBe(null)
  })
  it('counts direct-children progress', () => {
    const tasks = [mk({ id: 'p' }), mk({ id: 'a', parentId: 'p', depth: 1 }), mk({ id: 'b', parentId: 'p', depth: 1 })]
    const cs = planFinish(tasks, cats, 'a', 'completed', env)
    expect(subtaskProgress(tasks.filter((t) => t.id !== 'a'), cs.completions, 'p')).toEqual({ done: 1, total: 2 })
  })
})

describe('moving tasks between parents', () => {
  const tree = () => [
    mk({ id: 'a', dueDate: '2026-10-30' }),
    mk({ id: 'b', parentId: 'a', depth: 1, dueDate: '2026-10-20' }),
    mk({ id: 'b1', parentId: 'b', depth: 2, dueDate: '2026-10-10' }),
    mk({ id: 'x', dueDate: '2026-10-25' }),
    mk({ id: 'deep', parentId: 'x', depth: 1, dueDate: '2026-10-25' }),
    mk({ id: 'deeper', parentId: 'deep', depth: 2, dueDate: '2026-10-25' }),
    mk({ id: 'deepest', parentId: 'deeper', depth: 3, dueDate: '2026-10-25' }),
  ]
  it('moves a subtree and shifts every depth, parents first', () => {
    const tasks = tree()
    const b = tasks.find((t) => t.id === 'b')!
    const v = validateTask({ ...b, parentId: null }, { categories: cats, tasks, selfId: 'b' })
    expect(v.ok).toBe(true)
    if (!v.ok) return
    const cs = planUpdate(b, v.value, tasks)
    expect(cs.updates.map((t) => [t.id, t.parentId, t.depth])).toEqual([['b', null, 0], ['b1', 'b', 1]])
  })
  it('refuses moves that nest the subtree too deep, under itself, or after the new parent', () => {
    const tasks = tree()
    const b = tasks.find((t) => t.id === 'b')!
    const tooDeep = validateTask({ ...b, parentId: 'deepest' }, { categories: cats, tasks, selfId: 'b' })
    expect(!tooDeep.ok && tooDeep.errors.parentId).toMatch(/levels deep/)
    const underSelf = validateTask({ ...b, parentId: 'b1' }, { categories: cats, tasks, selfId: 'b' })
    expect(!underSelf.ok && underSelf.errors.parentId).toMatch(/under itself/)
    const late = validateTask({ ...tasks.find((t) => t.id === 'a')!, parentId: 'x' }, { categories: cats, tasks, selfId: 'a' })
    expect(!late.ok && late.errors.dueDate).toMatch(/after its parent/)
  })
  it('offers only valid parents', () => {
    const ids = parentCandidates(tree(), 'b', 4).map((t) => t.id).sort()
    expect(ids).toEqual(['a', 'deep', 'deeper', 'x']) // not itself, its child, or 'deepest' (too deep)
  })
})

describe('local state', () => {
  it('create, update, toggle and finish round-trip through applyLocal', () => {
    let s: Snapshot = { tasks: [], categories: cats, completions: [] }
    const v = { title: 'a', notes: '', priority: 2, categoryId: 'c1', ongoing: false, dueDate: TODAY, checklist: [{ text: 'x', done: false }], parentId: null, depth: 0, recurrence: null }
    s = applyLocal(s, planCreate(v, env))
    const t = s.tasks[0]
    expect(t).toMatchObject({ title: 'a', createdAt: env.now() })
    s = applyLocal(s, planUpdate(t, { ...v, title: 'b' }))
    expect(s.tasks.map((x) => x.title)).toEqual(['b'])
    s = applyLocal(s, planToggleChecklist(s.tasks[0], 0))
    expect(s.tasks[0].checklist[0].done).toBe(true)
    s = applyLocal(s, planFinish(s.tasks, cats, t.id, 'completed', env))
    expect(s.tasks).toEqual([])
    expect(s.completions).toHaveLength(1)
    s = applyLocal(s, planRestore(s.tasks, cats, s.completions[0], env))
    expect(s.tasks).toHaveLength(1)
    expect(s.completions).toHaveLength(0)
  })
})

describe('applyLocal idempotency', () => {
  it('re-applying the same change set changes nothing', () => {
    const tasks = [mk({ id: 'p' }), mk({ id: 'c', parentId: 'p', depth: 1 })]
    const s0 = { tasks, categories: cats, completions: [] }
    const cs = planFinish(tasks, cats, 'p', 'completed', env)
    const once = applyLocal(s0, cs)
    expect(applyLocal(once, cs)).toEqual(once)
    const create = planCreate({ title: 'n', notes: '', priority: 1, categoryId: 'c1', ongoing: false, dueDate: TODAY, checklist: [], parentId: null, depth: 0, recurrence: null }, env)
    const a = applyLocal(once, create)
    expect(applyLocal(a, create).tasks).toHaveLength(a.tasks.length)
  })
})

describe('categories', () => {
  it('assigns unused palette colors, then cycles', () => {
    expect(nextCategoryColor([])).toBe(PALETTE[0])
    const full = PALETTE.map((color, i) => ({ id: `${i}`, name: `${i}`, color, sortOrder: i }))
    expect(nextCategoryColor(full)).toBe(PALETTE[0])
  })
  it('only lets real hex colors through to styles', () => {
    expect(safeColor('#5b8cff')).toBe('#5b8cff')
    expect(safeColor('red;background:url(x)')).toBe('#8b929c')
    expect(safeColor(undefined)).toBe('#8b929c')
  })
})
