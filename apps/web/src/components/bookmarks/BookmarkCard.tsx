import type { ReactNode } from 'react'
import { Link } from 'react-router'
import type { components } from '../../lib/api/generated'
import { BookCard } from '../books/BookCard'
import { BookmarkBody, type FeedContentMode } from './BookmarkBody'
import { HeartIcon, ReplyIcon } from './ReactionIcons'

type Props = ({ variant?: 'full'; bookmark: components['schemas']['BookmarkCard'] }
  | { variant: 'flow'; bookmark: components['schemas']['BookmarkFlowItem'] }) & {
  viewerId: string | null
  mode: FeedContentMode
  authorHref?: string
  bookHref?: string
  detailHref?: string
  likeAction?: ReactNode
  replyAction?: ReactNode
  shareAction?: ReactNode
  actions?: ReactNode
  appearance?: 'card' | 'timeline'
  inThread?: boolean
}
const dateFormat = new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })

export function BookmarkCard(props: Props) {
  const { bookmark, viewerId, mode, detailHref, actions, inThread } = props
  const date = new Date(bookmark.createdAt)
  const dateText = Number.isNaN(date.getTime()) ? '日時不明' : dateFormat.format(date)
  const timeline = props.appearance === 'timeline' && props.variant !== 'flow'
  const time = <time dateTime={Number.isNaN(date.getTime()) ? undefined : bookmark.createdAt}>{dateText}</time>
  const timestamp = detailHref && !timeline ? <Link to={detailHref} className="ui-action inline-flex underline">{time}</Link> : time
  const detailOverlay = timeline && detailHref
  const book = props.variant !== 'flow' && <BookCard book={props.bookmark.book} titleHref={props.bookHref}
    compact={timeline} pageNumber={timeline ? bookmark.pageNumber : undefined} />
  return (
    <article aria-label="栞" className={timeline
      ? 'relative min-w-0 py-4 [overflow-wrap:anywhere]'
      : 'min-w-0 rounded-2xl border border-[#e2e7e2] bg-white p-4 [overflow-wrap:anywhere] sm:p-5'}>
      {detailOverlay && <Link to={detailOverlay} aria-label={`${props.bookmark.book.title}の栞を開く`}
        className="absolute inset-0 rounded-lg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-forest" />}
      <div className={`relative ${detailOverlay ? 'pointer-events-none [&_a]:pointer-events-auto [&_button]:pointer-events-auto' : ''} ${inThread ? 'min-h-8 pl-11' : ''}`}>
        {props.variant !== 'flow' && (
          <div className={timeline ? undefined : 'mb-3'}>
            <div className={timeline ? 'flex items-center gap-2.5' : 'mb-3'}>
              {timeline && <span aria-hidden="true" className={`grid size-8 shrink-0 place-items-center rounded-full bg-mist text-xs font-bold text-forest ${inThread ? 'absolute top-0 left-0 ring-4 ring-white' : ''}`}>{props.bookmark.author.displayName.slice(0, 1)}</span>}
              <div className={timeline ? 'flex min-h-8 min-w-0 flex-1 flex-wrap items-center justify-between gap-x-3' : 'min-w-0'}>
                <p className="text-sm font-bold">
                  {props.authorHref ? <Link className={timeline ? 'inline-flex rounded-sm text-forest hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest' : 'ui-action inline-flex text-forest underline'}
                    to={props.authorHref}>{props.bookmark.author.displayName}</Link> : props.bookmark.author.displayName}
                </p>
                {timeline && <div className="flex flex-wrap items-center gap-x-2 text-xs text-[#65756a]">
                  {bookmark.visibility === 'private' && <span className="rounded-full bg-paper px-2 py-0.5">非公開</span>}
                  {timestamp}
                </div>}
              </div>
            </div>
            {!timeline && book}
          </div>
        )}
        {!timeline && <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#526356]">
          {timestamp}
          <span>{bookmark.visibility === 'public' ? '公開' : '非公開'}</span>
          {bookmark.pageNumber !== null && <span>{bookmark.pageNumber}ページ</span>}
        </div>}
        <BookmarkBody bookmarkId={bookmark.id} viewerId={viewerId} mode={mode} isSpoiler={bookmark.isSpoiler} content={bookmark.content}
          closeBelow={props.variant === 'flow'} compact={timeline && !inThread} revealOverlay={timeline} />
        {timeline && book}
        {(!inThread || bookmark.visibility === 'public') && <div className={`flex flex-wrap items-start gap-x-3 text-sm text-[#526356] tabular-nums ${timeline ? 'mt-1' : 'mt-2 border-t border-[#e2e7e2] pt-1'}`}>
          {props.likeAction ?? <span className="inline-flex min-h-11 items-center gap-1.5 px-2">
            <HeartIcon filled={bookmark.likedByMe} /><span className="sr-only">いいね </span>{bookmark.likeCount}
          </span>}
          {props.replyAction ?? <span className="inline-flex min-h-11 items-center gap-1.5 px-2">
            <ReplyIcon /><span className="sr-only">返信 </span>{bookmark.replyCount}
          </span>}
          {props.shareAction}
        </div>}
        {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
      </div>
    </article>
  )
}
