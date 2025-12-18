import { z } from 'zod'
import SafeRuntimeConfig from '../../../src/module'

// Schema expects secretKey to be a string, but we'll set it to a number at runtime
const runtimeConfigSchema = z.object({
  public: z.object({
    apiBase: z.string(),
  }),
  secretKey: z.string().min(10), // Must be at least 10 chars
})

export default defineNuxtConfig({
  modules: [SafeRuntimeConfig],

  runtimeConfig: {
    // Valid at build time (passes build validation)
    secretKey: 'valid-secret-key-for-build',
    public: {
      apiBase: 'https://api.test.com',
    },
  },

  safeRuntimeConfig: {
    $schema: runtimeConfigSchema,
    validateAtBuild: false, // Skip build validation for this test
    validateAtRuntime: true,
  },
})
