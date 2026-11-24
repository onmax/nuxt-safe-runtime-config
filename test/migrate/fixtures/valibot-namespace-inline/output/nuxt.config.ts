const siteUrl = 'https://example.com'

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: [
    '@nuxt/content',
  ],

  runtimeConfig: {
    studioAccess: {
      allowedGitHubProviderIds: ['1234'],
    },
    public: {
      siteUrl,
      plausibleDomain: process.env.FIXTURE_UNSET_PLAUSIBLE_DOMAIN || '',
    },
  },

  compatibilityDate: '2025-07-15',
})
