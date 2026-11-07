import { useInfiniteQuery } from '@tanstack/react-query'
import { useRef, useState, type KeyboardEvent, type UIEvent } from 'react'
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

const tabs = [
  { scope: 'all', label: '新着順' },
  { scope: 'following', label: 'フォロー中' },
] as const

type Scope = typeof tabs[number]['scope']

export function Feed() {
  const auth = useAuth()
  const { mode, control } = useContentPreference({ compact: true })
  const [scope, setScope] = useState<Scope>('all')
  const [tabsHidden, setTabsHidden] = useState(false)
  const scrollArea = useRef<HTMLDivElement>(null)
  const lastScrollTop = useRef(0)
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

  function updateTabs({ currentTarget }: UIEvent<HTMLDivElement>) {
    const top = Math.max(0, currentTarget.scrollTop)
    const delta = top - lastScrollTop.current
    if (top > 0 && Math.abs(delta) < 8) return
    setTabsHidden(top > 0 && delta > 0)
    lastScrollTop.current = top
  }

  function selectScope(next: Scope) {
    setScope(next)
    setTabsHidden(false)
    lastScrollTop.current = 0
    if (scrollArea.current) scrollArea.current.scrollTop = 0
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const next = event.key === 'Home' ? 'all' : event.key === 'End' ? 'following' : scope === 'all' ? 'following' : 'all'
    selectScope(next)
    event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`#feed-tab-${next}`)?.focus()
  }

  return <section className="relative h-full bg-white" aria-labelledby="feed-title">
    <h1 id="feed-title" className="sr-only">タイムライン</h1>
    <div ref={scrollArea} role="region" aria-label="投稿一覧" tabIndex={0} onScroll={updateTabs}
      className="h-full overflow-y-auto overscroll-y-contain focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-forest">
      <div className={`sticky top-0 z-20 border-b border-[#e2e7e2] bg-white/95 px-5 py-2 backdrop-blur-sm motion-safe:transition-transform has-[:focus-visible]:translate-y-0 ${tabsHidden ? '-translate-y-full' : ''}`}>
        <div role="tablist" aria-label="タイムラインの表示範囲"
          className="mx-auto grid max-w-xs grid-cols-2 gap-1 rounded-full bg-mist/70 p-1">
          {tabs.map((tab) => <button key={tab.scope} id={`feed-tab-${tab.scope}`} type="button" role="tab"
            aria-selected={scope === tab.scope} aria-controls="feed-panel" tabIndex={scope === tab.scope ? 0 : -1}
            className="ui-action rounded-full px-3 text-sm font-semibold text-[#526356] hover:text-forest aria-selected:bg-white aria-selected:text-forest aria-selected:shadow-sm"
            onClick={() => selectScope(tab.scope)} onKeyDown={onTabKeyDown}>{tab.label}</button>)}
        </div>
      </div>
      <div id="feed-panel" role="tabpanel" aria-labelledby={`feed-tab-${scope}`} className="px-5 pb-20 sm:px-6">
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
    <div className="absolute right-4 bottom-4 z-30 max-w-[calc(100%-2rem)] sm:right-6">
      {control}
    </div>
  </section>
}
