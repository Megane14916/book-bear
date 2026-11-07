import { useInfiniteQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { BookmarkCard } from '../../components/bookmarks/BookmarkCard'
import { EmptyState, ErrorState, LoadingState } from '../../components/states/ScreenStates'
import { api } from '../../lib/api/client'
import { requestData } from '../../lib/api/result'
import { useAuth } from '../../lib/auth/AuthProvider'
import { queryKeys } from '../../lib/query/keys'
import { useContentPreference } from './useContentPreference'

export function Feed() {
  const auth = useAuth()
  const { mode, control } = useContentPreference()
  const feed = useInfiniteQuery({
    queryKey: queryKeys.feed('all', auth.userId),
    enabled: auth.status !== 'loading' && auth.status !== 'signing-out',
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const data = await requestData(() => api.GET('/api/v1/feed', {
        params: { query: { scope: 'all', limit: 15, cursor: pageParam } }, signal,
      }))
      if (!data) throw new Error('フィードの応答がありません。')
      return data
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  })
  const items = feed.data?.pages.flatMap((page) => page.items) ?? []

  return <section className="mt-10" aria-labelledby="feed-title">
    <h2 id="feed-title" className="mb-4 text-xl font-bold">みんなの栞</h2>
    {control}
    {feed.isPending ? <LoadingState /> : feed.isError && !feed.data ?
      <ErrorState description="栞を取得できませんでした。" onRetry={() => void feed.refetch()} /> :
      items.length === 0 ? <EmptyState title="栞はまだありません" description="投稿が集まると、ここに新しい栞が表示されます。"
        action={<Link className="ui-action inline-flex text-forest underline" to="/search">本を探す</Link>} /> :
      <div className="space-y-4">
        {items.map((bookmark) => <BookmarkCard key={bookmark.id} bookmark={bookmark} viewerId={auth.userId} mode={mode} />)}
        {feed.isFetchingNextPage && <LoadingState variant="more" />}
        {feed.isFetchNextPageError && <ErrorState description="続きを取得できませんでした。" onRetry={() => void feed.fetchNextPage()} isRetrying={feed.isFetchingNextPage} />}
        {feed.hasNextPage && !feed.isFetchNextPageError && <button type="button" disabled={feed.isFetchingNextPage}
          className="ui-action w-full border border-forest text-sm font-bold text-forest" onClick={() => void feed.fetchNextPage()}>もっと見る</button>}
      </div>}
  </section>
}
