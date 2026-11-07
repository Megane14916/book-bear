import { useEffect, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { BookCard } from '../components/books/BookCard'
import { EmptyState, ErrorState, LoadingState } from '../components/states/ScreenStates'
import { externalIdentity, importBook } from '../features/book-search/api'
import { searchOptions, useBookCreation } from '../features/book-search/queries'
import { bookErrorMessage } from '../features/book-search/errors'

export default function BookSearchPage() {
  const [params, setParams] = useSearchParams()
  const q = (params.get('q') ?? '').trim()
  const [input, setInput] = useState(q)
  const query = useQuery(searchOptions(q))
  const registration = useBookCreation(importBook, q)
  useEffect(() => { setInput(q) }, [q])
  function submit(event: FormEvent) {
    event.preventDefault()
    if (!input.trim()) return
    if (input.trim() === q) void query.refetch()
    else setParams({ q: input.trim() })
  }
  return (
    <section aria-labelledby="search-title" className="min-w-0 space-y-6">
      <h1 id="search-title" className="text-2xl font-bold">本を探す</h1>
      <form role="search" onSubmit={submit} className="space-y-3">
        <label htmlFor="book-query" className="block text-sm font-bold">書名・著者名・ISBN</label>
        <div className="flex flex-wrap gap-3">
          <input id="book-query" type="search" value={input} onChange={(event) => setInput(event.target.value)}
            aria-describedby="isbn-hint" className="min-h-11 min-w-0 flex-1 rounded-lg border bg-white px-3 focus-visible:outline-2 focus-visible:outline-forest" />
          <button type="submit" className="ui-action border border-forest px-5 text-forest" disabled={!input.trim() || registration.isPending}>検索する</button>
        </div>
        <p id="isbn-hint" className="text-xs leading-6 text-[#526356]">ISBNは13桁です。ハイフン・空白を含む入力にも対応しています。</p>
      </form>
      <p><Link to="/books/manual" className="ui-action inline-flex text-forest underline">ISBNのない本を手動登録する</Link></p>
      {registration.isPending && <p role="status">認証と書籍の取り込みを行っています…</p>}
      {registration.isError && <ErrorState title="取り込みできませんでした" description={bookErrorMessage(registration.error)}
        onRetry={() => { if (registration.variables) void registration.save(registration.variables) }} isRetrying={registration.isPending} />}
      {!q ? <p className="text-sm text-[#526356]">書名・著者名・ISBNを入力して検索してください。</p>
        : query.isPending ? <LoadingState label="本を検索しています…" />
        : query.isError ? <ErrorState description={bookErrorMessage(query.error, 'search')} onRetry={() => void query.refetch()} isRetrying={query.isFetching} />
        : query.data && <>
          <p role="status" className="text-sm text-[#526356]">「{q}」の検索結果：{query.data.items.length}件（最大20件）</p>
          {query.isFetching && <LoadingState variant="more" label="検索結果を更新しています…" />}
          {query.data.items.length === 0
            ? <EmptyState title="本が見つかりませんでした" description="検索語を変えるか、ISBNのない本を手動登録できます。"
              action={<Link className="ui-action inline-flex text-forest underline" to="/books/manual">手動登録へ</Link>} />
            : <ul className="space-y-4">{query.data.items.map((book, index) => {
              const external = externalIdentity(book)
              return <li key={book.localBookId ?? `${book.provider}:${book.providerId}:${index}`}>
                <BookCard book={book} titleHref={book.localBookId ? `/books/${book.localBookId}` : undefined}
                  actions={book.localBookId ? <Link className="ui-action inline-flex text-forest underline" to={`/books/${book.localBookId}`}>詳細を見る</Link>
                    : external ? <button type="button" className="ui-action border border-forest px-3 text-forest" disabled={registration.isPending}
                      onClick={() => void registration.save(external)}>書籍情報を取り込む</button>
                      : <p className="text-sm">取り込みに必要な識別情報がありません。検索し直してください。</p>} />
              </li>
            })}</ul>}
        </>}
    </section>
  )
}
