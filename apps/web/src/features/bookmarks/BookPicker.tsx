import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { BookPreview } from '../../components/books/BookPreview'
import { LoadMore } from '../../components/states/LoadMore'
import { ErrorState, LoadingState } from '../../components/states/ScreenStates'
import { useAuth } from '../../lib/auth/AuthProvider'
import { queryKeys } from '../../lib/query/keys'
import { externalIdentity, importBook, type SearchBook } from '../book-search/api'
import { bookErrorMessage } from '../book-search/errors'
import { IsbnCamera } from '../book-search/IsbnCamera'
import { searchOptions, useBookCreation } from '../book-search/queries'
import { getLibraryPage } from '../library/api'

export function usePickerLibrary(userId: string | null, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: queryKeys.myBooks(userId ?? 'unavailable'), enabled,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => getLibraryPage(pageParam, signal),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  })
}

type Library = ReturnType<typeof usePickerLibrary>
type Selection = { bookId: string } | { userBookId: string }
const toolClass = 'ui-action flex min-w-0 gap-2 rounded-xl border border-[#d6ded6] bg-white px-2 text-sm font-bold text-forest hover:bg-mist aria-pressed:bg-mist'
const bookClass = 'ui-action grid w-full min-w-0 place-items-center rounded-xl border border-[#e2e7e2] bg-white px-2 py-3 hover:bg-mist'

export function BookPicker({ library, active, onSelect }: {
  library: Library; active: boolean; onSelect: (selection: Selection) => void
}) {
  const [searchOpen, setSearchOpen] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const [input, setInput] = useState('')
  const [q, setQuery] = useState('')
  const [scanned, setScanned] = useState<string | null>(null)
  const search = useQuery({ ...searchOptions(q), enabled: active && searchOpen && !!q })
  const registration = useBookCreation(importBook, `${active}:${searchOpen}:${q}`, (book) => onSelect({ bookId: book.id }))
  useEffect(() => {
    if (!active) { setScanning(false); setScanned(null) }
  }, [active])
  const choose = useCallback((book: SearchBook) => {
    if (book.localBookId) onSelect({ bookId: book.localBookId })
    else {
      const external = externalIdentity(book)
      if (external) void registration.save(external)
    }
  }, [onSelect, registration.save])

  useEffect(() => {
    if (!active || !searchOpen || !scanned || q !== scanned || !search.data || search.isFetching || search.isError) return
    setScanned(null)
    const matches = search.data.items.filter((book) => book.isbn13 === scanned)
    const match = matches.find((book) => book.localBookId) ?? (matches.length === 1 ? matches[0] : undefined)
    if (match) choose(match)
  }, [active, searchOpen, scanned, q, search.data, search.isFetching, search.isError, choose])

  const finishCamera = useCallback((result?: { isbn: string } | { error: string }) => {
    setScanning(false)
    if (!result) return
    setSearchOpen(true)
    if ('error' in result) setCameraError(result.error)
    else {
      setInput(result.isbn)
      setQuery(result.isbn)
      setScanned(result.isbn)
    }
  }, [])

  function searchBooks(event: FormEvent) {
    event.preventDefault()
    const term = input.trim()
    if (!term) return
    setScanned(null)
    setCameraError('')
    if (term === q) void search.refetch()
    else setQuery(term)
  }

  return <section aria-label="投稿する本の選択" className="min-w-0 space-y-5">
    <div className="grid grid-cols-2 gap-3">
      <button type="button" className={toolClass} aria-pressed={searchOpen} disabled={registration.isPending}
        onClick={() => { setScanning(false); setCameraError(''); setScanned(null); setSearchOpen(!searchOpen) }}>
        <svg aria-hidden="true" className="size-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>検索
      </button>
      <button type="button" className={toolClass} aria-pressed={scanning} disabled={registration.isPending}
        onClick={() => { setSearchOpen(false); setCameraError(''); setScanned(null); setScanning(!scanning) }}>
        <svg aria-hidden="true" className="size-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 7V3h4M17 3h4v4M21 17v4h-4M7 21H3v-4M7 7v10M10 7v10M14 7v10M17 7v10" /></svg>バーコード
      </button>
    </div>

    {active && scanning && <IsbnCamera onFinish={finishCamera} />}
    {searchOpen ? <div className="space-y-4">
      {cameraError && <p role="alert" className="text-sm text-red-700">{cameraError} 検索欄にISBNを手入力できます。</p>}
      <form role="search" onSubmit={searchBooks} className="space-y-2">
        <label htmlFor="composer-book-query" className="block text-sm font-bold">書名・著者名・ISBN</label>
        <div className="flex gap-2">
          <input id="composer-book-query" type="search" value={input} onChange={(event) => setInput(event.target.value)}
            className="min-h-11 min-w-0 flex-1 rounded-lg border bg-white px-3 focus-visible:outline-2 focus-visible:outline-forest" />
          <button className="ui-action shrink-0 bg-forest px-4 text-sm font-bold text-white" disabled={!input.trim() || registration.isPending}>検索する</button>
        </div>
      </form>
      {registration.isPending && <p role="status" className="text-sm">書籍情報を取り込んでいます…</p>}
      {registration.isError && <ErrorState title="取り込みできませんでした" description={bookErrorMessage(registration.error)}
        onRetry={() => { if (registration.variables) void registration.save(registration.variables) }} />}
      {q && (search.isPending ? <LoadingState label="本を検索しています…" /> : search.isError ?
        <ErrorState description={bookErrorMessage(search.error, 'search')} onRetry={() => void search.refetch()} isRetrying={search.isFetching} /> :
        search.data.items.length === 0 ? <p role="status" className="text-sm text-[#526356]">本が見つかりませんでした。検索語を変えてください。</p> :
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5" aria-label="書籍検索結果">
          {search.data.items.map((book, index) => <li key={book.localBookId ?? `${book.provider}:${book.providerId}:${index}`}>
            <button type="button" aria-label={`投稿する本：${book.title}`} className={bookClass}
              disabled={registration.isPending || (!book.localBookId && !externalIdentity(book))} onClick={() => choose(book)}>
              <BookPreview book={book} />
            </button>
          </li>)}
        </ul>)}
    </div> : !scanning && <ShelfPicker library={library} active={active} onSelect={onSelect} />}
  </section>
}

