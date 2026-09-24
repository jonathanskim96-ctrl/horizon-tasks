import { useCallback, useEffect, useState } from 'react'
import { signOut } from '../auth/useSession'
import { useStore } from '../data/useStore'
import { BusyError } from '../data/writeGuard'
import { CategoryGoneError, nextOccurrenceDate, occurrenceParent, planDelete, planDeleteHistory, planFinish, planRestore, planToggleChecklist, restoreDetachReason } from '../domain/actions'
import { safeColor } from '../domain/categories'
import { CategoriesSheet } from '../ui/CategoriesSheet'
import { todayISO } from '../domain/dates'
import { toCSV, toExportJSON } from '../domain/exporting'
import { descendantsOf, isOverdue } from '../domain/placement'
import type { Completion, ISODate, Outcome, Task } from '../domain/types'
import { downloadText } from '../ui/download'
import { ImportSheet } from '../ui/ImportSheet'
import { OverduePopup } from '../ui/OverduePopup'
import { QuickAdd } from '../ui/QuickAdd'
import { ErrorBanner, Sheet } from '../ui/Sheet'
import { Confirm, TaskDetail } from '../ui/TaskDetail'
import { TaskForm } from '../ui/TaskForm'
import { Daily } from './Daily'
import { Dashboard } from './Dashboard'
import { Forever } from './Forever'
import { History } from './History'
import { Later, Monthly, Weekly } from './Lists'

type Tab = 'dashboard' | 'daily' | 'weekly' | 'monthly' | 'forever' | 'later' | 'history'
const TABS: { id: Tab; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'forever', label: 'Forever' },
  { id: 'later', label: 'Later' },
  { id: 'history', label: 'History' },
]

type SheetState =
  | { kind: 'detail'; id: string }
  | { kind: 'form'; editingId?: string; parentId?: string; presetDue?: ISODate; back?: string }
  | { kind: 'confirmComplete'; id: string }
  | { kind: 'confirmDelete'; id: string }
  | { kind: 'confirmHistoryDelete'; completionId: string }
  | { kind: 'overdue' }
  | { kind: 'quickAdd' }
  | { kind: 'import' }
  | { kind: 'categories' }
  | { kind: 'confirmSignOut' }
  | { kind: 'restorePick'; completionId: string }
  | null

/** The active task a sheet is about, if any (History/overdue/quick-add sheets have none). */
function sheetTask(sheet: SheetState): string | undefined {
  if (!sheet) return undefined
  switch (sheet.kind) {
    case 'detail':
    case 'confirmComplete':
    case 'confirmDelete':
      return sheet.id
    case 'form':
      return sheet.editingId ?? sheet.parentId
    default:
      return undefined
  }
}

