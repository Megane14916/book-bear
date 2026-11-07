import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useRef, useState } from 'react'
import { BookCard } from '../../components/books/BookCard'
import { BookPreview } from '../../components/books/BookPreview'
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
import { ComposerDock } from './ComposerDock'

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
  const [previewOpen, setPreviewOpen] = useState(true)
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
        <Link className="ui-action inline-flex text-forest underline" to="/search">検索から本を選ぶ</Link>
      </div>}
    <BookmarkForm pending={mutation.isPending} error={mutation.error} canPublish={auth.status === 'ready' && !auth.isAnonymous}
      registrationAction={<GoogleAction />}
      canSave={!authBusy && (bookId ? book.isSuccess : !!selectedBook)}
      submitLabel="栞を投稿"
      submitArea={(button) => <ComposerDock>
        {!bookId && auth.canReadPrivate && <>
          <div className="flex min-w-0 items-center justify-between gap-2">
            <p className="min-w-0 truncate text-xs font-bold" title={selectedBook?.book.title}>{selectedBook ? `選択中：${selectedBook.book.title}` : '本棚から選ぶ'}</p>
            <button type="button" className="ui-action shrink-0 px-2 text-xs font-bold text-forest" aria-expanded={previewOpen} aria-controls="shelf-preview"
              onClick={() => setPreviewOpen((value) => !value)}>{previewOpen ? '本棚を閉じる' : '本棚を開く'}</button>
          </div>
          {previewOpen && <div id="shelf-preview" className="space-y-1">
            {library.isPending && <p role="status" className="text-xs">本棚を読み込み中…</p>}
            {library.isError && <button type="button" className="ui-action text-xs text-forest underline" onClick={() => void library.refetch()}>本棚の取得を再試行</button>}
            {!library.isPending && items.length === 0 && <p className="text-xs">本棚に本がありません。検索から本を選んでください。</p>}
            <div role="group" aria-label="本棚のプレビュー" tabIndex={0} className="flex gap-2 overflow-x-auto pb-1 focus-visible:outline-2 focus-visible:outline-forest">
              {items.map((item) => <button key={item.id} type="button" aria-label={`投稿する本：${item.book.title}`} aria-pressed={selected === item.id}
                disabled={mutation.isPending} title={item.book.title}
                className="shrink-0 rounded-lg border-2 border-transparent p-1 text-ink aria-pressed:border-forest aria-pressed:bg-mist focus-visible:outline-2 focus-visible:outline-forest"
                onClick={() => { setSelected(item.id); mutation.reset() }}><BookPreview book={item.book} /></button>)}
              {library.hasNextPage && <button type="button" className="ui-action shrink-0 border px-3 text-xs text-forest" disabled={library.isFetchingNextPage || mutation.isPending}
                onClick={() => void library.fetchNextPage()}>本棚の続きを読み込む</button>}
            </div>
            {selected && !selectedBook && !library.isPending && <p role="status" className="text-xs">選択した本が見つかりません。本棚の続きを読み込むか、選び直してください。</p>}
          </div>}
        </>}
        <div className="flex justify-end pt-1">{button}</div>
      </ComposerDock>}
      onSave={(input) => void mutation.save(input)}>
      <p className="text-sm text-[#526356]">非公開の栞は自分だけが読めます。</p>
    </BookmarkForm>
  </section>
}
