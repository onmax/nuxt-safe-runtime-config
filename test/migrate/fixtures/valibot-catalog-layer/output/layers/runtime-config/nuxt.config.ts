import { toStandardJsonSchema } from '@valibot/to-json-schema'
import { object, optional, picklist, string } from 'valibot'

export default defineNuxtConfig({
  runtimeConfig: toStandardJsonSchema(object({
    sessionSecret: string(),
    apiKey: string(),
    smtpPassword: string(),
    github: object({
      clientId: string(),
    }),
    stripe: optional(object({
      secretKey: string(),
    })),
    public: object({
      lessons: object({}),
      region: picklist(['eu', 'us']),
      siteName: string(),
    }),
  })),
})
