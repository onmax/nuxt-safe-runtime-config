import { useRuntimeConfig } from '#imports'
import { useValidatedRuntimeConfig } from '../config-state'

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
  return useValidatedRuntimeConfig(useRuntimeConfig()) as NuxtSafeRuntimeConfig
}
