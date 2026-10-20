import { useRuntimeConfig } from '#imports'
import { ensureRuntimeConfigValidation, useValidatedRuntimeConfig } from '../config-state'

declare global {
  interface NuxtSafeRuntimeConfig {}
}

/**
 * Returns the runtime config with auto-generated type safety.
 * Types are automatically inferred from your schema defined in nuxt.config.ts.
 *
 * @example
 * ```ts
 * // Types are auto-generated - no generic needed!
 * const config = useSafeRuntimeConfig()
 * config.secretKey // typed as string
 * config.public.apiBase // typed as string
 * ```
 */
export function useSafeRuntimeConfig(): NuxtSafeRuntimeConfig {
  const config = useRuntimeConfig()
  // Nuxt's server-side `$config` is event-scoped and validates on first read.
  // Asynchronous schemas were already awaited by the validation middleware.
  void ensureRuntimeConfigValidation(config)
  return useValidatedRuntimeConfig(config) as NuxtSafeRuntimeConfig
}
