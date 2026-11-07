import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router'
import { useEffect, useRef } from 'react'
import { BookCard } from '../../components/books/BookCard'
import { EmptyState, ErrorState, LoadingState } from '../../components/states/ScreenStates'
import { throwIfAborted } from '../../lib/api/errors'
import { useAuth } from '../../lib/auth/AuthProvider'
import { GoogleAction } from '../../lib/auth/GoogleAction'
import { queryKeys } from '../../lib/query/keys'
import { bookOptions } from '../book-search/queries'
import { isUuid } from '../book-search/validation'
import { addToLibrary } from '../library/api'
import { createBookmark, type BookmarkInput } from './api'
import { BookPicker, usePickerLibrary } from './BookPicker'
import { BookmarkForm } from './BookmarkForm'
import { BookmarkHistory } from './BookmarkHistory'
import { ComposerDock } from './ComposerDock'
import { useBookmarkWrite } from './queries'

const activeStep = 'rounded-lg bg-mist px-4 py-2 text-base font-bold text-forest'
const slide = 'w-full motion-safe:transition-[left] motion-safe:duration-300 motion-safe:ease-out'

export default function BookmarkCreatePage() {
  const [params, setParams] = useSearchParams()
  const auth = useAuth()
  const bookId = params.get('bookId')
  const userBookId = params.get('userBookId')
  const composing = bookId !== null || userBookId !== null
  const invalid = (bookId !== null && !isUuid(bookId)) || (userBookId !== null && !isUuid(userBookId))
  const library = usePickerLibrary(auth.userId, auth.canReadPrivate && (!composing || (!bookId && !!userBookId)))
  const heading = useRef<HTMLHeadingElement>(null)
  const previous = useRef(composing)

  useEffect(() => {
    if (previous.current === composing) return
    previous.current = composing
    heading.current?.focus()
  }, [composing])

  return <section className="min-w-0 space-y-5">
    <ol aria-label="投稿の手順" className="flex items-center justify-center gap-2 text-sm font-bold text-[#526356] sm:gap-4">
      <li aria-current={composing ? undefined : 'step'}>
        {composing ? <button type="button" className="ui-action px-4 text-forest underline" onClick={() => setParams({}, { replace: true })}>本を選ぶ</button> :
          <h1 ref={heading} tabIndex={-1} className={activeStep}>本を選ぶ</h1>}
      </li>
      <li aria-hidden="true" className="h-px w-6 bg-[#b4c6b7]" />
      <li aria-current={composing ? 'step' : undefined}>
        {composing ? <h1 ref={heading} tabIndex={-1} className={activeStep}>投稿する</h1> : <span className="px-4">投稿する</span>}
      </li>
    </ol>

    <div className="relative overflow-x-clip">
      <div inert={composing} aria-hidden={composing || undefined}
        className={`${slide} ${composing ? 'absolute inset-y-0 -left-full overflow-hidden' : 'relative left-0'}`}>
        <BookPicker library={library} active={!composing} onSelect={(selection) => setParams(selection)} />
      </div>
      <div inert={!composing} aria-hidden={!composing || undefined}
        className={`${slide} ${composing ? 'relative left-0' : 'absolute inset-y-0 left-full overflow-hidden'}`}>
        {composing && (invalid ? <EmptyState title="本を選び直してください" description="指定された本のIDが正しくありません。" /> :
          <Compose key={params.toString()} bookId={bookId} userBookId={userBookId} library={library} />)}
      </div>
    </div>
  </section>
}

function Compose({ bookId, userBookId, library }: {
  bookId: string | null; userBookId: string | null; library: ReturnType<typeof usePickerLibrary>
}) {
  const auth = useAuth()
  const navigate = useNavigate()
  const client = useQueryClient()
  const registered = useRef<{ userId: string; id: string } | null>(null)
  const catalogBook = useQuery({ ...bookOptions(bookId ?? ''), enabled: !!bookId })
  const selectedBook = auth.canReadPrivate ? library.data?.pages.flatMap((page) => page.items)
    .find((item) => bookId ? item.book.id === bookId : item.id === userBookId) : undefined
  const book = bookId ? catalogBook.data : selectedBook?.book
  const mutation = useBookmarkWrite(async (input: BookmarkInput, signal) => {
    let shelfId = selectedBook?.id
    if (bookId && !shelfId) {
      // A retry after a failed bookmark POST can reuse the confirmed shelf entry.
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
  }, bookId ?? userBookId ?? '', (saved) => { if (saved) void navigate(`/bookmarks/${saved.id}`) })

  const authBusy = ['loading', 'preparing', 'signing-out'].includes(auth.status)
  const canPublish = auth.status === 'ready' && !auth.isAnonymous
  return <div className="min-w-0 space-y-5">
    {(auth.status === 'error' || auth.status === 'unconfigured') && <ErrorState description={auth.error?.message ?? '認証設定を確認してください。'}
      onRetry={() => void auth.retrySession().catch(() => {})} />}
    {book ? <BookCard book={book} /> : bookId ? catalogBook.isError ?
      <ErrorState description="書籍を取得できませんでした。" onRetry={() => void catalogBook.refetch()} /> : <LoadingState /> :
      authBusy || (auth.canReadPrivate && library.isPending) ? <LoadingState /> :
      library.isError && !library.data ? <ErrorState description="本棚を取得できませんでした。" onRetry={() => void library.refetch()} /> :
      <div className="space-y-2">
        <p className="text-sm">選んだ本が見つかりません。本棚の続きを読み込むか、本を選び直してください。</p>
        {library.hasNextPage && <button type="button" className="ui-action border px-3 text-sm text-forest" disabled={library.isFetching}
          onClick={() => void library.fetchNextPage()}>本棚の続きを読み込む</button>}
      </div>}
    {book && auth.canReadPrivate && auth.userId && <BookmarkHistory key={`${auth.userId}:${book.id}`} bookId={book.id} userId={auth.userId} />}
    <BookmarkForm pending={mutation.isPending} error={mutation.error} canPublish={canPublish}
      defaultVisibility={canPublish ? 'public' : 'private'} autoGrow
      registrationAction={<GoogleAction />}
      canSave={!authBusy && (bookId ? catalogBook.isSuccess : !!selectedBook)}
      submitLabel="栞を投稿"
      submitArea={(button) => <ComposerDock><div className="flex justify-end">{button}</div></ComposerDock>}
      onSave={(input) => void mutation.save(input)}>
      <p className="text-sm text-[#526356]">非公開の栞は自分だけが読めます。</p>
    </BookmarkForm>
  </div>
}