/** Keeps "today" correct across midnight and when the app is reopened. */
function useToday() {
  const [today, setToday] = useState(todayISO())
  useEffect(() => {
    const tick = () => setToday(todayISO())
    const t = window.setInterval(tick, 60_000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(t)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [])
  return today
}

export function Main({ email, userId }: { email: string; userId: string }) {
  const store = useStore(userId)
  const { data } = store
  const today = useToday()
  const [tab, setTab] = useState<Tab>('dashboard')
  const [sheet, setSheet] = useState<SheetState>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Checklist items with a save in flight are disabled, so a quick second tap
  // can't be silently swallowed by the write guard.
  const [pendingChecks, setPendingChecks] = useState<ReadonlySet<string>>(new Set())
  const [fabMenu, setFabMenu] = useState(false)
  // The overdue popup opens once per app open, after the first load.
  const [popupChecked, setPopupChecked] = useState(false)
  if (data && !popupChecked) {
    setPopupChecked(true)
    if (data.tasks.some((t) => isOverdue(t, today))) setSheet((s) => s ?? { kind: 'overdue' })
  }

  // Offline banner (the store itself syncs when the connection returns).
  const [online, setOnline] = useState(() => navigator.onLine)
  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 2600)
    return () => window.clearTimeout(t)
  }, [toast])

  const find = useCallback((id: string) => data?.tasks.find((t) => t.id === id), [data])

  // The open sheet's task can vanish (completed/deleted on another device):
  // close the sheet and say so, instead of leaving an invisible open state.
  const sheetTaskId = sheetTask(sheet)
  // Tasks this device removed itself (complete/delete) are excluded.
  const [ownRemovals, setOwnRemovals] = useState<ReadonlySet<string>>(new Set())
  const markOwnRemovals = (ids: string[]) => setOwnRemovals((s) => new Set([...s, ...ids]))
  const unmarkOwnRemovals = (ids: string[]) => setOwnRemovals((s) => new Set([...s].filter((id) => !ids.includes(id))))
  const sheetTaskGone =
    !!data && !!sheetTaskId && !data.tasks.some((t) => t.id === sheetTaskId) && !ownRemovals.has(sheetTaskId)
  const historyGone =
    (sheet?.kind === 'confirmHistoryDelete' || sheet?.kind === 'restorePick') && !!data && !data.completions.some((c) => c.id === sheet.completionId)
  if (historyGone) setSheet(null)
  if (sheetTaskGone) {
    // React's "adjust state during render" pattern (no effect round-trip).
    setSheet(null)
    setToast('That task was changed on another device.')
  }
  const close = useCallback(() => setSheet(null), [])
  const report = (e: unknown) => setActionError(e instanceof BusyError ? e.message : `Couldn't save: ${(e as Error).message}`)

  /** Complete or skip (cascading); resolves true on success. Errors are reported. */
  const finishNow = async (t: Task, outcome: Outcome): Promise<boolean> => {
    if (!data) return false
    setBusy(true)
    let removed: string[] = []
    try {
      const cs = planFinish(data.tasks, data.categories, t.id, outcome)
      removed = cs.deletes
      markOwnRemovals(removed)
      await store.commit(`${outcome}:${t.id}`, cs)
      const next = nextOccurrenceDate(t)
      const verb = outcome === 'completed' ? 'Completed' : 'Marked not needed'
      const moved = next ? occurrenceParent(data.tasks, t, next).detachedFrom : null
      setToast(
        next
          ? `${verb} — next due ${next}${moved ? `, as a top-level task (it's past “${moved.title}”)` : ''}.`
          : `${verb}.`,
      )
      setActionError(null)
      return true
    } catch (e) {
      unmarkOwnRemovals(removed)
      report(e)
      return false
    } finally {
      setBusy(false)
    }
  }

  const finish = async (t: Task, confirmed: boolean) => {
    if (!data) return
    if (!confirmed && descendantsOf(data.tasks, t.id).length > 0) {
      setSheet({ kind: 'confirmComplete', id: t.id })
      return
    }
    if (await finishNow(t, 'completed')) setSheet(null)
  }

  const restore = async (c: Completion, categoryOverride?: string) => {
    if (!data) return
    try {
      const cs = planRestore(data.tasks, data.categories, c, undefined, categoryOverride)
      await store.commit(`restore:${c.id}`, cs)
      const restored = cs.inserts[0]
      const parent = restored.parentId ? data.tasks.find((t) => t.id === restored.parentId) : undefined
      const detached = restoreDetachReason(data.tasks, c, restored)
      setToast(parent ? `Restored under “${parent.title}”.` : detached ? `Restored as a top-level task — ${detached}.` : 'Restored.')
      setActionError(null)
      if (sheet?.kind === 'restorePick') setSheet(null)
    } catch (e) {
      if (e instanceof CategoryGoneError && !categoryOverride) setSheet({ kind: 'restorePick', completionId: c.id })
      else report(e)
    }
  }

  const deleteHistory = async (completionId: string) => {
    setBusy(true)
    try {
      await store.commit(`history-delete:${completionId}`, planDeleteHistory(completionId))
      setToast('Deleted from history.')
      setSheet(null)
      setActionError(null)
    } catch (e) {
      report(e)
    } finally {
      setBusy(false)
    }
  }

  /** Sign out and wipe this user's cached data from the device. */
  const doSignOut = async () => {
    try {
      await signOut() // first: if this fails (e.g. offline), keep the device copy
      await store.clearDevice()
    } catch (e) {
      setActionError((e as Error).message)
    }
  }

  const exportAs = (kind: 'json' | 'csv') => {
    if (!data) return
    try {
      const stamp = todayISO()
      if (kind === 'json') downloadText(`horizon-tasks-${stamp}.json`, toExportJSON(data, new Date().toISOString()), 'application/json')
      else downloadText(`horizon-tasks-${stamp}.csv`, toCSV(data), 'text/csv')
      setToast('Export ready — check your downloads.')
    } catch (e) {
      setActionError(`Export failed: ${(e as Error).message}`)
    }
  }

  const remove = async (t: Task) => {
    if (!data) return
    setBusy(true)
    let removed: string[] = []
    try {
      const cs = planDelete(data.tasks, t.id)
      removed = cs.deletes
      markOwnRemovals(removed)
      await store.commit(`delete:${t.id}`, cs)
      setToast('Deleted.')
      setSheet(null)
      setActionError(null)
    } catch (e) {
      unmarkOwnRemovals(removed)
      report(e)
    } finally {
      setBusy(false)
    }
  }

  const toggleChecklist = async (t: Task, i: number) => {
    const key = `${t.id}:${i}`
    if (pendingChecks.has(key)) return
    setPendingChecks((s) => new Set(s).add(key))
    try {
      await store.commit(`checklist:${key}`, planToggleChecklist(t, i))
    } catch (e) {
      report(e)
    } finally {
      setPendingChecks((s) => {
        const next = new Set(s)
        next.delete(key)
        return next
      })
    }
  }

  if (store.loadError && !data)
    return <ErrorBanner message={`Couldn't load your tasks: ${store.loadError}`} onRetry={store.reload} />
  if (!data) return <p className="muted">Loading your tasks…</p>

  const overdueCount = data.tasks.filter((t) => isOverdue(t, today)).length
  const open = (t: Task) => setSheet({ kind: 'detail', id: t.id })
  const complete = (t: Task) => void finish(t, false)
  const addOn = (day: ISODate) => setSheet({ kind: 'form', presetDue: day })

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <h1>Horizon</h1>
          <span className="tag">tasks</span>
        </div>
        {store.pending > 0 && (
          <span className="pending-chip" role="status" title="Saved on this device; will sync when online">
            {store.pending} to sync
          </span>
        )}
        {overdueCount > 0 && (
          <button className="overdue-pill" onClick={() => setSheet({ kind: 'overdue' })}>
            <span className="dot" />
            {overdueCount} overdue
          </button>
        )}
      </header>

      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={`tab-btn${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      {!online && (
        <div className="offline-banner" role="status">
          You're offline. Changes are saved on this device and will sync when you reconnect.
        </div>
      )}
      {store.syncProblems.length > 0 && (
        <div className="error" role="alert">
          {store.syncProblems.length === 1 ? 'An offline change' : `${store.syncProblems.length} offline changes`} couldn't be synced and
          {store.syncProblems.length === 1 ? ' was' : ' were'} undone:
          <ul className="small">
            {store.syncProblems.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
          <button className="link" onClick={store.dismissSyncProblems}>
            Dismiss
          </button>
        </div>
      )}
      {online && store.loadError && <ErrorBanner message={`Sync problem: ${store.loadError}`} onRetry={store.reload} />}
      {actionError && !sheet && (
        <div className="error" role="alert">
          {actionError}
          <button className="link" onClick={() => setActionError(null)}>
            Dismiss
          </button>
        </div>
      )}

      <main>
        {tab === 'dashboard' && (
          <Dashboard data={data} today={today} onOpen={open} onComplete={complete} onAddOn={addOn} onGoForever={() => setTab('forever')} />
        )}
        {tab === 'daily' && <Daily data={data} today={today} onOpen={open} onComplete={complete} />}
        {tab === 'weekly' && <Weekly data={data} today={today} onOpen={open} onComplete={complete} onAddOn={addOn} />}
        {tab === 'monthly' && <Monthly data={data} today={today} onOpen={open} onComplete={complete} onAddOn={addOn} />}
        {tab === 'forever' && <Forever data={data} today={today} onOpen={open} onComplete={complete} />}
        {tab === 'later' && <Later data={data} today={today} onOpen={open} onComplete={complete} onAddOn={addOn} />}
        {tab === 'history' && (
          <History
            data={data}
            onRestore={(c) => void restore(c)}
            onDelete={(c) => setSheet({ kind: 'confirmHistoryDelete', completionId: c.id })}
            onExportJSON={() => exportAs('json')}
            onExportCSV={() => exportAs('csv')}
            onImport={() => setSheet({ kind: 'import' })}
          />
        )}
      </main>

      <footer className="footer muted small">
        <div className="build-id">build {(import.meta.env.VITE_BUILD_ID || 'dev').slice(0, 7)}</div>
        {email} ·{' '}
        <button className="link" onClick={() => setSheet({ kind: 'categories' })}>
          Categories
        </button>{' '}
        ·{' '}
        <button className="link" onClick={() => (store.pending ? setSheet({ kind: 'confirmSignOut' }) : void doSignOut())}>
          Sign out
        </button>
      </footer>

      {fabMenu && (
        <>
          <div className="fab-scrim" onClick={() => setFabMenu(false)} />
          <div className="fab-menu" role="menu">
            <button className="fab-menu-item" role="menuitem" onClick={() => { setFabMenu(false); setSheet({ kind: 'quickAdd' }) }}>
              Quick add
            </button>
            <button className="fab-menu-item primary" role="menuitem" onClick={() => { setFabMenu(false); setSheet({ kind: 'form' }) }}>
              Add task
            </button>
          </div>
        </>
      )}
      <button className="fab" aria-label="Add task" aria-expanded={fabMenu} aria-haspopup="menu" onClick={() => setFabMenu((m) => !m)}>
        {fabMenu ? '×' : '+'}
      </button>

      {sheet?.kind === 'detail' && find(sheet.id) && (
        <TaskDetail
          task={find(sheet.id)!}
          data={data}
          today={today}
          onClose={close}
          onOpen={open}
          onEdit={(t) => setSheet({ kind: 'form', editingId: t.id, back: t.id })}
          onAddSubtask={(t) => setSheet({ kind: 'form', parentId: t.id, presetDue: t.dueDate ?? undefined, back: t.id })}
          onComplete={complete}
          onDelete={(t) => setSheet({ kind: 'confirmDelete', id: t.id })}
          onToggleChecklist={toggleChecklist}
          pendingChecks={pendingChecks}
        />
      )}
      {sheet?.kind === 'detail' && actionError && (
        <div className="toast-wrap">
          <div className="toast error-toast" role="alert">
            {actionError}
          </div>
        </div>
      )}

      {sheet?.kind === 'form' && (
        <TaskForm
          data={data}
          store={store}
          editing={sheet.editingId ? find(sheet.editingId) : undefined}
          parentId={sheet.parentId}
          presetDue={sheet.presetDue}
          onClose={() => setSheet(sheet.back ? { kind: 'detail', id: sheet.back } : null)}
          onSaved={(msg) => {
            setToast(msg)
            setSheet(sheet.back ? { kind: 'detail', id: sheet.back } : null)
          }}
        />
      )}

      {sheet?.kind === 'confirmComplete' && find(sheet.id) && (
        <Confirm
          title="Complete with subtasks?"
          body={
            <p>
              “{find(sheet.id)!.title}” has {descendantsOf(data.tasks, sheet.id).length} open subtask(s). Completing it will
              complete them too, and each will be recorded in History.
            </p>
          }
          confirmLabel="Complete all"
          busy={busy}
          error={actionError}
          onConfirm={() => void finish(find(sheet.id)!, true)}
          onCancel={() => setSheet({ kind: 'detail', id: sheet.id })}
        />
      )}

      {sheet?.kind === 'confirmDelete' && find(sheet.id) && (
        <Confirm
          title="Delete task?"
          body={
            <p>
              “{find(sheet.id)!.title}”
              {descendantsOf(data.tasks, sheet.id).length > 0 &&
                ` and its ${descendantsOf(data.tasks, sheet.id).length} open subtask(s)`}{' '}
              will be deleted. History is not affected.
            </p>
          }
          confirmLabel="Delete"
          danger
          busy={busy}
          error={actionError}
          onConfirm={() => void remove(find(sheet.id)!)}
          onCancel={() => setSheet({ kind: 'detail', id: sheet.id })}
        />
      )}

      {sheet?.kind === 'overdue' && (
        <OverduePopup data={data} today={today} error={actionError} onFinish={finishNow} onClose={() => { setSheet(null); setActionError(null) }} />
      )}

      {sheet?.kind === 'quickAdd' && <QuickAdd data={data} store={store} onClose={close} onSaved={setToast} />}

      {sheet?.kind === 'import' && (
        <ImportSheet
          data={data}
          store={store}
          onClose={close}
          onDone={(msg) => {
            setToast(msg)
            setSheet(null)
          }}
        />
      )}

      {sheet?.kind === 'confirmSignOut' && (
        <Confirm
          title="Sign out with unsynced changes?"
          body={
            <p>
              {store.pending} change(s) made offline haven't reached the server yet. Signing out now discards them from this device.
              Connect to the internet first to keep them.
            </p>
          }
          confirmLabel="Discard and sign out"
          danger
          onConfirm={() => void doSignOut()}
          onCancel={close}
        />
      )}

      {sheet?.kind === 'categories' && <CategoriesSheet data={data} store={store} onClose={close} onToast={setToast} />}

      {sheet?.kind === 'restorePick' && data.completions.some((c) => c.id === sheet.completionId) && (() => {
        const c = data.completions.find((x) => x.id === sheet.completionId)!
        return (
          <Sheet title="Choose a category" onClose={close}>
            {actionError && <ErrorBanner message={actionError} />}
            <p>
              “{c.snapshot.title}” was in “{c.snapshot.categoryName}”, which has been deleted. Restore it into:
            </p>
            <div className="pill-row">
              {data.categories.map((cat) => (
                <button key={cat.id} className="pill cat-pill" onClick={() => void restore(c, cat.id)}>
                  <span className="cat-dot" style={{ background: safeColor(cat.color) }} />
                  {cat.name}
                </button>
              ))}
            </div>
            <div className="btn-row">
              <button className="btn" onClick={close}>
                Cancel
              </button>
            </div>
          </Sheet>
        )
      })()}

      {sheet?.kind === 'confirmHistoryDelete' && data.completions.some((c) => c.id === sheet.completionId) && (
        <Confirm
          title="Delete permanently?"
          body={
            <p>
              “{data.completions.find((c) => c.id === sheet.completionId)!.snapshot.title}” will be removed from History for good.
              This can't be undone (Restore instead if you want it back as a task).
            </p>
          }
          confirmLabel="Delete forever"
          danger
          busy={busy}
          error={actionError}
          onConfirm={() => void deleteHistory(sheet.completionId)}
          onCancel={close}
        />
      )}

      {toast && (
        <div className="toast-wrap">
          <div className="toast">{toast}</div>
        </div>
      )}
    </>
  )
}
