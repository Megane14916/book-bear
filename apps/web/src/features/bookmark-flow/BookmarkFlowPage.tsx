import { useInfiniteQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { PageBack } from '../../components/PageBack'
import { BookCard } from '../../components/books/BookCard'
import { LoadMore } from '../../components/states/LoadMore'
import { EmptyState, ErrorState, LoadingState } from '../../components/states/ScreenStates'
import { HttpError } from '../../lib/api/errors'
import { useAuth } from '../../lib/auth/AuthProvider'
import { canReadPublic } from '../../lib/auth/readable'
import { isUuid } from '../book-search/validation'
import { useContentPreference } from '../feed/useContentPreference'
import { SocialBookmarkCard } from '../social/SocialBookmarkCard'
import { bookmarkFlowOptions } from './queries'

export default function BookmarkFlowPage() {
  const { userId = '', bookId = '' } = useParams()
  return <section className="space-y-5">
    <PageBack fallback={isUuid(userId) ? `/users/${userId}` : '/'} />
    <FlowContent userId={userId} bookId={bookId} />
  </section>
}

function FlowContent({ userId, bookId }: { userId: string; bookId: string }) {
  const auth = useAuth()
  const valid = isUuid(userId) && isUuid(bookId)
  const { mode, control } = useContentPreference({ enabled: valid, compact: true })
  const flow = useInfiniteQuery({
    ...bookmarkFlowOptions(userId, bookId, auth.userId),
    enabled: valid && canReadPublic(auth.status),
  })
  const back = auth.userId === userId
    ? <Link className="ui-action inline-flex text-forest underline" to="/library">本棚へ戻る</Link>
    : <Link className="ui-action inline-flex text-forest underline" to="/">ホームへ戻る</Link>
  if (!valid || (!flow.isFetchNextPageError && flow.error instanceof HttpError && flow.error.status === 404)) {
    return <EmptyState title="本または読者が見つかりません" description="URLを確認してください。" action={back} />
  }
  if (auth.status === 'error') return <ErrorState description={auth.error?.message ?? 'ログイン状態を確認できませんでした。'}
    onRetry={() => void auth.retrySession().catch(() => {})} />
  if (!canReadPublic(auth.status) || flow.isPending) return <LoadingState />
  if (!flow.data) return <ErrorState description="栞の流れを取得できませんでした。" onRetry={() => void flow.refetch()} isRetrying={flow.isFetching} />

  const { author, book } = flow.data.pages[0]
  const items = flow.data.pages.flatMap((page) => page.items)
  return <>
    <h1 className="text-3xl font-bold">栞の流れ</h1>
    <header className="space-y-2">
      <Link className="ui-action inline-flex gap-2.5 text-sm font-bold text-forest hover:underline" to={`/users/${author.id}`}>
        {author.avatarUrl ? <img className="size-8 shrink-0 rounded-full object-cover" src={author.avatarUrl} alt="" /> :
          <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full bg-mist">
            <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="7" r="4" />
              <path d="M4 21v-2a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v2" />
            </svg>
          </span>}
        {author.displayName}
      </Link>
      <BookCard book={book} titleHref={`/books/${book.id}`} compact plain />
    </header>
    {items.length === 0 && <EmptyState title="表示できる栞はまだありません" description="この本の栞が集まると、ここに投稿順で表示されます。" action={back} />}
    {items.map((bookmark) => <SocialBookmarkCard key={bookmark.id} variant="flow" bookmark={bookmark} viewerId={auth.userId}
      mode={mode} detailHref={`/bookmarks/${bookmark.id}`} />)}
    <LoadMore query={flow} />
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--app-nav-height)+env(safe-area-inset-bottom)+1rem)] z-20 mx-auto flex max-w-[740px] justify-end px-4 sm:px-6">
      <div className="pointer-events-auto">{control}</div>
    </div>
  </>
}
