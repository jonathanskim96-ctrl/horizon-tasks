import { describe, expect, it } from 'vitest'
import { applyLocal, planCreateMany, planDeleteHistory, planFinish, type Env } from './actions'
import { csvCell, toCSV, toExportJSON } from './exporting'
import { missingCategories, parseImport, planImport } from './importing'
import type { Category, Snapshot, Task } from './types'

let seq = 0
const env: Env = { now: () => '2026-09-24T12:00:00.000Z', newId: () => `id-${++seq}` }
const cats: Category[] = [
  { id: 'c-mph', name: 'MPH', color: '#5b8cff', sortOrder: 0 },
  { id: 'c-admin', name: 'Admin', color: '#a687f0', sortOrder: 1 },
]
const empty: Snapshot = { tasks: [], categories: cats, completions: [] }

// Shaped like the v4 artifact's exportData() payload.
const artifactExport = {
  schemaVersion: 1,
  exportedAt: '2026-09-20T10:00:00Z',
  categories: [
    { id: 'a1', name: 'MPH', color: '#5b8cff' },
    { id: 'a2', name: 'Gym', color: '#f2789a' },
    { id: 'a3', name: 'Unused', color: '#000000' },
  ],
  tasks: [
    { id: 't1', title: 'Thesis', notes: 'n', priority: 5, categoryId: 'a1', ongoing: false, dueDate: '2026-10-10', checklist: [{ text: 'ch1', done: true }], parentId: null, depth: 0, recurrence: null, complete: false },
    { id: 't2', title: 'Lit review', priority: 4, categoryId: 'a1', dueDate: '2026-10-05', parentId: 't1', depth: 1 },
    { id: 't3', title: 'Late child', priority: 4, categoryId: 'a1', dueDate: '2026-10-20', parentId: 't1', depth: 1 },
    { id: 't4', title: 'Lift', priority: 2, categoryId: 'a2', dueDate: '2026-09-25', recurrence: { everyNDays: 2, endDate: null } },
    { id: 't5', title: 'Bad priority', priority: 3.7, categoryId: 'a1', dueDate: '2026-09-25' },
    { id: 't6', title: 'Ongoing', priority: 1, categoryId: 'a1', ongoing: true, dueDate: null },
    { id: 't7', title: '', priority: 1, categoryId: 'a1', dueDate: '2026-09-25' },
    { id: 'x1', title: 'Cycle A', priority: 1, categoryId: 'a1', dueDate: '2026-09-25', parentId: 'x2' },
    { id: 'x2', title: 'Cycle B', priority: 1, categoryId: 'a1', dueDate: '2026-09-25', parentId: 'x1' },
  ],
  completions: [
    { id: 'h1', title: 'Done thing', categoryId: 'a2', priority: 2, parentId: 't1', parentTitle: 'Thesis', dueDate: '2026-09-01', completedAt: '2026-09-02', outcome: 'completed' },
    { id: 'h2', title: 'Skipped thing', categoryId: 'a1', priority: 9, dueDate: null, completedAt: 'garbage', outcome: 'skipped' },
  ],
}

describe('export', () => {
  it('neutralizes spreadsheet formulas and quotes CSV cells', () => {
    expect(csvCell('=HYPERLINK("http://evil")')).toBe(`"'=HYPERLINK(""http://evil"")"`)
    expect(csvCell('+1')).toBe("'+1")
    expect(csvCell('-2')).toBe("'-2")
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)")
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"')
    expect(csvCell(null)).toBe('')
  })
  it('exports JSON that re-imports losslessly (round trip)', () => {
    let s: Snapshot = empty
    s = applyLocal(s, planCreateMany([
      { title: 'A', notes: 'x', priority: 2, categoryId: 'c-mph', ongoing: false, dueDate: '2026-10-01', checklist: [{ text: 'i', done: false }], parentId: null, depth: 0, recurrence: { everyNDays: 7, endDate: null } },
    ], env))
    s = applyLocal(s, planCreateMany([{ title: 'B', notes: '', priority: 3, categoryId: 'c-admin', ongoing: true, dueDate: null, checklist: [], parentId: s.tasks[0].id, depth: 1, recurrence: null }], env))
    s = applyLocal(s, planFinish(s.tasks, s.categories, s.tasks[1].id, 'completed', env))
    const csv = toCSV(s)
    expect(csv.split('\r\n')[0]).toMatch(/^status,title/)
    expect(csv).toContain('history,B,Admin')
    const parsed = parseImport(toExportJSON(s, env.now()))
    expect(parsed.format).toBe('horizon-tasks')
    const plan = planImport(parsed, empty, env)
    expect(plan.counts).toMatchObject({ tasks: 1, completions: 1, skipped: 0 })
    const t = plan.changeSet.inserts[0]
    expect(t).toMatchObject({ title: 'A', priority: 2, recurrence: { everyNDays: 7, endDate: null }, checklist: [{ text: 'i', done: false }] })
    expect(plan.changeSet.completions[0].snapshot).toMatchObject({ title: 'B', categoryName: 'Admin' })
  })
  it('permanent history delete plans exactly one delete', () => {
    expect(planDeleteHistory('h').historyDeletes).toEqual(['h'])
  })
})

