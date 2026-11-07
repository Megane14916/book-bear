import { z } from 'zod'
import { AiUnavailable, workersAi, type AiBinding } from '../../src/integrations/workers-ai'

const usageSchema = z.object({ usage: z.object({
  prompt_tokens: z.number().nonnegative().optional(), completion_tokens: z.number().nonnegative().optional(),
  neurons: z.number().nonnegative().optional(),
}) })

export function createExperimentAi(maxCalls: number, maxInputChars: number, mock?: AiBinding['run'], timeoutMs = 15_000) {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID
  const token = process.env.CLOUDFLARE_API_TOKEN
  if (!mock && (!account || !/^[a-f0-9]{32}$/i.test(account) || !token)) {
    throw new AiUnavailable('Approved Workers AI account ID and API token are required')
  }
  const usage = { calls: 0, inputChars: 0, reportedPromptTokens: 0, reportedCompletionTokens: 0,
    reportedNeurons: 0, tokenMeteredCalls: 0, neuronMeteredCalls: 0 }
  const binding: AiBinding = { async run(model, input) {
    const chars = JSON.stringify(input).length
    if (usage.calls >= maxCalls || usage.inputChars + chars > maxInputChars) throw new AiUnavailable('Experiment AI budget exhausted')
    usage.calls++
    usage.inputChars += chars
    if (mock) return mock(model, input)
    const response = await fetch('https://api.cloudflare.com/client/v4/accounts/' + account + '/ai/run/' + model, {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(input), signal: AbortSignal.timeout(timeoutMs), redirect: 'error',
    })
    if (!response.ok) throw new AiUnavailable('Workers AI REST request failed (HTTP ' + response.status + ')')
    const body = z.object({ success: z.literal(true), result: z.unknown() }).safeParse(await response.json())
    if (!body.success) throw new AiUnavailable('Workers AI returned an unsuccessful response')
    const metered = usageSchema.safeParse(body.data.result)
    if (metered.success) {
      const { prompt_tokens, completion_tokens, neurons } = metered.data.usage
      usage.reportedPromptTokens += prompt_tokens ?? 0
      usage.reportedCompletionTokens += completion_tokens ?? 0
      usage.reportedNeurons += neurons ?? 0
      if (prompt_tokens !== undefined || completion_tokens !== undefined) usage.tokenMeteredCalls++
      if (neurons !== undefined) usage.neuronMeteredCalls++
    }
    return body.data.result
  } }
  return { ai: workersAi({ AI: binding }, timeoutMs), usage: () => ({ ...usage,
    reportedPromptTokens: usage.tokenMeteredCalls ? usage.reportedPromptTokens : null,
    reportedCompletionTokens: usage.tokenMeteredCalls ? usage.reportedCompletionTokens : null,
    reportedNeurons: usage.neuronMeteredCalls ? usage.reportedNeurons : null,
  }) }
}
