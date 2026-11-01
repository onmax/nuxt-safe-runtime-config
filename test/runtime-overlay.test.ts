import { object, string } from 'valibot'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyRuntimeConfigOverlay,
  ensureRuntimeConfigValidation,
  getRuntimeValidationState,
  registerRuntimeConfigOverlay,
  registerRuntimeConfigValidator,
  useValidatedRuntimeConfig,
  waitForRuntimeConfigValidation,
} from '../src/runtime/config-state'
import { createRuntimeConfigValidator } from '../src/runtime/validator'
import { getJSONSchema } from '../src/utils/json-schema'

const schema = object({
  databaseUrl: string(),
  github: object({ clientSecret: string() }),
  public: object({ siteName: string() }),
})
const jsonSchema = await getJSONSchema(schema)
const logger = { error: vi.fn(), warn: vi.fn() }

function baseConfig() {
  return { databaseUrl: '', github: { clientId: 'id' }, public: { siteName: 'Site' } } as Record<string, unknown>
}

const secrets = { databaseUrl: 'postgresql://db', github: { clientSecret: 'shh' } }

function createValidator() {
  return vi.fn(createRuntimeConfigValidator({
    runtimeSchema: null,
    schema: jsonSchema as never,
    draft: '2020-12',
    coercionSchema: jsonSchema,
    onError: 'throw',
    logger,
  }))
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

let load: ReturnType<typeof deferred<Record<string, unknown> | undefined>>

beforeEach(() => {
  load = deferred()
  registerRuntimeConfigOverlay(load.promise)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('runtime config overlay', () => {
  it('validates the startup config only after the overlay loads', async () => {
    const shared = Object.freeze(baseConfig())
    const validator = createValidator()
    registerRuntimeConfigValidator(validator, shared)

    expect(validator).not.toHaveBeenCalled()
    expect(getRuntimeValidationState(shared)?.status).toBe('pending')

    load.resolve(secrets)
    await waitForRuntimeConfigValidation(shared)

    expect(validator).toHaveBeenCalledOnce()
    expect(useValidatedRuntimeConfig(shared)).toEqual({
      databaseUrl: 'postgresql://db',
      github: { clientId: 'id', clientSecret: 'shh' },
      public: { siteName: 'Site' },
    })
  })

  it('merges the overlay into mutable request configs and reuses the startup result', async () => {
    const validator = createValidator()
    registerRuntimeConfigValidator(validator, Object.freeze(baseConfig()))
    load.resolve(secrets)

    const eventConfig = baseConfig()
    await ensureRuntimeConfigValidation(eventConfig)

    expect(eventConfig).toMatchObject({ databaseUrl: 'postgresql://db', github: { clientSecret: 'shh' } })
    expect(useValidatedRuntimeConfig(eventConfig)).toMatchObject({ github: { clientId: 'id', clientSecret: 'shh' } })
    expect(validator).toHaveBeenCalledOnce()
  })

  it('merges the overlay into a mutable shared config in place', async () => {
    const shared = baseConfig()
    registerRuntimeConfigValidator(createValidator(), shared)
    load.resolve(secrets)
    await waitForRuntimeConfigValidation(shared)

    expect(shared).toMatchObject({ databaseUrl: 'postgresql://db', github: { clientId: 'id', clientSecret: 'shh' } })
  })

  it('reports invalid config once the overlay loads without the missing values', async () => {
    const shared = Object.freeze(baseConfig())
    registerRuntimeConfigValidator(createValidator(), shared)
    load.resolve(undefined)

    await expect(waitForRuntimeConfigValidation(shared)).rejects.toThrow('Runtime validation failed')
    expect(logger.error).toHaveBeenCalledOnce()
  })

  it('applies the overlay to a mutable config once', async () => {
    load.resolve(secrets)
    await waitForOverlay()
    const config = baseConfig()

    expect(applyRuntimeConfigOverlay(config)).toBe(config)
    const github = config.github
    applyRuntimeConfigOverlay(config)
    expect(config.github).toBe(github)
  })

  it('returns a merged copy of a frozen config', async () => {
    load.resolve(secrets)
    await waitForOverlay()
    const frozen = Object.freeze(baseConfig())

    const merged = applyRuntimeConfigOverlay(frozen)

    expect(merged).not.toBe(frozen)
    expect(merged).toMatchObject({ databaseUrl: 'postgresql://db' })
    expect(frozen.databaseUrl).toBe('')
  })
})

async function waitForOverlay() {
  await load.promise
  await Promise.resolve()
}
