import * as v from 'valibot'

const isProduction = process.env.NODE_ENV === 'production'

export default defineNuxtConfig({
  modules: ['./modules/better-auth', 'nuxt-safe-runtime-config'],
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
  safeRuntimeConfig: {
    $schema: v.looseObject({
      oauth: v.object({
        github: v.object({
          clientId: isProduction ? v.pipe(v.string(), v.minLength(1)) : v.optional(v.string()),
        }),
      }),
      email: v.object({
        provider: v.picklist(['console', 'resend']),
      }),
      public: v.object({
        siteUrl: v.pipe(v.string(), v.url()),
      }),
    }),
  },
})
