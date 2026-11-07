import { useId, useState } from 'react'
import type { components } from '../../lib/api/generated'

export type FeedContentMode = components['schemas']['Preferences']['feedContentMode']
type Props = {
  bookmarkId: string
  viewerId: string | null
  content: string
  isSpoiler: boolean
  mode: FeedContentMode
  compact?: boolean
}

export function BookmarkBody(props: Props) {
  // A keyed inner component resets before rendering, avoiding an effect's
  // one-frame leak when a card is reused for another post or viewer.
  const identity = JSON.stringify([props.bookmarkId, props.viewerId, props.mode, props.isSpoiler, props.content, props.compact])
  return <BodySession key={identity} {...props} />
}

function BodySession({ content, isSpoiler, mode, compact = false }: Props) {
  const id = useId()
  const [expanded, setExpanded] = useState(mode === 'all' && !isSpoiler)
  const [full, setFull] = useState(false)
  const long = compact && (content.length > 120 || content.split('\n').length > 3)
  const visibleContent = long && !full ? `${content.slice(0, 120).split('\n').slice(0, 3).join('\n')}…` : content
  return (
    <div className="min-w-0">
      {isSpoiler && <p className="mb-2 text-sm font-bold text-[#805518]">ネタバレあり</p>}
      <button type="button" className="ui-action text-sm font-bold text-forest underline"
        aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded((value) => !value)}>
        {expanded ? '本文を閉じる' : isSpoiler ? 'ネタバレ本文を表示' : '本文を表示'}
      </button>
      <div id={id}>
        {expanded && <>
          <p className={`text-sm whitespace-pre-wrap [overflow-wrap:anywhere] ${compact ? 'leading-6' : 'mt-2 leading-8'}`}>{visibleContent}</p>
          {long && <button type="button" className="ui-action text-sm font-bold text-forest underline" aria-expanded={full}
            onClick={() => setFull((value) => !value)}>{full ? '短く表示' : '全文を読む'}</button>}
        </>}
      </div>
    </div>
  )
}
