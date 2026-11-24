import { toStandardJsonSchema } from '@valibot/to-json-schema'
import { object, string } from 'valibot'

const runtimeConfigSchema = object({
  productlaneApiKey: string(),
  oauth: object({
    githubClientSecret: string(),
  }),
})

export default defineNuxtConfig({
  runtimeConfig: toStandardJsonSchema(runtimeConfigSchema),
})
