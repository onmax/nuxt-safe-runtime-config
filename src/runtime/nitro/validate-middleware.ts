/// <reference path="../../runtime-nitro.d.ts" />
import process from 'node:process'
import { eventHandler } from '#safe-runtime-config/h3'
import { useRuntimeConfig } from '#safe-runtime-config/nitro-runtime-config'
import { schema } from '#safe-runtime-config/validate'
import { waitForRuntimeConfigValidation } from '../config-state'
import { captureEnvSchemaEnvironment, isEnvSchema } from '../env-schema'

export default eventHandler(async (event): Promise<void> => {
  // Only a fresh Nitro config has a known process-env source. Existing bindings own their values.
  const environment = isEnvSchema(schema) && !event.context.nitro?.runtimeConfig
    ? captureEnvSchemaEnvironment(schema, process.env)
    : undefined
  // Read the event config before awaiting: Nitro 2 on Cloudflare resolves env from a global
  // that the next request overwrites.
  const eventConfig = useRuntimeConfig(event)
  await waitForRuntimeConfigValidation(useRuntimeConfig())
  // Writes the validated values into the event config, which Nuxt renders into the payload.
  await waitForRuntimeConfigValidation(eventConfig, environment)
})
