import { useInfiniteQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useLocation } from 'react-router'
import { BookmarkBody, type FeedContentMode } from '../../components/bookmarks/BookmarkBody'
import { LoadMore } from '../../components/states/LoadMore'
import { ErrorState, LoadingState } from '../../components/states/ScreenStates'
import { useAutoGrowTextarea } from '../../components/useAutoGrowTextarea'
import { api } from '../../lib/api/client'
import type { components } from '../../lib/api/generated'
import { requestData, requireData } from '../../lib/api/result'
import { useAuth } from '../../lib/auth/AuthProvider'
import { GoogleAction } from '../../lib/auth/GoogleAction'
import { refreshBookmarkSocial, socialError, useSocialMutation } from './mutations'

type Reply = components['schemas']['Reply']
type ReplyInput = components['schemas']['CreateReplyRequest']
const replyDate = new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })

export function Replies({ bookmarkId, mode }: { bookmarkId: string; mode: FeedContentMode }) {
  const auth = useAuth()
  const { hash, key } = useLocation()
  const section = useRef<HTMLElement>(null)
  useEffect(() => { if (hash === '#replies') section.current?.focus() }, [hash, key])
  const registered = auth.status === 'ready' && !auth.isAnonymous
  const replies = useInfiniteQuery({
    queryKey: ['replies', bookmarkId, auth.userId],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => requireData(() => api.GET('/api/v1/bookmarks/{bookmarkId}/replies', {
      params: { path: { bookmarkId }, query: { cursor: pageParam, limit: 15 } }, signal,
    })),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  })
  const items = replies.data?.pages.flatMap((page) => page.items) ?? []

  return <section ref={section} id="replies" tabIndex={-1} aria-labelledby="replies-title"
    className="mt-5 space-y-4 border-t border-[#e2e7e2] pt-4 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-forest">
    <h2 id="replies-title" className="text-lg font-bold">返信</h2>
    {registered ? <NewReply bookmarkId={bookmarkId} /> : <div className="space-y-2 rounded-xl bg-paper p-4">
      <p className="text-sm text-[#526356]">返信するにはGoogleでの登録とログインが必要です。</p>
      <GoogleAction />
    </div>}
    {replies.isPending ? <LoadingState /> : !replies.data ? <ErrorState description="返信を取得できませんでした。"
      onRetry={() => void replies.refetch()} isRetrying={replies.isFetching} /> : <>
      {items.length === 0 ? <p className="border-t border-[#e2e7e2] pt-3 text-sm text-[#526356]">返信はまだありません。</p> :
        <div className="divide-y divide-[#e2e7e2] border-t border-[#e2e7e2]">
          {items.map((reply) => <ReplyItem key={reply.id} reply={reply} bookmarkId={bookmarkId} mode={mode} />)}
        </div>}
      <LoadMore query={replies} />
    </>}
  </section>
}

function NewReply({ bookmarkId }: { bookmarkId: string }) {
  const [formKey, setFormKey] = useState(0)
  const add = useSocialMutation(['create-reply', bookmarkId], (body: ReplyInput, signal) =>
    requireData(() => api.POST('/api/v1/bookmarks/{bookmarkId}/replies', { params: { path: { bookmarkId } }, body, signal })),
  (client) => refreshBookmarkSocial(client, bookmarkId))
  return <ReplyForm key={formKey} label="返信を投稿" pending={add.pending} error={add.error}
    onSave={(body) => add.mutate(body, { onSuccess: () => setFormKey((key) => key + 1) })} />
}

