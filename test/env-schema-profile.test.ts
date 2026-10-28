import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ENV_SCHEMA_PROFILE, parseEnvSchema } from '../src/env-schema/profile'

function fixture(name: string) {
  const filename = fileURLToPath(new URL(`./fixtures/env-schema-profile/${name}.env`, import.meta.url))
  return parseEnvSchema(readFileSync(filename, 'utf8'), filename)
}

describe('env-spec-v1 profile', () => {
  it('reads one serializable contract with required secrets, defaults and examples', () => {
    expect(ENV_SCHEMA_PROFILE).toBe('env-spec-v1')
    const fields = fixture('contract')
    expect(fields).toHaveLength(6)
    expect(fields[0]).toMatchObject({ key: 'DATABASE_URL', type: { kind: 'url' }, required: true, sensitive: true, example: 'https://example.test/database', description: 'Database connection.', source: { line: 6 } })
    expect(fields[0]).not.toHaveProperty('default')
    expect(fields[1]).toMatchObject({ key: 'PORT', type: { kind: 'number', min: 1, max: 65535, isInt: true }, default: 3000, required: true, sensitive: false, source: { line: 10 } })
    expect(fields[2]).toMatchObject({ type: { kind: 'boolean' }, default: false, sensitive: false })
    expect(fields[3]).toMatchObject({ type: { kind: 'enum', values: ['debug', 'info', 'warn', 'error'] }, default: 'info' })
    expect(fields[4]).toMatchObject({ required: false, default: '' })
    expect(fields[5]).toMatchObject({ required: false, type: { kind: 'number' } })
    expect(fields[5]).not.toHaveProperty('default')
    expect(JSON.parse(JSON.stringify(fields))).toEqual(fields)
  })

  it('uses the actual parser for quoting, comments and multiline values', () => {
    const fields = fixture('quoted')
    expect(fields.map(field => field.default)).toEqual(['value#with=hash', 'literal $VALUE', 'first\nsecond', '00123', 'true', '$OTHER', '\\$OTHER', '$OTHER'])
    expect(fields.every(field => field.type.kind === 'string')).toBe(true)
    expect(fields[0]?.description).toBe('A literal hash and equals sign remain part of this string.')
  })

  it('preserves string lexical contents rather than inferring types', () => {
    const fields = parseEnvSchema('A=0123\nB=true\nC=false\nD=123.00\nE=1e5\nF=undefined\nG=123\n', 'lexical.env')
    expect(fields.map(field => field.default)).toEqual(['0123', 'true', 'false', '123.00', '1e5', 'undefined', '123'])
    expect(parseEnvSchema('# @type=string\nA=00123', 'lexical.env')[0]?.default).toBe('00123')
  })

  it('keeps missing and explicit empty string distinct', () => {
    const fields = parseEnvSchema('# @optional\nA=\n# @optional\nB=""\n# @optional @type=number\nC=""\n# @optional @type=boolean\nD=""', 'empty.env')
    expect(fields[0]).not.toHaveProperty('default')
    expect(fields[1]).toHaveProperty('default', '')
    expect(fields[2]).not.toHaveProperty('default')
    expect(fields[3]).not.toHaveProperty('default')
    expect(() => parseEnvSchema('A=""', 'empty.env')).toThrow('Required default cannot be empty')
    expect(parseEnvSchema('A=', 'required.env')[0]).toMatchObject({ required: true, sensitive: true })
  })

  it('allows static header defaults with explicit item overrides', () => {
    const fields = parseEnvSchema('# @defaultRequired=false @defaultSensitive=false\n# ---\nA=\n# @required @sensitive\nB=\n# @optional=false @public=false\nC=', 'header.env')
    expect(fields.map(field => [field.required, field.sensitive])).toEqual([[false, false], [true, true], [true, true]])
  })

  it('attaches descriptions only across contiguous comment lines and omits disabled assignments', () => {
    const fields = parseEnvSchema('# detached\n\n# first\n# @optional\n# DISABLED=private-value\n# second\nA=\n# detached\n# ---\nB=', 'comments.env')
    expect(fields[0]?.description).toBe('first\nsecond')
    expect(fields[0]?.source).toEqual({ file: 'comments.env', line: 7 })
    expect(fields[1]?.description).toBe('')
    expect(parseEnvSchema('# first\r\n# @optional\r\nA=', 'crlf.env')[0]?.source.line).toBe(3)
  })

  it.each([
    ['# @type=number\nA=1e3', 1000],
    ['# @type=number\nA=" 2.5 "', 2.5],
    ['# @type=boolean\nA=true', true],
    ['# @type=boolean\nA=0', false],
    ['# @type=boolean\nA="1"', true],
    ['# @type=url\nA=https://example.test', 'https://example.test'],
    ['# @type=string(minLength=2, maxLength=4)\nA=abc', 'abc'],
    ['# @type=enum("true", "123")\nA=123', '123'],
  ])('validates and converts defaults for %s', (source, expected) => {
    expect(parseEnvSchema(source, 'default.env')[0]?.default).toBe(expected)
  })

  it.each([
    '# @type=number\nA=NaN',
    '# @type=number\nA=Infinity',
    '# @type=number\nA=0xff',
    '# @type=number\nA=" "',
    '# @type=number(min=2)\nA=1',
    '# @type=number(max=2)\nA=3',
    '# @type=number(isInt=true)\nA=2.5',
    '# @type=boolean\nA=yes',
    '# @type=url\nA=relative/path',
    '# @type=enum(a, b)\nA=c',
    '# @type=string(minLength=4)\nA=abc',
    '# @type=string(maxLength=2)\nA=abc',
    '# @optional @type=string(minLength=1)\nA=""',
  ])('rejects invalid defaults instead of inventing a fallback: %s', (source) => {
    expect(() => parseEnvSchema(source, 'default.env')).toThrow(/default\.env:2 \(A\): Default/)
  })

  it.each([
    ['# @type=unknown\nA=', 'Unsupported type'],
    ['# @type=number(precision=2)\nA=', 'Unsupported type argument'],
    ['# @type=number(min=1, min=2)\nA=', 'Duplicate type argument'],
    ['# @type=number(min=10, max=2)\nA=', 'Minimum exceeds maximum'],
    ['# @type=string(minLength=-1)\nA=', 'Invalid numeric type argument'],
    ['# @type=string(minLength=4, maxLength=2)\nA=', 'Minimum length exceeds maximum length'],
    ['# @type=boolean(extra=true)\nA=', 'Unsupported type argument'],
    ['# @type=enum()\nA=', 'Enum requires string choices'],
    ['# @type=enum(true, false)\nA=', 'Enum requires nonempty string choices'],
    ['# @type=enum(a, a)\nA=', 'Duplicate enum choice'],
    ['# @type=number(min=ref(A))\nA=', 'Only static values'],
    ['# @example=123\nA=', 'Example must be a string'],
    ['# @required="true"\nA=', 'Decorator requires a static boolean'],
    ['# @defaultRequired=infer\n# ---\nA=', 'Decorator requires a static boolean'],
  ])('rejects unsupported schema declarations: %s', (source, message) => {
    expect(() => parseEnvSchema(source, 'schema.env')).toThrow(message)
  })

  it.each([
    ['A=\nA=', 'Duplicate environment key'],
    ['# @required @required\nA=', 'Duplicate decorator'],
    ['# @required @optional\nA=', 'Cannot combine required and optional'],
    ['# @sensitive @public\nA=', 'Cannot combine sensitive and public'],
    ['# @unknown\nA=', 'Unsupported or malformed decorator'],
    ['# @required stray\nA=', 'Unsupported or malformed decorator'],
    ['# @defaultRequired=false\n\nA=', 'Root decorators require a header divider'],
    ['A=\n# @optional\n\nB=', 'Decorator is not attached to a declaration'],
    ['# @defaultSensitive=true\n# ---\n# @defaultRequired=true\n# ---\n# @defaultRequired=false\n# ---\nA=', 'Duplicate decorator'],
  ])('rejects duplicates, conflicts and misplaced annotations: %s', (source, message) => {
    expect(() => parseEnvSchema(source, 'schema.env')).toThrow(message)
  })

  it.each(['__proto__', 'constructor', 'PROTOTYPE', 'INVALID.KEY', 'INVALID-KEY', 'X'.repeat(257)])('rejects unsafe or nonportable key %s', (key) => {
    expect(() => parseEnvSchema(`${key}=`, 'keys.env')).toThrow('Invalid or reserved environment key')
  })

  it.each([
    'A=$OTHER',
    'A="$' + '{OTHER}"',
    'A=$(private-command)',
    'A=fetchSecret(private-reference)',
    'A=[a, b]',
    'A={key=value}',
    '# @required=forEnv(production)\nA=',
    '# @example="$OTHER"\nA=',
  ])('rejects expressions without evaluating them: %s', (source) => {
    expect(() => parseEnvSchema(source, 'dynamic.env')).toThrow(/unsupported|Only static/)
  })

  it('reports safe locations without echoing default values or parser source excerpts', () => {
    expect(() => fixture('invalid-default')).toThrow(/invalid-default\.env:2 \(PORT\): Default/)
    expect(() => fixture('unsupported')).toThrow('Only static values')
    const sources = ['# @type=number\nPRIVATE=private-marker', 'PRIVATE="private-marker', 'PRIVATE=private-marker\nmalformed private-marker']
    for (const source of sources) {
      try {
        parseEnvSchema(source, 'safe.env')
        expect.fail('Expected a schema error')
      }
      catch (error: unknown) {
        expect(error).toBeInstanceOf(Error)
        if (error instanceof Error) {
          expect(error.message).toMatch(/^safe\.env:\d+/)
          expect(error.message).not.toContain('private-marker')
        }
      }
    }
  })
})
