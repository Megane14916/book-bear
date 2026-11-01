import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Client } from 'pg'
import * as schema from './schema'

export type DatabaseBindings = { HYPERDRIVE?: { connectionString: string } }
export type Database = NodePgDatabase<typeof schema>

// Hyperdrive owns the remote pool. Create and close a client within each
// request; sharing sockets between Workers requests is not supported.
export async function withDatabase<T>(env: DatabaseBindings, query: (db: Database) => Promise<T>): Promise<T> {
  if (!env.HYPERDRIVE?.connectionString) throw new Error('HYPERDRIVE binding is required')
  const client = new Client({
    connectionString: env.HYPERDRIVE.connectionString,
    connectionTimeoutMillis: 5000, query_timeout: 5000,
  })
  try {
    await client.connect()
    return await query(drizzle(client, { schema }))
  } finally {
    await client.end()
  }
}
