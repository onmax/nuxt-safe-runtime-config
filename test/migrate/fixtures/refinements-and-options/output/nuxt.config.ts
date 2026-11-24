const featureFlagDefaults = { newDashboard: false, betaExport: true }
const defaultDatabaseUrl = process.env.FIXTURE_UNSET_DATABASE_URL || 'postgres://localhost/portal'

export default defineNuxtConfig({
  modules: ['@nuxt/ui', '@nuxt/eslint', '@pinia/nuxt'],
  runtimeConfig: {
    databaseUrl: defaultDatabaseUrl,
    public: {
      featureFlags: featureFlagDefaults,
      loginMethods: ['email'],
      siteUrl: 'http://localhost:3000',
      maxUploadMb: 10,
    },
  },
})
