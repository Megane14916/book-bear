import { beforeEach, expect, it, vi } from 'vitest'
import { openObserver } from '../scripts/cloud-test/database'
import type { CloudConfig } from '../scripts/cloud-test/config'

const fake = vi.hoisted(() => ({ queries: [] as { sql: string; values?: string[] }[],
  options: {} as Record<string, unknown>, failRead: false, role: 'book_bear_api', ended: false }))
vi.mock('pg', () => ({ Client: class {
  constructor(options: Record<string, unknown>) { fake.options = options }
  on() {}
  async connect() {}
  async end() { fake.ended = true }
  async query(sql: string, values?: string[]) {
    fake.queries.push({ sql, values })
    if (sql.includes('current_user')) return { rows: [{ role: fake.role, readonly: 'on' }] }
    if (fake.failRead && sql.includes('FROM public.books WHERE id=')) throw new Error('private database details')
    return { rows: [] }
  }
} }))

const config = { database: { host: 'db.fixture.supabase.co', port: 5432, database: 'postgres',
  user: 'book_bear_api', password: 'private', ca: 'fixture-ca' } } as CloudConfig

beforeEach(() => { fake.queries = []; fake.failRead = false; fake.role = 'book_bear_api'; fake.ended = false })

it('uses explicit verified TLS and READ ONLY around every observation, binding generated IDs', async () => {
  const db = await openObserver(config)
  await db.book('book-id')
  await db.shelf('shelf-id')
  await db.recover('cloud-test-run-id', 'user-id')
  await db.close()
  expect(fake.options.ssl).toEqual({ ca: 'fixture-ca', rejectUnauthorized: true })
  expect(fake.options.user).toBe('book_bear_api')
  expect(fake.options).not.toHaveProperty('connectionString')
  for (let i = 0; i < fake.queries.length; i += 3) {
    expect(fake.queries[i].sql).toBe('BEGIN READ ONLY')
    expect(fake.queries[i + 1].sql).toMatch(/^SELECT /)
    expect(fake.queries[i + 2].sql).toBe('COMMIT')
  }
  expect(fake.queries.find((q) => q.values?.[0] === 'book-id')?.sql).toContain('id=$1::uuid')
  expect(fake.queries.find((q) => q.values?.[0] === 'shelf-id')?.sql).toContain('id=$1::uuid')
  expect(fake.queries.map((q) => q.sql).join('\n')).not.toMatch(/auth\.|__drizzle|DELETE|UPDATE|INSERT/)
  expect(fake.ended).toBe(true)
})

it('rolls back a failed read, without writing to application tables', async () => {
  const db = await openObserver(config)
  fake.failRead = true
  await expect(db.book('book-id')).rejects.toThrow()
  expect(fake.queries.at(-1)?.sql).toBe('ROLLBACK')
  await db.close()
})

it('refuses a privileged observation session and closes it before CRUD', async () => {
  fake.role = 'postgres'
  await expect(openObserver(config)).rejects.toMatchObject({ stage: 'db-preflight' })
  expect(fake.ended).toBe(true)
  expect(fake.queries.some((q) => q.sql.includes('FROM public.'))).toBe(false)
})
