import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Client } from 'pg'
import { formatMigrationError, type MigrationStage } from './migration-errors'

const connectionString = process.env.MIGRATION_DATABASE_URL
if (!connectionString) {
  console.error('MIGRATION_DATABASE_URL is required. See docs/database-setup.md.')
  process.exitCode = 1
} else {
  let client: Client | undefined
  let stage: MigrationStage = 'connection'
  try {
    client = new Client({ connectionString, connectionTimeoutMillis: 10000 })
    await client.connect()
    stage = 'role-setup'
    await client.query(await readFile(new URL('sql/bootstrap.sql', import.meta.url), 'utf8'))
    stage = 'migration'
    await migrate(drizzle(client), { migrationsFolder: fileURLToPath(new URL('../drizzle/', import.meta.url)) })
    stage = 'grants'
    await client.query(await readFile(new URL('sql/grants.sql', import.meta.url), 'utf8'))
    console.log('Book Bear migrations and application grants are up to date.')
  } catch (error) {
    console.error(formatMigrationError(error, stage))
    process.exitCode = 1
  } finally {
    try {
      await client?.end()
    } catch (error) {
      if (process.exitCode !== 1) console.error(formatMigrationError(error, 'close'))
      process.exitCode = 1
    }
  }
}
