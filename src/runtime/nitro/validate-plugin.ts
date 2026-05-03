import type { SchemaDraft } from '@cfworker/json-schema'
// @ts-expect-error - virtual alias is provided by Nitro module setup
import { useRuntimeConfig } from '#safe-runtime-config/nitro-runtime-config'
import { draft, onError, schema } from '#safe-runtime-config/validate'
import { Validator } from '@cfworker/json-schema'
import { consola } from 'consola'

interface ValidationError {
  error: string
  instanceLocation: string
}

const logger = consola.withTag('safe-runtime-config')

export default (): void => {
  const config = useRuntimeConfig()
  const validator = new Validator(schema, draft as SchemaDraft)
  const result = validator.validate(config)

  if (!result.valid) {
    const errors = result.errors.map((e: ValidationError) => `${e.instanceLocation}: ${e.error}`).join(', ')
    const msg = `Runtime validation failed: ${errors}`

    if (onError === 'throw') {
      logger.error(msg)
      throw new Error(msg)
    }
    else if (onError === 'warn') {
      logger.warn(msg)
    }
    return
  }

  logger.success('Runtime config validated (server start)')
}
