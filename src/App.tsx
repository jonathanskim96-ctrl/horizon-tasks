import { useEffect, useState } from 'react'
import { configError } from './data/supabase'
import { signInWithGoogle, useSession } from './auth/useSession'
import { Main } from './screens/Main'
import { ErrorBanner } from './ui/Sheet'
import { UPDATE_EVENT } from './sw-register'

export default function App() {
  const { session, loading, authError } = useSession()
  const [error, setError] = useState<string | null>(null)
  const [crash, setCrash] = useState<string | null>(null)

  // Safety net: nothing may fail silently, even outside a handled path.
  useEffect(() => {
    const onRejection = (e: PromiseRejectionEvent) => setCrash(String((e.reason as Error)?.message ?? e.reason))
    const onError = (e: ErrorEvent) => setCrash(e.message)
    window.addEventListener('unhandledrejection', onRejection)
    window.addEventListener('error', onError)
    return () => {
      window.removeEventListener('unhandledrejection', onRejection)
      window.removeEventListener('error', onError)
    }
  }, [])
  // A new version arrived while the app was in use: offer a reload.
  const [updateReady, setUpdateReady] = useState(false)
  useEffect(() => {
    const on = () => setUpdateReady(true)
    window.addEventListener(UPDATE_EVENT, on)
    return () => window.removeEventListener(UPDATE_EVENT, on)
  }, [])
  const updateBanner = updateReady && (
    <div className="update-banner" role="status">
      A new version of Horizon is ready.
      <button className="link" onClick={() => window.location.reload()}>
        Reload
      </button>
    </div>
  )
  const crashBanner = crash && <ErrorBanner message={`Something went wrong: ${crash}`} onRetry={() => setCrash(null)} retryLabel="Dismiss" />

  if (configError) return <Shell><ErrorBanner message={configError} /></Shell>
  if (loading) return <Shell><p className="muted">Loading…</p></Shell>
  if (!session)
    return (
      <Shell>
        <h1 className="signin-title">Horizon Tasks</h1>
        {crashBanner}
        {(error ?? authError) && <ErrorBanner message={(error ?? authError)!} />}
        <button className="btn primary" onClick={() => signInWithGoogle().catch((e: Error) => setError(e.message))}>
          Sign in with Google
        </button>
      </Shell>
    )
  return (
    <Shell>
      {updateBanner}
      {crashBanner}
      <Main key={session.user.id} userId={session.user.id} email={session.user.email ?? ''} />
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="shell">{children}</div>
}
