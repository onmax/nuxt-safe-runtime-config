import { describe, expect, it } from 'vitest'
import { generateTypeDeclaration, jsonSchemaToTs } from '../src/json-schema-to-ts'

describe('jsonSchemaToTs', () => {
  it('converts primitives', () => {
    expect(jsonSchemaToTs({ type: 'string' })).toBe('string')
    expect(jsonSchemaToTs({ type: 'number' })).toBe('number')
    expect(jsonSchemaToTs({ type: 'integer' })).toBe('number')
    expect(jsonSchemaToTs({ type: 'boolean' })).toBe('boolean')
    expect(jsonSchemaToTs({ type: 'null' })).toBe('null')
  })

  it('converts arrays', () => {
    expect(jsonSchemaToTs({ type: 'array', items: { type: 'string' } })).toBe('string[]')
    expect(jsonSchemaToTs({ type: 'array' })).toBe('unknown[]')
    expect(jsonSchemaToTs({ type: 'array', items: { type: 'array', items: { type: 'number' } } })).toBe('number[][]')
  })

  it('converts objects with required/optional properties', () => {
    const result = jsonSchemaToTs({
      type: 'object',
      properties: { name: { type: 'string' }, age: { type: 'number' } },
      required: ['name'],
    })
    expect(result).toContain('name: string')
    expect(result).toContain('age?: number')
  })

  it('converts nested objects', () => {
    const result = jsonSchemaToTs({
      type: 'object',
      properties: {
        user: { type: 'object', properties: { email: { type: 'string' } }, required: ['email'] },
      },
      required: ['user'],
    })
    expect(result).toContain('user: {')
    expect(result).toContain('email: string')
  })

  it('handles objects without properties', () => {
    expect(jsonSchemaToTs({ type: 'object' })).toBe('Record<string, unknown>')
    expect(jsonSchemaToTs({ type: 'object', additionalProperties: false })).toBe('Record<string, never>')
    expect(jsonSchemaToTs({ type: 'object', additionalProperties: { type: 'string' } })).toBe('Record<string, string>')
  })

  it('quotes invalid property names', () => {
    const result = jsonSchemaToTs({
      type: 'object',
      properties: { 'valid-key': { type: 'string' }, '123invalid': { type: 'number' } },
    })
    expect(result).toContain('"valid-key"')
    expect(result).toContain('"123invalid"')
  })

  it('converts union types', () => {
    expect(jsonSchemaToTs({ anyOf: [{ type: 'string' }, { type: 'number' }] })).toBe('string | number')
    expect(jsonSchemaToTs({ oneOf: [{ type: 'boolean' }, { type: 'null' }] })).toBe('boolean | null')
    expect(jsonSchemaToTs({ type: ['string', 'null'] })).toBe('string | null')
  })

  it('converts intersection types', () => {
    const result = jsonSchemaToTs({
      allOf: [
        { type: 'object', properties: { a: { type: 'string' } } },
        { type: 'object', properties: { b: { type: 'number' } } },
      ],
    })
    expect(result).toContain('&')
  })

  it('converts const and enum', () => {
    expect(jsonSchemaToTs({ const: 'hello' })).toBe('"hello"')
    expect(jsonSchemaToTs({ const: 42 })).toBe('42')
    expect(jsonSchemaToTs({ enum: ['a', 'b', 'c'] })).toBe('"a" | "b" | "c"')
    expect(jsonSchemaToTs({ enum: ['active', 1, null] })).toBe('"active" | 1 | null')
  })

  it('handles edge cases', () => {
    expect(jsonSchemaToTs({ $ref: '#/definitions/User' })).toBe('unknown')
    expect(jsonSchemaToTs({})).toBe('unknown')
  })
})

describe('generateTypeDeclaration', () => {
  it('generates complete declaration file', () => {
    const result = generateTypeDeclaration({
      type: 'object',
      properties: {
        secretKey: { type: 'string' },
        public: { type: 'object', properties: { apiBase: { type: 'string' } }, required: ['apiBase'] },
      },
      required: ['secretKey', 'public'],
    })

    expect(result).toContain('export type SafeRuntimeConfig')
    expect(result).toContain('secretKey: string')
    expect(result).toContain('apiBase: string')
    expect(result).toContain('declare module \'#imports\'')
    expect(result).toContain('useSafeRuntimeConfig(): SafeRuntimeConfig')
  })
})
