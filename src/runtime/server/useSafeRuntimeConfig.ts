import { useRuntimeConfig } from '#imports'

declare global {
  interface NuxtSafeRuntimeConfig {}
}

export function useSafeRuntimeConfig(): NuxtSafeRuntimeConfig {
  return useRuntimeConfig() as NuxtSafeRuntimeConfig
}
