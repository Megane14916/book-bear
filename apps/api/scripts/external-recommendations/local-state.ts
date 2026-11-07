import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const stateDir = resolve(process.env.RECOMMENDATION_EXPERIMENT_DIR
  ?? fileURLToPath(new URL('../../.recommendation-experiments/', import.meta.url)))
export const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
export const elapsed = (start: number) => Math.round(performance.now() - start)

export async function readJson(path: string): Promise<unknown> {
  try { return JSON.parse(await readFile(path, 'utf8')) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

export async function writeJson(path: string, data: unknown) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = path + '.' + randomUUID() + '.tmp'
  try {
    await writeFile(temporary, JSON.stringify(data), 'utf8')
    await rename(temporary, path)
  } finally { await rm(temporary, { force: true }) }
}
