import * as v from 'valibot'

const siteUrl = 'https://example.com'

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: [
    '@nuxt/content',
    'nuxt-safe-runtime-config',
  ],

  runtimeConfig: {
    googleApiKey: '',
    studioAccess: {
      allowedGitHubProviderIds: ['1234'],
    },
    public: {
      siteUrl,
      plausibleDomain: process.env.FIXTURE_UNSET_PLAUSIBLE_DOMAIN || '',
    },
  },

  safeRuntimeConfig: {
    $schema: v.object({
      googleApiKey: v.pipe(v.string(), v.minLength(1, 'GOOGLE_API_KEY is required')),
      public: v.object({
        siteUrl: v.pipe(v.string(), v.url()),
        plausibleDomain: v.string(),
      }),
    }),
  },

  compatibilityDate: '2025-07-15',
})
