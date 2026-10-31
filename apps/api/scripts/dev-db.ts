import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'

// This is a local development substitute, not Supabase Auth. Never run these
// auth stubs against Supabase; the hosted migration script does not import this.
const db = await PGlite.create(fileURLToPath(new URL('../.local-db/', import.meta.url)))
await db.exec('CREATE SCHEMA IF NOT EXISTS auth; CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY);')
const server = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 5433, maxConnections: 4 })
await server.start()
console.log('Local Book Bear PostgreSQL is listening on 127.0.0.1:5433 (development only).')
async function stop() {
  await server.stop()
  await db.close()
  process.exit(0)
}
process.once('SIGINT', stop)
process.once('SIGTERM', stop)
