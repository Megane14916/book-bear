import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRemoteConfig } from './remote-config'

const apiDirectory = fileURLToPath(new URL('../', import.meta.url))
const [command, ...args] = process.argv.slice(2)
const unsupportedArgs = args.some((arg) => ['--config', '-c', '--env', '-e'].includes(arg) || /^(--config|--env)=/.test(arg))
if (!['dev', 'deploy'].includes(command) || (command === 'dev' && !args.includes('--remote')) || unsupportedArgs) {
  console.error('Use pnpm --filter api dev:remote or pnpm --filter api deploy:worker. Select the environment through HYPERDRIVE_ID; do not override --config or --env.')
  process.exitCode = 1
} else {
  // Keep the generated file alongside the base config so every relative path,
  // including main, remains relative to the API directory. Git ignores it.
  const configPath = join(apiDirectory, `wrangler.remote.${randomUUID()}.json`)
  try {
    const source = await readFile(join(apiDirectory, 'wrangler.jsonc'), 'utf8')
    const config = createRemoteConfig(source, process.env.HYPERDRIVE_ID, {
      SUPABASE_URL: process.env.SUPABASE_URL, CORS_ORIGIN: process.env.CORS_ORIGIN,
    })
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { flag: 'wx' })
    const require = createRequire(import.meta.url)
    const cli = join(dirname(require.resolve('wrangler/package.json')), 'bin/wrangler.js')
    const child = spawn(process.execPath, [cli, command, '--config', configPath, ...args], {
      cwd: apiDirectory, stdio: 'inherit', env: process.env,
    })
    const stop = () => { child.kill('SIGTERM') }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
    try {
      process.exitCode = await new Promise<number>((resolve, reject) => {
        child.once('error', reject)
        child.once('exit', (code, signal) => resolve(code ?? (signal === 'SIGINT' ? 130 : 1)))
      })
    } finally {
      process.removeListener('SIGINT', stop)
      process.removeListener('SIGTERM', stop)
    }
  } catch (error) {
    // Only show our configuration errors. Raw process errors need not expose
    // paths or external settings to explain that startup failed.
    const message = error instanceof Error ? error.message : ''
    console.error(message.startsWith('Set HYPERDRIVE_ID') || message.startsWith('The base ')
      ? message : 'Could not start Wrangler with the generated remote configuration.')
    process.exitCode = 1
  } finally {
    await rm(configPath, { force: true })
  }
}
