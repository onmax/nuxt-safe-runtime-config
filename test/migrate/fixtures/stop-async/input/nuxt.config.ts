import { z } from 'zod'

export default defineNuxtConfig({
  modules: ['nuxt-safe-runtime-config'],
  runtimeConfig: {
    apiKey: '',
  },
  safeRuntimeConfig: {
    $schema: z.object({
      apiKey: z.string().refine(async value => value.length > 0),
    }),
  },
})
