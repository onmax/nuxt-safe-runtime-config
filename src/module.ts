import type { StandardSchemaV1 } from '@standard-schema/spec'
import { addImportsDir, addTemplate, createResolver, defineNuxtModule } from '@nuxt/kit'
import { toJsonSchema } from '@standard-community/standard-json'

export interface ModuleOptions {
  $schema: StandardSchemaV1
  validateAtBuild: boolean
  validateAtRuntime: boolean
}

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: 'nuxt-safe-runtime-config',
    configKey: 'safeRuntimeConfig',
  },
  defaults: {
    $schema: undefined,
    validateAtBuild: true,
    validateAtRuntime: false,
  },
  async setup(options, nuxt) {
    if (!options.$schema)
      return

    const schema = options.$schema
    const resolver = createResolver(import.meta.url)

    // Build-time validation (existing behavior)
    if (options.validateAtBuild) {
      nuxt.hook('ready', async () => {
        if ((nuxt.options as any)._prepare)
          return
        await validateRuntimeConfig(nuxt.options.nitro.runtimeConfig, schema)
      })
      nuxt.hook('build:done', async () => {
        await validateRuntimeConfig(nuxt.options.nitro.runtimeConfig, schema)
      })
    }

    // Runtime validation setup
    if (options.validateAtRuntime) {
      const jsonSchema = await toJsonSchema(schema as any)
      addTemplate({
        filename: 'safe-runtime-config/schema.json',
        write: true,
        getContents: () => JSON.stringify(jsonSchema),
      })

      addImportsDir(resolver.resolve('./runtime/composables'))
    }
  },
})

async function validateRuntimeConfig(config: any, schema: StandardSchemaV1): Promise<void> {
  if (!isStandardSchema(schema)) {
    console.error('Safe Runtime Config: Schema is not Standard Schema compatible')
    throw new Error('Invalid schema format')
  }

  const result = await schema['~standard'].validate(config)

  if ('issues' in result && result.issues && result.issues.length > 0) {
    console.error('Safe Runtime Config: Validation failed!')
    result.issues.forEach((issue: any, index: number) => {
      console.error(`  ${index + 1}. ${formatIssue(issue)}`)
    })
    throw new Error('Runtime config validation failed')
  }

  // eslint-disable-next-line no-console
  console.log('✓ Validated Runtime Config')
}

function isStandardSchema(schema: any): schema is StandardSchemaV1 {
  return schema
    && typeof schema === 'object'
    && '~standard' in schema
    && typeof schema['~standard'] === 'object'
    && typeof schema['~standard'].validate === 'function'
}

function formatIssue(issue: any): string {
  const path = issue.path
    ? issue.path.map((p: any) => p && typeof p === 'object' && 'key' in p ? p.key : p).join('.')
    : 'root'
  return `${path}: ${issue.message || 'Validation error'}`
}
