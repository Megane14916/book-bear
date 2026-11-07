import { useId, useRef, useState } from 'react'
import type { components } from '../../lib/api/generated'

export type FeedContentMode = components['schemas']['Preferences']['feedContentMode']
type Props = {
  bookmarkId: string
  viewerId: string | null
  content: string
  isSpoiler: boolean
  mode: FeedContentMode
  closeBelow?: boolean
  compact?: boolean
  revealOverlay?: boolean
}

export function BookmarkBody(props: Props) {
  // A keyed inner component resets before rendering, avoiding an effect's
  // one-frame leak when a card is reused for another post or viewer.
  const identity = JSON.stringify([props.bookmarkId, props.viewerId, props.mode, props.isSpoiler, props.content, props.compact])
  return <BodySession key={identity} {...props} />
}

function BodySession({ content, isSpoiler, mode, closeBelow = false, compact = false, revealOverlay = false }: Props) {
  const id = useId()
  const body = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(mode === 'all' && !isSpoiler)
  const [full, setFull] = useState(false)
  const long = compact && (content.length > 120 || content.split('\n').length > 3)
  const visibleContent = long && !full ? `${content.slice(0, 120).split('\n').slice(0, 3).join('\n')}…` : content
  const bodySpacing = compact ? 'leading-6' : closeBelow ? 'mb-1 leading-8' : 'mt-2 leading-8'
  const revealLabel = isSpoiler ? 'ネタバレ本文を表示' : '本文を表示'
  const toggle = <button type="button" className="ui-action text-sm font-bold text-forest underline"
    aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded((value) => !value)}>
    {expanded ? '本文を閉じる' : revealLabel}
  </button>
  const previewToggle = long && (!revealOverlay || !full) && <button type="button"
    className="ui-action text-sm font-bold text-forest underline" aria-expanded={full}
    onClick={() => {
      if (revealOverlay) body.current?.focus({ preventScroll: true })
      setFull((value) => !value)
    }}>{full ? '短く表示' : '全文を読む'}</button>

  if (revealOverlay) return (
    <div id={id} ref={body} tabIndex={-1} className="my-3 rounded-xl focus:outline-none">
      {expanded ? <>
        <p className={`text-sm whitespace-pre-wrap [overflow-wrap:anywhere] ${bodySpacing}`}>{visibleContent}</p>
        {previewToggle}
      </> : <div className={`relative grid min-h-24 place-items-center rounded-xl border px-3 py-2 ${isSpoiler ? 'border-[#efe5d4] bg-[#fbf8f2]' : 'border-[#edf0eb] bg-paper'}`}>
        <div aria-hidden="true" className="absolute inset-x-4 top-1/2 -translate-y-1/2 space-y-3 blur-[2px]">
          <div className="h-1.5 w-11/12 rounded-full bg-current/15" />
          <div className="h-1.5 w-4/5 rounded-full bg-current/15" />
          <div className="h-1.5 w-3/5 rounded-full bg-current/15" />
        </div>
        <button type="button" className="ui-action relative rounded-full border border-[#d6e0d5] bg-white px-4 text-sm font-bold text-forest shadow-sm hover:bg-mist"
          onClick={() => {
            body.current?.focus({ preventScroll: true })
            setExpanded(true)
            setFull(true)
          }}>{revealLabel}</button>
      </div>}
    </div>
  )

  return (
    <div className="min-w-0">
      {isSpoiler && <p className="mb-2 text-sm font-bold text-[#805518]">ネタバレあり</p>}
      {!closeBelow && toggle}
      <div id={id}>
        {expanded && <>
          <p className={`text-sm whitespace-pre-wrap [overflow-wrap:anywhere] ${bodySpacing}`}>{visibleContent}</p>
          {previewToggle}
        </>}
      </div>
      {closeBelow && toggle}
    </div>
  )
}
