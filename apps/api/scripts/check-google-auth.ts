import { GoogleCheckClient } from './auth/check-client'
import { startCallback } from './auth/callback'
import { AuthCheckError, createPkce, googleOidc, readCheckConfig } from './auth/google-oidc'

const [mode, ...extra] = process.argv.slice(2)
async function main() {
  if (!mode || mode === '--help') {
    console.log('Usage: pnpm --filter api auth:google <config|check|scopes|login|link>\nconfig: show public provider settings (no network)\ncheck: validate .env.auth.local (no network)\nscopes: inspect Supabase authorization URLs without contacting Google or logging in\nlogin: manually sign in using your browser\nlink: create a disposable anonymous user, then manually link Google\nSee docs/google-oidc-setup.md. This CLI never opens or controls a browser.')
    return
  }
  if (extra.length || !['config', 'check', 'scopes', 'login', 'link'].includes(mode)) throw new AuthCheckError('Unknown command. Use auth:google --help.')
  if (mode === 'config') { console.log(JSON.stringify(googleOidc, null, 2)); return }
  const config = readCheckConfig(process.env)
  if (mode === 'check') { console.log('Local configuration is valid. No network request, login or provider change was performed.'); return }
  if (mode === 'scopes') {
    const client = new GoogleCheckClient(config)
    const redirectTo = `http://127.0.0.1:${config.port}/auth/callback`
    await client.authorization(createPkce().challenge, redirectTo)
    await client.authorization(createPkce().challenge, redirectTo, undefined, true)
    console.log('Provider scopes and override protection verified: openid email. Two Supabase authorization flows were prepared; no Google request, login or user creation was performed.')
    return
  }
  const callback = await startCallback(config.port)
  const stop = () => { process.exitCode = 130; callback.cancel() }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  try {
    const client = new GoogleCheckClient(config)
    const anonymous = mode === 'link' ? await client.anonymous(process.env.AUTH_CAPTCHA_TOKEN) : undefined
    const before = anonymous ? await client.prepareLink(anonymous) : undefined
    if (before) console.log(`Created a test anonymous user: ${before.profile.id}. Existing profile/preferences will be compared after linking.`)
    const pkce = createPkce()
    const url = await client.authorization(pkce.challenge, callback.redirectTo, anonymous)
    console.log('Provider scopes verified: openid email. Open this one-time URL yourself in your browser:')
    console.log(url)
    console.log('Waiting for the manual browser login (maximum 10 minutes). Keep this terminal open.')
    let session = await client.exchange(await callback.code, pkce.verifier)
    const first = await client.verify(session, before)
    console.log(JSON.stringify({ phase: 'after-login', ...first }, null, 2))
    session = await client.refresh(session)
    const refreshed = await client.verify(session, before)
    if (refreshed.uid !== first.uid) throw new AuthCheckError('Session refresh changed the UID.')
    console.log(JSON.stringify({ phase: 'after-refresh', ...refreshed }, null, 2))
    if (first.additionalMetadataDetected || refreshed.additionalMetadataDetected) {
      throw new AuthCheckError('Additional Auth metadata was detected. The no-profile-data requirement is not confirmed. Review the manual audit steps; no values are logged or deleted.')
    }
    console.log('API/UID checks passed. Auth metadata checked here has no additional populated fields. Complete the Dashboard audit in the guide; this does not prove the provider returned no extra claims.')
  } finally {
    process.removeListener('SIGINT', stop)
    process.removeListener('SIGTERM', stop)
    await callback.close()
  }
}

try { await main() } catch (error) {
  console.error(error instanceof AuthCheckError ? error.message : 'Google auth check failed. Check local port, configuration and the setup guide. Raw errors/tokens are not logged.')
  process.exitCode = process.exitCode || 1
}
