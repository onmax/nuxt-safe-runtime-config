import { toStandardJsonSchema } from '@valibot/to-json-schema'
import { object, string } from 'valibot'

const runtimeConfigSchema = object({
  apiKey: string(),
  public: object({
    siteName: string(),
  }),
})

export default defineNuxtConfig({
  runtimeConfig: toStandardJsonSchema(runtimeConfigSchema),
})
