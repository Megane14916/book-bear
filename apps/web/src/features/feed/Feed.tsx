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
  const { mode, control } = useContentPreference({ compact: true })
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

  return <section className="flex min-h-0 flex-1 flex-col" aria-labelledby="feed-title">
    <h2 id="feed-title" className="sr-only">みんなの栞</h2>
    <div role="region" aria-label="投稿一覧" tabIndex={0}
      className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-forest">
    <div className="px-5 py-4 sm:px-6">
    {auth.status === 'error' ? <ErrorState description="ログイン状態を確認できませんでした。" onRetry={() => void auth.retrySession().catch(() => {})} /> :
      !canReadPublic(auth.status) ? <LoadingState /> : requiresRegistration ?
        <EmptyState title="フォロー中の栞を見るには登録が必要です" description="Googleでログインすると、フォローした読者の栞を表示できます。" action={<GoogleAction />} /> :
      feed.isPending ? <LoadingState /> : !feed.data ?
      <ErrorState description="栞を取得できませんでした。" onRetry={() => void feed.refetch()} isRetrying={feed.isFetching} /> :
      items.length === 0 ? <EmptyState title="栞はまだありません" description={scope === 'all' ? '投稿が集まると、ここに新しい栞が表示されます。' : 'フォローした読者が栞を公開すると、ここに表示されます。'}
        action={<Link className="ui-action inline-flex text-forest underline" to="/search">本を探す</Link>} /> :
      <div className="divide-y divide-[#e2e7e2]">
        {items.map((bookmark) => <SocialBookmarkCard key={bookmark.id} appearance="timeline" bookmark={bookmark} viewerId={auth.userId} mode={mode} detailHref={`/bookmarks/${bookmark.id}`} />)}
        <LoadMore query={feed} />
      </div>}
    </div>
    </div>
    <div role="group" aria-label="タイムラインの表示設定" className="flex shrink-0 justify-end gap-2 border-t border-[#e2e7e2] bg-paper px-3 py-3 sm:px-5">
      <button type="button" aria-label={`表示範囲：${scope === 'all' ? '全体' : 'フォロー中'}`}
        title={scope === 'all' ? 'フォロー中に切り替える' : '全体に切り替える'}
        className="ui-action flex shrink-0 gap-2 border border-forest bg-forest px-3 text-xs font-bold text-white shadow-sm hover:bg-forest-dark"
        onClick={() => setScope((value) => value === 'all' ? 'following' : 'all')}>
        <span aria-hidden="true" className="text-base">◎</span>
        <span>{scope === 'all' ? '全体' : 'フォロー中'}</span>
      </button>
      {control}
    </div>
  </section>
}
