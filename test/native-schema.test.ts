import type { Nuxt } from '@nuxt/schema'
import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { registerNativeSchema, supportsNativeSchemas } from '../src/native-schema'

describe('native runtime config schemas', () => {
  it('detects Nuxt versions that compile runtime config schemas', () => {
    expect(supportsNativeSchemas({ options: { _runtimeConfigSchemas: [] } } as unknown as Nuxt)).toBe(true)
    expect(supportsNativeSchemas({ options: {} } as unknown as Nuxt)).toBe(false)
  })

  it('keeps a plain Valibot schema, which has no JSON Schema', async () => {
    await expect(registerNativeSchema('/nonexistent/package.json', v.object({ port: v.number() })))
      .resolves
      .toBe('the schema does not implement Standard JSON Schema')
  })
  it('keeps a schema with transforms before Nuxt sees it', async () => {
    const schema = z.object({ origins: z.string().transform(value => value.split(',')) })
    await expect(registerNativeSchema('/nonexistent/package.json', schema))
      .resolves
      .toMatch(/^the schema has no JSON Schema output/)
  })
})
