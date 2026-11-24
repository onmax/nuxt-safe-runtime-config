import { toStandardJsonSchema } from '@valibot/to-json-schema'
import * as v from 'valibot'

export default defineNuxtConfig({
  runtimeConfig: toStandardJsonSchema(v.object({
    googleApiKey: v.pipe(v.string(), v.minLength(1, 'GOOGLE_API_KEY is required')),
    public: v.object({
      siteUrl: v.pipe(v.string(), v.url()),
      plausibleDomain: v.string(),
    }),
  })),
})
