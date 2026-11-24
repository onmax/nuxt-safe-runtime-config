import process from 'node:process'
import { z } from 'zod'

export default defineNuxtConfig({
  future: { compatibilityVersion: 4 },
  modules: [(_options, nuxt) => {
    if ((nuxt.options as { _nitroMajor?: number })._nitroMajor !== 3)
      throw new Error('This regression fixture must use Nitro 3')
  }, 'nuxt-safe-runtime-config'],
  runtimeConfig: {
    quota: 3000,
    appLimit: z.number().default(100),
    apiVersion: '1.00',
    public: { limits: { quota: 3000 } },
  },
  safeRuntimeConfig: process.env.TEST_ENV_SCHEMA
    ? { envSchema: './env.schema' }
    : {
        $schema: z.looseObject({
          quota: z.number(),
          appLimit: z.unknown(),
          apiVersion: z.string(),
          public: z.object({ limits: z.record(z.string(), z.number()) }),
        }),
      },
})
