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

  // This config is missing required fields and has wrong types
  runtimeConfig: {
    // Missing databaseUrl and secretKey (required)
    port: 'invalid-number', // Wrong type - should be number
    public: {
      // Missing apiBase (required)
      appName: 'Test App',
    },
  },

  // @ts-expect-error you need to run `prepare` to generate the types
  safeRuntimeConfig: {
    $schema: runtimeConfigSchema,
  },
})
