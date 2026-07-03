import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { supabase, supabaseConfigured } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [gym, setGym] = useState(null)
  const [loading, setLoading] = useState(true)
  const [profileError, setProfileError] = useState(null)

  useEffect(() => {
    if (!supabaseConfigured) { setLoading(false); return }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (!data.session) setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      // Supabase auto-refreshes the access token when the tab regains focus
      // and fires TOKEN_REFRESHED with a NEW session object for the SAME user.
      // Ignore those: keeping the previous session reference means the profile
      // effect below (keyed on the user id) won't re-run and `loading` won't
      // flip — so the app never unmounts and in-progress editor state survives.
      setSession((prev) => (prev?.user?.id === s?.user?.id ? prev : s))
      if (!s) { setProfile(null); setGym(null); setLoading(false) }
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const userId = session?.user?.id

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setProfileError(null)
      try {
        let { data: prof } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
        if (!prof) {
          // first user ever becomes platform_admin; others must be invited
          const { data, error } = await supabase.rpc('ensure_profile', {
            p_full_name: session?.user?.user_metadata?.full_name || session?.user?.email,
          })
          if (error) throw error
          prof = data
        }
        if (cancelled) return
        setProfile(prof)
        if (prof?.gym_id) {
          const { data: g } = await supabase.from('gyms').select('*').eq('id', prof.gym_id).maybeSingle()
          if (!cancelled) setGym(g)
        }
      } catch (e) {
        if (!cancelled) setProfileError(e.message || String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [userId])

  const value = useMemo(() => ({
    session,
    user: session?.user ?? null,
    profile,
    gym,
    setGym,
    role: profile?.role ?? null,
    loading,
    profileError,
    signIn: (email, password) => supabase.auth.signInWithPassword({ email, password }),
    signUp: (email, password, fullName) =>
      supabase.auth.signUp({ email, password, options: { data: { full_name: fullName } } }),
    signOut: () => supabase.auth.signOut(),
  }), [session, profile, gym, loading, profileError])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
