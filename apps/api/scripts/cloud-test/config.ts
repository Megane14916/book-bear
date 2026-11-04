import { readFileSync } from 'node:fs'
import { isIP } from 'node:net'
import { z } from 'zod'

export class CloudTestError extends Error {
  constructor(public stage: string, public reason: string, public status?: number) {
    super(`${stage}: ${reason}`)
  }
}

export function ensure(condition: unknown, stage: string, reason = 'mismatch'): asserts condition {
  if (!condition) throw new CloudTestError(stage, reason)
}

export type CloudConfig = {
  apiOrigin: string; supabaseUrl: string; projectRef: string
  publishableKey: string; userId: string; accessToken: string
  database: { host: string; port: number; database: string; user: string; password: string; ca: string }
}

export function readCloudConfig(env: NodeJS.ProcessEnv): CloudConfig {
  // Never include input values or parser exceptions in configuration errors.
  try {
    ensure(env.CLOUD_TEST_ENVIRONMENT === 'development', 'config')
    const api = new URL(env.CLOUD_TEST_API_ORIGIN ?? '')
    const ref = env.CLOUD_TEST_SUPABASE_PROJECT_REF ?? ''
    ensure(/^[a-z0-9]{20}$/.test(ref), 'config')
    ensure(api.protocol === 'https:' && !api.username && !api.password && api.pathname === '/'
      && !api.search && !api.hash && !api.port && !isIP(api.hostname)
      && api.hostname.includes('.') && !/(^|\.)(localhost|local|test|invalid)$/.test(api.hostname), 'config')
    const supabase = new URL(env.SUPABASE_URL ?? '')
    ensure(supabase.href === `https://${ref}.supabase.co/`, 'config')
    const publishableKey = env.SUPABASE_PUBLISHABLE_KEY ?? ''
    ensure(/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey) && !publishableKey.includes('YOUR_'), 'config')
    const userId = z.string().uuid().parse(env.CLOUD_TEST_USER_ID)
    const accessToken = env.CLOUD_TEST_ACCESS_TOKEN ?? ''
    ensure(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(accessToken)
      && accessToken.length <= 16384, 'config')
    const db = new URL(env.CLOUD_TEST_DATABASE_URL ?? '')
    const user = decodeURIComponent(db.username)
    const direct = db.hostname === `db.${ref}.supabase.co` && user === 'book_bear_api'
    const pooler = db.hostname.endsWith('.pooler.supabase.com') && user === `book_bear_api.${ref}`
    ensure(['postgres:', 'postgresql:'].includes(db.protocol) && (direct || pooler)
      && (db.port || '5432') === '5432' && db.pathname === '/postgres' && !db.hash && db.password, 'config')
    ensure([...db.searchParams.keys()].every((key) => ['sslmode', 'sslrootcert'].includes(key))
      && db.searchParams.getAll('sslmode').length === 1 && db.searchParams.get('sslmode') === 'verify-full'
      && db.searchParams.getAll('sslrootcert').length === 1, 'config')
    const caPath = db.searchParams.get('sslrootcert')
    ensure(caPath, 'config')
    const ca = readFileSync(caPath, 'utf8')
    ensure(ca.includes('-----BEGIN CERTIFICATE-----'), 'config')
    return { apiOrigin: api.origin, supabaseUrl: supabase.origin, projectRef: ref, publishableKey, userId, accessToken,
      database: { host: db.hostname, port: 5432, database: 'postgres', user,
        password: decodeURIComponent(db.password), ca } }
  } catch { throw new CloudTestError('config', 'Invalid cloud test settings. See docs/cloud-integration-test.md; values are not logged.') }
}

export type ManualConfirmation = {
  confirmedAt: string; workerName: string; deploymentVersion: string; hyperdriveId: string
}

export function confirmTarget(config: CloudConfig, answers: {
  origin: string; projectRef: string; workerName: string; deploymentVersion: string; hyperdriveId: string; checked: string
}): ManualConfirmation {
  ensure(answers.origin === config.apiOrigin && answers.projectRef === config.projectRef
    && /^[a-z0-9][a-z0-9-]{0,62}$/.test(answers.workerName)
    && /^[A-Za-z0-9_-]{1,128}$/.test(answers.deploymentVersion)
    && /^[a-f0-9]{32}$/i.test(answers.hyperdriveId) && !/^0{32}$/.test(answers.hyperdriveId)
    && answers.checked === 'development verified', 'manual-confirmation', 'not-confirmed')
  return { confirmedAt: new Date().toISOString(), workerName: answers.workerName,
    deploymentVersion: answers.deploymentVersion, hyperdriveId: answers.hyperdriveId }
}
