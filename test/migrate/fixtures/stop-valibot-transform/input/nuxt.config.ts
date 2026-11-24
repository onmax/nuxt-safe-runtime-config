import { object, pipe, string, transform, trim } from 'valibot'

export default defineNuxtConfig({
  modules: ['nuxt-safe-runtime-config'],
  runtimeConfig: {
    apiKey: '',
    port: '3000',
  },
  safeRuntimeConfig: {
    $schema: object({
      apiKey: pipe(string(), trim()),
      port: pipe(string(), transform(Number)),
    }),
  },
})
