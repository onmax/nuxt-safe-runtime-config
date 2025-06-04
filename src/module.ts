import type { StandardSchemaV1 } from '@standard-schema/spec'
import { defineNuxtModule } from '@nuxt/kit'
import { consola } from 'consola'

export interface ModuleOptions {
  $schema: StandardSchemaV1
}

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: 'nuxt-safe-runtime-config',
    configKey: 'safeRuntimeConfig',
  },
  defaults: {
    $schema: undefined, // No default schema, users must provide their own
  },
  setup(options, nuxt) {
    // Skip validation when no schema is provided to avoid breaking existing setups
    // This makes the module opt-in and non-intrusive
    if (!options?.$schema)
      return

    // In development mode, validate immediately when modules are done loading
    // This catches config errors early during dev server startup
    if (nuxt.options.dev) {
      nuxt.hook('modules:done', async () => {
        await validateRuntimeConfig(nuxt, options)
      })
      return
    }

    // For production builds, validate after build is complete
    // This ensures validation runs during CI/CD pipelines and local builds
    nuxt.hook('build:done', async () => {
      await validateRuntimeConfig(nuxt, options)
    })
  },
})

async function validateRuntimeConfig(nuxt: any, options: ModuleOptions): Promise<void> {
  const schemaConfig = options.$schema

  // Skip validation when no schema is provided to avoid breaking existing setups
  // This makes the module opt-in and non-intrusive
  if (!schemaConfig)
    return

  try {
    const runtimeConfig = nuxt.options.runtimeConfig || {}

    // We use Standard Schema to ensure compatibility with multiple validation libraries
    // This gives users flexibility to choose their preferred schema library (Zod, Valibot, etc.)
    if (!isStandardSchema(schemaConfig)) {
      consola.error('Safe Runtime Config: Schema is not Standard Schema compatible')
      return
    }
    const result = await schemaConfig['~standard'].validate(runtimeConfig)

    // Standard Schema uses different result formats, so we check for issues property
    // to handle both success/failure patterns across different implementations
    if ('issues' in result && result.issues && result.issues.length > 0) {
      consola.error('Safe Runtime Config: Validation failed!')
      result.issues.forEach((issue: any, index: number) => {
        consola.error(`  ${index + 1}. ${formatIssue(issue)}`)
      })
      // We throw to stop the build process and force developers to fix config issues
      throw new Error('Runtime config validation failed')
    }

    consola.success('Validated Runtime Config')
  }
  catch (error) {
    consola.error('Safe Runtime Config: Validation error:', error)
    throw error
  }
}

// Standard Schema detection helps ensure we're working with compatible validation libraries
// This prevents runtime errors when users provide incompatible schema objects
function isStandardSchema(schema: any): schema is StandardSchemaV1 {
  return schema
    && typeof schema === 'object'
    && '~standard' in schema
    && typeof schema['~standard'] === 'object'
    && typeof schema['~standard'].validate === 'function'
}

// We format validation issues in a developer-friendly way to make debugging easier
// The path shows exactly where in the config the issue occurred
function formatIssue(issue: any): string {
  const path = issue.path
    ? issue.path.map((p: any) => p && typeof p === 'object' && 'key' in p ? p.key : p).join('.')
    : 'root'
  return `${path}: ${issue.message || 'Validation error'}`
}
