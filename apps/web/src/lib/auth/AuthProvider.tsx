import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api, setAccessTokenGetter, setRequestSignalGetter } from '../api/client'
import { ApiError } from '../api/errors'
import { requestData } from '../api/result'
import { createAuthAdapter } from './client'
import { createAuthController, type AuthController, type AuthState } from './controller'

const AuthContext = createContext<{ state: AuthState; controller: AuthController } | null>(null)
let adapter: ReturnType<typeof createAuthAdapter> | undefined

export function AuthProvider({ children, controller: supplied }: { children: ReactNode; controller?: AuthController }) {
  const queryClient = useQueryClient()
  const [controller] = useState(() => supplied ?? createAuthController({
    auth: adapter === undefined ? (adapter = createAuthAdapter()) : adapter,
    queryClient,
    async initializeProfile(signal) {
      const profile = await requestData(() => api.PUT('/api/v1/me', { signal }))
      if (!profile) throw new ApiError('response', 'プロフィールの応答がありません。')
      return profile
    },
  }))
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)

  useEffect(() => {
    controller.start()
    setAccessTokenGetter(controller.getAccessToken)
    setRequestSignalGetter(controller.getRequestSignal)
    return () => {
      controller.stop()
      setAccessTokenGetter(undefined)
      setRequestSignalGetter(undefined)
    }
  }, [controller])

  return <AuthContext.Provider value={{ state, controller }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuthはAuthProvider配下で使用してください。')
  return { ...context.state, runAuthenticatedWrite: context.controller.runAuthenticatedWrite,
    retrySession: context.controller.retrySession, signOut: context.controller.signOut, refreshSession: context.controller.refreshSession }
}
