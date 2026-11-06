import { createHash } from 'node:crypto'
import { createCiniiProvider } from '../../src/integrations/cinii'
import { lookupOpenBd } from '../../src/integrations/openbd-batch'
import type { Registered } from './experiment'
import { ciniiPermissions } from './cinii-experiment'

type Work = { title: string; author: string; tags: string[]; description?: string }

export function createCiniiMock(catalog: Work[]) {
  const rows = catalog.map((book, index) => {
    const stem = `9784000000${String(index).padStart(2, '0')}`
    const checksum = (10 - [...stem].reduce((sum, digit, i) => sum + Number(digit) * (i % 2 ? 3 : 1), 0) % 10) % 10
    const isbn = index === 6 || index === 11 ? null : stem + checksum
    const ncid = `BA${String(index + 1).padStart(8, '0')}`
    const introduction = index < 3 ? `模擬紹介文。 ${book.description ?? book.title}` : null
    return { book, isbn, ncid, introduction, json: {
      '@id': `https://cir.nii.ac.jp/crid/${String(index + 1).padStart(19, '0')}`, title: book.title,
      'dc:type': 'book', 'dc:creator': [book.author], 'dc:subject': book.tags,
      'dc:identifier': [{ '@type': 'NCID', '@value': ncid }, ...(isbn ? [{ '@type': 'ISBN', '@value': isbn }] : [])],
      'dc:source': index === 1 ? [] : [{ '@id': `https://ci.nii.ac.jp/ncid/${ncid}`, 'dc:title': 'NACSIS-CAT/ILL' }],
    } }
  })
  const ownerCounts = [15, 140, 900, 1200, 420, null, 75, 8, 150, 350, 22, 260, 50]
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input))
    if (url.hostname === 'cir.nii.ac.jp' && url.pathname.endsWith('/books')) {
      return Response.json({ 'opensearch:totalResults': rows.length, items: rows.map((row) => row.json) })
    }
    if (url.hostname === 'cir.nii.ac.jp' && url.pathname.endsWith('/holder')) {
      const index = rows.findIndex(({ ncid }) => ncid === url.searchParams.get('ncid'))
      const total = ownerCounts[index]
      return total == null ? new Response(null, { status: 503 }) : Response.json({ 'opensearch:totalResults': String(total) })
    }
    if (url.hostname === 'api.openbd.jp') {
      const requested = url.searchParams.get('isbn')?.split(',') ?? []
      return Response.json(requested.map((isbn) => {
        const row = rows.find((entry) => entry.isbn === isbn)
        if (!row || rows.indexOf(row) > 7) return null
        return { summary: { isbn, title: row.book.title, author: row.book.author },
          onix: { CollateralDetail: { TextContent: row.introduction ? [{ ContentType: '03', Text: row.introduction }] : [] } } }
      }))
    }
    throw new Error('Unexpected mock URL')
  }
  const permissions = ciniiPermissions.parse({
    [rows[0].isbn!]: { openBdDescription: { sha256: createHash('sha256').update(rows[0].introduction!).digest('hex'),
      evidence: 'CLIが生成した模擬紹介文', embedding: true, workersAi: true } },
    [rows[1].ncid]: { ownContent: { text: rows[1].book.description!, evidence: 'Book Bear独立カタログ', workersAi: true } },
  })
  const registered: Registered = async (items) => new Set(items.filter(({ title }) => title === 'こころ'))
  return { cinii: createCiniiProvider('mock', fetcher), openBd: (isbns: string[]) => lookupOpenBd(isbns, fetcher),
    permissions, registered }
}
