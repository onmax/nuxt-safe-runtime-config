import type { StandardSchemaV1 } from '@standard-schema/spec'
import { type } from 'arktype'
import { object, optional, string } from 'valibot'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { getJSONSchema, hasNativeJSONSchema } from '../src/utils/json-schema'

describe('json-schema detection', () => {
  it('uses native Standard Schema JSON Schema output when present', async () => {
    const schema = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: () => ({ value: {} }),
        jsonSchema: {
          output: ({ target }: { target: string }) => ({
            $schema: target,
            type: 'object',
            properties: { name: { type: 'string' } },
          }),
        },
      },
    } as unknown as StandardSchemaV1

    expect(hasNativeJSONSchema(schema)).toBe(true)

    const jsonSchema = await getJSONSchema(schema, 'draft-2020-12')
    expect(jsonSchema).toMatchObject({
      $schema: 'draft-2020-12',
      type: 'object',
      properties: { name: { type: 'string' } },
    })
  })

  it('does not detect native jsonSchema in Valibot', () => {
    const schema = object({ name: string() })
    expect(hasNativeJSONSchema(schema)).toBe(false)
  })

  it('generates JSON Schema from Zod', async () => {
    const schema = z.object({ name: z.string(), age: z.number().optional() })
    const jsonSchema = await getJSONSchema(schema, 'draft-2020-12')

    expect(jsonSchema).toHaveProperty('type', 'object')
    expect(jsonSchema).toHaveProperty('properties')
    expect((jsonSchema.properties as Record<string, unknown>)).toHaveProperty('name')
  })

  it('generates JSON Schema from Valibot through fallback conversion', async () => {
    const schema = object({ name: string(), email: optional(string()) })
    const warnings: string[] = []
    const jsonSchema = await getJSONSchema(schema, 'draft-2020-12', message => warnings.push(message))

    expect(warnings).toEqual(['Schema does not support native JSON Schema, using @standard-community/standard-json fallback'])
    expect(jsonSchema).toHaveProperty('type', 'object')
    expect(jsonSchema).toHaveProperty('properties')
    expect((jsonSchema.properties as Record<string, unknown>)).toHaveProperty('name')
  })

  it('detects native JSON Schema on callable ArkType schemas', async () => {
    const schema = type({ name: 'string' })
    expect(hasNativeJSONSchema(schema as any)).toBe(true)

    const jsonSchema = await getJSONSchema(schema as any, 'draft-2020-12')
    expect(jsonSchema).toHaveProperty('type', 'object')
    expect(jsonSchema).toHaveProperty('properties')
  })
})
