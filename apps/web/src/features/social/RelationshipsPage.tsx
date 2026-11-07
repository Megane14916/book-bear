import { useInfiniteQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { PageBack } from '../../components/PageBack'
import { LoadMore } from '../../components/states/LoadMore'
import { EmptyState, ErrorState, LoadingState } from '../../components/states/ScreenStates'
import { api } from '../../lib/api/client'
import { HttpError } from '../../lib/api/errors'
import { requireData } from '../../lib/api/result'
import { useAuth } from '../../lib/auth/AuthProvider'
import { canReadPublic } from '../../lib/auth/readable'
import { isUuid } from '../book-search/validation'

export default function RelationshipsPage({ kind }: { kind: 'followers' | 'following' }) {
  const { userId = '' } = useParams()
  return <section className="space-y-4">
    <PageBack fallback={isUuid(userId) ? `/users/${userId}` : '/'} />
    <Relationships userId={userId} kind={kind} />
  </section>
}

function Relationships({ userId, kind }: { userId: string; kind: 'followers' | 'following' }) {
  const auth = useAuth()
  const valid = isUuid(userId)
  const users = useInfiniteQuery({
    queryKey: ['relationships', userId, kind], enabled: valid && canReadPublic(auth.status),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => requireData(() => api.GET(kind === 'followers' ? '/api/v1/users/{userId}/followers' : '/api/v1/users/{userId}/following', {
      params: { path: { userId }, query: { limit: 15, cursor: pageParam } }, signal,
    })),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  })
  const back = <Link className="ui-action inline-flex text-forest underline" to={valid ? `/users/${userId}` : '/'}>プロフィールへ戻る</Link>
  if (!valid || (!users.isFetchNextPageError && users.error instanceof HttpError && users.error.status === 404)) return <EmptyState title="プロフィールが見つかりません"
    description="URLを確認してください。" action={back} />
  if (auth.status === 'error') return <ErrorState description="ログイン状態を確認できませんでした。" onRetry={() => void auth.retrySession().catch(() => {})} />
  if (!canReadPublic(auth.status) || users.isPending) return <LoadingState />
  if (!users.data) return <ErrorState description="読者の一覧を取得できませんでした。" onRetry={() => void users.refetch()} isRetrying={users.isFetching} />
  const items = users.data.pages.flatMap((page) => page.items)
  const title = kind === 'followers' ? 'フォロワー' : 'フォロー中'
  return <>
    <h1 className="text-3xl font-bold">{title}</h1>
    {items.length === 0 ? <EmptyState title={`${title}の読者はまだいません`} description="読者が追加されると、ここに表示されます。" action={back} /> :
      <ul className="space-y-2">{items.map((user) => <li key={user.id} className="rounded-xl border border-[#e2e7e2] bg-white px-4 py-2">
        <Link className="ui-action inline-flex items-center gap-3 font-bold text-forest underline" to={`/users/${user.id}`}>
          {user.avatarUrl && <img className="size-8 rounded-full object-cover" src={user.avatarUrl} alt="" />}
          {user.displayName}
        </Link>
      </li>)}</ul>}
    <LoadMore query={users} />
  </>
}
