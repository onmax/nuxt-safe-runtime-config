import { number, object, optional, string } from 'valibot'
import SafeRuntimeConfig from '../../../src/module'

const runtimeConfigSchema = object({
  public: object({
    apiBase: string(),
  }),
  secretKey: string(),
  port: optional(number()),
})

export default defineNuxtConfig({
  modules: [SafeRuntimeConfig],

  runtimeConfig: {
    secretKey: 'test-secret-key',
    port: 3000,
    public: {
      apiBase: 'https://api.test.com',
    },
  },

  safeRuntimeConfig: {
    $schema: runtimeConfigSchema,
    validateAtRuntime: true,
  },
})
