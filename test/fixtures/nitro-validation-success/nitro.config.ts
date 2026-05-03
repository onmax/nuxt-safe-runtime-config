import { defineNitroConfig } from 'nitropack/config'
import SafeRuntimeConfig from '../../../src/nitro'
import { runtimeConfigSchema, validRuntimeConfig } from '../_shared/nitro-runtime-config-schema'

export default defineNitroConfig({
  modules: [SafeRuntimeConfig],
  runtimeConfig: validRuntimeConfig,
  safeRuntimeConfig: { $schema: runtimeConfigSchema, validateAtRuntime: true },
})
