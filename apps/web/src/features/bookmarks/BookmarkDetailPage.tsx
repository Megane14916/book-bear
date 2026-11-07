import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { PageBack } from '../../components/PageBack'
import { BookCard } from '../../components/books/BookCard'
import { EmptyState, ErrorState, LoadingState } from '../../components/states/ScreenStates'
import { useAuth } from '../../lib/auth/AuthProvider'
import { GoogleAction } from '../../lib/auth/GoogleAction'
import { HttpError } from '../../lib/api/errors'
import { isUuid } from '../book-search/validation'
import { useContentPreference } from '../feed/useContentPreference'
import { BookmarkForm } from './BookmarkForm'
import { deleteBookmark, patchBookmark, type PatchBookmark } from './api'
import { useBookmark, useBookmarkWrite } from './queries'
import { bookmarkError } from './validation'
import { BookmarkThread } from './BookmarkThread'

export default function BookmarkDetailPage({ edit = false }: { edit?: boolean }) {
  const { bookmarkId = '' } = useParams()
  if (edit) return <div className="space-y-5">
    <PageBack fallback={isUuid(bookmarkId) ? `/bookmarks/${bookmarkId}` : '/'} />
    <Detail key={bookmarkId} bookmarkId={bookmarkId} edit />
  </div>
  return <section aria-labelledby="bookmark-detail-title" className="flex h-full flex-col bg-white sm:border-x sm:border-[#edf0eb]">
    <header className="flex shrink-0 items-center gap-3 border-b border-[#e2e7e2] px-3 py-1 sm:px-5">
      <PageBack fallback="/" />
      <h1 id="bookmark-detail-title" className="text-lg font-bold">栞の詳細</h1>
    </header>
    <Detail key={bookmarkId} bookmarkId={bookmarkId} edit={false} />
  </section>
}

function Detail({ bookmarkId, edit }: { bookmarkId: string; edit: boolean }) {
  const auth = useAuth()
  const navigate = useNavigate()
  const { mode } = useContentPreference({ enabled: !edit && isUuid(bookmarkId) })
  const query = useBookmark(bookmarkId)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const write = useBookmarkWrite(async (input: PatchBookmark | null, signal) => {
    if (input) return patchBookmark(bookmarkId, input, signal)
    await deleteBookmark(bookmarkId, signal)
    return null
  }, bookmarkId, (saved) => navigate(saved ? `/bookmarks/${saved.id}` : '/library', { replace: true }))
  const missing = !isUuid(bookmarkId) || (query.error instanceof HttpError && query.error.status === 404)
  if (missing) return <EmptyState title="栞が見つかりません" description="非公開・削除済みの栞は表示できません。"
    action={<Link to="/library" className="ui-action inline-flex underline">本棚へ戻る</Link>} />
  if (auth.status === 'error' || auth.status === 'unconfigured') {
    // Unconfigured guests may still read public bookmarks; configuration is
    // required only for writes. A failed restore must be retried explicitly.
    if (auth.status === 'error') return <ErrorState description={auth.error?.message ?? '認証を再確認してください。'} onRetry={() => void auth.retrySession().catch(() => {})} />
  }
  if (query.isPending || ['loading', 'preparing', 'signing-out'].includes(auth.status)) return <LoadingState />
  if (query.isError) return <ErrorState description={bookmarkError(query.error)} onRetry={() => void query.refetch()} />
  const bookmark = query.data
  const owner = auth.status === 'ready' && auth.userId === bookmark.author.id
  if (edit && !owner) return <EmptyState title="この栞は編集できません" description="編集できるのは作成した本人だけです。" action={<Link className="ui-action inline-flex underline" to={`/bookmarks/${bookmarkId}`}>栞に戻る</Link>} />
  if (edit) return <section className="min-w-0 space-y-5">
    <h1 className="text-2xl font-bold">栞を編集</h1>
    <BookCard book={bookmark.book} />
    <BookmarkForm initial={bookmark} pending={write.isPending} error={write.error} canPublish={!auth.isAnonymous}
      registrationAction={<GoogleAction />}
      onSave={(input) => void write.save(input)} />
    <Link className="ui-action inline-flex text-forest underline" to={`/bookmarks/${bookmarkId}`}>編集をやめる</Link>
  </section>
  return <BookmarkThread key={auth.userId} bookmark={bookmark} viewerId={auth.userId} mode={mode}
    actions={owner && <>
      <Link className="ui-action inline-flex px-3 text-sm font-semibold text-forest hover:bg-mist" to={`/bookmarks/${bookmarkId}/edit`}>編集</Link>
      <button className="ui-action px-3 text-sm font-semibold text-red-700 hover:bg-red-50" disabled={write.isPending} onClick={() => setConfirmDelete(true)}>削除</button>
    </>}
    feedback={((confirmDelete && owner) || write.error) && <>
      {confirmDelete && owner && <div role="group" aria-label="栞の削除確認" className="space-y-3 rounded-lg border border-red-700 bg-white p-4">
        <p>この栞を削除しますか？削除すると元に戻せません。</p>
        <button className="ui-action border border-red-700 px-4 text-red-700" disabled={write.isPending} onClick={() => void write.save(null)}>{write.isPending ? '削除中…' : '削除する'}</button>
        <button className="ui-action ml-3 border px-4" disabled={write.isPending} onClick={() => setConfirmDelete(false)}>キャンセル</button>
      </div>}
      {write.error && <p role="alert" className="text-sm text-red-700">{bookmarkError(write.error)}</p>}
    </>} />
}
