import { useSafeRuntimeConfig as useExplicitSafeRuntimeConfig } from '#safe-runtime-config/server'

export function getTypedServerConfig(): { secretKey: string, apiBase: string } {
  const config = useSafeRuntimeConfig()
  const explicitConfig = useExplicitSafeRuntimeConfig()
  // @ts-expect-error unknown keys must be rejected to catch typos
  type _InvalidKey = typeof config.notARealConfigKey
  // @ts-expect-error explicit server imports must reject unknown keys too
  type _InvalidExplicitKey = typeof explicitConfig.notARealConfigKey

  const secretKey: string = explicitConfig.secretKey
  const apiBase: string = config.public.apiBase

  return {
    secretKey,
    apiBase,
  }
}
