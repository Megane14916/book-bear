import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Client } from 'pg'

const connectionString = process.env.MIGRATION_DATABASE_URL
if (!connectionString) {
  console.error('MIGRATION_DATABASE_URL is required. See docs/database-setup.md.')
  process.exitCode = 1
} else {
  const client = new Client({ connectionString, connectionTimeoutMillis: 10000 })
  try {
    await client.connect()
    await client.query(await readFile(new URL('sql/bootstrap.sql', import.meta.url), 'utf8'))
    await migrate(drizzle(client), { migrationsFolder: fileURLToPath(new URL('../drizzle/', import.meta.url)) })
    await client.query(await readFile(new URL('sql/grants.sql', import.meta.url), 'utf8'))
    console.log('Book Bear migrations and application grants are up to date.')
  } catch {
    // pg/Drizzle errors may contain SQL, connection settings or credentials.
    console.error('Migration failed. Check connectivity, auth.users, migration privileges and the reviewed SQL. Connection details are not logged.')
    process.exitCode = 1
  } finally {
    await client.end()
  }
}
