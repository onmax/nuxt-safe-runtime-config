import { z } from 'zod'

const baseSchema = z.object({
  databaseUrl: z.string(),
  logLevel: z.enum(['debug', 'info', 'warn']).default('info'),
})

export default defineNuxtConfig({
  modules: [],
  runtimeConfig: baseSchema,
  $development: {
    runtimeConfig: baseSchema.extend({
      debugToken: z.string().optional(),
    }),
  },
})
