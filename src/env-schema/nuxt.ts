import type { EnvSchemaField, EnvSchemaType } from './profile'
import { camelCase, snakeCase } from 'scule'

export interface CompileEnvSchemaOptions {
  paths?: Record<string, string>
}

export interface EnvSchemaMapping {
  key: string
  path: string[]
  required: boolean
  sensitive: boolean
  type: EnvSchemaType
  source: { file: string, line: number }
  default?: string | number | boolean
}

interface EnvSchemaLeaf extends Record<string, unknown> {
  'type': 'string' | 'number' | 'integer' | 'boolean'
  'description': string
  'x-env-key': string
  'x-env-source': { file: string, line: number }
  'x-env-required': boolean
  'x-env-sensitive': boolean
  'default'?: string | number | boolean
  'enum'?: string[]
  'format'?: string
  'minLength'?: number
  'maxLength'?: number
  'minimum'?: number
  'maximum'?: number
}

export interface EnvSchemaObject extends Record<string, unknown> {
  type: 'object'
  properties: Record<string, EnvSchemaObject | EnvSchemaLeaf>
  required: string[]
  additionalProperties: true
}

export interface EnvSchemaRuntimeConfig {
  [key: string]: string | number | boolean | null | EnvSchemaRuntimeConfig
}

export interface CompiledEnvSchema {
  jsonSchema: EnvSchemaObject
  runtimeConfig: EnvSchemaRuntimeConfig
  mappings: EnvSchemaMapping[]
}

interface ObjectNode {
  kind: 'object'
  children: Map<string, ObjectNode | FieldNode>
}

interface FieldNode {
  kind: 'field'
  field: EnvSchemaField
}

const reservedSegments = new Set(['__proto__', 'prototype', 'constructor'])
const reservedRoots = new Set(['app', 'nitro', 'public'])

function fail(field: EnvSchemaField, message: string): never {
  throw new Error(`${field.source.file}:${field.source.line} (${field.key}): ${message}`)
}

