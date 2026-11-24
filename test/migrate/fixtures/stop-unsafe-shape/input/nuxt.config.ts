import * as v from 'valibot'

const shared = {
  safeRuntimeConfig: {
    $schema: v.object({ apiKey: v.string() }),
  },
}

export default defineNuxtConfig({
  modules: ['nuxt-safe-runtime-config'],
  ...shared,
})
