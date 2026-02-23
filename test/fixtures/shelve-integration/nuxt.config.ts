import SafeRuntimeConfig from '../../../src/module'

export default defineNuxtConfig({
  modules: [SafeRuntimeConfig],

  runtimeConfig: {
    existingKey: 'existing-value',
    public: { baseUrl: 'https://example.com' },
  },

  // Shelve remains disabled when not explicitly configured
  safeRuntimeConfig: {},
})
