import type { Nuxt } from '@nuxt/schema'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { ResolvedValidationOptions } from './validation'
import { createJiti } from 'jiti'
import { errorMessage } from './utils/error'

interface NuxtKitWithSchemas {
  updateRuntimeConfig: (runtimeConfig: Record<string, unknown>) => void | Promise<void>
}

/** Nuxt 5 validates runtime config against the schemas it lists in `_runtimeConfigSchemas`. */
export function supportsNativeSchemas(nuxt: Nuxt): boolean {
  return Array.isArray((nuxt.options as { _runtimeConfigSchemas?: unknown })._runtimeConfigSchemas)
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
 * Declares each env schema value as any value for Nuxt. The env schema reads and checks its
 * `NUXT_*` variables itself, and Nuxt would otherwise infer a type from the placeholder defaults
 * and reject the variables before that check runs.
 */
export async function registerEnvSchemaPaths(nuxtPackage: string, paths: string[][]): Promise<void> {
  const update: Record<string, unknown> = {}
  for (const path of paths) {
    let parent = update
    for (const key of path.slice(0, -1))
      parent = (parent[key] ||= {}) as Record<string, unknown>
    parent[path.at(-1)!] = anyValue
  }
  await updateNativeRuntimeConfig(nuxtPackage, update)
}
