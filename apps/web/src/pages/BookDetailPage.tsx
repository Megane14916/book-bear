import { useParams, Link, useNavigate, useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { BookCard } from '../components/books/BookCard'
import { EmptyState, ErrorState, LoadingState } from '../components/states/ScreenStates'
import { bookOptions } from '../features/book-search/queries'
import { bookErrorMessage } from '../features/book-search/errors'
import { isUuid } from '../features/book-search/validation'
import { AddToLibraryButton } from '../features/library/AddToLibraryButton'
import { HttpError } from '../lib/api/errors'

export default function BookDetailPage() {
  const { bookId = '' } = useParams()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const userId = params.get('userId')
  const query = useQuery({ ...bookOptions(bookId), enabled: isUuid(bookId) })
  const missing = !isUuid(bookId) || (query.error instanceof HttpError && query.error.status === 404)
  if (missing) return <EmptyState title="書籍が見つかりません" description="検索から本を選び直してください。"
    action={<Link className="ui-action inline-flex text-forest underline" to="/search">本を探す</Link>} />
  if (query.isPending) return <LoadingState label="書籍情報を読み込んでいます…" />
  if (query.isError) return <ErrorState description={bookErrorMessage(query.error)} onRetry={() => void query.refetch()} isRetrying={query.isFetching} />
  const book = query.data
  return <section aria-labelledby="detail-title" className="min-w-0 space-y-6 [overflow-wrap:anywhere]">
    <h1 id="detail-title" className="text-2xl font-bold">書籍詳細</h1>
    <BookCard book={book} />
    <dl className="space-y-3 rounded-2xl border border-[#e2e7e2] bg-white p-5 text-sm">
      <div><dt className="font-bold">ISBN</dt><dd>{book.isbn13 ?? 'ISBNなし'}</dd></div>
      <div><dt className="font-bold">出版社</dt><dd>{book.publisher ?? '出版社情報なし'}</dd></div>
      <div><dt className="font-bold">総ページ数</dt><dd>{book.totalPages === null ? '未設定' : `${book.totalPages}ページ`}</dd></div>
    </dl>
    <AddToLibraryButton key={book.id} bookId={book.id} onAdded={() => void navigate('/library', { state: { sort: 'added_recent' } })} />
    <p className="text-xs text-[#526356]">書籍情報の登録と、自分の本棚への追加は別の操作です。</p>
    <p><Link className="ui-action inline-flex bg-forest px-4 text-white" to={`/create?bookId=${book.id}`}>この本に栞を残す</Link></p>
    {userId && isUuid(userId) && <p><Link className="ui-action inline-flex text-forest underline"
      to={`/users/${userId}/books/${book.id}/bookmarks`}>このユーザーの栞の流れを見る</Link></p>}
    <p><Link className="ui-action inline-flex text-forest underline" to="/search">書籍検索へ戻る</Link></p>
  </section>
}
