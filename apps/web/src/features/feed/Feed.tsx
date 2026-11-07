import { useInfiniteQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'
import { ScrollableTabs } from '../../components/ScrollableTabs'
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

const tabs = [
  { value: 'all', label: '新着順' },
  { value: 'following', label: 'フォロー中' },
] as const

type Scope = typeof tabs[number]['value']

export function Feed() {
  const auth = useAuth()
  const { mode, control } = useContentPreference({ compact: true })
  const [scope, setScope] = useState<Scope>('all')
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

  return <section className="relative h-full bg-white" aria-labelledby="feed-title">
    <h1 id="feed-title" className="sr-only">タイムライン</h1>
    <ScrollableTabs tabs={tabs} value={scope} onChange={setScope} label="タイムラインの表示範囲" scrollLabel="投稿一覧" panelClassName="px-5 pb-20 sm:px-6">
      {auth.status === 'error' ? <ErrorState description="ログイン状態を確認できませんでした。" onRetry={() => void auth.retrySession().catch(() => {})} /> :
        !canReadPublic(auth.status) ? <LoadingState /> : requiresRegistration ?
        <EmptyState title="フォロー中の栞を見るには登録が必要です" description="Googleでログインすると、フォローした読者の栞を表示できます。" action={<GoogleAction />} /> :
        feed.isPending ? <LoadingState /> : !feed.data ?
        <ErrorState description="栞を取得できませんでした。" onRetry={() => void feed.refetch()} isRetrying={feed.isFetching} /> :
        items.length === 0 ? <EmptyState title="栞はまだありません" description={scope === 'all' ? '投稿が集まると、ここに新しい栞が表示されます。' : 'フォローした読者が栞を公開すると、ここに表示されます。'}
          action={<Link className="ui-action inline-flex text-forest underline" to="/search">本を探す</Link>} /> :
        <div className="divide-y divide-[#e2e7e2]">
          {items.map((bookmark) => <SocialBookmarkCard key={bookmark.id} appearance="timeline" bookmark={bookmark} viewerId={auth.userId} mode={mode} detailHref={`/bookmarks/${bookmark.id}`} />)}
          <LoadMore query={feed} automatic />
        </div>}
    </ScrollableTabs>
    <div className="absolute right-4 bottom-4 z-30 max-w-[calc(100%-2rem)] sm:right-6">
      {control}
    </div>
  </section>
}
