/// <reference path="../../runtime-nitro.d.ts" />
import { useRuntimeConfig } from '#safe-runtime-config/nitro-runtime-config'
import { eventHandler } from 'h3'
import { isRuntimeConfigValidationAsync, waitForRuntimeConfigValidation } from '../config-state'

export default eventHandler(async (event): Promise<void> => {
  await waitForRuntimeConfigValidation(useRuntimeConfig())
  // `useSafeRuntimeConfig()` is synchronous, so asynchronous schemas validate the event config here.
  if (isRuntimeConfigValidationAsync())
    await waitForRuntimeConfigValidation(useRuntimeConfig(event))
})
