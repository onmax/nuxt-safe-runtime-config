import { defineNitroConfig } from 'nitro/config'
import SafeRuntimeConfig from '../../../src/nitro'
import { runtimeConfigSchema, validRuntimeConfig } from '../_shared/nitro-runtime-config-schema'

export default defineNitroConfig({
  modules: [SafeRuntimeConfig],
  plugins: ['./plugin'],
  runtimeConfig: validRuntimeConfig,
  safeRuntimeConfig: { $schema: runtimeConfigSchema, validateAtRuntime: true },
})
