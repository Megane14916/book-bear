import { Client } from 'pg'
import { loadDataset, SeedError } from './seed/dataset'
import { resolveSeedTarget } from './seed/target'
import { writeSeed } from './seed/write'

let client: Client | undefined
let stage = 'dataset'
try {
  const data = await loadDataset()
  stage = 'target'
  const target = await resolveSeedTarget(process.argv.slice(2), data.users)
  stage = 'connection'
  client = new Client({ ...target.connection, ssl: target.connection.ssl ?? false,
    connectionTimeoutMillis: 5000, statement_timeout: 10000, query_timeout: 12000 })
  client.on('error', () => {})
  await client.connect()
  stage = 'write'
  const counts = await writeSeed(client, data, target)
  console.log(JSON.stringify({ version: data.version, environment: target.local ? 'local' : 'development', counts }, null, 2))
} catch (error) {
  console.error(`Seed failed during ${stage}. ${error instanceof SeedError ? error.message : 'Check the seed setup and database constraints.'}`)
  process.exitCode = 1
} finally {
  await client?.end().catch(() => { process.exitCode = 1 })
}
