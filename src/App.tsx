import { useCallback, useEffect, useState } from 'react'
import { configError } from './data/supabase'
import { loadAll, seedStarterCategories, type Snapshot } from './data/api'
import { signInWithGoogle, signOut, useSession } from './auth/useSession'
import { todayISO } from './domain/dates'
import { inDaily, inForever, inWeekly } from './domain/placement'

export default function App() {
  const { session, loading } = useSession()
  const [error, setError] = useState<string | null>(null)

  if (configError) return <Shell><ErrorBanner message={configError} /></Shell>
  if (loading) return <Shell><p className="muted">Loading…</p></Shell>

  if (!session)
    return (
      <Shell>
        {error && <ErrorBanner message={error} />}
        <button className="primary" onClick={() => signInWithGoogle().catch((e: Error) => setError(e.message))}>
          Sign in with Google
        </button>
      </Shell>
    )

  return (
    <Shell>
      <SignedIn email={session.user.email ?? ''} />
    </Shell>
  )
}

function SignedIn({ email }: { email: string }) {
  const [data, setData] = useState<Snapshot | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      await seedStarterCategories()
      setData(await loadAll())
      setError(null)
    } catch (e) {
      setError((e as Error).message)
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
        if (!cancelled) setError((e as Error).message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const today = todayISO()
  return (
    <>
      <p className="muted">
        Signed in as {email} · <button className="link" onClick={() => signOut().catch((e: Error) => setError(e.message))}>Sign out</button>
      </p>
      {error && <ErrorBanner message={error} onRetry={refresh} />}
      {data && (
        <ul className="stats">
          <li><b>{data.tasks.filter((t) => inDaily(t, today)).length}</b> today / overdue</li>
          <li><b>{data.tasks.filter((t) => inWeekly(t, today)).length}</b> this week</li>
          <li><b>{data.tasks.filter((t) => inForever(t) && !t.parentId).length}</b> forever</li>
          <li><b>{data.categories.length}</b> categories · <b>{data.completions.length}</b> history</li>
        </ul>
      )}
      <p className="muted">Screens are next — backend and sign-in are wired up.</p>
    </>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="shell">
      <h1>Horizon Tasks</h1>
      {children}
    </main>
  )
}

function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error" role="alert">
      {message}
      {onRetry && <button className="link" onClick={onRetry}>Retry</button>}
    </div>
  )
}
