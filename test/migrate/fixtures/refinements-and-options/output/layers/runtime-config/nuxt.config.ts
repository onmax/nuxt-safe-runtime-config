import { toStandardJsonSchema } from '@valibot/to-json-schema'
import { array, boolean, minLength, number, object, picklist, pipe, strictObject, string, union, url } from 'valibot'
import { LOGIN_METHODS, MINIMUM_SECRET_LENGTH } from '../../shared/auth-constants'

const featureFlagDefaults = { newDashboard: false, betaExport: true }

export default defineNuxtConfig({
  runtimeConfig: toStandardJsonSchema(object({
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
  })),
})
