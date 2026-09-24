import { useCallback, useEffect, useState } from 'react'
import { applyLocal } from '../domain/actions'
import { nextCategoryColor } from '../domain/categories'
import type { Category, ChangeSet, Snapshot } from '../domain/types'
import { validateCategoryName } from '../domain/validate'
import { applyChanges, createCategory, loadAll, seedStarterCategories } from './api'
import { guardedWrite } from './writeGuard'

/** In-memory copy of the user's data plus the only way to change it. */
export function useStore() {
  const [data, setData] = useState<Snapshot | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      setData(await loadAll())
      setLoadError(null)
    } catch (e) {
      setLoadError((e as Error).message)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await seedStarterCategories()
        const snap = await loadAll()
        if (!cancelled) setData(snap)
      } catch (e) {
        if (!cancelled) setLoadError((e as Error).message)
      }
    })()
    // Pick up changes made on another device when the app comes back into view.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void reload()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [reload])

  /** Apply a ChangeSet atomically, then mirror it locally. Throws on failure. */
  const commit = useCallback(
    (key: string, cs: ChangeSet) =>
      guardedWrite(key, async () => {
        await applyChanges(cs)
        setData((d) => (d ? applyLocal(d, cs) : d))
      }),
    [],
  )

  const addCategory = useCallback(
    (name: string, existing: Category[]) =>
      guardedWrite(`category:${name.trim().toLowerCase()}`, async () => {
        const err = validateCategoryName(name, existing)
        if (err) throw new Error(err)
        const cat = await createCategory(name.trim(), nextCategoryColor(existing), existing.length)
        setData((d) => (d ? { ...d, categories: [...d.categories, cat] } : d))
        return cat
      }),
    [],
  )

  return { data, loadError, reload, commit, addCategory }
}

export type Store = ReturnType<typeof useStore>
