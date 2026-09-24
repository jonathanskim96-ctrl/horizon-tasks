import { useState } from 'react'
import { configError } from './data/supabase'
import { signInWithGoogle, useSession } from './auth/useSession'
import { Main } from './screens/Main'
import { ErrorBanner } from './ui/Sheet'

export default function App() {
  const { session, loading } = useSession()
  const [error, setError] = useState<string | null>(null)

  if (configError) return <Shell><ErrorBanner message={configError} /></Shell>
  if (loading) return <Shell><p className="muted">Loading…</p></Shell>
  if (!session)
    return (
      <Shell>
        <h1 className="signin-title">Horizon Tasks</h1>
        {error && <ErrorBanner message={error} />}
        <button className="btn primary" onClick={() => signInWithGoogle().catch((e: Error) => setError(e.message))}>
          Sign in with Google
        </button>
      </Shell>
    )
  return (
    <Shell>
      <Main key={session.user.id} email={session.user.email ?? ''} />
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="shell">{children}</div>
}
