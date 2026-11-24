import { array, boolean, minLength, number, object, picklist, pipe, strictObject, string, union, url } from 'valibot'
import { LOGIN_METHODS, MINIMUM_SECRET_LENGTH } from './shared/auth-constants'

const featureFlagDefaults = { newDashboard: false, betaExport: true }
const defaultDatabaseUrl = process.env.FIXTURE_UNSET_DATABASE_URL || 'postgres://localhost/portal'

export default defineNuxtConfig({
  modules: ['@nuxt/ui', '@nuxt/eslint', 'nuxt-safe-runtime-config', '@pinia/nuxt'],
  runtimeConfig: {
    betterAuthSecret: '',
    databaseUrl: defaultDatabaseUrl,
    githubOauth: {
      clientId: '',
      clientSecret: '',
    },
    public: {
      featureFlags: featureFlagDefaults,
      loginMethods: ['email'],
      siteUrl: 'http://localhost:3000',
      maxUploadMb: 10,
    },
  },
  safeRuntimeConfig: {
    $schema: object({
      betterAuthSecret: pipe(string(), minLength(MINIMUM_SECRET_LENGTH)),
      databaseUrl: pipe(string(), url()),
      githubOauth: object({
        clientId: string(),
        clientSecret: string(),
      }),
      public: object({
        featureFlags: strictObject(Object.fromEntries(Object.keys(featureFlagDefaults).map(key => [key, boolean()]))),
        loginMethods: array(picklist(LOGIN_METHODS)),
        siteUrl: pipe(string(), url()),
        maxUploadMb: union([number(), string()]),
      }),
    }),
    validateAtBuild: false,
    validateAtRuntime: true,
    onError: 'throw',
  },
})
