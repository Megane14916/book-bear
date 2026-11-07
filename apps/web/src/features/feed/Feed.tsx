import { useInfiniteQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'
import { LoadMore } from '../../components/states/LoadMore'
import { EmptyState, ErrorState, LoadingState } from '../../components/states/ScreenStates'
import { api } from '../../lib/api/client'
import { requestData } from '../../lib/api/result'
import { useAuth } from '../../lib/auth/AuthProvider'
import { GoogleAction } from '../../lib/auth/GoogleAction'
import { canReadPublic } from '../../lib/auth/readable'
import { queryKeys } from '../../lib/query/keys'
import { useContentPreference } from './useContentPreference'
import { SocialBookmarkCard } from '../social/SocialBookmarkCard'

export function Feed() {
  const auth = useAuth()
  const { mode, control } = useContentPreference()
  const [scope, setScope] = useState<'all' | 'following'>('all')
  const requiresRegistration = scope === 'following' && !(auth.status === 'ready' && !auth.isAnonymous)
  const feed = useInfiniteQuery({
    queryKey: queryKeys.feed(scope, auth.userId),
    enabled: canReadPublic(auth.status) && !requiresRegistration,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const data = await requestData(() => api.GET('/api/v1/feed', {
        params: { query: { scope, limit: 15, cursor: pageParam } }, signal,
      }))
      if (!data) throw new Error('フィードの応答がありません。')
      return data
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  })
  const items = feed.data?.pages.flatMap((page) => page.items) ?? []

  return <section className="mt-10" aria-labelledby="feed-title">
    <h2 id="feed-title" className="mb-4 text-xl font-bold">みんなの栞</h2>
    <div role="group" aria-label="フィードの範囲" className="mb-4 flex gap-2">
      {(['all', 'following'] as const).map((value) => <button key={value} type="button" aria-pressed={scope === value}
        className="ui-action border border-forest px-4 text-sm font-bold text-forest aria-pressed:bg-mist" onClick={() => setScope(value)}>
        {value === 'all' ? '全体' : 'フォロー中'}
      </button>)}
    </div>
    {control}
    {auth.status === 'error' ? <ErrorState description="ログイン状態を確認できませんでした。" onRetry={() => void auth.retrySession().catch(() => {})} /> :
      !canReadPublic(auth.status) ? <LoadingState /> : requiresRegistration ?
        <EmptyState title="フォロー中の栞を見るには登録が必要です" description="Googleでログインすると、フォローした読者の栞を表示できます。" action={<GoogleAction />} /> :
      feed.isPending ? <LoadingState /> : !feed.data ?
      <ErrorState description="栞を取得できませんでした。" onRetry={() => void feed.refetch()} isRetrying={feed.isFetching} /> :
      items.length === 0 ? <EmptyState title="栞はまだありません" description={scope === 'all' ? '投稿が集まると、ここに新しい栞が表示されます。' : 'フォローした読者が栞を公開すると、ここに表示されます。'}
        action={<Link className="ui-action inline-flex text-forest underline" to="/search">本を探す</Link>} /> :
      <div className="space-y-4">
        {items.map((bookmark) => <SocialBookmarkCard key={bookmark.id} bookmark={bookmark} viewerId={auth.userId} mode={mode} detailHref={`/bookmarks/${bookmark.id}`} />)}
        <LoadMore query={feed} />
      </div>}
  </section>
}
