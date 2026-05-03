import { defineNitroConfig } from 'nitropack/config'
import SafeRuntimeConfig from '../../../src/nitro'
import { invalidRuntimeConfig, runtimeConfigSchema } from '../_shared/nitro-runtime-config-schema'

export default defineNitroConfig({
  modules: [SafeRuntimeConfig],
  runtimeConfig: invalidRuntimeConfig,
  safeRuntimeConfig: { $schema: runtimeConfigSchema },
})
