import { z } from 'zod'

export default defineNuxtConfig({
  modules: ['nuxt-safe-runtime-config'],
  safeRuntimeConfig: {
    $schema: z.object({
      apiKey: z.string().optional(),
    }),
  },
})
