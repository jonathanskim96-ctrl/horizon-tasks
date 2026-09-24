// Data-safety guardrails for the codebase itself. These fail the build when a
// change widens how the app can write to or delete from the database, so any
// such change has to be deliberate and reviewed (see CLAUDE.md → Data safety).
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { planDelete, planFinish } from '../src/domain/actions'
import type { Category, Task } from '../src/domain/types'

function sources(dir = 'src'): { path: string; text: string }[] {
  return readdirSync(dir).flatMap((name: string) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return sources(p)
    return /\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name) ? [{ path: p, text: readFileSync(p, 'utf8') }] : []
  })
}
const src = sources()

describe('data-safety guardrails (code)', () => {
  it('only the data layer and auth can reach the database client', () => {
    const imports = src.flatMap((f) =>
      [...f.text.matchAll(/import \{([^}]*)\} from '(?:\.\.?\/)+(?:data\/)?supabase'/g)].map((m) => `${f.path}: ${m[1].trim()}`),
    )
    // App.tsx may only read the "not configured" message.
    expect(imports.sort()).toEqual(['src/App.tsx: configError', 'src/auth/useSession.ts: supabase', 'src/data/api.ts: supabase'])
  })

  it('every database write is one of the known, reviewed operations', () => {
    const writes = src.flatMap((f) =>
      [...f.text.matchAll(/\.from\('(\w+)'\)\.(insert|update|delete|upsert)\(|\.rpc\('(\w+)'/g)].map((m) => `${f.path}: ${m[3] ?? `${m[1]}.${m[2]}`}`),
    )
    expect(writes.sort()).toEqual([
      'src/data/api.ts: apply_changes',
      'src/data/api.ts: categories.delete',
      'src/data/api.ts: categories.insert',
      'src/data/api.ts: categories.update',
      'src/data/api.ts: seed_starter_categories',
    ])
  })

  it('no code path issues destructive SQL', () => {
    for (const f of src) expect(f.text, f.path).not.toMatch(/\b(truncate|drop\s+table|drop\s+schema)\b/i)
  })

  it('a single delete never reaches beyond one task subtree', () => {
    const t = (id: string, parentId: string | null = null, depth = 0): Task => ({
      id, title: id, notes: '', priority: 3, categoryId: 'c', ongoing: false, dueDate: '2026-10-01',
      checklist: [], parentId, depth, recurrence: null, createdAt: '',
    })
    const tasks = [t('a'), t('a1', 'a', 1), t('a2', 'a', 1), t('b'), t('b1', 'b', 1)]
    const cats: Category[] = [{ id: 'c', name: 'C', color: '#5b8cff', sortOrder: 0 }]
    expect(planDelete(tasks, 'a').deletes.sort()).toEqual(['a', 'a1', 'a2'])
    expect(planFinish(tasks, cats, 'b', 'completed').deletes.sort()).toEqual(['b', 'b1'])
    expect(planDelete(tasks, 'a').historyDeletes).toEqual([])
  })
})
