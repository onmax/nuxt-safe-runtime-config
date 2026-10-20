import { array, boolean, minLength, number, object, picklist, pipe, string } from 'valibot'
import SafeRuntimeConfig from '../../../src/module'

export default defineNuxtConfig({
  modules: [SafeRuntimeConfig],
  runtimeConfig: {
    // Supplied by the deployment environment, empty at build time.
    secret: '',
    perfTrace: { enabled: false },
    public: {
      posthog: { enabled: false, sampleRate: 0.1 },
      logins: ['email'],
    },
  },
  safeRuntimeConfig: {
    $schema: object({
      secret: pipe(string(), minLength(8)),
      perfTrace: object({ enabled: boolean() }),
      public: object({
        posthog: object({ enabled: boolean(), sampleRate: number() }),
        logins: array(picklist(['email', 'github'])),
      }),
    }),
    validateAtBuild: false,
    validateAtRuntime: true,
  },
})
