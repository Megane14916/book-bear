import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import app, { openApiConfig } from '../src/index'

const output = fileURLToPath(new URL('../../../contracts/openapi.json', import.meta.url))
const document = `${JSON.stringify(app.getOpenAPIDocument(openApiConfig), null, 2)}\n`
if (process.argv.includes('--check')) {
  const existing = await readFile(output, 'utf8').catch(() => '')
  if (existing !== document) {
    console.error('OpenAPI contract is out of date. Run pnpm generate:openapi.')
    process.exitCode = 1
  }
} else {
  await writeFile(output, document)
}
