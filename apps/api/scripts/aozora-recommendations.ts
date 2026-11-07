import { embeddingModel } from '../src/integrations/workers-ai'
import { importAozora, loadAozoraCatalog } from './external-recommendations/aozora-catalog'
import { aozoraArchivePath, aozoraArchiveUrl, indexAozora, indexLimit } from './external-recommendations/aozora-index'
import { createExperimentAi } from './external-recommendations/rest-ai'

try {
  const [mode, first, second, third, ...rest] = process.argv.slice(2)
  if (mode === 'import' && (!first || first === '--refresh') && !second) {
    const { works: _, ...summary } = await importAozora(first === '--refresh')
    console.log(JSON.stringify(summary, null, 2))
  } else if (mode === 'index' && first === '--limit' && /^\d+$/.test(second ?? '') && third === '--execute' && !rest.length) {
    const limit = Number(second)
    if (limit < 1 || limit > indexLimit) throw new Error('Limit must be between 1 and ' + indexLimit)
    const catalog = await loadAozoraCatalog()
    if (!catalog) throw new Error('Run recommendations:aozora import first')
    const { ai, usage } = createExperimentAi(Math.ceil(limit / 8), 1_000_000)
    const report = await indexAozora(catalog, limit, ai.embed)
    console.log(JSON.stringify({ ...report, catalogHash: catalog.csvHash, model: embeddingModel, usage: usage() }, null, 2))
  } else {
    throw new Error('Use import [--refresh] or index --limit <1-300> --execute. Place ' + aozoraArchiveUrl + ' at ' + aozoraArchivePath)
  }
} catch (error) {
  const message = error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT'
    ? 'Place the Soranoha plaintext ZIP at ' + aozoraArchivePath
    : error instanceof Error ? error.message : 'Aozora processing failed'
  console.error(message)
  process.exitCode = 1
}
