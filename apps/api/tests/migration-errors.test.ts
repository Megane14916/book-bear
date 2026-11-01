import { describe, expect, it } from 'vitest'
import { formatMigrationError } from '../scripts/migration-errors'

describe('migration error diagnostics', () => {
  it('パスワードや接続URIを出さず、認証失敗コードと対処を表示する', () => {
    const error = {
      code: '28P01', message: 'password=DO_NOT_LOG_THIS',
      connectionString: 'postgres://user:SECRET@private-host/db',
      query: 'select private_data', stack: 'PRIVATE_STACK',
    }
    const output = formatMigrationError(error, 'connection')
    expect(output).toContain('connection [28P01]')
    expect(output).toContain('database password')
    for (const secret of ['DO_NOT_LOG_THIS', 'SECRET', 'private-host', 'private_data', 'PRIVATE_STACK']) {
      expect(output).not.toContain(secret)
    }
  })
  it('Drizzleがラップしたcauseから元のPostgreSQLコードを取得する', () => {
    const output = formatMigrationError({ message: 'SECRET_SQL', cause: { code: '42501', detail: 'SECRET_DETAIL' } }, 'migration')
    expect(output).toContain('migration [42501]')
    expect(output).not.toContain('SECRET')
  })
  it.each([
    ['ENOTFOUND', 'DNS'],
    ['ENOENT', 'sslrootcert'],
    ['SELF_SIGNED_CERT_IN_CHAIN', 'certificate verification enabled'],
    ['42P01', 'auth.users'],
    ['P0001', 'elevated privileges'],
  ])('%sの安全な対処を表示する', (code, hint) => {
    expect(formatMigrationError({ code }, 'connection')).toContain(hint)
  })
  it.each([null, undefined, 'SECRET', { code: 'SECRET' }, { code: '__proto__' }])('未知のエラー情報を表示しない', (error) => {
    const output = formatMigrationError(error, 'grants')
    expect(output).toContain('grants [UNKNOWN]')
    expect(output).not.toContain('SECRET')
    expect(output).not.toContain('__proto__')
  })
  it('循環causeや深すぎるcauseでも停止する', () => {
    const circular: { cause?: unknown } = {}
    circular.cause = circular
    expect(formatMigrationError(circular, 'close')).toContain('[UNKNOWN]')
    let nested: unknown = { code: '28P01' }
    for (let index = 0; index < 10; index++) nested = { cause: nested }
    expect(formatMigrationError(nested, 'close')).toContain('[UNKNOWN]')
  })
})
