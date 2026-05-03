import type { StandardJSONSchemaV1, StandardSchemaV1 } from '@standard-schema/spec'
import type { ErrorBehavior, ValidationOptions } from './types'
import { generateTypeDeclaration } from './json-schema-to-ts'
import { getJSONSchema } from './utils/json-schema'

export interface ResolvedValidationOptions {
  $schema?: StandardSchemaV1
  validateAtBuild: boolean
  validateAtRuntime: boolean
  jsonSchemaTarget: StandardJSONSchemaV1.Target
  onError: ErrorBehavior
}

export interface ValidationLogger {
  error: (message: string) => void
  warn: (message: string) => void
  success: (message: string) => void
}

export interface RuntimeValidationArtifacts {
  draft: string
  jsonSchema: Record<string, unknown>
  typeDeclaration: string
  validateTemplate: string
  validateTemplateDeclaration: string
}

export function resolveValidationOptions(options: ValidationOptions = {}): ResolvedValidationOptions {
  return {
    $schema: options.$schema,
    validateAtBuild: options.validateAtBuild ?? true,
    validateAtRuntime: options.validateAtRuntime ?? false,
    jsonSchemaTarget: options.jsonSchemaTarget ?? 'draft-2020-12',
    onError: options.onError ?? 'throw',
  }
}

export function detectJsonSchemaDraft(schemaUri: string | undefined): string {
  if (schemaUri?.includes('2020-12'))
    return '2020-12'
  if (schemaUri?.includes('2019-09'))
    return '2019-09'
  if (schemaUri?.includes('draft-07'))
    return '7'
  return '2020-12'
}

export async function createRuntimeValidationArtifacts(
  options: ResolvedValidationOptions,
  warn: (message: string) => void,
): Promise<RuntimeValidationArtifacts | null> {
  if (!options.$schema)
    return null

  const jsonSchema = await getJSONSchema(options.$schema, options.jsonSchemaTarget, warn)
  const draft = detectJsonSchemaDraft(jsonSchema.$schema as string | undefined)

  return {
    draft,
    jsonSchema,
    typeDeclaration: generateTypeDeclaration(jsonSchema),
    validateTemplate: `export const schema = ${JSON.stringify(jsonSchema)}\nexport const onError = ${JSON.stringify(options.onError)}\nexport const draft = ${JSON.stringify(draft)}\n`,
    validateTemplateDeclaration: `export declare const schema: Record<string, unknown>\nexport declare const onError: 'throw' | 'warn' | 'ignore'\nexport declare const draft: string\n`,
  }
}

export async function validateRuntimeConfig(
  config: unknown,
  schema: StandardSchemaV1,
  onError: ErrorBehavior,
  logger: ValidationLogger,
): Promise<void> {
  if (!isStandardSchema(schema)) {
    const msg = 'Schema is not Standard Schema compatible'
    if (onError === 'throw') {
      logger.error(msg)
      throw new Error('Invalid schema format')
    }
    else if (onError === 'warn') {
      logger.warn(msg)
    }
    return
  }

  const result = await schema['~standard'].validate(config)

  if ('issues' in result && result.issues && result.issues.length > 0) {
    const errorLines = result.issues.map((issue, index) => `  ${index + 1}. ${formatIssue(issue)}`)
    if (onError === 'throw') {
      logger.error(`Validation failed!\n${errorLines.join('\n')}`)
      throw new Error('Runtime config validation failed')
    }
    else if (onError === 'warn') {
      logger.warn(`Validation failed!\n${errorLines.join('\n')}`)
    }
    return
  }

  logger.success('Validated Runtime Config')
}

function isStandardSchema(schema: unknown): schema is StandardSchemaV1 {
  const candidate = schema as { '~standard'?: { validate?: unknown } } | null | undefined
  return Boolean(
    candidate
    && (typeof schema === 'object' || typeof schema === 'function')
    && candidate['~standard']
    && typeof candidate['~standard'] === 'object'
    && typeof candidate['~standard'].validate === 'function',
  )
}

function formatIssue(issue: { path?: ReadonlyArray<PropertyKey | { key: PropertyKey }>, message?: string }): string {
  const path = issue.path
    ? issue.path.map(p => typeof p === 'object' && p !== null && 'key' in p ? p.key : p).join('.')
    : 'root'
  return `${path}: ${issue.message || 'Validation error'}`
}
