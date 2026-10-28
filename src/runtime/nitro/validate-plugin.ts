/// <reference path="../../runtime-nitro.d.ts" />
import { consola } from 'consola'
import { useRuntimeConfig } from '#safe-runtime-config/nitro-runtime-config'
import { coercionSchema, draft, onError, runtimeSchema, schema } from '#safe-runtime-config/validate'
import { registerRuntimeConfigValidator } from '../config-state'
import { createRuntimeConfigValidator } from '../validator'

const logger = consola.withTag('safe-runtime-config')

export default (): void => {
  const validator = createRuntimeConfigValidator({ runtimeSchema, schema, draft, coercionSchema, onError, logger })
  registerRuntimeConfigValidator(validator, useRuntimeConfig())
}
