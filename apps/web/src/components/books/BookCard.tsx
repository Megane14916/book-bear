import type { ReactNode } from 'react'
import { Link } from 'react-router'
import type { components } from '../../lib/api/generated'
import { BookCover } from './BookCover'

type BookData = components['schemas']['BookSummary'] | components['schemas']['BookSearchItem']

export function BookCard({ book, titleHref, actions, compact = false }: { book: BookData; titleHref?: string; actions?: ReactNode; compact?: boolean }) {
  return (
    <article aria-label={`書籍：${book.title}`} className={`flex min-w-0 border border-[#e2e7e2] bg-white ${compact ? 'gap-2 rounded-lg p-2' : 'gap-4 rounded-2xl p-4'}`}>
      <BookCover src={book.coverUrl} size={compact ? 'tiny' : 'default'} />
      <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
        <h3 className={compact ? 'text-sm leading-5 font-bold' : 'text-base leading-7 font-bold'}>
          {titleHref ? <Link className="ui-action inline-flex text-forest underline" to={titleHref}>{book.title}</Link> : book.title}
        </h3>
        <p className={compact ? 'text-xs leading-5 text-[#526356]' : 'mt-1 text-sm leading-6 text-[#526356]'}>{book.author ?? '著者情報なし'}</p>
        {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
      </div>
    </article>
  )
}
