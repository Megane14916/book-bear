import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BookCard } from '../components/books/BookCard'
import { EmptyState, ErrorState, LoadingState } from '../components/states/ScreenStates'
import { externalIdentity, importBook } from '../features/book-search/api'
import { searchOptions, useBookCreation } from '../features/book-search/queries'
import { bookErrorMessage } from '../features/book-search/errors'
import { IsbnCamera } from '../features/book-search/IsbnCamera'
import { PostResults, UserResults } from '../features/book-search/SearchResults'
import { useAuth } from '../lib/auth/AuthProvider'
import { queryKeys } from '../lib/query/keys'

const tabs = [
  { id: 'books', label: '書籍', title: '本を探す', field: '書名・著者名・ISBN' },
  { id: 'posts', label: '栞', title: '栞を探す', field: '栞の本文' },
  { id: 'users', label: 'ユーザー', title: 'ユーザーを探す', field: '表示名・ハンドル' },
] as const
type SearchTab = typeof tabs[number]['id']

function searchParams(type: SearchTab, q: string) {
  return { ...(type === 'books' ? {} : { type }), ...(q ? { q } : {}) }
}

export default function BookSearchPage() {
  const [params, setParams] = useSearchParams()
  const tab = tabs.find(({ id }) => id === params.get('type')) ?? tabs[0]
  const books = tab.id === 'books'
  const q = (params.get('q') ?? '').trim()
  const [input, setInput] = useState(q)
  const [scanning, setScanning] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const queryInput = useRef<HTMLInputElement>(null)
  const queryClient = useQueryClient()
  const auth = useAuth()
  const query = useQuery({ ...searchOptions(q), enabled: books && !!q })
  const registration = useBookCreation(importBook, `${tab.id}:${q}`)
  useEffect(() => { setInput(q); setScanning(false); setCameraError('') }, [q, tab.id])

  const finishCamera = useCallback((result?: { isbn: string } | { error: string }) => {
    setScanning(false)
    if (result && 'isbn' in result) {
      setInput(result.isbn)
      if (result.isbn === q) void queryClient.invalidateQueries({ queryKey: queryKeys.bookSearch(q) })
      else setParams(searchParams('books', result.isbn))
    } else {
      setCameraError(result?.error ?? '')
      queryInput.current?.focus()
    }
  }, [q, queryClient, setParams])

  function submit(event: FormEvent) {
    event.preventDefault()
    const term = input.trim()
    if (!term) return
    setScanning(false)
    setCameraError('')
    if (term !== q) setParams(searchParams(tab.id, term))
    else {
      const queryKey = books ? queryKeys.bookSearch(q) : tab.id === 'posts' ? queryKeys.searchPosts(q, auth.userId) : queryKeys.searchUsers(q)
      void queryClient.invalidateQueries({ queryKey })
    }
  }
  return (
    <section aria-labelledby="search-title" className="min-w-0 space-y-6">
      <h1 id="search-title" className="text-2xl font-bold">{tab.title}</h1>
      <nav aria-label="検索対象" className="flex flex-wrap gap-2">
        {tabs.map(({ id, label }) => <Link key={id} to={{ search: new URLSearchParams(searchParams(id, q)).toString() }}
          aria-current={tab.id === id ? 'page' : undefined}
          className="ui-action inline-flex border border-forest px-4 text-sm font-bold text-forest aria-[current=page]:bg-mist">{label}</Link>)}
      </nav>
      <form role="search" onSubmit={submit} className="space-y-3">
        <label htmlFor="book-query" className="block text-sm font-bold">{tab.field}</label>
        <div className="flex flex-wrap gap-3">
          <input ref={queryInput} id="book-query" type="search" value={input} onChange={(event) => setInput(event.target.value)}
            aria-describedby={books ? 'isbn-hint' : undefined} className="min-h-11 min-w-0 flex-1 rounded-lg border bg-white px-3 focus-visible:outline-2 focus-visible:outline-forest" />
          <button type="submit" className="ui-action border border-forest px-5 text-forest" disabled={!input.trim() || registration.isPending}>検索する</button>
        </div>
        {books && <p id="isbn-hint" className="text-xs leading-6 text-[#526356]">ISBNは13桁です。ハイフン・空白を含む入力にも対応しています。</p>}
      </form>
      {tab.id === 'posts' && <PostResults q={q} />}
      {tab.id === 'users' && <UserResults q={q} />}
      {books && <>
        {scanning ? <IsbnCamera onFinish={finishCamera} /> :
          <button type="button" className="ui-action border border-forest px-4 text-sm text-forest" disabled={registration.isPending}
            onClick={() => { setCameraError(''); setScanning(true) }}>ISBNバーコードを読み取る</button>}
        {cameraError && <p role="alert" className="text-sm text-red-700">{cameraError} 検索欄にISBNを手入力できます。</p>}
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
      </>}
    </section>
  )
}
