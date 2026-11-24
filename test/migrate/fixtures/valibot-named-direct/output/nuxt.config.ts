import { toStandardJsonSchema } from '@valibot/to-json-schema'
import { boolean, number, object, optional, string } from 'valibot'

export default defineNuxtConfig({
  modules: [],
  runtimeConfig: toStandardJsonSchema(object({
    apiSecret: string(),
    port: optional(number(), 3000),
    debug: optional(boolean()),
    public: object({
      apiBase: string(),
    }),
  })),
})
