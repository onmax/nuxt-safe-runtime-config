import { object, string } from 'valibot'

const runtimeConfigSchema = object({
  apiKey: string(),
  public: object({
    siteName: string(),
  }),
})

const runtimeConfig = {
  apiKey: '',
  public: {
    siteName: 'Tiles',
  },
}

export default defineNuxtConfig({
  modules: ['@nuxt/image', 'nuxt-safe-runtime-config'],
  runtimeConfig,
  safeRuntimeConfig: {
    $schema: runtimeConfigSchema,
  },
})
