import type { SupabaseClient } from '@supabase/supabase-js'
import { AuthError } from './errors'

export type AuthSession = {
  access_token: string
  user: { id: string; is_anonymous?: boolean }
}

// Only the auth surface is exposed; application data always goes through Hono.
export interface AuthAdapter {
  getSession(): Promise<AuthSession | null>
  signInAnonymously(): Promise<AuthSession>
  signOut(): Promise<void>
  refreshSession?(): Promise<AuthSession>
  googleUrl?(redirectTo: string, link: boolean): Promise<{ url: string; flowId: string }>
  exchangeGoogle?(code: string, flowId: string, linkedUserId: string | null): Promise<AuthSession>
  onChange(callback: (session: AuthSession | null, event?: string) => void): () => void
}

export function createAuthAdapter(
  url = import.meta.env.VITE_SUPABASE_URL as string | undefined,
  key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined,
): AuthAdapter | null {
  if (!url || !key) return null
  try {
    const parsed = new URL(url)
    if (parsed.username || parsed.password || (parsed.protocol !== 'https:' &&
      !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname)))) return null
    if (!key.startsWith('sb_publishable_')) return null
  } catch { return null }

  // Keep the SDK out of the initial UI bundle, and do not load it at all when
  // auth is unconfigured. Every operation shares the same SDK instance.
  let client: Promise<SupabaseClient> | undefined
  let exchange: { linkedUserId: string | null } | undefined
  const origin = new URL(url).origin

  // The SDK persists and broadcasts a successful exchange before returning it.
  // Reject an unexpected identity at the transport boundary, before that write.
  const guardedFetch: typeof fetch = async (input, init) => {
    const pending = exchange
    const response = await fetch(input, init)
    if (!pending || !response.ok) return response
    const endpoint = new URL(input instanceof Request ? input.url : input)
    if (endpoint.origin !== origin || !endpoint.pathname.endsWith('/auth/v1/token') ||
      endpoint.searchParams.get('grant_type') !== 'pkce') return response
    const data = await response.clone().json().catch(() => null) as { user?: AuthSession['user'] } | null
    const user = data?.user
    if (user?.id && user.is_anonymous === false && (!pending.linkedUserId || user.id === pending.linkedUserId)) return response
    return Response.json({ code: 'oauth_identity_mismatch', msg: 'Unexpected OAuth identity' }, { status: 400 })
  }
  type Listener = { callback: Parameters<AuthAdapter['onChange']>[0]; unsubscribe?: () => void }
  const listeners = new Set<Listener>()
  function subscribe(listener: Listener, sdk: SupabaseClient) {
    if (!listeners.has(listener) || listener.unsubscribe) return
    const { data } = sdk.auth.onAuthStateChange((event, session) => { listener.callback(session, event) })
    listener.unsubscribe = () => data.subscription.unsubscribe()
  }
  const getClient = () => client ??= import('@supabase/supabase-js').then(({ createClient }) => {
    const sdk = createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: 'pkce' },
      global: { fetch: guardedFetch },
    })
    // Retry must restore subscriptions too, not only SDK requests.
    listeners.forEach((listener) => subscribe(listener, sdk))
    return sdk
  }).catch((error: unknown) => { client = undefined; throw error })
  return {
    async getSession() {
      const { data, error } = await (await getClient()).auth.getSession()
      if (error) throw new AuthError('restore', 'セッションを確認できませんでした。再試行してください。')
      return data.session
    },
    async signInAnonymously() {
      const { data, error } = await (await getClient()).auth.signInAnonymously()
      if (error || !data.session) throw new AuthError('signin', '匿名認証に失敗しました。認証設定・通信状況・利用制限を確認してください。')
      return data.session
    },
    async signOut() {
      const { error } = await (await getClient()).auth.signOut({ scope: 'local' })
      if (error) throw new AuthError('signout', 'サインアウトを確認できませんでした。再試行してください。')
    },
    async refreshSession() {
      const { data, error } = await (await getClient()).auth.refreshSession()
      if (error || !data.session) throw new AuthError('restore', 'セッションを更新できませんでした。再試行してください。')
      return data.session
    },
    async googleUrl(redirectTo, link) {
      const auth = (await getClient()).auth
      const credentials = { provider: 'custom:google' as const, options: {
        redirectTo, scopes: 'openid email', skipBrowserRedirect: true,
        queryParams: { nonce: crypto.randomUUID() },
      } }
      const { data, error } = await (link ? auth.linkIdentity(credentials) : auth.signInWithOAuth(credentials))
      if (error || !data.url || !data.flowId) throw new AuthError('oauth', 'Google認証を開始できませんでした。')
      const destination = new URL(data.url)
      if (link ? destination.origin !== 'https://accounts.google.com' : destination.origin !== origin) {
        throw new AuthError('oauth', 'Google認証の接続先を確認できませんでした。')
      }
      return { url: data.url, flowId: data.flowId }
    },
    async exchangeGoogle(code, flowId, linkedUserId) {
      if (exchange) throw new AuthError('oauth', 'Google認証を処理しています。')
      exchange = { linkedUserId }
      try {
        const { data, error } = await (await getClient()).auth.exchangeCodeForSession(code, { flowId })
        if (error || !data.session) throw new AuthError('oauth', 'Google認証を完了できませんでした。もう一度お試しください。')
        return data.session
      } finally { exchange = undefined }
    },
    onChange(callback) {
      const listener: Listener = { callback }
      listeners.add(listener)
      void getClient().then((sdk) => subscribe(listener, sdk))
        .catch(() => { /* getSession reports initialization failures to the controller. */ })
      return () => { listeners.delete(listener); listener.unsubscribe?.() }
    },
  }
}
