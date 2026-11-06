import { z } from 'zod'
import { normalizeIsbn } from './isbn'

export const openBdBatchLimit = 100
const rowSchema = z.object({
  summary: z.object({ isbn: z.string(), title: z.string().optional(), author: z.string().optional(),
    publisher: z.string().optional(), cover: z.string().optional() }),
  onix: z.object({ CollateralDetail: z.object({ TextContent: z.array(z.unknown()).optional() }).optional() }).nullish(),
})
const descriptionSchema = z.object({ ContentType: z.union([z.string(), z.number()]), Text: z.string() })

export async function lookupOpenBd(isbns: string[], fetcher: typeof fetch = fetch) {
  const requested = [...new Set(isbns.map(normalizeIsbn).filter((id): id is string => id !== null))]
  if (requested.length > openBdBatchLimit) throw new Error('openBD batch limit exceeded')
  const records = new Map<string, { title: string | null; author: string | null; publisher: string | null; coverUrl: string | null; description: string | null }>()
  if (!requested.length) return { calls: 0, status: 'skipped' as const, records }
  const url = new URL('https://api.openbd.jp/v1/get')
  url.searchParams.set('isbn', requested.join(','))
  try {
    const response = await fetcher(url, { signal: AbortSignal.timeout(5000), redirect: 'error' })
    if (!response.ok) return { calls: 1, status: 'unavailable' as const, records }
    const values = z.array(z.unknown()).length(requested.length).safeParse(await response.json())
    if (!values.success) return { calls: 1, status: 'invalid-response' as const, records }
    for (const [index, value] of values.data.entries()) {
      const row = rowSchema.safeParse(value)
      if (!row.success) continue
      const summary = row.data.summary
      const id = requested[index]
      if (normalizeIsbn(summary.isbn) !== id) continue
      const texts = (row.data.onix?.CollateralDetail?.TextContent ?? []).flatMap((value) => {
        const parsed = descriptionSchema.safeParse(value)
        return parsed.success && parsed.data.Text.trim() ? [parsed.data] : []
      })
      const intro = texts.find((value) => Number(value.ContentType) === 3) ?? texts.find((value) => Number(value.ContentType) === 2)
      const cover = z.string().url().safeParse(summary.cover)
      const coverUrl = cover.success && /^https?:\/\//i.test(cover.data) ? cover.data : null
      records.set(id, { title: summary.title || null, author: summary.author || null,
        publisher: summary.publisher || null, coverUrl, description: intro?.Text ?? null })
    }
    return { calls: 1, status: 'ok' as const, records }
  } catch {
    return { calls: 1, status: 'unavailable' as const, records }
  }
}
