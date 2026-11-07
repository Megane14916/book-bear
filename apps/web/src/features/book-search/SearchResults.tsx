import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { LoadMore } from '../../components/states/LoadMore'
import { ErrorState, LoadingState } from '../../components/states/ScreenStates'
import { api } from '../../lib/api/client'
import { requireData } from '../../lib/api/result'
import { useAuth } from '../../lib/auth/AuthProvider'
import { canReadPublic } from '../../lib/auth/readable'
import { queryKeys } from '../../lib/query/keys'
import { SocialBookmarkCard } from '../social/SocialBookmarkCard'

export function PostResults({ q }: { q: string }) {
  const auth = useAuth()
  const enabled = !!q && canReadPublic(auth.status)
  const posts = useInfiniteQuery({
    queryKey: queryKeys.searchPosts(q, auth.userId), enabled,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => requireData(() => api.GET('/api/v1/search/posts', {
      params: { query: { q, cursor: pageParam, limit: 15 } }, signal,
    })),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  })
  if (!q) return <p className="text-sm text-[#526356]">栞の本文に含まれる言葉を入力してください。</p>
  if (auth.status === 'error') return <ErrorState description="ログイン状態を確認できませんでした。" onRetry={() => void auth.retrySession().catch(() => {})} />
  if (!enabled || posts.isPending) return <LoadingState label="栞を検索しています…" />
  if (!posts.data) return <ErrorState description="栞を検索できませんでした。" onRetry={() => void posts.refetch()} isRetrying={posts.isFetching} />
  const items = posts.data.pages.flatMap((page) => page.items)
  if (items.length === 0) return <p role="status" className="text-sm text-[#526356]">「{q}」に一致する公開栞は見つかりませんでした。</p>
  return <div className="space-y-4">
    {items.map((bookmark) => <SocialBookmarkCard key={bookmark.id} bookmark={bookmark} viewerId={auth.userId}
      mode="all" detailHref={`/bookmarks/${bookmark.id}`} />)}
    <LoadMore query={posts} />
  </div>
}

export function UserResults({ q }: { q: string }) {
  const auth = useAuth()
  const enabled = !!q && canReadPublic(auth.status)
  const users = useQuery({
    queryKey: queryKeys.searchUsers(q), enabled,
    queryFn: ({ signal }) => requireData(() => api.GET('/api/v1/search/users', { params: { query: { q, limit: 30 } }, signal })),
  })
  if (!q) return <p className="text-sm text-[#526356]">表示名またはハンドルを入力してください。</p>
  if (auth.status === 'error') return <ErrorState description="ログイン状態を確認できませんでした。" onRetry={() => void auth.retrySession().catch(() => {})} />
  if (!enabled || users.isPending) return <LoadingState label="ユーザーを検索しています…" />
  if (!users.data) return <ErrorState description="ユーザーを検索できませんでした。" onRetry={() => void users.refetch()} isRetrying={users.isFetching} />
  if (users.data.items.length === 0) return <p role="status" className="text-sm text-[#526356]">「{q}」に一致するユーザーは見つかりませんでした。</p>
  return <div className="space-y-3">
    <p role="status" className="text-sm text-[#526356]">「{q}」の検索結果：{users.data.items.length}件（最大30件）</p>
    <ul className="space-y-2">{users.data.items.map((user) => <li key={user.id} className="rounded-xl border border-[#e2e7e2] bg-white px-4 py-2">
      <Link className="ui-action inline-flex items-center gap-3 font-bold text-forest underline" to={`/users/${user.id}`}>
        {user.avatarUrl && <img className="size-8 rounded-full object-cover" src={user.avatarUrl} alt="" />}
        <span className="[overflow-wrap:anywhere]">{user.displayName}{user.handle && <small className="ml-2 font-normal">@{user.handle}</small>}</span>
      </Link>
    </li>)}</ul>
  </div>
}
