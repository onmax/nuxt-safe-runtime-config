import { defineNitroConfig } from 'nitropack/config'
import { number, object, string } from 'valibot'
import SafeRuntimeConfig from '../../../src/nitro'

const runtimeConfigSchema = object({
  port: number(),
  secretKey: string(),
  public: object({ apiBase: string() }),
})

export default defineNitroConfig({
  modules: [SafeRuntimeConfig],
  runtimeConfig: {
    port: 'not-a-number',
    secretKey: 'test-secret',
    public: { apiBase: 'https://api.example.com' },
  },
  safeRuntimeConfig: {
    $schema: runtimeConfigSchema,
    validateAtBuild: false,
    validateAtRuntime: true,
  },
})
