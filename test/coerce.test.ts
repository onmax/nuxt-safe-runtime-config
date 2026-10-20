import { array, boolean, integer, number, object, optional, picklist, pipe, strictObject, string, union } from 'valibot'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { coerceRuntimeConfig } from '../src/runtime/coerce'
import { getJSONSchema } from '../src/utils/json-schema'

const schema = await getJSONSchema(object({
  perfTrace: object({ enabled: boolean(), token: string() }),
  public: object({
    featureFlags: strictObject({ forecast: boolean() }),
    secondaryLogins: array(picklist(['email', 'github'])),
    posthog: object({
      replaySampleRate: number(),
      port: optional(pipe(number(), integer())),
      label: union([boolean(), string()]),
    }),
  }),
}))

function config(overrides: { enabled?: unknown, forecast?: unknown, logins?: unknown, rate?: unknown, port?: unknown, label?: unknown }) {
  return {
    app: { baseURL: '/' },
    perfTrace: { enabled: overrides.enabled ?? false, token: '123' },
    public: {
      featureFlags: { forecast: overrides.forecast ?? false },
      secondaryLogins: overrides.logins ?? [],
      posthog: { replaySampleRate: overrides.rate ?? 0.1, port: overrides.port, label: overrides.label ?? 'x' },
    },
  }
}

describe('coerceRuntimeConfig', () => {
  it('coerces boolean strings and Nitro 2 numeric flags', () => {
    const result = coerceRuntimeConfig(config({ enabled: 'true', forecast: 1 }), schema)
    expect(result.perfTrace.enabled).toBe(true)
    expect(result.public.featureFlags.forecast).toBe(true)

    for (const [raw, expected] of [['false', false], [' TRUE ', true], ['0', false], ['1', true], [0, false]] as const)
      expect(coerceRuntimeConfig(config({ enabled: raw }), schema).perfTrace.enabled).toBe(expected)
  })

  it('coerces numeric strings, including integers', () => {
    const result = coerceRuntimeConfig(config({ rate: '0.25', port: '3000' }), schema)
    expect(result.public.posthog.replaySampleRate).toBe(0.25)
    expect(result.public.posthog.port).toBe(3000)
  })

  it('parses JSON arrays from Nitro 3 env strings', () => {
    const result = coerceRuntimeConfig(config({ logins: '["github"]' }), schema)
    expect(result.public.secondaryLogins).toEqual(['github'])
  })

  it('leaves values the schema accepts or cannot convert', () => {
    const raw = config({ enabled: 'yes', rate: 'abc', label: 'true', logins: 'github' })
    const result = coerceRuntimeConfig(raw, schema)
    expect(result.perfTrace.enabled).toBe('yes')
    expect(result.perfTrace.token).toBe('123')
    expect(result.public.posthog.replaySampleRate).toBe('abc')
    expect(result.public.posthog.label).toBe('true')
    expect(result.public.secondaryLogins).toBe('github')
    expect(coerceRuntimeConfig(config({ rate: '' }), schema).public.posthog.replaySampleRate).toBe('')
  })

  it('keeps identity for unchanged subtrees and does not mutate the input', () => {
    const raw = Object.freeze(config({ enabled: 'true' }))
    const result = coerceRuntimeConfig(raw, schema)
    expect(result).not.toBe(raw)
    expect(result.public).toBe(raw.public)
    expect(result.app).toBe(raw.app)
    expect(raw.perfTrace.enabled).toBe('true')

    const valid = config({})
    expect(coerceRuntimeConfig(valid, schema)).toBe(valid)
  })

  it('follows local $ref definitions', () => {
    const refSchema = {
      type: 'object',
      properties: { a: { $ref: '#/$defs/toggle' }, b: { $ref: '#/$defs/toggle' } },
      $defs: { toggle: { type: 'object', properties: { enabled: { type: 'boolean' } } } },
    }
    const result = coerceRuntimeConfig({ a: { enabled: 'true' }, b: { enabled: 'false' } }, refSchema)
    expect(result).toEqual({ a: { enabled: true }, b: { enabled: false } })
  })

  it('coerces inside nullable unions (Zod native JSON Schema)', async () => {
    const zodSchema = await getJSONSchema(z.object({ rate: z.number().nullable(), debug: z.boolean().optional() }))
    expect(coerceRuntimeConfig({ rate: '2', debug: 'false' }, zodSchema)).toEqual({ rate: 2, debug: false })
  })

  it('skips coercion without a schema', () => {
    const raw = { enabled: 'true' }
    expect(coerceRuntimeConfig(raw, null)).toBe(raw)
    expect(coerceRuntimeConfig(raw, {})).toBe(raw)
  })
})
