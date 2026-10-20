/// <reference path="../../runtime-nitro.d.ts" />
import { eventHandler } from '#safe-runtime-config/h3'
import { useRuntimeConfig } from '#safe-runtime-config/nitro-runtime-config'
import { waitForRuntimeConfigValidation } from '../config-state'

export default eventHandler(async (event): Promise<void> => {
  // Read the event config before awaiting: Nitro 2 on Cloudflare resolves env from a global
  // that the next request overwrites.
  const eventConfig = useRuntimeConfig(event)
  await waitForRuntimeConfigValidation(useRuntimeConfig())
  // Writes the validated values into the event config, which Nuxt renders into the payload.
  await waitForRuntimeConfigValidation(eventConfig)
})
