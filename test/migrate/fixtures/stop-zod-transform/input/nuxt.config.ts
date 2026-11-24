import { z } from 'zod'

export default defineNuxtConfig({
  modules: ['nuxt-safe-runtime-config'],
  runtimeConfig: {
    port: '3000',
    allowedHosts: '',
  },
  safeRuntimeConfig: {
    $schema: z.object({
      port: z.string().transform(Number),
      allowedHosts: z.string().trim(),
    }),
  },
})
