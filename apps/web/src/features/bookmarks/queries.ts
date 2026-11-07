import { useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useAuth } from '../../lib/auth/AuthProvider'
import { isAbortError, throwIfAborted } from '../../lib/api/errors'
import { queryKeys } from '../../lib/query/keys'
import { isUuid } from '../book-search/validation'
import { getBookmark, type Bookmark } from './api'

// Public profile/flow/list caches can contain full text, even while inactive.
// Reset (rather than only invalidate) so an old public body cannot flash on return.
// Preserve public book metadata and health. Keep bookshelf pages and mark the owner's list stale.
export async function refreshBookmarkCaches(client: QueryClient, bookmark: Bookmark | null, viewerId: string, signal: AbortSignal) {
  const filters = { predicate: (query: { queryKey: readonly unknown[] }) => !['books', 'health', 'my-books'].includes(String(query.queryKey[0])) }
  const library = { queryKey: queryKeys.myBooks(viewerId) }
  await Promise.all([client.cancelQueries(filters), client.cancelQueries(library)])
  throwIfAborted(signal)
  // Keep the mounted detail/form stable until navigation. Reset other viewers'
  // details as well; after deletion the hook removes all detail caches.
  void client.resetQueries({ predicate: (query) => filters.predicate(query) && (query.queryKey[0] !== 'bookmarks'
    || (bookmark !== null && !(query.queryKey[2] === bookmark.id && query.queryKey[3] === viewerId))) })
  if (bookmark) client.setQueryData(queryKeys.bookmark(bookmark.id, viewerId), bookmark)
  void client.invalidateQueries(library)
}

export function useBookmark(bookmarkId: string) {
  const auth = useAuth()
  const settled = auth.status === 'ready' || auth.status === 'guest' || auth.status === 'unconfigured'
  return useQuery({
    queryKey: queryKeys.bookmark(bookmarkId, auth.userId),
    queryFn: ({ signal }) => getBookmark(bookmarkId, signal),
    enabled: settled && isUuid(bookmarkId),
  })
}

// A synchronous lock also covers two clicks before React renders disabled=true.
// The caller's signal cancels work when the form/route disappears; auth adds its
// own identity signal, preventing responses from a previous user taking effect.
export function useBookmarkWrite<T>(operation: (input: T, signal: AbortSignal) => Promise<Bookmark | null>, scope: string, onSaved: (bookmark: Bookmark | null) => void) {
  const auth = useAuth()
  const client = useQueryClient()
  const controller = useRef(new AbortController())
  const busy = useRef<AbortSignal | null>(null)
  const mutation = useMutation({ mutationFn: ({ input, signal }: { input: T; signal: AbortSignal }) =>
    auth.runAuthenticatedWrite(async ({ signal: combined, userId }) => {
      const result = await operation(input, combined)
      throwIfAborted(combined)
      await refreshBookmarkCaches(client, result, userId, combined)
      return result
    }, signal), retry: false,
  })
  const reset = mutation.reset
  useEffect(() => {
    const current = new AbortController()
    controller.current = current
    reset()
    return () => current.abort()
  }, [scope, reset])
  async function save(input: T) {
    const signal = controller.current.signal
    if (busy.current === signal) return
    busy.current = signal
    try {
      const result = await mutation.mutateAsync({ input, signal })
      if (!signal.aborted) {
        onSaved(result)
        if (result === null) client.removeQueries({ queryKey: ['bookmarks'] })
      }
    } catch { /* Errors are displayed safely by the form, never logged. */ }
    finally { if (busy.current === signal) busy.current = null }
  }
  return { ...mutation, save, error: isAbortError(mutation.error) ? null : mutation.error }
}
