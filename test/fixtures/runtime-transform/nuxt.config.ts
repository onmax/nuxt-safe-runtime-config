import SafeRuntimeConfig from '../../../src/module'

export default defineNuxtConfig({
  modules: [SafeRuntimeConfig],
  runtimeConfig: {
    perfTrace: { enabled: false },
    public: { featureEnabled: false },
  },
  safeRuntimeConfig: {
    $schema: './schema',
    validateAtBuild: false,
    validateAtRuntime: true,
  },
})
