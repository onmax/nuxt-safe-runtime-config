import process from 'node:process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { compileEnvSchema } from '../src/env-schema/nuxt'
import { parseEnvSchema } from '../src/env-schema/profile'
import { registerRuntimeConfigValidator, useValidatedRuntimeConfig } from '../src/runtime/config-state'
import { createRuntimeConfigValidator } from '../src/runtime/validator'

interface Event {
  context: { nitro: { runtimeConfig?: Record<string, unknown> } }
}

const runtime = vi.hoisted(() => ({ startup: {} as Record<string, unknown>, schema: {} }))

vi.mock('#safe-runtime-config/h3', () => ({ eventHandler: (handler: unknown) => handler }))
vi.mock('#safe-runtime-config/validate', () => ({ schema: runtime.schema }))
vi.mock('#safe-runtime-config/nitro-runtime-config', () => ({
  useRuntimeConfig: (event?: Event) => {
    if (!event)
      return runtime.startup
    // Model Nitro's creation of an event config from the current environment.
    return event.context.nitro.runtimeConfig ??= { accountPin: JSON.parse(process.env.NUXT_ACCOUNT_PIN!) }
  },
}))

const { jsonSchema } = compileEnvSchema(parseEnvSchema('NUXT_ACCOUNT_PIN=', 'example.env'))
Object.assign(runtime.schema, jsonSchema)
const middleware = (await import('../src/runtime/nitro/validate-middleware')).default

afterEach(() => vi.unstubAllEnvs())

function start(raw: string) {
  vi.stubEnv('NUXT_ACCOUNT_PIN', raw)
  runtime.startup = Object.freeze({ accountPin: JSON.parse(raw) })
  registerRuntimeConfigValidator(createRuntimeConfigValidator({
    runtimeSchema: null,
    schema: jsonSchema,
    coercionSchema: jsonSchema,
    draft: '2020-12',
    onError: 'throw',
    logger: { error: vi.fn(), warn: vi.fn() },
  }), runtime.startup)
}

describe('env schema request source', () => {
  it.each(['1e3', '[1,2]'])('preserves process text %s when creating a Node request config', async (raw) => {
    start(raw)
    const event: Event = { context: { nitro: {} } }
    await middleware(event as never)
    expect(useValidatedRuntimeConfig(event.context.nitro.runtimeConfig!).accountPin).toBe(raw)
    expect(event.context.nitro.runtimeConfig!.accountPin).toBe(raw)
  })

  it('keeps an existing request binding independent from equal process values', async () => {
    start('1e3')
    const config = { accountPin: 1000 }
    const event: Event = { context: { nitro: { runtimeConfig: config } } }
    await middleware(event as never)
    expect(useValidatedRuntimeConfig(config).accountPin).toBe('1000')
  })

  it('captures the environment used by the request instead of reusing startup text', async () => {
    start('1e3')
    vi.stubEnv('NUXT_ACCOUNT_PIN', '1000')
    const event: Event = { context: { nitro: {} } }
    await middleware(event as never)
    expect(useValidatedRuntimeConfig(event.context.nitro.runtimeConfig!).accountPin).toBe('1000')
  })

  it('retains the captured text if the process environment changes while awaiting validation', async () => {
    start('1e3')
    const event: Event = { context: { nitro: {} } }
    const ready = middleware(event as never)
    vi.stubEnv('NUXT_ACCOUNT_PIN', 'another-request')
    await ready
    expect(useValidatedRuntimeConfig(event.context.nitro.runtimeConfig!).accountPin).toBe('1e3')
  })
})
