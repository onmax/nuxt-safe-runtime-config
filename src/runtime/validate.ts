import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { ErrorBehavior } from '../types'

export interface ValidationLogger {
  error: (message: string) => void
  warn: (message: string) => void
  info?: (message: string) => void
}

export type RuntimeValidationResult
  = | { success: true, value: unknown }
    | { success: false }

function reportError(msg: string, onError: ErrorBehavior, logger: ValidationLogger, throwMsg?: string): void {
  if (onError === 'throw') {
    logger.error(msg)
    throw new Error(throwMsg ?? msg)
  }
  if (onError === 'warn')
    logger.warn(msg)
}

export interface ValidateRuntimeConfigOptions {
  /**
   * Treat issues on values that are `undefined` or `''` as values the deployment sets later.
   * They are listed, not reported as failures. Used by the build check.
   */
  deferMissing?: boolean
}

function issueKeys(issue: StandardSchemaV1.Issue): PropertyKey[] {
  return (issue.path ?? []).map(p => typeof p === 'object' && p !== null && 'key' in p ? p.key : p)
}

function valueAt(config: unknown, keys: PropertyKey[]): unknown {
  let current = config
  for (const key of keys) {
    if (current === null || typeof current !== 'object')
      return undefined
    current = (current as Record<PropertyKey, unknown>)[key]
  }
  return current
}

/** A Nuxt placeholder: no value, or the `''` that a `NUXT_*` variable replaces at startup. */
function isMissing(value: unknown): boolean {
  return value === undefined || value === ''
}

function resolveResult(
  config: unknown,
  result: StandardSchemaV1.Result<unknown>,
  onError: ErrorBehavior,
  logger: ValidationLogger,
  options: ValidateRuntimeConfigOptions,
): RuntimeValidationResult {
  let issues = 'issues' in result ? result.issues : undefined
  if ('value' in result && !issues?.length)
    return { success: true, value: result.value }

  if (options.deferMissing && issues?.length) {
    const deferred = issues.filter(issue => issue.path?.length && isMissing(valueAt(config, issueKeys(issue))))
    issues = issues.filter(issue => !deferred.includes(issue))
    if (deferred.length) {
      const paths = [...new Set(deferred.map(issue => issueKeys(issue).join('.')))]
      logger.info?.(`Not set at build, checked when the server starts: ${paths.join(', ')}`)
    }
    if (!issues.length)
      return { success: true, value: config }
  }

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
  options: ValidateRuntimeConfigOptions = {},
): RuntimeValidationResult | Promise<RuntimeValidationResult> {
  if (!isStandardSchema(schema)) {
    reportError('Schema is not Standard Schema compatible', onError, logger, 'Invalid schema format')
    return { success: false }
  }

  const result = schema['~standard'].validate(config)
  return isPromiseLike(result)
    ? result.then(value => resolveResult(config, value, onError, logger, options))
    : resolveResult(config, result, onError, logger, options)
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
