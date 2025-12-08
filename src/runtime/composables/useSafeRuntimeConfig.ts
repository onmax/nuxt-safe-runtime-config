import schema from '#build/safe-runtime-config/schema.json'
import { useRuntimeConfig } from '#imports'
import Ajv from 'ajv'

let validated = false
let cachedConfig: ReturnType<typeof useRuntimeConfig> | null = null

export function useSafeRuntimeConfig<T = ReturnType<typeof useRuntimeConfig>>(): T {
  if (validated)
    return cachedConfig as T

  const config = useRuntimeConfig()
  const ajv = new Ajv()
  const validate = ajv.compile(schema)

  if (!validate(config)) {
    const errors = ajv.errorsText(validate.errors)
    throw new Error(`Runtime config validation failed: ${errors}`)
  }

  validated = true
  cachedConfig = config
  return config as T
}
