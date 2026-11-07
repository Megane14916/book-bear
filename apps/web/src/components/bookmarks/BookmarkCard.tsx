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
  actions?: ReactNode
}
const dateFormat = new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })

export function BookmarkCard(props: Props) {
  const { bookmark, viewerId, mode, detailHref, actions } = props
  const date = new Date(bookmark.createdAt)
  const dateText = Number.isNaN(date.getTime()) ? '日時不明' : dateFormat.format(date)
  return (
    <article aria-label="栞" className="min-w-0 rounded-2xl border border-[#e2e7e2] bg-white p-4 [overflow-wrap:anywhere] sm:p-5">
      {props.variant !== 'flow' && (
        <div className="mb-3">
          <p className="mb-3 text-sm font-bold">
            {props.authorHref ? <Link className="ui-action inline-flex text-forest underline" to={props.authorHref}>{props.bookmark.author.displayName}</Link>
              : props.bookmark.author.displayName}
          </p>
          <BookCard book={props.bookmark.book} titleHref={props.bookHref} />
        </div>
      )}
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#526356]">
        {detailHref ? <Link to={detailHref} className="ui-action inline-flex underline"><time dateTime={bookmark.createdAt}>{dateText}</time></Link>
          : <time dateTime={Number.isNaN(date.getTime()) ? undefined : bookmark.createdAt}>{dateText}</time>}
        <span>{bookmark.visibility === 'public' ? '公開' : '非公開'}</span>
        {bookmark.pageNumber !== null && <span>{bookmark.pageNumber}ページ</span>}
      </div>
      <BookmarkBody bookmarkId={bookmark.id} viewerId={viewerId} mode={mode} isSpoiler={bookmark.isSpoiler} content={bookmark.content} />
      <div className="mt-3 flex flex-wrap gap-4 border-t border-[#e2e7e2] pt-3 text-sm text-[#526356]">
        <span>いいね {bookmark.likeCount}{bookmark.likedByMe ? '（いいね済み）' : ''}</span>
        <span>返信 {bookmark.replyCount}</span>
      </div>
      {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
    </article>
  )
}
