import { minLength, object, pipe, string } from 'valibot'
import SafeRuntimeConfig from '../../../src/module'

export default defineNuxtConfig({
  modules: [SafeRuntimeConfig],
  runtimeConfig: {
    // Fetched from Shelve when the server starts.
    databaseUrl: '',
    github: { clientId: '' },
  },
  safeRuntimeConfig: {
    $schema: object({
      databaseUrl: pipe(string(), minLength(1)),
      github: object({ clientId: string(), clientSecret: pipe(string(), minLength(1)) }),
    }),
    validateAtRuntime: true,
    // The test points SHELVE_URL at a mock API.
    shelve: { project: 'app', slug: 'team', fetchAtBuild: false, fetchAtRuntime: true },
  },
})
