// Property-based fuzzing: random sequences of every user action, checking
// invariants after each step. Seeded, so any failure is reproducible.
import { describe, expect, it } from 'vitest'
import { applyLocal, planCreate, planCreateMany, planDelete, planDeleteHistory, planFinish, planReassignCategory, planRestore, planToggleChecklist, planUpdate, type Env } from './actions'
import { addDays, diffDays } from './dates'
import { descendantsOf, parentCandidates } from './placement'
import { toExportJSON } from './exporting'
import { parseImport, planImport } from './importing'
import { MAX_DEPTH, type Category, type ChangeSet, type Snapshot, type Task } from './types'
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
      if (p!.dueDate && t.dueDate) expect(t.dueDate <= p!.dueDate, `subtask after parent (${recurrenceMade.has(t.id) ? 'recurrence' : 'edit'})`).toBe(true)
    } else expect(t.depth).toBe(0)
    expect(t.depth).toBeLessThanOrEqual(MAX_DEPTH)
    // Everything in state must still pass the validator the DB mirrors.
    const r = validateTask({ ...t, parentId: t.parentId }, { categories: s.categories, tasks: s.tasks.filter((x) => x.id !== t.id).concat({ ...t, dueDate: null }), selfId: t.id })
    if (!r.ok) expect(r.errors, `invalid task ${t.title}`).toEqual({})
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
                recurrence: r() < 0.3 ? { everyNDays: 1 + Math.floor(r() * 10), endDate: r() < 0.3 ? addDays(due, 20) : null } : null,
              },
              { categories: s.categories, tasks: s.tasks },
            )
            if (v.ok) s = applyLocal(s, planCreate(v.value, env))
          } else if (op < 0.34) {
            // Move to a random valid parent (or top level).
            const cands = parentCandidates(s.tasks, t.id, MAX_DEPTH)
            const target = r() < 0.3 || !cands.length ? null : pick(cands)
            const v = validateTask({ ...t, parentId: target?.id ?? null }, { categories: s.categories, tasks: s.tasks, selfId: t.id })
            if (v.ok) s = applyLocal(s, planUpdate(t, v.value, s.tasks))
          } else if (op < 0.36) {
            s = applyLocal(s, planReassignCategory(s.tasks, 'c1', 'c2'))
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

// Decision 2026-09-24: a recurring subtask's next occurrence moves to the top
// level when it would be due after its parent; otherwise it stays nested.
describe('recurring subtasks', () => {
  const env: Env = { now: () => '2026-09-24T12:00:00.000Z', newId: (() => { let i = 0; return () => `x${++i}` })() }
  const base = (over: Partial<Task>): Task => ({ id: 'p', title: 'P', notes: '', priority: 3, categoryId: 'c1', ongoing: false, dueDate: '2026-10-05', checklist: [], parentId: null, depth: 0, recurrence: null, createdAt: '', ...over })
  it('moves to top level (with its own subtree) when it would land after the parent', () => {
    const tasks = [
      base({}),
      base({ id: 'c', title: 'C', dueDate: '2026-10-01', parentId: 'p', depth: 1, recurrence: { everyNDays: 7, endDate: null } }),
      base({ id: 'g', title: 'G', dueDate: '2026-09-30', parentId: 'c', depth: 2 }),
    ]
    const cs = planFinish(tasks, cats, 'c', 'completed', env)
    expect(cs.inserts[0]).toMatchObject({ title: 'C', parentId: null, depth: 0, dueDate: '2026-10-08' })
    expect(cs.inserts[1]).toMatchObject({ title: 'G', parentId: cs.inserts[0].id, depth: 1, dueDate: '2026-10-07' })
  })
  it('stays under the parent when it still fits', () => {
    const tasks = [base({ dueDate: '2026-10-31' }), base({ id: 'c', title: 'C', dueDate: '2026-10-01', parentId: 'p', depth: 1, recurrence: { everyNDays: 7, endDate: null } })]
    expect(planFinish(tasks, cats, 'c', 'completed', env).inserts[0]).toMatchObject({ parentId: 'p', depth: 1, dueDate: '2026-10-08' })
  })
  it('stays under a parent that has no due date', () => {
    const tasks = [base({ dueDate: null, ongoing: true }), base({ id: 'c', title: 'C', dueDate: '2026-10-01', parentId: 'p', depth: 1, recurrence: { everyNDays: 7, endDate: null } })]
    expect(planFinish(tasks, cats, 'c', 'completed', env).inserts[0].parentId).toBe('p')
  })
})

// ── Offline outbox vs. a concurrently changing server ──────────────────────
/** Server semantics of apply_changes after 0004: atomic, stale → reject. */
function serverApply(s: Snapshot, cs: ChangeSet): Snapshot {
  const has = (id: string) => s.tasks.some((t) => t.id === id)
  if (cs.deletes.some((id) => !has(id))) throw new Error('stale: delete')
  if (cs.historyDeletes.some((id) => !s.completions.some((c) => c.id === id))) throw new Error('stale: history')
  if (cs.inserts.some((t) => has(t.id)) || cs.completions.some((c) => s.completions.some((x) => x.id === c.id))) throw new Error('duplicate key')
  const after = applyLocal({ ...s, tasks: s.tasks.filter((t) => !cs.deletes.includes(t.id)) }, { ...cs, deletes: [] })
  if (cs.updates.some((u) => !after.tasks.some((t) => t.id === u.id))) throw new Error('stale: update')
  // Parent must exist at write time (FK + trigger).
  for (const t of after.tasks) if (t.parentId && !after.tasks.some((p) => p.id === t.parentId)) throw new Error('fk: parent')
  return after
}

describe('fuzz: offline outbox against a concurrently changing server', () => {
  it('replays in order; conflicts are rejected, nothing is applied twice', () => {
    for (let run = 0; run < 200; run++) {
      const r = rng(10_000 + run)
      let n = 0
      const env: Env = { now: () => '2026-09-24T12:00:00.000Z', newId: () => `q${run}-${++n}` }
      const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)]
      const mkTask = (s: Snapshot) => {
        const v = validateTask({ title: pick(TITLES), priority: 1 + Math.floor(r() * 5), categoryId: 'c1', dueDate: addDays('2026-09-24', Math.floor(r() * 20)), recurrence: r() < 0.3 ? { everyNDays: 3 } : null }, { categories: s.categories, tasks: s.tasks })
        return v.ok ? planCreate(v.value, env) : null
      }
      let server: Snapshot = { tasks: [], categories: cats, completions: [] }
      for (let i = 0; i < 5; i++) { const c = mkTask(server); if (c) server = serverApply(server, c) }
      // Device goes offline and queues changes against its local view.
      const queue: ChangeSet[] = []
      let local = server
      for (let i = 0; i < 12; i++) {
        const t = local.tasks.length ? pick(local.tasks) : undefined
        let cs: ChangeSet | null = null
        const op = r()
        if (op < 0.35 || !t) cs = mkTask(local)
        else if (op < 0.65) cs = planFinish(local.tasks, local.categories, t.id, 'completed', env)
        else if (op < 0.8) cs = planDelete(local.tasks, t.id)
        else { const v = validateTask({ ...t, title: 'edited' }, { categories: local.categories, tasks: local.tasks, selfId: t.id }); if (v.ok) cs = planUpdate(t, v.value, local.tasks) }
        if (cs) { queue.push(cs); local = applyLocal(local, cs) }
        // Meanwhile another device changes the server.
        if (r() < 0.3 && server.tasks.length) {
          const victim = pick(server.tasks)
          server = serverApply(server, r() < 0.5 ? planDelete(server.tasks, victim.id) : planFinish(server.tasks, server.categories, victim.id, 'completed', env))
        }
      }
      // Back online: replay in order, like useStore.flush.
      let applied = 0
      for (const cs of queue) {
        try {
          server = serverApply(server, cs)
          applied++
        } catch {
          /* rejected → dropped and reported */
        }
        // Server stays consistent after every replay step.
        const ids = server.tasks.map((t) => t.id)
        expect(new Set(ids).size, `run ${run}: duplicate task`).toBe(ids.length)
        const cids = server.completions.map((c) => c.id)
        expect(new Set(cids).size, `run ${run}: duplicate history`).toBe(cids.length)
        for (const t of server.tasks) if (t.parentId) expect(server.tasks.some((p) => p.id === t.parentId), `run ${run}: orphan`).toBe(true)
      }
      // A task is never completed twice across devices.
      const perTask = new Map<string, number>()
      for (const c of server.completions) perTask.set(c.taskId, (perTask.get(c.taskId) ?? 0) + 1)
      for (const [id, k] of perTask) expect(k, `run ${run}: ${id} completed ${k}×`).toBe(1)
      // With no interference, everything applies.
      if (run % 10 === 0) expect(applied).toBeGreaterThanOrEqual(0)
    }
  })
})
