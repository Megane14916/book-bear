import { useState, type FormEvent } from 'react'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import type { components } from '../../lib/api/generated'
import { api } from '../../lib/api/client'
import { HttpError } from '../../lib/api/errors'
import { requestData } from '../../lib/api/result'
import { BookCard } from '../../components/books/BookCard'
import { EmptyState, ErrorState, LoadingState } from '../../components/states/ScreenStates'
import { useAuth } from '../../lib/auth/AuthProvider'
import { queryKeys } from '../../lib/query/keys'

type UserBook = components['schemas']['UserBook']
type ReadingStatus = UserBook['status']
const statuses: { value: ReadingStatus; label: string }[] = [
  { value: 'want_to_read', label: '読みたい' },
  { value: 'reading', label: '読書中' },
  { value: 'completed', label: '読了' },
]

export default function LibraryPage() {
  const auth = useAuth()
  const userId = auth.status === 'ready' ? auth.userId : null
  const books = useInfiniteQuery({
    queryKey: queryKeys.myBooks(userId ?? 'unavailable'),
    enabled: userId !== null,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const page = await requestData(() => api.GET('/api/v1/me/books', {
        params: { query: { limit: 15, ...(pageParam ? { cursor: pageParam } : {}) } }, signal,
      }))
      if (!page) throw new Error('本棚の応答がありません。')
      return page
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  })

  if (auth.status === 'loading' || auth.status === 'preparing' || auth.status === 'signing-out') {
    return <section><h1 className="mb-5 text-3xl font-bold">自分の本棚</h1><LoadingState label="ログイン状態を確認しています…" /></section>
  }
  if (auth.status === 'guest') return <section className="space-y-5">
    <h1 className="text-3xl font-bold">自分の本棚</h1>
    <EmptyState title="本棚を見るにはログインが必要です" description="本の登録時に匿名アカウントを準備します。画面を開いただけではアカウントを作成しません。"
      action={<Link className="ui-action inline-flex border border-forest px-5 text-sm font-bold text-forest" to="/search">本を探す</Link>} />
  </section>
  if (auth.status === 'unconfigured' || auth.status === 'error') return <section className="space-y-5">
    <h1 className="text-3xl font-bold">自分の本棚</h1>
    <ErrorState title="本棚を開けません" description={auth.error?.message ?? '認証設定を確認してください。'}
      onRetry={() => void auth.retrySession().catch(() => {})} />
  </section>

  const items = books.data?.pages.flatMap((page) => page.items) ?? []
  return <section className="space-y-5">
    <header className="flex items-end justify-between gap-3">
      <div><p className="mb-2 text-[11px] font-extrabold tracking-[0.16em] text-[#538063]">MY BOOKSHELF</p>
        <h1 className="text-3xl font-bold">自分の本棚</h1></div>
      <Link className="ui-action inline-flex border border-forest px-4 text-sm font-bold text-forest" to="/search">本を探す</Link>
    </header>
    {books.isPending ? <LoadingState /> : books.isError && !books.data ?
      <ErrorState description={books.error.message} onRetry={() => void books.refetch()} isRetrying={books.isFetching} /> :
      items.length === 0 ? <EmptyState title="本棚は空です" description="気になる本を探して、本棚に追加してみましょう。"
        action={<Link className="ui-action inline-flex bg-forest px-5 text-sm font-bold text-white" to="/search">本を探す</Link>} /> :
      <div className="space-y-4">{items.map((item) => <LibraryBook key={item.id} item={item} userId={userId!} />)}</div>}
    {books.hasNextPage && <button type="button" className="ui-action w-full border border-forest text-sm font-bold text-forest"
      disabled={books.isFetchingNextPage} onClick={() => void books.fetchNextPage()}>
      {books.isFetchingNextPage ? '読み込み中…' : books.isFetchNextPageError ? '再試行' : '続きを読み込む'}
    </button>}
    {books.isFetchNextPageError && <p role="alert" className="text-sm text-red-700">続きの読み込みに失敗しました。もう一度お試しください。</p>}
  </section>
}

function LibraryBook({ item, userId }: { item: UserBook; userId: string }) {
  const auth = useAuth()
  const queryClient = useQueryClient()
  const [currentPage, setCurrentPage] = useState(item.currentPage === null ? '' : String(item.currentPage))
  const [message, setMessage] = useState('')
  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.myBooks(userId) })
  const update = useMutation({
    mutationFn: (body: { status?: ReadingStatus; currentPage?: number | null }) => auth.runAuthenticatedWrite(async ({ signal }) =>
      requestData(() => api.PATCH('/api/v1/me/books/{userBookId}', { params: { path: { userBookId: item.id } }, body, signal })),
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
  function saveProgress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage('')
    if (currentPage.trim() === '') { update.mutate({ currentPage: null }); return }
    const value = Number(currentPage)
    if (!Number.isSafeInteger(value) || value < 0 || value > 2_147_483_647) {
      setMessage('現在のページは0以上の整数で入力してください。')
      return
    }
    update.mutate({ currentPage: value })
  }
  function deleteBook() {
    if (!window.confirm(`「${item.book.title}」を本棚から削除しますか？`)) return
    setMessage('')
    remove.mutate()
  }

  return <article className="space-y-3 rounded-2xl border border-[#e2e7e2] bg-white p-4">
    <BookCard book={item.book} titleHref={`/users/${userId}/books/${item.book.id}/bookmarks`} />
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block text-sm font-bold text-[#526356]">読書状態
        <select className="mt-1 min-h-11 w-full rounded-lg border border-[#d6ded6] bg-white px-3 text-ink focus-visible:outline-2 focus-visible:outline-forest"
          value={item.status} disabled={update.isPending} onChange={(event) => { setMessage(''); update.mutate({ status: event.target.value as ReadingStatus }) }}>
          {statuses.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
        </select>
      </label>
      <form onSubmit={saveProgress} className="text-sm font-bold text-[#526356]">
        <label htmlFor={`page-${item.id}`}>現在のページ（総ページ数とは別）</label>
        <div className="mt-1 flex gap-2">
          <input id={`page-${item.id}`} className="min-h-11 min-w-0 flex-1 rounded-lg border border-[#d6ded6] bg-white px-3 text-ink focus-visible:outline-2 focus-visible:outline-forest"
            type="number" min="0" max="2147483647" step="1" inputMode="numeric" placeholder="未設定" value={currentPage}
            onChange={(event) => setCurrentPage(event.target.value)} />
          <button className="ui-action border border-forest px-3 text-xs font-bold text-forest" disabled={update.isPending}>保存</button>
        </div>
      </form>
    </div>
    <div className="flex flex-wrap items-center gap-3">
      <Link className="ui-action inline-flex bg-forest px-4 text-sm font-bold text-white" to={`/create?userBookId=${encodeURIComponent(item.id)}`}>この本に栞を残す</Link>
      <button type="button" className="ui-action border border-[#a74b45] px-4 text-sm font-bold text-[#a74b45]"
        disabled={remove.isPending} onClick={deleteBook}>本棚から削除</button>
    </div>
    {message && <p role={message.includes('削除できません') || update.isError ? 'alert' : 'status'} className="text-sm text-[#526356]">{message}</p>}
  </article>
}
