import { type } from 'arktype'

export default defineNuxtConfig({
  modules: ['nuxt-safe-runtime-config'],
  runtimeConfig: {
    apiToken: '',
  },
  safeRuntimeConfig: {
    $schema: type({
      apiToken: 'string',
      port: 'number = 3000',
      public: {
        apiBase: 'string.url',
      },
    }),
  },
})
