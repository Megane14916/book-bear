import { useState } from 'react'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useLocation } from 'react-router'
import type { components } from '../../lib/api/generated'
import { api } from '../../lib/api/client'
import { HttpError } from '../../lib/api/errors'
import { requestData } from '../../lib/api/result'
import { BookCover } from '../../components/books/BookCover'
import { ScrollableTabs } from '../../components/ScrollableTabs'
import { EmptyState, ErrorState, LoadingState } from '../../components/states/ScreenStates'
import { useAuth } from '../../lib/auth/AuthProvider'
import { queryKeys } from '../../lib/query/keys'
import { getLibraryPage, type LibrarySelection } from './api'

type UserBook = components['schemas']['UserBook']
type ReadingStatus = UserBook['status']
type Filter = 'all' | ReadingStatus
type Sort = NonNullable<LibrarySelection['sort']>
const statuses: { value: ReadingStatus; label: string }[] = [
  { value: 'want_to_read', label: '読みたい' },
  { value: 'reading', label: '読書中' },
  { value: 'completed', label: '読了' },
]
const filters: { value: Filter; label: string }[] = [{ value: 'all', label: 'すべて' }, ...statuses]
const sorts: { value: Sort; label: string }[] = [
  { value: 'read_recent', label: '最近読んだ' },
  { value: 'read_oldest', label: '最近読んでない' },
  { value: 'added_recent', label: '登録日が新しい' },
  { value: 'added_oldest', label: '登録日が古い' },
]

export default function LibraryPage() {
  return <section aria-labelledby="library-title" className="h-full">
    <h1 id="library-title" className="sr-only">本棚</h1>
    <LibraryContents />
  </section>
}

