import { defineNitroConfig } from 'nitro/config'
import SafeRuntimeConfig from '../../../src/nitro'
import { runtimeConfigSchema, validRuntimeConfig } from '../_shared/nitro-runtime-config-schema'

export default defineNitroConfig({
  modules: [SafeRuntimeConfig],
  // The port comes from the environment at startup, so the build has only a placeholder.
  runtimeConfig: { ...validRuntimeConfig, port: '' },
  handlers: [{ route: '/port', handler: './port' }],
  safeRuntimeConfig: { $schema: runtimeConfigSchema },
})
