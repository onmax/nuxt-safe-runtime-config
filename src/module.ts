import type { StandardSchemaV1 } from '@standard-schema/spec'
import { defineNuxtModule } from '@nuxt/kit'

export interface ModuleOptions {
  $schema: StandardSchemaV1
}

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: 'nuxt-safe-runtime-config',
    configKey: 'safeRuntimeConfig',
  },
  defaults: {
    $schema: undefined,
  },
  setup(options, nuxt) {
    if (!options.$schema)
      return

    const schema = options.$schema

    // Validate during dev (ready) and build (build:done)
    // Skip during prepare/typecheck where env vars may not be set
    nuxt.hook('ready', async () => {
      if ((nuxt.options as any)._prepare)
        return
      await validateRuntimeConfig(nuxt.options.nitro.runtimeConfig, schema)
    })
    nuxt.hook('build:done', async () => {
      await validateRuntimeConfig(nuxt.options.nitro.runtimeConfig, schema)
    })
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
