import { infiniteQueryOptions } from '@tanstack/react-query'
import { api } from '../../lib/api/client'
import { requireData } from '../../lib/api/result'
import { queryKeys } from '../../lib/query/keys'

export function bookmarkFlowOptions(userId: string, bookId: string, viewerId: string | null) {
  return infiniteQueryOptions({
    queryKey: queryKeys.bookmarkFlow(userId, bookId, viewerId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => requireData(() => api.GET('/api/v1/users/{userId}/books/{bookId}/bookmarks', {
      params: { path: { userId, bookId }, query: { limit: 15, cursor: pageParam } }, signal,
    })),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  })
}
