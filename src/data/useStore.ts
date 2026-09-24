import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { applyLocal, planReassignCategory } from '../domain/actions'
import { nextCategoryColor, safeColor } from '../domain/categories'
import type { Category, ChangeSet, Snapshot } from '../domain/types'
import { validateCategoryName } from '../domain/validate'
import { applyChanges, createCategory, deleteCategory, loadAll, seedStarterCategories, subscribeToChanges, updateCategory } from './api'
import { localClearUser, localGet, localSet } from './localStore'
import { classifyReplayError, isNetworkError, withOutbox, type OutboxItem } from './outbox'
import { guardedWrite } from './writeGuard'

const STALE_MESSAGE = 'That was already changed on another device — showing the latest now.'

/** A short human description of a change, for sync messages. */
function describe(cs: ChangeSet, current: Snapshot | null): string {
  const title = (id: string) => current?.tasks.find((t) => t.id === id)?.title ?? 'a task'
  if (cs.completions.length)
    return `${cs.completions[0].outcome === 'skipped' ? 'mark not needed' : 'complete'} “${cs.completions[0].snapshot.title}”`
  if (cs.historyDeletes.length) return 'delete a history entry'
  if (cs.deletes.length) return `delete “${title(cs.deletes[0])}”`
  if (cs.inserts.length) return cs.inserts.length > 1 ? `add ${cs.inserts.length} tasks` : `add “${cs.inserts[0].title}”`
  if (cs.updates.length) return `edit “${cs.updates[0].title}”`
  return 'a change'
}

/**
 * The user's data plus the only way to change it.
 * - Server data is cached on the device (IndexedDB) so the app opens offline.
 * - Changes made offline go into an ordered outbox, show immediately, and are
 *   sent when the connection returns. Anything the server rejects on replay
 *   is dropped and reported in `syncProblems`.
 */
