import { defineNuxtPlugin } from '#app'
import { ensureRuntimeConfigValidation, mergeTransformedRuntimeConfig, useValidatedRuntimeConfig } from '../config-state'

export default defineNuxtPlugin(async (nuxtApp) => {
  // On the server, `$config` is the event-scoped runtime config.
  const runtimeConfig = nuxtApp.$config as Record<string, unknown>
  await ensureRuntimeConfigValidation(runtimeConfig)
  const config = useValidatedRuntimeConfig(runtimeConfig)
  if (config === runtimeConfig)
    return

  if (!config.public || typeof config.public !== 'object' || Array.isArray(config.public))
    return

  const ssrConfig = nuxtApp.ssrContext?.config as { public: unknown } | undefined
  if (ssrConfig)
    ssrConfig.public = mergeTransformedRuntimeConfig(ssrConfig.public, config.public)
})
