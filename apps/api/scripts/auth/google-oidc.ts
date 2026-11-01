import { createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'

// Public configuration shared by the setup output and the manual-check client.
// Credentials are supplied in Supabase, never embedded in this repository.
export const googleOidc = {
  provider_type: 'oidc', identifier: 'custom:google', name: 'Google (email only)',
  issuer: 'https://accounts.google.com', scopes: ['openid', 'email'],
  pkce_enabled: true, skip_nonce_check: false, email_optional: false,
  // Custom providers accept a caller's scopes override. Their stored
  // authorization params are applied last, so pin the outgoing scope too.
  authorization_params: { scope: 'openid email', access_type: 'online', include_granted_scopes: 'false' },
} as const

export class AuthCheckError extends Error {}

export type CheckConfig = { supabaseUrl: string; publishableKey: string; apiUrl: string; clientId: string; port: number }
export function readCheckConfig(env: Record<string, string | undefined>): CheckConfig {
  const supabaseUrl = parseBaseUrl(env.SUPABASE_URL, false)
  const apiUrl = parseBaseUrl(env.API_BASE_URL ?? 'http://127.0.0.1:8787', true)
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY?.trim() ?? ''
  const clientId = env.GOOGLE_OIDC_CLIENT_ID?.trim() ?? ''
  const portText = env.OIDC_CALLBACK_PORT ?? '8790'
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey) || publishableKey.includes('YOUR_')) {
    throw new AuthCheckError('Set SUPABASE_PUBLISHABLE_KEY to a publishable key, not a secret/service_role key.')
  }
  if (!/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId) || clientId.includes('YOUR_')) {
    throw new AuthCheckError('Set GOOGLE_OIDC_CLIENT_ID to the Google OAuth web client ID.')
  }
  if (!/^\d+$/.test(portText) || Number(portText) < 1024 || Number(portText) > 65535) {
    throw new AuthCheckError('OIDC_CALLBACK_PORT must be an integer from 1024 to 65535.')
  }
  return { supabaseUrl, publishableKey, apiUrl, clientId, port: Number(portText) }
}

function parseBaseUrl(value: string | undefined, allowLoopback: boolean): string {
  try {
    const url = new URL(value?.trim() ?? '')
    const local = allowLoopback && url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    if ((!local && url.protocol !== 'https:') || url.username || url.password || url.pathname !== '/' || url.search || url.hash || /YOUR_/i.test(url.host)) throw new Error()
    return url.origin
  } catch { throw new AuthCheckError('Set valid SUPABASE_URL / API_BASE_URL origins. HTTPS is required except for the loopback API.') }
}

export function createPkce() {
  const verifier = randomBytes(32).toString('base64url')
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
}

export function assertGoogleAuthorizationUrl(value: string, clientId: string): URL {
  let url: URL
  try { url = new URL(value) } catch { throw new AuthCheckError('Supabase did not return a valid Google authorization URL.') }
  const query = url.searchParams
  if (url.origin !== googleOidc.issuer || url.username || url.password || url.hash || !['/o/oauth2/v2/auth', '/o/oauth2/auth'].includes(url.pathname)) {
    throw new AuthCheckError('Authorization must go directly to the Google accounts HTTPS endpoint.')
  }
  for (const name of ['scope', 'client_id', 'redirect_uri', 'response_type', 'state', 'nonce', 'code_challenge', 'code_challenge_method']) {
    if (query.getAll(name).length !== 1 || !query.get(name)) throw new AuthCheckError('Google authorization parameters are missing or duplicated. Check provider PKCE and nonce settings.')
  }
  const scopes = query.get('scope')!.split(/\s+/).filter(Boolean)
  if (scopes.length !== 2 || new Set(scopes).size !== 2 || !googleOidc.scopes.every((scope) => scopes.includes(scope))) {
    throw new AuthCheckError('Google scope must be exactly openid email. Stop and fix the Custom OIDC provider scopes.')
  }
  if (query.get('client_id') !== clientId || query.get('response_type') !== 'code' || query.get('code_challenge_method') !== 'S256'
    || !/^[A-Za-z0-9_-]{43}$/.test(query.get('code_challenge')!)
    || query.getAll('access_type').length > 1 || (query.has('access_type') && query.get('access_type') !== 'online')
    || query.getAll('include_granted_scopes').length > 1 || (query.has('include_granted_scopes') && query.get('include_granted_scopes') !== 'false')
    || query.has('request') || query.has('request_uri')) {
    throw new AuthCheckError('Unexpected Google client, PKCE, offline access or additional authorization settings.')
  }
  return url
}

export const AuthUser = z.object({
  id: z.string().uuid(), is_anonymous: z.boolean(),
  user_metadata: z.record(z.unknown()).optional(),
  app_metadata: z.object({ providers: z.array(z.string()).optional(), provider: z.string().optional() }).passthrough().optional(),
  identities: z.array(z.object({ provider: z.string(), identity_data: z.record(z.unknown()).optional() }).passthrough()).optional(),
}).passthrough()
export const AuthSession = z.object({ access_token: z.string().min(1), refresh_token: z.string().min(1), user: AuthUser })
export type Session = z.infer<typeof AuthSession>

const metadataKeys = new Set(['iss', 'sub', 'provider_id', 'email', 'email_verified', 'phone_verified'])
const profileKeys = ['name', 'full_name', 'given_name', 'family_name', 'picture', 'avatar_url', 'profile', 'locale'] as const
export function auditMetadata(user: z.infer<typeof AuthUser>, jwtMetadata: unknown) {
  const inspect = (value: unknown) => {
    const record = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
    const populated = Object.entries(record).filter(([, item]) => item !== null && item !== undefined && item !== '')
    return {
      additionalFieldCount: populated.filter(([key]) => !metadataKeys.has(key)).length,
      profileFieldsPresent: profileKeys.filter((key) => record[key] !== undefined && record[key] !== null && record[key] !== ''),
    }
  }
  // Values and arbitrary metadata keys are never returned to the logger.
  return { userMetadata: inspect(user.user_metadata), jwtUserMetadata: inspect(jwtMetadata),
    identities: (user.identities ?? []).filter((identity) => identity.provider === googleOidc.identifier).map((identity) => inspect(identity.identity_data)) }
}

export function hasAdditionalMetadata(audit: ReturnType<typeof auditMetadata>) {
  return [audit.userMetadata, audit.jwtUserMetadata, ...audit.identities].some((item) => item.additionalFieldCount > 0)
}
