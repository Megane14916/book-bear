import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import type { components } from '../../lib/api/generated'
import { api } from '../../lib/api/client'
import LibraryPage from './LibraryPage'

vi.mock('../../lib/api/client', () => ({ api: { GET: vi.fn(), PATCH: vi.fn(), DELETE: vi.fn() } }))
vi.mock('../../lib/auth/AuthProvider', () => ({ useAuth: () => ({
  status: 'ready', userId: 'viewer-1', isAnonymous: true, canReadPrivate: true, error: null,
  runAuthenticatedWrite: vi.fn(), retrySession: vi.fn(), signOut: vi.fn(), refreshSession: vi.fn(),
}) }))

afterEach(cleanup)

const userBook = (id: string, title: string): components['schemas']['UserBook'] => ({
  id, userId: 'viewer-1', book: { id: `book-${id}`, title, author: null, isbn13: null, coverUrl: null },
  status: 'reading', currentPage: 12, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
})

beforeEach(() => {
  vi.mocked(api.GET).mockReset()
  vi.mocked(api.GET)
    .mockResolvedValueOnce({ data: { items: [userBook('1', '最初の本')], nextCursor: 'next-page' }, response: new Response() } as never)
    .mockRejectedValueOnce(new Error('追加取得に失敗しました'))
    .mockResolvedValueOnce({ data: { items: [userBook('2', '次の本')], nextCursor: null }, response: new Response() } as never)
})

it('keeps loaded books visible after a next-page error and lets the user retry', async () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}><MemoryRouter><LibraryPage /></MemoryRouter></QueryClientProvider>)

  expect(await screen.findByRole('heading', { name: '最初の本' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '続きを読み込む' }))

  expect(await screen.findByRole('alert')).toBeTruthy()
  expect(screen.getByRole('heading', { name: '最初の本' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '再試行' }))
  expect(await screen.findByRole('heading', { name: '次の本' })).toBeTruthy()
  expect(screen.getByRole('heading', { name: '最初の本' })).toBeTruthy()

  queryClient.clear()
})
