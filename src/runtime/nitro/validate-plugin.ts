/// <reference path="../../runtime-nitro.d.ts" />
import { useRuntimeConfig } from '#safe-runtime-config/nitro-runtime-config'
import { draft, onError, runtimeSchema, schema } from '#safe-runtime-config/validate'
import { Validator } from '@cfworker/json-schema'
import { consola } from 'consola'
import { applyValidatedRuntimeConfig, setRuntimeValidationState } from '../config-state'
import { isPromiseLike, validateRuntimeConfig } from '../validate'

const logger = consola.withTag('safe-runtime-config')

export default (): void => {
  const config = useRuntimeConfig()

  if (runtimeSchema) {
    const result = validateRuntimeConfig(config, runtimeSchema, onError, logger)

    if (isPromiseLike(result)) {
      const ready = result
        .then((validation) => {
          if (validation.success)
            applyValidatedRuntimeConfig(config, validation.value)
          else
            setRuntimeValidationState(config, { status: 'invalid' })
        })
        .catch(error => setRuntimeValidationState(config, { status: 'failed', error }))

      setRuntimeValidationState(config, { status: 'pending', ready })
    }
    else if (result.success) {
      applyValidatedRuntimeConfig(config, result.value)
    }
    else {
      setRuntimeValidationState(config, { status: 'invalid' })
    }
    return
  }

  const validator = new Validator(schema, draft)
  const result = validator.validate(config)

  if (!result.valid) {
    const errors = result.errors.map(e => `${e.instanceLocation}: ${e.error}`).join(', ')
    const msg = `Runtime validation failed: ${errors}`

    if (onError === 'throw') {
      logger.error(msg)
      throw new Error(msg)
    }
    else if (onError === 'warn') {
      logger.warn(msg)
    }
  }
}
