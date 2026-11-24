import process from 'node:process'
import { object, optional, picklist, string } from 'valibot'

const lessons = [{ title: 'Lesson 1' }]

export default defineNuxtConfig({
  modules: ['nuxt-safe-runtime-config'],
  runtimeConfig: {
    sessionSecret: process.env.FIXTURE_SESSION_SECRET,
    apiKey: process.env.FIXTURE_API_KEY || '',
    smtpPassword: 31415926,
    github: {
      clientId: process.env.FIXTURE_GITHUB_CLIENT_ID,
    },
    public: {
      lessons,
      region: 'moon',
      siteName: 'Lingo',
    },
  },
  safeRuntimeConfig: {
    $schema: object({
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
    }),
  },
})
