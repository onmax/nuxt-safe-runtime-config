import SafeRuntimeConfig from '../../../src/module'

export default defineNuxtConfig({
  modules: [SafeRuntimeConfig],
  runtimeConfig: {
    databaseUrl: '',
  },
  safeRuntimeConfig: {
    // The test points SHELVE_URL at a mock API.
    shelve: { project: 'app', slug: 'team', fetchAtBuild: false, fetchAtRuntime: true },
  },
})
