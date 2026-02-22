export function getTypedServerConfig(): { secretKey: string, apiBase: string } {
  const config = useSafeRuntimeConfig()

  const secretKey: string = config.secretKey
  const apiBase: string = config.public.apiBase

  return {
    secretKey,
    apiBase,
  }
}
