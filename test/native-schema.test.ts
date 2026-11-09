import type { Nuxt } from '@nuxt/schema'
import type { ResolvedValidationOptions } from '../src/validation'
import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { registerNativeSchema, supportsNativeSchemas } from '../src/native-schema'

const strictValidation = { runtimeCheck: true, onError: 'throw' } as const

describe('native runtime config schemas', () => {
  it('detects Nuxt versions that compile runtime config schemas', () => {
    expect(supportsNativeSchemas({ options: { _runtimeConfigSchemas: [] } } as unknown as Nuxt)).toBe(true)
    expect(supportsNativeSchemas({ options: {} } as unknown as Nuxt)).toBe(false)
  })

  it('keeps a plain Valibot schema, which has no JSON Schema', async () => {
    await expect(registerNativeSchema('/nonexistent/package.json', v.object({ port: v.number() }), strictValidation))
      .resolves
      .toBe('the schema does not implement Standard JSON Schema')
  })
  it('keeps a schema with transforms before Nuxt sees it', async () => {
    const schema = z.object({ origins: z.string().transform(value => value.split(',')) })
    await expect(registerNativeSchema('/nonexistent/package.json', schema, strictValidation))
      .resolves
      .toMatch(/^the schema has no JSON Schema output/)
  })

  it.each<Pick<ResolvedValidationOptions, 'runtimeCheck' | 'onError'>>([
    { runtimeCheck: false, onError: 'throw' },
    { runtimeCheck: false, onError: 'warn' },
    { runtimeCheck: false, onError: 'ignore' },
    { runtimeCheck: true, onError: 'warn' },
    { runtimeCheck: true, onError: 'ignore' },
  ])('keeps $runtimeCheck/$onError validation under the module\'s control', async (options) => {
    const schema = z.object({ apiSecret: z.string() })
    // No Kit exists here: the module must reject native registration before calling Nuxt,
    // whose mandatory required-value check would bypass these settings.
    await expect(registerNativeSchema('/nonexistent/package.json', schema, options))
      .resolves
      .toBe('native validation requires runtime validation and onError: "throw"')
  })
})
