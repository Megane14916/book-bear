import { useEffect, useRef } from 'react'
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { useAuth } from '../../lib/auth/AuthProvider'
import { AuthError } from '../../lib/auth/errors'
import { throwIfAborted } from '../../lib/api/errors'
import { queryKeys } from '../../lib/query/keys'
import { getBook, searchBooks, type Book } from './api'

export const searchOptions = (q: string) => queryOptions({
  queryKey: queryKeys.bookSearch(q), queryFn: ({ signal }) => searchBooks(q, signal), enabled: Boolean(q.trim()),
})
export const bookOptions = (bookId: string) => queryOptions({
  queryKey: queryKeys.book(bookId), queryFn: ({ signal }) => getBook(bookId, signal),
})

// Share authentication, cancellation, duplicate prevention and navigation for
// import/manual creation. Never turn providerId or ISBN into an internal ID.
export function useBookCreation<T>(write: (input: T, signal: AbortSignal) => Promise<Book>, scopeKey: string) {
  const { runAuthenticatedWrite, retrySession, status, error } = useAuth()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const controller = useRef(new AbortController())
  const busy = useRef<AbortSignal | null>(null)
  const mutation = useMutation({
    mutationFn: async ({ input, signal }: { input: T; signal: AbortSignal }) => {
      throwIfAborted(signal)
      if (status === 'error' && error instanceof AuthError && error.stage === 'restore') await retrySession()
      throwIfAborted(signal)
      return runAuthenticatedWrite(({ signal: combined }) => write(input, combined), signal)
    },
    retry: false,
  })
  const reset = mutation.reset
  useEffect(() => {
    const current = new AbortController()
    controller.current = current
    reset()
    return () => current.abort()
  }, [scopeKey, reset])
  async function save(input: T) {
    const signal = controller.current.signal
    if (busy.current === signal) return
    busy.current = signal
    try {
      const book = await mutation.mutateAsync({ input, signal })
      if (signal.aborted) return
      queryClient.setQueryData(queryKeys.book(book.id), book)
      void queryClient.invalidateQueries({ queryKey: ['books', 'search'] })
      navigate(`/books/${book.id}`)
    } catch { /* Safe, retryable UI uses mutation.error; never log raw responses. */ }
    finally { if (busy.current === signal) busy.current = null }
  }
  return { ...mutation, variables: mutation.variables?.input, save }
}
