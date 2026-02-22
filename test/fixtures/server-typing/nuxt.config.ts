import { defineNuxtConfig } from 'nuxt/config'
import SafeRuntimeConfig from '../../../src/module'
import { runtimeConfigSchema } from './schema'

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
  },
})
