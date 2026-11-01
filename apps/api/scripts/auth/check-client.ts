import { randomBytes } from 'node:crypto'
import { decodeJwt } from 'jose'
import { z } from 'zod'
import { Profile } from '../../src/modules/users/schemas'
import { Preferences } from '../../src/modules/preferences/schemas'
import {
  assertGoogleAuthorizationUrl, auditMetadata, AuthCheckError, AuthSession, AuthUser,
  googleOidc, hasAdditionalMetadata, type CheckConfig, type Session,
} from './google-oidc'

export class GoogleCheckClient {
  constructor(readonly config: CheckConfig, private readonly fetcher: typeof fetch = fetch) {}

  private async response(url: string | URL, stage: string, init: RequestInit = {}) {
    try { return await this.fetcher(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(15_000) }) }
    catch { throw new AuthCheckError(`${stage}: could not connect. Check connectivity and settings.`) }
  }

  private async json<T>(url: string | URL, stage: string, schema: z.ZodType<T>, init: RequestInit = {}): Promise<T> {
    const response = await this.response(url, stage, init)
    if (!response.ok) throw new AuthCheckError(`${stage}: HTTP ${response.status}. See the troubleshooting guide.`)
    try { return schema.parse(await response.json()) }
    catch { throw new AuthCheckError(`${stage}: unexpected response. Raw data is not logged.`) }
  }

  private authHeaders(accessToken?: string) {
    return { apikey: this.config.publishableKey, 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) }
  }

  async anonymous(captchaToken?: string) {
    const session = await this.json(`${this.config.supabaseUrl}/auth/v1/signup`, 'Anonymous sign-in', AuthSession, {
      method: 'POST', headers: this.authHeaders(), body: JSON.stringify({ data: {}, ...(captchaToken ? { gotrue_meta_security: { captcha_token: captchaToken } } : {}) }),
    })
    if (!session.user.is_anonymous) throw new AuthCheckError('Expected a new anonymous user. Aborting the link check.')
    return session
  }

  async authorization(challenge: string, redirectTo: string, session?: Session) {
    const nonce = randomBytes(32).toString('base64url')
    const endpoint = session ? 'user/identities/authorize' : 'authorize'
    const url = new URL(`${this.config.supabaseUrl}/auth/v1/${endpoint}`)
    url.search = new URLSearchParams({ provider: googleOidc.identifier, redirect_to: redirectTo,
      code_challenge: challenge, code_challenge_method: 's256', nonce, ...(session ? { skip_http_redirect: 'true' } : {}),
    }).toString()
    // Do not pass scopes here: inspect the provider's actual configured scopes.
    let googleUrl: string
    if (session) {
      const data = await this.json(url, 'Identity link authorization', z.object({ url: z.string() }), { headers: this.authHeaders(session.access_token) })
      googleUrl = data.url
    } else {
      const response = await this.response(url, 'Google authorization', { headers: this.authHeaders() })
      if (response.status !== 302 || !response.headers.get('Location')) throw new AuthCheckError(`Google authorization: expected HTTP 302, got ${response.status}. Check the Custom OIDC provider.`)
      googleUrl = response.headers.get('Location')!
    }
    const result = assertGoogleAuthorizationUrl(googleUrl, this.config.clientId)
    if (result.searchParams.get('nonce') !== nonce || result.searchParams.get('redirect_uri') !== `${this.config.supabaseUrl}/auth/v1/callback`) {
      throw new AuthCheckError('Google nonce or Supabase callback differs from the expected value. Check Custom OIDC settings.')
    }
    return result.toString()
  }

  exchange(code: string, verifier: string) {
    return this.json(`${this.config.supabaseUrl}/auth/v1/token?grant_type=pkce`, 'PKCE exchange', AuthSession, {
      method: 'POST', headers: this.authHeaders(), body: JSON.stringify({ auth_code: code, code_verifier: verifier }),
    })
  }

  refresh(session: Session) {
    return this.json(`${this.config.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, 'Session refresh', AuthSession, {
      method: 'POST', headers: this.authHeaders(), body: JSON.stringify({ refresh_token: session.refresh_token }),
    })
  }

  private profile(session: Session, method: 'GET' | 'PUT') {
    return this.json(`${this.config.apiUrl}/api/v1/me`, `API ${method} /me`, Profile, {
      method, headers: { Authorization: `Bearer ${session.access_token}` },
    })
  }

  private preferences(session: Session) {
    return this.json(`${this.config.apiUrl}/api/v1/me/preferences`, 'API GET /me/preferences', Preferences, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
  }

  async initialize(session: Session) {
    const profile = await this.profile(session, 'PUT')
    if (profile.id !== session.user.id || profile.isAnonymous !== session.user.is_anonymous) throw new AuthCheckError('Auth and application identity differ.')
    return { profile, preferences: await this.preferences(session) }
  }

  async verify(session: Session, before?: Awaited<ReturnType<GoogleCheckClient['initialize']>>) {
    // Auth HTTPS validates the token; Hono also verifies its signature/claims.
    // Do not trust a decoded JWT as the identity or create a mismatched profile.
    const user = await this.json(`${this.config.supabaseUrl}/auth/v1/user`, 'Auth user verification', AuthUser, { headers: this.authHeaders(session.access_token) })
    if (user.is_anonymous || user.id !== session.user.id || (before && user.id !== before.profile.id)) {
      throw new AuthCheckError('Google link did not preserve the expected UID or registered state. No application data is moved.')
    }
    if (!user.identities?.some((identity) => identity.provider === googleOidc.identifier)) throw new AuthCheckError('The user has no expected Custom OIDC identity.')
    const current = before
      ? { profile: await this.profile(session, 'GET'), preferences: await this.preferences(session) }
      : await this.initialize(session)
    if (current.profile.id !== user.id || current.profile.isAnonymous) throw new AuthCheckError('API identity or anonymous state differs from Auth.')
    if (before) {
      for (const key of ['displayName', 'handle', 'bio', 'avatarUrl'] as const) {
        if (current.profile[key] !== before.profile[key]) throw new AuthCheckError('Google linking changed an existing application profile field.')
      }
      if (current.preferences.feedContentMode !== before.preferences.feedContentMode) throw new AuthCheckError('Google linking changed existing preferences.')
    }
    const initialized = await this.initialize(session)
    if (JSON.stringify(initialized) !== JSON.stringify(current)) throw new AuthCheckError('Repeated PUT /me changed the application profile or preferences.')
    const publicProfile = await this.json(`${this.config.apiUrl}/api/v1/users/${user.id}`, 'API public profile', z.record(z.unknown()))
    if (['email', 'email_verified', 'user_metadata', 'identity_data', 'isAnonymous', 'feedContentMode'].some((key) => key in publicProfile)) {
      throw new AuthCheckError('The public profile exposed private Auth or preference fields.')
    }
    // Only inspect metadata AFTER Hono accepted this access token. Its claims
    // are used for a privacy audit, never for authorization or ownership.
    let jwtMetadata: unknown
    try { jwtMetadata = decodeJwt(session.access_token).user_metadata }
    catch { throw new AuthCheckError('Could not inspect the already API-verified JWT metadata.') }
    const audit = auditMetadata(user, jwtMetadata)
    return { uid: user.id, isAnonymous: current.profile.isAnonymous, sameUid: before ? user.id === before.profile.id : undefined,
      profilePreserved: true, metadataAudit: audit, additionalMetadataDetected: hasAdditionalMetadata(audit) }
  }
}
