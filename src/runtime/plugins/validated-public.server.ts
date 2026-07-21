import { defineNuxtPlugin } from '#app'
import { mergeTransformedRuntimeConfig, runtimeValidationContextKey, setRuntimeValidationState } from '../config-state'

export default defineNuxtPlugin((nuxtApp) => {
  const event = nuxtApp.ssrContext?.event
  const config = event && Reflect.get(event.context, runtimeValidationContextKey) as Record<string, unknown> | undefined
  if (!config || !config.public || typeof config.public !== 'object' || Array.isArray(config.public))
    return

  setRuntimeValidationState(nuxtApp.$config as Record<string, unknown>, { status: 'valid', value: config })

  const ssrConfig = nuxtApp.ssrContext?.config as { public: unknown } | undefined
  if (ssrConfig)
    ssrConfig.public = mergeTransformedRuntimeConfig(ssrConfig.public, config.public)
})
