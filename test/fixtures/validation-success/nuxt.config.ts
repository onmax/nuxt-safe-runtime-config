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
    databaseUrl: 'postgresql://localhost:5432/test',
    secretKey: 'test-secret-key',
    port: 3000,
    public: {
      apiBase: 'https://api.test.com',
      appName: 'Test App',
    },
  },

  // @ts-expect-error you need to run `prepare` to generate the types
  safeRuntimeConfig: {
    $schema: runtimeConfigSchema,
  },
})
