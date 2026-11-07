import type { components } from '../../lib/api/generated'
import { BookCover } from './BookCover'

export function BookPreview({ book }: { book: components['schemas']['BookSummary'] }) {
  return <span className="flex w-16 flex-col items-center gap-1">
    <BookCover src={book.coverUrl} size="small" />
    <span className="line-clamp-2 w-full text-center text-[11px] leading-4 [overflow-wrap:anywhere]">{book.title}</span>
  </span>
}
