// Tiny IndexedDB key-value store for the offline cache and outbox.
// Everything is scoped by user id and wiped on sign-out. If IndexedDB is
// unavailable (e.g. some private-browsing modes), every call resolves
// harmlessly and the app simply works online-only.
const DB = 'horizon-tasks'
const STORE = 'kv'

let dbPromise: Promise<IDBDatabase | null> | null = null
function open(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return dbPromise
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T | undefined> {
  return open().then(
    (db) =>
      new Promise((resolve) => {
        if (!db) return resolve(undefined)
        try {
          const tx = db.transaction(STORE, mode)
          const req = fn(tx.objectStore(STORE))
          tx.oncomplete = () => resolve(req.result as T)
          tx.onerror = () => resolve(undefined)
          tx.onabort = () => resolve(undefined)
        } catch {
          resolve(undefined)
        }
      }),
  )
}

export const localGet = <T>(key: string) => run<T>('readonly', (s) => s.get(key))
export const localSet = (key: string, value: unknown) => run('readwrite', (s) => s.put(value, key)).then(() => undefined)
/** Remove every key belonging to a user (sign-out). */
export const localClearUser = (userId: string) =>
  run('readwrite', (s) => s.delete(IDBKeyRange.bound(`${userId}:`, `${userId}:￿`))).then(() => undefined)