function ShelfPicker({ library, active, onSelect }: { library: Library; active: boolean; onSelect: (selection: Selection) => void }) {
  const auth = useAuth()
  const end = useRef<HTMLDivElement>(null)
  const { hasNextPage, isFetching, isFetchNextPageError, fetchNextPage } = library
  useEffect(() => {
    const target = end.current
    if (!active || !target || !hasNextPage || isFetching || isFetchNextPageError || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) void fetchNextPage({ cancelRefetch: false })
    }, { rootMargin: '0px 0px 160px' })
    observer.observe(target)
    return () => observer.disconnect()
  }, [active, hasNextPage, isFetching, isFetchNextPageError, fetchNextPage])

  const items = library.data?.pages.flatMap((page) => page.items) ?? []
  return <section className="space-y-3" aria-labelledby="composer-shelf-title">
    <h2 id="composer-shelf-title" className="text-lg font-bold">本棚</h2>
    {auth.status === 'error' ? <ErrorState description="ログイン状態を確認できませんでした。" onRetry={() => void auth.retrySession().catch(() => {})} /> :
      ['loading', 'preparing', 'signing-out'].includes(auth.status) || (auth.canReadPrivate && library.isPending) ? <LoadingState /> :
      library.isError && !library.data ? <ErrorState description="本棚を取得できませんでした。" onRetry={() => void library.refetch()} isRetrying={isFetching} /> :
      items.length ? <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {items.map((item) => <li key={item.id}>
          <button type="button" aria-label={`投稿する本：${item.book.title}`} className={bookClass} onClick={() => onSelect({ userBookId: item.id })}>
            <BookPreview book={item.book} />
          </button>
        </li>)}
      </ul> : !hasNextPage && <p className="text-sm text-[#526356]">本棚に本がありません。検索から本を選べます。</p>}
    {auth.canReadPrivate && <>
      <div ref={end} aria-hidden="true" className="h-px" />
      <LoadMore query={library} />
    </>}
  </section>
}
