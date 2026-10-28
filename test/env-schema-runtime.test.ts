import { afterEach, describe, expect, it, vi } from 'vitest'
import { compileEnvSchema } from '../src/env-schema/nuxt'
import { parseEnvSchema } from '../src/env-schema/profile'
import { createEnvSchemaValidator } from '../src/env-schema/standard'
import { useValidatedRuntimeConfig } from '../src/runtime/config-state'
import { normalizeEnvSchemaConfig } from '../src/runtime/env-schema'
import { createRuntimeConfigValidator } from '../src/runtime/validator'

afterEach(() => vi.unstubAllEnvs())

function contract(source: string) {
  const compiled = compileEnvSchema(parseEnvSchema(source, 'example.env'))
  const config = structuredClone(compiled.runtimeConfig)
  const logger = { error: vi.fn(), warn: vi.fn() }
  const validate = createRuntimeConfigValidator({
    runtimeSchema: null,
    schema: compiled.jsonSchema,
    coercionSchema: compiled.jsonSchema,
    draft: '2020-12',
    onError: 'throw',
    logger,
  })
  return { ...compiled, config, logger, validate }
}

describe('env schema runtime boundary', () => {
  it.each(['1e3', 'false', 'null', '00123', '{"pin":123}'])('preserves the injected string %s after Nitro parsing', (raw) => {
    const { config, validate } = contract('NUXT_ACCOUNT_PIN=')
    vi.stubEnv('NUXT_ACCOUNT_PIN', raw)
    try {
      config.accountPin = JSON.parse(raw)
    }
    catch {
      config.accountPin = raw
    }
    validate(config)
    expect(useValidatedRuntimeConfig(config).accountPin).toBe(raw)
  })

  it('keeps request bindings when they differ from process values', () => {
    const { config, validate } = contract('NUXT_ACCOUNT_PIN=')
    vi.stubEnv('NUXT_ACCOUNT_PIN', 'global-secret')
    config.accountPin = 'request-secret'
    validate(config)
    expect(useValidatedRuntimeConfig(config).accountPin).toBe('request-secret')
  })

  it('removes optional sentinels and applies defaults to optional typed empty inputs', () => {
    const { config, validate } = contract('# @optional @type=number\nNUXT_LIMIT=\n# @optional @type=number\nNUXT_RETRIES=3')
    config.retries = ''
    validate(config)
    expect(useValidatedRuntimeConfig(config)).toEqual({ retries: 3 })
    expect(config.limit).toBeUndefined()
    expect(JSON.stringify(config)).not.toContain('limit')
  })

  it.each(['0x20', 'NaN', 'Infinity', 'not-a-number'])('rejects the numeric override %s with a redacted source location', (raw) => {
    const { config, validate, logger } = contract('# @type=number\nNUXT_LIMIT=3')
    config.limit = raw
    expect(() => validate(config)).toThrow('Runtime validation failed')
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('example.env:2 (NUXT_LIMIT)'))
    expect(logger.error.mock.calls.flat().join()).not.toContain(raw)
  })

  it.each(['9007199254740993', '-9007199254740993', 9007199254740992])('rejects unsafe integer overrides instead of rounding them: %s', (value) => {
    const { config, validate } = contract('# @type=number(isInt=true)\nNUXT_LIMIT=3')
    config.limit = value
    expect(() => validate(config)).toThrow('Runtime validation failed')
  })

  it('rejects a present required empty override instead of restoring its default', () => {
    const { config, validate } = contract('NUXT_LABEL=default-label')
    config.label = ''
    expect(() => validate(config)).toThrow('Runtime validation failed')
  })

  it('validates source metadata without requiring deployment values at compilation', () => {
    const { runtimeConfig, jsonSchema } = contract('NUXT_SECRET=\n# @optional @type=number\nNUXT_LIMIT=')
    expect(runtimeConfig).toEqual({ secret: { __envSchemaUnset: true }, limit: { __envSchemaUnset: true } })
    expect(createEnvSchemaValidator(jsonSchema)['~standard'].validate({ secret: 'runtime-only', limit: null })).toEqual({ value: { secret: 'runtime-only' } })
  })

  it('leaves existing schemas and their string unions unchanged', () => {
    const config = { limit: '5' }
    expect(normalizeEnvSchemaConfig(config, { type: 'object' })).toBe(config)
  })
})
