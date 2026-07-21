import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { ErrorBehavior } from '../types'

export interface ValidationLogger {
  error: (message: string) => void
  warn: (message: string) => void
}

export type RuntimeValidationResult =
  | { success: true, value: unknown }
  | { success: false }

function reportError(msg: string, onError: ErrorBehavior, logger: ValidationLogger, throwMsg?: string): void {
  if (onError === 'throw') {
    logger.error(msg)
    throw new Error(throwMsg ?? msg)
  }
  if (onError === 'warn')
    logger.warn(msg)
}

function resolveResult(
  result: StandardSchemaV1.Result<unknown>,
  onError: ErrorBehavior,
  logger: ValidationLogger,
): RuntimeValidationResult {
  const issues = 'issues' in result ? result.issues : undefined
  if ('value' in result && !issues?.length)
    return { success: true, value: result.value }

  const errorLines = (issues ?? []).map((issue, index) => `  ${index + 1}. ${formatIssue(issue)}`)
  reportError(`Validation failed!\n${errorLines.join('\n')}`, onError, logger, 'Runtime config validation failed')
  return { success: false }
}

export function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return Boolean(value && typeof (value as Promise<T>).then === 'function')
}

export function validateRuntimeConfig(
  config: unknown,
  schema: StandardSchemaV1,
  onError: ErrorBehavior,
  logger: ValidationLogger,
): RuntimeValidationResult | Promise<RuntimeValidationResult> {
  if (!isStandardSchema(schema)) {
    reportError('Schema is not Standard Schema compatible', onError, logger, 'Invalid schema format')
    return { success: false }
  }

  const result = schema['~standard'].validate(config)
  return isPromiseLike(result)
    ? result.then(value => resolveResult(value, onError, logger))
    : resolveResult(result, onError, logger)
}

export function isStandardSchema(schema: unknown): schema is StandardSchemaV1 {
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
