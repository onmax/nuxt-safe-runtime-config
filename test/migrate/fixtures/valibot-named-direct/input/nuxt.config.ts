import { boolean, number, object, optional, string } from 'valibot'

export default defineNuxtConfig({
  modules: ['nuxt-safe-runtime-config'],
  runtimeConfig: {
    apiSecret: '',
    public: {
      apiBase: '',
    },
  },
  safeRuntimeConfig: {
    $schema: object({
      apiSecret: string(),
      port: optional(number(), 3000),
      debug: optional(boolean()),
      public: object({
        apiBase: string(),
      }),
    }),
  },
})
