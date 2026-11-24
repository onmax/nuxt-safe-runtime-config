import { toStandardJsonSchema } from '@valibot/to-json-schema'
import { runtimeConfigSchema } from '../../runtime-config.schema'

export default defineNuxtConfig({
  runtimeConfig: toStandardJsonSchema(runtimeConfigSchema),
})
