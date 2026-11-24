import { toStandardJsonSchema } from '@valibot/to-json-schema'
import { object, optional, string } from 'valibot'

const productionRuntimeConfigSchema = object({
  betterAuthSecret: string(),
  public: object({
    nimiqNetwork: string(),
  }),
})

const developmentRuntimeConfigSchema = object({
  betterAuthSecret: string(),
  public: object({
    nimiqNetwork: string(),
    devToolsUrl: optional(string()),
  }),
})

export default defineNuxtConfig({
  runtimeConfig: toStandardJsonSchema(productionRuntimeConfigSchema),
  $development: {
    runtimeConfig: toStandardJsonSchema(developmentRuntimeConfigSchema),
  },
  $production: {
    runtimeConfig: toStandardJsonSchema(productionRuntimeConfigSchema),
  },
})
