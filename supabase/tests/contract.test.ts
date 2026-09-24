// Contract test: the exact payloads the app sends (domain planners → row
// mapping) are applied to a real Postgres with the real migrations, then read
// back and compared with the app's own local state. Runs via run.sh, which
// sets PGHOST/PGPORT; skipped in a plain `npm test`.
import { execFileSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { applyLocal, planCreate, planDelete, planFinish, planRestore, planToggleChecklist, planUpdate, type Env } from '../../src/domain/actions'
import { STARTER_CATEGORIES } from '../../src/domain/categories'
import type { ChangeSet, Snapshot } from '../../src/domain/types'
import { validateTask } from '../../src/domain/validate'
import { changeSetToArgs, completionFromRow, taskFromRow, type CompletionRow, type TaskRow } from '../../src/data/rows'

const enabled = !!process.env.PGHOST
const USER = '00000000-0000-0000-0000-0000000000cc'

function psql(sqlText: string): string {
  return execFileSync('psql', ['-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-f', '-'], {
    input: sqlText,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim()
}
const lit = (json: unknown) => {
  const tag = `j${randomBytes(6).toString('hex')}`
  return `$${tag}$${JSON.stringify(json)}$${tag}$::jsonb`
}
const asUser = (body: string) =>
  psql(`set role authenticated; set request.jwt.claim.sub = '${USER}';\n${body}`)

function rpc(cs: ChangeSet) {
  const a = changeSetToArgs(cs)
  asUser(
    `select public.apply_changes(inserts => ${lit(a.inserts)}, updates => ${lit(a.updates)}, deletes => ${lit(a.deletes)}, completions => ${lit(a.completions)}, history_deletes => ${lit(a.history_deletes)});`,
  )
}
function readBack(): Snapshot {
  const tasks = JSON.parse(asUser(`select coalesce(json_agg(t), '[]') from public.tasks t;`)) as TaskRow[]
  const cats = JSON.parse(asUser(`select coalesce(json_agg(c order by sort_order), '[]') from public.categories c;`))
  const hist = JSON.parse(asUser(`select coalesce(json_agg(h), '[]') from public.completions h;`)) as CompletionRow[]
  return {
    tasks: tasks.map(taskFromRow),
    categories: cats.map((r: { id: string; name: string; color: string; sort_order: number }) => ({ id: r.id, name: r.name, color: r.color, sortOrder: r.sort_order })),
    completions: hist.map(completionFromRow),
  }
}
/** Compare server and local state, ignoring timestamp formatting. */
function expectSame(server: Snapshot, local: Snapshot) {
  const norm = (s: Snapshot) => ({
    tasks: [...s.tasks].sort((a, b) => a.id.localeCompare(b.id)).map((t) => ({ ...t, createdAt: Date.parse(t.createdAt) })),
    completions: [...s.completions]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((c) => ({ ...c, completedAt: Date.parse(c.completedAt), snapshot: { ...c.snapshot, createdAt: Date.parse(c.snapshot.createdAt) } })),
  })
  expect(norm(server)).toEqual(norm(local))
}

const env: Env = { now: () => new Date().toISOString(), newId: () => randomUUID() }

describe.skipIf(!enabled)('app ↔ database contract', () => {
  it('round-trips every planner through apply_changes', () => {
    psql(`insert into auth.users values ('${USER}') on conflict do nothing;`)
    expect(asUser(`select public.seed_starter_categories(${lit(STARTER_CATEGORIES)});`)).toBe('t')
    let local = readBack()
    expect(local.categories.map((c) => c.name)).toEqual(STARTER_CATEGORIES.map((c) => c.name))
    const cat = local.categories[0].id
    const ctx = () => ({ categories: local.categories, tasks: local.tasks })
    const create = (input: Parameters<typeof validateTask>[0]) => {
      const r = validateTask(input, ctx())
      if (!r.ok) throw new Error(JSON.stringify(r.errors))
      const cs = planCreate(r.value, env)
      rpc(cs)
      local = applyLocal(local, cs)
      return cs.inserts[0]
    }
    const apply = (cs: ChangeSet) => {
      rpc(cs)
      local = applyLocal(local, cs)
      expectSame(readBack(), local)
    }

    // A recurring parent with a 3-level subtree and a checklist.
    const root = create({ title: 'Grant report ✍️ <script>', notes: 'multi\nline', priority: 5, categoryId: cat, dueDate: '2026-10-10', checklist: [{ text: 'Draft', done: true }], recurrence: { everyNDays: 14, endDate: '2026-12-31' } })
    const child = create({ title: 'Figures', priority: 3, categoryId: cat, dueDate: '2026-10-08', parentId: root.id })
    const grand = create({ title: 'Stats', priority: 2, categoryId: cat, dueDate: '2026-10-05', parentId: child.id })
    create({ title: 'Ongoing thing', priority: 1, categoryId: cat, ongoing: true })
    expectSame(readBack(), local)

    // Edit + checklist toggle.
    const edited = validateTask({ title: 'Grant report v2', priority: 4, categoryId: cat, dueDate: '2026-10-10', checklist: root.checklist, recurrence: root.recurrence, notes: 'x' }, { ...ctx(), selfId: root.id })
    if (!edited.ok) throw new Error('edit invalid')
    apply(planUpdate(local.tasks.find((t) => t.id === root.id)!, edited.value))
    apply(planToggleChecklist(local.tasks.find((t) => t.id === root.id)!, 0))

    // Complete the recurring root: history for all 3, clone with gaps preserved.
    apply(planFinish(local.tasks, local.categories, root.id, 'completed', env))
    const next = local.tasks.find((t) => t.title === 'Grant report v2')!
    expect(next.dueDate).toBe('2026-10-24')
    expect(next.checklist.every((c) => !c.done)).toBe(true)
    const nextChild = local.tasks.find((t) => t.parentId === next.id)!
    expect(nextChild.dueDate).toBe('2026-10-22')
    expect(local.tasks.find((t) => t.parentId === nextChild.id)!.dueDate).toBe('2026-10-19')
    expect(local.completions).toHaveLength(3)

    // Skip a single subtask, then restore it under its (still existing) parent.
    const skipTarget = local.tasks.find((t) => t.parentId === nextChild.id)!
    apply(planFinish(local.tasks, local.categories, skipTarget.id, 'skipped', env))
    const skipped = local.completions.find((c) => c.taskId === skipTarget.id)!
    expect(skipped.outcome).toBe('skipped')
    apply(planRestore(local.tasks, local.categories, skipped, env))
    expect(local.tasks.find((t) => t.id === skipTarget.id)!.parentId).toBe(nextChild.id)

    // Restoring the old grandchild whose parent is gone → top level.
    const orphan = local.completions.find((c) => c.taskId === grand.id)!
    apply(planRestore(local.tasks, local.categories, orphan, env))
    expect(local.tasks.find((t) => t.id === grand.id)).toMatchObject({ parentId: null, depth: 0 })

    // Delete cascades to active descendants only; history untouched.
    const histBefore = local.completions.length
    apply(planDelete(local.tasks, next.id))
    expect(local.tasks.some((t) => t.id === nextChild.id)).toBe(false)
    expect(local.completions).toHaveLength(histBefore)
  })

  it('accepts everything the client validator accepts (size limits agree)', () => {
    const local = readBack()
    const cat = local.categories[0].id
    // Worst case per the client limits: 3-byte characters everywhere.
    const r = validateTask(
      {
        title: '界'.repeat(500),
        notes: '界'.repeat(20000),
        priority: 1,
        categoryId: cat,
        dueDate: '2026-10-01',
        checklist: Array.from({ length: 100 }, () => ({ text: '界'.repeat(500), done: false })),
      },
      { categories: local.categories, tasks: local.tasks },
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const cs = planCreate(r.value, env)
    rpc(cs)
    const after = applyLocal(local, cs)
    // …and it can still be completed (snapshot carries notes + checklist).
    rpc(planFinish(after.tasks, after.categories, cs.inserts[0].id, 'completed', env))
  })
})
