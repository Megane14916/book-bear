// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createQueryClient } from '../query/client'
import { createAuthController } from './controller'
import type { AuthAdapter, AuthSession } from './client'
import { HttpError } from '../api/errors'
import { createApiClient } from '../api/client'
import { requestData } from '../api/result'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const user = (id = 'a', anonymous = true, token = 'token-1'): AuthSession => ({ access_token: token, user: { id, is_anonymous: anonymous } })
const profile = (session = user()) => ({ id: session.user.id, isAnonymous: session.user.is_anonymous === true,
  displayName: 'ゲスト', avatarUrl: null, handle: null, bio: null, followersCount: 0, followingCount: 0 })

const cleanups: (() => void)[] = []
afterEach(() => { cleanups.splice(0).forEach((cleanup) => cleanup()) })

function setup(initial: AuthSession | null = null) {
  let current = initial
  let listener: ((session: AuthSession | null, event?: string) => void) | undefined
  const auth = {
    getSession: vi.fn(async () => current),
    signInAnonymously: vi.fn(async () => { emit(user()); return current! }),
    signOut: vi.fn(async () => { emit(null) }),
    onChange: vi.fn((callback: (session: AuthSession | null, event?: string) => void) => { listener = callback; return () => { listener = undefined } }),
  } satisfies AuthAdapter
  function emit(next: AuthSession | null, event?: string) { current = next; listener?.(next, event) }
  const queryClient = createQueryClient()
  const initializeProfile = vi.fn(async (_signal: AbortSignal) => profile(current ?? undefined))
  const controller = createAuthController({ auth, queryClient, initializeProfile })
  cleanups.push(() => { controller.stop(); queryClient.clear() })
  controller.start()
  return { auth, emit, controller, queryClient, initializeProfile }
}

describe('anonymous auth and profile preparation', () => {
  it('does not create an account or initialize a profile for guest browsing', async () => {
    const { auth, controller, initializeProfile } = setup()
    await vi.waitFor(() => expect(controller.getSnapshot().status).toBe('guest'))
    await expect(controller.getAccessToken()).resolves.toBeNull()
    expect(auth.signInAnonymously).not.toHaveBeenCalled()
    expect(initializeProfile).not.toHaveBeenCalled()
    expect(controller.getSnapshot().canReadPrivate).toBe(false)
  })

  it('shares anonymous login and PUT /me across simultaneous first saves', async () => {
    const { auth, controller, initializeProfile } = setup()
    const pendingLogin = deferred<AuthSession>()
    auth.signInAnonymously.mockReturnValue(pendingLogin.promise)
    const save = vi.fn(async () => 'saved')
    const first = controller.runAuthenticatedWrite(save)
    const second = controller.runAuthenticatedWrite(save)
    await vi.waitFor(() => expect(auth.signInAnonymously).toHaveBeenCalledOnce())
    expect(save).not.toHaveBeenCalled()
    pendingLogin.resolve(user())
    await expect(Promise.all([first, second])).resolves.toEqual(['saved', 'saved'])
    expect(initializeProfile).toHaveBeenCalledOnce()
    expect(save).toHaveBeenCalledTimes(2)
    expect(controller.getSnapshot()).toMatchObject({ userId: 'a', canReadPrivate: true })
  })

  it('waits for profile initialization before writing and retries it without a new account', async () => {
    const { auth, controller, initializeProfile } = setup()
    initializeProfile.mockRejectedValueOnce(new HttpError(503))
    const save = vi.fn(async () => 'saved')
    await expect(controller.runAuthenticatedWrite(save)).rejects.toBeInstanceOf(HttpError)
    expect(save).not.toHaveBeenCalled()
    expect(controller.getSnapshot().canReadPrivate).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(initializeProfile).toHaveBeenCalledOnce()
    await expect(controller.runAuthenticatedWrite(save)).resolves.toBe('saved')
    expect(auth.signInAnonymously).toHaveBeenCalledOnce()
    expect(initializeProfile).toHaveBeenCalledTimes(2)
  })

  it('can retry failed anonymous authentication without sending a save', async () => {
    const { auth, controller } = setup()
    auth.signInAnonymously.mockRejectedValueOnce(new Error('raw-secret-error'))
    const save = vi.fn(async () => 'saved')
    await expect(controller.runAuthenticatedWrite(save)).rejects.toMatchObject({ kind: 'auth', stage: 'signin' })
    expect(String(controller.getSnapshot().error)).not.toContain('raw-secret')
    expect(save).not.toHaveBeenCalled()
    await expect(controller.runAuthenticatedWrite(save)).resolves.toBe('saved')
  })

  it('restores the same UID and prepares private reads without anonymous login', async () => {
    const { auth, controller, initializeProfile } = setup(user())
    await vi.waitFor(() => expect(controller.getSnapshot().canReadPrivate).toBe(true))
    expect(controller.getSnapshot().userId).toBe('a')
    expect(auth.signInAnonymously).not.toHaveBeenCalled()
    expect(initializeProfile).toHaveBeenCalledOnce()
  })

  it('does not silently create another account after session restoration fails', async () => {
    const { auth, controller } = setup()
    controller.stop()
    auth.getSession.mockRejectedValueOnce(new Error('private'))
    controller.start()
    await vi.waitFor(() => expect(controller.getSnapshot().status).toBe('error'))
    await expect(controller.runAuthenticatedWrite(vi.fn())).rejects.toMatchObject({ stage: 'restore' })
    expect(auth.signInAnonymously).not.toHaveBeenCalled()
    await controller.retrySession()
    expect(controller.getSnapshot().status).toBe('guest')
  })

  it('keeps public guest state available without Supabase configuration', async () => {
    const controller = createAuthController({ auth: null, queryClient: createQueryClient(), initializeProfile: vi.fn() })
    controller.start()
    expect(controller.getSnapshot().status).toBe('unconfigured')
    await expect(controller.getAccessToken()).resolves.toBeNull()
    await expect(controller.runAuthenticatedWrite(vi.fn())).rejects.toMatchObject({ stage: 'config' })
    controller.stop()
  })
})

