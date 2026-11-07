import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { BookCard } from '../../components/books/BookCard'
import { LoadMore } from '../../components/states/LoadMore'
import { EmptyState, ErrorState, LoadingState } from '../../components/states/ScreenStates'
import { api } from '../../lib/api/client'
import { HttpError } from '../../lib/api/errors'
import { requireData } from '../../lib/api/result'
import { useAuth } from '../../lib/auth/AuthProvider'
import { canReadPublic } from '../../lib/auth/readable'
import { queryKeys } from '../../lib/query/keys'
import { isUuid } from '../book-search/validation'

export default function PublicProfilePage() {
  const { userId = '' } = useParams()
  const auth = useAuth()
  const valid = isUuid(userId)
  const enabled = valid && canReadPublic(auth.status)
  const profile = useQuery({
    queryKey: queryKeys.publicProfile(userId, auth.userId), enabled,
    queryFn: ({ signal }) => requireData(() => api.GET('/api/v1/users/{userId}', { params: { path: { userId } }, signal })),
  })
  const books = useInfiniteQuery({
    queryKey: queryKeys.publicBooks(userId), enabled,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => requireData(() => api.GET('/api/v1/users/{userId}/books', {
      params: { path: { userId }, query: { limit: 15, cursor: pageParam } }, signal,
    })),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  })
  const home = <Link to="/" className="ui-action inline-flex text-forest underline">ホームへ戻る</Link>
  if (!valid || (profile.error instanceof HttpError && profile.error.status === 404)) return <EmptyState title="プロフィールが見つかりません"
    description="URLを確認してください。" action={home} />
  if (auth.status === 'error') return <ErrorState description={auth.error?.message ?? 'ログイン状態を確認できませんでした。'}
    onRetry={() => void auth.retrySession().catch(() => {})} />
  if (!enabled || profile.isPending) return <LoadingState />
  if (!profile.data) return <ErrorState description="プロフィールを取得できませんでした。"
    onRetry={() => void profile.refetch()} isRetrying={profile.isFetching} />

  const { displayName, handle, bio, avatarUrl, publicBookmarkCount } = profile.data
  const items = books.data?.pages.flatMap((page) => page.items) ?? []
  return <section className="space-y-5 [overflow-wrap:anywhere]">
    <header className="space-y-2 rounded-2xl border border-[#e2e7e2] bg-white p-4">
      {avatarUrl && <img className="size-14 rounded-full object-cover" alt="" src={avatarUrl} />}
      <h1 className="text-3xl font-bold">{displayName}</h1>
      {handle && <p className="text-sm text-[#526356]">@{handle}</p>}
      {bio && <p className="whitespace-pre-wrap">{bio}</p>}
      <p className="text-sm text-[#526356]">公開栞 {publicBookmarkCount}件</p>
    </header>
    <h2 className="text-xl font-bold">公開栞がある本</h2>
    {books.isPending ? <LoadingState /> : !books.data ? <ErrorState description="本の一覧を取得できませんでした。"
      onRetry={() => void books.refetch()} isRetrying={books.isFetching} /> : items.length === 0 ?
      <EmptyState title="公開栞がある本はまだありません" description="公開栞が追加されると、ここに本が表示されます。" action={home} /> :
      items.map((book) => <div key={book.id} className="rounded-2xl border border-[#e2e7e2] bg-white p-4">
        <BookCard book={book} titleHref={`/users/${userId}/books/${book.id}/bookmarks`} />
      </div>)}
    <LoadMore query={books} />
  </section>
}
