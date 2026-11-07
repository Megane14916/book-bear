import { useInfiniteQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useLocation } from 'react-router'
import { BookmarkBody, type FeedContentMode } from '../../components/bookmarks/BookmarkBody'
import { LoadMore } from '../../components/states/LoadMore'
import { ErrorState, LoadingState } from '../../components/states/ScreenStates'
import { api } from '../../lib/api/client'
import type { components } from '../../lib/api/generated'
import { requestData, requireData } from '../../lib/api/result'
import { useAuth } from '../../lib/auth/AuthProvider'
import { GoogleAction } from '../../lib/auth/GoogleAction'
import { refreshBookmarkSocial, socialError, useSocialMutation } from './mutations'

type Reply = components['schemas']['Reply']
type ReplyInput = components['schemas']['CreateReplyRequest']

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
    className="space-y-3 rounded-xl border border-[#e2e7e2] bg-[#fbfcfa] p-3 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-forest sm:p-4">
    <h2 id="replies-title" className="text-base font-bold">返信</h2>
    {registered ? <NewReply bookmarkId={bookmarkId} /> : <div className="space-y-2">
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
  return <article aria-label="返信" className="min-w-0 space-y-2 py-3 [overflow-wrap:anywhere]">
    <Link className="ui-action inline-flex font-bold text-forest underline" to={`/users/${reply.author.id}`}>{reply.author.displayName}</Link>
    {editing && owner ? <ReplyForm initial={reply} label="返信を保存" pending={change.pending} error={change.error}
      onSave={(body) => change.mutate(body, { onSuccess: () => setEditing(false) })}
      onCancel={() => { change.reset(); setEditing(false) }} /> : <>
      <BookmarkBody bookmarkId={reply.id} viewerId={auth.userId} mode={mode} isSpoiler={reply.isSpoiler} content={reply.content} revealOverlay />
      {owner && <div className="flex flex-wrap gap-2">
        {confirming ? <>
          <button type="button" className="ui-action border border-red-700 px-3 text-sm text-red-700" disabled={change.pending}
            onClick={() => change.mutate(null, { onSuccess: () => setConfirming(false) })}>返信を削除する</button>
          <button type="button" className="ui-action border px-3 text-sm" disabled={change.pending}
            onClick={() => { change.reset(); setConfirming(false) }}>キャンセル</button>
        </> : <>
          <button type="button" className="ui-action border border-forest px-3 text-sm text-forest" disabled={change.pending}
            onClick={() => setEditing(true)}>返信を編集</button>
          <button type="button" className="ui-action border border-red-700 px-3 text-sm text-red-700" disabled={change.pending}
            onClick={() => setConfirming(true)}>返信を削除</button>
        </>}
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
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    const body = content.trim()
    if (!body || body.length > 1_000) { setInvalid(true); return }
    setInvalid(false)
    onSave({ content: body, isSpoiler })
  }
  return <form onSubmit={submit} className="space-y-3">
    <fieldset disabled={pending} className="space-y-2">
      <label className="block text-sm font-bold">返信本文（1,000文字以内）
        <textarea className="mt-1 w-full resize-y rounded-lg border border-[#d6e0d5] bg-white px-3 py-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-forest"
          value={content} maxLength={1_000} rows={2}
          onChange={(event) => setContent(event.target.value)} />
      </label>
      {(invalid || Boolean(error)) && <p role="alert" className="text-sm text-red-700">
        {invalid ? '返信本文は1〜1,000文字で入力してください。' : socialError(error)}</p>}
      <div className="flex flex-wrap items-center gap-x-3">
        <label className="mr-auto flex min-h-11 items-center gap-1.5 text-xs font-semibold">
          <input type="checkbox" className="accent-forest" checked={isSpoiler} onChange={(event) => setSpoiler(event.target.checked)} />返信にネタバレを含む
        </label>
        {onCancel && <button type="button" className="ui-action border px-3 text-sm" onClick={onCancel}>キャンセル</button>}
        <button className="ui-action rounded-full bg-forest px-4 text-sm font-bold text-white">{pending ? '保存中…' : label}</button>
      </div>
    </fieldset>
  </form>
}
