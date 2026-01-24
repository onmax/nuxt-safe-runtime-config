import SafeRuntimeConfig from '../../../src/module'

export default defineNuxtConfig({
  modules: [SafeRuntimeConfig],

  runtimeConfig: {
    existingKey: 'existing-value',
    public: { baseUrl: 'https://example.com' },
  },

  // Shelve disabled since no shelve.json exists and not explicitly enabled
  safeRuntimeConfig: {},
})
