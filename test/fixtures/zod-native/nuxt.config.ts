import { z } from 'zod'
import SafeRuntimeConfig from '../../../src/module'

const runtimeConfigSchema = z.object({
  public: z.object({
    apiBase: z.string(),
  }),
  secretKey: z.string(),
})

export default defineNuxtConfig({
  modules: [SafeRuntimeConfig],

  runtimeConfig: {
    secretKey: 'test-secret-key',
    public: {
      apiBase: 'https://api.test.com',
    },
  },

  safeRuntimeConfig: {
    $schema: runtimeConfigSchema,
    validateAtRuntime: true,
    jsonSchemaTarget: 'draft-2020-12',
  },
})
