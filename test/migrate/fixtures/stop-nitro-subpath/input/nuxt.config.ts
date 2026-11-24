import * as v from 'valibot'

export default defineNuxtConfig({
  modules: ['nuxt-safe-runtime-config'],
  safeRuntimeConfig: {
    $schema: v.object({ apiKey: v.string() }),
  },
})
