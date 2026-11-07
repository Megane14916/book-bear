export class ApiError extends Error {
  constructor(
    public readonly kind: 'http' | 'network' | 'auth' | 'response',
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export class HttpError extends ApiError {
  readonly code: string | null
  readonly details?: Record<string, unknown>

  constructor(public readonly status: number, payload?: unknown) {
    const body = isRecord(payload) && isRecord(payload.error) ? payload.error : undefined
    super('http', typeof body?.message === 'string' ? body.message : `APIリクエストに失敗しました（HTTP ${status}）。`)
    this.name = 'HttpError'
    this.code = typeof body?.code === 'string' ? body.code : null
    this.details = isRecord(body?.details) ? body.details : undefined
  }
}

export function isAbortError(error: unknown): error is Error & { name: 'AbortError' | 'CancelledError' } {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'CancelledError')
}

export function throwIfAborted(signal: AbortSignal) {
  // AbortController.abort(reason) accepts any value, including sensitive text.
  // Keep cancellation recognizable and never expose the caller's raw reason.
  if (signal.aborted) throw new DOMException('通信を中断しました。', 'AbortError')
}
