import { array, boolean, integer, literal, number, object, optional, picklist, pipe, record, strictObject, string, tuple, union, variant } from 'valibot'
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

  it('restores strings that Nitro 2 parsed into integers or booleans', async () => {
    const stringSchema = await getJSONSchema(object({ token: string(), flag: string(), mode: picklist(['1', 'auto']), rate: string() }))
    const result = coerceRuntimeConfig({ token: 123456, flag: true, mode: 1, rate: 1.1 }, stringSchema)
    expect(result).toEqual({ token: '123456', flag: 'true', mode: '1', rate: 1.1 })
  })

  it('coerces tuple items (Valibot items array, Zod prefixItems)', async () => {
    const valibotTuple = await getJSONSchema(object({ t: tuple([number(), boolean()]) }))
    const zodTuple = await getJSONSchema(z.object({ t: z.tuple([z.number(), z.boolean()]) }))
    for (const tupleSchema of [valibotTuple, zodTuple])
      expect(coerceRuntimeConfig({ t: '["2","true"]' }, tupleSchema)).toEqual({ t: [2, true] })
  })

  it('picks the matching branch of a discriminated union', async () => {
    const valibotUnion = await getJSONSchema(variant('kind', [
      object({ kind: literal('a'), port: number() }),
      object({ kind: literal('b'), port: boolean() }),
    ]))
    const zodUnion = await getJSONSchema(z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('a'), port: z.number() }),
      z.object({ kind: z.literal('b'), port: z.boolean() }),
    ]))
    for (const unionSchema of [valibotUnion, zodUnion]) {
      expect(coerceRuntimeConfig({ kind: 'a', port: '1' }, unionSchema)).toEqual({ kind: 'a', port: 1 })
      expect(coerceRuntimeConfig({ kind: 'b', port: '1' }, unionSchema)).toEqual({ kind: 'b', port: true })
    }
  })

  it('targets enum literals instead of their primitive types', () => {
    const enumSchema = { type: 'object', properties: { level: { enum: [1, false] } } }
    expect(coerceRuntimeConfig({ level: '0' }, enumSchema)).toEqual({ level: false })
    expect(coerceRuntimeConfig({ level: '1' }, enumSchema)).toEqual({ level: 1 })
  })

  it('coerces patternProperties and additionalProperties (records)', async () => {
    const patternSchema = { type: 'object', patternProperties: { '^PORT_': { type: 'number' } }, additionalProperties: { type: 'boolean' } }
    expect(coerceRuntimeConfig({ PORT_API: '3000', DEBUG: 'true' }, patternSchema)).toEqual({ PORT_API: 3000, DEBUG: true })

    const recordSchema = await getJSONSchema(record(string(), number()))
    expect(coerceRuntimeConfig({ a: '1', b: '2.5' }, recordSchema)).toEqual({ a: 1, b: 2.5 })
  })

  it('leaves values alone where the schema has no type constraint', () => {
    const untyped = { type: 'object', properties: { x: { properties: { y: { type: 'number' } } } } }
    expect(coerceRuntimeConfig({ x: '{"y":"1"}' }, untyped)).toEqual({ x: '{"y":"1"}' })
    expect(coerceRuntimeConfig({ x: { y: '1' } }, untyped)).toEqual({ x: { y: 1 } })
  })

  it('does not turn non-integral strings into integers', () => {
    const integerSchema = { type: 'object', properties: { port: { type: 'integer' } } }
    expect(coerceRuntimeConfig({ port: '0.5' }, integerSchema)).toEqual({ port: '0.5' })
    expect(coerceRuntimeConfig({ port: '3000' }, integerSchema)).toEqual({ port: 3000 })
  })

  it('skips coercion without a schema', () => {
    const raw = { enabled: 'true' }
    expect(coerceRuntimeConfig(raw, null)).toBe(raw)
    expect(coerceRuntimeConfig(raw, {})).toBe(raw)
  })
})
