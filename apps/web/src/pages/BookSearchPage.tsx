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
  const [inputFocused, setInputFocused] = useState(false)
  const [keyboardOpen, setKeyboardOpen] = useState(false)
  const showBookActions = books && !scanning && !inputFocused && !keyboardOpen
  const queryInput = useRef<HTMLInputElement>(null)
  const results = useRef<HTMLDivElement>(null)
  const queryClient = useQueryClient()
  const auth = useAuth()
  const query = useQuery({ ...searchOptions(q), enabled: books && !!q })
  const registration = useBookCreation(importBook, `${tab.id}:${q}`)
  useEffect(() => { setInput(q); setScanning(false); setCameraError('') }, [q, tab.id])
  useEffect(() => { if (results.current) results.current.scrollTop = 0 }, [q, tab.id, scanning])
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return
    const update = () => setKeyboardOpen(window.innerHeight - viewport.height - viewport.offsetTop > 120)
    update()
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
    }
  }, [])

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
    queryInput.current?.blur()
    setScanning(false)
    setCameraError('')
    if (term !== q) setParams(searchParams(tab.id, term))
    else {
      const queryKey = books ? queryKeys.bookSearch(q) : tab.id === 'posts' ? queryKeys.searchPosts(q, auth.userId) : queryKeys.searchUsers(q)
      void queryClient.invalidateQueries({ queryKey })
    }
  }
  return (
    <section aria-labelledby="search-title" className="relative flex h-full min-h-0 min-w-0 flex-col">
      <header className="shrink-0 bg-white px-5 pt-5 sm:px-6">
      <form role="search" onSubmit={submit}>
        <label htmlFor="book-query" className="sr-only">{tab.field}</label>
        <div className="flex min-h-12 items-center gap-2 rounded-2xl border border-[#d6ded6] bg-paper px-3 focus-within:border-forest focus-within:ring-1 focus-within:ring-forest">
          <svg aria-hidden="true" className="size-5 shrink-0 text-[#718075]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
          <input ref={queryInput} id="book-query" type="search" enterKeyHint="search" value={input} onChange={(event) => setInput(event.target.value)}
            onFocus={() => setInputFocused(true)} onBlur={() => setInputFocused(false)} placeholder={tab.field}
            className="min-h-12 min-w-0 flex-1 bg-transparent text-base outline-none" />
          <button type="submit" className="ui-action shrink-0 px-1 text-sm font-bold text-forest" disabled={!input.trim() || registration.isPending}>検索する</button>
        </div>
      </form>
      <nav aria-label="検索対象" className="mt-3 grid grid-cols-3 border-b border-[#e2e7e2]">
        {tabs.map(({ id, label }) => <Link key={id} to={{ search: new URLSearchParams(searchParams(id, q)).toString() }}
          aria-current={tab.id === id ? 'page' : undefined}
          className="flex min-h-12 items-center justify-center border-b-2 border-transparent text-sm font-bold text-[#718075] focus-visible:outline-2 focus-visible:outline-forest aria-[current=page]:border-forest aria-[current=page]:text-forest">{label}</Link>)}
      </nav>
      </header>
      <div ref={results} role="region" aria-label="検索結果" tabIndex={0}
        className={`min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-y-contain px-5 pt-5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-forest sm:px-6 ${showBookActions ? 'pb-32' : 'pb-5'}`}>
      <h1 id="search-title" className="text-xl font-bold">{tab.title}</h1>
      {tab.id === 'posts' && <PostResults q={q} />}
      {tab.id === 'users' && <UserResults q={q} />}
      {books && <>
        {scanning && <IsbnCamera onFinish={finishCamera} />}
        {cameraError && <p role="alert" className="text-sm text-red-700">{cameraError} 検索欄にISBNを手入力できます。</p>}
        {registration.isPending && <p role="status">認証と書籍の取り込みを行っています…</p>}
        {registration.isError && <ErrorState title="取り込みできませんでした" description={bookErrorMessage(registration.error)}
          onRetry={() => { if (registration.variables) void registration.save(registration.variables) }} isRetrying={registration.isPending} />}
        {!q ? !scanning && <p className="text-sm text-[#526356]">書名・著者名・ISBNを入力してください。</p>
          : query.isPending ? <LoadingState label="本を検索しています…" />
          : query.isError ? <ErrorState description={bookErrorMessage(query.error, 'search')} onRetry={() => void query.refetch()} isRetrying={query.isFetching} />
          : query.data && <>
            <p role="status" className="text-sm text-[#526356]">「{q}」の検索結果：{query.data.items.length}件（最大20件）</p>
            {query.isFetching && <LoadingState variant="more" label="検索結果を更新しています…" />}
            {query.data.items.length === 0
              ? <EmptyState title="本が見つかりませんでした" description="検索語を変えるか、ISBNのない本を手動登録できます。" />
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
      </div>
      {showBookActions && <div role="group" aria-label="書籍検索の操作" className="pointer-events-none absolute right-4 bottom-4 z-10 flex flex-col items-end gap-2 sm:right-6">
        <button type="button" className="ui-action pointer-events-auto flex gap-2 rounded-full bg-forest px-4 text-sm font-bold text-white shadow-md hover:bg-forest-dark" disabled={registration.isPending}
          onClick={() => { setCameraError(''); setScanning(true) }}>
          <svg aria-hidden="true" className="size-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 7V3h4M17 3h4v4M21 17v4h-4M7 21H3v-4M7 7v10M10 7v10M14 7v10M17 7v10" /></svg>
          バーコードを読み取る
        </button>
        <Link to="/books/manual" className="ui-action pointer-events-auto inline-flex gap-2 rounded-full border border-[#d6e0d5] bg-white px-4 text-sm font-semibold text-forest shadow-md hover:bg-mist">
          <svg aria-hidden="true" className="size-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M13 4H6a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h7m6-6V8m-2 2h4M4 20h10" />
          </svg>
          ISBNのない本を手動登録
        </Link>
      </div>}
    </section>
  )
}
