import { defineNitroConfig } from 'nitro/config'
import SafeRuntimeConfig from '../../../src/nitro'
import { invalidRuntimeConfig, runtimeConfigSchema } from '../_shared/nitro-runtime-config-schema'

export default defineNitroConfig({
  modules: [SafeRuntimeConfig],
  runtimeConfig: invalidRuntimeConfig,
  handlers: [{ route: '/port', handler: './port' }],
  safeRuntimeConfig: { $schema: runtimeConfigSchema, validateAtBuild: false, validateAtRuntime: true },
})