describe('session transitions', () => {
  it('reflects refreshed JWTs without clearing the same user cache or reinitializing', async () => {
    const { controller, emit, queryClient, initializeProfile } = setup(user())
    await vi.waitFor(() => expect(controller.getSnapshot().canReadPrivate).toBe(true))
    queryClient.setQueryData(['my-books', 'a'], ['my book'])
    const signal = controller.getRequestSignal()
    emit(user('a', true, 'new-token'))
    await expect(controller.getAccessToken()).resolves.toBe('new-token')
    expect(queryClient.getQueryData(['my-books', 'a'])).toEqual(['my book'])
    expect(signal.aborted).toBe(false)
    expect(initializeProfile).toHaveBeenCalledOnce()
  })

  it.each([user('b'), user('a', false), null])('clears private/public/mutation caches and aborts old scope on transition %j', async (next) => {
    const { controller, emit, queryClient } = setup(user())
    await vi.waitFor(() => expect(controller.getSnapshot().canReadPrivate).toBe(true))
    const oldSignal = controller.getRequestSignal()
    queryClient.setQueryData(['my-books', 'a'], ['private'])
    queryClient.setQueryData(['feed', 'all', 'a'], [{ likedByMe: true }])
    const mutation = queryClient.getMutationCache().build(queryClient, { mutationFn: async () => 'private-result' })
    await mutation.execute(undefined)
    emit(next)
    expect(oldSignal.aborted).toBe(true)
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0)
    expect(controller.getSnapshot().canReadPrivate).toBe(false)
    if (next) await vi.waitFor(() => expect(controller.getSnapshot().canReadPrivate).toBe(true))
  })

  it('ignores late profile success from the previous user', async () => {
    const { controller, emit, initializeProfile } = setup()
    await vi.waitFor(() => expect(controller.getSnapshot().status).toBe('guest'))
    const late = deferred<ReturnType<typeof profile>>()
    initializeProfile.mockReturnValueOnce(late.promise)
    emit(user('a'))
    await vi.waitFor(() => expect(initializeProfile).toHaveBeenCalledOnce())
    emit(user('b'))
    await vi.waitFor(() => expect(controller.getSnapshot().canReadPrivate).toBe(true))
    late.resolve(profile(user('a')))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(controller.getSnapshot()).toMatchObject({ userId: 'b', canReadPrivate: true })
  })

  it('rejects a late save result after a user switch', async () => {
    const { controller, emit } = setup(user())
    const late = deferred<string>()
    const write = vi.fn(async () => late.promise)
    const result = controller.runAuthenticatedWrite(write)
    const failure = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(write).toHaveBeenCalledOnce())
    emit(user('b'))
    late.resolve('old user result')
    await failure
  })

  it('does not transfer a queued save to a newly signed-in user before preparation starts', async () => {
    const { controller, emit } = setup(user('a'))
    await vi.waitFor(() => expect(controller.getSnapshot().canReadPrivate).toBe(true))
    const save = vi.fn(async () => 'saved')
    const result = controller.runAuthenticatedWrite(save)
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    emit(user('b'))
    await rejected
    expect(save).not.toHaveBeenCalled()
  })

  it('blocks saves when signout fails and supports an explicit signout retry', async () => {
    const { auth, controller } = setup(user())
    await vi.waitFor(() => expect(controller.getSnapshot().canReadPrivate).toBe(true))
    auth.signOut.mockRejectedValueOnce(new Error('secret'))
    await expect(controller.signOut()).rejects.toMatchObject({ stage: 'signout' })
    await expect(controller.runAuthenticatedWrite(vi.fn())).rejects.toMatchObject({ stage: 'signout' })
    expect(controller.getSnapshot().canReadPrivate).toBe(false)
    await controller.signOut()
    expect(controller.getSnapshot().status).toBe('guest')
  })

  it('signs out a late anonymous SDK session without allowing the waiting save', async () => {
    const { auth, controller, emit, initializeProfile } = setup()
    const login = deferred<AuthSession>()
    auth.signInAnonymously.mockImplementation(async () => { const result = await login.promise; emit(result); return result })
    const save = vi.fn(async () => 'saved')
    const write = controller.runAuthenticatedWrite(save)
    const rejected = expect(write).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(auth.signInAnonymously).toHaveBeenCalledOnce())
    const signout = controller.signOut()
    expect(auth.signOut).not.toHaveBeenCalled()
    login.resolve(user())
    await rejected
    await signout
    expect(auth.signOut).toHaveBeenCalledOnce()
    expect(save).not.toHaveBeenCalled()
    expect(initializeProfile).not.toHaveBeenCalled()
    expect(controller.getSnapshot()).toMatchObject({ status: 'guest', userId: null })
  })

  it('honors a cross-tab SIGNED_OUT event during anonymous signup', async () => {
    const { auth, controller, emit } = setup()
    const login = deferred<AuthSession>()
    auth.signInAnonymously.mockImplementation(async () => { const next = await login.promise; emit(next, 'SIGNED_IN'); return next })
    const save = vi.fn(async () => 'saved')
    const result = controller.runAuthenticatedWrite(save)
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(auth.signInAnonymously).toHaveBeenCalledOnce())
    emit(null, 'SIGNED_OUT')
    login.resolve(user())
    await rejected
    await vi.waitFor(() => expect(controller.getSnapshot().status).toBe('guest'))
    expect(save).not.toHaveBeenCalled()
    expect(auth.signOut).toHaveBeenCalledOnce()
  })

  it('ignores stale startup results after StrictMode stop/start and removes subscriptions', async () => {
    const { auth, controller } = setup()
    controller.stop()
    const old = deferred<AuthSession | null>()
    auth.getSession.mockReturnValueOnce(old.promise)
    controller.start()
    controller.stop()
    controller.start()
    await vi.waitFor(() => expect(controller.getSnapshot().status).toBe('guest'))
    old.resolve(user('old'))
    await Promise.resolve()
    expect(controller.getSnapshot().userId).toBeNull()
  })

  it('does not start anonymous signup after unmount while restoration was pending', async () => {
    const { auth, controller } = setup()
    controller.stop()
    const restore = deferred<AuthSession | null>()
    auth.getSession.mockReturnValueOnce(restore.promise)
    controller.start()
    const save = vi.fn()
    const result = controller.runAuthenticatedWrite(save)
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    controller.stop()
    restore.resolve(null)
    await rejected
    expect(auth.signInAnonymously).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
  })

  it('does not create an anonymous account for a save cancelled during restoration', async () => {
    const { auth, controller } = setup()
    controller.stop()
    const restore = deferred<AuthSession | null>()
    auth.getSession.mockReturnValueOnce(restore.promise)
    controller.start()
    const signal = new AbortController()
    const save = vi.fn()
    const result = controller.runAuthenticatedWrite(save, signal.signal)
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    signal.abort()
    restore.resolve(null)
    await rejected
    expect(auth.signInAnonymously).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
  })
})

