import { object, string } from 'valibot'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

describe('json-schema detection', () => {
  it('detects native jsonSchema support in Zod v3.24+', () => {
    const schema = z.object({ name: z.string() })
    const hasNative = typeof (schema as any)?.['~standard']?.jsonSchema?.output === 'function'
    expect(hasNative).toBe(true)
  })

  it('does not detect native jsonSchema in Valibot', () => {
    const schema = object({ name: string() })
    const hasNative = typeof (schema as any)?.['~standard']?.jsonSchema?.output === 'function'
    expect(hasNative).toBe(false)
  })

  it('generates valid JSON Schema from Zod natively', () => {
    const schema = z.object({ name: z.string(), age: z.number().optional() })
    const jsonSchema = (schema as any)['~standard'].jsonSchema.output({ target: 'draft-2020-12' })
    expect(jsonSchema).toHaveProperty('type', 'object')
    expect(jsonSchema).toHaveProperty('properties')
    expect(jsonSchema.properties).toHaveProperty('name')
  })
})
