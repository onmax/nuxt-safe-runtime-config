import SafeRuntimeConfig from '../../../src/module'

export default defineNuxtConfig({
  modules: [SafeRuntimeConfig],
  runtimeConfig: {
    perfTrace: { enabled: false },
    public: {
      featureEnabled: false,
      moduleConfig: { label: 'keep', nested: { count: 1 } },
    },
  },
  safeRuntimeConfig: {
    $schema: './schema',
    validateAtBuild: false,
    validateAtRuntime: true,
  },
})
