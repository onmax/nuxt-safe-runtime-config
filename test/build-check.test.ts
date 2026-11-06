import type { StandardSchemaV1 } from '@standard-schema/spec'
import { type } from 'arktype'
import * as v from 'valibot'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { validateRuntimeConfig } from '../src/runtime/validate'
import { resolveChecks } from '../src/validation'

const schemas: Array<[string, StandardSchemaV1]> = [
  ['Valibot', v.object({
    databaseUrl: v.pipe(v.string(), v.url()),
    port: v.number(),
    public: v.object({ apiBase: v.pipe(v.string(), v.minLength(1)) }),
  })],
  ['Zod', z.object({
    databaseUrl: z.string().url(),
    port: z.number(),
    public: z.object({ apiBase: z.string().min(1) }),
  })],
  ['ArkType', type({
    databaseUrl: 'string.url',
    port: 'number',
    public: { apiBase: 'string > 0' },
  })],
]

function logger() {
  return { error: vi.fn(), warn: vi.fn(), info: vi.fn() }
}

describe.each(schemas)('build check with %s', (_name, schema) => {
  it('leaves undefined and empty values to the server start check', async () => {
    const log = logger()
    const result = await validateRuntimeConfig({ port: 3000, databaseUrl: '', public: {} }, schema, 'throw', log, { deferMissing: true })

    expect(result.success).toBe(true)
    expect(log.error).not.toHaveBeenCalled()
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining('databaseUrl'))
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining('public.apiBase'))
  })

  it('leaves a missing nested object to the server start check', async () => {
    const result = await validateRuntimeConfig({ port: 3000 }, schema, 'throw', logger(), { deferMissing: true })

    expect(result.success).toBe(true)
  })

  it('fails on a value that is set and wrong', async () => {
    const log = logger()
    const check = async () => validateRuntimeConfig({ port: 'abc', databaseUrl: '', public: { apiBase: 'x' } }, schema, 'throw', log, { deferMissing: true })

    await expect(check()).rejects.toThrow('Runtime config validation failed')
    const [message] = log.error.mock.calls[0]!
    expect(message).toContain('port')
    expect(message).not.toContain('databaseUrl')
  })

  it('fails on missing values without deferMissing', async () => {
    const check = async () => validateRuntimeConfig({ port: 3000, databaseUrl: '', public: { apiBase: 'x' } }, schema, 'throw', logger())

    await expect(check()).rejects.toThrow('Runtime config validation failed')
  })
})

describe('resolveChecks', () => {
  it('checks present values at build and everything at server start by default', () => {
    const warn = vi.fn()
    expect(resolveChecks({}, warn)).toEqual({ buildCheck: 'present', runtimeCheck: true })
    expect(warn).not.toHaveBeenCalled()
  })

  it('requires every value at build with requireAtBuild', () => {
    expect(resolveChecks({ requireAtBuild: true })).toEqual({ buildCheck: 'all', runtimeCheck: true })
  })

  it('keeps already resolved checks', () => {
    const warn = vi.fn()
    expect(resolveChecks({ buildCheck: 'off', runtimeCheck: true }, warn)).toEqual({ buildCheck: 'off', runtimeCheck: true })
    expect(warn).not.toHaveBeenCalled()
  })

  it.each([
    [{ validateAtRuntime: true }, { buildCheck: 'present', runtimeCheck: true }, 'Remove them'],
    [{ validateAtBuild: true, validateAtRuntime: true }, { buildCheck: 'all', runtimeCheck: true }, 'requireAtBuild: true'],
    [{ validateAtBuild: false, validateAtRuntime: true }, { buildCheck: 'off', runtimeCheck: true }, 'Remove them'],
    [{ validateAtRuntime: false }, { buildCheck: 'all', runtimeCheck: false }, 'turns that check off'],
    [{ validateAtBuild: true }, { buildCheck: 'all', runtimeCheck: true }, 'requireAtBuild: true'],
  ] as const)('maps deprecated %o and warns', (options, expected, hint) => {
    const warn = vi.fn()
    expect(resolveChecks(options, warn)).toEqual(expected)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('deprecated'))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(hint))
  })

  it('rejects requireAtBuild with validateAtBuild: false', () => {
    expect(() => resolveChecks({ requireAtBuild: true, validateAtBuild: false })).toThrow('requireAtBuild')
  })
})