describe('integration with #35 transport', () => {
  it('sends no guest JWT, then initializes and writes with current JWT', async () => {
    let current: AuthSession | null = null
    const headers: (string | null)[] = [], paths: string[] = []
    const { api, setAccessTokenGetter, setRequestSignalGetter } = createApiClient({
      baseUrl: 'http://api.test', fetch: vi.fn<typeof fetch>().mockImplementation(async (input) => {
        const request = input as Request
        headers.push(request.headers.get('Authorization'))
        paths.push(new URL(request.url).pathname)
        return Response.json(request.method === 'PUT' ? profile(current!) : { status: 'ok' })
      }),
    })
    const auth: AuthAdapter = { getSession: async () => current, signInAnonymously: async () => (current = user()), signOut: async () => {}, onChange: () => () => {} }
    const controller = createAuthController({ auth, queryClient: createQueryClient(), initializeProfile: async (signal) => {
      const result = await requestData(() => api.PUT('/api/v1/me', { signal }))
      return result!
    } })
    controller.start()
    setAccessTokenGetter(controller.getAccessToken)
    setRequestSignalGetter(controller.getRequestSignal)
    await api.GET('/api/v1/health')
    await controller.runAuthenticatedWrite(({ signal }) => api.GET('/api/v1/health', { signal }))
    current = user('a', true, 'refreshed')
    await api.GET('/api/v1/health')
    expect(paths).toEqual(['/api/v1/health', '/api/v1/me', '/api/v1/health', '/api/v1/health'])
    expect(headers).toEqual([null, 'Bearer token-1', 'Bearer token-1', 'Bearer refreshed'])
    controller.stop()
  })
})
