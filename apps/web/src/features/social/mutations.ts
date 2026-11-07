import { useIsMutating, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { HttpError } from '../../lib/api/errors'
import { useAuth } from '../../lib/auth/AuthProvider'

export function useSocialMutation<T>(key: string[], write: (input: T, signal: AbortSignal) => Promise<unknown>, refresh: (client: QueryClient) => Promise<unknown>) {
  const auth = useAuth()
  const client = useQueryClient()
  const mutationKey = ['social', ...key, auth.userId]
  const mutation = useMutation({
    mutationKey,
    mutationFn: (input: T) => {
      if (auth.status !== 'ready' || auth.isAnonymous) throw new HttpError(403)
      return auth.runAuthenticatedWrite(({ userId, signal }) => {
        if (userId !== auth.userId) throw new HttpError(403)
        return write(input, signal)
      })
    },
    onSuccess: () => refresh(client),
  })
  const pending = useIsMutating({ mutationKey }) > 0
  function mutate(...args: Parameters<typeof mutation.mutate>) {
    if (client.isMutating({ mutationKey }) === 0) mutation.mutate(...args)
  }
  return { ...mutation, mutate, pending }
}

export function refreshBookmarkSocial(client: QueryClient, bookmarkId: string) {
  return client.invalidateQueries({ predicate: ({ queryKey: [group, kind, id] }) =>
    ['feed', 'bookmark-flow', 'search-posts', 'my-bookmarks'].includes(String(group)) ||
    (group === 'bookmarks' && kind === 'detail' && id === bookmarkId) || (group === 'replies' && kind === bookmarkId),
  })
}

export function socialError(error: unknown) {
  if (error instanceof HttpError) {
    if (error.status === 401 || error.status === 403) return 'この操作にはGoogleでの登録とログインが必要です。'
    if (error.status === 404) return '対象が見つかりません。'
  }
  return '操作を完了できませんでした。もう一度お試しください。'
}
