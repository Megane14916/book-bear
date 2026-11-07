import type { ReactNode } from 'react'
import { Link } from 'react-router'
import type { components } from '../../lib/api/generated'
import { BookCover } from './BookCover'

type BookData = components['schemas']['BookSummary'] | components['schemas']['BookSearchItem']

export function BookCard({ book, titleHref, actions }: { book: BookData; titleHref?: string; actions?: ReactNode }) {
  return (
    <article aria-label={`書籍：${book.title}`} className="flex min-w-0 gap-4 rounded-2xl border border-[#e2e7e2] bg-white p-4">
      <BookCover src={book.coverUrl} />
      <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
        <h3 className="text-base leading-7 font-bold">
          {titleHref ? <Link className="ui-action inline-flex text-forest underline" to={titleHref}>{book.title}</Link> : book.title}
        </h3>
        <p className="mt-1 text-sm leading-6 text-[#526356]">{book.author ?? '著者情報なし'}</p>
        {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
      </div>
    </article>
  )
}
