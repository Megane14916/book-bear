import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { components } from '../../lib/api/generated'
import { addToLibrary } from './api'
import { queryKeys } from '../../lib/query/keys'
import { useAuth } from '../../lib/auth/AuthProvider'

type UserBook = components['schemas']['UserBook']

/** Reusable by book search/detail screens; authentication is initialized only after the user saves. */
export function AddToLibraryButton({ bookId, onAdded }: { bookId: string; onAdded?: (item: UserBook) => void }) {
  const auth = useAuth()
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: () => auth.runAuthenticatedWrite(({ signal }) => addToLibrary(bookId, signal)),
    onSuccess: (item) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.myBooks(item.userId) })
      onAdded?.(item)
    },
  })

  return <div>
    <button type="button" className="ui-action inline-flex bg-forest px-4 text-sm font-bold text-white hover:bg-forest-dark"
      disabled={mutation.isPending} onClick={() => mutation.mutate()}>
      {mutation.isPending ? '本棚に追加中…' : '本棚に追加'}
    </button>
    {mutation.isError && <p role="alert" className="mt-2 text-sm text-red-700">{mutation.error.message}</p>}
    {mutation.isSuccess && <p role="status" className="mt-2 text-sm text-forest">本棚に追加しました。</p>}
  </div>
}
