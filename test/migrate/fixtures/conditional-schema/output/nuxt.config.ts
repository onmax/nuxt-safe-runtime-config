export default defineNuxtConfig({
  modules: ['./modules/better-auth'],
  runtimeConfig: {
    oauth: {
      github: {
        clientId: process.env.FIXTURE_UNSET_GITHUB_CLIENT_ID || '',
      },
    },
    email: {
      provider: process.env.FIXTURE_UNSET_EMAIL_PROVIDER || 'console',
    },
    public: {
      siteUrl: process.env.FIXTURE_UNSET_SITE_URL || 'http://localhost:3000',
    },
  },
})
