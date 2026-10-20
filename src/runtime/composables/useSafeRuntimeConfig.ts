import { useRuntimeConfig } from '#imports'
import { ensureRuntimeConfigValidation, useValidatedRuntimeConfig } from '../config-state'

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
 * Pass the request event in server handlers to read the event-scoped config,
 * the validated equivalent of `useRuntimeConfig(event)`.
 *
 * @example
 * ```ts
 * // Types are auto-generated - no generic needed!
 * const config = useSafeRuntimeConfig()
 * config.secretKey // typed as string
 * config.public.apiBase // typed as string
 *
 * export default defineEventHandler((event) => {
 *   const { secretKey } = useSafeRuntimeConfig(event)
 * })
 * ```
 */
export function useSafeRuntimeConfig(event?: SafeRuntimeConfigEvent): NuxtSafeRuntimeConfig {
  // The structural event type matches the h3 version Nuxt or Nitro resolves.
  const config = useRuntimeConfig(event as Parameters<typeof useRuntimeConfig>[0])
  // Event configs, including Nuxt's server-side `$config`, validate on first read.
  // Asynchronous schemas were already awaited by the validation middleware.
  void ensureRuntimeConfigValidation(config)
  return useValidatedRuntimeConfig(config) as NuxtSafeRuntimeConfig
}
