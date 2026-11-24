import { toStandardJsonSchema } from '@valibot/to-json-schema'
import * as v from 'valibot'

export default defineNuxtConfig({
  modules: [],
  runtimeConfig: toStandardJsonSchema(v.object({
    databaseUrl: v.string(),
  })),
})
