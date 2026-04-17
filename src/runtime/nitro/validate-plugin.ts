import { draft, onError, schema } from '#safe-runtime-config/validate'
import { Validator } from '@cfworker/json-schema'
import { consola } from 'consola'
import { defineNitroPlugin, useRuntimeConfig } from 'nitropack/runtime'

const logger = consola.withTag('safe-runtime-config')

export default defineNitroPlugin(() => {
  const config = useRuntimeConfig()
  const validator = new Validator(schema as any, draft as any)
  const result = validator.validate(config)

  if (!result.valid) {
    const errors = result.errors.map((e: any) => `${e.instanceLocation}: ${e.error}`).join(', ')
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
})
