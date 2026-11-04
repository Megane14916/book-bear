import { Client } from 'pg'
import { ensure, type CloudConfig } from './config'

export type ObservedBook = { id: string; title: string; isbn13: string | null; created_by_user_id: string | null }
export type ObservedShelf = { id: string; user_id: string; book_id: string; status: string; current_page: number | null }
export interface Observer {
  book(id: string): Promise<ObservedBook | undefined>
  shelf(id: string): Promise<ObservedShelf | undefined>
  recover(title: string, userId: string): Promise<{ books: ObservedBook[]; shelves: ObservedShelf[] }>
  close(): Promise<void>
}

// Construct pg options explicitly: connection-string SSL options must not
// replace the verified CA/rejectUnauthorized settings.
export async function openObserver(config: CloudConfig): Promise<Observer> {
  const { ca, ...connection } = config.database
  const client = new Client({ ...connection, ssl: { ca, rejectUnauthorized: true },
    connectionTimeoutMillis: 5000, query_timeout: 5000, statement_timeout: 5000 })
  // pg may emit an idle-client error independently of a query. Do not log it.
  client.on('error', () => {})
  const read = async <T>(sql: string, values: string[] = []): Promise<T[]> => {
    await client.query('BEGIN READ ONLY')
    try {
      const result = await client.query(sql, values)
      await client.query('COMMIT')
      return result.rows as T[]
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    }
  }
  try {
    await client.connect()
    const [identity] = await read<{ role: string; readonly: string }>(
      "SELECT current_user AS role, current_setting('transaction_read_only') AS readonly")
    ensure(identity?.role === 'book_bear_api' && identity.readonly === 'on', 'db-preflight')
    // Check SELECT permissions without reading unrelated users' data.
    await read('SELECT id FROM public.books WHERE false')
    await read('SELECT id FROM public.user_books WHERE false')
    return {
      book: async (id) => (await read<ObservedBook>(
        'SELECT id, title, isbn13, created_by_user_id FROM public.books WHERE id=$1::uuid', [id]))[0],
      shelf: async (id) => (await read<ObservedShelf>(
        'SELECT id, user_id, book_id, status, current_page FROM public.user_books WHERE id=$1::uuid', [id]))[0],
      recover: async (title, userId) => ({
        books: await read<ObservedBook>('SELECT id, title, isbn13, created_by_user_id FROM public.books WHERE title=$1 AND created_by_user_id=$2::uuid', [title, userId]),
        shelves: await read<ObservedShelf>('SELECT ub.id, ub.user_id, ub.book_id, ub.status, ub.current_page FROM public.user_books ub JOIN public.books b ON b.id=ub.book_id WHERE b.title=$1 AND b.created_by_user_id=$2::uuid AND ub.user_id=$2::uuid', [title, userId]),
      }),
      close: () => client.end(),
    }
  } catch (error) {
    await client.end().catch(() => {})
    throw error
  }
}
