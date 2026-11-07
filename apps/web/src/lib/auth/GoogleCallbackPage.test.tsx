import { StrictMode } from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import GoogleCallbackPage from './GoogleCallbackPage'
import { safeReturnTo, storeGoogleAttempt } from './google'

const auth = vi.hoisted(() => ({ status: 'ready', userId: 'owner', isAnonymous: true, exchangeGoogle: vi.fn() }))
vi.mock('./AuthProvider', () => ({ useAuth: () => auth }))
afterEach(() => {
  cleanup(); auth.exchangeGoogle.mockReset(); auth.isAnonymous = true; auth.status = 'ready'
  sessionStorage.clear(); window.history.replaceState(null, '', '/')
})

function show(path: string) {
  window.history.replaceState(null, '', path)
  const view = () => <StrictMode><MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/auth/callback" element={<GoogleCallbackPage />} />
    <Route path="/library" element={<h1>自分の本棚</h1>} />
  </Routes></MemoryRouter></StrictMode>
  const { rerender } = render(view())
  return () => rerender(view())
}

it('consumes one code, scrubs it from the URL, and waits until the formal profile is ready', async () => {
  storeGoogleAttempt({ flowId: 'flow', linkedUserId: 'owner', returnTo: '/library' })
  auth.status = 'preparing'; auth.isAnonymous = false
  auth.exchangeGoogle.mockResolvedValue('owner')
  const refresh = show('/auth/callback?code=test-code')
  await waitFor(() => expect(auth.exchangeGoogle).toHaveBeenCalledExactlyOnceWith('test-code', 'flow', 'owner'))
  expect(window.location.search).toBe('')
  expect(screen.queryByRole('heading', { name: '自分の本棚' })).toBeNull()
  auth.status = 'ready'
  refresh()
  await screen.findByRole('heading', { name: '自分の本棚' })
})

it('keeps the anonymous session on a provider conflict and offers a new attempt', async () => {
  storeGoogleAttempt({ flowId: 'flow', linkedUserId: 'owner', returnTo: '/library' })
  show('/auth/callback#error_code=identity_already_exists&error_description=private')
  await screen.findByRole('button', { name: 'Googleアカウントを連携' })
  expect(screen.getByRole('alert').textContent).toContain('すでに別のアカウントに連携')
  expect(screen.queryByText('private')).toBeNull()
  expect(window.location.hash).toBe('')
  expect(auth.exchangeGoogle).not.toHaveBeenCalled()
  expect(safeReturnTo('/x/..//example.com')).toBe('/me')
  expect(safeReturnTo('https://example.com')).toBe('/me')
})
