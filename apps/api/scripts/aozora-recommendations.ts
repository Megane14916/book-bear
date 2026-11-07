import { embeddingModel } from '../src/integrations/workers-ai'
import { importAozora, loadAozoraCatalog } from './external-recommendations/aozora-catalog'
import { aozoraArchivePath, aozoraArchiveUrl, indexAozora, indexBudget, localAozoraArchive, planAozoraIndex,
  withAozoraIndexLock } from './external-recommendations/aozora-index'
import { createExperimentAi } from './external-recommendations/rest-ai'

try {
  const [mode, first, second] = process.argv.slice(2)
  if (mode === 'import' && (!first || first === '--refresh') && !second) {
    const { works: _, ...summary } = await importAozora(first === '--refresh')
    console.log(JSON.stringify(summary, null, 2))
  } else if (mode === 'status' && !first) {
    const catalog = await loadAozoraCatalog()
    if (!catalog) throw new Error('Run recommendations:aozora import first')
    const archive = await localAozoraArchive()
    const { state } = await planAozoraIndex(catalog, archive)
    console.log(JSON.stringify({ ...catalog.counts, ...state, archiveAvailable: Boolean(archive) }, null, 2))
  } else if (mode === 'index') {
    const limit = first === '--all' ? Infinity : first === '--limit' && /^\d+$/.test(second ?? '') ? Number(second) : 0
    const flags = process.argv.slice(first === '--all' ? 4 : 5)
    if (!limit || (limit !== Infinity && !Number.isSafeInteger(limit)) || new Set(flags).size !== flags.length
      || flags.some((flag) => !['--execute', '--retry-failed'].includes(flag))) throw new Error('Use index --limit N or index --all [--retry-failed] [--execute]')
    const catalog = await loadAozoraCatalog()
    if (!catalog) throw new Error('Run recommendations:aozora import first')
    const run = async () => {
      const archive = await localAozoraArchive()
      const retry = flags.includes('--retry-failed')
      const { state, queue } = await planAozoraIndex(catalog, archive, retry)
      const selected = queue.slice(0, limit)
      const budget = indexBudget(selected.length)
      const plan = { ...budget, mode: retry ? 'retry-failed' : 'pending', before: state, archiveAvailable: Boolean(archive) }
      if (!flags.includes('--execute')) { console.log(JSON.stringify(plan, null, 2)); return }
      console.error('Aozora index plan ' + JSON.stringify(plan))
      if (!budget.planned) { console.log(JSON.stringify({ ...plan, indexed: 0, calls: 0 }, null, 2)); return }
      if (!archive) throw new Error('Place the Soranoha plaintext ZIP at ' + aozoraArchivePath)
      const { ai, usage } = createExperimentAi(budget.maxCalls, budget.inputCharCap, undefined, 25_000)
      const report = await indexAozora(selected, archive, ai.embed)
      const after = (await planAozoraIndex(catalog, archive)).state
      console.log(JSON.stringify({ ...report, after, catalogHash: catalog.csvHash, model: embeddingModel, usage: usage() }, null, 2))
      if (report.stopped) process.exitCode = 1
    }
    if (flags.includes('--execute')) await withAozoraIndexLock(run)
    else await run()
  } else {
    throw new Error('Use import [--refresh], status, or index (--limit N | --all) [--retry-failed] [--execute]. Place '
      + aozoraArchiveUrl + ' at ' + aozoraArchivePath)
  }
} catch (error) {
  const message = error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT'
    ? 'Place the Soranoha plaintext ZIP at ' + aozoraArchivePath
    : error instanceof Error ? error.message : 'Aozora processing failed'
  console.error(message)
  process.exitCode = 1
}
