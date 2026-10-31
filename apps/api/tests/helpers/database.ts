import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Client } from 'pg'

export const migrationFolder = fileURLToPath(new URL('../../drizzle/', import.meta.url))
export const bootstrapSql = () => readFile(new URL('../../scripts/sql/bootstrap.sql', import.meta.url), 'utf8')
export const grantsSql = () => readFile(new URL('../../scripts/sql/grants.sql', import.meta.url), 'utf8')

export async function createTestDatabase() {
  const providedUrl = process.env.TEST_DATABASE_URL
  let embedded: PGlite | undefined
  let server: PGLiteSocketServer | undefined
  let connectionString: string
  if (providedUrl) {
    const url = new URL(providedUrl)
    // The fixture below intentionally creates Auth stubs. Only disposable local
    // databases may be used; never point it at a Supabase project.
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.pathname !== '/book_bear_test') {
      throw new Error('TEST_DATABASE_URL must target a local disposable book_bear_test database')
    }
    connectionString = providedUrl
  } else {
    embedded = await PGlite.create()
    server = new PGLiteSocketServer({ db: embedded, host: '127.0.0.1', port: 0, maxConnections: 4 })
    await server.start()
    connectionString = `postgres://postgres:postgres@${server.getServerConn()}/postgres`
  }
  const client = new Client({ connectionString })
  await client.connect()
  await client.query(`
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY);
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
    END $$;
  `)
  const apply = async () => {
    await client.query(await bootstrapSql())
    await migrate(drizzle(client), { migrationsFolder: migrationFolder })
    await client.query(await grantsSql())
  }
  await apply()
  let apiConnectionString = connectionString
  if (providedUrl) {
    // Real PostgreSQL CI must exercise the actual runtime login, not postgres.
    // PGlite's shared embedded session is tested with SET ROLE instead.
    const password = randomUUID()
    await client.query(`ALTER ROLE book_bear_api LOGIN PASSWORD '${password}'`)
    const apiUrl = new URL(connectionString)
    apiUrl.username = 'book_bear_api'
    apiUrl.password = password
    apiConnectionString = apiUrl.toString()
  }
  return {
    client, connectionString, apiConnectionString, apply,
    close: async () => { await client.end(); await server?.stop(); await embedded?.close() },
  }
}
