export function getTypedServerConfig(): { secretKey: string, apiBase: string } {
  const config = useSafeRuntimeConfig()
  // @ts-expect-error unknown keys must be rejected to catch typos
  type _InvalidKey = typeof config.notARealConfigKey

  const secretKey: string = config.secretKey
  const apiBase: string = config.public.apiBase

  return {
    secretKey,
    apiBase,
  }
}
