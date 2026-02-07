import { object, string } from 'valibot'
import SafeRuntimeConfig from '../../../src/module'

const runtimeConfigSchema = object({
  public: object({
    apiBase: string(),
  }),
  secretKey: string(),
})

export default defineNuxtConfig({
  modules: [SafeRuntimeConfig],

  nitro: {
    preset: 'cloudflare_module',
  },

  runtimeConfig: {
    secretKey: 'test-secret-key',
    public: {
      apiBase: 'https://api.test.com',
    },
  },

  safeRuntimeConfig: {
    $schema: runtimeConfigSchema,
  },
})
