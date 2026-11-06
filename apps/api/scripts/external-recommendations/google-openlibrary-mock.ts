import { createHash } from 'node:crypto'
import { createBookProvider } from '../../src/integrations/books'
import { convertIsbn10 } from '../../src/integrations/isbn'
import { lookupOpenLibrary } from '../../src/integrations/open-library'
import { lookupOpenBd } from '../../src/integrations/openbd-batch'
import type { CatalogBook } from './experiment'

export function createGoogleOpenLibraryMock(catalog: CatalogBook[]) {
  const rows = catalog.map((book, index) => ({ book, isbn: index === 3 ? null : convertIsbn10(`499000${String(index).padStart(3, '0')}`) }))
  const description = '証言の食い違いが手掛かりになる短編。モック用の独自文章。'
  const permitted = rows.find(({ book }) => book.id === 'yabu')?.isbn
  const permissions = permitted ? { [permitted]: { openBdDescription: {
    sha256: createHash('sha256').update(description).digest('hex'), evidence: 'Book Bearのモック文章', embedding: true as const, workersAi: true as const,
  } } } : {}
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input))
    if (url.hostname === 'www.googleapis.com') {
      const items = rows.map(({ book, isbn }) => ({ id: `mock-${book.id}`, volumeInfo: { title: book.title, authors: [book.author],
        categories: [book.kind === 'fiction' ? 'Fiction' : 'Literary Criticism'], language: 'ja',
        industryIdentifiers: isbn ? [{ type: 'ISBN_13', identifier: isbn }] : [] } }))
      const otherEdition = { id: 'mock-other-edition', volumeInfo: { ...items[0].volumeInfo, title: `${items[0].volumeInfo.title}（新装版）`,
        industryIdentifiers: [{ type: 'ISBN_13', identifier: convertIsbn10('499000999') }] } }
      return Response.json({ totalItems: items.length + 1, items: [...items, otherEdition] })
    }
    if (url.hostname === 'openlibrary.org') {
      const docs = rows.flatMap(({ book, isbn }, index) => !isbn || index % 3 === 2 ? [] : [{
        key: `/works/OL${index + 1}W`, title: book.title, author_name: [book.author], isbn: [isbn],
        readinglog_count: [0, 12, 4, 5, 1500, 80, 40, 700, 7, 800, 320, 17][index] ?? 1, ratings_count: index,
      }])
      return Response.json({ numFound: docs.length, docs })
    }
    if (url.hostname === 'api.openbd.jp') {
      const isbns = url.searchParams.get('isbn')?.split(',') ?? []
      return Response.json(isbns.map((isbn, index) => index % 3 === 2 && isbn !== permitted ? null : {
        summary: { isbn, title: rows.find((row) => row.isbn === isbn)?.book.title },
        onix: { CollateralDetail: { TextContent: [{ ContentType: '03', Text: isbn === permitted ? description : '許諾未確認の模擬紹介文' }] } },
      }))
    }
    throw new Error('Unexpected mock endpoint')
  }
  return { search: createBookProvider(fetcher, 'mock-key').searchJapanese,
    openLibrary: (isbns: string[]) => lookupOpenLibrary(isbns, undefined, fetcher), openBd: (isbns: string[]) => lookupOpenBd(isbns, fetcher), permissions }
}
