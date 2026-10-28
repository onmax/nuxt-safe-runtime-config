import type { Schema, SchemaDraft } from '@cfworker/json-schema'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { ErrorBehavior } from '../types'
import type { RuntimeConfigValidator } from './config-state'
import type { RuntimeValidationResult, ValidationLogger } from './validate'
import process from 'node:process'
import { Validator } from '@cfworker/json-schema'
import { coerceRuntimeConfig } from './coerce'
import { applyValidatedRuntimeConfig, setRuntimeValidationState } from './config-state'
import { clearAbsentEnvSchemaValues, envSchemaIssueLocation, isEnvSchema, normalizeEnvSchemaConfig } from './env-schema'
import { isPromiseLike, validateRuntimeConfig } from './validate'

export interface RuntimeConfigValidatorOptions {
  /** Standard Schema executed at runtime (schema modules only) */
  runtimeSchema: StandardSchemaV1 | null
  /** JSON Schema used when there is no runtime schema */
  schema: Schema
  draft: SchemaDraft
  /** JSON Schema that env overrides are coerced against, or null to skip coercion */
  coercionSchema: Record<string, unknown> | null
  onError: ErrorBehavior
  logger: ValidationLogger
}

// Event configs on per-request env platforms validate repeatedly; report each message once.
function onceLogger(logger: ValidationLogger): ValidationLogger {
  const seen = new Set<string>()
  const once = (log: (message: string) => void) => (message: string) => {
    if (seen.has(message))
      return
    seen.add(message)
    log(message)
  }
  return { error: once(msg => logger.error(msg)), warn: once(msg => logger.warn(msg)) }
}

function validateJsonSchema(
  config: Record<string, unknown>,
  validator: Validator,
  onError: ErrorBehavior,
  logger: ValidationLogger,
  schema: Record<string, unknown>,
): RuntimeValidationResult {
  const result = validator.validate(config)
  if (result.valid)
    return { success: true, value: config }

  const errors = result.errors.map(e => `${envSchemaIssueLocation(schema, e)}${e.instanceLocation}: ${e.error}`).join(', ')
  const msg = `Runtime validation failed: ${errors}`
  if (onError === 'throw') {
    logger.error(msg)
    throw new Error(msg)
  }
  if (onError === 'warn')
    logger.warn(msg)
  return { success: false }
}

export function createRuntimeConfigValidator(options: RuntimeConfigValidatorOptions): RuntimeConfigValidator {
  const { runtimeSchema, coercionSchema, onError } = options
  const logger = onceLogger(options.logger)
  const jsonValidator = runtimeSchema ? null : new Validator(options.schema, options.draft)

  const settle = (config: Record<string, unknown>, validation: RuntimeValidationResult): void => {
    if (validation.success) {
      if (isEnvSchema(options.schema) && validation.value && typeof validation.value === 'object' && !Array.isArray(validation.value))
        clearAbsentEnvSchemaValues(config, Object.fromEntries(Object.entries(validation.value)), options.schema)
      applyValidatedRuntimeConfig(config, validation.value)
    }
    else {
      setRuntimeValidationState(config, { status: 'invalid' })
    }
  }

  const validate: RuntimeConfigValidator = (config, source) => {
    const environment = source === 'startup' ? process.env : source
    const coerced = isEnvSchema(options.schema)
      ? normalizeEnvSchemaConfig(config, options.schema, environment)
      : coerceRuntimeConfig(config, coercionSchema)
    let result: RuntimeValidationResult | Promise<RuntimeValidationResult>
    try {
      result = runtimeSchema
        ? validateRuntimeConfig(coerced, runtimeSchema, onError, logger)
        : validateJsonSchema(coerced, jsonValidator!, onError, logger, options.schema)
    }
    catch (error) {
      setRuntimeValidationState(config, { status: 'failed', error })
      throw error
    }

    if (!isPromiseLike(result)) {
      settle(config, result)
      return
    }

    const ready = result
      .then(validation => settle(config, validation))
      .catch(error => setRuntimeValidationState(config, { status: 'failed', error }))
    setRuntimeValidationState(config, { status: 'pending', ready })
  }

  if (isEnvSchema(options.schema)) {
    validate.reuse = (config, value, environment) => {
      // Equal parsed values do not prove that a request used the startup env spelling.
      if (JSON.stringify(normalizeEnvSchemaConfig(config, options.schema, environment)) !== JSON.stringify(value))
        return false
      settle(config, { success: true, value })
      return true
    }
  }
  return validate
}
