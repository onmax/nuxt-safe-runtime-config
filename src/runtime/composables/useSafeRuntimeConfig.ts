import { useRuntimeConfig } from '#imports'
import { readValidatedRuntimeConfig } from '../config-state'

declare global {
  interface NuxtSafeRuntimeConfig {}
}

/** Structural H3 event type, compatible with h3 v1 and v2. */
export interface SafeRuntimeConfigEvent {
  context: object
}

/**
 * Returns the runtime config with auto-generated type safety.
 * Types are automatically inferred from your schema defined in nuxt.config.ts.
 *
 * @example
 * ```ts
 * const config = useSafeRuntimeConfig()
 * config.public.apiBase // typed as string
 * ```
 */
export function useSafeRuntimeConfig(event?: SafeRuntimeConfigEvent): NuxtSafeRuntimeConfig {
  // The structural event type matches the h3 version Nuxt or Nitro resolves.
  return readValidatedRuntimeConfig(useRuntimeConfig(event as Parameters<typeof useRuntimeConfig>[0])) as NuxtSafeRuntimeConfig
}
