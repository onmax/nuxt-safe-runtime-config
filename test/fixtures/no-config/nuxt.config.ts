import SafeRuntimeConfig from '../../../src/module'

export default defineNuxtConfig({
  modules: [SafeRuntimeConfig],

  runtimeConfig: {
    databaseUrl: 'postgresql://localhost:5432/test',
    secretKey: 'test-secret-key',
    port: 3000,
    public: {
      apiBase: 'https://api.test.com',
      appName: 'Test App',
    },
  },

  // No safeRuntimeConfig configuration - this should work without validation
})