function LibraryContents() {
  const auth = useAuth()
  const { state } = useLocation()
  const userId = auth.status === 'ready' ? auth.userId : null
  const [filter, setFilter] = useState<Filter>('all')
  const status = filter === 'all' ? undefined : filter
  const [sort, setSort] = useState<Sort>(state?.sort === 'added_recent' ? 'added_recent' : 'read_recent')
  const selection = sort === 'added_recent' && !status ? undefined : { sort, status }
  const books = useInfiniteQuery({
    queryKey: queryKeys.myBooks(userId ?? 'unavailable', 15, selection),
    enabled: userId !== null,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => getLibraryPage(pageParam, signal, selection),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  })

  if (!userId) return <div className="h-full overflow-y-auto px-5 py-4 sm:px-6">
    {auth.status === 'guest' ? <EmptyState title="本棚を見るにはログインが必要です"
      description="本の登録時に匿名アカウントを準備します。画面を開いただけではアカウントを作成しません。"
      action={<Link className="ui-action inline-flex border border-forest px-5 text-sm font-bold text-forest" to="/search">本を探す</Link>} /> :
      auth.status === 'unconfigured' || auth.status === 'error' ? <ErrorState title="本棚を開けません"
        description={auth.error?.message ?? '認証設定を確認してください。'} onRetry={() => void auth.retrySession().catch(() => {})} /> :
        <LoadingState label="ログイン状態を確認しています…" />}
  </div>

  const items = books.data?.pages.flatMap((page) => page.items) ?? []
  return <ScrollableTabs tabs={filters} value={filter} onChange={setFilter} label="絞り込み" scrollLabel="本棚の一覧"
    panelClassName="space-y-3 px-5 pt-3 pb-6 sm:px-6">
    <div className="flex justify-end">
      <label className="relative inline-flex items-center text-forest">
        <span className="sr-only">並べ替え</span>
        <svg aria-hidden="true" className="pointer-events-none absolute left-3 size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 6v12m-4-4 4 4 4-4m4 4V6m-4 4 4-4 4 4" />
        </svg>
        <select value={sort} onChange={(event) => setSort(event.target.value as Sort)}
          className="min-h-11 rounded-lg border border-[#e2e7e2] bg-white pr-3 pl-9 text-sm font-semibold focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-forest">
          {sorts.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
    </div>
    {books.isPending ? <LoadingState /> : books.isError && !books.data ?
      <ErrorState description={books.error.message} onRetry={() => void books.refetch()} isRetrying={books.isFetching} /> :
      items.length === 0 ? status ? <EmptyState title="条件に一致する本がありません" description="「すべて」を選ぶと、本棚全体を表示できます。" /> :
        <EmptyState title="本棚は空です" description="気になる本を探して、本棚に追加してみましょう。"
        action={<Link className="ui-action inline-flex bg-forest px-5 text-sm font-bold text-white" to="/search">本を探す</Link>} /> :
      <ul className="grid gap-3 sm:grid-cols-2">
        {items.map((item) => <li key={item.id} className="min-w-0"><LibraryBook item={item} userId={userId} /></li>)}
      </ul>}
    {books.isRefetchError && <ErrorState description="本棚の一覧を更新できませんでした。" onRetry={() => void books.refetch()} isRetrying={books.isFetching} />}
    {books.hasNextPage && !books.isRefetchError && <button type="button" className="ui-action w-full border border-forest text-sm font-bold text-forest"
      disabled={books.isFetching} onClick={() => void books.fetchNextPage()}>
      {books.isFetchingNextPage ? '読み込み中…' : books.isFetchNextPageError ? '再試行' : '続きを読み込む'}
    </button>}
    {books.isFetchNextPageError && <p role="alert" className="text-sm text-red-700">続きの読み込みに失敗しました。もう一度お試しください。</p>}
  </ScrollableTabs>
}

function LibraryBook({ item, userId }: { item: UserBook; userId: string }) {
  const auth = useAuth()
  const queryClient = useQueryClient()
  const [message, setMessage] = useState('')
  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.myBooks(userId) })
  const update = useMutation({
    mutationFn: (status: ReadingStatus) => auth.runAuthenticatedWrite(async ({ signal }) =>
      requestData(() => api.PATCH('/api/v1/me/books/{userBookId}', { params: { path: { userBookId: item.id } }, body: { status }, signal })),
    ),
    onSuccess: async () => { setMessage('本棚を更新しました。'); await invalidate() },
    onError: (error) => setMessage(error.message),
  })
  const remove = useMutation({
    mutationFn: () => auth.runAuthenticatedWrite(async ({ signal }) =>
      requestData(() => api.DELETE('/api/v1/me/books/{userBookId}', { params: { path: { userBookId: item.id } }, signal })),
    ),
    onSuccess: () => { setMessage('本棚から削除しました。'); void invalidate() },
    onError: (error) => {
      setMessage(error instanceof HttpError && error.status === 409
        ? 'この本には栞の記録があるため削除できません。削除済みの栞も対象です。'
        : error.message)
    },
  })
  function deleteBook() {
    if (!window.confirm(`「${item.book.title}」を本棚から削除しますか？`)) return
    setMessage('')
    remove.mutate()
  }

  const titleId = `shelf-book-${item.id}`
  return <article aria-labelledby={titleId} className="flex h-full flex-col rounded-xl border border-[#e2e7e2] bg-white p-3.5">
    <div className="flex flex-1 items-start gap-3">
      <BookCover src={item.book.coverUrl} size="small" />
      <div className="min-w-0 flex-1 py-0.5">
        <h2 id={titleId} className="line-clamp-2 text-sm leading-5 font-bold [overflow-wrap:anywhere]">
          <Link to={`/users/${userId}/books/${item.book.id}/bookmarks`}
            className="rounded-sm text-ink hover:text-forest hover:underline focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-forest">
            {item.book.title}
          </Link>
        </h2>
        <p className="mt-0.5 truncate text-xs text-[#526356]">{item.book.author ?? '著者情報なし'}</p>
        <dl className="mt-2 flex flex-wrap items-baseline gap-x-2">
          <dt className="text-xs text-[#526356]">現在のページ</dt>
          <dd className="text-sm font-bold text-forest tabular-nums">
            {item.latestBookmarkPage == null ? '未設定' : `${item.latestBookmarkPage}ページ`}
          </dd>
        </dl>
      </div>
      <button type="button" aria-label="本棚から削除" title="本棚から削除"
        className="ui-action -mt-1 -mr-1 grid size-11 shrink-0 place-items-center rounded-full p-0 text-[#65756a] hover:bg-red-50 hover:text-red-700 focus-visible:-outline-offset-2"
        disabled={remove.isPending} onClick={deleteBook}>
        <svg aria-hidden="true" className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5m4-5v5" />
        </svg>
      </button>
    </div>
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#edf0eb] pt-2.5">
      <label className="relative inline-flex items-center">
        <span className="sr-only">読書状態</span>
        <select className="min-h-11 appearance-none rounded-full border border-[#d6e0d5] bg-white py-2 pr-8 pl-3 text-xs font-semibold text-forest focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-forest"
          value={item.status} disabled={update.isPending || remove.isPending}
          onChange={(event) => { setMessage(''); update.mutate(event.target.value as ReadingStatus) }}>
          {statuses.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
        </select>
        <svg aria-hidden="true" className="pointer-events-none absolute right-2.5 size-3.5 text-forest" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="m5 8 5 5 5-5" />
        </svg>
      </label>
      <Link className="ui-action inline-flex gap-1.5 rounded-full bg-mist px-3 text-xs font-bold text-forest hover:bg-[#d8e9da]"
        to={`/create?userBookId=${encodeURIComponent(item.id)}`}>
        <svg aria-hidden="true" className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 4h12v16l-6-4-6 4z" />
        </svg>
        栞を残す
      </Link>
    </div>
    {message && <p role={update.isError || remove.isError ? 'alert' : 'status'} className="mt-2 text-sm text-[#526356]">{message}</p>}
  </article>
}
