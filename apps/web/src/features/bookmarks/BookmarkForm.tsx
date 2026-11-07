import { useId, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import type { Bookmark, BookmarkInput } from './api'
import { bookmarkError, bookmarkInput, registrationMessage, validateBookmark } from './validation'

const field = 'mt-1 min-h-11 w-full rounded-lg border border-[#d6ded6] bg-white px-3 py-2 text-ink focus-visible:outline-2 focus-visible:outline-forest'

export function BookmarkForm({ initial, pending, error, canPublish, canSave = true, onSave, registrationAction, children, submitClassName = '', submitLabel = '栞を保存', defaultVisibility = 'private', autoGrow = false }: {
  initial?: Bookmark; pending: boolean; error: unknown; canPublish: boolean
  onSave: (input: BookmarkInput) => void; children?: ReactNode; registrationAction?: ReactNode; canSave?: boolean
  submitClassName?: string; submitLabel?: string
  defaultVisibility?: BookmarkInput['visibility']; autoGrow?: boolean
}) {
  const [content, setContent] = useState(initial?.content ?? '')
  const [page, setPage] = useState(initial?.pageNumber?.toString() ?? '')
  const [visibilityChoice, setVisibility] = useState<'private' | 'public' | null>(initial?.visibility ?? null)
  const visibility = visibilityChoice ?? defaultVisibility
  const [spoiler, setSpoiler] = useState(initial?.isSpoiler ?? false)
  const [validation, setValidation] = useState<string | null>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const countId = useId()
  useLayoutEffect(() => {
    const input = textarea.current
    if (!autoGrow || !input) return
    const resize = () => {
      input.style.height = 'auto'
      input.style.height = `${input.scrollHeight + input.offsetHeight - input.clientHeight}px`
    }
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [autoGrow, content])
  function submit(event: FormEvent) {
    event.preventDefault()
    if (pending || !canSave) return
    const invalid = validateBookmark(content, page) ?? (visibility === 'public' && !canPublish ? registrationMessage : null)
    setValidation(invalid)
    if (!invalid) onSave(bookmarkInput(content, page, visibility, spoiler))
  }
  return <form onSubmit={submit} noValidate className="min-w-0 space-y-5">
    <fieldset disabled={pending} className="min-w-0 space-y-5">
      <legend className="sr-only">栞の内容</legend>
      {children}
      <label className="block text-sm font-bold">本文（必須・2,000文字以内）
        <textarea ref={textarea} className={autoGrow ? `${field} resize-none overflow-hidden focus-visible:-outline-offset-2` : field} rows={autoGrow ? 3 : 7}
          value={content} onChange={(e) => setContent(e.target.value)} aria-describedby={countId} />
      </label>
      <p id={countId} className="text-xs text-[#526356]">{content.trim().length} / 2,000文字</p>
      <label className="block text-sm font-bold">ページ番号（任意）
        <input className={field} inputMode="numeric" value={page} onChange={(e) => setPage(e.target.value)} placeholder="未設定" />
      </label>
      <label className="block text-sm font-bold">公開範囲
        <select className={field} value={visibility} onChange={(e) => setVisibility(e.target.value as 'private' | 'public')}>
          <option value="private">非公開（自分だけ）</option><option value="public">公開</option>
        </select>
      </label>
      {visibility === 'public' && !canPublish && <div className="space-y-2">
        <p role="status" className="text-sm text-[#526356]">{registrationMessage}</p>
        {registrationAction}
      </div>}
      <label className="flex min-h-11 items-center gap-3 text-sm font-bold">
        <input type="checkbox" className="size-5 accent-forest" checked={spoiler} onChange={(e) => setSpoiler(e.target.checked)} />ネタバレを含む
      </label>
    </fieldset>
    {Boolean(validation || error) && <p role="alert" className="text-sm text-red-700">{validation ?? bookmarkError(error)}</p>}
    <button type="submit" className={`ui-action bg-forest px-5 font-bold text-white ${submitClassName}`}
      disabled={pending || !canSave}>{pending ? '保存中…' : submitLabel}</button>
  </form>
}
