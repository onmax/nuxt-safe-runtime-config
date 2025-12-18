import { number, object, optional, string } from 'valibot'
import SafeRuntimeConfig from '../../../src/module'

const runtimeConfigSchema = object({
  public: object({
    apiBase: string(),
    appName: optional(string()),
  }),
  databaseUrl: string(),
  secretKey: string(),
  port: optional(number()),
})

export default defineNuxtConfig({
  modules: [SafeRuntimeConfig],

  runtimeConfig: {
    databaseUrl: '',
    secretKey: '',
    port: 3000,
    public: {
      apiBase: '',
      appName: 'Test App',
    },
  },

  safeRuntimeConfig: {
    $schema: runtimeConfigSchema,
  },
})
