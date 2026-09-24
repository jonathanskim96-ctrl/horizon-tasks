import { useCallback, useEffect, useState } from 'react'
import { signOut } from '../auth/useSession'
import { useStore } from '../data/useStore'
import { BusyError } from '../data/writeGuard'
import { nextOccurrenceDate, planDelete, planFinish, planToggleChecklist } from '../domain/actions'
import { todayISO } from '../domain/dates'
import { descendantsOf, isOverdue } from '../domain/placement'
import type { ISODate, Task } from '../domain/types'
import { ErrorBanner } from '../ui/Sheet'
import { Confirm, TaskDetail } from '../ui/TaskDetail'
import { TaskForm } from '../ui/TaskForm'
import { Daily } from './Daily'
import { Dashboard } from './Dashboard'
import { Forever } from './Forever'

type Tab = 'dashboard' | 'daily' | 'forever'
const TABS: { id: Tab; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'daily', label: 'Daily' },
  { id: 'forever', label: 'Forever' },
]

type SheetState =
  | { kind: 'detail'; id: string }
  | { kind: 'form'; editingId?: string; parentId?: string; presetDue?: ISODate; back?: string }
  | { kind: 'confirmComplete'; id: string }
  | { kind: 'confirmDelete'; id: string }
  | null

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

export function Main({ email }: { email: string }) {
  const store = useStore()
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

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 2600)
    return () => window.clearTimeout(t)
  }, [toast])

  const find = useCallback((id: string) => data?.tasks.find((t) => t.id === id), [data])

  // The open sheet's task can vanish (completed/deleted on another device):
  // close the sheet and say so, instead of leaving an invisible open state.
  const sheetTaskId = sheet && (sheet.kind === 'form' ? (sheet.editingId ?? sheet.parentId) : sheet.id)
  // Tasks this device removed itself (complete/delete) are excluded.
  const [ownRemovals, setOwnRemovals] = useState<ReadonlySet<string>>(new Set())
  const markOwnRemovals = (ids: string[]) => setOwnRemovals((s) => new Set([...s, ...ids]))
  const unmarkOwnRemovals = (ids: string[]) => setOwnRemovals((s) => new Set([...s].filter((id) => !ids.includes(id))))
  const sheetTaskGone =
    !!data && !!sheetTaskId && !data.tasks.some((t) => t.id === sheetTaskId) && !ownRemovals.has(sheetTaskId)
  if (sheetTaskGone) {
    // React's "adjust state during render" pattern (no effect round-trip).
    setSheet(null)
    setToast('That task was changed on another device.')
  }
  const close = useCallback(() => setSheet(null), [])
  const report = (e: unknown) => setActionError(e instanceof BusyError ? e.message : `Couldn't save: ${(e as Error).message}`)

  const finish = async (t: Task, confirmed: boolean) => {
    if (!data) return
    if (!confirmed && descendantsOf(data.tasks, t.id).length > 0) {
      setSheet({ kind: 'confirmComplete', id: t.id })
      return
    }
    setBusy(true)
    let removed: string[] = []
    try {
      const cs = planFinish(data.tasks, data.categories, t.id, 'completed')
      removed = cs.deletes
      markOwnRemovals(removed)
      await store.commit(`complete:${t.id}`, cs)
      const next = nextOccurrenceDate(t)
      setToast(next ? `Completed — next due ${next}.` : 'Completed.')
      setSheet(null)
      setActionError(null)
    } catch (e) {
      unmarkOwnRemovals(removed)
      report(e)
    } finally {
      setBusy(false)
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
        {overdueCount > 0 && (
          <button className="overdue-pill" onClick={() => setTab('daily')}>
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

      {store.loadError && <ErrorBanner message={`Sync problem: ${store.loadError}`} onRetry={store.reload} />}
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
        {tab === 'forever' && <Forever data={data} today={today} onOpen={open} onComplete={complete} />}
      </main>

      <footer className="footer muted small">
        {email} ·{' '}
        <button className="link" onClick={() => signOut().catch((e: Error) => setActionError(e.message))}>
          Sign out
        </button>
      </footer>

      <button className="fab" aria-label="Add task" onClick={() => setSheet({ kind: 'form' })}>
        +
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

      {toast && (
        <div className="toast-wrap">
          <div className="toast">{toast}</div>
        </div>
      )}
    </>
  )
}
