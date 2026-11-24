import * as v from 'valibot'

export default defineNuxtConfig({
  modules: ['nuxt-safe-runtime-config'],
  runtimeConfig: {
    databaseUrl: '',
  },
  safeRuntimeConfig: {
    $schema: v.object({
      databaseUrl: v.string(),
    }),
  },
})
