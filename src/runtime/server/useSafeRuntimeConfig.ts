/// <reference path="../../runtime-nitro.d.ts" />
// Reads Nitro's runtime config directly. Importing `#imports` on the server makes Nuxt 5 apply its Nitro v2 compatibility layer.
import type { SafeRuntimeConfigEvent } from '../composables/useSafeRuntimeConfig'
import { useRuntimeConfig } from '#safe-runtime-config/nitro-runtime-config'
import { readValidatedRuntimeConfig } from '../config-state'

/**
 * Returns the validated runtime config, typed from your schema.
 * Pass the request event to read the event-scoped config, the validated equivalent of `useRuntimeConfig(event)`.
 *
 * @example
 * ```ts
 * export default defineEventHandler((event) => {
 *   const { secretKey } = useSafeRuntimeConfig(event)
 * })
 * ```
 */
export function useSafeRuntimeConfig(event?: SafeRuntimeConfigEvent): NuxtSafeRuntimeConfig {
  return readValidatedRuntimeConfig(useRuntimeConfig(event)) as NuxtSafeRuntimeConfig
}
