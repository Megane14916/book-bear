import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useRef, useState } from 'react'
import { BookCard } from '../../components/books/BookCard'
import { EmptyState, ErrorState, LoadingState } from '../../components/states/ScreenStates'
import { useAuth } from '../../lib/auth/AuthProvider'
import { GoogleAction } from '../../lib/auth/GoogleAction'
import { queryKeys } from '../../lib/query/keys'
import { bookOptions } from '../book-search/queries'
import { isUuid } from '../book-search/validation'
import { addToLibrary, getLibraryPage } from '../library/api'
import { createBookmark, type BookmarkInput } from './api'
import { BookmarkForm } from './BookmarkForm'
import { useBookmarkWrite } from './queries'
import { throwIfAborted } from '../../lib/api/errors'

export default function BookmarkCreatePage() {
  const [params] = useSearchParams()
  // A route change starts a new form; inputs survive request failures within it.
  return <CreateForm key={params.toString()} bookId={params.get('bookId')} userBookId={params.get('userBookId')} />
}

function CreateForm({ bookId, userBookId }: { bookId: string | null; userBookId: string | null }) {
  const auth = useAuth()
  const navigate = useNavigate()
  const client = useQueryClient()
  const [selected, setSelected] = useState(userBookId ?? '')
  // Keep the returned shelf ID for retrying a failed bookmark POST; never treat
  // bookId/providerId as userBookId. Owner identity must match on reuse.
  const registered = useRef<{ userId: string; id: string } | null>(null)
  const library = useInfiniteQuery({
    queryKey: queryKeys.myBooks(auth.userId ?? 'unavailable'), enabled: auth.canReadPrivate,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => getLibraryPage(pageParam, signal),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })
  const book = useQuery({ ...bookOptions(bookId ?? ''), enabled: !!bookId && isUuid(bookId) })
  const items = library.data?.pages.flatMap((p) => p.items) ?? []
  const selectedBook = items.find((item) => item.id === selected)
  const mutation = useBookmarkWrite(async (input: BookmarkInput, signal) => {
    let shelfId = selectedBook?.id
    if (bookId) {
      // POST /me/books is idempotent for an existing book (200 or 201).
      if (registered.current?.userId === auth.userId) shelfId = registered.current.id
      else {
        const added = await addToLibrary(bookId, signal)
        throwIfAborted(signal)
        registered.current = { userId: added.userId, id: added.id }
        shelfId = added.id
        void client.invalidateQueries({ queryKey: queryKeys.myBooks(added.userId) })
      }
    }
    if (!shelfId) throw new Error('自分の本棚から本を選び直してください。')
    return createBookmark({ ...input, userBookId: shelfId }, signal)
  }, bookId ?? selected, (saved) => { if (saved) navigate(`/bookmarks/${saved.id}`) })

  const authBusy = ['loading', 'preparing', 'signing-out'].includes(auth.status)
  const invalidId = (bookId !== null && !isUuid(bookId)) || (userBookId !== null && !isUuid(userBookId))
  if (invalidId) return <EmptyState title="本を選び直してください" description="指定された本のIDが正しくありません。" action={<Link to="/search" className="ui-action inline-flex underline">本を探す</Link>} />
  return <section className="min-w-0 space-y-5">
    <h1 className="text-2xl font-bold">栞を残す</h1>
    {auth.status === 'error' || auth.status === 'unconfigured' ? <ErrorState description={auth.error?.message ?? '認証設定を確認してください。'}
      onRetry={() => void auth.retrySession().catch(() => {})} /> : null}
    {bookId ? book.isPending ? <LoadingState /> : book.isError ? <ErrorState description="書籍を取得できませんでした。" onRetry={() => void book.refetch()} /> : <BookCard book={book.data} />
      : <div className="space-y-3">
        {authBusy && <LoadingState label="ログイン状態を確認しています…" />}
        {auth.canReadPrivate && <>
          <label className="block text-sm font-bold">本棚から選ぶ
            <select className="mt-1 min-h-11 w-full min-w-0 rounded-lg border bg-white px-2" value={selected} disabled={mutation.isPending}
              onChange={(e) => { setSelected(e.target.value); mutation.reset() }}>
              <option value="">本を選んでください</option>
              {items.map((item) => <option key={item.id} value={item.id}>{item.book.title}</option>)}
            </select>
          </label>
          {library.isPending && <LoadingState />}
          {library.isError && <ErrorState description="本棚を取得できませんでした。" onRetry={() => void library.refetch()} />}
          {library.hasNextPage && <button className="ui-action border px-3" disabled={library.isFetchingNextPage || mutation.isPending}
            onClick={() => void library.fetchNextPage()}>本棚の続きを読み込む</button>}
          {selected && !selectedBook && !library.isPending && <p role="status" className="text-sm">選択した本が見つかりません。続きの読み込みか、本の選び直しをしてください。</p>}
        </>}
        <Link className="ui-action inline-flex text-forest underline" to="/search">検索から本を選ぶ</Link>
      </div>}
    <BookmarkForm pending={mutation.isPending} error={mutation.error} canPublish={auth.status === 'ready' && !auth.isAnonymous}
      registrationAction={<GoogleAction />}
      canSave={!authBusy && (bookId ? book.isSuccess : !!selectedBook)}
      onSave={(input) => void mutation.save(input)}>
      <p className="text-sm text-[#526356]">非公開の栞は自分だけが読めます。本棚にない本は保存時に本棚へ追加します。</p>
      {!bookId && !selectedBook && <p className="text-sm">保存する前に本を選んでください。</p>}
    </BookmarkForm>
  </section>
}
