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
  const { mode } = useContentPreference({ enabled: valid })
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
    <header className="space-y-2 rounded-2xl border border-[#e2e7e2] bg-white p-4">
      <Link className="ui-action inline-flex text-sm font-bold text-forest underline" to={`/users/${author.id}`}>{author.displayName}</Link>
      <BookCard book={book} titleHref={`/books/${book.id}`} />
    </header>
    {items.length === 0 && <EmptyState title="表示できる栞はまだありません" description="この本の栞が集まると、ここに投稿順で表示されます。" action={back} />}
    {items.map((bookmark) => <SocialBookmarkCard key={bookmark.id} variant="flow" bookmark={bookmark} viewerId={auth.userId}
      mode={mode} detailHref={`/bookmarks/${bookmark.id}`} />)}
    <LoadMore query={flow} />
  </>
}
