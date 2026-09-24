import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../data/supabase'

/**
 * A failed/cancelled Google sign-in comes back as ?error=…&error_description=…
 * (or in the #hash). Read it once so it can be shown, then strip it from the URL.
 */
export function readAuthError(loc: Pick<Location, 'search' | 'hash'>): string | null {
  for (const part of [loc.search.replace(/^\?/, ''), loc.hash.replace(/^#/, '')]) {
    const q = new URLSearchParams(part)
    const msg = q.get('error_description') ?? q.get('error')
    if (msg) return `Sign-in failed: ${msg}`
  }
  return null
}

function takeAuthErrorFromUrl(): string | null {
  const msg = readAuthError(window.location)
  if (msg) window.history.replaceState(null, '', window.location.pathname)
  return msg
}

export function useSession() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(!!supabase)
  const [authError, setAuthError] = useState<string | null>(takeAuthErrorFromUrl)
  useEffect(() => {
    if (!supabase) return
    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (error) setAuthError(`Sign-in failed: ${error.message}`)
        setSession(data.session)
      })
      .catch((e: Error) => setAuthError(`Sign-in failed: ${e.message}`))
      .finally(() => setLoading(false))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])
  return { session, loading, authError }
}

export async function signInWithGoogle() {
  if (!supabase) throw new Error('Supabase is not configured.')
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + import.meta.env.BASE_URL },
  })
  if (error) throw new Error(`Sign-in failed: ${error.message}`)
}

export async function signOut() {
  if (!supabase) return
  const { error } = await supabase.auth.signOut()
  if (error) throw new Error(`Sign-out failed: ${error.message}`)
}
