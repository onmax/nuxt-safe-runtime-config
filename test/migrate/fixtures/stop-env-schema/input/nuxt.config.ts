export default defineNuxtConfig({
  modules: ['nuxt-safe-runtime-config'],
  runtimeConfig: {
    apiKey: '',
  },
  safeRuntimeConfig: {
    envSchema: '.env.schema',
  },
})
