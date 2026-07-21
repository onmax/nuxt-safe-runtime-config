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

export interface ResolvedValidationOptions {
  $schema?: StandardSchemaV1
  schemaPath?: string
  validateAtBuild: boolean
  validateAtRuntime: boolean
  jsonSchemaTarget: StandardJSONSchemaV1.Target
  onError: ErrorBehavior
}

export interface RuntimeValidationArtifacts {
  draft: SchemaDraft
  jsonSchema: Record<string, unknown>
  typeDeclaration: string
  validateTemplate: string
  validateTemplateDeclaration: string
}

export async function resolveValidationOptions(
  options: ValidationOptions & { schemaPath?: string } = {},
  rootDir = process.cwd(),
): Promise<ResolvedValidationOptions> {
  let schema = options.$schema
  let schemaPath = options.schemaPath

  if (typeof schema === 'string') {
    const jiti = createJiti(join(rootDir, 'nuxt-safe-runtime-config.loader.mjs'))
    const resolvedPath = jiti.esmResolve(schema)
    schemaPath = resolvedPath.startsWith('file:') ? fileURLToPath(resolvedPath) : resolvedPath
    schema = await jiti.import<unknown>(schemaPath, { default: true }) as StandardSchemaV1

    if (!isStandardSchema(schema))
      throw new TypeError(`Schema module must default export a Standard Schema: ${schemaPath}`)
  }

  return {
    $schema: schema,
    schemaPath,
    validateAtBuild: options.validateAtBuild ?? true,
    validateAtRuntime: options.validateAtRuntime ?? false,
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

  return {
    draft,
    jsonSchema,
    typeDeclaration: options.schemaPath
      ? generateSchemaTypeDeclaration(options.schemaPath, options.validateAtRuntime ? 'output' : 'input')
      : generateTypeDeclaration(jsonSchema),
    validateTemplate: `${runtimeSchema}export { runtimeSchema }\nexport const schema = ${JSON.stringify(jsonSchema)}\nexport const onError = ${JSON.stringify(options.onError)}\nexport const draft = ${JSON.stringify(draft)}\n`,
    validateTemplateDeclaration: `import type { Schema, SchemaDraft } from '@cfworker/json-schema'\nimport type { StandardSchemaV1 } from '@standard-schema/spec'\nexport declare const runtimeSchema: StandardSchemaV1 | null\nexport declare const schema: Schema\nexport declare const onError: 'throw' | 'warn' | 'ignore'\nexport declare const draft: SchemaDraft\n`,
  }
}