function configPath(field: EnvSchemaField, explicit: string | undefined): string[] {
  if (!/^NUXT_[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/.test(field.key))
    fail(field, 'Expected a canonical uppercase NUXT_ environment key')
  if (/^NUXT_(?:APP|NITRO)(?:_|$)/.test(field.key))
    fail(field, 'Nuxt app and Nitro environment keys are reserved')

  const isPublic = field.key.startsWith('NUXT_PUBLIC_')
  if (isPublic && field.sensitive)
    fail(field, 'Public environment keys require @public or @sensitive=false')

  const name = field.key.slice(isPublic ? 'NUXT_PUBLIC_'.length : 'NUXT_'.length)
  const path = explicit === undefined
    ? [...(isPublic ? ['public'] : []), camelCase(name, { normalize: true })]
    : explicit.split('.')
  if (path.some(segment => !/^[a-z][A-Za-z0-9]*$/.test(segment) || reservedSegments.has(segment.toLowerCase())))
    fail(field, 'Config paths require safe camelCase segments')
  if (isPublic !== (path[0] === 'public'))
    fail(field, 'Config paths cannot change public or private visibility')
  const firstField = path[isPublic ? 1 : 0]
  if (!firstField || (!isPublic && reservedRoots.has(firstField)))
    fail(field, 'Config path targets a reserved Nuxt key')

  const canonical = `NUXT_${snakeCase(path.join('_')).toUpperCase()}`
  if (canonical !== field.key)
    fail(field, `Config path does not roundtrip to ${field.key}`)
  return path
}

function fieldSchema(field: EnvSchemaField): EnvSchemaLeaf {
  const metadata = {
    'description': field.description,
    'x-env-key': field.key,
    'x-env-source': { ...field.source },
    'x-env-required': field.required,
    'x-env-sensitive': field.sensitive,
    ...(field.default !== undefined && { default: field.default }),
  }
  switch (field.type.kind) {
    case 'string':
      return {
        ...metadata,
        type: 'string',
        ...(field.required || field.type.minLength !== undefined
          ? { minLength: Math.max(field.required ? 1 : 0, field.type.minLength ?? 0) }
          : {}),
        ...(field.type.maxLength !== undefined && { maxLength: field.type.maxLength }),
      }
    case 'number':
      return {
        ...metadata,
        type: field.type.isInt ? 'integer' : 'number',
        ...(field.type.isInt
          ? { minimum: Math.max(field.type.min ?? Number.MIN_SAFE_INTEGER, Number.MIN_SAFE_INTEGER), maximum: Math.min(field.type.max ?? Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER) }
          : { ...(field.type.min !== undefined && { minimum: field.type.min }), ...(field.type.max !== undefined && { maximum: field.type.max }) }),
      }
    case 'boolean':
      return { ...metadata, type: 'boolean' }
    case 'enum':
      return { ...metadata, type: 'string', enum: [...field.type.values] }
    case 'url':
      return { ...metadata, type: 'string', format: 'uri', minLength: 1 }
  }
}

function insertField(root: ObjectNode, path: string[], field: EnvSchemaField): void {
  let node = root
  for (const [index, segment] of path.entries()) {
    const child = node.children.get(segment)
    if (index === path.length - 1) {
      if (child)
        fail(field, 'Duplicate or overlapping config path')
      node.children.set(segment, { kind: 'field', field })
    }
    else {
      if (child?.kind === 'field')
        fail(field, 'Duplicate or overlapping config path')
      if (child) {
        node = child
      }
      else {
        const branch: ObjectNode = { kind: 'object', children: new Map() }
        node.children.set(segment, branch)
        node = branch
      }
    }
  }
}

function renderObject(node: ObjectNode): Pick<CompiledEnvSchema, 'jsonSchema' | 'runtimeConfig'> {
  const jsonSchema: EnvSchemaObject = { type: 'object', properties: {}, required: [], additionalProperties: true }
  const runtimeConfig: EnvSchemaRuntimeConfig = {}
  for (const [key, child] of node.children) {
    if (child.kind === 'object') {
      const nested = renderObject(child)
      jsonSchema.properties[key] = nested.jsonSchema
      runtimeConfig[key] = nested.runtimeConfig
      if (nested.jsonSchema.required.length)
        jsonSchema.required.push(key)
    }
    else {
      const { field } = child
      jsonSchema.properties[key] = fieldSchema(field)
      // Nitro drops null defaults. An invalid object keeps the env key declared until runtime.
      runtimeConfig[key] = field.default ?? { __envSchemaUnset: true }
      if (field.required || field.default !== undefined)
        jsonSchema.required.push(key)
    }
  }
  return { jsonSchema, runtimeConfig }
}

export function compileEnvSchema(fields: EnvSchemaField[], options: CompileEnvSchemaOptions = {}): CompiledEnvSchema {
  const declaredKeys = new Set(fields.map(field => field.key))
  for (const key of Object.keys(options.paths ?? {})) {
    if (!declaredKeys.has(key))
      throw new Error(`Config path mapping refers to undeclared environment key ${key}`)
  }

  const root: ObjectNode = { kind: 'object', children: new Map() }
  const seen = new Set<string>()
  const mappings: EnvSchemaMapping[] = []
  for (const field of fields) {
    if (seen.has(field.key))
      fail(field, 'Duplicate environment key')
    seen.add(field.key)
    const explicit = options.paths && Object.hasOwn(options.paths, field.key) ? options.paths[field.key] : undefined
    const path = configPath(field, explicit)
    insertField(root, path, field)
    mappings.push({
      key: field.key,
      path,
      required: field.required,
      sensitive: field.sensitive,
      type: field.type.kind === 'enum' ? { ...field.type, values: [...field.type.values] } : { ...field.type },
      source: { ...field.source },
      ...(field.default !== undefined && { default: field.default }),
    })
  }
  const compiled = renderObject(root)
  compiled.jsonSchema['x-env-profile'] = 'env-spec-v1'
  return { ...compiled, mappings }
}
