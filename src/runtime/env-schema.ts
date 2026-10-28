import type { OutputUnit } from '@cfworker/json-schema'

type JsonSchema = Record<string, unknown>

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isUnsetValue(value: unknown): boolean {
  return isRecord(value) && Object.keys(value).length === 1 && value.__envSchemaUnset === true
}

export function isEnvSchema(schema: JsonSchema): boolean {
  return schema['x-env-profile'] === 'env-spec-v1'
}

/** Captures declared lexical inputs at the point Nitro creates a config from this env. */
export function captureEnvSchemaEnvironment(schema: JsonSchema, env: Record<string, string | undefined>): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = {}
  if (!isRecord(schema.properties))
    return result
  for (const property of Object.values(schema.properties)) {
    if (!isRecord(property))
      continue
    const key = property['x-env-key']
    if (typeof key === 'string') {
      if (Object.hasOwn(env, key))
        result[key] = env[key]
    }
    else {
      Object.assign(result, captureEnvSchemaEnvironment(property, env))
    }
  }
  return result
}

function normalizeField(value: unknown, schema: JsonSchema): unknown {
  if (schema.type === 'number' || schema.type === 'integer') {
    if (typeof value !== 'string')
      return value
    const text = value.trim()
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text))
      return value
    const number = Number(text)
    return Number.isFinite(number) ? number : value
  }
  if (schema.type === 'boolean') {
    if (value === 1 || value === 0)
      return value === 1
    if (typeof value === 'string') {
      const text = value.trim().toLowerCase()
      if (text === 'true' || text === '1')
        return true
      if (text === 'false' || text === '0')
        return false
    }
    return value
  }
  if (schema.type === 'string' && (typeof value === 'number' || typeof value === 'boolean'))
    return String(value)
  return value
}

function normalizeObject(config: Record<string, unknown>, schema: JsonSchema, env: Record<string, string | undefined>): Record<string, unknown> {
  const result = { ...config }
  if (!isRecord(schema.properties))
    return result
  for (const [key, property] of Object.entries(schema.properties)) {
    if (!isRecord(property))
      continue
    const envKey = property['x-env-key']
    if (typeof envKey !== 'string') {
      if (isRecord(config[key]))
        result[key] = normalizeObject(config[key], property, env)
      continue
    }

    // Only the caller that knows the config's source may supply lexical env values.
    const raw = Object.hasOwn(env, envKey) ? env[envKey] : undefined
    const hasOverride = raw !== undefined
    if (!hasOverride && !Object.hasOwn(config, key))
      continue
    let value: unknown = hasOverride ? raw : config[key]
    const optional = property['x-env-required'] === false
    const plainString = property.type === 'string' && !property.enum && !property.format
    if (optional && ((!hasOverride && (isUnsetValue(value) || value === null)) || (value === '' && !plainString)))
      value = property.default
    if (value === undefined && optional) {
      delete result[key]
      continue
    }
    result[key] = normalizeField(value === undefined ? null : value, property)
  }
  return result
}

/** Normalizes only the compiled experiment; other schema sources keep their own semantics. */
export function normalizeEnvSchemaConfig(config: Record<string, unknown>, schema: JsonSchema, env: Record<string, string | undefined> = {}): Record<string, unknown> {
  return isEnvSchema(schema) ? normalizeObject(config, schema, env) : config
}

function sourceLocations(schema: JsonSchema): string[] {
  const source = schema['x-env-source']
  if (typeof schema['x-env-key'] === 'string' && isRecord(source) && typeof source.file === 'string' && typeof source.line === 'number')
    return [`${source.file}:${source.line} (${schema['x-env-key']})`]
  const properties = schema.properties
  if (!isRecord(properties) || !Array.isArray(schema.required))
    return []
  return schema.required.flatMap((key: unknown) => typeof key === 'string' && isRecord(properties[key]) ? sourceLocations(properties[key]) : [])
}

export function envSchemaIssueLocation(schema: JsonSchema, issue: Pick<OutputUnit, 'instanceLocation' | 'keyword' | 'error'>): string {
  if (!isEnvSchema(schema))
    return ''
  let current: unknown = schema
  for (const segment of issue.instanceLocation.split('/').slice(1)) {
    if (!isRecord(current) || !isRecord(current.properties))
      return ''
    current = current.properties[segment.replace(/~1/g, '/').replace(/~0/g, '~')]
  }
  if (issue.keyword === 'required') {
    // The validator points required errors at the containing object, not the missing child.
    const key = issue.error.match(/^Instance does not have required property "([^"]+)"\.$/)?.[1]
    if (!key || !isRecord(current) || !isRecord(current.properties))
      return ''
    current = current.properties[key]
  }
  if (!isRecord(current))
    return ''
  const locations = sourceLocations(current)
  return locations.length ? `${locations.join(', ')} ` : ''
}

/** Keeps omitted optional declarations out of Nuxt's serialized public payload. */
export function clearAbsentEnvSchemaValues(config: Record<string, unknown>, value: Record<string, unknown>, schema: JsonSchema): void {
  if (!isRecord(schema.properties))
    return
  for (const [key, property] of Object.entries(schema.properties)) {
    if (!isRecord(property))
      continue
    if (property['x-env-required'] === false && typeof property['x-env-key'] === 'string' && !Object.hasOwn(value, key))
      Reflect.set(config, key, undefined)
    else if (isRecord(config[key]) && isRecord(value[key]))
      clearAbsentEnvSchemaValues(config[key], value[key], property)
  }
}
