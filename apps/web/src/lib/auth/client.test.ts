// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sdk = vi.hoisted(() => {
  const auth = { getSession: vi.fn(), signInAnonymously: vi.fn(), signOut: vi.fn(), refreshSession: vi.fn(), onAuthStateChange: vi.fn(),
    signInWithOAuth: vi.fn(), linkIdentity: vi.fn(), exchangeCodeForSession: vi.fn() }
  return { auth, createClient: vi.fn((_url: string, _key: string, _options: { global: { fetch: typeof fetch } }) => ({ auth })) }
})
vi.mock('@supabase/supabase-js', () => ({ createClient: sdk.createClient }))
import { createAuthAdapter } from './client'

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.unstubAllGlobals())

describe('Supabase auth-only adapter', () => {
  it.each([
    ['', ''], ['not-a-url', 'sb_publishable_test'], ['https://project.supabase.co', 'sb_secret_private'],
    ['http://project.supabase.co', 'sb_publishable_test'], ['https://name:password@project.supabase.co', 'sb_publishable_test'],
  ])('keeps bad configuration out of the SDK', (url, key) => {
    expect(createAuthAdapter(url, key)).toBeNull()
    expect(sdk.createClient).not.toHaveBeenCalled()
  })

  it('enables SDK persistence/refresh without enabling OAuth URL processing', async () => {
    sdk.auth.getSession.mockResolvedValue({ data: { session: null }, error: null })
    const adapter = createAuthAdapter('https://project.supabase.co', 'sb_publishable_test')!
    await adapter.getSession()
    expect(sdk.createClient).toHaveBeenCalledWith('https://project.supabase.co', 'sb_publishable_test', {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: 'pkce' },
      global: { fetch: expect.any(Function) },
    })
  })

  it('only forwards session events, unsubscribes and signs out this browser', async () => {
    const unsubscribe = vi.fn()
    sdk.auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe } } })
    sdk.auth.signOut.mockResolvedValue({ error: null })
    const adapter = createAuthAdapter('https://project.supabase.co', 'sb_publishable_test')!
    const callback = vi.fn()
    const stop = adapter.onChange(callback)
    await vi.waitFor(() => expect(sdk.auth.onAuthStateChange).toHaveBeenCalledOnce())
    const session = { access_token: 'test-token', user: { id: 'a' } }
    sdk.auth.onAuthStateChange.mock.calls[0][0]('TOKEN_REFRESHED', session)
    expect(callback).toHaveBeenCalledWith(session, 'TOKEN_REFRESHED')
    stop()
    expect(unsubscribe).toHaveBeenCalledOnce()
    await adapter.signOut()
    expect(sdk.auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
  })

  it('returns current SDK sessions and removes raw errors from failures', async () => {
    const adapter = createAuthAdapter('https://project.supabase.co', 'sb_publishable_test')!
    const session = { access_token: 'test-token', user: { id: 'a' } }
    sdk.auth.getSession.mockResolvedValue({ data: { session }, error: null })
    await expect(adapter.getSession()).resolves.toEqual(session)
    sdk.auth.signInAnonymously.mockResolvedValue({ data: { session }, error: null })
    await expect(adapter.signInAnonymously()).resolves.toEqual(session)
    sdk.auth.signInAnonymously.mockResolvedValue({ data: { session: null }, error: new Error('secret') })
    await expect(adapter.signInAnonymously()).rejects.toMatchObject({ stage: 'signin' })
    sdk.auth.getSession.mockResolvedValue({ data: { session: null }, error: new Error('secret') })
    await expect(adapter.getSession()).rejects.toMatchObject({ stage: 'restore' })
    sdk.auth.signOut.mockResolvedValue({ error: new Error('secret') })
    await expect(adapter.signOut()).rejects.toMatchObject({ stage: 'signout' })
  })

  it('retries failed SDK initialization and restores the auth event subscription', async () => {
    sdk.createClient.mockImplementationOnce(() => { throw new Error('temporary load failure') })
    sdk.auth.getSession.mockResolvedValue({ data: { session: null }, error: null })
    const unsubscribe = vi.fn()
    sdk.auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe } } })
    const adapter = createAuthAdapter('https://project.supabase.co', 'sb_publishable_test')!
    const callback = vi.fn()
    const stop = adapter.onChange(callback)
    await expect(adapter.getSession()).rejects.toThrow('temporary load failure')
    await expect(adapter.getSession()).resolves.toBeNull()
    expect(sdk.createClient).toHaveBeenCalledTimes(2)
    expect(sdk.auth.onAuthStateChange).toHaveBeenCalledOnce()
    sdk.auth.onAuthStateChange.mock.calls[0][0]('SIGNED_OUT', null)
    expect(callback).toHaveBeenCalledWith(null, 'SIGNED_OUT')
    stop()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('refreshes through the SDK and sanitizes a refresh failure', async () => {
    const adapter = createAuthAdapter('https://project.supabase.co', 'sb_publishable_test')!
    const session = { access_token: 'refreshed-test-token', user: { id: 'a' } }
    sdk.auth.refreshSession.mockResolvedValueOnce({ data: { session }, error: null })
    await expect(adapter.refreshSession!()).resolves.toEqual(session)
    sdk.auth.refreshSession.mockResolvedValueOnce({ data: { session: null }, error: new Error('private') })
    await expect(adapter.refreshSession!()).rejects.toMatchObject({ stage: 'restore' })
  })

  it('uses different SDK operations for login and linking, with the same minimal scopes', async () => {
    const adapter = createAuthAdapter('https://project.supabase.co', 'sb_publishable_test')!
    const callback = 'http://localhost:5173/auth/callback'
    sdk.auth.signInWithOAuth.mockResolvedValue({ data: { url: 'https://project.supabase.co/auth/v1/authorize', flowId: 'login' } })
    sdk.auth.linkIdentity.mockResolvedValue({ data: { url: 'https://accounts.google.com/o/oauth2/v2/auth', flowId: 'link' } })
    await expect(adapter.googleUrl!(callback, false)).resolves.toMatchObject({ flowId: 'login' })
    await expect(adapter.googleUrl!(callback, true)).resolves.toMatchObject({ flowId: 'link' })
    for (const method of [sdk.auth.signInWithOAuth, sdk.auth.linkIdentity]) {
      expect(method).toHaveBeenCalledWith({ provider: 'custom:google', options: {
        scopes: 'openid email', redirectTo: callback, skipBrowserRedirect: true, queryParams: { nonce: expect.any(String) },
      } })
    }
  })

  it('rejects a different or still-anonymous identity before the SDK can persist it', async () => {
    const adapter = createAuthAdapter('https://project.supabase.co', 'sb_publishable_test')!
    const tokenResponse = vi.fn()
    vi.stubGlobal('fetch', tokenResponse)
    const persisted = vi.fn()
    sdk.auth.exchangeCodeForSession.mockImplementation(async () => {
      const guardedFetch = sdk.createClient.mock.calls[0][2].global.fetch
      const response = await guardedFetch('https://project.supabase.co/auth/v1/token?grant_type=pkce')
      if (!response.ok) return { error: new Error('rejected') }
      const session = await response.json()
      persisted(session)
      return { data: { session } }
    })
    tokenResponse.mockResolvedValueOnce(Response.json({ user: { id: 'other', is_anonymous: false } }))
      .mockResolvedValueOnce(Response.json({ user: { id: 'owner', is_anonymous: true } }))
      .mockResolvedValueOnce(Response.json({ user: { id: 'owner', is_anonymous: false } }))
    await expect(adapter.exchangeGoogle!('code', 'flow', 'owner')).rejects.toMatchObject({ stage: 'oauth' })
    await expect(adapter.exchangeGoogle!('code', 'flow', 'owner')).rejects.toMatchObject({ stage: 'oauth' })
    expect(persisted).not.toHaveBeenCalled()
    await expect(adapter.exchangeGoogle!('code', 'flow', 'owner')).resolves.toMatchObject({ user: { id: 'owner' } })
    expect(persisted).toHaveBeenCalledOnce()
    expect(sdk.auth.exchangeCodeForSession).toHaveBeenCalledWith('code', { flowId: 'flow' })
  })
})
