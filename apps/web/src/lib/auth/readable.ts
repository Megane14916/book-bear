export function canReadPublic(status: string) {
  return status === 'ready' || status === 'guest' || status === 'unconfigured'
}
