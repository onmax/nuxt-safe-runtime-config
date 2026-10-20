type JsonSchema = Record<string, unknown>
type JsonType = 'array' | 'boolean' | 'integer' | 'null' | 'number' | 'object' | 'string'

const booleanStrings: Record<string, boolean> = { true: true, false: false, 1: true, 0: false }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function resolveRef(schema: JsonSchema, root: JsonSchema): JsonSchema | undefined {
  const ref = schema.$ref
  if (typeof ref !== 'string')
    return schema
  if (!ref.startsWith('#/'))
    return undefined

  let target: unknown = root
  for (const segment of ref.slice(2).split('/'))
    target = isPlainObject(target) ? target[segment.replace(/~1/g, '/').replace(/~0/g, '~')] : undefined
  return isPlainObject(target) ? resolveRef(target, root) : undefined
}

/** Flattens `anyOf`/`oneOf`/`allOf` into the branches a value may match. */
function branches(schema: JsonSchema, root: JsonSchema, seen = new Set<JsonSchema>()): JsonSchema[] {
  const resolved = resolveRef(schema, root)
  if (!resolved || seen.has(resolved))
    return []
  seen.add(resolved)

  const nested = [resolved.anyOf, resolved.oneOf, resolved.allOf].filter(Array.isArray).flat() as JsonSchema[]
  if (!nested.length)
    return [resolved]
  return [resolved, ...nested.flatMap(branch => isPlainObject(branch) ? branches(branch, root, seen) : [])]
}

function acceptedTypes(schemas: JsonSchema[]): Set<JsonType> {
  const types = new Set<JsonType>()
  for (const schema of schemas) {
    const type = schema.type
    for (const entry of Array.isArray(type) ? type : [type]) {
      if (typeof entry === 'string')
        types.add(entry as JsonType)
    }
    const literals = 'const' in schema ? [schema.const] : Array.isArray(schema.enum) ? schema.enum : []
    for (const literal of literals) {
      if (typeof literal === 'string' || typeof literal === 'boolean' || typeof literal === 'number')
        types.add(typeof literal as JsonType)
    }
    if (isPlainObject(schema.properties))
      types.add('object')
    if ('items' in schema || 'prefixItems' in schema)
      types.add('array')
  }
  if (types.has('integer'))
    types.add('number')
  return types
}

function parseNumber(value: string): number | undefined {
  const trimmed = value.trim()
  if (!trimmed)
    return undefined
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : undefined
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value)
  }
  catch {
    return undefined
  }
}

function coerceScalar(value: unknown, types: Set<JsonType>): unknown {
  if (typeof value === 'string' && !types.has('string')) {
    const number = types.has('number') ? parseNumber(value) : undefined
    if (number !== undefined)
      return number
    const boolean = booleanStrings[value.trim().toLowerCase()]
    if (types.has('boolean') && boolean !== undefined)
      return boolean
    if (types.has('object') || types.has('array')) {
      const parsed = parseJson(value)
      if ((types.has('array') && Array.isArray(parsed)) || (types.has('object') && isPlainObject(parsed)))
        return parsed
    }
    return value
  }

  // Nitro 2 parses `NUXT_FLAG=1` into the number 1.
  if (typeof value === 'number' && !types.has('number') && types.has('boolean') && (value === 0 || value === 1))
    return value === 1

  return value
}

function coerceNode(value: unknown, schema: JsonSchema, root: JsonSchema): unknown {
  const schemas = branches(schema, root)
  if (!schemas.length)
    return value

  const coerced = coerceScalar(value, acceptedTypes(schemas))

  if (isPlainObject(coerced))
    return coerceObject(coerced, schemas, root)
  if (Array.isArray(coerced))
    return coerceArray(coerced, schemas, root)
  return coerced
}

function coerceObject(value: Record<string, unknown>, schemas: JsonSchema[], root: JsonSchema): Record<string, unknown> {
  let result = value
  for (const [key, child] of Object.entries(value)) {
    const childSchemas = schemas.flatMap((schema) => {
      const properties = isPlainObject(schema.properties) ? schema.properties : undefined
      const property = properties?.[key] ?? schema.additionalProperties
      return isPlainObject(property) ? [property] : []
    })
    let next = child
    for (const childSchema of childSchemas)
      next = coerceNode(next, childSchema, root)
    if (next !== child) {
      if (result === value)
        result = { ...value }
      result[key] = next
    }
  }
  return result
}

function coerceArray(value: unknown[], schemas: JsonSchema[], root: JsonSchema): unknown[] {
  const itemSchemas = schemas.flatMap(schema => isPlainObject(schema.items) ? [schema.items] : [])
  if (!itemSchemas.length)
    return value

  let changed = false
  const result = value.map((item) => {
    let next = item
    for (const itemSchema of itemSchemas)
      next = coerceNode(next, itemSchema, root)
    changed ||= next !== item
    return next
  })
  return changed ? result : value
}

/**
 * Converts runtime env overrides to the types the JSON Schema expects.
 *
 * Only values the schema would reject are touched: a string becomes a number,
 * boolean (`true`/`false`/`1`/`0`), or JSON array/object when the schema does not
 * accept strings at that path. Unchanged subtrees keep their identity.
 */
export function coerceRuntimeConfig<T>(value: T, schema: JsonSchema | null | undefined): T {
  if (!schema || !Object.keys(schema).length)
    return value
  return coerceNode(value, schema, schema) as T
}
