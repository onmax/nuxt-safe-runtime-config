import { describe, expect, it, vi } from 'vitest'
import { applyValidatedRuntimeConfig, mergeTransformedRuntimeConfig, useValidatedRuntimeConfig } from '../src/runtime/config-state'
import { validateRuntimeConfig } from '../src/runtime/validate'

const logger = {
  error: vi.fn(),
  warn: vi.fn(),
}

describe('standard Schema runtime validation', () => {
  it('returns transformed output from a synchronous schema', () => {
    const schema = {
      '~standard': {
        version: 1 as const,
        vendor: 'test',
        validate: (value: unknown) => ({ value: { enabled: value === 'true' } }),
      },
    }

    expect(validateRuntimeConfig('true', schema, 'throw', logger)).toEqual({
      success: true,
      value: { enabled: true },
    })
  })

  it('returns transformed output from an asynchronous schema', async () => {
    const schema = {
      '~standard': {
        version: 1 as const,
        vendor: 'test',
        validate: async (value: unknown) => ({ value: { enabled: value === 'true' } }),
      },
    }

    await expect(validateRuntimeConfig('true', schema, 'throw', logger)).resolves.toEqual({
      success: true,
      value: { enabled: true },
    })
  })

  it('keeps exact validated output when Nitro config is frozen', () => {
    const rawConfig = Object.freeze({ enabled: 'true', app: Object.freeze({ baseURL: '/' }) })
    const output = { enabled: true }

    applyValidatedRuntimeConfig(rawConfig, output)

    expect(useValidatedRuntimeConfig(rawConfig)).toBe(output)
    expect(rawConfig.enabled).toBe('true')
  })

  it('preserves runtime config fields omitted from transformed output', () => {
    const current = {
      featureEnabled: 'true',
      moduleConfig: { label: 'keep', nested: { count: 1 } },
    }
    const transformed = {
      featureEnabled: true,
      moduleConfig: { nested: { enabled: true } },
    }

    expect(mergeTransformedRuntimeConfig(current, transformed)).toEqual({
      featureEnabled: true,
      moduleConfig: { label: 'keep', nested: { count: 1, enabled: true } },
    })
  })

  it('preserves raw config after ignored validation issues', () => {
    const schema = {
      '~standard': {
        version: 1 as const,
        vendor: 'test',
        validate: () => ({ issues: [{ message: 'invalid' }] }),
      },
    }

    expect(validateRuntimeConfig({}, schema, 'ignore', logger)).toEqual({ success: false })
  })
})
