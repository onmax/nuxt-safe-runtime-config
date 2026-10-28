import { Validator } from '@cfworker/json-schema'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { compileEnvSchema } from '../src/env-schema/nuxt'
import { parseEnvSchema } from '../src/env-schema/profile'
import { generateTypeDeclaration } from '../src/json-schema-to-ts'

function compile(source: string, paths?: Record<string, string>) {
  return compileEnvSchema(parseEnvSchema(source, '.env.example'), { paths })
}

afterEach(() => vi.unstubAllEnvs())

describe('nuxt env schema compiler', () => {
  it('uses declared defaults without loading environment values or examples', () => {
    vi.stubEnv('NUXT_COMPILER_CANARY', 'injected-but-not-a-default')
    const result = compile(`
# Database address.
# @type=url @example="https://example.test/documentation-only"
NUXT_DATABASE_URL=
# @example="example-only"
NUXT_COMPILER_CANARY=
# @type=number(min=1, max=65535, isInt=true)
NUXT_PORT=3000
# @type=boolean
NUXT_ENABLED=false
# @type=enum(debug, info)
NUXT_LOG_LEVEL=info
`)
    expect(result.runtimeConfig).toEqual({ databaseUrl: { __envSchemaUnset: true }, compilerCanary: { __envSchemaUnset: true }, port: 3000, enabled: false, logLevel: 'info' })
    expect(JSON.stringify(result)).not.toContain('documentation-only')
    expect(JSON.stringify(result)).not.toContain('example-only')
    expect(JSON.stringify(result)).not.toContain('injected-but-not-a-default')
    expect(result.jsonSchema.properties.port).toMatchObject({ type: 'integer', minimum: 1, maximum: 65535, default: 3000 })
  })

  it('keeps private names flat regardless of neighboring prefixes', () => {
    const first = compile('NUXT_DATABASE_URL=')
    const second = compile('NUXT_DATABASE_URL=\nNUXT_DATABASE_TOKEN=')
    expect(first.runtimeConfig).toEqual({ databaseUrl: { __envSchemaUnset: true } })
    expect(second.runtimeConfig).toEqual({ databaseUrl: { __envSchemaUnset: true }, databaseToken: { __envSchemaUnset: true } })
    expect(second.mappings.map(mapping => mapping.path)).toEqual([['databaseUrl'], ['databaseToken']])
  })

  it('uses only the canonical prefix to expose public values', () => {
    const result = compile(`
# @public @type=number
NUXT_PORT=3000
# @public
NUXT_PUBLIC_TITLE=Portal
`)
    expect(result.runtimeConfig).toEqual({ port: 3000, public: { title: 'Portal' } })
    expect(result.mappings.map(mapping => mapping.path)).toEqual([['port'], ['public', 'title']])
    expect(() => compile('NUXT_PUBLIC_TOKEN=')).toThrow('require @public or @sensitive=false')
    expect(compile('# @sensitive=false\nNUXT_PUBLIC_TITLE=Portal').runtimeConfig).toEqual({ public: { title: 'Portal' } })
  })

  it('preserves nested explicit mappings that match Nuxt runtime overrides', () => {
    const result = compile(`
# @public @type=boolean
NUXT_PUBLIC_POSTHOG_ENABLED=false
# @public @type=number(min=0, max=1)
NUXT_PUBLIC_POSTHOG_REPLAY_SAMPLE_RATE=0.1
NUXT_GITHUB_OAUTH_CLIENT_SECRET=
`, {
      NUXT_PUBLIC_POSTHOG_ENABLED: 'public.posthog.enabled',
      NUXT_PUBLIC_POSTHOG_REPLAY_SAMPLE_RATE: 'public.posthog.replaySampleRate',
      NUXT_GITHUB_OAUTH_CLIENT_SECRET: 'githubOauth.clientSecret',
    })
    expect(result.runtimeConfig).toEqual({ public: { posthog: { enabled: false, replaySampleRate: 0.1 } }, githubOauth: { clientSecret: { __envSchemaUnset: true } } })
    expect(result.mappings[1]).toMatchObject({ key: 'NUXT_PUBLIC_POSTHOG_REPLAY_SAMPLE_RATE', path: ['public', 'posthog', 'replaySampleRate'], type: { kind: 'number', min: 0, max: 1 } })
    expect(new Validator(result.jsonSchema).validate({ public: { posthog: { enabled: true, replaySampleRate: 0.4 } }, githubOauth: { clientSecret: 'credential' } }).valid).toBe(true)
  })

  it.each([
    ['NUXT_PORT=', { NUXT_PORT: 'public.port' }, 'visibility'],
    ['# @public\nNUXT_PUBLIC_PORT=', { NUXT_PUBLIC_PORT: 'port' }, 'visibility'],
    ['NUXT_PORT=', { NUXT_PORT: 'differentPort' }, 'roundtrip'],
    ['NUXT_PORT=', { NUXT_UNKNOWN: 'unknown' }, 'undeclared'],
  ])('rejects incompatible mappings for %s', (source, paths, error) => {
    expect(() => compile(source, paths)).toThrow(error)
  })

  it('rejects duplicate fields even when called with already parsed fields', () => {
    const fields = parseEnvSchema('NUXT_TOKEN=', '.env.example')
    expect(() => compileEnvSchema([...fields, ...fields])).toThrow('Duplicate environment key')
  })

  it.each([
    'NUXT_GROUP=\nNUXT_GROUP_TOKEN=',
    'NUXT_GROUP_TOKEN=\nNUXT_GROUP=',
  ])('rejects scalar and nested path collisions in either declaration order', (source) => {
    expect(() => compile(source, { NUXT_GROUP_TOKEN: 'group.token' })).toThrow('overlapping config path')
  })

  it.each([
    'PORT=',
    'PUBLIC_PORT=',
    'nuxt_PORT=',
    'NUXT_port=',
    'NUXT_PORT__VALUE=',
    'NUXT_PORT_=',
    'NUXT_APP_BASE_URL=',
    'NUXT_NITRO_PRESET=',
    'NUXT_PUBLIC=',
    'NUXT_CONSTRUCTOR=',
    'NUXT_PROTOTYPE=',
    '# @public\nNUXT_PUBLIC_CONSTRUCTOR=',
  ])('rejects noncanonical or reserved names: %s', (source) => {
    expect(() => compile(source)).toThrow()
  })

  it.each([
    'app.token',
    'nitro.token',
    'group.__proto__',
    'group.constructor',
    'group.prototype',
    'group..token',
    'group[0].token',
    'group.token-name',
  ])('rejects reserved or unsafe explicit path %s', (path) => {
    expect(() => compile('NUXT_GROUP_TOKEN=', { NUXT_GROUP_TOKEN: path })).toThrow()
  })

  it('emits constrained schemas with source metadata and leaves app defaults accepted', () => {
    const result = compile(`# Access token.
# @type=string(minLength=4, maxLength=12)
NUXT_TOKEN=
# @type=number(min=0, max=5, isInt=true)
NUXT_RETRIES=
# @type=url
NUXT_ENDPOINT=
# @type=enum(draft, send)
NUXT_MODE=
`)
    expect(result.jsonSchema.properties.token).toMatchObject({ 'type': 'string', 'minLength': 4, 'maxLength': 12, 'description': 'Access token.', 'x-env-key': 'NUXT_TOKEN', 'x-env-source': { file: '.env.example', line: 3 }, 'x-env-sensitive': true })
    expect(result.jsonSchema.properties.endpoint).toMatchObject({ type: 'string', format: 'uri' })
    const validator = new Validator(result.jsonSchema)
    const valid = { token: 'abcd', retries: 2, endpoint: 'https://example.test', mode: 'draft', app: { baseURL: '/' } }
    expect(validator.validate(valid).valid).toBe(true)
    for (const invalid of [{ token: 'a' }, { token: 'a'.repeat(13) }, { retries: -1 }, { retries: 6 }, { retries: 1.5 }, { endpoint: 'not a URL' }, { mode: 'missing' }])
      expect(validator.validate({ ...valid, ...invalid }).valid).toBe(false)
    expect(validator.validate({}).valid).toBe(false)
  })

  it('requires nonempty strings even without an explicit minimum length', () => {
    const result = compile('NUXT_TOKEN=')
    const validator = new Validator(result.jsonSchema)
    expect(validator.validate({ token: '' }).valid).toBe(false)
    expect(validator.validate({ token: null }).valid).toBe(false)
    expect(validator.validate({ token: 'present' }).valid).toBe(true)
  })

  it('retains unresolved keys through serialization without treating the placeholder as valid', () => {
    const result = compile(`NUXT_REQUIRED_TOKEN=
# @optional
NUXT_OPTIONAL_TOKEN=
# @optional @type=number
NUXT_OPTIONAL_LIMIT=
`)
    expect(JSON.parse(JSON.stringify(result.runtimeConfig))).toEqual({ requiredToken: { __envSchemaUnset: true }, optionalToken: { __envSchemaUnset: true }, optionalLimit: { __envSchemaUnset: true } })
    const validator = new Validator(result.jsonSchema)
    expect(validator.validate(result.runtimeConfig).valid).toBe(false)
    expect(validator.validate({ requiredToken: 'present', optionalToken: null }).valid).toBe(false)
    expect(validator.validate({ requiredToken: 'present' }).valid).toBe(true)
    expect(validator.validate({ requiredToken: 'present', optionalToken: '' }).valid).toBe(true)
    expect(result.mappings).toContainEqual(expect.objectContaining({ key: 'NUXT_OPTIONAL_LIMIT', required: false, type: { kind: 'number' } }))
  })

  it('generates typed outputs for required, optional, defaulted and nested values', () => {
    const result = compile(`NUXT_TOKEN=
# @optional
NUXT_LABEL=
# @optional @type=number
NUXT_LIMIT=5
# @public @type=boolean
NUXT_PUBLIC_ENABLED=false
# @type=enum(draft, send)
NUXT_MODE=draft
# @type=url
NUXT_ENDPOINT=
`)
    const declaration = generateTypeDeclaration(result.jsonSchema)
    expect(declaration).toContain('token: string')
    expect(declaration).toContain('label?: string')
    expect(declaration).toContain('limit: number')
    expect(declaration).toContain('public: {')
    expect(declaration).toContain('enabled: boolean')
    expect(declaration).toContain('mode: "draft" | "send"')
    expect(declaration).toContain('endpoint: string')
    expect(declaration).not.toContain('null')
  })
})
