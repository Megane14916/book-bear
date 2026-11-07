import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { ScrollableTabs } from '../../components/ScrollableTabs'
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
import { useContentPreference } from '../feed/useContentPreference'
import { FollowControls } from '../social/FollowControls'
import { SocialBookmarkCard } from '../social/SocialBookmarkCard'

const tabs = [
  { value: 'posts', label: '投稿' },
  { value: 'books', label: '栞がある本' },
] as const
type ProfileTab = typeof tabs[number]['value']

export default function PublicProfilePage() {
  const { userId = '' } = useParams()
  return <PublicProfile key={userId} userId={userId} />
}

export function PublicProfile({ userId, myPage = false }: { userId: string; myPage?: boolean }) {
  const auth = useAuth()
  const [tab, setTab] = useState<ProfileTab>('posts')
  const valid = isUuid(userId)
  const enabled = valid && canReadPublic(auth.status)
  const owner = auth.status === 'ready' && auth.userId === userId
  const ownPosts = myPage && owner && auth.canReadPrivate
  const profile = useQuery({
    queryKey: queryKeys.publicProfile(userId, auth.userId), enabled,
    queryFn: ({ signal }) => requireData(() => api.GET('/api/v1/users/{userId}', { params: { path: { userId } }, signal })),
  })
  const books = useInfiniteQuery({
    queryKey: queryKeys.publicBooks(userId), enabled: enabled && tab === 'books',
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
  const actionClass = 'ui-action inline-flex gap-2 px-3 text-sm font-bold text-forest hover:bg-mist'
  const header = (
    <header className="space-y-3 px-5 pt-4 pb-3 sm:px-6">
      <div className="flex items-center gap-3">
        {avatarUrl ? <img className="size-14 shrink-0 rounded-full object-cover" alt="" src={avatarUrl} /> :
          <span aria-hidden="true" className="grid size-14 shrink-0 place-items-center rounded-full bg-mist text-xl font-bold text-forest">{displayName.slice(0, 1)}</span>}
        <div className="min-w-0">
          <h1 className="text-3xl font-bold">{displayName}</h1>
          {handle && <p className="text-sm text-[#526356]">@{handle}</p>}
          <p className="text-sm text-[#526356]">公開栞 {publicBookmarkCount}件</p>
        </div>
      </div>
      {bio && <p className="whitespace-pre-wrap">{bio}</p>}
      <FollowControls key={`${userId}:${auth.userId}`} profile={profile.data} />
      {owner && <>
        <nav aria-label="プロフィールの操作" className="flex flex-wrap gap-x-1">
          <Link to="/me/edit" className={actionClass}>
            <svg aria-hidden="true" className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="m14 6 4 4M5 19l4-.5L20 7.5a2.8 2.8 0 0 0-4-4L5.5 15Z" />
            </svg>
            編集
          </Link>
          <Link to="/settings" className={actionClass}>
            <svg aria-hidden="true" className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 6h16M4 12h16M4 18h16M8 4v4m8 2v4m-6 2v4" />
            </svg>
            設定
          </Link>
        </nav>
        <GoogleAction />
      </>}
    </header>
  )
  const bookList = <>
    <h2 className="text-xl font-bold">公開栞がある本</h2>
    {books.isPending ? <LoadingState /> : !books.data ? <ErrorState description="本の一覧を取得できませんでした。"
      onRetry={() => void books.refetch()} isRetrying={books.isFetching} /> : items.length === 0 ?
      <EmptyState title="公開栞がある本はまだありません" description="公開栞が追加されると、ここに本が表示されます。" /> :
      items.map((book) => <div key={book.id} className="rounded-2xl border border-[#e2e7e2] bg-white p-4">
        <BookCard book={book} titleHref={`/users/${userId}/books/${book.id}/bookmarks`} />
      </div>)}
    <LoadMore query={books} />
  </>
  return <section className="h-full [overflow-wrap:anywhere]">
    <ScrollableTabs tabs={tabs} value={tab} onChange={setTab}
      label={myPage ? 'マイページの表示' : 'プロフィールの表示'} scrollLabel={myPage ? 'マイページの内容' : 'プロフィールの内容'}
      beforeTabs={header} panelClassName="space-y-5 px-5 py-4 sm:px-6">
      {tab === 'posts' ? <ProfilePosts userId={userId} ownPosts={ownPosts} /> : bookList}
    </ScrollableTabs>
  </section>
}

function ProfilePosts({ userId, ownPosts }: { userId: string; ownPosts: boolean }) {
  const { userId: viewerId } = useAuth()
  const { mode } = useContentPreference()
  const posts = useInfiniteQuery({
    queryKey: ownPosts ? queryKeys.myBookmarks(userId) : queryKeys.publicBookmarks(userId, viewerId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => {
      const query = { limit: 15, cursor: pageParam }
      return requireData(() => ownPosts
        ? api.GET('/api/v1/me/bookmarks', { params: { query }, signal })
        : api.GET('/api/v1/users/{userId}/bookmarks', { params: { path: { userId }, query }, signal }))
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  })
  if (posts.isPending) return <LoadingState />
  if (!posts.data) return <ErrorState description="投稿を取得できませんでした。"
    onRetry={() => void posts.refetch()} isRetrying={posts.isFetching} />

  const items = posts.data.pages.flatMap((page) => page.items)
  if (items.length === 0) return <EmptyState title="投稿はまだありません"
    description={ownPosts ? '投稿した栞がここに表示されます。' : '公開された栞がここに表示されます。'} />
  return <div className="divide-y divide-[#e2e7e2]">
    {items.map((bookmark) => <SocialBookmarkCard key={bookmark.id} appearance="timeline" bookmark={bookmark} viewerId={viewerId}
      mode={mode} detailHref={`/bookmarks/${bookmark.id}`} />)}
    <LoadMore query={posts} />
  </div>
}
