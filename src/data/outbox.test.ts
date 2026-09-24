import { describe, expect, it } from 'vitest'
import { classifyReplayError, withOutbox, type OutboxItem } from './outbox'
import { planCreate, planFinish, type Env } from '../domain/actions'
import type { Snapshot } from '../domain/types'

describe('outbox', () => {
  it('classifies replay failures', () => {
    expect(classifyReplayError("Saving failed: Can't reach the server — you may be offline.", false)).toBe('offline')
    expect(classifyReplayError('Saving failed: TypeError: Failed to fetch', true)).toBe('offline')
    // Uncertain first attempt + "already gone/exists" → it did go through.
    expect(classifyReplayError('Saving failed: stale: this task was already changed on another device', true)).toBe('applied')
    expect(classifyReplayError('Saving failed: duplicate key value violates unique constraint "tasks_pkey"', true)).toBe('applied')
    // Queued while known-offline: a stale error is a genuine conflict.
    expect(classifyReplayError('Saving failed: stale: this task was already changed on another device', false)).toBe('rejected')
    expect(classifyReplayError('Saving failed: expected an integer', true)).toBe('rejected')
  })
  it('layers queued changes over server data in order', () => {
    let n = 0
    const env: Env = { now: () => '2026-09-24T00:00:00Z', newId: () => `o${++n}` }
    const server: Snapshot = { tasks: [], categories: [{ id: 'c', name: 'A', color: '#5b8cff', sortOrder: 0 }], completions: [] }
    const create = planCreate({ title: 'Offline', notes: '', priority: 2, categoryId: 'c', ongoing: false, dueDate: '2026-10-01', checklist: [], parentId: null, depth: 0, recurrence: null }, env)
    const afterCreate = withOutbox(server, [{ id: '1', key: 'k', label: 'add', cs: create, queuedAt: '', uncertain: false }])
    const finish = planFinish(afterCreate.tasks, afterCreate.categories, afterCreate.tasks[0].id, 'completed', env)
    const items: OutboxItem[] = [
      { id: '1', key: 'k', label: 'add', cs: create, queuedAt: '', uncertain: false },
      { id: '2', key: 'k2', label: 'complete', cs: finish, queuedAt: '', uncertain: false },
    ]
    const view = withOutbox(server, items)
    expect(view.tasks).toHaveLength(0)
    expect(view.completions.map((c) => c.snapshot.title)).toEqual(['Offline'])
  })
})
