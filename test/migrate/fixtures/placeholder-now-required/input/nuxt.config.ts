import { object, string } from 'valibot'

const runtimeConfigSchema = object({
  productlaneApiKey: string(),
  oauth: object({
    githubClientSecret: string(),
  }),
})

export default defineNuxtConfig({
  modules: ['nuxt-safe-runtime-config'],
  runtimeConfig: {
    // Contact form: forwarded to Productlane's API
    productlaneApiKey: '',
    oauth: {
      githubClientSecret: '',
    },
    public: {
      siteUrl: 'https://example.com',
    },
  },
  safeRuntimeConfig: {
    $schema: runtimeConfigSchema,
  },
})
