// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const sdk = vi.hoisted(() => {
  const auth = { getSession: vi.fn(), signInAnonymously: vi.fn(), signOut: vi.fn(), refreshSession: vi.fn(), onAuthStateChange: vi.fn() }
  return { auth, createClient: vi.fn(() => ({ auth })) }
})
vi.mock('@supabase/supabase-js', () => ({ createClient: sdk.createClient }))
import { createAuthAdapter } from './client'

beforeEach(() => vi.clearAllMocks())

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
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
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
})
