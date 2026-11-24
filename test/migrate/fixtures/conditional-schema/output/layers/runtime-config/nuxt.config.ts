import { toStandardJsonSchema } from '@valibot/to-json-schema'
import * as v from 'valibot'

const isProduction = process.env.NODE_ENV === 'production'

export default defineNuxtConfig({
  runtimeConfig: toStandardJsonSchema(v.looseObject({
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
  })),
})
