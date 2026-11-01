import { parse, type ParseError } from 'jsonc-parser'

type HyperdriveConfig = { binding: string; id: string; [key: string]: unknown }
export type RemoteConfig = Record<string, unknown> & { hyperdrive: HyperdriveConfig[] }

export function createRemoteConfig(source: string, hyperdriveId: string | undefined): RemoteConfig {
  const id = hyperdriveId?.trim()
  if (!id || !/^[a-f0-9]{32}$/i.test(id) || /^0{32}$/.test(id)) {
    throw new Error('Set HYPERDRIVE_ID to your 32-character Hyperdrive ID in apps/api/.env.deploy.local or the shell environment.')
  }
  const errors: ParseError[] = []
  const config: unknown = parse(source, errors, { allowTrailingComma: true })
  if (errors.length || typeof config !== 'object' || config === null || Array.isArray(config)) {
    throw new Error('The base wrangler.jsonc is not a valid configuration object.')
  }
  const base = config as Record<string, unknown>
  if (!Array.isArray(base.hyperdrive)) throw new Error('The base config must contain a HYPERDRIVE binding.')
  const bindings = base.hyperdrive as HyperdriveConfig[]
  if (bindings.filter((binding) => binding?.binding === 'HYPERDRIVE').length !== 1) {
    throw new Error('The base config must contain exactly one HYPERDRIVE binding.')
  }
  return {
    ...base,
    hyperdrive: bindings.map((binding) => binding.binding === 'HYPERDRIVE' ? { ...binding, id } : binding),
  }
}