function ReplyItem({ reply, bookmarkId, mode }: { reply: Reply; bookmarkId: string; mode: FeedContentMode }) {
  const auth = useAuth()
  const owner = auth.status === 'ready' && !auth.isAnonymous && auth.userId === reply.author.id
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const change = useSocialMutation(['reply', reply.id], (body: ReplyInput | null, signal) => {
    const params = { path: { replyId: reply.id } }
    return body ? requireData(() => api.PATCH('/api/v1/replies/{replyId}', { params, body, signal })) :
      requestData(() => api.DELETE('/api/v1/replies/{replyId}', { params, signal }))
  }, (client) => refreshBookmarkSocial(client, bookmarkId))
  const createdAt = new Date(reply.createdAt)
  return <article aria-label="返信" className="min-w-0 py-3 [overflow-wrap:anywhere]">
    <header className="flex min-h-11 items-center gap-2.5">
      <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full bg-mist text-xs font-bold text-forest">{reply.author.displayName.slice(0, 1)}</span>
      <div className="min-w-0 flex-1">
        <Link className="rounded-sm text-sm font-bold text-forest hover:underline focus-visible:outline-2 focus-visible:outline-forest"
          to={`/users/${reply.author.id}`}>{reply.author.displayName}</Link>
        {!Number.isNaN(createdAt.getTime()) && <time dateTime={reply.createdAt} className="block text-xs text-[#65756a]">{replyDate.format(createdAt)}</time>}
      </div>
      {owner && !editing && !confirming && <div className="flex shrink-0">
        <button type="button" aria-label="返信を編集" title="返信を編集"
          className="ui-action grid size-11 place-items-center rounded-full p-0 text-forest hover:bg-mist focus-visible:-outline-offset-2"
          disabled={change.pending} onClick={() => setEditing(true)}>
          <svg aria-hidden="true" className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="m14 6 4 4M5 19l4-.5L20 7.5a2.8 2.8 0 0 0-4-4L5.5 15Z" />
          </svg>
        </button>
        <button type="button" aria-label="返信を削除" title="返信を削除"
          className="ui-action grid size-11 place-items-center rounded-full p-0 text-[#65756a] hover:bg-red-50 hover:text-red-700 focus-visible:-outline-offset-2"
          disabled={change.pending} onClick={() => setConfirming(true)}>
          <svg aria-hidden="true" className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5m4-5v5" />
          </svg>
        </button>
      </div>}
    </header>
    {editing && owner ? <ReplyForm initial={reply} label="返信を保存" pending={change.pending} error={change.error}
      onSave={(body) => change.mutate(body, { onSuccess: () => setEditing(false) })}
      onCancel={() => { change.reset(); setEditing(false) }} /> : <>
      <BookmarkBody bookmarkId={reply.id} viewerId={auth.userId} mode={mode} isSpoiler={reply.isSpoiler} content={reply.content} revealOverlay />
      {owner && confirming && <div role="group" aria-label="返信の削除確認" className="space-y-2 rounded-xl bg-red-50 p-3">
        <p className="text-sm font-semibold text-red-800">この返信を削除しますか？</p>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="ui-action rounded-full px-3 text-sm hover:bg-white" disabled={change.pending}
            onClick={() => { change.reset(); setConfirming(false) }}>キャンセル</button>
          <button type="button" className="ui-action rounded-full bg-red-700 px-3 text-sm font-bold text-white" disabled={change.pending}
            onClick={() => change.mutate(null, { onSuccess: () => setConfirming(false) })}>返信を削除する</button>
        </div>
      </div>}
      {change.isError && <p role="alert" className="text-sm text-red-700">{socialError(change.error)}</p>}
    </>}
  </article>
}

function ReplyForm({ initial, label, pending, error, onSave, onCancel }: {
  initial?: Reply; label: string; pending: boolean; error: unknown; onSave: (body: ReplyInput) => void; onCancel?: () => void
}) {
  const [content, setContent] = useState(initial?.content ?? '')
  const [isSpoiler, setSpoiler] = useState(initial?.isSpoiler ?? false)
  const [invalid, setInvalid] = useState(false)
  const textarea = useAutoGrowTextarea(content)
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    const body = content.trim()
    if (!body || body.length > 1_000) { setInvalid(true); return }
    setInvalid(false)
    onSave({ content: body, isSpoiler })
  }
  return <form onSubmit={submit} className="mt-2">
    <fieldset disabled={pending} className="min-w-0 space-y-2">
      <label className="block">
        <span className="sr-only">返信本文（1,000文字以内）</span>
        <textarea ref={textarea} className="block min-h-11 w-full resize-none overflow-hidden rounded-lg border border-[#d6e0d5] bg-white px-3 py-2 text-base focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-forest"
          value={content} placeholder="返信を書く" maxLength={1_000} rows={1}
          onChange={(event) => setContent(event.target.value)} />
      </label>
      {(invalid || Boolean(error)) && <p role="alert" className="text-sm text-red-700">
        {invalid ? '返信本文は1〜1,000文字で入力してください。' : socialError(error)}</p>}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <label className="mr-auto flex min-h-11 items-center gap-1.5 text-xs font-semibold">
          <input type="checkbox" className="accent-forest" checked={isSpoiler} onChange={(event) => setSpoiler(event.target.checked)} />返信にネタバレを含む
        </label>
        {onCancel && <button type="button" className="ui-action rounded-full px-3 text-sm hover:bg-white" onClick={onCancel}>キャンセル</button>}
        <button className="ui-action rounded-full bg-forest px-4 text-sm font-bold text-white hover:bg-forest-dark">{pending ? '保存中…' : label}</button>
      </div>
    </fieldset>
  </form>
}
