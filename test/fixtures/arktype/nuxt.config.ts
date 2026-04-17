import { type } from 'arktype'
import SafeRuntimeConfig from '../../../src/module'

const runtimeConfigSchema = type({
  'public': {
    'apiBase': 'string',
    'appName?': 'string',
  },
  'databaseUrl': 'string',
  'secretKey': 'string',
  'port?': 'number',
})

export default defineNuxtConfig({
  modules: [SafeRuntimeConfig],
  runtimeConfig: {
    databaseUrl: 'postgresql://localhost:5432/app',
    secretKey: 'test-secret',
    port: 3000,
    public: {
      apiBase: 'https://api.example.com',
      appName: 'ArkType Test',
    },
  },
  safeRuntimeConfig: {
    $schema: runtimeConfigSchema,
  },
})
