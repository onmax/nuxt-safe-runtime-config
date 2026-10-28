import type { ParsedEnvSpecDecorator, ParsedEnvSpecFile } from '@env-spec/parser'
import type { EnvSchemaValue } from '../runtime/env-schema-value'
import { format } from '@cfworker/json-schema'
import { ParsedEnvSpecFunctionCall, ParsedEnvSpecKeyValuePair, ParsedEnvSpecStaticValue, parseEnvSpecDotEnvFile } from '@env-spec/parser'
import { isEnvSchemaValue } from '../runtime/env-schema-value'

export const ENV_SCHEMA_PROFILE = 'env-spec-v1'

export type EnvSchemaType
  = | { kind: 'string', minLength?: number, maxLength?: number }
    | { kind: 'number', min?: number, max?: number, isInt?: boolean }
    | { kind: 'boolean' }
    | { kind: 'enum', values: string[] }
    | { kind: 'url' }
    | { kind: 'array', items?: EnvSchemaType }
    | { kind: 'object', properties?: Record<string, EnvSchemaType> }

export interface EnvSchemaField {
  key: string
  type: EnvSchemaType
  required: boolean
  sensitive: boolean
  description: string
  example?: string
  docs: string[]
  default?: EnvSchemaValue
  source: { file: string, line: number }
}

interface Context {
  file: string
  line: number
  key?: string
}

function fail(context: Context, reason: string): never {
  throw new Error(`${context.file}:${context.line}${context.key ? ` (${context.key})` : ''}: ${reason}`)
}

function locationLine(location: unknown, end = false): number {
  if (typeof location !== 'object' || location === null)
    return 1
  const point: unknown = end && 'end' in location ? location.end : 'start' in location ? location.start : undefined
  if (typeof point === 'object' && point !== null && 'line' in point && typeof point.line === 'number' && Number.isInteger(point.line) && point.line > 0)
    return point.line
  return 1
}

