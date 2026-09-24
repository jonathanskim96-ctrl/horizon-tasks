// Property-based fuzzing: random sequences of every user action, checking
// invariants after each step. Seeded, so any failure is reproducible.
import { describe, expect, it } from 'vitest'
import { applyLocal, planCreate, planCreateMany, planDelete, planDeleteHistory, planFinish, planRestore, planToggleChecklist, planUpdate, type Env } from './actions'
import { addDays, diffDays } from './dates'
import { descendantsOf } from './placement'
import { toExportJSON } from './exporting'
import { parseImport, planImport } from './importing'
import { MAX_DEPTH, type Category, type Snapshot, type Task } from './types'
import { validateTask } from './validate'

function rng(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const cats: Category[] = [
  { id: 'c1', name: 'A', color: '#5b8cff', sortOrder: 0 },
  { id: 'c2', name: 'B', color: '#34c2b0', sortOrder: 1 },
]
const TITLES = ['Report', 'Call', '<b>x</b>', '=SUM(A1)', 'Ünïcödé 界', 'a'.repeat(500), '  padded  ', 'Same']

function checkInvariants(s: Snapshot, recurrenceMade: Set<string>) {
  const ids = new Set<string>()
  for (const t of s.tasks) {
    expect(ids.has(t.id), `duplicate id ${t.id}`).toBe(false)
    ids.add(t.id)
  }
  for (const t of s.tasks) {
    if (t.parentId) {
      const p = s.tasks.find((x) => x.id === t.parentId)
      expect(p, `orphan ${t.title}`).toBeDefined()
      expect(t.depth).toBe(p!.depth + 1)
      if (p!.dueDate && t.dueDate && !recurrenceMade.has(t.id)) expect(t.dueDate <= p!.dueDate, 'subtask after parent').toBe(true)
    } else expect(t.depth).toBe(0)
    expect(t.depth).toBeLessThanOrEqual(MAX_DEPTH)
    // Everything in state must still pass the validator the DB mirrors.
    const r = validateTask({ ...t, parentId: t.parentId }, { categories: s.categories, tasks: s.tasks.filter((x) => x.id !== t.id).concat({ ...t, dueDate: null }), selfId: t.id })
    if (!r.ok && !(recurrenceMade.has(t.id) && r.errors.dueDate)) expect(r.errors, `invalid task ${t.title}`).toEqual({})
  }
  const cids = new Set(s.completions.map((c) => c.id))
  expect(cids.size).toBe(s.completions.length)
}

describe('fuzz: random action sequences keep data consistent', () => {
  it('holds invariants over 300 random sessions', () => {
    for (let run = 0; run < 300; run++) {
      const r = rng(run + 1)
      let n = 0
      const env: Env = { now: () => '2026-09-24T12:00:00.000Z', newId: () => `r${run}-${++n}` }
      const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)]
      let s: Snapshot = { tasks: [], categories: cats, completions: [] }
      const recurrenceMade = new Set<string>()
      for (let step = 0; step < 60; step++) {
        const op = r()
        const t = s.tasks.length ? pick(s.tasks) : undefined
        try {
          if (op < 0.3 || !t) {
            const parent = r() < 0.5 && t && t.depth < MAX_DEPTH ? t : undefined
            const due = parent?.dueDate ? addDays(parent.dueDate, -Math.floor(r() * 5)) : addDays('2026-09-24', Math.floor(r() * 40) - 10)
            const v = validateTask(
              {
                title: pick(TITLES), priority: 1 + Math.floor(r() * 5), categoryId: pick(cats).id, dueDate: r() < 0.1 ? null : due,
                ongoing: r() < 0.15, parentId: parent?.id ?? null, checklist: r() < 0.3 ? [{ text: 'c', done: false }] : [],
                recurrence: !parent && r() < 0.3 ? { everyNDays: 1 + Math.floor(r() * 10), endDate: r() < 0.3 ? addDays(due, 20) : null } : null,
              },
              { categories: s.categories, tasks: s.tasks },
            )
            if (v.ok) s = applyLocal(s, planCreate(v.value, env))
          } else if (op < 0.4) {
            const v = validateTask({ ...t, title: pick(TITLES), priority: 1 + Math.floor(r() * 5), dueDate: t.dueDate ? addDays(t.dueDate, Math.floor(r() * 7) - 3) : null }, { categories: s.categories, tasks: s.tasks, selfId: t.id })
            if (v.ok) s = applyLocal(s, planUpdate(t, v.value))
          } else if (op < 0.47 && t.checklist.length) {
            s = applyLocal(s, planToggleChecklist(t, 0))
          } else if (op < 0.65) {
            const before = new Set(s.tasks.map((x) => x.id))
            const originals = [t, ...descendantsOf(s.tasks, t.id)]
            const cs = planFinish(s.tasks, s.categories, t.id, r() < 0.7 ? 'completed' : 'skipped', env)
            // Recurrence clones mirror the original subtree 1:1, and every
            // subtask keeps its day gap to its own parent.
            if (cs.inserts.length) {
              expect(cs.inserts.length).toBe(originals.length)
              expect(diffDays(t.dueDate!, cs.inserts[0].dueDate!)).toBe(t.recurrence!.everyNDays)
              cs.inserts.forEach((clone, i) => {
                const orig = originals[i]
                expect(clone.title).toBe(orig.title)
                expect(clone.checklist.every((c) => !c.done)).toBe(true)
                const cp = cs.inserts.find((x) => x.id === clone.parentId)
                const op = originals.find((x) => x.id === orig.parentId)
                if (cp && op && orig.dueDate && op.dueDate) expect(diffDays(cp.dueDate!, clone.dueDate!)).toBe(diffDays(op.dueDate, orig.dueDate))
              })
            }
            s = applyLocal(s, cs)
            cs.inserts.forEach((x) => !before.has(x.id) && recurrenceMade.add(x.id))
            expect(s.tasks.some((x) => x.id === t.id)).toBe(false)
          } else if (op < 0.72) {
            s = applyLocal(s, planDelete(s.tasks, t.id))
          } else if (op < 0.85 && s.completions.length) {
            const c = pick(s.completions)
            if (!s.tasks.some((x) => x.id === c.taskId)) s = applyLocal(s, planRestore(s.tasks, s.categories, c, env))
          } else if (op < 0.9 && s.completions.length) {
            s = applyLocal(s, planDeleteHistory(pick(s.completions).id))
          } else if (op < 0.95) {
            s = applyLocal(s, planCreateMany([], env))
          } else {
            // Export → import into an empty account reproduces everything.
            const plan = planImport(parseImport(toExportJSON(s, env.now())), { tasks: [], categories: cats, completions: [] }, env)
            expect(plan.counts.tasks + plan.counts.skipped + plan.counts.duplicates).toBeGreaterThanOrEqual(s.tasks.length > 0 ? 1 : 0)
            expect(plan.counts.completions).toBe(s.completions.length)
            const reimported = applyLocal({ tasks: [], categories: cats, completions: [] }, plan.changeSet)
            checkInvariants(reimported, new Set(reimported.tasks.map((x) => x.id)))
          }
        } catch (e) {
          throw new Error(`run ${run} step ${step}: ${(e as Error).message}`)
        }
        checkInvariants(s, recurrenceMade)
      }
    }
  })

  it('import parser never crashes on junk (always a readable Error or a result)', () => {
    const r = rng(42)
    const junk = [
      () => String.fromCharCode(...Array.from({ length: 50 }, () => Math.floor(r() * 128))),
      () => JSON.stringify({ tasks: Array.from({ length: 5 }, () => ({ id: r(), title: r() < 0.5 ? null : [1, 2], priority: 'x', parentId: {}, checklist: 'no' })), categories: [null, 1, 'x', { name: {} }] }),
      () => JSON.stringify({ tasks: [], categories: [], completions: [{ completedAt: { a: 1 }, snapshot: [] }, null, 7] }),
      () => '['.repeat(100000),
      () => JSON.stringify({ app: 'horizon-tasks', tasks: [{ id: 'a', parentId: 'a', title: 'self', priority: 1, categoryId: 'c', dueDate: '2026-01-01' }], categories: [{ id: 'c', name: 'A' }] }),
    ]
    for (let i = 0; i < 200; i++) {
      const text = pick(junk)()
      try {
        const p = parseImport(text)
        const plan = planImport(p, { tasks: [], categories: cats, completions: [] }, { now: () => '2026-01-01T00:00:00Z', newId: () => `j${i}-${r()}` })
        const s = applyLocal({ tasks: [], categories: cats, completions: [] }, plan.changeSet)
        checkInvariants(s, new Set())
      } catch (e) {
        expect(e).toBeInstanceOf(Error)
        expect((e as Error).message.length).toBeGreaterThan(5)
      }
    }
    function pick<T>(xs: T[]) {
      return xs[Math.floor(r() * xs.length)]
    }
  })
})

// A recurring *subtask* can produce a next occurrence due after its parent —
// documented behaviour (open product question), asserted here so it's explicit.
describe('recurring subtasks', () => {
  it('next occurrence keeps its parent even if it lands after the parent due date', () => {
    const env: Env = { now: () => '2026-09-24T12:00:00.000Z', newId: (() => { let i = 0; return () => `x${++i}` })() }
    const tasks: Task[] = [
      { id: 'p', title: 'P', notes: '', priority: 3, categoryId: 'c1', ongoing: false, dueDate: '2026-10-05', checklist: [], parentId: null, depth: 0, recurrence: null, createdAt: '' },
      { id: 'c', title: 'C', notes: '', priority: 3, categoryId: 'c1', ongoing: false, dueDate: '2026-10-01', checklist: [], parentId: 'p', depth: 1, recurrence: { everyNDays: 7, endDate: null }, createdAt: '' },
    ]
    const cs = planFinish(tasks, cats, 'c', 'completed', env)
    expect(cs.inserts[0]).toMatchObject({ parentId: 'p', dueDate: '2026-10-08' })
  })
})
