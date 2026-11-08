import { useState } from 'react'
import { useParams, Link, useNavigate, useSearchParams } from 'react-router'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { ScrollableTabs } from '../components/ScrollableTabs'
import { BookCover } from '../components/books/BookCover'
import { LoadMore } from '../components/states/LoadMore'
import { EmptyState, ErrorState, LoadingState } from '../components/states/ScreenStates'
import type { Book } from '../features/book-search/api'
import { bookOptions } from '../features/book-search/queries'
import { bookErrorMessage } from '../features/book-search/errors'
import { isUuid } from '../features/book-search/validation'
import { useContentPreference } from '../features/feed/useContentPreference'
import { AddToLibraryButton } from '../features/library/AddToLibraryButton'
import { SocialBookmarkCard } from '../features/social/SocialBookmarkCard'
import { api } from '../lib/api/client'
import { HttpError } from '../lib/api/errors'
import { requireData } from '../lib/api/result'
import { useAuth } from '../lib/auth/AuthProvider'
import { canReadPublic } from '../lib/auth/readable'
import { queryKeys } from '../lib/query/keys'

const tabs = [
  { value: 'page', label: 'ページ順' },
  { value: 'recent', label: '新着順' },
] as const
type Sort = typeof tabs[number]['value']

export default function BookDetailPage() {
  const { bookId = '' } = useParams()
  const query = useQuery({ ...bookOptions(bookId), enabled: isUuid(bookId) })
  const missing = !isUuid(bookId) || (query.error instanceof HttpError && query.error.status === 404)
  if (!missing && query.isSuccess) return <BookDetailContent key={bookId} book={query.data} />
  return <div className="px-5 py-4 sm:px-6">
    {missing ? <EmptyState title="書籍が見つかりません" description="検索から本を選び直してください。"
      action={<Link className="ui-action inline-flex text-forest underline" to="/search">本を探す</Link>} /> :
      query.isPending ? <LoadingState label="書籍情報を読み込んでいます…" /> :
      <ErrorState description={bookErrorMessage(query.error)} onRetry={() => void query.refetch()} isRetrying={query.isFetching} />}
  </div>
}

function BookDetailContent({ book }: { book: Book }) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const userId = params.get('userId')
  const auth = useAuth()
  const { mode, control } = useContentPreference({ compact: true })
  const [sort, setSort] = useState<Sort>('page')
  const feed = useInfiniteQuery({
    queryKey: queryKeys.bookBookmarks(book.id, sort, auth.userId),
    enabled: canReadPublic(auth.status),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => requireData(() => api.GET('/api/v1/books/{bookId}/bookmarks', {
      params: { path: { bookId: book.id }, query: { sort, cursor: pageParam } }, signal,
    })),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  })
  const items = feed.data?.pages.flatMap((page) => page.items) ?? []
  const createHref = `/create?bookId=${book.id}`
  const header = <header className="space-y-3 px-5 pt-2 pb-4 sm:px-6">
    <div className="flex flex-wrap items-center justify-between gap-x-3">
      <Link className="ui-action inline-flex gap-1.5 text-sm font-medium text-forest hover:underline" to="/search">
        <svg aria-hidden="true" className="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <path d="m14 6-6 6 6 6" />
        </svg>
        書籍検索へ戻る
      </Link>
      <h1 id="detail-title" className="text-xs font-bold text-[#526356]">書籍詳細</h1>
    </div>
    <div className="rounded-2xl border border-[#e2e7e2] bg-[#fbfcfa] p-4">
      <div className="flex min-w-0 items-center gap-4">
        <BookCover src={book.coverUrl} />
        <div className="min-w-0 space-y-1">
          <h2 className="text-xl leading-snug font-bold sm:text-2xl">{book.title}</h2>
          <p className="text-sm text-[#526356]">{book.author ?? '著者情報なし'}</p>
        </div>
      </div>
      <details className="group mt-3 border-t border-[#e2e7e2]">
        <summary className="ui-action flex cursor-pointer list-none justify-between gap-2 px-1 text-sm font-bold text-forest [&::-webkit-details-marker]:hidden">
          書誌情報
          <svg aria-hidden="true" className="size-4 shrink-0 group-open:rotate-180 motion-safe:transition-transform" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
        </summary>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 px-1 pb-1 text-sm">
          <dt className="font-bold">ISBN</dt><dd>{book.isbn13 ?? 'ISBNなし'}</dd>
          <dt className="font-bold">出版社</dt><dd>{book.publisher ?? '出版社情報なし'}</dd>
          <dt className="font-bold">総ページ数</dt><dd>{book.totalPages === null ? '未設定' : `${book.totalPages}ページ`}</dd>
        </dl>
      </details>
    </div>
    <div className="grid grid-cols-2 items-start gap-2.5">
      <AddToLibraryButton bookId={book.id} onAdded={() => void navigate('/library', { state: { sort: 'added_recent' } })} />
      <Link className="ui-action flex gap-2 bg-forest px-2 text-sm font-bold text-white hover:bg-forest-dark" to={createHref}>
        <svg aria-hidden="true" className="size-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 4h10v16l-5-3-5 3zM10 9h4m-2-2v4" />
        </svg>
        栞を残す
      </Link>
    </div>
    {userId && isUuid(userId) && <Link className="ui-action inline-flex text-sm text-forest underline"
      to={`/users/${userId}/books/${book.id}/bookmarks`}>このユーザーの栞の流れを見る</Link>}
  </header>

  return <section aria-labelledby="detail-title" className="relative h-full min-w-0 bg-white [overflow-wrap:anywhere]">
    <ScrollableTabs tabs={tabs} value={sort} onChange={setSort} label="栞の並べ替え" scrollLabel="書籍詳細と栞の一覧"
      panelClassName="px-5 pb-20 sm:px-6" beforeTabs={header}>
      {auth.status === 'error' ? <div className="pt-4"><ErrorState description="ログイン状態を確認できませんでした。"
        onRetry={() => void auth.retrySession().catch(() => {})} /></div> : feed.isPending ? <LoadingState /> : !feed.data ?
        <div className="pt-4"><ErrorState description="栞を取得できませんでした。" onRetry={() => void feed.refetch()} isRetrying={feed.isFetching} /></div> :
        items.length === 0 ? <div className="pt-4"><EmptyState title="公開栞はまだありません" description="この本に公開された栞がここに表示されます。" /></div> :
        <div className="divide-y divide-[#e2e7e2]">
          {items.map((bookmark) => <SocialBookmarkCard key={bookmark.id} appearance="timeline" bookmark={bookmark} viewerId={auth.userId}
            mode={mode} detailHref={`/bookmarks/${bookmark.id}`} />)}
          <LoadMore key={sort} query={feed} automatic />
        </div>}
    </ScrollableTabs>
    {items.length > 0 && <div className="absolute right-4 bottom-4 z-30 max-w-[calc(100%-2rem)] sm:right-6">{control}</div>}
  </section>
}
