import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'
import { BookmarkCard } from '../../components/bookmarks/BookmarkCard'
import { ContentModeSwitch } from '../../components/bookmarks/ContentModeSwitch'
import type { FeedContentMode } from '../../components/bookmarks/BookmarkBody'
import { EmptyState, ErrorState, LoadingState } from '../../components/states/ScreenStates'
import { api } from '../../lib/api/client'
import { requestData } from '../../lib/api/result'
import { useAuth } from '../../lib/auth/AuthProvider'
import { queryKeys } from '../../lib/query/keys'

const storageKey = 'book-bear:guest-feed-content-mode'

function readGuestMode(): FeedContentMode {
  try { return localStorage.getItem(storageKey) === 'all' ? 'all' : 'tap' } catch { return 'tap' }
}

export function Feed() {
  const auth = useAuth()
  const queryClient = useQueryClient()
  const [guestMode, setGuestMode] = useState(readGuestMode)
  const [storageError, setStorageError] = useState(false)
  const preferenceKey = ['preferences', auth.userId] as const
  const preferences = useQuery({
    queryKey: preferenceKey,
    enabled: auth.canReadPrivate && !!auth.userId,
    queryFn: async ({ signal }) => {
      const data = await requestData(() => api.GET('/api/v1/me/preferences', { signal }))
      if (!data) throw new Error('設定の応答がありません。')
      return data
    },
  })
  const update = useMutation({
    mutationFn: (mode: FeedContentMode) => auth.runAuthenticatedWrite(async ({ signal, userId }) => {
      if (userId !== auth.userId) throw new Error('認証状態が変更されました。')
      const data = await requestData(() => api.PATCH('/api/v1/me/preferences', { signal, body: { feedContentMode: mode } }))
      if (!data) throw new Error('設定の応答がありません。')
      return data
    }),
    onSuccess: (data) => queryClient.setQueryData(preferenceKey, data),
  })
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
  const isGuest = !auth.userId && (auth.status === 'guest' || auth.status === 'unconfigured')
  const mode = isGuest ? guestMode : preferences.data?.feedContentMode ?? 'tap'
  const items = feed.data?.pages.flatMap((page) => page.items) ?? []

  function changeMode(value: FeedContentMode) {
    if (isGuest) {
      setGuestMode(value)
      try { localStorage.setItem(storageKey, value); setStorageError(false) } catch { setStorageError(true) }
    } else if (auth.canReadPrivate) {
      update.mutate(value)
    }
  }

  return <section className="mt-10" aria-labelledby="feed-title">
    <h2 id="feed-title" className="mb-4 text-xl font-bold">みんなの栞</h2>
    <div className="mb-4 rounded-2xl border border-[#e2e7e2] bg-white px-4 py-3">
      <div aria-busy={update.isPending}>
        <fieldset disabled={(!isGuest && (!auth.canReadPrivate || !preferences.data)) || update.isPending}>
          <ContentModeSwitch value={mode} onChange={changeMode} />
        </fieldset>
      </div>
      {preferences.isError && auth.canReadPrivate && <ErrorState description="表示設定を取得できませんでした。" onRetry={() => void preferences.refetch()} />}
      {update.isError && <p role="alert" className="text-sm text-red-700">表示設定を保存できませんでした。もう一度お試しください。</p>}
      {storageError && <p role="alert" className="text-sm text-red-700">端末に設定を保存できませんでした。</p>}
    </div>
    {feed.isPending ? <LoadingState /> : feed.isError && !feed.data ?
      <ErrorState description="栞を取得できませんでした。" onRetry={() => void feed.refetch()} /> :
      items.length === 0 ? <EmptyState title="栞はまだありません" description="投稿が集まると、ここに新しい栞が表示されます。"
        action={<Link className="ui-action inline-flex text-forest underline" to="/search">本を探す</Link>} /> :
      <div className="space-y-4">
        {items.map((bookmark) => <BookmarkCard key={bookmark.id} bookmark={bookmark} viewerId={auth.userId} mode={mode} />)}
        {feed.isFetchingNextPage && <LoadingState variant="more" />}
        {feed.isFetchNextPageError && <ErrorState description="続きを取得できませんでした。" onRetry={() => void feed.fetchNextPage()} />}
        {feed.hasNextPage && !feed.isFetchNextPageError && <button type="button" disabled={feed.isFetchingNextPage}
          className="ui-action w-full border border-forest text-sm font-bold text-forest" onClick={() => void feed.fetchNextPage()}>もっと見る</button>}
      </div>}
  </section>
}
