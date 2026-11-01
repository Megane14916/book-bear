export type MigrationStage = 'connection' | 'role-setup' | 'migration' | 'grants' | 'close'

// Never log raw pg/Drizzle errors: their messages, queries and causes may
// contain credentials or application data. Emit only recognized codes.
const hints: Record<string, string> = {
  '28P01': 'Check the Supabase database password and its URL encoding (not your Dashboard login password).',
  '28000': 'Check the database username and authentication settings from Connect.',
  '42501': 'Use the administrative migration connection; check role, schema and table privileges.',
  '42P01': 'Check that auth.users exists and that the migration targets the intended Supabase project.',
  '3F000': 'Check the target database schemas, including the Supabase auth schema.',
  '3D000': 'Check the database name from Connect.',
  '42P07': 'A migration object already exists. Check schema and migration history; do not delete data to retry.',
  '42710': 'A migration object already exists. Check schema and migration history; do not delete data to retry.',
  '42704': 'Check that the required role or database object exists.',
  'P0001': 'Check that book_bear_api has no elevated privileges or membership in other roles.',
  '53300': 'The database connection limit has been reached. Close unused connections and retry later.',
  '57P03': 'The database is not ready to accept connections. Check project status and retry later.',
  'ENOTFOUND': 'Check the Connect hostname and local DNS; use Session pooler on an IPv4-only network.',
  'EAI_AGAIN': 'DNS lookup failed temporarily. Check the network and retry later.',
  'ECONNREFUSED': 'Check the database service and port. Use Session pooler port 5432 for migration fallback.',
  'ETIMEDOUT': 'Check network access, connection mode and project status.',
  'ENETUNREACH': 'Check network access; use Session pooler on an IPv4-only network.',
  'EHOSTUNREACH': 'Check network access; use Session pooler on an IPv4-only network.',
  'ENOENT': 'Check that the sslrootcert file exists at the configured path.',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE': 'Check the Supabase CA certificate and sslrootcert path; keep certificate verification enabled.',
  'SELF_SIGNED_CERT_IN_CHAIN': 'Check the Supabase CA certificate and sslrootcert path; keep certificate verification enabled.',
  'DEPTH_ZERO_SELF_SIGNED_CERT': 'Check the Supabase CA certificate and sslrootcert path; keep certificate verification enabled.',
  'ERR_TLS_CERT_ALTNAME_INVALID': 'The certificate does not match the hostname. Check the Connect hostname and CA certificate.',
  'CERT_HAS_EXPIRED': 'Check the CA certificate and the system clock.',
}

export function formatMigrationError(error: unknown, stage: MigrationStage): string {
  const visited = new Set<object>()
  let current = error
  for (let depth = 0; depth < 6; depth++) {
    if (typeof current !== 'object' || current === null || visited.has(current)) break
    visited.add(current)
    const candidate = current as { code?: unknown; cause?: unknown }
    if (typeof candidate.code === 'string' && Object.hasOwn(hints, candidate.code)) {
      return `Migration failed during ${stage} [${candidate.code}]. ${hints[candidate.code]} Connection details and SQL are not logged.`
    }
    current = candidate.cause
  }
  return `Migration failed during ${stage} [UNKNOWN]. Check connectivity, auth.users, migration privileges and the reviewed SQL. Connection details and SQL are not logged.`
}
