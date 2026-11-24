import type { Nuxt } from '@nuxt/schema'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { ResolvedValidationOptions } from './validation'
import { createJiti } from 'jiti'
import { errorMessage } from './utils/error'

interface NuxtKitWithSchemas {
  updateRuntimeConfig: (runtimeConfig: Record<string, unknown>) => void | Promise<void>
}

interface NativeSchemaNode {
  p?: Record<string, NativeSchemaNode>
}

interface NativeSchemaEntry {
  path: string[]
  node: NativeSchemaNode
}

function nativeSchemas(nuxt: Nuxt): NativeSchemaEntry[] | undefined {
  const entries = (nuxt.options as { _runtimeConfigSchemas?: NativeSchemaEntry[] })._runtimeConfigSchemas
  return Array.isArray(entries) ? entries : undefined
}

/**
 * Whether Nuxt stops the server when a value fails a schema that a module registers. Nuxt 4.7
 * compiles runtime config schemas too, but before `compatibilityVersion: 5` it only warns about a
 * module's schema and starts with the default, which hides the invalid value from this module.
 */
export function enforcesModuleSchemas(nuxt: Nuxt): boolean {
  return supportsNativeSchemas(nuxt) && (nuxt.options.future?.compatibilityVersion ?? 4) >= 5
}

export function supportsNativeSchemas(nuxt: Nuxt): boolean {
  return nativeSchemas(nuxt) !== undefined
}

export function onlyInferredPaths(nuxt: Nuxt, paths: string[][]): string[][] {
  const entries = nativeSchemas(nuxt)
  if (!entries)
    return []
  return paths.filter(path => !entries.some((entry) => {
    if (!Array.isArray(entry.path))
      return true
    const commonLength = Math.min(path.length, entry.path.length)
    if (entry.path.slice(0, commonLength).some((part, index) => part !== path[index]))
      return false
    let node = entry.node
    for (const key of path.slice(commonLength)) {
      if (!node?.p)
        return true
      if (!Object.hasOwn(node.p, key))
        return false
      node = node.p[key]!
    }
    return true
  }))
}

async function updateNativeRuntimeConfig(nuxtPackage: string, update: object): Promise<void> {
  // The Kit this module resolves can predate schemas and would merge a schema in as a value.
  const kit = await import(createJiti(nuxtPackage).esmResolve('@nuxt/kit')) as NuxtKitWithSchemas
  await kit.updateRuntimeConfig(update as Record<string, unknown>)
}

/**
 * Hands `schema` to Nuxt for the whole runtime config. Nuxt then fills its defaults, coerces
 * `NUXT_*` values, requires values without a default and types `useRuntimeConfig()`.
 *
 * Returns why Nuxt can't use the schema, or `undefined` once it took it. Nuxt needs a Standard JSON
 * Schema output and synchronous validation, so schemas with transforms stay with this module.
 * Native checks are mandatory, so disabled or non-throwing validation also stays with this module.
 */
export async function registerNativeSchema(
  nuxtPackage: string,
  schema: StandardSchemaV1,
  options: Pick<ResolvedValidationOptions, 'runtimeCheck' | 'onError'>,
): Promise<string | undefined> {
  if (!options.runtimeCheck || options.onError !== 'throw')
    return 'native validation requires runtime validation and onError: "throw"'

  const standard: StandardSchemaV1['~standard'] & { jsonSchema?: { output?: unknown } } = schema['~standard']
  const output = standard.jsonSchema?.output
  if (typeof output !== 'function')
    return 'the schema does not implement Standard JSON Schema'
  // Checked here so a schema with transforms doesn't get Nuxt's warning to remove them.
  try {
    (output as (options: { target: 'draft-2020-12' }) => unknown)({ target: 'draft-2020-12' })
  }
  catch (error) {
    return `the schema has no JSON Schema output (${errorMessage(error)})`
  }
  try {
    await updateNativeRuntimeConfig(nuxtPackage, schema)
  }
  catch (error) {
    return errorMessage(error)
  }
}

const anyValue: StandardSchemaV1 & { '~standard': { jsonSchema: { input: () => object, output: () => object } } } = {
  '~standard': {
    version: 1,
    vendor: 'nuxt-safe-runtime-config',
    validate: value => ({ value }),
    jsonSchema: { input: () => ({}), output: () => ({}) },
  },
}

/**
 * Declares module-owned values as unconstrained for Nuxt instead of letting it infer a type
 * from the defaults. The module still checks these values at startup.
 */
export async function registerPassthroughPaths(nuxt: Nuxt, nuxtPackage: string, paths: string[][]): Promise<void> {
  const inferredPaths = onlyInferredPaths(nuxt, paths)
  if (!inferredPaths.length)
    return
  const update: Record<string, unknown> = Object.create(null)
  for (const path of inferredPaths) {
    let parent = update
    for (const key of path.slice(0, -1))
      parent = (parent[key] ||= Object.create(null)) as Record<string, unknown>
    parent[path.at(-1)!] = anyValue
  }
  await updateNativeRuntimeConfig(nuxtPackage, update)
}

export function inferredSchemaPaths(config: Record<string, unknown>, schema: Record<string, unknown> | null): string[][] {
  const properties = schema?.properties as Record<string, unknown> | undefined
  return Object.entries(config).flatMap(([key, value]) => {
    const property = properties && Object.hasOwn(properties, key) ? properties[key] : schema?.additionalProperties
    if (property === undefined || property === false || typeof value === 'string')
      return []
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const childSchema = property && typeof property === 'object' ? property as Record<string, unknown> : null
      return inferredSchemaPaths(value as Record<string, unknown>, childSchema).map(path => [key, ...path])
    }
    return [[key]]
  })
}
