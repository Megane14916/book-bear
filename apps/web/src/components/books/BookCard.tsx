import type { ReactNode } from 'react'
import { Link } from 'react-router'
import type { components } from '../../lib/api/generated'
import { BookCover } from './BookCover'

type BookData = components['schemas']['BookSummary'] | components['schemas']['BookSearchItem']

export function BookCard({ book, titleHref, actions, compact = false, pageNumber }: {
  book: BookData; titleHref?: string; actions?: ReactNode; compact?: boolean; pageNumber?: number | null
}) {
  return (
    <article aria-label={`書籍：${book.title}`} className={`flex min-w-0 border border-[#e2e7e2] ${compact ? 'items-center gap-3 rounded-xl bg-[#fbfcfa] p-2.5' : 'gap-4 rounded-2xl bg-white p-4'}`}>
      <BookCover src={book.coverUrl} size={compact ? 'tiny' : 'default'} />
      <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
        <h3 className={compact ? 'text-sm leading-5 font-bold' : 'text-base leading-7 font-bold'}>
          {titleHref ? <Link className={compact ? 'inline-flex rounded-sm text-forest hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest' : 'ui-action inline-flex text-forest underline'}
            to={titleHref}>{book.title}</Link> : book.title}
        </h3>
        <p className={compact ? 'text-xs leading-5 text-[#526356]' : 'mt-1 text-sm leading-6 text-[#526356]'}>{book.author ?? '著者情報なし'}</p>
        {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
      </div>
      {pageNumber != null && <p className="shrink-0 self-end text-base font-semibold text-forest tabular-nums">
        {pageNumber}<span className="ml-1 text-xs font-normal text-[#526356]">ページ</span>
      </p>}
    </article>
  )
}
