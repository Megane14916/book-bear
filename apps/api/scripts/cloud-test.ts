import { execFileSync } from 'node:child_process'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline/promises'
import { CloudTestError, confirmTarget, readCloudConfig } from './cloud-test/config'
import { openObserver } from './cloud-test/database'
import { failure, runCloudTest } from './cloud-test/runner'

// pnpm runs this script in apps/api; keep CA paths and output consistent even
// if the entry point is invoked directly from another working directory.
process.chdir(fileURLToPath(new URL('../', import.meta.url)))
try {
  const [command, ...extra] = process.argv.slice(2)
  if (!['check', 'run'].includes(command) || extra.length) throw new CloudTestError('command', 'Use test:cloud check or test:cloud run')
  const config = readCloudConfig(process.env)
  if (command === 'check') {
    console.log('Local configuration is valid. No network requests were made; deployed settings are NOT verified.')
  } else {
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw new CloudTestError('manual-confirmation', 'Run interactively after checking the development Dashboards')
    console.log('Check the ACTUAL deployed Worker binding, Hyperdrive origin/role/cache-disabled, Supabase project, migrations/grants, and observation DB endpoint in the Dashboards now. Never select production.')
    const input = createInterface({ input: process.stdin, output: process.stdout })
    let manual
    try {
      manual = confirmTarget(config, {
        origin: (await input.question('Approved development Worker HTTPS origin: ')).trim(),
        projectRef: (await input.question('Approved development Supabase project ref: ')).trim(),
        workerName: (await input.question('Checked deployed Worker name: ')).trim(),
        deploymentVersion: (await input.question('Checked deployment version ID: ')).trim(),
        hyperdriveId: (await input.question('Checked actual Hyperdrive binding ID: ')).trim(),
        checked: (await input.question('After verifying ALL settings above, type "development verified": ')).trim(),
      })
    } finally { input.close() }
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    const directory = new URL('../.cloud-test-results/', import.meta.url)
    await mkdir(directory, { recursive: true })
    const report = await runCloudTest(config, manual, { fetcher: fetch, openDatabase: () => openObserver(config), commit,
      save: async (value) => {
        const temporary = new URL(`${value.runId}.tmp`, directory)
        await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
        await rename(temporary, new URL(`${value.runId}.json`, directory))
      },
    })
    console.log(JSON.stringify({ runId: report.runId, result: report.result, cleanup: report.cleanup,
      retainedBook: report.retainedBook, failure: report.failure, cleanupFailure: report.cleanupFailure }))
    console.log(`Local record: apps/api/.cloud-test-results/${report.runId}.json`)
    process.exitCode = report.result === 'passed' ? 0 : 1
  }
} catch (error) {
  console.error(JSON.stringify(failure(error, 'cloud-test')))
  process.exitCode = 1
}
