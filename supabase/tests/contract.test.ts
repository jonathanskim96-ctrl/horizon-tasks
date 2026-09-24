// Contract test: the exact payloads the app sends (domain planners → row
// mapping) are applied to a real Postgres with the real migrations, then read
// back and compared with the app's own local state. Runs via run.sh, which
// sets PGHOST/PGPORT; skipped in a plain `npm test`.
import { execFileSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { applyLocal, planCreate, planCreateMany, planDelete, planDeleteHistory, planFinish, planReassignCategory, planRestore, planToggleChecklist, planUpdate, type Env } from '../../src/domain/actions'
import { toExportJSON } from '../../src/domain/exporting'
import { missingCategories, parseImport, planImport } from '../../src/domain/importing'
import { validateQuickAdd } from '../../src/domain/validate'
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

  it('quick add, permanent history delete and a full import round-trip through the DB', () => {
    let local = readBack()
    const cat = local.categories[1].id
    const apply = (cs: ChangeSet) => {
      rpc(cs)
      local = applyLocal(local, cs)
      expectSame(readBack(), local)
    }
    // Quick add: 3 rows in one atomic write.
    const qa = validateQuickAdd(
      [
        { title: 'Q1', dueDate: '2026-11-01', priority: 1, categoryId: cat },
        { title: '', dueDate: '', priority: '', categoryId: '' },
        { title: 'Q2 界', dueDate: '2026-11-02', priority: 5, categoryId: cat },
      ],
      { categories: local.categories, tasks: local.tasks },
    )
    if (!qa.ok) throw new Error('quick add invalid')
    apply(planCreateMany(qa.values, env))
    // Complete one, then permanently delete that history entry.
    apply(planFinish(local.tasks, local.categories, local.tasks.find((t) => t.title === 'Q1')!.id, 'completed', env))
    const h = local.completions.find((c) => c.snapshot.title === 'Q1')!
    apply(planDeleteHistory(h.id))
    expect(local.completions.some((c) => c.id === h.id)).toBe(false)

    // Export everything, import into a brand-new account: same data comes back.
    const OTHER = '00000000-0000-0000-0000-0000000000dd'
    psql(`insert into auth.users values ('${OTHER}') on conflict do nothing;`)
    const exported = toExportJSON(local, env.now())
    const asOther = (body: string) => psql(`set role authenticated; set request.jwt.claim.sub = '${OTHER}';\n${body}`)
    asOther(`select public.seed_starter_categories(${lit(STARTER_CATEGORIES)});`)
    const otherCats = JSON.parse(asOther(`select coalesce(json_agg(c order by sort_order), '[]') from public.categories c;`)).map(
      (r: { id: string; name: string; color: string; sort_order: number }) => ({ id: r.id, name: r.name, color: r.color, sortOrder: r.sort_order }),
    )
    const parsed = parseImport(exported)
    expect(missingCategories(parsed, otherCats)).toEqual([])
    const plan = planImport(parsed, { tasks: [], categories: otherCats, completions: [] }, env)
    const a = changeSetToArgs(plan.changeSet)
    asOther(`select public.apply_changes(inserts => ${lit(a.inserts)}, completions => ${lit(a.completions)});`)
    const count = (table: string) => Number(asOther(`select count(*) from public.${table};`))
    expect(count('tasks')).toBe(local.tasks.length)
    expect(count('completions')).toBe(local.completions.length)
    // Importing the same file again adds nothing.
    const again = planImport(parsed, { tasks: plan.changeSet.inserts, categories: otherCats, completions: plan.changeSet.completions }, env)
    expect(again.counts.tasks + again.counts.completions).toBe(0)
  })

  it('moves subtrees, recurs subtasks to top level, reassigns + deletes categories', () => {
    let local = readBack()
    const [catA, catB] = local.categories
    const apply = (cs: ChangeSet) => {
      rpc(cs)
      local = applyLocal(local, cs)
      expectSame(readBack(), local)
    }
    const create = (input: Parameters<typeof validateTask>[0]) => {
      const r = validateTask(input, { categories: local.categories, tasks: local.tasks })
      if (!r.ok) throw new Error(JSON.stringify(r.errors))
      const cs = planCreate(r.value, env)
      apply(cs)
      return cs.inserts[0]
    }
    const home = create({ title: 'Home', priority: 3, categoryId: catA.id, dueDate: '2026-12-31' })
    const mid = create({ title: 'Mid', priority: 3, categoryId: catB.id, dueDate: '2026-12-01' })
    const leaf = create({ title: 'Leaf', priority: 3, categoryId: catB.id, dueDate: '2026-11-01', parentId: mid.id })
    // Move Mid (with Leaf) under Home: depths shift parent-first, trigger accepts.
    const v = validateTask({ ...mid, parentId: home.id }, { categories: local.categories, tasks: local.tasks, selfId: mid.id })
    if (!v.ok) throw new Error(JSON.stringify(v.errors))
    apply(planUpdate(local.tasks.find((t) => t.id === mid.id)!, v.value, local.tasks))
    expect(local.tasks.find((t) => t.id === leaf.id)!.depth).toBe(2)
    // Recurring subtask whose next occurrence passes its parent → top level.
    const rec = create({ title: 'Rec', priority: 1, categoryId: catA.id, dueDate: '2026-11-28', parentId: mid.id, recurrence: { everyNDays: 7 } })
    apply(planFinish(local.tasks, local.categories, rec.id, 'completed', env))
    expect(local.tasks.find((t) => t.title === 'Rec')).toMatchObject({ parentId: null, depth: 0, dueDate: '2026-12-05' })
    // Deleting a category in use is refused by the database…
    expect(() => asUser(`delete from public.categories where id = '${catB.id}';`)).toThrow(/foreign key/)
    // …so the app reassigns first, then deletes.
    apply(planReassignCategory(local.tasks, catB.id, catA.id))
    asUser(`delete from public.categories where id = '${catB.id}';`)
    expect(Number(asUser(`select count(*) from public.categories where id = '${catB.id}';`))).toBe(0)
    // Rename/recolor goes through RLS as the owner.
    asUser(`update public.categories set name = 'Renamed', color = '#d6688f' where id = '${catA.id}';`)
    expect(asUser(`select name || color from public.categories where id = '${catA.id}';`)).toBe('Renamed#d6688f')
    expect(() => asUser(`update public.categories set color = 'red' where id = '${catA.id}';`)).toThrow(/check constraint/)
  })
})
