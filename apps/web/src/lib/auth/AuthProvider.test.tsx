import { StrictMode } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { createQueryClient } from '../query/client'
import { createAuthController } from './controller'
import { AuthProvider, useAuth } from './AuthProvider'
import { AuthCheck } from './AuthCheck'

afterEach(cleanup)

it('subscribes safely in StrictMode and keeps guest pages mounted without signup', async () => {
  const listeners = new Set<unknown>()
  const getSession = vi.fn(async () => null), signup = vi.fn()
  const queryClient = createQueryClient()
  const controller = createAuthController({ auth: { getSession, signInAnonymously: signup, signOut: vi.fn(),
    onChange(callback) { listeners.add(callback); return () => { listeners.delete(callback) } } },
    queryClient, initializeProfile: vi.fn() })
  function Guest() { const auth = useAuth(); return <p>閲覧状態：{auth.status}</p> }
  const view = render(<StrictMode><QueryClientProvider client={queryClient}>
    <AuthProvider controller={controller}><Guest /></AuthProvider>
  </QueryClientProvider></StrictMode>)
  await screen.findByText('閲覧状態：guest')
  expect(signup).not.toHaveBeenCalled()
  expect(listeners.size).toBe(1)
  view.unmount()
  expect(listeners.size).toBe(0)
  queryClient.clear()
})

it('keeps public content available when auth is unconfigured and reports save configuration errors', async () => {
  const queryClient = createQueryClient()
  const controller = createAuthController({ auth: null, queryClient, initializeProfile: vi.fn() })
  render(<QueryClientProvider client={queryClient}><AuthProvider controller={controller}>
    <p>公開ページ</p><AuthCheck />
  </AuthProvider></QueryClientProvider>)
  expect(screen.getByText('公開ページ')).toBeTruthy()
  screen.getByRole('button', { name: '保存前処理を確認' }).click()
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('認証設定がありません'))
  queryClient.clear()
})
