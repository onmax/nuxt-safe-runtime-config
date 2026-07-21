/// <reference path="../../runtime-nitro.d.ts" />
import { useRuntimeConfig } from '#safe-runtime-config/nitro-runtime-config'
import { eventHandler } from 'h3'
import { runtimeValidationContextKey, useValidatedRuntimeConfig, waitForRuntimeConfigValidation } from '../config-state'

export default eventHandler(async (event): Promise<void> => {
  const config = useRuntimeConfig()
  await waitForRuntimeConfigValidation(config)
  Reflect.set(event.context, runtimeValidationContextKey, useValidatedRuntimeConfig(config))
})
