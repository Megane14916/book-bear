import type { QueryClient } from '@tanstack/react-query'
import type { components } from '../api/generated'
import { ApiError, isAbortError, throwIfAborted } from '../api/errors'
import type { AuthAdapter, AuthSession } from './client'
import { AuthError, safeAuthError } from './errors'

type Profile = components['schemas']['Profile']
export type AuthState = {
  status: 'loading' | 'guest' | 'preparing' | 'ready' | 'error' | 'unconfigured' | 'signing-out'
  userId: string | null
  isAnonymous: boolean
  canReadPrivate: boolean
  error: Error | null
}
const identity = (session: AuthSession | null) => session ? `${session.user.id}:${session.user.is_anonymous === true}` : null

export function createAuthController(deps: {
  auth: AuthAdapter | null
  queryClient: QueryClient
  initializeProfile: (signal: AbortSignal) => Promise<Profile>
}) {
  let session: AuthSession | null = null
  let state: AuthState = { status: deps.auth ? 'loading' : 'unconfigured', userId: null, isAnonymous: false, canReadPrivate: false, error: null }
  const listeners = new Set<() => void>()
  let active = false
  let lifetime = 0
  let revision = 0
  let epoch = 0
  let scope = new AbortController()
  let unsubscribe: (() => void) | undefined
  let restoration: Promise<void> = Promise.resolve()
  let restoreError: Error | null = null
  let blocked = false
  let anonymousFlight: Promise<void> | undefined
  let profileFlight: { epoch: number; promise: Promise<void> } | undefined
  let readyEpoch: number | undefined
  let signoutFlight: Promise<void> | undefined
  let startingGoogle = false
  let timer: ReturnType<typeof setTimeout> | undefined

  function publish(status: AuthState['status'], error: Error | null = null) {
    state = { status, userId: session?.user.id ?? null, isAnonymous: session?.user.is_anonymous === true, canReadPrivate: status === 'ready', error }
    listeners.forEach((listener) => listener())
  }

  function rotate() {
    scope.abort()
    scope = new AbortController()
    epoch++
    readyEpoch = undefined
    profileFlight = undefined
    clearTimeout(timer)
    // cancelQueries aborts consumed signals synchronously; clear also removes
    // viewer-dependent public data and old mutation results.
    void deps.queryClient.cancelQueries()
    deps.queryClient.clear()
  }

  function check(expected: number, signal: AbortSignal) {
    throwIfAborted(signal)
    if (!active || blocked || epoch !== expected) throw new DOMException('認証状態が変更されました。', 'AbortError')
  }

  function accept(next: AuthSession | null) {
    revision++
    const changed = identity(session) !== identity(next)
    if (changed) rotate()
    session = next
    if (blocked) { publish('signing-out'); return }
    if (!next) { publish('guest'); return }
    if (readyEpoch === epoch) { publish('ready'); return }
    publish('preparing')
    // Never await SDK/API calls inside onAuthStateChange (SDK auth lock).
    clearTimeout(timer)
    timer = setTimeout(() => { if (active && !blocked) void ensureProfile().catch(() => {}) }, 0)
  }

  async function ensureProfile() {
    clearTimeout(timer)
    if (!session) throw new AuthError('restore', '保存にはセッションが必要です。')
    if (readyEpoch === epoch) return
    if (profileFlight?.epoch === epoch) return profileFlight.promise
    const expected = epoch, signal = scope.signal, expectedIdentity = identity(session)
    const current = { epoch: expected, promise: Promise.resolve() }
    // Defer invocation so the shared flight is installed even for sync failures.
    current.promise = Promise.resolve().then(async () => {
      check(expected, signal)
      publish('preparing')
      try {
        const profile = await deps.initializeProfile(signal)
        check(expected, signal)
        if (`${profile.id}:${profile.isAnonymous}` !== expectedIdentity) throw new ApiError('auth', 'プロフィールと認証状態が一致しません。再確認してください。')
        readyEpoch = expected
        publish('ready')
      } catch (error) {
        const safe = safeAuthError(error, 'restore')
        if (active && epoch === expected && !blocked && !isAbortError(safe)) publish('error', safe)
        throw safe
      } finally {
        if (profileFlight === current) profileFlight = undefined
      }
    })
    profileFlight = current
    return current.promise
  }

  async function restore() {
    if (!deps.auth) return
    const startedLifetime = lifetime, startedRevision = revision
    restoreError = null
    try {
      const next = await deps.auth.getSession()
      if (!active || lifetime !== startedLifetime || blocked) return
      // An auth event arriving during getSession is newer than its result.
      if (revision === startedRevision) accept(next)
    } catch (error) {
      if (!active || lifetime !== startedLifetime || blocked || revision !== startedRevision) return
      restoreError = safeAuthError(error, 'restore')
      publish('error', restoreError)
    }
  }

  async function ensureAnonymous() {
    if (anonymousFlight) return anonymousFlight
    const startedEpoch = epoch, startedLifetime = lifetime, startedSignal = scope.signal
    const flight = Promise.resolve().then(async () => {
      try {
        check(startedEpoch, startedSignal)
        const next = await deps.auth!.signInAnonymously()
        if (!active || blocked || lifetime !== startedLifetime ||
          !(epoch === startedEpoch || (epoch === startedEpoch + 1 && identity(session) === identity(next)))) {
          throw new DOMException('認証状態が変更されました。', 'AbortError')
        }
        accept(next)
      } catch (error) {
        const safe = safeAuthError(error, 'signin')
        if (active && !blocked && epoch === startedEpoch && !isAbortError(safe)) publish('error', safe)
        throw safe
      }
    })
    anonymousFlight = flight
    try { await flight } finally { if (anonymousFlight === flight) anonymousFlight = undefined }
  }

  async function ensureReady(callerSignal?: AbortSignal) {
    if (!deps.auth) throw new AuthError('config', '認証設定がありません。SupabaseのURLとPublishable keyを確認してください。')
    if (!active) throw new AuthError('restore', '認証の準備が完了していません。')
    const startedLifetime = lifetime, startedEpoch = epoch
    const awaitingInitialSession = state.status === 'loading' && session === null
    await restoration
    if (callerSignal) throwIfAborted(callerSignal)
    if (!active || lifetime !== startedLifetime || (epoch !== startedEpoch && !awaitingInitialSession)) {
      throw new DOMException('認証状態が変更されました。', 'AbortError')
    }
    if (restoreError) throw restoreError
    if (blocked) throw new AuthError('signout', 'サインアウト中、または確認に失敗したため保存を停止しています。')
    const expected = session ? epoch : epoch + 1
    if (!session) await ensureAnonymous()
    if (callerSignal) throwIfAborted(callerSignal)
    check(expected, scope.signal)
    await ensureProfile()
    check(expected, scope.signal)
    return { epoch: expected, signal: scope.signal, userId: session!.user.id }
  }

  async function signOut() {
    if (signoutFlight) return signoutFlight
    if (!deps.auth || !active) throw new AuthError('config', '認証設定を確認してください。')
    blocked = true
    const startedLifetime = lifetime, pendingAnonymous = anonymousFlight
    revision++
    rotate()
    publish('signing-out')
    const flight = Promise.resolve().then(async () => {
      try {
        // Signup cannot be cancelled through Hono's AbortSignal. Settle it
        // before signing out so its late SDK session cannot log us back in.
        await pendingAnonymous?.catch(() => {})
        if (!active || lifetime !== startedLifetime) throw new DOMException('認証状態が変更されました。', 'AbortError')
        await deps.auth!.signOut()
        if (!active || lifetime !== startedLifetime) return
        session = null
        blocked = false
        restoreError = null
        publish('guest')
      } catch (error) {
        const safe = safeAuthError(error, 'signout')
        if (active && lifetime === startedLifetime) publish('error', safe)
        throw safe
      }
    })
    signoutFlight = flight
    try { await flight } finally { if (signoutFlight === flight) signoutFlight = undefined }
  }

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    getRequestSignal: () => scope.signal,
    start() {
      if (active) return
      active = true
      lifetime++
      blocked = false
      if (!deps.auth) return
      unsubscribe = deps.auth.onChange((next, event) => {
        if (!active) return
        if (event === 'SIGNED_OUT' && anonymousFlight && !blocked) {
          // A different tab may sign out while signup is still pending.
          void signOut().catch(() => {})
          return
        }
        restoreError = null
        accept(next)
      })
      restoration = restore()
    },
    stop() {
      active = false
      lifetime++
      unsubscribe?.()
      clearTimeout(timer)
      rotate()
      anonymousFlight = undefined
    },
    async retrySession() {
      if (!active || !deps.auth) throw new AuthError('config', '認証設定を確認してください。')
      if (blocked) throw new AuthError('signout', 'サインアウトを再試行してください。')
      publish('loading')
      restoration = restore()
      await restoration
      if (restoreError) throw restoreError
      if (session) await ensureProfile()
    },
    async getAccessToken() {
      if (!deps.auth) return null
      await restoration
      if (!active || blocked) throw new AuthError('restore', '認証状態を確認できません。')
      if (restoreError) throw restoreError
      const expected = epoch, signal = scope.signal
      let next: AuthSession | null
      try { next = await deps.auth.getSession() } catch (error) { throw safeAuthError(error, 'restore') }
      check(expected, signal)
      if (identity(next) !== identity(session)) {
        accept(next)
        throw new DOMException('認証状態が変更されました。', 'AbortError')
      }
      session = next
      return next?.access_token ?? null
    },
    async refreshSession() {
      await restoration
      const expected = epoch, signal = scope.signal
      check(expected, signal)
      if (!session || !deps.auth?.refreshSession) throw new AuthError('restore', '更新するセッションがありません。')
      try {
        const next = await deps.auth.refreshSession()
        check(expected, signal)
        if (identity(next) !== identity(session)) {
          accept(next)
          throw new DOMException('認証状態が変更されました。', 'AbortError')
        }
        session = next
      } catch (error) { throw safeAuthError(error, 'restore') }
    },
    async startGoogle(redirectTo: string) {
      const adapter = deps.auth
      if (!adapter?.googleUrl || !active || startingGoogle || anonymousFlight ||
        (state.status !== 'guest' && !(state.status === 'ready' && state.isAnonymous))) {
        throw new AuthError('oauth', 'ログイン状態を確認して、もう一度お試しください。')
      }
      const expected = epoch, signal = scope.signal, linkedUserId = session?.user.id ?? null
      startingGoogle = true
      try {
        const redirect = await adapter.googleUrl(redirectTo, linkedUserId !== null)
        check(expected, signal)
        return { ...redirect, linkedUserId }
      } finally { startingGoogle = false }
    },
    async exchangeGoogle(code: string, flowId: string, linkedUserId: string | null) {
      await restoration
      const adapter = deps.auth
      const startedLifetime = lifetime
      if (!adapter?.exchangeGoogle || !active || blocked || restoreError || (session?.user.id ?? null) !== linkedUserId ||
        (linkedUserId && !session?.user.is_anonymous)) {
        throw new AuthError('oauth', 'ログイン状態が変わりました。Google認証をやり直してください。')
      }
      const next = await adapter.exchangeGoogle(code, flowId, linkedUserId)
      if (!active || lifetime !== startedLifetime || blocked || next.user.is_anonymous !== false ||
        (linkedUserId && next.user.id !== linkedUserId)) throw new AuthError('oauth', 'Google認証のアカウントを確認できませんでした。')
      if (identity(session) !== identity(next)) accept(next)
      return next.user.id
    },
    async runAuthenticatedWrite<T>(operation: (context: { signal: AbortSignal; userId: string }) => Promise<T>, callerSignal?: AbortSignal): Promise<T> {
      if (callerSignal) throwIfAborted(callerSignal)
      const prepared = await ensureReady(callerSignal)
      const signal = callerSignal ? AbortSignal.any([prepared.signal, callerSignal]) : prepared.signal
      check(prepared.epoch, signal)
      const result = await operation({ signal, userId: prepared.userId })
      check(prepared.epoch, signal)
      return result
    },
    signOut,
  }
}

export type AuthController = ReturnType<typeof createAuthController>
