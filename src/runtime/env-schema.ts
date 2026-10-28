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

function matchesInjectedValue(current: unknown, raw: string): boolean {
  if (current === raw)
    return true
  try {
    const parsed: unknown = JSON.parse(raw)
    return Object.is(current, parsed) || (isRecord(current) && isRecord(parsed) && JSON.stringify(current) === JSON.stringify(parsed))
  }
  catch {
    if (typeof current === 'boolean')
      return String(current) === raw.trim().toLowerCase()
    return typeof current === 'number' && raw.trim() !== '' && Number(raw) === current
  }
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

    // Read the original injected string before Nitro's JSON parsing loses its spelling.
    const raw = Object.hasOwn(env, envKey) ? env[envKey] : undefined
    // A request-scoped binding can differ from the process environment. Keep its value.
    const hasOverride = raw !== undefined && (!Object.hasOwn(config, key) || isUnsetValue(config[key]) || matchesInjectedValue(config[key], raw))
    let value: unknown = hasOverride ? env[envKey] : config[key]
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

export function envSchemaIssueLocation(schema: JsonSchema, location: string): string {
  if (!isEnvSchema(schema))
    return ''
  let current: unknown = schema
  for (const segment of location.split('/').slice(1)) {
    if (!isRecord(current) || !isRecord(current.properties))
      return ''
    current = current.properties[segment.replace(/~1/g, '/').replace(/~0/g, '~')]
  }
  if (!isRecord(current) || typeof current['x-env-key'] !== 'string')
    return ''
  const source = current['x-env-source']
  return isRecord(source) && typeof source.file === 'string' && typeof source.line === 'number'
    ? `${source.file}:${source.line} (${current['x-env-key']}) `
    : ''
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
