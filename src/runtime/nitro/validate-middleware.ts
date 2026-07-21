/// <reference path="../../runtime-nitro.d.ts" />
import { useRuntimeConfig } from '#safe-runtime-config/nitro-runtime-config'
import { eventHandler } from 'h3'
import { waitForRuntimeConfigValidation } from '../config-state'

export default eventHandler(async (): Promise<void> => {
  await waitForRuntimeConfigValidation(useRuntimeConfig())
})
