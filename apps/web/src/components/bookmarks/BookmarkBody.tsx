import { useId, useState } from 'react'
import type { components } from '../../lib/api/generated'

export type FeedContentMode = components['schemas']['Preferences']['feedContentMode']
type Props = {
  bookmarkId: string
  viewerId: string | null
  content: string
  isSpoiler: boolean
  mode: FeedContentMode
  closeBelow?: boolean
}

export function BookmarkBody(props: Props) {
  // A keyed inner component resets before rendering, avoiding an effect's
  // one-frame leak when a card is reused for another post or viewer.
  const identity = JSON.stringify([props.bookmarkId, props.viewerId, props.mode, props.isSpoiler, props.content])
  return <BodySession key={identity} {...props} />
}

function BodySession({ content, isSpoiler, mode, closeBelow = false }: Props) {
  const id = useId()
  const [expanded, setExpanded] = useState(mode === 'all' && !isSpoiler)
  const toggle = <button type="button" className="ui-action text-sm font-bold text-forest underline"
    aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded((value) => !value)}>
    {expanded ? '本文を閉じる' : isSpoiler ? 'ネタバレ本文を表示' : '本文を表示'}
  </button>
  return (
    <div className="min-w-0">
      {isSpoiler && <p className="mb-2 text-sm font-bold text-[#805518]">ネタバレあり</p>}
      {!closeBelow && toggle}
      <div id={id}>
        {expanded && <p className={`${closeBelow ? 'mb-1' : 'mt-2'} text-sm leading-8 whitespace-pre-wrap [overflow-wrap:anywhere]`}>{content}</p>}
      </div>
      {closeBelow && toggle}
    </div>
  )
}
