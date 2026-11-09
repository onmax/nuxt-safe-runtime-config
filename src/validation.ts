import type { SchemaDraft } from '@cfworker/json-schema'
import type { StandardJSONSchemaV1, StandardSchemaV1 } from '@standard-schema/spec'
import type { ErrorBehavior, ValidationOptions } from './types'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { createJiti } from 'jiti'
import { generateSchemaTypeDeclaration, generateTypeDeclaration } from './json-schema-to-ts'
import { isStandardSchema } from './runtime/validate'
import { getJSONSchema } from './utils/json-schema'

export { validateRuntimeConfig } from './runtime/validate'
export type { RuntimeValidationResult, ValidationLogger } from './runtime/validate'

/**
 * What the build check does with the `nuxt.config.ts` values:
 * - `'present'` fails on wrong values and leaves missing ones (`undefined`, `''`) to the server start check
 * - `'all'` also fails on missing values
 * - `'off'` skips it
 */
export type BuildCheck = 'off' | 'present' | 'all'

export interface ResolvedValidationOptions {
  $schema?: StandardSchemaV1
  schemaPath?: string
  buildCheck: BuildCheck
  /** Coerce and check the config when the server starts */
  runtimeCheck: boolean
  jsonSchemaTarget: StandardJSONSchemaV1.Target
  onError: ErrorBehavior
}

type ValidationInput = ValidationOptions & { schemaPath?: string } & Partial<Pick<ResolvedValidationOptions, 'buildCheck' | 'runtimeCheck'>>

export function resolveChecks(
  options: ValidationInput,
  warn: (message: string) => void = () => {},
): Pick<ResolvedValidationOptions, 'buildCheck' | 'runtimeCheck'> {
  // Already resolved, e.g. the Nuxt module handing its options to the Nitro module.
  if (options.buildCheck && typeof options.runtimeCheck === 'boolean')
    return { buildCheck: options.buildCheck, runtimeCheck: options.runtimeCheck }

  const { validateAtBuild, validateAtRuntime, requireAtBuild } = options
  if (requireAtBuild && validateAtBuild === false)
    throw new Error('requireAtBuild needs the build check. Remove validateAtBuild: false.')

  if (validateAtRuntime !== undefined || validateAtBuild !== undefined) {
    const replacement = validateAtRuntime === false
      ? 'Remove both options; the server start check now always runs. `validateAtRuntime: false` still turns that check off for now.'
      : validateAtBuild
        ? 'Replace them with `requireAtBuild: true`.'
        : 'Remove them.'
    warn(`validateAtBuild and validateAtRuntime are deprecated. Every schema is checked when the server starts, and the build check skips values the deployment sets. ${replacement}`)
  }

  const runtimeCheck = validateAtRuntime ?? true
  let buildCheck: BuildCheck = requireAtBuild ? 'all' : 'present'
  if (validateAtBuild === false)
    buildCheck = 'off'
  // A deprecated build check requires every value, as it did when it was the only check.
  else if (validateAtBuild === true || !runtimeCheck)
    buildCheck = 'all'

  return { buildCheck, runtimeCheck }
}

export interface RuntimeValidationArtifacts {
  draft: SchemaDraft
  jsonSchema: Record<string, unknown>
  /** JSON Schema that runtime env overrides are coerced against */
  coercionSchema: Record<string, unknown> | null
  typeDeclaration: string
  validateTemplate: string
  validateTemplateDeclaration: string
}

export async function resolveValidationOptions(
  options: ValidationInput = {},
  rootDir = process.cwd(),
  warn?: (message: string) => void,
): Promise<ResolvedValidationOptions> {
  let schema = options.$schema
  let schemaPath = options.schemaPath

  if (typeof schema === 'string') {
    // jiti's default interop also unwraps a `default` property, and Zod schemas have a `default()` method.
    const jiti = createJiti(join(rootDir, 'nuxt-safe-runtime-config.loader.mjs'), { interopDefault: false })
    const resolvedPath = jiti.esmResolve(schema)
    schemaPath = resolvedPath.startsWith('file:') ? fileURLToPath(resolvedPath) : resolvedPath
    schema = (await jiti.import<{ default?: unknown }>(schemaPath)).default as StandardSchemaV1

    if (!isStandardSchema(schema))
      throw new TypeError(`Schema module must default export a Standard Schema: ${schemaPath}`)
  }

  return {
    $schema: schema,
    schemaPath,
    ...resolveChecks(options, warn),
    jsonSchemaTarget: options.jsonSchemaTarget ?? 'draft-2020-12',
    onError: options.onError ?? 'throw',
  }
}

export function detectJsonSchemaDraft(schemaUri: string | undefined): SchemaDraft {
  if (schemaUri?.includes('2019-09'))
    return '2019-09'
  if (schemaUri?.includes('draft-07'))
    return '7'
  return '2020-12'
}

// Schema modules may use transforms that have no JSON Schema form; they then receive raw values.
async function getCoercionSchema(
  schema: StandardSchemaV1,
  target: StandardJSONSchemaV1.Target,
): Promise<Record<string, unknown> | null> {
  try {
    return await getJSONSchema(schema, target, undefined, 'input')
  }
  catch {
    return null
  }
}

export async function createRuntimeValidationArtifacts(
  options: ResolvedValidationOptions,
  warn: (message: string) => void,
): Promise<RuntimeValidationArtifacts | null> {
  if (!options.$schema)
    return null

  const jsonSchema = options.schemaPath
    ? {}
    : await getJSONSchema(options.$schema, options.jsonSchemaTarget, warn)
  const draft = detectJsonSchemaDraft(jsonSchema.$schema as string | undefined)
  const runtimeSchema = options.schemaPath
    ? `import runtimeSchema from '#safe-runtime-config/runtime-schema'\n`
    : 'const runtimeSchema = null\n'
  let coercionSchema: Record<string, unknown> | null = null
  if (options.runtimeCheck)
    coercionSchema = options.schemaPath ? await getCoercionSchema(options.$schema, options.jsonSchemaTarget) : jsonSchema
  const coercionSchemaSource = coercionSchema === jsonSchema ? 'schema' : JSON.stringify(coercionSchema)

  return {
    draft,
    jsonSchema,
    coercionSchema,
    typeDeclaration: options.schemaPath
      ? generateSchemaTypeDeclaration(options.schemaPath, options.runtimeCheck ? 'output' : 'input')
      : generateTypeDeclaration(jsonSchema),
    validateTemplate: `${runtimeSchema}export { runtimeSchema }\nexport const schema = ${JSON.stringify(jsonSchema)}\nexport const onError = ${JSON.stringify(options.onError)}\nexport const draft = ${JSON.stringify(draft)}\nexport const coercionSchema = ${coercionSchemaSource}\n`,
    validateTemplateDeclaration: `import type { Schema, SchemaDraft } from '@cfworker/json-schema'\nimport type { StandardSchemaV1 } from '@standard-schema/spec'\nexport declare const runtimeSchema: StandardSchemaV1 | null\nexport declare const schema: Schema\nexport declare const onError: 'throw' | 'warn' | 'ignore'\nexport declare const draft: SchemaDraft\nexport declare const coercionSchema: Record<string, unknown> | null\n`,
  }
}
