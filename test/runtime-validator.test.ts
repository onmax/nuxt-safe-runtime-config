import { boolean, number, object, pipeAsync, string, transformAsync } from 'valibot'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureRuntimeConfigValidation, getRuntimeValidationState, registerRuntimeConfigValidator, useValidatedRuntimeConfig, waitForRuntimeConfigValidation } from '../src/runtime/config-state'
import { createRuntimeConfigValidator } from '../src/runtime/validator'
import { getJSONSchema } from '../src/utils/json-schema'

const runtimeConfig = vi.hoisted(() => ({ shared: {} as Record<string, unknown> }))

vi.mock('#imports', () => ({
  useRuntimeConfig: () => runtimeConfig.shared,
}))

const { useSafeRuntimeConfig } = await import('../src/runtime/composables/useSafeRuntimeConfig')

const valibotSchema = object({
  secret: string(),
  perfTrace: object({ enabled: boolean() }),
  public: object({ sampleRate: number() }),
})
const jsonSchema = await getJSONSchema(valibotSchema)
const logger = { error: vi.fn(), warn: vi.fn() }

function rawConfig(secret: string, enabled: unknown = 'true') {
  return { secret, perfTrace: { enabled }, public: { sampleRate: '0.5' }, app: { baseURL: '/' } }
}

function register(options: Partial<Parameters<typeof createRuntimeConfigValidator>[0]> = {}) {
  const validator = vi.fn(createRuntimeConfigValidator({
    runtimeSchema: null,
    schema: jsonSchema as never,
    draft: '7',
    coercionSchema: jsonSchema,
    onError: 'throw',
    logger,
    ...options,
  }))
  registerRuntimeConfigValidator(validator, runtimeConfig.shared)
  return validator
}

beforeEach(() => {
  runtimeConfig.shared = Object.freeze(rawConfig('startup-secret')) as Record<string, unknown>
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('inline schema runtime validation', () => {
  it('returns coerced values from useSafeRuntimeConfig()', () => {
    register()
    const config = useSafeRuntimeConfig() as Record<string, any>
    expect(config.perfTrace.enabled).toBe(true)
    expect(config.public.sampleRate).toBe(0.5)
    expect(config.app).toEqual({ baseURL: '/' })
  })

  it('throws at startup when coerced values still fail', () => {
    runtimeConfig.shared = Object.freeze(rawConfig('startup-secret', 'maybe')) as Record<string, unknown>
    expect(() => register()).toThrow('Runtime validation failed')
    expect(logger.error).toHaveBeenCalledOnce()
  })
})

describe('event-scoped config validation', () => {
  function validated(config: Record<string, unknown>) {
    void ensureRuntimeConfigValidation(config)
    return useValidatedRuntimeConfig(config) as Record<string, any>
  }

  it('reuses the startup validation when the event config has the same values', () => {
    const validator = register()
    const config = validated(structuredClone(rawConfig('startup-secret')))

    expect(config).toEqual(useSafeRuntimeConfig())
    expect(validator).toHaveBeenCalledOnce()
  })

  it('validates and coerces event configs with request-specific values once', () => {
    const validator = register()
    const eventConfig = rawConfig('request-secret', '0')

    const config = validated(eventConfig)
    validated(eventConfig)

    expect(config.secret).toBe('request-secret')
    expect(config.perfTrace.enabled).toBe(false)
    expect(validator).toHaveBeenCalledTimes(2)
  })

  it('writes validated values into mutable event configs without sharing objects', () => {
    register()
    const first = structuredClone(rawConfig('startup-secret'))
    const second = structuredClone(rawConfig('startup-secret'))

    const firstConfig = validated(first)
    firstConfig.public.sampleRate = 1

    expect(first.public.sampleRate).toBe(0.5)
    expect(validated(second).public.sampleRate).toBe(0.5)
    expect(useSafeRuntimeConfig()).toMatchObject({ public: { sampleRate: 0.5 } })
  })

  it('throws for invalid event configs when onError is throw', () => {
    register()
    expect(() => validated(rawConfig('request-secret', 'maybe'))).toThrow('Runtime validation failed')
  })

  it('warns once and returns the raw config when onError is warn', () => {
    register({ onError: 'warn' })
    const first = rawConfig('a', 'maybe')
    const second = rawConfig('b', 'maybe')

    expect(validated(first)).toBe(first)
    expect(validated(second)).toBe(second)
    expect(logger.warn).toHaveBeenCalledOnce()
  })

  it('waits for asynchronous schemas', async () => {
    let runs = 0
    const asyncSchema = pipeAsync(valibotSchema, transformAsync(async (value) => {
      runs++
      return { ...value, runs }
    }))
    register({ runtimeSchema: asyncSchema })
    await waitForRuntimeConfigValidation(runtimeConfig.shared)

    const eventConfig = rawConfig('request-secret')
    expect(() => validated(eventConfig)).toThrow('still pending')
    await ensureRuntimeConfigValidation(eventConfig)

    expect(getRuntimeValidationState(eventConfig)?.status).toBe('valid')
    expect(useValidatedRuntimeConfig(eventConfig)).toMatchObject({ secret: 'request-secret', perfTrace: { enabled: true }, runs: 2 })
    expect(useValidatedRuntimeConfig(runtimeConfig.shared)).toMatchObject({ secret: 'startup-secret', runs: 1 })
  })
})
