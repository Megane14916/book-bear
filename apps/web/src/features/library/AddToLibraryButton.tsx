import { useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { ApiError, throwIfAborted } from '../../lib/api/errors'
import type { components } from '../../lib/api/generated'
import { addToLibrary } from './api'
import { queryKeys } from '../../lib/query/keys'
import { useAuth } from '../../lib/auth/AuthProvider'

type UserBook = components['schemas']['UserBook']
type LibraryData = InfiniteData<components['schemas']['UserBookPage'], string | undefined>

/** Reusable by book search/detail screens; authentication is initialized only after the user saves. */
export function AddToLibraryButton({ bookId, onAdded }: { bookId: string; onAdded?: (item: UserBook) => void }) {
  const auth = useAuth()
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: () => auth.runAuthenticatedWrite(async ({ userId, signal }) => {
      const item = await addToLibrary(bookId, signal)
      if (item.userId !== userId) throw new ApiError('response', '本棚登録の利用者を確認できませんでした。')
      const query = { queryKey: queryKeys.myBooks(userId), exact: true }
      await queryClient.cancelQueries(query)
      throwIfAborted(signal)
      queryClient.setQueryData<LibraryData>(query.queryKey, (current) => {
        if (current?.pages.some((page) => page.items.some((book) => book.id === item.id))) return current
        const [first, ...remaining] = current?.pages ?? []
        return {
          pages: [{ items: [item, ...(first?.items ?? [])], nextCursor: first?.nextCursor ?? null }, ...remaining],
          pageParams: current?.pageParams ?? [undefined],
        }
      })
      void queryClient.invalidateQueries(query)
      return item
    }),
  })

  return <div>
    <button type="button" className="ui-action inline-flex bg-forest px-4 text-sm font-bold text-white hover:bg-forest-dark"
      disabled={mutation.isPending} onClick={() => mutation.mutate(undefined, { onSuccess: onAdded })}>
      {mutation.isPending ? '本棚に追加中…' : '本棚に追加'}
    </button>
    {mutation.isError && <p role="alert" className="mt-2 text-sm text-red-700">{mutation.error.message}</p>}
    {mutation.isSuccess && <p role="status" className="mt-2 text-sm text-forest">本棚に追加しました。</p>}
  </div>
}
