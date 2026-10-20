type JsonSchema = Record<string, unknown>

const booleanStrings: Record<string, boolean> = { true: true, false: false, 1: true, 0: false }
const combinators = ['anyOf', 'oneOf', 'allOf'] as const

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

/** Resolves `$ref` and flattens `anyOf`/`oneOf`/`allOf` into the schemas a value may match. */
function alternatives(schema: unknown, root: JsonSchema, seen = new Set<JsonSchema>()): JsonSchema[] {
  if (schema === true)
    return [{}]
  const resolved = isPlainObject(schema) ? resolveRef(schema, root) : undefined
  if (!resolved || seen.has(resolved))
    return []
  seen.add(resolved)

  const nested = combinators.flatMap(key => Array.isArray(resolved[key]) ? resolved[key] as unknown[] : [])
  return [resolved, ...nested.flatMap(branch => alternatives(branch, root, seen))]
}

interface Accepted {
  /** Some alternative has no type constraint, so any value is valid here */
  any: boolean
  types: Set<string>
  literals: unknown[]
}

function accepted(schemas: JsonSchema[]): Accepted {
  const result: Accepted = { any: false, types: new Set(), literals: [] }
  for (const schema of schemas) {
    if ('const' in schema)
      result.literals.push(schema.const)
    else if (Array.isArray(schema.enum))
      result.literals.push(...schema.enum)
    else if (!('type' in schema) && !combinators.some(key => key in schema))
      result.any = true

    for (const type of Array.isArray(schema.type) ? schema.type : [schema.type]) {
      if (typeof type === 'string')
        result.types.add(type)
    }
  }
  return result
}

function accepts(value: unknown, { any, types, literals }: Accepted): boolean {
  if (any || literals.includes(value))
    return true
  if (typeof value === 'number')
    return types.has('number') || (types.has('integer') && Number.isInteger(value))
  if (Array.isArray(value))
    return types.has('array')
  if (value === null)
    return types.has('null')
  return types.has(isPlainObject(value) ? 'object' : typeof value)
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

function candidates(value: unknown): unknown[] {
  if (typeof value === 'string') {
    const parsed = parseJson(value)
    return [
      parseNumber(value),
      booleanStrings[value.trim().toLowerCase()],
      typeof parsed === 'object' ? parsed : undefined,
    ]
  }
  // Nitro 2 parses env values with destr, so `1` and `true` may stand for the strings '1' and 'true'.
  if (typeof value === 'number')
    return [Number.isSafeInteger(value) ? String(value) : undefined, value === 1 ? true : value === 0 ? false : undefined]
  if (typeof value === 'boolean')
    return [String(value)]
  return []
}

function coerceScalar(value: unknown, schemas: JsonSchema[]): unknown {
  const target = accepted(schemas)
  if (accepts(value, target))
    return value
  return candidates(value).find(candidate => candidate !== undefined && accepts(candidate, target)) ?? value
}

function looselyEquals(value: unknown, literal: unknown): boolean {
  return value === literal || (value !== undefined && value !== null && String(value) === String(literal))
}

// Discriminated unions: skip object branches whose literal properties contradict the value.
function matchingBranches(value: Record<string, unknown>, schemas: JsonSchema[]): JsonSchema[] {
  const matching = schemas.filter((schema) => {
    const properties = isPlainObject(schema.properties) ? schema.properties : {}
    return Object.entries(properties).every(([key, property]) => {
      if (!isPlainObject(property) || !(key in value))
        return true
      const literals = 'const' in property ? [property.const] : Array.isArray(property.enum) && property.enum.length === 1 ? property.enum : undefined
      return !literals || literals.some(literal => looselyEquals(value[key], literal))
    })
  })
  return matching.length ? matching : schemas
}

function matchesPattern(pattern: string, key: string): boolean {
  try {
    return new RegExp(pattern, 'u').test(key)
  }
  catch {
    return false
  }
}

function propertySchemas(schema: JsonSchema, key: string): unknown[] {
  if (isPlainObject(schema.properties) && key in schema.properties)
    return [schema.properties[key]]
  const patterns = isPlainObject(schema.patternProperties)
    ? Object.entries(schema.patternProperties).filter(([pattern]) => matchesPattern(pattern, key)).map(([, property]) => property)
    : []
  if (patterns.length)
    return patterns
  return 'additionalProperties' in schema ? [schema.additionalProperties] : []
}

function itemSchemas(schema: JsonSchema, index: number): unknown[] {
  if (Array.isArray(schema.prefixItems))
    return index < schema.prefixItems.length ? [schema.prefixItems[index]] : 'items' in schema ? [schema.items] : []
  if (Array.isArray(schema.items))
    return index < schema.items.length ? [schema.items[index]] : 'additionalItems' in schema ? [schema.additionalItems] : []
  return 'items' in schema ? [schema.items] : []
}

function coerceChildren<T extends unknown[] | Record<string, unknown>>(
  value: T,
  childSchemas: (key: string, index: number) => unknown[],
  root: JsonSchema,
): T {
  let result = value
  Object.entries(value).forEach(([key, child], index) => {
    const schemas = childSchemas(key, index).filter(schema => schema !== false)
    if (!schemas.length)
      return
    const next = coerceNode(child, { anyOf: schemas }, root)
    if (next === child)
      return
    if (result === value)
      result = (Array.isArray(value) ? [...value] : { ...value }) as T
    ;(result as Record<string, unknown>)[key] = next
  })
  return result
}

function coerceNode(value: unknown, schema: unknown, root: JsonSchema): unknown {
  const schemas = alternatives(schema, root)
  if (!schemas.length)
    return value

  const coerced = coerceScalar(value, schemas)
  if (isPlainObject(coerced)) {
    const branches = matchingBranches(coerced, schemas)
    return coerceChildren(coerced, key => branches.flatMap(branch => propertySchemas(branch, key)), root)
  }
  if (Array.isArray(coerced))
    return coerceChildren(coerced, (_, index) => schemas.flatMap(branch => itemSchemas(branch, index)), root)
  return coerced
}

/**
 * Converts runtime env overrides to the types the JSON Schema expects.
 *
 * A value the schema already accepts is left alone. Otherwise a string may become a number,
 * boolean (`true`/`false`/`1`/`0`), or JSON array/object, and a Nitro 2 `destr` number or
 * boolean may become its string form. Unchanged subtrees keep their identity, and the input
 * is never mutated.
 */
export function coerceRuntimeConfig<T>(value: T, schema: JsonSchema | null | undefined): T {
  if (!schema || !Object.keys(schema).length)
    return value
  return coerceNode(value, schema, schema) as T
}
