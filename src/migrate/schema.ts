/** Reads an evaluated `$schema` value: its library, the rules Nuxt can't keep, and the JSON Schema Nuxt will see. */

type JsonObject = Record<string, unknown>

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export type SchemaVendor = 'valibot' | 'zod' | 'arktype' | (string & {})

export interface SchemaNote {
  /** Dotted path inside runtimeConfig, `''` for the root. */
  path: string
  note: string
}

export interface SchemaAnalysis {
  vendor: SchemaVendor
  /** Valibot schemas need `toStandardJsonSchema()` before Nuxt can convert them. */
  needsWrap: boolean
  /** Reasons the codemod must stop for this schema. */
  stops: SchemaNote[]
  /** Rules Nuxt does not check, by path. */
  refinements: SchemaNote[]
  /** Behaviour that changes even though the schema converts, such as `.catch()`. */
  changes: SchemaNote[]
  json?: JsonObject
  /** Paths that the schema requires without a default. */
  required: Set<string>
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function join(path: string, key: string): string {
  return path ? `${path}.${key}` : key
}

export async function analyseSchema(schema: unknown): Promise<SchemaAnalysis> {
  const standard = isRecord(schema) || typeof schema === 'function' ? (schema as JsonObject)['~standard'] : undefined
  const result: SchemaAnalysis = { vendor: 'unknown', needsWrap: false, stops: [], refinements: [], changes: [], required: new Set() }
  if (!isRecord(standard)) {
    result.stops.push({ path: '', note: 'the $schema is not a Standard Schema. Use a Valibot, Zod or ArkType schema' })
    return result
  }
  result.vendor = typeof standard.vendor === 'string' ? standard.vendor : 'unknown'
  const hasJsonSchema = isRecord(standard.jsonSchema) && typeof standard.jsonSchema.output === 'function'

  if (result.vendor === 'valibot')
    walkValibot(schema, '', result)
  else if (result.vendor === 'zod')
    walkZod(schema, '', result, new Set())
  else if (result.vendor === 'arktype')
    walkArkType(schema, result)

  let converter: unknown = schema
  if (result.vendor === 'valibot' && !hasJsonSchema) {
    result.needsWrap = true
    const { toStandardJsonSchema } = await import('@valibot/to-json-schema')
    try {
      converter = toStandardJsonSchema(schema as Parameters<typeof toStandardJsonSchema>[0])
    }
    catch (error) {
      result.stops.push({ path: '', note: `Valibot can't convert the $schema to JSON Schema: ${errorText(error)}` })
      return result
    }
  }
  else if (!hasJsonSchema) {
    const hint = result.vendor === 'zod' ? '. Zod adds it in 4.2: upgrade zod to ^4.2.0 and run the command again' : ''
    result.stops.push({ path: '', note: `the ${result.vendor} $schema does not implement Standard JSON Schema, which Nuxt needs to read it${hint}` })
    return result
  }
  if (result.stops.length)
    return result

  try {
    const jsonSchema = (converter as { '~standard': { jsonSchema: { output: (options: { target: string }) => unknown } } })['~standard'].jsonSchema
    const output = jsonSchema.output({ target: 'draft-2020-12' })
    if (!isRecord(output))
      throw new Error('the converter returned no object')
    result.json = output
  }
  catch (error) {
    result.stops.push({ path: '', note: `Nuxt can't convert the $schema to JSON Schema: ${errorText(error)}` })
    return result
  }
  const shape = rootShape(result.json)
  if (shape)
    result.stops.push({ path: '', note: `Nuxt needs one object schema for the whole runtime config, and this one is ${shape} (NUXT_B5031)` })
  const validate = (converter as { '~standard': { validate?: unknown } })['~standard'].validate
  if (typeof validate === 'function' && validatesAsync(validate as (value: unknown) => unknown, result.json))
    result.stops.push({ path: '', note: 'the schema validates asynchronously, through an async refinement or transform, and Nuxt validates runtimeConfig synchronously (NUXT_B5031)' })
  walkJson(result.json, '', result)
  collectRequired(result.json, '', result.required)
  return result
}

function resolveRef(node: JsonObject, root: JsonObject): JsonObject {
  let current = node
  for (let depth = 0; depth < 10 && typeof current.$ref === 'string' && current.$ref.startsWith('#/'); depth++) {
    let target: unknown = root
    for (const part of current.$ref.slice(2).split('/'))
      target = isRecord(target) ? target[part.replaceAll('~1', '/').replaceAll('~0', '~')] : undefined
    if (!isRecord(target))
      break
    current = target
  }
  return current
}

/** What the root is when it isn't one object, as Nuxt reads it: a union, another type, or a constant. Undefined for an object. */
function rootShape(json: JsonObject): string | undefined {
  const node = resolveRef(json, json)
  for (const keyword of ['anyOf', 'oneOf'] as const) {
    const members = node[keyword]
    if (!Array.isArray(members))
      continue
    const distinct = new Set(members.map(member => JSON.stringify(member)))
    if (distinct.size > 1)
      return 'a union'
    return isRecord(members[0]) ? rootShape({ ...json, ...resolveRef(members[0], json), [keyword]: undefined }) : 'empty'
  }
  if (Array.isArray(node.allOf))
    return node.allOf.map(member => isRecord(member) ? rootShape({ ...json, ...resolveRef(member, json), allOf: undefined }) : 'empty').find(Boolean)
  if ('const' in node || Array.isArray(node.enum))
    return 'a constant'
  if (node.type === 'object' || (node.type === undefined && isRecord(node.properties)))
    return undefined
  return node.type === undefined ? 'not an object' : `of type ${JSON.stringify(node.type)}`
}

/** A value that passes the JSON Schema's types, with defaults applied, so the probe reaches refinements behind them. */
function sampleValue(node: unknown, root: JsonObject, depth = 0): unknown {
  if (!isRecord(node) || depth > 8)
    return undefined
  const resolved = resolveRef(node, root)
  if ('default' in resolved)
    return resolved.default
  if ('const' in resolved)
    return resolved.const
  if (Array.isArray(resolved.enum))
    return resolved.enum[0]
  for (const keyword of ['anyOf', 'oneOf', 'allOf']) {
    const members = resolved[keyword]
    if (Array.isArray(members) && members.length)
      return sampleValue(members[0], root, depth + 1)
  }
  const type = Array.isArray(resolved.type) ? resolved.type[0] : resolved.type
  switch (type) {
    case 'object': {
      const value: JsonObject = {}
      if (isRecord(resolved.properties)) {
        for (const [key, child] of Object.entries(resolved.properties)) value[key] = sampleValue(child, root, depth + 1)
      }
      return value
    }
    case 'string': return ''
    case 'number':
    case 'integer': return typeof resolved.minimum === 'number' ? resolved.minimum : 0
    case 'boolean': return false
    case 'array': return []
    case 'null': return null
  }
  return isRecord(resolved.properties) ? sampleValue({ ...resolved, type: 'object' }, root, depth + 1) : undefined
}

/**
 * Runs the schema's validation the way Nuxt probes it: with no value, an empty object and a sample of the JSON Schema.
 * Async checks only show when validation reaches them, such as a refinement after a default.
 */
function validatesAsync(validate: (value: unknown) => unknown, json: JsonObject): boolean {
  for (const value of [undefined, {}, sampleValue(json, json)]) {
    let output: unknown
    try {
      output = validate(value)
    }
    catch {
      continue
    }
    if (isRecord(output) && typeof output.then === 'function') {
      (output as unknown as Promise<unknown>).then(() => {}, () => {})
      return true
    }
  }
  return false
}

function collectRequired(node: JsonObject, path: string, out: Set<string>): void {
  const properties = node.properties
  if (!isRecord(properties))
    return
  const required = new Set(Array.isArray(node.required) ? node.required : [])
  for (const [key, child] of Object.entries(properties)) {
    if (!isRecord(child))
      continue
    const childPath = join(path, key)
    if (required.has(key) && !('default' in child))
      out.add(childPath)
    collectRequired(child, childPath, out)
  }
}

const safeIntegerBound = Number.MAX_SAFE_INTEGER

/** JSON Schema keywords that Nuxt's runtimeConfig check ignores. */
function uncheckedKeywords(node: JsonObject): string[] {
  const notes: string[] = []
  if (typeof node.format === 'string')
    notes.push(`format ${node.format}`)
  if (typeof node.pattern === 'string')
    notes.push(`pattern ${node.pattern}`)
  for (const keyword of ['minLength', 'maxLength', 'minItems', 'maxItems', 'minProperties', 'maxProperties', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf']) {
    if (typeof node[keyword] === 'number')
      notes.push(`${keyword} ${node[keyword]}`)
  }
  for (const keyword of ['minimum', 'maximum']) {
    const value = node[keyword]
    if (typeof value === 'number' && Math.abs(value) !== safeIntegerBound)
      notes.push(`${keyword} ${value}`)
  }
  if (node.uniqueItems === true)
    notes.push('uniqueItems')
  for (const keyword of ['not', 'if', 'contains', 'dependentRequired', 'dependentSchemas', 'patternProperties']) {
    if (keyword in node)
      notes.push(keyword)
  }
  if (isRecord(node.propertyNames) && Object.keys(node.propertyNames).some(key => key !== 'type'))
    notes.push('propertyNames')
  return notes
}

function walkJson(node: unknown, path: string, result: SchemaAnalysis): void {
  if (!isRecord(node))
    return
  for (const note of uncheckedKeywords(node))
    result.refinements.push({ path, note })
  if (isRecord(node.properties)) {
    for (const [key, child] of Object.entries(node.properties))
      walkJson(child, join(path, key), result)
  }
  for (const keyword of ['anyOf', 'oneOf', 'allOf', 'prefixItems']) {
    const list = node[keyword]
    if (Array.isArray(list)) {
      for (const child of list) walkJson(child, path, result)
    }
  }
  if (isRecord(node.items))
    walkJson(node.items, join(path, '[]'), result)
  if (isRecord(node.additionalProperties))
    walkJson(node.additionalProperties, join(path, '*'), result)
}

// Valibot

const valibotObjects = new Set(['object', 'loose_object', 'strict_object', 'object_with_rest'])

function walkValibot(schema: unknown, path: string, result: SchemaAnalysis): void {
  if (!isRecord(schema))
    return
  if (schema.async === true) {
    result.stops.push({ path, note: `the Valibot ${String(schema.type)} schema is async` })
    return
  }
  if (Array.isArray(schema.pipe)) {
    for (const action of schema.pipe.slice(1)) {
      if (!isRecord(action))
        continue
      if (action.async === true)
        result.stops.push({ path, note: `the Valibot ${String(action.type)} action is async` })
      else if (action.kind === 'transformation')
        result.stops.push({ path, note: `the Valibot ${String(action.type)} action changes the value, and Nuxt keeps the raw value` })
    }
  }
  if (schema.type === 'strict_object')
    result.refinements.push({ path, note: 'strictObject rejects unknown keys' })
  if (valibotObjects.has(String(schema.type)) && isRecord(schema.entries)) {
    for (const [key, entry] of Object.entries(schema.entries)) walkValibot(entry, join(path, key), result)
    if (isRecord(schema.rest))
      walkValibot(schema.rest, join(path, '*'), result)
    return
  }
  if ('wrapped' in schema)
    walkValibot(schema.wrapped, path, result)
  if ('item' in schema)
    walkValibot(schema.item, join(path, '[]'), result)
  if (Array.isArray(schema.options)) {
    for (const option of schema.options) walkValibot(option, path, result)
  }
  if (Array.isArray(schema.items)) {
    for (const item of schema.items) walkValibot(item, join(path, '[]'), result)
  }
  if (schema.type === 'record' && isRecord(schema.value))
    walkValibot(schema.value, join(path, '*'), result)
}

// Zod 4

function zodDef(schema: unknown): JsonObject | undefined {
  return isRecord(schema) && isRecord(schema._zod) && isRecord(schema._zod.def) ? schema._zod.def : undefined
}

function isAsyncFunction(value: unknown): boolean {
  return typeof value === 'function' && value.constructor.name === 'AsyncFunction'
}

/** `ancestors` holds the schemas above `schema`, so a recursive schema ends while one shared by two keys is read at both. */
function walkZod(schema: unknown, path: string, result: SchemaAnalysis, ancestors: Set<unknown>): void {
  const def = zodDef(schema)
  if (!def || ancestors.has(schema))
    return
  ancestors.add(schema)
  try {
    walkZodDef(def, path, result, ancestors)
  }
  finally {
    ancestors.delete(schema)
  }
}

function walkZodDef(def: JsonObject, path: string, result: SchemaAnalysis, seen: Set<unknown>): void {
  for (const check of Array.isArray(def.checks) ? def.checks : []) {
    const checkDef = zodDef(check)
    if (checkDef?.check === 'overwrite')
      result.stops.push({ path, note: 'a Zod overwrite such as .trim() or .toLowerCase() changes the value, and Nuxt keeps the raw value' })
    else if (checkDef?.check === 'custom' && isAsyncFunction(checkDef.fn))
      result.stops.push({ path, note: 'an async Zod refinement, which Nuxt can\'t run' })
    else if (checkDef?.check === 'custom')
      result.refinements.push({ path, note: 'a .refine() check' })
  }
  if (def.coerce === true)
    result.changes.push({ path, note: 'z.coerce: Nuxt coerces NUXT_* values from the JSON Schema type instead' })
  switch (def.type) {
    case 'object': {
      const shape = def.shape
      if (isRecord(shape)) {
        for (const [key, child] of Object.entries(shape)) walkZod(child, join(path, key), result, seen)
      }
      if (zodDef(def.catchall)?.type === 'never')
        result.refinements.push({ path, note: 'a strict object rejects unknown keys' })
      return
    }
    case 'transform':
      result.stops.push({ path, note: 'a Zod .transform() changes the value, and Nuxt keeps the raw value' })
      return
    case 'pipe':
      if (typeof def.reverseTransform === 'function') {
        result.changes.push({ path, note: 'a Zod codec such as z.stringbool(): Nuxt keeps the input value without decoding it' })
        return
      }
      walkZod(def.in, path, result, seen)
      walkZod(def.out, path, result, seen)
      return
    case 'promise':
      result.stops.push({ path, note: 'a Zod promise schema, which Nuxt can\'t check' })
      return
    case 'catch':
      result.changes.push({ path, note: '.catch(): Nuxt fails on an invalid value instead of using the fallback' })
      walkZod(def.innerType, path, result, seen)
      return
    case 'array':
      walkZod(def.element, join(path, '[]'), result, seen)
      return
    case 'union':
      for (const option of Array.isArray(def.options) ? def.options : []) walkZod(option, path, result, seen)
      return
    case 'intersection':
      walkZod(def.left, path, result, seen)
      walkZod(def.right, path, result, seen)
      return
    case 'record':
      walkZod(def.valueType, join(path, '*'), result, seen)
      return
    case 'tuple':
      for (const item of Array.isArray(def.items) ? def.items : []) walkZod(item, join(path, '[]'), result, seen)
      return
  }
  if ('innerType' in def)
    walkZod(def.innerType, path, result, seen)
}

// ArkType

function walkArkType(schema: unknown, result: SchemaAnalysis): void {
  const internal = isRecord(schema) || typeof schema === 'function' ? (schema as JsonObject).internal : undefined
  const morphs = isRecord(internal) && Array.isArray(internal.flatMorphs) ? internal.flatMorphs : []
  for (const morph of morphs) {
    const morphPath = isRecord(morph) && Array.isArray(morph.path) ? morph.path.map(String).join('.') : ''
    result.stops.push({ path: morphPath, note: 'an ArkType morph changes the value, and Nuxt keeps the raw value' })
  }
}
