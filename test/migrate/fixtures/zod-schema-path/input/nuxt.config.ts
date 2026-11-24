export default defineNuxtConfig({
  modules: [
    'nuxt-safe-runtime-config',
  ],
  safeRuntimeConfig: {
    $schema: './server/runtime-config.schema',
  },
})
