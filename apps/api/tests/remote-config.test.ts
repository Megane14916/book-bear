import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { createRemoteConfig } from '../scripts/remote-config'

const id = '1234567890abcdef1234567890abcdef'
const base = `{
  // Relative paths must keep their meaning in the generated file.
  "main": "src/index.ts",
  "compatibility_flags": ["nodejs_compat"],
  "vars": {"CORS_ORIGIN": "http://localhost:5173"},
  "hyperdrive": [
    {"binding": "HYPERDRIVE", "id": "00000000000000000000000000000000", "localConnectionString": "postgres://local"},
    {"binding": "OTHER_DATABASE", "id": "other-id"},
  ],
}`

describe('environment-based remote config', () => {
  it('環境変数のIDを指定bindingだけへ反映し、パス・他binding・varsを保持する', () => {
    const config = createRemoteConfig(base, ` ${id} `)
    expect(config.main).toBe('src/index.ts')
    expect(config.compatibility_flags).toEqual(['nodejs_compat'])
    expect(config.vars).toEqual({ CORS_ORIGIN: 'http://localhost:5173' })
    expect(config.hyperdrive).toEqual([
      { binding: 'HYPERDRIVE', id, localConnectionString: 'postgres://local' },
      { binding: 'OTHER_DATABASE', id: 'other-id' },
    ])
  })
  it.each([undefined, '', ' ', 'YOUR_HYPERDRIVE_ID', '0'.repeat(32), 'abc', '../config.json'])('未設定・仮ID・不正IDでリモート操作を開始しない', (value) => {
    expect(() => createRemoteConfig(base, value)).toThrow('Set HYPERDRIVE_ID')
  })
  it.each(['{', 'null', '[]', '{}', '{"hyperdrive": []}', '{"hyperdrive":[{"binding":"HYPERDRIVE"},{"binding":"HYPERDRIVE"}]}'])('壊れた設定やbindingの欠落・重複を拒否する', (source) => {
    expect(() => createRemoteConfig(source, id)).toThrow()
  })
  it('実際のベース設定は仮IDのまま保持し、生成結果だけにIDを反映する', async () => {
    const path = new URL('../wrangler.jsonc', import.meta.url)
    const source = await readFile(path, 'utf8')
    expect(createRemoteConfig(source, id).hyperdrive.find((binding) => binding.binding === 'HYPERDRIVE')?.id).toBe(id)
    expect(await readFile(path, 'utf8')).toBe(source)
    expect(source).toContain('00000000000000000000000000000000')
    expect(source).not.toContain(id)
  })
})