describe('import from the v4 artifact', () => {
  const parsed = parseImport(JSON.stringify(artifactExport))
  it('parses only whitelisted fields', () => {
    expect(parsed.format).toBe('artifact-v4')
    expect(parsed.tasks.map((t) => t.srcId)).toContain('t1')
  })
  it('creates only missing categories that are actually used', () => {
    expect(missingCategories(parsed, cats)).toEqual([{ name: 'Gym', color: '#f2789a' }])
  })
  it('imports valid tasks, keeps structure, reports every adjustment', () => {
    const current: Snapshot = { ...empty, categories: [...cats, { id: 'c-gym', name: 'Gym', color: '#f2789a', sortOrder: 2 }] }
    const plan = planImport(parsed, current, env)
    const titles = plan.changeSet.inserts.map((t) => t.title)
    expect(titles).toEqual(expect.arrayContaining(['Thesis', 'Lit review', 'Late child', 'Lift', 'Ongoing', 'Cycle A', 'Cycle B']))
    expect(titles).not.toContain('Bad priority')
    const thesis = plan.changeSet.inserts.find((t) => t.title === 'Thesis')!
    expect(plan.changeSet.inserts.find((t) => t.title === 'Lit review')).toMatchObject({ parentId: thesis.id, depth: 1 })
    expect(plan.changeSet.inserts.find((t) => t.title === 'Late child')).toMatchObject({ parentId: null, depth: 0 })
    expect(plan.changeSet.inserts.find((t) => t.title === 'Lift')!.categoryId).toBe('c-gym')
    expect(plan.notes.join('\n')).toMatch(/Late child.*due after its parent/)
    expect(plan.notes.join('\n')).toMatch(/Skipped “Bad priority”: Priority must be a whole number/)
    expect(plan.notes.join('\n')).toMatch(/no title/)
    expect(plan.notes.join('\n')).toMatch(/no valid completion date/)
    expect(plan.counts).toMatchObject({ completions: 1, skipped: 3 })
    const h = plan.changeSet.completions[0]
    expect(h).toMatchObject({ outcome: 'completed', completedAt: '2026-09-02T12:00:00.000Z', parentId: thesis.id })
    expect(h.snapshot).toMatchObject({ categoryName: 'Gym', parentTitle: 'Thesis' })
  })
  it('is idempotent: importing the same file twice adds nothing new', () => {
    const current: Snapshot = { ...empty, categories: [...cats, { id: 'c-gym', name: 'Gym', color: '#f2789a', sortOrder: 2 }] }
    const first = planImport(parsed, current, env)
    const after = applyLocal(current, first.changeSet)
    const second = planImport(parsed, after, env)
    expect(second.counts.tasks).toBe(0)
    expect(second.counts.completions).toBe(0)
    expect(second.counts.duplicates).toBe(first.counts.tasks + first.counts.completions)
  })
  it('rejects non-exports and oversized input with readable errors', () => {
    expect(() => parseImport('not json')).toThrow(/valid JSON/)
    expect(() => parseImport('{"hello":1}')).toThrow(/doesn't look like/)
    expect(() => parseImport('[]')).toThrow(/doesn't look like/)
    expect(() => parseImport(' '.repeat(5 * 1024 * 1024 + 1))).toThrow(/too large/)
  })
  it('ignores prototype-pollution style keys', () => {
    const evil = '{"categories":[],"tasks":[{"id":"p","title":"x","priority":1,"__proto__":{"polluted":true}}],"__proto__":{"polluted":true}}'
    parseImport(evil)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
  it('does not trust colors from the file', () => {
    const p = parseImport(JSON.stringify({ categories: [{ id: 'z', name: 'Z', color: 'red;background:url(x)' }], tasks: [{ id: '1', title: 'x', priority: 1, categoryId: 'z', dueDate: '2026-01-01' }] }))
    const m = missingCategories(p, cats)
    expect(m[0].color).toMatch(/^#[0-9a-f]{6}$/i)
  })
})

describe('planCreateMany', () => {
  it('creates all rows in one change set', () => {
    const v = { title: 'q', notes: '', priority: 1, categoryId: 'c-mph', ongoing: false, dueDate: '2026-10-01', checklist: [], parentId: null, depth: 0, recurrence: null }
    const cs = planCreateMany([v, { ...v, title: 'r' }], env)
    expect(cs.inserts.map((t: Task) => t.title)).toEqual(['q', 'r'])
    expect(new Set(cs.inserts.map((t) => t.id)).size).toBe(2)
  })
})