export function useStore(userId: string) {
  const [server, setServer] = useState<Snapshot | null>(null)
  const [outbox, setOutbox] = useState<OutboxItem[]>([])
  const outboxRef = useRef<OutboxItem[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [fromCache, setFromCache] = useState(false)
  const [syncProblems, setSyncProblems] = useState<string[]>([])
  // Bumped on every write. A reload that started before a write finished
  // would overwrite it with stale data, so such results are discarded.
  const writes = useRef(0)
  const flushing = useRef(false)
  const snapKey = `${userId}:snapshot`
  const outboxKey = `${userId}:outbox`

  const data = useMemo(() => (server ? withOutbox(server, outbox) : null), [server, outbox])
  const dataRef = useRef<Snapshot | null>(null)
  useEffect(() => {
    dataRef.current = data
  }, [data])

  // Keep the device cache current.
  useEffect(() => {
    if (server) void localSet(snapKey, server)
  }, [server, snapKey])

  const setQueue = useCallback(
    (items: OutboxItem[]) => {
      outboxRef.current = items
      setOutbox(items)
      void localSet(outboxKey, items)
    },
    [outboxKey],
  )

  const reload = useCallback(async () => {
    try {
      // A write landed mid-load → that result is stale; load again (bounded).
      for (let attempt = 0; attempt < 3; attempt++) {
        const startedAt = writes.current
        const snap = await loadAll()
        if (writes.current !== startedAt) continue
        setServer(snap)
        setFromCache(false)
        setLoadError(null)
        return
      }
    } catch (e) {
      setLoadError((e as Error).message)
    }
  }, [])

  /** Send queued offline changes, oldest first. Safe to call any time. */
  const flush = useCallback(async () => {
    if (flushing.current || !outboxRef.current.length || !navigator.onLine) return
    flushing.current = true
    const problems: string[] = []
    let needsReload = false
    try {
      while (outboxRef.current.length) {
        const [item, ...rest] = outboxRef.current
        try {
          await applyChanges(item.cs)
          writes.current++
          setServer((d) => (d ? applyLocal(d, item.cs) : d))
          setQueue(rest)
        } catch (e) {
          const message = (e as Error).message
          const outcome = classifyReplayError(message, item.uncertain)
          if (outcome === 'offline') {
            setQueue([{ ...item, uncertain: true }, ...rest]) // outcome unknown now
            break
          }
          if (outcome === 'rejected') problems.push(`Couldn't sync “${item.label}”: ${message.replace(/^Saving failed: /, '').replace(/^stale: /, '')}`)
          needsReload = true
          setQueue(rest)
        }
      }
    } finally {
      flushing.current = false
    }
    if (problems.length) setSyncProblems((p) => [...p, ...problems])
    if (needsReload) await reload()
  }, [reload, setQueue])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // 1. Show what this device already knows, instantly (works offline).
      const [cached, queued] = await Promise.all([localGet<Snapshot>(snapKey), localGet<OutboxItem[]>(outboxKey)])
      if (cancelled) return
      if (Array.isArray(queued) && queued.length) {
        outboxRef.current = queued
        setOutbox(queued)
      }
      if (cached && Array.isArray(cached.tasks)) {
        setServer((s) => s ?? cached)
        setFromCache(true)
      }
      // 2. Then fetch the real thing and send anything queued.
      try {
        await seedStarterCategories()
        const snap = await loadAll()
        if (cancelled) return
        setServer(snap)
        setFromCache(false)
        setLoadError(null)
        void flush()
      } catch (e) {
        if (!cancelled) setLoadError((e as Error).message)
      }
    })()
    const sync = () => {
      void flush().then(() => reload())
    }
    // Pick up other devices' changes when the app comes back into view…
    const onVisible = () => {
      if (document.visibilityState === 'visible') sync()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', sync)
    // …poll gently while visible, as a fallback for live sync…
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'visible') sync()
    }, 60_000)
    // …and live sync: a debounced refresh when any of the user's rows change.
    let debounce: number | undefined
    const unsubscribe = subscribeToChanges(() => {
      window.clearTimeout(debounce)
      debounce = window.setTimeout(() => void reload(), 400)
    })
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', sync)
      window.clearInterval(poll)
      window.clearTimeout(debounce)
      unsubscribe()
    }
  }, [reload, flush, snapKey, outboxKey])

  const enqueue = useCallback(
    (key: string, cs: ChangeSet, uncertain: boolean) => {
      writes.current++
      setQueue([
        ...outboxRef.current,
        { id: crypto.randomUUID(), key, label: describe(cs, dataRef.current), cs, queuedAt: new Date().toISOString(), uncertain },
      ])
    },
    [setQueue],
  )

  /**
   * Apply a ChangeSet atomically. Offline (or with changes already waiting),
   * it's queued and shown immediately instead. Throws on real failures.
   */
  const commit = useCallback(
    (key: string, cs: ChangeSet): Promise<'saved' | 'queued'> =>
      guardedWrite(key, async () => {
        if (outboxRef.current.length || !navigator.onLine) {
          enqueue(key, cs, false)
          return 'queued'
        }
        try {
          await applyChanges(cs)
        } catch (e) {
          const message = (e as Error).message
          if (message.includes('stale:')) {
            void reload()
            throw new Error(STALE_MESSAGE)
          }
          if (isNetworkError(message)) {
            enqueue(key, cs, true) // the request may or may not have landed
            return 'queued'
          }
          throw e
        }
        writes.current++
        setServer((d) => (d ? applyLocal(d, cs) : d))
        return 'saved'
      }),
    [reload, enqueue],
  )

  const requireOnline = (what: string, allowQueued = false) => {
    if (!navigator.onLine) throw new Error(`${what} needs a connection — try again when you're back online.`)
    if (!allowQueued && outboxRef.current.length) throw new Error(`${what} has to wait until your offline changes finish syncing.`)
  }

  const addCategory = useCallback(
    (name: string, existing: Category[], color?: string) =>
      guardedWrite(`category:${name.trim().toLowerCase()}`, async () => {
        requireOnline('Adding a category', true)
        const err = validateCategoryName(name, existing)
        if (err) throw new Error(err)
        const cat = await createCategory(name.trim(), safeColor(color, nextCategoryColor(existing)), existing.length)
        writes.current++
        setServer((d) => (d ? { ...d, categories: [...d.categories, cat] } : d))
        return cat
      }),
    [],
  )

  const editCategory = useCallback(
    (id: string, name: string, color: string, existing: Category[]) =>
      guardedWrite(`category-edit:${id}`, async () => {
        requireOnline('Changing a category')
        const err = validateCategoryName(name, existing, id)
        if (err) throw new Error(err)
        const safe = safeColor(color, '')
        if (!safe) throw new Error('Pick a color.')
        try {
          await updateCategory(id, name.trim(), safe)
        } catch (e) {
          if ((e as Error).message.includes('stale:')) {
            void reload()
            throw new Error(STALE_MESSAGE)
          }
          throw e
        }
        writes.current++
        setServer((d) => (d ? { ...d, categories: d.categories.map((c) => (c.id === id ? { ...c, name: name.trim(), color: safe } : c)) } : d))
      }),
    [reload],
  )

  /** Delete a category, first moving its active tasks to `moveTo` if given. */
  const removeCategory = useCallback(
    (id: string, snapshot: Snapshot, moveTo?: string) =>
      guardedWrite(`category-delete:${id}`, async () => {
        requireOnline('Deleting a category')
        try {
          const reassign = moveTo ? planReassignCategory(snapshot.tasks, id, moveTo) : null
          if (reassign?.updates.length) {
            await applyChanges(reassign)
            writes.current++
            setServer((d) => (d ? applyLocal(d, reassign) : d))
          }
          await deleteCategory(id)
        } catch (e) {
          if ((e as Error).message.includes('stale:')) {
            void reload()
            throw new Error(STALE_MESSAGE)
          }
          throw e
        }
        writes.current++
        setServer((d) => (d ? { ...d, categories: d.categories.filter((c) => c.id !== id) } : d))
      }),
    [reload],
  )

  /** Remove this user's cached data and queue from the device (sign-out). */
  const clearDevice = useCallback(async () => {
    setQueue([])
    await localClearUser(userId)
  }, [setQueue, userId])

  const dismissSyncProblems = useCallback(() => setSyncProblems([]), [])

  return {
    data,
    loadError,
    fromCache,
    pending: outbox.length,
    syncProblems,
    dismissSyncProblems,
    reload,
    flush,
    commit,
    addCategory,
    editCategory,
    removeCategory,
    clearDevice,
  }
}

export type Store = ReturnType<typeof useStore>
