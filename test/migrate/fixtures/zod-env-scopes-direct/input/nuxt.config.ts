import { z } from 'zod'

const baseSchema = z.object({
  databaseUrl: z.string(),
  logLevel: z.enum(['debug', 'info', 'warn']).default('info'),
})

export default defineNuxtConfig({
  modules: [
    ['nuxt-safe-runtime-config', { validateAtRuntime: true }],
  ],
  safeRuntimeConfig: {
    $schema: baseSchema,
  },
  $development: {
    runtimeConfig: {
      databaseUrl: '',
    },
    safeRuntimeConfig: {
      $schema: baseSchema.extend({
        debugToken: z.string().optional(),
      }),
    },
  },
})
