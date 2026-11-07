import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { ErrorState } from '../components/states/ScreenStates'
import { createManualBook } from '../features/book-search/api'
import { useBookCreation } from '../features/book-search/queries'
import { validateManualBook, type ManualErrors } from '../features/book-search/validation'
import { bookErrorMessage } from '../features/book-search/errors'

const inputClass = 'mt-2 block min-h-11 w-full min-w-0 rounded-lg border bg-white px-3 focus-visible:outline-2 focus-visible:outline-forest'
export default function ManualBookPage() {
  const [title, setTitle] = useState(''), [author, setAuthor] = useState(''), [totalPages, setTotalPages] = useState('')
  const [errors, setErrors] = useState<ManualErrors>({})
  const registration = useBookCreation(createManualBook, 'manual')
  function saveCurrent() {
    const result = validateManualBook({ title, author, totalPages })
    setErrors(result.errors ?? {})
    if (result.data) void registration.save(result.data)
  }
  function submit(event: FormEvent) { event.preventDefault(); saveCurrent() }
  return <section aria-labelledby="manual-title" className="min-w-0 space-y-6">
    <h1 id="manual-title" className="text-2xl font-bold">ISBNのない本を登録する</h1>
    <p className="text-sm leading-7 text-[#526356]">書籍情報を登録します。本棚への追加は登録後の詳細画面から進めます。</p>
    <form onSubmit={submit} noValidate className="space-y-5">
      <div><label htmlFor="manual-book-title" className="text-sm font-bold">タイトル（必須）</label>
        <input id="manual-book-title" value={title} onChange={(event) => setTitle(event.target.value)} required
          aria-invalid={Boolean(errors.title)} aria-describedby={errors.title ? 'title-error' : undefined} className={inputClass} />
        {errors.title && <p id="title-error" role="alert" className="mt-2 text-sm">{errors.title}</p>}</div>
      <div><label htmlFor="manual-book-author" className="text-sm font-bold">著者（任意）</label>
        <input id="manual-book-author" value={author} onChange={(event) => setAuthor(event.target.value)} className={inputClass} /></div>
      <div><label htmlFor="manual-book-pages" className="text-sm font-bold">総ページ数（任意）</label>
        <input id="manual-book-pages" inputMode="numeric" value={totalPages} onChange={(event) => setTotalPages(event.target.value)}
          aria-invalid={Boolean(errors.totalPages)} aria-describedby="pages-hint pages-error" className={inputClass} />
        <p id="pages-hint" className="mt-2 text-xs text-[#526356]">不明な場合は空欄にしてください。</p>
        <p id="pages-error" role={errors.totalPages ? 'alert' : undefined} className="mt-2 text-sm">{errors.totalPages}</p></div>
      <button type="submit" className="ui-action border border-forest px-5 text-forest" disabled={registration.isPending}>
        {registration.isPending ? '認証と登録を行っています…' : '書籍を登録する'}</button>
    </form>
    {registration.isError && <>
      <ErrorState title="登録できませんでした" description={bookErrorMessage(registration.error)}
        onRetry={saveCurrent} isRetrying={registration.isPending} />
      <p className="text-sm leading-7 text-[#526356]">通信が途切れた場合は、登録済みか検索で確認してから再試行してください。ISBNなしの本は重複登録される可能性があります。</p>
    </>}
    <Link className="ui-action inline-flex text-forest underline" to="/search">書籍検索へ戻る</Link>
  </section>
}
