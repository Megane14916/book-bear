import { readFile } from 'node:fs/promises'
import type { ClientConfig } from 'pg'
import { z } from 'zod'
import { check, type Dataset } from './dataset'

const credentials = z.object({
  uid: z.string().uuid(),
  token: z.string().max(16384).regex(/^[\w-]+\.[\w-]+\.[\w-]+$/),
}).strict()
const authUser = z.object({ id: z.string().uuid(), is_anonymous: z.boolean() })

export async function resolveSeedTarget(args: string[], users: Dataset['users'], env = process.env, fetcher = fetch) {
  if (args.length === 0) {
    return {
      local: true,
      connection: { host: '127.0.0.1', port: 5433, database: 'postgres', user: 'postgres', password: 'postgres' } satisfies ClientConfig,
      uids: new Map(users.map((user) => [user.key, user.localUid])),
    }
  }
  const [flag, ref] = args
  check(args.length === 2 && flag === '--development' && /^[a-z0-9]{20}$/.test(ref)
    && env.SEED_DEVELOPMENT_PROJECT_REF === ref && env.SEED_SUPABASE_URL === `https://${ref}.supabase.co`,
  'Specify --development with the independently verified development project ref')
  const publishableKey = env.SEED_SUPABASE_PUBLISHABLE_KEY
  check(publishableKey && /^sb_publishable_[\w-]+$/.test(publishableKey), 'A development publishable key is required')
  const url = new URL(env.SEED_DATABASE_URL ?? '')
  const role = decodeURIComponent(url.username)
  const direct = url.hostname === `db.${ref}.supabase.co` && role === 'book_bear_api'
  const pooler = url.hostname.endsWith('.pooler.supabase.com') && role === `book_bear_api.${ref}`
  check(['postgresql:', 'postgres:'].includes(url.protocol) && (direct || pooler) && url.pathname === '/postgres'
    && (url.port || '5432') === '5432' && url.password && !url.hash && !url.search, 'Development DB URL does not match the approved project')
  const ca = await readFile(new URL('../../certs/prod-ca-2021.crt', import.meta.url), 'utf8')
  const accounts = z.record(credentials).safeParse(JSON.parse(await readFile(env.SEED_ACCOUNTS_FILE ?? '', 'utf8')))
  check(accounts.success && Object.keys(accounts.data).length === users.length, 'Invalid development seed accounts file')
  const uids = new Map<string, string>()
  for (const user of users) {
    const account = accounts.data[user.key]
    check(account && ![...uids.values()].includes(account.uid), `Missing or duplicate development UID: ${user.key}`)
    const response = await fetcher(`https://${ref}.supabase.co/auth/v1/user`, {
      headers: { apikey: publishableKey, Authorization: `Bearer ${account.token}` },
      redirect: 'error', signal: AbortSignal.timeout(5000),
    }).catch(() => undefined)
    check(response?.ok, `Auth verification failed: ${user.key}`)
    const verified = authUser.safeParse(await response.json().catch(() => null))
    check(verified.success && verified.data.id === account.uid && verified.data.is_anonymous === user.anonymous,
      `Auth identity mismatch: ${user.key}`)
    uids.set(user.key, account.uid)
  }
  return {
    local: false,
    connection: { host: url.hostname, port: 5432, database: 'postgres', user: role,
      password: decodeURIComponent(url.password), ssl: { ca, rejectUnauthorized: true } } satisfies ClientConfig,
    uids,
  }
}
