import type { ReactNode } from 'react'
import { Link } from 'react-router'
import type { components } from '../../lib/api/generated'
import { BookCard } from '../books/BookCard'
import { BookmarkBody, type FeedContentMode } from './BookmarkBody'

type Props = ({ variant?: 'full'; bookmark: components['schemas']['BookmarkCard'] }
  | { variant: 'flow'; bookmark: components['schemas']['BookmarkFlowItem'] }) & {
  viewerId: string | null
  mode: FeedContentMode
  authorHref?: string
  bookHref?: string
  detailHref?: string
  likeAction?: ReactNode
  actions?: ReactNode
  appearance?: 'card' | 'timeline'
}
const dateFormat = new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })

export function BookmarkCard(props: Props) {
  const { bookmark, viewerId, mode, detailHref, actions } = props
  const date = new Date(bookmark.createdAt)
  const dateText = Number.isNaN(date.getTime()) ? '日時不明' : dateFormat.format(date)
  const timeline = props.appearance === 'timeline' && props.variant !== 'flow'
  const timestamp = detailHref ? <Link to={detailHref} className="ui-action inline-flex underline"><time dateTime={Number.isNaN(date.getTime()) ? undefined : bookmark.createdAt}>{dateText}</time></Link>
    : <time dateTime={Number.isNaN(date.getTime()) ? undefined : bookmark.createdAt}>{dateText}</time>
  return (
    <article aria-label="栞" className={timeline
      ? 'min-w-0 bg-white py-3 [overflow-wrap:anywhere] first:pt-0'
      : 'min-w-0 rounded-2xl border border-[#e2e7e2] bg-white p-4 [overflow-wrap:anywhere] sm:p-5'}>
      {props.variant !== 'flow' && (
        <div className={timeline ? 'mb-1' : 'mb-3'}>
          <div className={timeline ? 'flex items-center gap-2' : 'mb-3'}>
            {timeline && <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-full bg-mist text-xs font-bold text-forest">{props.bookmark.author.displayName.slice(0, 1)}</span>}
            <div className={timeline ? 'flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-2' : 'min-w-0'}>
            <p className="text-sm font-bold">
              {props.authorHref ? <Link className="ui-action inline-flex text-forest underline" to={props.authorHref}>{props.bookmark.author.displayName}</Link>
                : props.bookmark.author.displayName}
            </p>
            {timeline && <div className="text-xs text-[#718075]">{timestamp}</div>}
            </div>
          </div>
          <BookCard book={props.bookmark.book} titleHref={props.bookHref} compact={timeline} />
        </div>
      )}
      <div className={`${timeline ? 'mb-0' : 'mb-3'} flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#526356]`}>
        {!timeline && timestamp}
        <span>{bookmark.visibility === 'public' ? '公開' : '非公開'}</span>
        {bookmark.pageNumber !== null && <span>{bookmark.pageNumber}ページ</span>}
      </div>
      <BookmarkBody bookmarkId={bookmark.id} viewerId={viewerId} mode={mode} isSpoiler={bookmark.isSpoiler} content={bookmark.content} compact={timeline} />
      <div className={`${timeline ? 'mt-1 pt-1' : 'mt-3 pt-3'} flex flex-wrap items-center gap-4 border-t border-[#e2e7e2] text-sm text-[#526356]`}>
        {props.likeAction ?? <span>いいね {bookmark.likeCount}{bookmark.likedByMe ? '（いいね済み）' : ''}</span>}
        <span>返信 {bookmark.replyCount}</span>
      </div>
      {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
    </article>
  )
}
