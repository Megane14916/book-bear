import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { BookCard } from '../../components/books/BookCard'
import { LoadMore } from '../../components/states/LoadMore'
import { EmptyState, ErrorState, LoadingState } from '../../components/states/ScreenStates'
import { api } from '../../lib/api/client'
import { HttpError } from '../../lib/api/errors'
import { requireData } from '../../lib/api/result'
import { useAuth } from '../../lib/auth/AuthProvider'
import { GoogleAction } from '../../lib/auth/GoogleAction'
import { canReadPublic } from '../../lib/auth/readable'
import { queryKeys } from '../../lib/query/keys'
import { isUuid } from '../book-search/validation'
import { FollowControls } from '../social/FollowControls'

export default function PublicProfilePage() {
  const { userId = '' } = useParams()
  return <PublicProfile userId={userId} />
}

export function PublicProfile({ userId }: { userId: string }) {
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
  if (!valid || (profile.error instanceof HttpError && profile.error.status === 404)) return <EmptyState title="プロフィールが見つかりません"
    description="URLを確認してください。" />
  if (auth.status === 'error') return <ErrorState description={auth.error?.message ?? 'ログイン状態を確認できませんでした。'}
    onRetry={() => void auth.retrySession().catch(() => {})} />
  if (!enabled || profile.isPending) return <LoadingState />
  if (!profile.data) return <ErrorState description="プロフィールを取得できませんでした。"
    onRetry={() => void profile.refetch()} isRetrying={profile.isFetching} />

  const { displayName, handle, bio, avatarUrl, publicBookmarkCount } = profile.data
  const items = books.data?.pages.flatMap((page) => page.items) ?? []
  const owner = auth.status === 'ready' && auth.userId === userId
  const actionClass = 'ui-action inline-flex px-3 text-sm font-bold text-forest hover:bg-mist'
  return <section className="space-y-5 [overflow-wrap:anywhere]">
    <header className="space-y-3">
      <div className="flex items-center gap-3">
        {avatarUrl ? <img className="size-14 shrink-0 rounded-full object-cover" alt="" src={avatarUrl} /> :
          <span aria-hidden="true" className="grid size-14 shrink-0 place-items-center rounded-full bg-mist text-xl font-bold text-forest">{displayName.slice(0, 1)}</span>}
        <div className="min-w-0">
          <h1 className="text-3xl font-bold">{displayName}</h1>
          {handle && <p className="text-sm text-[#526356]">@{handle}</p>}
        </div>
      </div>
      {bio && <p className="whitespace-pre-wrap">{bio}</p>}
      <p className="text-sm text-[#526356]">公開栞 {publicBookmarkCount}件</p>
      <FollowControls key={`${userId}:${auth.userId}`} profile={profile.data} />
      {owner && <>
        <nav aria-label="プロフィールの操作" className="flex flex-wrap gap-x-1">
          <Link to="/me/edit" className={actionClass}>編集</Link>
          <Link to="/settings" className={actionClass}>設定</Link>
        </nav>
        <GoogleAction />
      </>}
    </header>
    <h2 className="text-xl font-bold">公開栞がある本</h2>
    {books.isPending ? <LoadingState /> : !books.data ? <ErrorState description="本の一覧を取得できませんでした。"
      onRetry={() => void books.refetch()} isRetrying={books.isFetching} /> : items.length === 0 ?
      <EmptyState title="公開栞がある本はまだありません" description="公開栞が追加されると、ここに本が表示されます。" /> :
      items.map((book) => <div key={book.id} className="rounded-2xl border border-[#e2e7e2] bg-white p-4">
        <BookCard book={book} titleHref={`/users/${userId}/books/${book.id}/bookmarks`} />
      </div>)}
    <LoadMore query={books} />
  </section>
}