function staticValue(node: unknown, context: Context): string | number | boolean | undefined {
  if (!(node instanceof ParsedEnvSpecStaticValue))
    fail(context, 'Only static values are supported')
  const value: unknown = node.unescapedValue
  if (value === undefined || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number')
    return value
  return fail(context, 'Unsupported static value')
}

function booleanDecorator(decorator: ParsedEnvSpecDecorator, context: Context): boolean {
  const value = staticValue(decorator.value, context)
  if (typeof value !== 'boolean')
    fail(context, 'Decorator requires a static boolean')
  return value
}

function decorators(nodes: ParsedEnvSpecDecorator[], allowed: string[], context: Context): Map<string, ParsedEnvSpecDecorator> {
  const result = new Map<string, ParsedEnvSpecDecorator>()
  for (const node of nodes) {
    const here = { ...context, line: locationLine(node.data._location) }
    if (node.hasInvalidName || !allowed.includes(node.name) || node.strayText || node.isBareFnCall)
      fail(here, 'Unsupported or malformed decorator')
    if (result.has(node.name))
      fail(here, 'Duplicate decorator')
    result.set(node.name, node)
  }
  return result
}

function typeArguments(call: ParsedEnvSpecFunctionCall, allowed: string[], context: Context): Map<string, string | number | boolean | undefined> {
  const args = new Map<string, string | number | boolean | undefined>()
  for (const arg of call.data.args.values) {
    if (!(arg instanceof ParsedEnvSpecKeyValuePair) || !allowed.includes(arg.key))
      fail(context, 'Unsupported type argument')
    if (args.has(arg.key))
      fail(context, 'Duplicate type argument')
    args.set(arg.key, staticValue(arg.value, context))
  }
  return args
}

function numericArgument(args: Map<string, unknown>, name: string, context: Context, length = false): number | undefined {
  if (!args.has(name))
    return undefined
  const value = args.get(name)
  if (typeof value !== 'number' || !Number.isFinite(value) || (length && (!Number.isSafeInteger(value) || value < 0)))
    fail(context, 'Invalid numeric type argument')
  return value
}

function parseType(decorator: ParsedEnvSpecDecorator | undefined, context: Context): EnvSchemaType {
  if (!decorator)
    return { kind: 'string' }
  return parseTypeNode(decorator.value, context)
}

function parseTypeNode(node: unknown, context: Context, depth = 0): EnvSchemaType {
  if (depth > 16)
    fail(context, 'Type nesting exceeds 16 levels')
  const name = node instanceof ParsedEnvSpecFunctionCall ? node.name : staticValue(node, context)
  if (name === 'array') {
    const args = node instanceof ParsedEnvSpecFunctionCall ? node.data.args.values : []
    if (args.length > 1 || args[0] instanceof ParsedEnvSpecKeyValuePair)
      fail(context, 'Array requires at most one item type')
    return { kind: 'array', ...(args.length && { items: parseTypeNode(args[0], context, depth + 1) }) }
  }
  if (name === 'object') {
    if (!(node instanceof ParsedEnvSpecFunctionCall))
      return { kind: 'object' }
    const entries = new Map<string, EnvSchemaType>()
    for (const arg of node.data.args.values) {
      if (!(arg instanceof ParsedEnvSpecKeyValuePair) || !/^[A-Z_$][\w$]*$/i.test(arg.key) || ['__proto__', 'prototype', 'constructor', '__envSchemaUnset'].includes(arg.key))
        fail(context, 'Object requires safe named property types')
      if (entries.has(arg.key))
        fail(context, 'Duplicate object property')
      entries.set(arg.key, parseTypeNode(arg.value, context, depth + 1))
    }
    return { kind: 'object', properties: Object.fromEntries(entries) }
  }
  if (name === 'enum') {
    if (!(node instanceof ParsedEnvSpecFunctionCall) || node.data.args.values.length === 0)
      fail(context, 'Enum requires string choices')
    const values = node.data.args.values.map((arg) => {
      const value = staticValue(arg, context)
      if (typeof value !== 'string' || value === '')
        fail(context, 'Enum requires nonempty string choices')
      return value
    })
    if (new Set(values).size !== values.length)
      fail(context, 'Duplicate enum choice')
    return { kind: 'enum', values }
  }
  if (name === 'string') {
    const args = node instanceof ParsedEnvSpecFunctionCall ? typeArguments(node, ['minLength', 'maxLength'], context) : new Map<string, unknown>()
    const minLength = numericArgument(args, 'minLength', context, true)
    const maxLength = numericArgument(args, 'maxLength', context, true)
    if (minLength !== undefined && maxLength !== undefined && minLength > maxLength)
      fail(context, 'Minimum length exceeds maximum length')
    return { kind: 'string', ...(minLength !== undefined && { minLength }), ...(maxLength !== undefined && { maxLength }) }
  }
  if (name === 'number') {
    const args = node instanceof ParsedEnvSpecFunctionCall ? typeArguments(node, ['min', 'max', 'isInt'], context) : new Map<string, unknown>()
    const min = numericArgument(args, 'min', context)
    const max = numericArgument(args, 'max', context)
    const isInt = args.get('isInt')
    if (args.has('isInt') && typeof isInt !== 'boolean')
      fail(context, 'Integer constraint requires a static boolean')
    if (min !== undefined && max !== undefined && min > max)
      fail(context, 'Minimum exceeds maximum')
    return { kind: 'number', ...(min !== undefined && { min }), ...(max !== undefined && { max }), ...(typeof isInt === 'boolean' && { isInt }) }
  }
  if (name === 'boolean' || name === 'url') {
    if (node instanceof ParsedEnvSpecFunctionCall)
      typeArguments(node, [], context)
    return { kind: name }
  }
  return fail(context, 'Unsupported type')
}

function lexicalValue(node: ParsedEnvSpecStaticValue, context: Context): string | undefined {
  if (node.data.quote) {
    const value = staticValue(node, context)
    if (typeof value !== 'string')
      fail(context, 'Invalid quoted default')
    return value
  }
  const raw: unknown = node.data.rawValue
  if (raw === undefined)
    return undefined
  if (typeof raw !== 'string')
    fail(context, 'Invalid default')
  const value = raw.trim()
  if (!value)
    return undefined
  if (/^["'`[{]/.test(value) || /^[A-Z]\w*\(/i.test(value))
    fail(context, 'Unsupported or malformed default expression')
  const decoded = staticValue(node, context)
  return typeof decoded === 'string' ? decoded : value
}

function matchesStructuredType(value: EnvSchemaValue, type: EnvSchemaType): boolean {
  switch (type.kind) {
    case 'array': {
      const items = type.items
      return Array.isArray(value) && (!items || value.every(item => matchesStructuredType(item, items)))
    }
    case 'object': {
      if (value === null || typeof value !== 'object' || Array.isArray(value))
        return false
      const properties = type.properties
      return !properties || (Object.keys(value).length === Object.keys(properties).length && Object.entries(properties).every(([key, property]) => {
        const item = value[key]
        return Object.hasOwn(value, key) && item !== undefined && matchesStructuredType(item, property)
      }))
    }
    case 'string':
      return typeof value === 'string' && (type.minLength === undefined || value.length >= type.minLength) && (type.maxLength === undefined || value.length <= type.maxLength)
    case 'number':
      return typeof value === 'number' && (!type.isInt || Number.isSafeInteger(value)) && (type.min === undefined || value >= type.min) && (type.max === undefined || value <= type.max)
    case 'boolean':
      return typeof value === 'boolean'
    case 'enum':
      return typeof value === 'string' && type.values.includes(value)
    case 'url':
      return typeof value === 'string' && format.uri?.(value) === true
  }
}

function parseDefault(value: string | undefined, type: EnvSchemaType, required: boolean, context: Context): EnvSchemaValue | undefined {
  if (value === undefined)
    return undefined
  if (value === '') {
    if (required)
      fail(context, 'Required default cannot be empty')
    if (type.kind !== 'string')
      return undefined
  }
  switch (type.kind) {
    case 'array':
    case 'object': {
      let parsed: unknown
      try {
        parsed = JSON.parse(value)
      }
      catch {
        fail(context, 'Default must be valid JSON')
      }
      if (!isEnvSchemaValue(parsed) || !matchesStructuredType(parsed, type))
        fail(context, 'Default does not match the declared JSON type')
      return parsed
    }
    case 'string':
      if ((type.minLength !== undefined && value.length < type.minLength) || (type.maxLength !== undefined && value.length > type.maxLength))
        fail(context, 'Default violates string length constraints')
      return value
    case 'number': {
      const text = value.trim()
      if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text))
        fail(context, 'Default must be a finite decimal number')
      const number = Number(text)
      if (!Number.isFinite(number) || (type.isInt && !Number.isSafeInteger(number)) || (type.min !== undefined && number < type.min) || (type.max !== undefined && number > type.max))
        fail(context, 'Default violates number constraints')
      return number
    }
    case 'boolean':
      if (value.trim() === 'true' || value.trim() === '1')
        return true
      if (value.trim() === 'false' || value.trim() === '0')
        return false
      return fail(context, 'Default must be a boolean')
    case 'enum':
      if (!type.values.includes(value))
        fail(context, 'Default is not an enum choice')
      return value
    case 'url':
      if (!format.uri?.(value))
        fail(context, 'Default must be an absolute URL')
      return value
  }
}

export function parseEnvSchema(source: string, filename: string): EnvSchemaField[] {
  let parsed: ParsedEnvSpecFile
  try {
    parsed = parseEnvSpecDotEnvFile(source)
  }
  catch (error: unknown) {
    const location: unknown = typeof error === 'object' && error !== null && 'location' in error ? error.location : undefined
    return fail({ file: filename, line: locationLine(location) }, 'Invalid env-spec syntax')
  }

  const rootContext = { file: filename, line: 1 }
  for (const block of parsed.headerBlocks) {
    if (block.decoratorsArray.length && !block.divider)
      fail({ file: filename, line: locationLine(block.data._location) }, 'Root decorators require a header divider')
  }
  for (const block of parsed.orphanCommentBlocks) {
    if (block.decoratorsArray.length)
      fail({ file: filename, line: locationLine(block.data._location) }, 'Decorator is not attached to a declaration')
  }
  const root = decorators(parsed.decoratorsArray, ['defaultRequired', 'defaultSensitive'], rootContext)
  const defaultRequired = root.get('defaultRequired')
  const defaultSensitive = root.get('defaultSensitive')
  const required = defaultRequired ? booleanDecorator(defaultRequired, rootContext) : true
  const sensitive = defaultSensitive ? booleanDecorator(defaultSensitive, rootContext) : true
  const keys = new Set<string>()
  return parsed.configItems.map((item) => {
    const line = Math.max(locationLine(item.data._location), ...item.data.preComments.map(comment => locationLine(comment.data._location, true) + 1))
    const context: Context = { file: filename, line }
    if (!/^[A-Z_]\w*$/i.test(item.key) || item.key.length > 256 || ['__proto__', 'prototype', 'constructor'].includes(item.key.toLowerCase()))
      fail(context, 'Invalid or reserved environment key')
    context.key = item.key
    if (keys.has(item.key))
      fail(context, 'Duplicate environment key')
    keys.add(item.key)
    const metadata = decorators(item.decoratorsArray, ['type', 'required', 'optional', 'sensitive', 'public', 'example'], context)
    if (metadata.has('required') && metadata.has('optional'))
      fail(context, 'Cannot combine required and optional')
    if (metadata.has('sensitive') && metadata.has('public'))
      fail(context, 'Cannot combine sensitive and public')
    const field: EnvSchemaField = { key: item.key, type: parseType(metadata.get('type'), context), required, sensitive, description: item.description, docs: [], source: { file: filename, line } }
    for (const [name, node] of metadata) {
      if (name === 'required') {
        field.required = booleanDecorator(node, context)
      }
      else if (name === 'optional') {
        field.required = !booleanDecorator(node, context)
      }
      else if (name === 'sensitive') {
        field.sensitive = booleanDecorator(node, context)
      }
      else if (name === 'public') {
        field.sensitive = !booleanDecorator(node, context)
      }
      else if (name === 'example') {
        const example = staticValue(node.value, context)
        if (typeof example !== 'string')
          fail(context, 'Example must be a string')
        field.example = example
      }
    }
    if (item.value !== undefined && !(item.value instanceof ParsedEnvSpecStaticValue))
      fail(context, 'Dynamic or structured defaults are unsupported')
    const value = item.value ? lexicalValue(item.value, context) : undefined
    const checkedDefault = parseDefault(value, field.type, field.required, context)
    if (checkedDefault !== undefined)
      field.default = checkedDefault
    return field
  })
}
