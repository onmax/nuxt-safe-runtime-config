import { defineNuxtPlugin } from '#app'
import { mergeTransformedRuntimeConfig, useValidatedRuntimeConfig } from '../config-state'

export default defineNuxtPlugin((nuxtApp) => {
  const config = useValidatedRuntimeConfig(nuxtApp.$config as Record<string, unknown>)
  if (!config.public || typeof config.public !== 'object' || Array.isArray(config.public))
    return

  const ssrConfig = nuxtApp.ssrContext?.config as { public: unknown } | undefined
  if (ssrConfig)
    ssrConfig.public = mergeTransformedRuntimeConfig(ssrConfig.public, config.public)
})
