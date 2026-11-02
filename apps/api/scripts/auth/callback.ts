import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { AuthCheckError } from './google-oidc'

// Used only by the user-run CLI. This is not an application/OAuth server route.
export async function startCallback(port: number, timeoutMs = 10 * 60_000) {
  let resolveCode!: (code: string) => void
  let rejectCode!: (error: Error) => void
  let consumed = false
  const code = new Promise<string>((resolve, reject) => { resolveCode = resolve; rejectCode = reject })
  // It may reject while the caller is still preparing the authorization URL.
  void code.catch(() => {})
  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
    const address = server.address() as AddressInfo
    if (request.headers.host !== `127.0.0.1:${address.port}`) { response.writeHead(400).end(); return }
    if (request.method !== 'GET') { response.writeHead(405, { Allow: 'GET' }).end(); return }
    let url: URL
    try { url = new URL(request.url ?? '/', 'http://127.0.0.1') } catch { response.writeHead(400).end(); return }
    if (url.pathname === '/complete') { response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Received. Return to the terminal for the verification result.'); return }
    if (url.pathname !== '/auth/callback') { response.writeHead(404).end(); return }
    if (consumed) { response.writeHead(409).end(); return }
    const authCode = url.searchParams.get('code')
    const error = url.searchParams.get('error')
    if ((authCode && (error || url.searchParams.getAll('code').length !== 1 || authCode.length > 2048)) || (!authCode && !error)) {
      response.writeHead(400).end(); return
    }
    consumed = true
    // The authorization code is PKCE-bound; it is never rendered or logged.
    response.writeHead(303, { Location: '/complete' }).end()
    if (error) rejectCode(new AuthCheckError('Google sign-in/link was cancelled or rejected. No application data is moved.'))
    else resolveCode(authCode!)
  })
  server.requestTimeout = 5000
  server.headersTimeout = 5000
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => { server.removeListener('error', reject); resolve() })
  })
  const address = server.address() as AddressInfo
  const timer = setTimeout(() => rejectCode(new AuthCheckError('Timed out waiting for the manual browser login. Run the command again.')), timeoutMs)
  return {
    redirectTo: `http://127.0.0.1:${address.port}/auth/callback`, code,
    cancel: () => rejectCode(new AuthCheckError('Manual login check interrupted.')),
    close: async () => {
      clearTimeout(timer)
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}
